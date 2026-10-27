const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const _ = require('underscore');

function startup({ ready = true, full = false } = {}) {
    const hooks = {}, exits = [], messages = [];
    const config = { debug_level: 'info', port: 8000, use_one_port: true, nb_worlds: 1,
        nb_players_per_world: 1, map_filepath: 'unused', metrics_enabled: false };
    function Log() { this.info = this.error = () => {}; }
    function Server() {
        this.onConnect = fn => { hooks.connect = fn; };
        this.onError = fn => { hooks.error = fn; };
        this.onRequestStatus = fn => { hooks.status = fn; };
    }
    function World() {
        this.playerCount = full ? 1 : 0;
        this.map = { isLoaded: ready };
        this.run = this.updatePopulation = this.connect_callback = () => {};
    }
    const deps = {
        fs: { readFile(file, encoding, callback) { callback(null, JSON.stringify(config)); } },
        underscore: _, log: Log,
        './metrics': function() {},
        './productionconfig': function() { this.inProduction = () => false; },
        './ws': { MultiVersionWebsocketServer: Server }, './worldserver': World,
        './databaseselector': () => function() {}
    };
    const context = { require(name) { if(!(name in deps)) throw new Error(name); return deps[name]; },
        console, Player: function() {}, setInterval() { return 1; },
        process: { argv: [], env: {}, on() {}, exit(code) { exits.push(code); } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/js/main.js'), 'utf8'), context);
    const connection = { sendUTF8(message) { messages.push(message); }, close() { messages.push('closed'); } };
    return { hooks, exits, messages, connection };
}

test('connections before maps are ready receive a retryable status', () => {
    const harness = startup({ ready: false });
    harness.hooks.connect(harness.connection);
    assert.deepEqual(harness.messages, ['notready', 'closed']);
    assert.deepEqual(JSON.parse(harness.hooks.status()), []);
});

test('full worlds reject the socket without dereferencing an absent world', () => {
    const harness = startup({ full: true });
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
