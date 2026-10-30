import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { config } from './config.js';
import { getDb } from './db.js';
import { generateAuditToken } from './token.js';
import { resolveChromiumPath } from './render.js';

const MAX_PAGES = 15;

function plural(n, word) {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/**
 * Retire le jargon et accorde les « mot(s) » selon le nombre qui ouvre la preuve
 * (« 1 lien(s) interne(s) » -> « 1 lien interne », « 5 page(s) » -> « 5 pages »).
 */
function cleanEvidence(text) {
  const raw = String(text || '');
  const lead = raw.match(/^\s*(\d+)\s/);
  const n = lead ? Number(lead[1]) : 1;
  return raw
    .replace(/\(s\)/g, n > 1 ? 's' : '')
    .replace(/\(\s*distance SimHash[^)]*\)/gi, '')
    .replace(/\bSimHash\b[^,.]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Scan de prospection : crawl court, constats déterministes, aucun appel LLM.
 * Crée un audit partageable (lien signé) et, si demandé, un PDF de 3 pages.
 */
export async function prospectScan({ url, email = null, pages = 8, deliver = true, source = 'api' }) {
  const { collect } = await import('./crawl.js');
  const { runChecks } = await import('./checks.js');

  const started = Date.now();
  const db = getDb();
  const auditId = crypto.randomUUID();
  const token = generateAuditToken(auditId);
  const host = new URL(url).hostname.replace(/^www\./, '');
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO audits (id, order_id, token, url, host, offer, status, created_at)
              VALUES (?, NULL, ?, ?, ?, 'prospect', 'running', ?)`)
    .run(auditId, token, url, host, now);

  const audit = { id: auditId, url, host, offer: 'prospect', activity: null, city: null, lang: 'fr' };

  const facts = await collect(audit, { maxPages: Math.min(pages, MAX_PAGES) });
  const checks = runChecks(facts);
  facts.score = checks.score;
  facts.allowed_codes = checks.catalogue.map((c) => c.code);

  const severityWeight = { bloquant: 5, critique: 4, majeur: 3, mineur: 2, informatif: 1 };
  const seenUrls = new Set();
  const top = [...checks.findings]
    .sort((a, b) => (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0))
    // Deux contrôles qui dénoncent la MÊME URL cassée font doublon dans un aperçu
    // commercial : on ne garde que le premier (le plus grave après tri).
    .filter((f) => {
      const urls = String(f.evidence || '').match(/https?:\/\/[^\s)]+/g) || [];
      if (urls.some((u) => seenUrls.has(u))) return false;
      urls.forEach((u) => seenUrls.add(u));
      return true;
    })
    .slice(0, 8);

  const dir = path.join(config.reportsDir, `${now.slice(0, 10)}_${auditId.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'faits.json'), JSON.stringify(facts, null, 2));

  let pdfPath = null;
  if (deliver) {
    pdfPath = path.join(dir, 'apercu.pdf');
    try {
      await renderTeaser({ host, url, facts, checks, top, outPath: pdfPath });
    } catch (err) {
      console.error('[prospect] rendu PDF impossible:', err.message);
      pdfPath = null;
    }
  }

  db.prepare(`UPDATE audits SET status='done', finished_at=?, score=?, score_detail=?,
              pages_crawled=?, pdf_path=?, duration_ms=? WHERE id=?`)
    .run(new Date().toISOString(), checks.score.global, JSON.stringify(checks.score),
      facts.site?.pages_crawled ?? 0, pdfPath, Date.now() - started, auditId);

  if (email) {
    db.prepare('INSERT INTO leads (email, source, consent_at, created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING')
      .run(email, source, now, now);
  }

  return {
    audit_id: auditId,
    token,
    share_url: `${config.publicBaseUrl}/audit/${token}`,
    pdf: Boolean(pdfPath),
    duration_ms: Date.now() - started,
    site: { url: facts.site?.url, host, pages_crawled: facts.site?.pages_crawled ?? 0 },
    score: checks.score.global,
    piliers: checks.score.piliers,
    counts: checks.score.counts,
    top_findings: top.map((f) => ({
      code: f.code,
      severity: f.severity,
      pillar: f.pillar,
      page: f.page_url,
      evidence: f.evidence,
      fix: f.detail,
    })),
    catalogue: {
      conforme: checks.catalogue.filter((c) => c.result === 'conforme').length,
      a_corriger: checks.catalogue.filter((c) => c.result === 'a_corriger').length,
      non_applicable: checks.catalogue.filter((c) => c.result === 'non_applicable').length,
    },
  };
}

const PILLARS = [
  ['onpage', 'Balises on-page', 30],
  ['technique', 'Technique', 25],
  ['contenu', 'Contenu & unicité', 20],
  ['performance', 'Performance', 15],
  ['local', 'Visibilité locale', 10],
];

function teaserHtml({ host, url, facts, checks, top }) {
  const score = checks.score.global;
  const sevClass = { bloquant: 'crit', critique: 'crit', majeur: 'maj', mineur: 'min', informatif: 'min' };
  const bars = PILLARS.map(([code, label, weight]) => {
    const v = checks.score.piliers[code] ?? 0;
    return `<div class="pil"><div class="nm">${esc(label)} <em>${weight} %</em></div>
      <div class="track"><i class="${v < 50 ? 'bad' : v < 70 ? 'warn' : ''}" style="width:${v}%"></i></div>
      <div class="v">${v}</div></div>`;
  }).join('');
  const cards = top.slice(0, 5).map((f) => `
    <div class="f ${sevClass[f.severity] || 'min'}">
      <div class="f-top"><span class="badge ${sevClass[f.severity] || 'min'}">${esc(f.severity)}</span>
        <span class="code">${esc(f.code)}</span></div>
      <p class="ev">${esc(cleanEvidence(f.evidence))}</p>
      ${f.fix ? `<p class="fix"><strong>Correctif — </strong>${esc(f.fix)}</p>`
              : `<p class="fix"><strong>Correctif — </strong>détaillé page par page dans le rapport complet</p>`}
    </div>`).join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Aperçu d'audit — ${esc(host)}</title>
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0e1116;font-size:10pt;line-height:1.5}
.page{width:210mm;height:297mm;padding:18mm;position:relative;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
.brand{display:flex;align-items:center;gap:2mm;font-weight:700;font-size:10pt;letter-spacing:-.01em}
.dot{width:4.6mm;height:4.6mm;border-radius:50%;background:#3b5bfd}
.top{display:flex;justify-content:space-between;font-size:8pt;color:#7b8492;border-bottom:1px solid #e6e8ee;padding-bottom:3mm}
h1{font-size:30pt;line-height:1.08;letter-spacing:-.03em;margin:16mm 0 3mm;font-weight:700}
.sub{color:#7b8492;font-size:11pt}
.hero{margin-top:14mm;border:1px solid #e6e8ee;border-radius:16px;padding:8mm;display:flex;gap:8mm;align-items:center;background:#f8f9fc}
.sc{font-size:64pt;font-weight:700;letter-spacing:-.04em;line-height:.9;color:#0e1116}
.sc small{font-size:12pt;color:#7b8492;font-weight:400}
.hero p{font-size:10.5pt;color:#3d4652}
.pil{display:grid;grid-template-columns:46mm 1fr 10mm;gap:4mm;align-items:center;padding:2.6mm 0;border-bottom:1px solid #e6e8ee}
.pil .nm{font-size:9pt;font-weight:500}.pil .nm em{font-style:normal;color:#7b8492;font-size:7.5pt}
.track{height:6px;border-radius:99px;background:#eceef4;overflow:hidden}
.track i{display:block;height:100%;border-radius:99px;background:#3b5bfd}
.track i.warn{background:#b45309}.track i.bad{background:#dc2626}
.pil .v{text-align:right;font-weight:700;font-size:11pt}
h2{font-size:15pt;letter-spacing:-.02em;margin:10mm 0 4mm;font-weight:700}
.f{border:1px solid #e6e8ee;border-left:3px solid #e6e8ee;border-radius:12px;padding:4mm 4.5mm;margin-bottom:3.5mm;break-inside:avoid}
.f.crit{border-left-color:#dc2626}.f.maj{border-left-color:#e0a028}.f.min{border-left-color:#7b8492}
.f-top{display:flex;gap:2.5mm;align-items:center;margin-bottom:1.8mm}
.badge{font-size:6.8pt;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.9mm 2.2mm;border-radius:99px;background:#f1f2f6;color:#3d4652}
.badge.crit{background:#fdeaea;color:#dc2626}.badge.maj{background:#fdf3e3;color:#b45309}
.code{font-size:7pt;color:#7b8492;font-weight:600}
.ev{font-size:9.4pt}
.fix{font-size:8.8pt;color:#3d4652;margin-top:1.2mm}
.fix strong{color:#0e1116}
.cta{margin-top:auto;background:#eef1ff;border:1px solid #dfe5ff;border-radius:14px;padding:6mm}
.cta h3{font-size:12pt;margin-bottom:2mm}
.cta p{font-size:9pt;color:#3d4652}
.prix{display:flex;gap:4mm;margin-top:4mm}
.prix{display:flex;gap:4mm;margin-top:4mm}
.prix a{flex:1;position:relative;background:#fff;border:1px solid #e6e8ee;border-radius:10px;padding:3.5mm;font-size:9pt;color:#3d4652;text-decoration:none}
.prix a.rec{border-color:#3b5bfd;box-shadow:0 0 0 1px #3b5bfd}
.prix b{display:block;font-size:14pt;color:#0e1116}
.rec-b{position:absolute;top:-2.5mm;right:2.5mm;background:#3b5bfd;color:#fff;font-size:6.5pt;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;padding:.7mm 2mm;border-radius:99px}
.foot{position:absolute;left:18mm;right:18mm;bottom:12mm;border-top:1px solid #e6e8ee;padding-top:3mm;font-size:7.5pt;color:#7b8492;display:flex;justify-content:space-between}
</style></head><body>

<section class="page">
  <div class="top"><span class="brand"><span class="dot"></span>ScanSEO</span><span>Aperçu d'audit · ${new Date().toLocaleDateString('fr-FR')}</span></div>
  <h1>${esc(host)}<div class="sub">${esc(url)}</div></h1>
  <div class="hero">
    <div class="sc">${score}<small>/100</small></div>
    <p>${plural(facts.site?.pages_crawled ?? 0, 'page')} analysée${(facts.site?.pages_crawled ?? 0) > 1 ? 's' : ''}, 66 contrôles exécutés.
    ${plural(checks.score.counts.critiques, 'point critique')},
    ${plural(checks.score.counts.majeurs, 'point majeur')},
    ${plural(checks.score.counts.mineurs, 'point mineur')}.</p>
  </div>
  <h2>Le détail par pilier</h2>
  ${bars}
  <div class="foot"><span>ScanSEO · contact@scanseo.fr</span><span>Aperçu automatisé, non contractuel — extrait du rapport complet</span></div>
</section>

<section class="page">
  <div class="top"><span class="brand"><span class="dot"></span>ScanSEO</span><span>${esc(host)} · constats prioritaires</span></div>
  <h2 style="margin-top:6mm">Les 5 points à corriger en premier</h2>
  ${cards}
  <div class="cta">
    <h3>Le rapport complet va plus loin</h3>
    <p>Textes prêts à coller pour chaque page (titres, descriptions, H1), plan d'action sur 30 jours,
    analyse de performance mobile et suivi Search Console pas à pas.</p>
    <div class="prix">
      <a href="${config.publicBaseUrl}/checkout/audit_29"><b>29 € TTC</b>Audit SEO · 25 pages</a>
      <a class="rec" href="${config.publicBaseUrl}/checkout/audit_59"><b>59 € TTC</b>Audit complet · 100 pages + re-audit<span class="rec-b">Recommandé</span></a>
    </div>
    <p style="margin-top:3mm;font-size:8.5pt">Commander sur ${esc(config.publicBaseUrl.replace(/^https?:\/\//, ''))} — rapport livré par email sous 15 minutes.</p>
  </div>
  <div class="foot"><span>ScanSEO · Loïc Huon, entrepreneur individuel · SIREN 853 658 375</span><span>Audit automatisé, non contractuel</span></div>
</section>
</body></html>`;
}

export async function renderTeaser({ host, url, facts, checks, top, outPath }) {
  const html = teaserHtml({ host, url, facts, checks, top });
  const htmlPath = outPath.replace(/\.pdf$/i, '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const executablePath = await resolveChromiumPath();
  const browser = await puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(new URL(`file://${htmlPath}`).href, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: outPath, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await browser.close();
  }
  return outPath;
}
