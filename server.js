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

// Derrière le reverse proxy (NPM), req.ip vaut l'IP du proxy pour TOUS les
// visiteurs : sans ce réglage, les limites par IP deviennent globales et trois
// scans gratuits bloquent le site entier. On fait confiance au premier saut.
app.set('trust proxy', 1);

// Rapport d'exemple : un vrai audit, consultable sans laisser son email.
app.get('/exemple/rapport.pdf', (req, res) => {
  const candidates = [
    path.join(config.contentDir, 'exemple', 'rapport.pdf'),
    path.join(process.cwd(), 'src', 'embedded_content', 'exemple-rapport.pdf'),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return res.status(404).send('Exemple indisponible');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="exemple-rapport-audit-seo-scanseo.pdf"');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(file).pipe(res);
});


// Middleware corps brut pour Polar webhook (spécifié 03 §3.1 - impératif avant express.json)
app.post('/webhook/polar', express.raw({ type: '*/*' }), handlePolarWebhook);

// Middlewares standards pour le reste
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // HSTS : après la première visite en HTTPS, le navigateur ne repasse plus par
  // http:// — c'est la seule façon d'empêcher un visiteur de tomber sur une
  // version servie en clair par erreur.
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Montage conditionnel des routeurs livrés par les lots L5/L6 : le serveur démarre
// même si un module n'est pas encore là, avec un repli explicite.
async function importOptionalRoute(spec) {
  try {
    const mod = await import(spec);
    const router = mod.default || mod.router || (typeof mod.createRouter === 'function' ? mod.createRouter() : null);
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
  const POLAR_PRODUCTS = {
    audit_29: config.polarProduct29,
    audit_59: config.polarProduct59,
    audit_49: config.polarProduct49,
    audit_149: config.polarProduct149,
  };
  productId = POLAR_PRODUCTS[offer] || null;

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
const publicPages = [
  'tarifs', 'faq', 'exemple', 'mentions-legales', 'cgv', 'confidentialite',
  // Pages d'intention : chacune répond à une requête réelle, avec sa propre FAQ.
  'audit-seo-prix', 'site-invisible-google', 'audit-seo-wordpress',
  'verificateur-balises',
];

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
      tarifs: "Deux offres, un paiement unique : audit à 29 € TTC (25 pages) ou audit complet à 59 € TTC (100 pages, re-audit inclus), rapport PDF et plan d'action livrés par email sous 15 minutes.",
      faq: "Délai de livraison, pages analysées, données conservées, remboursement, garanties : les réponses aux questions les plus fréquentes sur l'audit SEO automatisé.",
      exemple: "Un rapport d'audit réel anonymisé : score par pilier, constats mesurés page par page, textes prêts à coller et plan d'action sur 30 jours. Voyez ce que vous recevez.",
      'mentions-legales': "Éditeur, hébergeur et responsable de publication de scanseo.fr, avec les informations légales de l'entreprise individuelle Loïc Huon (SIREN 853 658 375).",
      cgv: "Conditions générales de vente des audits SEO ScanSEO : commande, livraison, rétractation, garanties et médiation. Paiement sécurisé, facture émise par Polar.",
      confidentialite: "Quelles données ScanSEO conserve (email, URL auditée, rapport), pendant combien de temps, et comment demander leur suppression. Aucun cookie, aucun traceur.",
      'audit-seo-prix': "Combien coûte un audit SEO en France : outil en libre-service, audit automatisé à 49 €, consultant de 300 à 1 500 €, agence. Ce que chaque prix contient réellement.",
      'site-invisible-google': "Six causes expliquent qu'un site en ligne n'apparaisse pas sur Google : indexation, contenu trop court, balises, vitesse mobile, concurrence interne, absence de liens.",
      'audit-seo-wordpress': "Les six défauts qui plafonnent le référencement d'un site WordPress, et ce qu'un audit doit réellement contenir pour être utilisable.",
      'verificateur-balises': "Collez l'adresse d'une page et vérifiez ses balises title, meta description, H1, canonique et données structurées. Gratuit, sans compte, aucun email demandé.", 
    };

    const titles = {
      tarifs: 'Tarifs des audits SEO — ScanSEO',
      faq: "Foire aux questions sur l'audit SEO — ScanSEO",
      exemple: 'Exemple de rapport d\'audit SEO — ScanSEO',
      // 30 caractères minimum : « Mentions légales — ScanSEO » n'en faisait que 29.
      'mentions-legales': 'Mentions légales et éditeur du site — ScanSEO',
      cgv: 'Conditions générales de vente — ScanSEO',
      confidentialite: 'Politique de confidentialité — ScanSEO',
      'audit-seo-prix': 'Combien coûte un audit SEO ? Prix et contenu — ScanSEO',
      'site-invisible-google': "Pourquoi mon site n'apparaît pas sur Google — ScanSEO",
      'audit-seo-wordpress': 'Audit SEO WordPress : les 6 points à vérifier — ScanSEO',
      'verificateur-balises': 'Vérificateur de balises SEO gratuit — ScanSEO'
    };

    const faqSchemas = {
  "audit-seo-prix": [
    {
      "@type": "Question",
      "name": "Un audit à 49 € vaut-il un audit à 1 000 € ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Non. Un audit automatisé détecte les problèmes mesurables et rédige les corrections ; un consultant ajoute l'analyse concurrentielle, la lecture des données réelles et l'accompagnement."
      }
    },
    {
      "@type": "Question",
      "name": "Pourquoi payer alors que des outils gratuits existent ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Les outils gratuits donnent des alertes, sans les prioriser, sans les expliquer en français et sans rédiger vos balises."
      }
    },
    {
      "@type": "Question",
      "name": "Y a-t-il un abonnement caché ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Non. Un paiement, un rapport, aucune reconduction ni prélèvement récurrent."
      }
    }
  ],
  "site-invisible-google": [
    {
      "@type": "Question",
      "name": "Combien de temps avant d'apparaître sur Google ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Une page indexée peut apparaître en quelques jours, mais se classer sur une requête concurrentielle prend des mois. L'indexation se mesure, le classement ne se promet pas."
      }
    },
    {
      "@type": "Question",
      "name": "Mon site est neuf, est-ce normal de ne pas apparaître ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Oui. Un site sans historique ni lien entrant apparaît rarement avant plusieurs semaines. Un sitemap déclaré et des pages ciblant une question précise accélèrent les choses."
      }
    },
    {
      "@type": "Question",
      "name": "Un audit garantit-il de remonter ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Non. Un audit lève des obstacles mesurables : il rend le site indexable et lisible. La position dépend aussi de la concurrence et des liens."
      }
    }
  ],
  "audit-seo-wordpress": [
    {
      "@type": "Question",
      "name": "Quel est le meilleur plugin SEO WordPress ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yoast, Rank Math et SEOPress couvrent tous les trois le nécessaire : title, meta description, sitemap et balises canoniques. Le plugin stocke vos balises, il ne les rédige pas."
      }
    },
    {
      "@type": "Question",
      "name": "Un site WordPress peut-il être audité automatiquement ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Oui. Le crawl analyse les pages générées, exactement comme Google les voit ; le CMS ne change que les instructions de correction."
      }
    },
    {
      "@type": "Question",
      "name": "Combien de pages auditer sur un site WordPress ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Toutes celles qui ont une chance d'être trouvées : pages principales, articles, pages de service. Les archives et pages de compte n'ont pas besoin d'être optimisées."
      }
    }
  ]
};

    const jsonLd = faqSchemas[slug]
      ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqSchemas[slug] }
      : undefined;

    const html = renderPage({
      title: titles[slug] || `${page.title || slug.toUpperCase()} — ScanSEO`,
      description: page.description || descriptions[slug] || `Page ${slug} du service ScanSEO.`,
      content: page.html,
      path: `/${slug}`,
      jsonLd
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

const tagsRouter = await importOptionalRoute('./src/routes/tags.js');
if (tagsRouter) app.use('/api/tags', tagsRouter);

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
