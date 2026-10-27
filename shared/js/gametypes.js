
Types = {
    Messages: {
        CREATE: 0,
        LOGIN: 1,
        WELCOME: 2,
        SPAWN: 3,
        DESPAWN: 4,
        MOVE: 5,
        LOOTMOVE: 6,
        AGGRO: 7,
        ATTACK: 8,
        HIT: 9,
        HURT: 10,
        HEALTH: 11,
        CHAT: 12,
        LOOT: 13,
        EQUIP: 14,
        DROP: 15,
        TELEPORT: 16,
        DAMAGE: 17,
        POPULATION: 18,
        KILL: 19,
        LIST: 20,
        WHO: 21,
        ZONE: 22,
        DESTROY: 23,
        HP: 24,
        BLINK: 25,
        OPEN: 26,
        CHECK: 27,
        PVP: 28,
        GUILD: 29,
        GUILDERROR: 30,
        INVENTORY: 31,
        ACHIEVEMENT: 32,
        HUB: 33,
        GOOGLE_LOGIN: 34,
        GUILDERRORTYPE: {
        	DOESNOTEXIST: 1,
        	BADNAME: 2,
        	ALREADYEXISTS: 3,
        	NOLEAVE: 4,
        	BADINVITE: 5,
        	GUILDRULES: 6,
        	IDWARNING: 7
        },
        GUILDACTION: {
			CONNECT: 8,
			ONLINE: 9,
			DISCONNECT: 10,
			INVITE: 11,
			LEAVE: 12,
			CREATE: 13,
			TALK: 14,
			JOIN: 15,
			POPULATION: 16
		}
    },

    Entities: {
        WARRIOR: 1,

        // Mobs
        RAT: 2,
        SKELETON: 3,
        GOBLIN: 4,
        OGRE: 5,
        SPECTRE: 6,
        CRAB: 7,
        BAT: 8,
        WIZARD: 9,
        EYE: 10,
        SNAKE: 11,
        SKELETON2: 12,
        BOSS: 13,
        DEATHKNIGHT: 14,

        // Armors
        FIREFOX: 20,
        CLOTHARMOR: 21,
        LEATHERARMOR: 22,
        MAILARMOR: 23,
        PLATEARMOR: 24,
        REDARMOR: 25,
        GOLDENARMOR: 26,

        // Objects
        FLASK: 35,
        BURGER: 36,
        CHEST: 37,
        FIREPOTION: 38,
        CAKE: 39,

        // NPCs
        GUARD: 40,
        KING: 41,
        OCTOCAT: 42,
        VILLAGEGIRL: 43,
        VILLAGER: 44,
        PRIEST: 45,
        SCIENTIST: 46,
        AGENT: 47,
        RICK: 48,
        NYAN: 49,
        SORCERER: 50,
        BEACHNPC: 51,
        FORESTNPC: 52,
        DESERTNPC: 53,
        LAVANPC: 54,
        CODER: 55,

        // Weapons
        SWORD1: 60,
        SWORD2: 61,
        REDSWORD: 62,
        GOLDENSWORD: 63,
        MORNINGSTAR: 64,
        AXE: 65,
        BLUESWORD: 66,
        BOW: 67,
        GOLDENBOW: 68,

        // Roster de 10 Boss (Monde & Donjons)
        GRANDOGRE: 70,
        SPECTREANCIEN: 71,
        SEIGNEURMORT: 72,
        ARCHIMAGE: 73,
        OEILABYSSAL: 74,
        REINECRABE: 75,
        ROIGOBELIN: 76,
        HYDRESERPENT: 77,
        COLOSSESQUELETTE: 78
    },

    Orientations: {
        UP: 1,
        DOWN: 2,
        LEFT: 3,
        RIGHT: 4
    },

    Keys: {
        ENTER: 13,
        UP: 38,
        DOWN: 40,
        LEFT: 37,
        RIGHT: 39,
        W: 87,
        A: 65,
        S: 83,
        D: 68,
        Z: 90,
        Q: 81,
        SPACE: 32,
        I: 73,
        B: 66,
        H: 72,
        M: 77,
        P: 80,
        KEY_1: 49,
        KEY_2: 50,
        KEY_3: 51,
        KEY_4: 52,
        KEY_5: 53,
        KEY_6: 54,
        KEYPAD_4: 100,
        KEYPAD_6: 102,
        KEYPAD_8: 104,
        KEYPAD_2: 98
    }
};

