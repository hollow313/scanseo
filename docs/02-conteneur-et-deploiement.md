# 02 — Conteneur et déploiement

Contraintes imposées : **image Linux Alpine**, exécution en **uid/gid 568**, **bind mounts** pour les rapports et pour les éléments d'admin, déploiement sur TrueNAS derrière Nginx Proxy Manager.

## 1. Vue d'ensemble

- **Une seule image** : `ghcr.io/hollow313/scanseo:latest`
- **Deux services** lancés depuis cette image : `web` (Express + rendu HTML) et `worker` (file d'attente, crawl, analyse, PDF)
- **Un volume de données** (`/data` : SQLite, logs) et **un volume de rapports** (`/reports` : PDF + JSON par audit) — les deux bind-montés côté hôte
- Aucune base externe, aucun Redis : la file d'attente est une table SQLite avec verrou `BEGIN IMMEDIATE`

## 2. Dockerfile (à reproduire tel quel, multi-stage)

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

########## étape 1 : dépendances compilées (better-sqlite3 sur musl)
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache build-base python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

########## étape 2 : image finale
FROM node:${NODE_VERSION}-alpine AS runtime

RUN apk add --no-cache \
      chromium nss freetype harfbuzz ca-certificates tzdata curl \
      font-noto ttf-dejavu \
 && addgroup -g 568 apps \
 && adduser -D -u 568 -G apps -h /app -s /sbin/nologin apps

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Europe/Paris \
    DATA_DIR=/data \
    REPORTS_DIR=/reports \
    CONTENT_DIR=/content

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=568:568 . .
RUN mkdir -p /data /reports /content && chown -R 568:568 /data /reports /content /app

USER 568:568
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz >/dev/null || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
```

Notes d'implémentation :

- **Chromium** : paquet Alpine. Le chemin du binaire **varie** (`/usr/bin/chromium-browser` ou `/usr/bin/chromium`). Ne jamais le coder en dur dans le code applicatif : résoudre au démarrage dans cet ordre, et exposer le résultat dans `/healthz` (`chromium_version`). Variable `CHROMIUM_PATH` prioritaire si définie.
- **Polices** : si `font-noto` n'existe pas dans le dépôt Alpine utilisé, prendre `ttf-dejavu ttf-liberation` et le consigner. Critère : `fc-list | grep -ci noto` (ou `dejavu`) ≥ 1, et le PDF doit afficher correctement `é à ç œ € — «  »`.
- `npm ci` doit passer sur musl : `better-sqlite3` est compilé dans l'étape `deps` (build-base + python3 présents). Si la version de `better-sqlite3` ne compile pas, épingler une version qui le fait — ne pas remplacer par un module non testé.

## 3. `entrypoint.sh` — contrôle de pré-vol obligatoire

Le conteneur tourne en 568 : si les dossiers bind-montés appartiennent à root, l'application échoue à la première écriture, souvent après le paiement du client. Le pré-vol doit refuser de démarrer avec un message explicite.

```sh
#!/bin/sh
set -eu
fail() { echo "FATAL: $1" >&2; exit 1; }

for d in "${DATA_DIR:-/data}" "${REPORTS_DIR:-/reports}"; do
  mkdir -p "$d" 2>/dev/null || true
  probe="$d/.write-probe.$$"
  printf 'ok' > "$probe" 2>/dev/null || fail "dossier $d non inscriptible par uid $(id -u). Corriger côté hôte : chown -R 568:568 <chemin hôte>"
  rm -f "$probe"
done

echo "[entrypoint] uid=$(id -u) gid=$(id -g) data=$(realpath "${DATA_DIR:-/data}") reports=$(realpath "${REPORTS_DIR:-/reports}")"
if [ -d "${CONTENT_DIR:-/content}" ]; then
  echo "[entrypoint] content=$(ls -1 "${CONTENT_DIR:-/content}" 2>/dev/null | tr '\n' ' ')"
fi

# binaire chromium résolu une fois pour toutes
for c in "${CHROMIUM_PATH:-}" /usr/bin/chromium-browser /usr/bin/chromium /usr/lib/chromium/chrome; do
  [ -n "$c" ] && [ -x "$c" ] && { export CHROMIUM_PATH="$c"; "$c" --version 2>/dev/null || true; break; }
done
[ -n "${CHROMIUM_PATH:-}" ] || echo "[entrypoint] AVERTISSEMENT: aucun binaire chromium trouvé, le rendu PDF échouera"

exec "$@"
```

`chmod +x entrypoint.sh` dans le Dockerfile (ou `RUN chmod 755`).

## 4. Volumes et chemins

| Montage conteneur | Chemin hôte (exemple TrueNAS) | Contenu | Droits |
|---|---|---|---|
| `/data` | `/mnt/NVMe/Applications/scanseo/data` | `scanseo.db` + `-wal`/`-shm`, `logs/`, `tmp/` | **rw**, 568:568 |
| `/reports` | `/mnt/NVMe/Applications/scanseo/reports` | `<audit_id>/rapport.pdf`, `faits.json`, `rapport.json`, `rapport.html` | **rw**, 568:568 |
| `/content` | `/mnt/NVMe/Applications/scanseo/content` | **le contenu éditable du site** : blog, pages légales, images, surcharges d'admin | **rw**, 568:568 |

### 4.1 Le dossier du site — `/content` (modifiable sans rebuild)

C'est le dossier que le propriétaire ouvre et modifie : **du contenu, jamais du code**.

```
/mnt/NVMe/Applications/scanseo/content/
├── blog/      2026-11-prix-audit-seo.md …   Markdown + front-matter (title, description, date)
├── pages/     tarifs.md  faq.md  mentions-legales.md  cgv.md  confidentialite.md   (surcharge des pages)
├── images/    hero.webp  exemple-rapport-1.webp …     servis sur /assets/img/<nom>
└── admin/     logo.svg  admin.css                      surcharges visuelles du back-office
```

- Le serveur lit ce dossier **à chaque requête** (cache `mtime` de 5 s) : aucune modification ne demande de redémarrage. Fichier absent, dossier vide ou montage absent → **les valeurs embarquées dans l'image sont servies**. Jamais d'écran blanc, jamais d'erreur.
- Les images sont servies sur `/assets/img/<nom>` ; extensions autorisées `.webp .jpg .jpeg .png .svg .ico` uniquement (toute autre extension est refusée — jamais d'exécution depuis ce dossier).
- **Interdit** d'y déposer du code serveur (`.js`, `.mjs`, gabarit HTML exécutable) : ce dossier est du contenu, il n'est jamais interprété.
- **Interdit de binder un dossier hôte sur `/app` ou `/app/public`.** C'est le geste qui casse tout au premier `pull` : l'image écrase la config ou l'inverse, et un dossier hôte vide masque les assets embarqués (écran blanc, sans erreur).

### 4.2 Le code du site — comment y accéder

Le code n'est **pas** bind-monté : il voyage dans l'image publiée par la CI. Trois accès légitimes, dans cet ordre :

1. **Le dépôt** — `git clone https://github.com/hollow313/scanseo.git /mnt/NVMe/Applications/scanseo/repo`. Source de vérité : on modifie, on pousse, la CI reconstruit.
2. **Une instance de dev sur le NAS** — depuis ce clone, `docker compose -f docker-compose.yml up -d --build --scale worker=0` sur le **port 30024** (ne pas toucher au 30023 de la prod), pour voir le rendu avant de pousser.
3. **La lecture à chaud en production** — `docker exec -it scanseo-web sh` ou `docker cp scanseo-web:/app/src/views .`. Lecture seule : toute modification est perdue au `pull` suivant.

Accès depuis le poste : partage **SMB** du dataset `NVMe/Applications` (ou l'onglet *Files* de TrueNAS), dossier `content/`. C'est aussi par là que le blog se met à jour — pas de CMS, pas de base à maintenir, pas de surface d'attaque supplémentaire.

### 4.3 Rapports

- Structure : `/reports/2026-11-02_a1b2c3d4/rapport.pdf`. Un dossier par audit (`audit_id` = 8 premiers caractères de l'UUID).
- **Rétention** : le worker supprime les dossiers de plus de 12 mois (tâche quotidienne) et la ligne en base passe en `expired`. Un refus de suppression est logué, jamais silencieux.
- Le PDF reste **régénérable** : `faits.json` (la collecte) et `rapport.json` (la sortie LLM validée) restent dans le dossier. Sans eux, un client qui réclame son rapport dans 6 mois est irrécupérable.

## 5. `docker-compose.yml` (développement / build local)

```yaml
services:
  web:
    build: .
    image: scanseo:dev
    env_file: .env
    ports: ["127.0.0.1:30024:3000"]
    volumes:
      - ./var/data:/data
      - ./var/reports:/reports
      - ./var/content:/content

  worker:
    image: scanseo:dev
    env_file: .env
    command: ["node", "worker.js"]
    depends_on: [web]
    volumes:
      - ./var/data:/data
      - ./var/reports:/reports
      - ./var/content:/content
```

## 6. `docker-compose.prod.yml` (TrueNAS — aucune compilation)

```yaml
services:
  web:
    image: ghcr.io/hollow313/scanseo:latest
    container_name: scanseo-web
    restart: unless-stopped
    env_file: /mnt/NVMe/Applications/scanseo/.env
    ports: ["192.168.1.200:30023:3000"]
    volumes:
      - /mnt/NVMe/Applications/scanseo/data:/data
      - /mnt/NVMe/Applications/scanseo/reports:/reports
      - /mnt/NVMe/Applications/scanseo/content:/content
    mem_limit: 1g

  worker:
    image: ghcr.io/hollow313/scanseo:latest
    container_name: scanseo-worker
    restart: unless-stopped
    command: ["node", "worker.js"]
    env_file: /mnt/NVMe/Applications/scanseo/.env
    volumes:
      - /mnt/NVMe/Applications/scanseo/data:/data
      - /mnt/NVMe/Applications/scanseo/reports:/reports
    mem_limit: 1500m
    shm_size: 256m
```

- `restart: unless-stopped` obligatoire : un worker mort ne traite plus rien et le client ne reçoit jamais son audit.
- `shm_size` évite les crashs Chromium (`/dev/shm` trop petit dans Docker).
- Le port est publié **sur l'IP LAN uniquement** (`192.168.1.200:30023`), pour que NPM puisse joindre le conteneur : c'est volontaire et sans risque tant que rien ne le redirige depuis la box. Publier sur `0.0.0.0` exposerait le service sur toute interface que le NAS viendra à porter (VPN, second VLAN, Docker bridge) sans que personne ne le remarque.
- **Conséquence directe** : NPM n'est plus dans le chemin quand on tape `IP:30023`. Le service doit donc se protéger **par lui-même** — Basic Auth bcrypt + 5 tentatives/min sur `/admin`, vérification de signature sur `/webhook/polar`, jetons signés sur `/audit/<token>`, aucun bypass par en-tête. Aucune règle de proxy ne doit être considérée comme une protection.
- Un seul `worker` (concurrence 1) : c'est volontaire, un crawl à 1 req/s par site suffit et évite de se faire bloquer.

## 7. Variables d'environnement

Fichier `.env` côté hôte, jamais commité. Le service **refuse de démarrer** si une variable marquée *requise* manque, avec la liste des manquantes.

| Variable | Requis | Exemple / défaut | Rôle |
|---|---|---|---|
| `PUBLIC_BASE_URL` | oui | `https://scanseo.fr` | liens dans les emails, URLs canoniques |
| `DEEPSEEK_API_KEY` | oui | `sk-…` | clé **dédiée** au service |
| `DEEPSEEK_MODEL_PAID` | non | `deepseek-v4-pro` | rédaction du rapport payant |
| `DEEPSEEK_MODEL_FREE` | non | `deepseek-flash` | teaser gratuit |
| `PAGESPEED_API_KEY` | oui | `AIza…` | PageSpeed Insights v5 |
| `POLAR_WEBHOOK_SECRET` | oui | `whsec_…` | **secret du webhook de ce service**, pas celui de l'autre projet |
| `POLAR_PRODUCT_49` | oui | `uuid` | identifiant produit Polar → offre Audit SEO |
| `POLAR_PRODUCT_149` | oui | `uuid` | identifiant produit Polar → offre Audit Complet |
| `SMTP_URL` | oui | `smtps://user%40scanseo.fr:motdepasse@smtp.mail.ovh.net:465` | envoi des emails |
| `SMTP_FROM` | oui | `ScanSEO <contact@scanseo.fr>` | expéditeur |
| `CONTACT_EMAIL` | oui | `contact@scanseo.fr` | pied de page, réponses |
| `ADMIN_USER` | oui | `loic` | Basic Auth admin |
| `ADMIN_PASSWORD_HASH` | oui | `$2b$12$…` | bcrypt, jamais le mot de passe en clair |
| `SIGNING_SECRET` | oui | `openssl rand -hex 32` | jetons des liens `/audit/<token>` |
| `MAX_PAGES_49` | non | `25` | limite de crawl offre 49 € |
| `MAX_PAGES_149` | non | `100` | limite de crawl offre 149 € |
| `TZ` | non | `Europe/Paris` | dates des rapports |

## 8. `/healthz`

Retourne `200` uniquement si : process vivant, DB accessible (`SELECT 1`), dossier `/reports` inscriptible, `/content` lisible (ou montage absent), `SMTP_URL` configurée. Sinon `503` avec le détail. JSON :

```json
{"ok":true,"version":"0.1.0","db":true,"reports":true,"content":true,"mail":"configured",
 "chromium_version":"142.0.7444.59","worker_last_seen":"2026-11-02T09:14:03Z","queue":{"pending":0,"running":0,"failed":0}}
```

`mail` distingue `configured` (présence des variables) de `ok` (dernier envoi réussi < 24 h) et `failing` (dernier envoi en erreur) — une variable présente ne prouve pas qu'on peut envoyer.

## 9. CI — publication de l'image

`.github/workflows/docker-publish.yml` : sur push `main` → build multi-stage → push `ghcr.io/hollow313/scanseo:latest` + `:sha-<court>`. Package **public** (sinon TrueNAS doit s'authentifier sur le registre, à éviter). Tags d'action épinglés.

Déploiement sur le NAS = `docker compose -f docker-compose.prod.yml pull && up -d`. **Un correctif commité n'est pas un correctif actif** : toujours revérifier le comportement du service après `pull`.

## 10. Sauvegarde et ressources

- `/data` et `/reports` entrent dans la sauvegarde hebdomadaire existante du NAS. **La base SQLite doit être copiée avec `.backup`** (ou après `PRAGMA wal_checkpoint(TRUNCATE)`), pas par `cp` à chaud.
- Budget : 1 vCPU, 1,5 Go de RAM pour le worker (Chromium ~400 Mo pendant le rendu), 1 Go pour le web. Disque : ~1,5 Go pour l'image, ~2 Mo par rapport.
- Logs : JSON sur stdout (collectés par Docker), plus un fichier rotatif `/data/logs/app.log` (10 Mo × 3). **Jamais de clé API, de token ni d'email complet dans les logs.**
