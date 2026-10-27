# 🚀 PROMPT DE REPRISE TECHNIQUE — PROJET NOVA QUEST (BROWSERQUEST)
> **UNIVERS NOVA STUDIO** — Éditeur : *github.com/Playerxr*
> **Document de passation / Export de projet** (À coller directement dans le nouvel assistant IA sur le nouveau PC)

---

## 1. Contexte & Identité du Projet

Ce projet est **Nova Quest**, un mini-MMORPG 2D multijoueur temps réel basé sur le moteur HTML5 / Canvas / WebSockets de BrowserQuest.

Le projet a été massivement enrichi avec des fonctionnalités exclusives développées pour **UNIVERS NOVA STUDIO** :
1. **Persistance SQLite intégrée (`server/js/db.js`)** :
   - Comptes joueurs avec mot de passe hashé (`bcryptjs`).
   - Sauvegarde de la position (`x`, `y`), points de vie, niveau, expérience, équipement (armure, arme).
   - Solde de départ de **150 pièces d'Or** par joueur.
   - Sac à dos / Inventaire à 6 emplacements persistant en base.
   - Système de Guildes et Banque de guilde.
2. **Système de 3 Vies & HUD dédié** :
   - Barre de 3 cœurs de vie (`#nova-lives-hud`) affichée en haut à gauche.
   - Décompte des vies à chaque mort, résurrection au village ou Game Over si 0 vie.
3. **Système d'Inventaire (6 slots) & Raccourcis** :
   - Interface interactive de sac à dos (`#nova-inventory`) toggleable via la touche `I` ou clic sur l'icône de sac.
   - Raccourcis clavier numériques `1`, `2`, `3` pour la consommation rapide de potions.
