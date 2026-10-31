'use strict';

const express = require('express');

module.exports = function webhookRoutes(ctx) {
  const { payments, telegram, logger, limit } = ctx;
  const router = express.Router();

  router.post('/stripe', limit('wh-stripe', 300, 60_000), express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
    if (payments.isMock) return res.status(404).end();
    try {
      const result = await payments.handleStripeEvent(req.body, req.get('stripe-signature'));
      res.status(result.status).json({ received: result.status === 200 });
    } catch (err) {
      logger.error(`[stripe] Webhook-Fehler: ${err.message}`);
      res.status(500).json({ received: false }); // Stripe versucht es später erneut
    }
  });

  router.post('/telegram', limit('wh-tg', 300, 60_000), express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const status = await telegram.handleUpdate(req.get('x-telegram-bot-api-secret-token'), req.body);
      res.status(status).end();
    } catch (err) {
      logger.error(`[telegram] Webhook-Fehler: ${err.message}`);
      res.status(200).end();
    }
  });

  return router;
};
