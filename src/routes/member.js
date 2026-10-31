'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');
const v = require('../validate');
const { nowIso } = require('../db');
const { requireAuth, requireAccessWith } = require('./guards');
const { paywallData } = require('./paywall');
const { checkPasswordPolicy, hashPassword, verifyPassword } = require('../security/passwords');
const { generateSecret, verifyTotp, otpauthUri } = require('../security/totp');

const MOTIVATION = [
  'Kleine Schritte, jeden Tag. Das ist das ganze Geheimnis.',
  'Du musst heute nicht alles schaffen. Nur das Nächste.',
  'Disziplin ist, das zu tun, was du dir vorgenommen hast, auch wenn die Lust gerade fehlt.',
  'Wer misst, sieht Fortschritt. Wer Fortschritt sieht, bleibt dran.',
  'Der Mann, der du sein willst, fängt nicht morgen an.',
  'Ehrlich zu dir sein ist der härteste und wichtigste Teil.',
  'Konstanz schlägt Intensität.',
];

module.exports = function memberRoutes(ctx) {
  const { cfg, db, learning, payments, telegram, sessions, mailer, limit, logger } = ctx;
  const router = express.Router();
  const requireAccess = requireAccessWith(learning);

  router.use(requireAuth);

  const liveSubjects = () => learning.subjects().filter((s) => s.status === 'live');

  /* ---------- Übersicht ---------- */

  function renderPaywall(req, res) {
    res.render('member/paywall.njk', { title: 'Freischalten', aborted: req.query.abgebrochen === '1', ...paywallData(ctx, req.user) });
  }

  router.get('/', (req, res) => {
    if (!learning.hasAccess(req.user)) return renderPaywall(req, res);
    const day = Math.floor(Date.now() / 86400000);
    const courses = liveSubjects().map((s) => ({ subject: s, ...learning.courseSummary(req.user.id, s.id) }));
    // Weitermachen: der Lehrgang mit Fortschritt, der noch nicht fertig ist, sonst der erste.
    const current = courses.find((c) => c.done > 0 && !c.finished && c.next) || courses.find((c) => c.next) || courses[0] || null;
    let lastTask = null;
    if (current && current.lastDone && current.next) {
      const sub = db.get('SELECT content FROM submissions WHERE user_id = ? AND seminar_id = ?', req.user.id, current.lastDone.id);
      lastTask = sub ? { seminar: current.lastDone, content: sub.content } : null;
    }
    res.render('member/dashboard.njk', {
      title: 'Übersicht',
      quote: MOTIVATION[day % MOTIVATION.length],
      courses,
      current,
      lastTask,
      totalDone: courses.reduce((n, c) => n + c.done, 0),
      streak: learning.streak(req.user.id),
      tests: learning.selfTests(req.user.id),
      goal: learning.goal(req.user.id),
      hasTelegram: learning.hasTelegram(req.user),
    });
  });

  router.get('/freischalten', (req, res) => {
    if (learning.hasAccess(req.user)) return res.redirect(303, '/app');
    renderPaywall(req, res);
  });

  /* ---------- Lehrgänge und Seminare ---------- */

  router.get(['/lehrgaenge', '/seminare'], requireAccess, (req, res) => {
    const subjects = learning.subjects();
    const courses = subjects.filter((s) => s.status === 'live').map((s) => ({ subject: s, ...learning.courseSummary(req.user.id, s.id) }));
    res.render('member/courses.njk', { title: 'Lehrgänge', courses, soon: subjects.filter((s) => s.status === 'soon') });
  });

  router.get('/lehrgaenge/:slug', requireAccess, (req, res, next) => {
    const slug = v.slug(req.params.slug);
    const subject = slug && learning.subjectBySlug(slug);
    if (!subject || subject.status !== 'live') return next();
    const summary = learning.courseSummary(req.user.id, subject.id);
    const blocks = [];
    for (const item of summary.items) {
      let block = blocks.find((b) => b.title === item.block_title);
      if (!block) blocks.push((block = { title: item.block_title, items: [] }));
      block.items.push(item);
    }
    res.render('member/course.njk', { title: subject.title, subject, ...summary, blocks });
  });

  function loadSeminar(req, res, next) {
    const id = v.id(req.params.id);
    if (!id) return next('route');
    const result = learning.openSeminar(req.user, id);
    if (!result.seminar) {
      if (result.reason === 'locked') {
        if (req.method === 'GET' && !req.path.endsWith('/video')) return res.redirect(303, '/app/lehrgaenge?hinweis=gesperrt');
        return res.status(403).json({ error: 'Seminar gesperrt.' });
      }
      if (result.reason === 'no_access') return res.redirect(303, '/app?hinweis=kein-zugang');
      return next('route');
    }
    req.seminarResult = result;
    req.seminar = result.seminar;
    next();
  }

  router.get('/seminare/:id', requireAccess, loadSeminar, (req, res) => {
    const { seminar, next, prev, items } = req.seminarResult;
    const progress = db.get('SELECT watched_seconds, video_done_at FROM seminar_progress WHERE user_id = ? AND seminar_id = ?', req.user.id, seminar.id);
    const submission = db.get('SELECT * FROM submissions WHERE user_id = ? AND seminar_id = ?', req.user.id, seminar.id);
    const myReview = db.get('SELECT * FROM reviews WHERE user_id = ? AND seminar_id = ?', req.user.id, seminar.id);
    // Nur auf Seminarseiten mit Vimeo darf der Vimeo-Player eingebettet werden.
    if (seminar.vimeo_id) {
      const csp = String(res.getHeader('Content-Security-Policy') || '');
      res.setHeader('Content-Security-Policy', `${csp}; frame-src https://player.vimeo.com`);
    }
    res.render('member/seminar.njk', {
      title: `Seminar ${seminar.number} · ${seminar.title}`,
      seminar,
      next,
      prev,
      total: items ? items.length : 0,
      watched: progress ? Math.min(progress.watched_seconds, seminar.video_duration) : 0,
      videoDone: Boolean(progress && progress.video_done_at),
      submission,
      myReview,
      justDone: req.query.geschafft === '1',
    });
  });

  // Video nur für berechtigte Nutzer streamen (mit Range-Unterstützung).
  router.get('/seminare/:id/video', requireAccess, loadSeminar, (req, res, next) => {
    const s = req.seminar;
    if (!s.video_file || !/^[a-f0-9]{32}\.(mp4|webm)$/.test(s.video_file)) return next('route');
    const file = path.join(cfg.videoDir, s.video_file);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return next('route');
    }
    res.set({
      'Content-Type': s.video_mime || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
    if (range && (range[1] || range[2])) {
      let start;
      let end;
      if (range[1] === '') {
        start = Math.max(0, stat.size - Number(range[2]));
        end = stat.size - 1;
      } else {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.set('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.set('Content-Length', String(stat.size));
    return fs.createReadStream(file).pipe(res);
  });

  router.post('/seminare/:id/fortschritt', limit('beat', 40, 60_000, (req) => `u${req.user.id}`), requireAccess, loadSeminar, (req, res) => {
    const s = req.seminar;
    if (s.preview || !s.video_duration) return res.json({ watched: 0, duration: s.video_duration, videoDone: false });
    const position = Number(req.body && req.body.position);
    if (!Number.isFinite(position) || position < 0) return res.status(400).json({ error: 'Ungültige Position.' });
    res.json(learning.heartbeat(req.user.id, s, position));
  });

  router.post('/seminare/:id/aufgabe', requireAccess, loadSeminar, (req, res) => {
    const s = req.seminar;
    let content;
    if (s.task_type === 'check') {
      if (!v.checkbox(req.body.done)) return res.redirect(303, `/app/seminare/${s.id}?hinweis=aufgabe-leer#aufgabe`);
      content = 'Erledigt ✓' + (v.str(req.body.note, 2000) ? `\n\n${v.str(req.body.note, 2000)}` : '');
    } else {
      content = v.str(req.body.answer, 5000);
      if (content.length < 10) return res.redirect(303, `/app/seminare/${s.id}?hinweis=aufgabe-leer#aufgabe`);
    }
    const result = learning.submitTask(req.user, s.id, content);
    if (!result.ok) {
      const map = { video: 'video-zuerst', locked: 'gesperrt', already: 'gespeichert' };
      return res.redirect(303, `/app/seminare/${s.id}?hinweis=${map[result.reason] || 'gesperrt'}`);
    }
    db.audit(req.user.id, 'task.submit', `seminar=${s.id}`);
    res.redirect(303, `/app/seminare/${s.id}?geschafft=1#aufgabe`);
  });

  router.post('/seminare/:id/bewertung', requireAccess, loadSeminar, (req, res) => {
    const s = req.seminar;
    const done = db.get('SELECT 1 AS ok FROM submissions WHERE user_id = ? AND seminar_id = ?', req.user.id, s.id);
    const rating = v.intIn(req.body.rating, 1, 5);
    if (!done || !rating) return res.redirect(303, `/app/seminare/${s.id}#bewertung`);
    const comment = v.str(req.body.comment, 1000);
    const now = nowIso();
    db.run(`INSERT INTO reviews (user_id, seminar_id, rating, comment, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)
            ON CONFLICT(user_id, seminar_id) WHERE seminar_id IS NOT NULL
            DO UPDATE SET rating = excluded.rating, comment = excluded.comment, status = 'pending', updated_at = excluded.updated_at`,
    req.user.id, s.id, rating, comment, now, now);
    res.redirect(303, `/app/seminare/${s.id}?hinweis=bewertet#bewertung`);
  });

  /* ---------- Zeugnis ---------- */

  const DIMENSIONS = [
    ['clarity', 'Klarheit'], ['confidence', 'Selbstvertrauen'], ['discipline', 'Disziplin'], ['calm', 'Innere Ruhe'], ['goal_progress', 'Zielfortschritt'],
  ];

  router.get('/zeugnis', requireAccess, (req, res) => {
    const courses = liveSubjects().map((s) => ({ subject: s, ...learning.courseSummary(req.user.id, s.id) }));
    const totalDone = courses.reduce((n, c) => n + c.done, 0);
    const schoolReview = db.get('SELECT * FROM reviews WHERE user_id = ? AND seminar_id IS NULL', req.user.id);
    res.render('member/report.njk', {
      title: 'Mein Zeugnis',
      dimensions: DIMENSIONS,
      tests: learning.selfTests(req.user.id),
      goal: learning.goal(req.user.id),
      streak: learning.streak(req.user.id),
      courses,
      totalDone,
      canReview: totalDone >= 3,
      schoolReview,
    });
  });

  router.post('/zeugnis/selbsttest', requireAccess, (req, res) => {
    const week = Number(req.body.week) === 12 ? 12 : 0;
    const values = {};
    for (const [key] of DIMENSIONS) {
      values[key] = v.intIn(req.body[key], 1, 10);
      if (values[key] === null) return res.redirect(303, '/app/zeugnis#selbsttest');
    }
    learning.saveSelfTest(req.user.id, week, values);
    res.redirect(303, '/app/zeugnis?hinweis=selbsttest#selbsttest');
  });

  router.post('/zeugnis/ziel', requireAccess, (req, res) => {
    const text = v.str(req.body.goal, 500);
    if (text.length >= 5) learning.saveGoal(req.user.id, text);
    res.redirect(303, '/app/zeugnis?hinweis=ziel#ziel');
  });

  router.post('/zeugnis/routine', requireAccess, (req, res) => {
    learning.checkIn(req.user.id);
    res.redirect(303, `${v.safeNext(req.body.back, '/app/zeugnis')}${req.body.back ? '' : '?hinweis=routine'}`);
  });

  router.post('/zeugnis/bewertung', requireAccess, (req, res) => {
    const done = db.get('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?', req.user.id).n;
    const rating = v.intIn(req.body.rating, 1, 5);
    if (done < 3 || !rating) return res.redirect(303, '/app/zeugnis#bewertung');
    const comment = v.str(req.body.comment, 1000);
    const now = nowIso();
    db.run(`INSERT INTO reviews (user_id, seminar_id, rating, comment, status, created_at, updated_at) VALUES (?, NULL, ?, ?, 'pending', ?, ?)
            ON CONFLICT(user_id) WHERE seminar_id IS NULL
            DO UPDATE SET rating = excluded.rating, comment = excluded.comment, status = 'pending', updated_at = excluded.updated_at`,
    req.user.id, rating, comment, now, now);
    res.redirect(303, '/app/zeugnis?hinweis=bewertet#bewertung');
  });

  /* ---------- Community ---------- */

  function renderCommunity(req, res, extra = {}) {
    const sub = learning.subscriptionOf(req.user.id);
    res.status(extra.status || 200).render('member/community.njk', {
      title: 'Community',
      enabled: telegram.enabled,
      hasTelegram: learning.hasTelegram(req.user),
      // Zubuchen geht nur mit eigenem, laufendem Abo (nicht bei Team-Freischaltung).
      canBook: ctx.telegramAddon && Boolean(sub && sub.subscription_id && ['active', 'trialing', 'past_due'].includes(sub.status)),
      sub,
      ...extra,
    });
  }

  router.get('/community', requireAccess, (req, res) => renderCommunity(req, res));

  router.post('/community/telegram', requireAccess, limit('tg-addon', 10, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    if (!ctx.telegramAddon) return res.redirect(303, '/app/community');
    if (!v.checkbox(req.body.waiver)) return renderCommunity(req, res, { status: 422, bookError: 'Bitte bestätige, dass der Zugang sofort beginnen soll.' });
    try {
      const ok = await payments.setTelegramAddon(req.user.id, true);
      if (!ok) return renderCommunity(req, res, { status: 422, bookError: 'Den Telegram-Kreis kannst du zu einem laufenden Abo dazubuchen.' });
    } catch (err) {
      logger.error(`[telegram-zusatz] ${err.message}`);
      return renderCommunity(req, res, { status: 502, bookError: 'Das hat gerade nicht geklappt. Es wurde nichts berechnet. Versuch es gleich noch einmal.' });
    }
    res.redirect(303, '/app/community?hinweis=telegram-gebucht');
  });

  router.post('/community/einladung', requireAccess, limit('tg-invite', 5, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    if (!learning.hasTelegram(req.user)) return res.redirect(303, '/app/community');
    let links = [];
    let error = null;
    try {
      links = await telegram.inviteLinks(req.user.id);
    } catch (err) {
      logger.error(`[telegram] ${err.message}`);
      error = 'Die Einladung konnte gerade nicht erstellt werden. Versuch es gleich noch einmal.';
    }
    renderCommunity(req, res, { links, error });
  });

  /* ---------- Konto & Abo ---------- */

  async function renderAccount(req, res, extra = {}) {
    const sub = learning.subscriptionOf(req.user.id);
    const sessionsList = db.all('SELECT id_hash, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? AND mfa_pending = 0 ORDER BY last_seen_at DESC LIMIT 10', req.user.id)
      .map((s) => ({ ...s, current: s.id_hash === req.sessionId }));
    res.status(extra.status || 200).render('member/account.njk', {
      title: 'Konto & Abo', sub, access: learning.hasAccess(req.user), sessionsList, ...extra,
    });
  }

  router.get('/konto', (req, res) => renderAccount(req, res));

  router.post('/konto/name', (req, res) => {
    const name = v.str(req.body.first_name, 60);
    if (name.length >= 2) db.run('UPDATE users SET first_name = ? WHERE id = ?', name, req.user.id);
    res.redirect(303, '/app/konto?hinweis=name-gespeichert');
  });

  router.post('/konto/passwort', limit('pw-change', 10, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(current, user.password_hash))) return renderAccount(req, res, { status: 422, pwErrors: ['Dein aktuelles Passwort stimmt nicht.'] });
    let error = checkPasswordPolicy(password, { email: user.email, firstName: user.first_name });
    if (!error && password !== req.body.password2) error = 'Die beiden neuen Passwörter stimmen nicht überein.';
    if (error) return renderAccount(req, res, { status: 422, pwErrors: [error] });
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password, cfg.passwordCost), user.id);
    sessions.destroyAllForUser(user.id, req.sessionId);
    db.audit(user.id, 'password.change');
    await mailer.send({ to: user.email, subject: 'Dein Passwort wurde geändert', text: `Hallo ${user.first_name},\n\ndein Passwort wurde soeben in deinem Konto geändert. Warst du das nicht? Setze es sofort über ${cfg.appUrl}/passwort-vergessen neu.` });
    res.redirect(303, '/app/konto?hinweis=passwort-geaendert');
  });

  router.post('/konto/sitzungen-beenden', (req, res) => {
    sessions.destroyAllForUser(req.user.id, req.sessionId);
    db.audit(req.user.id, 'sessions.revoke_others');
    res.redirect(303, '/app/konto?hinweis=gespeichert#sicherheit');
  });

  // Zwei-Faktor-Anmeldung einrichten: Geheimnis erzeugen, per Code bestätigen.
  router.post('/konto/2fa/start', async (req, res) => {
    const user = db.get('SELECT totp_enabled FROM users WHERE id = ?', req.user.id);
    if (user.totp_enabled) return res.redirect(303, '/app/konto#sicherheit');
    const secret = generateSecret();
    db.run('UPDATE users SET totp_secret = ?, totp_last_step = 0 WHERE id = ?', secret, req.user.id);
    const uri = otpauthUri(secret, req.user.email, cfg.schoolName);
    const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#16130f', light: '#f3ede1' } });
    renderAccount(req, res, { totpSetup: { secret, qrDataUri: `data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}` } });
  });

  router.post('/konto/2fa/bestaetigen', limit('2fa-setup', 10, 900_000, (req) => `u${req.user.id}`), (req, res) => {
    const user = db.get('SELECT totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?', req.user.id);
    if (!user.totp_secret || user.totp_enabled) return res.redirect(303, '/app/konto#sicherheit');
    const step = verifyTotp(user.totp_secret, v.str(req.body.code, 10).replace(/\s/g, ''), user.totp_last_step);
    if (step < 0) return renderAccount(req, res, { status: 422, totpError: 'Der Code stimmt nicht. Starte die Einrichtung bitte erneut.' });
    db.run('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', step, req.user.id);
    sessions.destroyAllForUser(req.user.id, req.sessionId);
    db.audit(req.user.id, '2fa.enable');
    res.redirect(303, '/app/konto?hinweis=2fa-an#sicherheit');
  });

  router.post('/konto/2fa/aus', limit('2fa-off', 10, 900_000, (req) => `u${req.user.id}`), async (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const okPw = await verifyPassword(typeof req.body.password === 'string' ? req.body.password : '', user.password_hash);
    const step = user.totp_secret ? verifyTotp(user.totp_secret, v.str(req.body.code, 10).replace(/\s/g, ''), user.totp_last_step) : -1;
    if (!okPw || step < 0) return renderAccount(req, res, { status: 422, totpError: 'Passwort oder Code stimmen nicht.' });
    db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', user.id);
    db.audit(user.id, '2fa.disable');
    res.redirect(303, '/app/konto?hinweis=2fa-aus#sicherheit');
  });

  router.post('/konto/abo/kuendigen', async (req, res) => {
    try {
      const ok = await payments.setCancelAtPeriodEnd(req.user.id, true);
      res.redirect(303, `/app/konto?hinweis=${ok ? 'abo-gekuendigt' : 'abo-fehler'}#abo`);
    } catch (err) {
      logger.error(`[abo] ${err.message}`);
      res.redirect(303, '/app/konto?hinweis=abo-fehler#abo');
    }
  });

  router.post('/konto/abo/fortsetzen', async (req, res) => {
    try {
      const ok = await payments.setCancelAtPeriodEnd(req.user.id, false);
      res.redirect(303, `/app/konto?hinweis=${ok ? 'abo-fortgesetzt' : 'abo-fehler'}#abo`);
    } catch (err) {
      logger.error(`[abo] ${err.message}`);
      res.redirect(303, '/app/konto?hinweis=abo-fehler#abo');
    }
  });

  router.post('/konto/telegram/beenden', async (req, res) => {
    try {
      const ok = await payments.setTelegramAddon(req.user.id, false);
      res.redirect(303, `/app/konto?hinweis=${ok ? 'telegram-beendet' : 'abo-fehler'}#abo`);
    } catch (err) {
      logger.error(`[telegram-zusatz] ${err.message}`);
      res.redirect(303, '/app/konto?hinweis=abo-fehler#abo');
    }
  });

  router.post('/konto/abo/verwalten', async (req, res) => {
    try {
      const url = await payments.portalUrl(req.user.id);
      if (url) return res.redirect(303, url);
    } catch (err) {
      logger.error(`[abo] ${err.message}`);
    }
    res.redirect(303, '/app/konto?hinweis=abo-fehler#abo');
  });

  // DSGVO Art. 15/20: eigene Daten als JSON herunterladen.
  router.get('/konto/daten', limit('export', 10, 3600_000, (req) => `u${req.user.id}`), (req, res) => {
    const uid = req.user.id;
    const data = {
      exportiert_am: nowIso(),
      konto: db.get('SELECT email, first_name, role, email_verified_at, totp_enabled, created_at FROM users WHERE id = ?', uid),
      abo: db.get('SELECT provider, status, current_period_end, cancel_at_period_end, telegram_addon, started_at FROM subscriptions WHERE user_id = ?', uid) || null,
      aufgaben: db.all('SELECT s.title AS seminar, sub.content, sub.submitted_at FROM submissions sub JOIN seminars s ON s.id = sub.seminar_id WHERE sub.user_id = ?', uid),
      fortschritt: db.all('SELECT s.title AS seminar, p.watched_seconds, p.video_done_at FROM seminar_progress p JOIN seminars s ON s.id = p.seminar_id WHERE p.user_id = ?', uid),
      selbsttests: db.all('SELECT week, clarity, confidence, discipline, calm, goal_progress, created_at FROM self_tests WHERE user_id = ?', uid),
      ziel: db.get('SELECT text, updated_at FROM goals WHERE user_id = ?', uid) || null,
      routine: db.all('SELECT day FROM routine_checkins WHERE user_id = ? ORDER BY day', uid).map((r) => r.day),
      bewertungen: db.all('SELECT seminar_id, rating, comment, status, created_at FROM reviews WHERE user_id = ?', uid),
      geraete: db.all('SELECT user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? AND mfa_pending = 0', uid),
    };
    res.set('Content-Disposition', 'attachment; filename="meine-daten.json"');
    res.type('application/json').send(JSON.stringify(data, null, 2));
  });

  router.post('/konto/loeschen', limit('delete', 5, 3600_000, (req) => `u${req.user.id}`), async (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    const okPw = await verifyPassword(typeof req.body.password === 'string' ? req.body.password : '', user.password_hash);
    if (!okPw || v.str(req.body.confirm, 20).toUpperCase() !== 'LÖSCHEN') {
      return renderAccount(req, res, { status: 422, deleteError: 'Bitte gib dein Passwort ein und tippe LÖSCHEN zur Bestätigung.' });
    }
    if (user.role === 'admin' && db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n <= 1) {
      return renderAccount(req, res, { status: 422, deleteError: 'Du bist der letzte Admin. Lege zuerst einen weiteren Admin an.' });
    }
    try {
      await payments.cancelImmediately(user.id);
      await telegram.removeUser(user.id);
    } catch (err) {
      logger.error(`[loeschen] ${err.message}`);
      return renderAccount(req, res, { status: 502, deleteError: 'Dein Abo konnte gerade nicht beendet werden. Bitte versuche es später erneut.' });
    }
    db.audit(null, 'user.delete', `id=${user.id}`);
    db.run('DELETE FROM users WHERE id = ?', user.id);
    sessions.destroy(req, res);
    await mailer.send({ to: user.email, subject: 'Dein Konto wurde gelöscht', text: `Hallo ${user.first_name},\n\ndein Konto und deine Lerndaten wurden gelöscht. Rechnungsdaten bewahrt unser Zahlungsanbieter nach den gesetzlichen Fristen auf.\n\nAlles Gute für deinen Weg.` });
    res.redirect(303, '/?hinweis=konto-geloescht');
  });

  return router;
};
