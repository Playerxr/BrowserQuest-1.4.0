
define(['character', 'timer'], function(Character, Timer) {

    var Updater = Class.extend({
        init: function(game) {
            this.game = game;
            this.playerAggroTimer = new Timer(1000);
        },

        update: function() {
            this.updateZoning();
            this.updateTransitions();
            this.updateKeyboardMovement();
            this.updateCharacters();
            this.updatePlayerAggro();
            this.updateAnimations();
            this.updateAnimatedTiles();
            this.updateChatBubbles();
            this.updateInfos();
            this.updateRegionToast();
            this.updateMinimap();
        },

        updateCharacters: function() {
            var self = this;

            this.game.forEachEntity(function(entity) {
                var isCharacter = entity instanceof Character;

                if(entity.isLoaded) {
                    if(isCharacter) {
                        self.updateCharacter(entity);
                        self.game.onCharacterUpdate(entity);
                    }
                    self.updateEntityFading(entity);
                }
            });
        },

        updatePlayerAggro: function() {
            var t = this.game.currentTime,
                player = this.game.player;

            // Check player aggro every 1s when not moving nor attacking
            if(player && !player.isMoving() && !player.isAttacking()  && this.playerAggroTimer.isOver(t)) {
                player.checkAggro();
            }
        },

        updateEntityFading: function(entity) {
            if(entity && entity.isFading) {
                var duration = 1000,
                    t = this.game.currentTime,
                    dt = t - entity.startFadingTime;

                if(dt > duration) {
                    this.isFading = false;
                    entity.fadingAlpha = 1;
                } else {
                    entity.fadingAlpha = dt / duration;
                }
            }
        },

        updateTransitions: function() {
            var self = this,
                m = null,
                z = this.game.currentZoning;

            this.game.forEachEntity(function(entity) {
                m = entity.movement;
                if(m) {
                    if(m.inProgress) {
                        m.step(self.game.currentTime);
                    }
                }
            });

            if(z) {
                if(z.inProgress) {
                    z.step(this.game.currentTime);
                }
            }
        },

        updateZoning: function() {
            var g = this.game,
                c = g.camera,
                z = g.currentZoning,
                s = 3,
                ts = 16,
                speed = 500;

            if(z && z.inProgress === false) {
                var orientation = this.game.zoningOrientation,
                    startValue = endValue = offset = 0,
                    updateFunc = null,
                    endFunc = null;

                if(orientation === Types.Orientations.LEFT || orientation === Types.Orientations.RIGHT) {
                    offset = (c.gridW - 2) * ts;
                    startValue = (orientation === Types.Orientations.LEFT) ? c.x - ts : c.x + ts;
                    endValue = (orientation === Types.Orientations.LEFT) ? c.x - offset : c.x + offset;
                    updateFunc = function(x) {
                        c.setPosition(x, c.y);
                        g.initAnimatedTiles();
                        g.renderer.renderStaticCanvases();
                    }
                    endFunc = function() {
                        c.setPosition(z.endValue, c.y);
                        g.endZoning();
                    }
                } else if(orientation === Types.Orientations.UP || orientation === Types.Orientations.DOWN) {
                    offset = (c.gridH - 2) * ts;
                    startValue = (orientation === Types.Orientations.UP) ? c.y - ts : c.y + ts;
                    endValue = (orientation === Types.Orientations.UP) ? c.y - offset : c.y + offset;
                    updateFunc = function(y) {
                        c.setPosition(c.x, y);
                        g.initAnimatedTiles();
                        g.renderer.renderStaticCanvases();
                    }
                    endFunc = function() {
                        c.setPosition(c.x, z.endValue);
                        g.endZoning();
                    }
                }

                z.start(this.game.currentTime, updateFunc, endFunc, startValue, endValue, speed);
            }
        },

        updateCharacter: function(c) {
            var self = this;

            if(c.isMoving() && c.movement.inProgress === false) {
                var startX = c.gridX * 16,
                    startY = c.gridY * 16;
                if(c.orientation === Types.Orientations.LEFT) {
                    c.movement.start(this.game.currentTime,
                                     function(x) {
                                        c.x = x;
                                        c.hasMoved();
                                     },
                                     function() {
                                        c.x = c.movement.endValue;
                                        c.hasMoved();
                                        c.nextStep();
                                     },
                                     startX,
                                     startX - 16,
                                     c.moveSpeed);
                }
                else if(c.orientation === Types.Orientations.RIGHT) {
                    c.movement.start(this.game.currentTime,
                                     function(x) {
                                        c.x = x;
                                        c.hasMoved();
                                     },
                                     function() {
                                        c.x = c.movement.endValue;
                                        c.hasMoved();
                                        c.nextStep();
                                     },
                                     startX,
                                     startX + 16,
                                     c.moveSpeed);
                }
                else if(c.orientation === Types.Orientations.UP) {
                    c.movement.start(this.game.currentTime,
                                     function(y) {
                                        c.y = y;
                                        c.hasMoved();
                                     },
                                     function() {
                                        c.y = c.movement.endValue;
                                        c.hasMoved();
                                        c.nextStep();
                                     },
                                     startY,
                                     startY - 16,
                                     c.moveSpeed);
                }
                else if(c.orientation === Types.Orientations.DOWN) {
                    c.movement.start(this.game.currentTime,
                                     function(y) {
                                        c.y = y;
                                        c.hasMoved();
                                     },
                                     function() {
                                        c.y = c.movement.endValue;
                                        c.hasMoved();
                                        c.nextStep();
                                     },
                                     startY,
                                     startY + 16,
                                     c.moveSpeed);
                }
            }
        },

        updateKeyboardMovement: function() {
            var game = this.game,
                player = game ? game.player : null;
            if(!player) return;

            // Maintien du clic souris : suivre le curseur en continu
            if(game.mouseHeld && !player.moveUp && !player.moveDown && !player.moveLeft && !player.moveRight) {
                if(typeof game.stepMouseHold === 'function') {
                    game.stepMouseHold();
                }
                return;
            }

            if(player.isMoving()) return;

            if(typeof game.tryDirectStep === 'function') {
                game.tryDirectStep();
            }
        },

        updateAnimations: function() {
            var t = this.game.currentTime;

            this.game.forEachEntity(function(entity) {
                var anim = entity.currentAnimation;

                if(anim) {
                    if(anim.update(t)) {
                        entity.setDirty();
                    }
                }
            });

            var sparks = this.game.sparksAnimation;
            if(sparks) {
                sparks.update(t);
            }

            var target = this.game.targetAnimation;
            if(target) {
                target.update(t);
            }
        },

        updateAnimatedTiles: function() {
            var self = this,
                t = this.game.currentTime;

            this.game.forEachAnimatedTile(function (tile) {
                if(tile.animate(t)) {
                    tile.isDirty = true;
                    tile.dirtyRect = self.game.renderer.getTileBoundingRect(tile);

                    if(self.game.renderer.mobile || self.game.renderer.tablet) {
                        self.game.checkOtherDirtyRects(tile.dirtyRect, tile, tile.x, tile.y);
                    }
                }
            });
        },

        updateChatBubbles: function() {
            var self = this,
                t = this.game.currentTime;

            this.game.bubbleManager.update(t);
            this.game.bubbleManager.forEachBubble(function(bubble) {
                var entity = self.game.getEntityById(bubble.id);
                if(entity) {
                    self.game.assignBubbleTo(entity);
                }
            });
        },

        updateInfos: function() {
            var t = this.game.currentTime;

            this.game.infoManager.update(t);
        },

        updateRegionToast: function() {
            var player = this.game.player;
            if(!player || !this.game.started) return;

            var t = this.game.currentTime;
            if(this._lastRegionCheck && t - this._lastRegionCheck < 800) {
                return;
            }
            this._lastRegionCheck = t;

            var gx = player.gridX,
                gy = player.gridY;

            // Détection si le joueur est à l'intérieur d'une maison
            var isInterior = (gx >= 0 && gx <= 28 && gy >= 0 && gy <= 28) ||
                             (gx >= 10 && gx <= 28 && gy >= 30 && gy <= 50) ||
                             (gx >= 130 && gx <= 170 && gy >= 190 && gy <= 245);

            if(isInterior) {
                if(this._currentRegionKey !== 'interior') {
                    this._currentRegionKey = 'interior';
                    if(this.game.app && typeof this.game.app.showRegionBanner === 'function') {
                        this.game.app.showRegionBanner('Maison & Abri', 'Zone intérieure de repos — Régénération de PV active');
                    }
                }
                return;
            }

            var regions = [
                { key: 'village', name: 'Village de Départ', desc: 'Zone paisible & abri des aventuriers', x: 43, y: 210, radius: 45 },
                { key: 'beach', name: 'Plage du Sud', desc: 'Rive sablonneuse bordée de crabes', x: 110, y: 280, radius: 40 },
                { key: 'forest', name: 'Grande Forêt', desc: 'Sous-bois sauvages peuplés de gobelins', x: 65, y: 160, radius: 45 },
                { key: 'desert', name: 'Désert Aride', desc: 'Dunes brûlantes et squelettes errants', x: 145, y: 175, radius: 40 },
                { key: 'lavacave', name: 'Caverne de Lave', desc: 'Profondeurs volcaniques incandescentes', x: 150, y: 80, radius: 35 },
                { key: 'castle', name: 'Château Royal', desc: 'Forteresse ancestrale et gardes d\'élite', x: 155, y: 275, radius: 30 },
                { key: 'graveyard', name: 'Cimetière Maudit', desc: 'Terres maudites hantées par les spectres', x: 25, y: 45, radius: 40 },
                { key: 'bossroom', name: 'Antre des Boss', desc: 'Zone de combat d\'Élite et de Raid mondial', x: 45, y: 105, radius: 30 }
            ];

            var closest = null,
                minDist = 999999;

            for(var i = 0; i < regions.length; i++) {
                var r = regions[i];
                var dist = Math.sqrt((gx - r.x) * (gx - r.x) + (gy - r.y) * (gy - r.y));
                if(dist < minDist) {
                    minDist = dist;
                    closest = r;
                }
            }

            if(closest && closest.key !== this._currentRegionKey) {
                var isFirst = !this._currentRegionKey;
                this._currentRegionKey = closest.key;
                if(this.game.app && typeof this.game.app.showRegionBanner === 'function') {
                    this.game.app.showRegionBanner(closest.name, closest.desc);
                }
                if(!isFirst && this.game.app && typeof this.game.app.addChatMessage === 'function') {
                    this.game.app.addChatMessage(
                        'Exploration',
                        '[Région] Vous entrez dans : ' + closest.name + ' (' + closest.desc + ')',
                        'system'
                    );
                }
            }
        },

        updateMinimap: function() {
            if(this.game && this.game.app && typeof this.game.app.renderMinimap === 'function') {
                this.game.app.renderMinimap(false);
            }
        }
    });

    return Updater;
});
