const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const _ = require('underscore');
const ConnectionQueue = require('../server/js/queue');

function startup({ ready = true, full = false, maxQueueSize = 100 } = {}) {
    const hooks = {}, exits = [], messages = [], worldHooks = {}, admitted = [];
    const config = { debug_level: 'info', port: 8000, use_one_port: true, nb_worlds: 1,
        nb_players_per_world: 1, max_queue_size: maxQueueSize, map_filepath: 'unused', metrics_enabled: false };
    function Log() { this.info = this.error = () => {}; }
    function Server() {
        this.onConnect = fn => { hooks.connect = fn; };
        this.onError = fn => { hooks.error = fn; };
        this.onRequestStatus = fn => { hooks.status = fn; };
    }
    let worldInstance;
    function World() {
        worldInstance = this;
        this.id = 'world1';
        this.playerCount = full ? 1 : 0;
        this.map = { isLoaded: ready };
        this.run = () => {};
        this.updatePopulation = () => {};
        this.connect_callback = player => { admitted.push(player); };
        this.onPlayerRemoved = fn => { worldHooks.removed = fn; };
    }
    const deps = {
        fs: { readFile(file, encoding, callback) { callback(null, JSON.stringify(config)); } },
        underscore: _, log: Log,
        './metrics': function() {},
        './productionconfig': function() { this.inProduction = () => false; },
        './ws': { MultiVersionWebsocketServer: Server }, './worldserver': World,
        './databaseselector': () => function() {},
        './queue': ConnectionQueue
    };
    const context = { require(name) { if(!(name in deps)) throw new Error(name); return deps[name]; },
        console, Player: function(conn, world) { this.connection = conn; this.world = world; conn.sendUTF8('go'); },
        setInterval() { return 1; },
        process: { argv: [], env: {}, on() {}, exit(code) { exits.push(code); } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/js/main.js'), 'utf8'), context);
    const connection = {
        sendUTF8(message) { messages.push(message); },
        close() { this.isClosed = true; messages.push('closed'); if(this._onClose) this._onClose(); },
        onClose(fn) { this._onClose = fn; }
    };
    return { hooks, exits, messages, connection, worldHooks, admitted, getWorld: () => worldInstance };
}

test('connections before maps are ready receive a retryable status', () => {
    const harness = startup({ ready: false });
    harness.hooks.connect(harness.connection);
    assert.deepEqual(harness.messages, ['notready', 'closed']);
    assert.deepEqual(JSON.parse(harness.hooks.status()), []);
});

test('full worlds enqueue incoming connections and admit them in FIFO order when capacity frees up', () => {
    const harness = startup({ full: true });
    const conn1Messages = [];
    const conn2Messages = [];
    const conn1 = {
        sendUTF8(msg) { conn1Messages.push(msg); },
        close() { this.isClosed = true; if(this._onClose) this._onClose(); },
        onClose(fn) { this._onClose = fn; }
    };
    const conn2 = {
        sendUTF8(msg) { conn2Messages.push(msg); },
        close() { this.isClosed = true; if(this._onClose) this._onClose(); },
        onClose(fn) { this._onClose = fn; }
    };

    harness.hooks.connect(conn1);
    assert.deepEqual(conn1Messages, ['queue:1:1']);
    assert.equal(harness.admitted.length, 0);

    harness.hooks.connect(conn2);
    assert.deepEqual(conn1Messages, ['queue:1:1', 'queue:1:2']);
    assert.deepEqual(conn2Messages, ['queue:2:2']);

    // When a player leaves the world, the first queued player is admitted and the second advances to position 1
    const world = harness.getWorld();
    world.playerCount = 0;
    harness.worldHooks.removed();

    assert.equal(harness.admitted.length, 1);
    assert.equal(harness.admitted[0].connection, conn1);
    assert.deepEqual(conn1Messages, ['queue:1:1', 'queue:1:2', 'go']);
    assert.deepEqual(conn2Messages, ['queue:2:2', 'queue:1:1']);
});

test('full worlds with a full waiting queue reject the socket with full', () => {
    const harness = startup({ full: true, maxQueueSize: 0 });
    assert.doesNotThrow(() => harness.hooks.connect(harness.connection));
    assert.deepEqual(harness.messages, ['full', 'closed']);
});

test('an occupied or forbidden port terminates the failed server process', () => {
    for(const code of ['EADDRINUSE', 'EACCES']) {
        const harness = startup();
        harness.hooks.error({ code });
        assert.deepEqual(harness.exits, [1]);
    }
});
