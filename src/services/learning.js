'use strict';

const { nowIso } = require('../db');

const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
const GRACE_MS = 2 * 24 * 3600 * 1000; // Puffer, falls ein Webhook verspätet ankommt
const MAX_RATE = 1.25; // maximal 1,25-fache Echtzeit (Netzwerk-Schwankungen)
const SLACK_SECONDS = 2;
const BEAT_GAP_SECONDS = 90;
const END_TOLERANCE = 2;
const WEEK12_DAYS = 84;

function berlinDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function createLearning(db) {
  /* ---------- Zugang (Abo) ---------- */

  function subscriptionOf(userId) {
    return db.get('SELECT * FROM subscriptions WHERE user_id = ?', userId) || null;
  }

  function hasAccess(user) {
    if (!user) return false;
    if (user.isAdmin || user.role === 'admin') return true;
    const now = Date.now();
    const comp = user.compAccessUntil ?? user.comp_access_until;
    if (comp && Date.parse(comp) > now) return true;
    const sub = subscriptionOf(user.id);
    if (!sub || !ACCESS_STATUSES.has(sub.status)) return false;
    if (sub.current_period_end && Date.parse(sub.current_period_end) + GRACE_MS < now) return false;
    return true;
  }

  /** Telegram-Kreis: Zusatz zum Abo. Admins und vom Team Freigeschaltete haben ihn immer. */
  function hasTelegram(user) {
    if (!hasAccess(user)) return false;
    if (user.isAdmin || user.role === 'admin') return true;
    const comp = user.compAccessUntil ?? user.comp_access_until;
    if (comp && Date.parse(comp) > Date.now()) return true;
    const sub = subscriptionOf(user.id);
    return Boolean(sub && sub.telegram_addon);
  }

  /* ---------- Fächer und Seminare ---------- */

  function subjects() {
    return db.all('SELECT * FROM subjects ORDER BY sort, id');
  }

  function subjectBySlug(slug) {
    return db.get('SELECT * FROM subjects WHERE slug = ?', slug) || null;
  }

  function curriculum(subjectId) {
    return db.all('SELECT * FROM seminars WHERE subject_id = ? ORDER BY position', subjectId);
  }

  /**
   * Liefert alle veröffentlichten Seminare eines Fachs mit Status für den Nutzer:
   * done (Aufgabe abgegeben), open (freigeschaltet), locked (gesperrt).
   * Die Reihenfolge ist zwingend: Seminar n öffnet erst nach Abgabe von n-1.
   */
  function course(userId, subjectId) {
    const rows = db.all(
      `SELECT s.*, p.watched_seconds, p.video_done_at, sub.submitted_at,
              (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.seminar_id = s.id AND r.status != 'hidden') AS avg_rating,
              (SELECT r.rating FROM reviews r WHERE r.seminar_id = s.id AND r.user_id = ?) AS my_rating
         FROM seminars s
         LEFT JOIN seminar_progress p ON p.seminar_id = s.id AND p.user_id = ?
         LEFT JOIN submissions sub ON sub.seminar_id = s.id AND sub.user_id = ?
        WHERE s.subject_id = ? AND s.published = 1
        ORDER BY s.position`,
      userId, userId, userId, subjectId,
    );
    let previousDone = true;
    let number = 0;
    return rows.map((row) => {
      number += 1;
      let state;
      if (row.submitted_at) state = 'done';
      else if (previousDone) state = 'open';
      else state = 'locked';
      previousDone = previousDone && Boolean(row.submitted_at);
      const watched = Math.min(row.watched_seconds || 0, row.video_duration);
      return {
        ...row,
        number,
        state,
        chapters: safeChapters(row.chapters),
        watchedPercent: row.video_duration ? Math.round((watched / row.video_duration) * 100) : 0,
        videoDone: Boolean(row.video_done_at),
      };
    });
  }

  function courseSummary(userId, subjectId) {
    const items = course(userId, subjectId);
    const done = items.filter((s) => s.state === 'done').length;
    const next = items.find((s) => s.state === 'open') || null;
    const lastDone = [...items].reverse().find((s) => s.state === 'done') || null;
    return { items, done, total: items.length, next, lastDone, finished: items.length > 0 && done === items.length };
  }

  /** Lädt ein Seminar nur, wenn der Nutzer es öffnen darf. Gibt { seminar, reason } zurück. */
  function openSeminar(user, seminarId) {
    const seminar = db.get(
      `SELECT s.*, sub.slug AS subject_slug, sub.title AS subject_title, sub.status AS subject_status
         FROM seminars s JOIN subjects sub ON sub.id = s.subject_id WHERE s.id = ?`, seminarId,
    );
    if (!seminar || (!seminar.published && !user.isAdmin)) return { seminar: null, reason: 'not_found' };
    if (!hasAccess(user)) return { seminar: null, reason: 'no_access' };
    if (seminar.subject_status !== 'live' && !user.isAdmin) return { seminar: null, reason: 'not_found' };
    if (user.isAdmin && !seminar.published) {
      return { seminar: { ...seminar, number: seminar.position, state: 'open', chapters: safeChapters(seminar.chapters), preview: true }, reason: null };
    }
    const items = course(user.id, seminar.subject_id);
    const item = items.find((s) => s.id === seminar.id);
    if (!item) return { seminar: null, reason: 'not_found' };
    if (item.state === 'locked') return { seminar: null, reason: 'locked', items };
    const idx = items.indexOf(item);
    return {
      seminar: { ...seminar, ...item, subject_slug: seminar.subject_slug, subject_title: seminar.subject_title },
      next: items[idx + 1] || null,
      prev: items[idx - 1] || null,
      items,
      reason: null,
    };
  }

  /* ---------- Video-Fortschritt (serverseitig, nicht überspringbar) ---------- */

  /**
   * Verarbeitet einen Fortschritts-Herzschlag des Players. Der angerechnete Fortschritt
   * kann höchstens so schnell wachsen wie die echte Zeit seit dem letzten Herzschlag.
   * Wer im Browser vorspult oder Anfragen fälscht, bekommt dadurch keinen Vorsprung.
   */
  function heartbeat(userId, seminar, position, now = Date.now()) {
    const duration = seminar.video_duration;
    const pos = Math.max(0, Math.min(Number(position) || 0, duration));
    return db.tx(() => {
      let row = db.get('SELECT * FROM seminar_progress WHERE user_id = ? AND seminar_id = ?', userId, seminar.id);
      if (!row) {
        db.run('INSERT INTO seminar_progress (user_id, seminar_id, watched_seconds, last_beat_at) VALUES (?, ?, 0, 0)', userId, seminar.id);
        row = { watched_seconds: 0, last_beat_at: 0, video_done_at: null };
      }
      const elapsed = row.last_beat_at ? (now - row.last_beat_at) / 1000 : Infinity;
      const allowance = elapsed >= 0 && elapsed <= BEAT_GAP_SECONDS ? elapsed * MAX_RATE + SLACK_SECONDS : SLACK_SECONDS;
      let watched = row.watched_seconds;
      if (pos > watched) watched = Math.min(pos, watched + allowance);
      watched = Math.min(watched, duration);
      let doneAt = row.video_done_at;
      if (!doneAt && duration > 0 && watched >= duration - END_TOLERANCE) doneAt = nowIso();
      db.run('UPDATE seminar_progress SET watched_seconds = ?, last_beat_at = ?, video_done_at = ? WHERE user_id = ? AND seminar_id = ?',
        watched, now, doneAt, userId, seminar.id);
      return { watched, duration, videoDone: Boolean(doneAt) };
    });
  }

  /** Gibt die Aufgabe ab. Erst danach öffnet sich das nächste Seminar. */
  function submitTask(user, seminarId, content) {
    const { seminar, reason } = openSeminar(user, seminarId);
    if (!seminar) return { ok: false, reason };
    if (seminar.preview) return { ok: false, reason: 'preview' };
    if (seminar.state === 'done') return { ok: false, reason: 'already' };
    const progress = db.get('SELECT video_done_at FROM seminar_progress WHERE user_id = ? AND seminar_id = ?', user.id, seminar.id);
    if (!progress || !progress.video_done_at) return { ok: false, reason: 'video' };
    try {
      db.run('INSERT INTO submissions (user_id, seminar_id, content, submitted_at) VALUES (?, ?, ?, ?)', user.id, seminar.id, content, nowIso());
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'already' };
      throw err;
    }
    return { ok: true, seminar };
  }

  /* ---------- Zeugnis: Selbsttest, Ziel, Routine ---------- */

  function selfTests(userId) {
    const rows = db.all('SELECT * FROM self_tests WHERE user_id = ? ORDER BY week', userId);
    const week0 = rows.find((r) => r.week === 0) || null;
    const week12 = rows.find((r) => r.week === 12) || null;
    let week12OpensAt = null;
    if (week0) week12OpensAt = new Date(Date.parse(week0.created_at) + WEEK12_DAYS * 86400000).toISOString();
    return { week0, week12, week12OpensAt, week12Open: Boolean(week0 && !week12 && Date.parse(week12OpensAt) <= Date.now()) };
  }

  function saveSelfTest(userId, week, values) {
    const tests = selfTests(userId);
    if (week === 0 && tests.week0) return false;
    if (week === 12 && !tests.week12Open) return false;
    db.run(`INSERT INTO self_tests (user_id, week, clarity, confidence, discipline, calm, goal_progress, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, week, values.clarity, values.confidence, values.discipline, values.calm, values.goal_progress, nowIso());
    return true;
  }

  function goal(userId) {
    return db.get('SELECT * FROM goals WHERE user_id = ?', userId) || null;
  }

  function saveGoal(userId, text) {
    db.run(`INSERT INTO goals (user_id, text, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`, userId, text, nowIso());
  }

  function checkIn(userId, day = berlinDay()) {
    db.run('INSERT OR IGNORE INTO routine_checkins (user_id, day) VALUES (?, ?)', userId, day);
  }

  function streak(userId, today = berlinDay()) {
    const days = new Set(db.all('SELECT day FROM routine_checkins WHERE user_id = ? ORDER BY day DESC LIMIT 400', userId).map((r) => r.day));
    const checkedToday = days.has(today);
    let cursor = checkedToday ? today : shiftDay(today, -1);
    let current = 0;
    while (days.has(cursor)) {
      current += 1;
      cursor = shiftDay(cursor, -1);
    }
    // längste Serie
    const sorted = [...days].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const d of sorted) {
      run = prev && shiftDay(prev, 1) === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    const last14 = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = shiftDay(today, -i);
      last14.push({ day: d, done: days.has(d) });
    }
    return { current, best, checkedToday, last14 };
  }

  return {
    hasAccess, hasTelegram, subscriptionOf, subjects, subjectBySlug, curriculum, course, courseSummary, openSeminar,
    heartbeat, submitTask, selfTests, saveSelfTest, goal, saveGoal, checkIn, streak,
  };
}

function safeChapters(json) {
  try {
    const list = JSON.parse(json || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && Number.isFinite(c.t) && typeof c.title === 'string')
      .map((c) => ({ t: Math.max(0, Math.floor(c.t)), title: c.title.slice(0, 80) }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

module.exports = { createLearning, berlinDay, shiftDay, safeChapters, WEEK12_DAYS };
