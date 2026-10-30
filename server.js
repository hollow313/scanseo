import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { validateConfig, config } from './src/config.js';
import { getDb } from './src/db.js';
import { checkHealth } from './src/health.js';
import { getPageContent, resolveImage } from './src/content.js';
import { renderPage } from './src/views/layout.js';
import { handlePolarWebhook } from './src/webhook.js';
import { listPosts, getPost, robotsTxt, sitemapXml } from './src/blog.js';

// 1. Validation stricte des variables d'environnement requises
validateConfig();

// 2. Initialisation de la base SQLite WAL
const db = getDb();

const app = express();

// Middleware corps brut pour Polar webhook (spécifié 03 §3.1 - impératif avant express.json)
app.post('/webhook/polar', express.raw({ type: '*/*' }), handlePolarWebhook);

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

// Montage conditionnel des routeurs livrés par les lots L5/L6 : le serveur démarre
// même si un module n'est pas encore là, avec un repli explicite.
async function importOptionalRoute(spec) {
  try {
    const mod = await import(spec);
    const router = mod.default || (typeof mod.createRouter === 'function' ? mod.createRouter() : null);
    if (router) console.log(`[routes] ${spec} monté`);
    return router || null;
  } catch (err) {
    console.warn(`[routes] ${spec} indisponible (${err.code || err.message})`);
    return null;
  }
}

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

// Liens de redirection vers le checkout Polar
app.get('/checkout/:offer', (req, res) => {
  const offer = req.params.offer;
  let productId = null;
  if (offer === 'audit_49') {
    productId = config.polarProduct49;
  } else if (offer === 'audit_149') {
    productId = config.polarProduct149;
  }

  if (!productId) {
    return res.status(404).send('Offre inconnue');
  }

  // Liens de checkout créés côté Polar (un par produit). Un lien mort ici = aucun encaissement.
  const polarCheckoutUrl = offer === 'audit_49' ? config.polarCheckout49 : config.polarCheckout149;
  if (!polarCheckoutUrl || !polarCheckoutUrl.startsWith('https://')) {
    console.error('[checkout] lien Polar manquant ou invalide pour', offer);
    return res.status(503).send("Le paiement est momentanément indisponible. Réessayez dans quelques minutes.");
  }
  res.redirect(302, polarCheckoutUrl);
});

// Page d'accueil
app.get('/', (req, res) => {
  const page = getPageContent('home');
  const html = renderPage({
    title: 'ScanSEO — Audit SEO professionnel et automatisé',
    description: 'Audit technique et sémantique de votre site web avec les textes rédigés prêts à copier-coller et un plan d\'action sur 30 jours.',
    content: page ? page.html : '<h1>ScanSEO</h1><p>Audit SEO automatisé.</p>',
    path: '/'
  });
  res.status(200).send(html);
});

// Retour de paiement Polar (success_url) — doit être déclaré avant /audit/:token
app.get('/audit/merci', (req, res) => {
  res.status(200).send(renderPage({
    title: 'Merci — votre audit démarre | ScanSEO',
    description: "Votre paiement est confirmé. Indiquez votre activité et votre ville pour lancer l'audit.",
    content: `
      <div class="content-box">
        <h1>Paiement confirmé, merci.</h1>
        <p>Vous allez recevoir un email avec le lien de votre espace : il vous reste <strong>trois questions</strong>
        (activité, ville, concurrents éventuels) à renseigner pour que l'audit démarre.</p>
        <p>Le rapport arrive par email, généralement sous 15 minutes.</p>
        <p style="font-size:.9rem;color:var(--text-muted)">Si vous ne recevez rien d'ici 10 minutes, vérifiez vos indésirables,
        puis écrivez à ${config.contactEmail}.</p>
      </div>`,
    path: '/audit/merci'
  }));
});

// Espace client : monté plus bas (/audit), après les pages publiques.

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

    // Descriptions rédigées : le repli générique tombait à 28–31 caractères, très en
    // dessous des 120–165 recommandés — sur un site qui vend des audits SEO.
    const descriptions = {
      tarifs: "Deux offres, un paiement unique : audit complet à 49 € TTC (25 pages) ou 149 € TTC (100 pages), rapport PDF et plan d'action livrés par email sous 15 minutes.",
      faq: "Délai de livraison, pages analysées, données conservées, remboursement, garanties : les réponses aux questions les plus fréquentes sur l'audit SEO automatisé.",
      exemple: "Un rapport d'audit réel anonymisé : score par pilier, constats mesurés page par page, textes prêts à coller et plan d'action sur 30 jours. Voyez ce que vous recevez.",
      'mentions-legales': "Éditeur, hébergeur et responsable de publication de scanseo.fr, avec les informations légales de l'entreprise individuelle Loïc Huon (SIREN 853 658 375).",
      cgv: "Conditions générales de vente des audits SEO ScanSEO : commande, livraison, rétractation, garanties et médiation. Paiement sécurisé, facture émise par Polar.",
      confidentialite: "Quelles données ScanSEO conserve (email, URL auditée, rapport), pendant combien de temps, et comment demander leur suppression. Aucun cookie, aucun traceur.",
    };

    const titles = {
      tarifs: 'Tarifs des audits SEO — ScanSEO',
      faq: 'Foire aux questions — ScanSEO',
      exemple: 'Exemple de rapport d\'audit SEO — ScanSEO',
      'mentions-legales': 'Mentions légales — ScanSEO',
      cgv: 'Conditions générales de vente — ScanSEO',
      confidentialite: 'Politique de confidentialité — ScanSEO'
    };

    const html = renderPage({
      title: titles[slug] || `${page.title || slug.toUpperCase()} — ScanSEO`,
      description: page.description || descriptions[slug] || `Page ${slug} du service ScanSEO.`,
      content: page.html,
      path: `/${slug}`
    });

    res.status(200).send(html);
  });
}

