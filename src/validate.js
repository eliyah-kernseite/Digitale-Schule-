'use strict';

// Eingabeprüfung: alles, was vom Browser kommt, wird hier normalisiert und begrenzt.

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function str(value, max = 200) {
  if (typeof value !== 'string') return '';
  // Steuerzeichen entfernen (außer Zeilenumbruch/Tab), Unicode normalisieren
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function email(value) {
  const v = str(value, 254).toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

function intIn(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function id(value) {
  return /^\d{1,10}$/.test(String(value)) ? Number(value) : null;
}

function slug(value) {
  const v = str(value, 80).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? v : null;
}

function slugify(text) {
  return str(text, 120)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'beitrag';
}

function checkbox(value) {
  return value === 'on' || value === '1' || value === 'true' || value === true;
}

/** Nur relative, interne Weiterleitungsziele erlauben (kein Open Redirect). */
function safeNext(value, fallback = '/app') {
  const v = str(value, 300);
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\r\n]/.test(v)) return fallback;
  return v;
}

module.exports = { str, email, intIn, id, slug, slugify, checkbox, safeNext };
