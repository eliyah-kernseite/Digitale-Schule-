'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, signup } = require('./helpers');

test('Sicherheits-Header sind gesetzt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const res = await fetch(app.base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('permissions-policy'));
  const cookies = res.headers.getSetCookie().join(';');
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Lax/);
});

test('POST ohne CSRF-Token oder von fremder Seite wird abgelehnt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app);
  let res = await c.request('POST', '/app/konto/name', { form: { first_name: 'Hacker' } });
  assert.equal(res.status, 403);
  res = await c.request('POST', '/app/konto/name', { form: { first_name: 'Hacker', _csrf: 'falsch' } });
  assert.equal(res.status, 403);
  res = await c.request('POST', '/app/konto/name', { form: { first_name: 'Hacker', _csrf: c.csrf }, headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(app.db.get('SELECT first_name FROM users').first_name, 'Max');
  res = await c.post('/app/konto/name', { first_name: 'Moritz' });
  assert.equal(res.status, 303);
  assert.equal(app.db.get('SELECT first_name FROM users').first_name, 'Moritz');
});

test('Ausgaben werden escaped (kein XSS)', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app);
  await c.get('/app/konto');
  await c.post('/app/konto/name', { first_name: '<script>alert(1)</script>' });
  const res = await c.get('/app');
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
  assert.match(res.text, /&lt;script&gt;/);
});

test('Hinweistexte spiegeln keine Eingaben zurück', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const res = await fetch(app.base + '/?hinweis=%3Cimg%20src%3Dx%3E');
  const text = await res.text();
  assert.doesNotMatch(text, /<img src=x>/);
});

test('Mitgliederbereich und Admin sind geschützt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const anon = new Client(app.base);
  for (const url of ['/app', '/app/seminare', '/app/zeugnis', '/app/konto']) {
    const res = await anon.get(url);
    assert.equal(res.status, 303, url);
  }
  const member = await signup(app);
  assert.equal((await member.get('/admin')).status, 404, 'Admin für Mitglieder unsichtbar');
  assert.equal((await member.get('/app/seminare')).status, 303, 'ohne Abo keine Seminare');
  assert.equal((await member.get('/admin/mitglieder')).status, 404);
});

test('Admin braucht Zwei-Faktor-Anmeldung', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app, { email: 'chef@example.de' });
  app.db.run("UPDATE users SET role = 'admin'");
  let res = await c.get('/admin');
  assert.equal(res.status, 303);
  assert.match(res.location, /2fa-admin/);
  app.db.run("UPDATE users SET totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP'");
  res = await c.get('/admin');
  assert.equal(res.status, 200);
  assert.match(res.text, /Adminbereich/);
});

test('Datei-Upload ohne Admin oder ohne CSRF wird abgelehnt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app, { email: 'chef@example.de' });
  const form = new FormData();
  form.append('video', new Blob([Buffer.from('xxxxftypisom')], { type: 'video/mp4' }), 'a.mp4');
  let res = await fetch(app.base + '/admin/seminare/1/video', { method: 'POST', body: form, headers: { cookie: c.cookieHeader() }, redirect: 'manual' });
  assert.equal(res.status, 404, 'Mitglied darf nicht hochladen');
  app.db.run("UPDATE users SET role = 'admin', totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP'");
  res = await fetch(app.base + '/admin/seminare/1/video', { method: 'POST', body: form, headers: { cookie: c.cookieHeader() }, redirect: 'manual' });
  assert.equal(res.status, 403, 'ohne CSRF-Token');
  // Multipart an anderen Admin-Routen umgeht die CSRF-Prüfung nicht
  const f2 = new FormData();
  f2.append('action', 'make-admin');
  res = await fetch(app.base + '/admin/mitglieder/1', { method: 'POST', body: f2, headers: { cookie: c.cookieHeader() }, redirect: 'manual' });
  assert.equal(res.status, 403);
  const fs = require('node:fs');
  const left = fs.readdirSync(app.cfg.videoDir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(left, [], 'keine temporären Dateien bleiben liegen');
});

test('Rate-Limit greift bei vielen Login-Versuchen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = new Client(app.base);
  await c.get('/login');
  let last;
  for (let i = 0; i < 22; i += 1) last = await c.post('/login', { email: `x${i}@example.de`, password: 'irgendwas-langes' });
  assert.equal(last.status, 429);
});

