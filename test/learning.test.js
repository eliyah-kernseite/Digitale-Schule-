'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startApp, Client, signup, publishSeminars, watchFully } = require('./helpers');

async function member(app) {
  const c = await signup(app);
  await c.get('/mitgliedschaft');
  let res = await c.post('/mitgliedschaft/checkout', { agb: 'on', waiver: 'on' });
  assert.equal(res.status, 303);
  assert.match(res.location, /testzahlung/);
  await c.get('/mitgliedschaft/testzahlung');
  res = await c.post('/mitgliedschaft/testzahlung');
  assert.equal(res.location, '/mitgliedschaft/danke');
  const user = app.db.get("SELECT * FROM users WHERE email = 'max@example.de'");
  return { c, user };
}

test('Checkout braucht beide Zustimmungen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await signup(app);
  await c.get('/mitgliedschaft');
  const res = await c.post('/mitgliedschaft/checkout', { agb: 'on' });
  assert.equal(res.status, 422);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM subscriptions').n, 0);
});

test('Seminare öffnen sich nur in Reihenfolge und nur nach ganzem Video + Aufgabe', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const seminars = publishSeminars(app, 30);
  const { c, user } = await member(app);
  const [s1, s2, s3] = seminars;

  let res = await c.get('/app/seminare');
  assert.equal(res.status, 200);
  assert.match(res.text, /Gesperrt · öffnet nach Seminar 1/);

  // Seminar 2 ist gesperrt – Seite, Video und Aufgabe
  res = await c.get(`/app/seminare/${s2.id}`);
  assert.match(res.location, /gesperrt/);
  res = await c.get(`/app/seminare/${s2.id}/video`);
  assert.equal(res.status, 403);
  await c.get(`/app/seminare/${s1.id}`);
  res = await c.post(`/app/seminare/${s2.id}/aufgabe`, { answer: 'Ich will das überspringen.' });
  assert.equal(res.status, 403);

  // Seminar 1: Aufgabe vor dem Video ist nicht möglich
  res = await c.post(`/app/seminare/${s1.id}/aufgabe`, { answer: 'Ehrliche Antwort zu meinem Stand.' });
  assert.match(res.location, /video-zuerst/);

  // Vorspulen per gefälschtem Herzschlag bringt nichts
  res = await c.request('POST', `/app/seminare/${s1.id}/fortschritt`, { json: { position: 30 }, headers: { 'x-csrf-token': c.csrf } });
  assert.equal(res.status, 200);
  let data = JSON.parse(res.text);
  assert.ok(data.watched <= 2.5, `angerechnet: ${data.watched}`);
  assert.equal(data.videoDone, false);
  res = await c.request('POST', `/app/seminare/${s1.id}/fortschritt`, { json: { position: 30 }, headers: { 'x-csrf-token': c.csrf } });
  data = JSON.parse(res.text);
  assert.ok(data.watched < 6, 'zweiter Sprung ebenfalls gedeckelt');

  // Herzschlag ohne CSRF-Header
  res = await c.request('POST', `/app/seminare/${s1.id}/fortschritt`, { json: { position: 1 } });
  assert.equal(res.status, 403);

  // echtes Ansehen (in Echtzeit) schaltet die Aufgabe frei
  watchFully(app, user.id, s1);
  res = await c.post(`/app/seminare/${s1.id}/aufgabe`, { answer: 'kurz' });
  assert.match(res.location, /aufgabe-leer/);
  res = await c.post(`/app/seminare/${s1.id}/aufgabe`, { answer: 'Körper okay, Geld knapp, Kopf voll.' });
  assert.match(res.location, /geschafft=1/);
  res = await c.get(res.location);
  assert.match(res.text, /Seminar 2 ist jetzt offen/);

  // doppelte Abgabe wird ignoriert
  await c.post(`/app/seminare/${s1.id}/aufgabe`, { answer: 'Noch einmal abgeben, bitte.' });
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM submissions').n, 1);

  // Seminar 2 jetzt offen, Seminar 3 weiterhin gesperrt
  res = await c.get(`/app/seminare/${s2.id}`);
  assert.equal(res.status, 200);
  res = await c.get(`/app/seminare/${s3.id}`);
  assert.match(res.location, /gesperrt/);

  // Video wird mit Range ausgeliefert
  res = await fetch(`${app.base}/app/seminare/${s1.id}/video`, { headers: { cookie: c.cookieHeader(), range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-99/4096');
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('Fortschritt wächst höchstens in Echtzeit', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const [s1] = publishSeminars(app, 600);
  const { user } = await member(app);
  const L = app.ctx.learning;
  const t0 = Date.now();
  L.heartbeat(user.id, s1, 0, t0);
  // 10 Sekunden später behauptet der Client, bei 500 zu sein
  const r = L.heartbeat(user.id, s1, 500, t0 + 10_000);
  assert.ok(r.watched <= 10 * 1.25 + 2, `angerechnet: ${r.watched}`);
  // lange Pause, dann Sprung: nur Mindestspielraum
  const r2 = L.heartbeat(user.id, s1, 500, t0 + 3600_000);
  assert.ok(r2.watched - r.watched <= 2.01);
  assert.equal(r2.videoDone, false);
});

test('Ohne Abo kein Zugriff, nach Ablauf wieder gesperrt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const [s1] = publishSeminars(app);
  const { c, user } = await member(app);
  assert.equal((await c.get(`/app/seminare/${s1.id}`)).status, 200);
  app.db.run("UPDATE subscriptions SET current_period_end = ? WHERE user_id = ?", new Date(Date.now() - 5 * 86400000).toISOString(), user.id);
  const res = await c.get(`/app/seminare/${s1.id}`);
  assert.equal(res.status, 303);
  assert.match(res.location, /kein-zugang/);
});

test('Bewertungen: erst nach Abgabe, Schule erst nach 3 Seminaren, Freigabe durch Admin', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const seminars = publishSeminars(app);
  const { c, user } = await member(app);
  await c.get(`/app/seminare/${seminars[0].id}`);
  await c.post(`/app/seminare/${seminars[0].id}/bewertung`, { rating: '5', comment: 'Top' });
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM reviews').n, 0, 'vor Abgabe keine Bewertung');

  for (const s of seminars.slice(0, 3)) {
    watchFully(app, user.id, s);
    await c.post(`/app/seminare/${s.id}/aufgabe`, { answer: 'Meine ehrliche Antwort dazu.', done: 'on' });
  }
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM submissions').n, 3);
  let res = await c.post(`/app/seminare/${seminars[0].id}/bewertung`, { rating: '4', comment: 'Hilfreich' });
  assert.match(res.location, /bewertet/);
  await c.post(`/app/seminare/${seminars[0].id}/bewertung`, { rating: '9' });
  assert.equal(app.db.get('SELECT rating FROM reviews WHERE seminar_id = ?', seminars[0].id).rating, 4, 'ungültige Werte ignoriert');

  await c.get('/app/zeugnis');
  res = await c.post('/app/zeugnis/bewertung', { rating: '5', comment: 'Hat mir Struktur gegeben.' });
  assert.match(res.location, /bewertet/);
  let home = await (await fetch(app.base + '/')).text();
  assert.doesNotMatch(home, /Hat mir Struktur gegeben/, 'erst nach Freigabe öffentlich');
  app.db.run("UPDATE reviews SET status = 'approved' WHERE seminar_id IS NULL");
  home = await (await fetch(app.base + '/')).text();
  assert.match(home, /Hat mir Struktur gegeben/);
  assert.match(home, /3 Seminare abgeschlossen/);
});

test('Zeugnis: Selbsttest, Ziel, Routine-Streak', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  publishSeminars(app);
  const { c, user } = await member(app);
  await c.get('/app/zeugnis');
  const values = { week: '0', clarity: '4', confidence: '3', discipline: '5', calm: '6', goal_progress: '2' };
  let res = await c.post('/app/zeugnis/selbsttest', values);
  assert.match(res.location, /selbsttest/);
  await c.post('/app/zeugnis/selbsttest', { ...values, clarity: '10' });
  assert.equal(app.db.get('SELECT clarity FROM self_tests WHERE week = 0').clarity, 4, 'Woche 0 nur einmal');
  await c.post('/app/zeugnis/selbsttest', { ...values, week: '12' });
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM self_tests WHERE week = 12').n, 0, 'Woche 12 erst nach 84 Tagen');
  await c.post('/app/zeugnis/selbsttest', { ...values, week: '0', clarity: '11' });

  await c.post('/app/zeugnis/ziel', { goal: '10 kg leichter und ein eigenes Projekt gestartet.' });
  await c.post('/app/zeugnis/routine');
  const { berlinDay, shiftDay } = require('../src/services/learning');
  const today = berlinDay();
  app.db.run('INSERT INTO routine_checkins (user_id, day) VALUES (?, ?), (?, ?)', user.id, shiftDay(today, -1), user.id, shiftDay(today, -2));
  res = await c.get('/app/zeugnis');
  assert.match(res.text, /<strong>3<\/strong> Tage in Folge/);
  assert.match(res.text, /10 kg leichter/);
});

