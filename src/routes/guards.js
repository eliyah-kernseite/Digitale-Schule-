'use strict';

function requireAuth(req, res, next) {
  if (req.user) return next();
  const target = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(303, `/login${target}`);
}

function requireAccessWith(learning) {
  return (req, res, next) => {
    if (learning.hasAccess(req.user)) return next();
    if (req.is('application/json')) return res.status(403).json({ error: 'Keine aktive Mitgliedschaft.' });
    return res.redirect(303, '/app?hinweis=kein-zugang');
  };
}

function requireAdminWith(cfg) {
  return (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
      return res.status(404).render('error.njk', { title: 'Seite nicht gefunden', message: 'Diese Seite gibt es nicht.', code: 404 });
    }
    if (cfg.requireAdmin2fa && !req.user.totpEnabled) return res.redirect(303, '/app/konto?hinweis=2fa-admin#sicherheit');
    return next();
  };
}

module.exports = { requireAuth, requireAccessWith, requireAdminWith };
