/* ------------------------------------------------------------------ */
/* Catalogue des 66 contrôles (docs/04 §4) + score déterministe.        */
/* Le score est calculé ici, jamais par le LLM.                         */
/* ------------------------------------------------------------------ */

const WEIGHTS = { technique: 25, onpage: 30, contenu: 20, performance: 15, local: 10 };

/* Helpers */
const pagesOf = (facts) => facts.pages || [];
const okPages = (facts) => pagesOf(facts).filter((p) => p.status >= 200 && p.status < 400);
const homeOf = (facts) => pagesOf(facts)[0] || null;

function normTitle(t) {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normUrl(u) {
  try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; }
}
function hostOfUrl(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

/* Résultat d'un contrôle : { result, occurrences, evidence, page_url, detail } */
function ok() { return { result: 'conforme', occurrences: 0, evidence: '', page_url: null, detail: '' }; }
function na(detail = '') { return { result: 'non_applicable', occurrences: 0, evidence: '', page_url: null, detail }; }
function fix(occurrences, evidence, page_url = null, detail = '') {
  return { result: 'a_corriger', occurrences, evidence, page_url, detail };
}

/* ------------------------------------------------------------------ */
/* CATALOGUE                                                           */
/* ------------------------------------------------------------------ */

export const CATALOGUE = [
  /* -------- Technique (17) -------- */
  {
    code: 'T01', label: 'HTTP → HTTPS absent ou non redirigé', pillar: 'technique', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (facts.site.https || facts.site.redirect_to_https) return ok();
      return fix(1, `site servi en HTTP sans redirection vers HTTPS (URL finale : ${home.final_url})`, home.url);
    },
  },
  {
    code: 'T02', label: 'Certificat invalide / expiré / HSTS absent', pillar: 'technique', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (!facts.site.https) return na();
      if (home.status !== 200) return na();
      if (!home.hsts) return fix(1, 'en-tête Strict-Transport-Security absent sur l’accueil (HTTPS actif)', home.url);
      return ok();
    },
  },
  {
    code: 'T03', label: 'Accueil ne répond pas 200', pillar: 'technique', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (home && home.status === 200) return ok();
      return fix(1, `accueil en statut ${home ? home.status : 'inaccessible'} au lieu de 200`, home ? home.url : facts.site.url);
    },
  },
  {
    code: 'T04', label: 'robots.txt absent', pillar: 'technique', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      if (facts.robots.present) return ok();
      return fix(1, 'robots.txt introuvable (pas de réponse 200)', `${facts.site.url}/robots.txt`);
    },
  },
  {
    code: 'T05', label: 'Sitemap absent, invalide ou vide', pillar: 'technique', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      if (facts.sitemap.present && facts.sitemap.urls_count > 0) return ok();
      return fix(1, `sitemap absent ou vide (${facts.sitemap.urls_count} URL lue(s))`, facts.site.url);
    },
  },
  {
    code: 'T06', label: 'meta robots en noindex', pillar: 'technique', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (/noindex/i.test(home.robots_meta || '')) return fix(1, `meta robots « ${home.robots_meta} » sur l’accueil`, home.url);
      return ok();
    },
  },
  {
    code: 'T07', label: 'En-tête X-Robots-Tag: noindex', pillar: 'technique', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (home.noindex_header) return fix(1, 'en-tête X-Robots-Tag: noindex sur l’accueil', home.url);
      return ok();
    },
  },
  {
    code: 'T08', label: 'Canonical absent', pillar: 'technique', severity: 'mineur', penalty: 2, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      if (!pages.length) return na();
      const missing = pages.filter((p) => !p.canonical);
      if (!missing.length) return ok();
      return fix(missing.length, `canonical absent sur ${missing.length} page(s) sur ${pages.length}`, missing[0].url);
    },
  },
  {
    code: 'T09', label: 'Canonical pointant vers une autre URL / autre domaine', pillar: 'technique', severity: 'critique', penalty: 10, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      const siteHost = (facts.site.host || '').toLowerCase();
      const bad = pages.filter((p) => {
        if (!p.canonical) return false;
        const ch = hostOfUrl(p.canonical);
        const ph = hostOfUrl(p.final_url || p.url);
        if (ch && ph && ch !== ph && !(ch.replace(/^www\./, '') === ph.replace(/^www\./, ''))) return true;
        return normUrl(p.canonical) !== normUrl(p.final_url || p.url);
      });
      if (!bad.length) return ok();
      return fix(bad.length, `canonical divergent sur ${bad.length} page(s), ex. ${bad[0].url} → ${bad[0].canonical}`, bad[0].url);
    },
  },
  {
    code: 'T10', label: 'Pages en 404/410 dans le sitemap ou la navigation', pillar: 'technique', severity: 'majeur', penalty: 5, cap: 5,
    check(facts) {
      const gone = (facts.broken_links || []).filter((b) => b.status === 404 || b.status === 410);
      if (!gone.length) return ok();
      return fix(gone.length, `${gone.length} lien(s) interne(s) en ${gone[0].status} (ex. ${gone[0].url})`, gone[0].url);
    },
  },
  {
    code: 'T11', label: 'Chaînes de redirection (> 1 saut)', pillar: 'technique', severity: 'mineur', penalty: 2, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      const chains = pages.filter((p) => (p.redirects || 0) > 1);
      if (!chains.length) return ok();
      return fix(chains.length, `${chains.length} page(s) avec chaîne de redirection (ex. ${chains[0].url})`, chains[0].url);
    },
  },
  {
    code: 'T12', label: 'Divergence de contenu par User-Agent (cloaking)', pillar: 'technique', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      if (facts.ua_matrix?.cloaking_detected) {
        return fix(1, `divergence détectée entre Googlebot (${facts.ua_matrix.googlebot?.bytes} o) et ScanSEO/curl`, facts.site.url);
      }
      return ok();
    },
  },
  {
    code: 'T13', label: 'Contenu principal absent du HTML brut, présent après JS', pillar: 'technique', severity: 'critique', penalty: 10, cap: 1,
    check(facts) {
      if (facts.ua_matrix?.js_only) return fix(1, 'HTML brut quasi vide (< 40 mots) alors que le rendu PageSpeed produit du contenu', facts.site.url);
      return ok();
    },
  },
  {
    code: 'T14', label: 'hreflang incohérent ou incomplet', pillar: 'technique', severity: 'mineur', penalty: 2, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      const withHl = pages.filter((p) => (p.hreflangs || []).length);
      if (!withHl.length) return na('aucun hreflang détecté');
      const hasXdefault = pages.some((p) => p.hreflang_xdefault);
      if (!hasXdefault) {
        return fix(withHl.length, `hreflang présent sur ${withHl.length} page(s) sans balise x-default`, withHl[0].url);
      }
      return ok();
    },
  },
  {
    code: 'T15', label: 'Contenu mixte (ressource http:// sur page https)', pillar: 'technique', severity: 'majeur', penalty: 5, cap: 3,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.mixed_content > 0);
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) HTTPS chargent ${pages.reduce((a, p) => a + p.mixed_content, 0)} ressource(s) http://`, pages[0].url);
    },
  },
  {
    code: 'T16', label: 'TTFB > 800 ms', pillar: 'technique', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home || !home.ttfb_ms) return na();
      if (home.ttfb_ms > 800) return fix(1, `temps de réponse de ${home.ttfb_ms} ms sur l’accueil (> 800 ms)`, home.url);
      return ok();
    },
  },
  {
    code: 'T17', label: 'URL avec paramètres / identifiants techniques', pillar: 'technique', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => /[?&](utm_|id=|page=|session|sid=|ref=|fbclid|gclid|pk_campaign|action=|p=)/i.test(p.url));
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} URL(s) avec paramètres techniques (ex. ${pages[0].url})`, pages[0].url);
    },
  },

  /* -------- On-page (24) -------- */
  {
    code: 'O01', label: '<title> absent', pillar: 'onpage', severity: 'critique', penalty: 10, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      const missing = pages.filter((p) => !p.title);
      if (!missing.length) return ok();
      return fix(missing.length, `title absent sur ${missing.length} page(s) sur ${pages.length}`, missing[0].url);
    },
  },
  {
    code: 'O02', label: '<title> hors 30–65 caractères', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.title && (p.title.length < 30 || p.title.length > 65));
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} title(s) hors bornes 30–65 caractères (ex. « ${pages[0].title.slice(0, 40)} »)`, pages[0].url);
    },
  },
  {
    code: 'O03', label: '<title> dupliqué entre pages', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.title);
      const seen = new Map();
      for (const p of pages) {
        const k = normTitle(p.title);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      const dupTitles = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
      if (!dupTitles.length) return ok();
      const involved = pages.filter((p) => dupTitles.includes(normTitle(p.title)));
      return fix(involved.length, `${dupTitles.length} title(s) dupliqué(s) sur ${involved.length} page(s)`, involved[0].url);
    },
  },
  {
    code: 'O04', label: '<title> sans marque ni localisation', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const host = (facts.site.host || '').toLowerCase().replace(/^www\./, '');
      const labels = host.split('.');
      const brand = (labels.length >= 2 ? labels[labels.length - 2] : labels[0]).toLowerCase();
      const city = (facts.site.city || '').toLowerCase();
      const pages = okPages(facts).filter((p) => {
        const t = normTitle(p.title);
        if (!t) return false;
        if (brand && t.includes(brand)) return false;
        if (city && t.includes(city)) return false;
        return true;
      });
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} title(s) sans marque ni ville (ex. « ${pages[0].title.slice(0, 40)} »)`, pages[0].url);
    },
  },
  {
    code: 'O05', label: 'Meta description absente', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts);
      const missing = pages.filter((p) => !p.meta);
      if (!missing.length) return ok();
      return fix(missing.length, `meta description absente sur ${missing.length} page(s) sur ${pages.length}`, missing[0].url);
    },
  },
  {
    code: 'O06', label: 'Meta description hors 120–165 caractères', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.meta && (p.meta.length < 120 || p.meta.length > 165));
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} meta description(s) hors bornes 120–165 caractères`, pages[0].url);
    },
  },
  {
    code: 'O07', label: 'Meta description dupliquée', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.meta);
      const seen = new Map();
      for (const p of pages) seen.set(normTitle(p.meta), (seen.get(normTitle(p.meta)) || 0) + 1);
      const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
      if (!dup.length) return ok();
      const involved = pages.filter((p) => dup.includes(normTitle(p.meta)));
      return fix(involved.length, `${dup.length} meta description(s) dupliquée(s) sur ${involved.length} page(s)`, involved[0].url);
    },
  },
  {
    code: 'O08', label: 'Aucun <h1>', pillar: 'onpage', severity: 'critique', penalty: 10, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.h1_count === 0);
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) sans balise h1`, pages[0].url);
    },
  },
  {
    code: 'O09', label: 'Plusieurs <h1>', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.h1_count > 1);
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) avec ${pages.map((p) => p.h1_count).join('/')} h1 (ex. ${pages[0].h1_count} sur ${pages[0].url})`, pages[0].url);
    },
  },
  {
    code: 'O10', label: '<h1> vide', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.h1_count > 0 && !(p.h1 || '').trim());
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) avec un h1 vide`, pages[0].url);
    },
  },
  {
    code: 'O11', label: 'Hiérarchie de titres cassée (saut H2→H4)', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => {
        const lv = p.h_levels || [];
        for (let i = 1; i < lv.length; i++) if (lv[i] > lv[i - 1] + 1) return true;
        return false;
      });
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) avec saut de niveau de titre (ex. ${pages[0].url})`, pages[0].url);
    },
  },
  {
    code: 'O12', label: 'Contenu mince (< 300 mots)', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.words < 300);
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.length} page(s) sous 300 mots (ex. ${pages[0].words} mots sur ${pages[0].url})`, pages[0].url);
    },
  },
  {
    code: 'O13', label: 'Images sans attribut alt', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const pages = okPages(facts);
      if (!pages.some((p) => p.images_total > 0)) return na('aucune image sur le site');
      const bad = pages.filter((p) => p.images_no_alt > 0);
      if (!bad.length) return ok();
      return fix(bad.length, `${bad.reduce((a, p) => a + p.images_no_alt, 0)} image(s) sans alt sur ${bad.length} page(s)`, bad[0].url);
    },
  },
  {
    code: 'O14', label: 'Images > 200 Ko ou non redimensionnées', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts);
      if (!pages.some((p) => p.images_total > 0)) return na('aucune image sur le site');
      const bad = pages.filter((p) => p.images_big > 0);
      if (!bad.length) return ok();
      return fix(bad.length, `${bad.reduce((a, p) => a + p.images_big, 0)} image(s) > 200 Ko sur ${bad.length} page(s)`, bad[0].url);
    },
  },
  {
    code: 'O15', label: 'Ancres internes génériques (« cliquez ici », « en savoir plus »)', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 10,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.generic_anchors > 0);
      if (!pages.length) return ok();
      return fix(pages.length, `${pages.reduce((a, p) => a + p.generic_anchors, 0)} ancre(s) générique(s) sur ${pages.length} page(s)`, pages[0].url);
    },
  },
  {
    code: 'O16', label: 'Page du sitemap non liée en interne (orpheline)', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      if (!facts.sitemap.present) return na('pas de sitemap');
      const orphan = facts.sitemap.in_sitemap_not_linked || [];
      if (!orphan.length) return ok();
      return fix(orphan.length, `${orphan.length} URL(s) du sitemap non liée(s) en interne (ex. ${orphan[0]})`, orphan[0]);
    },
  },
  {
    code: 'O17', label: 'Liens internes cassés (4xx)', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 10,
    check(facts) {
      const broken = (facts.broken_links || []).filter((b) => b.status >= 400 && b.status < 500);
      if (!broken.length) return ok();
      return fix(broken.length, `${broken.length} lien(s) interne(s) cassé(s) en ${broken[0].status} (ex. ${broken[0].url})`, broken[0].url);
    },
  },
  {
    code: 'O18', label: 'Balises Open Graph / Twitter absentes', pillar: 'onpage', severity: 'informatif', penalty: 0, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (home.og_title && home.og_image && home.twitter_card) return ok();
      const missing = [];
      if (!home.og_title) missing.push('og:title');
      if (!home.og_image) missing.push('og:image');
      if (!home.twitter_card) missing.push('twitter:card');
      return fix(1, `balises sociales absentes sur l’accueil : ${missing.join(', ')}`, home.url);
    },
  },
  {
    code: 'O19', label: 'Attribut lang absent sur <html>', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (home.lang) return ok();
      return fix(1, 'attribut lang absent sur la balise <html> de l’accueil', home.url);
    },
  },
  {
    code: 'O20', label: 'Données structurées absentes', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if ((home.jsonld_types || []).length) return ok();
      return fix(1, 'aucune donnée structurée JSON-LD sur l’accueil', home.url);
    },
  },
  {
    code: 'O21', label: 'JSON-LD invalide (ne se parse pas / champs requis manquants)', pillar: 'onpage', severity: 'majeur', penalty: 5, cap: 3,
    check(facts) {
      const pages = okPages(facts);
      const withJld = pages.filter((p) => (p.jsonld_types || []).length > 0);
      if (!withJld.length) return na('aucun JSON-LD');
      const bad = pages.filter((p) => (p.jsonld_invalid || 0) + (p.jsonld_missing_fields || 0) > 0);
      if (!bad.length) return ok();
      return fix(bad.length, `${bad.length} page(s) avec JSON-LD invalide ou incomplet`, bad[0].url);
    },
  },
  {
    code: 'O22', label: 'Incohérence NAP entre JSON-LD, page et pied de page', pillar: 'onpage', severity: 'critique', penalty: 10, cap: 3,
    check(facts) {
      const local = facts.local || {};
      if (!local.jsonld_phone && !local.jsonld_address) return na('pas de NAP en JSON-LD');
      let mismatches = 0;
      const detail = [];
      const pagePhones = (local.phones || []).map((p) => String(p).replace(/[\s.-]/g, ''));
      if (local.jsonld_phone) {
        const jp = String(local.jsonld_phone).replace(/[\s.-]/g, '');
        if (pagePhones.length && !pagePhones.includes(jp)) { mismatches++; detail.push(`téléphone JSON-LD (${local.jsonld_phone}) ≠ page`); }
      }
      if (local.jsonld_address) {
        const jaddr = normTitle(local.jsonld_address).replace(/[^a-z0-9]/g, '');
        const pageAddrs = (local.addresses || []).map((a) => normTitle(a).replace(/[^a-z0-9]/g, ''));
        if (pageAddrs.length && !pageAddrs.some((a) => a.includes(jaddr.slice(0, 12)) || jaddr.includes(a.slice(0, 12)))) {
          mismatches++; detail.push('adresse JSON-LD ≠ page');
        }
      }
      if (!mismatches) return ok();
      return fix(mismatches, `incohérence NAP : ${detail.join(' ; ')}`, facts.site.url);
    },
  },
  {
    code: 'O23', label: 'Texte essentiel porté par une image (image sans alt + texte voisin court)', pillar: 'onpage', severity: 'mineur', penalty: 2, cap: 5,
    check(facts) {
      const pages = okPages(facts);
      if (!pages.some((p) => p.images_total > 0)) return na('aucune image');
      const bad = pages.filter((p) => p.images_no_alt > 0 && p.words < 300);
      if (!bad.length) return ok();
      return fix(bad.length, `${bad.length} page(s) légères en texte avec images sans alt (texte probablement porté par l’image)`, bad[0].url);
    },
  },
  {
    code: 'O24', label: '<meta name="keywords"> ou balise obsolète', pillar: 'onpage', severity: 'informatif', penalty: 0, cap: 1,
    check(facts) {
      const home = homeOf(facts);
      if (!home) return na();
      if (home.meta_keywords) return fix(1, `balise meta keywords présente : « ${home.meta_keywords.slice(0, 40)} »`, home.url);
      return ok();
    },
  },

  /* -------- Contenu (7) -------- */
  {
    code: 'C01', label: 'Ni l’activité ni la ville n’apparaissent dans le corps de l’accueil', pillar: 'contenu', severity: 'critique', penalty: 10, cap: 1,
    check(facts) {
      const activity = (facts.site.activity || '').toLowerCase();
      const city = (facts.site.city || '').toLowerCase();
      if (!activity && !city) return na('activité et ville non renseignées');
      const home = homeOf(facts);
      if (!home) return na();
      const body = normTitle([home.title, home.h1, home.first_paragraph, (home.h2 || []).join(' ')].join(' '));
      const found = (activity && body.includes(activity)) || (city && body.includes(city));
      if (found) return ok();
      return fix(1, `ni « ${activity || city} » dans le texte de l’accueil (title/h1/premier paragraphe)`, home.url);
    },
  },
  {
    code: 'C02', label: 'Cannibalisation : 2 pages visant la même intention (titles proches)', pillar: 'contenu', severity: 'majeur', penalty: 5, cap: 5,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.title);
      const involved = new Set();
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          const a = normTitle(pages[i].title), b = normTitle(pages[j].title);
          const wa = a.split(/\s+/).filter(Boolean), wb = b.split(/\s+/).filter(Boolean);
          const inter = wa.filter((w) => wb.includes(w)).length;
          const jaccard = inter / Math.max(1, new Set([...wa, ...wb]).size);
          if (jaccard > 0.7 || a === b) { involved.add(pages[i].url); involved.add(pages[j].url); }
        }
      }
      if (!involved.size) return ok();
      return fix(involved.size, `${involved.size} page(s) en cannibalisation de title`, [...involved][0]);
    },
  },
  {
    code: 'C03', label: 'Contenu quasi dupliqué entre pages (SimHash, distance < 5)', pillar: 'contenu', severity: 'majeur', penalty: 5, cap: 5,
    check(facts) {
      const pages = okPages(facts).filter((p) => p.words >= 50 && p.simhash);
      const involved = new Set();
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          const d = hammingDistance(pages[i].simhash, pages[j].simhash);
          if (d < 5) { involved.add(pages[i].url); involved.add(pages[j].url); }
        }
      }
      if (!involved.size) return ok();
      return fix(involved.size, `${involved.size} page(s) au contenu quasi dupliqué (distance SimHash < 5)`, [...involved][0]);
    },
  },
  {
    code: 'C04', label: 'Aucune FAQ ni bloc de questions/réponses', pillar: 'contenu', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const pages = okPages(facts);
      const hasFaq = pages.some((p) =>
        (p.jsonld_types || []).includes('FAQPage') ||
        /foire aux questions|questions fréquentes|faq\b|\?/.test([p.title, p.h1, ...(p.h2 || [])].join(' '))
      );
      if (hasFaq) return ok();
      return fix(1, 'aucune FAQ ni bloc de questions/réponses détecté', homeOf(facts) ? homeOf(facts).url : facts.site.url);
    },
  },
  {
    code: 'C05', label: 'Contenu clé à plus de 3 clics de l’accueil', pillar: 'contenu', severity: 'mineur', penalty: 2, cap: 5,
    check(facts) {
      if (!facts.sitemap.present) return na('pas de sitemap');
      // profondeur atteinte pour chaque page crawlée
      const depthByUrl = new Map();
      for (const p of pagesOf(facts)) depthByUrl.set(normUrl(p.url), p.depth || 0);
      // URLs du sitemap liées mais atteintes seulement à la profondeur maximale crawlée (3 clics)
      const deep = (facts.sitemap.urls || [])
        .filter((u) => {
          const d = depthByUrl.get(normUrl(u));
          return d === 3;
        })
        .slice(0, 5);
      if (!deep.length) return ok();
      return fix(deep.length, `${deep.length} page(s) du sitemap atteinte(s) seulement à 3 clics de l’accueil (ex. ${deep[0]})`, deep[0]);
    },
  },
  {
    code: 'C06', label: 'Absence de page « contact » ou de moyen de contact direct', pillar: 'contenu', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const pages = pagesOf(facts);
      const hasContact = pages.some((p) => /contact|nous contacter|nous-ecrire|demande de devis|rdv/i.test((p.url || '') + ' ' + (p.title || ''))) ||
        pages.some((p) => (p.hrefs || []).some((h) => /^mailto:/i.test(h)));
      if (hasContact) return ok();
      return fix(1, 'aucune page contact ni lien mailto détecté', facts.site.url);
    },
  },
  {
    code: 'C07', label: 'Aucune mention géographique sur les pages internes', pillar: 'contenu', severity: 'majeur', penalty: 5, cap: 5,
    check(facts) {
      const internal = okPages(facts).filter((p) => (p.depth || 0) > 0);
      if (!internal.length) return na('aucune page interne');
      const withoutGeo = internal.filter((p) => !p.geo_mentions);
      if (!withoutGeo.length) return ok();
      return fix(withoutGeo.length, `${withoutGeo.length} page(s) interne(s) sur ${internal.length} sans mention géographique`, withoutGeo[0].url);
    },
  },

  /* -------- Performance (7) -------- */
  {
    code: 'P01', label: 'Score mobile < 50', pillar: 'performance', severity: 'critique', penalty: 10, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || typeof m.score !== 'number') return na('PageSpeed non mesuré');
      if (m.score < 50) return fix(1, `score mobile ${m.score}/100 (< 50)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P02', label: 'Score mobile 50–74', pillar: 'performance', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || typeof m.score !== 'number') return na('PageSpeed non mesuré');
      if (m.score >= 50 && m.score < 75) return fix(1, `score mobile ${m.score}/100 (50–74)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P03', label: 'LCP > 2,5 s', pillar: 'performance', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || typeof m.lcp_ms !== 'number') return na('LCP non mesuré');
      if (m.lcp_ms > 2500) return fix(1, `LCP de ${Math.round(m.lcp_ms)} ms (> 2500 ms)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P04', label: 'CLS > 0,1', pillar: 'performance', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || typeof m.cls !== 'number') return na('CLS non mesuré');
      if (m.cls > 0.1) return fix(1, `CLS de ${m.cls.toFixed(3)} (> 0,1)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P05', label: 'INP > 200 ms', pillar: 'performance', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || typeof m.inp_ms !== 'number') return na('INP non mesuré');
      if (m.inp_ms > 200) return fix(1, `INP de ${Math.round(m.inp_ms)} ms (> 200 ms)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P06', label: 'Poids de page > 2 Mo', pillar: 'performance', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      const total = m?.total_bytes ?? homeOf(facts)?.bytes ?? 0;
      if (!total) return na('poids non mesuré');
      if (total > 2 * 1024 * 1024) return fix(1, `poids total de ${Math.round(total / 1024)} Ko (> 2 Mo)`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'P07', label: 'Opportunités Lighthouse non exploitées (≥ 3 listées)', pillar: 'performance', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const m = facts.performance?.mobile;
      if (!m || !Array.isArray(m.top_opportunities)) return na('PageSpeed non mesuré');
      if (m.top_opportunities.length >= 3) return fix(1, `${m.top_opportunities.length} opportunités Lighthouse listées (ex. « ${m.top_opportunities[0]} »)`, facts.site.url);
      return ok();
    },
  },

  /* -------- Local & confiance (11) -------- */
  {
    code: 'L01', label: 'Aucun lien tel: cliquable', pillar: 'local', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (l.phone_href) return ok();
      if (l.phone_found) return fix(1, `téléphone présent dans le texte mais non cliquable (pas de lien tel:)`, facts.site.url);
      return fix(1, 'aucun numéro de téléphone ni lien tel: sur le site', facts.site.url);
    },
  },
  {
    code: 'L02', label: 'Adresse postale absente ou incohérente', pillar: 'local', severity: 'majeur', penalty: 5, cap: 3,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (!l.address_found) return fix(1, 'aucune adresse postale détectée', facts.site.url);
      const addrs = l.addresses || [];
      const codes = new Set();
      for (const a of addrs) for (const m of (a.match(/\b\d{5}\b/g) || [])) codes.add(m);
      if (codes.size > 1) return fix(codes.size, `adresses incohérentes : ${codes.size} codes postaux différents (${[...codes].join(', ')})`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'L03', label: 'Aucun lien vers la fiche Google Business', pillar: 'local', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (l.gbp_link_found) return ok();
      return fix(1, 'aucun lien vers une fiche Google Business détecté', facts.site.url);
    },
  },
  {
    code: 'L04', label: 'Aucune carte / plan d’accès', pillar: 'local', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (l.map_found) return ok();
      return fix(1, 'aucune carte ni plan d’accès intégré', facts.site.url);
    },
  },
  {
    code: 'L05', label: 'Aucun avis client visible', pillar: 'local', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (l.reviews_found) return ok();
      return fix(1, 'aucun avis client ni note visible', facts.site.url);
    },
  },
  {
    code: 'L06', label: 'Plusieurs établissements sur une seule page', pillar: 'local', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const l = facts.local || {};
      if (!hasLocalSignal(l)) return na('aucun signal local sur le site');
      if (l.multiple_locations) return fix(1, 'plusieurs adresses/téléphones distincts détectés sur une même page', facts.site.url);
      return ok();
    },
  },
  {
    code: 'S01', label: 'Mentions légales absentes', pillar: 'local', severity: 'critique', penalty: 10, cap: 1,
    check(facts) {
      if (facts.local?.legal_page_found) return ok();
      return fix(1, 'aucune page de mentions légales détectée', facts.site.url);
    },
  },
  {
    code: 'S02', label: 'Traceur chargé sans bandeau de consentement', pillar: 'local', severity: 'critique', penalty: 10, cap: 1,
    check(facts) {
      if (facts.local?.tracker_without_consent) return fix(1, 'traceur détecté sans bandeau de consentement', facts.site.url);
      return ok();
    },
  },
  {
    code: 'S03', label: 'Liens sortants vers des domaines douteux (> 5)', pillar: 'local', severity: 'majeur', penalty: 5, cap: 1,
    check(facts) {
      const doms = facts.local?.suspicious_domains || [];
      if (doms.length > 5) return fix(1, `${doms.length} domaine(s) sortant(s) douteux (ex. ${doms[0]})`, facts.site.url);
      return ok();
    },
  },
  {
    code: 'S04', label: 'Indices de compromission (liens cachés, texte masqué, redirection conditionnelle)', pillar: 'local', severity: 'bloquant', penalty: 20, cap: 1,
    check(facts) {
      if (facts.local?.compromise_indicators) return fix(1, 'marqueurs de contenu masqué / redirection conditionnelle détectés', facts.site.url);
      return ok();
    },
  },
  {
    code: 'S05', label: 'Version de CMS exposée (generator, /wp-json, ?ver=)', pillar: 'local', severity: 'mineur', penalty: 2, cap: 1,
    check(facts) {
      if (facts.local?.cms_version_exposed) return fix(1, 'version de CMS exposée (meta generator, /wp-json ou ?ver=)', facts.site.url);
      return ok();
    },
  },
];