var kinds = {
    warrior: [Types.Entities.WARRIOR, "player"],

    rat: [Types.Entities.RAT, "mob", 6, 2],
    skeleton: [Types.Entities.SKELETON , "mob", 18, 8],
    goblin: [Types.Entities.GOBLIN, "mob", 12, 5],
    ogre: [Types.Entities.OGRE, "mob", 32, 12],
    spectre: [Types.Entities.SPECTRE, "mob", 60, 21],
    deathknight: [Types.Entities.DEATHKNIGHT, "mob", 85, 24],
    crab: [Types.Entities.CRAB, "mob", 5, 1],
    snake: [Types.Entities.SNAKE, "mob", 28, 10],
    bat: [Types.Entities.BAT, "mob", 9, 3],
    wizard: [Types.Entities.WIZARD, "mob", 26, 9],
    eye: [Types.Entities.EYE, "mob", 52, 18],
    skeleton2: [Types.Entities.SKELETON2, "mob", 42, 15],
    boss: [Types.Entities.BOSS, "mob", 500, 50],
    grandogre: [Types.Entities.GRANDOGRE, "mob", 260, 28],
    spectreancien: [Types.Entities.SPECTREANCIEN, "mob", 340, 38],
    seigneurmort: [Types.Entities.SEIGNEURMORT, "mob", 420, 45],
    archimage: [Types.Entities.ARCHIMAGE, "mob", 320, 35],
    oeilabyssal: [Types.Entities.OEILABYSSAL, "mob", 300, 34],
    reinecrabe: [Types.Entities.REINECRABE, "mob", 200, 20],
    roigobelin: [Types.Entities.ROIGOBELIN, "mob", 230, 24],
    hydreserpent: [Types.Entities.HYDRESERPENT, "mob", 280, 32],
    colossesquelette: [Types.Entities.COLOSSESQUELETTE, "mob", 380, 42],

    sword1: [Types.Entities.SWORD1, "weapon"],
    sword2: [Types.Entities.SWORD2, "weapon"],
    axe: [Types.Entities.AXE, "weapon"],
    redsword: [Types.Entities.REDSWORD, "weapon"],
    bluesword: [Types.Entities.BLUESWORD, "weapon"],
    goldensword: [Types.Entities.GOLDENSWORD, "weapon"],
    morningstar: [Types.Entities.MORNINGSTAR, "weapon"],
    bow: [Types.Entities.BOW, "weapon"],
    goldenbow: [Types.Entities.GOLDENBOW, "weapon"],

    firefox: [Types.Entities.FIREFOX, "armor"],
    clotharmor: [Types.Entities.CLOTHARMOR, "armor"],
    leatherarmor: [Types.Entities.LEATHERARMOR, "armor"],
    mailarmor: [Types.Entities.MAILARMOR, "armor"],
    platearmor: [Types.Entities.PLATEARMOR, "armor"],
    redarmor: [Types.Entities.REDARMOR, "armor"],
    goldenarmor: [Types.Entities.GOLDENARMOR, "armor"],

    flask: [Types.Entities.FLASK, "object"],
    cake: [Types.Entities.CAKE, "object"],
    burger: [Types.Entities.BURGER, "object"],
    chest: [Types.Entities.CHEST, "object"],
    firepotion: [Types.Entities.FIREPOTION, "object"],

    guard: [Types.Entities.GUARD, "npc"],
    villagegirl: [Types.Entities.VILLAGEGIRL, "npc"],
    villager: [Types.Entities.VILLAGER, "npc"],
    coder: [Types.Entities.CODER, "npc"],
    scientist: [Types.Entities.SCIENTIST, "npc"],
    priest: [Types.Entities.PRIEST, "npc"],
    king: [Types.Entities.KING, "npc"],
    rick: [Types.Entities.RICK, "npc"],
    nyan: [Types.Entities.NYAN, "npc"],
    sorcerer: [Types.Entities.SORCERER, "npc"],
    agent: [Types.Entities.AGENT, "npc"],
    octocat: [Types.Entities.OCTOCAT, "npc"],
    beachnpc: [Types.Entities.BEACHNPC, "npc"],
    forestnpc: [Types.Entities.FORESTNPC, "npc"],
    desertnpc: [Types.Entities.DESERTNPC, "npc"],
    lavanpc: [Types.Entities.LAVANPC, "npc"],

    getType: function(kind) {
        return kinds[Types.getKindAsString(kind)][1];
    },
    getMobExp: function(kind){
        return kinds[Types.getKindAsString(kind)][2];
    },
    getMobLevel: function(kind){
        return kinds[Types.getKindAsString(kind)][3];
    }

};

