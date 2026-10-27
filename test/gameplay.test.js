"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
// The legacy shared game types receive underscore from the server map loader.
global._ = require("underscore");
var Gameplay = require("../server/js/gameplay");
var Types = require("../shared/js/gametypes");

global.log = {debug: function() {}, info: function() {}, error: function() {}};
var PlayerClass = require("../server/js/player");

function fixture(t) {
    var connection = {
        id: 1, messages: [],
        listen: function(fn) { this.receive = fn; },
        onClose: function(fn) { this.onClosed = fn; },
        send: function(message) { this.messages.push(message); },
        sendUTF8: function(message) { this.messages.push(message); },
        close: function(reason) { this.closed = reason; this.onClosed(); }
    };
    var world = {
        mobs: {}, entities: {}, groups: {"0-0": {entities: {}}},
        map: {doors: [{x: 10, y: 10, tx: 40, ty: 40}],
            getGroupIdFromPosition: function() { return "0-0"; }},
        isValidPosition: function(x, y) { return x > 0 && y > 0 && x < 100 && y < 100 && !(x === 12 && y === 10); },
        getEntityById: function(id) { return this.entities[id]; },
        loggedInPlayer: function() { return false; },
        handleMobHate: function(id, playerId) { this.mobs[id].target = playerId; },
        handleHurtEntity: function() {},
        broadcastAttacker: function() {}
    };
    var db = {loadPlayer: function() { this.logins = (this.logins || 0) + 1; }, savePlayer: function() {}};
    var player = new PlayerClass(connection, world, db);
    player.setPosition(10, 10);
    player.hitPoints = player.maxHitPoints = 80;
    player.armorLevel = player.weaponLevel = 1;
    player.hasEnteredGame = true;
    t.after(function() { connection.onClosed(); });
    return {player: player, world: world, connection: connection, db: db};
}

function addMob(f, overrides) {
    var mob = Object.assign({id: 2, type: "mob", kind: Types.Entities.GOBLIN,
        x: 11, y: 10, hitPoints: 100, isDead: false, armorLevel: 1, weaponLevel: 3,
        target: f.player.id, receiveDamage: function(amount) { this.hitPoints -= amount; }}, overrides);
    f.world.mobs[mob.id] = f.world.entities[mob.id] = f.world.groups["0-0"].entities[mob.id] = mob;
    return mob;
}

test("movement rejects distant destinations, diagonal steps and collision tiles", function(t) {
    var p = fixture(t).player;
    assert.equal(Gameplay.move(p, 20, 10, 0), false);
    assert.equal(Gameplay.move(p, 11, 11, 0), false);
    assert.equal(Gameplay.move(p, NaN, 10, 0), false);
    assert.equal(Gameplay.move(p, 10.5, 10, 0), false);
    p.setPosition(11, 10);
    assert.equal(Gameplay.move(p, 12, 10, 0), false);
    assert.deepEqual([p.x, p.y], [11, 10]);
});

test("movement accepts normal 120ms steps and bounded packet batching", function(t) {
    var p = fixture(t).player;
    Gameplay.resetMovement(p, 0);
    for(var i = 0; i < 20; i++) assert.equal(Gameplay.move(p, 10, 11 + i, i * 120), true);
    Gameplay.resetMovement(p, 3000);
    for(var j = 0; j < 3; j++) assert.equal(Gameplay.move(p, 11 + j, 30, 3000), true);
    assert.equal(Gameplay.move(p, 14, 30, 3000), false);
    assert.equal(Gameplay.move(p, 14, 30, 3120), true);
});

test("idle time cannot buy an unlimited sprint; server teleport resets the budget", function(t) {
    var p = fixture(t).player;
    Gameplay.resetMovement(p, 0);
    for(var i = 0; i < 3; i++) assert.equal(Gameplay.move(p, 10, 11 + i, 60000), true);
    assert.equal(Gameplay.move(p, 10, 14, 60000), false);
    p.setPosition(40, 40);
    assert.equal(Gameplay.move(p, 40, 41, Date.now()), true);
});

test("hits require a living adjacent cardinal monster in the same instance", function(t) {
    var f = fixture(t), mob = addMob(f);
    assert.equal(Gameplay.canHit(f.player, Object.assign({}, mob, {type: "player"}), 0), false);
    assert.equal(Gameplay.canHit(f.player, Object.assign({}, mob, {instanceId: "guild_9"}), 0), false);
    assert.equal(Gameplay.canHit(f.player, Object.assign({}, mob, {x: 11, y: 11}), 0), false);
    assert.equal(Gameplay.canHit(f.player, Object.assign({}, mob, {hitPoints: 0}), 0), false);
    assert.equal(Gameplay.canHit(f.player, Object.assign({}, mob, {isDead: true}), 0), false);
    assert.equal(Gameplay.canHit(f.player, mob, 0), true);
});

