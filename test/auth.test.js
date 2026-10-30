const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const Auth = require('../server/js/auth');
const Utils = require('../server/js/utils');

global.log = { info() {}, debug() {}, error() {} };
const DatabaseHandler = require('../server/js/database');

function hash(password) {
    return new Promise((resolve, reject) => Auth.hashPassword(password, (error, encoded) => error ? reject(error) : resolve(encoded)));
}

function verify(password, encoded) {
    return new Promise((resolve, reject) => Auth.verifyPassword(password, encoded, (error, matches, migratedHash) => {
        if(error) reject(error);
        else resolve({ matches, migratedHash });
    }));
}

function player(name, password) {
    let finish;
    const result = { name, pw: password, x: 2, y: 3, isAuthenticating: true, connectionClosed: false };
    result.completed = new Promise(resolve => { finish = resolve; });
    result.messages = [];
    result.connection = {
        sendUTF8(message) { result.messages.push(message); },
        close() { result.connectionClosed = true; finish({ success: false, reason: result.messages[0] }); }
    };
    result.updatePosition = function() { this.x = 2; this.y = 3; };
    result.sendWelcome = function() { this.hasEnteredGame = true; finish({ success: true, args: Array.from(arguments) }); };
    return result;
}

function database(t) {
    const result = new DatabaseHandler({ database_path: ':memory:' });
    t.after(() => result.db.close());
    return result;
}

