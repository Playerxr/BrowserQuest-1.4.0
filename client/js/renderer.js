
define(['camera', 'item', 'character', 'player', 'timer'],
function(Camera, Item, Character, Player, Timer) {

    var Renderer = Class.extend({
        init: function(game, canvas, background, foreground) {
            this.game = game;
            this.context = (canvas && canvas.getContext) ? canvas.getContext("2d") : null;
            this.background = (background && background.getContext) ? background.getContext("2d") : null;
            this.foreground = (foreground && foreground.getContext) ? foreground.getContext("2d") : null;

            this.canvas = canvas;
            this.backcanvas = background;
            this.forecanvas = foreground;

            this.initFPS();
            this.tilesize = 16;

            this.upscaledRendering = this.context.mozImageSmoothingEnabled !== undefined;
            this.supportsSilhouettes = this.upscaledRendering;

            this.rescale(this.getScaleFactor());

            this.lastTime = new Date();
            this.frameCount = 0;
            this.maxFPS = this.FPS;
            this.realFPS = 0;
            //Turn on or off Debuginfo (FPS Counter)
            this.isDebugInfoVisible = false;

            this.animatedTileCount = 0;
            this.highTileCount = 0;

            this.tablet = Detect.isTablet(window.innerWidth);

            this.fixFlickeringTimer = new Timer(100);
        },

        getWidth: function() {
            return this.canvas.width;
        },

        getHeight: function() {
            return this.canvas.height;
        },

        setTileset: function(tileset) {
            this.tileset = tileset;
        },

        getScaleFactor: function() {
            var w = window.innerWidth,
                h = window.innerHeight,
                scale;

            this.mobile = false;

            if(w <= 1000) {
                scale = 2;
                this.mobile = true;
            }
            else if(w <= 1500 || h <= 870) {
                scale = 2;
            }
            else {
                scale = 3;
            }

            return scale;
        },

        rescale: function(factor) {
            this.scale = this.getScaleFactor();

            this.createCamera();

            var disableSmoothing = function(ctx) {
                if(!ctx) return;
                ctx.imageSmoothingEnabled = false;
                if('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
                if('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
                if('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = false;
            };

            disableSmoothing(this.context);
            disableSmoothing(this.background);
            disableSmoothing(this.foreground);

            this.initFont();
            this.initFPS();

            if(!this.upscaledRendering && this.game.map && this.game.map.tilesets) {
                this.setTileset(this.game.map.tilesets[this.scale - 1]);
            }
            if(this.game.renderer) {
                this.game.setSpriteScale(this.scale);
            }
        },

        createCamera: function() {
            this.camera = new Camera(this);
            this.camera.rescale();

            this.canvas.width = this.camera.gridW * this.tilesize * this.scale;
            this.canvas.height = this.camera.gridH * this.tilesize * this.scale;
            log.debug("#entities set to "+this.canvas.width+" x "+this.canvas.height);

            this.backcanvas.width = this.canvas.width;
            this.backcanvas.height = this.canvas.height;
            log.debug("#background set to "+this.backcanvas.width+" x "+this.backcanvas.height);

            this.forecanvas.width = this.canvas.width;
            this.forecanvas.height = this.canvas.height;
            log.debug("#foreground set to "+this.forecanvas.width+" x "+this.forecanvas.height);
        },

        initFPS: function() {
            this.FPS = this.mobile ? 50 : 50;
        },

        initFont: function() {
            var fontsize;

            switch(this.scale) {
                case 1:
                    fontsize = 10; break;
                case 2:
                    fontsize = Detect.isWindows() ? 10 : 13; break;
                case 3:
                    fontsize = 20;
            }
            this.setFontSize(fontsize);
        },

        setFontSize: function(size) {
            var font = size+"px GraphicPixel";

            this.context.font = font;
            this.background.font = font;
        },

        drawText: function(text, x, y, centered, color, strokeColor) {
            var ctx = this.context,
                strokeSize;

            switch(this.scale) {
                case 1:
                    strokeSize = 3; break;
                case 2:
                    strokeSize = 3; break;
                case 3:
                    strokeSize = 5;
            }

            if(text && x && y) {
                ctx.save();
                if(centered) {
                    ctx.textAlign = "center";
                }
                ctx.strokeStyle = strokeColor || "#373737";
                ctx.lineWidth = strokeSize;
                ctx.strokeText(text, x, y);
                ctx.fillStyle = color || "white";
                ctx.fillText(text, x, y);
                ctx.restore();
            }
        },

        drawCellRect: function(x, y, color) {
            this.context.save();
            this.context.lineWidth = 2*this.scale;
            this.context.strokeStyle = color;
            this.context.translate(x+2, y+2);
            this.context.strokeRect(0, 0, (this.tilesize * this.scale) - 4, (this.tilesize * this.scale) - 4);
            this.context.restore();
        },
        drawRectStroke: function(x, y, width, height, color) {
            this.context.fillStyle = color;
            this.context.fillRect(x, y, (this.tilesize * this.scale)*width, (this.tilesize * this.scale)*height);
            this.context.fill();
            this.context.lineWidth = 5;
            this.context.strokeStyle = 'black';
            this.context.strokeRect(x, y, (this.tilesize * this.scale)*width, (this.tilesize * this.scale)*height);
        },
        drawRect: function(x, y, width, height, color) {
            this.context.fillStyle = color;
            this.context.fillRect(x, y, (this.tilesize * this.scale)*width, (this.tilesize * this.scale)*height);
        },

        drawCellHighlight: function(x, y, color) {
            var s = this.scale,
                ts = this.tilesize,
                tx = x * ts * s,
                ty = y * ts * s;

            this.drawCellRect(tx, ty, color);
        },

        drawTargetCell: function() {
            if(this.mobile || this.tablet || !this.game.hasMouseMoved) {
                return;
            }
            var mouse = this.game.getMouseGridPosition();

            if(this.game.targetCellVisible && !(mouse.x === this.game.selectedX && mouse.y === this.game.selectedY)) {
                this.drawCellHighlight(mouse.x, mouse.y, this.game.targetColor);
            }
        },

        drawAttackTargetCell: function() {
            var mouse = this.game.getMouseGridPosition(),
                entity = this.game.getEntityAt(mouse.x, mouse.y),
                s = this.scale;

            if(entity) {
                this.drawCellRect(entity.x * s, entity.y * s, "rgba(255, 0, 0, 0.5)");
            }
        },

        drawOccupiedCells: function() {
            var positions = this.game.entityGrid;

            if(positions) {
                for(var i=0; i < positions.length; i += 1) {
                    for(var j=0; j < positions[i].length; j += 1) {
                        if(!_.isNull(positions[i][j])) {
                            this.drawCellHighlight(i, j, "rgba(50, 50, 255, 0.5)");
                        }
                    }
                }
            }
        },

        drawPathingCells: function() {
            var grid = this.game.pathingGrid;

            if(grid && this.game.debugPathing) {
                for(var y=0; y < grid.length; y += 1) {
                    for(var x=0; x < grid[y].length; x += 1) {
                        if(grid[y][x] === 1 && this.game.camera.isVisiblePosition(x, y)) {
                            this.drawCellHighlight(x, y, "rgba(50, 50, 255, 0.5)");
                        }
                    }
                }
            }
        },

        drawSelectedCell: function() {
                var sprite = this.game.cursors["target"],
                anim = this.game.targetAnimation,
                os = this.upscaledRendering ? 1 : this.scale,
                ds = this.upscaledRendering ? this.scale : 1;

            if(this.game.selectedCellVisible) {
                if(this.mobile || this.tablet) {
                    if(this.game.drawTarget) {
                        var x = this.game.selectedX,
                            y = this.game.selectedY;

                        this.drawCellHighlight(this.game.selectedX, this.game.selectedY, "rgb(51, 255, 0)");
                        this.lastTargetPos = { x: x,
                                               y: y };
                        this.game.drawTarget = false;
                    }
                } else {
                    if(sprite && anim) {
                        var    frame = anim.currentFrame,
                            s = this.scale,
                            x = frame.x * os,
                            y = frame.y * os,
                            w = sprite.width * os,
                            h = sprite.height * os,
                            ts = 16,
                            dx = this.game.selectedX * ts * s,
                            dy = this.game.selectedY * ts * s,
                            dw = w * ds,
                            dh = h * ds;

                        this.context.save();
                        this.context.translate(dx, dy);
                        this.context.drawImage(sprite.image, x, y, w, h, 0, 0, dw, dh);
                        this.context.restore();
                    }
                }
            }
        },

        clearScaledRect: function(ctx, x, y, w, h) {
            var s = this.scale;

            ctx.clearRect(x * s, y * s, w * s, h * s);
        },

        drawCursor: function() {
            var mx = this.game.mouse.x,
                my = this.game.mouse.y,
                s = this.scale,
                os = this.upscaledRendering ? 1 : this.scale;

            this.context.save();
            if(this.game.currentCursor && this.game.currentCursor.isLoaded) {
                this.context.drawImage(this.game.currentCursor.image, 0, 0, 14 * os, 14 * os, mx, my, 14*s, 14*s);
            }
            this.context.restore();
        },

        drawScaledImage: function(ctx, image, x, y, w, h, dx, dy) {
            var s = this.upscaledRendering ? 1 : this.scale;
            _.each(arguments, function(arg) {
                if(_.isUndefined(arg) || _.isNaN(arg) || _.isNull(arg) || arg < 0) {
                    log.error("x:"+x+" y:"+y+" w:"+w+" h:"+h+" dx:"+dx+" dy:"+dy, true);
                    throw Error("A problem occured when trying to draw on the canvas");
                }
            });

            ctx.drawImage(image,
                          x * s,
                          y * s,
                          w * s,
                          h * s,
                          dx * this.scale,
                          dy * this.scale,
                          w * this.scale,
                          h * this.scale);
        },

        drawTile: function(ctx, tileid, tileset, setW, gridW, cellid) {
            var s = this.upscaledRendering ? 1 : this.scale;
            if(tileid !== -1) { // -1 when tile is empty in Tiled. Don't attempt to draw it.
                this.drawScaledImage(ctx,
                                     tileset,
                                     getX(tileid + 1, (setW / s)) * this.tilesize,
                                     Math.floor(tileid / (setW / s)) * this.tilesize,
                                     this.tilesize,
                                     this.tilesize,
                                     getX(cellid + 1, gridW) * this.tilesize,
                                     Math.floor(cellid / gridW) * this.tilesize);
            }
        },

        clearTile: function(ctx, gridW, cellid) {
            var s = this.scale,
                ts = this.tilesize,
                x = getX(cellid + 1, gridW) * ts * s,
                y = Math.floor(cellid / gridW) * ts * s,
                w = ts * s,
                h = w;

            ctx.clearRect(x, y, h, w);
        },

        drawEntity: function(entity) {
            var sprite = entity.sprite,
                shadow = this.game.shadows["small"],
                anim = entity.currentAnimation,
                os = this.upscaledRendering ? 1 : this.scale,
                ds = this.upscaledRendering ? this.scale : 1;

            if(anim && sprite) {
                var frame = anim.currentFrame,
                    s = this.scale,
                    x = frame.x * os,
                    y = frame.y * os,
                    w = sprite.width * os,
                    h = sprite.height * os,
                    ox = sprite.offsetX * s,
                    oy = sprite.offsetY * s,
                    dx = entity.x * s,
                    dy = entity.y * s,
                    dw = w * ds,
                    dh = h * ds;

                if(entity.isFading) {
                    this.context.save();
                    this.context.globalAlpha = entity.fadingAlpha;
                }

                this.drawEntityName(entity);

                this.context.save();
                if(entity.flipSpriteX) {
                    this.context.translate(dx + this.tilesize*s, dy);
                    this.context.scale(-1, 1);
                }
                else if(entity.flipSpriteY) {
                    this.context.translate(dx, dy + dh);
                    this.context.scale(1, -1);
                }
                else {
                    this.context.translate(dx, dy);
                }

                if(entity.isVisible()) {
                    var cScale = entity.customScale || 1;
                    if(entity.hasShadow()) {
                        this.context.drawImage(shadow.image, 0, 0, shadow.width * os, shadow.height * os,
                                               0,
                                               entity.shadowOffsetY * ds,
                                               shadow.width * os * ds * cScale, shadow.height * os * ds * cScale);
                    }

                    if(cScale > 1) {
                        var scaledW = dw * cScale,
                            scaledH = dh * cScale,
                            scaledOx = ox - (scaledW - dw) / 2,
                            scaledOy = oy - (scaledH - dh);
                        this.context.drawImage(sprite.image, x, y, w, h, scaledOx, scaledOy, scaledW, scaledH);
                    } else {
                        this.context.drawImage(sprite.image, x, y, w, h, ox, oy, dw, dh);
                    }

                    if(entity instanceof Item && entity.kind !== Types.Entities.CAKE) {
                        var sparks = this.game.sprites["sparks"],
                            anim = this.game.sparksAnimation,
                            frame = anim.currentFrame,
                            sx = sparks.width * frame.index * os,
                            sy = sparks.height * anim.row * os,
                            sw = sparks.width * os,
                            sh = sparks.width * os;

                        this.context.drawImage(sparks.image, sx, sy, sw, sh,
                                               sparks.offsetX * s,
                                               sparks.offsetY * s,
                                               sw * ds, sh * ds);
                    }
                }

                if(entity instanceof Character && !entity.isDead && entity.hasWeapon()) {
                    var weapon = this.game.sprites[entity.getWeaponName()];

                    if(weapon) {
                        var weaponAnimData = weapon.animationData[anim.name],
                            index = frame.index < weaponAnimData.length ? frame.index : frame.index % weaponAnimData.length,
                            wx = weapon.width * index * os,
                            wy = weapon.height * anim.row * os,
                            ww = weapon.width * os,
                            wh = weapon.height * os;

                        this.context.drawImage(weapon.image, wx, wy, ww, wh,
                                               weapon.offsetX * s,
                                               weapon.offsetY * s,
                                               ww * ds, wh * ds);
                    }
                }

                this.context.restore();

                if(entity.isFading) {
                    this.context.restore();
                }
            }
        },

        drawEntities: function(dirtyOnly) {
            var self = this;

            this.game.forEachVisibleEntityByDepth(function(entity) {
                if(entity.isLoaded) {
                    if(dirtyOnly) {
                        if(entity.isDirty) {
                            self.drawEntity(entity);

                            entity.isDirty = false;
                            entity.oldDirtyRect = entity.dirtyRect;
                            entity.dirtyRect = null;
                        }
                    } else {
                        self.drawEntity(entity);
                    }
                }
            });
        },

        drawDirtyEntities: function() {
            this.drawEntities(true);
        },

        clearDirtyRect: function(r) {
            this.context.clearRect(r.x, r.y, r.w, r.h);
        },

        clearDirtyRects: function() {
            var self = this,
                count = 0;

            this.game.forEachVisibleEntityByDepth(function(entity) {
                if(entity.isDirty && entity.oldDirtyRect) {
                    self.clearDirtyRect(entity.oldDirtyRect);
                    count += 1;
                }
            });

            this.game.forEachAnimatedTile(function(tile) {
                if(tile.isDirty) {
                    self.clearDirtyRect(tile.dirtyRect);
                    count += 1;
                }
            });

            if(this.game.clearTarget && this.lastTargetPos) {
                var last = this.lastTargetPos,
                    rect = this.getTargetBoundingRect(last.x, last.y);

                this.clearDirtyRect(rect);
                this.game.clearTarget = false;
                count += 1;
            }

            if(count > 0) {
                //log.debug("count:"+count);
            }
        },

        getEntityBoundingRect: function(entity) {
            var rect = {},
                s = this.scale,
                spr;

            if(entity instanceof Player && entity.hasWeapon()) {
                var weapon = this.game.sprites[entity.getWeaponName()];
                spr = weapon;
            } else {
                spr = entity.sprite;
            }

            if(spr) {
                rect.x = (entity.x + spr.offsetX - this.camera.x) * s;
                rect.y = (entity.y + spr.offsetY - this.camera.y) * s;
                rect.w = spr.width * s;
                rect.h = spr.height * s;
                rect.left = rect.x;
                rect.right = rect.x + rect.w;
                rect.top = rect.y;
                rect.bottom = rect.y + rect.h;
            }
            return rect;
        },

        getTileBoundingRect: function(tile) {
            var rect = {},
                gridW = this.game.map.width,
                s = this.scale,
                ts = this.tilesize,
                cellid = tile.index;

            rect.x = ((getX(cellid + 1, gridW) * ts) - this.camera.x) * s;
            rect.y = ((Math.floor(cellid / gridW) * ts) - this.camera.y) * s;
            rect.w = ts * s;
            rect.h = ts * s;
            rect.left = rect.x;
            rect.right = rect.x + rect.w;
            rect.top = rect.y;
            rect.bottom = rect.y + rect.h;

            return rect;
        },

        getTargetBoundingRect: function(x, y) {
            var rect = {},
                s = this.scale,
                ts = this.tilesize,
                tx = x || this.game.selectedX,
                ty = y || this.game.selectedY;

            rect.x = ((tx * ts) - this.camera.x) * s;
            rect.y = ((ty * ts) - this.camera.y) * s;
            rect.w = ts * s;
            rect.h = ts * s;
            rect.left = rect.x;
            rect.right = rect.x + rect.w;
            rect.top = rect.y;
            rect.bottom = rect.y + rect.h;

            return rect;
        },

        isIntersecting: function(rect1, rect2) {
            return !((rect2.left > rect1.right) ||
                     (rect2.right < rect1.left) ||
                     (rect2.top > rect1.bottom) ||
                     (rect2.bottom < rect1.top));
        },

        drawEntityName: function(entity) {
            this.context.save();
            if(entity.name && entity instanceof Player) {
                var color = (entity.id === this.game.playerId) ? "#fcda5c" : "white";
                var name = (entity.level) ? "lv." + entity.level + " " + entity.name : entity.name;
                this.drawText(entity.name,
                              (entity.x + 8) * this.scale,
                              (entity.y + entity.nameOffsetY) * this.scale,
                              true,
                              color);
            } else if(entity.bossTitle) {
                this.drawText(entity.bossTitle,
                              (entity.x + 8) * this.scale,
                              (entity.y - 18) * this.scale,
                              true,
                              "#ff4d4d");
            }
            this.context.restore();
        },

        drawTerrain: function() {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;

            this.game.forEachVisibleTile(function (id, index) {
                if(!m.isHighTile(id) && !m.isAnimatedTile(id)) { // Don't draw unnecessary tiles
                    self.drawTile(self.background, id, self.tileset, tilesetwidth, m.width, index);
                }
            }, 1);
        },

        drawAnimatedTiles: function(dirtyOnly) {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;

            this.animatedTileCount = 0;
            this.game.forEachAnimatedTile(function (tile) {
                if(dirtyOnly) {
                    if(tile.isDirty) {
                        self.drawTile(self.context, tile.id, self.tileset, tilesetwidth, m.width, tile.index);
                        tile.isDirty = false;
                    }
                } else {
                    self.drawTile(self.context, tile.id, self.tileset, tilesetwidth, m.width, tile.index);
                    self.animatedTileCount += 1;
                }
            });
        },

        drawDirtyAnimatedTiles: function() {
            this.drawAnimatedTiles(true);
        },

        drawHighTiles: function(ctx) {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;

            this.highTileCount = 0;
            this.game.forEachVisibleTile(function (id, index) {
                if(m.isHighTile(id)) {
                    self.drawTile(ctx, id, self.tileset, tilesetwidth, m.width, index);
                    self.highTileCount += 1;
                }
            }, 1);
        },

        drawBackground: function(ctx, color) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        },

        drawFPS: function() {
            var nowTime = new Date(),
                diffTime = nowTime.getTime() - this.lastTime.getTime();

            if (diffTime >= 1000) {
                this.realFPS = this.frameCount;
                this.frameCount = 0;
                this.lastTime = nowTime;
            }
            this.frameCount++;

            //this.drawText("FPS: " + this.realFPS + " / " + this.maxFPS, 30, 30, false);
            this.drawText("FPS: " + this.realFPS, 30, 30, false);
        },

        drawDebugInfo: function() {
            if(this.isDebugInfoVisible) {
                this.drawFPS();
                //this.drawText("A: " + this.animatedTileCount, 100, 30, false);
                //this.drawText("H: " + this.highTileCount, 140, 30, false);
            }
        },

        drawProjectiles: function() {
            var self = this,
                projs = (this.game && this.game.projectiles) ? this.game.projectiles : [],
                now = this.game.currentTime || Date.now(),
                s = this.scale,
                ctx = this.context;

            if(!projs || projs.length === 0) return;

            for(var i = projs.length - 1; i >= 0; i--) {
                var p = projs[i],
                    elapsed = now - p.startTime,
                    prog = elapsed / (p.duration || 360);

                if(prog >= 1) {
                    projs.splice(i, 1);
                    continue;
                }

                var cx = (p.sx + (p.tx - p.sx) * prog) * s,
                    cy = (p.sy + (p.ty - p.sy) * prog) * s;

                ctx.save();
                // Flèche tirée à l'arc (joueur ou ennemi archer)
                if(p.isArrow) {
                    var angle = Math.atan2(p.ty - p.sy, p.tx - p.sx);
                    ctx.translate(cx, cy);
                    ctx.rotate(angle);
                    ctx.strokeStyle = p.color || "#854d0e";
                    ctx.fillStyle = p.glow || "#fef08a";
                    ctx.lineWidth = 2 * s;
                    // Fût de la flèche
                    ctx.beginPath();
                    ctx.moveTo(-10 * s, 0);
                    ctx.lineTo(8 * s, 0);
                    ctx.stroke();
                    // Pointe de flèche affûtée
                    ctx.beginPath();
                    ctx.moveTo(8 * s, 0);
                    ctx.lineTo(3 * s, -3 * s);
                    ctx.lineTo(5 * s, 0);
                    ctx.lineTo(3 * s, 3 * s);
                    ctx.closePath();
                    ctx.fill();
                    // Empennage (plumes de flèche)
                    ctx.strokeStyle = p.isGolden ? "#ef4444" : "#e2e8f0";
                    ctx.beginPath();
                    ctx.moveTo(-7 * s, -3 * s);
                    ctx.lineTo(-10 * s, 0);
                    ctx.lineTo(-7 * s, 3 * s);
                    ctx.stroke();
                    ctx.restore();
                    continue;
                }

                // Si c'est un Boss à pouvoir de zone (AoE), dessiner une onde de choc autour de la cible
                if(p.aoe && prog > 0.5) {
                    var ringR = (prog - 0.5) * 42 * s;
                    ctx.beginPath();
                    ctx.arc(p.tx * s, p.ty * s, ringR, 0, Math.PI * 2, false);
                    ctx.strokeStyle = p.color;
                    ctx.lineWidth = 2 * s;
                    ctx.globalAlpha = Math.max(0.1, 1 - prog);
                    ctx.stroke();
                }

                // Orbe magique / projectile
                ctx.beginPath();
                ctx.arc(cx, cy, (p.aoe ? 5 : 3.5) * s, 0, Math.PI * 2, false);
                ctx.fillStyle = p.glow || "#fff";
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8 * s;
                ctx.fill();
                ctx.lineWidth = 1.5 * s;
                ctx.strokeStyle = p.color;
                ctx.stroke();
                ctx.restore();
            }
        },

        drawCombatInfo: function() {
            var self = this;

            switch(this.scale) {
                case 2: this.setFontSize(20); break;
                case 3: this.setFontSize(30); break;
            }
            this.game.infoManager.forEachInfo(function(info) {
                self.context.save();
                self.context.globalAlpha = info.opacity;
                self.drawText(info.value, (info.x + 8) * self.scale, Math.floor(info.y * self.scale), true, info.fillColor, info.strokeColor);
                self.context.restore();
            });
            this.initFont();
        },

        setCameraView: function(ctx) {
            ctx.translate(-this.camera.x * this.scale, -this.camera.y * this.scale);
        },

        clearScreen: function(ctx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        },

        getPlayerImage: function() {
            var canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d'),
                os = this.upscaledRendering ? 1 : this.scale,
                player = this.game.player,
                sprite = player.getArmorSprite(),
                spriteAnim = sprite.animationData["idle_down"],
                // character
                row = spriteAnim.row,
                w = sprite.width * os,
                h = sprite.height * os,
                y = row * h,
                // weapon
                weapon = this.game.sprites[this.game.player.getWeaponName()],
                ww = weapon.width * os,
                wh = weapon.height * os,
                wy = wh * row,
                offsetX = (weapon.offsetX - sprite.offsetX) * os,
                offsetY = (weapon.offsetY - sprite.offsetY) * os,
                // shadow
                shadow = this.game.shadows["small"],
                sw = shadow.width * os,
                sh = shadow.height * os,
                ox = -sprite.offsetX * os,
                oy = -sprite.offsetY * os;

            canvas.width = w;
            canvas.height = h;

            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(shadow.image, 0, 0, sw, sh, ox, oy, sw, sh);
            ctx.drawImage(sprite.image, 0, y, w, h, 0, 0, w, h);
            ctx.drawImage(weapon.image, 0, wy, ww, wh, offsetX, offsetY, ww, wh);

            return canvas.toDataURL("image/png");
        },

        renderStaticCanvases: function() {
            this.clearScreen(this.background);
            this.drawBackground(this.background, "#11100d");
            this.background.save();
                this.setCameraView(this.background);
                this.drawTerrain();
            this.background.restore();

            this.clearScreen(this.foreground);
            if(this.mobile || this.tablet) {
                this.foreground.save();
                    this.setCameraView(this.foreground);
                    this.drawHighTiles(this.foreground);
                this.foreground.restore();
            }
        },

        renderFrame: function() {
            this.renderFrameDesktop();
        },

        isHouseInteriorPosition: function(gx, gy) {
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

        drawIndoorDoorIndicators: function() {
            if(!this.game || !this.game.started || !this.game.player || !this.game.map || !this.game.map.doors) {
                return;
            }
            var p = this.game.player;
            if(!this.isHouseInteriorPosition(p.gridX, p.gridY)) {
                return;
            }

            var self = this,
                ctx = this.context,
                s = this.scale,
                ts = this.tilesize,
                cam = this.camera,
                now = this.game.currentTime || Date.now(),
                pulse = 0.55 + 0.35 * Math.sin(now / 220),
                bobOffset = Math.round(Math.sin(now / 200) * 2);

            _.each(this.game.map.doors, function(door, tileIndexStr) {
                var doorX = (typeof door.doorX === 'number') ? door.doorX : (getX(parseInt(tileIndexStr, 10) + 1, self.game.map.width)),
                    doorY = (typeof door.doorY === 'number') ? door.doorY : (Math.floor(parseInt(tileIndexStr, 10) / self.game.map.width));

                if(!cam.isVisiblePosition(doorX, doorY)) {
                    return;
                }

                var px = doorX * ts * s,
                    py = doorY * ts * s,
                    tileW = ts * s,
                    tileH = ts * s;

                ctx.save();
                ctx.fillStyle = "rgba(250, 204, 21, " + (0.18 * pulse).toFixed(3) + ")";
                ctx.fillRect(px + 2, py + 2, tileW - 4, tileH - 4);

                ctx.strokeStyle = "rgba(250, 204, 21, " + (0.85 * pulse).toFixed(3) + ")";
                ctx.lineWidth = Math.max(2, s);
                ctx.strokeRect(px + 2, py + 2, tileW - 4, tileH - 4);

                var labelX = px + (tileW / 2),
                    labelY = py - (4 * s) + bobOffset;
                ctx.font = "bold " + Math.max(10, 5 * s) + "px GraphicPixel, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                ctx.lineWidth = Math.max(3, s + 1);
                ctx.strokeStyle = "rgba(15, 23, 42, 0.92)";
                ctx.strokeText("▼ SORTIE", labelX, labelY);
                ctx.fillStyle = "#fde047";
                ctx.fillText("▼ SORTIE", labelX, labelY);
                ctx.restore();
            });
        },

        drawDoorTransitionFade: function() {
            if(!this.game || !this.game.doorFadeStartTime) {
                return;
            }
            var duration = this.game.doorFadeDuration || 180,
                elapsed = Date.now() - this.game.doorFadeStartTime;
            if(elapsed >= duration || elapsed < 0) {
                this.game.doorFadeStartTime = 0;
                return;
            }
            var progress = elapsed / duration,
                alpha = (1 - progress) * 0.42,
                ctx = this.context;

            ctx.save();
            ctx.fillStyle = "rgba(15, 23, 42, " + alpha.toFixed(3) + ")";
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.restore();
        },

        renderFrameDesktop: function() {
            this.clearScreen(this.context);

            this.context.save();
                this.setCameraView(this.context);
                this.drawAnimatedTiles();

                if(this.game.started && this.game.cursorVisible) {
                    this.drawSelectedCell();
                    this.drawTargetCell();
                }

                //this.drawOccupiedCells();
                this.drawPathingCells();
                this.drawIndoorDoorIndicators();
                this.drawEntities();
                this.drawProjectiles();
                this.drawCombatInfo();
                this.drawHighTiles(this.context);
            this.context.restore();

            // Overlay UI elements
            this.drawDoorTransitionFade();
            if(this.game.cursorVisible)
                this.drawCursor();

            this.drawDebugInfo();
        },

        renderFrameMobile: function() {
            this.clearDirtyRects();
            this.preventFlickeringBug();

            this.context.save();
                this.setCameraView(this.context);

                this.drawDirtyAnimatedTiles();
                this.drawSelectedCell();
                this.drawIndoorDoorIndicators();
                this.drawDirtyEntities();
                this.drawProjectiles();
            this.context.restore();

            this.drawDoorTransitionFade();
        },

        preventFlickeringBug: function() {
            if(this.fixFlickeringTimer.isOver(this.game.currentTime)) {
                this.background.fillRect(0, 0, 0, 0);
                this.context.fillRect(0, 0, 0, 0);
                this.foreground.fillRect(0, 0, 0, 0);
            }
        }
    });

    var getX = function(id, w) {
        if(id == 0) {
            return 0;
        }
        return (id % w == 0) ? w - 1 : (id % w) - 1;
    };

    return Renderer;
});
