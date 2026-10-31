'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function nowIso() {
  return new Date().toISOString();
}

/** Ergänzt Spalten, die nach dem ersten Start dazugekommen sind. */
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(subscriptions)').all().map((c) => c.name);
  if (!columns.includes('telegram_addon')) db.exec('ALTER TABLE subscriptions ADD COLUMN telegram_addon INTEGER NOT NULL DEFAULT 0');
}

/**
 * Öffnet die SQLite-Datenbank, setzt sichere Pragmas und spielt das Schema ein.
 * Alle Abfragen im Projekt laufen über vorbereitete Statements mit Parametern,
 * nie über zusammengesetzte SQL-Strings.
 */
function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA secure_delete = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  return {
    raw: db,
    get: (sql, ...params) => stmt(sql).get(...params),
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    audit(userId, action, detail = '') {
      stmt('INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)')
        .run(userId ?? null, action, String(detail).slice(0, 500), nowIso());
    },
    close: () => db.close(),
  };
}

module.exports = { openDatabase, nowIso };
