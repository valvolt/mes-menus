# Mes Menus

Application simple mobile-first pour gérer les menus (pour des utilisateurs francophones).
Deux modes : `client` et `cuisinier`.

Ce dépôt contient :
- Backend Node.js + Express (API & static files)
- Base de données SQLite embarquée
- Frontend minimal (HTML/JS/CSS) optimisé mobile-first
- Dockerfile + docker-compose pour exécution en conteneur

Fonctionnalités principales (MVP)
- Mode client
  - Page "aujourd'hui" affichant Déjeuner (haut) / Dîner (bas)
  - Notation 1..5 étoiles (modifiable pour aujourd'hui et jours futurs)
  - Navigation vers jours précédents / suivants (notes des jours passés non modifiables)
- Mode cuisinier
  - Liste alphabétique des menus, tris disponibles : alphabétique, par fréquence, par note moyenne
  - Vue "planning" jour → aujourd'hui +7 jours (assignation déjeuner/dîner)
  - Création de nouveaux menus
  - Création d'utilisateurs clients (par le cuisinier) via API (UI simple à venir)

Installation et exécution (docker)
1. Copier / éditer le fichier `.env` (ex. fourni dans le repo) pour définir :
   - ADMIN_USERNAME (ex: `cuisinier`)
   - ADMIN_PASSWORD (ex: `changeme`)
   - SESSION_SECRET (chaîne longue aléatoire)
   - PORT (ex: `8080`)
   - DB_PATH (par défaut `/data/mes-menus.sqlite`)
   - (Optionnel) CLIENT_USERNAME / CLIENT_PASSWORD pour créer un client par défaut

2. Démarrer avec Docker Compose :
   docker-compose up -d

3. Accéder à l'application :
   http://localhost:8080

Démarrage en développement (sans Docker)
1. Installer les dépendances :
   npm install

2. Lancer le serveur en mode développement :
   npm run dev

API essentielles
- POST /api/login                { username, password } → crée session
- POST /api/logout
- GET  /api/me                   → info utilisateur courant (session)
- POST /api/users                (cuisinier) créer client { username, password }
- POST /api/menus                (cuisinier) créer menu { name }
- GET  /api/menus?sort=alpha|frequency|rating  (cuisinier) liste avec stats
- POST /api/assignments         (cuisinier) assigner menu à { menu_id, date, meal }
- GET  /api/day/:YYYY-MM-DD     voir déjeuner/dîner pour la date
- GET  /api/today               redirection vers /api/day/today
- POST /api/ratings             créer / mettre à jour note { assignment_id, score }
- GET  /api/upcoming?days=7     planning à venir (cuisinier)

Compte par défaut et provisoire
- Le compte cuisinier est créé automatiquement à la première exécution si absent, à partir des variables d'environnement `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
- Vous pouvez également définir `CLIENT_USERNAME` / `CLIENT_PASSWORD` dans `.env` pour provisionner un client de test.

Création d'un client (par le cuisinier)
- Via l'API : après connexion en tant que cuisinier, appeler POST /api/users avec JSON { username, password }.
- (Option) Le cuisinier pourra bientôt créer des clients depuis l'interface cuisinier.

Sécurité / production
- Définir une valeur forte pour `SESSION_SECRET` et ne pas la committer.
- En production, utiliser HTTPS et activer cookie.secure dans la configuration de session.
- Pour un déploiement multi‑instance, remplacer le stockage de session SQLite par Redis ou une solution partagée.

Structure du projet (raccourci)
- server/index.js       — backend Express et initialisation SQLite
- web/index.html        — frontend minimal
- web/app.js            — logique frontend (client + cuisinier)
- web/style.css         — styles (mobile-first)
- Dockerfile
- docker-compose.yml
- .env                  — configuration (ne pas committer)
- .gitignore

Notes sur le layout planning (mobile)
- Les vignettes du planning du cuisinier utilisent un grid responsive : elles s'adaptent à la largeur de l'écran. Sur téléphone les vignettes qui seraient "à droite" passent automatiquement en dessous pour rester lisibles.

Souhaitez-vous que :
- J'ajoute un formulaire d'UI pour que le cuisinier crée des clients directement depuis le navigateur ? (recommandé)
- J'ajoute des tests de fumée / script de vérification et CI ?
- J'améliore le design / accessibilité (focus trap pour modal de login, ESC pour fermer, toasts) ?