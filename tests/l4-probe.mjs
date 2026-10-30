// Sonde L4 : rend le PDF du fixture et vérifie sa conformité page par page.
// Usage : node tests/l4-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { renderPdf, resolveChromiumPath, extractTextPerPage } from '../src/render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'report-sample.json'), 'utf8'));
const outDir = '/opt/data/cache/scratch/pdf-qa';
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, 'rapport.pdf');

console.log('=== ScanSEO · sonde L4 (rendu PDF) ===\n');

const t0 = Date.now();
const result = await renderPdf(fixture.report, fixture.facts, { outPath });
const elapsed = Date.now() - t0;

const host = fixture.facts.site.host;
const expectedTitle = `Audit SEO — ${host} — `; // préfixe vérifié plus bas

// Relecture du PDF : titre + texte par page.
const bytes = await fs.readFile(outPath);
const pdfDoc = await PDFDocument.load(bytes);
const title = pdfDoc.getTitle();
const pageTexts = await extractTextPerPage(bytes);

console.log(`PDF        : ${result.path}`);
console.log(`Pages      : ${result.pages}  (bornes 12–26)`);
console.log(`Poids      : ${(result.bytes / 1048576).toFixed(2)} Mo  (limite < 6 Mo)`);
console.log(`Titre PDF  : ${title}`);
console.log(`Rendu      : ${elapsed} ms\n`);

// Vérifications
const checks = [];
checks.push(['pages ∈ [12,26]', result.pages >= 12 && result.pages <= 26]);
checks.push(['poids < 6 Mo', result.bytes < 6 * 1024 * 1024]);
checks.push(['titre = "Audit SEO — host — date"', title === expectedTitle.slice(0, -2) ? false : title.startsWith('Audit SEO — ') && title.includes(host) && /— \d{1,2} /.test(title)]);

const shortPages = [];
pageTexts.forEach((t, i) => {
  const len = t.trim().length;
  if (i > 0 && len < 200) shortPages.push({ page: i + 1, len });
});
checks.push(['aucune page < 200 caractères (hors couverture)', shortPages.length === 0]);

checks.push(['aucun avertissement de débordement', !result.warnings.some((w) => w.includes('déborde'))]);
checks.push(['aucun avertissement de rendu', result.warnings.length === 0]);

console.log('--- Conformité ---');
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'OK ' : 'NON'}  ${label}`);
  if (!ok) allOk = false;
}
if (result.warnings.length) {
  console.log('\n  Warnings rendu :');
  for (const w of result.warnings) console.log(`    - ${w}`);
}
console.log(`\nVERDICT : ${allOk ? 'CONFORME' : 'NON CONFORME'}`);

// Texte extrait page par page (compte + amorce).
console.log('\n--- Texte par page (pdfjs) ---');
for (let i = 0; i < pageTexts.length; i++) {
  const t = pageTexts[i].trim();
  const excerpt = t.replace(/\s+/g, ' ').slice(0, 80);
  console.log(`  p${String(i + 1).padStart(2)} · ${String(t.length).padStart(4)} car. · ${excerpt}${t.length > 80 ? '…' : ''}`);
}

// Vérification de présence : host, score, date.
const allText = pageTexts.join('\n').replace(/\s+/g, ' ');
const norm = (s) => String(s).replace(/[^a-z0-9]/gi, '');
const scoreStr = String(fixture.facts.score.global);
console.log('\n--- Présence attendue ---');
console.log(`  host "${host}"       : ${norm(allText).includes(norm(host)) ? 'OK' : 'NON'}`);
console.log(`  score "${scoreStr}"  : ${allText.includes(scoreStr) ? 'OK' : 'NON'}`);
console.log(`  mention non contractuel : ${allText.includes('non contractuel') ? 'OK' : 'NON'}`);

// Capture d'une PNG par page (relecture visuelle).
const executablePath = await resolveChromiumPath();
const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1300, deviceScaleFactor: 1 });
  await page.emulateMediaType('print');
  const htmlPath = outPath.replace(/\.pdf$/i, '.html');
  await page.goto(new URL(`file://${htmlPath}`).href, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const els = await page.$$('.page');
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`) });
  }
  console.log(`\nPNG       : ${els.length} capture(s) → ${outDir}/page-01.png … page-${String(els.length).padStart(2, '0')}.png`);
} finally {
  await browser.close();
}

console.log(`\nFichiers livrés : rapport.pdf, rapport.html, ${pageTexts.length} PNG dans ${outDir}`);
process.exit(allOk ? 0 : 1);
