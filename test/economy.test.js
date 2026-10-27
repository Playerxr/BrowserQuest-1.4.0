const test = require('node:test');
const assert = require('node:assert/strict');
global.log = { info() {}, debug() {}, error() {} };
// The historical map bootstrap exposes underscore to shared/gametypes.
global._ = require('underscore');
const Store = require('../server/js/database');
const PlayerClass = require('../server/js/player');
const Types = require('../shared/js/gametypes');

function setup(t) {
    const db = new Store({ database_path: ':memory:' });
    global.databaseHandler = db;
    t.after(() => db.db.close());
    const online = new Map();
    const server = { getPlayerByName: name => online.get(name) };
    function player(name, gold = 500) {
        const p = Object.create(PlayerClass.prototype);
        Object.assign(p, { name, id: online.size + 1, server, databaseHandler: db,
            hasEnteredGame: true, isDead: false, gold, guildId: null, lives: 3,
            x: 43, y: 210, armor: Types.Entities.CLOTHARMOR, armorLevel: 1,
            weapon: Types.Entities.SWORD1, weaponLevel: 1, hitPoints: 80, maxHitPoints: 80,
            inventory: Array(6).fill(null), inventoryCount: Array(6).fill(0),
            experience: 0, messages: [],
            send(message) { this.messages.push(message); },
            broadcast(message) { this.messages.push(['broadcast', message]); },
            sendHubState(text) { this.messages.push(['state', text]); },
            sendHubNotice(text, error) { this.messages.push(['notice', text, error]); }
        });
        db.db.prepare('INSERT INTO players (username, password, gold, inventory) VALUES (?, ?, ?, ?)')
            .run(name, 'test-only', gold, JSON.stringify({ items: p.inventory, counts: p.inventoryCount }));
        online.set(name, p);
        return p;
    }
    function listing(seller, kind = 'sword2', price = 100) {
        return Number(db.addMarketItem(seller.name, kind, 'weapon', price));
    }
    return { db, online, player, listing };
}

function storedItems(db, p) { return JSON.parse(db.stmtGetPlayer.get(p.name).inventory).items; }

test('market purchase commits item, payment, seller credit and listing removal', t => {
    const { db, player, listing } = setup(t);
    const buyer = player('buyer'), seller = player('seller', 20);
    const id = listing(seller);
    buyer.handleHubMessage('market_buy', { marketId: id });
    assert.equal(buyer.gold, 400);
    assert.equal(seller.gold, 120);
    assert.equal(db.stmtGetPlayer.get('buyer').gold, 400);
    assert.equal(db.stmtGetPlayer.get('seller').gold, 120);
    assert.equal(storedItems(db, buyer)[0], 'sword2');
    assert.equal(db.getMarketItemById(id), undefined);
    assert.ok(buyer.messages.some(m => m[0] === 'state'));
});

test('offline seller is credited and a sold listing cannot be purchased twice', t => {
    const { db, online, player, listing } = setup(t);
    const buyer = player('buyer'), second = player('second'), seller = player('seller', 20);
    const id = listing(seller);
    online.delete('seller');
    buyer.handleHubMessage('market_buy', { marketId: id });
    second.handleHubMessage('market_buy', { marketId: id });
    assert.equal(db.stmtGetPlayer.get('seller').gold, 120);
    assert.equal(second.gold, 500);
    assert.deepEqual(second.inventory, Array(6).fill(null));
});

test('seller-credit failure rolls back SQLite, in-memory buyer and outgoing inventory messages', t => {
    const { db, online, player, listing } = setup(t);
    const buyer = player('buyer'), seller = player('seller', 20);
    const id = listing(seller);
    online.delete('seller');
    db.addGoldToUsername = () => { throw new Error('injected write failure'); };
    buyer.handleHubMessage('market_buy', { marketId: id });
    assert.equal(buyer.gold, 500);
    assert.deepEqual(buyer.inventory, Array(6).fill(null));
    assert.equal(db.stmtGetPlayer.get('buyer').gold, 500);
    assert.equal(db.stmtGetPlayer.get('seller').gold, 20);
    assert.deepEqual(storedItems(db, buyer), Array(6).fill(null));
    assert.ok(db.getMarketItemById(id));
    assert.deepEqual(buyer.messages.map(m => m[0]), ['notice']);
    assert.equal(buyer._economyTransactionActive, false);
});

