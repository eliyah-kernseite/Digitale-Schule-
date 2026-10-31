'use strict';

// Legt einen Admin an oder macht ein bestehendes Konto zum Admin.
// Aufruf: npm run create-admin -- admin@example.de Vorname
// Das Passwort wird verdeckt abgefragt und nie als Argument übergeben.

const readline = require('node:readline');
const { loadConfig } = require('../src/config');
const { openDatabase, nowIso } = require('../src/db');
const { hashPassword, checkPasswordPolicy } = require('../src/security/passwords');
const v = require('../src/validate');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function write(s) {
      if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const cfg = loadConfig();
  const email = v.email(process.argv[2]);
  const firstName = v.str(process.argv[3] || 'Admin', 60);
  if (!email) {
    console.error('Aufruf: npm run create-admin -- <email> [Vorname]');
    process.exit(1);
  }
  const db = openDatabase(cfg.dbFile);
  const existing = db.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) {
    db.run("UPDATE users SET role = 'admin', email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", nowIso(), existing.id);
    db.audit(existing.id, 'cli.make_admin');
    console.info(`${email} ist jetzt Admin. Beim nächsten Login muss die Zwei-Faktor-Anmeldung eingerichtet werden.`);
    return;
  }
  const password = process.env.ADMIN_PASSWORD || (await askHidden('Passwort (mind. 10 Zeichen): '));
  const err = checkPasswordPolicy(password, { email, firstName });
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const hash = await hashPassword(password, cfg.passwordCost);
  const info = db.run("INSERT INTO users (email, password_hash, first_name, role, email_verified_at, created_at) VALUES (?, ?, ?, 'admin', ?, ?)",
    email, hash, firstName, nowIso(), nowIso());
  db.audit(info.lastInsertRowid, 'cli.create_admin');
  console.info(`Admin ${email} angelegt. Nach dem ersten Login richtest du unter „Konto & Abo“ die Zwei-Faktor-Anmeldung ein.`);
})();
