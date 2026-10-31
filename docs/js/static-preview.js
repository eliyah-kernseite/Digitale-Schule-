(function () {
  'use strict';
  // Vorschau: Registrieren und Login führen in die Demo, alles andere wird kurz erklärt.
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var action = e.target.getAttribute('action') || '';
    var root = document.querySelector('link[rel=stylesheet]').getAttribute('href').split('css/main.css')[0];
    if (action.slice(-13) === 'registrieren/') { window.location.href = root + 'app/freischalten/'; return; }
    if (action.slice(-6) === 'login/') { window.location.href = root + 'app/'; return; }
    window.alert('Das ist nur die Vorschau. Formulare und Zahlung funktionieren erst auf dem echten Server.');
  }, true);
  document.querySelectorAll('video').forEach(function (v) { v.removeAttribute('src'); });
})();
