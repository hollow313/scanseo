// Sonde L2 : crawl 2 sites publics réels, applique runChecks, affiche le résultat.
// Usage : node tests/l2-probe.mjs   (depuis la racine du dépôt)
import { collect } from '../src/crawl.js';
import { runChecks, CATALOGUE } from '../src/checks.js';

const SITES = [
  { url: 'https://example.com/', activity: '', city: '' },
  { url: 'https://fr.wordpress.org/', activity: '', city: '' },
];

function auditFor(site, i) {
  const host = new URL(site.url).hostname;
  return {
    id: `probe-${i}`,
    url: site.url,
    host,
    offer: 'audit_49',
    activity: site.activity,
    city: site.city,
    competitors: '[]',
    lang: 'fr',
  };
}

function verifyScore(checks) {
  const W = { technique: 25, onpage: 30, contenu: 20, performance: 15, local: 10 };
  const expected = Math.round(
    (checks.score.piliers.technique * W.technique +
      checks.score.piliers.onpage * W.onpage +
      checks.score.piliers.contenu * W.contenu +
      checks.score.piliers.performance * W.performance +
      checks.score.piliers.local * W.local) / 100
  );
  return expected === checks.score.global;
}

for (let i = 0; i < SITES.length; i++) {
  const site = SITES[i];
  console.log('\n' + '='.repeat(78));
  console.log(`SITE ${i + 1} : ${site.url}`);
  console.log('='.repeat(78));

  const audit = auditFor(site, i);
  const facts = await collect(audit, {
    onProgress: (n, total) => process.stdout.write(`\r  crawl ${n}/${total} pages...`),
  });
  process.stdout.write('\r\x1b[2K');

  const checks = runChecks(facts);

  console.log(`  Accueil statut        : ${facts.pages[0]?.status ?? 'inaccessible'}`);
  console.log(`  Pages crawlées        : ${facts.site.pages_crawled} (max ${facts.limits.max_pages})`);
  console.log(`  partial               : ${facts.site.partial}`);
  console.log(`  CMS                   : ${facts.site.cms ?? '(non détecté)'}`);
  console.log(`  HTTPS / redir HTTPS   : ${facts.site.https} / ${facts.site.redirect_to_https}`);
  console.log(`  robots.txt            : present=${facts.robots.present} blocks_all=${facts.robots.blocks_all}`);
  console.log(`  sitemap               : present=${facts.sitemap.present} urls=${facts.sitemap.urls_count}`);
  console.log(`  cloaking (UA matrix)  : ${facts.ua_matrix.cloaking_detected}  js_only=${facts.ua_matrix.js_only}`);
  console.log(`  PageSpeed mobile      : ${facts.performance.mobile ? `score ${facts.performance.mobile.score}/100 (LCP ${facts.performance.mobile.lcp_ms} ms)` : 'non mesuré (clé absente/échec API)'}`);
  console.log(`  Liens cassés          : ${facts.broken_links.length}`);

  console.log(`\n  Score global          : ${checks.score.global}/100`);
  console.log(`  Scores par pilier     : technique ${checks.score.piliers.technique} | onpage ${checks.score.piliers.onpage} | contenu ${checks.score.piliers.contenu} | performance ${checks.score.piliers.performance} | local ${checks.score.piliers.local}`);
  console.log(`  Vérif. somme pondérée : ${verifyScore(checks) ? 'OK (somme pondérée = score global)' : 'ÉCART !'}`);

  const byResult = { conforme: 0, a_corriger: 0, non_applicable: 0 };
  for (const c of checks.catalogue) byResult[c.result]++;
  console.log(`  Répartition 66 contrôles : conforme=${byResult.conforme}  à corriger=${byResult.a_corriger}  non applicable=${byResult.non_applicable}  (somme=${checks.catalogue.length})`);

  console.log(`\n  8 premiers findings :`);
  const top = checks.findings.slice(0, 8);
  for (const f of top) {
    console.log(`    [${f.code}] ${f.severity.padEnd(9)} ${f.evidence}`);
  }
  console.log(`  (total findings : ${checks.findings.length})`);
}
