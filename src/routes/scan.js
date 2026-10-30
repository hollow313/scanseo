import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { clientIpHash, checkRateLimit } from '../ratelimit.js';
import { guardUrl } from '../urlguard.js';
import { sendEmail } from '../mail.js';

export const router = Router();

const SCAN_RATE_MAX = 3;
const SCAN_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 h
const TEASER_REUSE_MS = 24 * 60 * 60 * 1000; // 24 h
const TEASER_MAX_PAGES = 6;

// Tâches de scan en mémoire (état vivant tant que le processus tourne).
const jobs = new Map();

const SEVERITY_WEIGHT = { bloquant: 5, critique: 4, majeur: 3, mineur: 2, informatif: 1 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scan — teaser gratuit (tâche de fond, réponse immédiate 202)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const body = req.body || {};
  const rawUrl = typeof body.url === 'string' ? body.url : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!rawUrl.trim()) {
    return res.status(400).json({ error: 'url_required' });
  }

  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  // Anti-SSRF + normalisation (message générique, jamais de détail réseau).
  const guarded = await guardUrl(rawUrl);
  if (!guarded.ok) {
    return res.status(400).json({ error: 'url_not_allowed' });
  }

  const db = getDb();
  const ipHash = clientIpHash(req);

  // Rate limit : 3 analyses / heure / IP.
  const rl = checkRateLimit(`scan:${ipHash}`, { max: SCAN_RATE_MAX, windowMs: SCAN_RATE_WINDOW_MS });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: 'rate_limited' });
  }

  // 1 résultat réutilisé 24 h par host : renvoie le teaser déjà calculé.
  const cached = db.prepare(`
    SELECT id, score, result_json FROM teasers
    WHERE host = ? AND score IS NOT NULL AND result_json IS NOT NULL
      AND datetime(created_at) > datetime('now', '-24 hours')
    ORDER BY id DESC LIMIT 1
  `).get(guarded.host);

  if (cached) {
    return res.status(202).json({ ok: true, id: String(cached.id), cached: true });
  }

  const now = new Date().toISOString();

  // Enregistrement teaser (état en attente) + lead (email optionnel).
  const ins = db.prepare(`
    INSERT INTO teasers (url, host, email, ip_hash, score, result_json, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?)
  `).run(guarded.url, guarded.host, email || null, ipHash, now);
  const teaserId = ins.lastInsertRowid;

  if (email) {
    db.prepare(`
      INSERT INTO leads (email, source, consent_at, created_at)
      VALUES (?, 'teaser', ?, ?)
      ON CONFLICT(email) DO NOTHING
    `).run(email, now, now);
  }

  const id = String(teaserId);
  jobs.set(id, { status: 'queued' });
  // Tâche de fond : ne bloque jamais la réponse HTTP.
  runTeaserScan(id, guarded.url, guarded.host, email).catch((err) => {
    console.error(`[scan] tâche teaser ${id} : erreur inattendue`, err);
  });

  return res.status(202).json({ ok: true, id });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scan/:id — statut du teaser
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) {
    return res.status(404).json({ error: 'not_found' });
  }

  const job = jobs.get(id);
  if (job) {
    if (job.status === 'done') {
      return res.json({ status: 'done', score: job.score, top3: job.top3 });
    }
    if (job.status === 'error') {
      return res.json({ status: 'error', error: job.error || 'scan_failed' });
    }
    return res.json({ status: job.status });
  }

  // Tâche absente de la mémoire (redémarrage) : on relit la base.
  const db = getDb();
  const teaser = db.prepare('SELECT id, score, result_json FROM teasers WHERE id = ?').get(Number(id));
  if (!teaser) {
    return res.status(404).json({ error: 'not_found' });
  }

  const result = parseResult(teaser.result_json);
  if (result.error) {
    return res.json({ status: 'error', error: result.error });
  }
  if (teaser.score != null) {
    return res.json({ status: 'done', score: teaser.score, top3: result.top3 });
  }
  return res.json({ status: 'queued' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tâche de fond : collect() (6 pages max) + runChecks(), LLM gratuit optionnel.
// Les modules du pipeline sont importés dynamiquement : leur absence (écriture
// en parallèle) ou leur échec ne fait jamais planter la route, on dégrade proprement.
// ─────────────────────────────────────────────────────────────────────────────
async function runTeaserScan(id, url, host, email) {
  const job = { status: 'running' };
  jobs.set(id, job);

  try {
    // Import dynamique : lève une erreur propre si src/crawl.js est absent.
    const { collect } = await import('../crawl.js');
    const { runChecks } = await import('../checks.js');

    const audit = {
      id,
      url,
      host,
      offer: 'teaser',
      activity: null,
      city: null,
      competitors: null,
      lang: 'fr',
    };

    const facts = await collect(audit, { maxPages: TEASER_MAX_PAGES, onProgress: () => {} });
    const result = runChecks(facts);

    const score = result?.score?.global ?? null;
    const top3 = buildTop3(result);

    // LLM gratuit (texte prêt) : optionnel, jamais bloquant.
    let textePret = null;
    try {
      const { analyze } = await import('../analyze.js');
      const out = await analyze(facts, {
        offer: 'audit_49',
        model: config.deepseekModelFree,
        fallbackFindings: result?.findings || [],
      });
      textePret = out?.report?.textes_prets?.[0] || null;
    } catch (err) {
      console.warn(`[scan] texte prêt indisponible pour ${host} :`, err?.message || err);
    }

    const stored = JSON.stringify({ score, top3, textePret });
    const db = getDb();
    db.prepare('UPDATE teasers SET score = ?, result_json = ? WHERE id = ?').run(score, stored, Number(id));

    job.status = 'done';
    job.score = score;
    job.top3 = top3;
    jobs.set(id, job);

    if (email) {
      sendTeaserEmail(email, url, host, score, top3, textePret).catch((err) => {
        console.error(`[scan] email teaser en échec pour ${host} :`, err?.message || err);
      });
    }
  } catch (err) {
    console.error(`[scan] échec du teaser ${id} (${host}) :`, err?.message || err);
    job.status = 'error';
    job.error = 'scan_failed'; // générique, jamais de détail réseau
    jobs.set(id, job);

    try {
      const db = getDb();
      db.prepare('UPDATE teasers SET result_json = ? WHERE id = ?')
        .run(JSON.stringify({ error: 'scan_failed' }), Number(id));
    } catch (e) {
      /* base indisponible : l'état vit en mémoire */
    }
  }
}

function buildTop3(result) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const labelByCode = {};
  for (const c of result?.catalogue || []) {
    if (c && c.code) labelByCode[c.code] = c.label;
  }

  return [...findings]
    .sort((a, b) => (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0))
    .slice(0, 3)
    .map((f) => ({
      code: f.code,
      label: labelByCode[f.code] || f.code,
      severity: f.severity,
      evidence: typeof f.evidence === 'string' ? f.evidence.slice(0, 200) : null,
    }));
}

async function sendTeaserEmail(email, url, host, score, top3, textePret) {
  const problems = (top3 || [])
    .map((f, i) => `${i + 1}. ${f.label}`)
    .join('\n');

  const offerUrl = `${config.publicBaseUrl}/tarifs`;
  const subject = `Votre analyse SEO gratuite de ${host} : ${score != null ? `${score}/100` : 'terminée'}`;

  const text = `Bonjour,\n\nVoici le résultat de l'analyse gratuite de ${url} :\n\nScore global : ${score != null ? `${score}/100` : '—'}\n\nLes 3 points à corriger en priorité :\n${problems}\n\nPour obtenir le rapport complet (25 à 100 pages, textes prêts à coller, plan d'action) :\n${offerUrl}\n\nÀ bientôt,\nL'équipe ScanSEO`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:24px;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;">
    <h1 style="color:#0284c7;font-size:22px;margin-top:0;">Votre analyse gratuite</h1>
    <p>Bonjour,</p>
    <p>Voici le résultat de l'analyse de <strong>${escapeHtml(url)}</strong> :</p>
    <p style="font-size:28px;font-weight:800;color:#0284c7;margin:16px 0;">${score != null ? `${score}/100` : '—'}</p>
    <p>Les 3 points à corriger en priorité :</p>
    <ol style="padding-left:20px;margin:12px 0;">${(top3 || []).map((f) => `<li>${escapeHtml(f.label)}</li>`).join('')}</ol>
    <div style="margin:28px 0;text-align:center;">
      <a href="${escapeHtml(offerUrl)}" style="background:#0284c7;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;border-radius:6px;display:inline-block;">Obtenir mon rapport complet</a>
    </div>
    <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="font-size:12px;color:#94a3b8;margin-bottom:0;">ScanSEO — Loïc Huon EI, Toulouse. Répondez à cet email pour toute question.</p>
  </div>
</body>
</html>`;

  await sendEmail({ to: email, kind: 'teaser', subject, text, html });
}

function parseResult(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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
