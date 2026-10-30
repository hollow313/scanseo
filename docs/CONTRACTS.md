# CONTRATS INTERNES — modules du pipeline

Contrat **figé** entre les modules. Aucun agent ne renomme une fonction, ne change une forme de
retour, ni ne modifie un fichier hors de son périmètre. Les specs produit sont dans `docs/01` à `docs/07`.

Runtime : Node 22 (`/opt/data/installs/node22/bin/node`). ESM (`"type":"module"`). Dépendances déjà
présentes dans `package.json` : `express`, `better-sqlite3`, `undici`, `zod`, `nodemailer`, `marked`,
`puppeteer-core`, `pdf-lib`, `pdfjs-dist`, `bcryptjs`, `dotenv`. **Ne pas modifier `package.json`.**

Le fichier `src/fetcher.js` est écrit par l'orchestrateur : les autres modules l'importent, personne
d'autre ne le modifie.

---

## `src/fetcher.js` (orchestrateur — déjà livré)

```js
export const UA = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  scanseo:   'ScanSEO/1.0 (+https://scanseo.fr/bot)',
  curl:      'curl/8.5.0',
};

// Vérifie une URL AVANT toute requête (schéma, forme, IP privée, rebinding).
export function isUrlAllowed(url) -> { ok: boolean, reason?: string }   // async (résolution DNS)

// Requête protégée (lookup anti-SSRF appliqué à chaque redirection).
export async function safeFetch(url, { headers, timeoutMs = 20000, maxBytes = 8*1024*1024 } = {})
  -> { status, url, headers, body: Buffer, text: string, bytes, elapsedMs, truncated }
  // throw FetchError { code: 'EURLFORBIDDEN' | 'ETIMEOUT' | 'ETOOLARGE' | 'ENETWORK' }

export async function mapLimit(items, limit, fn) -> Promise<Array>  // concurrence bornée, ordre conservé
```

## `src/pagespeed.js`

```js
export async function runPageSpeed(url, { strategy = 'mobile' } = {})
  -> { ok: true, score, lcp_ms, cls, inp_ms, ttfb_ms, fcp_ms, top_opportunities: [string], total_bytes }
   | { ok: false, error: string }
```

## `src/crawl.js`

```js
export async function collect(audit, { onProgress } = {}) -> facts
```

`audit` = ligne `audits` (id, url, host, offer, activity, city, competitors JSON, lang).
`facts` (forme **exacte**) :

```js
{
  site: { url, host, activity, city, lang, cms, pages_crawled, partial, truncated,
          started_at, duration_ms, https, redirect_to_https },
  robots:  { present, blocks_all, sitemaps: [] },
  sitemap: { present, urls_count, in_sitemap_not_linked: [] },
  ua_matrix: { googlebot: {status, bytes, title}, scanseo: {...}, curl: {...},
               cloaking_detected: bool, js_only: bool },
  pages: [{
    url, final_url, depth, status, title, meta, h1, h1_count, words,
    canonical, robots_meta, jsonld_types: [], lang, ttfb_ms, bytes,
    internal_links, external_links, images_total, images_no_alt, images_big: int,
    first_paragraph, h2: [], hrefs: [], images: [{src, alt, bytes}], redirects: int,
    noindex_header: bool, mixed_content: int
  }],
  broken_links: [{url, from, status}],
  performance: { mobile: {score, lcp_ms, cls, inp_ms, ttfb_ms, top_opportunities}, desktop: {...} | null },
  local: { phone_found, phone_href, address_found, gbp_link_found, map_found,
           reviews_found, legal_page_found, tracker_without_consent, cms_version_exposed },
  limits: { max_pages, max_bytes_total, timeout_ms }
}
```

Règles dures : 1 requête/seconde par hôte, 3 en parallèle, 20 s par page, 8 Mo par page, profondeur 3,
respect de `robots.txt` pour les pages internes, User-Agent `UA.googlebot` par défaut. **Jamais** de
requête hors du domaine sauf pour tester un lien sortant (HEAD unique, sans suivre).

## `src/checks.js`

```js
export const CATALOGUE = [{ code, label, pillar, severity, penalty, cap }]   // 66 entrées, cf. docs/04 §4
export function runChecks(facts) -> {
  findings: [{ code, pillar, severity, page_url|null, evidence, detail, fix_payload|null }],
  score: { global, piliers: { technique, onpage, contenu, performance, local },
           counts: { critiques, majeurs, mineurs, informatifs } },
  catalogue: [{ code, label, pillar, result }]   // result: 'conforme' | 'a_corriger' | 'non_applicable'
}
```

Formule de score (docs/04 §5) : `note_pilier = max(0, 100 - Σ(min(occurrences, cap) × penalty))`,
`global = round(Σ(note_pilier × poids)/100)`, poids 25/30/20/15/10. Déterministe, jamais le LLM.

## `src/analyze.js`

```js
export const reportSchema          // zod
export async function analyze(facts, { offer, model, fallbackFindings } = {})
  -> { report, usage: { tokens_in, tokens_out, cost_usd }, fallback: boolean, fixes: [string] }
```

`report` = exactement la forme de `docs/05` §7 (`verdict`, `resume_executif`, `points_forts[]`,
`piliers[]`, `constats[]`, `textes_prets[]`, `plan_30_jours[]`, `a_verifier_dans_search_console[]`,
`limites`). Les notes de pilier sont **recopiées** depuis `facts.score`, jamais recalculées.

## `src/render.js`

```js
export async function renderPdf(report, facts, { outPath }) -> { path, pages, bytes, warnings: [] }
```

Écrit le PDF, vérifie : `12 ≤ pages ≤ 26`, aucune page < 200 caractères (hors couverture), poids < 6 Mo,
`title` du PDF renseigné. Gabarit = `src/templates/report.html` + `report.css` + `fonts/`
(copie de `docs`/`templates/b-produit`, direction validée).

## `src/pipeline.js` (orchestrateur — déjà livré)

`processAudit(audit)` : collecte → `pages`/`findings` en base → `analyze` → `renderPdf` →
statut `done` → email `delivery`. Écrit `faits.json`, `rapport.json`, `rapport.html`, `rapport.pdf`
dans `/reports/<AAAAMMJJ>_<id8>/`.

## Base de données

Schéma déjà en place (`src/db.js`) : `orders`, `audits`, `pages`, `findings`, `events`, `emails`,
`teasers`, `leads`, `rate_limits`, `system_kv`. **Ne pas modifier le schéma.**

## Routes déjà en place

`GET /`, `/tarifs`, `/faq`, `/exemple`, `/cgv`, `/confidentialite`, `/mentions-legales`, `/healthz`,
`POST /webhook/polar` (L1, vérifié). À ajouter : `POST /api/scan` (L5), `GET /audit/:token`,
`POST /audit/:token/brief`, `GET /audit/:token/rapport.pdf` (L5), `/admin/*` (L6).
