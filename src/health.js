import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { config } from './config.js';
import { getDb, getSystemKv } from './db.js';
import { checkContentHealth } from './content.js';

let cachedChromiumVersion = null;

export function getChromiumVersion() {
  if (cachedChromiumVersion !== null) {
    return cachedChromiumVersion;
  }

  const candidates = [
    process.env.CHROMIUM_PATH,
    config.chromiumPath,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/lib/chromium/chrome'
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) {
        const out = execSync(`"${bin}" --version`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const match = out.match(/(\d+\.\d+\.\d+\.\d+)/);
        cachedChromiumVersion = match ? match[1] : out.trim();
        return cachedChromiumVersion;
      }
    } catch (e) {}
  }

  // Fallback try which on PATH
  try {
    const whichCmd = process.platform === 'win32' ? 'where chromium chromium-browser' : 'which chromium-browser || which chromium';
    const resolved = execSync(whichCmd, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0];
    if (resolved) {
      const out = execSync(`"${resolved}" --version`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const match = out.match(/(\d+\.\d+\.\d+\.\d+)/);
      cachedChromiumVersion = match ? match[1] : out.trim();
      return cachedChromiumVersion;
    }
  } catch (e) {}

  cachedChromiumVersion = '';
  return cachedChromiumVersion;
}

export function checkReportsWritable() {
  try {
    if (!fs.existsSync(config.reportsDir)) {
      fs.mkdirSync(config.reportsDir, { recursive: true });
    }
    const probe = path.join(config.reportsDir, `.probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

export function checkHealth() {
  let dbOk = false;
  let queue = { pending: 0, running: 0, failed: 0 };
  let mailStatus = 'missing';

  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as alive').get();
    if (row && row.alive === 1) {
      dbOk = true;
    }

    const counts = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('pending', 'queued') THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
      FROM audits
    `).get();

    if (counts) {
      queue = {
        pending: Number(counts.pending || 0),
        running: Number(counts.running || 0),
        failed: Number(counts.failed || 0)
      };
    }

    // Mail status
    const recentSent = db.prepare(`
      SELECT id FROM emails
      WHERE status = 'sent' AND datetime(sent_at) > datetime('now', '-24 hours')
      LIMIT 1
    `).get();

    if (recentSent) {
      mailStatus = 'ok';
    } else {
      const recentFailed = db.prepare(`
        SELECT id FROM emails
        WHERE status = 'failed' AND datetime(created_at) > datetime('now', '-24 hours')
        ORDER BY id DESC LIMIT 1
      `).get();

      if (recentFailed) {
        mailStatus = 'failing';
      } else if (config.smtpUrl && config.smtpUrl.trim() !== '') {
        mailStatus = 'configured';
      } else {
        mailStatus = 'missing';
      }
    }
  } catch (e) {
    dbOk = false;
  }

  const reportsOk = checkReportsWritable();
  const contentOk = checkContentHealth();
  const chromiumVersion = getChromiumVersion();
  const workerLastSeen = getSystemKv('worker_heartbeat');

  // Une offre en vente sans produit Polar est une boutique fermée : le bouton
  // « Commander » renvoie une erreur. On l'expose dans /healthz et dans l'admin.
  const products = {
    audit_29: Boolean(config.polarProduct29),
    audit_59: Boolean(config.polarProduct59),
  };
  const shopReady = products.audit_29 && products.audit_59;

  const ok = dbOk && reportsOk && contentOk && (mailStatus === 'configured' || mailStatus === 'ok');

  return {
    statusCode: ok ? 200 : 503,
    data: {
      ok,
      version: '0.1.0',
      db: dbOk,
      reports: reportsOk,
      content: contentOk,
      mail: mailStatus,
      chromium_version: chromiumVersion,
      worker_last_seen: workerLastSeen,
      polar_products: products,
      shop_ready: shopReady,
      queue
    }
  };
}
