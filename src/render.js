// ScanSEO — rendu du rapport PDF (lot L4).
// Gabarit B « Produit » : voir src/templates/report.html + report.css + fonts/.
// renderPdf(report, facts, {outPath}) -> { path, pages, bytes, warnings }
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, 'templates');

// ---------------------------------------------------------------------------
// Constantes de gabarit (identité de l'éditeur, gravité, piliers)
// ---------------------------------------------------------------------------
const EDITOR = {
  name: 'ScanSEO',
  contact: 'contact@scanseo.fr',
  legal: 'Loïc Huon, entrepreneur individuel · SIREN 853 658 375 · TVA non applicable, art. 293 B du CGI · 16 Rue Saint-Antoine du T, 31000 Toulouse',
  contact2: 'contact@scanseo.fr · +33 6 82 29 87 65 · Données conservées 12 mois',
};

const SEVERITY = {
  bloquant:    { cls: 'crit', label: 'Critique' },
  critique:    { cls: 'crit', label: 'Critique' },
  majeur:      { cls: 'maj',  label: 'Majeur' },
  mineur:      { cls: 'min',  label: 'Mineur' },
  informatif:  { cls: 'min',  label: 'Informatif' },
};

// Ordre d'affichage = gabarit B (on-page en tête, poids 30).
// Les libellés doivent décrire ce que le pilier MESURE, sinon le rapport se
// contredit : « onpage » note les title/meta/H1, « contenu » l'unicité des textes.
const PILLARS = [
  { code: 'onpage',      label: 'Balises on-page',    weight: 30 },
  { code: 'technique',   label: 'Technique',          weight: 25 },
  { code: 'contenu',     label: 'Contenu & unicité',  weight: 20 },
  { code: 'performance', label: 'Performance',        weight: 15 },
  { code: 'local',       label: 'Visibilité locale',  weight: 10 },
];

const PILLAR_LABELS = {
  technique: 'Technique',
  onpage: 'Balises on-page',
  contenu: 'Contenu & unicité',
  performance: 'Performance',
  local: 'Local & confiance',
};

const RESULT_PILL = {
  conforme:        { cls: 'ok', label: 'Conforme' },
  a_corriger:      { cls: 'ko', label: 'À corriger' },
  non_applicable:  { cls: 'na', label: 'Non applicable' },
};

// ---------------------------------------------------------------------------
// Petits utilitaires
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const charCount = (s) => [...String(s ?? '')].length;

