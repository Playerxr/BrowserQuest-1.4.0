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
        define(names, factory) {
            if (typeof names === 'function') {
                exported = names();
            } else {
                exported = factory(...names.map(name => deps[name] || function() {}));
            }
        } };
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

test('queue messages display Waiting in line... on the client and keep the handshake alive until go', () => {
    const { timer, client, socket, failures } = socketFixture();
    const queueEvents = [];
    let connected = 0;
    client.onQueue((pos, total) => queueEvents.push([pos, total]));
    client.onConnected(() => connected++);

    socket.readyState = 1;
    socket.onopen();
    timer.advance(20000);
    socket.onmessage({ data: 'queue:2:5' });

    assert.equal(client.isQueued, true);
    assert.deepEqual(queueEvents, [[2, 5]]);

    // Waiting 20 more seconds does not fail because the queue message refreshed the timer
    timer.advance(20000);
    assert.equal(failures.length, 0);

    // Receiving 'go' clears queue state and triggers connected callback
    socket.onmessage({ data: 'go' });
    assert.equal(client.isQueued, false);
    assert.equal(connected, 1);

    // Verify App.showQueueStatus displays 'Waiting in line...'
    let playBtnText = 'Jouer';
    const appended = [];
    function mockJquery(sel) {
        if (typeof sel === 'string' && sel.startsWith('<')) {
            return {
                appendTo(target) {
                    appended.push({ target, sel });
                    return this;
                }
            };
        }
        return {
            text(val) { if (val !== undefined) playBtnText = val; return playBtnText; },
            remove() {},
            removeClass() { return this; },
            addClass() { return this; }
        };
    }
    mockJquery.fn = { on() {} };
    const App = load('app.js', timer, { jquery: mockJquery });
    const app = Object.create(App.prototype);
    app.$play = mockJquery('.play');
    app.getPlayButton = () => mockJquery('.play span');

    app.showQueueStatus(2, 5);
    assert.equal(app.isWaitingInQueue, true);
    assert.equal(playBtnText, 'Waiting in line...');
    assert.equal(app.queueMessage, 'Waiting in line... (2/5)');
});

test('pong hub packets compute smoothed RTT latency in ms and update #nova-ping-hud classes', () => {
    const timer = clock();
    let pingText = '-- ms';
    const hudClasses = new Set(['ping-good']);
    function mockJquery(sel) {
        if (sel === '#nova-ping-value') {
            return {
                text(v) { if (v !== undefined) pingText = v; return pingText; }
            };
        }
        if (sel === '#nova-ping-hud') {
            return {
                removeClass(cls) {
                    String(cls).split(/\s+/).forEach(c => hudClasses.delete(c));
                    return this;
                },
                addClass(cls) {
                    String(cls).split(/\s+/).forEach(c => { if (c) hudClasses.add(c); });
                    return this;
                }
            };
        }
        return { text() { return this; }, removeClass() { return this; }, addClass() { return this; } };
    }
    mockJquery.fn = { on() {} };
    const App = load('app.js', timer, { jquery: mockJquery });
    const app = Object.create(App.prototype);

    timer.advance(1000);
    app.handleHubPacket('pong', { t: timer.Date.now() - 32 });
    assert.equal(pingText, '32 ms');
    assert.equal(hudClasses.has('ping-good'), true);

    app._smoothedPing = 190;
    app.handleHubPacket('pong', { t: timer.Date.now() - 210 });
    assert.equal(hudClasses.has('ping-bad'), true);
});

