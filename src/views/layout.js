import { config } from '../config.js';

export function renderPage({ title = 'ScanSEO — Audit SEO professionnel et automatisé', description = 'Audit SEO technique et sémantique pour TPE, PME et artisans.', content = '', path = '/' }) {
  // Ensure title never exceeds 65 characters
  const trimmedTitle = title.length > 65 ? title.slice(0, 62) + '...' : title;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(trimmedTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-highlight: #1e3a5f;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --border: #334155;
      --border-highlight: #38bdf8;
      --success: #22c55e;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      overflow-x: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 1rem 1.5rem;
    }
    .nav-container {
      max-width: 1000px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .logo {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--primary);
      text-decoration: none;
    }
    nav {
      display: flex;
      gap: 1.25rem;
      align-items: center;
    }
    nav a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.95rem;
      transition: color 0.15s;
    }
    nav a:hover, nav a.active {
      color: var(--text);
    }
    main {
      flex: 1;
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem 1.25rem;
      width: 100%;
    }
    footer {
      background: var(--card-bg);
      border-top: 1px solid var(--border);
      padding: 2rem 1.25rem;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: auto;
    }
    .footer-container {
      max-width: 1000px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .footer-links a {
      color: var(--text-muted);
      text-decoration: none;
    }
    .footer-links a:hover {
      color: var(--primary);
    }
    .content-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.75rem;
      margin-bottom: 2rem;
    }
    .content-box h1 { margin-bottom: 1rem; color: var(--primary); font-size: 1.8rem; }
    .content-box h2 { margin-top: 1.5rem; margin-bottom: 0.75rem; color: #e2e8f0; font-size: 1.3rem; }
    .content-box p { margin-bottom: 1rem; }
    .content-box ul { margin-bottom: 1rem; padding-left: 1.5rem; }
    .content-box li { margin-bottom: 0.35rem; }

    /* Formulaire */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      flex: 1;
      min-width: 240px;
    }
    .form-label {
      font-weight: 600;
      font-size: 0.9rem;
      color: #e2e8f0;
    }
    .form-input {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #fff;
      font-size: 0.95rem;
      width: 100%;
    }
    .form-input:focus {
      outline: 2px solid var(--primary);
      border-color: transparent;
    }

    /* Cartes de prix */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    .pricing-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.75rem;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .pricing-card.featured {
      background: var(--card-highlight);
      border: 2px solid var(--border-highlight);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.15);
    }
    .badge-featured {
      position: absolute;
      top: -12px;
      right: 20px;
      background: var(--primary);
      color: #0f172a;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
    }
    .pricing-title {
      font-size: 1.3rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .pricing-price {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--primary);
      margin-bottom: 0.25rem;
    }
    .pricing-sub {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 1.5rem;
    }
    .pricing-features {
      list-style: none;
      padding: 0;
      margin-bottom: 1.75rem;
      flex: 1;
    }
    .pricing-features li {
      padding: 0.4rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .pricing-features li::before {
      content: "✓";
      color: var(--primary);
      font-weight: 800;
    }
    .btn {
      display: inline-block;
      background: var(--primary);
      color: #0f172a;
      font-weight: 700;
      padding: 0.75rem 1.25rem;
      border-radius: 6px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      font-size: 0.95rem;
      text-align: center;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary {
      background: #334155;
      color: #fff;
    }
    .btn-secondary:hover {
      background: #475569;
    }
    .alert-box {
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid var(--primary);
      border-radius: 6px;
      padding: 0.9rem 1.1rem;
      color: #e0f2fe;
      font-size: 0.9rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="nav-container">
      <a href="/" class="logo">ScanSEO</a>
      <nav>
        <a href="/" class="${path === '/' ? 'active' : ''}">Accueil</a>
        <a href="/tarifs" class="${path === '/tarifs' ? 'active' : ''}">Tarifs</a>
        <a href="/faq" class="${path === '/faq' ? 'active' : ''}">FAQ</a>
        <a href="/exemple" class="${path === '/exemple' ? 'active' : ''}">Exemple</a>
      </nav>
    </div>
  </header>

  <main>
    ${content}
  </main>

  <footer>
    <div class="footer-container">
      <div class="footer-links">
        <a href="/mentions-legales">Mentions légales</a>
        <a href="/cgv">CGV</a>
        <a href="/confidentialite">Confidentialité</a>
        <a href="mailto:${escapeHtml(config.contactEmail)}">Contact</a>
      </div>
      <p>Loïc Huon, Entrepreneur Individuel — SIREN 853 658 375 — Toulouse, France. TVA non applicable art. 293 B du CGI.</p>
      <p>Audit SEO automatisé, non contractuel. Aucun cookie ni traceur publicitaire déposé.</p>
    </div>
  </footer>
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
