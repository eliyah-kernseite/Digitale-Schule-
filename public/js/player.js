/*
 * Seminar-Player: kein Vorspulen, keine Geschwindigkeitsänderung.
 * Funktioniert mit eigenen Videodateien und mit Vimeo. Der Browser verhindert
 * das Überspringen für die Bedienung; die eigentliche Prüfung macht der Server,
 * der Fortschritt nur in Echtzeit anrechnet.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-player]');
  if (!root) return;

  var id = root.getAttribute('data-id');
  var csrf = root.getAttribute('data-csrf');
  var duration = Number(root.getAttribute('data-duration')) || 0;
  var allowed = Number(root.getAttribute('data-watched')) || 0;
  var done = root.getAttribute('data-done') === 'true';
  var playBtns = root.querySelectorAll('[data-play]');
  var overlay = root.querySelector('[data-overlay]');
  var watchedBar = root.querySelector('[data-watched-bar]');
  var posBar = root.querySelector('[data-pos-bar]');
  var timeEl = root.querySelector('[data-time]');
  var hint = root.querySelector('[data-hint]');
  var track = root.querySelector('.player-track');
  var chapterBtns = document.querySelectorAll('[data-seek]');
  var form = document.querySelector('[data-task-form]');
  var beatTimer = null;
  var sending = false;

  function limit() {
    return done ? Infinity : allowed;
  }

  /* ---------- Einheitliche Schnittstelle für Datei und Vimeo ---------- */

  var media = (function () {
    var video = root.querySelector('video');
    var handlers = {};
    function emit(name) { (handlers[name] || []).forEach(function (fn) { fn(); }); }
    var api = { on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); } };

    if (video) {
      api.time = function () { return video.currentTime; };
      api.seek = function (t) { video.currentTime = t; };
      api.play = function () { video.play().catch(function () {}); };
      api.pause = function () { video.pause(); };
      api.paused = function () { return video.paused; };
      api.length = function () { return video.duration || 0; };
      video.addEventListener('loadedmetadata', function () { emit('ready'); });
      video.addEventListener('timeupdate', function () { emit('time'); });
      video.addEventListener('seeking', function () {
        if (!done && video.currentTime > allowed + 0.5) video.currentTime = allowed;
      });
      video.addEventListener('ratechange', function () {
        if (video.playbackRate !== 1) video.playbackRate = 1;
      });
      video.addEventListener('play', function () { emit('play'); });
      video.addEventListener('pause', function () { emit('pause'); });
      video.addEventListener('ended', function () { emit('pause'); });
      video.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      video.addEventListener('click', function () { if (api.paused()) api.play(); else api.pause(); });
      return api;
    }

    // Vimeo: der Player läuft in einem iframe, gesteuert über die offizielle Player-Bibliothek.
    var el = root.querySelector('[data-vimeo]');
    var state = { t: 0, paused: true, d: 0 };
    // Das iframe kommt fertig vom Server, so braucht die Bibliothek keine Anfrage an vimeo.com.
    var player = new window.Vimeo.Player(el);
    api.time = function () { return state.t; };
    api.seek = function (t) { state.t = t; player.setCurrentTime(t).catch(function () {}); };
    api.play = function () { player.play().catch(function () {}); };
    api.pause = function () { player.pause().catch(function () {}); };
    api.paused = function () { return state.paused; };
    api.length = function () { return state.d; };
    player.ready().then(function () {
      return player.getDuration();
    }).then(function (d) {
      state.d = d;
      emit('ready');
    }).catch(function () {
      hint.textContent = 'Das Video konnte nicht geladen werden. Bitte lade die Seite neu.';
    });
    player.on('timeupdate', function (data) {
      state.t = data.seconds;
      if (data.duration) state.d = data.duration;
      emit('time');
    });
    player.on('seeked', function (data) {
      state.t = data.seconds;
      if (!done && data.seconds > allowed + 1) api.seek(allowed);
    });
    player.on('playbackratechange', function (data) {
      if (data.playbackRate !== 1) player.setPlaybackRate(1).catch(function () {});
    });
    player.on('play', function () { state.paused = false; emit('play'); });
    player.on('pause', function () { state.paused = true; emit('pause'); });
    player.on('ended', function () { state.paused = true; emit('pause'); });
    return api;
  })();

  /* ---------- Anzeige ---------- */

  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function render() {
    var d = duration || media.length() || 1;
    var now = media.time();
    var w = done ? 100 : Math.min(100, (allowed / d) * 100);
    watchedBar.style.width = w + '%';
    posBar.style.left = Math.min(100, (now / d) * 100) + '%';
    timeEl.textContent = fmt(now) + ' / ' + fmt(d);
    var icon = media.paused() ? '▶' : '❚❚';
    playBtns.forEach(function (b) { if (b.classList.contains('player-btn')) b.textContent = icon; });
    overlay.hidden = !media.paused();
    chapterBtns.forEach(function (b) {
      b.disabled = Number(b.getAttribute('data-seek')) > limit() + 1;
    });
  }

  function unlockTask() {
    if (!form) return;
    form.querySelectorAll('[disabled]').forEach(function (el) { el.disabled = false; });
    var h = form.querySelector('[data-task-hint]');
    if (h) h.hidden = true;
  }

  /* ---------- Fortschritt an den Server ---------- */

  function beat() {
    if (sending || (done && !media.paused())) return;
    sending = true;
    fetch('/app/seminare/' + encodeURIComponent(id) + '/fortschritt', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ position: media.time() }),
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) { hint.textContent = 'Deine Sitzung ist abgelaufen. Bitte lade die Seite neu.'; }
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (!data) return;
      allowed = Math.max(allowed, Number(data.watched) || 0);
      if (data.videoDone && !done) {
        done = true;
        unlockTask();
        hint.textContent = 'Seminar vollständig angesehen. Jetzt die Aufgabe abgeben.';
        hint.classList.add('ok');
      }
      render();
    }).catch(function () {
      hint.textContent = 'Keine Verbindung. Dein Fortschritt wird gespeichert, sobald du wieder online bist.';
    }).finally(function () { sending = false; });
  }

  function startBeats() {
    if (beatTimer) return;
    beat();
    beatTimer = setInterval(beat, 5000);
  }

  function stopBeats() {
    clearInterval(beatTimer);
    beatTimer = null;
    beat();
  }

  function toggle() {
    if (media.paused()) media.play();
    else media.pause();
  }

  /* ---------- Ereignisse ---------- */

  media.on('ready', function () {
    if (!duration) duration = Math.floor(media.length());
    if (!done && allowed > 1 && allowed < media.length() - 1) media.seek(allowed);
    render();
  });

  media.on('time', function () {
    var now = media.time();
    if (!done && now > allowed + 1.5) {
      media.seek(allowed);
    } else if (!done) {
      allowed = Math.max(allowed, Math.min(now, allowed + 1.5));
    }
    render();
  });

  media.on('play', function () { startBeats(); render(); });
  media.on('pause', function () { stopBeats(); render(); });

  playBtns.forEach(function (b) { b.addEventListener('click', toggle); });

  root.querySelector('[data-back]').addEventListener('click', function () {
    media.seek(Math.max(0, media.time() - 10));
  });

  root.querySelector('[data-fs]').addEventListener('click', function () {
    var video = root.querySelector('video');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen();
    else if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });

  track.addEventListener('click', function (e) {
    var rect = track.getBoundingClientRect();
    var target = ((e.clientX - rect.left) / rect.width) * (duration || media.length());
    media.seek(Math.min(target, limit()));
  });

  chapterBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var t = Number(b.getAttribute('data-seek'));
      if (t <= limit() + 1) {
        media.seek(t);
        media.play();
      }
    });
  });

  root.tabIndex = 0;
  root.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); media.seek(Math.max(0, media.time() - 5)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); media.seek(Math.min(media.time() + 5, limit())); }
  });

  // Wer den Tab verlässt, pausiert: Fortschritt zählt nur, wenn du dabei bist.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !media.paused() && !document.pictureInPictureElement) media.pause();
  });

  render();
})();