test('mobile browser auth session endpoints store and hand off Google and Play Games tokens once', () => {
    const createAdminRouter = require('../server/js/admin_routes');
    const router = createAdminRouter({ worlds: [], databaseHandler: {} });

    function findRoute(method, routePath) {
        for (const layer of router.stack) {
            if (layer.route && layer.route.path === routePath && layer.route.methods[method]) {
                return layer.route.stack[0].handle;
            }
        }
        throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
    }

    const postSession = findRoute('post', '/api/auth/mobile-session');
    const getSession = findRoute('get', '/api/auth/mobile-session');
    const getBridge = findRoute('get', '/auth/mobile-bridge');

    let postResBody = null;
    postSession(
        {
            body: {
                key: 'nq_test_session_12345',
                idToken: 'mock_firebase_jwt_token',
                displayName: 'NovaPlayHero',
                email: 'hero@example.com',
                provider: 'playgames'
            }
        },
        {
            status() { return this; },
            json(obj) { postResBody = obj; }
        }
    );
    assert.deepEqual(postResBody, { success: true });

    let getResBody = null;
    getSession(
        { query: { key: 'nq_test_session_12345' } },
        {
            setHeader() {},
            json(obj) { getResBody = obj; }
        }
    );
    assert.equal(getResBody.completed, true);
    assert.equal(getResBody.idToken, 'mock_firebase_jwt_token');
    assert.equal(getResBody.displayName, 'NovaPlayHero');
    assert.equal(getResBody.provider, 'playgames');

    // Second poll for the same consumed key returns completed: false
    let secondGetBody = null;
    getSession(
        { query: { key: 'nq_test_session_12345' } },
        {
            setHeader() {},
            json(obj) { secondGetBody = obj; }
        }
    );
    assert.deepEqual(secondGetBody, { completed: false });

    let bridgeHtml = '';
    getBridge(
        { query: { key: 'nq_test_session_12345', provider: 'playgames' } },
        {
            setHeader() {},
            send(html) { bridgeHtml = html; }
        }
    );
    assert.match(bridgeHtml, /Google Play Jeux/);
    assert.match(bridgeHtml, /intent:\/\/auth-complete/);
});

test('DoorDiagnostics audits all 84 doors in world_client.json and identifies interior/exterior boundary anomalies', () => {
    const DoorDiagnostics = require('../client/js/door_diagnostics');
    const worldMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/maps/world_client.json'), 'utf8'));

    // Build mock map matching client Map structure
    const doors = [];
    const doorGrid = [];
    for (let y = 0; y < worldMap.height; y++) {
        doorGrid[y] = [];
    }
    for (const d of worldMap.doors) {
        const o = d.o === 'u' ? Types.Orientations.UP
            : d.o === 'd' ? Types.Orientations.DOWN
            : d.o === 'l' ? Types.Orientations.LEFT
            : Types.Orientations.RIGHT;
        const doorObj = {
            x: d.x,
            y: d.y,
            destX: d.tx,
            destY: d.ty,
            orientation: o,
            cameraX: d.tcx,
            cameraY: d.tcy,
            portal: d.p === 1
        };
        doors.push(doorObj);
        doorGrid[d.y][d.x] = doorObj;
    }
    const collisionSet = new Set(worldMap.collisions);
    const mockMap = {
        width: worldMap.width,
        height: worldMap.height,
        data: worldMap.data,
        doors,
        grid: null,
        isColliding(x, y) {
            if (x < 0 || y < 0 || x >= worldMap.width || y >= worldMap.height) return true;
            const tileIndex = y * worldMap.width + x;
            return collisionSet.has(tileIndex);
        },
        isDoor(x, y) {
            return !!(doorGrid[y] && doorGrid[y][x]);
        },
        getDoorDestination(x, y) {
            const d = doorGrid[y] && doorGrid[y][x];
            if (!d) return null;
            return { x: d.destX, y: d.destY, orientation: d.orientation, cameraX: d.cameraX, cameraY: d.cameraY, portal: d.portal };
        }
    };

    const diag = new DoorDiagnostics({ map: mockMap, renderer: { camera: { gridW: 30, gridH: 14, gridX: 60, gridY: 196 } } });
    const report = diag.auditMapDoors();

    assert.equal(report.totalDoors, 84);
    assert.equal(report.destIsDoorCount, 69);
    assert.ok(report.exteriorToInteriorCount >= 20);
    assert.ok(report.interiorToExteriorCount >= 20);
    assert.ok(report.legacyCameraOffsetCount > 0);
    assert.ok(report.singleExitDirectionCount > 0);

    // Specifically check the village house door (80, 211) -> (155, 311)
    const houseEntry = report.doors.find(d => d.doorX === 80 && d.doorY === 211);
    assert.ok(houseEntry);
    assert.equal(houseEntry.fromEnv, 'EXTERIOR');
    assert.equal(houseEntry.toEnv, 'INTERIOR');
    assert.equal(houseEntry.destX, 155);
    assert.equal(houseEntry.destY, 311);
    assert.equal(houseEntry.destIsDoor, true);

    // And its interior exit door (155, 311) -> (80, 211) where only UP is walkable and DOWN is a colliding threshold wall
    const houseExit = report.doors.find(d => d.doorX === 155 && d.doorY === 311);
    assert.ok(houseExit);
    assert.equal(houseExit.fromEnv, 'INTERIOR');
    assert.equal(houseExit.toEnv, 'EXTERIOR');
    assert.deepEqual(houseExit.walkableDirectionsFromDoor, ['UP']);
    assert.ok(houseExit.blockedDirectionsFromDoor.includes('DOWN'));
});

