'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const express = require('express');
const multer = require('multer');
const v = require('../validate');
const { nowIso } = require('../db');
const { requireAdminWith } = require('./guards');
const { safeChapters } = require('../services/learning');

/** Erkennt MP4/WebM an den ersten Bytes statt am Dateinamen. */
function sniffVideo(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return { ext: 'mp4', mime: 'video/mp4' };
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return { ext: 'webm', mime: 'video/webm' };
  return null;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 20000 }, (err, stdout) => {
      const n = Number.parseFloat(String(stdout || '').trim());
      resolve(err || !Number.isFinite(n) ? 0 : Math.floor(n));
    });
  });
}

/** Kapitel im Format "mm:ss Titel" (eine Zeile pro Kapitel). */
function parseChapters(text) {
  const out = [];
  for (const line of String(text || '').split('\n').slice(0, 50)) {
    const m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s+(.{1,80})$/.exec(line.trim());
    if (!m) continue;
    out.push({ t: (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]), title: v.str(m[4], 80) });
  }
  return out.sort((a, b) => a.t - b.t);
}

function chaptersToText(json) {
  return safeChapters(json).map((c) => {
    const m = Math.floor(c.t / 60);
    return `${String(m).padStart(2, '0')}:${String(c.t % 60).padStart(2, '0')} ${c.title}`;
  }).join('\n');
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Schutz vor CSV-/Formel-Injection
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports = function adminRoutes(ctx) {
  const { cfg, db, csrf, learning, payments } = ctx;
  const router = express.Router();
  const UPLOAD_PATH = /^\/seminare\/\d+\/video$/;

  router.use(requireAdminWith(cfg));
  router.use((req, res, next) => {
    res.locals.adminNav = true;
    next();
  });
  router.use((req, res, next) => {
    // Multipart ohne CSRF-Prüfung nur an der Upload-Route zulassen.
    if (req.csrfDeferred && !(req.method === 'POST' && UPLOAD_PATH.test(req.path))) {
      return res.status(403).render('error.njk', { title: 'Nicht erlaubt', message: 'Diese Anfrage ist nicht erlaubt.' });
    }
    next();
  });

  fs.mkdirSync(cfg.videoDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: cfg.videoDir,
      filename: (req, file, cb) => cb(null, `upload-${crypto.randomBytes(16).toString('hex')}.tmp`),
    }),
    limits: { fileSize: cfg.maxVideoBytes, files: 1, fields: 5, fieldSize: 2048 },
    fileFilter: (req, file, cb) => cb(null, ['video/mp4', 'video/webm'].includes(file.mimetype)),
  });

  /* ---------- Übersicht ---------- */

  router.get('/', (req, res) => {
    const count = (sql) => db.get(sql).n;
    res.render('admin/index.njk', {
      title: 'Admin',
      stats: {
        users: count('SELECT COUNT(*) AS n FROM users'),
        active: count("SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active','trialing','past_due')"),
        cancelling: count("SELECT COUNT(*) AS n FROM subscriptions WHERE cancel_at_period_end = 1 AND status IN ('active','trialing','past_due')"),
        submissions: count('SELECT COUNT(*) AS n FROM submissions'),
        pendingReviews: count("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
        waitlist: count('SELECT COUNT(*) AS n FROM waitlist WHERE confirmed_at IS NOT NULL'),
        cancellations: count('SELECT COUNT(*) AS n FROM cancellations'),
      },
      latest: db.all(`SELECT sub.submitted_at, u.first_name, s.title FROM submissions sub JOIN users u ON u.id = sub.user_id
                      JOIN seminars s ON s.id = sub.seminar_id ORDER BY sub.submitted_at DESC LIMIT 8`),
      paymentMode: payments.isMock ? 'Testmodus (keine echten Zahlungen)' : 'Stripe (live)',
    });
  });

  /* ---------- Fächer ---------- */

  router.get('/faecher', (req, res) => {
    res.render('admin/subjects.njk', { title: 'Fächer', subjects: learning.subjects() });
  });

  router.post('/faecher/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    if (!id || !db.get('SELECT id FROM subjects WHERE id = ?', id)) return next('route');
    const f = {
      title: v.str(req.body.title, 80), tagline: v.str(req.body.tagline, 160), description: v.str(req.body.description, 2000),
      level_title: v.str(req.body.level_title, 80), teacher_name: v.str(req.body.teacher_name, 80), teacher_bio: v.str(req.body.teacher_bio, 1500),
      status: req.body.status === 'live' ? 'live' : 'soon',
    };
    if (f.title.length < 2) return res.redirect(303, '/admin/faecher');
    db.run(`UPDATE subjects SET title = ?, tagline = ?, description = ?, level_title = ?, teacher_name = ?, teacher_bio = ?, status = ? WHERE id = ?`,
      f.title, f.tagline, f.description, f.level_title, f.teacher_name, f.teacher_bio, f.status, id);
    db.audit(req.user.id, 'admin.subject.update', `id=${id} status=${f.status}`);
    res.redirect(303, '/admin/faecher?hinweis=gespeichert');
  });

  /* ---------- Seminare ---------- */

  router.get('/seminare', (req, res) => {
    const subjects = learning.subjects().map((s) => ({ ...s, seminars: learning.curriculum(s.id) }));
    res.render('admin/seminars.njk', { title: 'Seminare', subjects });
  });

  router.get('/seminare/neu', (req, res) => {
    const subjectId = v.id(req.query.fach) || learning.subjects()[0]?.id;
    const max = db.get('SELECT COALESCE(MAX(position), 0) AS m FROM seminars WHERE subject_id = ?', subjectId).m;
    res.render('admin/seminar-edit.njk', {
      title: 'Neues Seminar', subjects: learning.subjects(),
      seminar: { subject_id: subjectId, position: max + 1, task_type: 'text', chapters_text: '' },
    });
  });

  function readSeminarForm(body) {
    return {
      subject_id: v.id(body.subject_id),
      position: v.intIn(body.position, 1, 999),
      block_title: v.str(body.block_title, 60),
      title: v.str(body.title, 120),
      summary: v.str(body.summary, 500),
      task_type: body.task_type === 'check' ? 'check' : 'text',
      task_prompt: v.str(body.task_prompt, 1000),
      chapters: JSON.stringify(parseChapters(body.chapters)),
      video_duration: v.intIn(body.video_duration, 0, 6 * 3600) ?? 0,
      published: v.checkbox(body.published),
    };
  }

  router.post('/seminare', (req, res) => {
    const f = readSeminarForm(req.body);
    const subject = f.subject_id && db.get('SELECT id FROM subjects WHERE id = ?', f.subject_id);
    if (!subject || !f.position || f.title.length < 2 || f.task_prompt.length < 5) {
      return res.status(422).render('admin/seminar-edit.njk', {
        title: 'Neues Seminar', subjects: learning.subjects(), seminar: { ...f, chapters_text: chaptersToText(f.chapters) },
        errors: ['Bitte Fach, Position, Titel und Aufgabe ausfüllen.'],
      });
    }
    try {
      const info = db.run(`INSERT INTO seminars (subject_id, position, block_title, title, summary, task_type, task_prompt, chapters, video_duration, published)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      f.subject_id, f.position, f.block_title, f.title, f.summary, f.task_type, f.task_prompt, f.chapters, f.video_duration);
      db.audit(req.user.id, 'admin.seminar.create', `id=${info.lastInsertRowid}`);
      res.redirect(303, `/admin/seminare/${info.lastInsertRowid}?hinweis=gespeichert`);
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      res.status(422).render('admin/seminar-edit.njk', {
        title: 'Neues Seminar', subjects: learning.subjects(), seminar: { ...f, chapters_text: chaptersToText(f.chapters) },
        errors: ['Diese Position ist in dem Fach schon vergeben.'],
      });
    }
  });

  router.get('/seminare/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const seminar = id && db.get('SELECT * FROM seminars WHERE id = ?', id);
    if (!seminar) return next('route');
    const submissions = db.get('SELECT COUNT(*) AS n FROM submissions WHERE seminar_id = ?', id).n;
    const rating = db.get("SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE seminar_id = ? AND status != 'hidden'", id);
    res.render('admin/seminar-edit.njk', {
      title: seminar.title, subjects: learning.subjects(), seminar: { ...seminar, chapters_text: chaptersToText(seminar.chapters) }, submissions, rating,
    });
  });

  router.post('/seminare/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const existing = id && db.get('SELECT * FROM seminars WHERE id = ?', id);
    if (!existing) return next('route');
    const f = readSeminarForm(req.body);
    if (!f.position || f.title.length < 2 || f.task_prompt.length < 5) return res.redirect(303, `/admin/seminare/${id}`);
    const duration = f.video_duration || existing.video_duration;
    let published = f.published;
    let notice = 'gespeichert';
    if (published && (!existing.video_file || !duration)) {
      published = false;
      notice = 'veroeffentlichen-video';
    }
    try {
      db.run(`UPDATE seminars SET position = ?, block_title = ?, title = ?, summary = ?, task_type = ?, task_prompt = ?, chapters = ?,
              video_duration = ?, published = ? WHERE id = ?`,
      f.position, f.block_title, f.title, f.summary, f.task_type, f.task_prompt, f.chapters, duration, published ? 1 : 0, id);
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      notice = 'abo-fehler';
    }
    db.audit(req.user.id, 'admin.seminar.update', `id=${id} published=${published}`);
    res.redirect(303, `/admin/seminare/${id}?hinweis=${notice}`);
  });

  router.post('/seminare/:id/video', (req, res, next) => {
    // Temporäre Datei immer aufräumen, falls sie nicht übernommen wurde (z. B. CSRF-Fehler).
    res.on('finish', () => req.file && fs.rm(req.file.path, { force: true }, () => {}));
    next();
  }, upload.single('video'), (req, res, next) => {
    req.csrfDeferredDone = true;
    csrf.verify(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  }, async (req, res, next) => {
    const id = v.id(req.params.id);
    const seminar = id && db.get('SELECT * FROM seminars WHERE id = ?', id);
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    if (!seminar) {
      cleanup();
      return next('route');
    }
    if (!req.file) return res.redirect(303, `/admin/seminare/${id}?hinweis=video-fehler`);
    const kind = sniffVideo(req.file.path);
    if (!kind) {
      cleanup();
      return res.redirect(303, `/admin/seminare/${id}?hinweis=video-fehler`);
    }
    const name = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
    fs.renameSync(req.file.path, path.join(cfg.videoDir, name));
    const duration = (await probeDuration(path.join(cfg.videoDir, name))) || seminar.video_duration;
    if (seminar.video_file) fs.rm(path.join(cfg.videoDir, path.basename(seminar.video_file)), { force: true }, () => {});
    db.run('UPDATE seminars SET video_file = ?, video_mime = ?, video_duration = ? WHERE id = ?', name, kind.mime, duration, id);
    db.audit(req.user.id, 'admin.seminar.video', `id=${id}`);
    res.redirect(303, `/admin/seminare/${id}?hinweis=video-hochgeladen`);
  });

  router.post('/seminare/:id/loeschen', (req, res, next) => {
    const id = v.id(req.params.id);
    const seminar = id && db.get('SELECT * FROM seminars WHERE id = ?', id);
    if (!seminar) return next('route');
    if (v.str(req.body.confirm, 20) !== 'LÖSCHEN') return res.redirect(303, `/admin/seminare/${id}`);
    db.run('DELETE FROM seminars WHERE id = ?', id);
    if (seminar.video_file) fs.rm(path.join(cfg.videoDir, path.basename(seminar.video_file)), { force: true }, () => {});
    db.audit(req.user.id, 'admin.seminar.delete', `id=${id} title=${seminar.title}`);
    res.redirect(303, '/admin/seminare?hinweis=geloescht');
  });

  /* ---------- Aufgaben ---------- */

  router.get('/aufgaben', (req, res) => {
    const seminarId = v.id(req.query.seminar);
    const rows = db.all(
      `SELECT sub.*, u.first_name, u.email, s.title, s.position FROM submissions sub
         JOIN users u ON u.id = sub.user_id JOIN seminars s ON s.id = sub.seminar_id
        WHERE (? IS NULL OR sub.seminar_id = ?) ORDER BY sub.submitted_at DESC LIMIT 200`, seminarId, seminarId,
    );
    res.render('admin/submissions.njk', { title: 'Aufgaben', rows, seminars: db.all('SELECT id, title, position FROM seminars ORDER BY subject_id, position'), seminarId });
  });

  /* ---------- Mitglieder ---------- */

  router.get('/mitglieder', (req, res) => {
    const q = v.str(req.query.q, 100);
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = db.all(
      `SELECT u.id, u.email, u.first_name, u.role, u.created_at, u.disabled_at, u.email_verified_at, u.totp_enabled,
              s.status, s.current_period_end, s.cancel_at_period_end,
              (SELECT COUNT(*) FROM submissions x WHERE x.user_id = u.id) AS done
         FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
        WHERE (? = '' OR u.email LIKE ? ESCAPE '\\' OR u.first_name LIKE ? ESCAPE '\\')
        ORDER BY u.created_at DESC LIMIT 200`, q, like, like,
    );
    res.render('admin/members.njk', { title: 'Mitglieder', rows, q });
  });

  router.get('/mitglieder/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const member = id && db.get('SELECT * FROM users WHERE id = ?', id);
    if (!member) return next('route');
    res.render('admin/member.njk', {
      title: member.first_name,
      member,
      sub: learning.subscriptionOf(id),
      submissions: db.all('SELECT sub.*, s.title FROM submissions sub JOIN seminars s ON s.id = sub.seminar_id WHERE sub.user_id = ? ORDER BY sub.submitted_at DESC', id),
      tests: learning.selfTests(id),
      streak: learning.streak(id),
      access: learning.hasAccess({ id: member.id, role: member.role, compAccessUntil: member.comp_access_until }),
    });
  });

  router.post('/mitglieder/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const member = id && db.get('SELECT * FROM users WHERE id = ?', id);
    if (!member) return next('route');
    const action = v.str(req.body.action, 30);
    const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n;
    if (action === 'disable' && member.id !== req.user.id) {
      db.run('UPDATE users SET disabled_at = ? WHERE id = ?', nowIso(), id);
      ctx.sessions.destroyAllForUser(id);
    } else if (action === 'enable') {
      db.run('UPDATE users SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?', id);
    } else if (action === 'make-admin') {
      db.run("UPDATE users SET role = 'admin' WHERE id = ?", id);
      ctx.sessions.destroyAllForUser(id);
    } else if (action === 'make-member' && member.id !== req.user.id && admins > 1) {
      db.run("UPDATE users SET role = 'member' WHERE id = ?", id);
      ctx.sessions.destroyAllForUser(id);
    } else if (action === 'comp') {
      const days = v.intIn(req.body.days, 0, 3650);
      if (days !== null) db.run('UPDATE users SET comp_access_until = ? WHERE id = ?', days ? new Date(Date.now() + days * 86400000).toISOString() : null, id);
    } else if (action === 'verify') {
      db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', nowIso(), id);
    } else if (action === 'reset-2fa' && member.id !== req.user.id) {
      db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', id);
      ctx.sessions.destroyAllForUser(id);
    } else {
      return res.redirect(303, `/admin/mitglieder/${id}`);
    }
    db.audit(req.user.id, `admin.member.${action}`, `id=${id}`);
    res.redirect(303, `/admin/mitglieder/${id}?hinweis=gespeichert`);
  });

  /* ---------- Bewertungen ---------- */

  router.get('/bewertungen', (req, res) => {
    const status = ['pending', 'approved', 'hidden'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = db.all(
      `SELECT r.*, u.first_name, u.email, s.title AS seminar_title FROM reviews r JOIN users u ON u.id = r.user_id
       LEFT JOIN seminars s ON s.id = r.seminar_id WHERE r.status = ? ORDER BY r.updated_at DESC LIMIT 200`, status,
    );
    const summary = db.all(
      `SELECT s.id, s.title, s.position, COUNT(r.id) AS n, ROUND(AVG(r.rating), 1) AS avg FROM seminars s
       LEFT JOIN reviews r ON r.seminar_id = s.id AND r.status != 'hidden' GROUP BY s.id HAVING n > 0 ORDER BY s.subject_id, s.position`,
    );
    res.render('admin/reviews.njk', { title: 'Bewertungen', rows, status, summary });
  });

  router.post('/bewertungen/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const status = ['approved', 'hidden', 'pending'].includes(req.body.status) ? req.body.status : null;
    if (!id || !status) return next('route');
    db.run('UPDATE reviews SET status = ? WHERE id = ?', status, id);
    db.audit(req.user.id, 'admin.review', `id=${id} status=${status}`);
    res.redirect(303, `/admin/bewertungen?hinweis=gespeichert&status=${encodeURIComponent(v.str(req.body.back, 20) || 'pending')}`);
  });

  /* ---------- Beiträge ---------- */

  router.get('/beitraege', (req, res) => {
    res.render('admin/posts.njk', { title: 'Beiträge', posts: db.all('SELECT * FROM posts ORDER BY created_at DESC') });
  });

  router.get('/beitraege/neu', (req, res) => res.render('admin/post-edit.njk', { title: 'Neuer Beitrag', post: {} }));

  router.get('/beitraege/:id', (req, res, next) => {
    const id = v.id(req.params.id);
    const post = id && db.get('SELECT * FROM posts WHERE id = ?', id);
    if (!post) return next('route');
    res.render('admin/post-edit.njk', { title: post.title, post });
  });

  router.post('/beitraege{/:id}', (req, res, next) => {
    const id = req.params.id ? v.id(req.params.id) : null;
    if (req.params.id && !id) return next('route');
    const f = { title: v.str(req.body.title, 160), excerpt: v.str(req.body.excerpt, 400), body: v.str(req.body.body, 20000), publish: v.checkbox(req.body.publish) };
    if (f.title.length < 3 || f.body.length < 20) {
      return res.status(422).render('admin/post-edit.njk', { title: 'Beitrag', post: { id, ...f }, errors: ['Titel und Text sind zu kurz.'] });
    }
    if (id) {
      const post = db.get('SELECT * FROM posts WHERE id = ?', id);
      if (!post) return next('route');
      db.run('UPDATE posts SET title = ?, excerpt = ?, body = ?, published_at = ? WHERE id = ?',
        f.title, f.excerpt, f.body, f.publish ? post.published_at || nowIso() : null, id);
    } else {
      let slug = v.slugify(f.title);
      if (db.get('SELECT id FROM posts WHERE slug = ?', slug)) slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
      db.run('INSERT INTO posts (slug, title, excerpt, body, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        slug, f.title, f.excerpt, f.body, f.publish ? nowIso() : null, nowIso());
    }
    db.audit(req.user.id, 'admin.post.save', f.title);
    res.redirect(303, '/admin/beitraege?hinweis=gespeichert');
  });

  router.post('/beitraege/:id/loeschen', (req, res, next) => {
    const id = v.id(req.params.id);
    if (!id) return next('route');
    db.run('DELETE FROM posts WHERE id = ?', id);
    db.audit(req.user.id, 'admin.post.delete', `id=${id}`);
    res.redirect(303, '/admin/beitraege?hinweis=geloescht');
  });

  /* ---------- Warteliste, Kündigungen, Protokoll ---------- */

  router.get('/warteliste', (req, res) => {
    const rows = db.all('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 1000');
    if (req.query.format === 'csv') {
      const lines = ['E-Mail;Fach;Bestätigt;Eingetragen'];
      for (const r of rows.filter((x) => x.confirmed_at)) lines.push([r.email, r.subject_slug, r.confirmed_at, r.created_at].map(csvCell).join(';'));
      res.set('Content-Disposition', 'attachment; filename="warteliste.csv"');
      return res.type('text/csv; charset=utf-8').send(`﻿${lines.join('\r\n')}`);
    }
    res.render('admin/waitlist.njk', { title: 'Warteliste', rows });
  });

  router.get('/kuendigungen', (req, res) => {
    res.render('admin/cancellations.njk', { title: 'Kündigungen', rows: db.all('SELECT * FROM cancellations ORDER BY requested_at DESC LIMIT 300') });
  });

  router.get('/protokoll', (req, res) => {
    res.render('admin/audit.njk', { title: 'Protokoll', rows: db.all('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300') });
  });

  return router;
};

module.exports.parseChapters = parseChapters;
module.exports.csvCell = csvCell;
