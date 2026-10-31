'use strict';

const { randomToken, hmac, safeEqual } = require('./crypto');

/**
 * CSRF-Schutz in zwei Schichten:
 * 1. Jede verändernde Anfrage braucht ein Token, das an ein zufälliges,
 *    HttpOnly-Cookie gebunden und mit dem Server-Geheimnis signiert ist.
 * 2. Kommt ein Origin-/Referer-Header mit, muss er zur eigenen Domain passen.
 */
function createCsrf(cfg) {
  const name = cfg.secureCookies ? '__Host-ds_csrf' : 'ds_csrf';
  const opts = { httpOnly: true, secure: cfg.secureCookies, sameSite: 'lax', path: '/' };
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

  function issue(req, res, next) {
    let seed = req.cookies[name];
    if (!seed || seed.length !== 43) {
      seed = randomToken(32);
      res.cookie(name, seed, opts);
    }
    req.csrfToken = hmac(cfg.secret, `csrf:${seed}`);
    res.locals.csrfToken = req.csrfToken;
    next();
  }

  function sameOrigin(req) {
    const origin = req.get('origin');
    if (origin) return origin === cfg.appOrigin;
    const referer = req.get('referer');
    if (referer) {
      try {
        return new URL(referer).origin === cfg.appOrigin;
      } catch {
        return false;
      }
    }
    return true; // ohne Header entscheidet allein das Token
  }

  function verify(req, res, next) {
    if (SAFE.has(req.method)) return next();
    // Datei-Uploads (nur Adminbereich) prüfen das Token selbst, nachdem multer das Formular gelesen hat.
    if (req.is('multipart/form-data') && req.originalUrl.startsWith('/admin/') && !req.csrfDeferredDone) {
      req.csrfDeferred = true;
      return next();
    }
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    const seed = req.cookies[name];
    const ok = seed && sent && sameOrigin(req) && safeEqual(hmac(cfg.secret, `csrf:${seed}`), sent);
    if (ok) return next();
    res.status(403);
    if (req.is('application/json')) return res.json({ error: 'Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu.' });
    return res.render('error.njk', {
      title: 'Sitzung abgelaufen',
      message: 'Die Sicherheitsprüfung ist fehlgeschlagen. Lade die Seite neu und versuche es noch einmal.',
    });
  }

  return { issue, verify };
}

module.exports = { createCsrf };
