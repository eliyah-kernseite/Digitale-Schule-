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
