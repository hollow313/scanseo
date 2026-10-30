import { Router } from 'express';
import { config } from '../config.js';
import { clientIpHash, checkRateLimit } from '../ratelimit.js';
import { inspectTags } from '../tools/tags.js';

export const router = Router();

// Outil gratuit : 30 analyses par heure et par visiteur. Le crawl complet est
// bien plus coûteux, mais une seule page ici — inutile de rationner davantage.
const MAX = 30;
const WINDOW = 60 * 60 * 1000;

router.post('/', async (req, res) => {
  const rawUrl = typeof (req.body || {}).url === 'string' ? req.body.url.trim() : '';
  if (!rawUrl) return res.status(400).json({ ok: false, error: 'url_required' });

  const rl = checkRateLimit(`tags:${clientIpHash(req)}`, { max: MAX, windowMs: WINDOW });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  try {
    const result = await inspectTags(rawUrl);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[tags] échec:', err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});
