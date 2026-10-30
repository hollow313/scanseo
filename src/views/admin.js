import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const NAV = [
  { href: '/admin', key: 'dashboard', label: 'Tableau de bord' },
  { href: '/admin/audits', key: 'audits', label: 'Audits' },
  { href: '/admin/leads', key: 'leads', label: 'Leads & teasers' },
  { href: '/admin/create', key: 'create', label: 'Créer un audit' },
  { href: '/admin/system', key: 'system', label: 'Système' },
];

const STATUS_BADGE = {
  pending: ['#eab308', 'pending'],
  queued: ['#38bdf8', 'queued'],
  running: ['#38bdf8', 'running'],
  done: ['#22c55e', 'done'],
  failed: ['#ef4444', 'failed'],
  refunded: ['#94a3b8', 'refunded'],
  expired: ['#94a3b8', 'expired'],
};

function badge(status) {
  const [color] = STATUS_BADGE[status] || ['#94a3b8', status];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}55;">${escapeHtml(status)}</span>`;
}

function adminCustomCss() {
  try {
    const cssPath = path.join(config.contentDir, 'admin', 'admin.css');
    if (fs.existsSync(cssPath)) return '<link rel="stylesheet" href="/admin/custom/admin.css">';
  } catch (e) { /* dossier absent : admin par défaut */ }
  return '';
}

function adminCustomLogo() {
  try {
    const logoPath = path.join(config.contentDir, 'admin', 'logo.svg');
    if (fs.existsSync(logoPath)) {
      return '<img src="/admin/custom/logo.svg" alt="logo" style="height:28px;">';
    }
  } catch (e) { /* absent : logo texte */ }
  return '<strong style="color:#38bdf8;">ScanSEO <span style="color:#94a3b8;">admin</span></strong>';
}

