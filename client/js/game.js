
define(['infomanager', 'bubble', 'renderer', 'map', 'animation', 'sprite',
        'tile', 'warrior', 'gameclient', 'audio', 'updater', 'transition',
        'pathfinder', 'item', 'mob', 'npc', 'player', 'character', 'chest',
        'mobs', 'exceptions', 'config', 'guild', 'door_diagnostics', '../../shared/js/gametypes'],
function(InfoManager, BubbleManager, Renderer, Map, Animation, Sprite, AnimatedTile,
         Warrior, GameClient, AudioManager, Updater, Transition, Pathfinder,
         Item, Mob, Npc, Player, Character, Chest, Mobs, Exceptions, config,
         Guild, DoorDiagnostics) {
    var Game = Class.extend({
        init: function(app) {
            this.app = app;
            this.app.config = config;
            this.ready = false;
            this.started = false;
            this.hasNeverStarted = true;

            this.renderer = null;
            this.updater = null;
            this.pathfinder = null;
            this.chatinput = null;
            this.bubbleManager = null;
            this.audioManager = null;

            // Player
            this.player = new Warrior("player", "");
            this.player.moveUp = false;
            this.player.moveDown = false;
            this.player.moveLeft = false;
            this.player.moveRight = false;
            this.player.disableKeyboardNpcTalk = false;

            // Game state
            this.entities = {};
            this.deathpositions = {};
            this.entityGrid = null;
            this.pathingGrid = null;
            this.renderingGrid = null;
            this.itemGrid = null;
            this.currentCursor = null;
            this.mouse = { x: 0, y: 0 };
            this.hasMouseMoved = false;
            this.pingInterval = null;
            this.zoningQueue = [];
            this.previousClickPosition = {};
            this._lastSentMoveX = null;
            this._lastSentMoveY = null;
            this._lastDoorTeleportAt = 0;
            this.doorDiagnostics = (typeof DoorDiagnostics === 'function') ? new DoorDiagnostics(this) : null;
            if(this.doorDiagnostics && typeof this.doorDiagnostics.recordEvent !== 'function') {
                this.doorDiagnostics = null;
            }
            if(typeof window !== 'undefined' && this.doorDiagnostics) {
                window.novaDoorDiagnostics = this.doorDiagnostics;
            }

            this.cursorVisible = false;
            this.selectedX = 0;
            this.selectedY = 0;
            this.selectedCellVisible = false;
            this.targetColor = "rgba(255, 255, 255, 0.5)";
            this.targetCellVisible = true;
            this.hoveringTarget = false;
            this.hoveringPlayer = false;
            this.hoveringMob = false;
            this.hoveringItem = false;
            this.hoveringCollidingTile = false;

            // combat
            this.infoManager = new InfoManager(this);
            this.projectiles = [];

            // zoning
            this.currentZoning = null;

            this.cursors = {};

            this.sprites = {};

            // tile animation
            this.animatedTiles = null;

            // debug
            this.debugPathing = false;
            
            // pvp
            this.pvpFlag = false;

            // sprites
            this.spriteNames = ["hand", "sword", "loot", "target", "talk", "sparks", "shadow16", "rat", "skeleton", "skeleton2", "spectre", "boss", "deathknight",
                                "ogre", "crab", "snake", "eye", "bat", "goblin", "wizard", "guard", "king", "villagegirl", "villager", "coder", "agent", "rick", "scientist", "nyan", "priest",
                                "sorcerer", "octocat", "beachnpc", "forestnpc", "desertnpc", "lavanpc", "clotharmor", "leatherarmor", "mailarmor",
                                "platearmor", "redarmor", "goldenarmor", "firefox", "death", "sword1", "axe", "chest",
                                "sword2", "redsword", "bluesword", "goldensword", "item-sword2", "item-axe", "item-redsword", "item-bluesword", "item-goldensword", "item-leatherarmor", "item-mailarmor",
                                "item-platearmor", "item-redarmor", "item-goldenarmor", "item-flask", "item-cake", "item-burger", "morningstar", "item-morningstar", "item-firepotion", "bow", "goldenbow", "item-bow", "item-goldenbow"];
        },

        setup: function($bubbleContainer, canvas, background, foreground, input) {
            this.setBubbleManager(new BubbleManager($bubbleContainer));
            this.setRenderer(new Renderer(this, canvas, background, foreground));
            this.setChatInput(input);
        },

        setStorage: function(storage) {
            this.storage = storage;
        },

        setRenderer: function(renderer) {
            this.renderer = renderer;
        },

        setUpdater: function(updater) {
            this.updater = updater;
        },

        setPathfinder: function(pathfinder) {
            this.pathfinder = pathfinder;
        },

        setChatInput: function(element) {
            this.chatinput = element;
        },

        setBubbleManager: function(bubbleManager) {
            this.bubbleManager = bubbleManager;
        },

        loadMap: function() {
            var self = this;

            this.map = new Map(!this.renderer.upscaledRendering, this);

            this.map.ready(function() {
                log.info("Map loaded.");
                var tilesetIndex = self.renderer.upscaledRendering ? 0 : self.renderer.scale - 1;
                self.renderer.setTileset(self.map.tilesets[tilesetIndex]);
            });
        },

        initPlayer: function() {
            // Ne jamais écraser l'armure ou l'arme reçues du serveur (SQLite) avec un ancien localStorage
            if(!this.player.getSpriteName() && this.storage.hasAlreadyPlayed() && this.storage.data.player) {
                if(this.storage.data.player.armor && this.storage.data.player.weapon) {
                    this.player.setSpriteName(this.storage.data.player.armor);
                    this.player.setWeaponName(this.storage.data.player.weapon);
                }
                if(this.storage.data.player.guild) {
					this.player.setGuild(this.storage.data.player.guild);
				}
            }

            this.player.setSprite(this.sprites[this.player.getSpriteName()]);
            this.player.idle();

            log.debug("Finished initPlayer");
        },

        initShadows: function() {
            this.shadows = {};
            this.shadows["small"] = this.sprites["shadow16"];
        },

        initCursors: function() {
            this.cursors["hand"] = this.sprites["hand"];
            this.cursors["sword"] = this.sprites["sword"];
            this.cursors["loot"] = this.sprites["loot"];
            this.cursors["target"] = this.sprites["target"];
            this.cursors["arrow"] = this.sprites["arrow"];
            this.cursors["talk"] = this.sprites["talk"];
            this.cursors["join"] = this.sprites["talk"];
        },

        initAnimations: function() {
            this.targetAnimation = new Animation("idle_down", 4, 0, 16, 16);
            this.targetAnimation.setSpeed(50);

            this.sparksAnimation = new Animation("idle_down", 6, 0, 16, 16);
            this.sparksAnimation.setSpeed(120);
        },

        initHurtSprites: function() {
            var self = this;

            Types.forEachArmorKind(function(kind, kindName) {
                self.sprites[kindName].createHurtSprite();
            });
        },

        initSilhouettes: function() {
            var self = this;

            Types.forEachMobOrNpcKind(function(kind, kindName) {
                self.sprites[kindName].createSilhouette();
            });
            self.sprites["chest"].createSilhouette();
            self.sprites["item-cake"].createSilhouette();
        },

        initAchievements: function() {
            var self = this;

            this.achievements = {
                A_TRUE_WARRIOR: {
                    id: 1,
                    name: "Un Vrai Guerrier",
                    desc: "Trouver une nouvelle arme"
                },
                INTO_THE_WILD: {
                    id: 2,
                    name: "À l'Aventure",
                    desc: "S'aventurer hors du village"
                },
                ANGRY_RATS: {
                    id: 3,
                    name: "Rats Enragés",
                    desc: "Tuer 10 rats",
                    isCompleted: function() {
                        return self.storage.getRatCount() >= 10;
                    }
                },
                SMALL_TALK: {
                    id: 4,
                    name: "Bavardage",
                    desc: "Parler à un personnage non-joueur"
                },
                FAT_LOOT: {
                    id: 5,
                    name: "Gros Butin",
                    desc: "Obtenir une nouvelle armure"
                },
                UNDERGROUND: {
                    id: 6,
                    name: "Souterrain",
                    desc: "Explorer au moins une grotte"
                },
                AT_WORLDS_END: {
                    id: 7,
                    name: "Au Bout du Monde",
                    desc: "Atteindre le rivage sud"
                },
                COWARD: {
                    id: 8,
                    name: "Lâche",
                    desc: "Fuir un ennemi avec succès"
                },
                TOMB_RAIDER: {
                    id: 9,
                    name: "Pilleur de Tombes",
                    desc: "Trouver le cimetière"
                },
                SKULL_COLLECTOR: {
                    id: 10,
                    name: "Collectionneur de Crânes",
                    desc: "Tuer 10 squelettes",
                    isCompleted: function() {
                        return self.storage.getSkeletonCount() >= 10;
                    }
                },
                NINJA_LOOT: {
                    id: 11,
                    name: "Butin Ninja",
                    desc: "Ramasser un objet pour lequel vous n'avez pas combattu"
                },
                NO_MANS_LAND: {
                    id: 12,
                    name: "Terres Désolées",
                    desc: "Traverser le désert"
                },
                HUNTER: {
                    id: 13,
                    name: "Chasseur",
                    desc: "Tuer 50 ennemis",
                    isCompleted: function() {
                        return self.storage.getTotalKills() >= 50;
                    }
                },
                STILL_ALIVE: {
                    id: 14,
                    name: "Toujours Vivant",
                    desc: "Ressusciter votre personnage 5 fois",
                    isCompleted: function() {
                        return self.storage.getTotalRevives() >= 5;
                    }
                },
                MEATSHIELD: {
                    id: 15,
                    name: "Bouclier Humain",
                    desc: "Subir 5 000 points de dégâts",
                    isCompleted: function() {
                        return self.storage.getTotalDamageTaken() >= 5000;
                    }
                },
                HOT_SPOT: {
                    id: 16,
                    name: "Zone Brûlante",
                    desc: "Entrer dans les montagnes volcaniques"
                },
                HERO: {
                    id: 17,
                    name: "Héros de Nova",
                    desc: "Vaincre le boss final"
                },
                FOXY: {
                    id: 18,
                    name: "Renard de Feu",
                    desc: "Trouver la potion de feu",
                    hidden: true
                },
                FOR_SCIENCE: {
                    id: 19,
                    name: "Pour la Science",
                    desc: "Entrer dans un portail",
                    hidden: true
                },
                RICKROLLD: {
                    id: 20,
                    name: "Mélomane",
                    desc: "Prendre des cours de chant",
                    hidden: true
                }
            };

            _.each(this.achievements, function(obj) {
                if(!obj.isCompleted) {
                    obj.isCompleted = function() { return true; }
                }
                if(!obj.hidden) {
                    obj.hidden = false;
                }
            });

            this.app.initAchievementList(this.achievements);

            if(this.storage.hasAlreadyPlayed()) {
                this.app.initUnlockedAchievements(this.storage.data.achievements.unlocked);
            }
        },

        getAchievementById: function(id) {
            var found = null;
            _.each(this.achievements, function(achievement, key) {
                if(achievement.id === parseInt(id)) {
                    found = achievement;
                }
            });
            return found;
        },

        loadSprite: function(name) {
            if(this.renderer.upscaledRendering) {
                this.spritesets[0][name] = new Sprite(name, 1);
            } else {
                this.spritesets[1][name] = new Sprite(name, 2);
                if(!this.renderer.mobile && !this.renderer.tablet) {
                    this.spritesets[2][name] = new Sprite(name, 3);
                }
            }
        },

        setSpriteScale: function(scale) {
            var self = this;

            if(!this.spritesets) {
                return;
            }

            if(this.renderer.upscaledRendering) {
                this.sprites = this.spritesets[0];
            } else {
                this.sprites = this.spritesets[scale - 1];

                if(this.ready && this.spritesLoaded()) {
                    _.each(this.entities, function(entity) {
                        entity.sprite = null;
                        entity.setSprite(self.sprites[entity.getSpriteName()]);
                    });
                    this.initHurtSprites();
                    this.initShadows();
                    this.initCursors();
                }
            }
        },

        loadSprites: function() {
            log.info("Loading sprites...");
            this.spritesets = [];
            this.spritesets[0] = {};
            this.spritesets[1] = {};
            this.spritesets[2] = {};
            _.map(this.spriteNames, this.loadSprite, this);
        },

        spritesLoaded: function() {
            if(_.any(this.sprites, function(sprite) { return !sprite.isLoaded; })) {
                return false;
            }
            return true;
        },

        setCursor: function(name, orientation) {
            if(name in this.cursors) {
                this.currentCursor = this.cursors[name];
                this.currentCursorOrientation = orientation;
            } else {
                log.error("Unknown cursor name :"+name);
            }
        },

        updateCursorLogic: function() {
            if(this.hoveringCollidingTile && this.started) {
                this.targetColor = "rgba(255, 50, 50, 0.5)";
            }
            else {
                this.targetColor = "rgba(255, 255, 255, 0.5)";
            }
            
            if(this.hoveringPlayer && this.started) {
                if(this.pvpFlag)
                    this.setCursor("sword");
                else
                    this.setCursor("hand");
                this.hoveringTarget = false;
                this.hoveringMob = false;
                this.targetCellVisible = false;
            } else if(this.hoveringMob && this.started) {
                this.setCursor("sword");
                this.hoveringTarget = false;
                this.hoveringPlayer = false;
                this.targetCellVisible = false;
 
            }
            else if(this.hoveringNpc && this.started) {
                this.setCursor("talk");
                this.hoveringTarget = false;
                this.targetCellVisible = false;
            }
            else if((this.hoveringItem || this.hoveringChest) && this.started) {
                this.setCursor("loot");
                this.hoveringTarget = false;
                this.targetCellVisible = true;
            }
            else {
                this.setCursor("hand");
                this.hoveringTarget = false;
                this.hoveringPlayer = false;
                this.targetCellVisible = true;
            }
        },

        focusPlayer: function() {
            this.renderer.camera.lookAt(this.player);
        },

        addEntity: function(entity) {
            var self = this;

            if(this.entities[entity.id] === undefined) {
                this.entities[entity.id] = entity;
                this.registerEntityPosition(entity);

                if(!(entity instanceof Item && entity.wasDropped)
                && !(this.renderer.mobile || this.renderer.tablet)) {
                    entity.fadeIn(this.currentTime);
                }

                if(this.renderer.mobile || this.renderer.tablet) {
                    entity.onDirty(function(e) {
                        if(self.camera.isVisible(e)) {
                            e.dirtyRect = self.renderer.getEntityBoundingRect(e);
                            self.checkOtherDirtyRects(e.dirtyRect, e, e.gridX, e.gridY);
                        }
                    });
                }
            }
            else {
                log.error("This entity already exists : " + entity.id + " ("+entity.kind+")");
            }
        },

        removeEntity: function(entity) {
            if(entity.id in this.entities) {
                this.unregisterEntityPosition(entity);
                delete this.entities[entity.id];
            }
            else {
                log.error("Cannot remove entity. Unknown ID : " + entity.id);
            }
        },

        addItem: function(item, x, y) {
            item.setSprite(this.sprites[item.getSpriteName()]);
            item.setGridPosition(x, y);
            item.setAnimation("idle", 150);
            this.addEntity(item);
        },

        removeItem: function(item) {
            if(item) {
                this.removeFromItemGrid(item, item.gridX, item.gridY);
                this.removeFromRenderingGrid(item, item.gridX, item.gridY);
                delete this.entities[item.id];
            } else {
                log.error("Cannot remove item. Unknown ID : " + item.id);
            }
        },

        initPathingGrid: function() {
            this.pathingGrid = [];
            for(var i=0; i < this.map.height; i += 1) {
                this.pathingGrid[i] = [];
                for(var j=0; j < this.map.width; j += 1) {
                    this.pathingGrid[i][j] = this.map.grid[i][j];
                }
            }
            log.info("Initialized the pathing grid with static colliding cells.");
        },

        initEntityGrid: function() {
            this.entityGrid = [];
            for(var i=0; i < this.map.height; i += 1) {
                this.entityGrid[i] = [];
                for(var j=0; j < this.map.width; j += 1) {
                    this.entityGrid[i][j] = {};
                }
            }
            log.info("Initialized the entity grid.");
        },

        initRenderingGrid: function() {
            this.renderingGrid = [];
            for(var i=0; i < this.map.height; i += 1) {
                this.renderingGrid[i] = [];
                for(var j=0; j < this.map.width; j += 1) {
                    this.renderingGrid[i][j] = {};
                }
            }
            log.info("Initialized the rendering grid.");
        },

        initItemGrid: function() {
            this.itemGrid = [];
            for(var i=0; i < this.map.height; i += 1) {
                this.itemGrid[i] = [];
                for(var j=0; j < this.map.width; j += 1) {
                    this.itemGrid[i][j] = {};
                }
            }
            log.info("Initialized the item grid.");
        },

        /**
         *
         */
        initAnimatedTiles: function() {
            var self = this,
                m = this.map;

            this.animatedTiles = [];
            this.forEachVisibleTile(function (id, index) {
                if(m.isAnimatedTile(id)) {
                    var tile = new AnimatedTile(id, m.getTileAnimationLength(id), m.getTileAnimationDelay(id), index),
                        pos = self.map.tileIndexToGridPosition(tile.index);

                    tile.x = pos.x;
                    tile.y = pos.y;
                    self.animatedTiles.push(tile);
                }
            }, 1);
            //log.info("Initialized animated tiles.");
        },

        addToRenderingGrid: function(entity, x, y) {
            if(!this.map.isOutOfBounds(x, y)) {
                this.renderingGrid[y][x][entity.id] = entity;
            }
        },

        removeFromRenderingGrid: function(entity, x, y) {
            if(entity && this.renderingGrid[y][x] && entity.id in this.renderingGrid[y][x]) {
                delete this.renderingGrid[y][x][entity.id];
            }
        },

        removeFromEntityGrid: function(entity, x, y) {
            if(this.entityGrid[y][x][entity.id]) {
                delete this.entityGrid[y][x][entity.id];
            }
        },

        removeFromItemGrid: function(item, x, y) {
            if(item && this.itemGrid[y][x][item.id]) {
                delete this.itemGrid[y][x][item.id];
            }
        },

        removeFromPathingGrid: function(x, y) {
            this.pathingGrid[y][x] = 0;
        },

        /**
         * Registers the entity at two adjacent positions on the grid at the same time.
         * This situation is temporary and should only occur when the entity is moving.
         * This is useful for the hit testing algorithm used when hovering entities with the mouse cursor.
         *
         * @param {Entity} entity The moving entity
         */
        registerEntityDualPosition: function(entity) {
            if(entity) {
                this.entityGrid[entity.gridY][entity.gridX][entity.id] = entity;

                this.addToRenderingGrid(entity, entity.gridX, entity.gridY);

                if(entity.nextGridX >= 0 && entity.nextGridY >= 0) {
                    this.entityGrid[entity.nextGridY][entity.nextGridX][entity.id] = entity;
                    if(!(entity instanceof Player)) {
                        this.pathingGrid[entity.nextGridY][entity.nextGridX] = 1;
                    }
                }
            }
        },

        /**
         * Clears the position(s) of this entity in the entity grid.
         *
         * @param {Entity} entity The moving entity
         */
        unregisterEntityPosition: function(entity) {
            if(entity) {
                this.removeFromEntityGrid(entity, entity.gridX, entity.gridY);
                this.removeFromPathingGrid(entity.gridX, entity.gridY);

                this.removeFromRenderingGrid(entity, entity.gridX, entity.gridY);

                if(entity.nextGridX >= 0 && entity.nextGridY >= 0) {
                    this.removeFromEntityGrid(entity, entity.nextGridX, entity.nextGridY);
                    this.removeFromPathingGrid(entity.nextGridX, entity.nextGridY);
                }
            }
        },

        registerEntityPosition: function(entity) {
            var x = entity.gridX,
                y = entity.gridY;

            if(entity) {
                if(entity instanceof Character || entity instanceof Chest) {
                    this.entityGrid[y][x][entity.id] = entity;
                    if(!(entity instanceof Player)) {
                        this.pathingGrid[y][x] = 1;
                    }
                }
                if(entity instanceof Item) {
                    this.itemGrid[y][x][entity.id] = entity;
                }

                this.addToRenderingGrid(entity, x, y);
            }
        },

        setServerOptions: function(host, port, username, userpw, email) {
            this.host = host;
            this.port = port;
            this.username = username;
            this.userpw = userpw;
            this.email = email;
        },
 
        loadAudio: function() {
            this.audioManager = new AudioManager(this);
        },

        initMusicAreas: function() {
            var self = this;
            _.each(this.map.musicAreas, function(area) {
                self.audioManager.addArea(area.x, area.y, area.w, area.h, area.id);
            });
        },

        run: function(action, started_callback) {
            var self = this;
            if(this.loadWait) clearInterval(this.loadWait);
            var deadline = Date.now() + 60000;
            function failLoading(reason) {
                clearInterval(self.loadWait);
                self.loadWait = null;
                self.started = false;
                self.ready = false;
                started_callback({success: false, reason: reason});
            }

            if(!this.map || this.map.loadError) {
                this.loadMap();
            }

            this.loadSprites();
            this.setUpdater(new Updater(this));
            this.camera = this.renderer.camera;

            this.setSpriteScale(this.renderer.scale);

            this.loadWait = setInterval(function() {
                var failedSprite = _.find(self.sprites, function(sprite) { return sprite.loadError; });
                if(self.map && self.map.loadError || failedSprite) {
                    failLoading(failedSprite ? failedSprite.loadError : self.map.loadError);
                    return;
                }
                if(Date.now() >= deadline) {
                    failLoading('Le chargement de la carte ou des images a expiré. Rechargez la page puis réessayez.');
                    return;
                }
                if(self.map && self.map.isLoaded && self.spritesLoaded()) {
                    clearInterval(self.loadWait);
                    self.loadWait = null;
                    try {
                    self.ready = true;
                    log.debug('All sprites loaded.');

                    self.loadAudio();

                    self.initMusicAreas();
                    self.initAchievements();
                    self.initCursors();
                    self.initAnimations();
                    self.initShadows();
                    self.initHurtSprites();

                    if(!self.renderer.mobile
                    && !self.renderer.tablet
                    && self.renderer.upscaledRendering) {
                        self.initSilhouettes();
                    }

                    self.initEntityGrid();
                    self.initItemGrid();
                    self.initPathingGrid();
                    self.initRenderingGrid();

                    self.setPathfinder(new Pathfinder(self.map.width, self.map.height));

                    self.initPlayer();
                    self.setCursor("hand");

                    self.connect(action, started_callback);

                    } catch(error) {
                        log.error('Game initialization failed: ' + error.message);
                        failLoading('Le jeu ne peut pas démarrer. Rechargez la page puis réessayez.');
                    }
                }
            }, 100);
        },

        tick: function() {
            this.currentTime = new Date().getTime();

            if(this.started) {
                this.updateCursorLogic();
                this.updater.update();
                this.renderer.renderFrame();
            }

            if(!this.isStopped) {
                requestAnimFrame(this.tick.bind(this));
            }
        },

        start: function() {
            this.tick();
            this.hasNeverStarted = false;
            log.info("Game loop started.");
        },

        stop: function() {
            log.info("Game stopped.");
            this.isStopped = true;
        },

        entityIdExists: function(id) {
            return id in this.entities;
        },

        getEntityById: function(id) {
            if(id in this.entities) {
                return this.entities[id];
            }
            else {
                log.debug("Unknown entity id : " + id);
            }
        },

        connect: function(action, started_callback) {
            var self = this,
                connecting = false; // always in dispatcher mode in the build version

            this.client = new GameClient(this.host, this.port);
            this.client.fail_callback = function(reason){
                if(self.app && typeof self.app.hideQueueStatus === 'function') {
                    self.app.hideQueueStatus();
                }
                started_callback({
                    success: false,
                    reason: reason
                });
                self.started = false;
            };

            if(typeof this.client.onQueue === 'function') {
                this.client.onQueue(function(position, total) {
                    log.info("Waiting in line... (" + position + "/" + total + ")");
                    if(self.app && typeof self.app.showQueueStatus === 'function') {
                        self.app.showQueueStatus(position, total);
                    }
                });
            }

            //>>excludeStart("prodHost", pragmas.prodHost);
            var config = this.app.config.local || this.app.config.dev;
            if(config) {
                this.client.connect(config.dispatcher); // false if the client connects directly to a game server
                connecting = true;
            }
            //>>excludeEnd("prodHost");

            //>>includeStart("prodHost", pragmas.prodHost);
            if(!connecting) {
                this.client.connect(false); // dont use the dispatcher in production
            }
            //>>includeEnd("prodHost");

            this.client.onDispatched(function(host, port) {
                log.debug("Dispatched to game server "+host+ ":"+port);

                self.client.host = host;
                self.client.port = port;
                self.client.connect(); // connect to actual game server
            });

            this.client.onConnected(function() {
                log.info("Starting client/server handshake");
                if(self.app && typeof self.app.hideQueueStatus === 'function') {
                    self.app.hideQueueStatus();
                }

                self.player.name = self.username;
                self.player.pw = self.userpw;
                self.player.email = self.email;
                self.started = true;

                if(action === 'google') {
                    self.client.sendGoogleLogin(self.googleIdToken, self.preferredGoogleName);
                } else if(action === 'create') {
                    self.client.sendCreate(self.player);
                } else {
                    self.client.sendLogin(self.player);
                }
            });

            this.client.onEntityList(function(list) {
                var entityIds = _.pluck(self.entities, 'id'),
                    knownIds = _.intersection(entityIds, list),
                    newIds = _.difference(list, knownIds);

                self.obsoleteEntities = _.reject(self.entities, function(entity) {
                    return _.include(knownIds, entity.id) || entity.id === self.player.id;
                });

                // Destroy entities outside of the player's zone group
                self.removeObsoleteEntities();

                // Ask the server for spawn information about unknown entities
                if(_.size(newIds) > 0) {
                    self.client.sendWho(newIds);
                }
            });

            this.client.onWelcome(function(id, name, x, y, hp, armor, weapon,
                                           avatar, weaponAvatar, experience,
                                           inventory, inventoryCount, admin) {
                log.info("Received player ID from server : "+ id);
                self.player.id = id;
                self.playerId = id;
                // Always accept name received from the server which will
                // sanitize and shorten names exceeding the allowed length.
                self.player.name = name;
                self.player.admin = (admin === 1) ? 1 : 0;
                self.player.setGridPosition(x, y);
                self._lastSentMoveX = x;
                self._lastSentMoveY = y;
                self.player.setArmorName(armor);
                self.player.setSpriteName(avatar);
                self.player.setWeaponName(weapon);
                self.initPlayer();
                if(self.app && self.app.initEquipmentIcons) {
                    self.app.initEquipmentIcons();
                }
                self.player.experience = experience;
                self.player.level = Types.getLevel(experience);
                var armorRank = Types.getArmorRank(Types.getKindFromString(armor)),
                    maxHp = 80 + ((armorRank + 1) * 40);
                self.player.maxHitPoints = (hp > maxHp) ? hp : maxHp;
                self.player.hitPoints = hp;
                self.player.inventory = inventory || [null, null, null, null, null, null];
                self.player.inventoryCount = inventoryCount || [0, 0, 0, 0, 0, 0];

                self.updateBars();
                self.updateExpBar();
                if(self.app && self.app.updateInventoryUI) {
                    self.app.updateInventoryUI();
                }
                self.resetCamera();
                self.updatePlateauMode();
                self.audioManager.updateMusic();

                self.addEntity(self.player);
                self.player.dirtyRect = self.renderer.getEntityBoundingRect(self.player);

                setTimeout(function() {
                    self.tryUnlockingAchievement("STILL_ALIVE");
                }, 1500);

                if(!self.storage.hasAlreadyPlayed()) {
                    self.storage.initPlayer(self.player.name);
                    self.storage.savePlayer(self.renderer.getPlayerImage(),
                                            self.player.getSpriteName(),
                                            self.player.getWeaponName(),
                                            self.player.getGuild());
                    self.showNotification("Bienvenue sur Nova Quest !");
                } else {
                    self.showNotification("Bon retour sur Nova Quest ! Vous êtes niveau " + self.player.level + ".");
                    self.storage.setPlayerName(name);
                    self.storage.savePlayer(self.renderer.getPlayerImage(),
                                            self.player.getSpriteName(),
                                            self.player.getWeaponName(),
                                            self.player.getGuild());
                }


                self.player.onStartPathing(function(path) {
                    var i = path.length - 1,
                        x =  path[i][0],
                        y =  path[i][1];

                    if(self.player.isMovingToLoot()) {
                        self.player.isLootMoving = false;
                    }
                    // Completed tile steps are sent below. Sending the final
                    // path destination here would teleport the server position.

                    // Target cursor position
                    self.selectedX = x;
                    self.selectedY = y;

                    self.selectedCellVisible = true;

                    if(self.renderer.mobile || self.renderer.tablet) {
                        self.drawTarget = true;
                        self.clearTarget = true;
                        self.renderer.targetRect = self.renderer.getTargetBoundingRect();
                        self.checkOtherDirtyRects(self.renderer.targetRect, null, self.selectedX, self.selectedY);
                    }
                });

                self.player.onCheckAggro(function() {
                    self.forEachMob(function(mob) {
                        if(mob.isAggressive && !mob.isAttacking() && self.player.isNear(mob, mob.aggroRange)) {
                            self.player.aggro(mob);
                        }
                    });
                });

                self.player.onAggro(function(mob) {
                    if(!mob.isWaitingToAttack(self.player) && !self.player.isAttackedBy(mob)) {
                        self.player.log_info("Aggroed by " + mob.id + " at ("+self.player.gridX+", "+self.player.gridY+")");
                        self.client.sendAggro(mob);
                        mob.waitToAttack(self.player);
                    }
                });

                self.player.onCheckDoor(function(x, y) {
                    return Boolean(self.map && self.map.isDoor(x, y));
                });

                self.player.onDoorStopGuard(function(x, y, hadNewDest, hadNextStep) {
                    if(self.doorDiagnostics) {
                        self.doorDiagnostics.recordGuard(
                            'JOYSTICK_STOP_ON_DOOR',
                            'Arrêt forcé sur la porte (' + x + ',' + y + ') malgré un déplacement continu (joystick/clavier).',
                            { x: x, y: y, hadNewDest: hadNewDest, hadNextStep: hadNextStep }
                        );
                    }
                });

                self.player.onBeforeStep(function() {
                    var blockingEntity = self.getEntityAt(self.player.nextGridX, self.player.nextGridY);
                    if(blockingEntity && blockingEntity.id !== self.playerId) {
                        log.debug("Blocked by " + blockingEntity.id);
                    }
                    self.unregisterEntityPosition(self.player);
                });

                self.player.onStep(function() {
                    var gx = self.player.gridX,
                        gy = self.player.gridY;

                    self.sendPlayerMoveIfChanged(gx, gy, 'onStep');
                    if(self.doorDiagnostics) {
                        self.doorDiagnostics.recordStep(gx, gy);
                    }
                    if(self.app && typeof self.app.updateHubMapLiveStatus === 'function') {
                        self.app.updateHubMapLiveStatus();
                    }

                    if(self.player.hasNextStep()) {
                        self.registerEntityDualPosition(self.player);
                    }

                    var steppingOnActiveDoor = (!self.player.hasTarget() && self.map && self.map.isDoor(gx, gy));
                    if(self.isZoningTile(gx, gy)) {
                        if(steppingOnActiveDoor) {
                            if(self.doorDiagnostics) {
                                self.doorDiagnostics.recordGuard(
                                    'CLEAR_ZONING_ON_DOOR',
                                    'Transition de zone ignorée sur la case porte (' + gx + ',' + gy + ') pour éviter un conflit caméra.',
                                    { x: gx, y: gy }
                                );
                            }
                        } else {
                            self.enqueueZoningFrom(gx, gy);
                        }
                    }

                    self.player.forEachAttacker(self.makeAttackerFollow);

                    var item = self.getItemAt(gx, gy);
                    if(item instanceof Item) {
                        self.tryLootingItem(item);
                    }


                    if((gx <= 85 && gy <= 179 && gy > 178) || (gx <= 85 && gy <= 266 && gy > 265)) {
                        self.tryUnlockingAchievement("INTO_THE_WILD");
                    }

                    if(gx <= 85 && gy <= 293 && gy > 292) {
                        self.tryUnlockingAchievement("AT_WORLDS_END");
                    }

                    if(gx <= 85 && gy <= 100 && gy > 99) {
                        self.tryUnlockingAchievement("NO_MANS_LAND");
                    }

                    if(gx <= 85 && gy <= 51 && gy > 50) {
                        self.tryUnlockingAchievement("HOT_SPOT");
                    }

                    if(gx <= 27 && gy <= 123 && gy > 112) {
                        self.tryUnlockingAchievement("TOMB_RAIDER");
                    }

                    self.updatePlayerCheckpoint();

                    if(!self.player.isDead) {
                        self.audioManager.updateMusic();
                    }
                });

                self.player.onStopPathing(function(x, y) {
                    self.sendPlayerMoveIfChanged(x, y, 'onStopPathing');
                    if(self.player.isAttacking() && self.player.hasTarget()) {
                        self.client.sendAttack(self.player.target);
                    }
                    if(self.player.hasTarget()) {
                        self.player.lookAtTarget();
                    }

                    self.selectedCellVisible = false;

                    if(self.isItemAt(x, y)) {
                        var item = self.getItemAt(x, y);
                        self.tryLootingItem(item);
                    }

                    var teleportedViaDoor = false;
                    if(!self.player.hasTarget() && self.map.isDoor(x, y)) {
                        teleportedViaDoor = self.executeDoorTeleport(x, y, 'STOP_PATHING');
                    }

                    if(self.player.target instanceof Npc) {
                        self.makeNpcTalk(self.player.target);
                    } else if(self.player.target instanceof Chest) {
                        self.client.sendOpen(self.player.target);
                        self.audioManager.playSound("chest");
                    }

                    self.player.forEachAttacker(function(attacker) {
                        if(!attacker.isAdjacentNonDiagonal(self.player)) {
                            attacker.follow(self.player);
                        }
                    });

                    if(!teleportedViaDoor) {
                        self.unregisterEntityPosition(self.player);
                        self.registerEntityPosition(self.player);
                    }
                });

                self.player.onRequestPath(function(x, y) {
                    var ignored = [self.player]; // Always ignore self

                    if(self.player.hasTarget()) {
                        ignored.push(self.player.target);
                    }
                    return self.findPath(self.player, x, y, ignored);
                });

                self.player.onDeath(function() {
                    log.info(self.playerId + " is dead");

                    self.player.stopBlinking();
                    self.player.setSprite(self.sprites["death"]);
                    self.player.animate("death", 120, 1, function() {
                        log.info(self.playerId + " was removed");

                        self.removeEntity(self.player);
                        self.removeFromRenderingGrid(self.player, self.player.gridX, self.player.gridY);

                        self.player = null;
                        self.client.disable();

                        setTimeout(function() {
                            self.playerdeath_callback();
                        }, 1000);
                    });

                    self.player.forEachAttacker(function(attacker) {
                        attacker.disengage();
                        attacker.idle();
                    });

                    self.audioManager.fadeOutCurrentMusic();
                    self.audioManager.playSound("death");
                });

                self.player.onHasMoved(function(player) {
                    self.assignBubbleTo(player);
                });
                self.client.onPVPChange(function(pvpFlag){
                    self.player.flagPVP(pvpFlag);
                    if(pvpFlag){
                        self.showNotification("Zone JcJ (PVP) activée !");
                    } else{
                        self.showNotification("Zone JcJ (PVP) désactivée.");
                    }
                });

                self.player.onArmorLoot(function(armorName) {
                    self.player.switchArmor(self.sprites[armorName]);
                });

                self.player.onSwitchItem(function() {
                    self.storage.savePlayer(self.renderer.getPlayerImage(),
                                            self.player.getArmorName(),
                                            self.player.getWeaponName(),
                                            self.player.getGuild());
                    if(self.equipment_callback) {
                        self.equipment_callback();
                    }
                });

                self.player.onInvincible(function() {
                    self.invincible_callback();
                    self.player.switchArmor(self.sprites["firefox"]);
                });

                self.client.onSpawnItem(function(item, x, y) {
                    log.info("Spawned " + Types.getKindAsString(item.kind) + " (" + item.id + ") at "+x+", "+y);
                    self.addItem(item, x, y);
                });

                self.client.onSpawnChest(function(chest, x, y) {
                    log.info("Spawned chest (" + chest.id + ") at "+x+", "+y);
                    chest.setSprite(self.sprites[chest.getSpriteName()]);
                    chest.setGridPosition(x, y);
                    chest.setAnimation("idle_down", 150);
                    self.addEntity(chest, x, y);

                    chest.onOpen(function() {
                        chest.stopBlinking();
                        chest.setSprite(self.sprites["death"]);
                        chest.setAnimation("death", 120, 1, function() {
                            log.info(chest.id + " was removed");
                            self.removeEntity(chest);
                            self.removeFromRenderingGrid(chest, chest.gridX, chest.gridY);
                            self.previousClickPosition = {};
                        });
                    });
                });

                self.client.onSpawnCharacter(function(entity, x, y, orientation, targetId) {
                    if(!self.entityIdExists(entity.id)) {
                        try {
                            if(entity.id !== self.playerId) {
                                entity.setSprite(self.sprites[entity.getSpriteName()]);
                                entity.setGridPosition(x, y);
                                entity.setOrientation(orientation);
                                entity.idle();

                                self.addEntity(entity);

                                log.debug("Spawned " + Types.getKindAsString(entity.kind) + " (" + entity.id + ") at "+entity.gridX+", "+entity.gridY);

                                if(entity instanceof Character) {
                                    entity.onBeforeStep(function() {
                                        self.unregisterEntityPosition(entity);
                                    });

                                    entity.onStep(function() {
                                        if(!entity.isDying) {
                                            self.registerEntityDualPosition(entity);

                                            if(self.player.target === entity) {
                                                self.makeAttackerFollow(self.player)
                                            }


                                            entity.forEachAttacker(function(attacker) {
                                                if(attacker.isAdjacent(attacker.target)) {
                                                    attacker.lookAtTarget();
                                                } else {
                                                    attacker.follow(entity);
                                                }
                                            });
                                        }
                                    });

                                    entity.onStopPathing(function(x, y) {
                                        if(!entity.isDying) {
                                            if(entity.hasTarget() && entity.isAdjacent(entity.target)) {
                                                entity.lookAtTarget();
                                            }

                                            if(entity instanceof Player) {
                                                var gridX = entity.destination.gridX,
                                                    gridY = entity.destination.gridY;

                                                if(self.map.isDoor(gridX, gridY)) {
                                                    var dest = self.map.getDoorDestination(gridX, gridY);
                                                    entity.setGridPosition(dest.x, dest.y);
                                                }
                                            }

                                            entity.forEachAttacker(function(attacker) {
                                                if(!attacker.isAdjacentNonDiagonal(entity) && attacker.id !== self.playerId) {
                                                    attacker.follow(entity);
                                                }
                                            });

                                            self.unregisterEntityPosition(entity);
                                            self.registerEntityPosition(entity);
                                        }
                                    });

                                    entity.onRequestPath(function(x, y) {
                                        var ignored = [entity], // Always ignore self
                                            ignoreTarget = function(target) {
                                                ignored.push(target);

                                                // also ignore other attackers of the target entity
                                                target.forEachAttacker(function(attacker) {
                                                    ignored.push(attacker);
                                                });
                                            };

                                        if(entity.hasTarget()) {
                                            ignoreTarget(entity.target);
                                        } else if(entity.previousTarget) {
                                            // If repositioning before attacking again, ignore previous target
                                            // See: tryMovingToADifferentTile()
                                            ignoreTarget(entity.previousTarget);
                                        }

                                        return self.findPath(entity, x, y, ignored);
                                    });

                                    entity.onDeath(function() {
                                        log.info(entity.id + " is dead");

                                        if(entity instanceof Mob) {
                                            // Keep track of where mobs die in order to spawn their dropped items
                                            // at the right position later.
                                            self.deathpositions[entity.id] = {x: entity.gridX, y: entity.gridY};
                                        }

                                        entity.isDying = true;
                                        entity.setSprite(self.sprites[entity instanceof Mobs.Rat ? "rat" : "death"]);
                                        entity.animate("death", 120, 1, function() {
                                            log.info(entity.id + " was removed");

                                            self.removeEntity(entity);
                                            self.removeFromRenderingGrid(entity, entity.gridX, entity.gridY);
                                        });

                                        entity.forEachAttacker(function(attacker) {
                                            attacker.disengage();
                                        });

                                        if(self.player.target && self.player.target.id === entity.id) {
                                            self.player.disengage();
                                        }

                                        // Upon death, this entity is removed from both grids, allowing the player
                                        // to click very fast in order to loot the dropped item and not be blocked.
                                        // The entity is completely removed only after the death animation has ended.
                                        self.removeFromEntityGrid(entity, entity.gridX, entity.gridY);
                                        self.removeFromPathingGrid(entity.gridX, entity.gridY);

                                        if(self.camera.isVisible(entity)) {
                                            self.audioManager.playSound("kill"+Math.floor(Math.random()*2+1));
                                        }

                                        self.updateCursor();
                                    });

                                    entity.onHasMoved(function(entity) {
                                        self.assignBubbleTo(entity); // Make chat bubbles follow moving entities
                                    });

                                    if(entity instanceof Mob) {
                                        if(targetId) {
                                            var player = self.getEntityById(targetId);
                                            if(player) {
                                                self.createAttackLink(entity, player);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        catch(e) {
                            log.error(e);
                        }
                    } else {
                        log.debug("Character "+entity.id+" already exists. Don't respawn.");
                    }
                });

                self.client.onDespawnEntity(function(entityId) {
                    var entity = self.getEntityById(entityId);

                    if(entity) {
                        log.info("Despawning " + Types.getKindAsString(entity.kind) + " (" + entity.id+ ")");

                        if(entity.gridX === self.previousClickPosition.x
                        && entity.gridY === self.previousClickPosition.y) {
                            self.previousClickPosition = {};
                        }

                        if(entity instanceof Item) {
                            self.removeItem(entity);
                        } else if(entity instanceof Character) {
                            entity.forEachAttacker(function(attacker) {
                                if(attacker.canReachTarget()) {
                                    attacker.hit();
                                }
                            });
                            entity.die();
                        } else if(entity instanceof Chest) {
                            entity.open();
                        }

                        entity.clean();
                    }
                });

                self.client.onItemBlink(function(id) {
                    var item = self.getEntityById(id);

                    if(item) {
                        item.blink(150);
                    }
                });
                
                self.client.onGuildError(function(errorType, info) {
					if(errorType === Types.Messages.GUILDERRORTYPE.BADNAME){
						self.showNotification(info + " semble être un nom de guilde inapproprié…");
					}
					else if(errorType === Types.Messages.GUILDERRORTYPE.ALREADYEXISTS){
						self.showNotification(info + " existe déjà…");
						setTimeout(function(){self.showNotification("Changez le nom de VOTRE guilde")},2500);
						setTimeout(function(){self.showNotification("Ou demandez à un membre de " + info + " de les rejoindre.")},5000);
					}
					else if(errorType === Types.Messages.GUILDERRORTYPE.IDWARNING){
						self.showNotification("ATTENTION : le serveur a redémarré.");
						setTimeout(function(){self.showNotification(info + " a changé d'identifiant.")},2500);
					}
					else if(errorType === Types.Messages.GUILDERRORTYPE.BADINVITE){
						self.showNotification(info+" est DÉJÀ membre de « "+self.player.getGuild().name+" »");
					}
				});
				
				self.client.onGuildCreate(function(guildId, guildName) {
					self.player.setGuild(new Guild(guildId, guildName));
					self.storage.setPlayerGuild(self.player.getGuild());
					self.showNotification("Vous avez créé et rejoint la guilde…");
					setTimeout(function(){self.showNotification("…" + self.player.getGuild().name)},2500);
				});
				
				self.client.onGuildInvite(function(guildId, guildName, invitorName) {
					self.showNotification(invitorName + " vous invite à rejoindre « "+guildName+" ».");
					self.player.addInvite(guildId);
					setTimeout(function(){$("#chatinput").attr("placeholder", "Rejoindre "+guildName+" ? Tapez /guild accept yes ou /guild accept no");
					self.app.showChat();},2500);
				});
				
				self.client.onGuildJoin(function(playerName, id, guildId, guildName) {
					if(typeof id === "undefined"){
						self.showNotification(playerName + " n'a pas répondu à l'invitation à temps.");
						setTimeout(function(){self.showNotification("Vous devrez peut-être renvoyer une invitation…")},2500);
					}
					else if(id === false){
						self.showNotification(playerName + " a décliné votre invitation…");
						setTimeout(function(){self.showNotification("…à rejoindre « "+self.player.getGuild().name+" ».")},2500);
					}
					else if(id === self.player.id){
						self.player.setGuild(new Guild(guildId, guildName));
						self.storage.setPlayerGuild(self.player.getGuild());
						self.showNotification("Vous venez de rejoindre « "+guildName+" ».");
					}
					else{
						self.showNotification(playerName+" fait maintenant partie de « "+guildName+" ».");//#updateguild
					}
				});
				
				self.client.onGuildLeave(function(name, playerId, guildName) {
					if(self.player.id===playerId){
						if(self.player.hasGuild()){
							if(self.player.getGuild().name === guildName){//do not erase new guild on create
								self.player.unsetGuild();
								self.storage.setPlayerGuild();
								self.showNotification("Vous avez quitté « "+guildName+" ».");
							}
						}
						//missing elses above should not happen (errors)
					}
					else{
						self.showNotification(name + " a quitté « "+guildName+" ».");//#updateguild
					}
				});
				
				self.client.onGuildTalk(function(name, id, message) {
					if(id===self.player.id){
						self.showNotification("VOUS : "+message);
					}
					else{
						self.showNotification(name+" : "+message);
					}
				});

				self.client.onMemberConnect(function(name) {
					self.showNotification(name + " s'est connecté à votre monde.");//#updateguild
				});
				
				self.client.onMemberDisconnect(function(name) {
					self.showNotification(name + " s'est déconnecté.");
				});
				
				self.client.onReceiveGuildMembers(function(memberNames) {
					self.showNotification(memberNames.join(", ") + ((memberNames.length===1) ? " est " : " sont ") +"actuellement en ligne.");//#updateguild
				});

                self.client.onEntityMove(function(id, x, y) {
                    var entity = null;

                    if(id !== self.playerId) {
                        entity = self.getEntityById(id);

                        if(entity) {
                            if(self.player.isAttackedBy(entity)) {
                                self.tryUnlockingAchievement("COWARD");
                            }
                            entity.disengage();
                            entity.idle();
                            self.makeCharacterGoTo(entity, x, y);
                        }
                    }
                });

                self.client.onEntityDestroy(function(id) {
                    var entity = self.getEntityById(id);
                    if(entity) {
                        if(entity instanceof Item) {
                            self.removeItem(entity);
                        } else {
                            self.removeEntity(entity);
                        }
                        log.debug("Entity was destroyed: "+entity.id);
                    }
                });

                self.client.onPlayerMoveToItem(function(playerId, itemId) {
                    var player, item;

                    if(playerId !== self.playerId) {
                        player = self.getEntityById(playerId);
                        item = self.getEntityById(itemId);

                        if(player && item) {
                            self.makeCharacterGoTo(player, item.gridX, item.gridY);
                        }
                    }
                });

                self.client.onEntityAttack(function(attackerId, targetId) {
                    var attacker = self.getEntityById(attackerId),
                        target = self.getEntityById(targetId);

                    if(attacker && target && attacker.id !== self.playerId) {
                        log.debug(attacker.id + " attacks " + target.id);

                        if(attacker && target instanceof Player && target.id !== self.playerId && target.target && target.target.id === attacker.id && attacker.getDistanceToEntity(target) < 3) {
                            setTimeout(function() {
                                self.createAttackLink(attacker, target);
                            }, 200); // delay to prevent other players attacking mobs from ending up on the same tile as they walk towards each other.
                        } else {
                            self.createAttackLink(attacker, target);
                        }
                    }
                });

                self.client.onPlayerDamageMob(function(mobId, points, healthPoints, maxHp) {
                    var mob = self.getEntityById(mobId);
                    if(mob && points) {
                        self.infoManager.addDamageInfo(points, mob.x, mob.y - 15, "inflicted");
                    }
                    if(self.player.hasTarget()){
                        self.updateTarget(mobId, points, healthPoints, maxHp);
                    }
                });

                self.client.onPlayerKillMob(function(kind, level, exp) {
                    var mobExp = Types.getMobExp(kind);
                    self.player.level = level;
                    self.player.experience = exp;
                    self.updateExpBar();
                    
                    self.infoManager.addDamageInfo("+"+mobExp+" exp", self.player.x, self.player.y - 15, "exp", 3000);

                    var expInThisLevel = self.player.experience - Types.expForLevel[self.player.level-1];
                    var expForLevelUp = Types.expForLevel[self.player.level] - Types.expForLevel[self.player.level-1];
                    var expPercentThisLevel = (100*expInThisLevel/expForLevelUp);

                    self.showNotification( "XP totale : " + self.player.experience + " (" + expPercentThisLevel.toFixed(0) + "% du niveau " + self.player.level + ")." );

                    var mobName = Types.getKindAsString(kind);

                    if(mobName === 'boss') {
                        self.showNotification("Vous avez terrassé le Roi Squelette !");
                    }

                    self.storage.incrementTotalKills();
                    self.tryUnlockingAchievement("HUNTER");

                    if(kind === Types.Entities.RAT) {
                        self.storage.incrementRatCount();
                        self.tryUnlockingAchievement("ANGRY_RATS");
                    }

                    if(kind === Types.Entities.SKELETON || kind === Types.Entities.SKELETON2) {
                        self.storage.incrementSkeletonCount();
                        self.tryUnlockingAchievement("SKULL_COLLECTOR");
                    }

                    if(kind === Types.Entities.BOSS) {
                        self.tryUnlockingAchievement("HERO");
                    }
                });

                self.client.onPlayerChangeHealth(function(points, isRegen) {
                    var player = self.player,
                        diff,
                        isHurt;

                    if(player && !player.isDead && !player.invincible) {
                        isHurt = points <= player.hitPoints;
                        diff = points - player.hitPoints;
                        player.hitPoints = points;

                        if(isHurt) {
                            player.hurt();
                            self.infoManager.addDamageInfo(diff, player.x, player.y - 15, "received");
                            self.audioManager.playSound("hurt");
                            self.storage.addDamage(-diff);
                            self.tryUnlockingAchievement("MEATSHIELD");
                            if(self.playerhurt_callback) {
                                self.playerhurt_callback();
                            }
                        } else if(!isRegen){
                            self.infoManager.addDamageInfo("+"+diff, player.x, player.y - 15, "healed");
                        }
                        self.updateBars();
                    }
                });

                self.client.onPlayerChangeMaxHitPoints(function(hp) {
                    self.player.maxHitPoints = hp;
                    self.player.hitPoints = hp;
                    self.updateBars();
                });

                self.client.onPlayerEquipItem(function(playerId, itemKind) {
                    var player = self.getEntityById(playerId),
                        itemName = Types.getKindAsString(itemKind);

                    if(player) {
                        if(Types.isArmor(itemKind)) {
                            player.setSprite(self.sprites[itemName]);
                            player.setSpriteName(itemName);
                            player.setArmorName(itemName);
                        } else if(Types.isWeapon(itemKind)) {
                            player.setWeaponName(itemName);
                        }
                        if(playerId === self.playerId) {
                            if(self.equipment_callback) {
                                self.equipment_callback();
                            }
                            self.storage.savePlayer(self.renderer.getPlayerImage(),
                                                    self.player.getArmorName(),
                                                    self.player.getWeaponName(),
                                                    self.player.getGuild());
                        }
                    }
                });

                self.client.onInventoryChange(function(slot, itemKind, count) {
                    if(self.player && slot >= 0 && slot < 6) {
                        self.player.inventory[slot] = itemKind ? itemKind : null;
                        self.player.inventoryCount[slot] = count ? count : 0;
                        if(self.app && self.app.updateInventoryUI) {
                            self.app.updateInventoryUI();
                        }
                    }
                });

                self.client.onHubMessage(function(subAction, payload) {
                    if(self.app && self.app.handleHubPacket) {
                        self.app.handleHubPacket(subAction, payload);
                    }
                });

                self.client.onPlayerTeleport(function(id, x, y) {
                    var entity = null,
                        currentOrientation;

                    if(id === self.playerId && self.player) {
                        if(self.doorDiagnostics) {
                            self.doorDiagnostics.recordServerTeleport(x, y);
                        }
                        self.currentZoning = null;
                        self.zoningQueue = [];
                        self.previousClickPosition = {};
                        self.player.isDead = false;
                        self.player.path = null;
                        self.player.newDestination = null;
                        self.player.movement.stop();
                        $('body').removeClass('death');
                        self.player.disengage();
                        self.player.forEachAttacker(function(attacker) {
                            attacker.disengage();
                            attacker.idle();
                        });
                        self.unregisterEntityPosition(self.player);
                        self.player.setGridPosition(x, y);
                        self.player.nextGridX = x;
                        self.player.nextGridY = y;
                        self._lastSentMoveX = x;
                        self._lastSentMoveY = y;
                        self.registerEntityPosition(self.player);
                        self.resetCamera();
                        self.updatePlateauMode();
                        self.audioManager.playSound("teleport");
                        if(self.app && typeof self.app.updateHubMapLiveStatus === 'function') {
                            self.app.updateHubMapLiveStatus();
                        }
                    } else if(id !== self.playerId) {
                        entity = self.getEntityById(id);

                        if(entity) {
                            currentOrientation = entity.orientation;

                            self.makeCharacterTeleportTo(entity, x, y);
                            entity.setOrientation(currentOrientation);

                            entity.forEachAttacker(function(attacker) {
                                attacker.disengage();
                                attacker.idle();
                                attacker.stop();
                            });
                        }
                    }
                });

                self.client.onDropItem(function(item, mobId) {
                    var pos = self.getDeadMobPosition(mobId);

                    if(pos) {
                        self.addItem(item, pos.x, pos.y);
                        self.updateCursor();
                    }
                });

                self.client.onChatMessage(function(entityId, message) {
                    var entity = self.getEntityById(entityId);
                    if(entity) {
                        self.createBubble(entityId, message);
                        self.assignBubbleTo(entity);
                    }
                    self.audioManager.playSound("chat");
                });

                self.client.onPopulationChange(function(worldPlayers, totalPlayers) {
                    if(self.nbplayers_callback) {
                        self.nbplayers_callback(worldPlayers, totalPlayers);
                    }
                });
                
                self.client.onGuildPopulation(function(guildName, guildPopulation) {
					if(self.nbguildplayers_callback) {
						self.nbguildplayers_callback(guildName, guildPopulation);
					}
				});

                self.client.onDisconnected(function(message) {
                    self.stopPingLoop();
                    if(self.player) {
                        self.player.die();
                    }
                    if(self.disconnect_callback) {
                        self.disconnect_callback(message);
                    }
                });

                self.gamestart_callback();
                self.startPingLoop();

                if(self.hasNeverStarted) {
                    self.start();
                }
                if(started_callback) {
                    var cb = started_callback;
                    started_callback = null;
                    cb({success: true});
                }
            });
        },

        startPingLoop: function() {
            var self = this;
            this.stopPingLoop();
            var sendPing = function() {
                if(self.started && self.client && self.player && !self.player.isDead) {
                    self.client.sendHub('ping', { t: Date.now() });
                }
            };
            setTimeout(sendPing, 300);
            this.pingInterval = setInterval(sendPing, 2500);
        },

        stopPingLoop: function() {
            if(this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }
        },

        /**
         * Links two entities in an attacker<-->target relationship.
         * This is just a utility method to wrap a set of instructions.
         *
         * @param {Entity} attacker The attacker entity
         * @param {Entity} target The target entity
         */
        createAttackLink: function(attacker, target) {
            if(attacker.hasTarget()) {
                attacker.removeTarget();
            }
            attacker.engage(target);

            if(attacker.id !== this.playerId) {
                target.addAttacker(attacker);
            }
        },

        /**
         * Converts the current mouse position on the screen to world grid coordinates.
         * @returns {Object} An object containing x and y properties.
         */
        getMouseGridPosition: function() {
            var mx = this.mouse.x,
                my = this.mouse.y,
                c = this.renderer.camera,
                s = this.renderer.scale,
                ts = this.renderer.tilesize,
                offsetX = mx % (ts * s),
                offsetY = my % (ts * s),
                x = ((mx - offsetX) / (ts * s)) + c.gridX,
                y = ((my - offsetY) / (ts * s)) + c.gridY;

                return { x: x, y: y };
        },

        /**
         * Moves a character to a given location on the world grid.
         *
         * @param {Number} x The x coordinate of the target location.
         * @param {Number} y The y coordinate of the target location.
         */
        makeCharacterGoTo: function(character, x, y) {
            if(!this.map.isOutOfBounds(x, y)) {
                character.go(x, y);
            }
        },

        /**
         *
         */
        makeCharacterTeleportTo: function(character, x, y) {
            if(!this.map.isOutOfBounds(x, y)) {
                this.unregisterEntityPosition(character);

                character.setGridPosition(x, y);

                this.registerEntityPosition(character);
                this.assignBubbleTo(character);
            } else {
                log.debug("Teleport out of bounds: "+x+", "+y);
            }
        },

        /**
         *
         */
        makePlayerAttackNext: function()
        {

            pos = {
                x: this.player.gridX,
                y: this.player.gridY
            };
            switch(this.player.orientation)
            {
                case Types.Orientations.DOWN:
                    pos.y += 1;
                    this.makePlayerAttackTo(pos);
                    break;
                case Types.Orientations.UP:
                    pos.y -= 1;
                    this.makePlayerAttackTo(pos);
                    break;
                case Types.Orientations.LEFT:
                    pos.x -= 1;
                    this.makePlayerAttackTo(pos);
                    break;
                case Types.Orientations.RIGHT:
                    pos.x += 1;
                    this.makePlayerAttackTo(pos);
                    break;

                default:
                    break;
            }
        },

        /**
         *
         */
        makePlayerAttackTo: function(pos)
        {
            entity = this.getEntityAt(pos.x, pos.y);
            if(entity instanceof Mob) {
                this.makePlayerAttack(entity);
            }
        },

        /**
         * Attacks the current target if still alive, or finds the closest living Mob
         * within 6 tiles and engages it immediately (ideal for mobile combat button & Spacebar).
         */
        makePlayerAttackClosest: function() {
            if(!this.player || this.player.isDead) return;
            var self = this;

            if(this.player.hasTarget() && (this.player.target instanceof Mob) && !this.player.target.isDead && this.getEntityById(this.player.target.id)) {
                this.makePlayerAttack(this.player.target);
                return;
            }

            var bestMob = null,
                bestDist = 999;

            this.forEachMob(function(mob) {
                if(mob && !mob.isDead) {
                    var d = Math.abs(self.player.gridX - mob.gridX) + Math.abs(self.player.gridY - mob.gridY);
                    if(d <= 8 && d < bestDist) {
                        bestDist = d;
                        bestMob = mob;
                    }
                }
            });

            if(bestMob) {
                this.makePlayerAttack(bestMob);
            } else {
                this.makePlayerAttackNext();
            }
        },

        /**
         * Bouton d'action circulaire mobile : attaque la cible la plus proche,
         * ramasse les objets / ouvre les coffres proches ou parle aux PNJ.
         */
        makePlayerInteractClosest: function() {
            if(!this.player || this.player.isDead) return;
            var self = this,
                bestMob = null,
                bestMobDist = 999,
                bestChest = null,
                bestChestDist = 999,
                bestItem = null,
                bestItemDist = 999,
                bestNpc = null,
                bestNpcDist = 999;

            if(this.player.hasTarget() && (this.player.target instanceof Mob) && !this.player.target.isDead && this.getEntityById(this.player.target.id)) {
                this.makePlayerAttack(this.player.target);
                return;
            }

            this.forEachEntity(function(entity) {
                if(!entity || entity.id === self.player.id) return;
                var d = Math.abs(self.player.gridX - entity.gridX) + Math.abs(self.player.gridY - entity.gridY);
                if((entity instanceof Mob) && !entity.isDead) {
                    if(d <= 8 && d < bestMobDist) {
                        bestMobDist = d;
                        bestMob = entity;
                    }
                } else if(entity instanceof Chest) {
                    if(d <= 7 && d < bestChestDist) {
                        bestChestDist = d;
                        bestChest = entity;
                    }
                } else if(entity instanceof Item) {
                    if(d <= 7 && d < bestItemDist) {
                        bestItemDist = d;
                        bestItem = entity;
                    }
                } else if(entity instanceof Npc) {
                    if(d <= 5 && d < bestNpcDist) {
                        bestNpcDist = d;
                        bestNpc = entity;
                    }
                }
            });

            // 1. Objet ou coffre immédiatement adjacent ou plus proche qu'un monstre
            if(bestChest && bestChestDist <= bestItemDist && bestChestDist <= bestMobDist) {
                this.makePlayerOpenChest(bestChest);
                return;
            }
            if(bestItem && bestItemDist <= bestMobDist) {
                this.makePlayerGoToItem(bestItem);
                return;
            }
            // 2. Monstre ou Boss à portée de combat
            if(bestMob) {
                this.makePlayerAttack(bestMob);
                return;
            }
            // 3. Coffre ou objet à proximité
            if(bestChest && bestChestDist <= bestItemDist) {
                this.makePlayerOpenChest(bestChest);
                return;
            }
            if(bestItem) {
                this.makePlayerGoToItem(bestItem);
                return;
            }
            // 4. PNJ à proximité
            if(bestNpc) {
                if(this.player.isAdjacentNonDiagonal(bestNpc)) {
                    this.makeNpcTalk(bestNpc);
                } else {
                    this.makePlayerTalkTo(bestNpc);
                }
                return;
            }

            this.makePlayerAttackClosest();
        },

        /**
         * Uses the first available healing item (flask, burger, cake) in the player's 6-slot backpack.
         */
        useFirstHealingItem: function() {
            if(!this.player || !this.player.inventory) return;
            for(var i = 0; i < 6; i++) {
                var k = this.player.inventory[i];
                if(k && Types.isHealingItem(k) && (this.player.inventoryCount[i] || 0) > 0) {
                    this.useInventoryItem(i);
                    return;
                }
            }
            if(this.app && this.app.showMessage) {
                this.app.showMessage("Aucune potion ou nourriture dans votre Sac à dos !");
            }
        },

        /**
         * Moves the current player to a given target location.
         * @see makeCharacterGoTo
         */
        makePlayerGoTo: function(x, y) {
            this.makeCharacterGoTo(this.player, x, y);
        },

        /**
         * Moves the current player towards a specific item.
         * @see makeCharacterGoTo
         */
        makePlayerGoToItem: function(item) {
            if(item) {
                this.player.isLootMoving = true;
                this.makePlayerGoTo(item.gridX, item.gridY);
            }
        },

        /**
         *
         */
        makePlayerTalkTo: function(npc) {
            if(npc) {
                this.player.setTarget(npc);
                this.player.follow(npc);
            }
        },

        makePlayerOpenChest: function(chest) {
            if(chest) {
                this.player.setTarget(chest);
                this.player.follow(chest);
            }
        },

        triggerAttackHaptic: function() {
            var now = Date.now();
            if(this._lastHapticTime && (now - this._lastHapticTime < 60)) {
                return false;
            }

            var hasCapacitor = (typeof window !== 'undefined' && Boolean(window.Capacitor));
            var isTouchDevice = Boolean(
                hasCapacitor ||
                (this.renderer && (this.renderer.mobile || this.renderer.tablet)) ||
                (typeof window !== 'undefined' && ('ontouchstart' in window)) ||
                (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
            );

            if(!isTouchDevice) {
                return false;
            }

            this._lastHapticTime = now;

            try {
                if(hasCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics && typeof window.Capacitor.Plugins.Haptics.impact === 'function') {
                    var res = window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
                    if(res && typeof res.catch === 'function') {
                        res.catch(function() {});
                    }
                    return true;
                }
                if(hasCapacitor && typeof window.Capacitor.nativePromise === 'function') {
                    var p = window.Capacitor.nativePromise('Haptics', 'impact', { style: 'LIGHT' });
                    if(p && typeof p.catch === 'function') {
                        p.catch(function() {});
                    }
                    return true;
                }
                if(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    navigator.vibrate(15);
                    return true;
                }
            } catch(e) {
                // Ignore haptics errors on unsupported devices
            }
            return false;
        },

        makePlayerAttack: function(mob) {
            this.createAttackLink(this.player, mob);
            this.triggerAttackHaptic();
            this.client.sendAttack(mob);
        },

        /**
         *
         */
        makeNpcTalk: function(npc) {
            var msg;

            if(npc) {
                msg = npc.talk(this);
                this.previousClickPosition = {};
                if(msg) {
                    this.createBubble(npc.id, msg);
                    this.assignBubbleTo(npc);
                    this.audioManager.playSound("npc");
                } else {
                    this.destroyBubble(npc.id);
                    this.audioManager.playSound("npc-end");
                }
                this.tryUnlockingAchievement("SMALL_TALK");

                if(npc.kind === Types.Entities.RICK) {
                    this.tryUnlockingAchievement("RICKROLLD");
                }
            }
        },

        /**
         * Loops through all the entities currently present in the game.
         * @param {Function} callback The function to call back (must accept one entity argument).
         */
        forEachEntity: function(callback) {
            _.each(this.entities, function(entity) {
                callback(entity);
            });
        },

        /**
         * Same as forEachEntity but only for instances of the Mob subclass.
         * @see forEachEntity
         */
        forEachMob: function(callback) {
            _.each(this.entities, function(entity) {
                if(entity instanceof Mob) {
                    callback(entity);
                }
            });
        },

        /**
         * Loops through all entities visible by the camera and sorted by depth :
         * Lower 'y' value means higher depth.
         * Note: This is used by the Renderer to know in which order to render entities.
         */
        forEachVisibleEntityByDepth: function(callback) {
            var self = this,
                m = this.map;

            this.camera.forEachVisiblePosition(function(x, y) {
                if(!m.isOutOfBounds(x, y)) {
                    if(self.renderingGrid[y][x]) {
                        _.each(self.renderingGrid[y][x], function(entity) {
                            callback(entity);
                        });
                    }
                }
            }, this.renderer.mobile ? 0 : 2);
        },

        /**
         *
         */
        forEachVisibleTileIndex: function(callback, extra) {
            var m = this.map;

            this.camera.forEachVisiblePosition(function(x, y) {
                if(!m.isOutOfBounds(x, y)) {
                    callback(m.GridPositionToTileIndex(x, y) - 1);
                }
            }, extra);
        },

        /**
         *
         */
        forEachVisibleTile: function(callback, extra) {
            var self = this,
                m = this.map;

            if(m.isLoaded) {
                this.forEachVisibleTileIndex(function(tileIndex) {
                    if(_.isArray(m.data[tileIndex])) {
                        _.each(m.data[tileIndex], function(id) {
                            callback(id-1, tileIndex);
                        });
                    }
                    else {
                        if(_.isNaN(m.data[tileIndex]-1)) {
                            //throw Error("Tile number for index:"+tileIndex+" is NaN");
                        } else {
                            callback(m.data[tileIndex]-1, tileIndex);
                        }
                    }
                }, extra);
            }
        },

        /**
         *
         */
        forEachAnimatedTile: function(callback) {
            if(this.animatedTiles) {
                _.each(this.animatedTiles, function(tile) {
                    callback(tile);
                });
            }
        },

        /**
         * Returns the entity located at the given position on the world grid.
         * @returns {Entity} the entity located at (x, y) or null if there is none.
         */
        getEntityAt: function(x, y) {
            if(this.map.isOutOfBounds(x, y) || !this.entityGrid) {
                return null;
            }

            var entities = this.entityGrid[y][x],
                entity = null;
            if(_.size(entities) > 0) {
                entity = entities[_.keys(entities)[0]];
            } else {
                entity = this.getItemAt(x, y);
            }
            return entity;
        },

        getMobAt: function(x, y) {
            if(this.map.isOutOfBounds(x, y) || !this.entityGrid) {
                return null;
            }
            var entities = this.entityGrid[y] ? this.entityGrid[y][x] : null;
            if(entities) {
                for(var id in entities) {
                    var entity = entities[id];
                    if(entity && (entity instanceof Mob) && !entity.isDead) {
                        return entity;
                    }
                }
            }
            var single = this.getEntityAt(x, y);
            if(single && (single instanceof Mob) && !single.isDead) {
                return single;
            }
            return null;
        },

        getPlayerAt: function(x, y) {
          var entity = this.getEntityAt(x, y);
            if(entity && (entity instanceof Player) && (entity !== this.player) && this.player.pvpFlag) {
                return entity;
            }
            return null;
        },

       getNpcAt: function(x, y) {
            var entity = this.getEntityAt(x, y);
            if(entity && (entity instanceof Npc)) {
                return entity;
            }
            return null;
        },

        getChestAt: function(x, y) {
            var entity = this.getEntityAt(x, y);
            if(entity && (entity instanceof Chest)) {
                return entity;
            }
            return null;
        },

        getItemAt: function(x, y) {
            if(this.map.isOutOfBounds(x, y) || !this.itemGrid) {
                return null;
            }
            var items = this.itemGrid[y][x],
                item = null;

            if(_.size(items) > 0) {
                // If there are potions/burgers stacked with equipment items on the same tile, always get expendable items first.
                _.each(items, function(i) {
                    if(Types.isExpendableItem(i.kind)) {
                        item = i;
                    };
                });

                // Else, get the first item of the stack
                if(!item) {
                    item = items[_.keys(items)[0]];
                }
            }
            return item;
        },

        /**
         * Returns true if an entity is located at the given position on the world grid.
         * @returns {Boolean} Whether an entity is at (x, y).
         */
        isEntityAt: function(x, y) {
            return !_.isNull(this.getEntityAt(x, y));
        },

        isMobAt: function(x, y) {
            return !_.isNull(this.getMobAt(x, y));
        },
        isPlayerAt: function(x, y) {
            return !_.isNull(this.getPlayerAt(x, y));
        },

        isItemAt: function(x, y) {
            return !_.isNull(this.getItemAt(x, y));
        },

        isNpcAt: function(x, y) {
            return !_.isNull(this.getNpcAt(x, y));
        },

        isChestAt: function(x, y) {
            return !_.isNull(this.getChestAt(x, y));
        },

        /**
         * Finds a path to a grid position for the specified character.
         * The path will pass through any entity present in the ignore list.
         */
        findPath: function(character, x, y, ignoreList) {
            var self = this,
                grid = this.pathingGrid,
                path = [],
                isPlayer = (character === this.player);

            if(this.map.isColliding(x, y)) {
                return path;
            }

            if(this.pathfinder && character) {
                if(ignoreList) {
                    _.each(ignoreList, function(entity) {
                        self.pathfinder.ignoreEntity(entity);
                    });
                }

                path = this.pathfinder.findPath(grid, character, x, y, false);

                if(ignoreList) {
                    this.pathfinder.clearIgnoreList();
                }
            } else {
                log.error("Error while finding the path to "+x+", "+y+" for "+character.id);
            }
            return path;
        },

        /**
         * Toggles the visibility of the pathing grid for debugging purposes.
         */
        togglePathingGrid: function() {
            if(this.debugPathing) {
                this.debugPathing = false;
            } else {
                this.debugPathing = true;
            }
        },

        /**
         * Toggles the visibility of the FPS counter and other debugging info.
         */
        toggleDebugInfo: function() {
            if(this.renderer && this.renderer.isDebugInfoVisible) {
                this.renderer.isDebugInfoVisible = false;
            } else {
                this.renderer.isDebugInfoVisible = true;
            }
        },

        /**
         *
         */
        movecursor: function() {
            var mouse = this.getMouseGridPosition(),
                x = mouse.x,
                y = mouse.y;

            this.hasMouseMoved = true;
            this.cursorVisible = true;

            if(this.player && !this.renderer.mobile && !this.renderer.tablet) {
                this.hoveringCollidingTile = this.map.isColliding(x, y);
                this.hoveringPlateauTile = this.player.isOnPlateau ? !this.map.isPlateau(x, y) : this.map.isPlateau(x, y);
                this.hoveringMob = this.isMobAt(x, y);
                this.hoveringPlayer = this.isPlayerAt(x, y);
                this.hoveringItem = this.isItemAt(x, y);
                this.hoveringNpc = this.isNpcAt(x, y);
                this.hoveringOtherPlayer = this.isPlayerAt(x, y);
                this.hoveringChest = this.isChestAt(x, y);

                if(this.hoveringMob || this.hoveringPlayer || this.hoveringNpc || this.hoveringChest || this.hoveringOtherPlayer) {
                    var entity = this.getEntityAt(x, y);

                    this.player.showTarget(entity);
                    if(!entity.isHighlighted && this.renderer.supportsSilhouettes) {
                        if(this.lastHovered) {
                            this.lastHovered.setHighlight(false);
                        }
                        entity.setHighlight(true);
                    }
                    this.lastHovered = entity;
                }
                else if(this.lastHovered) {
                    this.lastHovered.setHighlight(null);
                    if(this.timeout === undefined && !this.player.hasTarget()) {
                        var self = this;
                        this.timeout = setTimeout(function(){
                            $('#inspector').fadeOut('fast');
                            $('#inspector .health').text('');
                            self.player.inspecting = null;
                        }, 2000);
                        this.timeout = undefined;
                    }
                    this.lastHovered = null;
                }
            }
        },

        sendPlayerMoveIfChanged: function(x, y, source) {
            if(!this.client) return false;
            if(this._lastSentMoveX === x && this._lastSentMoveY === y) {
                if(this.doorDiagnostics) {
                    this.doorDiagnostics.recordGuard(
                        'DEDUP_STOP_MOVE',
                        'Paquet MOVE(' + x + ',' + y + ') redondant ignoré (' + (source || 'unknown') + ').',
                        { x: x, y: y, source: source }
                    );
                }
                return false;
            }
            this._lastSentMoveX = x;
            this._lastSentMoveY = y;
            this.client.sendMove(x, y);
            return true;
        },

        executeDoorTeleport: function(x, y, triggerSource) {
            var self = this;
            if(!this.player || !this.map || !this.map.isDoor(x, y)) return false;
            var dest = this.map.getDoorDestination(x, y);
            if(!dest) return false;

            var guardsApplied = [];
            if(this.doorDiagnostics) {
                this.doorDiagnostics.beginDoorTeleport(x, y, dest, triggerSource || 'STOP_PATHING');
            }

            if(this.currentZoning || (this.zoningQueue && this.zoningQueue.length > 0)) {
                this.currentZoning = null;
                this.zoningQueue = [];
                guardsApplied.push('CLEAR_ZONING_ON_DOOR');
                if(this.doorDiagnostics) {
                    this.doorDiagnostics.recordGuard(
                        'CLEAR_ZONING_ON_DOOR',
                        'Transition de zone active annulée lors du passage de la porte (' + x + ',' + y + ').',
                        { doorX: x, doorY: y }
                    );
                }
            }

            this.previousClickPosition = {};
            guardsApplied.push('RESET_CLICK_LOCKOUT');

            this.unregisterEntityPosition(this.player);
            guardsApplied.push('ENTITY_GRID_CLEAN_UNREGISTER');
            if(this.doorDiagnostics) {
                this.doorDiagnostics.recordGuard(
                    'ENTITY_GRID_CLEAN_UNREGISTER',
                    'Nettoyage de entityGrid/renderingGrid sur (' + x + ',' + y + ') avant téléportation vers (' + dest.x + ',' + dest.y + ').',
                    { fromX: x, fromY: y, toX: dest.x, toY: dest.y }
                );
            }

            this.player.path = null;
            this.player.newDestination = null;
            if(this.player.movement && typeof this.player.movement.stop === 'function') {
                this.player.movement.stop();
            }
            this.player.setGridPosition(dest.x, dest.y);
            this.player.nextGridX = dest.x;
            this.player.nextGridY = dest.y;
            this.player.turnTo(dest.orientation);
            this._lastSentMoveX = dest.x;
            this._lastSentMoveY = dest.y;
            this._lastDoorTeleportAt = Date.now();

            this.registerEntityPosition(this.player);
            this.client.sendTeleport(dest.x, dest.y);

            if(this.renderer.mobile && this.camera.gridW <= 15 && dest.cameraX && dest.cameraY) {
                this.camera.setGridPosition(dest.cameraX, dest.cameraY);
                this.resetZone();
            } else {
                if(dest.portal) {
                    this.assignBubbleTo(this.player);
                } else {
                    this.camera.focusEntity(this.player);
                    this.resetZone();
                }
            }

            if(_.size(this.player.attackers) > 0) {
                setTimeout(function() { self.tryUnlockingAchievement("COWARD"); }, 500);
            }
            this.player.forEachAttacker(function(attacker) {
                attacker.disengage();
                attacker.idle();
            });

            this.updatePlateauMode();
            this.checkUndergroundAchievement();
            this.doorFadeStartTime = Date.now();
            this.doorFadeDuration = 180;
            this.renderer.clearScreen(this.renderer.context);

            if(dest.portal) {
                this.audioManager.playSound("teleport");
            } else {
                this.audioManager.playSound("chat");
            }
            if(!this.player.isDead) {
                this.audioManager.updateMusic();
            }

            if(this.doorDiagnostics) {
                this.doorDiagnostics.completeDoorTeleport(guardsApplied);
            }
            if(this.app && typeof this.app.updateHubMapLiveStatus === 'function') {
                this.app.updateHubMapLiveStatus();
            }
            return true;
        },

        resolveDoorThresholdTarget: function(pos) {
            if(!this.player || !this.map || !pos) return pos;
            var px = this.player.gridX,
                py = this.player.gridY,
                standingOnDoor = this.map.isDoor(px, py),
                cooldownElapsed = (Date.now() - (this._lastDoorTeleportAt || 0)) >= 350;

            // 1. Si le joueur est déjà debout sur une porte (ex: tapis de sortie de maison) et clique dessus ou pousse vers le mur du seuil
            if(standingOnDoor && !this.player.isMoving() && !this.player.hasTarget() && cooldownElapsed) {
                var isSameTile = (pos.x === px && pos.y === py);
                var isAdjacentBlockedThreshold = (Math.abs(pos.x - px) + Math.abs(pos.y - py) === 1) && this.map.isColliding(pos.x, pos.y);
                if(isSameTile || isAdjacentBlockedThreshold) {
                    if(this.doorDiagnostics) {
                        this.doorDiagnostics.recordGuard(
                            'STANDING_DOOR_EXIT_ASSIST',
                            'Activation directe de la porte (' + px + ',' + py + ') depuis le tapis de seuil.',
                            { playerX: px, playerY: py, inputX: pos.x, inputY: pos.y }
                        );
                    }
                    this.executeDoorTeleport(px, py, 'STANDING_DOOR_EXIT_ASSIST');
                    return null;
                }
            }

            // 2. Si le joueur clique sur un mur de seuil adjacent (1 case) à une porte (ex: bord noir sous le tapis de sortie d'une maison)
            if(this.map.isColliding(pos.x, pos.y)) {
                var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for(var i = 0; i < dirs.length; i++) {
                    var nx = pos.x + dirs[i][0],
                        ny = pos.y + dirs[i][1];
                    if(!this.map.isOutOfBounds(nx, ny) && this.map.isDoor(nx, ny) && !this.map.isColliding(nx, ny)) {
                        var distToPlayer = Math.abs(nx - px) + Math.abs(ny - py);
                        if(distToPlayer > 0 && distToPlayer <= 12) {
                            if(this.doorDiagnostics) {
                                this.doorDiagnostics.recordGuard(
                                    'DOOR_THRESHOLD_SNAP_ASSIST',
                                    'Clic seuil (' + pos.x + ',' + pos.y + ') redirigé vers la porte (' + nx + ',' + ny + ').',
                                    { clickedX: pos.x, clickedY: pos.y, snappedX: nx, snappedY: ny }
                                );
                            }
                            this.hoveringCollidingTile = false;
                            return { x: nx, y: ny };
                        }
                    }
                }
            }

            return pos;
        },

        /**
         * Moves the player one space, if possible
         */
        keys: function(pos, orientation) {
            this.hoveringCollidingTile = false;
            this.hoveringPlateauTile = false;

            if(this.isZoning()) {
                return;
            }
            var standingOnDoor = Boolean(this.player && this.map && this.map.isDoor(this.player.gridX, this.player.gridY));
            if(!standingOnDoor && pos.x === this.previousClickPosition.x && pos.y === this.previousClickPosition.y) {
                return;
            } else {
                if(!this.player.disableKeyboardNpcTalk)
                    this.previousClickPosition = pos;
            }

            if(!this.player.isMoving()) {
                this.cursorVisible = false;
                this.processInput(pos);
            }
        },

        click: function()
        {
            var pos = this.getMouseGridPosition();
            var targetMob = this.getMobAt(pos.x, pos.y);
            var isEntityClick = Boolean(targetMob || this.getEntityAt(pos.x, pos.y));

            var standingOnDoor = Boolean(this.player && this.map && this.map.isDoor(this.player.gridX, this.player.gridY));
            if(!standingOnDoor && !isEntityClick && pos.x === this.previousClickPosition.x && pos.y === this.previousClickPosition.y) {
                return;
            } else {
                this.previousClickPosition = pos;
            }

            this.processInput(pos);
        },

        /**
         * Processes game logic when the user triggers a click/touch event during the game.
         */
        processInput: function(pos) {
            var entity;

            if(this.started && this.player && !this.player.isDead && !this.isZoning()) {
                pos = this.resolveDoorThresholdTarget(pos);
                if(!pos) {
                    return;
                }
            }

            if(this.started
            && this.player
            && !this.isZoning()
            && !(this.player.isMoving() && this.isZoningTile(this.player.nextGridX, this.player.nextGridY))
            && !this.player.isDead
            && !this.hoveringCollidingTile
            && !this.hoveringPlateauTile) {
                var mob = this.getMobAt(pos.x, pos.y);
                entity = mob || this.getEntityAt(pos.x, pos.y);

                if(entity instanceof Mob || (entity instanceof Player && entity !== this.player && this.player.pvpFlag && this.pvpFlag)) {
                    this.makePlayerAttack(entity);
                }
                else if(entity instanceof Item) {
                    this.makePlayerGoToItem(entity);
                }
                else if(entity instanceof Npc) {
                    if(this.player.isAdjacentNonDiagonal(entity) === false) {
                        this.makePlayerTalkTo(entity);
                    } else {
                        if(!this.player.disableKeyboardNpcTalk) {
                            this.makeNpcTalk(entity);

                            if(this.player.moveUp || this.player.moveDown || this.player.moveLeft || this.player.moveRight)
                                this.player.disableKeyboardNpcTalk = true;
                        }
                    }
                }
                else if(entity instanceof Chest) {
                    this.makePlayerOpenChest(entity);
                }
                else {
                    this.makePlayerGoTo(pos.x, pos.y);
                }
            }
        },

        isMobOnSameTile: function(mob, x, y) {
            var X = x || mob.gridX,
                Y = y || mob.gridY,
                list = this.entityGrid[Y][X],
                result = false;

            _.each(list, function(entity) {
                if(entity instanceof Mob && entity.id !== mob.id) {
                    result = true;
                }
            });
            return result;
        },

        getFreeAdjacentNonDiagonalPosition: function(entity) {
            var self = this,
                result = null;

            entity.forEachAdjacentNonDiagonalPosition(function(x, y, orientation) {
                if(!result && !self.map.isColliding(x, y) && !self.isMobAt(x, y)) {
                    result = {x: x, y: y, o: orientation};
                }
            });
            return result;
        },

        tryMovingToADifferentTile: function(character) {
            var attacker = character,
                target = character.target;

            if(attacker && target && target instanceof Player) {
                if(!target.isMoving() && attacker.getDistanceToEntity(target) === 0) {
                    var pos;

                    switch(target.orientation) {
                        case Types.Orientations.UP:
                            pos = {x: target.gridX, y: target.gridY - 1, o: target.orientation}; break;
                        case Types.Orientations.DOWN:
                            pos = {x: target.gridX, y: target.gridY + 1, o: target.orientation}; break;
                        case Types.Orientations.LEFT:
                            pos = {x: target.gridX - 1, y: target.gridY, o: target.orientation}; break;
                        case Types.Orientations.RIGHT:
                            pos = {x: target.gridX + 1, y: target.gridY, o: target.orientation}; break;
                    }

                    if(pos) {
                        attacker.previousTarget = target;
                        attacker.disengage();
                        attacker.idle();
                        this.makeCharacterGoTo(attacker, pos.x, pos.y);
                        target.adjacentTiles[pos.o] = true;

                        return true;
                    }
                }

                if(!target.isMoving() && attacker.isAdjacentNonDiagonal(target) && this.isMobOnSameTile(attacker)) {
                    var pos = this.getFreeAdjacentNonDiagonalPosition(target);

                    // avoid stacking mobs on the same tile next to a player
                    // by making them go to adjacent tiles if they are available
                    if(pos && !target.adjacentTiles[pos.o]) {
                        if(this.player.target && attacker.id === this.player.target.id) {
                            return false; // never unstack the player's target
                        }

                        attacker.previousTarget = target;
                        attacker.disengage();
                        attacker.idle();
                        this.makeCharacterGoTo(attacker, pos.x, pos.y);
                        target.adjacentTiles[pos.o] = true;

                        return true;
                    }
                }
            }
            return false;
        },

        /**
         *
         */
        spawnMobProjectile: function(attacker, target) {
            if(!attacker || !target || !Types.getMobPowerSpec) return;
            var spec = Types.getMobPowerSpec(attacker.kind);
            if(!spec) return;
            this.projectiles.push({
                sx: attacker.x + 8,
                sy: attacker.y + 4,
                tx: target.x + 8,
                ty: target.y + 4,
                color: spec.color || "#a855f7",
                glow: spec.glow || "#f3e8ff",
                aoe: !!spec.aoe,
                startTime: this.currentTime || Date.now(),
                duration: 360
            });
            if(spec.aoe && this.infoManager) {
                this.infoManager.addDamageInfo("⚡ " + spec.powerName, attacker.x, attacker.y - 24, "exp", 1400);
            }
        },

        spawnPlayerArrow: function(attacker, target) {
            if(!attacker || !target) return;
            var isGolden = (attacker.weapon === Types.Entities.GOLDENBOW || attacker.weapon === 'goldenbow');
            this.projectiles.push({
                sx: attacker.x + 8,
                sy: attacker.y + 4,
                tx: target.x + 8,
                ty: target.y + 4,
                color: isGolden ? "#eab308" : "#854d0e",
                glow: isGolden ? "#fef08a" : "#fed7aa",
                isArrow: true,
                isGolden: isGolden,
                startTime: this.currentTime || Date.now(),
                duration: 220
            });
            if(this.audioManager) {
                this.audioManager.playSound("hit2");
            }
        },

        onCharacterUpdate: function(character) {
            var time = this.currentTime,
                self = this;
            
            // If mob has finished moving to a different tile in order to avoid stacking, attack again from the new position.
            if(character.previousTarget && !character.isMoving() && character instanceof Mob) {
                var t = character.previousTarget;

                if(this.getEntityById(t.id)) { // does it still exist?
                    character.previousTarget = null;
                    this.createAttackLink(character, t);
                    return;
                }
            }

            if(character.isAttacking() && (!character.previousTarget || character.id === this.playerId)) {
                var isRanged = (character instanceof Mob && Types.isRangedMob && Types.isRangedMob(character.kind));
                var isMoving = isRanged ? false : this.tryMovingToADifferentTile(character); // Don't let multiple mobs stack on the same tile when attacking a player.

                if(character.canAttack(time)) {
                    if(isRanged && character.isMoving()) {
                        character.stop();
                    }
                    if(!isMoving) { // don't hit target if moving to a different tile.
                        if(character.hasTarget() && character.getOrientationTo(character.target) !== character.orientation) {
                            character.lookAtTarget();
                        }

                        character.hit();

                        if(isRanged && character.hasTarget()) {
                            this.spawnMobProjectile(character, character.target);
                        }

                        if(character.id === this.playerId) {
                            if(Types.isRangedWeapon && Types.isRangedWeapon(this.player.weapon) && character.hasTarget()) {
                                this.spawnPlayerArrow(character, character.target);
                            }
                            this.triggerAttackHaptic();
                            this.client.sendHit(character.target);
                        }

                        if(character instanceof Player && this.camera.isVisible(character)) {
                            this.audioManager.playSound("hit"+Math.floor(Math.random()*2+1));
                        }

                        if(character.hasTarget() && character.target.id === this.playerId && this.player && !this.player.invincible) {
                            this.client.sendHurt(character);
                        }
                    }
                } else {
                    if(character.hasTarget()
                    && !isRanged
                    && character.isDiagonallyAdjacent(character.target)
                    && character.target instanceof Player
                    && !character.target.isMoving()) {
                        character.follow(character.target);
                    }
                }
            }
        },

        /**
         *
         */
        isZoningTile: function(x, y) {
            var c = this.camera;

            x = x - c.gridX;
            y = y - c.gridY;

            if(x === 0 || y === 0 || x === c.gridW-1 || y === c.gridH-1) {
                return true;
            }
            return false;
        },

        /**
         *
         */
        getZoningOrientation: function(x, y) {
            var orientation = "",
                c = this.camera;

            x = x - c.gridX;
            y = y - c.gridY;

            if(x === 0) {
                orientation = Types.Orientations.LEFT;
            }
            else if(y === 0) {
                orientation = Types.Orientations.UP;
            }
            else if(x === c.gridW-1) {
                orientation = Types.Orientations.RIGHT;
            }
            else if(y === c.gridH-1) {
                orientation = Types.Orientations.DOWN;
            }

            return orientation;
        },

        startZoningFrom: function(x, y) {
            this.zoningOrientation = this.getZoningOrientation(x, y);

            if(this.renderer.mobile || this.renderer.tablet) {
                var z = this.zoningOrientation,
                    c = this.camera,
                    ts = this.renderer.tilesize,
                    x = c.x,
                    y = c.y,
                    xoffset = (c.gridW - 2) * ts,
                    yoffset = (c.gridH - 2) * ts;

                if(z === Types.Orientations.LEFT || z === Types.Orientations.RIGHT) {
                    x = (z === Types.Orientations.LEFT) ? c.x - xoffset : c.x + xoffset;
                } else if(z === Types.Orientations.UP || z === Types.Orientations.DOWN) {
                    y = (z === Types.Orientations.UP) ? c.y - yoffset : c.y + yoffset;
                }
                c.setPosition(x, y);

                this.renderer.clearScreen(this.renderer.context);
                this.endZoning();

                // Force immediate drawing of all visible entities in the new zone
                this.forEachVisibleEntityByDepth(function(entity) {
                    entity.setDirty();
                });
            }
            else {
                this.currentZoning = new Transition();
            }
            this.bubbleManager.clean();
            this.client.sendZone();
        },

        enqueueZoningFrom: function(x, y) {
            this.zoningQueue.push({x: x, y: y});

            if(this.zoningQueue.length === 1) {
                this.startZoningFrom(x, y);
            }
        },

        endZoning: function() {
            this.currentZoning = null;
            this.resetZone();
            this.zoningQueue.shift();

            if(this.zoningQueue.length > 0) {
                var pos = this.zoningQueue[0];
                this.startZoningFrom(pos.x, pos.y);
            }
        },

        isZoning: function() {
            return !_.isNull(this.currentZoning);
        },

        resetZone: function() {
            this.bubbleManager.clean();
            this.initAnimatedTiles();
            this.renderer.renderStaticCanvases();
        },

        resetCamera: function() {
            this.camera.focusEntity(this.player);
            this.resetZone();
        },

        say: function(message) {
            if(this.app && this.app.chatMode === 'guild') {
                this.client.sendHub('guild_chat', { message: message });
                return;
            }
            this.client.sendChat(message);
        },

        useInventoryItem: function(slot) {
            if(this.player && this.player.inventory && this.player.inventory[slot]) {
                var itemKind = this.player.inventory[slot];
                if(Types.isHealingItem(itemKind)) {
                    this.audioManager.playSound("heal");
                } else {
                    this.audioManager.playSound("loot");
                }
                this.client.sendInventory("use", slot, 1);
            }
        },

        dropInventoryItem: function(slot) {
            if(this.player && this.player.inventory && this.player.inventory[slot]) {
                this.audioManager.playSound("noloot");
                this.client.sendInventory("drop", slot, 1);
            }
        },

        eat: function(slot) {
            this.useInventoryItem(slot);
        },

        createBubble: function(id, message) {
            this.bubbleManager.create(id, message, this.currentTime);
        },

        destroyBubble: function(id) {
            this.bubbleManager.destroyBubble(id);
        },

        assignBubbleTo: function(character) {
            var bubble = this.bubbleManager.getBubbleById(character.id);

            if(bubble) {
                var s = this.renderer.scale,
                    t = 16 * s, // tile size
                    x = ((character.x - this.camera.x) * s),
                    w = parseInt(bubble.element.css('width')) + 24,
                    offset = (w / 2) - (t / 2),
                    offsetY,
                    y;

                if(character instanceof Npc) {
                    offsetY = 0;
                } else {
                    if(s === 2) {
                        if(this.renderer.mobile) {
                            offsetY = 0;
                        } else {
                            offsetY = 15;
                        }
                    } else {
                        offsetY = 12;
                    }
                }

                y = ((character.y - this.camera.y) * s) - (t * 2) - offsetY;

                bubble.element.css('left', x - offset + 'px');
                bubble.element.css('top', y + 'px');
            }
        },

        respawn: function() {
            log.debug("Beginning respawn");

            this.entities = {};
            this.initEntityGrid();
            this.initPathingGrid();
            this.initRenderingGrid();

            this.player = new Warrior("player", this.username);
            this.player.pw = this.userpw;
            this.player.email = this.email;
            this.initPlayer();
            this.app.initTargetHud();

            this.started = true;
            this.client.enable();
            this.client.sendLogin(this.player);

            this.storage.incrementRevives();

            if(this.renderer.mobile || this.renderer.tablet) {
                this.renderer.clearScreen(this.renderer.context);
            }

            log.debug("Finished respawn");
        },

        onGameStart: function(callback) {
            this.gamestart_callback = callback;
        },

        onDisconnect: function(callback) {
            this.disconnect_callback = callback;
        },

        onPlayerDeath: function(callback) {
            this.playerdeath_callback = callback;
        },

        onUpdateTarget: function(callback){
          this.updatetarget_callback = callback;
        },
        onPlayerExpChange: function(callback){
            this.playerexp_callback = callback;
        },

        onPlayerHealthChange: function(callback) {
            this.playerhp_callback = callback;
        },

        onPlayerHurt: function(callback) {
            this.playerhurt_callback = callback;
        },

        onPlayerEquipmentChange: function(callback) {
            this.equipment_callback = callback;
        },

        onNbPlayersChange: function(callback) {
            this.nbplayers_callback = callback;
        },
        
        onGuildPopulationChange: function(callback) {
			this.nbguildplayers_callback = callback;
		},

        onNotification: function(callback) {
            this.notification_callback = callback;
        },

        onPlayerInvincible: function(callback) {
            this.invincible_callback = callback
        },

        resize: function() {
            var x = this.camera.x,
                y = this.camera.y,
                currentScale = this.renderer.scale,
                newScale = this.renderer.getScaleFactor();

                this.renderer.rescale(newScale);
                this.camera = this.renderer.camera;
                this.camera.setPosition(x, y);

                this.renderer.renderStaticCanvases();
        },

        updateBars: function() {
            if(this.player && this.playerhp_callback) {
                this.playerhp_callback(this.player.hitPoints, this.player.maxHitPoints);
            }
        },
        updateExpBar: function(){
            if(this.player && this.playerexp_callback){
                var expInThisLevel = this.player.experience - Types.expForLevel[this.player.level-1];
                var expForLevelUp = Types.expForLevel[this.player.level] - Types.expForLevel[this.player.level-1];
                this.playerexp_callback(expInThisLevel, expForLevelUp);
            }
        },
        updateTarget: function(targetId, points, healthPoints, maxHp){
            if(this.player.hasTarget() && this.updatetarget_callback){
                var target = this.getEntityById(targetId);
                target.name = Types.getKindAsString(target.kind);
                target.points = points;
                target.healthPoints = healthPoints;
                target.maxHp = maxHp;
                this.updatetarget_callback(target);
            }
        },
    
        getDeadMobPosition: function(mobId) {
            var position;

            if(mobId in this.deathpositions) {
                position = this.deathpositions[mobId];
                delete this.deathpositions[mobId];
            }

            return position;
        },

        onAchievementUnlock: function(callback) {
            this.unlock_callback = callback;
        },

        tryUnlockingAchievement: function(name) {
            var achievement = null;
            if(name in this.achievements) {
                achievement = this.achievements[name];

                if(achievement.isCompleted() && this.storage.unlockAchievement(achievement.id)) {
                    if(this.unlock_callback) {
                        this.unlock_callback(achievement.id, achievement.name, achievement.desc);
                        this.audioManager.playSound("achievement");
                    }
                }
            }
        },

        showNotification: function(message) {
            if(this.notification_callback) {
                this.notification_callback(message);
            }
        },

        removeObsoleteEntities: function() {
            var nb = _.size(this.obsoleteEntities),
                self = this;

            if(nb > 0) {
                _.each(this.obsoleteEntities, function(entity) {
                    if(entity.id != self.player.id) { // never remove yourself
                        self.removeEntity(entity);
                    }
                });
                log.debug("Removed "+nb+" entities: "+_.pluck(_.reject(this.obsoleteEntities, function(id) { return id === self.player.id }), 'id'));
                this.obsoleteEntities = null;
            }
        },

        /**
         * Fake a mouse move event in order to update the cursor.
         *
         * For instance, to get rid of the sword cursor in case the mouse is still hovering over a dying mob.
         * Also useful when the mouse is hovering a tile where an item is appearing.
         */
        updateCursor: function() {
            if(!this.cursorVisible)
                var keepCursorHidden = true;

            this.movecursor();
            this.updateCursorLogic();

            if(keepCursorHidden)
                this.cursorVisible = false;
        },

        /**
         * Change player plateau mode when necessary
         */
        updatePlateauMode: function() {
            if(this.map.isPlateau(this.player.gridX, this.player.gridY)) {
                this.player.isOnPlateau = true;
            } else {
                this.player.isOnPlateau = false;
            }
        },

        updatePlayerCheckpoint: function() {
            var checkpoint = this.map.getCurrentCheckpoint(this.player);

            if(checkpoint) {
                var lastCheckpoint = this.player.lastCheckpoint;
                if(!lastCheckpoint || (lastCheckpoint && lastCheckpoint.id !== checkpoint.id)) {
                    this.player.lastCheckpoint = checkpoint;
                    this.client.sendCheck(checkpoint.id);
                }
            }
        },

        checkUndergroundAchievement: function() {
            var music = this.audioManager.getSurroundingMusic(this.player);

            if(music) {
                if(music.name === 'cave') {
                    this.tryUnlockingAchievement("UNDERGROUND");
                }
            }
        },

        makeAttackerFollow: function(attacker) {
              var target = attacker.target;

              if(attacker.isAdjacent(attacker.target)) {
                    attacker.lookAtTarget();
              } else {
                  attacker.follow(target);
              }
        },

        forEachEntityAround: function(x, y, r, callback) {
            for(var i = x-r, max_i = x+r; i <= max_i; i += 1) {
                for(var j = y-r, max_j = y+r; j <= max_j; j += 1) {
                    if(!this.map.isOutOfBounds(i, j)) {
                        _.each(this.renderingGrid[j][i], function(entity) {
                            callback(entity);
                        });
                    }
                }
            }
        },

        checkOtherDirtyRects: function(r1, source, x, y) {
            // Rendu plein écran unifié : pas de recalcul O(N²) des dirty rects
            return;
        },

	    tryLootingItem: function(item) {
            try {
                this.player.loot(item);
                this.client.sendLoot(item); // Notify the server that this item has been looted
                this.removeItem(item);
                this.showNotification(item.getLootMessage());

                if(item.type === "armor") {
                    this.tryUnlockingAchievement("FAT_LOOT");
                }

                if(item.type === "weapon") {
                    this.tryUnlockingAchievement("A_TRUE_WARRIOR");
                }

                if(item.kind === Types.Entities.CAKE) {
                    this.tryUnlockingAchievement("FOR_SCIENCE");
                }

                if(item.kind === Types.Entities.FIREPOTION) {
                    this.tryUnlockingAchievement("FOXY");
                    this.audioManager.playSound("firefox");
                }

                if(Types.isHealingItem(item.kind)) {
                    this.audioManager.playSound("heal");
                } else {
                    this.audioManager.playSound("loot");
                }

                if(item.wasDropped && !_(item.playersInvolved).include(this.playerId)) {
                    this.tryUnlockingAchievement("NINJA_LOOT");
                }
            } catch(e) {
                if(e instanceof Exceptions.LootException) {
                    this.showNotification(e.message);
                    this.audioManager.playSound("noloot");
                } else {
                    throw e;
                }
            }
        }
    });

    return Game;
});
