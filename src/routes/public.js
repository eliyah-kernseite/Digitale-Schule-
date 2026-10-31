'use strict';

const express = require('express');
const v = require('../validate');
const { nowIso } = require('../db');

const FAQ = [
  ['Für wen ist die Schule?', 'Für Männer zwischen 18 und 40, die mehr aus ihrem Leben machen wollen: fitter, klarer im Kopf, finanziell unabhängiger, besser in Beziehungen. Du brauchst kein Vorwissen, nur die Bereitschaft, die Aufgaben wirklich zu machen.'],
  ['Was kostet das?', 'Die Registrierung ist kostenlos und ohne Zahlungsdaten. Danach siehst du im Mitgliederbereich alle Lehrgänge und die Preise, bevor du irgendetwas bezahlst. Die Mitgliedschaft ist monatlich kündbar.'],
  ['Wie viel Zeit brauche ich pro Woche?', 'Plane zwei bis drei Stunden pro Woche ein: ein Seminar ansehen, die Aufgabe erledigen, kurz mit den anderen austauschen. Du lernst in deinem Tempo.'],
  ['Warum kann ich Videos nicht vorspulen?', 'Weil Fortschritt durch Überspringen nicht entsteht. Jedes Seminar baut auf dem vorherigen auf. Stellen, die du schon gesehen hast, kannst du jederzeit wiederholen.'],
  ['Was ist der Telegram-Kreis?', 'Eine Gruppe und ein Kanal auf Telegram, nur für Mitglieder. Dort tauschst du dich mit anderen aus, postest deine Wochenziele und bekommst Zusatzinhalte der Lehrer. Du buchst ihn bei Bedarf zur Mitgliedschaft dazu.'],
  ['Wie und wann kann ich kündigen?', 'Jederzeit zum Ende des laufenden Abrechnungsmonats. Mit einem Klick in deinem Konto oder ohne Login über „Verträge hier kündigen“ unten auf jeder Seite.'],
  ['Versprecht ihr mir Erfolg?', 'Nein, und wer dir das verspricht, lügt. Wir geben dir Struktur, Wissen und Aufgaben. Umsetzen musst du selbst. Dein Zeugnis zeigt dir, was sich dadurch verändert.'],
];

