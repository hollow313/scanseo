import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { isPremium, offerLabel } from './offers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tarifs DeepSeek (USD par million de tokens, hors peak). Source : docs/04 §8.
// ---------------------------------------------------------------------------
const PRICES = {
  'deepseek-v4-pro': { in: 0.66, out: 1.98 },
  'deepseek-flash': { in: 0.15, out: 0.6 },
};
const DEFAULT_MODEL = 'deepseek-v4-pro';

const SEVERITY_ORDER = { bloquant: 0, critique: 1, majeur: 2, mineur: 3, informatif: 4 };
const PILLAR_CODES = ['technique', 'onpage', 'contenu', 'performance', 'local'];

const API_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Schéma zod (forme exacte de docs/05 §7, dite « gabarit B »).
// Les champs que le code sait reconstruire déterministiquement sont optionnels :
// ils sont complétés dans finalizeReport() à partir des faits.
// ---------------------------------------------------------------------------
const texteSchema = z.object({
  title: z.string().optional().nullable(),
  meta: z.string().optional().nullable(),
  h1: z.string().optional().nullable(),
  h2: z.array(z.string()).optional().nullable(),
});

// Le modèle rend parfois `texte_a_coller` comme une simple chaîne (le title) ;
// on la normalise en objet pour coller au gabarit §7.
const texteACollerSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { title: v } : v),
  texteSchema,
);

const constatSchema = z.object({
  code: z.string(),
  page: z.string().nullable().optional(),
  gravite: z.string().optional().nullable(),
  constat: z.string(),
  pourquoi: z.string(),
  correctif: z.string(),
  texte_a_coller: texteACollerSchema.optional().nullable(),
});

const pilierSchema = z.object({
  code: z.string(),
  note: z.coerce.number().nullable().optional(),
  commentaire: z.string().optional(),
});

const textePretSchema = z.object({
  page: z.string(),
  title: z.string(),
  meta: z.string(),
  h1: z.string(),
  h2: z.array(z.string()),
});

const semaineSchema = z.object({
  semaine: z.preprocess((v) => {
    if (typeof v === 'string') {
      const m = v.match(/\d+/);
      return m ? Number(m[0]) : NaN;
    }
    return v;
  }, z.number()),
  theme: z.string().optional(),
  actions: z.array(z.string()),
});

const pageRedigeeSchema = z.object({
  url: z.string(),
  title: z.string(),
  meta: z.string(),
  h1: z.string(),
  chapo: z.string(),
  h2: z.array(z.object({ titre: z.string(), paragraphes: z.array(z.string()) })),
  faq: z.array(z.object({ q: z.string(), r: z.string() })),
  cta: z.string(),
});

export const reportSchema = z.object({
  verdict: z.string(),
  resume_executif: z.string(),
  points_forts: z.array(z.string()).optional(),
  piliers: z.array(pilierSchema).optional(),
  constats: z.array(constatSchema),
  textes_prets: z.array(textePretSchema).optional(),
  plan_30_jours: z.array(semaineSchema).optional(),
  a_verifier_dans_search_console: z.array(z.string()).optional(),
  limites: z.string().optional(),
  pages_redigees: z.array(pageRedigeeSchema).optional(),
});

// ---------------------------------------------------------------------------
// Exemple de gabarit fourni au modèle (il sert de « schéma » concret).
// ---------------------------------------------------------------------------
const REPORT_EXAMPLE = {
  verdict: 'Une phrase de 15 à 30 mots, factuelle, sans promesse de résultat.',
  resume_executif: '3 à 5 phrases (60 à 120 mots) : ce qui bloque, ce qui est facile à corriger, par quoi commencer.',
  points_forts: ['3 à 5 constats mesurés et positifs, jamais de compliment générique'],
  piliers: [
    { code: 'technique', commentaire: '2 à 3 phrases appuyées sur les faits et le score donné' },
    { code: 'onpage', commentaire: '2 à 3 phrases appuyées sur les faits et le score donné' },
    { code: 'contenu', commentaire: '2 à 3 phrases appuyées sur les faits et le score donné' },
    { code: 'performance', commentaire: '2 à 3 phrases appuyées sur les faits et le score donné' },
    { code: 'local', commentaire: '2 à 3 phrases appuyées sur les faits et le score donné' },
  ],
  constats: [
    {
      code: 'O05',
      page: 'https://…',
      gravite: 'majeur',
      constat: 'Ce qui est mesuré, en une phrase factuelle (reprends le chiffre du fait).',
      pourquoi: "L'effet concret pour le client, 1 à 2 phrases, sans jargon.",
      correctif: "Action exacte, à l'impératif, avec le chemin de clic quand il existe.",
      texte_a_coller: { title: '…', meta: '…', h1: '…', h2: ['…'] },
    },
  ],
  textes_prets: [{ page: 'https://…', title: '…', meta: '…', h1: '…', h2: ['…', '…', '…'] }],
  plan_30_jours: [{ semaine: 1, theme: '…', actions: ['…', '…'] }],
  a_verifier_dans_search_console: ['3 instructions maximum avec le chemin de clic exact'],
  limites: "2 à 3 phrases rappelant ce que l'audit ne mesure pas et pourquoi.",
};

const LIMITES_CONNUES = [
  'positions Google non mesurées',
  'volumes de recherche non mesurés',
  'backlinks non mesurés',
];

