const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once, EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const WebSocket = require('ws');
const SQLite = require('better-sqlite3');
const Types = require('../shared/js/gametypes');

const ROOT = path.resolve(__dirname, '..');

async function reservePort() {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    return port;
}

function status(port) {
    return new Promise((resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/status', timeout: 1000 }, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch(error) { reject(error); }
            });
        });
        request.on('timeout', () => request.destroy(new Error('HTTP status request timed out')));
        request.on('error', reject);
    });
}

async function waitForStatus(child, port, predicate, output) {
    const deadline = Date.now() + 90000;
    while(Date.now() < deadline) {
        if(child.exitCode !== null) throw new Error('Server exited early: ' + output());
        try {
            const value = await status(port);
            if(predicate(value)) return value;
        } catch(error) {
            if(child.exitCode !== null) throw error;
        }
        await delay(50);
    }
    throw new Error('Server status timed out: ' + output());
}

async function connect(port, sockets) {
    const socket = new WebSocket('ws://127.0.0.1:' + port + '/');
    sockets.add(socket);
    const packets = [];
    const events = new EventEmitter();
    socket.on('message', raw => {
        let parsed;
        try { parsed = JSON.parse(raw.toString()); } catch(error) { return; }
        const batch = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
        batch.forEach(packet => {
            packets.push(packet);
            events.emit('packet', packet);
        });
    });
    socket.on('error', error => events.emit('socketError', error));
    // Always keep a listener so asynchronous connection errors remain handled.
    events.on('socketError', () => {});
    await once(socket, 'open');
    return {
        socket,
        packets,
        send(packet) { socket.send(JSON.stringify(packet)); },
        next(predicate, after = 0) {
            const found = packets.slice(after).find(predicate);
            if(found) return Promise.resolve(found);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error('Expected game packet timed out')), 15000);
                function cleanup() {
                    clearTimeout(timer);
                    events.removeListener('packet', onPacket);
                    events.removeListener('socketError', onError);
                    socket.removeListener('close', onClose);
                }
                function finish(error, packet) { cleanup(); error ? reject(error) : resolve(packet); }
                function onPacket(packet) { if(predicate(packet)) finish(null, packet); }
                function onError(error) { finish(error); }
                function onClose() { finish(new Error('Game socket closed before expected packet')); }
                events.on('packet', onPacket);
                events.on('socketError', onError);
                socket.on('close', onClose);
            });
        }
    };
}

async function closeSocket(socket) {
    if(socket.readyState === WebSocket.CLOSED) return;
    const closed = once(socket, 'close');
    socket.close();
    await closed;
}

test('real server creates, purchases, saves and reloads an account, and survives malformed JSON roots', { timeout: 150000 }, async t => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browserquest-integration-'));
    const resolvedTemp = path.resolve(temporaryRoot);
    const expectedParent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolvedTemp), expectedParent);
    assert.ok(path.basename(resolvedTemp).startsWith('browserquest-integration-'));
    const databasePath = path.join(resolvedTemp, 'isolated-game.db');
    const configPath = path.join(resolvedTemp, 'config.json');
    const port = await reservePort();
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/config.json'), 'utf8'));
    Object.assign(config, {
        port, nb_worlds: 1, nb_players_per_world: 20, metrics_enabled: false,
        database: 'sqlite', database_path: databasePath,
        map_filepath: path.join(ROOT, 'server/maps/world_server.json'),
        debug_level: 'info', use_one_port: true
    });
    fs.writeFileSync(configPath, JSON.stringify(config));
    const environment = { ...process.env, PORT: String(port) };
    delete environment.OPENSHIFT_NODEJS_PORT;
    delete environment.OPENSHIFT_NODEJS_IP;
    delete environment.OPENSHIFT_APP_NAME;
    delete environment.BROWSERQUEST_TRUST_PROXY;
    let output = '';
    const child = spawn(process.execPath, [path.join(ROOT, 'server/js/main.js'), configPath], {
        cwd: ROOT, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const sockets = new Set();
    t.after(async () => {
        sockets.forEach(socket => socket.terminate());
        if(child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        // Remove only the checked directory created by this test.
        assert.equal(path.dirname(path.resolve(temporaryRoot)), expectedParent);
        assert.ok(path.basename(temporaryRoot).startsWith('browserquest-integration-'));
        fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await waitForStatus(child, port, value => Array.isArray(value) && value.length === 1, () => output);
    const initial = await connect(port, sockets);
    const password = '  Phrase très longue <b>avec & caractères</b>  ';
    initial.send([Types.Messages.CREATE, 'smoketest', password, '']);
    await initial.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.WELCOME);
    await initial.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.HUB);
    const purchaseStart = initial.packets.length;
    initial.send([Types.Messages.HUB, 'shop_buy', { itemKind: 'leatherarmor' }]);
    await initial.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.INVENTORY, purchaseStart);
    await initial.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.HUB, purchaseStart);
    await closeSocket(initial.socket);
    await waitForStatus(child, port, value => Array.isArray(value) && value[0] === 0, () => output);

    const reader = new SQLite(databasePath, { readonly: true, fileMustExist: true });
    let row;
    try { row = reader.prepare('SELECT * FROM players WHERE username = ?').get('smoketest'); }
    finally { reader.close(); }
    assert.equal(row.gold, 0); // Starting balance 150, leather armor price 150.
    assert.ok(JSON.parse(row.inventory).items.includes('leatherarmor'));
    assert.match(row.password, /^scrypt\$1\$/);

    const reconnect = await connect(port, sockets);
    reconnect.send([Types.Messages.LOGIN, 'smoketest', password]);
    const restoredWelcome = await reconnect.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.WELCOME);
    assert.ok(restoredWelcome.slice(12).filter((value, index) => index % 2 === 0).includes(Types.Entities.LEATHERARMOR));
    await reconnect.next(packet => Array.isArray(packet) && packet[0] === Types.Messages.HUB);
    await closeSocket(reconnect.socket);
    const invalid = await connect(port, sockets);
    const rejected = once(invalid.socket, 'close');
    invalid.socket.send('null');
    await rejected;
    assert.equal(child.exitCode, null);
    assert.ok(Array.isArray(await status(port)));
    assert.doesNotMatch(output, /uncaughtException|TypeError|ReferenceError/);
    assert.equal(output.includes(password), false);
});