4. **10 World Bosses légendaires** :
   - Boss avec attaques de zone (AoE), projectiles visuels et tables de loot rares (armes d'or, armures légendaires).
5. **Hub Communautaire & Système d'Achat/Vente** :
   - Menu `#nova-hub` avec boutiques d'objets, marché entre joueurs et gestion de guilde.
6. **Domaine Cloudflare Zero Trust Permanent** :
   - `https://quest.universnovastudio.online/`
   - WebSocket sécurisé : `wss://quest.universnovastudio.online/`

---

## 2. Arborescence & Fichiers Stratégiques

```
BrowserQuest-1.4.0/
├── server/
│   ├── js/
│   │   ├── main.js             # Point d'entrée serveur (World, DB, Dispatcher)
│   │   ├── ws.js               # Serveur HTTP + WebSocket (écoute dual-stack IPv4/IPv6)
│   │   ├── db.js               # Couche SQLite (utilisateurs, inventaires, or, marketplace)
│   │   ├── player.js           # Entité joueur, gestion de WELCOME, HUB, equip, combat
│   │   └── world.js            # Carte, groupes de zones, gestion des entités et bosses
│   └── db/
│       └── novaquest.db        # Fichier de base de données SQLite persistant
├── client/
│   ├── index.html              # HTML avec parchemin de connexion, HUD vies, inventaire
│   ├── css/
│   │   └── main.css            # Styles du jeu, centrage Desktop, responsive mobile
│   └── js/
│       ├── main.js             # Initialisation RequireJS, clics menus, raccourcis
│       ├── app.js              # Cycle de vie client, validation de formulaire, tryStartingGame
│       ├── game.js             # Moteur de jeu, boucle de rendu Canvas, callbacks
│       ├── gameclient.js       # Client WebSocket (gestion des URLs WS/WSS et des paquets)
│       ├── sprite.js           # Gestionnaire de sprites et fallbacks Canvas
│       └── config.js           # Détection dynamique host/port (443 / 8000)
├── run_playtest.js             # Script maître : lance Node server + Cloudflare Tunnel
├── cloudflare_token.txt        # Token Cloudflare Zero Trust pour quest.universnovastudio.online
├── cloudflared.exe             # Binaire tunnel Cloudflare pour Windows
└── package.json                # Dépendances npm (express, ws, sqlite3, bcryptjs, etc.)
```

---

## 3. Ce Qui a Été Réalisé & Résolu avec Succès

### A. Restauration du Menu Déroulant Authentique & Ergonomie PC
- **Zéro défilement vertical sur PC Desktop (1920x1080)** : La carte parchemin est parfaitement centrée, le logo d'origine est visible sans aucune barre de défilement parasite.
- **Animation de déroulement CSS (.animate)** : La navigation originale a été restaurée :
  1. Écran d'accueil de connexion (`#loadcharacter`).
  2. Clic sur *Créer un compte* (`#create-new`) ➡️ Enroulement du parchemin vers l'écran de confirmation (`#confirmation`).
  3. Clic sur *Continuer* (`#continue`) ➡️ Déroulement fluide vers le formulaire de création de compte (`#createcharacter`).

### B. Prise en Charge Mobile (Portrait / Paysage)
- Sur écran vertical (Mobile portrait) : Affichage d'un panneau d'avertissement plein écran `#portrait` avec animation d'inclinaison de l'appareil. Le parchemin de jeu est masqué pour protéger l'ergonomie.
- Dès que le smartphone est pivoté en paysage (`667x375`) : Le verrouillage se lève automatiquement et instantanément.

### C. Correction Critique du Dual-Stack & Erreur Cloudflare 520
- **Problème résolu** : Sur Windows, le connecteur `cloudflared` résout `localhost:8000` vers l'adresse IPv6 de bouclage `[::1]:8000`. Si Node écoutait uniquement sur `0.0.0.0`, la connexion IPv6 échouait immédiatement (`connectex WSAECONNREFUSED`), provoquant l'erreur Cloudflare 520 ("Web server is returning an unknown error").
- **Solution appliquée dans `server/js/ws.js`** :
  ```javascript
  this._httpServer.listen(port, function() {
      log.info("Server listening on dual-stack port " + port);
  });
  ```
  Le serveur accepte désormais à la fois IPv4 (`127.0.0.1`, `0.0.0.0`) et IPv6 (`::1`), permettant à Cloudflare de relayer les requêtes sans aucune erreur.

### D. Correction de l'URL WebSocket Client (`client/js/gameclient.js`)
- Le client détecte automatiquement le protocole :
  - Sur `https://quest.universnovastudio.online/` ➡️ `wss://quest.universnovastudio.online/` (port 443 implicite, aucun port 8000 erroné).
  - En local `http://localhost:8000/` ➡️ `ws://localhost:8000/`.
- Résout le bug où le port pouvait être ignoré ou mal formé si `dispatcherMode` était inactif.

### E. Nettoyage Canvas & CORS
- Retrait des attributs `crossOrigin = "Anonymous"` sur les sprites locaux dans `client/js/sprite.js` et `client/js/map.js` pour éliminer le problème du canvas teinté (*tainted canvas*) lors des appels à `getImageData`.

---

## 4. Problèmes Restants & Feuille de Route pour le Nouveau PC

Voici les points précis à finaliser sur cette machine :

### 1. Surveillance et Stabilité de la Connexion En Ligne (`cloudflared`)
- Le tunnel Cloudflare Zero Trust utilise le token défini dans `cloudflare_token.txt` :
  `eyJhIjoiODkxZmZkNTQwZmY5OGMyMzAyMDQ2MzU4OGYxMTU1YzciLCJ0IjoiM2Q5ZjQzNzQtM2EyNy00YjZiLWFmODgtMTdjZDk5OWM2OGY4IiwicyI6Ik4yUmxPRGhoWkRjdE56VTRaaTAwWXpOakxUZzVOVEl0TURZNE9XUmtNek5sWVdZNSJ9`
- **Attention aux doublons** : Si un service Windows `cloudflared` tourne en arrière-plan avec le même token, il entre en conflit avec l'instance lancée par `run_playtest.js`.
- Toujours vérifier avant de lancer :
  `Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force`
- Lancer le serveur et le tunnel avec la commande officielle :
  ```powershell
  npm run playtest
  ```
  Le terminal affichera :
  `🎮 NOVA QUEST EST EN LIGNE SUR VOTRE DOMAINE CLOUDFLARE !`
  `🔗 LIEN PUBLIC : https://quest.universnovastudio.online/`

### 2. Transition Complète vers le Canevas de Jeu (`WELCOME` ➡️ `app.start()`)
- Lorsqu'un utilisateur clique sur **Jouer** ou **Créer** :
  1. Le client envoie `[Types.Messages.CREATE, name, pw, email]` ou `[Types.Messages.LOGIN, name, pw]` via le WebSocket.
  2. Le serveur répond par `Types.Messages.WELCOME` avec l'ID, la position, les stats et l'inventaire.
  3. Dans `client/js/game.js`, `onWelcome` doit déclencher `started_callback({success: true})`.
  4. Dans `client/js/app.js`, `self.start()` doit exécuter `this.hideIntro()`, qui retire la classe `.intro` de `body` et applique les classes `.started .game`.
  5. **Vérification** : S'assurer que le formulaire parchemin disparaît totalement et que le héros apparaît bien au centre du canevas avec son sprite et ses points de vie.

### 3. Diagnostic du « Chargement en Boucle » sur Mobile
- **Symptôme observé** : Sur mobile, le joueur reste bloqué sur « Chargement... » indéfiniment lors de la connexion.
- **Causes identifiées dans les logs** :
  1. **Déconnexions intempestives du Tunnel Cloudflare (`cloudflared`)** :
     Sur cette machine Windows actuelle connectée en Wi-Fi, `cloudflared` subit des micro-coupures de flux de contrôle (`connection with edge closed`, `client disconnected`). Si le mobile tente de se connecter pendant ces micro-coupures, la poignée de main WebSocket WSS est gelée en attente.
  2. **Téléchargement de la carte (`world_client.json` ~2 Mo)** :
     Sur mobile, `Web Workers` est désactivé par défaut (`client/js/map.js` ligne 13). La carte complète est téléchargée via un appel AJAX `$.ajax`. Si le tunnel coupe pendant ce téléchargement, le chargement de la carte ne se termine jamais et bloque le démarrage du jeu.
- **Résolution sur le nouveau PC** :
  - Sur la nouvelle machine (plus rapide et avec une connexion réseau stable / Ethernet), `cloudflared` ne subira plus ces coupures de flux.
  - S'assurer que le tunnel démarre avec les résolveurs Cloudflare et Google :
    `cloudflared tunnel --no-prechecks run --protocol http2 --dns-resolver-addrs 1.1.1.1:53 --dns-resolver-addrs 8.8.8.8:53 --token <token>`

### 4. Contrôle des Erreurs Console & Audits
- Inspecter la console du navigateur (F12) pour s'assurer qu'aucun avertissement sur les polices, les fichiers audio manquants (`client/audio/`) ou des erreurs RequireJS ne bloque l'exécution.

---

## 5. Commandes de Démarrage Rapide

Sur votre nouveau PC, ouvrez un terminal dans ce dossier et exécutez :

```powershell
# 1. Vérification des dépendances Node.js
npm install

# 2. Lancement complet du serveur de jeu + Tunnel Cloudflare
npm run playtest

# 3. Test de connectivité immédiat (depuis un autre terminal)
curl.exe -I https://quest.universnovastudio.online/
```

Dès que `HTTP/1.1 200 OK` s'affiche, ouvrez votre navigateur sur :
👉 **`https://quest.universnovastudio.online/`**
et testez la création de personnage en direct !
