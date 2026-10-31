'use strict';

const { randomToken, sha256 } = require('./crypto');

const IDLE_MS = 30 * 24 * 3600 * 1000; // angemeldet bleiben: 30 Tage, auch ohne Besuch dazwischen
const ABSOLUTE_MS = 30 * 24 * 3600 * 1000; // spätestens nach 30 Tagen neu anmelden
const MFA_MS = 10 * 60 * 1000; // 10 Minuten für die Eingabe des 2FA-Codes
const TOUCH_MS = 5 * 60 * 1000;

function cookieName(cfg) {
  return cfg.secureCookies ? '__Host-ds_sid' : 'ds_sid';
}

function cookieOptions(cfg, maxAge) {
  return { httpOnly: true, secure: cfg.secureCookies, sameSite: 'lax', path: '/', maxAge };
}

function createSessionStore(db, cfg) {
  function create(res, userId, { mfaPending = false, userAgent = '' } = {}) {
    const token = randomToken(32);
    const now = Date.now();
    const ttl = mfaPending ? MFA_MS : IDLE_MS;
    db.run(
      `INSERT INTO sessions (id_hash, user_id, mfa_pending, created_at, last_seen_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sha256(token), userId, mfaPending ? 1 : 0, new Date(now).toISOString(), new Date(now).toISOString(),
      new Date(now + ttl).toISOString(), String(userAgent).slice(0, 200),
    );
    res.cookie(cookieName(cfg), token, cookieOptions(cfg, ttl));
    return token;
  }

  function destroy(req, res) {
    if (req.sessionId) db.run('DELETE FROM sessions WHERE id_hash = ?', req.sessionId);
    res.clearCookie(cookieName(cfg), cookieOptions(cfg));
  }

  function destroyAllForUser(userId, exceptIdHash = null) {
    if (exceptIdHash) db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', userId, exceptIdHash);
    else db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  /** Middleware: lädt Sitzung und Nutzer, verlängert die Sitzung gleitend. */
  function middleware(req, res, next) {
    req.user = null;
    req.sessionId = null;
    req.mfaPending = false;
    const token = req.cookies[cookieName(cfg)];
    if (!token || token.length > 100) return next();
    const idHash = sha256(token);
    const row = db.get(
      `SELECT s.*, u.id AS uid, u.email, u.first_name, u.role, u.email_verified_at, u.disabled_at,
              u.totp_enabled, u.comp_access_until
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
      idHash,
    );
    const now = Date.now();
    if (!row || Date.parse(row.expires_at) <= now || Date.parse(row.created_at) + ABSOLUTE_MS <= now || row.disabled_at) {
      if (row) db.run('DELETE FROM sessions WHERE id_hash = ?', idHash);
      res.clearCookie(cookieName(cfg), cookieOptions(cfg));
      return next();
    }
    req.sessionId = idHash;
    if (row.mfa_pending) {
      req.mfaPending = true;
      req.pendingUserId = row.uid;
      return next();
    }
    req.user = {
      id: row.uid,
      email: row.email,
      firstName: row.first_name,
      role: row.role,
      isAdmin: row.role === 'admin',
      emailVerified: Boolean(row.email_verified_at),
      totpEnabled: Boolean(row.totp_enabled),
      compAccessUntil: row.comp_access_until,
    };
    if (now - Date.parse(row.last_seen_at) > TOUCH_MS) {
      db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?',
        new Date(now).toISOString(), new Date(now + IDLE_MS).toISOString(), idHash);
      res.cookie(cookieName(cfg), token, cookieOptions(cfg, IDLE_MS));
    }
    return next();
  }

  function sweep() {
    db.run('DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
  }

  return { create, destroy, destroyAllForUser, middleware, sweep };
}

module.exports = { createSessionStore };
