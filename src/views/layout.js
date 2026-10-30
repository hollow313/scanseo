import { config } from '../config.js';

export function renderPage({ title = 'ScanSEO — Audit SEO automatisé', description = 'Audit SEO technique et sémantique pour TPE, PME et artisans.', content = '', path = '/' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --border: #334155;
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
      padding: 2.5rem 1.5rem;
      width: 100%;
    }
    footer {
      background: var(--card-bg);
      border-top: 1px solid var(--border);
      padding: 2rem 1.5rem;
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
      padding: 2rem;
    }
    .content-box h1 { margin-bottom: 1rem; color: var(--primary); }
    .content-box h2 { margin-top: 1.5rem; margin-bottom: 0.75rem; color: #e2e8f0; }
    .content-box p { margin-bottom: 1rem; }
    .content-box ul { margin-bottom: 1rem; padding-left: 1.5rem; }
    .content-box li { margin-bottom: 0.35rem; }
    .btn {
      display: inline-block;
      background: var(--primary);
      color: #0f172a;
      font-weight: 600;
      padding: 0.65rem 1.25rem;
      border-radius: 6px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
    }
    .btn:hover { background: var(--primary-hover); }
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
        <a href="/exemple" class="${path === '/exemple' ? 'active' : ''}">Exemple de rapport</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="content-box">
      ${content}
    </div>
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
