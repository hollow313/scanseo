import { isUrlAllowed } from './fetcher.js';

/**
 * Normalise une URL saisie par l'utilisateur : schéma par défaut https,
 * hôte en minuscules, clé d'unicité sans `www.`. Conserve chemin + query.
 * @param {string} rawUrl
 * @returns {{url: string, host: string} | null}
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let str = rawUrl.trim();
  if (!str) return null;

  if (!/^https?:\/\//i.test(str)) {
    str = `https://${str}`;
  }

  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(parsed.protocol)) return null;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return null;

  const host = hostname.replace(/^www\./, '');
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '';

  return {
    url: `${parsed.protocol}//${hostname}${pathname}${parsed.search}`,
    host,
  };
}

/**
 * Garde complète : normalisation puis anti-SSRF (isUrlAllowed).
 * @param {string} rawUrl
 * @returns {Promise<{ok: boolean, reason?: string, url?: string, host?: string}>}
 */
export async function guardUrl(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return { ok: false, reason: 'invalid_url' };
  }

  const check = await isUrlAllowed(normalized.url);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }

  return { ok: true, url: normalized.url, host: normalized.host };
}
