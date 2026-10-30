
var cls = require("./lib/class"),
    _ = require("underscore"),
    Log = require('log'),
    Entity = require('./entity'),
    Character = require('./character'),
    Mob = require('./mob'),
    Map = require('./map'),
    Npc = require('./npc'),
    Player = require('./player'),
    Guild = require('./guild'),
    Item = require('./item'),
    MobArea = require('./mobarea'),
    ChestArea = require('./chestarea'),
    Chest = require('./chest'),
    Messages = require('./message'),
    Properties = require("./properties"),
    Utils = require("./utils"),
    Types = require("../../shared/js/gametypes");

// ======= GAME SERVER ========

module.exports = World = cls.Class.extend({
    init: function(id, maxPlayers, websocketServer, databaseHandler) {
        var self = this;

        this.id = id;
        this.maxPlayers = maxPlayers;
        this.server = websocketServer;
        this.ups = 50;
        this.databaseHandler = databaseHandler;

        this.map = null;

        this.entities = {};
        this.players = {};
        this.guilds = {};
        this.mobs = {};
        this.attackers = {};
        this.items = {};
        this.equipping = {};
        this.hurt = {};
        this.npcs = {};
        this.mobAreas = [];
        this.chestAreas = [];
        this.groups = {};

        this.outgoingQueues = {};

        this.itemCount = 0;
        this.playerCount = 0;

        this.zoneGroupsReady = false;

        this.onPlayerConnect(function(player) {
            player.onRequestPosition(function() {
                if(player.lastCheckpoint) {
                    return player.lastCheckpoint.getRandomPosition();
                } else {
                    return self.map.getRandomStartingPosition();
                }
            });
        });

        this.onPlayerEnter(function(player) {
            log.info(player.name + "(" + player.connection._connection.remoteAddress + ") has joined " + self.id + " in guild " + player.guildId);

            if(!player.hasEnteredGame) {
                self.incrementPlayerCount();
            }

            // Number of players in this world
            self.pushToPlayer(player, new Messages.Population(self.playerCount));
            if(player.hasGuild() && player.getGuild()){
				self.pushToGuild(player.getGuild(), new Messages.Guild(Types.Messages.GUILDACTION.CONNECT, player.name),player);
				var names = _.without(player.getGuild().memberNames(), player.name);
				if(names.length > 0){
					self.pushToPlayer(player, new Messages.Guild(Types.Messages.GUILDACTION.ONLINE, names));
				}
			}
            self.pushRelevantEntityListTo(player);

            var move_callback = function(x, y) {
                log.debug(player.name + " is moving to (" + x + ", " + y + ").");
                 var isPVP = self.map.isPVP(x, y);
                player.flagPVP(isPVP); 
               player.forEachAttacker(function(mob) {
                     if(mob.target === null){
                        player.removeAttacker(mob);
                        return;
                    }
                   var target = self.getEntityById(mob.target);
                    if(target) {
                        var atkRange = Types.getMobAttackRange ? Types.getMobAttackRange(mob.kind) : 1;
                        var distToTarget = Utils.distanceTo(mob.x, mob.y, target.x, target.y);
                        if(atkRange > 1 && distToTarget <= atkRange) {
                            return; // Le monstre à distance est déjà à portée de tir !
                        }
                        var pos = self.findPositionNextTo(mob, target);
                        if(mob.distanceToSpawningPoint(pos.x, pos.y) > 50) {
                            mob.clearTarget();
                            mob.forgetEveryone();
                            player.removeAttacker(mob);
                        } else {
                            self.moveEntity(mob, pos.x, pos.y);
                        }
                    }
                });
            };

            player.onMove(move_callback);
            player.onLootMove(move_callback);

            player.onZone(function() {
                var hasChangedGroups = self.handleEntityGroupMembership(player);

                if(hasChangedGroups) {
                    self.pushToPreviousGroups(player, new Messages.Destroy(player));
                    self.pushRelevantEntityListTo(player);
                }
            });

            player.onBroadcast(function(message, ignoreSelf) {
                self.pushToAdjacentGroups(player.group, message, ignoreSelf ? player.id : null, player.instanceId || null);
            });

            player.onBroadcastToZone(function(message, ignoreSelf) {
                self.pushToGroup(player.group, message, ignoreSelf ? player.id : null, player.instanceId || null);
            });

            player.onExit(function() {
                log.info(player.name + " has left the game.");
                if(player.hasGuild() && player.getGuild()){
					self.pushToGuild(player.getGuild(), new Messages.Guild(Types.Messages.GUILDACTION.DISCONNECT, player.name), player);
				}
                self.removePlayer(player);
                self.decrementPlayerCount();

                if(self.removed_callback) {
                    self.removed_callback();
                }
            });

            if(self.added_callback) {
                self.added_callback();
            }
        });

        // Called when an entity is attacked by another entity
        this.onEntityAttack(function(attacker) {
            var target = self.getEntityById(attacker.target);
            if(target && attacker.type === "mob") {
                var atkRange = Types.getMobAttackRange ? Types.getMobAttackRange(attacker.kind) : 1;
                var distToTarget = Utils.distanceTo(attacker.x, attacker.y, target.x, target.y);
                if(atkRange > 1 && distToTarget <= atkRange) {
                    return; // Déjà à portée d'attaque magique/distance
                }
                var pos = self.findPositionNextTo(attacker, target);
                self.moveEntity(attacker, pos.x, pos.y);
            }
        });

        this.onRegenTick(function() {
            self.forEachCharacter(function(character) {
                if(!character.hasFullHealth()) {
                    var isRestingIndoors = (character.type === 'player' &&
                                            self.isPlayerInHouseInterior(character) &&
                                            _.size(character.attackers) === 0);
                    var healAmount = isRestingIndoors
                        ? Math.max(4, Math.floor(character.maxHitPoints / 12))
                        : Math.max(1, Math.floor(character.maxHitPoints / 25));

                    character.regenHealthBy(healAmount);

                    if(character.type === 'player') {
                        self.pushToPlayer(character, character.regen());
                        if(isRestingIndoors) {
                            self.pushToPlayer(character, new Messages.Hub("house_rest_heal", {
                                amount: healAmount,
                                hp: character.hitPoints,
                                maxHp: character.maxHitPoints
                            }));
                        }
                    }
                }
            });
        });
    },

    isPlayerInHouseInterior: function(player) {
        if(!player || player.isDead) return false;
        var gx = Number(player.x),
            gy = Number(player.y);
        if(isNaN(gx) || isNaN(gy)) return false;
        if(gx >= 145 && gx <= 168 && gy >= 270 && gy <= 292) {
            return false;
        }
        if(gx >= 115 && gy >= 60) {
            return true;
        }
        if(gy >= 265) {
            return true;
        }
        return false;
    },

    run: function(mapFilePath) {
        var self = this;

        this.map = new Map(mapFilePath);

        this.map.ready(function() {
            self.initZoneGroups();

            self.map.generateCollisionGrid();

            // Populate all mob "roaming" areas
            _.each(self.map.mobAreas, function(a) {
                var area = new MobArea(a.id, a.nb, a.type, a.x, a.y, a.width, a.height, self);
                area.spawnMobs();
                area.onEmpty(self.handleEmptyMobArea.bind(self, area));

                self.mobAreas.push(area);
            });

            // Create all chest areas
            _.each(self.map.chestAreas, function(a) {
                var area = new ChestArea(a.id, a.x, a.y, a.w, a.h, a.tx, a.ty, a.i, self);
                self.chestAreas.push(area);
                area.onEmpty(self.handleEmptyChestArea.bind(self, area));
            });

            // Spawn static chests
            _.each(self.map.staticChests, function(chest) {
                var c = self.createChest(chest.x, chest.y, chest.i);
                self.addStaticItem(c);
            });

            // Spawn static entities
            self.spawnStaticEntities();

            // Spawn the 10 World & Dungeon Bosses
            self.spawnWorldBosses();

            // Set maximum number of entities contained in each chest area
            _.each(self.chestAreas, function(area) {
                area.setNumberOfEntities(area.entities.length);
            });
        });

        var regenCount = this.ups * 2;
        var updateCount = 0;
        setInterval(function() {
            self.processGroups();
            self.processQueues();

            if(updateCount < regenCount) {
                updateCount += 1;
            } else {
                if(self.regen_callback) {
                    self.regen_callback();
                }
                updateCount = 0;
            }
        }, 1000 / this.ups);

        log.info(""+this.id+" created (capacity: "+this.maxPlayers+" players).");
    },

    setUpdatesPerSecond: function(ups) {
        this.ups = ups;
    },

    onInit: function(callback) {
        this.init_callback = callback;
    },

    onPlayerConnect: function(callback) {
        this.connect_callback = callback;
    },

    onPlayerEnter: function(callback) {
        this.enter_callback = callback;
    },

    onPlayerAdded: function(callback) {
        this.added_callback = callback;
    },

    onPlayerRemoved: function(callback) {
        this.removed_callback = callback;
    },

    onRegenTick: function(callback) {
        this.regen_callback = callback;
    },

    pushRelevantEntityListTo: function(player) {
        var self = this,
            entities;

        if(player && (player.group in this.groups)) {
            entities = _.keys(this.groups[player.group].entities);
            entities = _.reject(entities, function(id) {
                if(id == player.id) return true;
                var ent = self.getEntityById(id);
                if(ent && (ent.instanceId || null) !== (player.instanceId || null)) {
                    return true;
                }
                return false;
            });
            entities = _.map(entities, function(id) { return parseInt(id, 10); });
            if(entities) {
                this.pushToPlayer(player, new Messages.List(entities));
            }
        }
    },

    pushSpawnsToPlayer: function(player, ids) {
        var self = this;

        _.each(ids, function(id) {
            var entity = self.getEntityById(id);
            if(entity && (entity.instanceId || null) === (player.instanceId || null)) {
                self.pushToPlayer(player, new Messages.Spawn(entity));
            }
        });

        log.debug("Pushed "+_.size(ids)+" new spawns to "+player.id);
    },

    pushToPlayer: function(player, message) {
        if(player && player.id in this.outgoingQueues) {
            this.outgoingQueues[player.id].push(message.serialize());
        } else {
            log.error("pushToPlayer: player was undefined");
        }
    },
    
    pushToGuild: function(guild, message, except) {
		var	self = this;

		if(guild){
			if(typeof except === "undefined"){
				guild.forEachMember(function (player, id){
					self.pushToPlayer(self.getEntityById(id), message);
				});
			}
			else{
				guild.forEachMember(function (player, id){
					if(parseInt(id,10)!==except.id){
						self.pushToPlayer(self.getEntityById(id), message);
					}
				});
			}
		} else {
			log.error("pushToGuild: guild was undefined");
		}
	},

    pushToGroup: function(groupId, message, ignoredPlayer, requiredInstanceId) {
        var self = this,
            group = this.groups[groupId];

        if(group) {
            _.each(group.players, function(playerId) {
                if(playerId != ignoredPlayer) {
                    var p = self.getEntityById(playerId);
                    if(p) {
                        if(typeof requiredInstanceId !== 'undefined' && (p.instanceId || null) !== (requiredInstanceId || null)) {
                            return;
                        }
                        self.pushToPlayer(p, message);
                    }
                }
            });
        } else {
            log.error("groupId: "+groupId+" is not a valid group");
        }
    },

    pushToAdjacentGroups: function(groupId, message, ignoredPlayer, requiredInstanceId) {
        var self = this;
        self.map.forEachAdjacentGroup(groupId, function(id) {
            self.pushToGroup(id, message, ignoredPlayer, requiredInstanceId);
        });
    },

    pushToPreviousGroups: function(player, message) {
        var self = this;

        // Push this message to all groups which are not going to be updated anymore,
        // since the player left them.
        _.each(player.recentlyLeftGroups, function(id) {
            self.pushToGroup(id, message);
        });
        player.recentlyLeftGroups = [];
    },

    pushBroadcast: function(message, ignoredPlayer) {
        for(var id in this.outgoingQueues) {
            if(id != ignoredPlayer) {
                this.outgoingQueues[id].push(message.serialize());
            }
        }
    },

    processQueues: function() {
        var self = this,
            connection;

        for(var id in this.outgoingQueues) {
            if(this.outgoingQueues[id].length > 0) {
                connection = this.server.getConnection(id);
                connection.send(this.outgoingQueues[id]);
                this.outgoingQueues[id] = [];
            }
        }
    },

    addEntity: function(entity) {
        this.entities[entity.id] = entity;
        this.handleEntityGroupMembership(entity);
    },

    removeEntity: function(entity) {
        if(entity.id in this.entities) {
            delete this.entities[entity.id];
        }
        if(entity.id in this.mobs) {
            delete this.mobs[entity.id];
        }
        if(entity.id in this.items) {
            delete this.items[entity.id];
        }

        if(entity.type === "mob") {
            this.clearMobAggroLink(entity);
            this.clearMobHateLinks(entity);
        }

        entity.destroy();
        this.removeFromGroups(entity);
        log.debug("Removed "+ Types.getKindAsString(entity.kind) +" : "+ entity.id);
    },

	joinGuild: function(player, guildId, answer){
		if( typeof this.guilds[guildId] === 'undefined' ){
			this.pushToPlayer(player, new Messages.GuildError(Types.Messages.GUILDERRORTYPE.DOESNOTEXIST,guildId));
		}
		//#guildupdate (guildrules)
		else {
			if(player.hasGuild()){
				var formerGuildId = player.guildId;
			}
			var res=this.guilds[guildId].addMember(player, answer);
			if(res!==false && typeof formerGuildId !== "undefined"){
				this.guilds[formerGuildId].removeMember(player);
			}
			return res;
		}
		return false;
	},
	
	reloadGuild: function(guildId, guildName){
			var res = false;
			var lastItem = 0;
			if(typeof this.guilds[guildId] !== "undefined"){
				if(this.guilds[guildId].name === guildName){
					res = guildId;
				}
			}
			if(res===false){
				_.every(this.guilds, function(guild, key){
					if(guild.name === guildName){
						res = parseInt(key,10);
						return false;
					}
					else{
						lastItem = key;
						return true;
					}
				});
			}

			if(res===false){//first connected after reboot.
				if(typeof this.guilds[guildId] !== "undefined"){
					guildId = parseInt(lastItem,10)+1;
				}
				this.guilds[guildId] = new Guild(guildId, guildName, this);
				res = guildId;
			}
		return res;
	},
	
	addGuild: function(guildName){
		var res = true;
		var id=0;//an ID here
		res = _.every(this.guilds,function(guild, key){
			id = parseInt(key,10)+1;
			return (guild.name !== guildName);
		});
		if (res) { 
			this.guilds[id] = new Guild(id, guildName, this);
			res = id;
		}
		return res;
	},

    addPlayer: function(player, guildId) {
        this.addEntity(player);
        this.players[player.id] = player;
        this.outgoingQueues[player.id] = [];
        var res = true;
        if(typeof guildId !== 'undefined'){
			res = this.joinGuild(player, guildId);
		}
		return res;
    },

    removePlayer: function(player) {
        player.broadcast(player.despawn());
        this.removeEntity(player);
        if(player.hasGuild() && player.getGuild()){
			player.getGuild().removeMember(player);
		}
        delete this.players[player.id];
        delete this.outgoingQueues[player.id];
    },
    loggedInPlayer: function(name){
        for(var id in this.players) {
            if(this.players[id].name === name){
                if(!this.players[id].isDead)
                    return true;
            }
        }
        return false;
    },

    addMob: function(mob) {
        this.addEntity(mob);
        this.mobs[mob.id] = mob;
    },

    addNpc: function(kind, x, y) {
        var npc = new Npc('8'+x+''+y, kind, x, y);
        this.addEntity(npc);
        this.npcs[npc.id] = npc;
        return npc;
    },

    addItem: function(item) {
        this.addEntity(item);
        this.items[item.id] = item;

        return item;
    },

    createItem: function(kind, x, y) {
        var id = '9'+this.itemCount++,
            item = null;

        if(kind === Types.Entities.CHEST) {
            item = new Chest(id, x, y);
        } else {
            item = new Item(id, kind, x, y);
        }
        return item;
    },

    createChest: function(x, y, items) {
        var chest = this.createItem(Types.Entities.CHEST, x, y);
        chest.setItems(items);
        return chest;
    },

    addStaticItem: function(item) {
        item.isStatic = true;
        item.onRespawn(this.addStaticItem.bind(this, item));

        return this.addItem(item);
    },

    addItemFromChest: function(kind, x, y) {
        var item = this.createItem(kind, x, y);
        item.isFromChest = true;

        return this.addItem(item);
    },

    /**
     * The mob will no longer be registered as an attacker of its current target.
     */
    clearMobAggroLink: function(mob) {
        var player = null;
        if(mob.target) {
            player = this.getEntityById(mob.target);
            if(player) {
                player.removeAttacker(mob);
            }
        }
    },

    clearMobHateLinks: function(mob) {
        var self = this;
        if(mob) {
            _.each(mob.hatelist, function(obj) {
                var player = self.getEntityById(obj.id);
                if(player) {
                    player.removeHater(mob);
                }
            });
        }
    },

    forEachEntity: function(callback) {
        for(var id in this.entities) {
            callback(this.entities[id]);
        }
    },

    forEachPlayer: function(callback) {
        for(var id in this.players) {
            callback(this.players[id]);
        }
    },

    forEachMob: function(callback) {
        for(var id in this.mobs) {
            callback(this.mobs[id]);
        }
    },

    forEachCharacter: function(callback) {
        this.forEachPlayer(callback);
        this.forEachMob(callback);
    },

    handleMobHate: function(mobId, playerId, hatePoints) {
        var mob = this.getEntityById(mobId),
            player = this.getEntityById(playerId),
            mostHated;

        if(player && mob) {
            if((mob.instanceId || null) !== (player.instanceId || null)) {
                return;
            }
            mob.increaseHateFor(playerId, hatePoints);
            player.addHater(mob);

            if(mob.hitPoints > 0) { // only choose a target if still alive
                this.chooseMobTarget(mob);
            }
        }
    },

    chooseMobTarget: function(mob, hateRank) {
        var player = this.getEntityById(mob.getHatedPlayerId(hateRank));

        // If the mob is not already attacking the player, create an attack link between them.
        if(player && !(mob.id in player.attackers) && (mob.instanceId || null) === (player.instanceId || null)) {
            this.clearMobAggroLink(mob);

            player.addAttacker(mob);
            mob.setTarget(player);

            this.broadcastAttacker(mob);
            log.debug(mob.id + " is now attacking " + player.id);
        }
    },

    onEntityAttack: function(callback) {
        this.attack_callback = callback;
    },

    getEntityById: function(id) {
        if(id in this.entities) {
            return this.entities[id];
        } else {
            log.error("Unknown entity : " + id);
        }
    },

    getPlayerCount: function() {
        var count = 0;
        for(var p in this.players) {
            if(this.players.hasOwnProperty(p)) {
                count += 1;
            }
        }
        return count;
    },

    broadcastAttacker: function(character) {
        if(character) {
            this.pushToAdjacentGroups(character.group, character.attack(), character.id, character.instanceId || null);
        }
        if(this.attack_callback) {
            this.attack_callback(character);
        }
    },

    handleHurtEntity: function(entity, attacker, damage) {
        var self = this;

        if(entity.type === 'player') {
            // A player is only aware of his own hitpoints
            this.pushToPlayer(entity, entity.health());
        }

        if(entity.type === 'mob') {
            // Let the mob's attacker (player) know how much damage was inflicted
            this.pushToPlayer(attacker, new Messages.Damage(entity, damage, entity.hitPoints, entity.maxHitPoints));
        }

        // If the entity is about to die
        if(entity.hitPoints <= 0) {
            if(entity.type === "mob") {
                var mob = entity,
                    item = null;
                var mainTanker = this.getEntityById(mob.getMainTankerId());
                var killer = (mainTanker && mainTanker instanceof Player) ? mainTanker : attacker;
                var goldReward = Math.max(5, Math.floor(Types.getMobExp(mob.kind) / 2));

                if(killer && killer instanceof Player){
                    killer.incExp(Types.getMobExp(mob.kind));
                    killer.gold = (killer.gold || 0) + goldReward;
                    if(this.databaseHandler && this.databaseHandler.savePlayer) {
                        this.databaseHandler.savePlayer(killer);
                    }
                    this.pushToPlayer(killer, new Messages.Kill(mob, killer.level, killer.experience));
                    this.pushToPlayer(killer, new Messages.Hub("gold_update", { gold: killer.gold, reward: goldReward }));

                    // Progression des Quêtes PNJ de Chasse
                    if(typeof killer.onMobKilledForNpcQuest === 'function') {
                        killer.onMobKilledForNpcQuest(mob);
                    }

                    // Progression des Quêtes Collectives de Guilde (Guildes 3.0)
                    if(killer.guildId && this.databaseHandler && this.databaseHandler.addGuildQuestProgress) {
                        var killsCount = Types.isBoss(mob.kind) ? 25 : 1;
                        var qRes = this.databaseHandler.addGuildQuestProgress(killer.guildId, killsCount);
                        if(qRes && qRes.completed && qRes.guild) {
                            _.each(qRes.guild.members, function(mName) {
                                var mp = self.getPlayerByName(mName);
                                if(mp) {
                                    mp.sendHubState("🏆 Quête de Guilde accomplie ! +" + qRes.rewardGold + " Or versés dans la Banque de Guilde !", false);
                                }
                            });
                        }
                    }
                }

                this.pushToAdjacentGroups(mob.group, mob.despawn(), null, mob.instanceId || null);

                // Si c'est un Boss de Guilde instancié : chaque participant / membre présent dans le Salon reçoit du butin directement dans son inventaire !
                if(mob.isGuildBoss && mob.guildId) {
                    var guildRewardsPool = [
                        Types.Entities.GOLDENSWORD,
                        Types.Entities.GOLDENARMOR,
                        Types.Entities.REDSWORD,
                        Types.Entities.REDARMOR,
                        Types.Entities.BLUESWORD,
                        Types.Entities.PLATEARMOR
                    ];
                    var participantIds = _.map(mob.hatelist || [], function(h) { return Number(h.id); });
                    self.forEachPlayer(function(p) {
                        if(p && p.guildId === mob.guildId && (p.instanceId === mob.instanceId || _.include(participantIds, Number(p.id)))) {
                            var bonusGold = 1500;
                            var rewardKind = guildRewardsPool[Utils.random(guildRewardsPool.length)];
                            var rewardName = Types.getFrenchItemName(rewardKind);
                            var rarityLabel = Types.getItemRarityLabel(rewardKind);
                            p.gold = (p.gold || 0) + bonusGold;
                            p.addToInventory(rewardKind, 1, self.databaseHandler);
                            if(self.databaseHandler && self.databaseHandler.savePlayer) {
                                self.databaseHandler.savePlayer(p);
                            }
                            p.sendHubState("👹 Boss de Guilde vaincu ! Vous recevez +" + bonusGold + " Or et " + rewardName + " [" + rarityLabel + "] dans votre Sac !", false);
                            if(Types.getItemRarity(rewardKind) === "legendary") {
                                self.pushBroadcast(new Messages.Chat(p, "✨ [LÉGENDAIRE] " + p.name + " a obtenu " + rewardName + " sur le Boss de Guilde !"));
                            }
                        }
                    });
                } else {
                    item = this.getDroppedItem(mob);
                    if(item) {
                        item.instanceId = mob.instanceId || null;
                        this.pushToAdjacentGroups(mob.group, mob.drop(item), null, mob.instanceId || null);
                        this.handleItemDespawn(item);
                    }
                }
            }

            if(entity.type === "player") {
                this.handlePlayerVanish(entity);
                this.pushToAdjacentGroups(entity.group, entity.despawn(), null, entity.instanceId || null);
            }

            this.removeEntity(entity);
        }
    },

    despawn: function(entity) {
        this.pushToAdjacentGroups(entity.group, entity.despawn());

        if(entity.id in this.entities) {
            this.removeEntity(entity);
        }
    },

    spawnStaticEntities: function() {
        var self = this,
            count = 0;

        _.each(this.map.staticEntities, function(kindName, tid) {
            var kind = Types.getKindFromString(kindName),
                pos = self.map.tileIndexToGridPosition(tid);

            if(Types.isNpc(kind)) {
                self.addNpc(kind, pos.x + 1, pos.y);
            }
            if(Types.isMob(kind)) {
                var mob = new Mob('7' + kind + count++, kind, pos.x + 1, pos.y);
                mob.onRespawn(function() {
                    mob.isDead = false;
                    self.addMob(mob);
                    if(mob.area && mob.area instanceof ChestArea) {
                        mob.area.addToArea(mob);
                    }
                });
                mob.onMove(self.onMobMoveCallback.bind(self));
                self.addMob(mob);
                self.tryAddingMobToChestArea(mob);
            }
            if(Types.isItem(kind)) {
                self.addStaticItem(self.createItem(kind, pos.x + 1, pos.y));
            }
        });
    },

    isValidPosition: function(x, y) {
        if(this.map && _.isNumber(x) && _.isNumber(y) && !this.map.isOutOfBounds(x, y) && !this.map.isColliding(x, y)) {
            return true;
        }
        return false;
    },

    handlePlayerVanish: function(player) {
        var self = this,
            previousAttackers = [];

        // When a player dies or teleports, all of his attackers go and attack their second most hated player.
        player.forEachAttacker(function(mob) {
            previousAttackers.push(mob);
            self.chooseMobTarget(mob, 2);
        });

        _.each(previousAttackers, function(mob) {
            player.removeAttacker(mob);
            mob.clearTarget();
            mob.forgetPlayer(player.id, 1000);
        });

        var hasChangedGroups = this.handleEntityGroupMembership(player);
        if(hasChangedGroups) {
            this.pushToPreviousGroups(player, new Messages.Destroy(player));
        }
    },

    setPlayerCount: function(count) {
        this.playerCount = count;
    },

    incrementPlayerCount: function() {
        this.setPlayerCount(this.playerCount + 1);
    },

    decrementPlayerCount: function() {
        if(this.playerCount > 0) {
            this.setPlayerCount(this.playerCount - 1);
        }
    },

    getDroppedItem: function(mob) {
        var kind = Types.getKindAsString(mob.kind),
            drops = Properties[kind].drops,
            v = Utils.random(100),
            p = 0,
            item = null;

        for(var itemName in drops) {
            var percentage = drops[itemName];

            p += percentage;
            if(v <= p) {
                item = this.addItem(this.createItem(Types.getKindFromString(itemName), mob.x, mob.y));
                break;
            }
        }

        return item;
    },

    onMobMoveCallback: function(mob) {
        this.pushToAdjacentGroups(mob.group, new Messages.Move(mob), null, mob.instanceId || null);
        this.handleEntityGroupMembership(mob);
    },

    findPositionNextTo: function(entity, target) {
        var valid = false,
            pos;

        while(!valid) {
            pos = entity.getPositionNextTo(target);
            valid = this.isValidPosition(pos.x, pos.y);
        }
        return pos;
    },

    initZoneGroups: function() {
        var self = this;

        this.map.forEachGroup(function(id) {
            self.groups[id] = { entities: {},
                                players: [],
                                incoming: []};
        });
        this.zoneGroupsReady = true;
    },

    removeFromGroups: function(entity) {
        var self = this,
            oldGroups = [];

        if(entity && entity.group) {

            var group = this.groups[entity.group];
            if(entity instanceof Player) {
                group.players = _.reject(group.players, function(id) { return id === entity.id; });
            }

            this.map.forEachAdjacentGroup(entity.group, function(id) {
                if(entity.id in self.groups[id].entities) {
                    delete self.groups[id].entities[entity.id];
                    oldGroups.push(id);
                }
            });
            entity.group = null;
        }
        return oldGroups;
    },

    /**
     * Registers an entity as "incoming" into several groups, meaning that it just entered them.
     * All players inside these groups will receive a Spawn message when WorldServer.processGroups is called.
     */
    addAsIncomingToGroup: function(entity, groupId) {
        var self = this,
            isChest = entity && entity instanceof Chest,
            isItem = entity && entity instanceof Item,
            isDroppedItem =  entity && isItem && !entity.isStatic && !entity.isFromChest;

        if(entity && groupId) {
            this.map.forEachAdjacentGroup(groupId, function(id) {
                var group = self.groups[id];

                if(group) {
                    if(!_.include(group.entities, entity.id)
                    //  Items dropped off of mobs are handled differently via DROP messages. See handleHurtEntity.
                    && (!isItem || isChest || (isItem && !isDroppedItem))) {
                        group.incoming.push(entity);
                    }
                }
            });
        }
    },

    addToGroup: function(entity, groupId) {
        var self = this,
            newGroups = [];

        if(entity && groupId && (groupId in this.groups)) {
            this.map.forEachAdjacentGroup(groupId, function(id) {
                self.groups[id].entities[entity.id] = entity;
                newGroups.push(id);
            });
            entity.group = groupId;

            if(entity instanceof Player) {
                this.groups[groupId].players.push(entity.id);
            }
        }
        return newGroups;
    },

    logGroupPlayers: function(groupId) {
        log.debug("Players inside group "+groupId+":");
        _.each(this.groups[groupId].players, function(id) {
            log.debug("- player "+id);
        });
    },

    handleEntityGroupMembership: function(entity) {
        var hasChangedGroups = false;
        if(entity) {
            var groupId = this.map.getGroupIdFromPosition(entity.x, entity.y);
            if(!entity.group || (entity.group && entity.group !== groupId)) {
                hasChangedGroups = true;
                this.addAsIncomingToGroup(entity, groupId);
                var oldGroups = this.removeFromGroups(entity);
                var newGroups = this.addToGroup(entity, groupId);

                if(_.size(oldGroups) > 0) {
                    entity.recentlyLeftGroups = _.difference(oldGroups, newGroups);
                    log.debug("group diff: " + entity.recentlyLeftGroups);
                }
            }
        }
        return hasChangedGroups;
    },

    processGroups: function() {
        var self = this;

        if(this.zoneGroupsReady) {
            this.map.forEachGroup(function(id) {
                var spawns = [];
                if(self.groups[id].incoming.length > 0) {
                    spawns = _.each(self.groups[id].incoming, function(entity) {
                        if(entity instanceof Player) {
                            self.pushToGroup(id, new Messages.Spawn(entity), entity.id, entity.instanceId || null);
                        } else {
                            self.pushToGroup(id, new Messages.Spawn(entity), null, entity.instanceId || null);
                        }
                    });
                    self.groups[id].incoming = [];
                }
            });
        }
    },

    moveEntity: function(entity, x, y) {
        if(entity) {
            entity.setPosition(x, y);
            this.handleEntityGroupMembership(entity);
        }
    },

    handleItemDespawn: function(item) {
        var self = this;

        if(item) {
            item.handleDespawn({
                beforeBlinkDelay: 10000,
                blinkCallback: function() {
                    self.pushToAdjacentGroups(item.group, new Messages.Blink(item), null, item.instanceId || null);
                },
                blinkingDuration: 4000,
                despawnCallback: function() {
                    self.pushToAdjacentGroups(item.group, new Messages.Destroy(item), null, item.instanceId || null);
                    self.removeEntity(item);
                }
            });
        }
    },

    handleEmptyMobArea: function(area) {

    },

    handleEmptyChestArea: function(area) {
        if(area) {
            var chest = this.addItem(this.createChest(area.chestX, area.chestY, area.items));
            this.handleItemDespawn(chest);
        }
    },

    handleOpenedChest: function(chest, player) {
        var inst = chest.instanceId || null;
        this.pushToAdjacentGroups(chest.group, chest.despawn(), null, inst);
        this.removeEntity(chest);

        var kind = chest.getRandomItem();
        if(kind) {
            var itemId = parseInt('9' + (this.itemCount++) + '' + Math.floor(Math.random() * 90 + 10), 10);
            var item = new Item(itemId, kind, chest.x, chest.y);
            item.isFromChest = true;
            item.instanceId = inst;
            this.addItem(item);
            this.handleItemDespawn(item);
        }
    },

    spawnCustomChest: function(x, y, itemNames, instanceId) {
        var cx = x + 1,
            cy = y;
        if(!this.isValidPosition(cx, cy)) {
            cx = x;
            cy = y;
        }
        var chestId = parseInt('9' + (this.itemCount++) + '' + Math.floor(Math.random() * 90 + 10), 10);
        var chest = new Chest(chestId, cx, cy);
        chest.instanceId = instanceId || null;
        var numericItems = [];
        _.each(itemNames || [], function(name) {
            var k = (typeof name === 'number') ? name : Types.getKindFromString(name);
            if(k) numericItems.push(k);
        });
        if(numericItems.length === 0) {
            numericItems = [Types.Entities.GOLDENSWORD, Types.Entities.GOLDENARMOR, Types.Entities.REDSWORD, Types.Entities.REDARMOR, Types.Entities.BLUESWORD, Types.Entities.PLATEARMOR, Types.Entities.BURGER];
        }
        chest.setItems(numericItems);
        this.addItem(chest);
        this.handleItemDespawn(chest);
        return chest;
    },
    getPlayerByName: function(name){
        for(var id in this.players) {
            if(this.players[id].name === name){
                return this.players[id];
            }
        }
        return null;
    },
     removePlayer: function(player) {
        player.broadcast(player.despawn());
        this.removeEntity(player);
        delete this.players[player.id];
        delete this.outgoingQueues[player.id];
    },
    loggedInPlayer: function(name){
        for(var id in this.players) {
            if(this.players[id].name === name){
                if(!this.players[id].isDead)
                    return true;
            }
        }
        return false;
    },


    tryAddingMobToChestArea: function(mob) {
        _.each(this.chestAreas, function(area) {
            if(area.contains(mob)) {
                area.addToArea(mob);
            }
        });
    },

    updatePopulation: function(totalPlayers) {
        this.pushBroadcast(new Messages.Population(this.playerCount, totalPlayers ? totalPlayers : this.playerCount));
    },

    spawnMobFromAdmin: function(kindName, x, y, instanceId) {
        var self = this,
            kind = Types.getKindFromString(kindName);
        if(!kind || !Types.isMob(kind)) {
            return null;
        }
        var spawnX = x + 1,
            spawnY = y;
        if(!this.isValidPosition(spawnX, spawnY)) {
            spawnX = x;
            spawnY = y;
        }
        var mobId = parseInt('8' + kind + Date.now().toString().slice(-4) + Math.floor(Math.random() * 90 + 10), 10);
        var mob = new Mob(mobId, kind, spawnX, spawnY);
        if(instanceId) {
            mob.instanceId = instanceId;
        }
        mob.onMove(self.onMobMoveCallback.bind(self));
        self.addMob(mob);
        return mob;
    },

    spawnWorldBosses: function() {
        var self = this;
        var bossLocations = [
            { kind: "grandogre", x: 45, y: 105 },
            { kind: "spectreancien", x: 22, y: 52 },
            { kind: "seigneurmort", x: 135, y: 82 },
            { kind: "archimage", x: 156, y: 186 },
            { kind: "oeilabyssal", x: 60, y: 25 },
            { kind: "reinecrabe", x: 40, y: 285 },
            { kind: "roigobelin", x: 65, y: 160 },
            { kind: "hydreserpent", x: 35, y: 82 },
            { kind: "colossesquelette", x: 20, y: 120 }
        ];

        _.each(bossLocations, function(b, idx) {
            var kind = Types.getKindFromString(b.kind);
            if(!kind) return;
            var bx = b.x,
                by = b.y;
            if(!self.isValidPosition(bx, by)) {
                for(var dy = -3; dy <= 3; dy++) {
                    for(var dx = -3; dx <= 3; dx++) {
                        if(self.isValidPosition(b.x + dx, b.y + dy)) {
                            bx = b.x + dx;
                            by = b.y + dy;
                            break;
                        }
                    }
                }
            }
            var bossId = parseInt('79' + kind + '' + idx, 10);
            var bossMob = new Mob(bossId, kind, bx, by);
            bossMob.respawnDelay = 60000;
            bossMob.onRespawn(function() {
                bossMob.isDead = false;
                self.addMob(bossMob);
            });
            bossMob.onMove(self.onMobMoveCallback.bind(self));
            self.addMob(bossMob);
            log.info("Boss mondial déployé : " + b.kind + " (" + bx + ", " + by + ")");
        });
    },

    spawnGuildBoss: function(guildId, bossKindName) {
        var self = this,
            kind = Types.getKindFromString(bossKindName || "seigneurmort") || Types.Entities.SEIGNEURMORT,
            instanceId = "guild_" + guildId,
            bx = 155,
            by = 282;

        var mobId = parseInt('88' + guildId + '' + Date.now().toString().slice(-4), 10);
        var mob = new Mob(mobId, kind, bx, by);
        mob.instanceId = instanceId;
        mob.isGuildBoss = true;
        mob.guildId = guildId;
        mob.onMove(self.onMobMoveCallback.bind(self));
        this.addMob(mob);
        return mob;
    }
});
