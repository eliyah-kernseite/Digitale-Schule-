'use strict';

const crypto = require('node:crypto');

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(String(value)).digest('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { randomToken, sha256, hmac, safeEqual };
