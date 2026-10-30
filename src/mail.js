import nodemailer from 'nodemailer';
import { config } from './config.js';
import { getDb } from './db.js';
import { renderAdminAlertEmail } from './templates/emails.js';

let transporter = null;

export function getTransporter() {
  if (transporter) return transporter;

  if (!config.smtpUrl) {
    throw new Error('SMTP_URL is not configured');
  }

  transporter = nodemailer.createTransport(config.smtpUrl);
  return transporter;
}

export async function sendEmail({ to, kind, subject, text, html, auditId = null, attachments = [] }) {
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Enregistrement systématique en table emails
  const insert = db.prepare(`
    INSERT INTO emails (audit_id, to_addr, kind, status, attempts, created_at)
    VALUES (?, ?, ?, 'queued', 1, ?)
  `).run(auditId, to, kind, now);

  const emailId = insert.lastInsertRowid;

  try {
    const client = getTransporter();
    const info = await client.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      text,
      html,
      attachments
    });

    // 2. Succès réel attesté par le transporteur SMTP
    db.prepare(`
      UPDATE emails
      SET status = 'sent', sent_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), emailId);

    console.log(`[mail] Email ${kind} (${emailId}) envoyé avec succès à ${to.replace(/(.{2})(.*)(@.*)/, '$1***$3')} (id=${info.messageId})`);
    return { ok: true, emailId, messageId: info.messageId };
  } catch (err) {
    console.error(`[mail] Échec d'envoi email ${kind} (${emailId}) à ${to}:`, err.message);

    db.prepare(`
      UPDATE emails
      SET status = 'failed', error = ?
      WHERE id = ?
    `).run(err.message, emailId);

    // Déclenchement d'une alerte admin si l'email en échec n'est pas déjà une alerte
    if (kind !== 'admin_alert' && config.contactEmail && config.contactEmail !== to) {
      sendAdminAlert(`Échec d'envoi email ${kind} à ${to}`, {
        emailId,
        kind,
        to,
        error: err.message
      }).catch(() => {});
    }

    return { ok: false, emailId, error: err.message };
  }
}

export async function sendAdminAlert(title, details) {
  if (!config.contactEmail) return;
  const { subject, text, html } = renderAdminAlertEmail({ title, details });
  return sendEmail({
    to: config.contactEmail,
    kind: 'admin_alert',
    subject,
    text,
    html
  });
}
