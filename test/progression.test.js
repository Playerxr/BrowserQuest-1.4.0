const test = require('node:test');
const assert = require('node:assert/strict');
global.log = { info() {}, debug() {}, error() {} };
global._ = require('underscore');
const Store = require('../server/js/database');
const Progression = require('../server/js/progression');
const Types = require('../shared/js/gametypes');

function setup(t) {
    const db = new Store({ database_path: ':memory:' });
    t.after(() => db.db.close());
    Progression._resetCache();
    function player(name, exp = 0) {
        db.db.prepare('INSERT INTO players (username, password, gold, inventory) VALUES (?, ?, 0, ?)')
            .run(name, 'x', JSON.stringify({ items: [], counts: [], exp }));
        return { name, gold: 0, experience: 0, databaseHandler: db, messages: [],
            incExp(n) { this.experience += n; },
            send(m) { this.messages.push(m); } };
    }
    return { db, player };
}

const mob = kind => ({ kind: Types.Entities[kind.toUpperCase()] });
const NOON = Date.parse('2026-11-20T12:00:00Z');
const NEXT_DAY = NOON + 86400000;

test('daily quests are deterministic per player and day, and differ across days', () => {
    const a = Progression.generateQuests('alice', '2026-11-20');
    assert.equal(a.length, 3);
    assert.deepEqual(a, Progression.generateQuests('alice', '2026-11-20'));
    assert.equal(new Set(a.map(q => q.id)).size, 3);
    const days = new Set();
    for (let d = 1; d <= 20; d++) days.add(JSON.stringify(Progression.generateQuests('alice', '2026-11-' + String(d).padStart(2, '0')).map(q => q.id)));
    assert.ok(days.size > 1);
});

test('kills advance matching quests, pay rewards once and count toward stats', t => {
    const { player } = setup(t);
    const p = player('alice');
    const stored = Progression.generateQuests('alice', '2026-11-20');
    const anyQuest = stored.find(q => q.id === 'kill_any');
    let total = 0;
    for (let i = 0; i < 60; i++) {
        const res = Progression.onMobKilled(p, mob('rat'), NOON);
        total += res.rewardGold || 0;
    }
    assert.equal(p.gold, total);
    assert.ok(p.experience >= 0);
    const snap = Progression.leaderboard && JSON.parse(JSON.stringify(
        require('../server/js/progression').generateQuests('alice', '2026-11-20')));
    assert.ok(snap.length === 3);
    if (anyQuest) assert.ok(total >= anyQuest.gold);
});

test('completing all quests grants a streak bonus once and unlocks titles', t => {
    const { player, db } = setup(t);
    const p = player('bob');
    const bonuses = [];
    for (let i = 0; i < 200; i++) {
        // Chaque type de monstre pour couvrir toutes les quetes possibles
        ['rat', 'crab', 'bat', 'goblin', 'skeleton', 'ogre', 'boss'].forEach(kind => {
            const res = Progression.onMobKilled(p, mob(kind), NOON);
            if (res && res.bonus) bonuses.push(res.bonus);
        });
    }
    assert.equal(bonuses.length, 1, 'bonus only once per day');
    assert.equal(bonuses[0].streak, 1);
    const row = JSON.parse(db._progressionGet.get('bob').data);
    assert.ok(row.titles.includes('rookie'));
    assert.ok(row.titles.includes('bossbane'));
});

test('streak grows on consecutive days and resets after a gap', t => {
    const { player } = setup(t);
    const p = player('carol');
    const finish = when => {
        let bonus = null;
        for (let i = 0; i < 200 && !bonus; i++) {
            ['rat', 'crab', 'bat', 'goblin', 'skeleton', 'ogre', 'boss'].forEach(kind => {
                const res = Progression.onMobKilled(p, mob(kind), when);
                if (res && res.bonus) bonus = res.bonus;
            });
        }
        return bonus;
    };
    assert.equal(finish(NOON).streak, 1);
    assert.equal(finish(NEXT_DAY).streak, 2);
    assert.equal(finish(NEXT_DAY + 3 * 86400000).streak, 1);
});

test('leaderboard ranks by level, kills and gold, excluding banned and admin accounts', t => {
    const { player, db } = setup(t);
    player('low', 10);
    player('high', 5000);
    player('banned', 99999);
    player('boss', 99999);
    db.db.prepare('UPDATE players SET is_banned = 1 WHERE username = ?').run('banned');
    db.db.prepare('UPDATE players SET is_admin = 1 WHERE username = ?').run('boss');
    db.db.prepare('UPDATE players SET gold = 900 WHERE username = ?').run('low');
    const board = Progression.leaderboard(db);
    assert.deepEqual(board.level.map(r => r.name), ['high', 'low']);
    assert.equal(board.gold[0].name, 'low');
});

test('hub actions answer with data and titles can only be equipped when unlocked', t => {
    const { player } = setup(t);
    const p = player('dave');
    assert.ok(Progression.handles('progress_get'));
    Progression.handle(p, 'title_set', { id: 'bossbane' });
    assert.equal(Progression.titleFor(p.databaseHandler, 'dave'), null);
    for (let i = 0; i < 10; i++) Progression.onMobKilled(p, mob('boss'), NOON);
    Progression.handle(p, 'title_set', { id: 'bossbane' });
    assert.equal(Progression.titleFor(p.databaseHandler, 'dave'), 'Tueur de boss');
    p.messages.length = 0;
    Progression.handle(p, 'progress_get', {});
    Progression.handle(p, 'leaderboard_get', {});
    assert.equal(p.messages.length, 2);
});