function fmtDate(d) {
  const date = d instanceof Date ? d : new Date(d || Date.now());
  if (Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function firstSentence(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  let out = m ? m[0].trim() : t;
  if (out.length > 90) out = out.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return out;
}

const constatIsLong = (c) =>
  !!(c.texte_a_coller || c.fix_payload) ||
  charCount((c.constat || '') + (c.pourquoi || '') + (c.correctif || '')) > 600;

function paginateConstats(constats, maxPerPage = 3) {
  const cap = maxPerPage <= 2 ? 2 : 3;
  const pages = [];
  let i = 0;
  while (i < constats.length) {
    const batch = [];
    let longs = 0;
    while (batch.length < cap && i < constats.length) {
      const c = constats[i];
      const long = constatIsLong(c);
      if (long && longs >= 2) break; // 2 constats longs max par page
      batch.push(c);
      if (long) longs++;
      i++;
    }
    // 4 par page uniquement si les 3 sont courts et le 4e l'est aussi.
    if (cap === 3 && batch.length === 3 && longs === 0 && i < constats.length && !constatIsLong(constats[i])) {
      batch.push(constats[i]);
      i++;
    }
    pages.push(batch);
  }
  return pages;
}

function ringSvg(score) {
  const r = 70;
  const circ = 2 * Math.PI * r; // ~439.8
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const dash = (pct / 100) * circ;
  return `<svg width="160" height="160" viewBox="0 0 160 160">
    <circle cx="80" cy="80" r="70" fill="none" stroke="#e7e9f2" stroke-width="12"/>
    <circle cx="80" cy="80" r="70" fill="none" stroke="#3b5bfd" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" /></svg>`;
}

function pasteText(t) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  const parts = [];
  if (t.title) parts.push(t.title);
  if (t.meta) parts.push(t.meta);
  if (t.h1) parts.push(t.h1);
  if (Array.isArray(t.h2) && t.h2.length) parts.push(t.h2.join(' · '));
  return parts.join('\n') || null;
}

// ---------------------------------------------------------------------------
// Blocs de page réutilisables
// ---------------------------------------------------------------------------
const topBar = (crumb) =>
  `<div class="top"><div class="brand"><span class="dot"></span>ScanSEO</div><div class="crumb">${esc(crumb)}</div></div>`;

const pageNum = () => `<div class="pg"><b>__PG__</b> / __PT__</div>`;

const secHead = (kicker, title, lead = '') =>
  `<div class="sec"><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function coverPage(report, facts, offer = 'audit_49') {
  const site = facts?.site || {};
  const score = facts?.score || {};
  const counts = score.counts || {};
  const host = site.host || '—';
  const url = site.url || '';
  const activityCity = [site.activity, site.city].filter(Boolean).join(', ') || host;
  const date = fmtDate(site.started_at);
  const year = new Date(site.started_at || Date.now()).getFullYear();
  const ref = facts?.audit_ref || `SC-${year}-${String(Math.abs(hash(host + date)) % 10000).padStart(4, '0')}`;
  const global = Number.isFinite(score.global) ? score.global : null;
  const pagesCrawled = site.pages_crawled ?? null;
  const checksRun = Array.isArray(facts?.catalogue) && facts.catalogue.length ? facts.catalogue.length : 66;
  const crit = counts.critiques ?? 0;
  const maj = counts.majeurs ?? 0;
  const min = counts.mineurs ?? 0;

  const chips = [];
  if (crit) chips.push(`<span class="chip b">${crit} critique${crit > 1 ? 's' : ''}</span>`);
  if (maj) chips.push(`<span class="chip w">${maj} majeur${maj > 1 ? 's' : ''}</span>`);
  if (min) chips.push(`<span class="chip">${min} mineur${min > 1 ? 's' : ''}</span>`);
  const chipsHtml = chips.length ? `<div class="chips">${chips.join('')}</div>` : '';

  const partial = site.partial
    ? ' <em style="font-style:normal;color:var(--warn)">Collecte partielle : certains scores n\'ont pas pu être mesurés.</em>'
    : '';

  const coverBody =
    `${pagesCrawled != null ? pagesCrawled : '—'} page${pagesCrawled === 1 ? '' : 's'} analysée${pagesCrawled === 1 ? '' : 's'}, ${checksRun} contrôles, ${crit + maj} correction${crit + maj > 1 ? 's' : ''} prioritaire${crit + maj > 1 ? 's' : ''}.` +
    partial;

  return `<section class="page">
  ${topBar(`Rapport d'audit · ${date}`)}
  <div class="cv-grid">
    <span class="cv-eyebrow">Audit de référencement naturel</span>
    <h1 class="cv-h1">${esc(capitalizeHost(host))}<br><span class="cv-sub">${esc(host)}${activityCity !== host ? ` · ${esc(activityCity)}` : ''}</span></h1>
    <div class="cv-card">
      <div class="ring">
        ${ringSvg(global)}
        <div class="in"><b>${global == null ? '—' : global}</b><span>/ 100</span></div>
      </div>
      <div class="txt">
        <h3>${esc(report.verdict || '')}</h3>
        <p>${coverBody}</p>
        ${chipsHtml}
      </div>
    </div>
    <div class="disc">Audit automatisé, non contractuel. Les mesures sont réelles ; la rédaction des correctifs est générée.
    Aucune garantie de position, de trafic ou de délai de progression n'est associée à ce document.</div>
  </div>
  <div class="cv-foot">
    <span><strong style="color:var(--ink)">Réf. ${esc(ref)}</strong> · gabarit ${RENDER_VERSION} · ${offer === 'audit_149'
      ? 'Offre Audit Complet · 100 pages maximum'
      : 'Offre Audit SEO · 25 pages maximum'}</span>
    <span>${EDITOR.name} · ${EDITOR.contact}</span>
  </div>
  ${pageNum()}
</section>`;
}

function synthesePage(report, facts) {
  const host = facts?.site?.host || '';
  const actions = deriveActions(report.constats || []);
  const resume = String(report.resume_executif || '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .map((s) => `<p>${esc(s)}</p>`)
    .join('');
  const points = (report.points_forts || []).map((p) => esc(p)).join(' ');

  const actionRows = actions.map((a) => `
    <div class="row"><div class="n">${a.n}</div><div class="t"><strong>${esc(a.title)}</strong>
      <span>${esc(a.sub)}</span></div><div class="tag">${esc(a.code)}</div></div>`).join('');

  return `<section class="page">
  ${topBar(host)}
  ${secHead('01 · Synthèse', 'Par quoi commencer')}
  ${resume ? `<div class="resume">${resume}</div>` : ''}
  <div class="verdict">
    <div class="lbl">Verdict</div>
    <p>${esc(report.verdict || '')}</p>
  </div>
  <div class="kicker" style="margin-bottom:2.5mm">Les cinq actions à mener en premier</div>
  <div class="act">${actionRows}</div>
  <div style="margin-top:5mm" class="note">
    <b>Ce qui fonctionne déjà.</b> ${points || 'Aucun point fort mesuré sur ce site.'}
  </div>
  ${pageNum()}
</section>`;
}

function deriveActions(constats) {
  return (constats || []).slice(0, 5).map((c, i) => ({
    n: i + 1,
    title: firstSentence(c.correctif) || firstSentence(c.constat) || 'Corriger ce point',
    sub: c.constat || '',
    code: c.code || '',
  }));
}

function scoresPage(report, facts) {
  const host = facts?.site?.host || '';
  const score = facts?.score || {};
  const piliers = score.piliers || {};
  const global = score.global ?? '—';
  const comments = new Map((report.piliers || []).map((p) => [p.code, p.commentaire]));

  const rows = PILLARS.map((p) => {
    const v = Number.isFinite(piliers[p.code]) ? piliers[p.code] : null;
    const width = v == null ? 0 : Math.max(0, Math.min(100, v));
    const cls = width < 50 ? 'vlow' : width < 70 ? 'low' : '';
    const comment = comments.get(p.code);
    return `<div class="row"><div class="nm">${esc(p.label)} <em>poids ${p.weight} %</em></div>
      <div class="track"><i class="${cls}" style="width:${width}%"></i></div>
      <div class="v">${v == null ? '—' : v}</div></div>
      ${comment ? `<div class="cm">${esc(comment)}</div>` : ''}`;
  }).join('');

  const counts = score.counts || {};
  const crit = counts.critiques ?? 0;
  const na = Array.isArray(facts?.catalogue)
    ? facts.catalogue.filter((c) => c.result === 'non_applicable').length
    : 0;
  const mobileScore = facts?.performance?.mobile?.score ?? null;
  const lcp = facts?.performance?.mobile?.lcp_ms ?? null;

  return `<section class="page">
  ${topBar(host)}
  ${secHead('02 · Scores', `D'où vient la note de ${global}`,
    'Cinq familles pondérées selon leur effet réel sur la visibilité. Le score est calculé par des règles fixes : deux audits du même site donnent le même résultat.')}
  <div class="pil">${rows}</div>
  <div class="balance">
    <div><span class="bn">${(report.constats || []).length}</span><span class="bl">constats au total</span></div>
    <div><span class="bn">${crit}</span><span class="bl">critiques à traiter d'abord</span></div>
    <div><span class="bn">${na}</span><span class="bl">contrôles non applicables</span></div>
    <div><span class="bn">${lcp != null ? (lcp / 1000).toFixed(1).replace('.', ',') + ' s' : '—'}</span><span class="bl">${mobileScore != null ? `affichage mobile (${mobileScore}/100)` : 'affichage mobile'}</span></div>
  </div>
  ${pageNum()}
</section>`;
}

function constatCard(c) {
  const sev = SEVERITY[c.gravite] || SEVERITY.mineur;
  const paste = pasteText(c.texte_a_coller ?? c.fix_payload);
  return `<div class="finding ${sev.cls}">
    <div class="f-top"><span class="badge ${sev.cls}">${sev.label}</span>${c.code ? `<span class="f-code">CODE ${esc(c.code)}</span>` : ''}</div>
    <h3>${esc(c.constat || '')}</h3>
    <div class="f-lines">
      ${c.constat ? `<p><b>Constat</b>${esc(c.constat)}</p>` : ''}
      ${c.pourquoi ? `<p><b>Pourquoi c'est un problème</b>${esc(c.pourquoi)}</p>` : ''}
      ${c.correctif ? `<p><b>Correctif</b>${esc(c.correctif)}</p>` : ''}
    </div>
    ${paste ? `<div class="paste" data-label="Texte à coller"><p>${esc(paste)}</p></div>` : ''}
  </div>`;
}

function constatsPages(report, facts, perPage = 3) {
  const host = facts?.site?.host || '';
  const constats = report.constats || [];
  const batches = paginateConstats(constats, perPage);
  const pages = batches.map((batch, idx) => {
    const header = idx === 0
      ? `<div class="sec"><div class="kicker">03 · Constats</div><h2>Par ordre d'impact</h2></div>`
      : `<div class="cont-hdr"><div class="kicker">03 · Constats (suite)</div></div>`;
    return `<section class="page">
  ${topBar(host)}
  ${header}
  ${batch.map(constatCard).join('')}
  ${pageNum()}
</section>`;
  });
  return pages;
}

