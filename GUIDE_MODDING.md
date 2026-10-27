# 🛠️ Guide de modding BrowserQuest

> Projet : `BrowserQuest-1.4.0/BrowserQuest-1.4.0/`  
> Lancer le jeu : `npm install` (une fois) puis `npm start` → http://localhost:8000  
> ⚠️ Après chaque modification du **serveur** (`server/`, `shared/`), redémarre `npm start`. Pour le **client** (`client/`), recharge simplement la page (Ctrl+F5).

## Comment ça marche (en 30 secondes)

| Rôle | Fichier | Contenu |
|---|---|---|
| **Catalogue** des entités (mobs, armes, armures, objets, PNJ) | `shared/js/gametypes.js` | IDs, type, XP et niveau des mobs, classement des armes/armures |
| **Stats serveur** des mobs | `server/js/properties.js` | PV (`hp`), niveau d'arme/armure, **table de drops** |
| **Formules** de combat | `server/js/formulas.js` | Dégâts (`dmg`) et PV du joueur (`hp`) |
| **Sprites** | `client/js/sprites.js` + `client/sprites/*.json` + `client/img/` | Images et animations |
| **Fabriques** côté client | `client/js/entityfactory.js`, `items.js`, `mobs.js`, `npcs.js` | Création des objets à l'écran |
| **Carte** (où apparaissent mobs/objets/PNJ) | `server/maps/world_server.json` | Zones de spawn |

Le fichier `shared/js/gametypes.js` est partagé : le serveur le charge directement, et le client le reçoit via `/shared/js/gametypes.js`.

---

## 1️⃣ Modifier les dégâts d'une arme ou les PV d'un monstre

### PV d'un monstre
Fichier : `server/js/properties.js`

```js
ogre: {
    drops: { burger: 10, flask: 50, platearmor: 20, morningstar: 20, firepotion: 5 },
    hp: 200,      // ← points de vie du monstre
    armor: 3,     // ← niveau d'armure (réduit les dégâts qu'il reçoit)
    weapon: 2     // ← niveau d'arme (augmente les dégâts qu'il inflige)
},
```

### Dégâts d'une arme
Les dégâts sont calculés dans `server/js/formulas.js` :

```js
Formulas.dmg = function (weaponLevel, armorLevel) {
    var dealt = weaponLevel * Utils.randomInt(5, 10);   // dégâts bruts
    var absorbed = armorLevel * Utils.randomInt(1, 3);  // dégâts absorbés
    ...
```

- **Niveau d'une arme** = sa position dans `Types.rankedWeapons` (`shared/js/gametypes.js`) + 1.  
  Ex. : `sword1` = niveau 1, `axe` = 3, `goldensword` = 7.
- Pour **changer l'ordre/le niveau** d'une arme : déplace-la dans la liste `Types.rankedWeapons`.
- Pour **rendre toutes les armes plus fortes** : change `randomInt(5, 10)` dans `Formulas.dmg` (ex. `randomInt(10, 20)`).
- Pour un **mob** : change `weapon:` dans `properties.js`.
- PV du joueur : `Formulas.hp` (`80 + (niveauArmure - 1) * 30`).

### XP / niveau d'un mob
`shared/js/gametypes.js`, objet `kinds` : `rat: [Types.Entities.RAT, "mob", 5, 2]` → **5 = XP donnée**, **2 = niveau**.

### Drops
Dans `properties.js`, `drops: { flask: 40, burger: 10 }` : les nombres sont des **pourcentages de chance** (le reste = rien).

---

## 2️⃣ Changer le message de bienvenue / l'interface de départ

- **Écran de départ** (formulaires de connexion/création, textes « About », « How to play ») : `client/index.html`
  - Formulaires : balises `<input id="nameinput">`, `loginnameinput`, etc.
  - Texte de présentation : cherche `BrowserQuest is a multiplayer game…`
  - Titre de l'onglet : balise `<title>`.