// ---------------------------------------------------------------------------
// Helpers fichiers / prompts
// ---------------------------------------------------------------------------
function readPrompt(name) {
  return fs.readFileSync(path.join(__dirname, 'prompts', name), 'utf8');
}

function mockContent() {
  const file = process.env.DEEPSEEK_MOCK_FILE
    || path.resolve(__dirname, '../tests/fixtures/report-mock.json');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
}

function parseJsonContent(content) {
  let text = String(content ?? '').trim();
  // Défense : retirer d'éventuelles clôtures Markdown ```json … ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function costUsd(model, tokensIn, tokensOut) {
  const p = PRICES[model] || PRICES[DEFAULT_MODEL];
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

// ---------------------------------------------------------------------------
// Appel DeepSeek (2 tentatives réseau, pas de streaming)
// ---------------------------------------------------------------------------
async function callDeepSeek(messages, model, maxTokens = 8000) {
  const apiKey = process.env.DEEPSEEK_API_KEY || config.deepseekApiKey;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY manquante');

  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      const data = JSON.parse(text);
      const content = data?.choices?.[0]?.message?.content ?? '';
      return {
        content,
        finish_reason: data?.choices?.[0]?.finish_reason ?? null,
        usage: {
          tokens_in: data?.usage?.prompt_tokens ?? 0,
          tokens_out: data?.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < 2) await sleep(1000);
    }
  }
  throw lastErr || new Error('appel DeepSeek échoué');
}

// ---------------------------------------------------------------------------
// Réduction des faits (docs/04 §6) : corps des pages exclu, 300 car. du premier
// paragraphe par page, budget total ≤ 60 000 caractères.
// ---------------------------------------------------------------------------
function reduceFacts(facts, findings) {
  const pages = (facts.pages || []).map((p) => ({
    url: p.url,
    title: p.title ?? '',
    title_len: (p.title ?? '').length,
    meta: p.meta ?? '',
    meta_len: (p.meta ?? '').length,
    h1: p.h1 ?? '',
    h1_count: p.h1_count ?? null,
    words: p.words ?? null,
    status: p.status ?? null,
    jsonld: p.jsonld_types ?? [],
    images_no_alt: p.images_no_alt ?? null,
    images_total: p.images_total ?? null,
    internal_links: p.internal_links ?? null,
    first_paragraph: String(p.first_paragraph ?? '').slice(0, 300),
  }));

  return {
    site: {
      url: facts.site?.url ?? null,
      host: facts.site?.host ?? null,
      activity: facts.site?.activity ?? null,
      city: facts.site?.city ?? null,
      lang: facts.site?.lang ?? null,
      cms: facts.site?.cms ?? null,
      pages_crawled: facts.site?.pages_crawled ?? pages.length,
      partial: facts.site?.partial ?? false,
      https: facts.site?.https ?? null,
      redirect_to_https: facts.site?.redirect_to_https ?? null,
    },
    score: facts.score
      ? { global: facts.score.global ?? null, piliers: facts.score.piliers ?? {} }
      : null,
    findings: (findings || []).map((f) => ({
      code: f.code,
      pillar: f.pillar,
      severity: f.severity,
      page: f.page_url ?? f.page ?? null,
      evidence: f.evidence ?? null,
      detail: f.detail ?? null,
    })),
    pages,
    performance: facts.performance
      ? {
          mobile_score: facts.performance.mobile?.score ?? facts.performance.mobile_score ?? null,
          lcp_ms: facts.performance.mobile?.lcp_ms ?? null,
          cls: facts.performance.mobile?.cls ?? null,
          inp_ms: facts.performance.mobile?.inp_ms ?? null,
          top_opportunities: facts.performance.mobile?.top_opportunities ?? [],
        }
      : null,
    local: facts.local
      ? {
          phone_found: facts.local.phone_found ?? null,
          address_found: facts.local.address_found ?? null,
          gbp_link: facts.local.gbp_link_found ?? null,
          reviews_found: facts.local.reviews_found ?? null,
        }
      : null,
    limites_connues: LIMITES_CONNUES,
  };
}

function buildFactsString(reduced) {
  let s = JSON.stringify(reduced);
  if (s.length <= 60_000) return s;

  const slim = {
    ...reduced,
    pages: reduced.pages.map(({ first_paragraph, ...rest }) => rest),
  };
  s = JSON.stringify(slim);
  if (s.length <= 60_000) return s;

  for (let n = slim.pages.length - 1; n > 0; n--) {
    const candidate = { ...slim, pages: slim.pages.slice(0, n) };
    s = JSON.stringify(candidate);
    if (s.length <= 60_000) return s;
  }
  return s.slice(0, 60_000);
}