test("hit cooldown survives target changes and tolerates jitter without raising the average rate", function(t) {
    var f = fixture(t), first = addMob(f), second = addMob(f, {id: 3});
    assert.equal(Gameplay.canHit(f.player, first, 0), true);
    assert.equal(Gameplay.canHit(f.player, second, 100), false);
    assert.equal(Gameplay.canHit(f.player, second, 700), true);
    assert.equal(Gameplay.canHit(f.player, first, 1400), false);
    assert.equal(Gameplay.canHit(f.player, first, 1500), true);
});

test("only an actual door at the current tile can authorize client teleportation", function(t) {
    var f = fixture(t);
    assert.equal(Gameplay.canTeleport(f.player, 40, 40), true);
    assert.equal(Gameplay.canTeleport(f.player, 45, 45), false);
    f.player.setPosition(10, 11);
    assert.equal(Gameplay.canTeleport(f.player, 40, 40), false);
    f.player.setPosition(10, 10);
    f.player.instanceId = "guild_1";
    assert.equal(Gameplay.canTeleport(f.player, 40, 40), false);
});

test("checkpoints and nearby loot cannot be reached through another instance", function(t) {
    var p = fixture(t).player, cp = {x: 9, y: 9, width: 3, height: 3};
    assert.equal(Gameplay.inCheckpoint(p, cp), true);
    assert.equal(Gameplay.near(p, {x: 11, y: 10, instanceId: "guild_2"}, 1), false);
    p.setPosition(12, 10);
    assert.equal(Gameplay.inCheckpoint(p, cp), false);
    p.setPosition(10, 10); p.instanceId = "guild_2";
    assert.equal(Gameplay.inCheckpoint(p, cp), false);
});

test("server damages the player even when no HURT packet is sent", function(t) {
    var f = fixture(t);
    addMob(f, {target: null});
    f.player.processCombat(0);
    assert.equal(f.player.hitPoints, 80);
    f.player.processCombat(700);
    assert.ok(f.player.hitPoints < 80);
    var hp = f.player.hitPoints;
    f.connection.receive([Types.Messages.HURT, 2]);
    f.connection.receive([Types.Messages.HURT, 2]);
    assert.equal(f.player.hitPoints, hp);
    f.player.processCombat(1399);
    assert.equal(f.player.hitPoints, hp);
    f.player.processCombat(1400);
    assert.ok(f.player.hitPoints < hp);
});

test("server respects passive mobs, attack cadence, range, instance and firepotion immunity", function(t) {
    var f = fixture(t), mob = addMob(f, {kind: Types.Entities.RAT, target: null});
    f.player.processCombat(0); f.player.processCombat(5000);
    assert.equal(mob.target, null);
    mob.kind = Types.Entities.SKELETON; mob.target = f.player.id;
    f.player.processCombat(0); f.player.processCombat(1299);
    assert.equal(f.player.hitPoints, 80);
    f.player.processCombat(1300);
    assert.ok(f.player.hitPoints < 80);
    var hp = f.player.hitPoints;
    mob.instanceId = "guild_1"; f.player.processCombat(5000);
    mob.instanceId = null; mob.x = 14; f.player.processCombat(5000);
    assert.equal(f.player.hitPoints, hp);
    mob.kind = Types.Entities.WIZARD; f.player.firepotionTimeout = setTimeout(function() {}, 15000);
    f.player.processCombat(5000); assert.equal(f.player.hitPoints, hp);
    clearTimeout(f.player.firepotionTimeout); f.player.firepotionTimeout = null;
    f.player.processCombat(5000); assert.ok(f.player.hitPoints < hp);
});

test("client movement and lootmove packets cannot move the server to a distant item", function(t) {
    var f = fixture(t);
    f.player.onMove(function() {}); f.player.onLootMove(function() {});
    f.world.entities[8] = {id: 8, kind: Types.Entities.FLASK, x: 50, y: 50};
    f.connection.receive([Types.Messages.MOVE, 50, 50]);
    f.connection.receive([Types.Messages.LOOTMOVE, 50, 50, 8]);
    assert.deepEqual([f.player.x, f.player.y], [10, 10]);
    f.connection.receive([Types.Messages.MOVE, 11, 10]);
    assert.deepEqual([f.player.x, f.player.y], [11, 10]);
});

