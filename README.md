# ScanSEO

**Audit SEO automatisé, payé à l'acte, livré en PDF.**

Le client paie, donne l'URL de son site, et reçoit un rapport qui dit **ce qui bloque son
référencement et quel texte exact écrire**. Le service ne modifie jamais son site : il
observe, mesure, rédige, et rend un PDF.

![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/docker-alpine-2496ED?logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-WAL-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-proprietary-lightgrey)

---

## L'offre

| Offre | Prix | Contenu |
|---|---|---|
| **Teaser** | 0 € | Score + 3 constats + 1 texte prêt. 1 site / 24 h / IP. |
| **`audit_49`** | 49 € TTC | 25 pages auditées, PDF complet, plan d'action 30 jours, textes prêts à coller. |
| **`audit_149`** | 149 € TTC | 100 pages auditées, plan 90 jours, 2 pages entièrement rédigées. |

Paiement unique, pas d'abonnement. La TVA est collectée par **Polar** (merchant of record).

## Le rapport

Cinq piliers, 66 contrôles, une note par pilier, un score global.

| Pilier | Poids | Exemples de contrôles |
|---|---|---|
| Technique (`T`) | 25 % | HTTPS, redirections, statuts, `robots.txt`, sitemap, canonicals, HSTS |
| On-page (`O`) | 30 % | `<title>`, meta description, `h1`, structure des titres, maillage interne |
| Contenu (`C`) | 20 % | épaisseur de texte, duplication, intention de recherche, ancres |
| Performance (`P`) | 15 % | PageSpeed Insights (mobile), poids, LCP/CLS |
| Local (`L`) / Structuré (`S`) | 10 % | JSON-LD, Google Business Profile, cohérence NAP |

Chaque constat porte trois choses : **la preuve** (URL + extrait), **la gravité**
(bloquant / majeur / mineur) et **le correctif**. Le score est calculé par le code à
partir des notes de pilier — jamais par le modèle.

## Comment ça marche

```
Polar (paiement)
   │  webhook signé
   ▼
web  ── crée la commande + l'audit en file (SQLite)
   │
   ▼
worker ── claim atomique (BEGIN IMMEDIATE)
   1. garde URL anti-SSRF
   2. collecte : crawl 25/100 pages à 1 req/s, UA Googlebot + matrice d'UA (cloaking),
      robots.txt, sitemap, canonicals, JSON-LD, liens internes, PageSpeed
   3. faits + score : 66 contrôles, pénalité par gravité, note par pilier
   4. rédaction : DeepSeek, sortie JSON stricte, validée
   5. PDF : HTML → Chromium printToPDF
   6. livraison : email avec PDF + espace client /audit/<token>
```

Le worker est **idempotent** : si un rapport existe déjà sur disque, il reprend à
l'étape suivante au lieu de refacturer un crawl et un appel modèle. Un audit bloqué
depuis plus de 20 minutes est remis en file au démarrage.

## Architecture

Deux processus, **une seule image** :

| Service | Commande | Rôle |
|---|---|---|
| `web` | `node server.js` | Site public, webhook Polar, teaser, espace client, admin |
| `worker` | `node worker.js` | File d'attente, crawl, analyse, PDF, email — concurrence 1 |

La file d'attente est la table SQLite elle-même (`audits.status`), pas un broker.
`/healthz` expose l'état réel : base, dossiers, version de Chromium, configuration
mail, et `worker_last_seen` (le heartbeat du worker, toutes les 15 s).

**Stack** : Node 22 · Express 4 · better-sqlite3 (WAL) · Zod · undici · Puppeteer-core
(Chromium alpine) · Nodemailer · pdf-lib / pdfjs-dist · marked.

## Démarrage local

Le projet doit tourner sur **Node 22**. Un Node plus récent (26) casse la compilation
native de `better-sqlite3`.

```bash
npm ci
cp .env.example .env        # renseigner les clés
node server.js              # http://localhost:3000
node worker.js              # dans un second terminal
```

Contrôle immédiat :

```bash
curl -s localhost:3000/healthz | jq
```

`worker_last_seen` doit être renseigné — sinon aucun paiement ne sera traité.

### Tests

```bash
npm test                    # tests/l0.test.js + tests/l1.test.js (node --test)
```

Les lots suivants se recettent avec des sondes dédiées, à lancer à la main :
`tests/l2-probe.mjs` (collecte), `l3-probe.mjs` (score), `l4-probe.mjs` (rédaction),
`l5l6-probe.mjs` (PDF + livraison), `e2e-local.mjs` (bout en bout).

