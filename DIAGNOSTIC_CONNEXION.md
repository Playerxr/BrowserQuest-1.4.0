# Connexion bloquée sur « Chargement… »

Vérification du 25 octobre 2026.

Le serveur local répond sur le port 8000, les fichiers de démarrage et les images principales sont servis en HTTP 200, et le WebSocket actif envoie le signal `go`. Aucun compte réel n’a été utilisé pour ces vérifications.

Corrections appliquées :

- Le formulaire attend la création du moteur du jeu au lieu de forcer son lancement après 2,5 secondes. Un échec rend le bouton disponible.
- Les erreurs de carte, d’image et d’initialisation sont remontées au formulaire, avec un délai maximal pour éviter une attente infinie.
- Si le Web Worker ne démarre pas, échoue ou reste muet, la carte est chargée par JSON.
- La connexion WebSocket a un délai maximal de 30 secondes et remonte ses échecs une seule fois. Les erreurs ne condamnent plus les nouvelles tentatives.
- Le serveur refuse explicitement une connexion pendant le chargement des mondes ou lorsqu’ils sont complets. Un port déjà occupé provoque une sortie en erreur plutôt qu’un faux serveur actif.

Les sources antérieures sont conservées dans `backups/connection-20261025/`. La base de comptes n’a pas été employée par les tests.

Le lien de tunnel temporaire enregistré ne répond pas depuis cet environnement ; cela ne suffit pas à confirmer l’état d’un éventuel autre domaine configuré. La page locale reste accessible sur http://localhost:8000.

L’outil navigateur n’a pas pu ouvrir la page (erreur de politique du navigateur puis échec de rattachement de la vue). Les contrôles réalisés portent donc sur HTTP, WebSocket et les fonctions du client ; aucune vérification visuelle n’est annoncée.

La première exécution groupée a dépassé le délai de démarrage du serveur de test ; le même test d’intégration a réussi seul. Le lanceur exécute désormais les fichiers de tests en série et accorde 90 secondes au démarrage du serveur temporaire. Cela ne modifie pas les délais du jeu lui-même.

Les modifications du client nécessitent un rechargement complet (Ctrl+F5). Les gardes de démarrage dans `server/js/main.js` prennent effet au prochain redémarrage du serveur.

## Autres problèmes confirmés pendant la lecture

- Combat : `server/js/character.js`, méthode `forEachAttacker`, parcourt `attackers` comme un tableau alors que les attaquants sont enregistrés dans un objet. Les callbacks de poursuite et de nettoyage peuvent donc ne jamais être appelés. Cette partie n’a pas été modifiée dans la correction de connexion.
- Guildes : l’exclusion recherche encore le joueur dans le monde local. Un joueur connecté dans un autre monde conserve son `guildId` en mémoire et sa sauvegarde peut le réécrire en base. Le cas a été reproduit sur SQLite en mémoire ; cette correction reste à faire.

## Résultat final des tests

`npm test` : **68 tests réussis, aucune erreur**. Cela comprend 12 tests du chargement et de la connexion côté client, 3 tests des états de démarrage et le scénario d’intégration sur un vrai serveur avec une base temporaire.


## Reprise du diagnostic — 25 octobre 2026

- Chrome reste inaccessible dans ce nouveau chat : `Unable to load browser request-header policy. Retry the browser command.` Deux tentatives ont échoué. L’inventaire initial a aussi expiré (`js execution timed out; kernel reset, rerun your request`). Aucune validation visuelle du blocage.
- Le serveur local répond 200 sur `/status` avec `[0,0,0,0,0]`. Le processus écoutant sur 8000 est Node PID 20152, identifié par `server/js/main.js`, créé à 19:03:51 UTC, après les modifications serveur vérifiées avant cette reprise. Il n’a pas été arrêté ni redémarré pendant cette reprise.
- Vérification du graphe de démarrage : 120 modules et ressources texte présents, syntaxe JS et JSON analysables ; les 120 routes répondent 200. Les 119 fichiers statiques correspondent aux sources ; `config_build.json` est généré par le serveur. Les 71 sprites de démarrage possèdent leurs métadonnées et images aux échelles 1, 2 et 3.
- Le lien actuel de `current_tunnel_url.txt` dépasse un délai de 10 secondes sur `/status`. Ce résultat ne prouve pas la panne d’un autre domaine.
- Le scénario d’intégration sur une base temporaire réussit : création, achat, sauvegarde, déconnexion, reconnexion et rechargement. Aucun compte réel utilisé.
- Les tests ont révélé deux régressions réseau dans les sources actuelles, corrigées de façon ciblée : `server/js/ws.js` découpait `[::1]:4321` en hôte `[` et port `0` ; `client/js/gameclient.js` supprimait le port explicite WSS `80`. La configuration serveur respecte aussi `request.secure` et la politique de proxy Express, avec les ports par défaut HTTP 80 / HTTPS 443. Leur lien avec le blocage rapporté n’est pas établi. Sauvegardes : `backups/connection-resume-20261025/`.
- Le test d’erreur de sprite a été adapté à la nouvelle tentative sans CORS déjà présente ; un test couvre le succès de cette seconde tentative. Les 26 tests ciblés chargement/réseau/démarrage passent. La suite complète finale est en cours ; son résultat sera ajouté ci-dessous.
- Les nouvelles corrections réseau nécessitent un rechargement du client et, pour `ws.js`, un prochain redémarrage du serveur identifié. Le serveur en cours ne contient pas cette dernière correction. La cause exacte du blocage reste non reproduite : priorité suivante, observer le parcours navigateur local puis le domaine réellement utilisé.

Résultat final après corrections : `npm.cmd test` termine avec **69 tests réussis, 0 échec**, durée 165,8 secondes. Le scénario de reconnexion sur serveur réel et base temporaire passe également dans cette exécution complète.


### Domaine public communiqué par l’utilisateur

L’utilisateur a indiqué et autorisé `https://quest.universnovastudio.online`. Les premières requêtes sur `/` et `/status` ont retourné HTTP 530 avec le titre « Cloudflare Tunnel error ». Une requête suivante a expiré, puis le domaine a répondu 200 sans intervention sur les processus. Le serveur local est resté accessible (200, `[0,0,0,0,0]`). Le processus `cloudflared.exe` du projet a été identifié (PID 12236, parent 18008) sans afficher sa ligne de commande ni son jeton.

Après rétablissement : `/status`, `app.js`, `game.js`, `gameclient.js`, la carte JSON et le tileset 1 répondent 200 ; le WebSocket `wss://quest.universnovastudio.online/` reçoit `go`, sans authentification. Les trois scripts publics correspondent aux sources locales : [{"name":"app.js","status":200,"matchesLocal":true},{"name":"game.js","status":200,"matchesLocal":true},{"name":"gameclient.js","status":200,"matchesLocal":true}]. Une indisponibilité transitoire du tunnel a été directement observée, mais elle ne suffit pas à expliquer un blocage persistant après son rétablissement. Chrome reste inaccessible via l’outil (`Unable to load browser request-header policy`). Aucun parcours de connexion utilisateur n’a été validé visuellement.
