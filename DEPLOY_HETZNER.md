Déploiement de "mes-menus" sur un serveur Hetzner (guide pas-à-pas, français)

Résumé
- Option minimale : lancer le conteneur Docker Compose sur une VM Hetzner (rapide).
- Option production : ajouter reverse-proxy HTTPS (Caddy/Traefik), firewall, sauvegardes DB et monitoring.
Ce guide montre une installation simple et reproductible (Ubuntu 22.04).

Prérequis
- Un compte Hetzner et une clé SSH ajoutée à votre compte (ou au moins votre clé publique copiée sur la VM).
- Le repo git est disponible (ex: git@github.com:valvolt/mes-menus.git).
- Vous avez accès SSH à la VM.

1) Créer la VM (méthode manuelle)
- Dans l'interface Hetzner Cloud, créez un serveur (type recommandé : cx11/cx21 selon charge).
- Image : Ubuntu 22.04 LTS.
- Ajoutez votre clé SSH pour l'accès.
- Notez l'IP publique.

(Option CLI) avec hcloud (si installé):
  hcloud server create --name mes-menus --type cx21 --image ubuntu-22.04 --ssh-key "<NOM_DE_LA_CLE>"

2) Connexion SSH
  ssh root@<IP_SERVEUR>

3) Préparer l'OS
  # mettre à jour
  sudo apt update && sudo apt upgrade -y

  # installer utilitaires
  sudo apt install -y curl git

4) Installer Docker et Docker Compose (plugin)
  # installation Docker par script officiel
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh

  # installer le plugin docker compose (si pas présent)
  sudo apt install -y docker-compose-plugin

  # vérifier
  sudo docker version
  docker compose version

5) Créer un utilisateur non-root (optionnel mais recommandé)
  adduser mesmenus
  usermod -aG docker mesmenus
  # puis se reconnecter en tant que cet utilisateur ou utiliser sudo

6) Récupérer le code
  # en tant qu'utilisateur ayant accès SSH/Git
  git clone git@github.com:valvolt/mes-menus.git
  cd mes-menus

7) Configuration .env
- Copiez le .env d'exemple (nous avons un .env dans le repo, mais ne commettez pas votre secret).
- Éditez .env : ADMIN_PASSWORD, SESSION_SECRET (générer avec openssl rand -hex 32) et CLIENT_PASSWORD si souhaité.

  cp .env .env.local
  # éditer .env.local
  nano .env.local
  # ou
  openssl rand -hex 32

- Assurez-vous que docker-compose utilise ce .env (docker compose lit par défaut .env à la racine). Vous pouvez renommer .env.local -> .env mais gardez-le hors du repo.

8) Préparer le volume pour SQLite
  mkdir -p ./data
  chown -R $(whoami):$(whoami) ./data

9) Lancer l'application avec Docker Compose
  # si vous avez le fichier docker-compose.yml prêt
  docker compose up -d --build

  # vérifier les services
  docker compose ps
  docker compose logs -f

10) Reverse proxy & HTTPS (recommandé)
- Pour production, utilisez Caddy (très simple) ou Traefik pour gérer TLS automatiquement.

Exemple simple avec Caddy (méthode rapide)
- Installer Caddy system-wide ou lancer en container.
- Exemple docker-compose (schématique) — on peut ajouter un service caddy qui reverse-proxye l'app (sur le port interne 8080).

Exemple Caddyfile minimal (si vous installez Caddy séparément):
  yourdomain.example {
    reverse_proxy 127.0.0.1:8080
  }

- Si vous préférez utiliser Caddy en container, adaptez docker-compose pour inclure Caddy et un réseau docker.

11) Firewall (UFW)
  sudo apt install -y ufw
  sudo ufw allow OpenSSH
  sudo ufw allow http
  sudo ufw allow https
  sudo ufw enable

12) Superviser et maintenir
- Backup de la DB SQLite : sauvegarder ./data/mes-menus.sqlite régulièrement.
  Exemple cron (dump quotidien) :
    0 3 * * * cp /path/to/mes-menus/data/mes-menus.sqlite /backup/mes-menus-$(date +\%F).sqlite

- Logs : docker compose logs -f
- Redémarrage automatique : docker compose restart / systemd service wrapper si besoin.

13) Remarques et options améliorées
- Utiliser un stockage géré ou Postgres si vous anticipez montée en charge.
- Mettre sessions dans Redis pour scalabilité.
- Utiliser certbot / Traefik / Caddy pour TLS automatiquement.
- Déployer via CI (GitHub Actions) : push → build image → push to registry → SSH deploy or use Hetzner Kubernetes.

14) Déploiement automatisé (exemples rapides)
- Simple script deploy.sh (sur le serveur) qui fait:
  git pull origin main
  docker compose pull
  docker compose up -d --build

15) Exemple de commandes rapides (récap)
  # sur votre machine locale (déjà pushé sur GitHub)
  ssh root@<IP>
  cd /home/mesmenus/mes-menus
  git pull origin main
  cp .env.example .env   # ou éditer .env
  docker compose up -d --build

Conseils de sécurité
- Ne stockez pas SESSION_SECRET dans le repo.
- Désactivez les accès root SSH (use-based auth + user non-root).
- Activez fail2ban si besoin.
- Sauvegardez régulièrement le fichier SQLite et/ou migrez vers Postgres.

Si vous voulez, je peux :
- Générer un playbook Ansible / script shell (cloud-init) pour provisionner la VM et déployer automatiquement.
- Ajouter un modèle docker-compose.production.yml incluant Caddy ou Traefik.
- Créer un workflow GitHub Actions pour build et déploy (via SSH) sur Hetzner.

Dites quelle automatisation vous intéresse et je l'implémente.