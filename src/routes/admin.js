import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { getDb, getSystemKv } from '../db.js';
import { clientIpHash, checkRateLimit } from '../ratelimit.js';
import { generateAuditToken } from '../token.js';
import { normalizeUrl } from '../urlguard.js';
import { sendEmail } from '../mail.js';
import { checkHealth } from '../health.js';
import { renderBriefEmail } from '../templates/emails.js';
import {
  renderDashboard,
  renderAuditList,
  renderAuditDetail,
  renderLeads,
  renderCreateAudit,
  renderSystem,
} from '../views/admin.js';

export const router = Router();

const AUTH_RATE_MAX = 5;
const AUTH_RATE_WINDOW_MS = 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Authentification Basic Auth (bcrypt, comparaison à temps constant)
// ─────────────────────────────────────────────────────────────────────────────
export function verifyAdminCredentials(user, password) {
  if (!user || !password) return false;
  if (!config.adminUser || !config.adminPasswordHash) return false;

  const userBuf = Buffer.from(String(user), 'utf8');
  const expectedBuf = Buffer.from(config.adminUser, 'utf8');
  if (userBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(userBuf, expectedBuf)) return false;

  try {
    return bcrypt.compareSync(String(password), config.adminPasswordHash);
  } catch {
    return false;
  }
}

function parseBasicAuth(req) {
  const header = req.headers.authorization || '';
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const creds = parseBasicAuth(req);
  if (creds && verifyAdminCredentials(creds.user, creds.pass)) {
    return next();
  }

  // Rate limit sur les tentatives d'authentification (5/min/IP).
  const rl = checkRateLimit(`admin:${clientIpHash(req)}`, {
    max: AUTH_RATE_MAX,
    windowMs: AUTH_RATE_WINDOW_MS,
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))));
    return res.status(429).send('Trop de tentatives. Réessayez dans une minute.');
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="ScanSEO admin", charset="UTF-8"');
  return res.status(401).send('Authentification requise');
}

// En-tête noindex sur l'ensemble de l'admin.
router.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Assets personnalisés depuis /content/admin (logo.svg, admin.css).
router.get('/custom/:file(*)', serveCustomAsset);

// Tout le reste est protégé.
router.use(requireAdmin);

// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();

  const audits7d = db.prepare(`
    SELECT COUNT(*) AS n FROM audits WHERE datetime(created_at) > datetime('now', '-7 days')
  `).get().n;

  const avg = db.prepare(`
    SELECT AVG(duration_ms) AS avg_ms FROM audits
    WHERE status = 'done' AND duration_ms IS NOT NULL
  `).get().avg_ms;

  const total7d = db.prepare(`
    SELECT COUNT(*) AS n FROM audits WHERE datetime(created_at) > datetime('now', '-7 days')
  `).get().n;
  const failed7d = db.prepare(`
    SELECT COUNT(*) AS n FROM audits
    WHERE status = 'failed' AND datetime(created_at) > datetime('now', '-7 days')
  `).get().n;

  const llmCostMonth = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS total FROM audits
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get().total;

  const recentFailedEvents = db.prepare(`
    SELECT webhook_id, type, status, last_error, received_at FROM events
    WHERE status = 'failed'
    ORDER BY received_at DESC LIMIT 10
  `).all();

  const recentAudits = db.prepare(`
    SELECT a.*, o.email AS order_email FROM audits a
    LEFT JOIN orders o ON o.id = a.order_id
    ORDER BY a.created_at DESC LIMIT 10
  `).all();

  const queue = getQueueCounts(db);

  const body = renderDashboard({
    audits7d,
    avgDuration: avg != null ? (avg / 60000).toFixed(1) : '—',
    failureRate: total7d > 0 ? `${Math.round((failed7d / total7d) * 100)}%` : '—',
    llmCostMonth: `$${Number(llmCostMonth).toFixed(2)}`,
    recentFailedEvents,
    recentAudits,
    queue,
  });
  res.status(200).send(body);
});