function hasLocalSignal(l) {
  return !!(l.phone_found || l.address_found || l.map_found || l.gbp_link_found || l.reviews_found);
}

function hammingDistance(a, b) {
  let z = BigInt(a) ^ BigInt(b), d = 0;
  while (z) { d++; z &= z - 1n; }
  return d;
}

/* ------------------------------------------------------------------ */
/* runChecks                                                           */
/* ------------------------------------------------------------------ */

export function runChecks(facts) {
  const findings = [];
  const penalties = { technique: 0, onpage: 0, contenu: 0, performance: 0, local: 0 };
  const counts = { critiques: 0, majeurs: 0, mineurs: 0, informatifs: 0 };
  const catalogue = [];

  for (const c of CATALOGUE) {
    let r;
    try {
      r = c.check(facts);
    } catch {
      r = na('erreur de mesure');
    }
    catalogue.push({ code: c.code, label: c.label, pillar: c.pillar, result: r.result });

    if (r.result === 'a_corriger') {
      const occ = Math.max(0, Math.min(r.occurrences ?? 1, c.cap));
      penalties[c.pillar] += (c.penalty || 0) * occ;

      if (c.severity === 'bloquant' || c.severity === 'critique') counts.critiques++;
      else if (c.severity === 'majeur') counts.majeurs++;
      else if (c.severity === 'mineur') counts.mineurs++;
      else if (c.severity === 'informatif') counts.informatifs++;

      findings.push({
        code: c.code,
        pillar: c.pillar,
        severity: c.severity,
        page_url: r.page_url || null,
        evidence: r.evidence || '',
        detail: r.detail || '',
        fix_payload: null,
      });
    }
  }

  const note = (p) => Math.max(0, 100 - penalties[p]);
  const piliers = {
    technique: note('technique'),
    onpage: note('onpage'),
    contenu: note('contenu'),
    performance: note('performance'),
    local: note('local'),
  };
  const global = Math.round(
    (piliers.technique * WEIGHTS.technique +
      piliers.onpage * WEIGHTS.onpage +
      piliers.contenu * WEIGHTS.contenu +
      piliers.performance * WEIGHTS.performance +
      piliers.local * WEIGHTS.local) / 100
  );

  return {
    findings,
    score: { global, piliers, counts },
    catalogue,
  };
}
