import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EMBEDDED_DIR = path.join(__dirname, 'embedded_content');

const cache = new Map();
const TTL_MS = 5000;

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }
  const metaLines = match[1].split(/\r?\n/);
  const data = {};
  for (const line of metaLines) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      data[key] = val;
    }
  }
  return { data, content: match[2] };
}

export function getPageContent(slug) {
  const now = Date.now();
  const mountedPath = path.join(config.contentDir, 'pages', `${slug}.md`);
  const embeddedPath = path.join(EMBEDDED_DIR, 'pages', `${slug}.md`);

  let targetPath = null;
  let isMounted = false;

  try {
    if (fs.existsSync(mountedPath)) {
      targetPath = mountedPath;
      isMounted = true;
    } else if (fs.existsSync(embeddedPath)) {
      targetPath = embeddedPath;
    }
  } catch (err) {
    if (fs.existsSync(embeddedPath)) {
      targetPath = embeddedPath;
    }
  }

  if (!targetPath) {
    return null;
  }

  const cached = cache.get(slug);
  if (cached && cached.targetPath === targetPath && (now - cached.checkedAt < TTL_MS)) {
    return cached.result;
  }

  try {
    const stat = fs.statSync(targetPath);
    if (cached && cached.targetPath === targetPath && cached.mtimeMs === stat.mtimeMs) {
      cached.checkedAt = now;
      return cached.result;
    }

    const raw = fs.readFileSync(targetPath, 'utf8');
    const { data, content } = parseFrontmatter(raw);
    const html = marked.parse(content);

    const result = {
      title: data.title || '',
      description: data.description || '',
      html,
      rawContent: content,
      isMounted
    };

    cache.set(slug, {
      targetPath,
      mtimeMs: stat.mtimeMs,
      checkedAt: now,
      result
    });

    return result;
  } catch (err) {
    return null;
  }
}

export const ALLOWED_IMAGE_EXTS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.svg', '.ico']);

export function resolveImage(filename) {
  if (!filename) return null;

  // Anti path traversal: path.normalize and no absolute or parent hops
  const normalized = path.normalize(filename).replace(/^(\.\.[\/\\])+/, '');
  if (normalized.includes('..') || path.isAbsolute(filename)) {
    return { status: 400, error: 'invalid_path' };
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    return { status: 404, error: 'extension_not_allowed' };
  }

  const mountedImg = path.join(config.contentDir, 'images', normalized);
  const embeddedImg = path.join(EMBEDDED_DIR, 'images', normalized);

  try {
    if (fs.existsSync(mountedImg)) {
      const real = fs.realpathSync(mountedImg);
      const realBase = fs.realpathSync(path.join(config.contentDir, 'images'));
      if (real.startsWith(realBase)) {
        return { status: 200, filePath: real, ext };
      }
    }
  } catch (e) {}

  try {
    if (fs.existsSync(embeddedImg)) {
      const real = fs.realpathSync(embeddedImg);
      const realBase = fs.realpathSync(path.join(EMBEDDED_DIR, 'images'));
      if (real.startsWith(realBase)) {
        return { status: 200, filePath: real, ext };
      }
    }
  } catch (e) {}

  return { status: 404, error: 'not_found' };
}

export function checkContentHealth() {
  if (!fs.existsSync(config.contentDir)) {
    return true; // absence of mount is permitted and normal
  }
  try {
    fs.readdirSync(config.contentDir);
    return true;
  } catch (e) {
    return false;
  }
}
