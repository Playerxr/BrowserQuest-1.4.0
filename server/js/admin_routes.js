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

    // =========================================================================
    // PONT D'AUTHENTIFICATION NAVIGATEUR MOBILE (Google & Google Play Jeux)
    // Permet à l'application mobile (APK Capacitor / WebView) d'ouvrir le
    // navigateur système du téléphone (Chrome Custom Tab / Safari) où le joueur
    // est déjà connecté à son compte Google / Play Jeux, sans ressaisir son
    // adresse Gmail ni son code 2FA, puis de récupérer automatiquement le jeton.
    // =========================================================================
    var mobileAuthSessions = new Map();
    var MOBILE_SESSION_TTL_MS = 5 * 60 * 1000;

    function cleanupExpiredMobileSessions() {
        var now = Date.now();
        mobileAuthSessions.forEach(function(val, key) {
            if (!val || (now - val.createdAt) > MOBILE_SESSION_TTL_MS) {
                mobileAuthSessions.delete(key);
            }
        });
    }

    router.post('/api/auth/mobile-session', function(req, res) {
        cleanupExpiredMobileSessions();
        var body = req.body || {};
        var key = String(body.key || '').trim();
        var idToken = String(body.idToken || '').trim();
        if (!key || key.length < 8 || key.length > 128 || !idToken) {
            return res.status(400).json({ error: 'Paramètres de session mobile invalides.' });
        }

        mobileAuthSessions.set(key, {
            idToken: idToken,
            displayName: String(body.displayName || '').trim().slice(0, 48),
            email: String(body.email || '').trim().slice(0, 120),
            provider: String(body.provider || 'google').trim().slice(0, 24),
            createdAt: Date.now()
        });

        res.json({ success: true });
    });

    router.get('/api/auth/mobile-session', function(req, res) {
        cleanupExpiredMobileSessions();
        res.setHeader('Cache-Control', 'no-store');
        var key = String((req.query && req.query.key) || '').trim();
        if (!key || !mobileAuthSessions.has(key)) {
            return res.json({ completed: false });
        }

        var sessionData = mobileAuthSessions.get(key);
        mobileAuthSessions.delete(key);
        res.json({
            completed: true,
            idToken: sessionData.idToken,
            displayName: sessionData.displayName,
            email: sessionData.email,
            provider: sessionData.provider
        });
    });

    router.get('/auth/mobile-bridge', function(req, res) {
        var key = String((req.query && req.query.key) || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80);
        var providerType = String((req.query && req.query.provider) || 'google').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 24);
        var isPlayGames = (providerType === 'playgames');
        var titleLabel = isPlayGames ? 'Google Play Jeux' : 'Google';
        var accentColor = isPlayGames ? '#10b981' : '#3b82f6';

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send('<!DOCTYPE html>\n' +
'<html lang="fr">\n' +
'<head>\n' +
'  <meta charset="utf-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
'  <title>Connexion ' + titleLabel + ' — Nova Quest</title>\n' +
'  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js" crossorigin="anonymous"></script>\n' +
'  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js" crossorigin="anonymous"></script>\n' +
'  <style>\n' +
'    * { box-sizing: border-box; }\n' +
'    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, #1e293b 0%, #090d16 100%); color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; padding: 20px; text-align: center; }\n' +
'    .card { width: 100%; max-width: 400px; background: rgba(15, 23, 42, 0.95); border: 2px solid #ca8a04; border-radius: 16px; padding: 26px 22px; box-shadow: 0 20px 50px rgba(0,0,0,0.7); }\n' +
'    h1 { margin: 0 0 8px 0; font-size: 22px; color: #fef08a; }\n' +
'    p { margin: 0 0 18px 0; font-size: 14px; color: #cbd5e1; line-height: 1.45; }\n' +
'    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 13px 18px; border-radius: 10px; border: none; font-size: 15px; font-weight: 700; cursor: pointer; background: ' + accentColor + '; color: #fff; text-decoration: none; box-shadow: 0 4px 14px rgba(0,0,0,0.4); margin-top: 8px; }\n' +
'    .btn.secondary { background: #334155; color: #e2e8f0; margin-top: 10px; font-size: 13px; }\n' +
'    .status { margin: 14px 0; font-size: 14px; color: #fde047; font-weight: 600; min-height: 22px; }\n' +
'    .error { color: #fca5a5; background: rgba(127, 29, 29, 0.5); border: 1px solid #ef4444; padding: 10px; border-radius: 8px; margin-top: 12px; display: none; font-size: 13px; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="card">\n' +
'    <h1>Nova Quest</h1>\n' +
'    <p>Authentification rapide via votre navigateur mobile (' + titleLabel + ') sans ressaisir votre compte.</p>\n' +
'    <div id="status" class="status">Vérification de votre session ' + titleLabel + '...</div>\n' +
'    <button id="auth-btn" class="btn" type="button">Continuer avec ' + titleLabel + '</button>\n' +
'    <a id="return-app-btn" class="btn" href="intent://auth-complete?key=' + key + '#Intent;scheme=novaquest;package=com.universnovastudio.novaquest;end" style="display:none;background:#16a34a;">Retourner dans Nova Quest</a>\n' +
'    <div id="error-box" class="error"></div>\n' +
'  </div>\n' +
'  <script>\n' +
'    (function() {\n' +
'      var SESSION_KEY = ' + JSON.stringify(key) + ';\n' +
'      var PROVIDER_TYPE = ' + JSON.stringify(providerType) + ';\n' +
'      var statusEl = document.getElementById("status");\n' +
'      var authBtn = document.getElementById("auth-btn");\n' +
'      var returnBtn = document.getElementById("return-app-btn");\n' +
'      var errorBox = document.getElementById("error-box");\n' +
'      var sent = false;\n' +
'      firebase.initializeApp({\n' +
'        apiKey: "AIzaSyA-WdbYNN-Ks3PJAg7ZvMshSD9TxQnFPpI",\n' +
'        authDomain: "nova-quest-game.firebaseapp.com",\n' +
'        projectId: "nova-quest-game",\n' +
'        storageBucket: "nova-quest-game.firebasestorage.app",\n' +
'        messagingSenderId: "808258506442",\n' +
'        appId: "1:808258506442:web:e4013db9a481ea1854ae33"\n' +
'      });\n' +
'      function showError(msg) {\n' +
'        errorBox.textContent = msg;\n' +
'        errorBox.style.display = "block";\n' +
'      }\n' +
'      function finishWithUser(user) {\n' +
'        if (!user || sent) return;\n' +
'        sent = true;\n' +
'        statusEl.textContent = "Validation du compte en cours...";\n' +
'        authBtn.style.display = "none";\n' +
'        user.getIdToken(true).then(function(idToken) {\n' +
'          return fetch("/api/auth/mobile-session", {\n' +
'            method: "POST",\n' +
'            headers: { "Content-Type": "application/json" },\n' +
'            body: JSON.stringify({\n' +
'              key: SESSION_KEY,\n' +
'              idToken: idToken,\n' +
'              displayName: user.displayName || "",\n' +
'              email: user.email || "",\n' +
'              provider: PROVIDER_TYPE\n' +
'            })\n' +
'          });\n' +
'        }).then(function(resp) {\n' +
'          if (!resp.ok) throw new Error("Impossible d\'enregistrer la session mobile.");\n' +
'          statusEl.textContent = "Connecté ! Retour automatique au jeu...";\n' +
'          returnBtn.style.display = "inline-flex";\n' +
'          try {\n' +
'            if (window.opener && !window.opener.closed) {\n' +
'              window.opener.postMessage({ type: "nova-mobile-auth-complete", key: SESSION_KEY }, "*");\n' +
'            }\n' +
'          } catch(e) {}\n' +
'          setTimeout(function() {\n' +
'            try { window.close(); } catch(e) {}\n' +
'            window.location.href = returnBtn.href;\n' +
'          }, 350);\n' +
'        }).catch(function(err) {\n' +
'          sent = false;\n' +
'          authBtn.style.display = "inline-flex";\n' +
'          showError(err.message || String(err));\n' +
'        });\n' +
'      }\n' +
'      function startSignIn() {\n' +
'        errorBox.style.display = "none";\n' +
'        statusEl.textContent = "Ouverture de la sélection de compte...";\n' +
'        var provider = new firebase.auth.GoogleAuthProvider();\n' +
'        provider.setCustomParameters({ prompt: "select_account" });\n' +
'        firebase.auth().signInWithPopup(provider).then(function(res) {\n' +
'          if (res && res.user) finishWithUser(res.user);\n' +
'        }).catch(function(err) {\n' +
'          if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) {\n' +
'            firebase.auth().signInWithRedirect(provider);\n' +
'          } else if (err) {\n' +
'            showError("Connexion annulée ou refusée : " + (err.message || err.code));\n' +
'          }\n' +
'        });\n' +
'      }\n' +
'      authBtn.addEventListener("click", startSignIn);\n' +
'      firebase.auth().getRedirectResult().then(function(res) {\n' +
'        if (res && res.user) finishWithUser(res.user);\n' +
'      }).catch(function(err) {\n' +
'        if (err) showError(err.message || err.code);\n' +
'      });\n' +
'      firebase.auth().onAuthStateChanged(function(user) {\n' +
'        if (user) {\n' +
'          finishWithUser(user);\n' +
'        } else {\n' +
'          statusEl.textContent = "Appuyez ci-dessous pour utiliser votre compte du navigateur :";\n' +
'        }\n' +
'      });\n' +
'    })();\n' +
'  </script>\n' +
'</body>\n' +
'</html>');
    });

    // =========================================================================
    // DIAGNOSTIC MAISONS / PORTES (Journalisation des transitions & anomalies)
    // =========================================================================
    var doorDiagnosticLogs = [];
    var MAX_SERVER_DOOR_LOGS = 200;

    router.post('/api/diagnostics/door-log', function(req, res) {
        try {
            var body = req.body || {};
            var playerName = String(body.player || body.playerName || 'unknown').slice(0, 32);
            var entry = {
                id: doorDiagnosticLogs.length + 1,
                receivedAt: new Date().toISOString(),
                player: playerName,
                playerName: playerName,
                phase: String(body.phase || body.reason || 'UNKNOWN').slice(0, 64),
                timeFormatted: String(body.timeFormatted || ''),
                coords: body.coords || null,
                environment: body.environment || null,
                details: body.details || body.summary || {},
                anomalies: Array.isArray(body.anomalies) ? body.anomalies : []
            };
            doorDiagnosticLogs.push(entry);
            if (doorDiagnosticLogs.length > MAX_SERVER_DOOR_LOGS) {
                doorDiagnosticLogs.shift();
            }
            res.json({ ok: true, success: true, total: doorDiagnosticLogs.length, count: doorDiagnosticLogs.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/api/diagnostics/door-log', function(req, res) {
        if (typeof res.setHeader === 'function') {
            res.setHeader('Cache-Control', 'no-store');
        }
        res.json({
            ok: true,
            success: true,
            total: doorDiagnosticLogs.length,
            count: doorDiagnosticLogs.length,
            logs: doorDiagnosticLogs.slice(-100)
        });
    });

    return router;
};