// --- Montage des routeurs L5/L6, APRÈS les pages publiques -------------------
// Chaque routeur est monté sur son préfixe : un montage à la racine laisserait
// son middleware d'authentification (admin) intercepter /blog et conserverait /:id
// (scan) capter /blog. C'est le défaut qui a rendu le blog inaccessible une première fois.
const scanRouter = await importOptionalRoute('./src/routes/scan.js');
if (scanRouter) {
  app.use('/api/scan', scanRouter);
} else {
  app.post('/api/scan', (req, res) => {
    res.status(200).json({
      ok: true,
      status: 'info',
      message: "L'analyse gratuite instantanée arrive très prochainement. Les audits complets 49 € et 149 € sont déjà opérationnels ci-dessous."
    });
  });
}

const auditRouter = await importOptionalRoute('./src/routes/audit.js');
if (auditRouter) {
  app.use('/audit', auditRouter);
} else {
  app.get('/audit/:token', (req, res) => {
    const audit = db.prepare('SELECT * FROM audits WHERE token = ?').get(req.params.token);
    if (!audit) {
      return res.status(404).send(renderPage({
        title: 'Audit introuvable — ScanSEO',
        content: '<h1>Audit introuvable (404)</h1><p>Ce lien est invalide ou expiré.</p>',
        path: '/audit'
      }));
    }
    res.status(200).send(renderPage({
      title: `Audit de ${audit.host} — ScanSEO`,
      content: `<div class="content-box"><h1>Audit SEO de ${audit.host}</h1>
        <p>Statut : <strong>${audit.status}</strong></p>
        <p>Vous recevrez le rapport par email dès finalisation.</p></div>`,
      path: '/audit'
    }));
  });
}

// Assets du site (CSS + polices) servis depuis src/templates, sans dépendance externe.
try {
  const assets = await import('./src/views/site-assets.js');
  const router = assets.siteAssetsRouter || assets.default;
  if (router) app.use('/assets', router);
  else console.warn('[assets] site-assets.js ne exporte pas de router');
} catch (err) {
  console.warn('[assets] module absent:', err.code || err.message);
}

const prospectRouter = await importOptionalRoute('./src/routes/prospect.js');
if (prospectRouter) app.use('/api/prospect', prospectRouter);

const adminRouter = await importOptionalRoute('./src/routes/admin.js');
if (adminRouter) app.use('/admin', adminRouter);

// Blog (contenu éditorial, dossier monté /content/blog, repli embarqué)
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(robotsTxt(config.publicBaseUrl));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(sitemapXml(config.publicBaseUrl));
});

app.get('/blog', (req, res) => {
  const posts = listPosts();
  const items = posts.length
    ? posts.map((p) => `<article class="content-box" style="margin-bottom:1rem">
        <h2 style="margin-bottom:.25rem"><a href="/blog/${p.slug}" style="color:var(--primary);text-decoration:none">${p.title}</a></h2>
        <p style="font-size:.85rem;color:var(--ink-3,#7b8492);margin-bottom:.5rem">${new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p>${p.description}</p></article>`).join('')
    : '<div class="content-box"><p>Aucun article publié pour le moment.</p></div>';
  res.status(200).send(renderPage({
    title: 'Conseils référencement pour PME et artisans — ScanSEO',
    description: "Comprendre le référencement naturel sans jargon : ce que coûte un audit SEO, les causes réelles d'un site invisible sur Google, et la méthode pour corriger.",
    content: `<div class="content-box"><h1>Comprendre le référencement</h1>
      <p>Des réponses concrètes aux questions que se posent les dirigeants de TPE et les artisans.</p></div>${items}`,
    path: '/blog'
  }));
});

app.get('/blog/:slug', (req, res) => {
  const post = getPost(req.params.slug);
  if (!post) {
    return res.status(404).send(renderPage({
      title: 'Article introuvable — ScanSEO',
      content: '<h1>Article introuvable (404)</h1><p><a href="/blog">Voir tous les articles</a></p>',
      path: '/blog'
    }));
  }
  res.status(200).send(renderPage({
    title: `${post.title} — ScanSEO`.slice(0, 65),
    description: post.description,
    content: `<div class="content-box"><h1>${post.title}</h1>${post.html}</div>
      <div class="content-box"><p><a href="/tarifs" class="btn">Voir les audits (dès 49 €)</a>
      <a href="/blog" style="margin-left:1rem">Tous les articles</a></p></div>`,
    path: `/blog/${post.slug}`
  }));
});

app.use((req, res) => {
  res.status(404).send(renderPage({
    title: 'Page introuvable — ScanSEO',
    content: '<h1>Page introuvable (404)</h1><p>Cette page n\'existe pas. <a href="/">Retour à l\'accueil</a></p>',
    path: req.path
  }));
});

// Filet de sécurité : aucune exception asynchrone ne doit arrêter le site.
app.use((err, req, res, next) => {
  console.error('[http] erreur non gérée sur', req.method, req.path, ':', err?.message || err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'server_error' });
});

process.on('unhandledRejection', (err) => {
  console.error('[process] unhandledRejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.message || err);
});

// Mode « tout-en-un » : le worker tourne dans le même conteneur que le web.
// Pratique pour une installation simple (une seule app TrueNAS), au prix d'un
// partage de mémoire avec Chromium et d'un redémarrage commun.
if (String(process.env.WORKER_IN_PROCESS || '').toLowerCase() === 'true') {
  console.log('[scanseo-web] WORKER_IN_PROCESS=true → démarrage du worker dans ce processus');
  import('./worker.js').catch((err) => {
    console.error('[scanseo-web] worker en processus impossible:', err.message);
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
