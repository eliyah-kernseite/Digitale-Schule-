'use strict';

const express = require('express');
const v = require('../validate');
const { requireAuth } = require('./guards');
const { paywallData } = require('./paywall');

module.exports = function membershipRoutes(ctx) {
  const { db, payments, learning, logger, limit } = ctx;
  const router = express.Router();

  // Preise und Bestellung gibt es erst nach der kostenlosen Registrierung (im Mitgliederbereich).
  router.get('/mitgliedschaft', (req, res) => {
    if (!req.user) return res.redirect(303, '/registrieren');
    res.redirect(303, `/app/freischalten${req.query.abgebrochen === '1' ? '?abgebrochen=1' : ''}`);
  });

  router.post('/mitgliedschaft/checkout', requireAuth, limit('checkout', 10, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    if (!req.user.emailVerified) return res.redirect(303, '/mitgliedschaft?hinweis=bestaetigen-erst');
    if (learning.hasAccess(req.user)) return res.redirect(303, '/app');
    const errors = [];
    if (!v.checkbox(req.body.agb)) errors.push('Bitte bestätige die AGB und die Widerrufsbelehrung.');
    if (!v.checkbox(req.body.waiver)) errors.push('Bitte bestätige, dass der Zugang sofort beginnen soll.');
    const telegram = ctx.telegramAddon && v.checkbox(req.body.telegram);
    if (errors.length) {
      return res.status(422).render('member/paywall.njk', { title: 'Freischalten', errors, telegramChosen: telegram, ...paywallData(ctx, req.user) });
    }
    db.audit(req.user.id, 'checkout.start', `Zustimmung AGB + sofortiger Beginn${telegram ? ' + Telegram' : ''}`);
    try {
      const url = await payments.createCheckout(req.user, { telegram });
      res.redirect(303, url);
    } catch (err) {
      logger.error(`[checkout] ${err.message}`);
      res.status(502).render('error.njk', { title: 'Zahlung gerade nicht möglich', message: 'Der Zahlungsanbieter ist gerade nicht erreichbar. Es wurde nichts berechnet. Bitte versuche es in ein paar Minuten erneut.' });
    }
  });

  // Testmodus: simuliert den Zahlungsanbieter. In Produktion nicht erreichbar.
  router.get('/mitgliedschaft/testzahlung', requireAuth, (req, res, next) => {
    if (!payments.isMock) return next();
    res.render('public/mock-checkout.njk', { title: 'Testzahlung', telegram: ctx.telegramAddon && req.query.telegram === '1' });
  });

  router.post('/mitgliedschaft/testzahlung', requireAuth, (req, res, next) => {
    if (!payments.isMock) return next();
    if (!req.user.emailVerified) return res.redirect(303, '/mitgliedschaft?hinweis=bestaetigen-erst');
    payments.activateMock(req.user.id, { telegram: ctx.telegramAddon && req.body.telegram === '1' });
    res.redirect(303, '/mitgliedschaft/danke');
  });

  router.get('/mitgliedschaft/danke', requireAuth, (req, res) => {
    res.render('public/thanks.njk', { title: 'Willkommen', active: learning.hasAccess(req.user) });
  });

  return router;
};