test('online seller save failure restores both player balances and seller notifications', t => {
    const { db, player, listing } = setup(t);
    const buyer = player('buyer'), seller = player('seller', 20), id = listing(seller);
    const save = db.savePlayer.bind(db);
    db.savePlayer = p => { save(p); if(p === seller) throw new Error('seller save failure'); };
    buyer.handleHubMessage('market_buy', { marketId: id });
    assert.equal(buyer.gold, 500);
    assert.equal(seller.gold, 20);
    assert.equal(db.stmtGetPlayer.get('seller').gold, 20);
    assert.deepEqual(seller.messages, []);
    assert.ok(db.getMarketItemById(id));
});

test('full backpack does not remove listing or charge buyer', t => {
    const { db, player, listing } = setup(t);
    const buyer = player('buyer'), seller = player('seller'), id = listing(seller);
    buyer.inventory.fill(Types.Entities.AXE);
    buyer.inventoryCount.fill(1);
    buyer.handleHubMessage('market_buy', { marketId: id });
    assert.equal(buyer.gold, 500);
    assert.ok(db.getMarketItemById(id));
});

test('seller withdraws own listing without paying', t => {
    const { db, player, listing } = setup(t);
    const seller = player('seller', 20), id = listing(seller);
    seller.handleHubMessage('market_buy', { marketId: id });
    assert.equal(seller.gold, 20);
    assert.equal(storedItems(db, seller)[0], 'sword2');
    assert.equal(db.getMarketItemById(id), undefined);
});

test('listing failure restores equipped item and removes partially written listing', t => {
    const { db, player } = setup(t);
    const seller = player('seller');
    seller.equipWeapon(Types.Entities.AXE);
    db.savePlayer(seller);
    const save = db.savePlayer.bind(db);
    db.savePlayer = p => { save(p); throw new Error('injected save failure'); };
    seller.handleHubMessage('market_sell', { slotType: 'weapon', price: 100 });
    assert.equal(seller.weapon, Types.Entities.AXE);
    assert.equal(db.stmtGetPlayer.get('seller').weapon, 'axe');
    assert.deepEqual(db.getMarketItems(), []);
    assert.deepEqual(seller.messages.map(m => m[0]), ['notice']);
});

test('shop save failure rolls back item insertion and gold', t => {
    const { db, player } = setup(t);
    const buyer = player('buyer');
    const save = db.savePlayer.bind(db);
    db.savePlayer = p => { save(p); if(p.gold < 500) throw new Error('injected save failure'); };
    buyer.handleHubMessage('shop_buy', { itemKind: 'sword2' });
    assert.equal(buyer.gold, 500);
    assert.deepEqual(storedItems(db, buyer), Array(6).fill(null));
    assert.deepEqual(buyer.inventory, Array(6).fill(null));
});

test('guild deposit transfers gold once and is rolled back if saving player fails', t => {
    const { db, player } = setup(t);
    const leader = player('leader');
    leader.guildId = db.createGuild('TST', 'Test Guild', leader.name).id;
    db.savePlayer(leader);
    leader.handleHubMessage('guild_deposit', { amount: 100 });
    assert.equal(leader.gold, 400);
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 100);
    const save = db.savePlayer.bind(db);
    db.savePlayer = p => { save(p); throw new Error('injected write failure'); };
    leader.handleHubMessage('guild_deposit', { amount: 100 });
    assert.equal(leader.gold, 400);
    assert.equal(db.stmtGetPlayer.get(leader.name).gold, 400);
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 100);
});

test('guild hall purchase is atomic across personal gold, bank and unlock', t => {
    const { db, player } = setup(t);
    const leader = player('leader', 40000);
    leader.guildId = db.createGuild('TST', 'Test Guild', leader.name).id;
    db.depositGuildGold(leader.guildId, 20000);
    db.savePlayer(leader);
    const unlock = db.unlockGuildHall.bind(db);
    db.unlockGuildHall = id => { unlock(id); throw new Error('injected unlock failure'); };
    leader.handleHubMessage('guild_buy_hall', {});
    assert.equal(leader.gold, 40000);
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 20000);
    assert.equal(db.getGuildById(leader.guildId).has_hall, 0);
    db.unlockGuildHall = unlock;
    leader.handleHubMessage('guild_buy_hall', {});
    assert.equal(leader.gold, 10000);
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 0);
    assert.equal(db.getGuildById(leader.guildId).has_hall, 1);
    leader.handleHubMessage('guild_buy_hall', {});
    assert.equal(leader.gold, 10000);
});

