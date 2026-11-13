/* Start af appen: login, navigation og tegning af den rigtige side. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, A = BA.api, $ = U.$;
  var root = null, lastRoute = '';

  BA.go = function (hash) { if (location.hash === hash) route(); else location.hash = hash; };

  function parseRoute() {
    var h = location.hash.replace(/^#\/?/, '').split('?')[0];
    var p = h.split('/');
    return { name: p[0] || 'lager', arg: p[1] ? decodeURIComponent(p[1]) : '' };
  }

  function setChrome(logged) {
    if (!logged) { document.body.classList.remove('has-side'); var sd = $('#side'); if (sd) sd.hidden = true; }
    document.body.classList.toggle('guest', !logged);
    $('#nav').hidden = !logged; $('#tabbar').hidden = !logged; $('#savestate').hidden = !logged; $('#who').hidden = !logged;
  }

  function markNav(name) {
    var group = name === 'bytte' ? 'lager' : name === 'bil' ? (BA.store.car(parseRoute().arg) && BA.isSold(BA.store.car(parseRoute().arg).status) ? 'solgte' : 'lager') : name;
    U.$$('[data-nav]').forEach(function (a) { if (a.getAttribute('data-nav') === group) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  function route() {
    if (BA.flushEdits) BA.flushEdits();    // en tekst, der er skrevet men ikke gemt endnu, gemmes, før siden skiftes
    if (!A.hasKey()) { BA.views.bilReset(); setChrome(false); BA.views.login(root, BA.loginHint); return; }
    setChrome(true);
    var r = parseRoute();
    var key = r.name + '/' + r.arg;
    if (r.name !== 'ny' && r.name !== 'bil') BA.views.bilReset();
    if (r.name !== 'bytte' && BA.views.byttebilReset) BA.views.byttebilReset();
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
    markNav(r.name);
    var who = (BA.S.device && BA.S.device.person) || U.safeStore.get('ba.person') || '';
    $('#who').textContent = who;
    document.title = 'Bilarkiv';
    switch (r.name) {
      case 'solgte': BA.views.solgte(root); break;
      case 'ny': BA.views.ny(root); break;
      case 'bil': BA.views.bil(root, r.arg); break;
      case 'mere': BA.views.mere(root); break;
      case 'todo': BA.views.todo(root); break;
      case 'overblik': BA.views.overblik(root); break;
      case 'bytte': BA.views.bytte(root); break;
      default: BA.views.lager(root);
    }
    syncSide();
  }

  /** Sidepanelet med to-do (kun på bred skærm, og kun på lageret og bilsiderne) og tallet på To-do-fanen. */
  function syncSide() {
    var side = $('#side'); if (!side) return;
    var r = parseRoute();
    var want = A.hasKey() && window.innerWidth >= 1100 && (r.name === 'lager' || r.name === 'bil') && !!BA.views.todoPanel;
    document.body.classList.toggle('has-side', want);
    side.hidden = !want;
    if (want) BA.views.todoPanel(side);
    if (A.hasKey() && BA.syncTodoBadge) BA.syncTodoBadge();
  }
  BA.syncSide = syncSide;
  window.addEventListener('resize', U.debounce(syncSide, 150));
  // Tiden går: nedtællinger og "i dag" skal følge med, selv om ingen data ændrer sig.
  setInterval(function () {
    if (document.visibilityState !== 'visible' || !A.hasKey()) return;
    if (parseRoute().name === 'todo') { if (!(BA.views.todoRefresh && BA.views.todoRefresh(root))) route(); }
    syncSide();
  }, 60000);

  // Når data ændres, tegnes siden om – men aldrig midt i en indtastning.
  var redrawTimer = 0;
  function onData() {
    if (!A.hasKey()) return;
    var r = parseRoute();
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(function () {
      if (!A.hasKey()) return;
      if (r.name === 'bil') { BA.views.bilUpdate(root); markNav('bil'); syncSide(); return; }
      if (r.name === 'bytte') { if (BA.syncTodoBadge) BA.syncTodoBadge(); return; }   // byttebil-aftalen tegnes ikke om (underskrifter og tekst må ikke forsvinde)
      if (r.name === 'ny') { if (BA.syncTodoBadge) BA.syncTodoBadge(); return; }   // formularen tegnes ikke om af baggrundsopdateringer
      if (r.name === 'todo' && BA.views.todoRefresh && BA.views.todoRefresh(root)) { markNav('todo'); syncSide(); return; }   // kun listerne tegnes om: feltet til nye opgaver beholder sin tekst
      if (BA.focusInside(root)) { if (document.activeElement.id !== 'q') { syncSide(); return; } }
      route();
    }, 30);
  }
  BA.on('data', onData);
  // Listen "Kunne ikke gemmes" under Mere tegnes om, når den ændres.
  BA.on('failed', function () { if (parseRoute().name === 'mere') onData(); });
  BA.on('uploads', function () { if (parseRoute().name === 'mere') onData(); });
  BA.on('status', function () { /* gem-status tegnes i ui.js */ });

  BA.on('authlost', function (msg) {
    A.clearLogin();
    BA.loginHint = msg || 'Du skal logge ind igen.';
    BA.closeAllModals();
    route();
  });
  BA.on('loggedin', function () {
    BA.loginHint = '';
    location.hash = '#/lager';
    start();
  });
  BA.on('loadfail', function (err) {
    if (BA.S.loaded) return;
    var r = parseRoute();
    root.innerHTML = '<div class="empty"><p>' + U.esc(err.message) + '</p><button class="btn primary" id="retryload" type="button">Prøv igen</button></div>';
    $('#retryload').onclick = function () { root.innerHTML = '<div class="skeleton"></div>'; BA.store.refresh(); };
  });

  function start() {
    // Det, telefonen har gemt (kopien af arkivet ligger i IndexedDB), hentes først; derefter tegnes siden.
    if (BA.cleanDrafts) BA.cleanDrafts();   // kladder (kundeoplysninger, underskrifter) ældre end 14 dage slettes
    BA.store.loadLocal().then(function () {
      var qp = BA.store.queuePerson(), me = U.safeStore.get('ba.person') || '', n = BA.store.queueLength();
      if (n && qp && me && qp !== me) {
        // Ikke-sendte ændringer fra en anden person: spørg, før de sendes.
        // Dialogen kan ikke lukkes ved et uheld (Escape/tryk ved siden af): der skal vælges, og sletning bekræftes en gang til.
        BA.store.hold(true);
        BA.modal('Ændringer fra ' + qp, '<p style="margin:0 0 4px">Der ligger ' + n + (n === 1 ? ' ændring' : ' ændringer') + ', som ' + U.esc(qp) + ' lavede på denne enhed og ikke fik sendt. Skal de sendes nu (som ' + U.esc(me) + ')?</p>' +
          '<div class="actions"><button type="button" class="btn danger" data-drop>Slet dem</button><button type="button" class="btn primary" data-send>Send dem</button></div>', function (box, close) {
          box.querySelector('[data-send]').onclick = function () { close(); BA.store.hold(false); BA.store.retry(); };
          box.querySelector('[data-drop]').onclick = function () {
            BA.confirm('Slet ændringerne', 'Er du helt sikker? De kan ikke fortrydes.', 'Ja, slet dem', true).then(function (yes) { if (yes) { close(); BA.store.hold(false); BA.store.dropQueue(); } });
          };
        }, { sticky: true, onClose: function () { BA.store.hold(false); } });
      } else if (n) BA.store.retry();
      route();
      BA.store.refresh();
      BA.up.restore();
    });
  }

  function init() {
    root = $('#view');
    // Skrifterne hentes uden inline-kode (så CSP kan forbyde inline-scripts). Uden net bruges systemets skrifter.
    if (!window.__TEST__) {
      var font = document.createElement('link');
      font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=Teko:wght@500;600&family=Ubuntu:wght@400;500;700&display=swap';
      document.head.appendChild(font);
    }
    // Link med kode og serveradresse: #kode=12345678&server=https://…
    var m = /^#?kode=(\d{8})(?:&server=([^&]+))?$/.exec(location.hash);
    if (m) {
      BA.pairHint = { code: m[1], server: m[2] ? decodeURIComponent(m[2]) : '' };
      history.replaceState(null, '', location.pathname + location.search);
    }
    window.addEventListener('hashchange', route);
    if (!location.hash || /^#?kode=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/lager');
    BA.on('status', function () { /* afhænger af ui.js */ });
    if (A.hasKey()) start(); else route();
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__TEST__) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* appen virker også uden */ });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
