'use strict';

// Nur für Entwicklung: erzeugt kurze Platzhalter-Videos (ffmpeg nötig),
// hängt sie an die Seminare des ersten aktiven Fachs und veröffentlicht diese.
// Aufruf: npm run demo-videos [-- Sekunden]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { seed } = require('../src/seed');

const cfg = loadConfig();
if (cfg.isProd) {
  console.error('Demo-Videos sind in Produktion nicht erlaubt.');
  process.exit(1);
}
const seconds = Math.max(5, Math.min(Number(process.argv[2]) || 20, 600));
const db = openDatabase(cfg.dbFile);
seed(db);
fs.mkdirSync(cfg.videoDir, { recursive: true });
const subject = db.get("SELECT * FROM subjects WHERE status = 'live' ORDER BY sort LIMIT 1");
const colors = ['0x1d2a24', '0x2a1d16', '0x16202a', '0x24221a'];
for (const s of db.all('SELECT * FROM seminars WHERE subject_id = ? ORDER BY position', subject.id)) {
  const name = `${crypto.randomBytes(16).toString('hex')}.mp4`;
  const out = path.join(cfg.videoDir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colors[s.position % 4]}:s=640x360:d=${seconds}:r=24`,
    '-f', 'lavfi', '-i', `sine=frequency=${200 + s.position * 20}:duration=${seconds}`, '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]);
  const half = Math.floor(seconds / 2);
  db.run('UPDATE seminars SET video_file = ?, video_mime = ?, video_duration = ?, chapters = ?, published = 1 WHERE id = ?',
    name, 'video/mp4', seconds, JSON.stringify([{ t: 0, title: 'Einstieg' }, { t: half, title: 'Vertiefung' }]), s.id);
  console.info(`Seminar ${s.position}: ${s.title} → ${name}`);
}
console.info('Fertig. Die Seminare sind veröffentlicht.');