function renderAdminPage({ title, active, body }) {
  const nav = NAV.map((item) => {
    const cls = item.key === active ? 'nav-item active' : 'nav-item';
    return `<a class="${cls}" href="${item.href}">${item.label}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} — ScanSEO admin</title>
  <style>
    :root { --bg:#0b1220; --panel:#111a2e; --border:#1f2a44; --text:#e2e8f0; --muted:#8b9bb4; --accent:#38bdf8; --danger:#ef4444; --ok:#22c55e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:14px; line-height:1.5; }
    header { background:var(--panel); border-bottom:1px solid var(--border); padding:0.75rem 1.5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem; }
    nav { display:flex; gap:0.25rem; flex-wrap:wrap; }
    .nav-item { color:var(--muted); text-decoration:none; padding:0.4rem 0.75rem; border-radius:6px; font-size:0.9rem; }
    .nav-item:hover { color:var(--text); background:#1a2540; }
    .nav-item.active { color:var(--accent); background:#1a2540; }
    main { max-width:1200px; margin:0 auto; padding:1.5rem; }
    h1 { font-size:1.4rem; margin-bottom:1rem; }
    h2 { font-size:1.1rem; margin:1.5rem 0 0.75rem; }
    .panel { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:1.25rem; margin-bottom:1rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; margin-bottom:1rem; }
    .stat { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:1rem; }
    .stat .value { font-size:1.6rem; font-weight:800; color:var(--accent); }
    .stat .label { color:var(--muted); font-size:0.8rem; }
    table { width:100%; border-collapse:collapse; font-size:0.85rem; }
    th, td { text-align:left; padding:0.5rem 0.6rem; border-bottom:1px solid var(--border); vertical-align:top; }
    th { color:var(--muted); font-weight:600; white-space:nowrap; }
    a { color:var(--accent); }
    .btn { display:inline-block; background:var(--accent); color:#0b1220; font-weight:700; padding:0.4rem 0.7rem; border-radius:6px; text-decoration:none; font-size:0.8rem; border:none; cursor:pointer; }
    .btn.ghost { background:transparent; color:var(--accent); border:1px solid var(--accent); }
    .btn.danger { background:transparent; color:var(--danger); border:1px solid var(--danger); }
    .btn:hover { opacity:0.85; }
    .form-row { margin-bottom:0.9rem; }
    label { display:block; color:var(--muted); font-size:0.8rem; margin-bottom:0.3rem; }
    input, select { width:100%; padding:0.5rem 0.7rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.9rem; }
    .alert { background:var(--danger)18; border:1px solid var(--danger)55; color:#fecaca; border-radius:6px; padding:0.75rem 1rem; margin-bottom:1rem; }
    .ok { color:var(--ok); } .err { color:var(--danger); } .muted { color:var(--muted); }
    pre { background:#0b1220; border:1px solid var(--border); border-radius:6px; padding:0.75rem; overflow-x:auto; font-size:0.8rem; max-height:400px; overflow-y:auto; }
    .filters { display:flex; gap:0.5rem; margin-bottom:1rem; flex-wrap:wrap; align-items:center; }
    .filters select, .filters input { width:auto; min-width:140px; }
    .actions { display:flex; gap:0.35rem; flex-wrap:wrap; }
  </style>
  ${adminCustomCss()}
</head>
<body>
  <header>
    ${adminCustomLogo()}
    <nav>${nav}</nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord
// ─────────────────────────────────────────────────────────────────────────────
export function renderDashboard(data) {
  const body = `
    <h1>Tableau de bord</h1>
    <div class="grid">
      <div class="stat"><div class="value">${data.audits7d}</div><div class="label">Audits (7 jours)</div></div>
      <div class="stat"><div class="value">${data.avgDuration}</div><div class="label">Temps moyen (min)</div></div>
      <div class="stat"><div class="value">${data.failureRate}</div><div class="label">Taux d'échec</div></div>
      <div class="stat"><div class="value">${data.llmCostMonth}</div><div class="label">Coût LLM du mois</div></div>
    </div>

    <div class="panel">
      <h2>File actuelle</h2>
      <p><span class="muted">Pending :</span> ${data.queue.pending} ·
         <span class="muted">Running :</span> ${data.queue.running} ·
         <span class="muted">Failed :</span> ${data.queue.failed}</p>
    </div>

    <div class="panel">
      <h2>Derniers webhooks en erreur</h2>
      ${renderEventsTable(data.recentFailedEvents)}
    </div>

    <div class="panel">
      <h2>Audits récents</h2>
      ${renderAuditsTable(data.recentAudits, { compact: true })}
      <p style="margin-top:0.75rem;"><a href="/admin/audits">Voir tous les audits →</a></p>
    </div>
  `;
  return renderAdminPage({ title: 'Tableau de bord', active: 'dashboard', body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Liste des audits
// ─────────────────────────────────────────────────────────────────────────────
export function renderAuditList(data) {
  const statusOptions = ['pending', 'queued', 'running', 'done', 'failed', 'refunded', 'expired']
    .map((s) => `<option value="${s}" ${data.statusFilter === s ? 'selected' : ''}>${s}</option>`)
    .join('');
  const offerOptions = ['audit_49', 'audit_149', 'teaser']
    .map((o) => `<option value="${o}" ${data.offerFilter === o ? 'selected' : ''}>${o}</option>`)
    .join('');

  const body = `
    <h1>Audits</h1>
    <form class="filters" method="get" action="/admin/audits">
      <select name="status">
        <option value="">Tous les statuts</option>
        ${statusOptions}
      </select>
      <select name="offer">
        <option value="">Toutes les offres</option>
        ${offerOptions}
      </select>
      <button class="btn ghost" type="submit">Filtrer</button>
      ${(data.statusFilter || data.offerFilter) ? '<a class="btn ghost" href="/admin/audits">Réinitialiser</a>' : ''}
    </form>
    <div class="panel">
      ${renderAuditsTable(data.audits, { detail: true })}
    </div>
  `;
  return renderAdminPage({ title: 'Audits', active: 'audits', body });
}

function renderAuditsTable(audits, { compact = false, detail = false } = {}) {
  if (!audits.length) {
    return '<p class="muted">Aucun audit.</p>';
  }

  const rows = audits.map((a) => {
    const email = a.email || a.order_email || '—';
    const duration = a.duration_ms != null ? `${(a.duration_ms / 60000).toFixed(1)} min` : '—';
    const cost = a.cost_usd != null ? `$${Number(a.cost_usd).toFixed(2)}` : '—';
    const actions = detail
      ? `<div class="actions">
          <a class="btn ghost" href="/admin/audits/${escapeHtml(a.id)}">Voir</a>
          <a class="btn ghost" href="/admin/audits/${escapeHtml(a.id)}/pdf">PDF</a>
          <form method="post" action="/admin/audits/${escapeHtml(a.id)}/resend-email" style="display:inline;">
            <button class="btn ghost" type="submit">Renvoyer l'email</button>
          </form>
          <form method="post" action="/admin/audits/${escapeHtml(a.id)}/retry" style="display:inline;">
            <button class="btn ghost" type="submit">Relancer</button>
          </form>
          <form method="post" action="/admin/audits/${escapeHtml(a.id)}/refund" style="display:inline;"
                onsubmit="return confirm('Marquer cet audit remboursé ?');">
            <button class="btn ghost" type="submit">Remboursé</button>
          </form>
          <form method="post" action="/admin/audits/${escapeHtml(a.id)}/delete" style="display:inline;"
                onsubmit="return confirm('Supprimer définitivement cet audit et son dossier ?');">
            <button class="btn danger" type="submit">Supprimer</button>
          </form>
        </div>`
      : '';

    return `<tr>
      <td>${escapeHtml(String(a.created_at || '').slice(0, 16).replace('T', ' '))}</td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(a.host || '')}</td>
      <td>${escapeHtml(a.offer || '')}</td>
      <td>${badge(a.status)}</td>
      ${compact ? '' : `<td>${a.score != null ? `${a.score}/100` : '—'}</td><td>${duration}</td><td>${cost}</td>`}
      ${compact ? '' : `<td>${actions}</td>`}
    </tr>`;
  }).join('');

  const cols = compact
    ? '<tr><th>Date</th><th>Email</th><th>Site</th><th>Offre</th><th>Statut</th></tr>'
    : '<tr><th>Date</th><th>Email</th><th>Site</th><th>Offre</th><th>Statut</th><th>Score</th><th>Durée</th><th>Coût</th><th>Actions</th></tr>';

  return `<table><thead>${cols}</thead><tbody>${rows}</tbody></table>`;
}

function renderEventsTable(events) {
  if (!events || !events.length) {
    return '<p class="muted">Aucune erreur webhook récente.</p>';
  }
  const rows = events.map((e) => `<tr>
    <td>${escapeHtml(String(e.received_at || '').slice(0, 19).replace('T', ' '))}</td>
    <td>${escapeHtml(e.type || '')}</td>
    <td>${escapeHtml(e.webhook_id || '')}</td>
    <td class="err">${escapeHtml(e.last_error || e.status || '')}</td>
  </tr>`).join('');
  return `<table><thead><tr><th>Date</th><th>Type</th><th>Webhook ID</th><th>Erreur</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détail d'un audit
// ─────────────────────────────────────────────────────────────────────────────
export function renderAuditDetail(data) {
  const a = data.audit;
  const pagesRows = (data.pages || []).map((p) => `<tr>
    <td>${escapeHtml(p.url || '')}</td>
    <td>${p.http_status ?? '—'}</td>
    <td>${p.word_count ?? '—'}</td>
    <td>${p.h1_count ?? '—'}</td>
    <td>${p.ttfb_ms ?? '—'}</td>
  </tr>`).join('');

  const findingsRows = (data.findings || []).map((f) => `<tr>
    <td><code>${escapeHtml(f.code)}</code></td>
    <td>${escapeHtml(f.pillar)}</td>
    <td>${escapeHtml(f.severity)}</td>
    <td>${escapeHtml(f.evidence || '')}</td>
    <td>${f.deterministic ? 'code' : 'LLM'}</td>
  </tr>`).join('');

  const errorsList = (data.errors || []).map((e) => `<li>${escapeHtml(e)}</li>`).join('');
  const errorsHtml = errorsList ? `<div class="alert"><strong>Erreurs :</strong><ul style="padding-left:1.2rem;margin-top:0.5rem;">${errorsList}</ul></div>` : '';

  const body = `
    <h1>Audit ${escapeHtml(a.host)}</h1>
    <p><a href="/admin/audits">← Retour à la liste</a></p>
    ${errorsHtml}
    <div class="panel">
      <h2>Informations</h2>
      <table>
        <tr><td class="muted">ID</td><td>${escapeHtml(a.id)}</td></tr>
        <tr><td class="muted">URL</td><td>${escapeHtml(a.url)}</td></tr>
        <tr><td class="muted">Offre</td><td>${escapeHtml(a.offer)}</td></tr>
        <tr><td class="muted">Statut</td><td>${badge(a.status)}</td></tr>
        <tr><td class="muted">Score</td><td>${a.score != null ? `${a.score}/100` : '—'}</td></tr>
        <tr><td class="muted">Tokens in/out</td><td>${a.tokens_in ?? '—'} / ${a.tokens_out ?? '—'}</td></tr>
        <tr><td class="muted">Coût</td><td>${a.cost_usd != null ? `$${Number(a.cost_usd).toFixed(3)}` : '—'}</td></tr>
        <tr><td class="muted">Durée</td><td>${a.duration_ms != null ? `${(a.duration_ms / 60000).toFixed(1)} min` : '—'}</td></tr>
        <tr><td class="muted">Activité / Ville</td><td>${escapeHtml(a.activity || '—')} / ${escapeHtml(a.city || '—')}</td></tr>
        <tr><td class="muted">Créé le</td><td>${escapeHtml(a.created_at)}</td></tr>
      </table>
      <div class="actions" style="margin-top:0.75rem;">
        <a class="btn ghost" href="/admin/audits/${escapeHtml(a.id)}/pdf">Télécharger le PDF</a>
      </div>
    </div>

    <div class="panel">
      <h2>Pages collectées (${data.pages.length})</h2>
      ${pagesRows ? `<table><thead><tr><th>URL</th><th>HTTP</th><th>Mots</th><th>H1</th><th>TTFB (ms)</th></tr></thead><tbody>${pagesRows}</tbody></table>` : '<p class="muted">Aucune page.</p>'}
    </div>

    <div class="panel">
      <h2>Constats (${data.findings.length})</h2>
      ${findingsRows ? `<table><thead><tr><th>Code</th><th>Pilier</th><th>Gravité</th><th>Preuve</th><th>Source</th></tr></thead><tbody>${findingsRows}</tbody></table>` : '<p class="muted">Aucun constat.</p>'}
    </div>

    <div class="panel">
      <h2>JSON du rapport (LLM)</h2>
      ${data.reportJson ? `<pre>${escapeHtml(data.reportJson)}</pre>` : '<p class="muted">Rapport non disponible (audit non terminé ou fichier absent).</p>'}
    </div>
  `;
  return renderAdminPage({ title: `Audit ${a.host}`, active: 'audits', body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leads / teasers
// ─────────────────────────────────────────────────────────────────────────────
export function renderLeads(data) {
  const teaserRows = (data.teasers || []).map((t) => `<tr>
    <td>${escapeHtml(String(t.created_at || '').slice(0, 16).replace('T', ' '))}</td>
    <td>${escapeHtml(t.host || '')}</td>
    <td>${escapeHtml(t.url || '')}</td>
    <td>${t.score != null ? `${t.score}/100` : '—'}</td>
    <td>${escapeHtml(t.email || '—')}</td>
  </tr>`).join('');

  const leadRows = (data.leads || []).map((l) => `<tr>
    <td>${escapeHtml(String(l.created_at || '').slice(0, 16).replace('T', ' '))}</td>
    <td>${escapeHtml(l.email || '')}</td>
    <td>${escapeHtml(l.source || '—')}</td>
  </tr>`).join('');

  const body = `
    <h1>Leads & teasers</h1>
    <p><a class="btn ghost" href="/admin/leads.csv">Exporter en CSV</a></p>
    <div class="panel">
      <h2>Analyses gratuites (teasers) — ${data.teasers.length}</h2>
      ${teaserRows ? `<table><thead><tr><th>Date</th><th>Site</th><th>URL</th><th>Score</th><th>Email</th></tr></thead><tbody>${teaserRows}</tbody></table>` : '<p class="muted">Aucun teaser.</p>'}
    </div>
    <div class="panel">
      <h2>Leads (emails) — ${data.leads.length}</h2>
      ${leadRows ? `<table><thead><tr><th>Date</th><th>Email</th><th>Source</th></tr></thead><tbody>${leadRows}</tbody></table>` : '<p class="muted">Aucun lead.</p>'}
    </div>
  `;
  return renderAdminPage({ title: 'Leads & teasers', active: 'leads', body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Création manuelle d'un audit
// ─────────────────────────────────────────────────────────────────────────────
export function renderCreateAudit(opts = {}) {
  const alert = opts.error ? `<div class="alert">${escapeHtml(opts.error)}</div>` : '';
  const ok = opts.ok ? `<div class="panel"><p class="ok">Audit créé avec succès (${escapeHtml(opts.okHost)}). ${opts.okEmail ? 'Email brief envoyé.' : 'Aucun email (adresse absente).'}</p></div>` : '';

  const body = `
    <h1>Créer un audit manuellement</h1>
    ${ok}
    ${alert}
    <div class="panel" style="max-width:560px;">
      <form method="post" action="/admin/create">
        <div class="form-row">
          <label for="email">Email du client (optionnel)</label>
          <input id="email" name="email" type="email" value="${escapeHtml(opts.email || '')}" placeholder="client@example.com">
        </div>
        <div class="form-row">
          <label for="site">Site à auditer</label>
          <input id="site" name="site" type="text" required value="${escapeHtml(opts.site || '')}" placeholder="https://example.com">
        </div>
        <div class="form-row">
          <label for="offer">Offre</label>
          <select id="offer" name="offer" required>
            <option value="audit_49" ${opts.offer === 'audit_149' ? '' : 'selected'}>audit_49 — 49 € TTC</option>
            <option value="audit_149" ${opts.offer === 'audit_149' ? 'selected' : ''}>audit_149 — 149 € TTC</option>
          </select>
        </div>
        <button class="btn" type="submit">Créer l'audit</button>
      </form>
    </div>
  `;
  return renderAdminPage({ title: 'Créer un audit', active: 'create', body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Système
// ─────────────────────────────────────────────────────────────────────────────
export function renderSystem(data) {
  const h = data.health || {};
  const diskRow = (label, d) => {
    if (!d) return `<tr><td class="muted">${label}</td><td class="muted">indisponible</td></tr>`;
    return `<tr><td class="muted">${label}</td><td>${d.used} / ${d.total} (libre ${d.free})</td></tr>`;
  };

  const body = `
    <h1>Système</h1>
    <div class="panel">
      <h2>Santé</h2>
      <table>
        <tr><td class="muted">Version</td><td>${escapeHtml(data.version)}</td></tr>
        <tr><td class="muted">DB</td><td class="${h.db ? 'ok' : 'err'}">${h.db ? 'ok' : 'KO'}</td></tr>
        <tr><td class="muted">Reports (écriture)</td><td class="${h.reports ? 'ok' : 'err'}">${h.reports ? 'ok' : 'KO'}</td></tr>
        <tr><td class="muted">Content</td><td class="${h.content ? 'ok' : 'err'}">${h.content ? 'ok' : 'KO'}</td></tr>
        <tr><td class="muted">Mail</td><td>${escapeHtml(h.mail || '—')}</td></tr>
        <tr><td class="muted">Chromium</td><td>${escapeHtml(h.chromium_version || '—')}</td></tr>
        <tr><td class="muted">worker_last_seen</td><td>${escapeHtml(data.workerLastSeen || '—')}</td></tr>
        <tr><td class="muted">Dernier email réussi</td><td>${escapeHtml(data.lastSentEmail || '—')}</td></tr>
      </table>
    </div>

    <div class="panel">
      <h2>Espace disque</h2>
      <table>
        ${diskRow('/data', data.disk.data)}
        ${diskRow('/reports', data.disk.reports)}
      </table>
    </div>

    <div class="panel">
      <h2>Montage /content</h2>
      ${data.contentState
        ? `<p class="muted">Sous-dossiers détectés : ${data.contentState.map((s) => escapeHtml(s)).join(', ') || 'aucun'}</p>`
        : '<p class="muted">Montage absent (contenu embarqué utilisé).</p>'}
    </div>
  `;
  return renderAdminPage({ title: 'Système', active: 'system', body });
}
