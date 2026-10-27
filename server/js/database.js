var path = require('path'),
    crypto = require('crypto'),
    Database = require('better-sqlite3'),
    cls = require('./lib/class'),
    Formulas = require('./formulas'),
    Properties = require('./properties'),
    Auth = require('./auth'),
    firebaseService = null,
    Types = require('../../shared/js/gametypes');

try {
    firebaseService = require('./firebase_service');
} catch(e) {}

module.exports = DatabaseHandler = cls.Class.extend({
    init: function(config) {
        var dbPath = config && config.database_path ? config.database_path : path.resolve(__dirname, '../../game.db');
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');

        // Création automatique de la table players
        this.db.exec(
            "CREATE TABLE IF NOT EXISTS players (" +
            "  username TEXT PRIMARY KEY," +
            "  password TEXT," +
            "  x INTEGER DEFAULT 0," +
            "  y INTEGER DEFAULT 0," +
            "  armor TEXT DEFAULT 'clotharmor'," +
            "  weapon TEXT DEFAULT 'sword1'," +
            "  hp INTEGER DEFAULT 0," +
            "  inventory TEXT DEFAULT '{}'," +
            "  gold INTEGER DEFAULT 150," +
            "  is_admin INTEGER DEFAULT 0," +
            "  is_banned INTEGER DEFAULT 0," +
            "  guild_id INTEGER DEFAULT NULL," +
            "  lives INTEGER DEFAULT 3" +
            ");"
        );

        // Migration automatique si la table existait déjà sans les nouvelles colonnes
        var migrations = [
            "ALTER TABLE players ADD COLUMN gold INTEGER DEFAULT 150",
            "ALTER TABLE players ADD COLUMN is_admin INTEGER DEFAULT 0",
            "ALTER TABLE players ADD COLUMN is_banned INTEGER DEFAULT 0",
            "ALTER TABLE players ADD COLUMN guild_id INTEGER DEFAULT NULL",
            "ALTER TABLE players ADD COLUMN lives INTEGER DEFAULT 3",
            "ALTER TABLE players ADD COLUMN google_uid TEXT DEFAULT NULL",
            "ALTER TABLE players ADD COLUMN email TEXT DEFAULT NULL"
        ];
        for(var m = 0; m < migrations.length; m++) {
            try {
                this.db.exec(migrations[m]);
            } catch(e) {
                // La colonne existe déjà
            }
        }

        // Création de la table des guildes
        this.db.exec(
            "CREATE TABLE IF NOT EXISTS guilds (" +
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  tag TEXT," +
            "  name TEXT," +
            "  leader TEXT," +
            "  members TEXT DEFAULT '[]'," +
            "  bank_gold INTEGER DEFAULT 0," +
            "  quest_kills INTEGER DEFAULT 0," +
            "  quest_target INTEGER DEFAULT 1000," +
            "  quest_level INTEGER DEFAULT 1," +
            "  has_hall INTEGER DEFAULT 0" +
            ");"
        );

        var guildMigrations = [
            "ALTER TABLE guilds ADD COLUMN bank_gold INTEGER DEFAULT 0",
            "ALTER TABLE guilds ADD COLUMN quest_kills INTEGER DEFAULT 0",
            "ALTER TABLE guilds ADD COLUMN quest_target INTEGER DEFAULT 1000",
            "ALTER TABLE guilds ADD COLUMN quest_level INTEGER DEFAULT 1",
            "ALTER TABLE guilds ADD COLUMN has_hall INTEGER DEFAULT 0"
        ];
        for(var gm = 0; gm < guildMigrations.length; gm++) {
            try {
                this.db.exec(guildMigrations[gm]);
            } catch(e) {
                // La colonne existe déjà
            }
        }

        // Création de la table du Marché des joueurs (HDV)
        this.db.exec(
            "CREATE TABLE IF NOT EXISTS market_items (" +
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  seller TEXT," +
            "  item_kind TEXT," +
            "  item_type TEXT," +
            "  price INTEGER," +
            "  created_at INTEGER" +
            ");"
        );

        this.stmtGetPlayer = this.db.prepare("SELECT * FROM players WHERE username = ?");
        this.stmtInsertPlayer = this.db.prepare(
            "INSERT INTO players (username, password, x, y, armor, weapon, hp, inventory, gold, is_admin, is_banned, guild_id, lives) " +
            "VALUES (@username, @password, @x, @y, @armor, @weapon, @hp, @inventory, @gold, @is_admin, @is_banned, @guild_id, @lives)"
        );
        this.stmtUpdatePlayer = this.db.prepare(
            "UPDATE players SET x = @x, y = @y, armor = @armor, weapon = @weapon, hp = @hp, inventory = @inventory, gold = @gold, guild_id = @guild_id, lives = @lives " +
            "WHERE username = @username"
        );
        this.stmtGetAllPlayers = this.db.prepare(
            "SELECT username, armor, weapon, hp, inventory, gold, is_admin, is_banned, guild_id, lives FROM players ORDER BY username COLLATE NOCASE ASC"
        );
        this.stmtDeletePlayer = this.db.prepare("DELETE FROM players WHERE username = ?");
        this.stmtUpdatePlayerAdmin = this.db.prepare(
            "UPDATE players SET gold = @gold, lives = @lives, armor = @armor, weapon = @weapon, is_admin = @is_admin, is_banned = @is_banned, hp = @hp " +
            "WHERE username = @username"
        );
        this.stmtGetPlayerByGoogleUid = this.db.prepare("SELECT * FROM players WHERE google_uid = ?");
        this.stmtUpdatePlayerGoogleAuth = this.db.prepare("UPDATE players SET google_uid = ?, email = ? WHERE username = ?");

        log.info("Base de données SQLite initialisée : " + dbPath);
        if (firebaseService) {
            firebaseService.init();
        }
    },

    _parseInventoryData: function(rawInventory) {
        var defaultData = {
            items: ["flask", null, null, null, null, null],
            counts: [2, 0, 0, 0, 0, 0],
            exp: 0,
            achievementFound: [false, false, false, false, false, false, false, false],
            achievementProgress: [0, 0, 0, 0, 0, 0, 0, 0]
        };
        if(!rawInventory) {
            return defaultData;
        }
        try {
            var parsed = JSON.parse(rawInventory);
            if(Array.isArray(parsed)) {
                defaultData.items = parsed;
                return defaultData;
            }
            return {
                items: Array.isArray(parsed.items) ? parsed.items : defaultData.items,
                counts: Array.isArray(parsed.counts) ? parsed.counts : defaultData.counts,
                exp: typeof parsed.exp === 'number' ? parsed.exp : 0,
                achievementFound: Array.isArray(parsed.achievementFound) ? parsed.achievementFound : defaultData.achievementFound,
                achievementProgress: Array.isArray(parsed.achievementProgress) ? parsed.achievementProgress : defaultData.achievementProgress
            };
        } catch(e) {
            return defaultData;
        }
    },

    _serializePlayerInventory: function(player, existingData) {
        var items = [null, null, null, null, null, null],
            counts = [0, 0, 0, 0, 0, 0];

        for(var i = 0; i < 6; i++) {
            var k = player.inventory ? player.inventory[i] : null;
            if(typeof k === 'number') {
                items[i] = Types.getKindAsString(k);
            } else if(typeof k === 'string') {
                items[i] = k;
            } else {
                items[i] = null;
            }
            counts[i] = (player.inventoryCount && player.inventoryCount[i]) ? player.inventoryCount[i] : 0;
        }

        var achFound = (existingData && existingData.achievementFound) || [false, false, false, false, false, false, false, false],
            achProg = (existingData && existingData.achievementProgress) || [0, 0, 0, 0, 0, 0, 0, 0];

        if(player.achievement) {
            for(var a = 1; a <= 8; a++) {
                if(player.achievement[a]) {
                    achFound[a - 1] = !!player.achievement[a].found;
                    achProg[a - 1] = player.achievement[a].progress || 0;
                }
            }
        }

        return JSON.stringify({
            items: items,
            counts: counts,
            exp: player.experience || 0,
            achievementFound: achFound,
            achievementProgress: achProg
        });
    },

    createPlayer: function(player) {
        var self = this;
        if(!Auth.isValidPassword(player.pw)) {
            this._rejectAuthentication(player, 'invalidlogin');
            return;
        }
        if(this.stmtGetPlayer.get(player.name)) {
            this._rejectAuthentication(player, 'userexists');
            return;
        }
        Auth.hashPassword(player.pw, function(error, encodedPassword) {
            delete player.pw;
            player.isAuthenticating = false;
            if(player.connectionClosed) return;
            if(error) {
                self._rejectAuthentication(player, 'invalidlogin');
                return;
            }
            self._createPlayerWithHash(player, encodedPassword);
        });
    },

    _rejectAuthentication: function(player, reason) {
        delete player.pw;
        player.isAuthenticating = false;
        if(player.connectionClosed) return;
        player.connection.sendUTF8(reason);
        player.connection.close('Authentication failed');
    },

    _isNameLoggedIn: function(player) {
        var world = player.server,
            worlds = world && world.server && Array.isArray(world.server.worlds) ? world.server.worlds : [world];
        return worlds.some(function(candidate) {
            return candidate && typeof candidate.loggedInPlayer === 'function' && candidate.loggedInPlayer(player.name);
        });
    },

    _createPlayerWithHash: function(player, encodedPassword) {
        var existing = this.stmtGetPlayer.get(player.name);
        if(existing) {
            this._rejectAuthentication(player, 'userexists');
            return;
        }

        if(player.x === 0 && player.y === 0) {
            player.updatePosition();
        }

        var initialArmor = "clotharmor",
            initialWeapon = "sword1",
            initialHp = Formulas.hp(Properties.getArmorLevel(Types.getKindFromString(initialArmor))),
            initialGold = 150,
            initialInventory = JSON.stringify({
                items: ["flask", null, null, null, null, null],
                counts: [2, 0, 0, 0, 0, 0],
                exp: 0,
                achievementFound: [false, false, false, false, false, false, false, false],
                achievementProgress: [0, 0, 0, 0, 0, 0, 0, 0]
            });

        try {
            this.stmtInsertPlayer.run({
                username: player.name,
                password: encodedPassword,
                x: player.x,
                y: player.y,
                armor: initialArmor,
                weapon: initialWeapon,
                hp: initialHp,
                inventory: initialInventory,
                gold: initialGold,
                is_admin: 0,
                is_banned: 0,
                guild_id: null,
                lives: 3
            });
        } catch(error) {
            log.error('Unable to create account in SQLite');
            this._rejectAuthentication(player, 'invalidlogin');
            return;
        }

        player.gold = initialGold;
        player.guildId = null;
        player.admin = 0;
        player.lives = 3;

        if(player.googleUid || player.email) {
            try {
                this.stmtUpdatePlayerGoogleAuth.run(player.googleUid || null, player.email || null, player.name);
            } catch(e) {}
        }

        log.info("Nouveau compte créé dans SQLite (game.db) : " + player.name);

        if(firebaseService) {
            firebaseService.savePlayer({
                name: player.name,
                email: player.email || null,
                googleUid: player.googleUid || null,
                gold: initialGold,
                lives: 3,
                level: 1,
                experience: 0,
                armor: initialArmor,
                weapon: initialWeapon,
                isAdmin: false,
                isBanned: false,
                guild: null,
                lastIp: (player.connection && player.connection._connection) ? player.connection._connection.remoteAddress : null
            });
            firebaseService.logTrafficEvent('register', player.name, (player.connection && player.connection._connection) ? player.connection._connection.remoteAddress : '');
        }

        player.sendWelcome(
            initialArmor, initialWeapon, initialArmor, initialWeapon, 0,
            0, 0, 0,
            ["flask", null, null, null, null, null], [2, 0, 0, 0, 0, 0],
            [false, false, false, false, false, false, false, false],
            [0, 0, 0, 0, 0, 0, 0, 0],
            player.x, player.y, 0, initialHp
        );
    },

    loginWithGoogle: function(player, googleInfo) {
        var self = this;
        var existing = null;
        if(googleInfo && googleInfo.uid) {
            try {
                existing = this.stmtGetPlayerByGoogleUid.get(googleInfo.uid);
            } catch(e) {}
        }
        if(!existing && player.name) {
            existing = this.stmtGetPlayer.get(player.name);
        }

        if(existing) {
            if(existing.is_banned === 1) {
                this._rejectAuthentication(player, 'banned');
                return;
            }
            player.name = existing.username;
            if(this._isNameLoggedIn(player)) {
                this._rejectAuthentication(player, 'loggedin');
                return;
            }
            player.email = (googleInfo && googleInfo.email) ? googleInfo.email : existing.email;
            player.googleUid = (googleInfo && googleInfo.uid) ? googleInfo.uid : existing.google_uid;
            player.isAuthenticating = false;
            try {
                self.stmtUpdatePlayerGoogleAuth.run(player.googleUid, player.email, player.name);
            } catch(e) {}
            self._loadVerifiedPlayer(player, existing);
        } else {
            var candidateName = player.name || 'Hero';
            if(this.stmtGetPlayer.get(candidateName)) {
                candidateName = ('Hero' + Math.floor(Math.random() * 8999 + 1000)).substr(0, 12);
                while(this.stmtGetPlayer.get(candidateName)) {
                    candidateName = ('Hero' + Math.floor(Math.random() * 8999 + 1000)).substr(0, 12);
                }
            }
            player.name = candidateName;

            var randomPw = crypto.randomBytes(16).toString('hex');
            Auth.hashPassword(randomPw, function(error, encodedPassword) {
                player.isAuthenticating = false;
                if(player.connectionClosed) return;
                if(error) {
                    self._rejectAuthentication(player, 'invalidlogin');
                    return;
                }
                player.email = (googleInfo && googleInfo.email) ? googleInfo.email : null;
                player.googleUid = (googleInfo && googleInfo.uid) ? googleInfo.uid : null;
                self._createPlayerWithHash(player, encodedPassword);
            });
        }
    },

    loadPlayer: function(player) {
        var self = this;
        var row = this.stmtGetPlayer.get(player.name);
        if(!row) {
            this._rejectAuthentication(player, 'invalidlogin');
            return;
        }
        Auth.verifyPassword(player.pw, row.password, function(error, matches, migratedHash) {
            delete player.pw;
            player.isAuthenticating = false;
            if(player.connectionClosed) return;
            if(error || !matches) {
                self._rejectAuthentication(player, 'invalidlogin');
                return;
            }
            // Authentication yields to the event loop. Re-read bans and session
            // state before admitting the player or updating legacy credentials.
            var current = self.stmtGetPlayer.get(player.name);
            if(!current || current.password !== row.password) {
                self._rejectAuthentication(player, 'invalidlogin');
                return;
            }
            if(current.is_banned === 1) {
                self._rejectAuthentication(player, 'banned');
                return;
            }
            if(self._isNameLoggedIn(player)) {
                self._rejectAuthentication(player, 'loggedin');
                return;
            }
            if(migratedHash) {
                try {
                    self.db.prepare('UPDATE players SET password = ? WHERE username = ? AND password = ?')
                        .run(migratedHash, player.name, row.password);
                } catch(error) {
                    log.error('Unable to migrate account password in SQLite');
                    self._rejectAuthentication(player, 'invalidlogin');
                    return;
                }
            }
            self._loadVerifiedPlayer(player, current);
        });
    },

    _loadVerifiedPlayer: function(player, row) {
        if(row.is_banned === 1) {
            player.connection.sendUTF8("banned");
            player.connection.close("Banned user: " + player.name);
            return;
        }

        var armor = row.armor || "clotharmor",
            weapon = row.weapon || "sword1",
            x = row.x || 0,
            y = row.y || 0,
            savedHp = row.hp || 0,
            gold = (typeof row.gold === 'number') ? row.gold : 150,
            isAdmin = (row.is_admin === 1) ? 1 : 0,
            guildId = row.guild_id || null,
            lives = (typeof row.lives === 'number' && row.lives > 0) ? row.lives : 3,
            invData = this._parseInventoryData(row.inventory);

        player.gold = gold;
        player.guildId = guildId;
        player.admin = isAdmin;
        player.lives = lives;

        log.info("Joueur chargé depuis SQLite (game.db) : " + player.name + " (Pos: " + x + "," + y + " | Or: " + gold + " | Vies: " + lives + " | Admin: " + isAdmin + ")");

        if(firebaseService) {
            firebaseService.getPlayer(player.name).then(function(fsPlayer) {
                if(fsPlayer) {
                    if(fsPlayer.isBanned) {
                        try { self.db.prepare('UPDATE players SET is_banned = 1 WHERE username = ?').run(player.name); } catch(e) {}
                        player.connection.sendUTF8("banned");
                        player.connection.close("Banned user via Firebase: " + player.name);
                        return;
                    }
                    if(fsPlayer.isAdmin && !player.admin) {
                        player.admin = 1;
                        try { self.db.prepare('UPDATE players SET is_admin = 1 WHERE username = ?').run(player.name); } catch(e) {}
                        log.info("Rôle Administrateur synchronisé depuis Firestore pour : " + player.name);
                    }
                    if(typeof fsPlayer.gold === 'number' && fsPlayer.gold !== player.gold) {
                        player.gold = fsPlayer.gold;
                        try { self.db.prepare('UPDATE players SET gold = ? WHERE username = ?').run(player.gold, player.name); } catch(e) {}
                    }
                }
            }).catch(function() {});

            firebaseService.savePlayer({
                name: player.name,
                email: player.email || null,
                googleUid: player.googleUid || null,
                gold: gold,
                lives: lives,
                level: (invData && invData.exp) ? Types.getLevel(invData.exp) : 1,
                experience: (invData && invData.exp) || 0,
                armor: armor,
                weapon: weapon,
                isAdmin: isAdmin === 1,
                isBanned: false,
                guild: null,
                lastIp: (player.connection && player.connection._connection) ? player.connection._connection.remoteAddress : null
            });

            firebaseService.logTrafficEvent('login', player.name, (player.connection && player.connection._connection) ? player.connection._connection.remoteAddress : '');
        }

        player.sendWelcome(
            armor, weapon,
            armor, weapon, invData.exp, isAdmin,
            0, 0,
            invData.items, invData.counts,
            invData.achievementFound, invData.achievementProgress,
            x, y, 0, savedHp
        );
    },

    savePlayer: function(player) {
        if(!player || !player.name || !player.hasEnteredGame) {
            return;
        }
        var row = this.stmtGetPlayer.get(player.name);
        if(!row) {
            return;
        }

        var armorName = (typeof player.armor === 'number') ? Types.getKindAsString(player.armor) : (player.armor || row.armor || "clotharmor"),
            weaponName = (typeof player.weapon === 'number') ? Types.getKindAsString(player.weapon) : (player.weapon || row.weapon || "sword1"),
            maxHp = player.maxHitPoints || Formulas.hp(Properties.getArmorLevel(Types.getKindFromString(armorName))),
            currentHp = (player.hitPoints && player.hitPoints > 0) ? player.hitPoints : maxHp,
            currentGold = (typeof player.gold === 'number') ? player.gold : (row.gold || 0),
            currentGuildId = (typeof player.guildId !== 'undefined') ? player.guildId : row.guild_id,
            currentLives = (typeof player.lives === 'number' && player.lives > 0) ? player.lives : (row.lives || 3),
            existingInv = this._parseInventoryData(row.inventory),
            inventoryJson = this._serializePlayerInventory(player, existingInv);

        this.stmtUpdatePlayer.run({
            username: player.name,
            x: player.x || row.x || 0,
            y: player.y || row.y || 0,
            armor: armorName,
            weapon: weaponName,
            hp: currentHp,
            inventory: inventoryJson,
            gold: currentGold,
            guild_id: currentGuildId,
            lives: currentLives
        });

        log.debug("Progression sauvegardée dans game.db pour " + player.name);

        if(firebaseService) {
            firebaseService.savePlayer({
                name: player.name,
                email: player.email || null,
                googleUid: player.googleUid || null,
                gold: currentGold,
                lives: currentLives,
                level: player.level || 1,
                experience: player.experience || 0,
                armor: armorName,
                weapon: weaponName,
                isAdmin: player.admin === 1,
                isBanned: (row && row.is_banned === 1),
                guild: player.guild ? player.guild.name : null,
                lastIp: (player.connection && player.connection._connection) ? player.connection._connection.remoteAddress : null
            });
        }
    },

    checkBan: function(player) {
        var row = this.stmtGetPlayer.get(player.name);
        if(row && row.is_banned === 1) {
            player.connection.sendUTF8("banned");
            player.connection.close("User is banned: " + player.name);
        }
    },

    setPlayerBanned: function(username, banned) {
        this.db.prepare("UPDATE players SET is_banned = ? WHERE username = ?").run(banned ? 1 : 0, username);
    },

    setPlayerAdmin: function(username, isAdmin) {
        this.db.prepare("UPDATE players SET is_admin = ? WHERE username = ?").run(isAdmin ? 1 : 0, username);
    },

    addGoldToUsername: function(username, amount) {
        var row = this.stmtGetPlayer.get(username);
        if(row) {
            var newGold = (row.gold || 0) + amount;
            if(!Number.isSafeInteger(amount) || !Number.isSafeInteger(newGold) || newGold < 0) {
                throw new Error('Invalid gold transfer');
            }
            this.db.prepare("UPDATE players SET gold = ? WHERE username = ?").run(newGold, username);
            return newGold;
        }
        return null;
    },

    // ======= MARCHÉ DES JOUEURS (HDV) =======
    getMarketItems: function() {
        return this.db.prepare("SELECT * FROM market_items ORDER BY id DESC LIMIT 50").all();
    },

    getMarketItemById: function(id) {
        return this.db.prepare("SELECT * FROM market_items WHERE id = ?").get(id);
    },

    addMarketItem: function(seller, itemKind, itemType, price) {
        var info = this.db.prepare(
            "INSERT INTO market_items (seller, item_kind, item_type, price, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(seller, itemKind, itemType, price, Date.now());
        return info.lastInsertRowid;
    },

    removeMarketItem: function(id) {
        this.db.prepare("DELETE FROM market_items WHERE id = ?").run(id);
    },

    // ======= SYSTÈME DE GUILDE (SQLite) =======
    getGuildById: function(id) {
        if(!id) return null;
        var row = this.db.prepare("SELECT * FROM guilds WHERE id = ?").get(id);
        if(!row) return null;
        var members = [];
        try {
            members = JSON.parse(row.members || "[]");
        } catch(e) {
            members = [row.leader];
        }
        return {
            id: row.id,
            tag: row.tag,
            name: row.name,
            leader: row.leader,
            members: members,
            bank_gold: row.bank_gold || 0,
            quest_kills: row.quest_kills || 0,
            quest_target: row.quest_target || 1000,
            quest_level: row.quest_level || 1,
            has_hall: (row.has_hall === 1) ? 1 : 0
        };
    },

    depositGuildGold: function(guildId, amount) {
        var guild = this.getGuildById(guildId);
        if(!guild) return null;
        var newBank = (guild.bank_gold || 0) + amount;
        if(!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(newBank)) {
            throw new Error('Invalid guild deposit');
        }
        this.db.prepare("UPDATE guilds SET bank_gold = ? WHERE id = ?").run(newBank, guildId);
        guild.bank_gold = newBank;
        return guild;
    },

    spendGuildBankGold: function(guildId, amount) {
        if(!Number.isSafeInteger(amount) || amount <= 0) return false;
        var guild = this.getGuildById(guildId);
        if(!guild || (guild.bank_gold || 0) < amount) return false;
        var newBank = guild.bank_gold - amount;
        this.db.prepare("UPDATE guilds SET bank_gold = ? WHERE id = ?").run(newBank, guildId);
        return true;
    },

    unlockGuildHall: function(guildId) {
        this.db.prepare("UPDATE guilds SET has_hall = 1 WHERE id = ?").run(guildId);
        return this.getGuildById(guildId);
    },

    addGuildQuestProgress: function(guildId, kills) {
        var guild = this.getGuildById(guildId);
        if(!guild) return null;
        var newKills = (guild.quest_kills || 0) + (kills || 1);
        var target = guild.quest_target || 1000;
        var level = guild.quest_level || 1;
        var bankGold = guild.bank_gold || 0;
        var completed = false;
        var rewardGold = 0;

        if(newKills >= target) {
            completed = true;
            rewardGold = 15000 * level;
            bankGold += rewardGold;
            newKills = newKills - target;
            level += 1;
            target = 1000;
        }

        this.db.prepare(
            "UPDATE guilds SET quest_kills = ?, quest_target = ?, quest_level = ?, bank_gold = ? WHERE id = ?"
        ).run(newKills, target, level, bankGold, guildId);

        return {
            guild: this.getGuildById(guildId),
            completed: completed,
            rewardGold: rewardGold
        };
    },

    getGuildByNameOrTag: function(tag, name) {
        return this.db.prepare("SELECT * FROM guilds WHERE LOWER(tag) = LOWER(?) OR LOWER(name) = LOWER(?)").get(tag, name);
    },

    createGuild: function(tag, name, leader) {
        var membersJson = JSON.stringify([leader]);
        var info = this.db.prepare(
            "INSERT INTO guilds (tag, name, leader, members) VALUES (?, ?, ?, ?)"
        ).run(tag, name, leader, membersJson);
        var guildId = Number(info.lastInsertRowid);
        this.db.prepare("UPDATE players SET guild_id = ? WHERE username = ?").run(guildId, leader);
        return this.getGuildById(guildId);
    },

    addGuildMember: function(guildId, username) {
        var guild = this.getGuildById(guildId);
        if(!guild) return null;
        if(guild.members.indexOf(username) === -1) {
            guild.members.push(username);
        }
        this.db.prepare("UPDATE guilds SET members = ? WHERE id = ?").run(JSON.stringify(guild.members), guildId);
        this.db.prepare("UPDATE players SET guild_id = ? WHERE username = ?").run(guildId, username);
        return guild;
    },

    removeGuildMember: function(guildId, username) {
        var guild = this.getGuildById(guildId);
        if(!guild) return null;
        guild.members = guild.members.filter(function(m) { return m !== username; });
        this.db.prepare("UPDATE players SET guild_id = NULL WHERE username = ?").run(username);

        if(guild.members.length === 0) {
            this.db.prepare("DELETE FROM guilds WHERE id = ?").run(guildId);
            return null;
        }
        if(guild.leader === username) {
            guild.leader = guild.members[0];
        }
        this.db.prepare("UPDATE guilds SET leader = ?, members = ? WHERE id = ?").run(guild.leader, JSON.stringify(guild.members), guildId);
        return guild;
    },

    equipArmor: function(name, armor) {
        var row = this.stmtGetPlayer.get(name);
        if(row) {
            this.db.prepare("UPDATE players SET armor = ? WHERE username = ?").run(armor, name);
        }
    },

    equipAvatar: function(name, armor) {
        // Conservé pour compatibilité avec player.js
    },

    equipWeapon: function(name, weapon) {
        var row = this.stmtGetPlayer.get(name);
        if(row) {
            this.db.prepare("UPDATE players SET weapon = ? WHERE username = ?").run(weapon, name);
        }
    },

    setExp: function(name, exp) {
        var row = this.stmtGetPlayer.get(name);
        if(row) {
            var invData = this._parseInventoryData(row.inventory);
            invData.exp = exp;
            this.db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(invData), name);
        }
    },

    setInventory: function(name, itemKind, inventoryNumber, itemNumber) {
        var row = this.stmtGetPlayer.get(name);
        if(row && inventoryNumber >= 0 && inventoryNumber < 6) {
            var invData = this._parseInventoryData(row.inventory);
            invData.items[inventoryNumber] = itemKind ? Types.getKindAsString(itemKind) : null;
            invData.counts[inventoryNumber] = itemKind ? (itemNumber || 1) : 0;
            this.db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(invData), name);
        }
    },

    makeEmptyInventory: function(name, number) {
        var row = this.stmtGetPlayer.get(name);
        if(row && number >= 0 && number < 6) {
            var invData = this._parseInventoryData(row.inventory);
            invData.items[number] = null;
            invData.counts[number] = 0;
            this.db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(invData), name);
        }
    },

    foundAchievement: function(name, number) {
        var row = this.stmtGetPlayer.get(name);
        if(row && number >= 1 && number <= 8) {
            var invData = this._parseInventoryData(row.inventory);
            invData.achievementFound[number - 1] = true;
            this.db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(invData), name);
        }
    },

    progressAchievement: function(name, number, progress) {
        var row = this.stmtGetPlayer.get(name);
        if(row && number >= 1 && number <= 8) {
            var invData = this._parseInventoryData(row.inventory);
            invData.achievementProgress[number - 1] = progress;
            this.db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(invData), name);
        }
    },

    setCheckpoint: function(name, x, y) {
        var row = this.stmtGetPlayer.get(name);
        if(row) {
            this.db.prepare("UPDATE players SET x = ?, y = ? WHERE username = ?").run(x, y, name);
        }
    },

    getAllPlayers: function() {
        return this.stmtGetAllPlayers.all();
    },

    deletePlayerAdmin: function(username) {
        var res = this.stmtDeletePlayer.run(username);
        if(firebaseService && typeof firebaseService.deletePlayer === 'function') {
            try {
                firebaseService.deletePlayer(username);
            } catch(e) {}
        }
        return res;
    },

    updatePlayerAdmin: function(data) {
        var existing = this.stmtGetPlayer.get(data.username);
        if(!existing) return false;

        var gold = typeof data.gold === 'number' ? data.gold : parseInt(data.gold, 10) || 0;
        var lives = typeof data.lives === 'number' ? data.lives : parseInt(data.lives, 10) || 3;
        var isAdmin = (data.is_admin === 1 || data.is_admin === true || data.is_admin === '1') ? 1 : 0;
        var isBanned = (data.is_banned === 1 || data.is_banned === true || data.is_banned === '1') ? 1 : 0;
        var armor = data.armor || existing.armor;
        var weapon = data.weapon || existing.weapon;
        var hp = typeof data.hp === 'number' ? data.hp : (existing.hp || 100);

        this.stmtUpdatePlayerAdmin.run({
            username: data.username,
            gold: gold,
            lives: lives,
            armor: armor,
            weapon: weapon,
            is_admin: isAdmin,
            is_banned: isBanned,
            hp: hp
        });

        if(firebaseService && typeof firebaseService.savePlayer === 'function') {
            try {
                firebaseService.savePlayer({
                    name: data.username,
                    gold: gold,
                    lives: lives,
                    armor: armor,
                    weapon: weapon,
                    isAdmin: isAdmin === 1,
                    isBanned: isBanned === 1
                });
            } catch(e) {}
        }

        return true;
    }
});