Types.rankedWeapons = [
    Types.Entities.SWORD1,
    Types.Entities.SWORD2,
    Types.Entities.AXE,
    Types.Entities.BOW,
    Types.Entities.MORNINGSTAR,
    Types.Entities.BLUESWORD,
    Types.Entities.REDSWORD,
    Types.Entities.GOLDENBOW,
    Types.Entities.GOLDENSWORD
];

Types.isRangedWeapon = function(weaponKind) {
    var kStr = (typeof weaponKind === "number") ? Types.getKindAsString(weaponKind) : weaponKind;
    return kStr === "bow" || kStr === "goldenbow" || weaponKind === Types.Entities.BOW || weaponKind === Types.Entities.GOLDENBOW;
};

Types.getWeaponRange = function(weaponKind) {
    var kStr = (typeof weaponKind === "number") ? Types.getKindAsString(weaponKind) : weaponKind;
    if(kStr === "goldenbow" || weaponKind === Types.Entities.GOLDENBOW) return 7;
    if(kStr === "bow" || weaponKind === Types.Entities.BOW) return 5;
    return 1;
};

Types.rankedArmors = [
    Types.Entities.CLOTHARMOR,
    Types.Entities.LEATHERARMOR,
    Types.Entities.MAILARMOR,
    Types.Entities.PLATEARMOR,
    Types.Entities.REDARMOR,
    Types.Entities.GOLDENARMOR
];

Types.expForLevel = [
    0, 30, 80, 160, 280,
    450, 680, 980, 1360, 1850, // 10

    2450, 3200, 4100, 5200, 6500,
    8000, 9800, 11900, 14300, 17000, // 20

    20200, 23900, 28100, 32900, 38400,
    44600, 51600, 59500, 68400, 78500, // 30

    89800, 102500, 116700, 132500, 150000,
    169500, 191000, 215000, 241500, 270000, // 40

    302000, 337000, 375000, 417000, 463000,
    513000, 568000, 628000, 694000, 765000, // 50

    422825, 456976, 493155, 531441, 571914,
    614656, 659750, 707281, 757335, 810000, // 60

    865365, 923521, 984560, 1048576, 1115664,
    1185921, 1259445, 1336336, 1416695, 1500625, // 70

    1588230, 1679616, 1774890, 1874161, 1977539,
    2085136, 2197065, 2313441, 2434380, 2560000, // 80

    2690420, 2825761, 2966145, 3111696, 3262539,
    3418801, 3580610, 3748096, 3921390, 4100625, // 90

    4285935, 4477456, 4675325, 4879681, 5090664,
    5318416, 5553080, 5804801, 6083725, 6410000, // 100

    6765201, 7311616, 7890481, 8503056, 9150625,
    9834496, 10556001, 11316496, 12117361, 12960000, // 110

    13845841, 14776336, 15752961, 16777216, 17850625,
    18974736, 20151121, 21381376, 22667121, 24010000, // 120

    25411681, 26873856, 28398241, 29986576, 31640625,
    33362176, 35153041, 37015056, 38950081, 40960000, // 130

    43046721, 45212176, 47458321, 49787136, 52200625,
    54700816, 57289761, 59969536, 62742241, 65610000, // 140

    68574961, 71639296, 74805201, 78074896, 81450625,
    84934656, 88529281, 92236816, 96059601, 100000000, // 150

    108243216,
];

Types.getLevel = function(exp){
    var i=1;
    for(i=1; i<135; i++){
        if(exp < Types.expForLevel[i]){
            return i;
        }
    }
    return 135;
};
Types.getWeaponRank = function(weaponKind) {
    return _.indexOf(Types.rankedWeapons, weaponKind);
};

Types.getArmorRank = function(armorKind) {
    return _.indexOf(Types.rankedArmors, armorKind);
};
Types.getMobExp = function(mobKind){
    return kinds.getMobExp(mobKind);
};
Types.getMobLevel = function(mobKind){
    return kinds.getMobLevel(mobKind);
};

Types.isPlayer = function(kind) {
    return kinds.getType(kind) === "player";
};

