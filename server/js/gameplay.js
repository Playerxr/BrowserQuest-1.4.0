"use strict";

var Types = require("../../shared/js/gametypes");

// The client reports completed, cardinal tile steps (120 ms per tile). A small
// token bucket absorbs packet batching without accumulating idle-time teleports.
var STEP_MS = 120;
var MOVE_BURST_MS = STEP_MS * 3;
var ATTACK_MS = 800;

function sameInstance(a, b) {
    return !!a && !!b && (a.instanceId || null) === (b.instanceId || null);
}

function distance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function near(a, b, range) {
    return sameInstance(a, b) && distance(a, b) <= range;
}

function liveMob(player, mob, range) {
    return !!mob && mob.type === "mob" && mob.hitPoints > 0 && !mob.isDead &&
        player.hitPoints > 0 && !player.isDead && near(player, mob, range);
}

function resetMovement(player, now) {
    player.movementBudget = {at: now === undefined ? Date.now() : now, credit: MOVE_BURST_MS};
}

function move(player, x, y, now) {
    if(!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
       !player.server.isValidPosition(x, y)) {
        return false;
    }
    var steps = Math.abs(player.x - x) + Math.abs(player.y - y);
    if(steps > 1) {
        return false;
    }
    now = now === undefined ? Date.now() : now;
    if(!player.movementBudget) {
        resetMovement(player, now);
    }
    var budget = player.movementBudget;
    budget.credit = Math.min(MOVE_BURST_MS, budget.credit + Math.max(0, now - budget.at));
    budget.at = now;
    if(budget.credit < steps * STEP_MS) {
        return false;
    }
    budget.credit -= steps * STEP_MS;
    // Server teleports use Player.setPosition, which resets the budget. Network
    // steps update coordinates here so they cannot reset their own speed limit.
    player.x = x;
    player.y = y;
    return true;
}

function canHit(player, mob, now) {
    var range = 1;
    if(Types.getWeaponRange && player.weapon) {
        range = Types.getWeaponRange(player.weapon);
    }
    if(!liveMob(player, mob, range)) {
        return false;
    }
    if(range === 1 && Math.abs(player.x - mob.x) + Math.abs(player.y - mob.y) !== 1) {
        return false;
    }
    now = now === undefined ? Date.now() : now;
    // Never reset this clock when switching targets or equipment.
    if(player.lastHitAt !== undefined && now - player.lastHitAt < ATTACK_MS - 100) {
        return false;
    }
    // Permit modest network jitter while keeping the long-term rate at 800 ms.
    player.lastHitAt = player.lastHitAt === undefined ? now : Math.max(now, player.lastHitAt + ATTACK_MS);
    return true;
}

function canMobHit(player, mob, range, now) {
    if(player.firepotionTimeout || !liveMob(player, mob, range) || mob.target !== player.id ||
       (range === 1 && Math.abs(player.x - mob.x) + Math.abs(player.y - mob.y) !== 1)) {
        return false;
    }
    now = now === undefined ? Date.now() : now;
    if(mob.lastServerHitAt === undefined) {
        mob.lastServerHitAt = now;
        return false;
    }
    if(now - mob.lastServerHitAt < mobAttackRate(mob.kind)) {
        return false;
    }
    mob.lastServerHitAt = now;
    return true;
}

function mobAttackRate(kind) {
    var rates = {skeleton: 1300, skeleton2: 1300, spectre: 900, goblin: 700,
        boss: 2000, grandogre: 1400, spectreancien: 950, seigneurmort: 850,
        archimage: 1100, oeilabyssal: 1000, reinecrabe: 1100, hydreserpent: 950,
        colossesquelette: 1200};
    return rates[Types.getKindAsString(kind)] || ATTACK_MS;
}

function mobAggroRange(kind) {
    if(kind === Types.Entities.RAT || kind === Types.Entities.BAT) {
        return 0;
    }
    return Types.isBoss(kind) || kind === Types.Entities.DEATHKNIGHT ? 3 : 1;
}

function canTeleport(player, x, y) {
    if(player.instanceId || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
       !player.server.isValidPosition(x, y)) {
        return false;
    }
    return (player.server.map.doors || []).some(function(door) {
        // Door activation is sent after the client has completed its last step.
        return door.x === player.x && door.y === player.y && door.tx === x && door.ty === y;
    });
}

function inCheckpoint(player, checkpoint) {
    return !!checkpoint && !player.instanceId && player.x >= checkpoint.x &&
        player.y >= checkpoint.y && player.x < checkpoint.x + checkpoint.width &&
        player.y < checkpoint.y + checkpoint.height;
}

exports.sameInstance = sameInstance;
exports.distance = distance;
exports.near = near;
exports.liveMob = liveMob;
exports.resetMovement = resetMovement;
exports.move = move;
exports.canHit = canHit;
exports.canMobHit = canMobHit;
exports.mobAttackRate = mobAttackRate;
exports.mobAggroRange = mobAggroRange;
exports.canTeleport = canTeleport;
exports.inCheckpoint = inCheckpoint;
