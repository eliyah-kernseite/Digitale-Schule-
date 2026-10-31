/*
 * Seminar-Player: kein Vorspulen, keine Geschwindigkeitsänderung.
 * Der Browser verhindert das Überspringen für die Bedienung; die eigentliche
 * Prüfung macht der Server, der Fortschritt nur in Echtzeit anrechnet.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-player]');
  if (!root) return;

  var video = root.querySelector('video');
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

  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function limit() {
    return done ? Infinity : allowed;
  }

  function render() {
    var d = duration || video.duration || 1;
    var w = done ? 100 : Math.min(100, (allowed / d) * 100);
    watchedBar.style.width = w + '%';
    posBar.style.left = Math.min(100, (video.currentTime / d) * 100) + '%';
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(d);
    var icon = video.paused ? '▶' : '❚❚';
    playBtns.forEach(function (b) { if (b.classList.contains('player-btn')) b.textContent = icon; });
    overlay.hidden = !video.paused;
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

  function beat() {
    if (sending || done && !video.paused) return;
    sending = true;
    fetch('/app/seminare/' + encodeURIComponent(id) + '/fortschritt', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ position: video.currentTime }),
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
    if (video.paused) video.play().catch(function () {});
    else video.pause();
  }

  video.addEventListener('loadedmetadata', function () {
    if (!duration) duration = Math.floor(video.duration);
    if (!done && allowed > 1 && allowed < video.duration - 1) video.currentTime = allowed;
    render();
  });

  video.addEventListener('timeupdate', function () {
    if (!done && video.currentTime > allowed + 1.5) {
      video.currentTime = allowed;
    } else if (!done && !video.seeking) {
      allowed = Math.max(allowed, Math.min(video.currentTime, allowed + 1.5));
    }
    render();
  });

  video.addEventListener('seeking', function () {
    if (!done && video.currentTime > allowed + 0.5) video.currentTime = allowed;
  });

  video.addEventListener('ratechange', function () {
    if (video.playbackRate !== 1) video.playbackRate = 1;
  });

  video.addEventListener('play', startBeats);
  video.addEventListener('pause', stopBeats);
  video.addEventListener('ended', stopBeats);
  video.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  playBtns.forEach(function (b) { b.addEventListener('click', toggle); });
  video.addEventListener('click', toggle);

  root.querySelector('[data-back]').addEventListener('click', function () {
    video.currentTime = Math.max(0, video.currentTime - 10);
  });

  root.querySelector('[data-fs]').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });

  track.addEventListener('click', function (e) {
    var rect = track.getBoundingClientRect();
    var target = ((e.clientX - rect.left) / rect.width) * (duration || video.duration);
    video.currentTime = Math.min(target, limit());
  });

  chapterBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var t = Number(b.getAttribute('data-seek'));
      if (t <= limit() + 1) {
        video.currentTime = t;
        video.play().catch(function () {});
      }
    });
  });

  root.tabIndex = 0;
  root.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); video.currentTime = Math.min(video.currentTime + 5, limit()); }
  });

  // Wer den Tab verlässt, pausiert: Fortschritt zählt nur, wenn du dabei bist.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !video.paused && !document.pictureInPictureElement) video.pause();
  });

  render();
})();
