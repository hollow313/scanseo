import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { verifyAuditToken } from '../token.js';
import { renderClientAudit, renderAuditNotFound } from '../views/client.js';

export const router = Router();

/** Retrouve un audit par token et vérifie que le token signé correspond à l'id. */
function findAuditByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const db = getDb();
  const audit = db.prepare('SELECT * FROM audits WHERE token = ?').get(token);
  if (!audit) return null;
  if (!verifyAuditToken(audit.id, token)) return null;
  return audit;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /audit/:token — espace client
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:token', (req, res) => {
  const audit = findAuditByToken(req.params.token);
  if (!audit) {
    return res.status(404).send(renderAuditNotFound());
  }
  res.status(200).send(renderClientAudit(audit, {}));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /audit/:token/brief — enregistre le brief, pending → queued
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:token/brief', (req, res) => {
  const audit = findAuditByToken(req.params.token);
  if (!audit) {
    return res.status(404).send(renderAuditNotFound());
  }

  const body = req.body || {};
  const activity = typeof body.activity === 'string' ? body.activity.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim() : '';

  let competitors = [];
  const rawCompetitors = body.competitors ?? body.competitor;
  if (Array.isArray(rawCompetitors)) {
    competitors = rawCompetitors;
  } else if (typeof rawCompetitors === 'string' && rawCompetitors.trim() !== '') {
    competitors = rawCompetitors.split(',').map((s) => s.trim()).filter(Boolean);
  }
  competitors = competitors.filter((c) => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim().slice(0, 200))
    .slice(0, 3);

  const error = validateBrief(activity, city);
  if (error) {
    return res.status(400).send(renderClientAudit(audit, { error }));
  }

  if (audit.status !== 'pending') {
    return res.status(400).send(renderClientAudit(audit, {
      error: 'Le brief a déjà été enregistré pour cet audit.',
    }));
  }

  const db = getDb();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE audits
      SET activity = ?, city = ?, competitors = ?, status = 'queued', needs_brief_at = NULL
      WHERE id = ?
    `).run(activity, city, JSON.stringify(competitors), audit.id);

    // Machine d'état : aucune transition sans événement.
    db.prepare(`
      INSERT INTO events (provider, webhook_id, type, payload, status, received_at, processed_at)
      VALUES ('internal', ?, 'brief_received', ?, 'processed', ?, ?)
    `).run(
      `brief:${audit.id}:${crypto.randomUUID()}`,
      JSON.stringify({ audit_id: audit.id, activity, city, competitors }),
      now,
      now
    );
  })();

  // PRG : re-render de la page avec confirmation.
  const updated = db.prepare('SELECT * FROM audits WHERE id = ?').get(audit.id);
  return res.status(200).send(renderClientAudit(updated, { briefJustSaved: true }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /audit/:token/rapport.pdf — sert le PDF si l'audit est livré
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:token/rapport.pdf', (req, res) => {
  const audit = findAuditByToken(req.params.token);
  if (!audit) {
    return res.status(404).send(renderAuditNotFound());
  }

  if (audit.status !== 'done' || !audit.pdf_path) {
    return res.status(404).send(renderAuditNotFound());
  }

  // Garde de chemin : le PDF ne peut être servi que depuis reportsDir.
  const reportsRoot = path.resolve(config.reportsDir);
  const pdfPath = path.resolve(audit.pdf_path);
  if (!pdfPath.startsWith(reportsRoot + path.sep) && pdfPath !== reportsRoot) {
    return res.status(404).send(renderAuditNotFound());
  }

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send(renderAuditNotFound());
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="audit-${audit.host}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(pdfPath).pipe(res);
});

function validateBrief(activity, city) {
  if (!activity) return 'Merci d\'indiquer votre activité.';
  if (!city) return 'Merci d\'indiquer votre ville.';
  return null;
}

export default router;
