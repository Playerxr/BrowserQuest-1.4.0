/**
 * Nova Quest — Dashboard Administrateur Simplifié
 * Développé pour UNIVERS NOVA STUDIO (github.com/Playerxr)
 * Interface de gestion en tableau avec colonnes éditables (SQLite + Firestore + Serveur temps réel)
 */
var express = require('express');
var fs = require('fs');
var path = require('path');
var Types = require('../../shared/js/gametypes');

var ADMIN_SECRET = process.env.NOVA_ADMIN_PASSWORD || 'nova-admin-2026';
var ADMIN_HTML_PATH = path.join(__dirname, '..', 'admin', 'index.html');

module.exports = function(wsServer) {
    var router = express.Router();

    function checkAdminAuth(req, res, next) {
        var token = req.headers['x-admin-token'] || req.query.token;
        if (!token || token !== ADMIN_SECRET) {
            return res.status(401).json({ error: 'Mot de passe administrateur invalide.' });
        }
        next();
    }

    // Page d'administration
    router.get('/admin', function(req, res) {
        try {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            var html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
            res.send(html);
        } catch(e) {
            res.status(500).send("Erreur lors du chargement de la page admin : " + e.message);
        }
    });

    // API : Liste de tous les joueurs avec statut en direct
    router.get('/api/admin/players', checkAdminAuth, function(req, res) {
        try {
            var db = wsServer.databaseHandler;
            var players = (db && typeof db.getAllPlayers === 'function') ? db.getAllPlayers() : [];

            // Graphe des joueurs actuellement en ligne
            var onlineMap = new Map();
            if (wsServer.worlds) {
                wsServer.worlds.forEach(function(world) {
                    if (world && world.forEachPlayer) {
                        world.forEachPlayer(function(p) {
                            onlineMap.set(p.name, {
                                x: p.x,
                                y: p.y,
                                armor: p.armor ? Types.getKindAsString(p.armor) : null,
                                weapon: p.weapon ? Types.getKindAsString(p.weapon) : null,
                                gold: p.gold,
                                lives: p.lives
                            });
                        });
                    }
                });
            }

            var result = players.map(function(p) {
                var onlineInfo = onlineMap.get(p.username);
                return {
                    username: p.username,
                    gold: (onlineInfo && onlineInfo.gold !== undefined) ? onlineInfo.gold : p.gold,
                    lives: (onlineInfo && onlineInfo.lives !== undefined) ? onlineInfo.lives : (p.lives !== undefined ? p.lives : 3),
                    armor: (onlineInfo && onlineInfo.armor) ? onlineInfo.armor : p.armor,
                    weapon: (onlineInfo && onlineInfo.weapon) ? onlineInfo.weapon : p.weapon,
                    is_admin: p.is_admin,
                    is_banned: p.is_banned,
                    isOnline: !!onlineInfo
                };
            });

            res.json({
                success: true,
                players: result,
                totalOnline: onlineMap.size,
                totalRegistered: players.length
            });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // API : Mise à jour en direct d'un joueur
    router.post('/api/admin/player/update', checkAdminAuth, function(req, res) {
        try {
            var body = req.body;
            if (!body || !body.username) {
                return res.status(400).json({ error: 'Nom de joueur manquant.' });
            }

            var db = wsServer.databaseHandler;
            if (!db || typeof db.updatePlayerAdmin !== 'function') {
                return res.status(500).json({ error: 'Gestionnaire de base de données non disponible.' });
            }

            var ok = db.updatePlayerAdmin(body);
            if (!ok) {
                return res.status(404).json({ error: 'Joueur introuvable.' });
            }

            // Mise à jour de l'instance en mémoire si le joueur est en jeu
            if (wsServer.worlds) {
                wsServer.worlds.forEach(function(world) {
                    if (world && world.forEachPlayer) {
                        world.forEachPlayer(function(player) {
                            if (player.name === body.username) {
                                if (body.gold !== undefined) player.gold = parseInt(body.gold, 10) || 0;
                                if (body.lives !== undefined) player.lives = parseInt(body.lives, 10) || 3;
                                if (body.is_admin !== undefined) player.admin = (body.is_admin === 1 || body.is_admin === true) ? 1 : 0;

                                if (body.armor) {
                                    var armorKind = Types.getKindFromString(body.armor);
                                    if (armorKind) {
                                        player.equipItem(armorKind, false);
                                        player.broadcast(player.equip(armorKind), false);
                                        player.send(player.equip(armorKind).serialize());
                                    }
                                }

                                if (body.weapon) {
                                    var weaponKind = Types.getKindFromString(body.weapon);
                                    if (weaponKind) {
                                        player.equipItem(weaponKind, false);
                                        player.broadcast(player.equip(weaponKind), false);
                                        player.send(player.equip(weaponKind).serialize());
                                    }
                                }

                                if (body.is_banned === 1 || body.is_banned === true) {
                                    player.connection.sendUTF8("banned");
                                    player.connection.close("Banni par un administrateur.");
                                } else {
                                    player.sendHubState("👑 Profil mis à jour par un administrateur !", false);
                                }
                            }
                        });
                    }
                });
            }

            res.json({ success: true, message: 'Joueur ' + body.username + ' mis à jour.' });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // API : Expulsion en direct
    router.post('/api/admin/player/kick', checkAdminAuth, function(req, res) {
        var username = req.body && req.body.username;
        if (!username) return res.status(400).json({ error: 'Pseudo requis.' });

        var kicked = false;
        if (wsServer.worlds) {
            wsServer.worlds.forEach(function(world) {
                if (world && world.forEachPlayer) {
                    world.forEachPlayer(function(player) {
                        if (player.name === username) {
                            player.connection.close("Expulsé par l'administrateur.");
                            kicked = true;
                        }
                    });
                }
            });
        }
        res.json({ success: true, kicked: kicked });
    });

    // API : Suppression d'un joueur
    router.post('/api/admin/player/delete', checkAdminAuth, function(req, res) {
        var username = req.body && req.body.username;
        if (!username) return res.status(400).json({ error: 'Pseudo requis.' });

        try {
            var db = wsServer.databaseHandler;
            if (db && typeof db.deletePlayerAdmin === 'function') {
                db.deletePlayerAdmin(username);
            }

            if (wsServer.worlds) {
                wsServer.worlds.forEach(function(world) {
                    if (world && world.forEachPlayer) {
                        world.forEachPlayer(function(player) {
                            if (player.name === username) {
                                player.connection.close("Compte supprimé par l'administrateur.");
                            }
                        });
                    }
                });
            }
            res.json({ success: true });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
