'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp, signup } = require('./helpers');

async function admin(app) {
  const c = await signup(app, { email: 'chef@example.de', name: 'Chef' });
  app.db.run("UPDATE users SET role = 'admin', totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP'");
  return c;
}

test('Admin: Seminar anlegen, Video hochladen, veröffentlichen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await admin(app);
  const subject = app.db.get("SELECT id FROM subjects WHERE slug = 'fitness'");
  await c.get('/admin/seminare/neu?fach=' + subject.id);
  let res = await c.post('/admin/seminare', { subject_id: String(subject.id), position: '9', block_title: 'Aufbau', title: 'Schlaf als Training', summary: '', task_type: 'text', task_prompt: 'Schreibe deine Schlafzeiten auf.', chapters: '00:00 Start\n00:10 Praxis' });
  assert.equal(res.status, 303);
  const id = Number(/\/admin\/seminare\/(\d+)/.exec(res.location)[1]);

  // ohne Video nicht veröffentlichbar
  await c.get(`/admin/seminare/${id}`);
  res = await c.post(`/admin/seminare/${id}`, { position: '9', block_title: 'Aufbau', title: 'Schlaf als Training', task_type: 'text', task_prompt: 'Schreibe deine Schlafzeiten auf.', published: 'on' });
  assert.match(res.location, /veroeffentlichen-video/);
  assert.equal(app.db.get('SELECT published FROM seminars WHERE id = ?', id).published, 0);

  // falscher Dateiinhalt wird abgelehnt
  const bad = new FormData();
  bad.append('_csrf', c.csrf);
  bad.append('video', new Blob(['<html>kein video</html>'], { type: 'video/mp4' }), 'x.mp4');
  res = await fetch(`${app.base}/admin/seminare/${id}/video`, { method: 'POST', body: bad, headers: { cookie: c.cookieHeader() }, redirect: 'manual' });
  assert.match(res.headers.get('location'), /video-fehler/);

  const buf = Buffer.alloc(2048);
  buf.write('ftypisom', 4, 'latin1');
  const good = new FormData();
  good.append('_csrf', c.csrf);
  good.append('video', new Blob([buf], { type: 'video/mp4' }), 'kurs.mp4');
  res = await fetch(`${app.base}/admin/seminare/${id}/video`, { method: 'POST', body: good, headers: { cookie: c.cookieHeader() }, redirect: 'manual' });
  assert.match(res.headers.get('location'), /video-hochgeladen/);
  const row = app.db.get('SELECT * FROM seminars WHERE id = ?', id);
  assert.match(row.video_file, /^[a-f0-9]{32}\.mp4$/);
  assert.ok(fs.existsSync(`${app.cfg.videoDir}/${row.video_file}`));
  assert.deepEqual(fs.readdirSync(app.cfg.videoDir).filter((f) => f.endsWith('.tmp')), []);

  res = await c.post(`/admin/seminare/${id}`, { position: '9', block_title: 'Aufbau', title: 'Schlaf als Training', task_type: 'text', task_prompt: 'Schreibe deine Schlafzeiten auf.', video_duration: '20', published: 'on' });
  assert.match(res.location, /gespeichert/);
  assert.equal(app.db.get('SELECT published FROM seminars WHERE id = ?', id).published, 1);
});

test('Admin: Fach live schalten, Mitglied verwalten, Beitrag, Protokoll, CSV', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await admin(app);
  for (const url of ['/admin', '/admin/faecher', '/admin/seminare', '/admin/aufgaben', '/admin/mitglieder', '/admin/bewertungen', '/admin/beitraege', '/admin/beitraege/neu', '/admin/warteliste', '/admin/kuendigungen', '/admin/protokoll']) {
    assert.equal((await c.get(url)).status, 200, url);
  }
  const fit = app.db.get("SELECT * FROM subjects WHERE slug = 'fitness'");
  await c.post(`/admin/faecher/${fit.id}`, { title: fit.title, tagline: fit.tagline, description: fit.description, level_title: fit.level_title, teacher_name: 'Jonas', teacher_bio: 'Trainer.', status: 'live' });
  assert.equal(app.db.get('SELECT status FROM subjects WHERE id = ?', fit.id).status, 'live');

  // Mitglied: Freizugang
  const m = await signup(app, { email: 'schueler@example.de', name: 'Tom' });
  const tom = app.db.get("SELECT id FROM users WHERE email = 'schueler@example.de'");
  await c.get(`/admin/mitglieder/${tom.id}`);
  await c.post(`/admin/mitglieder/${tom.id}`, { action: 'comp', days: '30' });
  assert.equal((await m.get('/app/seminare')).status, 200);
  await c.post(`/admin/mitglieder/${tom.id}`, { action: 'disable' });
  assert.equal((await m.get('/app')).status, 303, 'gesperrtes Konto wird abgemeldet');

  // Admin kann sich nicht selbst die Rechte entziehen
  const me = app.db.get("SELECT id FROM users WHERE email = 'chef@example.de'");
  await c.post(`/admin/mitglieder/${me.id}`, { action: 'make-member' });
  assert.equal(app.db.get('SELECT role FROM users WHERE id = ?', me.id).role, 'admin');

  await c.post('/admin/beitraege', { title: 'Neuer Beitrag zur Routine', excerpt: 'Kurz', body: 'Ein Absatz mit genug Text.\n\nZweiter Absatz.', publish: 'on' });
  const html = await (await fetch(app.base + '/beitraege/neuer-beitrag-zur-routine')).text();
  assert.match(html, /<p>Zweiter Absatz.<\/p>/);

  app.db.run("INSERT INTO waitlist (email, subject_slug, confirmed_at, created_at) VALUES ('=cmd@x.de', 'fitness', 'x', 'x')");
  const csv = await c.get('/admin/warteliste?format=csv');
  assert.match(csv.text, /"'=cmd@x.de"/);
  assert.match((await c.get('/admin/protokoll')).text, /admin.member.comp/);
});

test('Admin: Vimeo-Video statt Upload, nur gültige Links, Einbettung nur auf der Seminarseite erlaubt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const c = await admin(app);
  const s = app.db.get("SELECT s.* FROM seminars s JOIN subjects j ON j.id = s.subject_id WHERE j.slug = 'persoenlichkeit' AND s.position = 1");
  await c.get(`/admin/seminare/${s.id}`);
  const base = { position: '1', block_title: s.block_title, title: s.title, task_type: s.task_type, task_prompt: s.task_prompt };
  let res = await c.post(`/admin/seminare/${s.id}`, { ...base, vimeo: 'https://evil.example/123', published: 'on' });
  assert.match(res.location, /vimeo-ungueltig/);
  res = await c.post(`/admin/seminare/${s.id}`, { ...base, vimeo: 'https://vimeo.com/76979871/8272103f6e', video_duration: '600', published: 'on' });
  assert.match(res.location, /gespeichert/);
  const row = app.db.get('SELECT vimeo_id, vimeo_hash, published FROM seminars WHERE id = ?', s.id);
  assert.deepEqual({ ...row }, { vimeo_id: '76979871', vimeo_hash: '8272103f6e', published: 1 });

  const page = await c.get(`/app/seminare/${s.id}`);
  assert.match(page.text, /src="https:\/\/player\.vimeo\.com\/video\/76979871\?h=8272103f6e&amp;controls=0/);
  assert.match(page.text, /vimeo-player\.min\.js/);
  assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/player\.vimeo\.com/);
  assert.doesNotMatch((await c.get('/app')).headers.get('content-security-policy'), /frame-src/);
});
