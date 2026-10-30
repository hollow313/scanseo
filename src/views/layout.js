import { config } from '../config.js';

const NAV_ITEMS = [
  { href: '/', label: 'Accueil', match: (p) => p === '/' },
  { href: '/tarifs', label: 'Tarifs', match: (p) => p === '/tarifs' },
  { href: '/faq', label: 'FAQ', match: (p) => p === '/faq' },
  { href: '/exemple', label: 'Exemple', match: (p) => p === '/exemple' },
  { href: '/blog', label: 'Blog', match: (p) => p === '/blog' || p.startsWith('/blog/') },
];

export function renderPage({ title = 'ScanSEO — Audit SEO professionnel et automatisé', description = 'Audit SEO technique et sémantique pour TPE, PME et artisans.', content = '', path = '/', jsonLd = null, robots = null }) {
  // Le site vend du SEO : ses propres balises doivent être exemplaires.
  const base = (config.publicBaseUrl || 'https://scanseo.fr').replace(/\/$/, '');
  const canonical = base + (path === '/' ? '/' : path);
  const socialImage = base + '/assets/apercu-rapport.png';
  const organisation = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': base + '/#organisation',
        name: 'ScanSEO',
        url: base + '/',
        email: config.contactEmail || 'contact@scanseo.fr',
        founder: { '@type': 'Person', name: 'Loïc Huon' },
        address: { '@type': 'PostalAddress', addressLocality: 'Toulouse', postalCode: '31000', addressCountry: 'FR' },
        vatID: 'SIREN 853 658 375',
      },
      {
        '@type': 'WebSite',
        '@id': base + '/#site',
        url: base + '/',
        name: 'ScanSEO',
        inLanguage: 'fr-FR',
        publisher: { '@id': base + '/#organisation' },
      },
      {
        '@type': 'Service',
        name: 'Audit SEO automatisé',
        serviceType: 'Audit de référencement naturel',
        provider: { '@id': base + '/#organisation' },
        areaServed: 'FR',
        description: 'Audit SEO technique et sémantique automatisé, avec les balises title, meta et H1 rédigées et un plan d\'action sur 30 jours.',
        offers: [
          { '@type': 'Offer', name: 'Audit SEO', price: '49.00', priceCurrency: 'EUR', url: base + '/tarifs' },
          { '@type': 'Offer', name: 'Audit Complet', price: '149.00', priceCurrency: 'EUR', url: base + '/tarifs' },
        ],
      },
    ],
  };
  const ldJson = JSON.stringify(jsonLd ? jsonLd : organisation).replace(/</g, '\\u003c');
  // Le titre ne dépasse jamais 65 caractères (recommandation SEO).
  const trimmedTitle = title.length > 65 ? title.slice(0, 62) + '…' : title;
  const contactEmail = config.contactEmail || 'contact@scanseo.fr';

  const nav = NAV_ITEMS.map((item) => {
    const active = item.match(path);
    return `      <a href="${item.href}" class="nav-link"${active ? ' aria-current="page"' : ''}>${item.label}</a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(trimmedTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${robots ? `<meta name="robots" content="${escapeHtml(robots)}">` : ''}
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="ScanSEO">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="${escapeHtml(trimmedTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(socialImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(trimmedTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(socialImage)}">
  <meta name="theme-color" content="#3b5bfd">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <script type="application/ld+json">${ldJson}</script>
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
  <a class="skip-link" href="#contenu">Aller au contenu</a>

  <header class="site-header">
    <div class="nav-wrap">
      <a href="/" class="brand" aria-label="ScanSEO — accueil">ScanSEO<span class="dot"></span></a>
      <button class="burger" id="burger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="nav">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" id="nav" aria-label="Navigation principale">
${nav}
        <a href="/#analyser" class="btn btn-outline nav-cta">Analyser mon site</a>
      </nav>
    </div>
  </header>

  <main id="contenu">
    <div class="container">
${content}
    </div>
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="brand">ScanSEO<span class="dot"></span></a>
          <p>Audit SEO automatisé en français : un score mesuré sur 100, des constats page par page et des textes rédigés prêts à copier-coller.</p>
        </div>
        <div class="footer-col">
          <p class="footer-col-title">Service</p>
          <ul>
            <li><a href="/#analyser">Analyser mon site</a></li>
            <li><a href="/tarifs">Tarifs</a></li>
            <li><a href="/exemple">Exemple de rapport</a></li>
            <li><a href="/faq">Questions fréquentes</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <p class="footer-col-title">Ressources &amp; légal</p>
          <ul>
            <li><a href="/verificateur-balises">Vérificateur de balises</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/mentions-legales">Mentions légales</a></li>
            <li><a href="/cgv">CGV</a></li>
            <li><a href="/confidentialite">Confidentialité</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>Loïc Huon — Entrepreneur individuel · SIREN 853 658 375 · 16 Rue Saint-Antoine du T, 31000 Toulouse · TVA non applicable, art. 293 B du CGI</p>
        <p><a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></p>
        <p class="legal">Audit automatisé, non contractuel · aucun cookie ni traceur</p>
      </div>
    </div>
  </footer>

  <script>
    (function () {
      // Filet 1px sous l'en-tête, qui apparaît au scroll.
      var header = document.querySelector('.site-header');
      var onScroll = function () {
        if (header) header.classList.toggle('scrolled', window.scrollY > 8);
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });

      var burger = document.getElementById('burger');
      var nav = document.getElementById('nav');
      if (!burger || !nav) return;
      burger.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.addEventListener('click', function (e) {
        if (e.target.closest('a')) {
          nav.classList.remove('open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('open')) {
          nav.classList.remove('open');
          burger.setAttribute('aria-expanded', 'false');
          burger.focus();
        }
      });
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
