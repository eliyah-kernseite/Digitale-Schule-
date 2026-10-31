'use strict';

const express = require('express');
const v = require('../validate');
const { checkPasswordPolicy, hashPassword, verifyPassword, needsRehash } = require('../security/passwords');
const { verifyTotp } = require('../security/totp');
const { nowIso } = require('../db');

const LOCK_AFTER = 5;
const LOCK_BASE_MS = 15 * 60 * 1000;
const LOGIN_FAILED = 'Anmeldung fehlgeschlagen. Prüfe E-Mail und Passwort. Nach mehreren Fehlversuchen ist die Anmeldung für einige Minuten gesperrt.';

module.exports = function authRoutes(ctx) {
  const { cfg, db, sessions, tokens, mailer, limit, limiter } = ctx;
  const router = express.Router();
  let dummyHash = null;
  const getDummyHash = async () => (dummyHash ||= await hashPassword('dummy-password-for-timing', cfg.passwordCost));

  const H = 3600_000;

  async function sendVerification(user) {
    const token = tokens.issue('verify', { userId: user.id, ttlMs: 48 * H });
    await mailer.send({
      to: user.email,
      subject: 'Bestätige deine E-Mail',
      text: `Hallo ${user.first_name},\n\nschön, dass du dabei bist. Bestätige deine E-Mail-Adresse mit diesem Link (48 Stunden gültig):\n\n${cfg.appUrl}/email-bestaetigen/${token}\n\nWenn du dich nicht registriert hast, ignoriere diese Nachricht einfach.`,
    });
  }

  /* ---------- Registrierung ---------- */

  router.get('/registrieren', (req, res) => {
    if (req.user) return res.redirect(303, '/app');
    res.render('auth/register.njk', { title: 'Konto erstellen', form: {} });
  });

  router.post('/registrieren', limit('register', 8, H), async (req, res) => {
    const form = { first_name: v.str(req.body.first_name, 60), email: v.str(req.body.email, 254) };
    const email = v.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const errors = [];
    if (form.first_name.length < 2) errors.push('Bitte gib deinen Vornamen an.');
    if (!email) errors.push('Bitte gib eine gültige E-Mail-Adresse an.');
    const pwError = checkPasswordPolicy(password, { email: email || '', firstName: form.first_name });
    if (pwError) errors.push(pwError);
    if (password !== req.body.password2) errors.push('Die beiden Passwörter stimmen nicht überein.');
    if (!v.checkbox(req.body.consent)) errors.push('Bitte bestätige, dass du AGB und Datenschutzerklärung gelesen hast.');
    if (errors.length) return res.status(422).render('auth/register.njk', { title: 'Konto erstellen', form, errors });

    const existing = db.get('SELECT id, email, first_name FROM users WHERE email = ?', email);
    if (existing) {
      // Keine Auskunft darüber, ob ein Konto existiert. Stattdessen Hinweis-Mail an den Inhaber.
      await mailer.send({
        to: existing.email,
        subject: 'Du hast bereits ein Konto',
        text: `Hallo ${existing.first_name},\n\njemand (vermutlich du) wollte mit dieser E-Mail-Adresse ein neues Konto anlegen. Du hast aber schon eines.\n\nAnmelden: ${cfg.appUrl}/login\nPasswort vergessen: ${cfg.appUrl}/passwort-vergessen`,
      });
    } else {
      const hash = await hashPassword(password, cfg.passwordCost);
      const info = db.run('INSERT INTO users (email, password_hash, first_name, created_at) VALUES (?, ?, ?, ?)', email, hash, form.first_name, nowIso());
      db.audit(info.lastInsertRowid, 'user.register');
      await sendVerification({ id: info.lastInsertRowid, email, first_name: form.first_name });
    }
    res.render('auth/check-mail.njk', { title: 'Fast geschafft', email });
  });

  router.get('/email-bestaetigen/:token', (req, res) => {
    const row = tokens.consume('verify', req.params.token);
    if (!row) return res.redirect(303, '/login?hinweis=link-ungueltig');
    db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', nowIso(), row.user_id);
    db.audit(row.user_id, 'user.verified');
    res.redirect(303, '/login?hinweis=email-bestaetigt');
  });

  router.post('/bestaetigung-erneut', limit('resend', 5, H), async (req, res) => {
    const email = v.email(req.body.email);
    if (email && limiter.hit('resend-mail', email, 3, H)) {
      const user = db.get('SELECT id, email, first_name, email_verified_at FROM users WHERE email = ? AND disabled_at IS NULL', email);
      if (user && !user.email_verified_at) {
        tokens.revokeAll('verify', user.id);
        await sendVerification(user);
      }
    }
    res.render('auth/check-mail.njk', { title: 'Link verschickt', email: email || '' });
  });

  /* ---------- Login ---------- */

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, '/app');
    res.render('auth/login.njk', { title: 'Login', next: v.safeNext(req.query.next), form: {} });
  });

  router.post('/login', limit('login', 20, 15 * 60_000), async (req, res) => {
    const email = v.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
    const next = v.safeNext(req.body.next);
    const fail = (message = LOGIN_FAILED, extra = {}) => res.status(401).render('auth/login.njk', {
      title: 'Login', next, form: { email: v.str(req.body.email, 254) }, errors: [message], ...extra,
    });

    const user = email ? db.get('SELECT * FROM users WHERE email = ?', email) : null;
    if (!user) {
      await verifyPassword(password, await getDummyHash()); // gleiche Antwortzeit wie bei echtem Konto
      return fail();
    }
    if (user.locked_until && Date.parse(user.locked_until) > Date.now()) return fail();
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok || user.disabled_at) {
      if (!ok) {
        const failed = user.failed_logins + 1;
        const lockedUntil = failed >= LOCK_AFTER
          ? new Date(Date.now() + Math.min(LOCK_BASE_MS * 2 ** (failed - LOCK_AFTER), 24 * H)).toISOString()
          : null;
        db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', failed, lockedUntil, user.id);
        if (lockedUntil) db.audit(user.id, 'login.locked', `failed=${failed}`);
      }
      return fail();
    }
    if (!user.email_verified_at) {
      return fail('Bitte bestätige zuerst deine E-Mail-Adresse. Den Link findest du in deinem Postfach.', { showResend: true });
    }
    db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', user.id);
    if (needsRehash(user.password_hash, cfg.passwordCost)) {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password, cfg.passwordCost), user.id);
    }
    sessions.destroy(req, res); // Sitzungs-Fixierung verhindern
    if (user.totp_enabled) {
      sessions.create(res, user.id, { mfaPending: true, userAgent: req.get('user-agent') });
      return res.redirect(303, `/login/2fa?next=${encodeURIComponent(next)}`);
    }
    sessions.create(res, user.id, { userAgent: req.get('user-agent') });
    db.audit(user.id, 'login.ok');
    await warnNewDevice(req, res, user.id);
    res.redirect(303, next);
  });

  /** Warn-Mail, wenn sich das Konto von einem bisher unbekannten Gerät anmeldet. */
  async function warnNewDevice(req, res, userId) {
    if (!sessions.rememberDevice(req, res, userId)) return;
    const u = db.get('SELECT email, first_name FROM users WHERE id = ?', userId);
    const when = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    db.audit(userId, 'login.new_device', String(req.get('user-agent') || '').slice(0, 120));
    await mailer.send({
      to: u.email,
      subject: 'Neue Anmeldung in deinem Konto',
      text: `Hallo ${u.first_name},\n\nam ${when} Uhr hat sich jemand von einem neuen Gerät in dein Konto eingeloggt.\n\nGerät: ${v.str(req.get('user-agent'), 160) || 'unbekannt'}\nIP-Adresse: ${req.ip}\n\nWarst du das? Dann ist alles in Ordnung.\n\nWarst du das nicht? Ändere sofort dein Passwort unter ${cfg.appUrl}/app/konto. Dabei werden alle anderen Geräte abgemeldet. Noch sicherer ist die Zwei-Faktor-Anmeldung, die du dort einschalten kannst.`,
    });
  }

  router.get('/login/2fa', (req, res) => {
    if (!req.mfaPending) return res.redirect(303, '/login');
    res.render('auth/2fa.njk', { title: 'Bestätigungscode', next: v.safeNext(req.query.next) });
  });

  router.post('/login/2fa', limit('2fa-ip', 20, 15 * 60_000), async (req, res) => {
    if (!req.mfaPending) return res.redirect(303, '/login');
    const next = v.safeNext(req.body.next);
    const userId = req.pendingUserId;
    if (!limiter.hit('2fa-user', userId, 6, 15 * 60_000)) {
      sessions.destroy(req, res);
      db.audit(userId, 'login.2fa_blocked');
      return res.status(429).render('error.njk', { title: 'Zu viele Versuche', message: 'Zu viele falsche Codes. Melde dich in 15 Minuten erneut an.' });
    }
    const user = db.get('SELECT id, totp_secret, totp_last_step FROM users WHERE id = ?', userId);
    const code = v.str(req.body.code, 10).replace(/\s/g, '');
    const step = user && user.totp_secret ? verifyTotp(user.totp_secret, code, user.totp_last_step) : -1;
    if (step < 0) {
      return res.status(401).render('auth/2fa.njk', { title: 'Bestätigungscode', next, errors: ['Der Code stimmt nicht. Prüfe die Uhrzeit auf deinem Handy und versuche es erneut.'] });
    }
    db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id);
    limiter.reset('2fa-user', userId);
    sessions.destroy(req, res);
    sessions.create(res, user.id, { userAgent: req.get('user-agent') });
    db.audit(user.id, 'login.ok', '2fa');
    await warnNewDevice(req, res, user.id);
    res.redirect(303, next);
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(req, res);
    res.redirect(303, '/?hinweis=abgemeldet');
  });

  /* ---------- Passwort vergessen ---------- */

  router.get('/passwort-vergessen', (req, res) => {
    res.render('auth/forgot.njk', { title: 'Passwort vergessen' });
  });

  router.post('/passwort-vergessen', limit('forgot', 8, H), async (req, res) => {
    const email = v.email(req.body.email);
    if (email && limiter.hit('forgot-mail', email, 3, H)) {
      const user = db.get('SELECT id, email, first_name FROM users WHERE email = ? AND disabled_at IS NULL', email);
      if (user) {
        tokens.revokeAll('reset', user.id);
        const token = tokens.issue('reset', { userId: user.id, ttlMs: H });
        await mailer.send({
          to: user.email,
          subject: 'Neues Passwort festlegen',
          text: `Hallo ${user.first_name},\n\nüber diesen Link legst du ein neues Passwort fest (1 Stunde gültig, nur einmal nutzbar):\n\n${cfg.appUrl}/passwort-neu/${token}\n\nWenn du das nicht angefordert hast, ignoriere diese Nachricht. Dein Passwort bleibt dann unverändert.`,
        });
        db.audit(user.id, 'password.reset_requested');
      }
    }
    res.render('auth/forgot.njk', { title: 'Passwort vergessen', sent: true });
  });

  router.get('/passwort-neu/:token', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    if (!tokens.peek('reset', req.params.token)) return res.redirect(303, '/passwort-vergessen?hinweis=link-ungueltig');
    res.render('auth/reset.njk', { title: 'Neues Passwort', token: req.params.token });
  });

  router.post('/passwort-neu/:token', limit('reset', 10, H), async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    const row = tokens.peek('reset', req.params.token);
    if (!row) return res.redirect(303, '/passwort-vergessen?hinweis=link-ungueltig');
    const user = db.get('SELECT id, email, first_name FROM users WHERE id = ?', row.user_id);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    let error = checkPasswordPolicy(password, { email: user.email, firstName: user.first_name });
    if (!error && password !== req.body.password2) error = 'Die beiden Passwörter stimmen nicht überein.';
    if (error) return res.status(422).render('auth/reset.njk', { title: 'Neues Passwort', token: req.params.token, errors: [error] });
    if (!tokens.consume('reset', req.params.token)) return res.redirect(303, '/passwort-vergessen?hinweis=link-ungueltig');
    const hash = await hashPassword(password, cfg.passwordCost);
    db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', hash, nowIso(), user.id);
    sessions.destroyAllForUser(user.id);
    tokens.revokeAll('reset', user.id);
    db.audit(user.id, 'password.reset');
    await mailer.send({ to: user.email, subject: 'Dein Passwort wurde geändert', text: `Hallo ${user.first_name},\n\ndein Passwort wurde soeben geändert. Warst du das nicht? Dann setze es sofort über ${cfg.appUrl}/passwort-vergessen neu und schreib uns.` });
    res.redirect(303, '/login?hinweis=passwort-neu');
  });

  return router;
};
