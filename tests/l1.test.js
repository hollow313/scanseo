import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to compute Standard Webhooks signature
function signPayload(secret, webhookId, timestamp, rawBody) {
  const secretClean = secret.replace(/^whsec_/, '');
  const key = Buffer.from(secretClean, 'base64');
  const toSign = Buffer.concat([
    Buffer.from(`${webhookId}.${timestamp}.`, 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8')
  ]);
  const hmac = crypto.createHmac('sha256', key).update(toSign).digest('base64');
  return `v1,${hmac}`;
}

test('L1 — Polar Webhook, Commandes, Audits et Emails', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanseo-l1-test-'));
  const dataDir = path.join(tmpDir, 'data');
  const reportsDir = path.join(tmpDir, 'reports');
  const contentDir = path.join(tmpDir, 'content');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });

  const testSecretKey = 'whsec_' + Buffer.from('my-super-secret-key-32bytes-long!').toString('base64');
  const prod49Id = 'prod-uuid-49';
  const prod149Id = 'prod-uuid-149';
  const serverPort = 31025;

  const testEnv = {
    ...process.env,
    PORT: String(serverPort),
    PUBLIC_BASE_URL: `http://localhost:${serverPort}`,
    DEEPSEEK_API_KEY: 'sk-test',
    PAGESPEED_API_KEY: 'AIzaTest',
    POLAR_WEBHOOK_SECRET: testSecretKey,
    POLAR_PRODUCT_49: prod49Id,
    POLAR_PRODUCT_149: prod149Id,
    // JSON transport for test nodemailer
    SMTP_URL: 'smtps://fakeuser%40scanseo.fr:fakepass@smtp.mail.ovh.net:465',
    SMTP_FROM: 'ScanSEO <contact@scanseo.fr>',
    CONTACT_EMAIL: 'contact@scanseo.fr',
    ADMIN_USER: 'loic',
    ADMIN_PASSWORD_HASH: '$2b$12$e84cQZ1jZ3QvCjJ03Q61j.YlG5aWjEcfGjYpB0bH4kF7VpE0nUv4G',
    SIGNING_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    DATA_DIR: dataDir,
    REPORTS_DIR: reportsDir,
    CONTENT_DIR: contentDir
  };

  const serverProc = fork(path.join(ROOT_DIR, 'server.js'), [], {
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  // Database handle for assertions
  const dbPath = path.join(dataDir, 'scanseo.db');

  try {
    // Wait for server to start
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timeout')), 6000);
      serverProc.stdout.on('data', (data) => {
        if (data.toString().includes(`En écoute sur le port ${serverPort}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      serverProc.on('error', reject);
    });

    const db = new Database(dbPath);

    // CRITÈRE 2 : Signatures absente / fausse / timestamp expiré
    await t.test('L1.2 - Signature absente -> 401', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'test' })
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'invalid_signature');
    });

    await t.test('L1.2 - Signature fausse -> 401', async () => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': 'msg_fake_1',
          'webhook-timestamp': ts,
          'webhook-signature': 'v1,dGhpcy1pcy1hLWZha2Utc2lnbmF0dXJl'
        },
        body: JSON.stringify({ event: 'test' })
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'invalid_signature');
    });

    await t.test('L1.2 - Timestamp expiré (-600s) -> 401', async () => {
      const body = JSON.stringify({ event: 'test' });
      const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
      const sig = signPayload(testSecretKey, 'msg_old_1', oldTs, body);
      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': 'msg_old_1',
          'webhook-timestamp': oldTs,
          'webhook-signature': sig
        },
        body
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'invalid_signature');
    });

    // CRITÈRE 1 : Corps brut préservé avec JSON réindenté mais signé sur l'original
    await t.test('L1.1 - Corps brut préservé', async () => {
      // Original raw body contains specific whitespaces / indentation
      const rawOriginal = '{\n  "type": "ignored.type",\n  "data": { "id": "test_raw_1" }\n}';
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = signPayload(testSecretKey, 'msg_raw_1', ts, rawOriginal);

      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': 'msg_raw_1',
          'webhook-timestamp': ts,
          'webhook-signature': sig
        },
        body: rawOriginal
      });

      assert.equal(res.status, 200, 'Doit accepter le corps brut signé');
      const json = await res.json();
      assert.equal(json.ok, true);
    });

    // CRITÈRE 3 : order.paid signé (produit 49) -> 200, orders, audits pending, emails brief
    const orderPaidPayload = JSON.stringify({
      type: 'order.paid',
      data: {
        id: 'polar_order_123',
        product_id: prod49Id,
        amount: 4900,
        currency: 'eur',
        customer: {
          email: 'client@example.com'
        },
        custom_field_data: {
          site: 'https://mon-artisan-plombier.fr'
        }
      }
    });
    const paidWebhookId = 'msg_paid_49_test';
    const paidTs = Math.floor(Date.now() / 1000).toString();
    const paidSig = signPayload(testSecretKey, paidWebhookId, paidTs, orderPaidPayload);

    await t.test('L1.3 - order.paid signé (produit 49) crée commande et audit', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': paidWebhookId,
          'webhook-timestamp': paidTs,
          'webhook-signature': paidSig
        },
        body: orderPaidPayload
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.ok(json.audit_id);
      assert.ok(json.token);

      // Vérification en base orders
      const order = db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get('polar_order_123');
      assert.ok(order, 'La commande doit être enregistrée');
      assert.equal(order.offer, 'audit_49');
      assert.equal(order.amount, 4900);
      assert.equal(order.status, 'paid');
      assert.equal(order.email, 'client@example.com');
      assert.equal(order.site_url, 'https://mon-artisan-plombier.fr');

      // Vérification en base audits
      const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(json.audit_id);
      assert.ok(audit, 'L\'audit doit être créé');
      assert.equal(audit.status, 'pending');
      assert.equal(audit.offer, 'audit_49');
      assert.equal(audit.host, 'mon-artisan-plombier.fr');
      assert.equal(audit.token, json.token);

      // Vérification en base emails
      const email = db.prepare('SELECT * FROM emails WHERE audit_id = ?').get(json.audit_id);
      assert.ok(email, 'Un email doit être enregistré');
      assert.equal(email.kind, 'brief');
      assert.equal(email.to_addr, 'client@example.com');
      assert.ok(['sent', 'failed'].includes(email.status), 'Statut de l\'email doit être explicite (sent ou failed)');
    });

    // CRITÈRE 4 : Rejeu du même webhook-id -> 200 already_processed
    await t.test('L1.4 - Rejeu du même webhook-id', async () => {
      const countBefore = db.prepare('SELECT count(*) as count FROM audits').get().count;

      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': paidWebhookId,
          'webhook-timestamp': paidTs,
          'webhook-signature': paidSig
        },
        body: orderPaidPayload
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.already_processed, true);

      const countAfter = db.prepare('SELECT count(*) as count FROM audits').get().count;
      assert.equal(countBefore, countAfter, 'Le nombre d\'audits ne doit pas changer au rejeu');
    });

    // CRITÈRE 5 : order.paid d'un product_id inconnu -> 200, events.status='failed', alerte admin
    await t.test('L1.5 - Produit inconnu -> 200, events.status=failed, alerte admin', async () => {
      const unknownPayload = JSON.stringify({
        type: 'order.paid',
        data: {
          id: 'polar_order_unknown',
          product_id: 'unknown-prod-xyz',
          customer: { email: 'client@example.com' },
          custom_field_data: { site: 'https://test.fr' }
        }
      });
      const unknownWebhookId = 'msg_unknown_prod';
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = signPayload(testSecretKey, unknownWebhookId, ts, unknownPayload);

      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': unknownWebhookId,
          'webhook-timestamp': ts,
          'webhook-signature': sig
        },
        body: unknownPayload
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'unknown_product');

      const event = db.prepare('SELECT * FROM events WHERE webhook_id = ?').get(unknownWebhookId);
      assert.ok(event);
      assert.equal(event.status, 'failed');
      assert.equal(event.last_error, 'unknown_product_id');

      // Aucun audit créé
      const order = db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get('polar_order_unknown');
      assert.equal(order, undefined, 'Aucune commande ni audit pour un produit inconnu');
    });

    // CRITÈRE 6 : order.paid sans custom_field_data.site -> 200, orders.status='needs_site', jamais 500
    await t.test('L1.6 - order.paid sans site -> 200, orders.status=needs_site', async () => {
      const noSitePayload = JSON.stringify({
        type: 'order.paid',
        data: {
          id: 'polar_order_no_site',
          product_id: prod49Id,
          customer: { email: 'client-no-site@example.com' },
          custom_field_data: {}
        }
      });
      const noSiteWebhookId = 'msg_no_site';
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = signPayload(testSecretKey, noSiteWebhookId, ts, noSitePayload);

      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': noSiteWebhookId,
          'webhook-timestamp': ts,
          'webhook-signature': sig
        },
        body: noSitePayload
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'needs_site');

      const order = db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get('polar_order_no_site');
      assert.ok(order);
      assert.equal(order.status, 'needs_site');
      assert.equal(order.site_url, null);

      // Vérifie l'envoi d'email au client
      const email = db.prepare('SELECT * FROM emails WHERE to_addr = ?').get('client-no-site@example.com');
      assert.ok(email, 'Un email d\'invitation à préciser l\'URL doit être enregistré');
    });

    // CRITÈRE 7 : order.refunded -> orders.status='refunded', audit -> 'refunded', aucun email
    await t.test('L1.7 - order.refunded -> refunded, aucun email envoyé', async () => {
      const refundPayload = JSON.stringify({
        type: 'order.refunded',
        data: {
          id: 'polar_order_123'
        }
      });
      const refundWebhookId = 'msg_refund_123';
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = signPayload(testSecretKey, refundWebhookId, ts, refundPayload);

      const emailCountBefore = db.prepare('SELECT count(*) as count FROM emails').get().count;

      const res = await fetch(`http://127.0.0.1:${serverPort}/webhook/polar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': refundWebhookId,
          'webhook-timestamp': ts,
          'webhook-signature': sig
        },
        body: refundPayload
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'refunded');

      const order = db.prepare('SELECT * FROM orders WHERE provider_ref = ?').get('polar_order_123');
      assert.equal(order.status, 'refunded');

      const audit = db.prepare('SELECT * FROM audits WHERE order_id = ?').get(order.id);
      assert.equal(audit.status, 'refunded');

      // Aucun nouvel email généré
      const emailCountAfter = db.prepare('SELECT count(*) as count FROM emails').get().count;
      assert.equal(emailCountBefore, emailCountAfter, 'Aucun email ne doit être envoyé sur un remboursement');
    });

    // Vérification de la page publique modifiée (<title> <= 65, labels, offres en cartes)
    await t.test('Page d\'accueil - title <= 65 chars, labels visibles, cartes de prix', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/`);
      assert.equal(res.status, 200);
      const html = await res.text();

      // Title <= 65
      const match = html.match(/<title>([^<]+)<\/title>/);
      assert.ok(match, 'Title doit exister');
      assert.ok(match[1].length <= 65, `Title "${match[1]}" dépasse 65 caractères (${match[1].length})`);

      // Labels visibles
      // Libellé issu de la refonte : il doit rester explicite pour un dirigeant non technique.
      assert.match(html, /<label[^>]*for="scan-url"[^>]*>Adresse du site<\/label>/);
      assert.match(html, /<label[^>]*for="scan-email"[^>]*>Email \(facultatif\)<\/label>/);

      // Cartes d'offres distinctes avec prix en gros et boutons
      assert.match(html, /class="price-card"/);
      assert.match(html, /class="price-card featured"/);
      // L'espace insécable est légitime dans un prix : on ne teste pas le caractère.
      assert.match(html, /29(?:&nbsp;|\u00a0|\s)*€/);
      assert.match(html, /59(?:&nbsp;|\u00a0|\s)*€/);
      assert.match(html, /href="\/checkout\/audit_29"/);
      assert.match(html, /href="\/checkout\/audit_59"/);

      // Bientôt disponible pour /api/scan
      // Les deux offres sont achetables : plus aucune mention « bientôt disponible ».
      assert.doesNotMatch(html, /bientôt disponible/i);
    });

  } finally {
    serverProc.kill('SIGTERM');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
});
