import crypto from 'node:crypto';
import { config } from './config.js';

export function generateAuditToken(auditId) {
  const hmac = crypto.createHmac('sha256', config.signingSecret);
  hmac.update(auditId);
  const sig16 = hmac.digest().subarray(0, 16).toString('base64url');
  const shortId = auditId.replace(/-/g, '').slice(0, 8);
  return `${sig16}${shortId}`;
}

export function verifyAuditToken(auditId, token) {
  if (!auditId || !token) return false;
  const expected = generateAuditToken(auditId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
