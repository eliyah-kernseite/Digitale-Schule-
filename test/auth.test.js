'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, signup, lastMailLink } = require('./helpers');

test('Registrierung, Bestätigung, Login, Logout', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = new Client(app.base);
  await c.get('/registrieren');
  const reg = await c.post('/registrieren', { first_name: 'Max', email: 'Max@Example.de', password: 'Sicheres-Passwort-42', password2: 'Sicheres-Passwort-42', consent: 'on' });
  assert.equal(reg.status, 200);
  assert.match(reg.text, /Postfach/);

  // vor Bestätigung kein Login
  let res = await c.post('/login', { email: 'max@example.de', password: 'Sicheres-Passwort-42' });
  assert.equal(res.status, 401);
  assert.match(res.text, /bestätige zuerst/);

  const link = lastMailLink(app.mailer, /\/email-bestaetigen\/[\w-]+/);
  assert.ok(link);
  res = await c.get(link);
  assert.equal(res.location, '/login?hinweis=email-bestaetigt');
  // Link ist nur einmal gültig
  res = await c.get(link);
  assert.equal(res.location, '/login?hinweis=link-ungueltig');

  res = await c.post('/login', { email: 'MAX@example.de', password: 'Sicheres-Passwort-42', next: '/app' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/app');
  res = await c.get('/app');
  assert.equal(res.status, 200);
  assert.match(res.text, /Willkommen zurück, Max/);

  res = await c.post('/logout');
  assert.equal(res.status, 303);
  res = await c.get('/app');
  assert.equal(res.status, 303);
  assert.match(res.location, /^\/login/);
});

test('Registrierung verrät nicht, ob eine E-Mail existiert', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  await signup(app, { email: 'anna@example.de' });
  const c = new Client(app.base);
  await c.get('/registrieren');
  const res = await c.post('/registrieren', { first_name: 'Fremd', email: 'anna@example.de', password: 'Anderes-Passwort-99', password2: 'Anderes-Passwort-99', consent: 'on' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Postfach/);
  assert.match(app.mailer.outbox.at(-1).subject, /bereits ein Konto/);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM users').n, 1);
});

test('Passwort-Regeln werden geprüft', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = new Client(app.base);
  await c.get('/registrieren');
  for (const pw of ['kurz', 'passwort123', 'aaaaaaaaaaaa', 'maximilian-01x']) {
    const res = await c.post('/registrieren', { first_name: 'Maximilian', email: 'maximilian@example.de', password: pw, password2: pw, consent: 'on' });
    assert.equal(res.status, 422, pw);
  }
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM users').n, 0);
});

test('Konto wird nach Fehlversuchen gesperrt, Fehlermeldung bleibt gleich', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  await signup(app);
  const c = new Client(app.base);
  await c.get('/login');
  const unknown = await c.post('/login', { email: 'niemand@example.de', password: 'egal-egal-egal' });
  for (let i = 0; i < 5; i += 1) {
    const r = await c.post('/login', { email: 'max@example.de', password: 'falsch-falsch-falsch' });
    assert.equal(r.status, 401);
  }
  const locked = await c.post('/login', { email: 'max@example.de', password: 'Sicheres-Passwort-42' });
  assert.equal(locked.status, 401, 'auch mit richtigem Passwort gesperrt');
  const msg = (html) => /role="alert">\s*<p>([^<]+)/.exec(html)[1];
  assert.equal(msg(locked.text), msg(unknown.text));
  assert.ok(app.db.get('SELECT locked_until FROM users').locked_until);
});

test('Passwort zurücksetzen beendet alle Sitzungen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const logged = await signup(app);
  const c = new Client(app.base);
  await c.get('/passwort-vergessen');
  let res = await c.post('/passwort-vergessen', { email: 'max@example.de' });
  assert.match(res.text, /Wenn es ein Konto/);
  // unbekannte Adresse: gleiche Antwort
  res = await c.post('/passwort-vergessen', { email: 'nope@example.de' });
  assert.match(res.text, /Wenn es ein Konto/);

  const link = lastMailLink(app.mailer, /\/passwort-neu\/[\w-]+/);
  res = await c.get(link);
  assert.equal(res.status, 200);
  res = await c.post(link, { password: 'Neues-Passwort-2026', password2: 'Neues-Passwort-2026' });
  assert.equal(res.location, '/login?hinweis=passwort-neu');
  res = await c.post(link, { password: 'Noch-eins-2026-xx', password2: 'Noch-eins-2026-xx' });
  assert.match(res.location, /link-ungueltig/);

  res = await logged.get('/app');
  assert.equal(res.status, 303, 'alte Sitzung ist abgemeldet');
  res = await c.post('/login', { email: 'max@example.de', password: 'Neues-Passwort-2026' });
  assert.equal(res.status, 303);
});

test('Kein Open Redirect nach dem Login', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  await signup(app);
  const c = new Client(app.base);
  await c.get('/login');
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    const res = await c.post('/login', { email: 'max@example.de', password: 'Sicheres-Passwort-42', next });
    assert.equal(res.location, '/app', next);
    await c.post('/logout');
  }
});

test('Zwei-Faktor-Anmeldung: einrichten, Login mit Code, keine Wiederverwendung', async (t) => {
  const { codeAt } = require('../src/security/totp');
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app);
  await c.get('/app/konto');
  let res = await c.post('/app/konto/2fa/start');
  const secret = /<code class="secret">([A-Z2-7]+)<\/code>/.exec(res.text)[1];
  const step = Math.floor(Date.now() / 30000);
  res = await c.post('/app/konto/2fa/bestaetigen', { code: codeAt(secret, step) });
  assert.match(res.location, /2fa-an/);
  await c.post('/logout');

  res = await c.post('/login', { email: 'max@example.de', password: 'Sicheres-Passwort-42', next: '/app/zeugnis' });
  assert.match(res.location, /^\/login\/2fa/);
  res = await c.get('/app');
  assert.equal(res.status, 303, 'ohne Code kein Zugang');
  await c.get('/login/2fa');
  res = await c.post('/login/2fa', { code: '000000', next: '/app' });
  assert.equal(res.status, 401);
  // derselbe Code wie bei der Einrichtung darf nicht noch einmal funktionieren
  res = await c.post('/login/2fa', { code: codeAt(secret, step), next: '/app' });
  assert.equal(res.status, 401);
  res = await c.post('/login/2fa', { code: codeAt(secret, step + 1), next: '/app' });
  assert.equal(res.status, 303);
  res = await c.get('/app');
  assert.equal(res.status, 200);
});
