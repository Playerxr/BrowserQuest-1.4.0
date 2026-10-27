const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Class = require('../server/js/lib/class').Class;
const Types = require('../shared/js/gametypes');
const _ = require('underscore');

function clock() {
    let now = 0, next = 0;
    const tasks = new Map();
    return { Date: { now: () => now },
        setInterval(fn) { tasks.set(++next, { fn, at: now, interval: true }); return next; },
        clearInterval(id) { tasks.delete(id); },
        setTimeout(fn, ms) { tasks.set(++next, { fn, at: now + ms }); return next; },
        clearTimeout(id) { tasks.delete(id); },
        advance(ms = 100) {
            now += ms;
            for(const [id, task] of [...tasks]) {
                if(tasks.has(id) && (task.interval || now >= task.at)) {
                    if(!task.interval) tasks.delete(id);
                    task.fn();
                }
            }
        }, count: () => tasks.size };
}
function load(file, env = {}, deps = {}) {
    let exported;
    const context = { Class, Types, _, log: { info() {}, debug() {}, error() {} },
        window: { location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:8000', port: '8000' } },
        ...env,
        define(names, factory) { exported = factory(...names.map(name => deps[name] || function() {})); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/', file), 'utf8'), context, { filename: file });
    return exported;
}
function appFixture(timer) {
    function jquery() {}
    jquery.fn = { on() {} };
    const App = load('app.js', timer, { jquery });
    const app = Object.create(App.prototype);
    Object.assign(app, { ready: false, starting: false, errors: [],
        createNewCharacterFormActive: () => false,
        getUsernameField: () => ({ val: () => 'hero' }),
        getPasswordField: () => ({ val: () => 'test' }),
        validateFormFields: () => true,
        setPlayButtonState(enabled) { this.starting = !enabled; },
        addValidationError(field, text) { this.errors.push(text); }
    });
    return app;
}

test('early login waits for game initialization instead of crashing after 2.5 seconds', () => {
    const timer = clock(), app = appFixture(timer);
    let starts = 0;
    app.startGame = () => starts++;
    app.tryStartingGame();
    timer.advance(3000);
    assert.equal(starts, 0);
    assert.equal(app.starting, true);
    app.ready = true; app.game = {};
    timer.advance();
    assert.equal(starts, 1);
    assert.equal(timer.count(), 0);
});

test('initialization timeout unlocks the login button and allows a later retry', () => {
    const timer = clock(), app = appFixture(timer);
    app.tryStartingGame();
    timer.advance(60000);
    assert.equal(app.starting, false);
    assert.equal(app.errors.length, 1);
    let starts = 0;
    app.ready = true; app.game = {}; app.startGame = () => starts++;
    app.tryStartingGame();
    assert.equal(starts, 1);
});

function gameFixture(timer) {
    const Game = load('game.js', timer);
    const game = Object.create(Game.prototype);
    Object.assign(game, { map: { isLoaded: false }, renderer: { camera: {}, scale: 1 },
        sprites: {}, failures: [], connectCalls: 0,
        loadSprites() {}, setUpdater() {}, setSpriteScale() {},
        connect() { this.connectCalls++; }
    });
    for(const name of ['loadAudio','initMusicAreas','initAchievements','initCursors','initAnimations','initShadows',
        'initHurtSprites','initEntityGrid','initItemGrid','initPathingGrid','initRenderingGrid','setPathfinder','initPlayer','setCursor']) {
        game[name] = () => {};
    }
    return game;
}

test('a failed image reports an error without leaving the startup interval running', () => {
    const timer = clock(), game = gameFixture(timer), results = [];
    game.run('login', result => results.push(result));
    game.sprites.failed = { isLoaded: false, loadError: 'Image unavailable' };
    timer.advance();
    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    assert.match(results[0].reason, /Image unavailable/);
    assert.equal(timer.count(), 0);
    assert.equal(game.connectCalls, 0);
});

test('map errors and loading deadlines terminate startup instead of waiting forever', () => {
    for(const mapError of [true, false]) {
        const timer = clock(), game = gameFixture(timer), results = [];
        game.run('login', result => results.push(result));
        if(mapError) game.map.loadError = 'Map unavailable';
        timer.advance(mapError ? 100 : 60000);
        assert.equal(results.length, 1);
        assert.equal(results[0].success, false);
        assert.equal(timer.count(), 0);
    }
});

test('initialization exceptions reach the form callback and the next attempt can connect', () => {
    const timer = clock(), game = gameFixture(timer), results = [];
    game.map.isLoaded = true;
    game.initPlayer = () => { throw new Error('initialization failed'); };
    game.run('login', result => results.push(result)); timer.advance();
    assert.equal(results[0].success, false);
    game.initPlayer = () => {};
    game.run('login', result => results.push(result)); timer.advance();
    assert.equal(game.connectCalls, 1);
    assert.equal(timer.count(), 0);
});

test('sprite image failures are retained for the game startup error callback', () => {
    function Image() {}
    const Sprite = load('sprite.js', { Image });
    const sprite = Object.create(Sprite.prototype);
    sprite.filepath = 'img/1/bow.png'; sprite.isLoaded = false;
    sprite.load();
    sprite.image.onerror();
    assert.equal(sprite.image.crossOrigin, null);
    assert.equal(sprite.loadError, undefined); // The retry is still pending.
    sprite.image.onerror();
    assert.match(sprite.loadError, /bow.png/);
});

test('worker errors and stalled workers fall back to JSON map loading', () => {
    for(const stalled of [false, true]) {
        const timer = clock(); let worker, request;
        function Worker() { worker = this; this.postMessage = () => {}; this.terminate = () => { this.terminated = true; }; }
        const Map = load('map.js', { ...timer, Worker }, { jquery: { ajax(options) { request = options; } } });
        const map = Object.create(Map.prototype);
        Object.assign(map, { _initMap() {}, _generateCollisionGrid() { this.collisionBuilt = true; },
            _generatePlateauGrid() {}, _checkReady() {} });
        map._loadMap(true);
        if(stalled) timer.advance(10000); else worker.onerror();
        assert.equal(worker.terminated, true);
        assert.equal(request.url, 'maps/world_client.json');
        request.success({});
        assert.equal(map.mapLoaded, true);
        assert.equal(map.collisionBuilt, true);
        assert.equal(timer.count(), 0);
    }
});

test('an unavailable JSON map records an error rather than blocking the form forever', () => {
    let request;
    const Map = load('map.js', clock(), { jquery: { ajax(options) { request = options; } } });
    const map = Object.create(Map.prototype);
    map._loadMap(false); request.error();
    assert.match(map.loadError, /carte/);
});

function socketFixture() {
    const timer = clock(), sockets = [], failures = [];
    function Socket() { this.readyState = 0; sockets.push(this); }
    Socket.prototype.close = function() { this.readyState = 3; if(this.onclose) this.onclose(); };
    const Client = load('gameclient.js', { ...timer, WebSocket: Socket,
        $() { return { addClass() {} }; }
    });
    const client = new Client('localhost', 8000);
    client.fail_callback = reason => failures.push(reason);
    client.connect(false);
    return { timer, client, socket: sockets[0], failures };
}

test('an open socket without a welcome has a bounded handshake and reports exactly one failure', () => {
    const { timer, socket, failures } = socketFixture();
    socket.readyState = 1; socket.onopen(); socket.onmessage({ data: 'go' });
    timer.advance(30000);
    assert.equal(failures.length, 1);
    assert.equal(socket.readyState, 3);
    assert.equal(timer.count(), 0);
});

test('a websocket error releases startup immediately and does not report twice on close', () => {
    const { timer, socket, failures } = socketFixture();
    socket.onerror({});
    assert.equal(failures.length, 1);
    timer.advance(30000);
    assert.equal(failures.length, 1);
});

test('welcome cancels the handshake deadline and a rejected login permits retry', () => {
    const success = socketFixture();
    success.socket.onmessage({ data: JSON.stringify([Types.Messages.WELCOME, 1, 'hero', 1, 1, 80]) });
    success.timer.advance(30000);
    assert.equal(success.failures.length, 0);
    assert.equal(success.timer.count(), 0);
    const retry = socketFixture();
    retry.socket.onmessage({ data: 'invalidlogin' });
    assert.equal(retry.failures[0], 'invalidlogin');
    retry.client.connect(false);
    retry.timer.advance(30000);
    assert.equal(retry.failures.length, 2);
});


test('a later game-data error disconnects the game without reporting a new login failure', () => {
    const { timer, client, socket, failures } = socketFixture();
    socket.onmessage({ data: JSON.stringify([Types.Messages.WELCOME, 1, 'hero', 1, 1, 80]) });
    let disconnects = 0;
    client.disconnected_callback = () => disconnects++;
    client.receiveMessage = () => { throw new Error('bad game data'); };
    socket.onmessage({ data: '[]' });
    assert.equal(failures.length, 0);
    assert.equal(disconnects, 1);
    assert.equal(timer.count(), 0);
});


test('a successful image retry without CORS completes sprite loading', () => {
    function Image() {}
    const Sprite = load('sprite.js', { Image });
    const sprite = Object.create(Sprite.prototype);
    sprite.filepath = 'img/1/bow.png'; sprite.isLoaded = false;
    let loaded = 0;
    sprite.onload_func = () => loaded++;
    sprite.load();
    sprite.image.onerror();
    sprite.image.onload();
    assert.equal(sprite.isLoaded, true);
    assert.equal(sprite.loadError, undefined);
    assert.equal(loaded, 1);
});
