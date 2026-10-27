/**
 * Script utilitaire Nova Quest (UNIVERS NOVA STUDIO)
 * Permet de donner les droits Administrateur (is_admin = 1) à un joueur dans game.db
 *
 * Utilisation :
 *   node make_admin.js <Pseudo>
 */
var path = require('path'),
    Database = require('better-sqlite3');

var dbPath = path.resolve(__dirname, 'game.db');
var db = new Database(dbPath);

// S'assurer que les colonnes existent même si le serveur n'a pas encore tourné
try { db.exec("ALTER TABLE players ADD COLUMN gold INTEGER DEFAULT 150"); } catch(e) {}
try { db.exec("ALTER TABLE players ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE players ADD COLUMN is_banned INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE players ADD COLUMN guild_id INTEGER DEFAULT NULL"); } catch(e) {}

var username = process.argv[2];

if (!username) {
    console.log("=== Liste des joueurs enregistrés dans game.db ===");
    var players = db.prepare("SELECT username, is_admin, is_banned, gold, weapon, armor FROM players").all();
    if (players.length === 0) {
        console.log("Aucun joueur enregistré pour le moment.");
    } else {
        players.forEach(function(p) {
            console.log(" - " + p.username + " | Admin: " + (p.is_admin ? "OUI (1)" : "NON (0)") + " | Or: " + (p.gold || 0) + " | Arme: " + p.weapon + " | Armure: " + p.armor);
        });
    }
    console.log("\nPour passer un compte en Admin, tapez :");
    console.log("  node make_admin.js VotrePseudo");
    process.exit(0);
}

var row = db.prepare("SELECT * FROM players WHERE username = ?").get(username);
if (!row) {
    console.error("Erreur : Le joueur '" + username + "' n'existe pas dans game.db. Créez d'abord le compte en jeu !");
    process.exit(1);
}

db.prepare("UPDATE players SET is_admin = 1 WHERE username = ?").run(username);
console.log("Succès ! Le joueur '" + username + "' est maintenant Administrateur (is_admin = 1) dans game.db.");
console.log("Reconnectez-vous en jeu ou ouvrez le Hub Central pour voir l'onglet Admin !");
