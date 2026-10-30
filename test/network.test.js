const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const WebSocket = require('ws');
global.log = { info() {}, error() {}, debug() {} };
const Class = require('../server/js/lib/class').Class;
const Types = require('../shared/js/gametypes');
const Format = require('../server/js/format');
const WS = require('../server/js/ws');

async function serverFor(t, callback, proxy) {
    const previousProxy = process.env.BROWSERQUEST_TRUST_PROXY;
    if (proxy === undefined) delete process.env.BROWSERQUEST_TRUST_PROXY;
    else process.env.BROWSERQUEST_TRUST_PROXY = proxy;
    let server;
    try { server = new WS.MultiVersionWebsocketServer(0, true); }
    finally {
        if (previousProxy === undefined) delete process.env.BROWSERQUEST_TRUST_PROXY;
        else process.env.BROWSERQUEST_TRUST_PROXY = previousProxy;
    }
    server.onConnect(callback || (() => {}));
    await once(server._httpServer, 'listening');
    t.after(async () => {
        server._wss.clients.forEach(socket => socket.terminate());
        await new Promise(resolve => server._wss.close(resolve));
        await new Promise(resolve => server._httpServer.close(resolve));
    });
    return server;
}
function urlFor(server) { return 'ws://127.0.0.1:' + server._httpServer.address().port; }
async function socketFor(server, headers) {
    const socket = new WebSocket(urlFor(server), { headers });
    await once(socket, 'open');
    return socket;
}
async function closeSocket(socket) {
    if (socket.readyState === WebSocket.CLOSED) return;
    const done = once(socket, 'close');
    socket.close();
    await done;
}
function requestConfig(server, pathname, host, forwardedProto) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port: server._httpServer.address().port, path: pathname,
            headers: { host, 'x-forwarded-proto': forwardedProto || 'http' } }, response => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', part => data += part);
            response.on('end', () => {
                try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(data) }); }
                catch (error) { reject(error); }
            });
        });
        req.on('error', reject);
    });
}

test('format rejects malformed roots, unsafe numbers and unknown actions without throwing', () => {
    for (const message of [null, {}, false, 'hello', 5, [], ['5', 1, 2], [999],
        [Types.Messages.MOVE, NaN, 2], [Types.Messages.MOVE, Infinity, 2],
        [Types.Messages.MOVE, 1.5, 2], [Types.Messages.MOVE, Number.MAX_SAFE_INTEGER + 1, 2],
        [Types.Messages.CREATE, 'name', 'secret', {}], [Types.Messages.LOGIN, 'name', 'x'.repeat(257)],
        [Types.Messages.INVENTORY, 'unknown', 0, 1], [Types.Messages.INVENTORY, 'use', 1.5, 1]]) {
        assert.equal(Format.check(message), false, String(message));
    }
    assert.equal(Format.check([Types.Messages.MOVE, 1, 2]), true);
    assert.equal(Format.check([Types.Messages.LOGIN, 'name', 'long password supported']), true);
    assert.equal(Format.check([Types.Messages.CREATE, 'name', 'secret', '']), true);
    assert.equal(Format.check([Types.Messages.WHO, ...Array(513).fill(1)]), false);
});

test('Hub payloads enforce the action schema and numerical types used by the client', () => {
    const hub = (action, data) => Format.check([Types.Messages.HUB, action, data]);
    assert.equal(hub('market_sell', { slotType: 'weapon', price: 120 }), true);
    assert.equal(hub('guild_summon_boss', {}), true);
    assert.equal(hub('guild_summon_boss', { bossKind: 'seigneurmort' }), true);
    assert.equal(hub('guild_create', { tag: 'BQ', name: 'Browser Quest' }), true);
    for (const [action, data] of [
        ['refresh', []], ['refresh', null], ['refresh', { unexpected: true }],
        ['unknown', {}], ['bag_equip', { slot: 6 }], ['bag_equip', { slot: '0' }],
        ['shop_buy', { itemKind: {} }], ['market_sell', { slotType: 'weapon', price: '120x' }],
        ['market_sell', { slotType: 'weapon', price: 0 }], ['market_sell', { slotType: 'weapon', price: 1000000 }],
        ['market_buy', { marketId: -1 }], ['guild_deposit', { amount: Number.MAX_SAFE_INTEGER + 1 }],
        ['guild_invite', {}], ['guild_chat', { message: 'x'.repeat(61) }],
        ['admin_spawn', { mobKind: '../boss' }], ['admin_announce', { text: 'x'.repeat(121) }]
    ]) assert.equal(hub(action, data), false, action);
    assert.equal(Format.check([Types.Messages.HUB, 'refresh']), false);
});

