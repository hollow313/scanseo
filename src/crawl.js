import { safeFetch, mapLimit, sleep, UA } from './fetcher.js';
import { runPageSpeed } from './pagespeed.js';

/* ------------------------------------------------------------------ */
/* Extraction HTML par regex uniquement (aucune dépendance DOM).        */
/* ------------------------------------------------------------------ */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => { try { return String.fromCodePoint(parseInt(d, 16)); } catch { return ''; } })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

function stripTags(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function collapse(s) {
  return stripTags(s).replace(/\s+/g, ' ').trim();
}

function wordCount(text) {
  const t = collapse(text);
  return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

function attrOf(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')) || tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, 'i'));
  return m ? decodeEntities(m[2]) : null;
}

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : '';
}

function getMeta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const n = attrOf(tag, 'name');
    if (n && n.toLowerCase() === name.toLowerCase()) return attrOf(tag, 'content');
  }
  for (const tag of tags) {
    const p = attrOf(tag, 'property');
    if (p && p.toLowerCase() === name.toLowerCase()) return attrOf(tag, 'content');
  }
  return null;
}

function getCanonical(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = (attrOf(tag, 'rel') || '').toLowerCase();
    if (rel.split(/\s+/).includes('canonical')) return attrOf(tag, 'href');
  }
  return null;
}

function getHreflangs(html) {
  const langs = [];
  let xdefault = false;
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = (attrOf(tag, 'rel') || '').toLowerCase();
    if (!rel.split(/\s+/).includes('alternate')) continue;
    const hl = attrOf(tag, 'hreflang');
    if (hl) {
      if (hl.toLowerCase() === 'x-default') xdefault = true;
      else langs.push(hl.toLowerCase());
    }
  }
  return { langs: [...new Set(langs)], xdefault };
}

function getHeadings(html, level) {
  return (html.match(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi')) || [])
    .map((t) => collapse(t.replace(/^<h\d[^>]*>/i, '').replace(/<\/h\d>$/i, '')));
}

function getHeadingLevels(html) {
  const levels = [];
  const re = /<h([1-6])\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) levels.push(parseInt(m[1], 10));
  return levels;
}

function getImages(html) {
  const out = [];
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const src = attrOf(tag, 'src');
    if (src) out.push({ src, alt: attrOf(tag, 'alt') ?? null });
  }
  return out;
}

function getLinks(html) {
  const hrefs = [];
  const anchors = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[2]);
    hrefs.push(href);
    anchors.push({ href, text: collapse(m[3]) });
  }
  return { hrefs, anchors };
}

function getJsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function analyzeJsonLd(html) {
  const types = [];
  let invalid = 0;
  let missingFields = 0;
  let phone = null, street = null, locality = null;
  let hasRating = false;
  for (const block of getJsonLdBlocks(html)) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { invalid++; continue; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        const t = o['@type'];
        const tlist = typeof t === 'string' ? [t] : (Array.isArray(t) ? t : []);
        tlist.forEach((x) => types.push(String(x)));
        if (tlist.some((x) => /Organization|LocalBusiness|Person/.test(String(x))) && !o.name) missingFields++;
        if (tlist.some((x) => /FAQPage/.test(String(x))) && !Array.isArray(o.mainEntity)) missingFields++;
        if (typeof o.telephone === 'string') phone = phone || o.telephone;
        if (o.address && typeof o.address === 'object') {
          if (typeof o.address.streetAddress === 'string') street = street || o.address.streetAddress;
          if (typeof o.address.addressLocality === 'string') locality = locality || o.address.addressLocality;
        }
        if (tlist.some((x) => /AggregateRating|Review/.test(String(x)))) hasRating = true;
        if (typeof o.ratingValue !== 'undefined' || typeof o.reviewCount !== 'undefined') hasRating = true;
        if (Array.isArray(o['@graph'])) o['@graph'].forEach(walk);
        if (Array.isArray(o.mainEntity)) o.mainEntity.forEach(walk);
      };
      walk(it);
    }
  }
  return { types: [...new Set(types)], invalid, missingFields, phone, street, locality, hasRating };
}