function textesPage(report, facts) {
  const host = facts?.site?.host || '';
  const rows = (report.textes_prets || []).map((t) => {
    const h2 = Array.isArray(t.h2) && t.h2.length
      ? `<div style="margin-top:1mm;font-size:7.4pt;color:var(--ink-3)">${t.h2.map((h) => esc(h)).join(' · ')}</div>`
      : '';
    return `<tr>
      <td><strong>${esc(shortPage(t.page))}</strong></td>
      <td>${esc(t.title)} <span class="cnt">${charCount(t.title)}</span></td>
      <td>${esc(t.meta)} <span class="cnt">${charCount(t.meta)}</span></td>
      <td>${esc(t.h1 || '')}${h2}</td>
    </tr>`;
  }).join('');

  const body = rows
    ? `<table>
      <thead><tr><th style="width:18%">Page</th><th style="width:30%">Titre</th><th style="width:34%">Description</th><th>H1</th></tr></thead>
      <tbody>${rows}</tbody></table>`
    : `<p style="font-size:9pt;color:var(--ink-3)">Aucun texte prêt à coller n'a été nécessaire : les titres et descriptions existants respectent déjà les bornes.</p>`;

  return `<section class="page">
  ${topBar(host)}
  ${secHead('04 · Textes prêts', 'À coller tel quel',
    'Titre 30–65 caractères, description 120–165. Uniques entre eux, ville et activité placées naturellement. Le compteur est affiché à côté de chaque texte.')}
  ${body}
  ${pageNum()}
</section>`;
}

