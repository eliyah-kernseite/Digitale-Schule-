'use strict';

/**
 * Einfacher Rate-Limiter im Speicher (feste Zeitfenster). Reicht für eine
 * einzelne Server-Instanz; bei mehreren Instanzen durch Redis o. ä. ersetzen.
 */
class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  /** Zählt einen Versuch. Gibt true zurück, solange das Limit nicht überschritten ist. */
  hit(name, key, limit, windowMs) {
    const id = `${name}:${key}`;
    const now = Date.now();
    let b = this.buckets.get(id);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      this.buckets.set(id, b);
    }
    b.count += 1;
    return b.count <= limit;
  }

  reset(name, key) {
    this.buckets.delete(`${name}:${key}`);
  }

  sweep() {
    const now = Date.now();
    for (const [id, b] of this.buckets) if (b.reset <= now) this.buckets.delete(id);
  }

  stop() {
    clearInterval(this.timer);
  }
}

/** Middleware-Fabrik: begrenzt Anfragen pro IP (oder eigenem Schlüssel). */
function limit(limiter, name, max, windowMs, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    if (limiter.hit(name, keyFn(req), max, windowMs)) return next();
    res.status(429);
    res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
    if (req.accepts(['html', 'json']) === 'json') return res.json({ error: 'Zu viele Anfragen. Bitte warte kurz.' });
    return res.render('error.njk', {
      title: 'Kurz durchatmen',
      message: 'Zu viele Versuche in kurzer Zeit. Bitte warte ein paar Minuten und versuche es dann erneut.',
    });
  };
}

module.exports = { RateLimiter, limit };