test('DoorDiagnostics tracks house entry/exit transitions, active boundary guards, and server rollback anomalies', () => {
    const DoorDiagnostics = require('../client/js/door_diagnostics');
    const createAdminRouter = require('../server/js/admin_routes');

    const mockPlayer = {
        id: 7,
        name: 'NovaTester',
        gridX: 80,
        gridY: 211,
        nextGridX: 80,
        nextGridY: 211,
        x: 80 * 16,
        y: 211 * 16,
        step: 2,
        path: [[80, 209], [80, 210], [80, 211]],
        newDestination: null,
        orientation: Types.Orientations.UP,
        isMoving() { return this.path !== null; },
        hasNextStep() { return false; },
        hasChangedItsPath() { return false; }
    };
    const mockCamera = {
        gridX: 60,
        gridY: 210,
        gridW: 30,
        gridH: 14,
        isZoningTile(x, y) { return x === 0 || y === 0 || x === 29 || y === 13; }
    };
    const mockGame = {
        player: mockPlayer,
        renderer: { camera: mockCamera },
        currentZoning: null,
        zoningQueue: [],
        entityGrid: { 211: { 80: { 7: mockPlayer } }, 311: { 155: {} } },
        renderingGrid: { 211: { 80: { 7: mockPlayer } }, 311: { 155: {} } },
        map: {
            width: 172,
            height: 314,
            doors: [{ x: 80, y: 211, destX: 155, destY: 311, orientation: Types.Orientations.UP, cameraX: 146, cameraY: 304, portal: false }],
            isColliding() { return false; },
            isDoor(x, y) { return (x === 80 && y === 211) || (x === 155 && y === 311); },
            getDoorDestination(x, y) {
                if (x === 80 && y === 211) return { x: 155, y: 311, orientation: Types.Orientations.UP, cameraX: 146, cameraY: 304, portal: false };
                if (x === 155 && y === 311) return { x: 80, y: 211, orientation: Types.Orientations.DOWN, cameraX: 73, cameraY: 206, portal: false };
                return null;
            }
        }
    };

    const diag = new DoorDiagnostics(mockGame);
    diag.recordStep(80, 211);
    diag.recordGuard('CLEAR_ZONING_ON_DOOR', 'Suppressed camera zoning on door tile', { x: 80, y: 211 });
    diag.beginDoorTeleport(80, 211, mockGame.map.getDoorDestination(80, 211), 'onStopPathing');

    // Simulate teleport completion into house interior (155, 311)
    delete mockGame.entityGrid[211][80][7];
    mockGame.entityGrid[311][155][7] = mockPlayer;
    mockPlayer.gridX = 155;
    mockPlayer.gridY = 311;
    mockPlayer.nextGridX = 155;
    mockPlayer.nextGridY = 311;
    mockPlayer.x = 155 * 16;
    mockPlayer.y = 311 * 16;
    mockPlayer.path = null;
    mockCamera.gridX = 142;
    mockCamera.gridY = 300;

    const record = diag.completeDoorTeleport(['UNREGISTER_BEFORE_TELEPORT', 'RECENTER_CAMERA_30X14']);
    assert.ok(record);
    assert.equal(record.direction, 'ENTER_HOUSE');
    assert.equal(record.from.x, 80);
    assert.equal(record.from.y, 211);
    assert.equal(record.to.x, 155);
    assert.equal(record.to.y, 311);
    assert.equal(record.anomaliesDetected.includes('DEST_IS_EXIT_DOOR_TRAP_RISK'), true);
    assert.equal(record.anomaliesDetected.includes('LEGACY_16X8_CAMERA_OFFSET_MISMATCH'), true);
    assert.equal(record.anomaliesDetected.includes('STALE_ENTITY_GRID_ON_SOURCE_DOOR'), false);

    // Simulate server rubber-band teleport back to source door
    diag.recordServerTeleport(80, 211);
    const summary = diag.getSummary();
    assert.equal(summary.stats.totalDoorTransitions, 1);
    assert.equal(summary.stats.houseEntries, 1);
    assert.equal(summary.stats.serverTeleportsReceived, 1);

    // Verify /api/diagnostics/door-log endpoint stores and returns diagnostic report
    const router = createAdminRouter({ worlds: [], databaseHandler: {} });
    const postDiag = router.stack.find(l => l.route && l.route.path === '/api/diagnostics/door-log' && l.route.methods.post).route.stack[0].handle;
    const getDiag = router.stack.find(l => l.route && l.route.path === '/api/diagnostics/door-log' && l.route.methods.get).route.stack[0].handle;

    let postOut = null;
    postDiag({ body: { reason: 'unit_test', playerName: 'NovaTester', summary, recentTransitions: diag.getTransitions() } }, { json(o) { postOut = o; } });
    assert.equal(postOut.ok, true);

    let getOut = null;
    getDiag({ query: { limit: '5' } }, { json(o) { getOut = o; } });
    assert.equal(getOut.ok, true);
    assert.equal(getOut.total >= 1, true);
    assert.equal(getOut.logs[getOut.logs.length - 1].playerName, 'NovaTester');
});