test('guild creation failure removes the new guild and refunds founder', t => {
    const { db, player } = setup(t);
    const leader = player('leader');
    const save = db.savePlayer.bind(db);
    db.savePlayer = p => { save(p); throw new Error('injected save failure'); };
    leader.handleHubMessage('guild_create', { tag: 'TST', name: 'Test Guild' });
    assert.equal(leader.gold, 500);
    assert.equal(leader.guildId, null);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM guilds').get().count, 0);
    assert.equal(db.stmtGetPlayer.get(leader.name).guild_id, null);
});

test('guild cannot be joined without invitation and foreign members cannot be kicked', t => {
    const { db, player } = setup(t);
    const leader = player('leader'), outsider = player('outsider'), otherLeader = player('other');
    leader.guildId = db.createGuild('ONE', 'First Guild', leader.name).id;
    otherLeader.guildId = db.createGuild('TWO', 'Second Guild', otherLeader.name).id;
    outsider.handleHubMessage('guild_accept', { guildId: leader.guildId });
    assert.equal(outsider.guildId, null);
    leader.handleHubMessage('guild_kick', { targetName: otherLeader.name });
    assert.equal(otherLeader.guildId, db.stmtGetPlayer.get(otherLeader.name).guild_id);
});


test('failed paid guild summons and chests refund the guild bank', t => {
    const { db, player } = setup(t);
    const leader = player('leader');
    leader.guildId = db.createGuild('TST', 'Test Guild', leader.name).id;
    db.unlockGuildHall(leader.guildId);
    db.depositGuildGold(leader.guildId, 10000);
    leader.instanceId = 'guild_' + leader.guildId;
    leader.server.spawnGuildBoss = () => null;
    leader.server.spawnCustomChest = () => null;
    leader.handleHubMessage('guild_summon_boss', { bossKind: 'seigneurmort' });
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 10000);
    leader.handleHubMessage('guild_spawn_chest', {});
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 10000);
    assert.equal(leader.gold, 500);
});

test('failed commit removes a newly spawned entity and its pending world spawn', t => {
    const { db, player } = setup(t);
    const leader = player('leader');
    leader.guildId = db.createGuild('TST', 'Test Guild', leader.name).id;
    db.depositGuildGold(leader.guildId, 10000);
    const entity = { id: 88, group: 'test' };
    leader.server.entities = {};
    leader.server.items = {};
    leader.server.groups = { test: { entities: {}, incoming: [] } };
    leader.server.spawnCustomChest = () => {
        leader.server.entities[entity.id] = entity;
        leader.server.items[entity.id] = entity;
        leader.server.groups.test.entities[entity.id] = entity;
        leader.server.groups.test.incoming.push(entity);
        // Force the final invariant check to fail after the spawn succeeded.
        leader.gold = -1;
        return entity;
    };
    leader.handleHubMessage('guild_spawn_chest', {});
    assert.equal(db.getGuildById(leader.guildId).bank_gold, 10000);
    assert.equal(leader.gold, 500);
    assert.deepEqual(leader.server.entities, {});
    assert.deepEqual(leader.server.items, {});
    assert.deepEqual(leader.server.groups.test.incoming, []);
    assert.deepEqual(leader.server.groups.test.entities, {});
    assert.equal(entity.isDead, true);
});


test('equipping and swapping armor cannot restore health', t => {
    const { db, player } = setup(t);
    const p = player('armored');
    p.hitPoints = 25;
    p.inventory[0] = Types.Entities.LEATHERARMOR;
    p.inventoryCount[0] = 1;
    p.handleHubMessage('bag_equip', { slot: 0 });
    assert.equal(p.hitPoints, 25);
    assert.equal(db.stmtGetPlayer.get(p.name).hp, 25);
    p.inventory[0] = Types.Entities.PLATEARMOR;
    p.inventoryCount[0] = 1;
    p.handleHubMessage('bag_equip', { slot: 0 });
    p.handleHubMessage('bag_equip', { slot: 0 });
    assert.equal(p.hitPoints, 25);
});


test('seller connected to a different world receives online credit without later overwriting payment', t => {
    const { db, online, player, listing } = setup(t);
    const buyer = player('buyer'), seller = player('seller', 20), id = listing(seller);
    online.delete(seller.name);
    buyer.server.server = { worlds: [buyer.server, { getPlayerByName: name => name === seller.name ? seller : null }] };
    buyer.handleHubMessage('market_buy', { marketId: id });
    assert.equal(seller.gold, 120);
    assert.equal(db.stmtGetPlayer.get(seller.name).gold, 120);
    db.savePlayer(seller);
    assert.equal(db.stmtGetPlayer.get(seller.name).gold, 120);
});