function shortPage(url) {
  try { return new URL(url).pathname.replace(/\/$/, '') || 'Accueil'; }
  catch { return url || 'Accueil'; }
}


/**
 * Offre 149 € : les pages entièrement rédigées. Elles étaient générées et
 * facturées mais jamais imprimées — le client payait trois fois le prix de
 * l'offre 49 € pour le même PDF.
 */
function pagesRedigeesPage(report, facts) {
  const host = facts?.site?.host || '';
  const cards = (report.pages_redigees || []).map((pg) => `
    <div class="pcard" style="margin-bottom:5mm">
      <div class="h"><span class="w">${esc(pg.page || 'Page')}</span><h4>${esc(pg.title || pg.titre || '')}</h4></div>
      ${pg.h1 ? `<p style="font-size:8.6pt;font-weight:600;color:var(--ink);margin-bottom:1.6mm">H1 — ${esc(pg.h1)}</p>` : ''}
      ${pg.chapo ? `<p style="font-size:8.2pt;color:var(--ink-2);margin-bottom:1.6mm">${esc(pg.chapo)}</p>` : ''}
      ${(pg.h2 || []).length ? `<ul>${pg.h2.map((h) => `<li>${esc(typeof h === 'string' ? h : h.title || h.titre || '')}</li>`).join('')}</ul>` : ''}
      ${(pg.faq || []).length ? `<div style="margin-top:2mm"><p style="font-size:7.4pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:1mm">FAQ</p>
        <ul>${pg.faq.map((f) => `<li>${esc(typeof f === 'string' ? f : f.q || f.question || '')}</li>`).join('')}</ul></div>` : ''}
      ${pg.cta ? `<p style="font-size:8.2pt;margin-top:2mm"><strong>Appel à l'action :</strong> ${esc(pg.cta)}</p>` : ''}
    </div>`).join('');

  return `<section class="page">
  ${topBar(host)}
  ${secHead('05 · Pages rédigées', 'À publier telles quelles')}
  <div class="plan" style="grid-template-columns:1fr">${cards}</div>
  <div class="note" style="margin-top:6mm">Ces textes tiennent compte de votre activité et de vos pages existantes.
  Relisez-les pour vérifier les éléments factuels (horaires, tarifs, zones) avant publication.</div>
  ${pageNum()}
</section>`;
}

function planPage(report, facts, offer = 'audit_49', shift = 0) {
  const host = facts?.site?.host || '';
  const cards = (report.plan_30_jours || []).map((w) => `
    <div class="pcard"><div class="h"><span class="w">S${esc(w.semaine ?? '')}</span><h4>${esc(w.theme || '')}</h4></div>
      <ul>${(w.actions || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`).join('');

  return `<section class="page">
  ${topBar(host)}
  ${secHead(`${5 + shift} · Plan d\'action`, (report.plan_30_jours || []).length >= 8 ? 'Les 90 prochains jours' : 'Les 30 prochains jours')}
  <div class="plan">${cards}</div>
  <div class="note" style="margin-top:7mm">Une fois les corrections faites, relancez un audit : le score doit refléter les changements.
  Aucune progression de position ne peut être garantie ni datée.</div>
  ${pageNum()}
</section>`;
}

function suiviPage(report, facts, shift = 0) {
  const host = facts?.site?.host || '';
  const steps = (report.a_verifier_dans_search_console || []).map((s, i) =>
    `<div class="s"><div class="n">${i + 1}</div><p>${esc(s)}</p></div>`).join('');

  return `<section class="page">
  ${topBar(host)}
  ${secHead(`${6 + shift} · Search Console`, 'Les données que cet audit ne mesure pas',
    'Trois vérifications, avec le chemin de clic exact, pour consulter vous-même les chiffres qui demandent un accès propriétaire.')}
  <div class="steps">${steps || '<p style="font-size:9pt;color:var(--ink-3)">—</p>'}</div>

  <div class="sec" style="margin-top:9mm"><div class="kicker">${7 + shift} · Méthode & limites</div><h2>Ce qui a été vérifié</h2></div>
  <div class="two">
    <div><div class="kicker">Ce que cet audit ne mesure pas</div>
      <p style="font-size:8.8pt">${esc(report.limites || '')}</p></div>
    <div><div class="kicker">Relancer un audit</div>
      <p style="font-size:8.8pt">Après corrections, relancez l'analyse depuis votre espace : le score et les constats sont recalculés sur les mêmes règles. Le rapport précédent reste accessible 12 mois.</p></div>
  </div>
  ${pageNum()}
</section>`;
}

function annexePages(facts) {
  const host = facts?.site?.host || '';
  const catalogue = facts?.catalogue || [];
  const byPillar = new Map();
  for (const c of catalogue) {
    const key = c.pillar || 'autre';
    if (!byPillar.has(key)) byPillar.set(key, []);
    byPillar.get(key).push(c);
  }
  const groups = [...byPillar.entries()].map(([pillar, rows]) => ({
    pillar,
    label: PILLAR_LABELS[pillar] || pillar,
    rows,
  }));

  // Répartit les groupes en pages de ~20 lignes, sans couper un groupe.
  const pageGroups = [];
  let cur = [];
  let curRows = 0;
  for (const g of groups) {
    const n = 1 + g.rows.length;
    if (curRows > 0 && curRows + n > 20) { pageGroups.push(cur); cur = []; curRows = 0; }
    cur.push(g);
    curRows += n;
  }
  if (cur.length) pageGroups.push(cur);

  const counts = { conforme: 0, a_corriger: 0, non_applicable: 0 };
  for (const c of catalogue) if (counts[c.result] != null) counts[c.result]++;

  const summary = `${catalogue.length} contrôles · ${counts.conforme} conformes · ${counts.a_corriger} à corriger · ${counts.non_applicable} non applicables`;

  return pageGroups.map((groupsInPage, idx) => {
    const rows = groupsInPage.map((g) =>
      `<tr class="ann-pillar"><td colspan="3">${esc(g.label)}</td></tr>` +
      g.rows.map((c) => {
        const r = RESULT_PILL[c.result] || RESULT_PILL.non_applicable;
        return `<tr><td class="c">${esc(c.code || '')}</td><td>${esc(c.label || '')}</td><td><span class="pill ${r.cls}">${r.label}</span></td></tr>`;
      }).join('')
    ).join('');

    const header = idx === 0
      ? `${secHead('08 · Annexe technique', 'Les 66 contrôles, un par un',
          `${summary}. Un contrôle non applicable est marqué « non applicable », jamais « réussi ».`)}`
      : `<div class="cont-hdr"><div class="kicker">08 · Annexe technique (suite)</div><h3>Les 66 contrôles, un par un</h3>
         <div class="sub">${esc(summary)}</div></div>`;

    return `<section class="page">
  ${topBar(host)}
  ${header}
  <table class="ann">
    <thead><tr><th style="width:12%">Code</th><th style="width:66%">Contrôle</th><th style="width:22%">Résultat</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${idx === pageGroups.length - 1 ? legalFoot() : ''}
  ${pageNum()}
</section>`;
  });
}

function legalFoot() {
  return `<div class="foot">
    <span><strong style="color:var(--ink)">ScanSEO</strong> · ${esc(EDITOR.legal)}</span>
    <span style="text-align:right">${esc(EDITOR.contact2)}</span>
  </div>`;
}

function capitalizeHost(host) {
  const h = String(host || '').split('.')[0];
  if (!h) return '';
  return h.charAt(0).toUpperCase() + h.slice(1);
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Assemblage du HTML
// ---------------------------------------------------------------------------
function buildPages(report, facts, opts = {}) {
  const perPage = opts.constatsPerPage || 3;
  const offer = opts.offer || 'audit_49';
  // La section des pages rédigées décale la numérotation des chapitres suivants :
  // sans cela le PDF affichait 04, 06, 05, 06 — indigne d'un document payant.
  const hasPages = offer === 'audit_149' && !!report.pages_redigees?.length;
  const pages = [
    coverPage(report, facts, offer),
    synthesePage(report, facts),
    scoresPage(report, facts),
    ...constatsPages(report, facts, perPage),
    textesPage(report, facts),
    ...(offer === 'audit_149' && report.pages_redigees?.length ? [pagesRedigeesPage(report, facts)] : []),
    planPage(report, facts, offer, hasPages ? 1 : 0),
    suiviPage(report, facts, hasPages ? 1 : 0),
    ...annexePages(facts),
  ];
  const total = pages.length;
  return pages
    .map((p, i) => p.replaceAll('__PG__', String(i + 1)).replaceAll('__PT__', String(total)))
    .join('\n');
}

async function buildCss() {
  const [reportCss, fontsCss] = await Promise.all([
    fs.readFile(path.join(TEMPLATES, 'report.css'), 'utf8'),
    fs.readFile(path.join(TEMPLATES, 'fonts', 'fonts.css'), 'utf8'),
  ]);
  const fontFiles = new Set([...fontsCss.matchAll(/url\(['"]?\.\/([^'")]+\.woff2)['"]?\)/g)].map((m) => m[1]));
  const fonts = new Map();
  for (const file of fontFiles) {
    fonts.set(file, (await fs.readFile(path.join(TEMPLATES, 'fonts', file))).toString('base64'));
  }
  // Remplace les url('./xxx.woff2') par des data-URL base64 (rapport autonome).
  const inlined = fontsCss.replace(/url\(['"]?\.\/([^'")]+\.woff2)['"]?\)/g, (_, file) =>
    `url(data:font/woff2;base64,${fonts.get(file)})`);
  const css = reportCss.replace(/@import[^;]+;/g, '');
  return `<style>${inlined}\n${css}</style>`;
}

async function buildHtml(report, facts, opts = {}) {
  const host = facts?.site?.host || '';
  const date = fmtDate(facts?.site?.started_at);
  const title = `Audit SEO — ${host} — ${date}`;
  const css = await buildCss();
  const pages = buildPages(report, facts, opts);
  return `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n${css}\n</head>\n<body>\n${pages}\n</body>\n</html>`;
}

// ---------------------------------------------------------------------------
// Résolution de Chromium
// ---------------------------------------------------------------------------
export async function resolveChromiumPath() {
  const candidates = [
    config.chromiumPath,
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/hermes/tools/chromium-1208/chrome-linux64/chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* continue */ }
  }
  throw new Error('Chromium introuvable — définir CHROMIUM_PATH');
}

// ---------------------------------------------------------------------------
// renderPdf
// ---------------------------------------------------------------------------
// Toute modification du gabarit incrémente cette version : le pipeline s'en sert
// pour savoir si le PDF sur disque est à jour. Sans elle, « Relancer » réutilisait
// le PDF existant et le client recevait l'ancienne mise en page indéfiniment.
export const RENDER_VERSION = '4';

export async function renderPdf(report, facts, { outPath, offer = 'audit_49' }) {
  const warnings = [];

  // 1. Vérification d'arithmétique du score (ne jamais afficher un score faux).
  const score = facts?.score || {};
  if (Number.isFinite(score.global) && score.piliers) {
    const expected = Math.round(
      PILLARS.reduce((acc, p) => acc + (Number(score.piliers[p.code]) || 0) * p.weight, 0) / 100
    );
    if (expected !== score.global) {
      warnings.push(`score global ${score.global} ≠ moyenne pondérée ${expected} (affiché tel que fourni)`);
    }
  }

  // 2-3. HTML puis Chromium -> printToPDF, avec repagination si une page déborde.
  // Un bloc plus haut que la page A4 est rogné par le moteur d'impression : on resserre
  // la pagination des constats plutôt que de livrer un rapport tronqué.
  const executablePath = await resolveChromiumPath();
  const htmlPath = outPath.replace(/\.pdf$/i, '.html');
  let heights = [];
  let pdfBytes = null;

  const schedules = [3, 2, 1];
  for (let si = 0; si < schedules.length; si++) {
    const constatsPerPage = schedules[si];
    const html = await buildHtml(report, facts, { constatsPerPage, offer });
    await fs.writeFile(htmlPath, html, 'utf8');
    const browser = await puppeteer.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(new URL(`file://${htmlPath}`).href, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      heights = await page.evaluate(() =>
        [...document.querySelectorAll('.page')].map((el) => +el.getBoundingClientRect().height.toFixed(1))
      );
      pdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
    } finally {
      await browser.close();
    }
    const over = heights.filter((h) => h > 1123.5);
    if (!over.length) break;
    const next = schedules[si + 1];
    warnings.push(`page ${heights.indexOf(over[0]) + 1} débordait de ${over[0].toFixed(0)} px` +
      (next ? ` → repagination à ${next} constat(s) par page` : ' → aucun mode de pagination ne suffit'));
  }

  heights.forEach((h, i) => {
    if (h > 1123.5) warnings.push(`page ${i + 1} déborde encore : ${h} px (max 1123 px)`);
  });

  // 4. Titre du PDF (pdf-lib) + nombre de pages.
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const host = facts?.site?.host || '';
  const date = fmtDate(facts?.site?.started_at);
  pdfDoc.setTitle(`Audit SEO — ${host} — ${date}`);
  pdfDoc.setProducer('ScanSEO');
  pdfDoc.setCreator('ScanSEO');
  pdfDoc.setAuthor('ScanSEO');
  const pages = pdfDoc.getPageCount();
  const finalBytes = await pdfDoc.save();

  await fs.writeFile(outPath, finalBytes);
  const bytes = finalBytes.length;

  // 5. Vérifications après rendu.
  if (pages < 10 || pages > 28) warnings.push(`nombre de pages hors bornes : ${pages} (attendu 10–28)`);
  if (bytes >= 6 * 1024 * 1024) warnings.push(`poids ${(bytes / 1048576).toFixed(1)} Mo ≥ 6 Mo`);

  const pageTexts = await extractTextPerPage(finalBytes);
  pageTexts.forEach((text, i) => {
    const len = text.trim().length;
    if (i > 0 && len < 200) warnings.push(`page ${i + 1} trop courte : ${len} caractères (< 200)`);
  });

  return { path: outPath, pages, bytes, warnings };
}

async function extractTextPerPage(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const tc = await p.getTextContent();
      out.push(tc.items.map((it) => it.str).join(' '));
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export { buildHtml, buildPages, buildCss, extractTextPerPage };
