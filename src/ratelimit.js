import crypto from 'node:crypto';
import { config } from './config.js';
import { getDb } from './db.js';

/**
 * Hache l'IP du client avec le sel SIGNING_SECRET (HMAC-SHA256).
 * L'IP n'est jamais stockée ni journalisée en clair.
 * @param {import('express').Request} req
 * @returns {string} hex sha256 (64 caractères)
 */
export function clientIpHash(req) {
  const ip = (req && (req.ip || req.socket?.remoteAddress)) || 'unknown';
  return crypto.createHmac('sha256', config.signingSecret).update(String(ip)).digest('hex');
}

/**
 * Limiteur en base (table rate_limits), fenêtre glissante simple.
 * Chaque appel incrémente le compteur ; `allowed` vaut false dès que
 * `count > max` dans la fenêtre courante.
 *
 * @param {string} key   clé de rate limit (ex. 'scan:<ip_hash>')
 * @param {{max?: number, windowMs?: number}} opts
 * @returns {{allowed: boolean, remaining: number, resetAt: number}}
 *   resetAt en millisecondes epoch.
 */
export function checkRateLimit(key, { max = 3, windowMs = 60 * 60 * 1000 } = {}) {
  const db = getDb();
  const now = Date.now();

  return db.transaction(() => {
    const row = db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);

    if (!row) {
      db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)')
        .run(key, new Date(now).toISOString());
      return { allowed: true, remaining: Math.max(0, max - 1), resetAt: now + windowMs };
    }

    const windowStartMs = Date.parse(row.window_start);
    // Fenêtre expirée : on repart de zéro.
    if (Number.isNaN(windowStartMs) || now - windowStartMs >= windowMs) {
      db.prepare('UPDATE rate_limits SET window_start = ?, count = 1 WHERE key = ?')
        .run(new Date(now).toISOString(), key);
      return { allowed: true, remaining: Math.max(0, max - 1), resetAt: now + windowMs };
    }

    const count = row.count + 1;
    db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').run(count, key);
    const remaining = Math.max(0, max - count);
    return { allowed: count <= max, remaining, resetAt: windowStartMs + windowMs };
  })();
}
