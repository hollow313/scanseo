// L3 probe — exécute analyze() sur tests/fixtures/facts-sample.json.
// Mode DEEPSEEK_MOCK=1 : validation sur un rapport volontairement fautif puis
// bascule fallback. Puis UN appel réel à DeepSeek (clé lue depuis /opt/data/.env,
// jamais affichée).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, numberIssues } from '../src/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');
const facts = JSON.parse(fs.readFileSync(path.join(fixtures, 'facts-sample.json'), 'utf8'));

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    console.error(`  ✘ ${label}`);
    failures++;
  }
}

// ---- Test 1 : mock fautif (code inconnu + title 90 car. + « +320 % ») ----
console.log('\n=== Test 1 : mock fautif → nettoyage + régénération ===');
process.env.DEEPSEEK_MOCK = '1';
process.env.DEEPSEEK_MOCK_FILE = path.join(fixtures, 'report-mock.json');
const t1 = await analyze(facts, { offer: 'audit_49', fallbackFindings: facts.findings });
console.log(`  fallback=${t1.fallback} constats=${t1.report.constats.length} fixes=${t1.fixes.length}`);
for (const f of t1.fixes) console.log(`    fix → ${f}`);

assert(!t1.report.constats.some((c) => c.code === 'X99'), 'code inconnu X99 retiré');
assert(t1.fixes.some((f) => /code inconnu|X99/.test(f)), 'écart X99 logué');
for (const tp of t1.report.textes_prets) {
  assert(tp.title.length >= 30 && tp.title.length <= 65, `title bornes OK (${tp.title.length} car.)`);
  assert(tp.meta.length >= 120 && tp.meta.length <= 165, `meta bornes OK (${tp.meta.length} car.)`);
}
assert(!/320\s*%/.test(t1.report.resume_executif), 'resume_executif sans « 320 % »');
assert(!t1.report.constats.some((c) => /320\s*%/.test(c.pourquoi || '')), 'pourquoi sans « 320 % »');
assert(t1.fallback === false, 'pas de bascule fallback (réparé, pas planté)');

// ---- Test 2 : mock structurellement invalide → fallback déterministe ----
console.log('\n=== Test 2 : mock invalide → fallback déterministe ===');
process.env.DEEPSEEK_MOCK_FILE = path.join(fixtures, 'report-mock-invalid.json');
const t2 = await analyze(facts, { offer: 'audit_49', fallbackFindings: facts.findings });
console.log(`  fallback=${t2.fallback} constats=${t2.report.constats.length}`);
assert(t2.fallback === true, 'fallback = true');
assert(t2.report.constats.length >= 8, `constats >= 8 (${t2.report.constats.length})`);
assert(t2.report.piliers.every((p) => typeof p.note === 'number'), 'notes de piliers recopiées depuis facts.score');

// ---- Test 3 : UN appel réel DeepSeek ----
console.log('\n=== Test 3 : appel réel DeepSeek (audit_49) ===');
let apiKey = null;
const envPath = '/opt/data/.env';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) {
      apiKey = m[1].replace(/^["']|["']$/g, '');
      break;
    }
  }
}
assert(!!apiKey, 'clé DEEPSEEK_API_KEY trouvée dans /opt/data/.env');
if (apiKey) {
  process.env.DEEPSEEK_API_KEY = apiKey;
  delete process.env.DEEPSEEK_MOCK;
  delete process.env.DEEPSEEK_MOCK_FILE;
  const t3 = await analyze(facts, { offer: 'audit_49', fallbackFindings: facts.findings });
  console.log(`  fallback=${t3.fallback} constats=${t3.report.constats.length} fixes=${t3.fixes.length}`);
  console.log(`  usage = tokens_in=${t3.usage.tokens_in} tokens_out=${t3.usage.tokens_out} cost_usd=${t3.usage.cost_usd.toFixed(6)}`);

  assert(!t3.fallback, 'rapport réel validé sans fallback');
  assert(t3.report.constats.length >= 8 && t3.report.constats.length <= 22, `constats entre 8 et 22 (${t3.report.constats.length})`);
  assert(!t3.report.constats.some((c) => !facts.allowed_codes.includes(c.code)), 'aucun code hors catalogue');
  const nums = numberIssues(t3.report, facts, facts.findings);
  assert(nums.length === 0, 'anti-hallucination : aucun nombre non sourcé');

  console.log('\n  — extrait du rapport réel —');
  console.log(`  Verdict : ${t3.report.verdict}`);
  console.log(`  Résumé exécutif : ${t3.report.resume_executif}`);
  for (const c of t3.report.constats.slice(0, 2)) {
    console.log(`  Constat ${c.code} [${c.gravite}] : ${c.constat}`);
    console.log(`    pourquoi : ${c.pourquoi}`);
    console.log(`    correctif : ${c.correctif}`);
  }
  console.log(`  Coût estimé : $${t3.usage.cost_usd.toFixed(6)}`);
}

console.log(`\n${failures === 0 ? 'TOUS LES TESTS PASSENT' : `${failures} ÉCHEC(S)`}`);
process.exit(failures === 0 ? 0 : 1);
