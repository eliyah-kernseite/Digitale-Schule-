'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const nunjucks = require('nunjucks');

const { openDatabase } = require('./db');
const { seed } = require('./seed');
const { cookieMiddleware } = require('./security/cookies');
const { createSessionStore } = require('./security/sessions');
const { createCsrf } = require('./security/csrf');
const { RateLimiter, limit } = require('./security/rateLimit');
const { createMailer } = require('./services/mailer');
const { createTokenService } = require('./services/tokens');
const { createLearning } = require('./services/learning');
const { createPayments } = require('./services/payments');
const { createTelegram } = require('./services/telegram');
const filters = require('./viewFilters');
const notices = require('./notices');

function createApp(cfg, { logger = console, db: injectedDb } = {}) {
  const db = injectedDb || openDatabase(cfg.dbFile);
  seed(db);

  const limiter = new RateLimiter();
  const sessions = createSessionStore(db, cfg);
  const csrf = createCsrf(cfg);
  const mailer = createMailer(cfg, logger);
  const tokens = createTokenService(db);
  const learning = createLearning(db);

  const userById = (id) => db.get('SELECT id, role, comp_access_until FROM users WHERE id = ?', id);
  const hasTelegramById = (id) => {
    const u = userById(id);
    return u ? learning.hasTelegram({ id: u.id, role: u.role, compAccessUntil: u.comp_access_until }) : false;
  };
  const telegram = createTelegram({ db, cfg, logger, hasTelegramById });
  const payments = createPayments({ db, cfg, logger, onAccessChange: (id) => telegram.onAccessChange(id) });

  const ctx = { cfg, db, logger, limiter, limit: (...a) => limit(limiter, ...a), sessions, csrf, mailer, tokens, learning, payments, telegram };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy === 'false' ? false : /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);
  app.locals.ctx = ctx;

  /* ---------- Templates (Autoescape ist Pflicht gegen XSS) ---------- */
  const env = nunjucks.configure(path.join(__dirname, 'views'), {
    autoescape: true,
    express: app,
    noCache: !cfg.isProd,
    throwOnUndefined: false,
  });
  for (const [name, fn] of Object.entries(filters)) env.addFilter(name, fn);
  env.addGlobal('schoolName', cfg.schoolName);
  env.addGlobal('priceLabel', cfg.priceLabel);
  env.addGlobal('priceNote', cfg.priceNote);
  env.addGlobal('paymentMock', payments.isMock);
  env.addGlobal('telegramPriceLabel', cfg.telegramPriceLabel);
  // Den Zusatz nur anbieten, wenn er auch funktioniert (oder im Testmodus).
  ctx.telegramAddon = payments.telegramAddonPossible && (telegram.enabled || payments.isMock);
  env.addGlobal('telegramAddon', ctx.telegramAddon);
  env.addGlobal('assetVersion', String(Date.now()).slice(-6));
  app.set('view engine', 'njk');

  /* ---------- Sicherheits-Header ---------- */
  const formAction = ["'self'"];
  if (!payments.isMock) formAction.push('https://checkout.stripe.com', 'https://billing.stripe.com');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction,
        ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: cfg.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });

  /* ---------- Webhooks (vor CSRF, mit eigener Signaturprüfung) ---------- */
  app.use('/webhooks', require('./routes/webhooks')(ctx));

  /* ---------- Statische Dateien ---------- */
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    dotfiles: 'ignore',
    maxAge: cfg.isProd ? '7d' : 0,
    setHeaders(res, file) {
      if (file.endsWith('.woff2')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  /* ---------- Sitzung, Formulare, CSRF ---------- */
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.user = null;
    next();
  });
  app.use(limit(limiter, 'global', 600, 60_000));
  app.use(cookieMiddleware);
  app.use(sessions.middleware);
  app.use((req, res, next) => {
    res.locals.user = req.user;
    res.locals.hasAccess = req.user ? learning.hasAccess(req.user) : false;
    res.locals.notice = notices.lookup(req.query.hinweis);
    // Seiten mit persönlichen Daten nie in Zwischenspeichern ablegen.
    if (req.user || req.path.startsWith('/app') || req.path.startsWith('/admin')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(csrf.issue);
  app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
  app.use(express.json({ limit: '8kb' }));
  app.use(csrf.verify);


  app.use(require('./routes/public')(ctx));
  app.use(require('./routes/auth')(ctx));
  app.use(require('./routes/membership')(ctx));
  app.use('/app', require('./routes/member')(ctx));
  app.use('/admin', require('./routes/admin')(ctx));

  app.use((req, res) => {
    res.status(404).render('error.njk', { title: 'Seite nicht gefunden', message: 'Diese Seite gibt es nicht (mehr). Zurück zur Startseite?', code: 404 });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error(`[fehler] ${req.method} ${req.path}: ${err.stack || err.message}`);
    if (res.headersSent) return;
    const clientError = status >= 400 && status < 500;
    res.status(clientError ? status : 500);
    if (req.is('application/json') || req.path.endsWith('/fortschritt')) {
      return res.json({ error: clientError ? 'Ungültige Anfrage.' : 'Interner Fehler.' });
    }
    res.render('error.njk', {
      title: clientError ? 'Ungültige Anfrage' : 'Da ist etwas schiefgelaufen',
      message: clientError
        ? (err.expose && err.publicMessage) || 'Die Anfrage konnte nicht verarbeitet werden.'
        : 'Ein unerwarteter Fehler ist aufgetreten. Wir kümmern uns darum. Bitte versuche es später erneut.',
    });
  });

  function startJobs() {
    const run = () => {
      try {
        sessions.sweep();
        tokens.sweep();
      } catch (err) {
        logger.error(`[jobs] ${err.message}`);
      }
      telegram.sweep().catch((err) => logger.error(`[jobs] ${err.message}`));
    };
    run();
    const timer = setInterval(run, 3600_000);
    timer.unref();
    return () => clearInterval(timer);
  }

  function close() {
    limiter.stop();
    if (!injectedDb) db.close();
  }

  return { app, ctx, startJobs, close };
}

module.exports = { createApp };
