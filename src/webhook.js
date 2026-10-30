import crypto from 'node:crypto';
import { config } from './config.js';
import { getDb } from './db.js';
import { generateAuditToken } from './token.js';
import { sendEmail, sendAdminAlert } from './mail.js';
import { renderBriefEmail, renderNeedsSiteEmail } from './templates/emails.js';

export function verifyPolarSignature(headers, rawBody) {
  const webhookId = headers['webhook-id'];
  const webhookTimestamp = headers['webhook-timestamp'];
  const webhookSignature = headers['webhook-signature'];

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  if (!config.polarWebhookSecret) {
    return false;
  }

  // Vérification de la fenêtre temporelle (|now - ts| <= 300 s)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(webhookTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  // Préparation de la clé HMAC (retrait whsec_ et décodage base64)
  const secretKeyClean = config.polarWebhookSecret.replace(/^whsec_/, '');
  let keyBuffer;
  try {
    keyBuffer = Buffer.from(secretKeyClean, 'base64');
  } catch (e) {
    return false;
  }

  // Contenu signé : {webhook-id}.{webhook-timestamp}.{corps brut}
  const toSign = Buffer.concat([
    Buffer.from(`${webhookId}.${webhookTimestamp}.`, 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8')
  ]);

  const hmac = crypto.createHmac('sha256', keyBuffer);
  hmac.update(toSign);
  const computedSignature = hmac.digest('base64');

  // En-tête webhook-signature : v1,<base64> (peut contenir plusieurs signatures séparées par des espaces)
  const signatures = webhookSignature.split(' ').map((s) => s.trim());
  for (const sig of signatures) {
    const parts = sig.split(',');
    if (parts.length === 2 && parts[0] === 'v1') {
      const candidate = parts[1];
      const candidateBuf = Buffer.from(candidate);
      const computedBuf = Buffer.from(computedSignature);
      if (candidateBuf.length === computedBuf.length && crypto.timingSafeEqual(candidateBuf, computedBuf)) {
        return true;
      }
    }
  }

  return false;
}

export function normalizeSiteUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let str = rawUrl.trim();
  if (!str) return null;

  if (!/^https?:\/\//i.test(str)) {
    str = `https://${str}`;
  }

  try {
    const parsed = new URL(str);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname;
    if (pathname === '/') pathname = '';
    const cleanUrl = `https://${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
    return { url: cleanUrl, host };
  } catch (e) {
    return null;
  }
}

export async function handlePolarWebhook(req, res) {
  try {
    return await handlePolarWebhookInner(req, res);
  } catch (err) {
    // Une exception dans ce handler ne doit JAMAIS tuer le process : Polar réessaie,
    // et un site tombé pour un webhook mal formé est une panne bien plus grave.
    console.error('[webhook] exception non gérée:', err?.message || err);
    try {
      const db = getDb();
      const wid = req.headers['webhook-id'];
      if (wid) {
        db.prepare("UPDATE events SET status='failed', last_error=? WHERE webhook_id=? AND status != 'processed'")
          .run(String(err?.message || err).slice(0, 500), wid);
      }
    } catch { /* la traçabilité ne doit pas masquer l'erreur d'origine */ }
    if (!res.headersSent) return res.status(500).json({ error: 'processing_failed' });
    return undefined;
  }
}

async function handlePolarWebhookInner(req, res) {
  const rawBody = req.body;
  const headers = req.headers;

  // 1. Contrôle de signature Standard Webhooks
  if (!verifyPolarSignature(headers, rawBody)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    event = JSON.parse(bodyStr);
  } catch (err) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const webhookId = headers['webhook-id'];
  const db = getDb();
  const now = new Date().toISOString();

  // 2. Idempotence par webhook_id
  const existingEvent = db.prepare('SELECT id, status FROM events WHERE webhook_id = ?').get(webhookId);
  if (existingEvent && existingEvent.status === 'processed') {
    return res.status(200).json({ ok: true, already_processed: true });
  }

  const rawJsonSnippet = (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(event)).slice(0, 65535);

  let eventRowId;
  if (!existingEvent) {
    const ins = db.prepare(`
      INSERT INTO events (provider, webhook_id, type, payload, status, attempts, received_at)
      VALUES ('polar', ?, ?, ?, 'received', 1, ?)
    `).run(webhookId, event.type || 'unknown', rawJsonSnippet, now);
    eventRowId = ins.lastInsertRowid;
  } else {
    eventRowId = existingEvent.id;
    db.prepare('UPDATE events SET attempts = attempts + 1 WHERE id = ?').run(eventRowId);
  }

  const eventType = event.type;

  // 3. Traitement selon type d'événement
  if (eventType === 'order.paid') {
    const data = event.data || {};
    const productId = data.product_id;

    // Idempotence métier, en plus de celle par webhook-id : Polar peut renvoyer le même
    // paiement avec un NOUVEL identifiant d'événement. Sans ce garde, l'insertion violait
    // la contrainte UNIQUE sur orders.provider_ref et faisait tomber le process.
    if (data.id) {
      const existingOrder = db.prepare('SELECT id FROM orders WHERE provider_ref = ?').get(data.id);
      if (existingOrder) {
        db.prepare("UPDATE events SET status = 'processed', processed_at = ? WHERE id = ?").run(now, eventRowId);
        return res.status(200).json({ ok: true, already_processed: true });
      }
    }

    // Détermination de l'offre
    let offer = null;
    if (productId && productId === config.polarProduct29) {
      offer = 'audit_29';
    } else if (productId && productId === config.polarProduct59) {
      offer = 'audit_59';
    } else if (productId && productId === config.polarProduct49) {
      offer = 'audit_49';
    } else if (productId && productId === config.polarProduct149) {
      offer = 'audit_149';
    } else {
      // Produit inconnu -> échec tracé, alerte admin, réponse 200 sans inventer de licence
      db.prepare("UPDATE events SET status = 'failed', last_error = 'unknown_product_id' WHERE id = ?").run(eventRowId);
      await sendAdminAlert('Commande Polar avec produit inconnu', {
        webhookId,
        productId,
        orderData: data
      });
      return res.status(200).json({ ok: true, status: 'unknown_product' });
    }

    const customerEmail = data.customer?.email || data.customer_email || data.email;
    const rawSite = data.custom_field_data?.site || data.custom_fields?.site;
    const normalized = normalizeSiteUrl(rawSite);

    // Cas custom_field_data.site manquant ou invalide
    if (!normalized) {
      const orderId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO orders (id, provider, provider_ref, product_id, offer, amount, currency, email, site_url, status, raw_json, created_at, updated_at)
        VALUES (?, 'polar', ?, ?, ?, ?, ?, ?, NULL, 'needs_site', ?, ?, ?)
      `).run(
        orderId,
        data.id,
        productId,
        offer,
        data.amount || (offer === 'audit_49' ? 4900 : 14900),
        data.currency || 'eur',
        customerEmail || null,
        rawJsonSnippet,
        now,
        now
      );

      db.prepare("UPDATE events SET status = 'processed', processed_at = ? WHERE id = ?").run(now, eventRowId);

      // Email au client "indiquez l'URL de votre site"
      if (customerEmail) {
        const { subject, text, html } = renderNeedsSiteEmail({
          contactEmail: config.contactEmail,
          orderId
        });
        await sendEmail({
          to: customerEmail,
          kind: 'brief',
          subject,
          text,
          html
        });
      }

      await sendAdminAlert('Commande payée sans URL de site spécifiée', {
        orderId,
        email: customerEmail,
        offer
      });

      return res.status(200).json({ ok: true, status: 'needs_site' });
    }

    // Cas normal : site présent et valide
    const orderId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const token = generateAuditToken(auditId);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (id, provider, provider_ref, product_id, offer, amount, currency, email, site_url, status, raw_json, created_at, updated_at)
        VALUES (?, 'polar', ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
      `).run(
        orderId,
        data.id,
        productId,
        offer,
        data.amount || (offer === 'audit_49' ? 4900 : 14900),
        data.currency || 'eur',
        customerEmail || null,
        normalized.url,
        rawJsonSnippet,
        now,
        now
      );

      db.prepare(`
        INSERT INTO audits (id, order_id, token, url, host, offer, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        auditId,
        orderId,
        token,
        normalized.url,
        normalized.host,
        offer,
        now
      );

      db.prepare("UPDATE events SET status = 'processed', processed_at = ? WHERE id = ?").run(now, eventRowId);
    })();

    // Envoi de l'email brief
    if (customerEmail) {
      const auditUrl = `${config.publicBaseUrl}/audit/${token}`;
      const { subject, text, html } = renderBriefEmail({
        token,
        auditUrl,
        siteUrl: normalized.url
      });

      await sendEmail({
        to: customerEmail,
        kind: 'brief',
        auditId,
        subject,
        text,
        html
      });
    }

    return res.status(200).json({ ok: true, audit_id: auditId, token });
  }

  if (eventType === 'order.refunded') {
    const data = event.data || {};
    const providerRef = data.id || data.order_id;

    db.transaction(() => {
      const order = db.prepare('SELECT id FROM orders WHERE provider_ref = ?').get(providerRef);
      if (order) {
        db.prepare("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?").run(now, order.id);
        db.prepare("UPDATE audits SET status = 'refunded' WHERE order_id = ?").run(order.id);
      }
      db.prepare("UPDATE events SET status = 'processed', processed_at = ? WHERE id = ?").run(now, eventRowId);
    })();

    console.log(`[polar] order.refunded traité pour ${providerRef} (aucun email envoyé)`);
    return res.status(200).json({ ok: true, status: 'refunded' });
  }

  // Événements ignorés (ex: subscription.*, etc.)
  db.prepare("UPDATE events SET status = 'ignored', processed_at = ? WHERE id = ?").run(now, eventRowId);
  return res.status(200).json({ ok: true, status: 'ignored' });
}