test("stale monster aggro packets are ignored and movement updates spatial membership", function(t) {
    var f = fixture(t), changes = 0;
    f.player.onMove(function() {});
    f.player.onZone(function() { changes++; });
    assert.doesNotThrow(function() { f.connection.receive([Types.Messages.AGGRO, 999]); });
    f.connection.receive([Types.Messages.MOVE, 11, 10]);
    assert.equal(changes, 1);
});

test("invalid client teleport is corrected to the authoritative position", function(t) {
    var f = fixture(t);
    f.connection.receive([Types.Messages.TELEPORT, 80, 80]);
    assert.deepEqual([f.player.x, f.player.y], [10, 10]);
    assert.deepEqual(f.connection.messages.at(-1), [Types.Messages.TELEPORT, 1, 10, 10]);
});

test("passwords stay exact and concurrent handshakes cannot enter async authentication twice", function(t) {
    var f = fixture(t); f.player.hasEnteredGame = false;
    f.connection.receive([Types.Messages.LOGIN, "Hero", " <exact password with spaces> "]);
    assert.equal(f.player.pw, " <exact password with spaces> ");
    assert.equal(f.player.isAuthenticating, true);
    assert.equal(f.db.logins, 1);
    f.connection.receive([Types.Messages.LOGIN, "Hero", "second"]);
    assert.equal(f.db.logins, 1);
    assert.equal(f.player.connectionClosed, true);
    assert.equal(f.player.pw, undefined);
});

test("legacy guild packets cannot mutate persistent guild membership", function(t) {
    var f = fixture(t);
    f.player.guildId = 22;
    f.connection.receive([Types.Messages.GUILD, Types.Messages.GUILDACTION.JOIN, 99, true]);
    assert.equal(f.player.guildId, 22);
    assert.equal(f.connection.closed, undefined);
});

test("changing armor preserves current health and clamps it to the new maximum", function(t) {
    var f = fixture(t);
    f.db.equipAvatar = f.db.equipArmor = function() {};
    f.player.hitPoints = 25;
    f.player.equipItem(Types.Entities.MAILARMOR, false);
    assert.equal(f.player.hitPoints, 25);
    assert.ok(f.player.maxHitPoints > 80);
    f.player.hitPoints = f.player.maxHitPoints;
    f.player.equipItem(Types.Entities.CLOTHARMOR, false);
    assert.equal(f.player.hitPoints, 80);
    assert.deepEqual(f.connection.messages.at(-1), f.player.health().serialize());
});

test("lethal server damage consumes a life, leaves the instance and respawns with full health", function(t) {
    var f = fixture(t), saves = 0;
    f.player.instanceId = "guild_1";
    f.player.hitPoints = 1;
    var mob = addMob(f, {instanceId: "guild_1", weaponLevel: 100});
    f.world.map.getRandomStartingPosition = function() { return {x: 20, y: 20}; };
    f.world.handlePlayerVanish = function() { mob.target = null; };
    f.world.pushToPlayer = f.world.pushRelevantEntityListTo = function() {};
    f.player.sendHubState = function() {};
    f.db.savePlayer = function() { saves++; };
    f.player.processCombat(0);
    f.player.processCombat(700);
    assert.equal(f.player.lives, 2);
    assert.equal(f.player.instanceId, null);
    assert.deepEqual([f.player.x, f.player.y], [20, 20]);
    assert.equal(f.player.hitPoints, f.player.maxHitPoints);
    assert.equal(saves, 1);
});

test("the final life restores three lives at the initial starting area", function(t) {
    var f = fixture(t), mob = addMob(f, {weaponLevel: 100});
    f.player.lives = 1; f.player.hitPoints = 1;
    f.player.lastCheckpoint = {getRandomPosition: function() { return {x: 30, y: 30}; }};
    f.world.map.startingAreas = [{getRandomPosition: function() { return {x: 5, y: 5}; }}];
    f.world.handlePlayerVanish = function() { mob.target = null; };
    f.world.pushToPlayer = f.world.pushRelevantEntityListTo = function() {};
    f.player.sendHubState = function() {};
    f.player.processCombat(0); f.player.processCombat(700);
    assert.equal(f.player.lives, 3);
    assert.equal(f.player.lastCheckpoint, null);
    assert.deepEqual([f.player.x, f.player.y], [5, 5]);
});