// ---------------------------------------------------------------------------
// Prompt utilisateur (docs/05 §2)
// ---------------------------------------------------------------------------
function buildUserPrompt(facts, offer, findings, regenReasons) {
  const reduced = reduceFacts(facts, findings);
  const date = new Date().toISOString().slice(0, 10);
  const scoreJson = JSON.stringify(reduced.score ?? null);
  const factsStr = buildFactsString(reduced);

  const findingsLines = (findings || [])
    .map((f) => `${f.code}\t${f.pillar}\t${f.severity}\t${f.page_url ?? f.page ?? ''}\t${f.evidence ?? ''}`)
    .join('\n');

  const codes = [...new Set(facts.allowed_codes || (findings || []).map((f) => f.code))]
    .sort()
    .join(', ');

  let out = `SITE : ${reduced.site.host || ''} (${reduced.site.url || ''})
ACTIVITÉ DÉCLARÉE : ${reduced.site.activity || ''}
VILLE : ${reduced.site.city || ''}
OFFRE : ${isPremium(offer)
    ? 'audit complet = 100 pages analysées, plan d\'action sur 12 semaines (90 jours), 2 pages entièrement rédigées (H1, chapô, H2, FAQ, CTA) dans pages_redigees'
    : 'audit standard = 25 pages analysées, plan d\'action sur 4 semaines (30 jours), aucune page entièrement rédigée'}

RÈGLE DE VÉRITÉ : n'affirme jamais un problème absent des constats fournis. Si un pilier est noté
100/100, aucun texte ne doit laisser entendre qu'il reste un défaut dans ce pilier. Chaque phrase du
verdict, du résumé et des points forts doit pouvoir être reliée à une mesure fournie.
DATE : ${date}

SCORES (calculés, ne pas les modifier) :
${scoreJson}

FAITS MESURÉS :
${factsStr}

CONSTATS DÉTECTÉS PAR LE CODE (un par ligne, à reprendre) :
${findingsLines}

CODES AUTORISÉS :
${codes}

SCHÉMA JSON ATTENDU (respecte-le exactement : mêmes clés, mêmes types, aucune clé supplémentaire) :
${JSON.stringify(REPORT_EXAMPLE, null, 2)}

Réponds uniquement avec le JSON valide conforme au schéma, sans texte avant ni après, sans balise Markdown.`;

  if (regenReasons && regenReasons.length) {
    out += `\n\nATTENTION : ta réponse précédente a été refusée par la validation automatique pour les raisons suivantes. Corrige précisément ces points et réponds à nouveau uniquement avec le JSON valide :\n${regenReasons.map((r) => `- ${r}`).join('\n')}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anti-hallucination numérique (docs/04 §7 règle 5)
// ---------------------------------------------------------------------------
const NUM_RE = /(\d+(?:[.,]\d+)?)\s*(%|€|ms|pages?|mots?|secondes?|octets?|ko|mo|go|s)(?![a-zA-ZÀ-ÿ])/gi;
const ALL_NUM_RE = /(\d+(?:[.,]\d+)?)/g;

function normalizeNum(s) {
  return String(s).replace(/\s+/g, '').replace(',', '.');
}

/** Tous les nombres (avec ou sans unité) — sert à construire l'ensemble des
 *  nombres « sourcés » présents dans les faits. */
function extractAllNumbers(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(ALL_NUM_RE)) out.push(normalizeNum(m[1]));
  return out;
}

/** Renvoie les nombres présents dans `pourquoi`/`resume_executif` absents des faits. */
export function numberIssues(report, facts, findings) {
  const factsText = JSON.stringify(reduceFacts(facts, findings));
  const allowed = new Set(extractAllNumbers(factsText));
  const problems = [];

  const scan = (text, where) => {
    for (const m of String(text ?? '').matchAll(NUM_RE)) {
      const num = normalizeNum(m[1]);
      if (!allowed.has(num)) problems.push({ number: num, raw: m[0], where, text });
    }
  };

  scan(report?.resume_executif, 'resume_executif');
  for (const c of report?.constats || []) scan(c.pourquoi, `constat ${c.code}`);
  return problems;
}

// ---------------------------------------------------------------------------
// Validation de forme (bornes, unicité)
// ---------------------------------------------------------------------------
function checkBounds(report) {
  const issues = [];
  const check = (where, obj, required) => {
    if (!obj) return;
    if (obj.title != null && (obj.title !== '' || required)) {
      const L = (obj.title || '').length;
      if (L < 30 || L > 65) issues.push(`${where}.title=${L} car. (attendu 30-65)`);
    }
    if (obj.meta != null && (obj.meta !== '' || required)) {
      const L = (obj.meta || '').length;
      if (L < 120 || L > 165) issues.push(`${where}.meta=${L} car. (attendu 120-165)`);
    }
    if (obj.h1 != null && obj.h1 !== '') {
      const L = obj.h1.length;
      if (L > 70) issues.push(`${where}.h1=${L} car. (max 70)`);
    }
  };
  (report.textes_prets || []).forEach((t, i) => check(`textes_prets[${i}]`, t, true));
  (report.constats || []).forEach((c, i) => {
    if (c.texte_a_coller) check(`constats[${i}].texte_a_coller`, c.texte_a_coller, false);
  });
  return issues;
}

function checkDuplicateTitles(report) {
  const seen = new Set();
  const dups = [];
  for (const t of report.textes_prets || []) {
    if (!t.title) continue;
    if (seen.has(t.title)) dups.push(t.title);
    else seen.add(t.title);
  }
  return dups;
}

// ---------------------------------------------------------------------------
// Validation complète d'une réponse brute.
// Retour : { report, fixes[], regenReasons[] } — les retraits de code/page sont
// des corrections silencieuses (fixes), les écarts de forme déclenchent une
// régénération (regenReasons).
// ---------------------------------------------------------------------------
function validateReport(content, ctx) {
  const fixes = [];
  const regenReasons = [];

  let raw;
  try {
    raw = parseJsonContent(content);
  } catch (e) {
    return { report: null, fixes, regenReasons: [{ type: 'zod', hard: true, message: `JSON invalide : ${e.message}` }] };
  }

  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ');
    return { report: null, fixes, regenReasons: [{ type: 'zod', hard: true, message: `schéma invalide : ${msg}` }] };
  }
  const report = parsed.data;

  // 1. code ∈ catalogue, page ∈ pages crawlées (retrait, loggé)
  report.constats = (report.constats || []).filter((c) => {
    if (!ctx.allowedCodes.has(c.code)) {
      fixes.push(`constat retiré : code inconnu « ${c.code} »`);
      return false;
    }
    if (c.page && !ctx.crawledUrls.has(c.page)) {
      fixes.push(`constat ${c.code} retiré : page hors crawl « ${c.page} »`);
      return false;
    }
    return true;
  });

  // 2. bornes de longueur
  const bounds = checkBounds(report);
  if (bounds.length) {
    regenReasons.push({ type: 'bounds', hard: false, message: `bornes de longueur dépassées : ${bounds.slice(0, 6).join(' ; ')}` });
  }

  // 3. unicité des titles
  const dups = checkDuplicateTitles(report);
  if (dups.length) {
    regenReasons.push({ type: 'dup_titles', hard: false, message: `titles dupliqués : ${[...new Set(dups)].slice(0, 4).join(' | ')}` });
  }

  // 4. anti-hallucination numérique
  const hallucinations = numberIssues(report, ctx.facts, ctx.findings);
  if (hallucinations.length) {
    regenReasons.push({
      type: 'hallucination',
      hard: false,
      message: `nombres non sourcés : ${[...new Set(hallucinations.map((h) => h.raw))].slice(0, 6).join(', ')}`,
    });
  }

  return { report, fixes, regenReasons };
}

// ---------------------------------------------------------------------------
// Normalisation / déterministes
// ---------------------------------------------------------------------------
function normalizeGravite(g) {
  const s = String(g ?? '').trim().toLowerCase();
  const map = {
    bloquant: 'bloquant', bloquante: 'bloquant', critique: 'critique',
    majeur: 'majeur', majeure: 'majeur', important: 'majeur', importante: 'majeur', grave: 'majeur',
    mineur: 'mineur', mineure: 'mineur', modere: 'mineur', 'modéré': 'mineur', 'modérée': 'mineur',
    informatif: 'informatif', informative: 'informatif', info: 'informatif',
  };
  return map[s] || (SEVERITY_ORDER[s] !== undefined ? s : 'majeur');
}

const WHY_BY_SEVERITY = {
  bloquant: "Ce point peut empêcher les moteurs de recherche d'indexer correctement votre site.",
  critique: 'Ce point dégrade fortement la lecture de votre site par les moteurs de recherche.',
  majeur: 'Ce point pénalise la qualité perçue de vos pages.',
  mineur: 'Ce point est une amélioration qui renforce la cohérence de votre site.',
  informatif: 'Ce point est signalé à titre informatif.',
};

function sortFindingsBySeverity(findings) {
  return (findings || []).slice().sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

function findingToConstat(f, facts) {
  return {
    code: f.code,
    page: f.page_url ?? f.page ?? null,
    gravite: normalizeGravite(f.severity),
    constat: f.evidence || facts.catalogue_labels?.[f.code] || f.code,
    pourquoi: WHY_BY_SEVERITY[normalizeGravite(f.severity)] || WHY_BY_SEVERITY.majeur,
    correctif: f.detail || "Corrigez ce point dans votre interface d'administration.",
    texte_a_coller: null,
  };
}

function derivePointsForts(facts) {
  const out = [];
  const s = facts.site || {};
  if (s.https) out.push('Votre site est servi en HTTPS, la navigation y est chiffrée.');
  if (s.redirect_to_https) out.push('Votre site redirige correctement de HTTP vers HTTPS.');
  if (facts.robots?.present) out.push('Votre fichier robots.txt est présent.');
  if (facts.sitemap?.present && (facts.sitemap.urls_count ?? 0) > 0) {
    out.push(`Votre sitemap XML est présent et référence ${facts.sitemap.urls_count} adresses.`);
  }
  if (facts.local?.phone_found) out.push('Votre numéro de téléphone est cliquable sur le site.');
  if (facts.local?.address_found) out.push('Votre adresse est visible sur le site.');
  if (facts.ua_matrix && facts.ua_matrix.cloaking_detected === false) {
    out.push('Aucune différence de contenu dissimulée détectée entre navigateurs.');
  }
  const riche = (facts.pages || []).find((p) => (p.words || 0) >= 300);
  if (riche) out.push(`La page ${riche.url} contient plus de 300 mots de contenu rédigé.`);
  return out.slice(0, 5);
}

function buildPiliers(facts) {
  return PILLAR_CODES.map((code) => ({
    code,
    note: facts.score?.piliers?.[code] ?? null,
    commentaire: 'Voir les constats de ce pilier dans le rapport.',
  }));
}

function buildTextesPrets(facts) {
  const s = facts.site || {};
  const activity = s.activity || 'professionnel';
  const city = s.city || '';
  const host = s.host || '';
  const out = [];
  for (const p of facts.pages || []) {
    const title = p.title ?? '';
    const meta = p.meta ?? '';
    const titleOk = title.length >= 30 && title.length <= 65;
    const metaOk = meta.length >= 120 && meta.length <= 165;
    if (titleOk && metaOk) continue;
    out.push({
      page: p.url,
      title: titleOk ? title : buildTitle(activity, city, host, p).slice(0, 65),
      meta: metaOk ? meta : buildMeta(activity, city, host).slice(0, 165),
      h1: p.h1 || `${activity}${city ? ` à ${city}` : ''}`,
      h2: ['Nos interventions', 'Nos zones d’intervention', 'Demander un devis gratuit'],
    });
  }
  return out;
}

function buildTitle(activity, city, host, page) {
  const base = `${activity}${city ? ` à ${city}` : ''}`;
  let title = `${base} — ${host}`;
  if (title.length > 65) title = base.slice(0, 62) + '…';
  if (title.length < 30) title = `${base} — ${host}`.slice(0, 65);
  return title;
}

function buildMeta(activity, city, host) {
  let m = `Besoin d'un ${activity}${city ? ` à ${city}` : ''} ? ${host} vous répond rapidement. Demandez votre devis gratuit en ligne.`;
  while (m.length < 120) m += ' Contactez-nous dès aujourd’hui.';
  return m.slice(0, 165);
}

/**
 * Offre 149 € : le plan doit couvrir 90 jours, soit douze semaines. Le modèle
 * renvoie souvent les quatre premières (copie de l'exemple du prompt) : on complète
 * avec les phases qui suivent logiquement, sans réinventer de constats.
 */
function completePlan90(plan, sortedFindings) {
  const weeks = Array.isArray(plan) ? [...plan] : [];
  if (weeks.length >= 8) return weeks;
  const titles = (sortedFindings || []).slice(0, 6).map((f) => f.code).join(', ');
  const extra = [
    { theme: "Contenu de fond : traiter les requêtes non couvertes", actions: [
      "Repérez dans la Search Console les requêtes où vous apparaissez sans page dédiée, et créez une page par intention.",
      "Enrichissez les deux pages les plus vues avec les questions réellement posées par vos clients.",
    ] },
    { theme: "Maillage interne et pages stratégiques", actions: [
      "Ajoutez un lien contextuel depuis chaque article vers la page de service correspondante.",
      "Vérifiez que chaque page importante est atteignable en deux clics depuis l'accueil.",
    ] },
    { theme: "Titres et descriptions des pages secondaires", actions: [
      "Reprenez les balises title des pages de blog : sujet explicite, marque en fin, 30 à 65 caractères.",
      "Rédigez une meta description unique par page, entre 120 et 165 caractères.",
    ] },
    { theme: "Autorité : premiers liens entrants", actions: [
      "Inscrivez l'activité dans deux annuaires professionnels de votre secteur, avec la même adresse et le même numéro.",
      "Proposez un article invité ou un témoignage à un site de votre métier qui accepte les contributions.",
    ] },
    { theme: "Vitesse et confort mobile", actions: [
      "Convertissez les images les plus lourdes en WebP et fixez leur largeur d'affichage réelle.",
      "Mesurez à nouveau le LCP mobile après conversion : l'objectif est sous 2,5 secondes.",
    ] },
    { theme: "Mesure : ce qui progresse et ce qui stagne", actions: [
      "Relevez mensuellement impressions, clics et position moyenne par page dans la Search Console.",
      "Comparez avec le relevé du mois précédent et gardez uniquement les actions qui ont produit un effet.",
    ] },
    { theme: "Conversion des pages qui reçoivent du trafic", actions: [
      "Vérifiez que chaque page visitée propose une action claire : appel, devis, commande.",
      "Testez un appel à l'action différent sur la page la plus consultée et comparez sur deux semaines.",
    ] },
    { theme: "Consolidation et audit de contrôle", actions: [
      "Relancez un audit pour mesurer l'écart avec le score initial.",
      "Corrigez les nouveaux constats apparus, puis figez les bons réflexes dans votre routine de publication.",
    ] },
  ];
  let w = weeks.length;
  for (const e of extra) {
    if (w >= 12) break;
    weeks.push({ semaine: w + 1, theme: e.theme, actions: [...e.actions] });
    w += 1;
  }
  return weeks;
}

function buildPlan30(sortedFindings) {
  const weeks = [
    { semaine: 1, theme: 'Lever les blocages et les points critiques', actions: [] },
    { semaine: 2, theme: 'Corriger les balises et les contenus des pages principales', actions: [] },
    { semaine: 3, theme: 'Performance et présence locale', actions: [] },
    { semaine: 4, theme: 'Suivi et mesure des résultats', actions: [] },
  ];
  const bucket = (f) => {
    const s = normalizeGravite(f.severity);
    if (s === 'bloquant' || s === 'critique') return 0;
    if (f.pillar === 'onpage' || f.pillar === 'contenu') return 1;
    if (f.pillar === 'performance' || f.pillar === 'local') return 2;
    return 3;
  };
  for (const f of sortedFindings) {
    const w = weeks[bucket(f)];
    if (w.actions.length < 5) {
      w.actions.push(`Corrigez le point ${f.code} : ${f.evidence || f.detail || ''}`.trim());
    }
  }
  // Complète les semaines trop vides avec du suivi factuel
  const defaults = [
    'Vérifiez dans Google Search Console que vos pages principales sont bien indexées.',
    'Vérifiez que chaque page importante possède un title et une meta uniques.',
    'Mesurez de nouveau la vitesse de vos pages après chaque correction.',
    'Relancez un audit pour mesurer la progression du score.',
  ];
  weeks.forEach((w, i) => {
    while (w.actions.length < 3) w.actions.push(defaults[i % defaults.length]);
  });
  return weeks;
}

function buildFallbackResume(facts, sorted, global) {
  const n = sorted.length;
  const top = sorted.slice(0, 3).map((f) => f.evidence || f.code);
  const host = facts.site?.host || '';
  return [
    `L'analyse automatisée de ${host} relève ${n} points à corriger, pour un score global de ${global ?? '—'}/100.`,
    `Les points les plus impactants concernent : ${top.join(' ; ')}.`,
    `Commencez par les points bloquants et critiques, puis traitez les balises et les contenus.`,
    `Les corrections se font dans votre interface d'administration, sans compétence technique particulière.`,
  ].join(' ');
}

function buildFallbackReport(facts, findings) {
  const sorted = sortFindingsBySeverity(findings);
  const global = facts.score?.global ?? null;
  return {
    verdict: `L'analyse automatisée de ${facts.site?.host || 'votre site'} relève ${sorted.length} points à corriger, pour un score global de ${global ?? '—'}/100 sur ${facts.site?.pages_crawled ?? (facts.pages || []).length ?? 0} pages examinées.`,
    resume_executif: buildFallbackResume(facts, sorted, global),
    points_forts: derivePointsForts(facts),
    piliers: buildPiliers(facts),
    constats: sorted.slice(0, 22).map((f) => findingToConstat(f, facts)),
    textes_prets: buildTextesPrets(facts),
    plan_30_jours: buildPlan30(sorted),
    a_verifier_dans_search_console: [
      'Google Search Console → Performance : vérifiez vos positions et vos requêtes réelles.',
      'Google Search Console → Indexation → Pages : vérifiez combien de pages sont indexées.',
      'Google Search Console → Liens : vérifiez les sites qui pointent vers le vôtre.',
    ],
    limites: "Cet audit mesure la technique, le contenu visible et la performance des pages. Il ne mesure pas les positions Google, les volumes de recherche ni les backlinks, qui ne sont pas accessibles sans vos comptes.",
  };
}

// ---------------------------------------------------------------------------
// Réparation ciblée après un second échec de régénération (bornes, doublons,
// nombres hallucinés). On ne livre jamais un rapport hors gabarit.
// ---------------------------------------------------------------------------
function truncateWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[ ,.…-]+$/, '');
}

