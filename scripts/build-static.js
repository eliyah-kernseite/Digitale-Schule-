'use strict';

// Erzeugt eine statische Vorschau der Website in docs/ (für GitHub Pages).
// Formulare, Login, Zahlung und Videos brauchen den echten Server; in der
// Vorschau sind die Seiten nur zum Anschauen. Aufruf: npm run build:static

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { berlinDay, shiftDay } = require('../src/services/learning');
const { nowIso } = require('../src/db');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const silent = { info() {}, warn() {}, error() {} };

function prefixFor(route) {
  const depth = route === '/' ? 0 : route.split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

function fileFor(route) {
  return route === '/' ? 'index.html' : path.join(route.slice(1), 'index.html');
}

/** Macht absolute Pfade relativ, damit die Seiten in jedem Pages-Unterordner laufen. */
function relativize(html, route, exported) {
  const pre = prefixFor(route);
  return html.replace(/(href|src|action)="\/(?!\/)([^"]*)"/g, (all, attr, rest) => {
    const [pathPart, hash = ''] = rest.split('#');
    const clean = pathPart.split('?')[0];
    const h = hash ? `#${hash}` : '';
    if (/\.[a-z0-9]{2,5}$/i.test(clean)) return `${attr}="${pre}${clean}"`; // Datei
    const target = `/${clean}`.replace(/\/$/, '') || '/';
    if (attr === 'href' && !exported.has(target)) return `${attr}="${pre}vorschau/${h}"`;
    return `${attr}="${pre}${clean ? `${clean}/` : ''}${h}"`;
  });
}

