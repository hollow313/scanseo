// Test de bout en bout local : webhook signé → audit → brief → worker → PDF → email.
// Prérequis : serveur (port 3999) + worker + puits SMTP démarrés, .env chargé.
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE = `http://127.0.0.1:${process.env.PORT || 3999}`;
const SECRET = process.env.POLAR_WEBHOOK_SECRET || '';
const DB_PATH = path.join(process.env.DATA_DIR || '/data', 'scanseo.db');
const PRODUCT_49 = process.env.POLAR_PRODUCT_49;
const SITE = process.env.E2E_SITE || 'https://example.com';
const EMAIL = process.env.E2E_EMAIL || 'acheteur-e2e@example.com';

const db = new Database(DB_PATH, { readonly: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(body, id, ts) {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  return crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

async function postWebhook(type, data) {
  const body = JSON.stringify({ type, data });
  const id = `msg_e2e_${Date.now()}`;
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(body, id, ts);
  const res = await fetch(`${BASE}/webhook/polar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': `v1,${sig}`,
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null), id };
}

function step(n, msg) { console.log(`\n[${n}] ${msg}`); }

async function main() {
  if (process.argv.includes('--verify-only')) {
    const last = db.prepare('SELECT * FROM audits ORDER BY created_at DESC LIMIT 1').get();
    if (!last) throw new Error('aucun audit en base');
    console.log(`audit ${last.id.slice(0, 8)} — ${last.url}`);
    return verify(last);
  }

  step(1, `webhook order.paid (${SITE})`);
  const orderId = `ord_e2e_${Date.now()}`;
  const wh = await postWebhook('order.paid', {
    id: orderId,
    status: 'paid',
    amount: 4900,
    currency: 'eur',
    product_id: PRODUCT_49,
    customer: { email: EMAIL },
    custom_field_data: { site: SITE },
  });
  console.log('  →', wh.status, JSON.stringify(wh.json));

  const order = db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get(orderId);
  if (!order) throw new Error('commande non créée');
  let audit = db.prepare('SELECT * FROM audits WHERE order_id = ?').get(order.id);
  if (!audit) throw new Error('audit non créé');
  console.log(`  → audit ${audit.id.slice(0, 8)} statut=${audit.status} token=${audit.token.slice(0, 12)}…`);

  step(2, 'idempotence : même événement rejoué, puis même commande avec un nouvel id');
  const replay = await postWebhook('order.paid', {
    id: orderId, status: 'paid', amount: 4900, currency: 'eur',
    product_id: PRODUCT_49, customer: { email: EMAIL }, custom_field_data: { site: SITE },
  });
  const count1 = db.prepare('SELECT count(*) c FROM audits').get().c;
  console.log(`  → même webhook-id: ${replay.status} ${JSON.stringify(replay.json)} | audits = ${count1}`);
  const replay2 = await postWebhook('order.paid', {
    id: orderId, status: 'paid', amount: 4900, currency: 'eur',
    product_id: PRODUCT_49, customer: { email: EMAIL }, custom_field_data: { site: SITE },
  });
  const count2 = db.prepare('SELECT count(*) c FROM audits').get().c;
  console.log(`  → nouvel id, même commande: ${replay2.status} ${JSON.stringify(replay2.json)} | audits = ${count2}`);
  if (count2 !== count1) throw new Error('un audit a été créé en double');
  if (!(await fetch(`${BASE}/healthz`).then((r) => r.ok))) throw new Error('le serveur est tombé après le rejeu');

  step(3, 'brief client (activité + ville)');
  const brief = await fetch(`${BASE}/audit/${audit.token}/brief`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ activity: 'plombier chauffagiste', city: 'Toulouse', competitors: '' }),
  });
  const after = db.prepare('SELECT status, activity, city FROM audits WHERE id = ?').get(audit.id);
  console.log(`  → HTTP ${brief.status} | statut=${after.status} activité=${after.activity} ville=${after.city}`);

  step(4, 'attente du worker (crawl + rédaction + PDF + email)');
  const t0 = Date.now();
  let final = null;
  while (Date.now() - t0 < 420000) {
    final = db.prepare('SELECT * FROM audits WHERE id = ?').get(audit.id);
    if (['done', 'failed'].includes(final.status)) break;
    await sleep(5000);
    process.stdout.write(`  … ${final.status} (${Math.round((Date.now() - t0) / 1000)} s)\r`);
  }
  console.log(`\n  → statut final: ${final.status} en ${Math.round((Date.now() - t0) / 1000)} s`);
  if (final.error) console.log(`  → erreur: ${final.error}`);

  step(5, 'vérifications');
  return verify(final);
}

function verify(final) {
  const audit = { id: final.id };
  const checks = [];
  const pdfExists = final.pdf_path && fs.existsSync(final.pdf_path);
  checks.push(['statut done', final.status === 'done']);
  checks.push(['PDF sur disque', Boolean(pdfExists)]);
  if (pdfExists) {
    const size = fs.statSync(final.pdf_path).size;
    const head = fs.readFileSync(final.pdf_path).subarray(0, 5).toString();
    checks.push([`PDF valide (${Math.round(size / 1024)} Ko)`, head === '%PDF-']);
    const dir = path.dirname(final.pdf_path);
    checks.push(['faits.json conservé', fs.existsSync(path.join(dir, 'faits.json'))]);
    checks.push(['rapport.json conservé', fs.existsSync(path.join(dir, 'rapport.json'))]);
  }
  const mails = db.prepare('SELECT kind, status, to_addr FROM emails WHERE audit_id = ?').all(audit.id);
  checks.push([`emails: ${mails.map((m) => `${m.kind}=${m.status}`).join(', ') || 'aucun'}`,
    mails.some((m) => m.kind === 'delivery' && m.status === 'sent')]);
  checks.push([`score: ${final.score}/100`, Number.isFinite(final.score) && final.score >= 0 && final.score <= 100]);
  checks.push([`pages crawlées: ${final.pages_crawled}`, final.pages_crawled > 0]);
  checks.push([`coût LLM: ${(final.cost_usd || 0).toFixed(4)} $`, (final.cost_usd || 0) < 0.2]);
  const findings = db.prepare('SELECT count(*) c FROM findings WHERE audit_id = ?').get(audit.id).c;
  checks.push([`constats en base: ${findings}`, findings >= 8]);

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? 'OK ' : 'KO '} ${label}`);
    if (!pass) ok = false;
  }
  console.log(`\nRÉSULTAT : ${ok ? 'E2E VALIDÉ' : 'E2E EN ÉCHEC'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('E2E ERREUR:', e.message); process.exit(1); });
