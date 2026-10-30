# Message à coller à Antigravity

> Tu construis le service **ScanSEO** (audit SEO automatisé payant). Tout est spécifié dans les fichiers Markdown joints — ils sont la seule source de vérité, il n'y a rien d'autre à deviner.
>
> **Contexte** : dépôt GitHub privé `hollow313/scanseo` (vide, tu fais le premier commit), image Docker `ghcr.io/hollow313/scanseo:latest`, déploiement sur TrueNAS (dataset `NVMe/Applications`, chemins `/mnt/NVMe/Applications/scanseo/...`), reverse proxy Nginx Proxy Manager sur `scanseo.fr`.
>
> **Deux exigences d'infrastructure non négociables** : image **Linux Alpine**, exécution en **uid/gid 568**, avec **bind mounts** pour `/data` (SQLite + logs), `/reports` (PDF par audit) et `/content` (contenu éditable du site : blog, pages, images, surcharges d'admin — du contenu, jamais du code).
>
> **Port applicatif : 30023** (3000 dans le conteneur), publié sur `192.168.1.200:30023` uniquement. NPM route `scanseo.fr` → `192.168.1.200:30023`. L'instance de dev utilise 30024 sur `127.0.0.1`.
>
> **Tu ne dépends d'aucun agent** : pas de Hermes, pas de gateway. Le seul appel sortant « intelligent » est l'API DeepSeek (`https://api.deepseek.com/chat/completions`). Le reste est du code : crawl, contrôles, score déterministe, PDF via Chromium headless, email SMTP.
>
> **Ordre de lecture** : `README.md`, puis `01` à `07` dans l'ordre.
>
> **Méthode** : tu travailles **un lot à la fois**, dans l'ordre de `06-lots-et-recette.md` (L0 → L7). À la fin de chaque lot, tu t'arrêtes et tu colles les sorties réelles des critères numérotés (commandes + résultats), le hash du commit, et `OK`/`NON` par critère. Tu n'enchaînes pas deux lots sans validation.
>
> **Interdits absolus** : ceux de `07-interdits.md`. En particulier — ne jamais binder de dossier sur `/app`, ne jamais fetcher une URL sans le garde SSRF, ne jamais laisser le LLM calculer le score, ne jamais répondre `500` sur un cas métier Polar, ne jamais annoncer un email envoyé s'il a échoué.
>
> Commence par **L0 uniquement** (socle : Dockerfile multi-stage Alpine uid 568, entrypoint de pré-vol, compose dev + prod, CI GHCR, `/healthz`), et arrête-toi là.
