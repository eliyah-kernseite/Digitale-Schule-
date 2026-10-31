(function () {
  'use strict';
  // Vorschau: Formulare nicht abschicken, sondern kurz erklären.
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    window.alert('Das ist nur die Vorschau. Formulare, Login und Zahlung funktionieren erst auf dem echten Server.');
  }, true);
  document.querySelectorAll('video').forEach(function (v) { v.removeAttribute('src'); });
})();
