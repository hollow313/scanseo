import { renderPage } from './layout.js';
import { config } from '../config.js';
import { hasReaudit } from '../offers.js';
import { frDateTime } from '../format.js';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const OFFER_LABELS = {
  audit_29: 'Audit SEO (29 € TTC)',
  audit_59: 'Audit complet (59 € TTC)',
  audit_49: 'Audit SEO (49 € TTC)',
  audit_149: 'Audit complet (149 € TTC)',
};

function offerLabel(offer) {
  return OFFER_LABELS[offer] || 'Audit SEO';
}

/**
 * Page espace client. Deux états :
 *  - brief manquant (activity absent) → formulaire 3 questions
 *  - brief présent → avancement + score + bouton PDF si livré
 * @param {object} audit
 * @param {{error?: string, briefJustSaved?: boolean}} opts
 */
export function renderClientAudit(audit, opts = {}) {
  const briefMissing = !audit.activity;
  const content = briefMissing
    ? renderBriefForm(audit, opts)
    : renderAuditStatus(audit, opts);

  return renderPage({
    title: `Audit de ${escapeHtml(audit.host)} — ScanSEO`,
    description: 'Suivi de votre audit SEO ScanSEO.',
    content,
    path: '/audit',
  });
}

function renderBriefForm(audit, opts = {}) {
  const existingCompetitors = safeParseArray(audit.competitors);
  const competitorsInputs = [0, 1, 2]
    .map((i) => {
      const value = existingCompetitors[i] || '';
      return `<input class="form-input" type="text" name="competitors" value="${escapeHtml(value)}"
        placeholder="Concurrent ${i + 1} (optionnel)" maxlength="200" style="margin-bottom:0.5rem;">`;
    })
    .join('');

  const errorHtml = opts.error
    ? `<div class="alert-box" style="border-color:var(--danger);background:rgba(239,68,68,0.1);color:#fecaca;" role="alert">${escapeHtml(opts.error)}</div>`
    : '';

  return `
    <div class="content-box">
      <h1>Personnalisez votre audit</h1>
      <p>Pour produire des recommandations et des textes prêts à coller vraiment adaptés, répondez à ces 3 questions. L'analyse de <strong>${escapeHtml(audit.host)}</strong> démarrera dès validation.</p>
      ${errorHtml}
      <form method="post" action="/audit/${escapeHtml(audit.token)}/brief" style="margin-top:1.5rem;display:flex;flex-direction:column;gap:1rem;">
        <div class="form-group">
          <label class="form-label" for="activity">1. Quelle est votre activité ?</label>
          <input class="form-input" id="activity" name="activity" type="text" required maxlength="200"
            placeholder="Ex : plombier, boulangerie, cabinet d'ostéopathie…" value="">
        </div>
        <div class="form-group">
          <label class="form-label" for="city">2. Dans quelle ville exercez-vous ?</label>
          <input class="form-input" id="city" name="city" type="text" required maxlength="120"
            placeholder="Ex : Toulouse" value="">
        </div>
        <div class="form-group">
          <label class="form-label">3. Vos 3 principaux concurrents (optionnel)</label>
          ${competitorsInputs}
        </div>
        <div>
          <button type="submit" class="btn">Lancer mon audit</button>
        </div>
      </form>
    </div>
  `;
}

