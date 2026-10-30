import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export const UA = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  scanseo: 'ScanSEO/1.0 (+https://scanseo.fr/bot)',
  curl: 'curl/8.5.0',
};

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);
const FORBIDDEN_HOSTS = [/^localhost$/i, /\.local$/i, /\.internal$/i, /\.lan$/i, /^metadata\./i];

/** Convertit une IPv4 en entier non signé. */
function v4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
].map(([base, bits]) => ({ base: v4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

export function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true; // inconnu = refusé
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(({ base, mask }) => (n & mask) >>> 0 === (base & mask) >>> 0);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true;          // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(v6)) return true;         // fe80::/10 link local
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (v6.startsWith('::ffff:')) {
    // forme hexadécimale mappée : ::ffff:7f00:1
    const hex = v6.slice(7).split(':');
    if (hex.length === 2) {
      const hi = parseInt(hex[0], 16) || 0;
      const lo = parseInt(hex[1], 16) || 0;
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

/** Vérifie une URL AVANT toute requête : schéma, forme, port, hôte, résolution DNS. */
export async function isUrlAllowed(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'bad_scheme' };
  if (rawUrl.length > 2048) return { ok: false, reason: 'too_long' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, reason: 'no_host' };
  if (FORBIDDEN_HOSTS.some((re) => re.test(host))) return { ok: false, reason: 'forbidden_host' };
  const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: 'bad_port' };
  if (net.isIP(host) && isPrivateIp(host)) return { ok: false, reason: 'private_ip' };

  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns_error' };
  }
  if (!addrs.length) return { ok: false, reason: 'dns_error' };
  if (addrs.some((a) => isPrivateIp(a.address))) return { ok: false, reason: 'private_ip' };
  return { ok: true, addresses: addrs.map((a) => a.address), port, host };
}

/** lookup undici : refuse la connexion si une seule adresse résolue est privée. */
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : (options || {});
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (!list.length) return callback(Object.assign(new Error('dns_error'), { code: 'EURLFORBIDDEN' }));
    if (list.some((a) => isPrivateIp(a.address))) {
      return callback(Object.assign(new Error('adresse privée refusée'), { code: 'EURLFORBIDDEN' }));
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const agents = {
  // une seule instance : le garde s'applique à chaque hop de redirection
  default: new Agent({
    connect: { lookup: guardedLookup, timeout: 20000 },
    maxRedirections: 5,
    headersTimeout: 20000,
    bodyTimeout: 20000,
  }),
};

export class FetchError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/**
 * Requête HTTP protégée : URL validée, résolution filtrée, taille bornée.
 * @returns {Promise<{status:number,url:string,headers:object,body:Buffer,text:string,bytes:number,elapsedMs:number,truncated:boolean}>}
 */
export async function safeFetch(url, { headers = {}, timeoutMs = 20000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const check = await isUrlAllowed(url);
  if (!check.ok) throw new FetchError('EURLFORBIDDEN', `url refusée: ${check.reason}`);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await undiciFetch(url, {
      dispatcher: agents.default,
      redirect: 'follow',
      headers: {
        'user-agent': UA.scanseo,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5',
        ...headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.code === 'EURLFORBIDDEN' || /adresse privée/i.test(err?.message || '')) {
      throw new FetchError('EURLFORBIDDEN', 'redirection vers une adresse privée');
    }
    if (err?.name === 'AbortError') throw new FetchError('ETIMEOUT', 'timeout');
    throw new FetchError('ENETWORK', err?.message || 'network error');
  }

  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) {
        truncated = true;
        chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (total - maxBytes))));
        controller.abort();
        break;
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (!truncated && err?.name !== 'AbortError') throw new FetchError('ENETWORK', err?.message || 'read error');
  } finally {
    clearTimeout(timer);
  }

  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const enc = res.headers.get('content-encoding') || '';
  const text = enc.includes('gzip') || enc.includes('br')
    ? '' // contenu compressé : undici décompresse déjà, on repart du corps brut
    : body.toString('utf8');

  return {
    status: res.status,
    url: res.url || url,
    headers: Object.fromEntries(res.headers.entries()),
    body,
    text: text || body.toString('utf8'),
    bytes: body.length,
    elapsedMs: Date.now() - started,
    truncated,
  };
}

/** Concurrence bornée, ordre des résultats conservé. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
