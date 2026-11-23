/* To-do: fanen To-do, sidepanelet på pc, bookinger (kalender), egne opgaver og laderen.
 * Reglerne for, hvad der står på listen, ligger i todo.js (BA.todo). Her er kun tegning og knapper.
 * Alt, der krydses af, går gennem den almindelige kø (store.js): det virker uden net og kan ikke gå tabt. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;
  var V = BA.views = BA.views || {};
  var T = BA.todo;
  var WD = ['søn', 'man', 'tirs', 'ons', 'tors', 'fre', 'lør'];

  BA.todoCtx = function () {
    return { now: Date.now(), cars: BA.S.cars, items: BA.S.items, settings: BA.S.settings, local: U.local,
      // Er den forventede avance under grænsen? (låsen før salg beder om din accept, hvis ja)
      belowMin: function (car) { var lvl = BA.profitLevel(BA.calc(car, BA.S.items, BA.S.settings), BA.S.settings); return lvl === 'warn' || lvl === 'bad'; } };
  };
  BA.todoList = function () { return T.compute(BA.todoCtx()); };
  BA.todoCount = function () { return T.count(BA.todoList()); };

  function carOptions(selected, blank) {
    var cars = BA.S.cars.filter(function (c) { return !BA.isSold(c.status); }).sort(function (a, b) { return T.carLabel(a) < T.carLabel(b) ? -1 : 1; });
    return BA.options(cars.map(function (c) { return { value: c.id, label: T.carLabel(c) }; }), selected, blank);
  }
  function dayHead(iso, today) {
    if (iso === today) return 'I dag';
    if (iso === T.addDaysIso(today, 1)) return 'I morgen';
    var d = new Date(T.dayNum(iso) * 864e5);
    return WD[d.getUTCDay()] + ' ' + T.fmtIso(iso).slice(0, 5);
  }

  // ---------------------------------------------------------------------------
  // Afkrydsning
  // ---------------------------------------------------------------------------
  function perform(e) {
    var a = e && e.action; if (!a) return;
    if (a.kind === 'tick') {
      var id = BA.store.addItem(a.carId, 'tick', { kind: a.tick, at: Date.now() });
      BA.toast(BA.store.tickName(a.tick) + ' ✓', { action: 'Fortryd', onAction: function () { BA.store.deleteItem(id); }, ms: 7000 });
    } else if (a.kind === 'todo') {
      BA.store.updateItem(a.id, { done: true, doneAt: Date.now() });
      BA.toast('Opgaven er udført ✓', { action: 'Fortryd', onAction: function () { BA.store.updateItem(a.id, { done: false, doneAt: null }); }, ms: 7000 });
    } else if (a.kind === 'booking') {
      BA.store.updateItem(a.id, { done: true });
      BA.toast('Markeret som afholdt ✓', { action: 'Fortryd', onAction: function () { BA.store.updateItem(a.id, { done: false }); }, ms: 7000 });
    } else if (a.kind === 'bookingready') {
      var bk = BA.store.item(a.id); if (!bk) return;
      var before = { ready: bk.ready || '', readyDay: bk.readyDay || '' };
      BA.store.updateItem(a.id, T.readyPatch(bk, BA.S.settings, U.local));
      BA.toast('Bilen er klar ✓', { action: 'Fortryd', onAction: function () { BA.store.updateItem(a.id, before); }, ms: 7000 });
    } else if (a.kind === 'bookingcancel') {
      BA.store.updateItem(a.id, { cancelled: true });
      BA.toast('Aftalen er aflyst.', { action: 'Fortryd', onAction: function () { BA.store.updateItem(a.id, { cancelled: false }); }, ms: 9000 });
    }
  }

  /** Et ønske fra h-auto.dk: ring op, og book tiden direkte fra linjen. */
  function leadHtml(e) {
    var it = e.lead ? BA.store.item(e.id) : null;
    if (!it) return '';
    var tel = String(it.phone || '').replace(/[^0-9+]/g, '');
    return (tel ? '<a class="btn small" href="tel:' + esc(tel) + '" aria-label="' + esc('Ring til ' + (it.who || 'kunden')) + '">Ring</a>' : '') +
      '<button type="button" class="btn small primary" data-todo-book="' + esc(e.key) + '" aria-label="' + esc('Book tid til ' + (it.who || 'kunden')) + '">Book tid</button>';
  }

  function rowHtml(e) {
    var btn = e.action ? '<button type="button" class="btn small todo-ok" data-todo-act="' + esc(e.key) + '" aria-label="' + esc(e.label + ': ' + e.text) + '">✓ ' + esc(e.label) + '</button>' : '';
    var edit = e.kind === 'todo' || e.kind === 'booking' || e.kind === 'prep' || e.kind === 'sold' ? '<button type="button" class="icon-btn" data-todo-edit="' + esc(e.key) + '" aria-label="Ret">✎</button>' : '';
    var link = e.carId ? '<a class="todo-car" href="#/bil/' + esc(e.carId) + '">Åbn bilen ›</a>' : '';
    return '<div class="todo-row p' + e.prio + '" data-key="' + esc(e.key) + '"><div class="main"><div class="t">' + esc(e.text) + '</div>' +
      (e.sub ? '<div class="m">' + esc(e.sub) + '</div>' : '') + link + '</div><div class="acts">' + leadHtml(e) + edit + btn + '</div></div>';
  }
  /** Lille mærke på en booking: er bilen klar? */
  function readyChip(b) {
    var st = T.settingsOf(BA.S.settings);
    if (!st.bookingChecks.length) return '';
    var miss = T.bookingMissing(b, BA.S.settings, U.local);
    return miss.length ? ' <span class="chip warn">Mangler ' + miss.length + '</span>' : ' <span class="chip ok">Klar ✓</span>';
  }
  /** Linjen under en booking: kunden, og hvad der mangler (skrevet ud, så det også kan læses på telefon og af en skærmlæser). */
  function bookingLines(b) {
    var miss = T.settingsOf(BA.S.settings).bookingChecks.length ? T.bookingMissing(b, BA.S.settings, U.local) : [];
    return (T.bookingSub(b) ? '<div class="m">' + esc(T.bookingSub(b)) + '</div>' : '') + (miss.length ? '<div class="m">Mangler: ' + esc(miss.join(', ')) + '</div>' : '');
  }
  function groupsHtml(list, opts) {
    opts = opts || {};
    var out = '';
    T.GROUPS.forEach(function (name, prio) {
      var rows = list.filter(function (e) { return e.prio === prio; });
      if (opts.skipLater && prio === 2) return;
      if (!rows.length) return;
      out += '<div class="todo-group g' + prio + '"><div class="eyebrow">' + esc(name) + ' <span class="cnt">' + rows.length + '</span></div>' + rows.slice(0, opts.max || 99).map(rowHtml).join('') +
        (opts.max && rows.length > opts.max ? '<div class="muted small" style="padding:6px 0">… og ' + (rows.length - opts.max) + ' mere</div>' : '') + '</div>';
    });
    return out;
  }

  var bound = [];
  /** Knapperne i en liste (fanen og sidepanelet). Bindes én gang pr. element; finder altid linjen i den friske liste. */
  function bindList(el) {
    if (bound.indexOf(el) >= 0) return;
    bound.push(el);
    el.addEventListener('click', function (ev) {
      var okb = ev.target.closest('[data-todo-act]');
      if (okb && el.contains(okb)) {
        var key = okb.getAttribute('data-todo-act');
        var e = BA.todoList().filter(function (x) { return x.key === key; })[0];
        if (e) perform(e); else BA.toast('Den er allerede krydset af.');
        return;
      }
      var bkb = ev.target.closest('[data-todo-book]');
      if (bkb && el.contains(bkb)) {
        var kb = bkb.getAttribute('data-todo-book');
        var eb = BA.todoList().filter(function (x) { return x.key === kb; })[0];
        var lead = eb ? BA.store.item(eb.id) : null;
        if (lead) openBooking(null, lead.carId || '', { id: lead.id, text: lead.text || '', who: lead.who || '', phone: lead.phone || '',
          note: String(lead.note || '').replace(/^Tlf\. [^·]*(· )?/, lead.phone ? '' : '$&').trim() });   // telefonen står allerede i sit eget felt
        return;
      }
      var ed = ev.target.closest('[data-todo-edit]');
      if (ed && el.contains(ed)) {
        var k2 = ed.getAttribute('data-todo-edit');
        var e2 = BA.todoList().filter(function (x) { return x.key === k2; })[0];
        if (!e2) return;
        var item = BA.store.item(e2.id);
        if (item && item.type === 'booking') openBooking(item); else if (item) openTodo(item);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Bookinger og egne opgaver: dialoger
  // ---------------------------------------------------------------------------
  /** lead (valgfri): et ønske fra h-auto.dk. Navn og telefon er udfyldt, og opgaven "Ring til ..." krydses af, når bookingen gemmes. */
  function openBooking(item, carId, lead) {
    var cur = item || { start: null, kind: 'Prøvetur', who: lead ? lead.who : '', phone: lead ? lead.phone : '', note: lead ? lead.note : '', ready: '' };
    var checkList = T.settingsOf(BA.S.settings).bookingChecks, have = T.readyList(cur, U.local);
    // Værdierne, da dialogen blev åbnet: kun det, du selv ændrer, bliver gemt (en aftale, der flyttes i Google imens, overskrives ikke)
    var opened = item ? { start: item.start, kind: item.kind, who: item.who || '', phone: item.phone || '', note: item.note || '', ready: item.ready || '', readyDay: item.readyDay || '' } : null;   // de rå værdier: også gamle kryds, der ikke gælder længere, skal kunne ryddes
    var ls = cur.start ? U.local(cur.start) : '';
    var date = ls ? ls.slice(0, 10) : U.today(), time = ls ? ls.slice(11, 16) : '';
    var selCar = item ? item.carId : (carId || '');
    var carSel = item
      ? '<div class="field"><label>Bil</label><div class="pre" style="min-height:0">' + esc(BA.store.car(item.carId) ? T.carLabel(BA.store.car(item.carId)) : 'Bilen findes ikke længere') + '</div></div>'
      : '<div class="field"><label for="bk-car">Bil *</label><select id="bk-car">' + carOptions(selCar, '– vælg bil –') + '</select><div class="errtxt" data-err="car" role="alert"></div></div>';
    var html = '<form novalidate>' + (lead && lead.text ? '<div class="banner" style="margin-bottom:10px">' + esc(lead.text) + '</div>' : '') + carSel +
      '<div class="grid2"><div class="field"><label for="bk-date">Dato *</label><input type="date" id="bk-date" value="' + esc(date) + '"><div class="errtxt" data-err="date" role="alert"></div></div>' +
      '<div class="field"><label for="bk-time">Klokken *</label><input type="time" id="bk-time" value="' + esc(time) + '"><div class="errtxt" data-err="time" role="alert"></div></div></div>' +
      '<div class="field"><label for="bk-kind">Hvad er det?</label><select id="bk-kind">' + BA.options(T.BOOKING_KINDS, cur.kind || 'Prøvetur') + '</select></div>' +
      '<div class="grid2"><div class="field"><label for="bk-who">Kundens navn</label><input id="bk-who" maxlength="100" value="' + esc(cur.who) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="bk-phone">Telefon</label><input id="bk-phone" type="tel" inputmode="tel" maxlength="20" value="' + esc(cur.phone) + '" autocomplete="off"><div class="errtxt" data-err="phone" role="alert"></div></div></div>' +
      '<div class="field"><label for="bk-note">Note</label><textarea id="bk-note" rows="2" maxlength="1000">' + esc(cur.note) + '</textarea></div>' +
      (checkList.length ? '<fieldset style="border:0;padding:0;margin:0 0 12px"><legend class="eyebrow" style="padding:0;margin-bottom:4px">Er bilen klar?</legend>' +
        checkList.map(function (c) { return '<label class="check"><input type="checkbox" data-bk-check value="' + esc(c) + '"' + (have.indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(c) + '</label>'; }).join('') + '</fieldset>' : '') +
      '<div data-bk-warn role="status"></div>' +
      '<div class="actions">' + (item ? '<button type="button" class="btn danger" data-cancelbk>Aflys booking</button>' : '') + '<button type="button" class="btn" data-cancel>Luk</button><button type="submit" class="btn primary">Gem</button></div></form>';
    BA.modal(item ? 'Ret booking' : 'Book prøvetur / fremvisning', html, function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      // Advarsler: bilen er ikke klar, eller tiden overlapper en anden aftale. De blokerer ikke: du kan have en god grund.
      var showWarnings = function () {
        var cid = item ? item.carId : $('#bk-car', box).value, carObj = cid ? BA.store.car(cid) : null, ctx = BA.todoCtx(), msgs = [];
        var w = carObj ? T.bookingCarWarning(carObj, ctx) : '';
        if (w) msgs.push(w);
        var dv = $('#bk-date', box).value, tv = $('#bk-time', box).value, at = dv && tv ? U.localToMs(dv, tv) : null;
        if (at !== null) {
          if (at < Date.now() && (!item || at !== item.start)) msgs.push('Det tidspunkt er allerede passeret.');
          T.bookingClashes(ctx, at, item ? item.id : '').forEach(function (x) { msgs.push('Du har allerede: ' + T.bookingText(x.booking, x.car, U.local, true) + '.'); });
        }
        if (item && have.length && dv && dv !== date) msgs.push('Ny dato: bilen skal tjekkes igen, så krydsene er fjernet.');
        $('[data-bk-warn]', box).innerHTML = msgs.length ? '<div class="banner warn">' + msgs.map(esc).join('<br>') + '</div>' : '';
      };
      // Krydsene gælder den dag, de er sat til. Ændres datoen, fjernes de; sættes den tilbage, kommer de igen.
      var shownDay = date;
      var onDay = function () {
        var dv = $('#bk-date', box).value;
        if (item && dv && dv !== shownDay) U.$$('[data-bk-check]', box).forEach(function (x) { x.checked = dv === date && have.indexOf(x.value) >= 0; });
        if (dv) shownDay = dv;
      };
      $('#bk-date', box).addEventListener('change', onDay);
      ['#bk-car', '#bk-date', '#bk-time'].forEach(function (sel) { var f = $(sel, box); if (f) { f.addEventListener('change', showWarnings); f.addEventListener('input', showWarnings); } });
      showWarnings();
      var cb = $('[data-cancelbk]', box);
      if (cb) cb.onclick = function () {
        close();
        BA.confirm('Aflys booking', 'Aflys ' + T.bookingText(item, BA.store.car(item.carId) || { reg: '', model: 'bilen' }, U.local, true) + '?', 'Aflys', true).then(function (yes) {
          if (!yes) return;
          BA.store.updateItem(item.id, { cancelled: true });
          BA.toast('Bookingen er aflyst.', { action: 'Fortryd', onAction: function () { BA.store.updateItem(item.id, { cancelled: false }); }, ms: 9000 });
        });
      };
      $('form', box).onsubmit = function (ev) {
        ev.preventDefault();
        U.$$('.errtxt', box).forEach(function (x) { x.textContent = ''; });
        var err = function (k, m) { var x = $('[data-err=' + k + ']', box); if (x) x.textContent = m; };
        var car = item ? item.carId : $('#bk-car', box).value, d = $('#bk-date', box).value, t = $('#bk-time', box).value, ph = $('#bk-phone', box).value.trim();
        var bad = false;
        if (!car) { err('car', 'Vælg en bil.'); bad = true; }
        var ms = U.localToMs(d, t);
        if (!d) { err('date', 'Vælg en dato.'); bad = true; }
        if (!t) { err('time', 'Skriv klokkeslættet.'); bad = true; }
        else if (d && ms === null) { err('time', 'Det tidspunkt findes ikke.'); bad = true; }
        if (ph && !/^[0-9+() \-]{3,20}$/.test(ph)) { err('phone', 'Telefonnummeret ser forkert ud.'); bad = true; }
        if (bad) return;
        var ready = U.$$('[data-bk-check]', box).filter(function (x) { return x.checked; }).map(function (x) { return x.value; }).join('|');
        var data = { start: ms, kind: $('#bk-kind', box).value, who: $('#bk-who', box).value.trim().replace(/\s+/g, ' '), phone: ph, note: $('#bk-note', box).value.trim(), ready: ready, readyDay: ready ? d : '' };
        if (lead && lead.id) data.leadId = lead.id;      // serveren krydser "Ring til ..." af, når bookingen er gemt
        if (item) BA.store.updateItem(item.id, data, opened); else BA.store.addItem(car, 'booking', data);
        close();
        BA.toast(item ? 'Bookingen er rettet.' : 'Bookingen er oprettet.');
      };
    });
  }

  function openTodo(item, carId) {
    var cur = item || { text: '', due: '', note: '' };
    var carSel = item
      ? (item.carId && BA.store.car(item.carId) ? '<div class="field"><label>Bil</label><div class="pre" style="min-height:0">' + esc(T.carLabel(BA.store.car(item.carId))) + '</div></div>' : '')
      : '<div class="field"><label for="td-car">Hører til en bil? (valgfri)</label><select id="td-car">' + carOptions(carId || '', '– ingen bil –') + '</select></div>';
    var html = '<form novalidate><div class="field"><label for="td-text">Hvad skal gøres? *</label><input id="td-text" maxlength="200" value="' + esc(cur.text) + '" autocomplete="off"><div class="errtxt" data-err="text"></div></div>' +
      '<div class="field"><label for="td-due">Frist (valgfri)</label><input type="date" id="td-due" value="' + esc(cur.due) + '"></div>' + carSel +
      '<div class="field"><label for="td-note">Note</label><textarea id="td-note" rows="2" maxlength="1000">' + esc(cur.note) + '</textarea></div>' +
      '<div class="actions">' + (item ? '<button type="button" class="btn danger" data-del>Slet</button>' : '') + '<button type="button" class="btn" data-cancel>Luk</button><button type="submit" class="btn primary">Gem</button></div></form>';
    BA.modal(item ? 'Ret opgave' : 'Ny opgave', html, function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      var del = $('[data-del]', box);
      if (del) del.onclick = function () {
        close();
        BA.confirm('Slet opgaven', 'Er du sikker? Du kan fortryde lige efter.', 'Slet', true).then(function (yes) {
          if (!yes) return;
          var copy = BA.store.deleteItem(item.id);
          if (copy) BA.toast('Slettet.', { action: 'Fortryd', onAction: function () { BA.store.restoreItem(copy); }, ms: 9000 });
        });
      };
      $('form', box).onsubmit = function (ev) {
        ev.preventDefault();
        var text = $('#td-text', box).value.trim().replace(/\s+/g, ' ');
        if (!text) { $('[data-err=text]', box).textContent = 'Skriv, hvad der skal gøres.'; $('#td-text', box).classList.add('invalid'); return; }
        var data = { text: text, due: $('#td-due', box).value, note: $('#td-note', box).value.trim() };
        if (item) BA.store.updateItem(item.id, data);
        else BA.store.addItem($('#td-car', box).value || '', 'todo', data);
        close();
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Fanen To-do
  // ---------------------------------------------------------------------------
  var HIDE_TG = 'ba.todo.tghide';
  /** Hvilken knap har tastaturfokus? Så fokus kan flyttes tilbage, når listen tegnes om (hvert minut og ved hver ændring). */
  var FOCUS_ATTRS = ['data-todo-act', 'data-todo-book', 'data-todo-edit', 'data-bk-edit', 'data-bk-new', 'data-todo-new', 'data-hide-tg'];
  function focusSig(container) {
    var a = document.activeElement;
    if (!a || a === document.body || !container.contains(a)) return null;
    for (var i = 0; i < FOCUS_ATTRS.length; i++) if (a.hasAttribute(FOCUS_ATTRS[i])) return { attr: FOCUS_ATTRS[i], val: a.getAttribute(FOCUS_ATTRS[i]) };
    return null;
  }
  function restoreFocus(container, sig) {
    if (!sig) return;
    var el = container.querySelector('[' + sig.attr + (sig.val ? '="' + String(sig.val).replace(/["\\]/g, '\\$&') + '"' : '') + ']');
    if (el) { try { el.focus(); } catch (e) { /* ingen */ } }
  }

  /** Virker kalender og To Do? Telegram er valgfrit, så det her skal ses, uanset om det er sat op. */
  function syncNote() {
    var r = BA.S.reminders, s = BA.S.sync || {}, out = '';
    var uses = (s.cal && s.cal.on) || (s.ms && s.ms.on);
    // Kun når appen selv har forbindelse: ellers er tidspunktet bare gammelt, fordi telefonen er uden net
    if (uses && r && !r.configured && BA.S.online !== false && (!r.at || Date.now() - r.at > 20 * 60000)) out += '<div class="banner bad">Den automatiske kørsel er stoppet' + (r.at ? ' (sidst ' + esc(U.fmtTime(r.at)) + ')' : '') + '. To Do og kalenderen bliver ikke opdateret.</div>';
    if (s.cal && s.cal.on && s.cal.allDay) out += '<div class="banner warn">Heldagsaftale i Google Kalender: ' + esc((s.cal.allDayList || []).join('; ') || (s.cal.allDay + ' aftaler')) + (s.cal.allDayList && s.cal.allDay > s.cal.allDayList.length ? ' og ' + (s.cal.allDay - s.cal.allDayList.length) + ' mere' : '') + '. Bilarkiv beholder klokkeslættet, og påmindelserne kan komme aftenen før.</div>';
    if (s.cal && s.cal.on && !s.cal.ok) out += '<div class="banner bad">Google Kalender har en fejl (' + esc(U.fmtTime(s.cal.at)) + '): ' + esc(s.cal.error || 'ukendt fejl') + '. Tjek aftalerne her i appen.</div>';
    if (s.cal && s.cal.on && s.cal.unknown) out += '<div class="banner warn">' + s.cal.unknown + (s.cal.unknown === 1 ? ' aftale' : ' aftaler') + ' i Google Kalender findes ikke i Bilarkiv. De er ikke slettet.</div>';
    if (s.ms && s.ms.on && !s.ms.ok && s.ms.fails >= 3) out += '<div class="banner bad">Microsoft To Do har en fejl: ' + esc(s.ms.error || 'ukendt fejl') + '</div>';
    return out;
  }

  function remindersNote() {
    return syncNote() + telegramNote();
  }

  function telegramNote() {
    var r = BA.S.reminders;
    if (!r || !r.configured) {
      // Telegram er valgfrit: beskeden kan lukkes, og det huskes på denne enhed
      if (U.safeStore.get(HIDE_TG) === '1') return '';
      return '<div class="banner warn row between" style="gap:10px"><span>Påmindelser på Telegram er ikke slået til (valgfrit). Listen her virker alligevel.</span><button type="button" class="btn small ghost" data-hide-tg>Luk</button></div>';
    }
    if (!r.at) return '<div class="banner warn">Påmindelserne er sat op, men har ikke kørt endnu. Har du kørt installerPaamindelser?</div>';
    if (!r.ok) return '<div class="banner bad">Påmindelserne havde en fejl ved sidste kørsel (' + esc(U.fmtTime(r.at)) + '): ' + esc(r.error || 'ukendt fejl') + '</div>';
    if (Date.now() - r.at > 20 * 60000) return '<div class="banner bad">Påmindelserne er ikke kørt siden ' + esc(U.fmtTime(r.at)) + '. Tjek udløseren i Apps Script.</div>';
    return '';
  }

  function bookingsHtml(ctx) {
    var list = T.bookings(ctx, 14), today = ctx.local(ctx.now).slice(0, 10);
    var h = '<div class="card"><div class="hd"><h2>Kalender</h2><div class="row"><button type="button" class="btn small primary" data-bk-new>+ Book</button></div></div>';
    if (!list.length) return h + '<p class="muted small" style="margin:0">Ingen bookinger de næste 14 dage. Tryk “+ Book” for at booke en prøvetur eller fremvisning. Dagen før kl. ' + T.PREP_HOUR + ' kommer der et klar-tjek på listen, hvis der mangler noget på bilen.</p></div>';
    var day = '';
    list.forEach(function (x) {
      var l = ctx.local(x.booking.start), d = l.slice(0, 10);
      if (d !== day) { day = d; h += '<div class="eyebrow" style="margin:10px 0 2px">' + esc(dayHead(d, today)) + '</div>'; }
      h += '<div class="li"><div class="main"><div class="t"><b>' + esc(l.slice(11, 16)) + '</b> · ' + esc(x.booking.kind || 'Prøvetur') + ' · <a href="#/bil/' + esc(x.car.id) + '">' + esc(T.carLabel(x.car)) + '</a>' + readyChip(x.booking) + '</div>' + bookingLines(x.booking) + '</div>' +
        '<button type="button" class="icon-btn" data-bk-edit="' + esc(x.booking.id) + '" aria-label="Ret booking">✎</button></div>';
    });
    return h + '</div>';
  }

  function chargeHtml(ctx) {
    var ci = T.chargeInfo(ctx), cars = ctx.cars.filter(T.onStock);
    var h = '<div class="card"><div class="hd"><h2>Laderen</h2></div>';
    if (!cars.length) return h + '<p class="muted small" style="margin:0">Ingen biler er ankommet endnu. Laderen er på rotation for alle biler fra Gennemgang til Til salg.</p></div>';
    h += '<p class="small muted" style="margin-top:0">' + (ci.lastAny ? 'Sidst flyttet ' + esc(T.fmtAgo(ctx.now - ci.lastAny)) + '. ' : 'Laderen er ikke flyttet endnu. ') +
      (ci.due ? '<b>Den skal flyttes nu.</b>' : 'Næste flytning kl. ' + esc(ctx.local(ci.nextDue).slice(5, 16).replace(' ', ' kl. ')) + '.') + '</p>';
    var rows = cars.map(function (c) { return { c: c, at: T.lastTick(ctx.items, c.id, 'charge') }; }).sort(function (a, b) { return a.at - b.at; });
    rows.forEach(function (r) {
      h += '<div class="li"><div class="main"><div class="t"><a href="#/bil/' + esc(r.c.id) + '">' + esc(T.carLabel(r.c)) + '</a>' + (r.c.id === ci.targetId && ci.due ? ' <span class="chip acc">Næste</span>' : '') + '</div>' +
        '<div class="m">' + (r.at ? 'Sidst ladet ' + esc(T.fmtAgo(ctx.now - r.at)) : 'Aldrig ladet') + '</div></div></div>';
    });
    return h + '</div>';
  }

  /** De dele af siden, der ændrer sig, når data eller tiden ændrer sig. Tilføj-feltet står udenfor, så det aldrig mister tekst eller fokus. */
  function dynamicParts() {
    var ctx = BA.todoCtx(), list = T.compute(ctx), n = T.count(list), body = groupsHtml(list);
    return {
      count: n ? ' <span class="muted" style="font-size:.6em">' + n + '</span>' : '',
      note: (BA.offlineBanner ? BA.offlineBanner() : '') + remindersNote(),
      main: body ? '<div class="card">' + body + '</div>' : '<div class="empty">' + (BA.S.loaded ? 'Intet at lave lige nu ✓' : 'Henter …') + '</div>',
      aside: bookingsHtml(ctx) + chargeHtml(ctx)
    };
  }
  /** Tegner kun de dele, der ændrer sig. Giver false, hvis siden ikke er tegnet endnu (så skal hele siden tegnes). */
  V.todoRefresh = function (root) {
    var main = root.querySelector('#todo-main');
    if (!main) return false;
    var p = dynamicParts(), sig = focusSig(root);
    root.querySelector('#todo-count').innerHTML = p.count; root.querySelector('#todo-note').innerHTML = p.note; main.innerHTML = p.main; root.querySelector('#todo-aside').innerHTML = p.aside;
    restoreFocus(root, sig);
    return true;
  };

  V.todo = function (root) {
    var p = dynamicParts(), sig = focusSig(root);
    root.innerHTML ='<h1 class="page">To-do<span id="todo-count">' + p.count + '</span></h1><div id="todo-note">' + p.note + '</div>' +
      '<div class="cols"><div><div id="todo-main">' + p.main + '</div>' +
      '<form class="addrow" data-todo-add style="margin:0 0 8px"><input name="t" placeholder="Ny opgave (fx Ring til Benjamin)" maxlength="200" aria-label="Ny opgave" autocomplete="off"><button class="btn" type="submit">Tilføj</button></form>' +
      '<button class="btn small" type="button" data-todo-new>+ Opgave med dato eller bil</button></div><div id="todo-aside">' + p.aside + '</div></div>';
    bindList(root);
    restoreFocus(root, sig);
    if (!root.__todoBound) {
      root.__todoBound = true;
      root.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-hide-tg]')) { U.safeStore.set(HIDE_TG, '1'); V.todoRefresh(root); }
        else if (ev.target.closest('[data-bk-new]')) openBooking(null);
        else if (ev.target.closest('[data-todo-new]')) openTodo(null);
        else { var b = ev.target.closest('[data-bk-edit]'); if (b) { var it = BA.store.item(b.getAttribute('data-bk-edit')); if (it) openBooking(it); } }
      });
      root.addEventListener('submit', function (ev) {
        var f = ev.target.closest('form[data-todo-add]'); if (!f) return;
        ev.preventDefault();
        var t = f.elements.t.value.trim().replace(/\s+/g, ' ');
        if (!t) return;
        BA.store.addItem('', 'todo', { text: t });
        f.elements.t.value = '';
        f.elements.t.focus();
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Sidepanel (pc) og tæller
  // ---------------------------------------------------------------------------
  V.todoPanel = function (el) {
    var list = BA.todoList(), n = T.count(list), sig = focusSig(el);
    var body = groupsHtml(list, { skipLater: true, max: 6 });
    el.innerHTML ='<div class="card"><div class="hd"><h2>To-do' + (n ? ' <span class="cnt">' + n + '</span>' : '') + '</h2><a class="btn small ghost" href="#/todo">Se alle</a></div>' +
      (body || '<p class="muted small" style="margin:0">' + (BA.S.loaded ? 'Intet at lave lige nu ✓' : 'Henter …') + '</p>') + '</div>';
    bindList(el);
    restoreFocus(el, sig);
  };

  BA.syncTodoBadge = function () {
    var n = BA.S.loaded ? BA.todoCount() : 0;
    U.$$('[data-todo-badge]').forEach(function (b) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  };

  // ---------------------------------------------------------------------------
  // Kortet på bilsiden
  // ---------------------------------------------------------------------------
  /** HTML til afsnittet "Påmindelser" på bilen. */
  BA.todoCarSection = function (car) {
    var ctx = BA.todoCtx(), mine = T.compute(ctx).filter(function (e) { return e.carId === car.id && e.kind !== 'tasks'; });
    var h = '<div class="hd"><h2>Påmindelser <span class="cnt">' + mine.length + '</span></h2></div>';
    if (T.onStock(car)) {
      var last = T.lastTick(ctx.items, car.id, 'charge');
      h += '<div class="li"><div class="main"><div class="t">Laderen</div><div class="m">' + (last ? 'Sidst ladet ' + esc(T.fmtAgo(ctx.now - last)) : 'Aldrig ladet') + '</div></div>' +
        '<button type="button" class="btn small" data-act="charge-now">⚡ Ladet nu</button></div>';
    }
    h += mine.map(rowHtml).join('');
    var bks = ctx.items.filter(function (i) { return i.type === 'booking' && i.carId === car.id && !i.cancelled && !i.done && typeof i.start === 'number'; }).sort(function (a, b) { return a.start - b.start; });
    h += '<div class="eyebrow" style="margin:12px 0 2px">Bookinger</div>';
    h += bks.length ? bks.map(function (b) {
      return '<div class="li"><div class="main"><div class="t">' + esc(b.kind || 'Prøvetur') + ' · ' + esc(U.fmtLocal(b.start)) + readyChip(b) + '</div>' + bookingLines(b) + '</div>' +
        '<button type="button" class="icon-btn" data-act="book-edit" data-id="' + esc(b.id) + '" aria-label="Ret booking">✎</button></div>';
    }).join('') : '<p class="muted small" style="margin:0 0 6px">Ingen bookinger.</p>';
    return h + '<button type="button" class="btn small" data-act="book-new" style="margin-top:8px">+ Book prøvetur / fremvisning</button>';
  };
  /** Knapper på bilsiden: giver true, hvis den håndterede handlingen. */
  BA.todoCarAct = function (act, car, el) {
    if (act === 'charge-now') { perform({ action: { kind: 'tick', tick: 'charge', carId: car.id } }); return true; }
    if (act === 'book-new') { openBooking(null, car.id); return true; }
    if (act === 'book-edit') { var it = BA.store.item(el.getAttribute('data-id')); if (it) openBooking(it); return true; }
    return false;
  };
  // Rækkerne i bilens kort er de samme som i listen: de har data-todo-act og data-todo-edit
  BA.todoBind = bindList;
  BA.todoUi = { perform: perform, openBooking: openBooking, openTodo: openTodo };
})();