test('new hashes use random salts, preserve long raw passwords, and yield to the event loop', async () => {
    const password = '  <b>Un mot de passe & très long</b>  ';
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const first = await hash(password);
    assert.equal(yielded, true);
    const second = await hash(password);
    assert.match(first, /^scrypt\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    assert.notEqual(first, second);
    assert.equal((await verify(password, first)).matches, true);
    assert.equal((await verify(password.trim(), first)).matches, false);
    assert.equal((await verify(password.substr(0, 15), first)).matches, false);
    assert.equal((await verify('wrong', first)).matches, false);
});

test('password limits and malformed encoded hashes fail closed', async () => {
    assert.equal(Auth.isValidPassword('x'.repeat(256)), true);
    for(const candidate of ['', null, 123, 'x'.repeat(257)]) {
        assert.equal(Auth.isValidPassword(candidate), false);
        assert.equal((await verify(candidate, 'secret')).matches, false);
        await assert.rejects(hash(candidate));
    }
    assert.equal((await verify('password', 'scrypt$1$invalid$invalid')).matches, false);
});

test('legacy credentials migrate without losing their original normalization rules', async () => {
    const password = '  <b>ancien & secret très long</b>  ';
    const plaintext = Utils.sanitize(password).trim().substr(0, 15);
    const result = await verify(password, plaintext);
    assert.equal(result.matches, true);
    assert.match(result.migratedHash, /^scrypt\$legacy\$/);
    assert.equal((await verify(password, result.migratedHash)).matches, true);
    assert.equal((await verify('bad password', result.migratedHash)).matches, false);
    assert.equal((await verify('bad password', plaintext)).migratedHash, undefined);
    assert.equal((await verify('scrypt$1$old', 'scrypt$1$old')).matches, true);
});

test('SQLite creation stores a hash and login accepts the complete unmodified password', async t => {
    const db = database(t);
    const password = '  Nouvelle phrase <>& très longue  ';
    const created = player('nouveau', password);
    db.createPlayer(created);
    assert.equal((await created.completed).success, true);
    const stored = db.stmtGetPlayer.get('nouveau').password;
    assert.match(stored, /^scrypt\$1\$/);
    assert.equal(created.pw, undefined);
    const login = player('nouveau', password);
    db.loadPlayer(login);
    assert.equal((await login.completed).success, true);
    assert.equal(login.pw, undefined);
    const truncated = player('nouveau', password.substr(0, 15));
    db.loadPlayer(truncated);
    assert.deepEqual(await truncated.completed, { success: false, reason: 'invalidlogin' });
});

test('SQLite only migrates legacy plaintext after a successful login', async t => {
    const db = database(t);
    const password = 'ancien-secret-plus-long';
    const plaintext = password.substr(0, 15);
    db.db.prepare('INSERT INTO players (username, password) VALUES (?, ?)').run('ancien', plaintext);
    const wrong = player('ancien', 'wrong');
    db.loadPlayer(wrong);
    assert.equal((await wrong.completed).success, false);
    assert.equal(db.stmtGetPlayer.get('ancien').password, plaintext);
    const login = player('ancien', password);
    db.loadPlayer(login);
    assert.equal((await login.completed).success, true);
    const migrated = db.stmtGetPlayer.get('ancien').password;
    assert.match(migrated, /^scrypt\$legacy\$/);
    const relogin = player('ancien', password);
    db.loadPlayer(relogin);
    assert.equal((await relogin.completed).success, true);
    assert.equal(db.stmtGetPlayer.get('ancien').password, migrated);
});

test('simultaneous account creation inserts exactly one account', async t => {
    const db = database(t);
    const first = player('doublon', 'first password');
    const second = player('doublon', 'second password');
    db.createPlayer(first);
    db.createPlayer(second);
    const results = await Promise.all([first.completed, second.completed]);
    assert.equal(results.filter(result => result.success).length, 1);
    assert.equal(results.filter(result => result.reason === 'userexists').length, 1);
    assert.equal(db.db.prepare('SELECT count(*) AS total FROM players').get().total, 1);
});

test('a disconnect while hashing does not create a ghost account', async t => {
    const db = database(t);
    const disconnected = player('parti', 'password');
    db.createPlayer(disconnected);
    disconnected.connectionClosed = true;
    while(disconnected.isAuthenticating) await delay(10);
    assert.equal(db.stmtGetPlayer.get('parti'), undefined);
    assert.equal(disconnected.pw, undefined);
    assert.equal(disconnected.hasEnteredGame, undefined);
});

test('a ban and an existing session are rechecked after asynchronous verification', async t => {
    const db = database(t);
    const encoded = await hash('password');
    db.db.prepare('INSERT INTO players (username, password) VALUES (?, ?)').run('joueur', encoded);
    const banned = player('joueur', 'password');
    db.loadPlayer(banned);
    db.setPlayerBanned('joueur', true);
    assert.deepEqual(await banned.completed, { success: false, reason: 'banned' });
    db.setPlayerBanned('joueur', false);
    const duplicate = player('joueur', 'password');
    duplicate.server = { loggedInPlayer() { return true; } };
    db.loadPlayer(duplicate);
    assert.deepEqual(await duplicate.completed, { success: false, reason: 'loggedin' });
});

test('a session in another world prevents login and legacy credential migration', async t => {
    const db = database(t);
    db.db.prepare('INSERT INTO players (username, password) VALUES (?, ?)').run('voyageur', 'password');
    const login = player('voyageur', 'password');
    const firstWorld = { loggedInPlayer() { return false; } };
    const secondWorld = { loggedInPlayer(name) { return name === 'voyageur'; } };
    firstWorld.server = { worlds: [firstWorld, secondWorld] };
    login.server = firstWorld;
    db.loadPlayer(login);
    assert.deepEqual(await login.completed, { success: false, reason: 'loggedin' });
    assert.equal(db.stmtGetPlayer.get('voyageur').password, 'password');
});

test('Google account creation handles existing username collisions and re-authenticates by google_uid', async t => {
    const db = database(t);
    const firebaseService = require('../server/js/firebase_service');
    // Existing classic player with username "Jean"
    const classic = player('Jean', 'classic-password');
    db.createPlayer(classic);
    assert.equal((await classic.completed).success, true);

    // New Google user whose displayName is also "Jean"
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        sub: 'google_uid_12345',
        email: 'jean.google@gmail.com',
        name: 'Jean',
        exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const idToken = `${header}.${payload}.sig`;

    const googleInfo = await firebaseService.verifyIdToken(idToken);
    assert.equal(googleInfo.uid, 'google_uid_12345');
    assert.equal(googleInfo.email, 'jean.google@gmail.com');

    const googleNew = player('Jean', '');
    db.loginWithGoogle(googleNew, googleInfo);
    const createdRes = await googleNew.completed;
    assert.equal(createdRes.success, true);
    assert.equal(googleNew.name, 'Jean1');

    // Subsequent login with the same Google UID logs into the created Google account
    const googleRelogin = player('Jean', '');
    db.loginWithGoogle(googleRelogin, googleInfo);
    const reloginRes = await googleRelogin.completed;
    assert.equal(reloginRes.success, true);
    assert.equal(googleRelogin.name, 'Jean1');

    // Choosing a new available hero name after Google authentication updates the player's name
    const googleChosenName = player('Excalibur', '');
    db.loginWithGoogle(googleChosenName, googleInfo);
    const chosenRes = await googleChosenName.completed;
    assert.equal(chosenRes.success, true);
    assert.equal(googleChosenName.name, 'Excalibur');
});

