var Utils = require('./utils');

var Formulas = {};

Formulas.dmg = function (weaponLevel, armorLevel) {
    var w = Number(weaponLevel);
    if (!Number.isFinite(w) || w <= 0) {
        w = 1;
    }
    var a = Number(armorLevel);
    if (!Number.isFinite(a) || a <= 0) {
        a = 1;
    }
    var dealt = w * Utils.randomInt(5, 10);
    var absorbed = a * Utils.randomInt(1, 3);
    var dmg =  dealt - absorbed;

    if (dmg <= 0) {
        return Utils.randomInt(1, 3);
    } else {
        return Math.max(1, dmg);
    }
};

Formulas.hp = function (armorLevel) {
    var a = Number(armorLevel);
    if (!Number.isFinite(a) || a <= 0) {
        a = 1;
    }
    var hp = 80 + ((a - 1) * 30);
    return hp;
};

if (typeof exports !== 'undefined') {
    module.exports = Formulas;
}
