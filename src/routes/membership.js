'use strict';

const express = require('express');
const v = require('../validate');
const { requireAuth } = require('./guards');

module.exports = function membershipRoutes(ctx) {
  const { db, payments, learning, logger, limit } = ctx;
  const router = express.Router();

  router.get('/mitgliedschaft', (req, res) => {
    const sub = req.user ? learning.subscriptionOf(req.user.id) : null;
    res.render('public/membership.njk', {
      title: 'Mitgliedschaft',
      sub,
      aborted: req.query.abgebrochen === '1',
      subjects: learning.subjects(),
    });
  });

  router.post('/mitgliedschaft/checkout', requireAuth, limit('checkout', 10, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    if (!req.user.emailVerified) return res.redirect(303, '/mitgliedschaft?hinweis=bestaetigen-erst');
    if (learning.hasAccess(req.user)) return res.redirect(303, '/app');
    const errors = [];
    if (!v.checkbox(req.body.agb)) errors.push('Bitte bestätige die AGB und die Widerrufsbelehrung.');
    if (!v.checkbox(req.body.waiver)) errors.push('Bitte bestätige, dass der Zugang sofort beginnen soll.');
    if (errors.length) {
      return res.status(422).render('public/membership.njk', {
        title: 'Mitgliedschaft', errors, sub: learning.subscriptionOf(req.user.id), subjects: learning.subjects(),
      });
    }
    db.audit(req.user.id, 'checkout.start', 'Zustimmung AGB + sofortiger Beginn');
    try {
      const url = await payments.createCheckout(req.user);
      res.redirect(303, url);
    } catch (err) {
      logger.error(`[checkout] ${err.message}`);
      res.status(502).render('error.njk', { title: 'Zahlung gerade nicht möglich', message: 'Der Zahlungsanbieter ist gerade nicht erreichbar. Es wurde nichts berechnet. Bitte versuche es in ein paar Minuten erneut.' });
    }
  });

  // Testmodus: simuliert den Zahlungsanbieter. In Produktion nicht erreichbar.
  router.get('/mitgliedschaft/testzahlung', requireAuth, (req, res, next) => {
    if (!payments.isMock) return next();
    res.render('public/mock-checkout.njk', { title: 'Testzahlung' });
  });

  router.post('/mitgliedschaft/testzahlung', requireAuth, (req, res, next) => {
    if (!payments.isMock) return next();
    if (!req.user.emailVerified) return res.redirect(303, '/mitgliedschaft?hinweis=bestaetigen-erst');
    payments.activateMock(req.user.id);
    res.redirect(303, '/mitgliedschaft/danke');
  });

  router.get('/mitgliedschaft/danke', requireAuth, (req, res) => {
    res.render('public/thanks.njk', { title: 'Willkommen', active: learning.hasAccess(req.user) });
  });

  return router;
};