test('Kündigung ohne Login (Verträge hier kündigen)', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { user } = await member(app);
  const anon = new Client(app.base);
  await anon.get('/kuendigen');
  let res = await anon.post('/kuendigen', { name: 'M', email: 'max@example.de', kind: 'ordentlich' });
  assert.equal(res.status, 422);
  res = await anon.post('/kuendigen', { name: 'Max Muster', email: 'max@example.de', kind: 'ordentlich' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Kündigung ist bei uns/);
  const sub = app.db.get('SELECT * FROM subscriptions WHERE user_id = ?', user.id);
  assert.equal(sub.cancel_at_period_end, 1);
  assert.equal(sub.status, 'active', 'Zugang bis Periodenende');
  assert.match(app.mailer.outbox.at(-1).subject, /Eingangsbestätigung/);
  // unbekannte Adresse: gleiche Seite, wird nur protokolliert
  res = await anon.post('/kuendigen', { name: 'Fremd Person', email: 'fremd@example.de', kind: 'ordentlich' });
  assert.equal(res.status, 200);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM cancellations').n, 2);
});

test('Abo im Konto kündigen und fortsetzen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { c, user } = await member(app);
  await c.get('/app/konto');
  let res = await c.post('/app/konto/abo/kuendigen');
  assert.match(res.location, /abo-gekuendigt/);
  assert.equal(app.db.get('SELECT cancel_at_period_end AS x FROM subscriptions WHERE user_id = ?', user.id).x, 1);
  res = await c.post('/app/konto/abo/fortsetzen');
  assert.match(res.location, /abo-fortgesetzt/);
  assert.equal(app.db.get('SELECT cancel_at_period_end AS x FROM subscriptions WHERE user_id = ?', user.id).x, 0);
});

