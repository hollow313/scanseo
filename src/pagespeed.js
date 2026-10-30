import { config } from './config.js';
import { safeFetch } from './fetcher.js';

/**
 * Client de l'API PageSpeed Insights v5 (catégorie performance uniquement).
 * Toutes les requêtes passent par safeFetch (garde anti-SSRF).
 *
 * @param {string} url
 * @param {{strategy?: 'mobile'|'desktop'}} [opts]
 * @returns {Promise<
 *   {ok:true, score:number, lcp_ms:number|null, cls:number|null, inp_ms:number|null,
 *    ttfb_ms:number|null, fcp_ms:number|null, top_opportunities:string[], total_bytes:number|null}
 * | {ok:false, error:string}
 * >}
 */
export async function runPageSpeed(url, { strategy = 'mobile' } = {}) {
  const key = config.pagespeedApiKey || '';
  if (!key || key === 'dummy') {
    return { ok: false, error: 'pagespeed_api_key_missing' };
  }

  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
    key,
  });
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;

  let res;
  try {
    res = await safeFetch(endpoint, {
      timeoutMs: 60000,
      maxBytes: 4 * 1024 * 1024,
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, error: `fetch_${err.code || 'error'}` };
  }

  if (res.status !== 200) {
    return { ok: false, error: `http_${res.status}` };
  }

  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  const lh = data.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  if (typeof score !== 'number') {
    // Réponse 200 mais sans mesure de performance exploitable.
    return { ok: false, error: 'no_performance_score' };
  }

  const audits = lh.audits || {};
  const num = (id) => {
    const v = audits[id]?.numericValue;
    return typeof v === 'number' ? v : null;
  };

  // Opportunités Lighthouse : audits de type "opportunity" avec un gain mesuré.
  const opportunities = Object.values(audits)
    .filter((a) => a && a.details && a.details.type === 'opportunity')
    .filter((a) => typeof a.numericValue === 'number' && a.numericValue > 0)
    .sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0))
    .slice(0, 10)
    .map((a) => String(a.title || a.id || '').trim())
    .filter(Boolean);

  return {
    ok: true,
    score: Math.max(0, Math.min(100, Math.round(score * 100))),
    lcp_ms: num('largest-contentful-paint'),
    cls: num('cumulative-layout-shift'),
    inp_ms: num('interaction-to-next-paint'),
    ttfb_ms: num('server-response-time'),
    fcp_ms: num('first-contentful-paint'),
    top_opportunities: opportunities,
    total_bytes: num('total-byte-weight'),
  };
}