Pour recetter un paiement **sans encaisser**, `tools/send-test-webhook.js` forge un
`order.paid` signé (Standard Webhooks).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `PUBLIC_BASE_URL` | URL publique, utilisée dans les emails et les liens client |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_PAID`, `DEEPSEEK_MODEL_FREE` | Rédaction (modèle payant pour les audits, gratuit pour le teaser) |
| `PAGESPEED_API_KEY` | PageSpeed Insights (pilier performance) |
| `POLAR_WEBHOOK_SECRET` | Vérification de la signature des webhooks |
| `POLAR_CHECKOUT_49`, `POLAR_CHECKOUT_149` | Liens de paiement |
| `POLAR_PRODUCT_49`, `POLAR_PRODUCT_149` | Identifiants produits (contrôle du webhook) |
| `SMTP_URL`, `SMTP_FROM`, `CONTACT_EMAIL` | Envoi des rapports et alertes |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Basic Auth de `/admin` (hash bcrypt) |
| `SIGNING_SECRET` | Signature des tokens d'accès client |
| `MAX_PAGES_49`, `MAX_PAGES_149` | Bornes de crawl (25 / 100) |
| `DATA_DIR`, `REPORTS_DIR`, `CONTENT_DIR`, `PORT`, `TZ` | Dossiers et runtime |

## Routes

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/webhook/polar` | Événements Polar signés (`order.paid`, `order.refunded`) |
| `GET` | `/` | Accueil |
| `GET` | `/tarifs` `/faq` `/exemple` `/cgv` `/confidentialite` `/mentions-legales` | Pages publiques |
| `GET` | `/checkout/:offer` | Redirection vers le checkout Polar |
| `POST` | `/api/scan` | Teaser gratuit (1 site / 24 h / IP) |
| `GET` | `/api/scan/:id` | État du teaser |
| `GET` | `/audit/merci` | Confirmation de commande |
| `GET` | `/audit/:token` | Espace client |
| `POST` | `/audit/:token/brief` | Brief complémentaire |
| `GET` | `/audit/:token/rapport.pdf` | Rapport PDF |
| `GET` | `/blog` `/blog/:slug` | Blog (6 articles) |
| `*` | `/admin/*` | Administration (Basic Auth) |
| `GET` | `/healthz` | Santé complète |
| `GET` | `/robots.txt` `/sitemap.xml` | SEO du site |

## Données

SQLite en WAL, dix tables : `orders`, `audits`, `pages`, `findings`, `events`,
`emails`, `teasers`, `leads`, `rate_limits`, `system_kv`.

- `events` porte l'identifiant des webhooks déjà traités → **idempotence**.
- `rate_limits` borne le teaser par IP.
- `system_kv` porte le heartbeat du worker et l'état système.
- Les rapports (faits, JSON, PDF) vivent sur disque, un dossier par audit :
  `REPORTS_DIR/<AAAA-MM-JJ>_<id>`.

## Sécurité

- **Anti-SSRF à chaque hop** : schémas et plages privées refusés, y compris au `lookup`
  de connexion et pour les sous-ressources chargées par Chromium.
- **Webhook** : signature Standard Webhooks vérifiée sur le corps brut ; signature
  invalide → `401`, jamais un audit créé.
- **Espace client** : accès par token signé, pas par identifiant devinable.
- **Admin** : Basic Auth avec hash bcrypt, aucune route d'administration publique.
- **Aucun secret dans le dépôt** : `.env` est ignoré, seul `.env.example` est versionné.

## Déploiement

### Docker

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f

# mise à jour
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d

# retour arrière
docker compose -f docker-compose.prod.yml down
docker run -d --name scanseo-web ghcr.io/<compte>/scanseo:sha-<précédent>
```

Chaque push sur `main` construit et publie l'image sur GHCR
(`ghcr.io/<compte>/scanseo:latest` et `:sha-<court>`), et sur Docker Hub si les secrets
`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` sont présents.

### Hébergement

Le conteneur tourne en **uid/gid 568** et attend trois volumes persistants :

| Volume | Contenu |
|---|---|
| `/data` | base SQLite |
| `/reports` | rapports générés (JSON, PDF) |
| `/content` | contenu éditorial, surchargeable sans reconstruire l'image |

Le service `worker` n'a besoin que des deux premiers. Prévoir 1 Go de RAM pour le web
et 1,5 Go pour le worker (Chromium), avec `shm_size: 256m` pour ce dernier.

## Ce que le produit ne fait pas

- **Aucun chiffre non mesuré.** Positions Google, volumes de recherche, backlinks et
  indexation ne sont pas inventés : le rapport renvoie aux trois clics Search Console.
  Un nombre produit par le modèle mais absent des faits est supprimé par le code.
- **Pas de promesse de conformité automatique.** Le score mesure ce qui est
  techniquement observable ; le jugement éditorial reste humain.
- **Pas de prestation d'implémentation.** Le rapport se termine par une phrase, sans
  tarif ni bouton.
- **Pas de crawl agressif.** 1 requête par seconde, nombre de pages borné par l'offre.

## Structure

```
server.js              site public, webhook, routes, healthz
worker.js              boucle de file d'attente, heartbeat, reprise après crash
src/
  crawl.js             collecte (crawl, robots, sitemap, UA, JSON-LD)
  checks.js            les 66 contrôles + calcul du score
  analyze.js           appel DeepSeek, validation JSON stricte
  render.js            HTML → PDF via Chromium
  pipeline.js          orchestration idempotente d'un audit
  urlguard.js          anti-SSRF
  db.js  mail.js  config.js  ratelimit.js  token.js  webhook.js
  routes/              scan.js, audit.js, admin.js
  views/               layout, client, admin
  templates/           gabarits de rapport, CSS, polices embarquées
  embedded_content/    pages du site et articles du blog (Markdown)
docs/                  spécification produit et contrats
tests/                 tests unitaires + sondes de recette
tools/                 forge de webhook de test
```
