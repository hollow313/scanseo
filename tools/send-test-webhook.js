#!/usr/bin/env node
import crypto from 'node:crypto';

// Usage: node tools/send-test-webhook.js <webhook_url> <webhook_secret> <product_id> <customer_email> <site_url>
const args = process.argv.slice(2);
const targetUrl = args[0] || 'http://192.168.1.200:30023/webhook/polar';
const secret = args[1] || process.env.POLAR_WEBHOOK_SECRET;
const productId = args[2] || process.env.POLAR_PRODUCT_49 || 'test-product-49';
const email = args[3] || 'loic.huon@outlook.com';
const site = args[4] || 'https://scanseo.fr';

if (!secret) {
  console.error('Erreur: Veuillez spécifier le secret Polar (arg 2 ou env POLAR_WEBHOOK_SECRET)');
  process.exit(1);
}

const webhookId = `msg_${crypto.randomUUID()}`;
const timestamp = Math.floor(Date.now() / 1000).toString();

const payload = JSON.stringify({
  type: 'order.paid',
  data: {
    id: `order_${crypto.randomUUID()}`,
    product_id: productId,
    amount: 4900,
    currency: 'eur',
    customer: { email },
    custom_field_data: { site }
  }
});

const secretClean = secret.replace(/^whsec_/, '');
const key = Buffer.from(secretClean, 'base64');
const toSign = Buffer.concat([
  Buffer.from(`${webhookId}.${timestamp}.`, 'utf8'),
  Buffer.from(payload, 'utf8')
]);
const hmac = crypto.createHmac('sha256', key).update(toSign).digest('base64');
const signature = `v1,${hmac}`;

console.log(`Envoi du webhook polar à ${targetUrl} (ID: ${webhookId})...`);

fetch(targetUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature
  },
  body: payload
}).then(async (res) => {
  console.log(`Statut HTTP: ${res.status}`);
  const text = await res.text();
  console.log(`Réponse: ${text}`);
}).catch((err) => {
  console.error('Erreur d\'envoi:', err.message);
});