function renderAuditStatus(audit, opts = {}) {
  const phases = [
    { key: 'collecte', label: 'Collecte des pages' },
    { key: 'redaction', label: 'Rédaction du rapport' },
    { key: 'rendu', label: 'Mise en page du PDF' },
    { key: 'livre', label: 'Livraison par email' },
  ];

  // Mapping du statut DB vers l'étape atteinte.
  let reached = 0;
  let label = 'En attente de traitement';
  if (audit.status === 'running') {
    reached = 1;
    label = 'Analyse en cours';
  } else if (audit.status === 'done') {
    reached = 4;
    label = 'Livré';
  } else if (audit.status === 'failed') {
    reached = 0;
    label = 'Analyse en échec';
  } else if (audit.status === 'refunded') {
    reached = 0;
    label = 'Commande remboursée';
  }

  const steps = phases
    .map((p, i) => {
      const done = i < reached;
      const icon = done ? '✓' : i + 1;
      return `<li style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;
          background:${done ? 'var(--success)' : 'var(--border)'};color:${done ? '#0f172a' : 'var(--text-muted)'};
          font-weight:700;flex-shrink:0;">${icon}</span>
        <span style="color:${done ? 'var(--text)' : 'var(--text-muted)'};">${p.label}</span>
      </li>`;
    })
    .join('');

  let statusExtra = '';
  if (audit.status === 'failed') {
    statusExtra = `<p style="color:#fecaca;">Notre équipe a été alertée et va reprendre votre analyse. Vous serez prévenu par email.</p>`;
  } else if (audit.status === 'refunded') {
    statusExtra = `<p>Votre commande a été remboursée. Aucune analyse ne sera effectuée.</p>`;
  } else if (audit.status === 'done') {
    // Re-audit de contrôle : inclus dans l'offre complète, pendant 90 jours.
    let reaudit = '';
    if (hasReaudit(audit.offer)) {
      const jours = audit.finished_at
        ? Math.floor((Date.now() - new Date(audit.finished_at).getTime()) / 86_400_000)
        : null;
      const reste = jours == null ? null : Math.max(0, 90 - jours);
      if (audit.reaudit_child_token) {
        reaudit = `<div class="alert-box">Votre re-audit de contrôle a déjà été lancé :
          <a href="/audit/${escapeHtml(audit.reaudit_child_token)}">voir le nouveau rapport</a>.</div>`;
      } else if (reste != null && reste > 0) {
        reaudit = `
          <div class="alert-box">
            <p><strong>Re-audit de contrôle inclus</strong> — vous pouvez relancer l'analyse de ce site
            gratuitement pendant encore ${escapeHtml(reste)} jour${reste > 1 ? 's' : ''},
            après avoir appliqué les corrections du rapport.</p>
            <form method="POST" action="/audit/${escapeHtml(audit.token)}/relance" style="margin:0.6rem 0 0">
              <button class="btn" type="submit">Lancer mon re-audit gratuit</button>
            </form>
          </div>`;
      } else {
        reaudit = '<p style="color:var(--text-muted);">Le délai de re-audit inclus (90 jours) est dépassé.</p>';
      }
    }

    statusExtra = `
      ${audit.score != null ? `<p style="font-size:1.1rem;">Score global : <strong style="color:var(--primary);font-size:1.6rem;">${escapeHtml(audit.score)}/100</strong></p>` : ''}
      <p><a class="btn" href="/audit/${escapeHtml(audit.token)}/rapport.pdf" download>📄 Télécharger mon rapport PDF</a></p>
      ${reaudit}
    `;
  }

  const savedNote = opts.briefJustSaved
    ? `<div class="alert-box">Merci, vos réponses sont enregistrées. Votre analyse démarre.</div>`
    : '';

  return `
    <div class="content-box">
      <h1>Audit de ${escapeHtml(audit.host)}</h1>
      <p style="color:var(--text-muted);">Offre : ${offerLabel(audit.offer)} · Créé le ${escapeHtml(frDateTime(audit.created_at))}</p>
      ${savedNote}
      <div style="margin:1.5rem 0;">
        <p style="font-weight:600;">Statut : <span style="color:var(--primary);">${escapeHtml(label)}</span></p>
        <ul style="list-style:none;padding:0;margin-top:0.75rem;">${steps}</ul>
      </div>
      ${statusExtra}
      <p style="margin-top:1.5rem;color:var(--text-muted);font-size:0.9rem;">Votre rapport complet vous est envoyé par email (${escapeHtml(config.contactEmail)}) dès sa finalisation.</p>
    </div>
  `;
}

export function renderAuditNotFound() {
  return renderPage({
    title: 'Audit introuvable — ScanSEO',
    description: 'Lien invalide ou expiré.',
    content: '<div class="content-box"><h1>Audit introuvable</h1><p>Ce lien d\'accès est invalide ou expiré.</p></div>',
    path: '/audit',
  });
}

function safeParseArray(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
