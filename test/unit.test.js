'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, checkPasswordPolicy } = require('../src/security/passwords');
const { verifyTotp, codeAt, generateSecret } = require('../src/security/totp');
const { verifyStripeSignature } = require('../src/services/payments');
const v = require('../src/validate');
const { parseChapters, csvCell } = require('../src/routes/admin');
const { shiftDay } = require('../src/services/learning');
const { loadConfig } = require('../src/config');

test('Passwort-Hash: richtig, falsch, manipuliert', async () => {
  const h = await hashPassword('Mein-Geheimnis-1', 1024);
  assert.ok(await verifyPassword('Mein-Geheimnis-1', h));
  assert.ok(!(await verifyPassword('Mein-Geheimnis-2', h)));
  assert.ok(!(await verifyPassword('x', 'kaputt')));
  assert.ok(!(await verifyPassword('x', 'scrypt$99999999$aa$bb')));
  assert.notEqual(h, await hashPassword('Mein-Geheimnis-1', 1024), 'Salt ist zufällig');
  assert.equal(checkPasswordPolicy('Ein-gutes-Passwort'), null);
});

test('TOTP prüft Zeitfenster und verhindert Wiederverwendung', () => {
  const s = generateSecret();
  const now = Date.now();
  const step = Math.floor(now / 30000);
  assert.equal(verifyTotp(s, codeAt(s, step), 0, now), step);
  assert.equal(verifyTotp(s, codeAt(s, step), step, now), -1);
  assert.equal(verifyTotp(s, codeAt(s, step - 5), 0, now), -1);
  assert.equal(verifyTotp(s, 'abcdef', 0, now), -1);
  // RFC-6238-Testvektor (SHA-1, T=59 s)
  const rfc = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(codeAt(rfc, 1), '287082');
});

test('Stripe-Signatur: gültig, falsch, veraltet', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1"}');
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret));
  assert.ok(!verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, secret));
  const old = t - 1000;
  const oldSig = crypto.createHmac('sha256', secret).update(`${old}.${body}`).digest('hex');
  assert.ok(!verifyStripeSignature(body, `t=${old},v1=${oldSig}`, secret));
});

test('Eingabeprüfung', () => {
  assert.equal(v.email(' Max@Example.DE '), 'max@example.de');
  assert.equal(v.email('kein mail'), null);
  assert.equal(v.email('a@b'), null);
  assert.equal(v.safeNext('/app/zeugnis'), '/app/zeugnis');
  assert.equal(v.safeNext('//evil.com'), '/app');
  assert.equal(v.safeNext('https://evil.com'), '/app');
  assert.equal(v.id('12'), 12);
  assert.equal(v.id('1; DROP'), null);
  assert.equal(v.slugify('Größe & Stärke!'), 'groesse-staerke');
  assert.equal(v.str('a\u0000b'), 'ab');
});

test('Kapitelmarken und CSV-Schutz', () => {
  assert.deepEqual(parseChapters('00:00 Start\n02:30 Mitte\nquatsch\n1:02:03 Ende'), [
    { t: 0, title: 'Start' }, { t: 150, title: 'Mitte' }, { t: 3723, title: 'Ende' },
  ]);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('normal'), '"normal"');
});

test('Datumsrechnung über Monatsgrenzen', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('Produktion verweigert unsichere Konfiguration', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATA_DIR: '/tmp/x-nope' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), APP_URL: 'https://a.de', PAYMENT_PROVIDER: 'mock', SMTP_URL: 'smtp://x' }), /stripe/);
});
