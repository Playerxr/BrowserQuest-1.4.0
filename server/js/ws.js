/**
 * Serveur HTTP + WebSocket moderne (express + ws).
 * Remplace les anciennes librairies : websocket, websocket-server, bison, connect.
 * Sert aussi les fichiers statiques du dossier client/ sur le même port.
 */
var _ = require('underscore');
var cls = require('./lib/class');
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var express = require('express');
var WebSocketServer = require('ws').WebSocketServer;
var net = require('net');
var Format = require('./format');
var Types = require('../../shared/js/gametypes');
var MAX_PAYLOAD = 16 * 1024;
var AUTH_WINDOW_MS = 60000;
var AUTH_ATTEMPTS = 10;
var MAX_AUTH_ADDRESSES = 10000;

function reportError(error) {
    if (typeof log !== 'undefined' && log.error) log.error(error.stack || String(error));
}

// Walk the forwarding chain from the socket, stopping at the first untrusted hop.
function remoteAddress(request, trust) {
    var peer = request.socket.remoteAddress || '';
    if (!trust(peer, 0)) return peer;
    var forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map(function (ip) { return ip.trim(); }).filter(Boolean);
    if (!forwarded.every(function (ip) { return net.isIP(ip); })) return peer;
    var chain = [peer].concat(forwarded.reverse()), index = 0;
    while (index + 1 < chain.length && trust(chain[index], index)) index += 1;
    return chain[index];
}

var WS = {};

module.exports = WS;

var ROOT_DIR = path.resolve(__dirname, '..', '..');

/**
 * Classes abstraites Server et Connection
 */
var Server = cls.Class.extend({
    init: function (port) {
        this.port = port;
    },

    onConnect: function (callback) {
        this.connectionCallback = callback;
    },

    onError: function (callback) {
        this.errorCallback = callback;
    },

    broadcast: function (message) {
        throw 'Not implemented';
    },

    forEachConnection: function (callback) {
        _.each(this._connections, callback);
    },

    addConnection: function (connection) {
        this._connections[connection.id] = connection;
    },

    removeConnection: function (id) {
        delete this._connections[id];
    },

    getConnection: function (id) {
        return this._connections[id];
    }
});


var Connection = cls.Class.extend({
    init: function (id, connection, server) {
        this._connection = connection;
        this._server = server;
        this.id = id;
    },

    onClose: function (callback) {
        this.closeCallback = callback;
    },

    listen: function (callback) {
        this.listenCallback = callback;
    },

    broadcast: function (message) {
        throw 'Not implemented';
    },

    send: function (message) {
        throw 'Not implemented';
    },

    sendUTF8: function (data) {
        throw 'Not implemented';
    },

    close: function (logError) {
        if (this.isClosed) return;
        this.isClosed = true;
        if (typeof log !== 'undefined' && log.info) log.info('Closing connection to ' + this._connection.remoteAddress + '. Error: ' + logError);
        this._connection.close();
    }
});


/**
 * Serveur HTTP (express) + WebSocket (ws) sur un seul port.
 */