test('dynamic configs win over static localhost configs and parse IPv6 hosts', async t => {
    const server = await serverFor(t);
    for (const pathname of ['/config/config_local.json', '/config/config_build.json']) {
        const response = await requestConfig(server, pathname, 'quest.example:9443', 'https');
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { host: 'quest.example', port: 9443, dispatcher: false });
        assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.deepEqual((await requestConfig(server, '/config/config_local.json', '[::1]:4321')).body,
        { host: '[::1]', port: 4321, dispatcher: false });
    assert.equal((await requestConfig(server, '/config/config_local.json', 'quest.example', 'https')).body.port, 80);
});

test('an explicitly trusted proxy can supply HTTPS and its first untrusted IP hop', async t => {
    let address;
    const server = await serverFor(t, connection => { address = connection._connection.remoteAddress; }, 'loopback');
    assert.equal((await requestConfig(server, '/config/config_local.json', 'quest.example', 'https')).body.port, 443);
    const socket = await socketFor(server, { 'x-forwarded-for': '198.51.100.2, 203.0.113.7' });
    assert.equal(address, '203.0.113.7');
    await closeSocket(socket);
});

test('invalid and oversized WebSocket messages close only their connection', async t => {
    const server = await serverFor(t, connection => connection.listen(message => connection.send(message)));
    for (const value of ['null', '{}', '5', '"text"', '{invalid', JSON.stringify([Types.Messages.HUB, 'market_buy', { marketId: '1' }]),
        JSON.stringify([Types.Messages.CHAT, 'x'.repeat(17000)])]) {
        const socket = await socketFor(server);
        const closed = once(socket, 'close');
        socket.send(value);
        await closed;
    }
    const socket = await socketFor(server);
    const reply = once(socket, 'message');
    socket.send(JSON.stringify([Types.Messages.ZONE]));
    assert.deepEqual(JSON.parse((await reply)[0].toString()), [Types.Messages.ZONE]);
    await closeSocket(socket);
});

test('message and close callbacks cannot throw out of a WebSocket event', async t => {
    const server = await serverFor(t, connection => {
        connection.listen(() => { throw new Error('handler failed'); });
        connection.onClose(() => { throw new Error('close cleanup failed'); });
    });
    const socket = await socketFor(server);
    const closed = once(socket, 'close');
    socket.send(JSON.stringify([Types.Messages.ZONE]));
    await closed;
    // Server close handlers can run on the next event loop iteration after the client close.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Object.keys(server._connections).length, 0);
});

test('authentication throttling survives reconnects and ignores spoofed forwarding by default', async t => {
    let accepted = 0;
    const addresses = new Set();
    const server = await serverFor(t, connection => {
        addresses.add(connection._connection.remoteAddress);
        connection.listen(() => { accepted += 1; connection.sendUTF8('accepted'); });
    });
    for (let i = 0; i < 10; i++) {
        const socket = await socketFor(server, { 'x-forwarded-for': '198.51.100.' + i });
        const reply = once(socket, 'message');
        socket.send(JSON.stringify([Types.Messages.LOGIN, 'player', 'secret']));
        await reply;
        await closeSocket(socket);
    }
    const blocked = await socketFor(server, { 'x-forwarded-for': '203.0.113.99' });
    const closed = once(blocked, 'close');
    blocked.send(JSON.stringify([Types.Messages.LOGIN, 'player', 'secret']));
    await closed;
    assert.equal(accepted, 10);
    assert.equal(addresses.size, 1);
    assert.match([...addresses][0], /127\.0\.0\.1/);
    const expiry = server._authAttempts.values().next().value.expires;
    assert.equal(server._acceptAuthAttempt([...addresses][0], expiry), true);
});

test('per-connection message flood is limited before callbacks run', () => {
    const socket = new EventEmitter();
    socket.remoteAddress = '127.0.0.1';
    socket.close = () => socket.emit('close');
    let removed = false, accepted = 0;
    const connection = new WS.wsConnection(1, socket, { removeConnection() { removed = true; } });
    connection.listen(() => accepted++);
    connection._messageTokens = 0;
    socket.emit('message', Buffer.from(JSON.stringify([Types.Messages.ZONE])), false);
    assert.equal(accepted, 0);
    assert.equal(connection.isClosed, true);
    assert.equal(removed, true);
});

