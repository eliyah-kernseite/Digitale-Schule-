'use strict';

const crypto = require('node:crypto');
const { nowIso } = require('../db');

const STRIPE_VERSION = '2024-06-20';
const SIGNATURE_TOLERANCE_S = 300;
const ACCESS = new Set(['active', 'trialing', 'past_due']);

function formEncode(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') formEncode(value, name, out);
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return out.join('&');
}

/** Prüft die Stripe-Signatur (HMAC-SHA256 über "Zeitstempel.Rohdaten"). */
function verifyStripeSignature(rawBody, header, secret, now = Date.now()) {
  if (!header || !secret || !Buffer.isBuffer(rawBody)) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = Number(v);
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return signatures.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

function createPayments({ db, cfg, logger = console, onAccessChange = () => {} }) {
  const p = cfg.payment;
  const isMock = p.provider === 'mock';
  // Telegram-Zusatz: im Testmodus immer, mit Stripe nur mit eigenem Preis.
  const telegramAddonPossible = isMock || Boolean(p.stripeTelegramPriceId);

  async function stripe(method, path, body) {
    const res = await fetch(`${p.stripeApiBase}/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${p.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_VERSION,
        ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      body: body ? formEncode(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Stripe ${method} ${path}: ${res.status} ${data.error?.message || ''}`.trim());
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function upsert(userId, fields) {
    const existing = db.get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
    const before = existing ? existing.status : null;
    const addonBefore = existing ? Boolean(existing.telegram_addon) : false;
    const row = { ...(existing || {}), ...fields, user_id: userId, updated_at: nowIso() };
    db.run(
      `INSERT INTO subscriptions (user_id, provider, customer_id, subscription_id, status, current_period_end, cancel_at_period_end, telegram_addon, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, customer_id = excluded.customer_id,
         subscription_id = excluded.subscription_id, status = excluded.status, current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end, telegram_addon = excluded.telegram_addon,
         started_at = COALESCE(subscriptions.started_at, excluded.started_at), updated_at = excluded.updated_at`,
      userId, row.provider || p.provider, row.customer_id || null, row.subscription_id || null, row.status || 'incomplete',
      row.current_period_end || null, row.cancel_at_period_end ? 1 : 0, row.telegram_addon ? 1 : 0, row.started_at || nowIso(), row.updated_at,
    );
    const addonChanged = addonBefore !== Boolean(row.telegram_addon);
    if (before !== row.status) db.audit(userId, 'subscription.status', `${before || '-'} -> ${row.status}`);
    if (addonChanged) db.audit(userId, 'subscription.telegram', row.telegram_addon ? 'an' : 'aus');
    if (before !== row.status || addonChanged) onAccessChange(userId);
  }

  function fromStripeSubscription(sub) {
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    return {
      provider: 'stripe',
      customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      subscription_id: sub.id,
      status: String(sub.status || 'incomplete'),
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      telegram_addon: Boolean(telegramItem(sub)),
    };
  }

  function telegramItem(sub) {
    if (!p.stripeTelegramPriceId) return null;
    return (sub.items?.data || []).find((item) => item.price?.id === p.stripeTelegramPriceId) || null;
  }

  /* ---------- Checkout ---------- */

  async function createCheckout(user, { telegram = false } = {}) {
    const withTelegram = telegram && telegramAddonPossible;
    if (isMock) return `${cfg.appUrl}/mitgliedschaft/testzahlung${withTelegram ? '?telegram=1' : ''}`;
    const existing = db.get('SELECT customer_id FROM subscriptions WHERE user_id = ?', user.id);
    let customerId = existing?.customer_id;
    if (!customerId) {
      const customer = await stripe('POST', '/customers', { email: user.email, name: user.firstName, metadata: { user_id: user.id } });
      customerId = customer.id;
      upsert(user.id, { provider: 'stripe', customer_id: customerId, status: 'incomplete' });
    }
    const session = await stripe('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(user.id),
      line_items: {
        0: { price: p.stripePriceId, quantity: 1 },
        ...(withTelegram ? { 1: { price: p.stripeTelegramPriceId, quantity: 1 } } : {}),
      },
      success_url: `${cfg.appUrl}/mitgliedschaft/danke`,
      cancel_url: `${cfg.appUrl}/app/freischalten?abgebrochen=1`,
      locale: 'de',
      allow_promotion_codes: 'true',
      billing_address_collection: 'required',
      subscription_data: { metadata: { user_id: user.id } },
    });
    return session.url;
  }

  /** Nur im Testmodus: schaltet ein 30-Tage-Abo frei, ohne echtes Geld. */
  function activateMock(userId, { telegram = false } = {}) {
    if (!isMock) throw new Error('Testzahlung ist nur im Testmodus erlaubt.');
    upsert(userId, {
      telegram_addon: Boolean(telegram),
      provider: 'mock',
      customer_id: `mock_cus_${userId}`,
      subscription_id: `mock_sub_${userId}`,
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancel_at_period_end: false,
    });
  }

  /* ---------- Kündigen / Fortsetzen ---------- */

  async function setCancelAtPeriodEnd(userId, cancel) {
    const sub = db.get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
    if (!sub || !sub.subscription_id || !['active', 'trialing', 'past_due'].includes(sub.status)) return false;
    if (sub.provider === 'stripe') {
      const updated = await stripe('POST', `/subscriptions/${encodeURIComponent(sub.subscription_id)}`, { cancel_at_period_end: cancel ? 'true' : 'false' });
      upsert(userId, fromStripeSubscription(updated));
    } else {
      upsert(userId, { cancel_at_period_end: cancel });
    }
    db.audit(userId, cancel ? 'subscription.cancel' : 'subscription.resume');
    return true;
  }

  /* ---------- Telegram-Zusatz ---------- */

  /** Bucht den Telegram-Kreis zum laufenden Abo dazu oder beendet ihn (anteilig verrechnet). */
  async function setTelegramAddon(userId, on) {
    const sub = db.get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
    if (!telegramAddonPossible || !sub || !sub.subscription_id || !ACCESS.has(sub.status)) return false;
    if (Boolean(sub.telegram_addon) === Boolean(on)) return true;
    if (sub.provider === 'stripe') {
      const current = await stripe('GET', `/subscriptions/${encodeURIComponent(sub.subscription_id)}`);
      const item = telegramItem(current);
      if (on && !item) {
        await stripe('POST', '/subscription_items', { subscription: sub.subscription_id, price: p.stripeTelegramPriceId, quantity: 1, proration_behavior: 'create_prorations' });
      } else if (!on && item) {
        await stripe('DELETE', `/subscription_items/${encodeURIComponent(item.id)}?proration_behavior=create_prorations`);
      }
      upsert(userId, fromStripeSubscription(await stripe('GET', `/subscriptions/${encodeURIComponent(sub.subscription_id)}`)));
    } else {
      upsert(userId, { telegram_addon: Boolean(on) });
    }
    return true;
  }

  async function cancelImmediately(userId) {
    const sub = db.get('SELECT * FROM subscriptions WHERE user_id = ?', userId);
    if (!sub || !sub.subscription_id || sub.status === 'canceled') return;
    if (sub.provider === 'stripe') {
      await stripe('DELETE', `/subscriptions/${encodeURIComponent(sub.subscription_id)}`);
    }
    upsert(userId, { status: 'canceled', cancel_at_period_end: false });
  }

  async function portalUrl(userId) {
    if (isMock) return null;
    const sub = db.get('SELECT customer_id FROM subscriptions WHERE user_id = ?', userId);
    if (!sub?.customer_id) return null;
    const session = await stripe('POST', '/billing_portal/sessions', { customer: sub.customer_id, return_url: `${cfg.appUrl}/app/konto` });
    return session.url;
  }

  /* ---------- Webhook ---------- */

  async function handleStripeEvent(rawBody, signature) {
    if (!verifyStripeSignature(rawBody, signature, p.stripeWebhookSecret)) return { status: 400, message: 'invalid signature' };
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, message: 'invalid json' };
    }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return { status: 400, message: 'invalid event' };

    // Idempotenz: jedes Ereignis nur einmal verarbeiten.
    const seen = db.get('SELECT id FROM webhook_events WHERE id = ?', event.id);
    if (seen) return { status: 200, message: 'duplicate' };

    const obj = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
      const userId = Number(obj.client_reference_id);
      const user = Number.isInteger(userId) ? db.get('SELECT id FROM users WHERE id = ?', userId) : null;
      if (user && obj.subscription) {
        const sub = await stripe('GET', `/subscriptions/${encodeURIComponent(obj.subscription)}`);
        upsert(user.id, fromStripeSubscription(sub));
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const fields = fromStripeSubscription(obj);
      const row = db.get('SELECT user_id FROM subscriptions WHERE subscription_id = ? OR (customer_id = ? AND customer_id IS NOT NULL)', fields.subscription_id, fields.customer_id || '');
      if (row) upsert(row.user_id, fields);
      else logger.warn(`[stripe] Abo ${fields.subscription_id} ohne bekannten Kunden`);
    }
    db.run('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)', event.id, nowIso());
    return { status: 200, message: 'ok' };
  }

  return { isMock, telegramAddonPossible, setTelegramAddon, createCheckout, activateMock, setCancelAtPeriodEnd, cancelImmediately, portalUrl, handleStripeEvent };
}

module.exports = { createPayments, verifyStripeSignature, formEncode };
