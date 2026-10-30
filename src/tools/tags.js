import { safeFetch, UA, isUrlAllowed } from '../fetcher.js';

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const grab = (html, re) => { const m = re.exec(html); return m ? decode(m[1]) : ''; };

/**
 * Analyse les balises d'une page publique. Aucune donnée n'est conservée :
 * l'outil est gratuit et ne demande ni compte ni email.
 */
export async function inspectTags(rawUrl) {
  const allowed = await isUrlAllowed(rawUrl).catch(() => false);
  if (!allowed) return { ok: false, error: 'url_not_allowed' };

  let res;
  try {
    res = await safeFetch(rawUrl, { headers: { 'user-agent': UA }, timeoutMs: 20000, maxBytes: 3 * 1024 * 1024 });
  } catch (err) {
    return { ok: false, error: err.code || 'fetch_failed' };
  }
  if (!res || !res.text) return { ok: false, error: 'empty_response' };

  const html = res.text;
  const head = (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(html) || [, html])[1];
  const title = grab(head, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = grab(head, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || grab(head, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const canonical = grab(head, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const ogTitle = grab(head, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const ogImage = grab(head, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i);
  const lang = grab(html, /<html[^>]+lang=["']([^"']*)["']/i);
  const robots = grab(head, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')));
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')));
  const jsonLd = (html.match(/application\/ld\+json/gi) || []).length;
  const noindex = /noindex/i.test(robots);
  const words = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).length;

  const checks = [];
  const add = (ok, label, detail, weight = 1) => checks.push({ ok, label, detail, weight });

  add(title.length >= 30 && title.length <= 65, 'Balise title',
    title ? `${title.length} caractères${title.length < 30 ? ' — trop court' : title.length > 65 ? ' — tronquée par Google' : ' — bonne longueur'}` : 'absente');
  add(metaDesc.length >= 120 && metaDesc.length <= 165, 'Meta description',
    metaDesc ? `${metaDesc.length} caractères${metaDesc.length < 120 ? ' — trop courte' : metaDesc.length > 165 ? ' — tronquée' : ' — bonne longueur'}` : 'absente');
  add(h1s.length === 1, 'Titre H1',
    h1s.length === 0 ? 'aucun H1' : h1s.length === 1 ? `« ${h1s[0].slice(0, 60)} »` : `${h1s.length} H1 — un seul attendu`);
  add(!!canonical, 'URL canonique', canonical || 'absente');
  add(!noindex, 'Indexation', noindex ? `noindex détecté (${robots})` : 'page indexable');
  add(h2s.length >= 2, 'Structure de titres', `${h2s.length} sous-titre(s) H2`);
  add(!!ogTitle && !!ogImage, 'Partage social', ogTitle && ogImage ? 'Open Graph complet' : 'balises Open Graph incomplètes');
  add(jsonLd > 0, 'Données structurées', jsonLd ? `${jsonLd} bloc(s) JSON-LD` : 'aucune');
  add(!!lang, 'Langue déclarée', lang ? `lang="${lang}"` : '<html lang> absent');
  add(words >= 300, 'Volume de texte', `${words} mots${words < 300 ? ' — contenu mince' : ''}`);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.ok).reduce((a, c) => a + c.weight, 0) / total) * 100);

  return { ok: true, url: res.url || rawUrl, status: res.status, score, checks,
    h2: h2s.slice(0, 6), title, metaDesc };
}