Types.isMob = function(kind) {
    return kinds.getType(kind) === "mob";
};

Types.isNpc = function(kind) {
    return kinds.getType(kind) === "npc";
};

Types.isCharacter = function(kind) {
    return Types.isMob(kind) || Types.isNpc(kind) || Types.isPlayer(kind);
};

Types.isArmor = function(kind) {
    return kinds.getType(kind) === "armor";
};

Types.isWeapon = function(kind) {
    return kinds.getType(kind) === "weapon";
};

Types.isObject = function(kind) {
    return kinds.getType(kind) === "object";
};

Types.isChest = function(kind) {
    return kind === Types.Entities.CHEST;
};

Types.isItem = function(kind) {
    return Types.isWeapon(kind)
        || Types.isArmor(kind)
        || (Types.isObject(kind) && !Types.isChest(kind));
};

Types.isHealingItem = function(kind) {
    return kind === Types.Entities.FLASK
        || kind === Types.Entities.BURGER
        || kind === Types.Entities.CAKE;
};

Types.isExpendableItem = function(kind) {
    return Types.isHealingItem(kind)
        || kind === Types.Entities.FIREPOTION
        || kind === Types.Entities.CAKE;
};

Types.getKindFromString = function(kind) {
    if(kind in kinds) {
        return kinds[kind][0];
    }
};

Types.getKindAsString = function(kind) {
    for(var k in kinds) {
        if(kinds[k][0] === kind) {
            return k;
        }
    }
};

Types.forEachKind = function(callback) {
    for(var k in kinds) {
        callback(kinds[k][0], k);
    }
};

Types.forEachArmor = function(callback) {
    Types.forEachKind(function(kind, kindName) {
        if(Types.isArmor(kind)) {
            callback(kind, kindName);
        }
    });
};

Types.forEachMobOrNpcKind = function(callback) {
    Types.forEachKind(function(kind, kindName) {
        if((Types.isMob(kind) && !Types.isCustomBoss(kind)) || Types.isNpc(kind)) {
            callback(kind, kindName);
        }
    });
};

Types.BossInfo = {
    boss: { sprite: "boss", name: "Roi Squelette", scale: 1.35 },
    grandogre: { sprite: "ogre", name: "Grand Ogre", scale: 1.5 },
    spectreancien: { sprite: "spectre", name: "Spectre Ancien", scale: 1.5 },
    seigneurmort: { sprite: "deathknight", name: "Seigneur de la Mort", scale: 1.5 },
    archimage: { sprite: "wizard", name: "Archimage Noir", scale: 1.5 },
    oeilabyssal: { sprite: "eye", name: "Œil Abyssal", scale: 1.55 },
    reinecrabe: { sprite: "crab", name: "Reine Crabe Géante", scale: 1.55 },
    roigobelin: { sprite: "goblin", name: "Roi Gobelin", scale: 1.5 },
    hydreserpent: { sprite: "snake", name: "Vipère Titan", scale: 1.55 },
    colossesquelette: { sprite: "skeleton2", name: "Colosse Squelette", scale: 1.5 }
};

Types.isBoss = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    return !!(kStr && Types.BossInfo[kStr]);
};

Types.isCustomBoss = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    return !!(kStr && kStr !== "boss" && Types.BossInfo[kStr]);
};

Types.getBossBaseSprite = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    if(kStr && Types.BossInfo[kStr]) {
        return Types.BossInfo[kStr].sprite;
    }
    return kStr;
};

Types.getBossDisplayName = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    if(kStr && Types.BossInfo[kStr]) {
        return Types.BossInfo[kStr].name;
    }
    return null;
};

Types.getBossScale = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    if(kStr && Types.BossInfo[kStr]) {
        return Types.BossInfo[kStr].scale;
    }
    return 1;
};

Types.getItemRarity = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    if(kStr === "redsword" || kStr === "goldensword" || kStr === "redarmor" || kStr === "goldenarmor" || kStr === "goldenbow") {
        return "legendary";
    }
    if(kStr === "morningstar" || kStr === "bluesword" || kStr === "platearmor" || kStr === "firepotion" || kStr === "bow") {
        return "rare";
    }
    return "common";
};

Types.getItemRarityLabel = function(kind) {
    var r = Types.getItemRarity(kind);
    if(r === "legendary") return "Légendaire";
    if(r === "rare") return "Rare";
    return "Commun";
};

