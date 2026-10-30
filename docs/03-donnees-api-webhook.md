# 03 — Données, API, webhook, emails

## 1. Modèle de données (SQLite, WAL)

`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`

```sql
CREATE TABLE orders (
  id             TEXT PRIMARY KEY,          -- uuid
  provider       TEXT NOT NULL DEFAULT 'polar',
  provider_ref   TEXT NOT NULL UNIQUE,      -- data.id de l'événement Polar
  product_id     TEXT NOT NULL,
  offer          TEXT NOT NULL,             -- 'audit_49' | 'audit_149'
  amount         INTEGER NOT NULL,          -- centimes
  currency       TEXT NOT NULL DEFAULT 'eur',
  email          TEXT,
  site_url       TEXT,                      -- custom field 'site', normalisé
  status         TEXT NOT NULL,             -- 'paid' | 'refunded' | 'needs_site'
  raw_json       TEXT NOT NULL,             -- payload complet (tronqué à 64 Ko)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE audits (
  id             TEXT PRIMARY KEY,
  order_id       TEXT REFERENCES orders(id),
  token          TEXT UNIQUE NOT NULL,      -- lien espace client
  url            TEXT NOT NULL,
  host           TEXT NOT NULL,
  offer          TEXT NOT NULL,
  lang           TEXT NOT NULL DEFAULT 'fr',
  activity       TEXT,
  city           TEXT,
  competitors    TEXT,                      -- JSON array ≤ 3
  status         TEXT NOT NULL,             -- voir §2
  attempts       INTEGER NOT NULL DEFAULT 0,
  claimed_at     TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  error          TEXT,
  pages_crawled  INTEGER,
  score          INTEGER,
  score_detail   TEXT,                      -- JSON par pilier
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  cost_usd       REAL,
  duration_ms    INTEGER,
  pdf_path       TEXT,
  needs_brief_at TEXT,                      -- date d'envoi du 1er rappel
  created_at     TEXT NOT NULL
);

CREATE TABLE pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id       TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  depth          INTEGER,
  http_status    INTEGER,
  final_url      TEXT,
  title          TEXT,
  meta_desc      TEXT,
  h1             TEXT,
  h1_count       INTEGER,
  word_count     INTEGER,
  canonical      TEXT,
  robots_meta    TEXT,
  jsonld_types   TEXT,                      -- CSV
  ttfb_ms        INTEGER,
  bytes          INTEGER,
  internal_links INTEGER,
  images_total   INTEGER,
  images_no_alt  INTEGER,
  facts          TEXT                       -- JSON complet de la page
);

CREATE TABLE findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id       TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,             -- 'O02' — doit exister au catalogue (§4 du 04)
  pillar         TEXT NOT NULL,
  severity       TEXT NOT NULL,             -- 'bloquant'|'critique'|'majeur'|'mineur'|'informatif'
  page_url       TEXT,
  evidence       TEXT,                      -- phrase factuelle issue de la collecte
  recommendation TEXT,
  fix_payload    TEXT,                      -- JSON {title, meta, h1, h2[]} quand applicable
  deterministic  INTEGER NOT NULL DEFAULT 1 -- 1 = détecté par le code, 0 = rédigé par le LLM
);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL,
  webhook_id     TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  status         TEXT NOT NULL,             -- 'received'|'processed'|'failed'|'ignored'
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  received_at    TEXT NOT NULL,
  processed_at   TEXT
);

CREATE TABLE emails (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id       TEXT REFERENCES audits(id),
  to_addr        TEXT NOT NULL,
  kind           TEXT NOT NULL,             -- brief|delivery|late|refund|admin_alert|teaser
  status         TEXT NOT NULL,             -- 'queued'|'sent'|'failed'
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  sent_at        TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE teasers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  url            TEXT NOT NULL,
  host           TEXT NOT NULL,
  email          TEXT,
  ip_hash        TEXT NOT NULL,
  score          INTEGER,
  result_json    TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE leads (                          -- emails capturés, jamais utilisés pour du démarchage
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT UNIQUE NOT NULL,
  source         TEXT,
  consent_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key            TEXT PRIMARY KEY,           -- 'scan:<ip_hash>'
  window_start   TEXT NOT NULL,
  count          INTEGER NOT NULL
);
```

Index : `audits(status, created_at)`, `findings(audit_id, pillar)`, `events(webhook_id)`, `teasers(host, created_at)`.

## 2. Machine d'état d'un audit