function repairReport(report, ctx, fixes) {
  const fixText = (where, obj, required) => {
    if (!obj) return;
    if (obj.title != null && (obj.title !== '' || required)) {
      let t = obj.title || '';
      if (t.length > 65) { obj.title = truncateWord(t, 65); fixes.push(`${where}.title tronqué à ${obj.title.length} car.`); }
      else if (t.length < 30) { obj.title = (t + ` — ${ctx.hostSuffix}`).slice(0, 65); fixes.push(`${where}.title complété à ${obj.title.length} car.`); }
    }
    if (obj.meta != null && (obj.meta !== '' || required)) {
      let m = obj.meta || '';
      if (m.length > 165) { obj.meta = truncateWord(m, 165); fixes.push(`${where}.meta tronquée à ${obj.meta.length} car.`); }
      else if (m.length < 120) { obj.meta = (m + ` Contactez ${ctx.hostSuffix} pour un devis gratuit.`).slice(0, 165); fixes.push(`${where}.meta complétée à ${obj.meta.length} car.`); }
    }
    if (obj.h1 != null && obj.h1 !== '' && obj.h1.length > 70) {
      obj.h1 = truncateWord(obj.h1, 70); fixes.push(`${where}.h1 tronqué à ${obj.h1.length} car.`);
    }
  };

  (report.textes_prets || []).forEach((t, i) => fixText(`textes_prets[${i}]`, t, true));
  (report.constats || []).forEach((c, i) => {
    if (c.texte_a_coller) fixText(`constats[${i}].texte_a_coller`, c.texte_a_coller, false);
  });

  // Doublons de titles → suffixe unique
  const seen = new Set();
  for (const t of report.textes_prets || []) {
    if (!t.title) continue;
    if (seen.has(t.title)) {
      let suffix = 2;
      while (seen.has(`${t.title} (${suffix})`) && suffix < 99) suffix++;
      const newTitle = `${truncateWord(t.title, 58)} (${suffix})`;
      t.title = newTitle;
      fixes.push(`title dédupliqué : « ${newTitle} »`);
    }
    seen.add(t.title);
  }

  // Nombres hallucinés → suppression de la phrase
  removeHallucinated(report, ctx, fixes);

  return report;
}

