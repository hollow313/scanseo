import { validateConfig, config } from './src/config.js';
import { getDb, setSystemKv } from './src/db.js';
import { processAudit } from './src/pipeline.js';

// 1. Validation de la configuration
validateConfig();

// 2. Initialisation DB
const db = getDb();
console.log('[scanseo-worker] Démarrage (concurrence 1), rapports dans', config.reportsDir);

// 3. Récupération des audits bloqués au démarrage (crash recovery > 20 min)
try {
  const recovered = db.prepare(`
    UPDATE audits
    SET status = 'queued', claimed_at = NULL
    WHERE status = 'running'
      AND (claimed_at IS NULL OR datetime(claimed_at) < datetime('now', '-20 minutes'))
  `).run();
  if (recovered.changes > 0) {
    console.log(`[scanseo-worker] Récupéré ${recovered.changes} audit(s) orphelin(s) -> queued`);
  }
} catch (e) {
  console.error('[scanseo-worker] Erreur lors de la récupération des orphelins:', e.message);
}

let running = true;

function heartbeat() {
  try {
    setSystemKv('worker_heartbeat', new Date().toISOString());
  } catch (e) {
    console.error("[scanseo-worker] Erreur d'écriture du heartbeat:", e.message);
  }
}

/** Réserve un audit : queued et prêt (claimed_at NULL ou date de reprise dépassée). */
function claim() {
  return db.transaction(() => {
    const item = db.prepare(`
      SELECT * FROM audits
      WHERE status = 'queued'
        AND (claimed_at IS NULL OR datetime(claimed_at) <= datetime('now'))
      ORDER BY created_at ASC
      LIMIT 1
    `).get();
    if (!item) return null;
    db.prepare(`
      UPDATE audits
      SET status = 'running', claimed_at = datetime('now'), started_at = COALESCE(started_at, datetime('now'))
      WHERE id = ?
    `).run(item.id);
    return db.prepare('SELECT * FROM audits WHERE id = ?').get(item.id);
  })();
}

// Le heartbeat doit battre PENDANT un audit, pas seulement entre deux : le pipeline
// bloque la boucle plusieurs minutes (crawl + LLM + PDF), ce qui faisait croire à un
// worker mort alors qu'il travaillait. Un audit de 6 minutes déclenchait l'alerte.
const beatTimer = setInterval(heartbeat, 15000);
if (typeof beatTimer.unref === 'function') beatTimer.unref();

async function loop() {
  heartbeat();
  while (running) {

    let audit = null;
    try {
      audit = claim();
    } catch (e) {
      console.error('[scanseo-worker] Erreur de boucle:', e.message);
    }

    if (audit) {
      console.log(`[scanseo-worker] Audit ${audit.id.slice(0, 8)} pris en charge (${audit.url})`);
      try {
        await processAudit(audit);
      } catch (e) {
        console.error(`[scanseo-worker] Pipeline a levé une exception non gérée: ${e.message}`);
        db.prepare("UPDATE audits SET status='failed', error=?, finished_at=? WHERE id=?")
          .run(`${e.code || 'ERROR'}: ${e.message}`, new Date().toISOString(), audit.id);
      }
      continue; // enchaîne aussitôt sur l'audit suivant s'il y en a un
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

loop();

function shutdown(signal) {
  console.log(`[scanseo-worker] Signal ${signal} reçu, arrêt propre...`);
  running = false;
  setTimeout(() => {
    try {
      db.close();
    } catch (e) { /* déjà fermée */ }
    process.exit(0);
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
