import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collect } from '../src/crawl.js';

/**
 * Fumée du crawler : un vrai serveur HTTP local, deux pages, une offre réelle.
 * Ce test existe parce qu'une erreur « maxPagesFor is not defined » (import
 * manquant) a fait échouer TOUS les audits en production sans que la suite le
 * voie : le module n'était chargé qu'à l'exécution, dans le worker.
 */
test('collect — un site de deux pages se collecte sans erreur', async () => {
  const pages = {
    '/': '<html lang="fr"><head><title>Accueil de test</title><meta name="description" content="x"></head><body><h1>Accueil</h1><a href="/page-2">Page 2</a></body></html>',
    '/page-2': '<html lang="fr"><head><title>Deuxième page</title></head><body><h1>Deux</h1><a href="/">retour</a></body></html>',
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /'); }
    const html = pages[req.url];
    if (!html) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const facts = await collect({
      url: `http://127.0.0.1:${port}/`,
      host: '127.0.0.1',
      offer: 'audit_29',
      activity: null,
      city: null,
      competitors: null,
    });
    assert.ok(facts.site, 'facts.site doit exister');
    // Le garde anti-SSRF refuse 127.0.0.1 : ce test vérifie que collect() va au
    // bout de son parcours sans lever (imports, calcul du plafond de pages, score).
    assert.ok(facts.pages.length >= 1, 'au moins une entrée de page');
    assert.ok(Array.isArray(facts.pages), 'facts.pages est un tableau');
  } finally {
    server.close();
  }
});
