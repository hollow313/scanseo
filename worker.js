import { validateConfig } from './src/config.js';
import { getDb, setSystemKv } from './src/db.js';

// 1. Validation de la configuration
validateConfig();

// 2. Initialisation DB
const db = getDb();
console.log('[scanseo-worker] Démarrage du worker (concurrence 1)...');

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

// 4. Boucle principale de traitement
let running = true;

async function heartbeat() {
  try {
    setSystemKv('worker_heartbeat', new Date().toISOString());
  } catch (e) {
    console.error('[scanseo-worker] Erreur d\'écriture du heartbeat:', e.message);
  }
}

async function loop() {
  while (running) {
    await heartbeat();

    try {
      // BEGIN IMMEDIATE pour verrouiller la sélection de l'audit
      const audit = db.transaction(() => {
        const item = db.prepare(`
          SELECT * FROM audits
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
        `).get();

        if (item) {
          db.prepare(`
            UPDATE audits
            SET status = 'running', claimed_at = datetime('now'), attempts = attempts + 1
            WHERE id = ?
          `).run(item.id);
        }
        return item;
      })();

      if (audit) {
        console.log(`[scanseo-worker] Audit ${audit.id} pris en charge pour ${audit.url}`);
        // Dans les lots suivants, on exécute le pipeline complet (crawl, facts, LLM, PDF, email)
      }
    } catch (e) {
      console.error('[scanseo-worker] Erreur de boucle:', e.message);
    }

    // Attente de 3 secondes avant la prochaine vérification
    await new Promise((r) => setTimeout(r, 3000));
  }
}

loop();

function shutdown(signal) {
  console.log(`[scanseo-worker] Signal ${signal} reçu, arrêt propre du worker...`);
  running = false;
  setTimeout(() => {
    try {
      db.close();
    } catch (e) {}
    process.exit(0);
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