test('Alle öffentlichen Seiten und Lehrgänge rendern ohne Fehler', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const slugs = app.db.all('SELECT slug FROM subjects').map((s) => `/faecher/${s.slug}`);
  for (const url of ['/', '/faecher', '/so-funktionierts', '/lehrplan', '/community', '/beitraege', '/registrieren', '/login', ...slugs]) {
    assert.equal((await fetch(app.base + url)).status, 200, url);
  }
});

test('Ohne Abo bleibt alles hinter der Paywall, ohne Login hinter dem Login', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const [s1] = (function publish() {
    const subject = app.db.get("SELECT id FROM subjects WHERE slug = 'persoenlichkeit'");
    app.db.run("UPDATE seminars SET video_file = ?, video_duration = 30, published = 1 WHERE subject_id = ?", 'a'.repeat(32) + '.mp4', subject.id);
    return app.db.all('SELECT * FROM seminars WHERE subject_id = ? ORDER BY position', subject.id);
  })();
  const guarded = ['/app/lehrgaenge', '/app/lehrgaenge/persoenlichkeit', '/app/seminare', `/app/seminare/${s1.id}`, `/app/seminare/${s1.id}/video`, '/app/zeugnis', '/app/community'];

  const guest = new Client(app.base);
  assert.equal((await guest.get('/admin')).status, 404, 'Adminbereich verrät nicht einmal, dass es ihn gibt');
  for (const url of [...guarded, '/app', '/app/konto', '/app/freischalten']) {
    const res = await guest.get(url);
    assert.equal(res.status, 303, url);
    assert.match(res.location, /^\/login/, url);
  }

  const free = await signup(app);
  for (const url of guarded) {
    const res = await free.get(url);
    assert.equal(res.status, 303, url);
    assert.match(res.location, /^\/app\?hinweis=kein-zugang/, url);
  }
  for (const [url, form] of [[`/app/seminare/${s1.id}/aufgabe`, { answer: 'Ich will rein ohne zu zahlen.' }], ['/app/zeugnis/routine', {}], ['/app/community/einladung', {}], ['/app/community/telegram', { waiver: 'on' }]]) {
    const res = await free.post(url, form);
    assert.equal(res.status, 303, url);
    assert.match(res.location, /kein-zugang/, url);
  }
  const beat = await free.request('POST', `/app/seminare/${s1.id}/fortschritt`, { json: { position: 5 }, headers: { 'x-csrf-token': free.csrf } });
  assert.equal(beat.status, 403);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM submissions').n, 0);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM seminar_progress').n, 0);
  assert.equal((await free.get('/admin')).status, 404, 'Adminbereich bleibt unsichtbar');
});

test('Ein kopierter Link meldet niemanden an; Geräte-Limit und Warn-Mail bei neuem Gerät', async (t) => {
  const app = await startApp({ MAX_DEVICES: '2' });
  t.after(() => app.stop());
  const a = await signup(app);
  // Die Sitzung steckt nur im HttpOnly-Cookie, nie in einer URL oder im HTML.
  const sid = [...a.cookies].find(([k]) => k.endsWith('ds_sid'))[1];
  const page = await a.get('/app/konto');
  assert.ok(!page.text.includes(sid));
  const friend = new Client(app.base);
  assert.equal((await friend.get('/app/konto')).status, 303, 'ohne eigenes Login kein Zugang');

  const mails = () => app.mailer.outbox.filter((m) => /Neue Anmeldung/.test(m.subject)).length;
  assert.equal(mails(), 0, 'erstes Gerät: keine Warnung');
  const login = async (c) => { await c.get('/login'); return c.post('/login', { email: 'max@example.de', password: 'Sicheres-Passwort-42', next: '/app' }); };

  const b = new Client(app.base);
  await login(b);
  assert.equal(mails(), 1, 'neues Gerät: Warn-Mail');
  await b.post('/logout');
  await login(b);
  assert.equal(mails(), 1, 'bekanntes Gerät: keine neue Mail');

  const c = new Client(app.base);
  await login(c);
  // Limit 2: das älteste Gerät (a) ist jetzt abgemeldet
  assert.equal((await a.get('/app/konto')).status, 303);
  assert.equal((await b.get('/app/konto')).status, 200);
  assert.equal((await c.get('/app/konto')).status, 200);
});
