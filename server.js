import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { validateConfig, config } from './src/config.js';
import { getDb } from './src/db.js';
import { checkHealth } from './src/health.js';
import { getPageContent, resolveImage } from './src/content.js';
import { renderPage } from './src/views/layout.js';

// 1. Validation stricte des variables d'environnement requises
validateConfig();

// 2. Initialisation de la base SQLite WAL
const db = getDb();

const app = express();

// Middleware corps brut pour Polar webhook (spécifié 03 §3.1)
app.use('/webhook/polar', express.raw({ type: '*/*' }));

// Middlewares standards pour le reste
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Santé
app.get('/healthz', (req, res) => {
  const { statusCode, data } = checkHealth();
  res.status(statusCode).json(data);
});

// Assets images (/assets/img/<nom>) - avec garde d'extension et anti-traversal
app.get('/assets/img/:filename(*)', (req, res) => {
  const result = resolveImage(req.params.filename);
  if (!result || result.status !== 200) {
    return res.status(result?.status || 404).send('Not Found');
  }

  const mimeMap = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  res.setHeader('Content-Type', mimeMap[result.ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(result.filePath).pipe(res);
});

// Page d'accueil
app.get('/', (req, res) => {
  const page = getPageContent('home');
  const html = renderPage({
    title: 'ScanSEO — Audit SEO automatisé en français pour dirigeants et artisans',
    description: 'Audit technique et sémantique de votre site web avec les textes rédigés prêts à copier-coller et un plan d\'action sur 30 jours.',
    content: page ? page.html : '<h1>ScanSEO</h1><p>Audit SEO automatisé.</p>',
    path: '/'
  });
  res.status(200).send(html);
});

// Pages publiques supportées
const publicPages = ['tarifs', 'faq', 'exemple', 'mentions-legales', 'cgv', 'confidentialite'];

for (const slug of publicPages) {
  app.get(`/${slug}`, (req, res) => {
    const page = getPageContent(slug);
    if (!page) {
      return res.status(404).send(renderPage({
        title: 'Page introuvable — ScanSEO',
        content: '<h1>Page introuvable (404)</h1><p>La page demandée n\'existe pas.</p>',
        path: `/${slug}`
      }));
    }

    const html = renderPage({
      title: `${page.title || slug.toUpperCase()} — ScanSEO`,
      description: page.description || `Page ${slug} du service ScanSEO.`,
      content: page.html,
      path: `/${slug}`
    });

    res.status(200).send(html);
  });
}

// Démarrage du serveur HTTP
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[scanseo-web] En écoute sur le port ${config.port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});

// Arrêt propre
function shutdown(signal) {
  console.log(`[scanseo-web] Signal ${signal} reçu, arrêt en cours...`);
  server.close(() => {
    try {
      db.close();
    } catch (e) {}
    console.log('[scanseo-web] Serveur arrêté proprement.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
