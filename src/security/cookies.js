'use strict';

/** Minimaler, strikter Cookie-Parser (ohne Abhängigkeit). */
function parseCookies(header) {
  const out = Object.create(null);
  if (!header || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    let val = part.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in out)) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function cookieMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

module.exports = { parseCookies, cookieMiddleware };