- **Styles / couleurs / polices** : `client/css/*.css`
- **Phrases des PNJ** (guide, roi, villageois…) : `client/js/npc.js` / `client/js/npcs.js`.
- **Messages affichés en jeu** (notifications) : `client/js/game.js` (cherche `showNotification`).
- **Message de bienvenue côté serveur** (envoyé à la connexion) : `sendWelcome` dans `server/js/player.js`.

---

## 3️⃣ Ajouter un nouvel objet ou un boss

### A. Nouvelle arme (ex. `superepee`)

1. **`shared/js/gametypes.js`**
   - Dans `Types.Entities`, ajoute un ID **unique** : `SUPEREPEE: 67,`
   - Dans `kinds` : `superepee: [Types.Entities.SUPEREPEE, "weapon"],`
   - Dans `Types.rankedWeapons`, place-la au niveau voulu (ça détermine ses dégâts).
2. **Images** : ajoute `client/sprites/superepee.json` et `client/sprites/item-superepee.json` + les PNG dans `client/img/1|2|3/` (copie ceux de `bluesword` et modifie-les).
3. **`client/js/sprites.js`** : ajoute `'text!../sprites/superepee.json'` et `'text!../sprites/item-superepee.json'` (en gardant le même ordre dans la liste de paramètres de la fonction).
4. **`client/js/game.js`** : ajoute `"superepee"` et `"item-superepee"` dans la liste de sprites à charger (là où apparaît `"bluesword"`).
5. **`client/js/items.js`** : copie le bloc `BlueSword` → `SuperEpee` (avec `Types.Entities.SUPEREPEE`).
6. **`client/js/entityfactory.js`** : copie le bloc `EntityFactory.builders[Types.Entities.BLUESWORD]`.
7. **Donner l'arme** : ajoute-la dans un `drops` de `server/js/properties.js` (ex. `superepee: 5`).

> 💡 Test rapide sans dessiner : réutilise les sprites existants en copiant les fichiers `.json` et PNG d'une autre arme.

### B. Nouveau boss (ou monstre)

1. **`shared/js/gametypes.js`** : ID unique dans `Types.Entities` (ex. `DRAGON: 15`) + ligne dans `kinds` : `dragon: [Types.Entities.DRAGON, "mob", 200, 60],` (XP, niveau).
2. **`server/js/properties.js`** : ajoute son bloc :
   ```js
   dragon: { drops: { goldensword: 100 }, hp: 2000, armor: 8, weapon: 10 },
   ```
3. **Sprites** : `client/sprites/dragon.json` + image, puis `client/js/sprites.js` et la liste dans `client/js/game.js` (comme pour l'arme).
4. **`client/js/mobs.js`** : copie un mob existant (ex. `Boss`) → `Dragon` ; **`client/js/entityfactory.js`** : ajoute `EntityFactory.builders[Types.Entities.DRAGON]`.
5. **Le faire apparaître** : dans `server/maps/world_server.json` (zones de spawn `roamingAreas`), ajoute une zone avec `"type": "dragon"`, `nb: 1`, et ses coordonnées `x, y, width, height`. Regarde l'entrée du `boss` actuel pour l'exemple.

### C. Nouvel objet consommable
Même principe que l'arme avec le type `"object"` dans `kinds`. Son effet (soin, etc.) est géré dans `server/js/player.js` (cherche `FLASK`/`BURGER`/`firepotion`).

---

## 🌐 Jouer avec des amis

- Le client se connecte automatiquement à l'adresse de la page (`window.location`), en `ws://` ou `wss://` (HTTPS) selon le cas.
- **Tunnel** : lance `npm start`, puis dans un autre terminal `npx localtunnel --port 8000` ou `cloudflared tunnel --url http://localhost:8000`, et donne l'URL à tes amis.
- **Sauvegarde** : la configuration actuelle utilise SQLite dans `game.db` (avec les fichiers WAL associés pendant le fonctionnement). Le serveur accepte `database_path` dans la configuration pour une base séparée ; les tests utilisent une base en mémoire. Redis reste un ancien backend optionnel.
