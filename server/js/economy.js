// Keep SQLite, the online players and client notifications in the same operation.
// The callback must be synchronous: better-sqlite3 cannot span async work.
var ACTIONS = [
    'shop_buy', 'market_sell', 'market_buy', 'guild_create',
    'guild_deposit', 'guild_buy_hall', 'guild_summon_boss', 'guild_spawn_chest'
];
var FIELDS = [
    'gold', 'guildId', 'weapon', 'weaponLevel', 'armor', 'armorLevel',
    'avatar', 'weaponAvatar', 'hitPoints', 'maxHitPoints',
    'inventory', 'inventoryCount'
];
var METHODS = ['send', 'broadcast', 'sendHubState'];

exports.handles = function(action) {
    return ACTIONS.indexOf(action) !== -1;
};

exports.findOnlinePlayer = function(player, name) {
    var worlds = player.server.server && player.server.server.worlds || [player.server];
    for(var i = 0; i < worlds.length; i++) {
        var online = worlds[i].getPlayerByName(name);
        if(online) return online;
    }
    return null;
};

exports.recordSpawn = function(player, entity) {
    if(!entity) throw new Error('Unable to spawn purchased entity');
    var server = player.server;
    player._economyUndo.push(function() {
        // A synchronous transaction returns before world updates can expose
        // this new entity. Remove pending spawns without scheduling a respawn.
        ['blinkTimeout', 'despawnTimeout', 'returnTimeout', 'respawnTimeout'].forEach(function(timer) {
            if(entity[timer]) clearTimeout(entity[timer]);
        });
        ['entities', 'mobs', 'items'].forEach(function(collection) {
            if(server[collection] && server[collection][entity.id] === entity) delete server[collection][entity.id];
        });
        Object.keys(server.groups || {}).forEach(function(id) {
            var group = server.groups[id];
            if(group.entities) delete group.entities[entity.id];
            if(group.incoming) group.incoming = group.incoming.filter(function(item) { return item !== entity; });
        });
        entity.isDead = true;
        entity.group = null;
    });
};

exports.run = function(player, action, data, operation) {
    var db = player.databaseHandler;
    var participants = [player];
    function include(other) {
        if(other && participants.indexOf(other) === -1) participants.push(other);
    }
    if(action === 'market_buy') {
        var listing = db.getMarketItemById(data.marketId);
        if(listing) include(exports.findOnlinePlayer(player, listing.seller));
    }
    if(player.guildId) {
        var guild = db.getGuildById(player.guildId);
        if(guild) guild.members.forEach(function(name) {
            include(player.server.getPlayerByName(name));
        });
    }

    var effects = [];
    var snapshots = participants.map(function(participant) {
        var values = {};
        var descriptors = {};
        FIELDS.forEach(function(field) {
            var descriptor = Object.getOwnPropertyDescriptor(participant, field);
            if(descriptor && Array.isArray(descriptor.value)) {
                descriptor.value = descriptor.value.slice();
            }
            values[field] = descriptor;
        });
        METHODS.forEach(function(method) {
            var original = participant[method];
            descriptors[method] = Object.getOwnPropertyDescriptor(participant, method);
            if(typeof original === 'function') {
                participant[method] = function() {
                    effects.push({ target: participant, method: original,
                        args: Array.prototype.slice.call(arguments) });
                };
            }
        });
        return { player: participant, values: values, methods: descriptors };
    });
    function restoreMethods() {
        snapshots.forEach(function(snapshot) {
            METHODS.forEach(function(method) {
                if(snapshot.methods[method]) {
                    Object.defineProperty(snapshot.player, method, snapshot.methods[method]);
                } else {
                    delete snapshot.player[method];
                }
            });
        });
    }

    var result;
    player._economyTransactionActive = true;
    player._economyUndo = [];
    try {
        result = db.db.transaction(function() {
            var value = operation();
            if(value && typeof value.then === 'function') {
                throw new Error('Economic transactions must be synchronous');
            }
            participants.forEach(function(participant) {
                if(!Number.isSafeInteger(participant.gold) || participant.gold < 0) {
                    throw new Error('Invalid player balance');
                }
            });
            return value;
        }).immediate();
    } catch(error) {
        player._economyUndo.forEach(function(undo) { undo(); });
        snapshots.forEach(function(snapshot) {
            FIELDS.forEach(function(field) {
                if(snapshot.values[field]) {
                    Object.defineProperty(snapshot.player, field, snapshot.values[field]);
                } else {
                    delete snapshot.player[field];
                }
            });
        });
        throw error;
    } finally {
        player._economyTransactionActive = false;
        delete player._economyUndo;
        restoreMethods();
    }

    // Once committed, a disconnected recipient must not undo a completed sale.
    effects.forEach(function(effect) {
        try {
            effect.method.apply(effect.target, effect.args);
        } catch(error) {
            if(typeof log !== 'undefined') log.error('Economic notification failed: ' + error.message);
        }
    });
    return result;
};