Types.getFrenchItemName = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    var names = {
        flask: "Potion de Soin (+40 PV)",
        burger: "Burger Royal (+100 PV)",
        cake: "Gâteau (+60 PV)",
        firepotion: "Potion de Feu",
        sword1: "Épée en Bois",
        sword2: "Épée en Acier",
        axe: "Hache de Guerre",
        bow: "🏹 Arc de Chasseur (Distance)",
        morningstar: "Étoile du Matin",
        bluesword: "Épée Saphir",
        redsword: "Épée Rubis Flamboyante",
        goldenbow: "🏹 Arc Royal d'Élite [Légendaire]",
        goldensword: "Épée d'Or Légendaire",
        clotharmor: "Tunique en Tissu",
        leatherarmor: "Armure de Cuir",
        mailarmor: "Cotte de Mailles",
        platearmor: "Armure de Plaques",
        redarmor: "Armure Pourpre de Rubis",
        goldenarmor: "Armure d'Or Légendaire"
    };
    return names[kStr] || kStr;
};

Types.forEachArmorKind = function(callback) {
    Types.forEachKind(function(kind, kindName) {
        if(Types.isArmor(kind)) {
            callback(kind, kindName);
        }
    });
};
Types.forEachWeaponKind = function(callback) {
    Types.forEachKind(function(kind, kindName) {
        if(Types.isWeapon(kind)) {
            callback(kind, kindName);
        }
    });
};

Types.getOrientationAsString = function(orientation) {
    switch(orientation) {
        case Types.Orientations.LEFT: return "left"; break;
        case Types.Orientations.RIGHT: return "right"; break;
        case Types.Orientations.UP: return "up"; break;
        case Types.Orientations.DOWN: return "down"; break;
    }
};

Types.getRandomItemKind = function(item) {
    var all = _.union(this.rankedWeapons, this.rankedArmors),
        forbidden = [Types.Entities.SWORD1, Types.Entities.CLOTHARMOR],
        itemKinds = _.difference(all, forbidden),
        i = Math.floor(Math.random() * _.size(itemKinds));

    return itemKinds[i];
};

Types.getMessageTypeAsString = function(type) {
    var typeName;
    _.each(Types.Messages, function(value, name) {
        if(value === type) {
            typeName = name;
        }
    });
    if(!typeName) {
        typeName = "UNKNOWN";
    }
    return typeName;
};

Types.RangedMobs = {
    wizard:        { range: 5, color: "#a855f7", glow: "#e9d5ff", powerName: "Éclair Arcanique",   aoe: false },
    eye:           { range: 4, color: "#ef4444", glow: "#fecaca", powerName: "Rayon Oculaire",     aoe: false },
    spectre:       { range: 4, color: "#38bdf8", glow: "#bae6fd", powerName: "Trait Spectral",     aoe: false },
    snake:         { range: 3, color: "#22c55e", glow: "#bbf7d0", powerName: "Jet de Venin",       aoe: false },
    archimage:     { range: 6, color: "#c084fc", glow: "#f3e8ff", powerName: "Nova Arcanique",     aoe: true  },
    oeilabyssal:   { range: 5, color: "#f43f5e", glow: "#ffe4e6", powerName: "Laser Abyssal",      aoe: true  },
    spectreancien: { range: 5, color: "#60a5fa", glow: "#dbeafe", powerName: "Tempête d'Âmes",     aoe: true  },
    hydreserpent:  { range: 4, color: "#10b981", glow: "#d1fae5", powerName: "Pluie d'Acide",      aoe: true  },
    seigneurmort:  { range: 4, color: "#f97316", glow: "#ffedd5", powerName: "Onde Infernale",     aoe: true  },
    boss:          { range: 5, color: "#eab308", glow: "#fef08a", powerName: "Courroux Royal",     aoe: true  }
};

Types.isRangedMob = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    return !!(kStr && Types.RangedMobs[kStr]);
};

Types.getMobAttackRange = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    if(kStr && Types.RangedMobs[kStr]) {
        return Types.RangedMobs[kStr].range;
    }
    return 1;
};

Types.getMobPowerSpec = function(kind) {
    var kStr = (typeof kind === "number") ? Types.getKindAsString(kind) : kind;
    return (kStr && Types.RangedMobs[kStr]) ? Types.RangedMobs[kStr] : null;
};

if(!(typeof exports === 'undefined')) {
    module.exports = Types;
}
