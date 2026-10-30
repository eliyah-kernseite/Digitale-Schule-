'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function bool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Liest die Konfiguration aus Umgebungsvariablen und prüft sie.
 * In Produktion bricht der Start bei unsicherer Konfiguration ab,
 * statt still mit schwachen Voreinstellungen zu laufen.
 */
function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));

  const cfg = {
    isProd,
    isTest,
    port: int(env.PORT, 3000),
    appUrl: (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    schoolName: env.SCHOOL_NAME || 'Fundament',
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'schule.db'),
    videoDir: env.VIDEO_DIR || path.join(dataDir, 'videos'),
    trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'false'),
    secret: env.SESSION_SECRET || '',
    passwordCost: int(env.PASSWORD_COST, isTest ? 1024 : 32768),
    requireAdmin2fa: bool(env.REQUIRE_ADMIN_2FA, true),
    priceLabel: env.PRICE_LABEL || '[Preis]',
    priceNote: env.PRICE_NOTE || 'pro Monat, monatlich kündbar',
    payment: {
      provider: env.PAYMENT_PROVIDER || (isProd ? 'stripe' : 'mock'),
      stripeSecretKey: env.STRIPE_SECRET_KEY || '',
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      stripePriceId: env.STRIPE_PRICE_ID || '',
      stripeApiBase: env.STRIPE_API_BASE || 'https://api.stripe.com',
    },
    mail: {
      smtpUrl: env.SMTP_URL || '',
      from: env.MAIL_FROM || 'Fundament <no-reply@localhost>',
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      groupId: env.TELEGRAM_GROUP_ID || '',
      channelId: env.TELEGRAM_CHANNEL_ID || '',
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
      apiBase: env.TELEGRAM_API_BASE || 'https://api.telegram.org',
    },
    maxVideoBytes: int(env.MAX_VIDEO_MB, 2048) * 1024 * 1024,
  };

  cfg.appOrigin = new URL(cfg.appUrl).origin;
  cfg.secureCookies = cfg.appUrl.startsWith('https://');

  const problems = [];
  if (isProd) {
    if (cfg.secret.length < 32) problems.push('SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
    if (!cfg.secureCookies) problems.push('APP_URL muss in Produktion mit https:// beginnen.');
    if (cfg.payment.provider !== 'stripe') problems.push('In Produktion ist nur PAYMENT_PROVIDER=stripe erlaubt.');
    if (!cfg.mail.smtpUrl) problems.push('SMTP_URL fehlt: ohne E-Mail-Versand funktionieren Registrierung und Passwort-Reset nicht.');
    if (!cfg.requireAdmin2fa) problems.push('REQUIRE_ADMIN_2FA darf in Produktion nicht abgeschaltet werden.');
  }
  if (cfg.payment.provider === 'stripe') {
    const p = cfg.payment;
    if (!p.stripeSecretKey || !p.stripeWebhookSecret || !p.stripePriceId) {
      problems.push('Für Stripe werden STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET und STRIPE_PRICE_ID benötigt.');
    }
  } else if (cfg.payment.provider !== 'mock') {
    problems.push(`Unbekannter PAYMENT_PROVIDER "${cfg.payment.provider}".`);
  }
  if (problems.length) {
    const err = new Error('Konfiguration unvollständig:\n - ' + problems.join('\n - '));
    err.code = 'CONFIG';
    throw err;
  }

  if (!cfg.secret) {
    // Nur Entwicklung/Test: dauerhaftes Zufallsgeheimnis im Datenordner.
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, '.dev-secret');
    if (fs.existsSync(file)) {
      cfg.secret = fs.readFileSync(file, 'utf8').trim();
    } else {
      cfg.secret = crypto.randomBytes(48).toString('hex');
      fs.writeFileSync(file, cfg.secret, { mode: 0o600 });
    }
  }
  return cfg;
}

module.exports = { loadConfig };
