import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { isUrlAllowed } from '../fetcher.js';
import { checkRateLimit, clientIpHash } from '../ratelimit.js';

export const router = Router();

/** Comparaison à temps constant, sans révéler la longueur attendue. */
function keyMatches(provided) {
  const expected = config.scanApiKey || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function providedKey(req) {
  const header = req.headers['x-api-key'];
  if (header) return String(header);
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

/**
 * POST /api/prospect/scan
 * En-tête : x-api-key: <SCAN_API_KEY>   (ou Authorization: Bearer <clé>)
 * Corps   : { url, email?, pages?, deliver? }
 * Usage   : prospection — scan gratuit d'un site, lien partageable + PDF d'aperçu.
 */
router.post('/scan', async (req, res) => {
  if (!config.scanApiKey) {
    return res.status(503).json({ error: 'prospection_disabled', message: 'SCAN_API_KEY non configurée' });
  }
  if (!keyMatches(providedKey(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const ip = clientIpHash(req);
  const limit = checkRateLimit(`prospect:${ip}`, { max: 30, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'too_many_requests', reset_at: limit.resetAt });
  }

  const { url, email = null, pages = 8, deliver = true } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'invalid_url' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email))) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const allowed = await isUrlAllowed(normalized);
  if (!allowed.ok) {
    return res.status(400).json({ error: 'url_not_allowed', reason: allowed.reason });
  }

  try {
    const { prospectScan } = await import('../prospect.js');
    const result = await prospectScan({
      url: normalized,
      email: email ? String(email) : null,
      pages: Math.max(1, Math.min(Number(pages) || 8, 15)),
      deliver: deliver !== false,
      source: 'api',
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[prospect] échec du scan:', err.message);
    return res.status(502).json({ error: 'scan_failed' });
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: Boolean(config.scanApiKey), authenticated: keyMatches(providedKey(req)) });
});

export default router;
