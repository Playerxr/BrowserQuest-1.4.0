
var cls = require("./lib/class"),
    _ = require("underscore"),
    Character = require('./character'),
    Chest = require('./chest'),
    Messages = require("./message"),
    Utils = require("./utils"),
    Properties = require("./properties"),
    Economy = require("./economy"),
    Formulas = require("./formulas"),
    check = require("./format").check,
    Types = require("../../shared/js/gametypes"),
    Gameplay = require("./gameplay"),
    firebaseService = null,
    Auth = require("./auth");

try {
    firebaseService = require("./firebase_service");
} catch(e) {}

module.exports = Player = Character.extend({
    init: function(connection, worldServer, databaseHandler) {
        var self = this;

        this.server = worldServer;
        this.connection = connection;
        this.sessionId = connection.sessionId || ("sess_" + connection.id);
        this.databaseHandler = databaseHandler;
        this.autoSaveInterval = null;
        this.instanceId = null;
        this.connectionClosed = false;
        this.isAuthenticating = false;

        this._super(this.connection.id, "player", Types.Entities.WARRIOR, 0, 0, "");

        this.hasEnteredGame = false;
        this.isDead = false;
        this.haters = {};
        this.lastCheckpoint = null;
        this.disconnectTimeout = null;

        this.pvpFlag = false;
        this.bannedTime = 0;
        this.banUseTime = 0;
        this.experience = 0;
        this.level = 0;
        this.lastWorldChatMinutes=99;

        this.inventory = [];
        this.inventoryCount = [];
        this.achievement = [];

        this.gold = 150;
        this.lives = 3;
        this.guildId = null;
        this.pendingGuildInvites = [];
        this.admin = 0;

        this.chatBanEndTime = 0;

        this.connection.listen(function(message) {
            var action = Array.isArray(message) ? message[0] : undefined;

            log.debug("Received action: " + action);
            if(!check(message)) {
                self.connection.close("Invalid message format");
                return;
            }

            if(!self.hasEnteredGame && action !== Types.Messages.CREATE && action !== Types.Messages.LOGIN && action !== Types.Messages.GOOGLE_LOGIN) { // Handshake must be first message
                self.connection.close("Invalid handshake message");
                return;
            }
            if((self.hasEnteredGame || self.isAuthenticating) && (action === Types.Messages.CREATE || action === Types.Messages.LOGIN || action === Types.Messages.GOOGLE_LOGIN)) { // Handshake can be sent only once
                self.connection.close("Cannot initiate handshake twice");
                return;
            }

            self.resetTimeout();

            if(action === Types.Messages.GOOGLE_LOGIN) {
                var idToken = message[1];
                var preferredName = message[2] ? Utils.sanitize(String(message[2])).trim() : '';

                self.isAuthenticating = true;
                firebaseService.verifyIdToken(idToken).then(function(googleUser) {
                    if(!googleUser) {
                        self.isAuthenticating = false;
                        self.connection.sendUTF8("invalidlogin");
                        self.connection.close("Invalid Google token");
                        return;
                    }

                    var rawName = preferredName || googleUser.name || (googleUser.email ? googleUser.email.split('@')[0] : 'Hero');
                    rawName = Utils.sanitize(rawName).replace(/[^a-zA-Z0-9_\-\u00C0-\u017F]/g, '').trim();
                    if(!rawName || rawName.length < 2) rawName = 'Hero' + Math.floor(Math.random() * 8999 + 1000);
                    self.name = rawName.substr(0, 12);
                    self.email = googleUser.email;
                    self.googleUid = googleUser.uid;

                    log.info("GOOGLE_LOGIN: " + self.name + " (" + googleUser.email + ") [session=" + self.sessionId + "]");
                    databaseHandler.loginWithGoogle(self, googleUser);
                }).catch(function(err) {
                    self.isAuthenticating = false;
                    self.connection.sendUTF8("invalidlogin");
                    self.connection.close("Google auth error: " + (err ? err.message : ''));
                });
                return;
            }

            if(action === Types.Messages.CREATE || action === Types.Messages.LOGIN) {
                var name = Utils.sanitize(String(message[1] || "")).trim();
                var pw = message[2];

                // Autoriser les pseudos jusqu'à 12 caractères (sans espace)
                self.name = name.substr(0, 12).split(' ')[0];
                if(!self.checkName(self.name) || !Auth.isValidPassword(pw)){
                    self.connection.sendUTF8("invalidlogin");
                    self.connection.close("Invalid name or password " + self.name);
                    return;
                }
                self.pw = pw;
                self.isAuthenticating = true;

                if(action === Types.Messages.CREATE) {
                    log.info("CREATE: " + self.name + " [session=" + self.sessionId + "]");
                    self.email = message[3] ? Utils.sanitize(String(message[3])) : "";
                    databaseHandler.createPlayer(self);
                } else {
                    log.info("LOGIN: " + self.name + " [session=" + self.sessionId + "]");
                    if(self.server.loggedInPlayer(self.name)) {
                        self.connection.sendUTF8("loggedin");
                        self.connection.close("Already logged in " + self.name);
                        return;
                    }
                    databaseHandler.loadPlayer(self);
                }
//              self.kind = Types.Entities.WARRIOR;
//              self.equipArmor(message[2]);
//              self.equipWeapon(message[3]);
//              if(typeof message[4] !== 'undefined'){	
//                  var aGuildId = self.server.reloadGuild(message[4],message[5]);				
//                  if( aGuildId !== message[4]){
//                      self.server.pushToPlayer(self, new Messages.GuildError(Types.Messages.GUILDERRORTYPE.IDWARNING,message[5]));
//                  }
//              }
//              self.orientation = Utils.randomOrientation();
//              self.updateHitPoints();
//              self.updatePosition();

//              self.server.addPlayer(self, aGuildId);
//              self.server.enter_callback(self);

//              self.send([Types.Messages.WELCOME, self.id, self.name, self.x, self.y, self.hitPoints]);
//              self.hasEnteredGame = true;
//              self.isDead = false;
            }
            else if(action === Types.Messages.WHO) {
                log.info("WHO: " + self.name);
                message.shift();
                self.server.pushSpawnsToPlayer(self, message);
            }
            else if(action === Types.Messages.ZONE) {
                log.info("ZONE: " + self.name);
                self.zone_callback();
            }
            else if(action === Types.Messages.CHAT) {
                var msg = Utils.sanitize(message[1]);
                log.info("CHAT: " + self.name + ": " + msg);

                // Sanitized messages may become empty. No need to broadcast empty chat messages.
                if(msg && msg !== "") {
                    msg = msg.substr(0, 60); // Enforce maxlength of chat input
                    self.server.pushBroadcast(new Messages.Chat(self, msg));
                }
            }
            else if(action === Types.Messages.MOVE) {
                log.info("MOVE: " + self.name + "(" + message[1] + ", " + message[2] + ")");
                if(self.move_callback) {
                    var x = message[1],
                        y = message[2];

                    if(Gameplay.move(self, x, y)) {
                        self.clearTarget();

                        self.broadcast(new Messages.Move(self));
                        self.move_callback(self.x, self.y);
                        if(self.zone_callback) self.zone_callback();
                    } else {
                        self.send(new Messages.Teleport(self).serialize());
                    }
                }
            }
            else if(action === Types.Messages.LOOTMOVE) {
                log.info("LOOTMOVE: " + self.name + "(" + message[1] + ", " + message[2] + ")");
                if(self.lootmove_callback) {
                    var item = self.server.getEntityById(message[3]);
                    if(item && Types.isItem(item.kind) && Gameplay.sameInstance(self, item) &&
                       Math.abs(message[1] - item.x) + Math.abs(message[2] - item.y) <= 1 &&
                       Gameplay.move(self, message[1], message[2])) {
                        self.clearTarget();

                        self.broadcast(new Messages.LootMove(self, item));
                        self.lootmove_callback(self.x, self.y);
                        if(self.zone_callback) self.zone_callback();
                    }
                }
            }
            else if(action === Types.Messages.AGGRO) {
                log.info("AGGRO: " + self.name + " " + message[1]);
                var mob = self.server.getEntityById(message[1]);
                if(mob && self.move_callback && Gameplay.mobAggroRange(mob.kind) > 0 &&
                   Gameplay.liveMob(self, mob, Gameplay.mobAggroRange(mob.kind) + 1)) {
                    self.server.handleMobHate(message[1], self.id, 5);
                }
            }
            else if(action === Types.Messages.ATTACK) {
                log.info("ATTACK: " + self.name + " " + message[1]);
                var mob = self.server.getEntityById(message[1]);

                if(Gameplay.liveMob(self, mob, 28)) {
                    self.setTarget(mob);
                    self.server.broadcastAttacker(self);
                }
            }
            else if(action === Types.Messages.HIT) {
                log.info("HIT: " + self.name + " " + message[1]);
                var mob = self.server.getEntityById(message[1]);
                if(Gameplay.canHit(self, mob)) {
                    if(self.target !== mob.id) {
                        self.setTarget(mob);
                        self.server.broadcastAttacker(self);
                    }
                    var dmg = Formulas.dmg(self.weaponLevel, mob.armorLevel);

                    if(dmg > 0) {
                      if(mob.type !== "player"){
                        mob.receiveDamage(dmg, self.id);
                        self.server.handleMobHate(mob.id, self.id, dmg);
                        self.server.handleHurtEntity(mob, self, dmg);
                      }
                    }
                }
            }

            else if(action === Types.Messages.HURT) {
                // Damage is driven by the server combat clock, never by client reports.
                return;
            }
            else if(action === Types.Messages.LOOT) {
                log.info("LOOT: " + self.name + " " + message[1]);
                var item = self.server.getEntityById(message[1]);

                if(item && Gameplay.near(self, item, 1)) {
                    var kind = item.kind;

                    if(Types.isItem(kind)) {
                        self.broadcast(item.despawn());
                        self.server.removeEntity(item);

                        if(kind === Types.Entities.FIREPOTION) {
                            if(self.firepotionTimeout) clearTimeout(self.firepotionTimeout);
                            self.updateHitPoints();
                            self.broadcast(self.equip(Types.Entities.FIREFOX));
                            self.firepotionTimeout = setTimeout(function() {
                                self.broadcast(self.equip(self.armor)); // return to normal after 15 sec
                                self.firepotionTimeout = null;
                            }, 15000);
                            self.send(new Messages.HitPoints(self.maxHitPoints).serialize());
                        } else {
                            // Le loot ramassé va DIRECTEMENT dans le Sac à dos (sans s'équiper de force)
                            var added = self.addToInventory(kind, 1, databaseHandler);
                            if(!added && Types.isHealingItem(kind)) {
                                // Si le sac est plein et que c'est un soin, soigner immédiatement
                                var amount = (kind === Types.Entities.BURGER) ? 100 : (kind === Types.Entities.CAKE ? 60 : 40);
                                if(!self.hasFullHealth()) {
                                    self.regenHealthBy(amount);
                                    self.server.pushToPlayer(self, self.health());
                                }
                            } else if(!added) {
                                // Si le sac est plein pour un équipement, le redéposer au sol
                                var redropped = self.server.addItemFromChest(kind, self.x, self.y);
                                if(redropped) {
                                    redropped.instanceId = self.instanceId || null;
                                    self.server.handleItemDespawn(redropped);
                                }
                                self.sendHubNotice("Sac à dos plein ! Libérez un emplacement dans le Hub.", true);
                                return;
                            }

                            if(databaseHandler && databaseHandler.savePlayer) {
                                databaseHandler.savePlayer(self);
                            }

                            var itemLabel = Types.getFrenchItemName(kind);
                            var rarity = Types.getItemRarity(kind);
                            var rarityLabel = Types.getItemRarityLabel(kind);

                            // Annonce publique dans le chat et bannière pour tout loot Légendaire !
                            if(rarity === "legendary") {
                                var legText = "✨ " + self.name + " a trouvé " + itemLabel + " [Légendaire] !";
                                self.server.pushBroadcast(new Messages.Chat(self, legText));
                                self.server.pushBroadcast(new Messages.Hub("announcement", {
                                    author: "BUTIN LÉGENDAIRE",
                                    text: self.name + " a trouvé " + itemLabel + " !"
                                }));
                            }

                            self.sendHubState("Objet rangé dans votre Sac à dos : " + itemLabel + " [" + rarityLabel + "]", false);
                        }
                    }
                }
            }
            else if(action === Types.Messages.TELEPORT) {
                log.info("TELEPORT: " + self.name + "(" + message[1] + ", " + message[2] + ")");
                var x = message[1],
                    y = message[2];

                if(Gameplay.canTeleport(self, x, y)) {
                    self.setPosition(x, y);
                    self.clearTarget();

                    self.broadcast(new Messages.Teleport(self));

                    self.server.handlePlayerVanish(self);
                    self.server.pushRelevantEntityListTo(self);
                } else {
                    self.send(new Messages.Teleport(self).serialize());
                }
            }
            else if(action === Types.Messages.OPEN) {
                log.info("OPEN: " + self.name + " " + message[1]);
                var chest = self.server.getEntityById(message[1]);
                if(chest && chest instanceof Chest && Gameplay.near(self, chest, 1)) {
                    self.server.handleOpenedChest(chest, self);
                }
            }
            else if(action === Types.Messages.CHECK) {
                log.info("CHECK: " + self.name + " " + message[1]);
                var checkpoint = self.server.map.getCheckpoint(message[1]);
                if(Gameplay.inCheckpoint(self, checkpoint)) {
                    self.lastCheckpoint = checkpoint;
                    databaseHandler.setCheckpoint(self.name, self.x, self.y);
                }
            }
            else if(action === Types.Messages.INVENTORY){
                log.info("INVENTORY: " + self.name + " " + message[1] + " " + message[2] + " " + message[3]);
                var subAction = message[1],
                    inventoryNumber = message[2],
                    count = message[3] || 1;

                if(inventoryNumber < 0 || inventoryNumber >= 6){
                    return;
                }

                var itemKind = self.inventory[inventoryNumber];
                if(!itemKind) {
                    return;
                }

                if(subAction === "use" || subAction === "eat" || subAction === "armor" || subAction === "avatar"){
                    if(Types.isHealingItem(itemKind)) {
                        var amount = 40;
                        if(itemKind === Types.Entities.BURGER) amount = 100;
                        else if(itemKind === Types.Entities.CAKE) amount = 60;

                        self.regenHealthBy(amount);
                        self.server.pushToPlayer(self, self.health());

                        self.inventoryCount[inventoryNumber] = (self.inventoryCount[inventoryNumber] || 1) - 1;
                        if(self.inventoryCount[inventoryNumber] <= 0){
                            self.inventory[inventoryNumber] = null;
                            self.inventoryCount[inventoryNumber] = 0;
                            databaseHandler.makeEmptyInventory(self.name, inventoryNumber);
                        } else {
                            databaseHandler.setInventory(self.name, self.inventory[inventoryNumber], inventoryNumber, self.inventoryCount[inventoryNumber]);
                        }
                        self.send(new Messages.Inventory(inventoryNumber, self.inventory[inventoryNumber], self.inventoryCount[inventoryNumber]).serialize());
                    } else if(Types.isArmor(itemKind)) {
                        var oldArmor = self.armor;
                        self.equipItem(itemKind, false);
                        self.broadcast(self.equip(itemKind), false);
                        self.inventory[inventoryNumber] = oldArmor;
                        self.inventoryCount[inventoryNumber] = 1;
                        databaseHandler.setInventory(self.name, oldArmor, inventoryNumber, 1);
                        self.send(new Messages.Inventory(inventoryNumber, self.inventory[inventoryNumber], 1).serialize());
                        if(databaseHandler && databaseHandler.savePlayer) {
                            databaseHandler.savePlayer(self);
                        }
                    } else if(Types.isWeapon(itemKind)) {
                        var oldWeapon = self.weapon;
                        self.equipItem(itemKind, false);
                        self.broadcast(self.equip(itemKind), false);
                        self.inventory[inventoryNumber] = oldWeapon;
                        self.inventoryCount[inventoryNumber] = 1;
                        databaseHandler.setInventory(self.name, oldWeapon, inventoryNumber, 1);
                        self.send(new Messages.Inventory(inventoryNumber, self.inventory[inventoryNumber], 1).serialize());
                        if(databaseHandler && databaseHandler.savePlayer) {
                            databaseHandler.savePlayer(self);
                        }
                    }
                } else if(subAction === "drop" || subAction === "empty"){
                    var dropped = self.server.addItemFromChest(itemKind, self.x, self.y);
                    if(dropped) {
                        dropped.instanceId = self.instanceId || null;
                        self.server.handleItemDespawn(dropped);
                    }
                    if(Types.isHealingItem(itemKind) && self.inventoryCount[inventoryNumber] > 1) {
                        self.inventoryCount[inventoryNumber] -= 1;
                        databaseHandler.setInventory(self.name, self.inventory[inventoryNumber], inventoryNumber, self.inventoryCount[inventoryNumber]);
                    } else {
                        self.inventory[inventoryNumber] = null;
                        self.inventoryCount[inventoryNumber] = 0;
                        databaseHandler.makeEmptyInventory(self.name, inventoryNumber);
                    }
                    self.send(new Messages.Inventory(inventoryNumber, self.inventory[inventoryNumber], self.inventoryCount[inventoryNumber]).serialize());
                }
            }
            else if(action === Types.Messages.ACHIEVEMENT) {
              log.info("ACHIEVEMENT: " + self.name + " " + message[1] + " " + message[2]);
              if(message[2] === "found" && self.achievement[message[1]]){
                  self.achievement[message[1]].found = true;
                  databaseHandler.foundAchievement(self.name, message[1]);
              }
            }
            else if(action === Types.Messages.HUB) {
                self.handleHubMessage(message[1], message[2]);
            }
            else if(action === Types.Messages.GUILD) {
                // Legacy, memory-only guilds share IDs with persistent Hub guilds.
                // Only the Hub routes enforce database membership and invitations.
                self.sendHubNotice("Utilisez le Hub pour gérer votre guilde.", true);
            } else {
                if(self.message_callback) {
                    self.message_callback(message);
                }
            }
        });

        this.connection.onClose(function() {
            self.connectionClosed = true;
            delete self.pw;
            clearInterval(self.combatInterval);
            if(self.firepotionTimeout) {
                clearTimeout(self.firepotionTimeout);
            }
            if(self.autoSaveInterval) {
                clearInterval(self.autoSaveInterval);
                self.autoSaveInterval = null;
            }
            if(self.hasEnteredGame && databaseHandler && databaseHandler.savePlayer) {
                databaseHandler.savePlayer(self);
            }
            clearTimeout(self.disconnectTimeout);
            if(self.exit_callback) {
                self.exit_callback();
            }
        });

        this.combatInterval = setInterval(function() {
            self.processCombat(Date.now());
        }, 200);
        this.combatInterval.unref();

        this.connection.sendUTF8("go"); // Notify client that the HELLO/WELCOME handshake can start
    },

    setPosition: function(x, y) {
        this._super(x, y);
        Gameplay.resetMovement(this);
    },

    processCombat: function(now) {
        if(!this.hasEnteredGame || this.connectionClosed || this.isDead || this.hitPoints <= 0) {
            return;
        }
        var self = this,
            groupId = this.server.map.getGroupIdFromPosition(this.x, this.y),
            group = this.server.groups[groupId],
            candidates = _.extend({}, group ? group.entities : {}, this.attackers);
        _.each(candidates, function(mob) {
            if(mob.type !== "mob" || self.server.mobs[mob.id] !== mob) {
                return;
            }
            // Nearby monsters aggro even if a modified client suppresses AGGRO.
            var aggroRange = Gameplay.mobAggroRange(mob.kind);
            if(!mob.target && aggroRange > 0 && Gameplay.liveMob(self, mob, aggroRange)) {
                self.server.handleMobHate(mob.id, self.id, 5);
            }
            if(mob.target === self.id) {
                self.receiveMobDamage(mob, now);
            }
        });
    },

    receiveMobDamage: function(mob, now) {
        var self = this, databaseHandler = this.databaseHandler;
        if(Gameplay.canMobHit(self, mob, Types.getMobAttackRange(mob.kind), now)) {
            var dmgTaken = Formulas.dmg(mob.weaponLevel, self.armorLevel);
            // Bonus de puissance si c'est un monstre à Pouvoir/Distance ou un Boss
            if(Types.isRangedMob && Types.isRangedMob(mob.kind)) {
                dmgTaken = Math.round(dmgTaken * 1.15);
            }
            self.hitPoints -= dmgTaken;
    
            // Si les PV tombent à 0 : Système de 3 Vies façon Arcade / Mario !
            if(self.hitPoints <= 0) {
                if(self.firepotionTimeout) {
                    clearTimeout(self.firepotionTimeout);
                    self.firepotionTimeout = null;
                }
                self.lives = (typeof self.lives === 'number' ? self.lives : 3) - 1;
                var isGameOver = (self.lives <= 0);
                var respawnPos;
    
                // Si le joueur était dans un Salon de Guilde, le faire sortir
                if(self.instanceId) {
                    self.server.handlePlayerVanish(self);
                    self.instanceId = null;
                }
    
                if(isGameOver) {
                    // GAME OVER : Plus aucune vie ! Téléportation au tout premier point de départ du village et réinitialisation à 3 Vies
                    self.lives = 3;
                    self.lastCheckpoint = null;
                    var startArea = (self.server.map && self.server.map.startingAreas && self.server.map.startingAreas[0])
                        ? self.server.map.startingAreas[0]
                        : null;
                    respawnPos = startArea ? startArea.getRandomPosition() : self.server.map.getRandomStartingPosition();
                } else {
                    // Il reste des Vies : réapparition au point de contrôle (checkpoint) le plus proche
                    respawnPos = self.getClosestCheckpointPosition();
                }
    
                self.updateHitPoints();
                self.hitPoints = self.maxHitPoints;
                self.isDead = false;
                self.setPosition(respawnPos.x, respawnPos.y);
                self.clearTarget();
    
                self.server.handlePlayerVanish(self);
                self.send(new Messages.HitPoints(self.maxHitPoints).serialize());
                self.server.pushToPlayer(self, self.health());
                self.send(new Messages.Teleport(self).serialize());
                self.broadcast(new Messages.Teleport(self), false);
                self.server.pushRelevantEntityListTo(self);
    
                if(databaseHandler && databaseHandler.savePlayer) {
                    databaseHandler.savePlayer(self);
                }
    
                self.send(new Messages.Hub("lives_update", {
                    lives: self.lives,
                    gameOver: isGameOver,
                    x: self.x,
                    y: self.y
                }).serialize());
                self.sendHubState(
                    isGameOver
                        ? "💀 GAME OVER ! Vous avez perdu votre dernière Vie : retour au village de départ (3 ❤️ Vies restaurées) !"
                        : ("💔 Vous avez perdu 1 Vie ! Il vous reste " + self.lives + " ❤️ Vie(s). Réapparition au point de contrôle."),
                    isGameOver
                );
                return;
            }
    
            self.server.handleHurtEntity(self, mob, dmgTaken);
        }
    },

    destroy: function() {
        var self = this;

        this.forEachAttacker(function(mob) {
            mob.clearTarget();
        });
        this.attackers = {};

        this.forEachHater(function(mob) {
            mob.forgetPlayer(self.id);
        });
        this.haters = {};
    },

    getState: function() {
        var basestate = this._getBaseState(),
            state = [this.name, this.orientation, this.armor, this.weapon, this.level];

        if(this.target) {
            state.push(this.target);
        }

        return basestate.concat(state);
    },

    send: function(message) {
        this.connection.send(message);
    },
    flagPVP: function(pvpFlag){
        if(this.pvpFlag != pvpFlag){
            this.pvpFlag = pvpFlag;
            this.send(new Messages.PVP(this.pvpFlag).serialize());
        }
    },

    broadcast: function(message, ignoreSelf) {
        if(this.broadcast_callback) {
            this.broadcast_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },

    broadcastToZone: function(message, ignoreSelf) {
        if(this.broadcastzone_callback) {
            this.broadcastzone_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },

    onExit: function(callback) {
        this.exit_callback = callback;
    },

    onMove: function(callback) {
        this.move_callback = callback;
    },

    onLootMove: function(callback) {
        this.lootmove_callback = callback;
    },

    onZone: function(callback) {
        this.zone_callback = callback;
    },

    onOrient: function(callback) {
        this.orient_callback = callback;
    },

    onMessage: function(callback) {
        this.message_callback = callback;
    },

    onBroadcast: function(callback) {
        this.broadcast_callback = callback;
    },

    onBroadcastToZone: function(callback) {
        this.broadcastzone_callback = callback;
    },

    equip: function(item) {
        return new Messages.EquipItem(this, item);
    },

    addHater: function(mob) {
        if(mob) {
            if(!(mob.id in this.haters)) {
                this.haters[mob.id] = mob;
            }
        }
    },

    removeHater: function(mob) {
        if(mob && mob.id in this.haters) {
            delete this.haters[mob.id];
        }
    },

    forEachHater: function(callback) {
        _.each(this.haters, function(mob) {
            callback(mob);
        });
    },

    equipArmor: function(kind) {
        this.armor = kind;
        this.armorLevel = Properties.getArmorLevel(kind);
    },

     equipAvatar: function(kind) {
       if(kind){
         this.avatar = kind;
       } else {
            this.avatar = Types.Entities.CLOTHARMOR;
       }
     },

    equipWeapon: function(kind) {
        this.weapon = kind;
        this.weaponLevel = Properties.getWeaponLevel(kind);
    },

    equipItem: function(itemKind, isAvatar) {
        var databaseHandler = this.databaseHandler;
        if(itemKind) {
            log.debug(this.name + " equips " + Types.getKindAsString(itemKind));

            if(Types.isArmor(itemKind)) {
                var currentHp = this.hitPoints;
                if(isAvatar){
                    databaseHandler.equipAvatar(this.name, Types.getKindAsString(itemKind));
                    this.equipAvatar(itemKind);
                } else {
                    databaseHandler.equipAvatar(this.name, Types.getKindAsString(itemKind));
                    this.equipAvatar(itemKind);

                    databaseHandler.equipArmor(this.name, Types.getKindAsString(itemKind));
                    this.equipArmor(itemKind);
                }
                this.updateHitPoints();
                this.hitPoints = Math.min(currentHp, this.maxHitPoints);
                this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
                this.send(this.health().serialize());
            } else if(Types.isWeapon(itemKind)) {
                databaseHandler.equipWeapon(this.name, Types.getKindAsString(itemKind));
                this.equipWeapon(itemKind);
            }
        }
    },

    updateHitPoints: function() {
        this.resetHitPoints(Formulas.hp(this.armorLevel));
    },

    updatePosition: function() {
        if(this.requestpos_callback) {
            var pos = this.requestpos_callback();
            this.setPosition(pos.x, pos.y);
        }
    },

    getClosestCheckpointPosition: function() {
        if(this.lastCheckpoint) {
            return this.lastCheckpoint.getRandomPosition();
        }
        var self = this,
            bestCp = null,
            bestDist = 999999;
        if(this.server && this.server.map && this.server.map.checkpoints) {
            _.each(this.server.map.checkpoints, function(cp) {
                var cx = cp.x + Math.floor(cp.width / 2),
                    cy = cp.y + Math.floor(cp.height / 2),
                    d = Math.abs(self.x - cx) + Math.abs(self.y - cy);
                if(d < bestDist) {
                    bestDist = d;
                    bestCp = cp;
                }
            });
        }
        if(bestCp) {
            return bestCp.getRandomPosition();
        }
        return this.server.map.getRandomStartingPosition();
    },

    onRequestPosition: function(callback) {
        this.requestpos_callback = callback;
    },

    resetTimeout: function() {
        clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = setTimeout(this.timeout.bind(this), 1000 * 60 * 15); // 15 min.
    },

    timeout: function() {
        this.connection.sendUTF8("timeout");
        this.connection.close("Player was idle for too long");
    },
     incExp: function(gotexp){
        this.experience = parseInt(this.experience) + (parseInt(gotexp));
        databaseHandler.setExp(this.name, this.experience);
        var origLevel = this.level;
        this.level = Types.getLevel(this.experience);
        if(origLevel !== this.level){
            this.updateHitPoints();
            this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
        }
    },
   
    setGuildId: function(id) {
		if(typeof this.server.guilds[id] !== "undefined"){
			this.guildId = id;
		}
		else{
			log.error(this.id + " cannot add guild " + id + ", it does not exist");
		}
	},
	
	getGuild: function() {
		return this.hasGuild ? this.server.guilds[this.guildId] : undefined;
	},
	
	hasGuild: function() {
		return (typeof this.guildId !== "undefined");
	},
	
	leaveGuild: function(){
		if(this.hasGuild()){
			var leftGuild = this.getGuild();
			leftGuild.removeMember(this);
			this.server.pushToGuild(leftGuild, new Messages.Guild(Types.Messages.GUILDACTION.LEAVE, [this.name, this.id, leftGuild.name]));
			delete this.guildId;
			this.server.pushToPlayer(this, new Messages.Guild(Types.Messages.GUILDACTION.LEAVE, [this.name, this.id, leftGuild.name]));
		}
		else{
			this.server.pushToPlayer(this, new Messages.GuildError(Types.Messages.GUILDERRORTYPE.NOLEAVE,""));
		}
	},
  checkName: function(name){
      if(name === null || name === undefined) return false;
      name = String(name).trim();
      if(name === '' || name.length < 1 || name.length > 12) return false;

      for(var i=0; i < name.length; i++){
          var c = name.charCodeAt(i);

          if(!((0xAC00 <= c && c <= 0xD7A3) || (0x3131 <= c && c <= 0x318E)
            || (0x61 <= c && c <= 0x7A) || (0x41 <= c && c <= 0x5A)
            || (0x30 <= c && c <= 0x39) || c === 0x5F || c === 0x2D
            || (0x00C0 <= c && c <= 0x017F))){
              return false;
          }
      }
      return true;
  },
  sendWelcome: function(armor, weapon, avatar, weaponAvatar, exp, admin,
      bannedTime, banUseTime,
      inventory, inventoryNumber, achievementFound, achievementProgress,
      x, y,
      chatBanEndTime, savedHp){
      var self = this;
      self.kind = Types.Entities.WARRIOR;
      self.admin = admin;
      self.equipArmor(Types.getKindFromString(armor));
      self.equipAvatar(Types.getKindFromString(avatar));
      self.equipWeapon(Types.getKindFromString(weapon));
      for(var idx = 0; idx < 6; idx++) {
          self.inventory[idx] = inventory[idx] ? Types.getKindFromString(inventory[idx]) : null;
          self.inventoryCount[idx] = inventoryNumber[idx] || 0;
      }
      self.achievement[1] = {found: achievementFound[0], progress: achievementProgress[0]};
      self.achievement[2] = {found: achievementFound[1], progress: achievementProgress[1]};
      self.achievement[3] = {found: achievementFound[2], progress: achievementProgress[2]};
      self.achievement[4] = {found: achievementFound[3], progress: achievementProgress[3]};
      self.achievement[5] = {found: achievementFound[4], progress: achievementProgress[4]};
      self.achievement[6] = {found: achievementFound[5], progress: achievementProgress[5]};
      self.achievement[7] = {found: achievementFound[6], progress: achievementProgress[6]};
      self.achievement[8] = {found: achievementFound[7], progress: achievementProgress[7]};
      self.bannedTime = bannedTime;
      self.banUseTime = banUseTime;
      self.experience = exp;
      self.level = Types.getLevel(self.experience);
      self.orientation = Utils.randomOrientation;
      self.updateHitPoints();
      if(savedHp && savedHp > 0 && savedHp <= self.maxHitPoints) {
          self.hitPoints = savedHp;
      }
      if(x === 0 && y === 0){
        self.updatePosition();
      } else {
        self.setPosition(x, y);
      }
      self.chatBanEndTime = chatBanEndTime;

      self.server.addPlayer(self);
      self.server.enter_callback(self);

      self.send([
        Types.Messages.WELCOME, self.id, self.name, self.x, self.y,
        self.hitPoints, armor, weapon, avatar, weaponAvatar,
        self.experience, self.admin,
        self.inventory[0], self.inventoryCount[0],
        self.inventory[1], self.inventoryCount[1],
        self.inventory[2], self.inventoryCount[2],
        self.inventory[3], self.inventoryCount[3],
        self.inventory[4], self.inventoryCount[4],
        self.inventory[5], self.inventoryCount[5]]);
      self.hasEnteredGame = true;
      self.isDead = false;

      // Force la mise à jour explicite des sprites d'équipement à la connexion
      if(self.armor) {
          self.send(self.equip(self.armor).serialize());
          self.broadcast(self.equip(self.armor), false);
      }
      if(self.weapon) {
          self.send(self.equip(self.weapon).serialize());
          self.broadcast(self.equip(self.weapon), false);
      }

      // Synchroniser immédiatement l'état du Hub Central (Or, Sac à dos, Guilde, Marché, Admin)
      self.sendHubState();

      // Sauvegarde initiale et sauvegarde automatique toutes les 60 secondes
      if(self.databaseHandler && self.databaseHandler.savePlayer) {
          self.databaseHandler.savePlayer(self);
          if(self.autoSaveInterval) {
              clearInterval(self.autoSaveInterval);
          }
          self.autoSaveInterval = setInterval(function() {
              if(self.hasEnteredGame && self.databaseHandler && self.databaseHandler.savePlayer) {
                  self.databaseHandler.savePlayer(self);
              }
          }, 60000);
      }
    },

    addToInventory: function(itemKind, count, databaseHandler) {
        var i;
        count = count || 1;
        if(Types.isHealingItem(itemKind)) {
            for(i = 0; i < 6; i++) {
                if(this.inventory[i] === itemKind) {
                    this.inventoryCount[i] = (this.inventoryCount[i] || 0) + count;
                    databaseHandler.setInventory(this.name, itemKind, i, this.inventoryCount[i]);
                    this.send(new Messages.Inventory(i, itemKind, this.inventoryCount[i]).serialize());
                    return true;
                }
            }
        }
        for(i = 0; i < 6; i++) {
            if(!this.inventory[i]) {
                this.inventory[i] = itemKind;
                this.inventoryCount[i] = count;
                databaseHandler.setInventory(this.name, itemKind, i, count);
                this.send(new Messages.Inventory(i, itemKind, count).serialize());
                return true;
            }
        }
        return false;
    },

    getShopCatalog: function() {
        var items = [
            { kind: "flask", name: "Potion de Soin (+40 PV)", type: "object", price: 35 },
            { kind: "burger", name: "Burger Royal (+100 PV)", type: "object", price: 95 },
            { kind: "firepotion", name: "Potion de Feu", type: "object", price: 220 },
            { kind: "sword2", name: "Épée en Acier", type: "weapon", price: 180 },
            { kind: "axe", name: "Hache de Guerre", type: "weapon", price: 420 },
            { kind: "morningstar", name: "Étoile du Matin", type: "weapon", price: 950 },
            { kind: "bluesword", name: "Épée Saphir", type: "weapon", price: 2200 },
            { kind: "bow", name: "🏹 Arc de Chasseur (Attaque à Distance)", type: "weapon", price: 750 },
            { kind: "redsword", name: "Épée Rubis", type: "weapon", price: 4800 },
            { kind: "goldenbow", name: "🏹 Arc Royal d'Élite [Légendaire]", type: "weapon", price: 9200 },
            { kind: "goldensword", name: "Épée d'Or Légendaire", type: "weapon", price: 9500 },
            { kind: "leatherarmor", name: "Armure de Cuir", type: "armor", price: 150 },
            { kind: "mailarmor", name: "Cotte de Mailles", type: "armor", price: 380 },
            { kind: "platearmor", name: "Armure de Plaques", type: "armor", price: 900 },
            { kind: "redarmor", name: "Armure Pourpre", type: "armor", price: 4200 },
            { kind: "goldenarmor", name: "Armure d'Or Légendaire", type: "armor", price: 8800 }
        ];
        return _.map(items, function(it) {
            it.rarity = Types.getItemRarity ? Types.getItemRarity(it.kind) : "common";
            it.rarityLabel = Types.getItemRarityLabel ? Types.getItemRarityLabel(it.kind) : "Commun";
            return it;
        });
    },

    sendHubNotice: function(text, isError) {
        this.send(new Messages.Hub("notice", { text: text, isError: !!isError }).serialize());
    },

    sendHubState: function(noticeText, isError) {
        var self = this,
            db = this.databaseHandler;

        // Recharger le statut admin/or/guilde depuis SQLite si besoin
        if(db && db.stmtGetPlayer) {
            var row = db.stmtGetPlayer.get(this.name);
            if(row) {
                this.admin = (row.is_admin === 1) ? 1 : 0;
                this.guildId = row.guild_id || null;
                if(typeof this.gold !== 'number') {
                    this.gold = row.gold || 0;
                }
                if(typeof this.lives !== 'number') {
                    this.lives = (typeof row.lives === 'number' && row.lives > 0) ? row.lives : 3;
                }
            }
        }

        var guildData = null;
        if(this.guildId && db && db.getGuildById) {
            var g = db.getGuildById(this.guildId);
            if(g) {
                var membersWithStatus = _.map(g.members, function(memberName) {
                    var onlineP = self.server.getPlayerByName(memberName);
                    return {
                        name: memberName,
                        online: !!(onlineP && !onlineP.isDead),
                        isLeader: (memberName === g.leader)
                    };
                });
                guildData = {
                    id: g.id,
                    tag: g.tag,
                    name: g.name,
                    leader: g.leader,
                    members: membersWithStatus,
                    bank_gold: g.bank_gold || 0,
                    quest_kills: g.quest_kills || 0,
                    quest_target: g.quest_target || 1000,
                    quest_level: g.quest_level || 1,
                    has_hall: g.has_hall || 0
                };
            } else {
                this.guildId = null;
            }
        }

        var onlinePlayers = [];
        this.server.forEachPlayer(function(p) {
            if(p && p.hasEnteredGame && !p.isDead) {
                onlinePlayers.push({
                    id: p.id,
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    hp: p.hitPoints,
                    maxHp: p.maxHitPoints,
                    gold: p.gold || 0,
                    weapon: Types.getKindAsString(p.weapon) || "sword1",
                    armor: Types.getKindAsString(p.armor) || "clotharmor",
                    guildId: p.guildId || null
                });
            }
        });

        var marketItems = (db && db.getMarketItems) ? db.getMarketItems() : [];
        marketItems = _.map(marketItems, function(m) {
            m.rarity = Types.getItemRarity ? Types.getItemRarity(m.item_kind) : "common";
            m.rarityLabel = Types.getItemRarityLabel ? Types.getItemRarityLabel(m.item_kind) : "Commun";
            return m;
        });

        // Construire les 6 emplacements du Sac à dos avec rareté
        var inventorySlots = [];
        for(var idx = 0; idx < 6; idx++) {
            var k = this.inventory[idx];
            var kStr = k ? Types.getKindAsString(k) : null;
            if(k && kStr) {
                inventorySlots.push({
                    slot: idx,
                    kind: kStr,
                    name: Types.getFrenchItemName ? Types.getFrenchItemName(k) : kStr,
                    count: this.inventoryCount[idx] || 1,
                    rarity: Types.getItemRarity ? Types.getItemRarity(k) : "common",
                    rarityLabel: Types.getItemRarityLabel ? Types.getItemRarityLabel(k) : "Commun",
                    isWeapon: !!Types.isWeapon(k),
                    isArmor: !!Types.isArmor(k),
                    isHealing: !!Types.isHealingItem(k)
                });
            } else {
                inventorySlots.push({
                    slot: idx,
                    kind: null,
                    name: "Emplacement vide",
                    count: 0,
                    rarity: "common",
                    rarityLabel: "",
                    isWeapon: false,
                    isArmor: false,
                    isHealing: false
                });
            }
        }

        var payload = {
            gold: this.gold || 0,
            lives: (typeof this.lives === 'number' && this.lives > 0) ? this.lives : 3,
            isAdmin: (this.admin === 1),
            weapon: Types.getKindAsString(this.weapon) || "sword1",
            weaponName: Types.getFrenchItemName ? Types.getFrenchItemName(this.weapon) : "Épée",
            weaponRarity: Types.getItemRarity ? Types.getItemRarity(this.weapon) : "common",
            weaponRarityLabel: Types.getItemRarityLabel ? Types.getItemRarityLabel(this.weapon) : "Commun",
            armor: Types.getKindAsString(this.armor) || "clotharmor",
            armorName: Types.getFrenchItemName ? Types.getFrenchItemName(this.armor) : "Armure",
            armorRarity: Types.getItemRarity ? Types.getItemRarity(this.armor) : "common",
            armorRarityLabel: Types.getItemRarityLabel ? Types.getItemRarityLabel(this.armor) : "Commun",
            inventorySlots: inventorySlots,
            inGuildHall: !!(this.guildId && this.instanceId === ("guild_" + this.guildId)),
            shopItems: this.getShopCatalog(),
            marketItems: marketItems,
            guild: guildData,
            guildInvites: this.pendingGuildInvites || [],
            onlinePlayers: onlinePlayers
        };
        if(noticeText) {
            payload.notice = { text: noticeText, isError: !!isError };
        }

        this.send(new Messages.Hub("state", payload).serialize());
    },

    giveOrEquipItem: function(kindName) {
        var kind = Types.getKindFromString(kindName);
        if(!kind) return false;
        var db = this.databaseHandler;

        // Place directement dans le Sac à dos sans forcer l'équipement
        var added = this.addToInventory(kind, 1, db);
        if(added && db && db.savePlayer) {
            db.savePlayer(this);
        }
        return added;
    },

    handleHubMessage: function(subAction, data) {
        var self = this,
            db = this.databaseHandler;
        data = data || {};

        if(Economy.handles(subAction) && !this._economyTransactionActive) {
            try {
                return Economy.run(this, subAction, data, function() {
                    return self.handleHubMessage(subAction, data);
                });
            } catch(error) {
                log.error('Economic operation rolled back (' + subAction + '): ' + error.message);
                this.sendHubNotice("Opération annulée. Aucun or ni objet n'a été transféré. Réessayez.", true);
                return;
            }
        }

        if(subAction === "refresh") {
            this.sendHubState();
            return;
        }

        // ======= 0. SAC À DOS (INVENTAIRE : ÉQUIPER / BOIRE / JETER) =======
        if(subAction === "bag_equip") {
            var slotIdx = parseInt(data.slot, 10);
            if(isNaN(slotIdx) || slotIdx < 0 || slotIdx >= 6 || !this.inventory[slotIdx]) {
                this.sendHubNotice("Emplacement d'inventaire vide.", true);
                return;
            }
            var itemKind = this.inventory[slotIdx];
            var itemNameFr = Types.getFrenchItemName ? Types.getFrenchItemName(itemKind) : Types.getKindAsString(itemKind);

            if(Types.isWeapon(itemKind)) {
                var prevWeapon = this.weapon;
                this.equipWeapon(itemKind);
                this.broadcast(this.equip(itemKind), false);
                this.send(this.equip(itemKind).serialize());
                if(prevWeapon && prevWeapon !== Types.Entities.SWORD1) {
                    this.inventory[slotIdx] = prevWeapon;
                    this.inventoryCount[slotIdx] = 1;
                    db.setInventory(this.name, prevWeapon, slotIdx, 1);
                    this.send(new Messages.Inventory(slotIdx, prevWeapon, 1).serialize());
                } else {
                    this.inventory[slotIdx] = null;
                    this.inventoryCount[slotIdx] = 0;
                    db.makeEmptyInventory(this.name, slotIdx);
                    this.send(new Messages.Inventory(slotIdx, null, 0).serialize());
                }
                if(db && db.savePlayer) db.savePlayer(this);
                this.sendHubState("Arme équipée : " + itemNameFr + " !", false);
                return;
            } else if(Types.isArmor(itemKind)) {
                var prevArmor = this.armor,
                    previousHp = this.hitPoints;
                this.equipArmor(itemKind);
                this.updateHitPoints();
                this.hitPoints = Math.min(previousHp, this.maxHitPoints);
                this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
                this.send(this.health().serialize());
                this.broadcast(this.equip(itemKind), false);
                this.send(this.equip(itemKind).serialize());
                if(prevArmor && prevArmor !== Types.Entities.CLOTHARMOR) {
                    this.inventory[slotIdx] = prevArmor;
                    this.inventoryCount[slotIdx] = 1;
                    db.setInventory(this.name, prevArmor, slotIdx, 1);
                    this.send(new Messages.Inventory(slotIdx, prevArmor, 1).serialize());
                } else {
                    this.inventory[slotIdx] = null;
                    this.inventoryCount[slotIdx] = 0;
                    db.makeEmptyInventory(this.name, slotIdx);
                    this.send(new Messages.Inventory(slotIdx, null, 0).serialize());
                }
                if(db && db.savePlayer) db.savePlayer(this);
                this.sendHubState("Armure équipée : " + itemNameFr + " !", false);
                return;
            } else if(Types.isHealingItem(itemKind)) {
                var healAmount = 0;
                if(itemKind === Types.Entities.FLASK) healAmount = 40;
                else if(itemKind === Types.Entities.BURGER) healAmount = 100;
                else if(itemKind === Types.Entities.CAKE) healAmount = 60;

                if(healAmount > 0 && !this.hasFullHealth()) {
                    this.regenHealthBy(healAmount);
                    this.server.pushToPlayer(this, this.health());
                }
                this.inventoryCount[slotIdx] -= 1;
                if(this.inventoryCount[slotIdx] <= 0) {
                    this.inventory[slotIdx] = null;
                    this.inventoryCount[slotIdx] = 0;
                    db.makeEmptyInventory(this.name, slotIdx);
                } else {
                    db.setInventory(this.name, itemKind, slotIdx, this.inventoryCount[slotIdx]);
                }
                this.send(new Messages.Inventory(slotIdx, this.inventory[slotIdx], this.inventoryCount[slotIdx]).serialize());
                if(db && db.savePlayer) db.savePlayer(this);
                this.sendHubState(itemNameFr + " utilisé(e) (+" + healAmount + " PV) !", false);
                return;
            }
            return;
        }

        if(subAction === "bag_drop") {
            var dropSlot = parseInt(data.slot, 10);
            if(isNaN(dropSlot) || dropSlot < 0 || dropSlot >= 6 || !this.inventory[dropSlot]) {
                this.sendHubNotice("Emplacement vide.", true);
                return;
            }
            var dropKind = this.inventory[dropSlot];
            var dropNameFr = Types.getFrenchItemName ? Types.getFrenchItemName(dropKind) : Types.getKindAsString(dropKind);
            var droppedItem = this.server.addItemFromChest(dropKind, this.x, this.y);
            if(droppedItem) {
                droppedItem.instanceId = this.instanceId || null;
                this.server.handleItemDespawn(droppedItem);
            }
            if(Types.isHealingItem(dropKind) && this.inventoryCount[dropSlot] > 1) {
                this.inventoryCount[dropSlot] -= 1;
                db.setInventory(this.name, dropKind, dropSlot, this.inventoryCount[dropSlot]);
            } else {
                this.inventory[dropSlot] = null;
                this.inventoryCount[dropSlot] = 0;
                db.makeEmptyInventory(this.name, dropSlot);
            }
            this.send(new Messages.Inventory(dropSlot, this.inventory[dropSlot], this.inventoryCount[dropSlot]).serialize());
            if(db && db.savePlayer) db.savePlayer(this);
            this.sendHubState(dropNameFr + " déposé(e) au sol.", false);
            return;
        }

        // ======= 1. BOUTIQUE & MARCHÉ DES JOUEURS (HDV) =======
        if(subAction === "shop_buy") {
            var itemKindStr = Utils.sanitize(String(data.itemKind || ""));
            var shopItem = _.find(this.getShopCatalog(), function(it) { return it.kind === itemKindStr; });
            if(!shopItem) {
                this.sendHubNotice("Objet introuvable dans la boutique.", true);
                return;
            }
            if((this.gold || 0) < shopItem.price) {
                this.sendHubNotice("Or insuffisant ! Il vous faut " + shopItem.price + " Or.", true);
                return;
            }
            if(!this.giveOrEquipItem(shopItem.kind)) {
                this.sendHubNotice("Votre sac à dos est plein ! Libérez un emplacement.", true);
                return;
            }
            this.gold -= shopItem.price;
            if(db && db.savePlayer) db.savePlayer(this);
            this.sendHubState("Achat placé dans votre Sac à dos : " + shopItem.name + " (-" + shopItem.price + " Or) !", false);
            return;
        }

        if(subAction === "market_sell") {
            var slotType = data.slotType; // "weapon" ou "armor"
            var price = parseInt(data.price, 10);
            if(isNaN(price) || price < 1 || price > 999999) {
                this.sendHubNotice("Veuillez entrer un prix valide (entre 1 et 999999 Or).", true);
                return;
            }
            if(slotType === "weapon") {
                var currentWeaponStr = Types.getKindAsString(this.weapon);
                if(!currentWeaponStr || currentWeaponStr === "sword1") {
                    this.sendHubNotice("Vous ne pouvez pas vendre l'épée de départ !", true);
                    return;
                }
                db.addMarketItem(this.name, currentWeaponStr, "weapon", price);
                this.equipItem(Types.Entities.SWORD1, false);
                this.broadcast(this.equip(Types.Entities.SWORD1), false);
                this.send(this.equip(Types.Entities.SWORD1).serialize());
                db.savePlayer(this);
                this.sendHubState("Votre arme a été mise en vente pour " + price + " Or !", false);
            } else if(slotType === "armor") {
                var currentArmorStr = Types.getKindAsString(this.armor);
                if(!currentArmorStr || currentArmorStr === "clotharmor") {
                    this.sendHubNotice("Vous ne pouvez pas vendre la tunique de départ !", true);
                    return;
                }
                db.addMarketItem(this.name, currentArmorStr, "armor", price);
                this.equipItem(Types.Entities.CLOTHARMOR, false);
                this.broadcast(this.equip(Types.Entities.CLOTHARMOR), false);
                this.send(this.equip(Types.Entities.CLOTHARMOR).serialize());
                db.savePlayer(this);
                this.sendHubState("Votre armure a été mise en vente pour " + price + " Or !", false);
            }
            return;
        }

        if(subAction === "market_buy") {
            var marketId = parseInt(data.marketId, 10);
            var listing = db.getMarketItemById(marketId);
            if(!listing) {
                this.sendHubState("Cet objet a déjà été vendu ou retiré.", true);
                return;
            }
            if(!Number.isSafeInteger(listing.price) || listing.price < 1 ||
                    !Types.getKindFromString(listing.item_kind) ||
                    !db.stmtGetPlayer.get(listing.seller)) {
                this.sendHubNotice("Cette annonce n'est plus valide.", true);
                return;
            }
            // Si le joueur rachète sa propre annonce -> retrait gratuit
            if(listing.seller === this.name) {
                if(!this.giveOrEquipItem(listing.item_kind)) {
                    this.sendHubNotice("Votre sac à dos est plein !", true);
                    return;
                }
                db.removeMarketItem(marketId);
                db.savePlayer(this);
                this.sendHubState("Vous avez récupéré votre objet dans votre Sac à dos.", false);
                return;
            }
            if((this.gold || 0) < listing.price) {
                this.sendHubNotice("Or insuffisant ! Il vous faut " + listing.price + " Or.", true);
                return;
            }
            if(!this.giveOrEquipItem(listing.item_kind)) {
                this.sendHubNotice("Votre sac à dos est plein ! Libérez un emplacement.", true);
                return;
            }
            this.gold -= listing.price;
            db.removeMarketItem(marketId);
            db.savePlayer(this);

            // Créditer le vendeur (en ligne ou hors ligne dans SQLite)
            var sellerOnline = Economy.findOnlinePlayer(this, listing.seller);
            if(sellerOnline) {
                sellerOnline.gold = (sellerOnline.gold || 0) + listing.price;
                db.savePlayer(sellerOnline);
                sellerOnline.sendHubState(this.name + " a acheté votre objet pour +" + listing.price + " Or !", false);
            } else {
                if(db.addGoldToUsername(listing.seller, listing.price) === null) {
                    throw new Error('Seller no longer exists');
                }
            }

            this.sendHubState("Objet acheté à " + listing.seller + " et placé dans votre Sac à dos !", false);
            return;
        }

        // ======= 2. SYSTÈME DE GUILDE 3.0 (TRÉSORERIE, QUÊTES, SALON PRIVÉ, BOSS) =======
        if(subAction === "guild_create") {
            if(this.guildId) {
                this.sendHubNotice("Vous êtes déjà dans une guilde.", true);
                return;
            }
            var tag = Utils.sanitize(String(data.tag || "")).trim().toUpperCase().substr(0, 4);
            var gName = Utils.sanitize(String(data.name || "")).trim().substr(0, 20);
            if(tag.length < 2 || gName.length < 3) {
                this.sendHubNotice("Le TAG (2-4 lettres) et le Nom (3+ lettres) sont requis.", true);
                return;
            }
            if((this.gold || 0) < 100) {
                this.sendHubNotice("Il vous faut 100 Or pour fonder une guilde !", true);
                return;
            }
            var existingG = db.getGuildByNameOrTag(tag, gName);
            if(existingG) {
                this.sendHubNotice("Ce TAG ou ce nom de guilde existe déjà !", true);
                return;
            }
            this.gold -= 100;
            var newGuild = db.createGuild(tag, gName, this.name);
            this.guildId = newGuild.id;
            db.savePlayer(this);
            this.sendHubState("Guilde [" + tag + "] " + gName + " créée avec succès (-100 Or) !", false);
            return;
        }

        if(subAction === "guild_deposit") {
            if(!this.guildId) {
                this.sendHubNotice("Vous devez être dans une guilde.", true);
                return;
            }
            var depAmount = parseInt(data.amount, 10);
            if(!Number.isSafeInteger(depAmount) || depAmount < 1) {
                this.sendHubNotice("Montant invalide.", true);
                return;
            }
            if((this.gold || 0) < depAmount) {
                this.sendHubNotice("Vous n'avez pas assez d'Or personnel (" + (this.gold || 0) + " Or).", true);
                return;
            }
            this.gold -= depAmount;
            var gAfterDep = db.depositGuildGold(this.guildId, depAmount);
            if(!gAfterDep) throw new Error('Guild no longer exists');
            db.savePlayer(this);
            this.sendHubState("Vous avez déposé +" + depAmount + " Or dans la Trésorerie de Guilde !", false);
            if(gAfterDep) {
                _.each(gAfterDep.members, function(mName) {
                    if(mName !== self.name) {
                        var mp = self.server.getPlayerByName(mName);
                        if(mp) mp.sendHubState(self.name + " a déposé +" + depAmount + " Or dans la Banque de Guilde !", false);
                    }
                });
            }
            return;
        }

        if(subAction === "guild_buy_hall") {
            if(!this.guildId) return;
            var gHall = db.getGuildById(this.guildId);
            if(!gHall || gHall.leader !== this.name) {
                this.sendHubNotice("Seul le Chef de Guilde peut acheter le Salon de Guilde.", true);
                return;
            }
            if(gHall.has_hall === 1) {
                this.sendHubNotice("Votre guilde possède déjà son Salon Privé !", true);
                return;
            }
            var hallCost = 50000;
            var bankGold = gHall.bank_gold || 0;
            var playerGold = this.gold || 0;
            if(bankGold >= hallCost) {
                db.spendGuildBankGold(this.guildId, hallCost);
            } else if((bankGold + playerGold) >= hallCost) {
                var neededFromPlayer = hallCost - bankGold;
                if(bankGold > 0) db.spendGuildBankGold(this.guildId, bankGold);
                this.gold -= neededFromPlayer;
                db.savePlayer(this);
            } else {
                this.sendHubNotice("Fonds insuffisants ! Il faut 50 000 Or (Banque : " + bankGold + " Or, Vous : " + playerGold + " Or).", true);
                return;
            }
            var unlockedGuild = db.unlockGuildHall(this.guildId);
            if(unlockedGuild) {
                _.each(unlockedGuild.members, function(mName) {
                    var mp = self.server.getPlayerByName(mName);
                    if(mp) mp.sendHubState("🏰 Le Salon Privé de la guilde [" + unlockedGuild.tag + "] est débloqué ! Vous pouvez vous y téléporter !", false);
                });
            }
            return;
        }

        if(subAction === "guild_tp_hall") {
            if(!this.guildId) return;
            var gTp = db.getGuildById(this.guildId);
            if(!gTp || gTp.has_hall !== 1) {
                this.sendHubNotice("Votre guilde n'a pas encore débloqué le Salon Privé (50 000 Or).", true);
                return;
            }
            // Retirer le joueur de son ancienne instance/groupe public avant d'entrer dans l'instance de guilde
            this.server.handlePlayerVanish(this);
            this.instanceId = "guild_" + this.guildId;
            this.setPosition(155, 284);
            this.server.handleEntityGroupMembership(this);
            this.clearTarget();
            this.send(new Messages.Teleport(this).serialize());
            this.broadcast(new Messages.Teleport(this), false);
            this.server.pushRelevantEntityListTo(this);
            this.sendHubState("✨ Bienvenue dans le Salon Privé de [" + gTp.tag + "] " + gTp.name + " !", false);
            return;
        }

        if(subAction === "guild_leave_hall") {
            if(!this.guildId || this.instanceId !== ("guild_" + this.guildId)) return;
            this.server.handlePlayerVanish(this);
            this.instanceId = null;
            this.setPosition(43, 210);
            this.server.handleEntityGroupMembership(this);
            this.clearTarget();
            this.send(new Messages.Teleport(this).serialize());
            this.broadcast(new Messages.Teleport(this), false);
            this.server.pushRelevantEntityListTo(this);
            this.sendHubState("Vous êtes de retour au village principal.", false);
            return;
        }

        if(subAction === "guild_summon_boss") {
            if(!this.guildId) return;
            var gBoss = db.getGuildById(this.guildId);
            if(!gBoss || gBoss.leader !== this.name) {
                this.sendHubNotice("Seul le Chef de Guilde peut invoquer un Boss de Guilde.", true);
                return;
            }
            if(gBoss.has_hall !== 1 || this.instanceId !== ("guild_" + this.guildId)) {
                this.sendHubNotice("Vous devez vous trouver à l'intérieur du Salon de Guilde pour invoquer le Boss !", true);
                return;
            }
            var summonCost = 5000;
            if((gBoss.bank_gold || 0) < summonCost && (this.gold || 0) < summonCost) {
                this.sendHubNotice("Il faut 5 000 Or (dans la Banque de Guilde ou sur vous) pour invoquer un Boss de Guilde !", true);
                return;
            }
            if((gBoss.bank_gold || 0) >= summonCost) {
                db.spendGuildBankGold(this.guildId, summonCost);
            } else {
                this.gold -= summonCost;
                db.savePlayer(this);
            }
            var bossKindChoice = Utils.sanitize(String(data.bossKind || "seigneurmort")).trim();
            if(!Types.isBoss(Types.getKindFromString(bossKindChoice))) {
                throw new Error('Invalid guild boss');
            }
            var spawnedGuildBoss = this.server.spawnGuildBoss(this.guildId, bossKindChoice);
            Economy.recordSpawn(this, spawnedGuildBoss);
            var bossNameFr = Types.getBossDisplayName(spawnedGuildBoss.kind);
            _.each(gBoss.members, function(mName) {
                var mp = self.server.getPlayerByName(mName);
                if(mp) {
                    mp.sendHubState("👹 " + bossNameFr + " a été invoqué dans le Salon de Guilde ! Tous les participants recevront Or et Équipement dans leur Sac !", false);
                }
            });
            return;
        }

        if(subAction === "guild_spawn_chest") {
            if(!this.guildId) return;
            var gChest = db.getGuildById(this.guildId);
            if(!gChest || gChest.leader !== this.name) {
                this.sendHubNotice("Seul le Chef de guilde peut poser un Coffre de Guilde.", true);
                return;
            }
            var chestCost = 1000;
            if((gChest.bank_gold || 0) < chestCost && this.gold < chestCost) {
                this.sendHubNotice("Il faut 1 000 Or (dans la Banque de Guilde ou sur vous) pour poser un Coffre de Guilde !", true);
                return;
            }
            if((gChest.bank_gold || 0) >= chestCost) {
                db.spendGuildBankGold(this.guildId, chestCost);
            } else {
                this.gold -= chestCost;
                db.savePlayer(this);
            }
            var guildChestItems = ["goldensword", "goldenarmor", "redsword", "redarmor", "bluesword", "platearmor", "morningstar", "burger", "firepotion"];
            var spawnedChest = this.server.spawnCustomChest(this.x, this.y, guildChestItems, this.instanceId || null);
            Economy.recordSpawn(this, spawnedChest);
            _.each(gChest.members, function(mName) {
                var mp = self.server.getPlayerByName(mName);
                if(mp) {
                    mp.sendHubState("🎁 Le Chef " + self.name + " a posé un Coffre au Trésor de Guilde en (" + spawnedChest.x + ", " + spawnedChest.y + ") ! Cliquez dessus pour l'ouvrir !", false);
                }
            });
            return;
        }

        if(subAction === "guild_invite") {
            if(!this.guildId) return;
            var guild = db.getGuildById(this.guildId);
            if(!guild) return;
            var targetName = Utils.sanitize(String(data.targetName || "")).trim();
            var targetPlayer = this.server.getPlayerByName(targetName);
            if(!targetPlayer || targetPlayer.isDead) {
                this.sendHubNotice("Le joueur " + targetName + " n'est pas connecté.", true);
                return;
            }
            if(targetPlayer.guildId) {
                this.sendHubNotice(targetName + " appartient déjà à une guilde.", true);
                return;
            }
            targetPlayer.pendingGuildInvites = targetPlayer.pendingGuildInvites || [];
            var alreadyInvited = _.find(targetPlayer.pendingGuildInvites, function(inv) { return inv.guildId === guild.id; });
            if(!alreadyInvited) {
                targetPlayer.pendingGuildInvites.push({
                    guildId: guild.id,
                    tag: guild.tag,
                    name: guild.name,
                    inviter: this.name
                });
            }
            targetPlayer.sendHubState("Invitation reçue pour rejoindre la guilde [" + guild.tag + "] " + guild.name + " !", false);
            this.sendHubNotice("Invitation envoyée à " + targetName + " !", false);
            return;
        }

        if(subAction === "guild_accept") {
            var inviteGuildId = parseInt(data.guildId, 10);
            if(this.guildId) {
                this.sendHubNotice("Vous avez déjà une guilde.", true);
                return;
            }
            var validInvite = _.find(this.pendingGuildInvites || [], function(invite) {
                return invite.guildId === inviteGuildId;
            });
            if(!validInvite) {
                this.sendHubNotice("Vous n'avez pas d'invitation pour cette guilde.", true);
                return;
            }
            var joinedGuild = db.addGuildMember(inviteGuildId, this.name);
            if(!joinedGuild) {
                this.sendHubNotice("Cette guilde n'existe plus.", true);
                return;
            }
            this.guildId = joinedGuild.id;
            this.pendingGuildInvites = [];
            db.savePlayer(this);
            this.sendHubState("Vous avez rejoint la guilde [" + joinedGuild.tag + "] " + joinedGuild.name + " !", false);

            // Notifier les autres membres en ligne
            _.each(joinedGuild.members, function(mName) {
                if(mName !== self.name) {
                    var mp = self.server.getPlayerByName(mName);
                    if(mp) mp.sendHubState(self.name + " a rejoint la guilde !", false);
                }
            });
            return;
        }

        if(subAction === "guild_decline") {
            var decGuildId = parseInt(data.guildId, 10);
            this.pendingGuildInvites = _.reject(this.pendingGuildInvites || [], function(inv) { return inv.guildId === decGuildId; });
            this.sendHubState("Invitation refusée.", false);
            return;
        }

        if(subAction === "guild_leave") {
            if(!this.guildId) return;
            if(this.instanceId === ("guild_" + this.guildId)) {
                this.server.handlePlayerVanish(this);
                this.instanceId = null;
                this.setPosition(43, 210);
                this.server.handleEntityGroupMembership(this);
                this.send(new Messages.Teleport(this).serialize());
            }
            var oldGuildId = this.guildId;
            var updatedGuild = db.removeGuildMember(oldGuildId, this.name);
            this.guildId = null;
            db.savePlayer(this);
            this.sendHubState("Vous avez quitté la guilde.", false);
            if(updatedGuild) {
                _.each(updatedGuild.members, function(mName) {
                    var mp = self.server.getPlayerByName(mName);
                    if(mp) mp.sendHubState(self.name + " a quitté la guilde.", false);
                });
            }
            return;
        }

        if(subAction === "guild_kick") {
            if(!this.guildId) return;
            var myGuild = db.getGuildById(this.guildId);
            if(!myGuild || myGuild.leader !== this.name) {
                this.sendHubNotice("Seul le chef de guilde peut exclure un membre.", true);
                return;
            }
            var kickName = Utils.sanitize(String(data.targetName || "")).trim();
            if(kickName === this.name) return;
            if(myGuild.members.indexOf(kickName) === -1) {
                this.sendHubNotice("Ce joueur ne fait pas partie de votre guilde.", true);
                return;
            }
            db.removeGuildMember(this.guildId, kickName);
            var kickedPlayer = this.server.getPlayerByName(kickName);
            if(kickedPlayer) {
                if(kickedPlayer.instanceId === ("guild_" + this.guildId)) {
                    this.server.handlePlayerVanish(kickedPlayer);
                    kickedPlayer.instanceId = null;
                    kickedPlayer.setPosition(43, 210);
                    this.server.handleEntityGroupMembership(kickedPlayer);
                    kickedPlayer.send(new Messages.Teleport(kickedPlayer).serialize());
                }
                kickedPlayer.guildId = null;
                db.savePlayer(kickedPlayer);
                kickedPlayer.sendHubState("Vous avez été exclu de la guilde [" + myGuild.tag + "].", true);
            }
            this.sendHubState(kickName + " a été exclu de la guilde.", false);
            return;
        }

        if(subAction === "guild_chat") {
            if(!this.guildId) {
                this.sendHubNotice("Vous n'êtes dans aucune guilde !", true);
                return;
            }
            var chatGuild = db.getGuildById(this.guildId);
            if(!chatGuild) return;
            var gMsg = Utils.sanitize(String(data.message || "")).trim().substr(0, 60);
            if(!gMsg) return;

            _.each(chatGuild.members, function(mName) {
                var mp = self.server.getPlayerByName(mName);
                if(mp) {
                    mp.send(new Messages.Hub("guild_chat", {
                        senderId: self.id,
                        sender: self.name,
                        tag: chatGuild.tag,
                        message: gMsg
                    }).serialize());
                }
            });
            return;
        }

        // ======= VOYAGES & TÉLÉPORTATIONS CARTE =======
        if(subAction === "map_teleport") {
            var destKey = String(data.destination || "").trim().toLowerCase();
            var destinations = {
                village: { name: "Village de Départ", x: 43, y: 210 },
                beach: { name: "Plage du Sud", x: 110, y: 280 },
                forest: { name: "Grande Forêt", x: 65, y: 160 },
                desert: { name: "Désert Aride", x: 145, y: 175 },
                lavacave: { name: "Caverne de Lave", x: 150, y: 80 },
                castle: { name: "Château Royal", x: 155, y: 275 },
                graveyard: { name: "Cimetière Maudit", x: 25, y: 45 },
                bossroom: { name: "Antre des Boss Mondiaux", x: 45, y: 105 }
            };
            var dest = destinations[destKey];
            if(!dest) {
                this.sendHubNotice("Destination inconnue.", true);
                return;
            }
            if(this.instanceId && this.instanceId.indexOf("guild_") === 0) {
                this.server.handlePlayerVanish(this);
                this.instanceId = null;
            } else {
                this.server.handlePlayerVanish(this);
            }
            this.setPosition(dest.x, dest.y);
            this.server.handleEntityGroupMembership(this);
            this.clearTarget();
            this.send(new Messages.Teleport(this).serialize());
            this.broadcast(new Messages.Teleport(this), false);
            this.server.pushRelevantEntityListTo(this);
            this.sendHubNotice("🗺️ Téléportation vers : " + dest.name + " (" + dest.x + ", " + dest.y + ") !", false);
            return;
        }

        // ======= 3. PANNEAU ADMIN (100% BOUTONS, VÉRIFIÉ SERVEUR) =======
        var adminRow = db.stmtGetPlayer.get(this.name);
        this.admin = (adminRow && adminRow.is_admin === 1) ? 1 : 0;
        if(this.admin !== 1) {
            this.sendHubNotice("Accès refusé : vous n'êtes pas Administrateur.", true);
            return;
        }

        if(subAction === "admin_tp") {
            var tpTarget = this.server.getPlayerByName(data.targetName);
            if(!tpTarget) {
                this.sendHubNotice("Joueur introuvable.", true);
                return;
            }
            this.instanceId = tpTarget.instanceId || null;
            this.setPosition(tpTarget.x, tpTarget.y);
            this.clearTarget();
            this.broadcast(new Messages.Teleport(this), false);
            this.send(new Messages.Teleport(this).serialize());
            this.server.handlePlayerVanish(this);
            this.server.pushRelevantEntityListTo(this);
            db.savePlayer(this);
            this.sendHubState("Téléporté sur " + tpTarget.name + " (" + tpTarget.x + ", " + tpTarget.y + ") !", false);
            return;
        }

        if(subAction === "admin_gold") {
            var goldTarget = this.server.getPlayerByName(data.targetName);
            if(!goldTarget) {
                this.sendHubNotice("Joueur introuvable.", true);
                return;
            }
            goldTarget.gold = (goldTarget.gold || 0) + 500;
            db.savePlayer(goldTarget);
            goldTarget.sendHubState("Un Admin vous a offert +500 Or !", false);
            if(goldTarget.name !== this.name) {
                this.sendHubState("+500 Or envoyés à " + goldTarget.name + " !", false);
            }
            return;
        }

        if(subAction === "admin_give_goldensword") {
            var swordTarget = this.server.getPlayerByName(data.targetName);
            if(!swordTarget) {
                this.sendHubNotice("Joueur introuvable.", true);
                return;
            }
            swordTarget.giveOrEquipItem("goldensword");
            swordTarget.sendHubState("Un Admin vous a offert l'Épée d'Or Légendaire (dans votre Sac à dos) !", false);
            if(swordTarget.name !== this.name) {
                this.sendHubState("Épée d'Or donnée à " + swordTarget.name + " !", false);
            }
            return;
        }

        if(subAction === "admin_heal") {
            var healTarget = this.server.getPlayerByName(data.targetName);
            if(!healTarget) {
                this.sendHubNotice("Joueur introuvable.", true);
                return;
            }
            healTarget.hitPoints = healTarget.maxHitPoints;
            this.server.pushToPlayer(healTarget, healTarget.health());
            db.savePlayer(healTarget);
            healTarget.sendHubNotice("Vos PV ont été restaurés au maximum par un Admin !", false);
            this.sendHubState(healTarget.name + " a été soigné à 100% !", false);
            return;
        }

        if(subAction === "admin_kick") {
            var kickTarget = this.server.getPlayerByName(data.targetName);
            if(!kickTarget) {
                this.sendHubNotice("Joueur introuvable.", true);
                return;
            }
            if(kickTarget.name === this.name) {
                this.sendHubNotice("Vous ne pouvez pas vous exclure vous-même.", true);
                return;
            }
            kickTarget.connection.close("Exclu par l'administrateur " + this.name);
            this.sendHubState(kickTarget.name + " a été expulsé (Kick) du serveur.", false);
            return;
        }

        if(subAction === "admin_ban") {
            var banName = Utils.sanitize(String(data.targetName || "")).trim();
            if(!banName || banName === this.name) {
                this.sendHubNotice("Action impossible sur votre propre compte.", true);
                return;
            }
            db.setPlayerBanned(banName, true);
            var banTarget = this.server.getPlayerByName(banName);
            if(banTarget) {
                banTarget.connection.sendUTF8("banned");
                banTarget.connection.close("Banni par l'administrateur " + this.name);
            }
            this.sendHubState(banName + " a été banni définitivement.", false);
            return;
        }

        if(subAction === "admin_spawn") {
            var mobKindName = Utils.sanitize(String(data.mobKind || "")).trim();
            var spawnedMob = this.server.spawnMobFromAdmin(mobKindName, this.x, this.y);
            if(!spawnedMob) {
                this.sendHubNotice("Monstre invalide : " + mobKindName, true);
                return;
            }
            if(this.instanceId) {
                spawnedMob.instanceId = this.instanceId;
            }
            this.sendHubNotice("Monstre '" + mobKindName + "' invoqué à vos côtés !", false);
            return;
        }

        if(subAction === "admin_spawn_chest") {
            var adminChestItems = ["goldensword", "goldenarmor", "redsword", "redarmor", "bluesword", "platearmor", "firepotion", "burger"];
            var admChest = this.server.spawnCustomChest(this.x, this.y, adminChestItems, this.instanceId || null);
            if(admChest) {
                this.sendHubNotice("🎁 Coffre Légendaire posé en (" + admChest.x + ", " + admChest.y + ") !", false);
            }
            return;
        }

        if(subAction === "admin_announce") {
            var announceText = Utils.sanitize(String(data.text || "")).trim().substr(0, 120);
            if(!announceText) {
                this.sendHubNotice("Veuillez écrire un message d'annonce.", true);
                return;
            }
            this.server.pushBroadcast(new Messages.Hub("announcement", {
                author: this.name,
                text: announceText
            }));
            this.sendHubNotice("Annonce envoyée à tout le serveur !", false);
            return;
        }
    },
	    checkName: function(name){
        if(name === null || name === undefined) return false;
        name = String(name).trim();
        if(name === '' || name.length < 1 || name.length > 12) return false;

        for(var i=0; i < name.length; i++){
            var c = name.charCodeAt(i);

           if(!((0xAC00 <= c && c <= 0xD7A3) || (0x3131 <= c && c <= 0x318E)
             || (0x61 <= c && c <= 0x7A) || (0x41 <= c && c <= 0x5A)
             || (0x30 <= c && c <= 0x39) || c === 0x5F || c === 0x2D
             || (0x00C0 <= c && c <= 0x017F))){
               return false;
           }
        }
        return true;
    },

});
