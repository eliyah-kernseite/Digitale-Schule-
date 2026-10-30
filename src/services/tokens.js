'use strict';

const { randomToken, sha256 } = require('../security/crypto');
const { nowIso } = require('../db');

/** Einmal-Tokens für E-Mail-Bestätigung, Passwort-Reset und Warteliste. Gespeichert wird nur der Hash. */
function createTokenService(db) {
  function issue(kind, { userId = null, ref = null, ttlMs }) {
    const token = randomToken(32);
    db.run('INSERT INTO tokens (id_hash, kind, user_id, ref, expires_at) VALUES (?, ?, ?, ?, ?)',
      sha256(token), kind, userId, ref, new Date(Date.now() + ttlMs).toISOString());
    return token;
  }

  /** Prüft ein Token, ohne es zu verbrauchen. */
  function peek(kind, token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = db.get('SELECT * FROM tokens WHERE id_hash = ? AND kind = ?', sha256(token), kind);
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  }

  /** Verbraucht ein Token atomar; ein zweiter Aufruf liefert null. */
  function consume(kind, token) {
    const row = peek(kind, token);
    if (!row) return null;
    const res = db.run('UPDATE tokens SET used_at = ? WHERE id_hash = ? AND used_at IS NULL', nowIso(), row.id_hash);
    return res.changes === 1 ? row : null;
  }

  function revokeAll(kind, userId) {
    db.run('UPDATE tokens SET used_at = ? WHERE kind = ? AND user_id = ? AND used_at IS NULL', nowIso(), kind, userId);
  }

  function sweep() {
    db.run('DELETE FROM tokens WHERE expires_at <= ?', new Date(Date.now() - 86400000).toISOString());
  }

  return { issue, peek, consume, revokeAll, sweep };
}

module.exports = { createTokenService };