```
pending  ──brief reçu──────────────► queued
pending  ──48 h sans brief──────────► queued (valeurs par défaut)
queued   ──claim worker────────────► running
running  ──collecte+LLM+PDF OK─────► done
running  ──erreur, attempts < 3────► queued (backoff 2/10/30 min)
running  ──erreur, attempts = 3────► failed  + alerte admin
running  ──order.refunded──────────► refunded (arrêt, aucun email)
done     ──12 mois─────────────────► expired (dossier supprimé)
```

Règles : un audit `running` sans heartbeat depuis 20 min est remis en `queued` par le worker au démarrage (crash). `failed` est rejouable depuis l'admin (`attempts` remis à 0). Aucune transition ne se fait sans écriture d'un événement en base.

## 3. Webhook Polar

`POST /webhook/polar` — **endpoint et secret distincts de l'autre projet**. Ne jamais réutiliser le handler existant.

### 3.1 Vérification de signature (Standard Webhooks — Polar)

Polar n'utilise **pas** `HMAC(corps)`. Contenu signé :

```
{webhook-id}.{webhook-timestamp}.{corps brut}
```

- clé HMAC = `POLAR_WEBHOOK_SECRET` **sans le préfixe `whsec_`**, puis **décodé en base64**
- en-tête `webhook-signature` : `v1,<base64>` (comparaison à temps constant sur le décodage)
- fenêtre : rejeter si `|now - timestamp| > 300 s`
- en-têtes manquants, secret absent → `401` avec message **générique** (ne jamais dire si le secret est configuré ou non)

Le corps doit être lu **brut** (middleware `express.raw({type:'*/*'})` sur cette route uniquement) avant tout parsing JSON.

### 3.2 Traitement

