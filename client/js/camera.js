
define(function() {

    var Camera = Class.extend({
        init: function(renderer) {
            this.renderer = renderer;
            this.x = 0;
            this.y = 0;
            this.gridX = 0;
            this.gridY = 0;
            this.offset = 0.5;
            this.rescale();
        },

        rescale: function() {
            var factor = 2; // Vue large et panoramique (30x14 cases) sur tous les appareils (mobile, tablette, PC)

            this.gridW = 15 * factor;
            this.gridH = 7 * factor;

            log.debug("---------");
            log.debug("Factor:"+factor);
            log.debug("W:"+this.gridW + " H:" + this.gridH);
        },

        setPosition: function(x, y) {
            this.x = x;
            this.y = y;

            this.gridX = Math.floor( x / 16 );
            this.gridY = Math.floor( y / 16 );
        },

        setGridPosition: function(x, y) {
            this.gridX = x;
            this.gridY = y;

            this.x = this.gridX * 16;
            this.y = this.gridY * 16;
        },

        lookAt: function(entity) {
            var r = this.renderer,
                x = Math.round( entity.x - (Math.floor(this.gridW / 2) * r.tilesize) ),
                y = Math.round( entity.y - (Math.floor(this.gridH / 2) * r.tilesize) );

            this.setPosition(x, y);
        },

        _getClampedTarget: function(entity, map) {
            var ts = (this.renderer && this.renderer.tilesize) ? this.renderer.tilesize : 16,
                viewW = this.gridW * ts,
                viewH = this.gridH * ts,
                tx = (entity.x + ts / 2) - (viewW / 2),
                ty = (entity.y + ts / 2) - (viewH / 2);

            if(map && map.width && map.height) {
                var maxX = Math.max(0, (map.width * ts) - viewW),
                    maxY = Math.max(0, (map.height * ts) - viewH);
                tx = Math.max(0, Math.min(maxX, tx));
                ty = Math.max(0, Math.min(maxY, ty));
            }
            return { x: tx, y: ty };
        },

        centerOn: function(entity, map) {
            if(!entity) return;
            var target = this._getClampedTarget(entity, map);
            this._smoothX = target.x;
            this._smoothY = target.y;
            this.setPosition(Math.round(target.x), Math.round(target.y));
        },

        followSmooth: function(entity, map, dtMs) {
            if(!entity) return { moved: false, gridChanged: false };
            var target = this._getClampedTarget(entity, map);
            if(typeof this._smoothX !== 'number' || typeof this._smoothY !== 'number') {
                this._smoothX = this.x;
                this._smoothY = this.y;
            }
            var dt = Math.max(1, Math.min(100, dtMs || 16));
            // Lissage exponentiel indépendant du framerate (réactif et sans secousse)
            var alpha = 1 - Math.exp(-0.014 * dt);
            var dx = target.x - this._smoothX,
                dy = target.y - this._smoothY;

            if(Math.abs(dx) < 0.35) {
                this._smoothX = target.x;
            } else {
                this._smoothX += dx * alpha;
            }
            if(Math.abs(dy) < 0.35) {
                this._smoothY = target.y;
            } else {
                this._smoothY += dy * alpha;
            }

            var nextX = Math.round(this._smoothX),
                nextY = Math.round(this._smoothY),
                prevX = this.x,
                prevY = this.y,
                prevGX = this.gridX,
                prevGY = this.gridY;

            if(nextX !== prevX || nextY !== prevY) {
                this.setPosition(nextX, nextY);
                return { moved: true, gridChanged: (this.gridX !== prevGX || this.gridY !== prevGY) };
            }
            return { moved: false, gridChanged: false };
        },

        forEachVisiblePosition: function(callback, extra) {
            var extra = extra || 0;
            for(var y=this.gridY-extra, maxY=this.gridY+this.gridH+(extra*2)+1; y < maxY; y += 1) {
                for(var x=this.gridX-extra, maxX=this.gridX+this.gridW+(extra*2)+1; x < maxX; x += 1) {
                    callback(x, y);
                }
            }
        },

        isVisible: function(entity) {
            return this.isVisiblePosition(entity.gridX, entity.gridY);
        },

        isVisiblePosition: function(x, y) {
            if(y >= this.gridY && y <= this.gridY + this.gridH
            && x >= this.gridX && x <= this.gridX + this.gridW) {
                return true;
            } else {
                return false;
            }
        },

        focusEntity: function(entity) {
            var w = this.gridW - 2,
                h = this.gridH - 2,
                x = Math.floor((entity.gridX - 1) / w) * w,
                y = Math.floor((entity.gridY - 1) / h) * h;

            this.setGridPosition(x, y);
            this._smoothX = this.x;
            this._smoothY = this.y;
        }
    });

    return Camera;
});
