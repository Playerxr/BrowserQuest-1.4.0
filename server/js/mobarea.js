var _ = require('underscore');
var Area = require('./area');
var Types = require('../../shared/js/gametypes');
var Utils = require('./utils');

var MobArea = Area.extend({
    init: function (id, nb, kind, x, y, width, height, world) {
        this._super(id, x, y, width, height, world);
        this.nb = nb;
        this.kind = kind;
        this.respawns = [];
        this.setNumberOfEntities(this.nb);

        // Enable random roaming for monsters
        // (comment this out to disable roaming)
        this.initRoaming();
    },

    spawnMobs: function () {
        for (var i = 0; i < this.nb; i += 1) {
            this.addToArea(this._createMobInsideArea());
        }
    },

    _createMobInsideArea: function () {
        var k = Types.getKindFromString(this.kind);
        var Mob = require('./mob');
        var pos = this._getRandomPositionInsideArea();
        var mob = new Mob('1' + this.id + '' + k + '' + this.entities.length, k, pos.x, pos.y);

        mob.onMove(this.world.onMobMoveCallback.bind(this.world));

        return mob;
    },

    respawnMob: function (mob, delay) {
        var self = this;

        this.removeFromArea(mob);

        setTimeout(function () {
            var pos = self._getRandomPositionInsideArea();

            mob.x = pos.x;
            mob.y = pos.y;
            mob.isDead = false;
            self.addToArea(mob);
            self.world.addMob(mob);
        }, delay);
    },

    initRoaming: function (mob) {
        var self = this;

        setInterval(function () {
            var now = Date.now();
            _.each(self.entities, function (mob) {
                var canRoam = (Utils.random(20) === 1);
                if (canRoam) {
                    if (!mob.hasTarget() && !mob.isDead && !(mob._targetedUntil && mob._targetedUntil > now)) {
                        var pos = self._getNearbyPositionInsideArea(mob.x, mob.y, 2);
                        if (pos && (pos.x !== mob.x || pos.y !== mob.y)) {
                            mob.move(pos.x, pos.y);
                        }
                    }
                }
            });
        }, 500);
    },

    _getNearbyPositionInsideArea: function (cx, cy, maxStep) {
        var minX = Math.max(this.x, cx - maxStep),
            maxX = Math.min(this.x + this.width - 1, cx + maxStep),
            minY = Math.max(this.y, cy - maxStep),
            maxY = Math.min(this.y + this.height - 1, cy + maxStep);

        for (var attempt = 0; attempt < 8; attempt++) {
            var x = Utils.randomInt(minX, maxX),
                y = Utils.randomInt(minY, maxY);
            if ((x !== cx || y !== cy) && this.world.isValidPosition(x, y)) {
                return { x: x, y: y };
            }
        }
        return null;
    },

    createReward: function () {
        var pos = this._getRandomPositionInsideArea();

        return { x: pos.x, y: pos.y, kind: Types.Entities.CHEST };
    }
});

module.exports = MobArea;
