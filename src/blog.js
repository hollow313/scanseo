import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { config } from './config.js';

const EMBEDDED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'embedded_content');
const TTL_MS = 5000;
const cache = new Map();

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, content: m[2] };
}

function blogDirs() {
  return [path.join(config.contentDir, 'blog'), path.join(EMBEDDED_DIR, 'blog')];
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/** Liste des articles, du plus récent au plus ancien. Le dossier monté /content/blog prime. */
export function listPosts() {
  const seen = new Map();
  for (const dir of blogDirs()) {
    for (const file of readDir(dir)) {
      const slug = file.replace(/\.md$/, '');
      if (seen.has(slug)) continue;
      const post = readPostFile(path.join(dir, file), slug);
      if (post) seen.set(slug, post);
    }
  }
  return [...seen.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function readPostFile(file, slug) {
  const now = Date.now();
  const cached = cache.get(file);
  try {
    const stat = fs.statSync(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && now - cached.checkedAt < TTL_MS) return cached.post;
    const raw = fs.readFileSync(file, 'utf8');
    const { data, content } = parseFrontmatter(raw);
    const html = marked.parse(content);
    const post = {
      slug: data.slug || slug,
      title: data.title || slug,
      description: data.description || '',
      date: data.date || stat.mtime.toISOString().slice(0, 10),
      html,
      words: content.split(/\s+/).filter(Boolean).length,
    };
    cache.set(file, { mtimeMs: stat.mtimeMs, checkedAt: now, post });
    return post;
  } catch {
    return null;
  }
}

export function getPost(slug) {
  const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '');
  if (!safe) return null;
  for (const dir of blogDirs()) {
    const file = path.join(dir, `${safe}.md`);
    if (fs.existsSync(file)) return readPostFile(file, safe);
  }
  return null;
}

export function robotsTxt(baseUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /audit/',
    'Disallow: /api/',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(baseUrl, extraPaths = []) {
  const staticPaths = [
    '/', '/tarifs', '/faq', '/exemple', '/blog', '/mentions-legales', '/cgv', '/confidentialite',
    '/audit-seo-prix', '/site-invisible-google', '/audit-seo-wordpress', '/verificateur-balises',
  ];
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...staticPaths.map((p) => ({ loc: `${baseUrl}${p}`, lastmod: today, priority: p === '/' ? '1.0' : '0.8' })),
    ...listPosts().map((p) => ({ loc: `${baseUrl}/blog/${p.slug}`, lastmod: p.date, priority: '0.6' })),
    ...extraPaths.map((p) => ({ loc: `${baseUrl}${p}`, lastmod: today, priority: '0.5' })),
  ];
  const body = urls
    .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