function clientHarness(location) {
    const urls = [];
    let Client;
    function MockSocket(url) { urls.push(url); }
    const context = { Class, Types, window: { location }, log: global.log, WebSocket: MockSocket,
        setTimeout() { return 1; }, clearTimeout() {},
        define(deps, factory) { Client = factory(function () {}, {}, {}); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/gameclient.js'), 'utf8'), context);
    return { client: new Client('localhost', 8000), urls };
}

test('direct client follows HTTP/HTTPS page origin and bracketed IPv6', () => {
    for (const [location, expected] of [
        [{ protocol: 'https:', hostname: 'quest.example', host: 'quest.example', port: '' }, 'wss://quest.example/'],
        [{ protocol: 'https:', hostname: 'quest.example', host: 'quest.example:9443', port: '9443' }, 'wss://quest.example:9443/'],
        [{ protocol: 'http:', hostname: 'localhost', host: 'localhost:8000', port: '8000' }, 'ws://localhost:8000/'],
        [{ protocol: 'http:', hostname: '[::1]', host: '[::1]:8000', port: '8000' }, 'ws://[::1]:8000/'],
        [{ protocol: 'http:', hostname: 'quest.example', host: 'quest.example', port: '' }, 'ws://quest.example/']
    ]) {
        const harness = clientHarness(location);
        harness.client.connect(false);
        assert.equal(harness.urls[0], expected);
    }
});

test('dispatcher and assigned game endpoints still use their configured host and port', () => {
    const harness = clientHarness({ protocol: 'https:', hostname: 'quest.example', host: 'quest.example', port: '' });
    const client = harness.client;
    client.host = 'dispatcher.example'; client.port = 443;
    client.onDispatched((host, port) => { client.host = host; client.port = port; client.connect(); });
    client.connect(true);
    assert.equal(harness.urls[0], 'wss://dispatcher.example/');
    client.connection.onmessage({ data: JSON.stringify({ status: 'OK', host: '2001:db8::1', port: 80 }) });
    assert.equal(harness.urls[1], 'wss://[2001:db8::1]:80/');
});

test('Capacitor Android APK (com.universnovastudio.novaquest) overrides localhost and connects to wss://quest.universnovastudio.online/', () => {
    const urls = [];
    let Client;
    function MockSocket(url) { urls.push(url); }
    const context = {
        Class,
        Types,
        window: {
            location: { protocol: 'https:', hostname: 'localhost', host: 'localhost', port: '' },
            Capacitor: { isNativePlatform: () => true }
        },
        log: global.log,
        WebSocket: MockSocket,
        setTimeout() { return 1; },
        clearTimeout() {},
        define(deps, factory) { Client = factory(function () {}, {}, {}); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/gameclient.js'), 'utf8'), context);
    const client = new Client('localhost', 8000);
    client.connect(false);
    assert.equal(urls[0], 'wss://quest.universnovastudio.online/');
});

test('Capacitor Haptics API triggers light vibration (LIGHT) on mobile touch attacks and skips desktop', () => {
    const impacts = [];
    const vibrations = [];
    let GameClass;
    let fakeNow = 10000;

    function Dummy() {}
    const context = {
        Class,
        Types,
        Date: { now: () => fakeNow },
        window: {
            Capacitor: {
                Plugins: {
                    Haptics: {
                        impact(opts) {
                            impacts.push(opts);
                            return Promise.resolve();
                        }
                    }
                }
            }
        },
        navigator: {
            maxTouchPoints: 5,
            vibrate(ms) { vibrations.push(ms); return true; }
        },
        log: global.log,
        _: require('underscore'),
        define(deps, factory) {
            const stubs = deps.map(() => Dummy);
            GameClass = factory(...stubs);
        }
    };

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client/js/game.js'), 'utf8'), context);

    const game = Object.create(GameClass.prototype);
    game.renderer = { mobile: true, tablet: false };
    game.player = { hasTarget: () => false, engage() {} };
    game.playerId = 1;
    game.client = { sendAttack() {} };

    // 1. Mobile attack triggers Capacitor Haptics.impact({ style: 'LIGHT' })
    game.makePlayerAttack({ id: 99, addAttacker() {} });
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0].style, 'LIGHT');

    // 2. Immediate duplicate call within 60ms is debounced
    fakeNow += 20;
    assert.equal(game.triggerAttackHaptic(), false);
    assert.equal(impacts.length, 1);

    // 3. Call after 60ms cooldown triggers again
    fakeNow += 60;
    assert.equal(game.triggerAttackHaptic(), true);
    assert.equal(impacts.length, 2);

    // 4. Fallback to navigator.vibrate(15) on mobile web when Capacitor is absent
    delete context.window.Capacitor;
    fakeNow += 100;
    assert.equal(game.triggerAttackHaptic(), true);
    assert.deepEqual(vibrations, [15]);

    // 5. Desktop non-touch environment does not vibrate
    game.renderer = { mobile: false, tablet: false };
    context.navigator.maxTouchPoints = 0;
    fakeNow += 100;
    assert.equal(game.triggerAttackHaptic(), false);
    assert.equal(vibrations.length, 1);
});
