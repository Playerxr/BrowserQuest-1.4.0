var fs = require('fs'),
    Metrics = require('./metrics'),
    ProductionConfig = require('./productionconfig'),
    _ = require('underscore');


function main(config) {
    var Log = require('log');
    switch(config.debug_level) {
        case "error":
            log = new Log(Log.ERROR); break;
        case "debug":
            log = new Log(Log.DEBUG); break;
        case "info":
            log = new Log(Log.INFO); break;
    };

    var production_config = new ProductionConfig(config);
    if(production_config.inProduction()) {
        _.extend(config, production_config.getProductionSettings());
    }

    var ws = require("./ws"),
        WorldServer = require("./worldserver"),
        ConnectionQueue = null,
        server = new ws.MultiVersionWebsocketServer(process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port, config.use_one_port),
        metrics = config.metrics_enabled ? new Metrics(config) : null,
        worlds = [],
        lastTotalPlayers = 0,
        DatabaseSelector = require("./databaseselector"),
        firebaseService = null;

        try {
            ConnectionQueue = require("./queue");
        } catch(e) {
            ConnectionQueue = function(opts) {
                this.maxQueueSize = (opts && typeof opts.maxQueueSize === "number") ? opts.maxQueueSize : 100;
                this.queue = [];
                this.size = function() { return this.queue.length; };
                this.enqueue = function(conn) {
                    if (this.queue.length >= this.maxQueueSize) {
                        conn.sendUTF8('full');
                        conn.close('All worlds are full');
                        return false;
                    }
                    this.queue.push(conn);
                    conn.sendUTF8('queue:' + this.queue.length + ':' + this.queue.length);
                    return true;
                };
                this.processQueue = function(wList, cap, cb) {
                    var count = 0;
                    while (this.queue.length > 0) {
                        var avail = _.detect(wList, function(w) { return w.map && w.map.isLoaded && w.playerCount < cap; });
                        if (!avail) break;
                        var next = this.queue.shift();
                        count++;
                        cb(next, avail);
                    }
                    return count;
                };
            };
        }

        var connectionQueue = new ConnectionQueue({
            maxQueueSize: (typeof config.max_queue_size === 'number') ? config.max_queue_size : 100
        });
        server.connectionQueue = connectionQueue;

        try {
            firebaseService = require("./firebase_service");
            if (firebaseService && typeof firebaseService.init === 'function') {
                firebaseService.init();
            }
        } catch(e) {}

        var admitConnectionToWorld = function(connection, world) {
            if(!world || !connection || connection.isClosed) return;
            world.updatePopulation();
            world.connect_callback(new Player(connection, world, databaseHandler));
        };

        var drainWaitingQueue = function() {
            connectionQueue.processQueue(worlds, config.nb_players_per_world, admitConnectionToWorld);
        };

        checkPopulationInterval = setInterval(function() {
            drainWaitingQueue();
            var currentOnline = 0;
            _.each(worlds, function(w) { currentOnline += (w.playerCount || 0); });

            if(metrics && metrics.isReady) {
                metrics.updateWorldCount();
                metrics.getTotalPlayers(function(totalPlayers) {
                    if(totalPlayers !== lastTotalPlayers) {
                        lastTotalPlayers = totalPlayers;
                        _.each(worlds, function(world) {
                            world.updatePopulation(totalPlayers);
                        });
                        if (firebaseService) firebaseService.updateServerStats(totalPlayers);
                    }
                });
            } else if(currentOnline !== lastTotalPlayers) {
                lastTotalPlayers = currentOnline;
                if (firebaseService) firebaseService.updateServerStats(currentOnline);
            }
        }, 3000);

    log.info("Starting BrowserQuest game server...");
    // Shared SQLite accounts and market listings can belong to any world.
    server.worlds = worlds;
    selector = DatabaseSelector(config);
    databaseHandler = new selector(config);
    server.databaseHandler = databaseHandler;

    server.onConnect(function(connection) {
        if(!worlds.length || _.some(worlds, function(candidate) {
            return !candidate.map || !candidate.map.isLoaded;
        })) {
            connection.sendUTF8('notready');
            connection.close('Worlds are still loading');
            return;
        }
        var world, // the one in which the player will be spawned
            connect = function() {
                if(world) {
                    world.connect_callback(new Player(connection, world, databaseHandler));
                }
            };

        if(metrics) {
            metrics.getOpenWorldCount(function(open_world_count) {
                // choose the least populated world among open worlds
                world = _.min(_.first(worlds, open_world_count), function(w) { return w.playerCount; });
                if(world && world.playerCount < config.nb_players_per_world && connectionQueue.size() === 0) {
                    connect();
                } else {
                    connectionQueue.enqueue(connection);
                }
            });
        }
        else {
            if(connectionQueue.size() > 0) {
                connectionQueue.enqueue(connection);
                drainWaitingQueue();
                return;
            }
            // simply fill each world sequentially until they are full
            world = _.detect(worlds, function(world) {
                return world.playerCount < config.nb_players_per_world;
            });
            if(!world) {
                connectionQueue.enqueue(connection);
                return;
            }
            admitConnectionToWorld(connection, world);
        }
    });

    server.onError(function() {
        log.error(Array.prototype.join.call(arguments, ", "));
        var error = arguments[0];
        if(error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
            process.exit(1);
        }
    });

    var onPopulationChange = function() {
        metrics.updatePlayerCounters(worlds, function(totalPlayers) {
            _.each(worlds, function(world) {
                world.updatePopulation(totalPlayers);
            });
        });
        metrics.updateWorldDistribution(getWorldDistribution(worlds));
    };

    _.each(_.range(config.nb_worlds), function(i) {
        var world = new WorldServer('world'+ (i+1), config.nb_players_per_world, server, databaseHandler);
        world.run(config.map_filepath);
        worlds.push(world);
        if(metrics) {
            if(typeof world.onPlayerAdded === 'function') {
                world.onPlayerAdded(onPopulationChange);
            }
            if(typeof world.onPlayerRemoved === 'function') {
                world.onPlayerRemoved(function() {
                    onPopulationChange();
                    drainWaitingQueue();
                });
            }
        } else if(typeof world.onPlayerRemoved === 'function') {
            world.onPlayerRemoved(drainWaitingQueue);
        }
    });

    server.onRequestStatus(function() {
        if(_.some(worlds, function(world) { return !world.map || !world.map.isLoaded; })) return '[]';
        return JSON.stringify(getWorldDistribution(worlds));
    });

    if(config.metrics_enabled) {
        metrics.ready(function() {
            onPopulationChange(); // initialize all counters to 0 when the server starts
        });
    }

    process.on('uncaughtException', function (e) {
        // Display the full error stack, to aid debugging
        log.error('uncaughtException: ' + e.stack);
    });
}

function getWorldDistribution(worlds) {
    var distribution = [];

    _.each(worlds, function(world) {
        distribution.push(world.playerCount);
    });
    return distribution;
}

function getConfigFile(path, callback) {
    fs.readFile(path, 'utf8', function(err, json_string) {
        if(err) {
            console.info("This server can be customized by creating a configuration file named: " + err.path);
            callback(null);
        } else {
            callback(JSON.parse(json_string.replace(/^\uFEFF/, '')));
        }
    });
}

var defaultConfigPath = './server/config.json',
    customConfigPath = './server/config_local.json';

process.argv.forEach(function (val, index, array) {
    if(index === 2) {
        customConfigPath = val;
    }
});

getConfigFile(defaultConfigPath, function(defaultConfig) {
    getConfigFile(customConfigPath, function(localConfig) {
        if(localConfig) {
            main(localConfig);
        } else if(defaultConfig) {
            main(defaultConfig);
        } else {
            console.error("Server cannot start without any configuration file.");
            process.exit(1);
        }
    });
});
