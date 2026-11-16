// Progression : quetes journalieres, succes (titres) et classement.
// Module autonome : ses donnees vivent dans des tables dediees, il n'altere
// ni la table players ni les quetes PNJ existantes.
var Types = require('../../shared/js/gametypes');

var ACTIONS = ['progress_get', 'leaderboard_get', 'title_set'];
var QUESTS_PER_DAY = 3;
var LEADERBOARD_SIZE = 10;
var LEADERBOARD_TTL = 30 * 1000;

// Modeles de quetes. Les cibles sont tirees de facon deterministe par jour/joueur.
var QUEST_POOL = [
    { id: 'kill_any',   text: 'Vaincre {n} monstres',          goal: [20, 30, 40], gold: 60,  exp: 40 },
    { id: 'kill_rat',   text: 'Chasser {n} rats',              goal: [8, 12],      gold: 40,  exp: 25, mobs: ['rat'] },
    { id: 'kill_crab',  text: 'Chasser {n} crabes',            goal: [8, 12],      gold: 40,  exp: 25, mobs: ['crab'] },
    { id: 'kill_bat',   text: 'Abattre {n} chauves-souris',    goal: [8, 12],      gold: 50,  exp: 30, mobs: ['bat'] },
    { id: 'kill_gob',   text: 'Eliminer {n} gobelins',         goal: [8, 12],      gold: 60,  exp: 40, mobs: ['goblin'] },
    { id: 'kill_undead', text: 'Detruire {n} morts-vivants',   goal: [6, 10],      gold: 90,  exp: 60, mobs: ['skeleton', 'skeleton2', 'spectre', 'deathknight'] },
    { id: 'kill_ogre',  text: 'Terrasser {n} ogres',           goal: [3, 5],       gold: 120, exp: 80, mobs: ['ogre'] },
    { id: 'kill_boss',  text: 'Vaincre un boss',               goal: [1],          gold: 250, exp: 150, boss: true }
];

// Titres debloques par paliers de statistiques.
var TITLES = [
    { id: 'rookie',    name: 'Recrue',               stat: 'kills',      need: 10 },
    { id: 'hunter',    name: 'Chasseur',             stat: 'kills',      need: 250 },
    { id: 'slayer',    name: 'Massacreur',           stat: 'kills',      need: 1500 },
    { id: 'bossbane',  name: 'Tueur de boss',        stat: 'bossKills',  need: 1 },
    { id: 'kingslayer', name: 'Fleau des rois',      stat: 'bossKills',  need: 10 },
    { id: 'dedicated', name: 'Assidu',               stat: 'questsDone', need: 10 },
    { id: 'devoted',   name: 'Fidele de Nova',       stat: 'questsDone', need: 50 },
    { id: 'streak3',   name: 'Regulier',             stat: 'bestStreak', need: 3 },
    { id: 'streak7',   name: 'Infatigable',          stat: 'bestStreak', need: 7 }
];

function dayKey(now) {
    return new Date(now || Date.now()).toISOString().slice(0, 10);
}