/* ------------------------------------------------------------------ */
/* Utilitaires crawl                                                   */
/* ------------------------------------------------------------------ */

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function normalizeForKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch { return url; }
}

function sameSiteHost(a, b) {
  return a.toLowerCase().replace(/^www\./, '') === b.toLowerCase().replace(/^www\./, '');
}

function isInternalHref(href, host) {
  if (!href) return false;
  if (/^(mailto:|tel:|javascript:|data:|#|ftp:|file:)/i.test(href)) return false;
  let u;
  try { u = new URL(href, 'https://scanseo.invalid/'); } catch { return false; }
  if (u.hostname === 'scanseo.invalid') return true; // relatif
  return sameSiteHost(u.hostname, host);
}

function resolveUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

function countRedirects(origUrl, finalUrl) {
  try {
    const a = new URL(origUrl), b = new URL(finalUrl);
    if (a.href === b.href) return 0;
    let n = 0;
    if (a.protocol !== b.protocol) n++;
    if (a.host !== b.host) n++;
    if (n === 0) n = 1;
    return n;
  } catch { return 0; }
}

function parseRobots(text) {
  const sitemaps = [];
  const groups = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const ua = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (ua) {
      current = { agents: ua[1].split(',').map((s) => s.trim().toLowerCase()), disallows: [], allows: [] };
      groups.push(current);
      continue;
    }
    const d = line.match(/^disallow\s*:\s*(.*)$/i);
    if (d && current) { current.disallows.push(d[1].trim()); continue; }
    const sm = line.match(/^sitemap\s*:\s*(\S+)$/i);
    if (sm) sitemaps.push(sm[1].trim());
  }
  const blocksAll = groups.some((g) => g.agents.includes('*') && g.disallows.some((d) => d === '/'));
  return { sitemaps, blocksAll, groups };
}

function robotsAllowsPath(path, groups) {
  if (!groups || !groups.length) return true;
  let picked = groups.find((g) => g.agents.includes('googlebot')) || groups.find((g) => g.agents.includes('scanseo'));
  if (!picked) {
    picked = groups.find((g) => g.agents.includes('*'));
    if (!picked) return true;
  }
  const p = path || '/';
  for (const d of picked.disallows) {
    if (d === '/' || (d && p.startsWith(d))) return false;
  }
  return true;
}

const TRACKERS = [
  /googletagmanager\.com/i, /google-analytics\.com/i, /gtag\/js/i, /analytics\.js/i, /ga\.js/i,
  /facebook\.net\/fbevents/i, /connect\.facebook\.net/i, /hotjar\.com/i, /matomo/i, /piwik/i,
  /clarity\.ms/i, /linkedin\.com\/px/i, /doubleclick\.net/i,
];

const CONSENT_MARKERS = [
  /cookieconsent/i, /tarteaucitron/i, /axeptio/i, /didomi/i, /consent/i, /gdpr/i, /rgpd/i,
  /cookie.*(banner|notice|bar|settings|preferences)/i, /accepter/i, /data-cookie/i,
  /onetrust/i, /cookiebot/i, /quantcast/i, /cmp-?ui/i, /consent-manager/i,
];

const PHONE_RE = /(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g;
const POSTAL_RE = /\b\d{5}\b/g;
const ADDRESS_RE = /\b\d{1,4}[,\s]+\w+\s+(?:rue|avenue|av\.|boulevard|bd|chemin|place|impasse|allée|allee|quai|route|faubourg|square|cours|esplanade|lotissement|zone|zac)\b[\s\S]{0,80}?\b\d{5}\b/i;

function extractPhones(text) {
  const found = [];
  for (const m of text.match(PHONE_RE) || []) {
    const norm = m.replace(/[\s.-]/g, '');
    if (!found.includes(norm)) found.push(norm);
  }
  return found;
}

function extractPostalCodes(text) {
  return [...new Set(text.match(POSTAL_RE) || [])];
}

function detectCms(html) {
  const gen = getMeta(html, 'generator');
  if (gen) {
    const g = gen.toLowerCase();
    if (g.includes('wordpress')) return `wordpress ${(gen.match(/\d+(?:\.\d+)*/) || [])[0] || ''}`.trim();
    if (g.includes('joomla')) return `joomla ${(gen.match(/\d+(?:\.\d+)*/) || [])[0] || ''}`.trim();
    if (g.includes('drupal')) return 'drupal';
    if (g.includes('wix')) return 'wix';
    if (g.includes('shopify')) return 'shopify';
    if (g.includes('squarespace')) return 'squarespace';
    if (g.includes('prestashop')) return 'prestashop';
    return gen.trim();
  }
  if (/\/wp-content\//i.test(html) || /\/wp-includes\//i.test(html)) return 'wordpress';
  return null;
}

function detectCmsExposed(html) {
  const gen = getMeta(html, 'generator');
  if (gen && /\d/.test(gen)) return true;
  if (/\/wp-json/i.test(html)) return true;
  if (/\?ver=\d/i.test(html)) return true;
  return false;
}

function simhash64(text) {
  const tokens = collapse(text).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2000);
  const v = new Array(64).fill(0);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    for (let bit = 0; bit < 64; bit++) v[bit] += (h & (1 << (bit % 32))) ? 1 : -1;
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (v[bit] > 0) out |= (1n << BigInt(bit));
  return out.toString();
}

function hammingDistance(a, b) {
  let z = BigInt(a) ^ BigInt(b), d = 0;
  while (z) { d++; z &= z - 1n; }
  return d;
}

const SUSPICIOUS_TLD = /\.(xyz|top|tk|ml|ga|cf|gq|loan|click|link|win|bid|men|stream|download|racing|accountant|science|party|review|trade|webcam|work|date|faith|cricket|kim|buzz|icu)$/i;
const SUSPICIOUS_KW = /(?:poker|casino|viagra|loan|crypto-?free|free-?crypto|bitcoin-?doubler)/i;

function makeThrottle(minGapMs) {
  const lastByHost = new Map();
  return async function throttle(hostname) {
    const now = Date.now();
    const last = lastByHost.get(hostname) || 0;
    const wait = Math.max(0, minGapMs - (now - last));
    if (wait > 0) await sleep(wait);
    lastByHost.set(hostname, Date.now());
  };
}

/* ------------------------------------------------------------------ */
/* Collecte                                                            */
/* ------------------------------------------------------------------ */

export async function collect(audit, { onProgress } = {}) {
  const startedAt = Date.now();
  const throttle = makeThrottle(1000); // 1 req/s par hôte

  const rawUrl = audit.url;
  const host = (audit.host || hostOf(rawUrl) || '').toLowerCase();
  const offer = audit.offer || 'audit_49';
  const maxPages = offer === 'audit_149' ? 100 : offer === 'audit_49' ? 25 : 5;
  const lang = audit.lang || 'fr';
  const activity = String(audit.activity || '');
  const city = String(audit.city || '');

  let origin;
  try { origin = new URL(rawUrl).origin; } catch { origin = rawUrl; }
  const homepageUrl = normalizeForKey(rawUrl);

  const facts = {
    site: {
      url: rawUrl, host, activity, city, lang, cms: null,
      pages_crawled: 0, partial: false, truncated: false,
      started_at: new Date().toISOString(), duration_ms: 0,
      https: false, redirect_to_https: false,
    },
    robots: { present: false, blocks_all: false, sitemaps: [] },
    sitemap: { present: false, urls_count: 0, in_sitemap_not_linked: [] },
    ua_matrix: {
      googlebot: { status: 0, bytes: 0, title: '' },
      scanseo: { status: 0, bytes: 0, title: '' },
      curl: { status: 0, bytes: 0, title: '' },
      cloaking_detected: false, js_only: false,
    },
    pages: [],
    broken_links: [],
    performance: { mobile: null, desktop: null },
    local: {
      phone_found: false, phone_href: '', address_found: false, gbp_link_found: false,
      map_found: false, reviews_found: false, legal_page_found: false,
      tracker_without_consent: false, cms_version_exposed: false,
    },
    limits: { max_pages: maxPages, max_bytes_total: 300 * 1024 * 1024, timeout_ms: 20000 },
  };

  async function safeGet(url, { ua = UA.googlebot, maxBytes = 8 * 1024 * 1024, timeoutMs = 20000 } = {}) {
    await throttle(hostOf(url) || host);
    try {
      return await safeFetch(url, { headers: { 'user-agent': ua }, timeoutMs, maxBytes });
    } catch (err) {
      return { error: err.code || 'ENETWORK', status: 0, url, bytes: 0, text: '', headers: {}, elapsedMs: 0, truncated: false };
    }
  }

  // --- robots.txt ---
  let robotsGroups = [];
  {
    const rb = await safeGet(`${origin}/robots.txt`);
    if (rb.status === 200 && rb.text) {
      facts.robots.present = true;
      const parsed = parseRobots(rb.text);
      facts.robots.blocks_all = parsed.blocksAll;
      facts.robots.sitemaps = parsed.sitemaps;
      robotsGroups = parsed.groups;
    }
  }

  // --- sitemap (et sitemap_index) ---
  const sitemapUrlsSet = new Set();
  const sitemapCandidates = facts.robots.sitemaps.length ? facts.robots.sitemaps : [`${origin}/sitemap.xml`];
  let primaryRawLocs = 0;
  {
    let fetched = 0;
    for (const smUrl of sitemapCandidates.slice(0, 5)) {
      if (fetched >= 10) break;
      const sm = await safeGet(smUrl);
      fetched++;
      if (sm.status !== 200 || !sm.text) continue;
      facts.sitemap.present = true;
      const locs = (sm.text.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi) || [])
        .map((t) => collapse(t.replace(/<\/?loc>/gi, '')));
      if (fetched === 1) primaryRawLocs = locs.length;
      for (const loc of locs) {
        const abs = resolveUrl(loc, smUrl);
        if (abs) sitemapUrlsSet.add(normalizeForKey(abs));
      }
      const children = (sm.text.match(/<sitemap>\s*<loc>([\s\S]*?)<\/loc>/gi) || [])
        .map((t) => collapse(t.replace(/<\/?loc>/gi, '')))
        .filter(Boolean);
      for (const child of children) {
        if (fetched >= 10) break;
        const abs = resolveUrl(child, smUrl);
        if (!abs) continue;
        const cs = await safeGet(abs);
        fetched++;
        if (cs.status !== 200 || !cs.text) continue;
        const childLocs = (cs.text.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi) || [])
          .map((t) => collapse(t.replace(/<\/?loc>/gi, '')));
        for (const loc of childLocs) {
          const a = resolveUrl(loc, abs);
          if (a) sitemapUrlsSet.add(normalizeForKey(a));
        }
      }
    }
    facts.sitemap.urls_count = sitemapUrlsSet.size;
    facts.sitemap.urls = [...sitemapUrlsSet].slice(0, 300);
  }

  // --- BFS accueil + liens internes ---
  const queue = [{ url: homepageUrl, depth: 0 }];
  const seen = new Set();
  const internalLinksSeen = new Set();
  const allInternalHrefs = [];
  let truncatedAny = false;

  function parsePage(res, url, depth) {
    const html = res.text || '';
    const finalUrl = res.url || url;
    const title = getTitle(html);
    const meta = getMeta(html, 'description') || '';
    const h1s = getHeadings(html, 1);
    const h2s = getHeadings(html, 2);
    const text = stripTags(html);
    const words = wordCount(text);
    const images = getImages(html);
    const { hrefs, anchors } = getLinks(html);
    const canonical = getCanonical(html);
    const robotsMeta = getMeta(html, 'robots') || '';
    const noindexHeader = /noindex/i.test(res.headers?.['x-robots-tag'] || '');
    const jld = analyzeJsonLd(html);

    const internal = [];
    const external = new Set();
    const suspiciousDomains = new Set();
    for (const h of hrefs) {
      const abs = resolveUrl(h, finalUrl);
      if (!abs) continue;
      if (isInternalHref(h, host)) {
        internal.push(abs);
        const key = normalizeForKey(abs);
        if (!internalLinksSeen.has(key)) {
          internalLinksSeen.add(key);
          allInternalHrefs.push({ url: abs, from: finalUrl });
        }
      } else {
        let d;
        try { d = new URL(abs).hostname.toLowerCase(); } catch { continue; }
        external.add(d);
        if (SUSPICIOUS_TLD.test(d) || SUSPICIOUS_KW.test(d)) suspiciousDomains.add(d);
      }
    }

    let mixed = 0;
    if ((finalUrl || '').startsWith('https://')) {
      mixed = (html.match(/(?:src|href)\s*=\s*["']http:\/\//gi) || []).length;
    }

    const genericAnchors = anchors.filter((a) => /cliquez ici|en savoir plus|lire la suite|voir plus|cliquer ici|click here|read more|plus d'infos|en savoir \+/i.test(a.text)).length;

    const firstP = (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [])
      .map((p) => collapse(p.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '')))
      .find((t) => t.length > 20) || '';

    const phonesOnPage = extractPhones(text);
    const postalOnPage = extractPostalCodes(text);

    const hasTracker = TRACKERS.some((re) => re.test(html));
    const hasConsent = CONSENT_MARKERS.some((re) => re.test(html));
    const gbpLink = /google\.[a-z.]+\/maps|g\.page|business\.google|maps\.app\.goo\.gl|search\?.*cid=/.test(html);
    const mapEmbed = /(?:google\.[a-z.]+\/maps\/embed|openstreetmap\.org\/export\/embed|mapbox|leaflet|iframe[^>]*maps)/i.test(html);
    const reviews = /"@type"\s*:\s*"(?:AggregateRating|Review)"|ratingValue|reviewCount|itemprop\s*=\s*["']reviewCount|avis\s+(?:clients|vérifiés|google)/i.test(html);
    const compromise = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px)?|text-indent\s*:\s*-?\d{3,}|position\s*:\s*absolute[^;]{0,40}(?:left|top)\s*:\s*-\d{3,}|<meta[^>]+http-equiv\s*=\s*["']refresh/i.test(html);
    const hr = getHreflangs(html);

    return {
      url,
      final_url: finalUrl,
      depth,
      status: res.status,
      error: res.error || null,
      title, meta,
      h1: h1s[0] || '',
      h1_count: h1s.length,
      words,
      canonical: canonical || '',
      robots_meta: robotsMeta,
      jsonld_types: jld.types,
      lang: (html.match(/<html[^>]*\blang\s*=\s*["']?([a-z-]+)/i) || [])[1] || '',
      ttfb_ms: res.elapsedMs || 0,
      bytes: res.bytes || 0,
      internal_links: internal.length,
      external_links: external.size,
      images_total: images.length,
      images_no_alt: images.filter((i) => !i.alt || !i.alt.trim()).length,
      images_big: 0,
      first_paragraph: firstP.slice(0, 300),
      h2: h2s,
      hrefs,
      images,
      redirects: countRedirects(url, finalUrl),
      noindex_header: noindexHeader,
      mixed_content: mixed,
      truncated: !!res.truncated,
      // champs dérivés pour les contrôles (jamais de HTML brut)
      generic_anchors: genericAnchors,
      h_levels: getHeadingLevels(html),
      simhash: simhash64(text),
      geo_mentions: /(?:rue|avenue|boulevard|quartier|centre-ville|région|département|France|code postal)\b/i.test(text) || postalOnPage.length > 0,
      phones: phonesOnPage,
      postal_codes: postalOnPage,
      jsonld_invalid: jld.invalid,
      jsonld_missing_fields: jld.missingFields,
      jsonld_phone: jld.phone,
      jsonld_street: jld.street,
      jsonld_locality: jld.locality,
      jsonld_rating: jld.hasRating,
      has_tracker: hasTracker,
      has_consent: hasConsent,
      gbp_link: gbpLink,
      map_embed: mapEmbed,
      reviews: reviews,
      cms: detectCms(html),
      cms_exposed: detectCmsExposed(html),
      compromise: compromise,
      suspicious_domains: [...suspiciousDomains],
      hsts: !!res.headers?.['strict-transport-security'],
      og_title: !!getMeta(html, 'og:title'),
      og_image: !!getMeta(html, 'og:image'),
      twitter_card: !!getMeta(html, 'twitter:card'),
      meta_keywords: getMeta(html, 'keywords') || '',
      hreflangs: hr.langs,
      hreflang_xdefault: hr.xdefault,
    };
  }

  while (queue.length && facts.pages.length < maxPages) {
    const item = queue.shift();
    const key = normalizeForKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.depth > 3) continue;
    if (item.depth > 0 && !robotsAllowsPath(new URL(item.url).pathname || '/', robotsGroups)) continue;

    const res = await safeGet(item.url);
    if (res.truncated) truncatedAny = true;
    const page = parsePage(res, item.url, item.depth);
    facts.pages.push(page);
    if (onProgress) { try { onProgress(facts.pages.length, maxPages); } catch {} }

    if (page.status === 200 && item.depth < 3) {
      for (const h of page.hrefs) {
        if (!isInternalHref(h, host)) continue;
        const abs = resolveUrl(h, page.final_url);
        if (!abs) continue;
        const k = normalizeForKey(abs);
        if (seen.has(k)) continue;
        // Les pages légales et de contact passent en tête : sans elles, un crawl court
        // conclut à tort à l'absence de mentions légales, ce qui est un constat critique.
        if (/mentions|cgv|confidentialite|legal|contact/i.test(abs)) queue.unshift({ url: abs, depth: item.depth + 1 });
        else queue.push({ url: abs, depth: item.depth + 1 });
      }
    }
  }

  facts.site.pages_crawled = facts.pages.length;
  // Un crawl arrêté au plafond de pages n'a PAS tout vu : `truncated` doit le dire,
  // sinon les contrôles d'exhaustivité (mentions légales, liens sortants, orphelines)
  // concluent sur un site partiellement visité — et produisent de faux « critique ».
  facts.site.truncated = truncatedAny || queue.length > 0;
  facts.site.crawl_complete = !facts.site.truncated;

  // --- statuts dérivés de l'accueil ---
  const home = facts.pages[0] || null;
  if (home) {
    facts.site.https = (home.final_url || '').startsWith('https://');
    try {
      const orig = new URL(rawUrl), fin = new URL(home.final_url || rawUrl);
      facts.site.redirect_to_https = orig.protocol === 'http:' && fin.protocol === 'https:';
    } catch {}
  }
  facts.site.cms = (home && home.cms) || facts.pages.map((p) => p.cms).find(Boolean) || null;

  // --- matrice UA (accueil sous 3 UA) ---
  {
    const g = home || { status: 0, bytes: 0, title: '' };
    facts.ua_matrix.googlebot = { status: g.status, bytes: g.bytes, title: g.title };
    const s = await safeGet(homepageUrl, { ua: UA.scanseo });
    facts.ua_matrix.scanseo = { status: s.status, bytes: s.bytes, title: getTitle(s.text || '') };
    const c = await safeGet(homepageUrl, { ua: UA.curl });
    facts.ua_matrix.curl = { status: c.status, bytes: c.bytes, title: getTitle(c.text || '') };

    const m = facts.ua_matrix;
    const normTitle = (t) => collapse(t).toLowerCase();
    const divBytes = (a, b) => Math.abs(a - b) > Math.max(1000, 0.2 * Math.max(a, b));
    const blocking = (x) => [403, 406, 410, 451].includes(x.status);
    let cloaking = false;

    for (const [x, y] of [['googlebot', 'scanseo'], ['googlebot', 'curl'], ['scanseo', 'curl']]) {
      const A = m[x], B = m[y];
      if ((A.status === 200) !== (B.status === 200)) { cloaking = true; break; }
      if (blocking(A) || blocking(B)) { cloaking = true; break; }
      if (A.status === 200 && B.status === 200) {
        if (normTitle(A.title) && normTitle(B.title) && normTitle(A.title) !== normTitle(B.title)) { cloaking = true; break; }
        if (divBytes(A.bytes, B.bytes)) { cloaking = true; break; }
      }
    }

    // robots.txt sous un second UA
    const rb2 = await safeGet(`${origin}/robots.txt`, { ua: UA.scanseo });
    if ((rb2.status === 200) !== facts.robots.present) cloaking = true;
    else if (rb2.status === 200) {
      const rb2Parsed = parseRobots(rb2.text || '');
      if (rb2Parsed.blocksAll !== facts.robots.blocks_all) cloaking = true;
    }

    // sitemap (nb d'URLs) sous un second UA
    const primarySm = sitemapCandidates[0];
    const sm2 = await safeGet(primarySm, { ua: UA.scanseo });
    if (sm2.status === 200) {
      const locs2 = (sm2.text || '').match(/<loc>/gi || [])?.length || 0;
      if (Math.abs(locs2 - primaryRawLocs) > 0) cloaking = true;
    }

    facts.ua_matrix.cloaking_detected = cloaking;
  }

  // --- PageSpeed (mobile) ---
  {
    const ps = await runPageSpeed(rawUrl, { strategy: 'mobile' });
    if (ps.ok) {
      facts.performance.mobile = {
        score: ps.score, lcp_ms: ps.lcp_ms, cls: ps.cls, inp_ms: ps.inp_ms,
        ttfb_ms: ps.ttfb_ms, fcp_ms: ps.fcp_ms,
        top_opportunities: ps.top_opportunities, total_bytes: ps.total_bytes,
      };
      const homeWords = home ? home.words : 0;
      facts.ua_matrix.js_only = !!home && home.status === 200 && homeWords < 40 &&
        ((typeof ps.lcp_ms === 'number' && ps.lcp_ms > 0) || (typeof ps.fcp_ms === 'number' && ps.fcp_ms > 0));
    }
  }

  // --- liens cassés (liens internes uniques non déjà crawlés) ---
  {
    const crawledKeys = new Set(facts.pages.map((p) => normalizeForKey(p.url)));
    // Seules les URL http(s) se testent : un mailto:/tel: résolu en chemin relatif
    // produisait un faux « lien interne en 404 » sur le domaine.
    const unique = [...new Set(allInternalHrefs.map((l) => l.url))]
      .filter((u) => /^https?:\/\//i.test(u))
      .filter((u) => !crawledKeys.has(normalizeForKey(u)))
      .slice(0, 40);
    const results = await mapLimit(unique, 3, async (u) => {
      const r = await safeGet(u, { maxBytes: 1024 * 1024, timeoutMs: 15000 });
      return { u, r };
    });
    for (const { u, r } of results) {
      if (r.status >= 400 || r.status === 0) {
        facts.broken_links.push({
          url: u,
          from: allInternalHrefs.find((l) => l.url === u)?.from || homepageUrl,
          status: r.status,
        });
      }
    }
  }

  // --- images lourdes (same-origin, taille réelle) ---
  {
    const imageBytes = new Map();
    const allImgs = [];
    for (const p of facts.pages) for (const img of p.images) allImgs.push(img.src);
    const uniqueImgs = [...new Set(allImgs.filter((s) => s && isInternalHref(s, host)))].slice(0, 25);
    const results = await mapLimit(uniqueImgs, 3, async (src) => {
      const abs = resolveUrl(src, homepageUrl);
      if (!abs) return { abs: null, r: null };
      const r = await safeGet(abs, { maxBytes: 205 * 1024, timeoutMs: 15000 });
      return { abs, r };
    });
    for (const { abs, r } of results) {
      if (abs && r && r.status === 200) imageBytes.set(abs, r.truncated ? 205 * 1024 : (r.bytes || 0));
    }
    for (const p of facts.pages) {
      let big = 0;
      p.images = p.images.map((img) => {
        const abs = resolveUrl(img.src, p.final_url || p.url);
        const bytes = abs ? (imageBytes.get(abs) ?? null) : null;
        if (bytes != null && bytes > 200 * 1024) big++;
        return { src: img.src, alt: img.alt, bytes };
      });
      p.images_big = big;
    }
  }

  // --- agrégation local & confiance ---
  {
    const allText = facts.pages.map((p) => [p.title, p.h1, p.first_paragraph, (p.h2 || []).join(' '), p.meta].join(' ')).join(' ');
    const phones = extractPhones(allText);
    facts.local.phone_found = phones.length > 0;
    facts.local.phones = phones;

    let telHref = '';
    outer: for (const p of facts.pages) for (const h of p.hrefs || []) {
      if (/^tel:/i.test(h)) { telHref = h; break outer; }
    }
    facts.local.phone_href = telHref;

    facts.local.address_found = ADDRESS_RE.test(allText);
    facts.local.addresses = (allText.match(ADDRESS_RE) || []).map((s) => collapse(s)).slice(0, 5);

    facts.local.gbp_link_found = facts.pages.some((p) => p.gbp_link);
    facts.local.map_found = facts.pages.some((p) => p.map_embed);
    facts.local.reviews_found = facts.pages.some((p) => p.reviews);

    const legalRe = /(?:mentions[\s_-]?l[ée]gales|mentions-legales|mentions_legales|legal-notice|\bimpressum\b|politique de confidentialit[ée]|confidentialite)/i;
    facts.local.legal_page_found = facts.pages.some((p) => legalRe.test((p.url || '') + ' ' + (p.title || '')));

    const hasTracker = facts.pages.some((p) => p.has_tracker);
    const hasConsent = facts.pages.some((p) => p.has_consent);
    facts.local.tracker_without_consent = hasTracker && !hasConsent;

    facts.local.cms_version_exposed = facts.pages.some((p) => p.cms_exposed);

    facts.local.jsonld_phone = facts.pages.map((p) => p.jsonld_phone).find(Boolean) || null;
    const street = facts.pages.map((p) => p.jsonld_street).find(Boolean) || null;
    const locality = facts.pages.map((p) => p.jsonld_locality).find(Boolean) || null;
    facts.local.jsonld_address = street ? `${street}${locality ? ' ' + locality : ''}`.trim() : null;

    facts.local.multiple_locations = facts.pages.some((p) => (p.postal_codes || []).length > 1 || (p.phones || []).length > 2);

    facts.local.compromise_indicators = facts.pages.some((p) => p.compromise);

    const suspicious = new Set();
    for (const p of facts.pages) for (const d of p.suspicious_domains) suspicious.add(d);
    facts.local.suspicious_domains = [...suspicious];
  }

  // --- pages orphelines (sitemap non lié en interne) ---
  {
    const linkedKeys = new Set(allInternalHrefs.map((l) => normalizeForKey(l.url)));
    for (const s of sitemapUrlsSet) {
      if (!linkedKeys.has(s) && facts.sitemap.in_sitemap_not_linked.length < 50) {
        facts.sitemap.in_sitemap_not_linked.push(s);
      }
    }
  }

  // --- partial : moins de 60 % des pages attendues récupérées ---
  {
    const attempted = facts.pages.length;
    const ok = facts.pages.filter((p) => p.status >= 200 && p.status < 400).length;
    facts.site.partial = !home || home.status !== 200 || (attempted > 0 && ok / attempted < 0.6);
  }

  facts.site.duration_ms = Date.now() - startedAt;
  return facts;
}
