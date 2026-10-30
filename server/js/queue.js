var cls = require("./lib/class"),
    _ = require("underscore");

var ConnectionQueue = cls.Class.extend({
    init: function(options) {
        options = options || {};
        this.maxQueueSize = (typeof options.maxQueueSize === "number" && options.maxQueueSize >= 0)
            ? options.maxQueueSize
            : 100;
        this.queue = [];
    },

    _purgeClosed: function() {
        this.queue = _.filter(this.queue, function(conn) {
            if (!conn || conn.isClosed) {
                if (conn) conn.inQueue = false;
                return false;
            }
            return true;
        });
    },

    size: function() {
        this._purgeClosed();
        return this.queue.length;
    },

    enqueue: function(connection) {
        var self = this;
        if (!connection || connection.isClosed) {
            return false;
        }

        this._purgeClosed();

        if (this.queue.length >= this.maxQueueSize) {
            connection.inQueue = false;
            connection.sendUTF8("full");
            connection.close("All worlds and waiting queue are full");
            return false;
        }

        if (_.indexOf(this.queue, connection) === -1) {
            connection.inQueue = true;
            this.queue.push(connection);

            if (typeof connection.onClose === "function") {
                connection.onClose(function() {
                    if (connection.inQueue) {
                        self.remove(connection);
                    }
                });
            }
        }

        this.notifyQueuePositions();
        return true;
    },

    remove: function(connection) {
        if (!connection) return false;
        var before = this.queue.length;
        connection.inQueue = false;
        this.queue = _.without(this.queue, connection);
        this._purgeClosed();
        if (this.queue.length !== before && this.queue.length > 0) {
            this.notifyQueuePositions();
        }
        return this.queue.length !== before;
    },

    notifyQueuePositions: function() {
        this._purgeClosed();
        var total = this.queue.length;
        _.each(this.queue, function(conn, index) {
            var pos = index + 1;
            var msg = "queue:" + pos + ":" + total;
            if (conn._lastQueueMessage !== msg) {
                conn._lastQueueMessage = msg;
                conn.sendUTF8(msg);
            }
        });
    },

    processQueue: function(worlds, maxPlayersPerWorld, admitCallback) {
        this._purgeClosed();
        if (this.queue.length === 0 || !worlds || !worlds.length) {
            return 0;
        }

        var admittedCount = 0;
        var admittedPerWorld = {};

        while (this.queue.length > 0) {
            var availableWorld = _.detect(worlds, function(world, idx) {
                if (!world || !world.map || !world.map.isLoaded) {
                    return false;
                }
                var key = world.id || ("w_" + idx);
                var currentCount = (world.playerCount || 0) + (admittedPerWorld[key] || 0);
                return currentCount < maxPlayersPerWorld;
            });

            if (!availableWorld) {
                break;
            }

            var nextConn = this.queue.shift();
            if (!nextConn || nextConn.isClosed) {
                if (nextConn) nextConn.inQueue = false;
                continue;
            }

            nextConn.inQueue = false;
            delete nextConn._lastQueueMessage;

            var worldKey = availableWorld.id || ("w_" + _.indexOf(worlds, availableWorld));
            admittedPerWorld[worldKey] = (admittedPerWorld[worldKey] || 0) + 1;
            admittedCount += 1;

            if (typeof admitCallback === "function") {
                admitCallback(nextConn, availableWorld);
            }
        }

        if (admittedCount > 0 && this.queue.length > 0) {
            this.notifyQueuePositions();
        }

        return admittedCount;
    }
});

module.exports = ConnectionQueue;
