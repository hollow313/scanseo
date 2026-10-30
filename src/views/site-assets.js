// Assets statiques du site public (CSS + polices embarquées).
//
// À monter dans server.js ainsi :
//     import { siteAssetsRouter } from './src/views/site-assets.js';
//     app.use('/assets', siteAssetsRouter);
//
// Expose alors :
//     GET /assets/site.css               → feuille de style du site
//     GET /assets/fonts/:file.woff2      → polices Inter (servies en local,
//                                          aucune ressource tierce, aucun appel
//                                          à Google Fonts)
//
// Le router est volontairement monté sur son préfixe (/assets), comme les
// routeurs L5/L6 le sont sur les leurs — un montage à la racine laisserait
// /:file capter des routes publiques.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const FONTS_DIR = path.join(TEMPLATES_DIR, 'fonts');

const FONT_RE = /^[a-z0-9-]+\.woff2$/;

export const siteAssetsRouter = express.Router();

// Image sociale (Open Graph) et favicon : sans elles, un partage sur LinkedIn
// ou WhatsApp n'affiche aucun visuel et le site paraît abandonné.
siteAssetsRouter.get('/apercu-rapport.png', (req, res) => {
  const file = path.join(TEMPLATES_DIR, 'apercu-rapport.png');
  if (!fs.existsSync(file)) return res.status(404).send('Not Found');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
});

siteAssetsRouter.get('/favicon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3b5bfd"/><circle cx="32" cy="32" r="12" fill="#fff"/></svg>');
});

// Feuille de style du site (contenu statique, cache court pour permettre les
// mises à jour sans purge manuelle).
siteAssetsRouter.get('/site.css', (req, res) => {
  const file = path.join(TEMPLATES_DIR, 'site.css');
  if (!fs.existsSync(file)) {
    return res.status(404).send('Not Found');
  }
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(file);
});

// Polices Inter. Garde stricte : nom de fichier normalisé (pas de traversal),
// extension woff2 uniquement, résolution réelle puis vérification du préfixe.
siteAssetsRouter.get('/fonts/:file', (req, res) => {
  const file = req.params.file || '';
  if (!FONT_RE.test(file)) {
    return res.status(404).send('Not Found');
  }

  let abs;
  try {
    abs = fs.realpathSync(path.join(FONTS_DIR, file));
    const base = fs.realpathSync(FONTS_DIR) + path.sep;
    if (!abs.startsWith(base)) {
      return res.status(404).send('Not Found');
    }
  } catch {
    return res.status(404).send('Not Found');
  }

  res.setHeader('Content-Type', 'font/woff2');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(abs);
});

export default siteAssetsRouter;
