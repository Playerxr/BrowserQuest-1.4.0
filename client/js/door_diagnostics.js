(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], function() {
            var mod = factory();
            if (typeof window !== 'undefined') {
                window.DoorDiagnostics = mod;
            }
            return mod;
        });
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DoorDiagnostics = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    "use strict";

    var MAX_EVENTS = 300;
    var MAX_TRANSITIONS = 60;

    function formatTime(ts) {
        var d = new Date(ts);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        var ms = String(d.getMilliseconds()).padStart(3, '0');
        return hh + ':' + mm + ':' + ss + '.' + ms;
    }

    /**
     * Classifies whether a grid coordinate is in the indoor house atlas region
     * or outdoor world region of BrowserQuest / Nova Quest.
     * In world_client.json, indoor house interiors are placed in the eastern/southern
     * atlas strips (x >= 115 && y >= 60) or surrounded by void tiles (tileId === 0).
     */
    function classifyEnvironment(map, x, y) {
        if (!map || typeof x !== 'number' || typeof y !== 'number') {
            return 'UNKNOWN';
        }
        // Check if within a 6-tile radius there are void tiles (data === 0)
        if (Array.isArray(map.data) && map.width) {
            var voidCount = 0;
            for (var dy = -4; dy <= 4; dy++) {
                for (var dx = -4; dx <= 4; dx++) {
                    var nx = x + dx, ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height) {
                        var idx = ny * map.width + nx;
                        if (map.data[idx] === 0) {
                            voidCount++;
                        }
                    }
                }
            }
            if (voidCount >= 8) {
                return 'INTERIOR';
            }
        }
        if ((x >= 115 && y >= 60) || y >= 265) {
            return 'INTERIOR';
        }
        return 'EXTERIOR';
    }

    function DoorDiagnostics(game) {
        this.game = game || null;
        this.enabled = true;
        this.overlayVisible = false;
        this.seq = 0;
        this.events = [];
        this.transitions = [];
        this.activeTransition = null;
        this.counters = {
            doorApproaches: 0,
            doorSteps: 0,
            doorTeleportsLocal: 0,
            doorTeleportsServerAck: 0,
            serverTeleportRollbacks: 0,
            duplicateMovesPrevented: 0,
            joystickDoorStops: 0,
            zoningConflictsPrevented: 0,
            thresholdSnapAssists: 0,
            standingDoorExitAssists: 0,
            entityGridCleanups: 0
        };
        this._lastStepAt = 0;
        this._lastApproachDoorKey = null;
    }

    DoorDiagnostics.classifyEnvironment = classifyEnvironment;

    DoorDiagnostics.prototype.setGame = function(game) {
        this.game = game;
    };

    DoorDiagnostics.prototype.findNearestDoor = function(x, y, maxRadius) {
        var g = this.game;
        if (!g || !g.map || !g.map.doors || typeof x !== 'number' || typeof y !== 'number') {
            return null;
        }
        var radius = typeof maxRadius === 'number' ? maxRadius : 6;
        var best = null;
        var bestDist = 999999;

        for (var dy = -radius; dy <= radius; dy++) {
            for (var dx = -radius; dx <= radius; dx++) {
                var tx = x + dx;
                var ty = y + dy;
                var outOfBounds = typeof g.map.isOutOfBounds === 'function'
                    ? g.map.isOutOfBounds(tx, ty)
                    : (tx < 0 || ty < 0 || (g.map.width && tx >= g.map.width) || (g.map.height && ty >= g.map.height));
                if (!outOfBounds && g.map.isDoor(tx, ty)) {
                    var dist = Math.abs(dx) + Math.abs(dy);
                    if (dist < bestDist) {
                        bestDist = dist;
                        var dest = g.map.getDoorDestination(tx, ty);
                        best = {
                            x: tx,
                            y: ty,
                            distance: dist,
                            destX: dest ? dest.x : null,
                            destY: dest ? dest.y : null,
                            destPortal: dest ? !!dest.portal : false,
                            destOrientation: dest ? dest.orientation : null
                        };
                    }
                }
            }
        }
        return best;
    };

    DoorDiagnostics.prototype.captureSnapshot = function(extra) {
        var g = this.game;
        var p = g && g.player ? g.player : null;
        var c = g ? (g.camera || (g.renderer && g.renderer.camera) || null) : null;
        var m = g && g.map ? g.map : null;

        var gx = p ? p.gridX : null;
        var gy = p ? p.gridY : null;
        var isOnDoor = Boolean(m && gx !== null && gy !== null && m.isDoor && m.isDoor(gx, gy));
        var doorDest = (isOnDoor && m.getDoorDestination) ? m.getDoorDestination(gx, gy) : null;
        var nearestDoor = (gx !== null && gy !== null) ? this.findNearestDoor(gx, gy, 6) : null;

        var inEntityGrid = false;
        var inRenderingGrid = false;
        if (g && p && gx !== null && gy !== null) {
            if (g.entityGrid && g.entityGrid[gy] && g.entityGrid[gy][gx]) {
                inEntityGrid = Boolean(g.entityGrid[gy][gx][p.id]);
            }
            if (g.renderingGrid && g.renderingGrid[gy] && g.renderingGrid[gy][gx]) {
                inRenderingGrid = Boolean(g.renderingGrid[gy][gx][p.id]);
            }
        }

        var relX = (c && gx !== null) ? (gx - c.gridX) : null;
        var relY = (c && gy !== null) ? (gy - c.gridY) : null;
        var isZoningTile = Boolean(g && gx !== null && gy !== null && typeof g.isZoningTile === 'function' && g.isZoningTile(gx, gy));

        return {
            player: p ? {
                id: p.id,
                name: p.name,
                gridX: gx,
                gridY: gy,
                nextGridX: p.nextGridX,
                nextGridY: p.nextGridY,
                x: p.x,
                y: p.y,
                orientation: p.orientation,
                isMoving: typeof p.isMoving === 'function' ? p.isMoving() : false,
                step: typeof p.step === 'number' ? p.step : null,
                pathLength: Array.isArray(p.path) ? p.path.length : 0,
                hasNextStep: (Array.isArray(p.path) && typeof p.hasNextStep === 'function') ? p.hasNextStep() : false,
                hasChangedPath: typeof p.hasChangedItsPath === 'function' ? p.hasChangedItsPath() : false,
                newDestination: p.newDestination ? { x: p.newDestination.x, y: p.newDestination.y } : null,
                hasTarget: typeof p.hasTarget === 'function' ? p.hasTarget() : false,
                isOnPlateau: Boolean(p.isOnPlateau),
                moveFlags: {
                    up: Boolean(p.moveUp),
                    down: Boolean(p.moveDown),
                    left: Boolean(p.moveLeft),
                    right: Boolean(p.moveRight)
                }
            } : null,
            camera: c ? {
                gridX: c.gridX,
                gridY: c.gridY,
                gridW: c.gridW,
                gridH: c.gridH,
                x: c.x,
                y: c.y,
                relX: relX,
                relY: relY,
                isZoningTile: isZoningTile
            } : null,
            zoning: g ? {
                active: typeof g.isZoning === 'function' ? g.isZoning() : false,
                queueLength: Array.isArray(g.zoningQueue) ? g.zoningQueue.length : 0,
                orientation: g.zoningOrientation || null
            } : null,
            door: {
                isOnDoor: isOnDoor,
                doorDest: doorDest ? {
                    x: doorDest.x,
                    y: doorDest.y,
                    orientation: doorDest.orientation,
                    cameraX: doorDest.cameraX,
                    cameraY: doorDest.cameraY,
                    portal: Boolean(doorDest.portal)
                } : null,
                nearestDoor: nearestDoor,
                environment: classifyEnvironment(m, gx, gy)
            },
            grids: {
                inEntityGridAtPos: inEntityGrid,
                inRenderingGridAtPos: inRenderingGrid,
                collidingAtPos: Boolean(m && gx !== null && gy !== null && m.isColliding && m.isColliding(gx, gy))
            },
            extra: extra || null
        };
    };

    DoorDiagnostics.prototype.recordEvent = function(phase, details, anomalies) {
        if (!this.enabled) return null;
        var now = Date.now();
        var snap = this.captureSnapshot(details);
        var entry = {
            id: ++this.seq,
            timestamp: now,
            timeFormatted: formatTime(now),
            phase: phase,
            details: details || {},
            anomalies: Array.isArray(anomalies) ? anomalies : [],
            snapshot: snap
        };

        this.events.push(entry);
        if (this.events.length > MAX_EVENTS) {
            this.events.shift();
        }

        if (this.overlayVisible) {
            this.renderOverlay();
        }

        // Send important boundary events (teleports, anomalies, rollbacks) to server diagnostic log
        if (
            phase === 'DOOR_TELEPORT_COMPLETE' ||
            phase === 'SERVER_TELEPORT_ROLLBACK' ||
            phase === 'BOUNDARY_GUARD_TRIGGERED' ||
            (entry.anomalies && entry.anomalies.length > 0)
        ) {
            this.postToServer(entry);
        }

        return entry;
    };

    DoorDiagnostics.prototype.recordStep = function(x, y) {
        var now = Date.now();
        var dt = this._lastStepAt > 0 ? (now - this._lastStepAt) : null;
        this._lastStepAt = now;

        var anomalies = [];
        if (dt !== null && dt > 0 && dt < 115) {
            anomalies.push({
                code: 'SUB_120MS_STEP_CADENCE',
                message: 'Pas exécuté en ' + dt + 'ms (< 120ms STEP_MS serveur), risque d\'épuisement du budget mouvement.'
            });
        }

        var nearest = this.findNearestDoor(x, y, 2);
        if (nearest) {
            if (nearest.distance === 0) {
                this.counters.doorSteps++;
                this.recordEvent('STEP_ON_DOOR', {
                    x: x,
                    y: y,
                    stepDeltaMs: dt,
                    destX: nearest.destX,
                    destY: nearest.destY
                }, anomalies);
            } else {
                var doorKey = nearest.x + ',' + nearest.y + '@' + nearest.distance;
                if (this._lastApproachDoorKey !== doorKey) {
                    this._lastApproachDoorKey = doorKey;
                    this.counters.doorApproaches++;
                    this.recordEvent('APPROACH_DOOR', {
                        x: x,
                        y: y,
                        doorX: nearest.x,
                        doorY: nearest.y,
                        distance: nearest.distance,
                        stepDeltaMs: dt
                    }, anomalies);
                }
            }
        } else {
            this._lastApproachDoorKey = null;
        }
    };

    DoorDiagnostics.prototype.recordGuard = function(guardCode, description, details) {
        if (guardCode === 'DEDUP_STOP_MOVE') this.counters.duplicateMovesPrevented++;
        if (guardCode === 'JOYSTICK_STOP_ON_DOOR') this.counters.joystickDoorStops++;
        if (guardCode === 'CLEAR_ZONING_ON_DOOR') this.counters.zoningConflictsPrevented++;
        if (guardCode === 'DOOR_THRESHOLD_SNAP_ASSIST') this.counters.thresholdSnapAssists++;
        if (guardCode === 'STANDING_DOOR_EXIT_ASSIST') this.counters.standingDoorExitAssists++;
        if (guardCode === 'ENTITY_GRID_CLEAN_UNREGISTER') this.counters.entityGridCleanups++;

        return this.recordEvent('BOUNDARY_GUARD_TRIGGERED', Object.assign({
            guardCode: guardCode,
            description: description
        }, details || {}), []);
    };

    DoorDiagnostics.prototype.beginDoorTeleport = function(fromX, fromY, dest, triggerSource) {
        var beforeSnap = this.captureSnapshot({ triggerSource: triggerSource || 'STOP_PATHING' });
        this.activeTransition = {
            id: this.transitions.length + 1,
            startedAt: Date.now(),
            triggerSource: triggerSource || 'STOP_PATHING',
            from: {
                x: fromX,
                y: fromY,
                environment: beforeSnap.door.environment,
                cameraX: beforeSnap.camera ? beforeSnap.camera.gridX : null,
                cameraY: beforeSnap.camera ? beforeSnap.camera.gridY : null,
                isZoning: beforeSnap.zoning ? beforeSnap.zoning.active : false
            },
            expectedDest: {
                x: dest ? dest.x : null,
                y: dest ? dest.y : null,
                cameraX: dest ? dest.cameraX : null,
                cameraY: dest ? dest.cameraY : null,
                portal: dest ? Boolean(dest.portal) : false,
                orientation: dest ? dest.orientation : null
            },
            beforeSnapshot: beforeSnap,
            afterSnapshot: null,
            anomalies: [],
            guardsApplied: [],
            status: 'IN_PROGRESS'
        };
        return this.activeTransition;
    };

    DoorDiagnostics.prototype.completeDoorTeleport = function(guardsApplied) {
        if (!this.activeTransition) return null;
        var afterSnap = this.captureSnapshot();
        var tr = this.activeTransition;
        tr.completedAt = Date.now();
        tr.durationMs = tr.completedAt - tr.startedAt;
        tr.afterSnapshot = afterSnap;
        tr.guardsApplied = Array.isArray(guardsApplied) ? guardsApplied : [];
        tr.to = {
            x: afterSnap.player ? afterSnap.player.gridX : null,
            y: afterSnap.player ? afterSnap.player.gridY : null,
            environment: afterSnap.door.environment,
            cameraX: afterSnap.camera ? afterSnap.camera.gridX : null,
            cameraY: afterSnap.camera ? afterSnap.camera.gridY : null,
            isOnExitDoor: afterSnap.door.isOnDoor,
            inEntityGrid: afterSnap.grids.inEntityGridAtPos,
            inRenderingGrid: afterSnap.grids.inRenderingGridAtPos
        };

        if (tr.from.environment === 'EXTERIOR' && tr.to.environment === 'INTERIOR') {
            tr.direction = 'ENTER_HOUSE';
        } else if (tr.from.environment === 'INTERIOR' && tr.to.environment === 'EXTERIOR') {
            tr.direction = 'EXIT_HOUSE';
        } else {
            tr.direction = tr.from.environment + '_TO_' + tr.to.environment;
        }

        // Check for any post-transition anomalies
        if (!tr.to.inEntityGrid || !tr.to.inRenderingGrid) {
            tr.anomalies.push({
                code: 'ENTITY_GRID_DESYNC',
                message: 'Le joueur n\'est pas correctement enregistré dans entityGrid/renderingGrid après téléportation.'
            });
        }
        if (afterSnap.zoning && afterSnap.zoning.active) {
            tr.anomalies.push({
                code: 'ZONING_CONFLICT_ON_DOOR',
                message: 'Une transition de zone (currentZoning) est restée active après le passage de porte.'
            });
        }
        if (afterSnap.camera && afterSnap.player) {
            var vis = (
                afterSnap.player.gridX >= afterSnap.camera.gridX &&
                afterSnap.player.gridX < afterSnap.camera.gridX + afterSnap.camera.gridW &&
                afterSnap.player.gridY >= afterSnap.camera.gridY &&
                afterSnap.player.gridY < afterSnap.camera.gridY + afterSnap.camera.gridH
            );
            if (!vis) {
                tr.anomalies.push({
                    code: 'CAMERA_OUT_OF_BOUNDS_ON_DOOR',
                    message: 'La caméra (' + afterSnap.camera.gridX + ',' + afterSnap.camera.gridY + ') ne contient pas le joueur (' + afterSnap.player.gridX + ',' + afterSnap.player.gridY + ').'
                });
            }
        }

        // Record structural boundary conditions that were guarded during this transition
        tr.anomaliesDetected = tr.anomalies.map(function(a) { return a.code; });
        if (tr.to.isOnExitDoor) {
            tr.anomaliesDetected.push('DEST_IS_EXIT_DOOR_TRAP_RISK');
        }
        if (tr.expectedDest && typeof tr.expectedDest.cameraX === 'number' && tr.to.cameraX !== null &&
            (tr.expectedDest.cameraX !== tr.to.cameraX || tr.expectedDest.cameraY !== tr.to.cameraY)) {
            tr.anomaliesDetected.push('LEGACY_16X8_CAMERA_OFFSET_MISMATCH');
        }
        var g = this.game;
        var p = g && g.player ? g.player : null;
        if (g && p && g.entityGrid && g.entityGrid[tr.from.y] && g.entityGrid[tr.from.y][tr.from.x] && g.entityGrid[tr.from.y][tr.from.x][p.id]) {
            tr.anomaliesDetected.push('STALE_ENTITY_GRID_ON_SOURCE_DOOR');
        }

        tr.status = tr.anomalies.length === 0 ? 'OK' : 'ANOMALY_DETECTED';
        this.counters.doorTeleportsLocal++;
        this.transitions.push(tr);
        if (this.transitions.length > MAX_TRANSITIONS) {
            this.transitions.shift();
        }

        this.recordEvent('DOOR_TELEPORT_COMPLETE', {
            transitionId: tr.id,
            direction: tr.direction,
            from: tr.from.x + ',' + tr.from.y + ' (' + tr.from.environment + ')',
            to: tr.to.x + ',' + tr.to.y + ' (' + tr.to.environment + ')',
            camera: tr.to.cameraX + ',' + tr.to.cameraY,
            guardsApplied: tr.guardsApplied,
            status: tr.status
        }, tr.anomalies);

        return tr;
    };

    DoorDiagnostics.prototype.recordServerTeleport = function(x, y) {
        var g = this.game;
        var p = g && g.player ? g.player : null;
        var curX = p ? p.gridX : null;
        var curY = p ? p.gridY : null;
        var lastTr = this.transitions.length > 0 ? this.transitions[this.transitions.length - 1] : null;

        var isRollback = false;
        var anomalies = [];
        if (lastTr && (Date.now() - lastTr.completedAt < 3000)) {
            if (x === lastTr.from.x && y === lastTr.from.y && (curX !== x || curY !== y)) {
                isRollback = true;
                this.counters.serverTeleportRollbacks++;
                var anomaly = {
                    code: 'SERVER_TELEPORT_ROLLBACK',
                    message: 'Le serveur a rejeté la transition de porte et renvoyé le joueur à (' + x + ',' + y + '). Cause : désynchronisation position/budget mouvement.'
                };
                anomalies.push(anomaly);
                lastTr.anomalies.push(anomaly);
                lastTr.status = 'SERVER_ROLLBACK';
            } else if (x === lastTr.expectedDest.x && y === lastTr.expectedDest.y) {
                this.counters.doorTeleportsServerAck++;
                lastTr.status = 'SERVER_CONFIRMED';
            }
        }

        return this.recordEvent(isRollback ? 'SERVER_TELEPORT_ROLLBACK' : 'NETWORK_RECV_TELEPORT', {
            serverX: x,
            serverY: y,
            clientXBefore: curX,
            clientYBefore: curY,
            isRollback: isRollback
        }, anomalies);
    };

    /**
     * Audits all doors on a loaded map to identify structural boundary characteristics:
     * - Doors whose destination lands directly on another door tile (destIsDoor)
     * - Doors with legacy 15x7 camera overrides (cameraX/cameraY)
     * - Doors sitting on 30x14 camera zone edges
     * - Walkable entry/exit directions around each door
     */
    DoorDiagnostics.prototype.auditMapDoors = function(mapOverride, gridWOverride, gridHOverride) {
        var g = this.game;
        var map = mapOverride || (g ? g.map : null);
        if (!map || !map.doors) {
            return { totalDoors: 0, error: 'Map not loaded' };
        }

        var gridW = gridWOverride || (g && (g.camera || (g.renderer && g.renderer.camera)) ? (g.camera || g.renderer.camera).gridW : 30);
        var gridH = gridHOverride || (g && (g.camera || (g.renderer && g.renderer.camera)) ? (g.camera || g.renderer.camera).gridH : 14);
        var zoneW = gridW - 2;
        var zoneH = gridH - 2;

        var report = {
            totalDoors: 0,
            destIsDoorCount: 0,
            legacyCameraOffsetCount: 0,
            singleExitDirectionCount: 0,
            interiorToExteriorCount: 0,
            exteriorToInteriorCount: 0,
            doors: []
        };

        var isArrayDoors = Array.isArray(map.doors);
        var doorKeys = isArrayDoors ? map.doors.map(function(_, idx) { return idx; }) : Object.keys(map.doors);
        report.totalDoors = doorKeys.length;

        for (var i = 0; i < doorKeys.length; i++) {
            var key = doorKeys[i];
            var door = map.doors[key];
            var dx, dy, tx, ty;

            if (isArrayDoors && typeof door.x === 'number' && (typeof door.destX === 'number' || typeof door.tx === 'number')) {
                dx = door.x;
                dy = door.y;
                tx = typeof door.destX === 'number' ? door.destX : door.tx;
                ty = typeof door.destY === 'number' ? door.destY : door.ty;
            } else {
                var tileIdx = parseInt(key, 10);
                var pos = typeof map.tileIndexToGridPosition === 'function'
                    ? map.tileIndexToGridPosition(tileIdx)
                    : { x: (tileIdx - 1) % map.width, y: Math.floor((tileIdx - 1) / map.width) };
                dx = pos.x;
                dy = pos.y;
                tx = door.x;
                ty = door.y;
            }

            var destIsDoor = typeof map.isDoor === 'function' ? map.isDoor(tx, ty) : false;
            if (destIsDoor) report.destIsDoorCount++;

            var hasLegacyCam = (typeof door.cameraX === 'number' && typeof door.cameraY === 'number') ||
                (typeof door.tcx === 'number' && typeof door.tcy === 'number');
            if (hasLegacyCam) report.legacyCameraOffsetCount++;

            var srcEnv = classifyEnvironment(map, dx, dy);
            var dstEnv = classifyEnvironment(map, tx, ty);
            if (srcEnv === 'EXTERIOR' && dstEnv === 'INTERIOR') report.exteriorToInteriorCount++;
            if (srcEnv === 'INTERIOR' && dstEnv === 'EXTERIOR') report.interiorToExteriorCount++;

            var openDirs = [];
            var blockedDirs = [];
            var dirs = [
                { name: 'UP', ox: 0, oy: -1 },
                { name: 'DOWN', ox: 0, oy: 1 },
                { name: 'LEFT', ox: -1, oy: 0 },
                { name: 'RIGHT', ox: 1, oy: 0 }
            ];
            for (var d = 0; d < dirs.length; d++) {
                var nx = dx + dirs[d].ox;
                var ny = dy + dirs[d].oy;
                var colliding = typeof map.isColliding === 'function' ? map.isColliding(nx, ny) : false;
                if (!colliding) openDirs.push(dirs[d].name);
                else blockedDirs.push(dirs[d].name);
            }
            if (openDirs.length === 1) {
                report.singleExitDirectionCount++;
            }

            var camX = Math.floor((tx - 1) / zoneW) * zoneW;
            var camY = Math.floor((ty - 1) / zoneH) * zoneH;

            report.doors.push({
                doorX: dx,
                doorY: dy,
                destX: tx,
                destY: ty,
                srcEnv: srcEnv,
                dstEnv: dstEnv,
                fromEnv: srcEnv,
                toEnv: dstEnv,
                destIsDoor: destIsDoor,
                hasLegacyCamera: hasLegacyCam,
                legacyCameraX: door.cameraX !== undefined ? door.cameraX : door.tcx,
                legacyCameraY: door.cameraY !== undefined ? door.cameraY : door.tcy,
                computedCameraX: camX,
                computedCameraY: camY,
                openDirections: openDirs,
                blockedThresholdDirections: blockedDirs,
                walkableDirectionsFromDoor: openDirs,
                blockedDirectionsFromDoor: blockedDirs
            });
        }

        return report;
    };

    DoorDiagnostics.prototype.getSummary = function() {
        var snap = this.captureSnapshot();
        var lastTr = this.transitions.length > 0 ? this.transitions[this.transitions.length - 1] : null;
        var houseEntries = 0;
        var houseExits = 0;
        for (var i = 0; i < this.transitions.length; i++) {
            if (this.transitions[i].direction === 'ENTER_HOUSE') houseEntries++;
            else if (this.transitions[i].direction === 'EXIT_HOUSE') houseExits++;
        }
        var recvTeleports = 0;
        for (var j = 0; j < this.events.length; j++) {
            if (this.events[j].phase === 'NETWORK_RECV_TELEPORT' || this.events[j].phase === 'SERVER_TELEPORT_ROLLBACK') {
                recvTeleports++;
            }
        }
        return {
            currentPosition: snap.player ? { x: snap.player.gridX, y: snap.player.gridY } : null,
            environment: snap.door.environment,
            isOnDoor: snap.door.isOnDoor,
            nearestDoor: snap.door.nearestDoor,
            camera: snap.camera,
            zoning: snap.zoning,
            counters: Object.assign({}, this.counters),
            stats: {
                totalDoorTransitions: this.transitions.length,
                houseEntries: houseEntries,
                houseExits: houseExits,
                serverTeleportsReceived: recvTeleports,
                serverTeleportRollbacks: this.counters.serverTeleportRollbacks
            },
            lastTransition: lastTr ? {
                id: lastTr.id,
                direction: lastTr.direction,
                from: lastTr.from,
                to: lastTr.to,
                durationMs: lastTr.durationMs,
                guardsApplied: lastTr.guardsApplied,
                anomalies: lastTr.anomalies,
                anomaliesDetected: lastTr.anomaliesDetected,
                status: lastTr.status
            } : null,
            recentEventsCount: this.events.length
        };
    };

    DoorDiagnostics.prototype.getLogs = function(limit) {
        var n = typeof limit === 'number' ? limit : 50;
        return this.events.slice(-n);
    };

    DoorDiagnostics.prototype.getTransitions = function() {
        return this.transitions.slice();
    };

    DoorDiagnostics.prototype.clearLogs = function() {
        this.events = [];
        this.transitions = [];
        this.seq = 0;
        if (this.overlayVisible) {
            this.renderOverlay();
        }
    };
    DoorDiagnostics.prototype.clear = DoorDiagnostics.prototype.clearLogs;

    DoorDiagnostics.prototype.exportJson = function() {
        return JSON.stringify({
            generatedAt: new Date().toISOString(),
            summary: this.getSummary(),
            mapAudit: this.auditMapDoors(),
            transitions: this.transitions,
            events: this.events.slice(-100)
        }, null, 2);
    };

    DoorDiagnostics.prototype.postToServer = function(entryOrReason) {
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
        try {
            var payload;
            if (typeof entryOrReason === 'string') {
                var snap = this.captureSnapshot();
                payload = {
                    player: snap.player ? snap.player.name : 'unknown',
                    phase: entryOrReason.toUpperCase(),
                    timeFormatted: formatTime(Date.now()),
                    details: { summary: this.getSummary() },
                    anomalies: [],
                    coords: snap.player ? { x: snap.player.gridX, y: snap.player.gridY } : null,
                    environment: snap.door ? snap.door.environment : null
                };
            } else {
                var entry = entryOrReason || {};
                payload = {
                    player: entry.snapshot && entry.snapshot.player ? entry.snapshot.player.name : 'unknown',
                    phase: entry.phase,
                    timeFormatted: entry.timeFormatted,
                    details: entry.details,
                    anomalies: entry.anomalies,
                    coords: entry.snapshot && entry.snapshot.player
                        ? { x: entry.snapshot.player.gridX, y: entry.snapshot.player.gridY }
                        : null,
                    environment: entry.snapshot && entry.snapshot.door ? entry.snapshot.door.environment : null
                };
            }
            window.fetch('/api/diagnostics/door-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(function() {});
        } catch (e) {}
    };

    DoorDiagnostics.prototype.toggleOverlay = function(forceState) {
        if (typeof forceState === 'boolean') {
            this.overlayVisible = forceState;
        } else {
            this.overlayVisible = !this.overlayVisible;
        }
        if (typeof document !== 'undefined') {
            var el = document.getElementById('nova-door-diag-overlay');
            if (el) {
                el.style.display = this.overlayVisible ? 'flex' : 'none';
            }
            if (this.overlayVisible) {
                this.renderOverlay();
            }
        }
        return this.overlayVisible;
    };

    DoorDiagnostics.prototype.renderOverlay = function() {
        if (typeof document === 'undefined' || !this.overlayVisible) return;
        var bodyEl = document.getElementById('nova-door-diag-body');
        if (!bodyEl) return;

        var snap = this.captureSnapshot();
        var p = snap.player;
        var c = snap.camera;
        var d = snap.door;
        var lastTr = this.transitions.length > 0 ? this.transitions[this.transitions.length - 1] : null;

        var posText = p ? ('(' + p.gridX + ', ' + p.gridY + ') [px: ' + p.x + ',' + p.y + ']') : 'N/A';
        var envBadge = d.environment === 'INTERIOR'
            ? '<span style="color:#fbbf24;font-weight:700;">🏠 INTÉRIEUR (Maison)</span>'
            : '<span style="color:#4ade80;font-weight:700;">🌲 EXTÉRIEUR (Monde)</span>';
        var camText = c ? ('(' + c.gridX + ', ' + c.gridY + ') [' + c.gridW + 'x' + c.gridH + '] rel=(' + c.relX + ',' + c.relY + ')') : 'N/A';

        var nearText = 'Aucune porte proche';
        if (d.nearestDoor) {
            nearText = 'Porte (' + d.nearestDoor.x + ', ' + d.nearestDoor.y + ') dist=' + d.nearestDoor.distance +
                ' ➔ Dest (' + d.nearestDoor.destX + ', ' + d.nearestDoor.destY + ')';
            if (d.isOnDoor) {
                nearText = '🚪 <strong style="color:#38bdf8;">SUR SEUIL DE PORTE</strong> ' + nearText;
            }
        }

        var trHtml = '<div style="color:#94a3b8;font-size:11px;">Aucune transition de maison enregistrée dans cette session.</div>';
        if (lastTr) {
            var statusColor = lastTr.status === 'OK' || lastTr.status === 'SERVER_CONFIRMED' ? '#4ade80' : '#f87171';
            var guardsStr = lastTr.guardsApplied.length > 0 ? lastTr.guardsApplied.join(', ') : 'Standard';
            trHtml = '<div style="font-size:11px;line-height:1.4;">' +
                '<div><strong>#' + lastTr.id + '</strong> : (' + lastTr.from.x + ',' + lastTr.from.y + ') [' + lastTr.from.environment + '] ➔ ' +
                '(' + lastTr.to.x + ',' + lastTr.to.y + ') [' + lastTr.to.environment + '] ' +
                '<span style="color:' + statusColor + ';font-weight:700;">[' + lastTr.status + ']</span></div>' +
                '<div style="color:#cbd5e1;">Caméra: (' + lastTr.from.cameraX + ',' + lastTr.from.cameraY + ') ➔ (' + lastTr.to.cameraX + ',' + lastTr.to.cameraY + ') | Protections: ' + guardsStr + '</div>' +
                '</div>';
        }

        var logsHtml = '';
        var recent = this.events.slice(-8).reverse();
        for (var i = 0; i < recent.length; i++) {
            var ev = recent[i];
            var evP = ev.snapshot && ev.snapshot.player ? ('(' + ev.snapshot.player.gridX + ',' + ev.snapshot.player.gridY + ')') : '';
            var phaseColor = '#93c5fd';
            if (ev.phase === 'DOOR_TELEPORT_COMPLETE') phaseColor = '#4ade80';
            else if (ev.phase === 'BOUNDARY_GUARD_TRIGGERED') phaseColor = '#fbbf24';
            else if (ev.phase === 'SERVER_TELEPORT_ROLLBACK' || (ev.anomalies && ev.anomalies.length > 0)) phaseColor = '#f87171';

            var detailText = '';
            if (ev.details) {
                if (ev.details.description) detailText = ev.details.description;
                else if (ev.details.from && ev.details.to) detailText = ev.details.from + ' ➔ ' + ev.details.to;
                else if (ev.details.destX !== undefined) detailText = '➔ (' + ev.details.destX + ',' + ev.details.destY + ')';
                else if (ev.details.distance !== undefined) detailText = 'Porte (' + ev.details.doorX + ',' + ev.details.doorY + ') à ' + ev.details.distance + ' case(s)';
            }

            logsHtml += '<div style="border-bottom:1px solid rgba(148,163,184,0.15);padding:3px 0;font-size:10px;">' +
                '<span style="color:#94a3b8;">' + ev.timeFormatted + '</span> ' +
                '<strong style="color:' + phaseColor + ';">' + ev.phase + '</strong> ' +
                '<span style="color:#e2e8f0;">' + evP + ' ' + detailText + '</span>' +
                '</div>';
        }
        if (!logsHtml) {
            logsHtml = '<div style="color:#64748b;font-size:11px;">Approchez ou franchissez une porte pour capturer les événements...</div>';
        }

        bodyEl.innerHTML =
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;background:rgba(15,23,42,0.75);padding:6px;border-radius:6px;border:1px solid rgba(212,175,55,0.25);">' +
                '<div><small style="color:#94a3b8;">Coordonnées Joueur</small><br><strong style="color:#f8fafc;">' + posText + '</strong></div>' +
                '<div><small style="color:#94a3b8;">Environnement</small><br>' + envBadge + '</div>' +
                '<div style="grid-column:span 2;"><small style="color:#94a3b8;">Caméra & Zone</small><br><span style="color:#e2e8f0;">' + camText + '</span></div>' +
                '<div style="grid-column:span 2;"><small style="color:#94a3b8;">Proximité Porte</small><br><span style="color:#e2e8f0;">' + nearText + '</span></div>' +
            '</div>' +
            '<div style="margin-bottom:6px;background:rgba(15,23,42,0.75);padding:6px;border-radius:6px;border:1px solid rgba(56,189,248,0.25);">' +
                '<div style="font-size:10px;color:#38bdf8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Dernière Transition Entrée / Sortie</div>' +
                trHtml +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:#cbd5e1;margin-bottom:6px;">' +
                '<span>Transitions: <b>' + this.counters.doorTeleportsLocal + '</b></span>' +
                '<span>Anti-Doublon MOVE: <b>' + this.counters.duplicateMovesPrevented + '</b></span>' +
                '<span>Arrêt Joystick: <b>' + this.counters.joystickDoorStops + '</b></span>' +
                '<span>Aide Seuil: <b>' + (this.counters.thresholdSnapAssists + this.counters.standingDoorExitAssists) + '</b></span>' +
                '<span>Rollbacks Serveur: <b style="color:' + (this.counters.serverTeleportRollbacks > 0 ? '#f87171' : '#4ade80') + ';">' + this.counters.serverTeleportRollbacks + '</b></span>' +
            '</div>' +
            '<div style="max-height:125px;overflow-y:auto;background:rgba(2,6,23,0.85);padding:5px 7px;border-radius:5px;border:1px solid rgba(148,163,184,0.2);">' +
                logsHtml +
            '</div>';
    };

    return DoorDiagnostics;
}));