WS.MultiVersionWebsocketServer = Server.extend({
    _connections: {},
    _counter: 0,

    init: function (port, useOnePort) {
        var self = this;

        this._super(port);

        this._connections = Object.create(null);
        this._authAttempts = new Map();
        var app = express(), proxySetting = process.env.BROWSERQUEST_TRUST_PROXY;
        if (proxySetting && proxySetting !== 'false' && proxySetting !== '0') {
            app.set('trust proxy', proxySetting === 'true' || proxySetting === '1' ? true : proxySetting.split(',').map(function (entry) { return entry.trim(); }));
        }
        this._trustProxy = app.get('trust proxy fn');

        app.use(function (req, res, next) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: wss: ws: https:; script-src * 'unsafe-inline' 'unsafe-eval' https: blob:; style-src * 'unsafe-inline' https:; font-src * data: https:; connect-src * wss: ws: https:;");
            if (req.method === 'OPTIONS') {
                return res.sendStatus(200);
            }
            next();
        });

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        try {
            var adminRoutes = require('./admin_routes');
            if (typeof adminRoutes === 'function') {
                app.use(adminRoutes(self));
            }
        } catch(e) {
            if (typeof log !== 'undefined' && log.error) log.error('Admin routes init error: ' + e.message);
        }

        app.get('/status', function (request, response) {
            response.status(200);
            response.send(self.statusCallback ? self.statusCallback() : '[]');
        });

        // Génère à la volée la config client à partir de l'hôte de la requête
        // (fonctionne en local, via un tunnel ou un nom de domaine)
        var dynamicConfig = function (request, response) {
            // Express applies the configured proxy trust policy to request.secure.
            var isHttps = request.secure;
            var hostHeader = request.headers.host || 'localhost';
            var endpoint = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostHeader);
            var hostname = endpoint ? endpoint[1] : 'localhost';
            var portNumber = endpoint && endpoint[2] ? Number(endpoint[2]) : (isHttps ? 443 : 80);

            response.set('Cache-Control', 'no-store');
            response.json({
                host: hostname,
                port: portNumber,
                dispatcher: false
            });
        };
        app.get('/config/config_build.json', dynamicConfig);
        app.get('/config/config_local.json', dynamicConfig);

        if (useOnePort === true) {
            var staticOptions = {
                setHeaders: function (res) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                }
            };
            // Fichiers statiques du client
            app.use(express.static(path.join(ROOT_DIR, 'client'), staticOptions));
            // Fichiers partagés client/serveur
            app.use('/shared', express.static(path.join(ROOT_DIR, 'shared'), staticOptions));
        }

        this._httpServer = http.createServer(app);
        this._httpServer.listen(port, '0.0.0.0', function () {
            log.info('Serveur (HTTP + WebSocket) en écoute sur port ' + port + ' (0.0.0.0)');
        });

        this._wss = new WebSocketServer({
            server: this._httpServer,
            maxPayload: MAX_PAYLOAD,
            perMessageDeflate: false
        });
        this._wss.on('connection', function (socket, req) {
            if (socket._socket && typeof socket._socket.setNoDelay === 'function') {
                socket._socket.setNoDelay(true);
            }
            socket.remoteAddress = remoteAddress(req, self._trustProxy);
            var c = new WS.wsConnection(self._createId(), socket, self);
            c.sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
            self.addConnection(c);
            try {
                if (self.connectionCallback) self.connectionCallback(c);
            } catch (error) {
                reportError(error);
                c.close('Connection initialization failed.');
            }
        });
        this._wss.on('error', function (e) {
            if (self.errorCallback) {
                self.errorCallback(e);
            }
        });
    },

    _acceptAuthAttempt: function (address, now) {
        var attempts = this._authAttempts.get(address);
        if (!attempts || attempts.expires <= now) {
            if (this._authAttempts.size >= MAX_AUTH_ADDRESSES) {
                this._authAttempts.forEach(function (entry, key, entries) {
                    if (entry.expires <= now) entries.delete(key);
                });
                if (!attempts && this._authAttempts.size >= MAX_AUTH_ADDRESSES) return false;
            }
            attempts = { count: 0, expires: now + AUTH_WINDOW_MS };
            this._authAttempts.set(address, attempts);
        }
        attempts.count += 1;
        return attempts.count <= AUTH_ATTEMPTS;
    },

    _createId: function () {
        this._counter = (this._counter + 1) % 100000;
        return parseInt('5' + crypto.randomInt(100, 999) + '' + this._counter, 10);
    },

    broadcast: function (message) {
        this.forEachConnection(function (connection) {
            connection.send(message);
        });
    },

    onRequestStatus: function (statusCallback) {
        this.statusCallback = statusCallback;
    }
});


/**
 * Connexion basée sur la librairie `ws`
 */
WS.wsConnection = Connection.extend({
    init: function (id, connection, server) {
        var self = this;

        this._super(id, connection, server);

        this._messageTokens = 160;
        this._lastMessageTime = Date.now();
        this._connection.on('message', function (message, isBinary) {
            if (self.isClosed || !self.listenCallback) return;
            var now = Date.now();
            self._messageTokens = Math.min(160, self._messageTokens + Math.max(0, now - self._lastMessageTime) * 0.08);
            self._lastMessageTime = now;
            if (self._messageTokens < 1) {
                self.close('Message rate exceeded.');
                return;
            }
            self._messageTokens -= 1;
            if (isBinary || message.length > MAX_PAYLOAD) {
                self.close('Unsupported or oversized message.');
                return;
            }
            var data;
            try {
                data = JSON.parse(message.toString());
            } catch (error) {
                self.close('Received message was not valid JSON.');
                return;
            }
            if (Array.isArray(data) && (data[0] === Types.Messages.LOGIN || data[0] === Types.Messages.CREATE || data[0] === Types.Messages.GOOGLE_LOGIN) &&
                !self._server._acceptAuthAttempt(self._connection.remoteAddress || '', now)) {
                self.close('Too many authentication attempts.');
                return;
            }
            if (!Format.check(data)) {
                self.close('Invalid message format.');
                return;
            }
            try {
                self.listenCallback(data);
            } catch (error) {
                reportError(error);
                self.close('Message handling failed.');
            }
        });

        this._connection.on('close', function () {
            self.isClosed = true;
            try {
                if (self.closeCallback) self.closeCallback();
            } catch (error) {
                reportError(error);
            } finally {
                self._server.removeConnection(self.id);
            }
        });

        this._connection.on('error', function () {
            // Évite un crash du serveur sur une erreur de socket
        });
    },

    send: function (message) {
        this.sendUTF8(JSON.stringify(message));
    },

    sendUTF8: function (data) {
        if (this._connection.readyState === 1) {
            this._connection.send(data);
        }
    }
});
