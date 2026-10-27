# Corrections de sécurité et de fiabilité

## Lancer et vérifier

Depuis ce dossier :

```powershell
npm install
npm test
npm start
```

Ouvrir http://localhost:8000. Runtime vérifié : Node.js 24.20.0. SQLite est le backend configuré ; Redis est facultatif. Les nouveaux tests utilisent le lanceur intégré à Node, sans Make ni Mocha. Les anciens tests restent accessibles via `npm run test:legacy` avec leurs dépendances historiques.

## Comptes

Les nouveaux mots de passe sont hachés avec scrypt asynchrone (N=32768, r=8, p=1), sel aléatoire de 16 octets et clé de 64 octets. Les comparaisons utilisent timingSafeEqual. Les mots de passe nouveaux conservent exactement leurs caractères et acceptent de 1 à 256 caractères. Le serveur ne les tronque plus.

La migration des anciens comptes se fait à leur prochaine connexion réussie. Jusqu’à cette connexion, leur ancienne valeur reste dans la base. Pour éviter de bloquer les comptes existants, leur transformation historique (nettoyage, espaces en début/fin et limite de 15 caractères) reste compatible, y compris après migration ; cette compatibilité ne s’applique pas aux nouveaux comptes. Les anciens comptes n’acquièrent donc pas rétroactivement une distinction sur les caractères au-delà des 15 premiers.

Les authentifications simultanées sont contrôlées dans tous les mondes et une déconnexion pendant le hachage ne crée pas de joueur fantôme. Les messages de connexion ne journalisent plus le mot de passe.

## Déplacements et combat

Le client transmet les cases parcourues, et le serveur contrôle leur voisinage, les collisions et la cadence avec une petite tolérance aux paquets groupés. Les téléportations réseau doivent correspondre à une porte réelle de la carte. Les téléportations du Hub restent soumises à leurs contrôles de guilde ou d’administration.

Les coups, le butin, les coffres et les points de contrôle vérifient leur portée et leur instance. Le serveur déclenche lui-même les dégâts des monstres : supprimer les messages HURT du client ne rend plus le joueur invulnérable. Changer d’armure ne restaure plus gratuitement ses PV.

**Déployer les fichiers client et serveur ensemble**, puis recharger le navigateur (Ctrl+F5) : l’ancien client qui envoie la destination d’un long trajet est incompatible avec le contrôle par case.

## Économie et guildes

Boutique, ventes/retraits/achats du marché, création de guilde, dépôts, achat du salon et invocations payantes utilisent une transaction SQLite immédiate. En cas d’échec, les soldes, équipements et inventaires en mémoire sont restaurés et les notifications de réussite sont annulées. Une invocation annulée retire aussi l’entité créée et sa file de spawn. Un vendeur connecté dans un autre monde est crédité en mémoire et en base pour éviter que sa sauvegarde suivante écrase le paiement.

L’acceptation d’une guilde nécessite une invitation et l’exclusion vérifie l’appartenance à la guilde. Les anciens messages GUILD qui manipulaient des guildes en mémoire sont remplacés par un message invitant à utiliser le Hub.

## Réseau et accès public

Les routes de configuration dynamique passent avant les fichiers statiques. La connexion habituelle utilise l’origine de la page, avec ws/wss et IPv6 ; le dispatcher conserve sa destination explicite.

Les entrées WebSocket sont limitées à 16 Kio, chaque message est validé, et les actions du Hub ont un schéma précis. Le débit est limité par connexion ; les authentifications sont limitées à 10 tentatives par minute et par adresse, même après reconnexion.

Les en-têtes proxy sont ignorés par défaut. Derrière un proxy connu, définir `BROWSERQUEST_TRUST_PROXY` avec les adresses ou réseaux de confiance, par exemple `loopback` pour un tunnel local. La valeur `true` n’est adaptée que si toutes les requêtes passent obligatoirement par un proxy qui remplace les en-têtes transférés. Plusieurs joueurs partageant la même adresse partagent aussi la limite de connexion.

## Données et retour arrière

Les vérifications utilisent des bases SQLite en mémoire ou temporaires, sans employer `game.db` existant. Le serveur accepte `database_path` pour choisir une autre base. Le dossier `backups/security-20261024-191548` contient les sources conservées avant ces modifications. Il ne s’agit pas d’une sauvegarde des comptes. Après migration effective de comptes, le retour à un serveur qui ne sait pas vérifier scrypt empêcherait leur connexion.

Avant un déploiement sur un serveur actif, conserver une sauvegarde cohérente de SQLite (API de sauvegarde, ou copie après arrêt propre du serveur).

## Vérifications réalisées

`npm test` : 53 tests réussis, aucune erreur (9 comptes, 16 économie, 17 gameplay, 10 réseau, 1 intégration serveur). L’intégration lance le vrai serveur avec une base temporaire, crée un compte, achète un objet, vérifie la sauvegarde et la reconnexion, puis rejette un message invalide. La syntaxe des fichiers JavaScript modifiés a aussi été vérifiée. Aucune partie visuelle en navigateur n’a été effectuée.
