// Sonde hors réseau pour les lots L5/L6 : vérifie en isolation ce qui est
// testable sans crawler ni contacter de serveur.
//   node tests/l5l6-probe.mjs   (Node 22 : /opt/data/installs/node22/bin/node)

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Isolation : DB / reports / content dans un dossier temporaire ────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scanseo-l5l6-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.REPORTS_DIR = path.join(tmp, 'reports');
process.env.CONTENT_DIR = path.join(tmp, 'content');
process.env.SIGNING_SECRET = 'probe-secret-l5l6';
process.env.ADMIN_USER = 'admin';

// ── Hash bcrypt de référence (généré avant l'import de config) ───────────────
const bcrypt = await import('bcryptjs');
const PASSWORD = 'correct-horse-battery';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

// ── Imports dynamiques (config lit l'env au chargement) ──────────────────────
const { generateAuditToken, verifyAuditToken } = await import('../src/token.js');
const { checkRateLimit, clientIpHash } = await import('../src/ratelimit.js');
const { verifyAdminCredentials } = await import('../src/routes/admin.js');

const results = [];
function check(name, fn) {
  try {
    const ok = fn();
    results.push({ name, ok: ok === true });
    console.log(`${ok === true ? 'OK ' : 'KO '} ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`KO  ${name} — exception: ${err.message}`);
  }
}

// ── Test 1 : hash Basic Auth (bcryptjs.compare) ──────────────────────────────
check('Basic Auth : bon utilisateur + bon mot de passe → true', () => {
  return verifyAdminCredentials('admin', PASSWORD) === true;
});
check('Basic Auth : mauvais mot de passe → false', () => {
  return verifyAdminCredentials('admin', 'mauvais') === false;
});
check('Basic Auth : mauvais utilisateur → false', () => {
  return verifyAdminCredentials('intrus', PASSWORD) === false;
});
check('Basic Auth : identifiants vides → false', () => {
  return verifyAdminCredentials(null, null) === false;
});

// ── Test 2 : signature / validation des jetons ───────────────────────────────
const AUDIT_ID = '12345678-9abc-def0-1234-56789abcdef0';
const validToken = generateAuditToken(AUDIT_ID);

check('token : jeton valide accepté', () => {
  return verifyAuditToken(AUDIT_ID, validToken) === true;
});
check('token : jeton modifié (1 caractère) refusé', () => {
  const chars = validToken.split('');
  const idx = chars.length - 1;
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
  return verifyAuditToken(AUDIT_ID, chars.join('')) === false;
});
check('token : jeton d\'un autre audit refusé', () => {
  const other = generateAuditToken('00000000-0000-0000-0000-000000000000');
  return verifyAuditToken(AUDIT_ID, other) === false;
});
check('token : jeton vide refusé', () => {
  return verifyAuditToken(AUDIT_ID, '') === false;
});

// ── Test 3 : checkRateLimit (3 autorisés puis refus) ─────────────────────────
check('rate limit : 3 appels autorisés puis 4ᵉ refusé (max=3)', () => {
  const key = `probe:rl:${Date.now()}`;
  const opts = { max: 3, windowMs: 60000 };
  const r1 = checkRateLimit(key, opts);
  const r2 = checkRateLimit(key, opts);
  const r3 = checkRateLimit(key, opts);
  const r4 = checkRateLimit(key, opts);
  if (!r1.allowed || !r2.allowed || !r3.allowed) return false;
  if (r4.allowed) return false;
  if (typeof r4.resetAt !== 'number' || r4.resetAt <= Date.now()) return false;
  if (r3.remaining !== 0) return false;
  return true;
});

// ── Test 4 : clientIpHash (SHA-256 salé, jamais l'IP en clair) ───────────────
check('clientIpHash : 64 hex, déterministe, distinct par IP', () => {
  const h1 = clientIpHash({ ip: '203.0.113.7' });
  const h1bis = clientIpHash({ ip: '203.0.113.7' });
  const h2 = clientIpHash({ ip: '198.51.100.9' });
  if (!/^[0-9a-f]{64}$/.test(h1)) return false;
  if (h1 !== h1bis) return false;
  if (h1 === h2) return false;
  return true;
});

// ── Bilan ────────────────────────────────────────────────────────────────────
console.log('');
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`Résultat : ${passed}/${results.length} tests OK${failed ? `, ${failed} KO` : ''}`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