test('Transition.step waits for full duration (120ms) instead of terminating early on rounded endValue', () => {
    const Transition = load('transition.js');
    const tr = new Transition();
    let stopTime = null;
    const updates = [];

    tr.start(
        1000,
        v => updates.push(v),
        () => { stopTime = lastTick; },
        2480,
        2496,
        120
    );

    // At 116ms, Math.round(2480 + 16 * (116/120)) === 2495, at 117ms Math.round(...) === 2496.
    // Previously Transition stopped at 117ms (< 120ms), draining the server's 120ms STEP_MS token bucket.
    let lastTick = 1117;
    tr.step(1117);
    assert.equal(stopTime, null);
    assert.equal(tr.inProgress, true);

    lastTick = 1120;
    tr.step(1120);
    assert.equal(stopTime, 1120);
    assert.equal(tr.inProgress, false);
    assert.equal(updates[updates.length - 1], 2496);
});

test('Character.nextStep stops immediately on a door tile even when newDestination is queued by joystick/keyboard', () => {
    const Entity = load('entity.js');
    const Transition = load('transition.js');
    const Timer = load('timer.js');
    const Character = load('character.js', {}, { entity: Entity, transition: Transition, timer: Timer });

    const c = new Character(1, Types.Entities.WARRIOR);
    c.setGridPosition(80, 211); // Door tile
    c.path = [[80, 210], [80, 211], [80, 212]];
    c.step = 1;
    // Simulate continuous virtual joystick queuing a new destination while crossing the door
    c.newDestination = { x: 80, y: 213 };

    let stoppedAt = null;
    let guardTriggered = null;
    c.onCheckDoor((gx, gy) => gx === 80 && gy === 211);
    c.onDoorStopGuard((gx, gy) => { guardTriggered = [gx, gy]; });
    c.onStopPathing((gx, gy) => { stoppedAt = [gx, gy]; });

    c.nextStep();
    assert.deepEqual(guardTriggered, [80, 211]);
    assert.deepEqual(stoppedAt, [80, 211]);
    assert.equal(c.path, null);
    assert.equal(c.newDestination, null);
});

test('Map._getDoors normalizes 30x14 camera coordinates while preserving legacy tcx/tcy and doorX/doorY', () => {
    const Area = load('area.js');
    const MapModule = load('map.js', { Worker: undefined }, { area: Area });

    const dummyMap = Object.create(MapModule.prototype);
    dummyMap.width = 172;
    dummyMap.height = 314;

    const parsedDoors = dummyMap._getDoors({
        doors: [
            { x: 80, y: 211, tx: 155, ty: 311, tcx: 150, tcy: 300, to: 'u', p: 0 }
        ]
    });

    const tileIdx = dummyMap.GridPositionToTileIndex(80, 211);
    const door = parsedDoors[tileIdx];
    assert.ok(door);
    assert.equal(door.x, 155);
    assert.equal(door.y, 311);
    assert.equal(door.doorX, 80);
    assert.equal(door.doorY, 211);
    assert.equal(door.legacyCameraX, 150);
    assert.equal(door.legacyCameraY, 300);
    assert.equal(door.cameraX, Math.floor((155 - 1) / 28) * 28); // 140
    assert.equal(door.cameraY, Math.floor((311 - 1) / 12) * 12); // 300
});

