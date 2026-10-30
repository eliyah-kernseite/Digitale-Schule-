'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

// Häufige Passwörter, die trotz Länge nicht akzeptiert werden.
const COMMON = new Set([
  'passwort123', 'password123', '1234567890', '12345678910', 'qwertzuiop', 'qwertyuiop',
  'passwort1234', 'password1234', 'hallo12345', 'iloveyou12', 'abcdefghij', '0123456789',
  'fussball123', 'schalke0404', 'dortmund09', 'bayern1900', 'meinpasswort', 'geheim12345',
  'letmein1234', 'willkommen1', 'willkommen123', 'sommer2026', 'winter2026', 'aaaaaaaaaa',
]);

/** Gibt eine Fehlermeldung zurück oder null, wenn das Passwort gut genug ist. */
function checkPasswordPolicy(password, { email = '', firstName = '' } = {}) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Dein Passwort braucht mindestens 10 Zeichen.';
  }
  if (password.length > 200) return 'Dein Passwort darf höchstens 200 Zeichen haben.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) {
    return 'Dieses Passwort ist zu leicht zu erraten. Nimm etwas Eigenes.';
  }
  const local = email.split('@')[0].toLowerCase();
  if ((local.length >= 4 && lower.includes(local)) || (firstName.length >= 4 && lower.includes(firstName.toLowerCase()))) {
    return 'Dein Passwort sollte nicht deinen Namen oder deine E-Mail enthalten.';
  }
  return null;
}

function params(cost) {
  return { N: cost, r: 8, p: 1, maxmem: 256 * cost * 8 + 1024 * 1024 };
}

async function hashPassword(password, cost) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, params(cost));
  return `scrypt$${cost}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024 || cost > 1048576) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, params(cost));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function needsRehash(stored, cost) {
  return !stored.startsWith(`scrypt$${cost}$`);
}

module.exports = { checkPasswordPolicy, hashPassword, verifyPassword, needsRehash };