module.exports = function publicRoutes(ctx) {
  const { cfg, db, learning, mailer, tokens, payments, limit, limiter, logger } = ctx;
  const router = express.Router();

  function homeData() {
    const subjects = learning.subjects();
    const main = subjects.find((s) => s.status === 'live') || subjects[0];
    const curriculum = main ? learning.curriculum(main.id) : [];
    const blocks = [];
    for (const s of curriculum) {
      let block = blocks.find((b) => b.title === s.block_title);
      if (!block) blocks.push((block = { title: s.block_title, seminars: [] }));
      block.seminars.push(s);
    }
    const reviews = db.all(
      `SELECT r.rating, r.comment, r.created_at, u.first_name,
              (SELECT COUNT(*) FROM submissions s WHERE s.user_id = r.user_id) AS done
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.seminar_id IS NULL AND r.status = 'approved' AND r.comment != ''
        ORDER BY r.created_at DESC LIMIT 6`,
    );
    const stats = db.get(`SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE seminar_id IS NULL AND status = 'approved'`);
    const withCounts = subjects.map((s) => ({ ...s, count: learning.curriculum(s.id).length }));
    return {
      subjects: withCounts, main, blocks, total: curriculum.length, reviews, reviewStats: stats,
      liveCount: subjects.filter((s) => s.status === 'live').length,
    };
  }

  router.get('/', (req, res) => {
    res.render('public/home.njk', { title: null, faq: FAQ, ...homeData() });
  });

  router.get('/faecher', (req, res) => {
    res.render('public/subjects.njk', { title: 'Lehrgänge', ...homeData() });
  });

  router.get('/faecher/:slug', (req, res, next) => {
    const slug = v.slug(req.params.slug);
    const subject = slug && learning.subjectBySlug(slug);
    if (!subject) return next();
    res.render('public/subject.njk', { title: subject.title, subject, curriculum: learning.curriculum(subject.id) });
  });

  router.get('/so-funktionierts', (req, res) => {
    res.render('public/how.njk', { title: 'So läuft’s', faq: FAQ });
  });

  router.get('/lehrplan', (req, res) => {
    res.render('public/curriculum.njk', { title: 'Lehrplan', ...homeData() });
  });

  router.get('/community', (req, res) => {
    res.render('public/community.njk', { title: 'Community' });
  });

  router.get('/beitraege', (req, res) => {
    const posts = db.all('SELECT slug, title, excerpt, published_at FROM posts WHERE published_at IS NOT NULL AND published_at <= ? ORDER BY published_at DESC LIMIT 50', nowIso());
    res.render('public/posts.njk', { title: 'Beiträge', posts });
  });

  router.get('/beitraege/:slug', (req, res, next) => {
    const slug = v.slug(req.params.slug);
    const post = slug && db.get('SELECT * FROM posts WHERE slug = ? AND published_at IS NOT NULL AND published_at <= ?', slug, nowIso());
    if (!post) return next();
    res.render('public/post.njk', { title: post.title, post });
  });

  /* ---------- Warteliste mit Double-Opt-in ---------- */

  router.post('/warteliste', limit('waitlist', 10, 3600_000), async (req, res) => {
    const email = v.email(req.body.email);
    const slug = v.slug(req.body.fach);
    const subject = slug && learning.subjectBySlug(slug);
    if (!email || !subject || !v.checkbox(req.body.consent)) {
      return res.status(422).render('public/waitlist.njk', { title: 'Warteliste', subject, error: 'Bitte gib eine gültige E-Mail-Adresse an und bestätige die Einwilligung.' });
    }
    if (limiter.hit('waitlist-mail', email, 3, 86400_000)) {
      const row = db.get('SELECT * FROM waitlist WHERE email = ? AND subject_slug = ?', email, subject.slug);
      if (!row) db.run('INSERT INTO waitlist (email, subject_slug, created_at) VALUES (?, ?, ?)', email, subject.slug, nowIso());
      if (!row || !row.confirmed_at) {
        const token = tokens.issue('waitlist', { ref: `${email}|${subject.slug}`, ttlMs: 7 * 86400_000 });
        await mailer.send({
          to: email,
          subject: `Warteliste ${subject.title}: bitte bestätigen`,
          text: `Hallo,\n\ndu möchtest benachrichtigt werden, sobald das Fach „${subject.title}“ startet. Bestätige das bitte mit diesem Link:\n\n${cfg.appUrl}/warteliste/bestaetigen/${token}\n\nOhne Bestätigung speichern wir deine Adresse nicht dauerhaft. Abmelden kannst du dich jederzeit mit einer kurzen Antwort auf unsere Mails.`,
        });
      }
    }
    res.render('public/waitlist.njk', { title: 'Warteliste', subject, sent: true });
  });

  router.get('/warteliste/bestaetigen/:token', (req, res) => {
    const row = tokens.consume('waitlist', req.params.token);
    if (!row) return res.redirect(303, '/?hinweis=link-ungueltig');
    const [email, slug] = String(row.ref).split('|');
    db.run('UPDATE waitlist SET confirmed_at = COALESCE(confirmed_at, ?) WHERE email = ? AND subject_slug = ?', nowIso(), email, slug);
    res.render('public/waitlist.njk', { title: 'Warteliste', subject: learning.subjectBySlug(slug), confirmed: true });
  });

  /* ---------- Kündigungsbutton (§ 312k BGB), ohne Login erreichbar ---------- */

  router.get('/kuendigen', (req, res) => {
    res.render('public/cancel.njk', {
      title: 'Verträge hier kündigen',
      form: { name: req.user ? req.user.firstName : '', email: req.user ? req.user.email : '', kind: 'ordentlich' },
    });
  });

  router.post('/kuendigen', limit('cancel', 10, 3600_000), async (req, res) => {
    const form = {
      name: v.str(req.body.name, 120),
      email: v.str(req.body.email, 254),
      kind: req.body.kind === 'ausserordentlich' ? 'ausserordentlich' : 'ordentlich',
      wished_date: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.wished_date || '')) ? req.body.wished_date : '',
      reason: v.str(req.body.reason, 2000),
    };
    const email = v.email(req.body.email);
    const errors = [];
    if (form.name.length < 2) errors.push('Bitte gib deinen Namen an.');
    if (!email) errors.push('Bitte gib die E-Mail-Adresse deines Kontos an.');
    if (form.kind === 'ausserordentlich' && form.reason.length < 5) errors.push('Für eine außerordentliche Kündigung gib bitte den Grund an.');
    if (errors.length) return res.status(422).render('public/cancel.njk', { title: 'Verträge hier kündigen', form, errors });

    const requestedAt = nowIso();
    let outcome = 'eingegangen';
    const user = db.get('SELECT id, first_name FROM users WHERE email = ?', email);
    if (user && limiter.hit('cancel-mail', email, 3, 86400_000)) {
      try {
        const done = await payments.setCancelAtPeriodEnd(user.id, true);
        outcome = done ? 'abo_zum_periodenende_gekuendigt' : 'kein_aktives_abo';
      } catch (err) {
        logger.error(`[kuendigung] ${err.message}`);
        outcome = 'manuelle_bearbeitung';
      }
    }
    db.run(
      'INSERT INTO cancellations (name, email, kind, wished_date, reason, user_id, outcome, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      form.name, email, form.kind, form.wished_date || null, form.reason, user ? user.id : null, outcome, requestedAt,
    );
    const sub = user ? learning.subscriptionOf(user.id) : null;
    const endText = sub && sub.current_period_end && outcome === 'abo_zum_periodenende_gekuendigt'
      ? `Dein Zugang bleibt bis ${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long' }).format(new Date(sub.current_period_end))} bestehen.`
      : 'Wir bearbeiten deine Kündigung und melden uns, falls wir Rückfragen haben.';
    const when = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short' }).format(new Date(requestedAt));
    await mailer.send({
      to: email,
      subject: 'Eingangsbestätigung deiner Kündigung',
      text: `Hallo ${form.name},\n\nwir haben deine Kündigung am ${when} Uhr erhalten.\n\nArt: ${form.kind === 'ordentlich' ? 'ordentliche Kündigung' : 'außerordentliche Kündigung'}\nZeitpunkt: ${form.wished_date || 'nächstmöglicher Zeitpunkt'}\n${form.reason ? `Grund: ${form.reason}\n` : ''}\n${endText}\n\nWarst du das nicht? Dann melde dich an und setze dein Abo unter „Konto & Abo“ mit einem Klick fort.`,
    });
    res.render('public/cancel-done.njk', { title: 'Kündigung eingegangen', form: { ...form, email }, when, endText });
  });

  /* ---------- Rechtliches ---------- */

  for (const [route, view, title] of [
    ['/impressum', 'legal/imprint.njk', 'Impressum'],
    ['/datenschutz', 'legal/privacy.njk', 'Datenschutz'],
    ['/agb', 'legal/terms.njk', 'AGB'],
    ['/widerruf', 'legal/withdrawal.njk', 'Widerrufsbelehrung'],
  ]) {
    router.get(route, (req, res) => res.render(view, { title }));
  }

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /app\nDisallow: /admin\nDisallow: /passwort-neu\nDisallow: /email-bestaetigen\n');
  });

  router.get('/healthz', (req, res) => {
    db.get('SELECT 1 AS ok');
    res.json({ ok: true });
  });

  return router;
};

module.exports.FAQ = FAQ;
