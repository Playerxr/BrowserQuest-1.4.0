
var Types = require("../../shared/js/gametypes");

var Properties = {
    rat: {
        drops: {
            flask: 40,
            burger: 10,
            firepotion: 5
        },
        hp: 25,
        armor: 1,
        weapon: 1
    },

    skeleton: {
        drops: {
            flask: 40,
            mailarmor: 10,
            axe: 20,
            firepotion: 5
        },
        hp: 135,
        armor: 2,
        weapon: 2
    },

    goblin: {
        drops: {
            flask: 50,
            leatherarmor: 20,
            axe: 10,
            firepotion: 5
        },
        hp: 100,
        armor: 2,
        weapon: 1
    },

    ogre: {
        drops: {
            burger: 10,
            flask: 50,
            platearmor: 20,
            morningstar: 20,
            firepotion: 5
        },
        hp: 250,
        armor: 3,
        weapon: 3
    },

    spectre: {
        drops: {
            flask: 30,
            redarmor: 35,
            redsword: 25,
            firepotion: 5
        },
        hp: 320,
        armor: 3,
        weapon: 5
    },

    deathknight: {
        drops: {
            burger: 85,
            redsword: 10,
            firepotion: 5
        },
        hp: 360,
        armor: 4,
        weapon: 5
    },

    crab: {
        drops: {
            flask: 50,
            axe: 20,
            leatherarmor: 10,
            firepotion: 5
        },
        hp: 65,
        armor: 2,
        weapon: 1
    },

    snake: {
        drops: {
            flask: 50,
            mailarmor: 10,
            morningstar: 10,
            firepotion: 5
        },
        hp: 185,
        armor: 3,
        weapon: 3
    },

    skeleton2: {
        drops: {
            flask: 60,
            platearmor: 15,
            bluesword: 15,
            firepotion: 5
        },
        hp: 260,
        armor: 4,
        weapon: 4
    },

    eye: {
        drops: {
            flask: 50,
            redarmor: 20,
            redsword: 10,
            firepotion: 5
        },
        hp: 260,
        armor: 3,
        weapon: 4
    },

    bat: {
        drops: {
            flask: 50,
            axe: 10,
            firepotion: 5
        },
        hp: 85,
        armor: 2,
        weapon: 1
    },

    wizard: {
        drops: {
            flask: 50,
            platearmor: 20,
            firepotion: 5
        },
        hp: 170,
        armor: 3,
        weapon: 6
    },

    boss: {
        drops: {
            goldensword: 35,
            goldenarmor: 30,
            redsword: 20,
            redarmor: 15
        },
        hp: 3600,
        armor: 7,
        weapon: 8
    },

    grandogre: {
        drops: {
            redsword: 25,
            redarmor: 25,
            goldensword: 15,
            platearmor: 20,
            burger: 15
        },
        hp: 1900,
        armor: 6,
        weapon: 6
    },

    spectreancien: {
        drops: {
            redsword: 30,
            redarmor: 30,
            goldensword: 20,
            goldenarmor: 15,
            firepotion: 5
        },
        hp: 2500,
        armor: 6,
        weapon: 7
    },

    seigneurmort: {
        drops: {
            goldensword: 30,
            goldenarmor: 30,
            redsword: 20,
            redarmor: 20
        },
        hp: 3100,
        armor: 7,
        weapon: 8
    },

    archimage: {
        drops: {
            goldensword: 25,
            redsword: 30,
            goldenarmor: 20,
            redarmor: 15,
            firepotion: 10
        },
        hp: 2400,
        armor: 6,
        weapon: 8
    },

    oeilabyssal: {
        drops: {
            redarmor: 30,
            redsword: 25,
            goldenarmor: 20,
            bluesword: 15,
            burger: 10
        },
        hp: 2250,
        armor: 6,
        weapon: 7
    },

    reinecrabe: {
        drops: {
            redsword: 20,
            redarmor: 20,
            bluesword: 25,
            platearmor: 20,
            burger: 15
        },
        hp: 1450,
        armor: 5,
        weapon: 5
    },

    roigobelin: {
        drops: {
            redsword: 22,
            redarmor: 22,
            goldensword: 12,
            bluesword: 24,
            burger: 20
        },
        hp: 1650,
        armor: 5,
        weapon: 5
    },

    hydreserpent: {
        drops: {
            redsword: 28,
            redarmor: 25,
            goldensword: 18,
            goldenarmor: 14,
            burger: 15
        },
        hp: 2100,
        armor: 6,
        weapon: 6
    },

    colossesquelette: {
        drops: {
            goldensword: 25,
            goldenarmor: 25,
            redsword: 25,
            redarmor: 25
        },
        hp: 2800,
        armor: 7,
        weapon: 7
    }
};

Properties.getArmorLevel = function(kind) {
    try {
        if(Types.isMob(kind)) {
            return Properties[Types.getKindAsString(kind)].armor;
        } else {
            return Types.getArmorRank(kind) + 1;
        }
    } catch(e) {
        log.error("No level found for armor: "+Types.getKindAsString(kind));
        log.error('Error stack: ' + e.stack);
    }
};

Properties.getWeaponLevel = function(kind) {
    try {
        if(Types.isMob(kind)) {
            return Properties[Types.getKindAsString(kind)].weapon;
        } else {
            return Types.getWeaponRank(kind) + 1;
        }
    } catch(e) {
        log.error("No level found for weapon: "+Types.getKindAsString(kind));
        log.error('Error stack: ' + e.stack);
    }
};

Properties.getHitPoints = function(kind) {
    return Properties[Types.getKindAsString(kind)].hp;
};
Properties.getExp = function(kind){
    return Properties[Types.getKindAsString(kind)].exp;
};

module.exports = Properties;