test('Renderer draws indoor exit indicators (▼ SORTIE) only when player is inside a house and renders smooth door transition fade', () => {
    const Renderer = load('renderer.js', {}, {
        camera: function() {},
        item: function() {},
        character: function() {},
        player: function() {},
        timer: function() {}
    });

    const fillTexts = [];
    const fillRects = [];
    const mockCtx = {
        save() {},
        restore() {},
        fillRect(x, y, w, h) { fillRects.push({ x, y, w, h, fillStyle: this.fillStyle }); },
        strokeRect() {},
        fillText(text, x, y) { fillTexts.push({ text, x, y }); },
        strokeText() {}
    };

    const renderer = Object.create(Renderer.prototype);
    renderer.context = mockCtx;
    renderer.canvas = { width: 960, height: 448 };
    renderer.scale = 2;
    renderer.tilesize = 16;
    renderer.camera = {
        isVisiblePosition(x, y) { return x === 155 && y === 311; }
    };
    renderer.game = {
        started: true,
        currentTime: 1000,
        player: { gridX: 43, gridY: 210 }, // Outdoor village
        map: {
            width: 172,
            doors: {
                '53492': { x: 80, y: 212, doorX: 155, doorY: 311 }
            }
        }
    };

    // 1. Outdoor player -> no indoor exit indicator drawn
    renderer.drawIndoorDoorIndicators();
    assert.equal(fillTexts.length, 0);

    // 2. Indoor player -> draws "▼ SORTIE" above visible exit door
    renderer.game.player.gridX = 155;
    renderer.game.player.gridY = 310;
    renderer.drawIndoorDoorIndicators();
    assert.equal(fillTexts.length, 1);
    assert.equal(fillTexts[0].text, '▼ SORTIE');

    // 3. Door transition micro-fade overlay
    fillRects.length = 0;
    renderer.game.doorFadeStartTime = Date.now() - 45;
    renderer.game.doorFadeDuration = 180;
    renderer.drawDoorTransitionFade();
    assert.equal(fillRects.length, 1);
    assert.equal(fillRects[0].w, 960);
    assert.equal(fillRects[0].h, 448);
});

test('WorldServer.isPlayerInHouseInterior and Player NPC hunting quests track kills and grant rewards', () => {
    const WorldServer = require('../server/js/worldserver');
    const Player = require('../server/js/player');

    const ws = Object.create(WorldServer.prototype);
    assert.equal(ws.isPlayerInHouseInterior({ x: 43, y: 210, isDead: false }), false);
    assert.equal(ws.isPlayerInHouseInterior({ x: 155, y: 310, isDead: false }), true);
    assert.equal(ws.isPlayerInHouseInterior({ x: 155, y: 275, isDead: false }), false); // Castle courtyard

    const sentPackets = [];
    const mockPlayer = Object.create(Player.prototype);
    mockPlayer.id = 77;
    mockPlayer.name = 'Chasseur';
    mockPlayer.level = 1;
    mockPlayer.experience = 0;
    mockPlayer.gold = 100;
    mockPlayer.incExp = function(exp) { this.experience += exp; };
    mockPlayer.send = function(pkt) { sentPackets.push(pkt); };
    mockPlayer.databaseHandler = { savePlayer() {} };

    const quest = mockPlayer.startOrSwitchNpcQuest('rats_village');
    assert.ok(quest);
    assert.equal(quest.id, 'rats_village');
    assert.equal(quest.targetCount, 3);
    assert.equal(quest.progress, 0);

    // Kill 3 rats to complete the quest
    mockPlayer.onMobKilledForNpcQuest({ id: 501, kind: Types.Entities.RAT });
    assert.equal(mockPlayer.activeQuest.progress, 1);
    mockPlayer.onMobKilledForNpcQuest({ id: 502, kind: Types.Entities.RAT });
    assert.equal(mockPlayer.activeQuest.progress, 2);
    mockPlayer.onMobKilledForNpcQuest({ id: 503, kind: Types.Entities.RAT });

    assert.equal(mockPlayer.activeQuest, null);
    assert.equal(mockPlayer.gold, 180); // +80 Gold
    assert.equal(mockPlayer.experience, 50); // +50 XP
});


