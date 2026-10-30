'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {} };

/** Startet eine frische App mit eigener Datenbank auf einem freien Port. */
async function startApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schule-test-'));
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    APP_URL: 'http://127.0.0.1',
    REQUIRE_ADMIN_2FA: 'true',
    ...env,
  });
  const instance = createApp(cfg, { logger: silent });
  const server = await new Promise((resolve) => {
    const s = instance.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Origin-Prüfung soll zur Test-URL passen
  cfg.appOrigin = base;
  cfg.appUrl = base;
  return {
    base,
    cfg,
    ctx: instance.ctx,
    db: instance.ctx.db,
    mailer: instance.ctx.mailer,
    async stop() {
      await new Promise((r) => server.close(r));
      instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimaler Browser: Cookies merken, CSRF-Token aus Formularen lesen. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, url, { form, json, headers = {}, raw } = {}) {
    const h = { cookie: this.cookieHeader(), ...headers };
    let body;
    if (form) {
      h['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (json) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (raw) {
      body = raw;
    }
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    const m = /name="_csrf" value="([^"]+)"/.exec(text) || /data-csrf="([^"]+)"/.exec(text);
    if (m) this.csrf = m[1];
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  get(url, opts) {
    return this.request('GET', url, opts);
  }

  async post(url, form = {}, opts = {}) {
    if (!this.csrf) await this.get('/login');
    return this.request('POST', url, { form: { _csrf: this.csrf, ...form }, ...opts });
  }
}

function lastMailLink(mailer, pattern) {
  for (let i = mailer.outbox.length - 1; i >= 0; i -= 1) {
    const m = pattern.exec(mailer.outbox[i].text);
    if (m) return m[0];
  }
  return null;
}

/** Registriert, bestätigt und loggt einen Nutzer ein. */
async function signup(t, { email = 'max@example.de', password = 'Sicheres-Passwort-42', name = 'Max' } = {}) {
  const c = new Client(t.base);
  await c.get('/registrieren');
  await c.post('/registrieren', { first_name: name, email, password, password2: password, consent: 'on' });
  const link = lastMailLink(t.mailer, /\/email-bestaetigen\/[\w-]+/);
  await c.get(link);
  await c.get('/login');
  const res = await c.post('/login', { email, password, next: '/app' });
  if (res.status !== 303) throw new Error(`Login fehlgeschlagen: ${res.status}`);
  return c;
}

/** Veröffentlicht die Seminare des ersten Fachs mit einer Platzhalter-Videodatei. */
function publishSeminars(t, duration = 30) {
  fs.mkdirSync(t.cfg.videoDir, { recursive: true });
  const name = 'a'.repeat(32) + '.mp4';
  const buf = Buffer.alloc(4096);
  buf.write('ftypisom', 4, 'latin1');
  fs.writeFileSync(path.join(t.cfg.videoDir, name), buf);
  const subject = t.db.get("SELECT id FROM subjects WHERE slug = 'persoenlichkeit'");
  t.db.run('UPDATE seminars SET video_file = ?, video_mime = ?, video_duration = ?, published = 1 WHERE subject_id = ?', name, 'video/mp4', duration, subject.id);
  return t.db.all('SELECT * FROM seminars WHERE subject_id = ? ORDER BY position', subject.id);
}

/** Simuliert vollständiges Ansehen in Echtzeit (mit gefälschter Uhr). */
function watchFully(t, userId, seminar) {
  let now = Date.now();
  for (let pos = 0; pos <= seminar.video_duration; pos += 5) {
    t.ctx.learning.heartbeat(userId, seminar, pos, now);
    now += 5000;
  }
  t.ctx.learning.heartbeat(userId, seminar, seminar.video_duration, now);
}

module.exports = { startApp, Client, signup, lastMailLink, publishSeminars, watchFully };