// ─────────────────────────────────────────────────────────────────────────────
// Liste des audits
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audits', (req, res) => {
  const db = getDb();
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
  const offerFilter = typeof req.query.offer === 'string' ? req.query.offer : '';

  const where = [];
  const params = [];
  if (statusFilter) { where.push('a.status = ?'); params.push(statusFilter); }
  if (offerFilter) { where.push('a.offer = ?'); params.push(offerFilter); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const audits = db.prepare(`
    SELECT a.*, o.email AS order_email FROM audits a
    LEFT JOIN orders o ON o.id = a.order_id
    ${whereSql}
    ORDER BY a.created_at DESC LIMIT 500
  `).all(...params);

  res.status(200).send(renderAuditList({ audits, statusFilter, offerFilter }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Détail d'un audit
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audits/:id', (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(req.params.id);
  if (!audit) {
    return res.status(404).send('Audit introuvable');
  }

  const pages = db.prepare(`
    SELECT url, http_status, word_count, h1_count, ttfb_ms FROM pages
    WHERE audit_id = ? ORDER BY id LIMIT 500
  `).all(audit.id);

  const findings = db.prepare(`
    SELECT code, pillar, severity, evidence, deterministic FROM findings
    WHERE audit_id = ? ORDER BY id LIMIT 500
  `).all(audit.id);

  const errors = [];
  if (audit.error) errors.push(`Audit : ${audit.error}`);
  const failedEmails = db.prepare(`
    SELECT kind, error FROM emails WHERE audit_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 10
  `).all(audit.id);
  for (const e of failedEmails) errors.push(`Email ${e.kind} : ${e.error}`);

  const reportJson = readReportJson(audit);

  res.status(200).send(renderAuditDetail({ audit, pages, findings, errors, reportJson }));
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF (téléchargement admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audits/:id/pdf', (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(req.params.id);
  if (!audit || !audit.pdf_path) {
    return res.status(404).send('PDF introuvable');
  }
  const pdfPath = resolveInsideReports(audit.pdf_path);
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return res.status(404).send('PDF introuvable');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${audit.host}.pdf"`);
  fs.createReadStream(pdfPath).pipe(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// Actions : renvoyer l'email / relancer / rembourser / supprimer
// ─────────────────────────────────────────────────────────────────────────────
router.post('/audits/:id/resend-email', async (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT a.*, o.email AS order_email FROM audits a LEFT JOIN orders o ON o.id = a.order_id WHERE a.id = ?').get(req.params.id);
  if (!audit) return res.status(404).send('Audit introuvable');

  const to = audit.order_email || req.body.email;
  if (!to) {
    return res.redirect(302, `/admin/audits/${audit.id}?error=no_email`);
  }

  const now = new Date().toISOString();

  if (audit.status === 'done' && audit.pdf_path) {
    const pdfPath = resolveInsideReports(audit.pdf_path);
    const attachments = (pdfPath && fs.existsSync(pdfPath))
      ? [{ filename: `audit-${audit.host}.pdf`, path: pdfPath, contentType: 'application/pdf' }]
      : [];

    const subject = `Votre audit SEO de ${audit.host} est prêt`;
    const text = `Bonjour,\n\nVotre audit SEO de ${audit.url} est terminé (score ${audit.score != null ? `${audit.score}/100` : '—'}).\n\nLe rapport complet est en pièce jointe, et reste disponible ici :\n${config.publicBaseUrl}/audit/${audit.token}\n\nSi vous préférez que ces corrections soient appliquées, répondez à cet email.\n\nÀ bientôt,\nL'équipe ScanSEO`;
    const html = `<html><body style="font-family:sans-serif;line-height:1.6;padding:24px;">
      <h1 style="color:#0284c7;">Votre audit SEO est prêt</h1>
      <p>Votre rapport de l'audit de <strong>${escapeHtml(audit.url)}</strong> est terminé (score ${audit.score != null ? `${audit.score}/100` : '—'}).</p>
      <p>Le PDF est en pièce jointe et reste accessible sur votre espace :</p>
      <p><a href="${escapeHtml(config.publicBaseUrl + '/audit/' + audit.token)}">Mon espace client</a></p>
      <p>Si vous préférez que ces corrections soient appliquées, répondez à cet email.</p>
    </body></html>`;

    await sendEmail({ to, kind: 'delivery', auditId: audit.id, subject, text, html, attachments });
  } else {
    const { subject, text, html } = renderBriefEmail({
      token: audit.token,
      auditUrl: `${config.publicBaseUrl}/audit/${audit.token}`,
      siteUrl: audit.url,
    });
    await sendEmail({ to, kind: 'brief', auditId: audit.id, subject, text, html });
  }

  db.prepare('UPDATE audits SET needs_brief_at = ? WHERE id = ?').run(now, audit.id);
  return res.redirect(302, `/admin/audits/${audit.id}`);
});

router.post('/audits/:id/retry', (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT id FROM audits WHERE id = ?').get(req.params.id);
  if (!audit) return res.status(404).send('Audit introuvable');

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE audits SET status = 'queued', attempts = 0, error = NULL, claimed_at = NULL WHERE id = ?").run(audit.id);
    db.prepare(`
      INSERT INTO events (provider, webhook_id, type, payload, status, received_at, processed_at)
      VALUES ('internal', ?, 'audit_retry', ?, 'processed', ?, ?)
    `).run(`retry:${audit.id}:${crypto.randomUUID()}`, JSON.stringify({ audit_id: audit.id }), now, now);
  })();

  return res.redirect(302, `/admin/audits/${audit.id}`);
});

router.post('/audits/:id/refund', (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT id, order_id FROM audits WHERE id = ?').get(req.params.id);
  if (!audit) return res.status(404).send('Audit introuvable');

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE audits SET status = 'refunded' WHERE id = ?").run(audit.id);
    if (audit.order_id) {
      db.prepare("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?").run(now, audit.order_id);
    }
    db.prepare(`
      INSERT INTO events (provider, webhook_id, type, payload, status, received_at, processed_at)
      VALUES ('internal', ?, 'audit_refunded', ?, 'processed', ?, ?)
    `).run(`refund:${audit.id}:${crypto.randomUUID()}`, JSON.stringify({ audit_id: audit.id }), now, now);
  })();

  return res.redirect(302, `/admin/audits/${audit.id}`);
});

router.post('/audits/:id/delete', (req, res) => {
  const db = getDb();
  const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(req.params.id);
  if (!audit) return res.status(404).send('Audit introuvable');

  db.transaction(() => {
    db.prepare('DELETE FROM emails WHERE audit_id = ?').run(audit.id);
    db.prepare('DELETE FROM audits WHERE id = ?').run(audit.id); // pages/findings en cascade
  })();

  // Suppression du dossier /reports/<id>
  const dir = getReportDir(audit);
  if (dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[admin] suppression dossier ${dir} en échec :`, e.message);
    }
  }

  console.log(`[admin] audit ${audit.id} supprimé (${audit.host})`);
  return res.redirect(302, '/admin/audits');
});

// ─────────────────────────────────────────────────────────────────────────────
// Leads / teasers + export CSV
// ─────────────────────────────────────────────────────────────────────────────
router.get('/leads', (req, res) => {
  const db = getDb();
  const teasers = db.prepare('SELECT * FROM teasers ORDER BY id DESC LIMIT 500').all();
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 500').all();
  res.status(200).send(renderLeads({ teasers, leads }));
});

router.get('/leads.csv', (req, res) => {
  const db = getDb();
  const teasers = db.prepare('SELECT * FROM teasers ORDER BY id DESC').all();
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();

  const rows = [['type', 'date', 'url', 'host', 'score', 'email']];
  for (const t of teasers) {
    rows.push(['teaser', t.created_at, t.url, t.host, t.score != null ? String(t.score) : '', t.email || '']);
  }
  for (const l of leads) {
    rows.push(['lead', l.created_at, '', '', '', l.email]);
  }

  const csv = rows.map((r) => r.map((cell) => csvCell(cell)).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-teasers.csv"');
  res.status(200).send('\uFEFF' + csv);
});

// ─────────────────────────────────────────────────────────────────────────────
// Création manuelle d'un audit
// ─────────────────────────────────────────────────────────────────────────────
router.get('/create', (req, res) => {
  res.status(200).send(renderCreateAudit({}));
});

router.post('/create', async (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const rawSite = typeof body.site === 'string' ? body.site : '';
  const offer = body.offer === 'audit_149' ? 'audit_149' : 'audit_49';

  if (!rawSite.trim()) {
    return res.status(400).send(renderCreateAudit({ error: 'Le site est requis.', email, site: rawSite, offer }));
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).send(renderCreateAudit({ error: 'Adresse email invalide.', email, site: rawSite, offer }));
  }

  const normalized = normalizeUrl(rawSite);
  if (!normalized) {
    return res.status(400).send(renderCreateAudit({ error: 'URL invalide.', email, site: rawSite, offer }));
  }

  const db = getDb();
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const token = generateAuditToken(auditId);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO audits (id, order_id, token, url, host, offer, status, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, 'queued', ?)
    `).run(auditId, token, normalized.url, normalized.host, offer, now);

    db.prepare(`
      INSERT INTO events (provider, webhook_id, type, payload, status, received_at, processed_at)
      VALUES ('internal', ?, 'manual_create', ?, 'processed', ?, ?)
    `).run(`manual:${auditId}:${crypto.randomUUID()}`, JSON.stringify({ audit_id: auditId, email, url: normalized.url, offer }), now, now);
  })();

  if (email) {
    const { subject, text, html } = renderBriefEmail({
      token,
      auditUrl: `${config.publicBaseUrl}/audit/${token}`,
      siteUrl: normalized.url,
    });
    await sendEmail({ to: email, kind: 'brief', auditId, subject, text, html });
  }

  res.status(200).send(renderCreateAudit({ ok: true, okHost: normalized.host, okEmail: Boolean(email) }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Système
// ─────────────────────────────────────────────────────────────────────────────
router.get('/system', (req, res) => {
  const db = getDb();
  const { data: health } = checkHealth();

  const workerLastSeen = getSystemKv('worker_heartbeat');
  const lastSent = db.prepare(`
    SELECT sent_at FROM emails WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1
  `).get();
  const lastSentEmail = lastSent ? lastSent.sent_at : null;

  const contentState = listContentDirs();

  res.status(200).send(renderSystem({
    version: '0.1.0',
    health,
    workerLastSeen,
    lastSentEmail,
    contentState,
    disk: {
      data: diskUsage(config.dataDir),
      reports: diskUsage(config.reportsDir),
    },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function serveCustomAsset(req, res) {
  const file = req.params.file || '';
  const allowedExt = ['.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'];
  const ext = path.extname(file).toLowerCase();
  if (!allowedExt.includes(ext)) {
    return res.status(404).send('Not Found');
  }

  const base = path.resolve(path.join(config.contentDir, 'admin'));
  const target = path.resolve(path.join(base, file));
  if (!target.startsWith(base + path.sep)) {
    return res.status(404).send('Not Found');
  }
  if (!fs.existsSync(target)) {
    return res.status(404).send('Not Found');
  }

  const mime = {
    '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  }[ext];
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(target).pipe(res);
}

function getQueueCounts(db) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('pending','queued') THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM audits
  `).get();
  return {
    pending: Number(row.pending || 0),
    running: Number(row.running || 0),
    failed: Number(row.failed || 0),
  };
}

function resolveInsideReports(p) {
  const reportsRoot = path.resolve(config.reportsDir);
  const target = path.resolve(p);
  if (target.startsWith(reportsRoot + path.sep) || target === reportsRoot) {
    return target;
  }
  return null;
}

function getReportDir(audit) {
  if (audit.pdf_path) {
    const resolved = resolveInsideReports(audit.pdf_path);
    return resolved ? path.dirname(resolved) : null;
  }
  const reportsRoot = path.resolve(config.reportsDir);
  try {
    if (!fs.existsSync(reportsRoot)) return null;
    const id8 = audit.id.replace(/-/g, '').slice(0, 8);
    const dirs = fs.readdirSync(reportsRoot).filter((d) => d.endsWith(`_${id8}`));
    return dirs.length ? path.join(reportsRoot, dirs[0]) : null;
  } catch {
    return null;
  }
}

function readReportJson(audit) {
  const dir = getReportDir(audit);
  if (!dir) return null;
  try {
    const file = path.join(dir, 'rapport.json');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      return raw.slice(0, 200000);
    }
  } catch (e) { /* absent : non bloquant */ }
  return null;
}

function diskUsage(dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    const s = fs.statfsSync(dir);
    const block = s.bsize || 1;
    const total = s.blocks * block;
    const free = s.bavail * block;
    const used = total - free;
    return {
      used: humanBytes(used),
      free: humanBytes(free),
      total: humanBytes(total),
    };
  } catch {
    return null;
  }
}

function humanBytes(n) {
  if (n < 1024) return `${n} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let i = -1;
  let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

function listContentDirs() {
  try {
    if (!fs.existsSync(config.contentDir)) return null;
    const wanted = ['blog', 'pages', 'images', 'admin'];
    return wanted.filter((d) => fs.existsSync(path.join(config.contentDir, d)));
  } catch {
    return null;
  }
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
