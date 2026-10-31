'use strict';

const TZ = 'Europe/Berlin';

function date(value, withTime = false) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

function duration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Teilt reinen Text in Absätze; die Ausgabe wird im Template weiterhin escaped. */
function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function initial(name) {
  const m = /\p{L}/u.exec(String(name || ''));
  return m ? m[0].toUpperCase() : '?';
}

function plural(n, one, many) {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

module.exports = { date, duration, paragraphs, initial, plural, pad2 };