function previousDayKey(day) {
    return new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

function hash(text) {
    var h = 2166136261;
    for(var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function generateQuests(name, day) {
    var seed = hash(name + '|' + day), pool = QUEST_POOL.slice(), quests = [];
    while(quests.length < QUESTS_PER_DAY && pool.length) {
        seed = hash(String(seed) + '|' + quests.length);
        var tpl = pool.splice(seed % pool.length, 1)[0];
        var goal = tpl.goal[(seed >>> 8) % tpl.goal.length];
        quests.push({
            id: tpl.id, text: tpl.text.replace('{n}', goal), goal: goal, progress: 0,
            gold: tpl.gold, exp: tpl.exp, done: false
        });
    }
    return quests;
}

function templateOf(id) {
    for(var i = 0; i < QUEST_POOL.length; i++) if(QUEST_POOL[i].id === id) return QUEST_POOL[i];
    return null;
}

function matches(quest, mobKind, isBoss) {
    var tpl = templateOf(quest.id);
    if(!tpl) return false;
    if(tpl.boss) return isBoss;
    if(tpl.mobs) return tpl.mobs.indexOf(mobKind) !== -1;
    return true;
}

function ensureTables(db) {
    if(db._progressionReady) return;
    db.db.exec(
        'CREATE TABLE IF NOT EXISTS progression (' +
        '  username TEXT PRIMARY KEY,' +
        '  data TEXT NOT NULL DEFAULT \'{}\'' +
        ');'
    );
    db._progressionReady = true;
    db._progressionGet = db.db.prepare('SELECT data FROM progression WHERE username = ?');
    db._progressionSet = db.db.prepare(
        'INSERT INTO progression (username, data) VALUES (?, ?) ' +
        'ON CONFLICT(username) DO UPDATE SET data = excluded.data'
    );
}

function load(db, name, now) {
    ensureTables(db);
    var row = db._progressionGet.get(name), data = {};
    try { data = row ? JSON.parse(row.data) : {}; } catch(e) { data = {}; }
    data.stats = data.stats || {};
    ['kills', 'bossKills', 'questsDone', 'streak', 'bestStreak'].forEach(function(key) {
        data.stats[key] = Number(data.stats[key]) || 0;
    });
    data.titles = Array.isArray(data.titles) ? data.titles : [];
    var today = dayKey(now);
    if(!data.day || data.day !== today || !Array.isArray(data.quests)) {
        data.day = today;
        data.quests = generateQuests(name, today);
        data.bonusClaimed = false;
    }
    return data;
}

function save(db, name, data) {
    db._progressionSet.run(name, JSON.stringify(data));
}

function unlockTitles(data) {
    var unlocked = [];
    TITLES.forEach(function(title) {
        if(data.titles.indexOf(title.id) === -1 && data.stats[title.stat] >= title.need) {
            data.titles.push(title.id);
            unlocked.push(title);
        }
    });
    return unlocked;
}

function titleName(id) {
    for(var i = 0; i < TITLES.length; i++) if(TITLES[i].id === id) return TITLES[i].name;
    return null;
}

function snapshot(data) {
    return {
        day: data.day,
        quests: data.quests,
        allDone: data.quests.every(function(q) { return q.done; }),
        bonusClaimed: !!data.bonusClaimed,
        stats: data.stats,
        titles: TITLES.map(function(t) {
            return { id: t.id, name: t.name, stat: t.stat, need: t.need,
                     unlocked: data.titles.indexOf(t.id) !== -1 };
        }),
        activeTitle: data.activeTitle ? titleName(data.activeTitle) : null
    };
}

exports.handles = function(action) {
    return ACTIONS.indexOf(action) !== -1;
};

exports.titleFor = function(db, name) {
    var data = load(db, name);
    return data.activeTitle && data.titles.indexOf(data.activeTitle) !== -1 ? titleName(data.activeTitle) : null;
};

// Appele quand un joueur tue un monstre. Retourne les evenements a notifier.
exports.onMobKilled = function(player, mob, now) {
    var db = player.databaseHandler;
    if(!db || !db.db || !player.name || !mob) return null;
    var data = load(db, player.name, now),
        kind = Types.getKindAsString(mob.kind),
        boss = Types.isBoss(mob.kind),
        completed = [], bonus = null;

    data.stats.kills += 1;
    if(boss) data.stats.bossKills += 1;

    data.quests.forEach(function(quest) {
        if(quest.done || !matches(quest, kind, boss)) return;
        quest.progress = Math.min(quest.goal, quest.progress + 1);
        if(quest.progress >= quest.goal) {
            quest.done = true;
            data.stats.questsDone += 1;
            completed.push(quest);
        }
    });

    var rewardGold = 0, rewardExp = 0;
    completed.forEach(function(q) { rewardGold += q.gold; rewardExp += q.exp; });

    if(!data.bonusClaimed && data.quests.every(function(q) { return q.done; })) {
        data.bonusClaimed = true;
        var yesterday = previousDayKey(data.day);
        data.stats.streak = data.lastBonusDay === yesterday ? data.stats.streak + 1 : 1;
        data.stats.bestStreak = Math.max(data.stats.bestStreak, data.stats.streak);
        data.lastBonusDay = data.day;
        bonus = { gold: 100 + 25 * Math.min(data.stats.streak, 7), streak: data.stats.streak };
        rewardGold += bonus.gold;
    }

    var titles = unlockTitles(data);
    save(db, player.name, data);

    if(rewardGold) player.gold = (player.gold || 0) + rewardGold;
    if(rewardExp && typeof player.incExp === 'function') player.incExp(rewardExp);
    if(rewardGold && db.savePlayer) db.savePlayer(player);

    if(!completed.length && !bonus && !titles.length) return { changed: true, rewardGold: 0 };
    return { changed: true, completed: completed, bonus: bonus, titles: titles,
             rewardGold: rewardGold, rewardExp: rewardExp };
};

// Applique un kill puis previent le client (quete finie, bonus, titre, or).
exports.afterKill = function(player, mob) {
    var Messages = require('./message');
    var result = exports.onMobKilled(player, mob);
    if(!result || !result.changed) return result;
    var db = player.databaseHandler;
    if(result.rewardGold) {
        player.send(new Messages.Hub('gold_update', { gold: player.gold, reward: result.rewardGold }).serialize());
    }
    var lines = [];
    (result.completed || []).forEach(function(q) {
        lines.push('Quete du jour terminee : ' + q.text + ' (+' + q.gold + ' or, +' + q.exp + ' XP)');
    });
    if(result.bonus) {
        lines.push('Toutes les quetes du jour accomplies ! Bonus +' + result.bonus.gold + ' or (serie : ' + result.bonus.streak + ' j)');
    }
    (result.titles || []).forEach(function(t) { lines.push('Nouveau titre debloque : ' + t.name); });
    var snap = snapshot(load(db, player.name));
    player.send(new Messages.Hub('progress_data', snap).serialize());
    lines.forEach(function(line) {
        if(typeof player.sendHubNotice === 'function') player.sendHubNotice(line, false);
    });
    return result;
};

var leaderboardCache = { at: 0, rows: null, db: null };

function leaderboard(db, now) {
    var t = now || Date.now();
    if(leaderboardCache.db === db && leaderboardCache.rows && t - leaderboardCache.at < LEADERBOARD_TTL) {
        return leaderboardCache.rows;
    }
    ensureTables(db);
    var rows = db.db.prepare(
        'SELECT p.username AS name, p.gold AS gold, p.inventory AS inventory, g.data AS progress ' +
        'FROM players p LEFT JOIN progression g ON g.username = p.username ' +
        'WHERE p.is_banned = 0 AND p.is_admin = 0'
    ).all().map(function(row) {
        var exp = 0, kills = 0, level = 0, progress = {};
        try { exp = Number(JSON.parse(row.inventory).exp) || 0; } catch(e) {}
        try { progress = row.progress ? JSON.parse(row.progress) : {}; } catch(e) {}
        kills = progress.stats && Number(progress.stats.kills) || 0;
        try { level = Types.getLevel(exp); } catch(e) {}
        return { name: row.name, level: level, exp: exp, kills: kills, gold: Number(row.gold) || 0 };
    });
    var boards = {
        level: rows.slice().sort(function(a, b) { return b.exp - a.exp; }),
        kills: rows.slice().sort(function(a, b) { return b.kills - a.kills; }),
        gold: rows.slice().sort(function(a, b) { return b.gold - a.gold; })
    };
    Object.keys(boards).forEach(function(key) {
        boards[key] = boards[key].slice(0, LEADERBOARD_SIZE);
    });
    leaderboardCache = { at: t, rows: boards, db: db };
    return boards;
}
exports.leaderboard = leaderboard;
exports._resetCache = function() { leaderboardCache = { at: 0, rows: null, db: null }; };

// Gere les messages Hub. Retourne true si l'action a ete traitee.
exports.handle = function(player, action, data) {
    var db = player.databaseHandler;
    if(!db || !db.db) return false;
    data = data || {};

    if(action === 'progress_get') {
        player.send(new (require('./message').Hub)('progress_data', snapshot(load(db, player.name))).serialize());
        return true;
    }
    if(action === 'leaderboard_get') {
        player.send(new (require('./message').Hub)('leaderboard_data', leaderboard(db)).serialize());
        return true;
    }
    if(action === 'title_set') {
        var progress = load(db, player.name), id = String(data.id || '');
        if(id === '') {
            progress.activeTitle = null;
        } else if(progress.titles.indexOf(id) !== -1) {
            progress.activeTitle = id;
        } else {
            return true;
        }
        save(db, player.name, progress);
        player.send(new (require('./message').Hub)('progress_data', snapshot(progress)).serialize());
        return true;
    }
    return false;
};

exports.QUEST_POOL = QUEST_POOL;
exports.TITLES = TITLES;
exports.generateQuests = generateQuests;
exports.dayKey = dayKey;
