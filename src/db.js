import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let dbInstance = null;

export function getDb(customPath = null) {
  if (dbInstance) return dbInstance;

  const dbPath = customPath || path.join(config.dataDir, 'scanseo.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  dbInstance = db;
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id             TEXT PRIMARY KEY,
      provider       TEXT NOT NULL DEFAULT 'polar',
      provider_ref   TEXT NOT NULL UNIQUE,
      product_id     TEXT NOT NULL,
      offer          TEXT NOT NULL,
      amount         INTEGER NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'eur',
      email          TEXT,
      site_url       TEXT,
      status         TEXT NOT NULL,
      raw_json       TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audits (
      id             TEXT PRIMARY KEY,
      order_id       TEXT REFERENCES orders(id),
      token          TEXT UNIQUE NOT NULL,
      url            TEXT NOT NULL,
      host           TEXT NOT NULL,
      offer          TEXT NOT NULL,
      lang           TEXT NOT NULL DEFAULT 'fr',
      activity       TEXT,
      city           TEXT,
      competitors    TEXT,
      status         TEXT NOT NULL,
      attempts       INTEGER NOT NULL DEFAULT 0,
      claimed_at     TEXT,
      started_at     TEXT,
      finished_at    TEXT,
      error          TEXT,
      pages_crawled  INTEGER,
      score          INTEGER,
      score_detail   TEXT,
      tokens_in      INTEGER,
      tokens_out     INTEGER,
      cost_usd       REAL,
      duration_ms    INTEGER,
      pdf_path       TEXT,
      needs_brief_at TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id       TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      url            TEXT NOT NULL,
      depth          INTEGER,
      http_status    INTEGER,
      final_url      TEXT,
      title          TEXT,
      meta_desc      TEXT,
      h1             TEXT,
      h1_count       INTEGER,
      word_count     INTEGER,
      canonical      TEXT,
      robots_meta    TEXT,
      jsonld_types   TEXT,
      ttfb_ms        INTEGER,
      bytes          INTEGER,
      internal_links INTEGER,
      images_total   INTEGER,
      images_no_alt  INTEGER,
      facts          TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id       TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      code           TEXT NOT NULL,
      pillar         TEXT NOT NULL,
      severity       TEXT NOT NULL,
      page_url       TEXT,
      evidence       TEXT,
      recommendation TEXT,
      fix_payload    TEXT,
      deterministic  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      provider       TEXT NOT NULL,
      webhook_id     TEXT NOT NULL UNIQUE,
      type           TEXT NOT NULL,
      payload        TEXT NOT NULL,
      status         TEXT NOT NULL,
      attempts       INTEGER NOT NULL DEFAULT 0,
      last_error     TEXT,
      received_at    TEXT NOT NULL,
      processed_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS emails (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id       TEXT REFERENCES audits(id),
      to_addr        TEXT NOT NULL,
      kind           TEXT NOT NULL,
      status         TEXT NOT NULL,
      attempts       INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      sent_at        TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teasers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      url            TEXT NOT NULL,
      host           TEXT NOT NULL,
      email          TEXT,
      ip_hash        TEXT NOT NULL,
      score          INTEGER,
      result_json    TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT UNIQUE NOT NULL,
      source         TEXT,
      consent_at     TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key            TEXT PRIMARY KEY,
      window_start   TEXT NOT NULL,
      count          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_kv (
      key            TEXT PRIMARY KEY,
      value          TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audits_status_created ON audits(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_findings_audit_pillar ON findings(audit_id, pillar);
    CREATE INDEX IF NOT EXISTS idx_events_webhook_id ON events(webhook_id);
    CREATE INDEX IF NOT EXISTS idx_teasers_host_created ON teasers(host, created_at);
  `);
}

export function setSystemKv(key, value) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_kv (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export function getSystemKv(key) {
  const db = getDb();
  const row = db.prepare('SELECT value, updated_at FROM system_kv WHERE key = ?').get(key);
  return row ? row.value : null;
}
