import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { sendEmail, sendAdminAlert } from './mail.js';

const MAX_ATTEMPTS = 3;

function log(audit, step, extra = '') {
  console.log(`[pipeline ${audit.id.slice(0, 8)}] ${step}${extra ? ' — ' + extra : ''}`);
}

export function reportDir(audit) {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(config.reportsDir, `${day}_${audit.id.slice(0, 8)}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Traite un audit de bout en bout. Idempotent : si un rapport existe déjà sur
 * disque, on reprend à l'étape suivante au lieu de refacturer un crawl + un appel LLM.
 */
export async function processAudit(audit) {
  const db = getDb();
  const startedAt = Date.now();
  const dir = reportDir(audit);
  fs.mkdirSync(dir, { recursive: true });

  const factsPath = path.join(dir, 'faits.json');
  const reportPath = path.join(dir, 'rapport.json');
  const pdfPath = path.join(dir, 'rapport.pdf');

  try {
    const { collect } = await import('./crawl.js');
    const { runChecks } = await import('./checks.js');
    const { analyze } = await import('./analyze.js');
    const { renderPdf } = await import('./render.js');

    // 1. collecte
    let facts = readJson(factsPath);
    if (facts) {
      log(audit, 'collecte', 'reprise depuis faits.json');
    } else {
      log(audit, 'collecte', `crawl de ${audit.url}`);
      facts = await collect(audit, {
        onProgress: (n, total) => {
          if (n % 5 === 0 || n === total) log(audit, 'collecte', `${n}/${total} pages`);
        },
      });
      fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
    }

    // 2. constats déterministes + score
    const checks = runChecks(facts);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM pages WHERE audit_id = ?').run(audit.id);
      db.prepare('DELETE FROM findings WHERE audit_id = ?').run(audit.id);
      const insPage = db.prepare(`INSERT INTO pages
        (audit_id,url,depth,http_status,final_url,title,meta_desc,h1,h1_count,word_count,canonical,
         robots_meta,jsonld_types,ttfb_ms,bytes,internal_links,images_total,images_no_alt,facts)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const p of facts.pages || []) {
        insPage.run(audit.id, p.url, p.depth ?? null, p.status ?? null, p.final_url ?? null,
          p.title ?? null, p.meta ?? null, p.h1 ?? null, p.h1_count ?? null, p.words ?? null,
          p.canonical ?? null, p.robots_meta ?? null, (p.jsonld_types || []).join(','),
          p.ttfb_ms ?? null, p.bytes ?? null, p.internal_links ?? null,
          p.images_total ?? null, p.images_no_alt ?? null, JSON.stringify(p));
      }
      const insFinding = db.prepare(`INSERT INTO findings
        (audit_id,code,pillar,severity,page_url,evidence,recommendation,fix_payload,deterministic)
        VALUES (?,?,?,?,?,?,?,?,1)`);
      for (const f of checks.findings || []) {
        insFinding.run(audit.id, f.code, f.pillar, f.severity, f.page_url ?? null,
          f.evidence ?? null, f.detail ?? null, f.fix_payload ? JSON.stringify(f.fix_payload) : null);
      }
      db.prepare(`UPDATE audits SET pages_crawled = ?, score = ?, score_detail = ? WHERE id = ?`)
        .run(facts.site?.pages_crawled ?? 0, checks.score.global, JSON.stringify(checks.score), audit.id);
    });
    tx();
    facts.score = checks.score;
    facts.allowed_codes = checks.catalogue.map((c) => c.code);
    facts.catalogue_labels = Object.fromEntries(checks.catalogue.map((c) => [c.code, c.label]));
    fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
    log(audit, 'constats', `${checks.findings.length} constats, score ${checks.score.global}`);

    // 3. rédaction
    let report = readJson(reportPath);
    let usage = { tokens_in: 0, tokens_out: 0, cost_usd: 0 };
    if (report) {
      log(audit, 'rédaction', 'reprise depuis rapport.json');
    } else {
      log(audit, 'rédaction', `appel ${config.deepseekModelPaid}`);
      const out = await analyze(facts, {
        offer: audit.offer,
        model: config.deepseekModelPaid,
        fallbackFindings: checks.findings,
      });
      report = out.report;
      usage = out.usage || usage;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      db.prepare(`UPDATE audits SET tokens_in = ?, tokens_out = ?, cost_usd = ? WHERE id = ?`)
        .run(usage.tokens_in, usage.tokens_out, usage.cost_usd, audit.id);
      if (out.fixes?.length) log(audit, 'validation', `${out.fixes.length} corrections`);
    }

    // 4. rendu
    let pdf = fs.existsSync(pdfPath) ? { path: pdfPath, pages: null, bytes: fs.statSync(pdfPath).size } : null;
    if (pdf) {
      log(audit, 'rendu', 'reprise depuis rapport.pdf');
    } else {
      log(audit, 'rendu', 'génération du PDF');
      pdf = await renderPdf(report, facts, { outPath: pdfPath });
      if (pdf.warnings?.length) log(audit, 'rendu', pdf.warnings.join(' | '));
    }

    // 5. livraison (le statut done exige un email réellement parti)
    const buyer = db.prepare('SELECT email FROM orders WHERE id = ?').get(audit.order_id);
    const to = buyer?.email || config.contactEmail;
    if (!to) throw new Error('no_recipient');
    log(audit, 'livraison', 'email de livraison');
    const html = buildDeliveryHtml(report, facts, audit);
    const sent = await sendEmail({
      to,
      kind: 'delivery',
      subject: `Votre audit SEO — ${facts.site?.host || audit.host}`,
      text: `${report.verdict}\n\nScore : ${checks.score.global}/100\n\nVotre rapport est en pièce jointe.`,
      html,
      auditId: audit.id,
      attachments: [{ filename: `audit-seo-${audit.host}.pdf`, path: pdfPath }],
    });
    if (!sent?.ok) throw new Error('mail_delivery_failed');

    const duration = Date.now() - startedAt;
    db.prepare(`UPDATE audits SET status='done', finished_at=?, pdf_path=?, duration_ms=?,
                error=NULL WHERE id=?`).run(new Date().toISOString(), pdfPath, duration, audit.id);
    log(audit, 'terminé', `${Math.round(duration / 1000)} s, ${pdf.bytes} octets`);
    return { ok: true, pdfPath, duration };
  } catch (err) {
    const attempts = (audit.attempts || 0) + 1;
    const message = `${err.code || 'ERROR'}: ${err.message}`;
    console.error(`[pipeline ${audit.id.slice(0, 8)}] échec (${attempts}/${MAX_ATTEMPTS}) ${message}`);
    if (attempts < MAX_ATTEMPTS) {
      const backoffMin = [2, 10, 30][attempts - 1] || 30;
      const next = new Date(Date.now() + backoffMin * 60000).toISOString();
      db.prepare(`UPDATE audits SET status='queued', claimed_at=?, error=? WHERE id=?`)
        .run(next, message, audit.id);
    } else {
      db.prepare(`UPDATE audits SET status='failed', error=?, finished_at=? WHERE id=?`)
        .run(message, new Date().toISOString(), audit.id);
      await sendAdminAlert('Audit en échec', `Audit ${audit.id} (${audit.url}) — ${message}`).catch(() => {});
    }
    return { ok: false, error: message };
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildDeliveryHtml(report, facts, audit) {
  const base = config.publicBaseUrl;
  const actions = (report.plan_30_jours?.[0]?.actions || []).slice(0, 5);
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0e1116">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#7b8492;margin:0 0 16px">ScanSEO</p>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 8px">Votre audit est prêt</h1>
    <p style="color:#3d4652;margin:0 0 24px">${esc(facts.site?.host || audit.host)} — score <strong>${esc(facts.score?.global ?? '')}/100</strong></p>
    <div style="background:#fff;border:1px solid #e6e8ee;border-radius:14px;padding:24px">
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${esc(report.verdict || '')}</p>
      ${actions.length ? `<p style="margin:16px 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7b8492">À commencer cette semaine</p>
      <ol style="margin:0;padding-left:20px;color:#3d4652;font-size:14px;line-height:1.6">${actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    </div>
    <p style="text-align:center;margin:28px 0"><a href="${base}/audit/${audit.token}" style="background:#3b5bfd;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;display:inline-block">Ouvrir mon espace</a></p>
    <p style="font-size:12px;color:#7b8492;line-height:1.6">Le rapport complet est en pièce jointe (PDF). Si vous préférez que ces corrections soient appliquées pour vous, répondez à cet email.<br>
    Audit automatisé, non contractuel : aucune garantie de position ou de trafic.</p>
  </div></body></html>`;
}