function injectPreview(html, route) {
  const pre = prefixFor(route);
  const banner = '<div class="preview-banner">Vorschau ohne Server: Login, Zahlung, Formulare und Videos funktionieren erst auf dem echten Server.</div>';
  return html
    .replace(/<body([^>]*)>/, `<body$1>${banner}`)
    .replace('</body>', `<script src="${pre}js/static-preview.js"></script></body>`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schule-static-'));
  const cfg = loadConfig({ NODE_ENV: 'development', DATA_DIR: dir, APP_URL: 'http://127.0.0.1', PAYMENT_PROVIDER: 'mock' });
  const { app, ctx, close } = createApp(cfg, { logger: silent });
  const { db } = ctx;

  // Demo-Daten für den Mitgliederbereich
  const subject = db.get("SELECT id FROM subjects WHERE slug = 'persoenlichkeit'");
  db.run("UPDATE seminars SET video_duration = 840, published = 1, chapters = ? WHERE subject_id = ?",
    JSON.stringify([{ t: 0, title: 'Einstieg' }, { t: 300, title: 'Die Idee' }, { t: 620, title: 'Deine Aufgabe' }]), subject.id);
  const info = db.run("INSERT INTO users (email, password_hash, first_name, email_verified_at, created_at) VALUES ('demo@example.de', 'x', 'Jonas', ?, ?)", nowIso(), nowIso());
  const uid = info.lastInsertRowid;
  db.run("INSERT INTO subscriptions (user_id, provider, status, current_period_end, started_at, updated_at) VALUES (?, 'mock', 'active', ?, ?, ?)",
    uid, new Date(Date.now() + 20 * 86400000).toISOString(), nowIso(), nowIso());
  const seminars = db.all('SELECT * FROM seminars WHERE subject_id = ? ORDER BY position', subject.id);
  const answers = ['Körper okay, Geld knapp, Kopf voll. Ich will wieder Klarheit.', 'In zwölf Monaten: 10 kg leichter und ein eigenes Projekt gestartet.', 'Erledigt ✓', 'Ich bin nicht diszipliniert. Ich bin zu spät dran. Andere sind talentierter.'];
  seminars.slice(0, 4).forEach((s, i) => {
    db.run('INSERT INTO seminar_progress (user_id, seminar_id, watched_seconds, last_beat_at, video_done_at) VALUES (?, ?, 840, 0, ?)', uid, s.id, nowIso());
    db.run('INSERT INTO submissions (user_id, seminar_id, content, submitted_at) VALUES (?, ?, ?, ?)', uid, s.id, answers[i], new Date(Date.now() - (4 - i) * 3 * 86400000).toISOString());
  });
  db.run('INSERT INTO seminar_progress (user_id, seminar_id, watched_seconds, last_beat_at) VALUES (?, ?, 310, 0)', uid, seminars[4].id);
  db.run("INSERT INTO self_tests VALUES (?, 0, 4, 3, 5, 4, 2, ?)", uid, new Date(Date.now() - 14 * 86400000).toISOString());
  db.run('INSERT INTO goals (user_id, text, updated_at) VALUES (?, ?, ?)', uid, '10 kg leichter und mein eigenes Projekt gestartet.', nowIso());
  const today = berlinDay();
  for (let i = 0; i < 9; i += 1) db.run('INSERT INTO routine_checkins (user_id, day) VALUES (?, ?)', uid, shiftDay(today, -i));

  let token = null;
  ctx.sessions.create({ cookie: (name, value) => { token = `${name}=${value}`; } }, uid);

  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const posts = db.all('SELECT slug FROM posts WHERE published_at IS NOT NULL').map((p) => `/beitraege/${p.slug}`);
  const subjects = db.all('SELECT slug FROM subjects').map((s) => `/faecher/${s.slug}`);
  const publicRoutes = ['/', '/faecher', ...subjects, '/so-funktionierts', '/lehrplan', '/community', '/beitraege', ...posts,
    '/mitgliedschaft', '/kuendigen', '/impressum', '/datenschutz', '/agb', '/widerruf', '/login', '/registrieren', '/passwort-vergessen'];
  const memberRoutes = ['/app', '/app/seminare', `/app/seminare/${seminars[4].id}`, `/app/seminare/${seminars[0].id}`, '/app/zeugnis', '/app/community', '/app/konto'];
  const exported = new Set([...publicRoutes, ...memberRoutes, '/vorschau']);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const route of [...publicRoutes, ...memberRoutes]) {
    const isMember = route.startsWith('/app');
    const res = await fetch(base + route, { headers: isMember ? { cookie: token } : {}, redirect: 'manual' });
    if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status}`);
    let html = await res.text();
    if (isMember) html = html.replace(/<html lang="de">/, '<html lang="de" data-demo="1">');
    html = injectPreview(relativize(html, route, exported), route);
    const file = path.join(OUT, fileFor(route));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }

  // Hinweisseite für Ziele, die nur mit Server funktionieren
  const note = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vorschau · ${cfg.schoolName}</title><link rel="stylesheet" href="../css/main.css"></head><body><main class="section"><div class="wrap narrow"><p class="eyebrow">Vorschau</p><h1 class="h1">Das geht nur mit Server.</h1><p class="lead">Diese Seite ist eine statische Vorschau auf GitHub Pages. Login, Zahlung, Formulare, Videos und der Adminbereich laufen erst, wenn die App auf einem echten Server gestartet ist (siehe README).</p><p><a class="btn" href="../">Zur Startseite</a> <a class="btn btn-ghost" href="../app/">Demo-Mitgliederbereich</a></p></div></main></body></html>`;
  fs.mkdirSync(path.join(OUT, 'vorschau'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'vorschau', 'index.html'), note);

  // Statische Dateien kopieren, CSS-Pfade relativ machen
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
  const cssFile = path.join(OUT, 'css', 'main.css');
  fs.writeFileSync(cssFile, fs.readFileSync(cssFile, 'utf8').replace(/url\('\/fonts\//g, "url('../fonts/") + `
.preview-banner { background: var(--brass); color: var(--ink); font: 700 0.85rem/1.4 var(--body); padding: 8px 16px; text-align: center; }
`);
  fs.writeFileSync(path.join(OUT, 'js', 'static-preview.js'), `(function () {
  'use strict';
  // Vorschau: Formulare nicht abschicken, sondern kurz erklären.
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    window.alert('Das ist nur die Vorschau. Formulare, Login und Zahlung funktionieren erst auf dem echten Server.');
  }, true);
  document.querySelectorAll('video').forEach(function (v) { v.removeAttribute('src'); });
})();
`);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  await new Promise((r) => server.close(r));
  close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.info(`Statische Vorschau mit ${exported.size} Seiten in docs/ erstellt.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