| Événement | Action |
|---|---|
| `order.paid` | insérer `events` (idempotence par `webhook-id`), puis `orders` + `audits` en `pending`, envoyer l'email `brief` |
| `order.refunded` | `orders.status='refunded'`, audit → `refunded`, arrêter le job, **aucun email** |
| `subscription.*` | `ignored` (le service ne vend pas d'abonnement) |
| autre | `ignored` |

- Mapping `product_id → offer` par les variables `POLAR_PRODUCT_49` / `POLAR_PRODUCT_149`. **Produit inconnu : ne pas inventer** — événement `failed`, alerte admin, réponse `200` (Polar ne doit pas boucler), et l'admin peut créer l'audit à la main.
- `data.custom_field_data.site` : URL du site. Normalisation (`https://` ajouté, minuscules sur l'hôte, `www.` retiré pour la clé d'unicité, query conservée). **Absent → `orders.status='needs_site'` + réponse `200` + email au client « indiquez l'URL de votre site » + alerte admin.** Jamais `500`.
- `data.customer.email` (imbriqué — pas `data.customer_email`, c'est le défaut déjà rencontré ailleurs).
- Idempotence par statut, **pas par booléen** : marquer `processed` seulement après succès ; un rejeu du même `webhook-id` renvoie `200 already_processed` sans recréer d'audit.

### 3.3 Réponses

`200 {"ok":true}` · `200 {"ok":true,"status":"ignored"}` · `401` signature · `400` corps invalide. **Jamais `500` sur un cas métier** (Polar réessaierait indéfiniment) ; `500` réservé à une panne réelle.

## 4. Routes publiques

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/` `/tarifs` `/exemple` `/faq` `/blog` `/blog/:slug` `/mentions-legales` `/cgv` `/confidentialite` | pages HTML rendues serveur |
| POST | `/api/scan` | teaser : `{url, email?}` → `202 {job, poll}` ; rate limit 3/h/IP, 1 résultat par `host` réutilisé 24 h |
| GET | `/api/scan/:id` | `{status, score?, top3?, error?}` |
| GET | `/audit/:token` | espace client (brief si manquant, statut, téléchargement PDF) |
| POST | `/audit/:token/brief` | `{activity, city, competitors[]?}` → déclenche l'audit |
| GET | `/audit/:token/rapport.pdf` | PDF (content-disposition inline) |
| GET | `/healthz` | santé |
| POST | `/webhook/polar` | webhook |

Jetons : `token = base64url(hmac_sha256(audit_id, SIGNING_SECRET)[:16]) + audit_id_court`. Vérification à temps constant. Aucune énumération possible, aucun mot de passe à créer.

## 5. Admin (`/admin`, Basic Auth)

Protection : Basic Auth (`ADMIN_USER` + `ADMIN_PASSWORD_HASH` bcrypt, comparaison à temps constant), **rate limit 5 tentatives/min/IP**, en-tête `X-Robots-Tag: noindex, nofollow`, `robots.txt` en `Disallow: /admin`. Session non persistée (pas de cookie).

Écrans :

1. **Tableau de bord** : audits 7 derniers jours, temps moyen, taux d'échec, coût LLM cumulé du mois, derniers événements webhook en erreur.
2. **Audits** : liste filtrable par statut, colonnes (date, email, site, offre, statut, score, durée, coût). Actions par ligne : voir, télécharger, **renvoyer l'email**, **relancer**, **marquer remboursé**, supprimer le dossier.
3. **Détail audit** : faits collectés (tableau des pages), constats et leur code, JSON LLM brut, erreurs, traces.
4. **Leads / teasers** : liste des analyses gratuites (URL, score, email si fourni), export CSV.
5. **Créer un audit manuellement** : `{email, site, offre}` — utilisé quand le webhook est arrivé sans URL, ou pour un geste commercial.
6. **Système** : version, `/healthz` détaillé, `worker_last_seen`, dernier envoi SMTP réussi, espace disque `/data` et `/reports`, et l'état du montage `/content` (fichiers détectés : blog, pages, images, admin).

Le back-office lit ses surcharges visuelles dans `/content/admin` (`logo.svg`, `admin.css`) et les sert sur `/admin/custom/*` — jamais depuis `/app`.

## 6. Emails transactionnels (5 gabarits HTML + texte)

| Kind | Déclencheur | Contenu |
|---|---|---|
| `teaser` | fin du scan gratuit (si email fourni) | score + 3 problèmes + lien vers l'offre |
| `brief` | `order.paid` | « votre audit démarre », lien `/audit/<token>` pour les 3 questions, délai annoncé |
| `brief_reminder` | H+30 min et H+20 h sans brief | relance courte, même lien |
| `delivery` | audit `done` | verdict, score, PDF **en pièce jointe**, lien espace client, phrase « répondre à cet email » |
| `admin_alert` | échec, produit inconnu, retard > 60 min | destinataire `CONTACT_EMAIL`, contenu technique |

Règles dures :

- Envoi via `SMTP_URL` (`smtps`, port 465, TLS). `SMTP_FROM` = `ScanSEO <contact@scanseo.fr>`.
- **Un échec d'envoi n'est jamais avalé** : `emails.status='failed'`, 3 tentatives (1/5/20 min), puis alerte admin. Le worker ne marque `done` qu'après `emails.status='sent'` pour `delivery` — sinon `delivered=false` visible dans l'admin. **Ne jamais répondre `200` en considérant l'email envoyé alors qu'il a échoué.**
- Un email ne part jamais deux fois pour le même `(audit_id, kind)` sauf action manuelle « renvoyer » depuis l'admin.
- Contenu : HTML simple, une colonne, 600 px, texte alternatif complet. Aucun pixel de suivi (le site ne dépose aucun cookie et n'utilise aucun traceur — c'est écrit dans la page confidentialité).

## 7. RGPD et rétention

- Données collectées : email (par Polar), URL auditée, contenu public des pages, PDF généré. **Aucune donnée personnelle du visiteur du site client**, aucun cookie, aucun traceur, aucune mesure d'audience tierce.
- Conservation : audit + PDF **12 mois**, puis suppression automatique ; `events` 3 mois ; `teasers` 30 jours (URL + score), emails de leads conservés jusqu'à désinscription.
- Suppression sur demande : un endpoint admin ou une commande `node cli.js purge --email x` supprime commandes, audits, PDF et emails associés, et le consigne.
- Le site client est crawlé à 1 requête/seconde, avec l'User-Agent `ScanSEO/1.0 (+https://scanseo.fr/bot)` ; pas de contournement de `robots.txt` au-delà des 5 pages d'entrée, pas d'authentification, pas de scraping de contenu privé.

## 8. Anti-abus

- `/api/scan` : 3/heure/IP (IP hachée en SHA-256 avec sel `SIGNING_SECRET`, jamais stockée en clair), 1 seul scan par `host` toutes les 24 h, liste noire de domaines (`localhost`, TLD internes).
- Un seul crawl simultané par `host` (verrou en base), 1 audit simultané global côté worker.
- Toute URL refusée par le garde SSRF (voir `04`) renvoie `400 {"error":"url_not_allowed"}` sans détail technique.
- Taille maximale acceptée par page : 8 Mo ; budget total par audit : 300 Mo de transfert — au-delà, crawl arrêté avec `truncated=true` dans les faits et mention dans le rapport.
