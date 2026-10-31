(function () {
  'use strict';

  // Rückfrage vor folgenschweren Formularen (ohne Inline-Skripte wegen CSP).
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });

  // Einfache Passwort-Rückmeldung (die echte Prüfung macht der Server).
  document.querySelectorAll('input[data-strength]').forEach(function (input) {
    var out = input.closest('form').querySelector('.strength');
    if (!out) return;
    input.addEventListener('input', function () {
      var v = input.value;
      var score = 0;
      if (v.length >= 10) score++;
      if (v.length >= 14) score++;
      if (/[a-zäöüß]/.test(v) && /[A-ZÄÖÜ]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^A-Za-z0-9äöüÄÖÜß]/.test(v)) score++;
      var labels = ['zu kurz', 'schwach', 'okay', 'gut', 'stark', 'sehr stark'];
      out.hidden = v.length === 0;
      out.textContent = 'Passwortstärke: ' + (v.length < 10 ? labels[0] : labels[score]);
    });
  });
})();

(function () {
  'use strict';
  document.documentElement.classList.add('js');
  var btn = document.querySelector('.nav-btn');
  var nav = document.getElementById('hauptmenue');
  if (!btn || !nav) return;
  btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();

/* Bewegung: Einblenden beim Scrollen, Wortwechsel, Lichtschein, Zähler.
   Alles respektiert "Bewegung reduzieren" im Betriebssystem. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var doc = document.documentElement;

  // Zähler von 0 hochlaufen lassen
  function countUp(el) {
    var target = Number(el.getAttribute('data-count')) || 0;
    if (reduce || target < 2) return;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / 1100);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) window.requestAnimationFrame(step);
    }
    el.textContent = '0';
    window.requestAnimationFrame(step);
  }

  // Einblenden mit kleinem Versatz zwischen Geschwistern
  var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal], [data-path], .lockdemo, .course-head'));
  items.forEach(function (el) {
    var sibs = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) { return c.hasAttribute('data-reveal'); }) : [];
    var i = sibs.indexOf(el);
    if (i > 0) el.style.setProperty('--d', Math.min(i * 0.08, 0.48) + 's');
  });
  function show(el) {
    el.classList.add('is-in');
    el.querySelectorAll('[data-count]').forEach(countUp);
  }
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(show);
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
  }

  // Wechselndes Wort in der Überschrift
  document.querySelectorAll('[data-rotator]').forEach(function (r) {
    var words = r.children;
    if (reduce || words.length < 2) return;
    var i = 0;
    window.setInterval(function () {
      var prev = words[i];
      prev.classList.remove('is-on');
      prev.classList.add('was-on');
      window.setTimeout(function () { prev.classList.remove('was-on'); }, 400);
      i = (i + 1) % words.length;
      words[i].classList.add('is-on');
    }, 2300);
  });

  // Satz, der Wort für Wort aufleuchtet
  var statements = [];
  document.querySelectorAll('[data-words]').forEach(function (el) {
    if (reduce) return;
    var hot = /^(Kraft|Geld|Ruhe|respektiert|Plan)/;
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach(function (w, idx) {
      var s = document.createElement('span');
      s.className = 'w' + (hot.test(w) ? ' hot' : '');
      s.textContent = w;
      el.appendChild(s);
      if (idx < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    statements.push({ el: el, spans: el.querySelectorAll('.w') });
  });

  // Scroll: Fortschrittsbalken, kleiner Kopf, leuchtende Wörter
  var ticking = false;
  function onScroll() {
    ticking = false;
    var max = doc.scrollHeight - window.innerHeight;
    doc.style.setProperty('--scroll', max > 0 ? (window.scrollY / max).toFixed(4) : '0');
    doc.classList.toggle('is-scrolled', window.scrollY > 24);
    var vh = window.innerHeight;
    statements.forEach(function (st) {
      var r = st.el.getBoundingClientRect();
      var p = (vh * 0.85 - r.top) / (r.height + vh * 0.3);
      var lit = Math.round(Math.max(0, Math.min(1, p)) * st.spans.length);
      for (var k = 0; k < st.spans.length; k++) st.spans[k].classList.toggle('on', k < lit);
    });
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  // Lichtschein folgt der Maus
  if (!reduce && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('[data-glow]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    });
  }

  // Paywall: Monatsbetrag mit und ohne Telegram-Kreis
  document.querySelectorAll('[data-pricing]').forEach(function (form) {
    var toggle = form.querySelector('[data-addon-toggle]');
    var total = form.querySelector('[data-total]');
    var note = form.querySelector('[data-total-note]');
    if (!toggle || !total) return;
    var num = function (v) { return Number(String(v).replace(',', '.')) || 0; };
    var base = num(form.getAttribute('data-base'));
    var addon = num(form.getAttribute('data-addon'));
    var fmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
    function update() {
      total.textContent = fmt.format(base + (toggle.checked ? addon : 0)) + ' €';
      if (note) note.textContent = toggle.checked ? 'inkl. Telegram-Kreis' : '';
      total.classList.remove('bump');
      void total.offsetWidth;
      total.classList.add('bump');
    }
    toggle.addEventListener('change', update);
    if (toggle.checked) update();
  });
})();