test('Warteliste mit Double-Opt-in', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = new Client(app.base);
  await c.get('/faecher/fitness');
  let res = await c.post('/warteliste', { email: 'neu@example.de', fach: 'fitness' });
  assert.equal(res.status, 422, 'ohne Einwilligung');
  res = await c.post('/warteliste', { email: 'neu@example.de', fach: 'fitness', consent: 'on' });
  assert.match(res.text, /Ein Klick noch/);
  assert.equal(app.db.get('SELECT confirmed_at FROM waitlist').confirmed_at, null);
  const link = /\/warteliste\/bestaetigen\/[\w-]+/.exec(app.mailer.outbox.at(-1).text)[0];
  res = await c.get(link);
  assert.match(res.text, /Du bist dabei/);
  assert.ok(app.db.get('SELECT confirmed_at FROM waitlist').confirmed_at);
});

test('Daten-Export und Konto löschen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { c } = await member(app);
  let res = await c.get('/app/konto/daten');
  const data = JSON.parse(res.text);
  assert.equal(data.konto.email, 'max@example.de');
  assert.equal(data.konto.password_hash, undefined, 'kein Passwort-Hash im Export');
  await c.get('/app/konto');
  res = await c.post('/app/konto/loeschen', { password: 'Sicheres-Passwort-42', confirm: 'nein' });
  assert.equal(res.status, 422);
  res = await c.post('/app/konto/loeschen', { password: 'Sicheres-Passwort-42', confirm: 'LÖSCHEN' });
  assert.match(res.location, /konto-geloescht/);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM users').n, 0);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM subscriptions').n, 0);
});

test('Stripe: Checkout, signierter Webhook, Idempotenz, Kündigung', async (t) => {
  // Kleiner Fake der Stripe-API
  const http = require('node:http');
  const calls = [];
  const sub = { id: 'sub_123', customer: 'cus_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false };
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: 'cus_1' }));
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));
      if (req.url === '/v1/subscriptions/sub_123' && req.method === 'GET') return res.end(JSON.stringify(sub));
      if (req.url === '/v1/subscriptions/sub_123' && req.method === 'POST') return res.end(JSON.stringify({ ...sub, cancel_at_period_end: body.includes('cancel_at_period_end=true') }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const app = await startApp({
    PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_1',
    STRIPE_API_BASE: `http://127.0.0.1:${fake.address().port}`,
  });
  t.after(async () => { await app.stop(); fake.close(); });

  const csp = (await fetch(app.base + '/')).headers.get('content-security-policy');
  assert.match(csp, /form-action 'self' https:\/\/checkout\.stripe\.com/);

  const c = await signup(app);
  await c.get('/mitgliedschaft');
  let res = await c.post('/mitgliedschaft/checkout', { agb: 'on', waiver: 'on' });
  assert.equal(res.location, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.equal(calls[0].auth, 'Bearer sk_test_x');
  assert.match(calls[1].body, /client_reference_id=1/);
  assert.equal((await c.get('/mitgliedschaft/testzahlung')).status, 404, 'Testzahlung im Stripe-Modus aus');

  const send = async (event, secret = 'whsec_x') => {
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return fetch(app.base + '/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body });
  };
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: '1', subscription: 'sub_123', customer: 'cus_1' } } };
  assert.equal((await send(event, 'whsec_falsch')).status, 400);
  assert.equal(app.db.get('SELECT status FROM subscriptions').status, 'incomplete');
  assert.equal((await send(event)).status, 200);
  assert.equal(app.db.get('SELECT status FROM subscriptions').status, 'active');
  assert.equal((await c.get('/app/seminare')).status, 200);
  // erneute Zustellung wird ignoriert
  const before = calls.length;
  assert.equal((await send(event)).status, 200);
  assert.equal(calls.length, before);

  res = await c.post('/app/konto/abo/kuendigen');
  assert.match(res.location, /abo-gekuendigt/);
  assert.equal(app.db.get('SELECT cancel_at_period_end AS x FROM subscriptions').x, 1);

  // Abo endet -> kein Zugang mehr
  await send({ id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
  assert.equal(app.db.get('SELECT status FROM subscriptions').status, 'canceled');
  assert.equal((await c.get('/app/seminare')).status, 303);
});