function removeSentenceContaining(text, raw) {
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const kept = sentences.filter((s) => !s.includes(raw));
  return kept.join(' ');
}

function removeHallucinated(report, ctx, fixes) {
  const problems = numberIssues(report, ctx.facts, ctx.findings);
  for (const p of problems) {
    if (p.where === 'resume_executif') {
      report.resume_executif = removeSentenceContaining(report.resume_executif, p.raw);
      fixes.push(`phrase supprimée (nombre non sourcé « ${p.raw} ») dans resume_executif`);
    } else {
      const idx = p.where.match(/constat (\S+)/);
      if (idx) {
        const code = idx[1];
        const c = (report.constats || []).find((x) => x.code === code);
        if (c) {
          c.pourquoi = removeSentenceContaining(c.pourquoi, p.raw);
          if (!c.pourquoi.trim()) c.pourquoi = WHY_BY_SEVERITY[normalizeGravite(c.gravite)] || WHY_BY_SEVERITY.majeur;
          fixes.push(`phrase supprimée (nombre non sourcé « ${p.raw} ») dans constat ${code}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Finalisation : notes de piliers recopiées depuis facts.score, complétion
// déterministe si < 8 constats, plafond à 22.
// ---------------------------------------------------------------------------
function finalizeReport(report, facts, findings, fixes) {
  const byCode = new Map((report.piliers || []).map((p) => [p.code, p]));
  report.piliers = PILLAR_CODES.map((code) => {
    const existing = byCode.get(code);
    return {
      code,
      note: facts.score?.piliers?.[code] ?? null,
      commentaire: existing?.commentaire || 'Voir les constats de ce pilier dans le rapport.',
    };
  });

  for (const c of report.constats || []) c.gravite = normalizeGravite(c.gravite);

  if (!report.constats || report.constats.length < 8) {
    const before = (report.constats || []).length;
    const existing = new Set((report.constats || []).map((c) => `${c.code}|${c.page ?? ''}`));
    for (const f of sortFindingsBySeverity(findings)) {
      if ((report.constats || []).length >= 8) break;
      const key = `${f.code}|${f.page_url ?? f.page ?? ''}`;
      if (existing.has(key)) continue;
      report.constats = report.constats || [];
      report.constats.push(findingToConstat(f, facts));
      existing.add(key);
    }
    if (report.constats.length > before) {
      fixes.push(`${report.constats.length} constats après complétion déterministe (cible ≥ 8)`);
    }
  }
  if (report.constats && report.constats.length > 22) {
    report.constats = report.constats.slice(0, 22);
    fixes.push('constats plafonnés à 22');
  }

  if (!report.points_forts || !report.points_forts.length) report.points_forts = derivePointsForts(facts);
  if (!report.textes_prets) report.textes_prets = [];
  if (!report.plan_30_jours || !report.plan_30_jours.length) report.plan_30_jours = buildPlan30(sortFindingsBySeverity(findings));
  if (!report.a_verifier_dans_search_console || !report.a_verifier_dans_search_console.length) {
    report.a_verifier_dans_search_console = [
      'Google Search Console → Performance : vérifiez vos positions et vos requêtes réelles.',
      'Google Search Console → Indexation → Pages : vérifiez combien de pages sont indexées.',
      'Google Search Console → Liens : vérifiez les sites qui pointent vers le vôtre.',
    ];
  }
  if (!report.limites) {
    report.limites = "Cet audit mesure la technique, le contenu visible et la performance des pages. Il ne mesure pas les positions Google, les volumes de recherche ni les backlinks, qui ne sont pas accessibles sans vos comptes.";
  }
  return report;
}

// ---------------------------------------------------------------------------
// Étape « 2 pages rédigées » (offre 149 € uniquement) — docs/05 §3
// ---------------------------------------------------------------------------
function pickWeakestServicePage(pages) {
  const skip = /(mentions|legal|contact|tarif|devis|blog|actualit)/i;
  const candidates = (pages || []).filter((p) => p?.url && !skip.test(p.url));
  if (!candidates.length) return (pages || [])[0] || null;
  return candidates.slice().sort((a, b) => (a.words ?? 0) - (b.words ?? 0))[0];
}

function build149UserPrompt(facts, chosen) {
  const s = facts.site || {};
  const pagesInfo = chosen.map((p) => ({
    url: p?.url,
    title: p?.title ?? '',
    meta: p?.meta ?? '',
    h1: p?.h1 ?? '',
    h2: (p?.h2 || []).slice(0, 4),
    first_paragraph: String(p?.first_paragraph ?? '').slice(0, 400),
  }));
  return `SITE : ${s.host || ''} (${s.url || ''})
ACTIVITÉ DÉCLARÉE : ${s.activity || ''}
VILLE : ${s.city || ''}

PAGES À RÉDIGER (dans cet ordre : l'accueil, puis la page de service la plus faible) :
${JSON.stringify(pagesInfo, null, 2)}

Rédige le contenu complet des DEUX pages (title, meta, h1, chapo, h2 avec paragraphes, faq, cta).
Chaque paragraphe fait 40 à 90 mots. N'invente aucun prix, ancienneté, label, garantie ou témoignage :
si une information manque, écris [À COMPLÉTER PAR VOS SOINS : …].
Réponds uniquement avec le JSON valide, sans texte avant ni après, sans balise Markdown.`;
}

async function redigePages149(facts, model) {
  const sys = readPrompt('report149.fr.txt');
  const pages = facts.pages || [];
  const accueil = pages.find((p) => p.depth === 0) || pages[0];
  const others = pages.filter((p) => p !== accueil && p?.url !== accueil?.url);
  const service = pickWeakestServicePage(others);
  const chosen = [accueil, service].filter(Boolean);
  if (chosen.length < 1) return { pages: [], usage: { tokens_in: 0, tokens_out: 0 } };

  const resp = await callDeepSeek(
    [{ role: 'system', content: sys }, { role: 'user', content: build149UserPrompt(facts, chosen) }],
    model,
    20_000,
  );
  let data;
  try {
    data = parseJsonContent(resp.content);
  } catch {
    data = {};
  }
  const pages149 = Array.isArray(data?.pages) ? data.pages : [];
  return { pages: pages149, usage: resp.usage };
}

// ---------------------------------------------------------------------------
// analyze()
// ---------------------------------------------------------------------------
export async function analyze(facts, { offer, model, fallbackFindings } = {}) {
  const fixes = [];
  const effectiveModel = model || config.deepseekModelPaid || DEFAULT_MODEL;
  const findings = fallbackFindings || facts.findings || [];
  const crawledUrls = new Set();
  for (const p of facts.pages || []) {
    if (!p.url) continue;
    crawledUrls.add(p.url);
    try { crawledUrls.add(new URL(p.url).href.replace(/\/$/, '')); } catch { /* ignore */ }
  }
  if (facts.site?.url) {
    crawledUrls.add(facts.site.url);
    try { crawledUrls.add(new URL(facts.site.url).href.replace(/\/$/, '')); } catch { /* ignore */ }
  }
  const allowedCodes = new Set(facts.allowed_codes || []);
  if (!allowedCodes.size) findings.forEach((f) => allowedCodes.add(f.code));

  const ctx = {
    facts,
    findings,
    crawledUrls,
    allowedCodes,
    hostSuffix: facts.site?.host || facts.site?.url || '',
  };

  const mock = process.env.DEEPSEEK_MOCK === '1';
  const sysPrompt = readPrompt('report.fr.txt');

  const usage = { tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  const accumulate = (u) => {
    usage.tokens_in += u.tokens_in || 0;
    usage.tokens_out += u.tokens_out || 0;
    usage.cost_usd = costUsd(effectiveModel, usage.tokens_in, usage.tokens_out);
  };

  const generate = async (regenReasons) => {
    const user = buildUserPrompt(facts, offer, findings, regenReasons);
    if (mock) {
      return { content: mockContent(), usage: { tokens_in: 1000, tokens_out: 600 } };
    }
    return callDeepSeek(
      [{ role: 'system', content: sysPrompt }, { role: 'user', content: user }],
      effectiveModel,
      40_000,
    );
  };

  let report = null;
  let fallback = false;

  // Tentative 1
  let resp;
  try {
    resp = await generate([]);
  } catch (err) {
    // Échec réseau définitif : rendu déterministe, jamais de crash.
    fixes.push(`échec d'appel DeepSeek : ${err.message}`);
    report = buildFallbackReport(facts, findings);
    fallback = true;
    return { report, usage, fallback, fixes };
  }
  accumulate(resp.usage);

  let result = validateReport(resp.content, ctx);
  fixes.push(...result.fixes);

  if (process.env.DEEPSEEK_DEBUG === '1') {
    console.error(`[DEEPSEEK_DEBUG] tentative 1 finish_reason=${resp.finish_reason} tokens_out=${resp.usage.tokens_out}`);
    if (result.regenReasons.length) {
      console.error('[DEEPSEEK_DEBUG] regenReasons:', result.regenReasons.map((r) => r.message).join(' | '));
      console.error('[DEEPSEEK_DEBUG] raw head:', String(resp.content).slice(0, 600));
      console.error('[DEEPSEEK_DEBUG] raw tail:', String(resp.content).slice(-600));
    }
  }

  if (result.regenReasons.length) {
    const reasons = result.regenReasons.map((r) => r.message);
    fixes.push(`régénération demandée : ${reasons.join(' ; ')}`);

    let resp2;
    try {
      resp2 = await generate(reasons);
    } catch (err) {
      fixes.push(`échec de régénération : ${err.message}`);
      resp2 = null;
    }

    if (resp2) {
      accumulate(resp2.usage);
      const second = validateReport(resp2.content, ctx);
      fixes.push(...second.fixes);

      if (second.regenReasons.length) {
        const hard = second.regenReasons.some((r) => r.hard);
        if (hard || !second.report) {
          fallback = true;
          report = buildFallbackReport(facts, findings);
          fixes.push('second échec de validation → rapport déterministe (fallback)');
        } else {
          report = repairReport(second.report, ctx, fixes);
          fixes.push('second échec de forme → corrections automatiques appliquées');
        }
      } else {
        report = second.report;
      }
    } else {
      fallback = true;
      report = buildFallbackReport(facts, findings);
      fixes.push('régénération impossible → rapport déterministe (fallback)');
    }
  } else {
    report = result.report;
  }

  // Finalisation (notes de piliers recopiées, complétion ≥ 8 constats)
  finalizeReport(report, facts, findings, fixes);

  // Offre 149 € : plan étendu à 90 jours si le modèle s'est arrêté à 30.
  if (isPremium(offer)) {
    const before = (report.plan_30_jours || []).length;
    report.plan_30_jours = completePlan90(report.plan_30_jours, findings);
    if ((report.plan_30_jours || []).length > before) {
      fixes.push(`plan étendu à ${report.plan_30_jours.length} semaines (offre 149)`);
    }
  }

  // Étape « 2 pages rédigées » (offre 149 € uniquement, hors mock)
  if (isPremium(offer) && !mock) {
    try {
      const p149 = await redigePages149(facts, effectiveModel);
      accumulate(p149.usage);
      report.pages_redigees = p149.pages;
      fixes.push(`${p149.pages.length} page(s) rédigée(s) pour l'offre 149`);
    } catch (err) {
      fixes.push(`pages_149 indisponibles : ${err.message}`);
    }
  }

  return { report, usage, fallback, fixes };
}
