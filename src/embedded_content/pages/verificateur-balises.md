# Vérificateur de balises SEO

Collez l'adresse d'une page : vous obtenez en quelques secondes ses balises title, meta description, H1, canonique et données structurées, avec la longueur exacte de chacune. **Gratuit, sans compte, sans email.** Aucune donnée n'est conservée.

<form class="scan-form" id="tagsForm" novalidate>
  <div class="field">
    <label for="tags-url">Adresse de la page</label>
    <input type="url" id="tags-url" name="url" placeholder="https://votre-site.fr" required>
  </div>
  <div class="submit-row">
    <button class="btn btn-primary" type="submit">Vérifier les balises</button>
  </div>
</form>

<div id="tagsResult" class="scan-result" role="status" aria-live="polite" hidden></div>

<script>
  (function () {
    var form = document.getElementById('tagsForm');
    var result = document.getElementById('tagsResult');
    if (!form || !result) return;
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function show(html) { result.innerHTML = html; result.hidden = false; result.style.display = 'block'; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('tags-url');
      if (!input || !input.value) return;
      show('<p>Analyse en cours…</p>');
      fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: input.value }) })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (res) {
          var d = res.d || {};
          if (res.status === 429) return show('<p>Trente analyses par heure et par visiteur. Réessayez dans un moment.</p>');
          if (!d.ok) {
            var msg = d.error === 'url_not_allowed' ? 'Adresse refusée : page privée ou inaccessible depuis Internet.'
              : d.error === 'fetch_failed' ? 'La page n\u2019a pas répondu. Vérifiez l\u2019adresse.'
              : 'Adresse invalide.';
            return show('<p>' + esc(msg) + '</p>');
          }
          var rows = (d.checks || []).map(function (c) {
            var col = c.ok ? '#0e9f6e' : '#dc2626';
            var mark = c.ok ? '\u2713' : '\u2715';
            return '<li style="padding:.5rem 0;border-top:1px solid #e6e8ee">' +
              '<strong style="color:' + col + '">' + mark + ' ' + esc(c.label) + '</strong> ' +
              '<span style="color:#3d4652;font-size:.9rem">' + esc(c.detail) + '</span></li>';
          }).join('');
          show('<p style="margin:0 0 .3rem;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Score balises</p>' +
            '<p style="margin:0;font-size:2rem;font-weight:700;line-height:1">' + esc(d.score) + '<span style="font-size:1rem;color:#6b7280">/100</span></p>' +
            '<ul style="list-style:none;margin:.8rem 0 1rem;padding:0">' + rows + '</ul>' +
            '<p style="margin:0;font-size:.85rem;color:#3d4652">Ce contrôle ne lit qu\u2019une page. Un audit ScanSEO analyse jusqu\u2019à 100 pages, détecte la duplication et rédige les balises à coller.</p>' +
            '<p style="margin:.6rem 0 0"><a class="btn btn-primary" href="/tarifs">Voir les audits — 29 €</a></p>');
        })
        .catch(function () { show('<p>Connexion interrompue. Réessayez.</p>'); });
    });
  })();
</script>

## Ce que vérifie cet outil

Dix contrôles sur la page que vous venez de saisir : longueur du `title`, longueur de la meta description, présence d'un `h1` unique, balise canonique, indexabilité (`noindex`), nombre de sous-titres, balises Open Graph, données structurées JSON-LD, langue déclarée et volume de texte. Ce sont exactement les signaux que Google lit en premier.

## Ce qu'il ne peut pas vous dire

Cet outil lit **une seule page**, à l'instant où vous la demandez. Il ignore ce que Google a réellement indexé, sur quelles requêtes votre site apparaît, et si vos pages se concurrencent entre elles. Ces trois questions demandent un crawl complet et l'accès à votre Search Console.

## Pourquoi ces contrôles comptent

Un `title` de moins de 30 caractères ne dit rien à Google. Une page sans meta description laisse Google choisir un extrait au hasard. Deux `h1` brouillent le sujet de la page. Aucun de ces défauts n'empêche le site de fonctionner — tous réduisent sa visibilité.
