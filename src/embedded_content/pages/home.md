<div class="content-box">
  <h1>Audit SEO en français pour dirigeants et artisans</h1>
  <p>Obtenez un diagnostic technique et sémantique complet de votre site web, avec vos balises rédigées prêtes à copier-coller et un plan d'action concret sur 30 jours.</p>
</div>

<div class="content-box">
  <h2>Testez votre site gratuitement</h2>
  <p>Entrez l'adresse de votre site pour obtenir un premier aperçu de vos axes d'amélioration.</p>
  
  <div class="alert-box" style="margin-bottom: 1.5rem;">
    <strong>Information :</strong> L'analyse gratuite instantanée en ligne est actuellement en cours de finalisation (bientôt disponible). Les audits complets ci-dessous sont pleinement opérationnels.
  </div>

  <form id="scanForm" action="/api/scan" method="POST" style="display: flex; flex-direction: column; gap: 1.25rem;">
    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
      <div class="form-group">
        <label for="scan-url" class="form-label">URL du site</label>
        <input type="url" id="scan-url" name="url" placeholder="https://votre-site.fr" required class="form-input">
      </div>
      <div class="form-group">
        <label for="scan-email" class="form-label">Email (facultatif)</label>
        <input type="email" id="scan-email" name="email" placeholder="contact@votre-site.fr" class="form-input">
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
      <button type="submit" class="btn" style="min-width: 200px;">Lancer l'analyse gratuite</button>
      <span style="font-size: 0.85rem; color: var(--text-muted);">Service 100 % confidentiel. Aucun mot de passe requis.</span>
    </div>
  </form>

  <div id="scanResult" style="display: none; margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border);"></div>

  <script>
    document.getElementById('scanForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const resDiv = document.getElementById('scanResult');
      resDiv.style.display = 'block';
      resDiv.innerHTML = '<div class="alert-box"><strong>Bientôt disponible :</strong> Le scanner gratuit instantané arrive très prochainement. Vous pouvez d\\'ores et déjà commander votre audit complet (49 € ou 149 €) ci-dessous pour une analyse intégrale sous 15 minutes.</div>';
    });
  </script>
</div>

<div class="pricing-grid">
  <div class="pricing-card">
    <div class="pricing-title">Audit SEO</div>
    <div class="pricing-price">49 € <span style="font-size: 1rem; font-weight: normal; color: var(--text-muted);">TTC</span></div>
    <div class="pricing-sub">TVA non applicable, art. 293 B du CGI</div>
    <ul class="pricing-features">
      <li>Analyse complète jusqu'à 25 pages</li>
      <li>Rapport PDF professionnel de 14 à 22 pages</li>
      <li>Balises &lt;title&gt;, meta descriptions et H1 rédigées</li>
      <li>Plan d'action priorisé sur 30 jours</li>
      <li>Vérification Search Console pas à pas</li>
      <li>Livraison sous 15 minutes par email</li>
    </ul>
    <a href="/checkout/audit_49" class="btn btn-secondary">Commander l'Audit SEO (49 €)</a>
  </div>

  <div class="pricing-card featured">
    <div class="badge-featured">Recommandé</div>
    <div class="pricing-title">Audit Complet</div>
    <div class="pricing-price">149 € <span style="font-size: 1rem; font-weight: normal; color: var(--text-muted);">TTC</span></div>
    <div class="pricing-sub">TVA non applicable, art. 293 B du CGI</div>
    <ul class="pricing-features">
      <li>Analyse approfondie jusqu'à 100 pages</li>
      <li>Rapport PDF exhaustif avec plan sur 90 jours</li>
      <li>2 pages entières rédigées (H1, chapô, H2, FAQ, CTA)</li>
      <li>Toutes les balises rédigées prêtes à copier-coller</li>
      <li>Détection fine de la cannibalisation sémantique</li>
      <li>Livraison prioritaire sous 15 minutes</li>
    </ul>
    <a href="/checkout/audit_149" class="btn">Commander l'Audit Complet (149 €)</a>
  </div>
</div>

<div class="content-box">
  <h2>Ce que contient votre audit</h2>
  <ul>
    <li><strong>Score déterministe sur 100</strong> : calculé sur 66 points de contrôle réels (technique, on-page, contenu, mobile, confiance).</li>
    <li><strong>Textes rédigés prêts à copier-coller</strong> : vous n'avez qu'à coller les titres et descriptions dans votre CMS (WordPress, Wix, Shopify...).</li>
    <li><strong>Plan d'action chronologique</strong> : semaine par semaine, les corrections à apporter par ordre d'impact.</li>
    <li><strong>Zéro jargon</strong> : chaque terme technique est traduit en français clair pour les non-spécialistes.</li>
  </ul>
</div>
