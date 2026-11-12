/* Skærmbilleder: login, lager, solgte biler, ny bil og indstillinger. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, A = BA.api, $ = U.$, esc = U.esc;
  var V = BA.views = BA.views || {};

  var SERVER_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/;

  // ---------------------------------------------------------------------------
  // Billeder på kortene
  // ---------------------------------------------------------------------------
  BA.photosOf = function (carId) {
    return BA.store.itemsOf(carId, 'fil').filter(function (f) { return (f.kind === 'photo' || f.kind === 'video') && !f.parent; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) || String(a.name).localeCompare(String(b.name)); });
  };
  BA.coverOf = function (car) {
    var photos = BA.photosOf(car.id).filter(function (f) { return f.kind === 'photo'; });
    var chosen = photos.filter(function (f) { return f.id === car.cover; })[0];
    return chosen || photos[0] || null;
  };

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  V.login = function (root, hint) {
    var pre = BA.pairHint || {};
    var server = pre.server || A.server();
    var deviceGuess = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android-telefon' : 'Pc';
    root.innerHTML =
      '<div class="login"><img class="logo" src="icons/logo-hvid.png" alt="Hovedvejens Auto"><h1 class="page">Bilarkiv</h1>' +
      (hint ? '<div class="banner warn">' + esc(hint) + '</div>' : '') +
      '<form id="loginform" class="card" autocomplete="off">' +
      '<div class="field"><label for="lg-code">Kode (8 cifre) – eller indsæt hele linket</label><input id="lg-code" class="codebox" autocomplete="one-time-code" placeholder="0000 0000" value="' + esc(pre.code || '') + '"></div>' +
      (SERVER_RE.test(server) ? '<input type="hidden" id="lg-server" value="' + esc(server) + '">' :
        '<div class="field"><label for="lg-server">Serverens adresse (fra Apps Script)</label><input id="lg-server" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(server) + '"></div>') +
      '<div class="field"><label for="lg-dev">Navn på denne enhed</label><input id="lg-dev" value="' + esc(deviceGuess) + '" maxlength="40"></div>' +
      '<div class="errtxt" id="lg-err" role="alert"></div>' +
      '<button class="btn primary big" id="lg-go" type="submit">Log ind</button></form>' +
      '<p class="muted small">Koden får du i Apps Script (funktionen nyKodeOliver) eller under Mere → Tilføj enhed på en enhed, der allerede er logget ind. Den gælder i 15 minutter og kan bruges én gang.</p></div>';
    var form = $('#loginform', root);
    // Hele linket kan indsættes i kodefeltet (fx i hjemmeskærm-appen på iPhone): så udfyldes koden og serverens adresse af sig selv.
    function takeLink() {
      var v = $('#lg-code').value, c = /kode=(\d{8})/.exec(v), s = /server=([^&\s#]+)/.exec(v);
      if (!c) return;
      $('#lg-code').value = c[1];
      if (s) { try { $('#lg-server').value = decodeURIComponent(s[1]); } catch (e0) { /* ingen */ } }
    }
    $('#lg-code').addEventListener('input', takeLink);
    form.onsubmit = function (e) {
      e.preventDefault();
      takeLink();
      var code = $('#lg-code').value.replace(/\D/g, ''), srv = $('#lg-server').value.trim(), err = $('#lg-err');
      err.textContent = '';
      if (!/^\d{8}$/.test(code)) { err.textContent = 'Skriv de 8 cifre fra koden.'; return; }
      if (!SERVER_RE.test(srv)) { err.textContent = 'Serverens adresse skal ligne https://script.google.com/macros/s/…/exec'; return; }
      var btn = $('#lg-go'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Logger ind …';
      U.safeStore.set('ba.server', srv);
      A._tmpServer = srv;
      A.call('pair', { code: code, deviceName: $('#lg-dev').value.trim() || deviceGuess }).then(function (res) {
        A.setLogin(srv, res.key, res.person);
        BA.pairHint = null;
        BA.emit('loggedin');
      }, function (er) {
        btn.disabled = false; btn.textContent = 'Log ind';
        err.textContent = er.message;
      });
    };
    $('#lg-code').focus();
  };

  // ---------------------------------------------------------------------------
  // Lager og solgte
  // ---------------------------------------------------------------------------
  var ui = { q: '', status: '', sort: 'age', soldYear: '' };
  BA.listUi = ui;

  function matches(c) {
    if (!ui.q) return true;
    var q = ui.q.toLowerCase();
    return [c.model, c.reg, c.vin, c.buyer, c.year, c.variant, c.notes].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
  }

  function carCard(c) {
    var st = BA.S.settings, r = BA.calc(c, BA.S.items, st), cover = BA.coverOf(c);
    var sold = BA.isSold(c.status);
    var kv;
    if (sold) kv = [['Salgspris', U.kr(U.pnum(c.soldPrice))], ['Avance', '<span class="' + (r.current < 0 ? 'neg' : 'pos') + '">' + U.kr(r.current) + '</span>'],
      ['Kr. pr. time', r.perHour == null ? '–' : '<span class="' + (r.perHour < st.hourGoal ? 'neg' : 'pos') + '">' + U.kr(r.perHour) + '</span>']];
    else kv = [['Kostpris', U.kr(r.cost)], ['Annonceret', U.kr(U.pnum(c.listPrice))], ['Forv. avance', r.expected == null ? '–' : '<span class="' + (r.expected < 0 ? 'neg' : r.expected < st.minProfit ? 'warn' : 'pos') + '">' + U.kr(r.expected) + '</span>']];
    var sub = [c.year, c.km != null ? U.fmtN(c.km) + ' km' : null, c.fuel].filter(Boolean).join(' · ');
    var days = '';
    if (!sold) {
      var bought = r.days != null ? '<span class="chip" title="Dage siden køb">Købt ' + r.days + ' d</span>' : '';
      var onSale = r.listedDays != null ? '<span class="chip ' + (r.listedDays >= st.stockDays ? 'bad' : 'acc') + '" title="Dage til salg">Til salg ' + r.listedDays + ' d</span>' : '';
      days = '<span class="row" style="gap:6px">' + onSale + bought + '</span>';
    }
    var claimsN = BA.store.itemsOf(c.id, 'reklamation').length;
    return '<a class="carcard" href="#/bil/' + esc(c.id) + '">' +
      '<div class="ph">' + (cover ? '<img data-iid="' + esc(cover.id) + '" alt="" data-ph="Intet billede">' : 'Intet billede endnu') + '<span class="st chip ' + BA.statusClass(c.status) + '">' + esc(c.status) + '</span></div>' +
      '<div class="cb"><div class="row between">' + U.plate(c.reg) + days + (sold && claimsN ? '<span class="chip bad">' + claimsN + ' reklamation' + (claimsN > 1 ? 'er' : '') + '</span>' : '') + '</div>' +
      '<h3>' + esc(c.model || 'Uden navn') + '</h3><div class="sub">' + esc(sub || ' ') + '</div>' +
      '<dl class="kv">' + kv.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl></div></a>';
  }

  function sortCars(list, sold) {
    var st = BA.S.settings;
    var key = ui.sort;
    var f = {
      age: function (a, b) { return String(a.boughtDate || '9999').localeCompare(String(b.boughtDate || '9999')); },
      new: function (a, b) { return String(b.boughtDate || '').localeCompare(String(a.boughtDate || '')); },
      profit: function (a, b) { var x = BA.calc(a, BA.S.items, st).base, y = BA.calc(b, BA.S.items, st).base; return (y == null ? -1e12 : y) - (x == null ? -1e12 : x); },
      status: function (a, b) { return BA.STATUSES.indexOf(a.status) - BA.STATUSES.indexOf(b.status); }
    }[key] || null;
    if (sold) return list.sort(function (a, b) { return String(b.soldDate || '').localeCompare(String(a.soldDate || '')); });
    return list.sort(f);
  }

  V.lager = function (root) {
    var all = BA.S.cars.filter(function (c) { return !BA.isSold(c.status); });
    var counts = {};
    all.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
    var list = all.filter(function (c) { return (!ui.status || c.status === ui.status) && matches(c); });
    sortCars(list, false);
    var stocks = BA.STATUSES.slice(0, BA.SOLD_FROM);
    var h = '<h1 class="page">Biler på lager <span class="muted" style="font-size:.6em">' + all.length + '</span></h1>' + offlineBanner() +
      '<div class="toolbar"><input type="search" id="q" placeholder="Søg model, reg.nr., stelnr. …" value="' + esc(ui.q) + '" aria-label="Søg"><select id="sortsel" aria-label="Sortér">' +
      BA.options([{ value: 'age', label: 'Længst på lager' }, { value: 'new', label: 'Nyeste først' }, { value: 'profit', label: 'Højest forventet avance' }, { value: 'status', label: 'Efter status' }], ui.sort) + '</select>' +
      '<a class="btn primary" href="#/ny">+ Ny bil</a></div>' +
      '<div class="chips" style="margin-bottom:14px"><button type="button" class="chip big ' + (ui.status ? '' : 'sel') + '" data-status="">Alle ' + all.length + '</button>' +
      stocks.filter(function (s) { return counts[s]; }).map(function (s) { return '<button type="button" class="chip big ' + (ui.status === s ? 'sel' : '') + '" data-status="' + esc(s) + '">' + esc(s) + ' ' + counts[s] + '</button>'; }).join('') + '</div>';
    if (!BA.S.loaded) h += '<div class="cars"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    else if (!list.length) h += '<div class="empty">' + (ui.q || ui.status ? 'Ingen biler matcher.' : 'Ingen biler på lager endnu. Tryk “+ Ny bil” for at oprette den første.') + '</div>';
    else h += '<div class="cars">' + list.map(carCard).join('') + '</div>';
    var focusQ = document.activeElement && document.activeElement.id === 'q';
    var pos = focusQ ? document.activeElement.selectionStart : 0;
    root.innerHTML = h;
    var q = $('#q', root);
    q.oninput = function () { ui.q = q.value; V.lager(root); var nq = $('#q', root); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); };
    if (focusQ) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { /* ingen */ } }
    $('#sortsel', root).onchange = function (e) { ui.sort = e.target.value; V.lager(root); };
    U.$$('[data-status]', root).forEach(function (b) { b.onclick = function () { ui.status = b.getAttribute('data-status'); V.lager(root); }; });
    BA.img.hydrate(root);
  };

  V.solgte = function (root) {
    var st = BA.S.settings;
    var all = BA.S.cars.filter(function (c) { return BA.isSold(c.status); });
    var thisY = U.today().slice(0, 4);
    var years = {}; years[thisY] = true;
    all.forEach(function (c) { if (c.soldDate) years[c.soldDate.slice(0, 4)] = true; });
    var yearList = Object.keys(years).sort().reverse();
    var y = ui.soldYear || thisY;
    var list = all.filter(function (c) { return (y === 'alle' || (c.soldDate || '').slice(0, 4) === y) && matches(c); });
    sortCars(list, true);
    var tot = { n: list.length, profit: 0, hrs: 0, rev: 0 };
    list.forEach(function (c) { var r = BA.calc(c, BA.S.items, st); tot.profit += r.current || 0; tot.hrs += r.hrs || 0; tot.rev += U.pnum(c.soldPrice) || 0; });
    var h = '<h1 class="page">Solgte biler <span class="muted" style="font-size:.6em">' + all.length + '</span></h1>' + offlineBanner() +
      '<div class="toolbar"><input type="search" id="q" placeholder="Søg model, reg.nr., køber …" value="' + esc(ui.q) + '" aria-label="Søg"><select id="yearsel" aria-label="Periode">' +
      BA.options(yearList.map(function (v) { return { value: v, label: v }; }).concat([{ value: 'alle', label: 'Alle år' }]), y) + '</select></div>' +
      '<div class="sumstrip"><div><div class="l">Solgt ' + (y === 'alle' ? 'i alt' : 'i ' + y) + '</div><div class="v">' + tot.n + '</div></div><div><div class="l">Omsætning</div><div class="v">' + U.kr(tot.rev) + '</div></div>' +
      '<div><div class="l">Aktuel avance</div><div class="v ' + (tot.profit < 0 ? 'neg' : '') + '">' + U.kr(tot.profit) + '</div></div>' +
      '<div><div class="l">Kr. pr. time</div><div class="v">' + (tot.hrs > 0 ? U.kr(tot.profit / tot.hrs) : '–') + '</div></div></div>';
    if (!BA.S.loaded) h += '<div class="cars"><div class="skeleton"></div></div>';
    else if (!list.length) h += '<div class="empty">' + (ui.q ? 'Ingen biler matcher.' : 'Ingen solgte biler i perioden. Når du markerer en bil som solgt, flytter den hertil.') + '</div>';
    else h += '<div class="cars">' + list.map(carCard).join('') + '</div>';
    var focusQ = document.activeElement && document.activeElement.id === 'q';
    root.innerHTML = h;
    var q = $('#q', root);
    q.oninput = function () { ui.q = q.value; V.solgte(root); var nq = $('#q', root); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); };
    if (focusQ) q.focus();
    $('#yearsel', root).onchange = function (e) { ui.soldYear = e.target.value; V.solgte(root); };
    BA.img.hydrate(root);
  };

  function offlineBanner() {
    var S = BA.S;
    if (!S.online && S.loaded) return '<div class="banner warn">Ingen forbindelse – du ser det, der sidst blev hentet' + (S.lastSync ? ' (' + U.fmtTime(S.lastSync) + ')' : '') + '. Ændringer sendes, så snart der er forbindelse igen.</div>';
    return '';
  }
  BA.offlineBanner = offlineBanner;

  // ---------------------------------------------------------------------------
  // Ny bil
  // ---------------------------------------------------------------------------
  var nw = null;
  function freshNew() {
    return { id: U.uid(), reg: '', looked: false, loading: false, err: '', note: '', existing: null, show: false,
      f: { model: '', variant: '', year: '', fuel: '', color: '', vin: '', firstReg: '', km: '', channel: '', buyPrice: '', boughtDate: U.today(), listPrice: '', nextInspection: '', motKm: null, motDate: '' }, equip: [], equipErr: '', showAll: false, extraEquip: '' };
  }
  BA.resetNewCar = function () { nw = null; };

  V.ny = function (root) {
    if (!nw) nw = freshNew();
    var st = BA.S.settings;
    if (!nw.f.channel && !nw.touchedChannel && st.channels && st.channels.length) nw.f.channel = '';
    var chosen = BA.findChannel(st, nw.f.channel);
    var h = '<h1 class="page">Ny bil</h1>' + offlineBanner() + '<div class="card"><div class="hd"><h2>1 · Nummerplade</h2></div>' +
      '<form id="lookupform" class="row" style="align-items:flex-end"><div class="field" style="flex:1 1 180px;margin:0"><label for="n-reg">Nummerplade</label>' +
      '<input id="n-reg" value="' + esc(nw.reg) + '" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" style="font-weight:700;letter-spacing:.12em;font-size:20px;text-transform:uppercase" placeholder="AB 12 345"></div>' +
      '<button class="btn primary" type="submit"' + (nw.loading ? ' disabled' : '') + '>' + (nw.loading ? '<span class="spin"></span> Slår op …' : 'Slå op') + '</button>' +
      (nw.show ? '' : '<button class="btn" type="button" id="n-manual">Opret uden opslag</button>') + '</form>' +
      (nw.err ? '<div class="banner bad" role="alert" style="margin-top:12px">' + esc(nw.err) + '</div>' : '') +
      (nw.existing ? '<div class="banner warn" style="margin-top:12px">Bilen findes allerede på lager: <b>' + esc(nw.existing.model) + '</b> (' + esc(nw.existing.status) + '). <a class="btn small" href="#/bil/' + esc(nw.existing.id) + '">Åbn bilen</a></div>' : '') +
      (nw.note ? '<div class="banner warn" style="margin-top:12px">' + esc(nw.note) + '</div>' : '') + '</div>';
    if (nw.show) {
      var f = nw.f;
      var inp = function (k, label, extra) { return '<div class="field"><label for="n-' + k + '">' + label + '</label><input id="n-' + k + '" data-nf="' + k + '" value="' + esc(f[k]) + '" ' + (extra || '') + '></div>'; };
      h += '<div class="card"><div class="hd"><h2>2 · Bilen</h2></div>' + inp('model', 'Mærke og model *', 'maxlength="100" autocomplete="off"') +
        '<div class="grid2">' + inp('variant', 'Variant', 'maxlength="100"') + inp('year', 'Årgang', 'inputmode="numeric" maxlength="4"') + '</div>' +
        '<div class="grid2">' + inp('fuel', 'Brændstof', 'list="dl-fuel" maxlength="40"') + inp('color', 'Farve', 'maxlength="40"') + '</div>' +
        '<div class="grid2">' + inp('firstReg', '1. registrering', 'type="date"') + inp('vin', 'Stelnummer', 'maxlength="20" autocapitalize="characters"') + '</div>' +
        (nw.f.motKm != null ? '<p class="muted small" style="margin:0">Seneste syn' + (nw.f.motDate ? ' (' + esc(U.fmtDate(nw.f.motDate)) + ')' : '') + ': ' + esc(U.fmtN(nw.f.motKm)) + ' km. Det er ikke bilens km-stand nu.</p>' : '') + '</div>' +
        '<div class="card"><div class="hd"><h2>3 · Køb</h2></div>' +
        '<div class="field"><label for="n-channel">Indkøbskanal</label><select id="n-channel" data-nf="channel">' + BA.options(st.channels.map(function (c) { return c.name; }), f.channel, 'Vælg …') + '</select>' +
        (chosen ? '<div class="muted small" style="margin-top:6px">' + (chosen.transit ? 'Bilen sættes til “Under transport”. ' : '') + (chosen.costs.length ? 'Faste omkostninger lægges i udgifter: ' + chosen.costs.map(function (c) { return esc(c.desc) + ' ' + U.kr(c.amount); }).join(', ') + '.' : 'Ingen faste omkostninger.') + '</div>' : '') + '</div>' +
        '<div class="grid2">' + inp('buyPrice', 'Købspris (kr)', 'inputmode="decimal"') + inp('boughtDate', 'Købsdato', 'type="date"') + '</div>' +
        '<div class="grid2">' + inp('km', 'Km nu', 'inputmode="numeric"') + inp('listPrice', 'Annonceret pris (kr)', 'inputmode="decimal"') + '</div></div>' +
        '<div class="card"><div class="hd"><h2>4 · Udstyr <span class="cnt">' + nw.equip.filter(function (e) { return e.on; }).length + '</span></h2></div>' +
        (nw.equipErr ? '<div class="banner warn">' + esc(nw.equipErr) + '</div>' : '') +
        (nw.equip.length ? '<div class="chips">' + nw.equip.slice(0, nw.showAll ? 999 : 14).map(function (e, i) { return '<button type="button" class="chip big ' + (e.on ? 'sel' : '') + '" data-eq="' + i + '" aria-pressed="' + (e.on ? 'true' : 'false') + '">' + esc(e.name) + '</button>'; }).join('') + '</div>' +
          (nw.equip.length > 14 && !nw.showAll ? '<button type="button" class="btn small" id="n-more" style="margin-top:10px">Vis alle ' + nw.equip.length + '</button>' : '') : '<p class="muted small" style="margin:0 0 8px">Intet udstyr hentet. Tilføj udstyr herunder – eller senere på bilen.</p>') +
        '<div class="addrow"><input id="n-eqadd" placeholder="Tilføj udstyr (fx Anhængertræk)" maxlength="120"><button type="button" class="btn" id="n-eqbtn">Tilføj</button></div></div>' +
        '<div class="errtxt" id="n-err" role="alert"></div><button class="btn primary big" id="n-create" type="button">Opret bil</button><datalist id="dl-fuel"><option>Benzin<option>Diesel<option>El<option>Hybrid (benzin)<option>Plug-in hybrid</datalist>';
    }
    var focusId = document.activeElement && document.activeElement.id;
    root.innerHTML = h;
    bindNew(root);
    if (focusId && $('#' + focusId, root) && !/^n-(create|more)$/.test(focusId)) { var fe = $('#' + focusId, root); try { fe.focus(); if (fe.setSelectionRange && /text|search|^$/.test(fe.type || '')) fe.setSelectionRange(fe.value.length, fe.value.length); } catch (e) { /* ingen */ } }
    else if (!nw.show && !nw.loading) { $('#n-reg', root).focus(); }
  };

  function bindNew(root) {
    var reg = $('#n-reg', root);
    reg.oninput = function () { nw.reg = reg.value.toUpperCase(); };
    $('#lookupform', root).onsubmit = function (e) { e.preventDefault(); nw.reg = reg.value.toUpperCase(); doLookup(root); };
    var man = $('#n-manual', root);
    if (man) man.onclick = function () {
      nw.reg = reg.value.toUpperCase().replace(/[\s.\-]/g, '');
      if (!nw.reg) { nw.err = 'Skriv nummerpladen først.'; V.ny(root); return; }
      nw.err = ''; nw.show = true; nw.looked = true; V.ny(root);
    };
    U.$$('[data-nf]', root).forEach(function (el) {
      el.onchange = function () { nw.f[el.getAttribute('data-nf')] = el.value; if (el.getAttribute('data-nf') === 'channel') { nw.touchedChannel = true; V.ny(root); } };
      el.oninput = function () { nw.f[el.getAttribute('data-nf')] = el.value; };
    });
    U.$$('[data-eq]', root).forEach(function (b) { b.onclick = function () { var e = nw.equip[+b.getAttribute('data-eq')]; e.on = !e.on; V.ny(root); }; });
    var more = $('#n-more', root); if (more) more.onclick = function () { nw.showAll = true; V.ny(root); };
    var addEq = function () {
      var inp = $('#n-eqadd', root), name = inp.value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (!nw.equip.some(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })) nw.equip.push({ name: name, source: 'egen', on: true });
      nw.showAll = true; V.ny(root); $('#n-eqadd', root).focus();
    };
    var eqb = $('#n-eqbtn', root); if (eqb) { eqb.onclick = addEq; $('#n-eqadd', root).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addEq(); } }; }
    var cr = $('#n-create', root); if (cr) cr.onclick = function () { createFromForm(root); };
  }

  function doLookup(root) {
    var reg = nw.reg.replace(/[\s.\-]/g, '');
    nw.err = ''; nw.note = ''; nw.existing = null;
    if (!reg) { nw.err = 'Skriv nummerpladen.'; V.ny(root); return; }
    nw.loading = true; V.ny(root);
    A.call('lookupPlate', { reg: reg }, { timeout: 40000 }).then(function (res) {
      nw.loading = false; nw.reg = res.reg;
      if (res.existing) { nw.existing = res.existing; nw.show = false; V.ny(root); return; }
      var c = res.car;
      Object.assign(nw.f, { model: c.model, variant: c.variant, year: c.year, fuel: c.fuel, color: c.color, vin: c.vin, firstReg: c.firstReg, motKm: c.motKm, motDate: c.motDate, nextInspection: c.nextInspection });
      nw.equip = (res.equipment || []).map(function (e) { return { name: e.name, source: 'dmr', on: true }; });
      nw.equipErr = res.equipmentError || '';
      nw.note = res.statusNote || '';
      nw.show = true; nw.looked = true; V.ny(root);
    }, function (er) {
      nw.loading = false; nw.err = er.code === 'NET' ? 'Ingen forbindelse. Du kan stadig oprette bilen uden opslag.' : er.message; V.ny(root);
    });
  }

  function createFromForm(root) {
    var f = nw.f, err = $('#n-err', root);
    var bad = function (m, id) { err.textContent = m; var el = $('#' + id, root); if (el) { el.classList.add('invalid'); el.focus(); } };
    U.$$('.invalid', root).forEach(function (e) { e.classList.remove('invalid'); });
    var reg = nw.reg.replace(/[\s.\-]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(reg)) return bad('Nummerpladen ser forkert ud.', 'n-reg');
    if (BA.S.cars.some(function (c) { return c.reg === reg && !BA.isSold(c.status); })) return bad('Bilen ' + reg + ' findes allerede på lager.', 'n-reg');
    if (!f.model.trim()) return bad('Skriv mærke og model.', 'n-model');
    if (f.year && !/^(19|20)\d{2}$/.test(f.year.trim())) return bad('Årgang skal være et årstal, fx 2019.', 'n-year');
    var vin = f.vin.replace(/\s/g, '').toUpperCase();
    if (vin && !/^[A-Z0-9]{5,20}$/.test(vin)) return bad('Stelnummeret må kun have bogstaver og tal (5-20 tegn).', 'n-vin');
    var buy = U.pnum(f.buyPrice), list = U.pnum(f.listPrice), km = U.pnum(f.km);
    if (String(f.buyPrice).trim() && (buy === null || buy < 0)) return bad('Købsprisen skal være et beløb.', 'n-buyPrice');
    if (String(f.listPrice).trim() && (list === null || list < 0)) return bad('Den annoncerede pris skal være et beløb.', 'n-listPrice');
    if (String(f.km).trim() && (km === null || km < 0 || Math.floor(km) !== km)) return bad('Km skal være et helt tal.', 'n-km');
    if (!f.boughtDate) return bad('Vælg en købsdato.', 'n-boughtDate');
    var fields = { reg: reg, model: f.model.trim(), variant: f.variant.trim(), year: (f.year || '').trim(), vin: vin, fuel: f.fuel.trim(), color: f.color.trim(), firstReg: f.firstReg || '',
      km: km, channel: f.channel, boughtDate: f.boughtDate, buyPrice: buy, listPrice: list, motKm: f.motKm, motDate: f.motDate || '', nextInspection: f.nextInspection || '' };
    var equipment = nw.equip.filter(function (e) { return e.on; }).map(function (e) { return { name: e.name, source: e.source }; });
    var id = nw.id;
    BA.store.createCar({ id: id, fields: fields, equipment: equipment });
    nw = null;
    BA.go('#/bil/' + id);
    BA.toast('Bilen er oprettet.');
  }

  // ---------------------------------------------------------------------------
  // Mere: indstillinger, enheder
  // ---------------------------------------------------------------------------
  var draft = null, draftDirty = false, draftSrc = "";   // kladde til indkøbskanaler og salgskanaler
  V.mere = function (root) {
    var st = BA.S.settings;
    var src = JSON.stringify([st.channels, st.salesChannels]);
    if (!draft || (!draftDirty && src !== draftSrc)) { draft = { channels: JSON.parse(JSON.stringify(st.channels || [])), sales: (st.salesChannels || []).join('\n') }; draftSrc = src; draftDirty = false; }
    var h = '<h1 class="page">Mere</h1>' + offlineBanner() +
      '<div class="cols"><div>' +
      '<div class="card"><div class="hd"><h2>Denne enhed</h2></div><p style="margin:0 0 10px">Logget ind som <b>' + esc((BA.S.device && BA.S.device.person) || U.safeStore.get('ba.person') || '') + '</b>' + (BA.S.device && BA.S.device.name ? ' på “' + esc(BA.S.device.name) + '”' : '') + '.</p>' +
      '<div class="row"><button class="btn" id="m-newdev" type="button">Tilføj enhed</button><button class="btn danger" id="m-logout" type="button">Log denne enhed ud</button></div><div id="m-code"></div></div>' +
      '<div class="card"><div class="hd"><h2>Mål og regler</h2></div>' +
      '<div class="grid2"><div class="field"><label for="s-hourGoal">Mål: kr. pr. time</label><input id="s-hourGoal" data-s="hourGoal" inputmode="decimal" value="' + esc(U.num(st.hourGoal)) + '"></div>' +
      '<div class="field"><label for="s-monthGoal">Mål: resultat pr. måned (kr)</label><input id="s-monthGoal" data-s="monthGoal" inputmode="decimal" value="' + esc(U.num(st.monthGoal)) + '"></div></div>' +
      '<div class="grid2"><div class="field"><label for="s-stockDays">Advar efter (dage til salg)</label><input id="s-stockDays" data-s="stockDays" inputmode="numeric" value="' + esc(st.stockDays) + '"></div>' +
      '<div class="field"><label for="s-minProfit">Advar hvis forventet avance under (kr)</label><input id="s-minProfit" data-s="minProfit" inputmode="decimal" value="' + esc(U.num(st.minProfit)) + '"></div></div>' +
      '<div class="grid2"><div class="field"><label for="s-vat">Brugtmoms (%)</label><input id="s-vat" data-s="vat" inputmode="decimal" value="' + esc(U.num(st.vat * 100)) + '"></div>' +
      '<div class="field"><label for="s-sellerName">Sælgerens navn (på papirer)</label><input id="s-sellerName" data-s="sellerName" maxlength="60" value="' + esc(st.sellerName) + '"></div></div>' +
      '<div class="errtxt" id="s-err" role="alert"></div></div>' +
      '<div class="card"><div class="hd"><h2>Salgskanaler</h2></div><div class="field"><label for="s-sales">Én pr. linje (vises, når du markerer en bil som solgt)</label><textarea id="s-sales" rows="6">' + esc(draft.sales) + '</textarea></div>' +
      '<button class="btn" id="s-savesales" type="button">Gem salgskanaler</button></div>' +
      '</div><div>' +
      '<div class="card"><div class="hd"><h2>Indkøbskanaler og faste omkostninger</h2></div><p class="muted small" style="margin-top:0">Når du opretter en bil, lægges kanalens faste omkostninger automatisk i bilens udgifter. “Starter som Under transport” bruges fx til AutoProff.</p>' +
      draft.channels.map(function (c, i) { return channelEditor(c, i); }).join('') +
      '<div class="row"><button class="btn" id="c-add" type="button">+ Ny kanal</button><button class="btn primary" id="c-save" type="button">Gem kanaler</button></div><div class="errtxt" id="c-err" role="alert"></div></div>' +
      '<div class="card"><div class="hd"><h2>Om appen</h2></div><p class="small muted" style="margin:0">Bilarkiv · fase 1' + (BA.S.lastSync ? ' · sidst hentet ' + esc(U.fmtTime(BA.S.lastSync)) : '') + '. På iPhone: åbn i Safari → Del → Føj til hjemmeskærm.</p>' +
      '<div class="field" style="margin-top:12px"><label for="m-server">Serverens adresse</label><input id="m-server" type="url" inputmode="url" value="' + esc(A.server()) + '"><div class="errtxt" id="m-serr" role="alert"></div></div>' +
      '<div class="row"><button class="btn small" id="m-sync" type="button">Hent nyt nu</button><button class="btn small" id="m-saveserver" type="button">Gem adresse</button></div></div>' +
      '</div></div>';
    root.innerHTML = h;
    bindMere(root);
  };

  function channelEditor(c, i) {
    return '<div class="card" style="background:var(--surface-2)" data-ch="' + i + '"><div class="row between"><div class="field" style="flex:1;margin:0"><label>Navn</label><input data-cf="name" value="' + esc(c.name) + '" maxlength="60"></div>' +
      '<button class="icon-btn del" type="button" data-cdel="' + i + '" aria-label="Fjern kanalen">✕</button></div>' +
      '<label class="check"><input type="checkbox" data-cf="transit"' + (c.transit ? ' checked' : '') + '> Starter som “Under transport”</label>' +
      c.costs.map(function (x, j) {
        return '<div class="row" style="align-items:flex-end;gap:8px" data-cost="' + j + '"><div class="field" style="flex:2 1 160px;margin:0"><label>Omkostning</label><input data-kf="desc" value="' + esc(x.desc) + '" maxlength="200"></div>' +
          '<div class="field" style="flex:1 1 90px;margin:0"><label>Kategori</label><input data-kf="cat" value="' + esc(x.cat) + '" maxlength="60" list="dl-exp"></div>' +
          '<div class="field" style="flex:1 1 90px;margin:0"><label>Beløb (kr)</label><input data-kf="amount" inputmode="decimal" value="' + esc(typeof x.amount === 'number' ? U.num(x.amount) : String(x.amount == null ? '' : x.amount)) + '"></div>' +
          '<button class="icon-btn del" type="button" data-kdel="' + i + ':' + j + '" aria-label="Fjern omkostningen">✕</button></div>';
      }).join('') +
      '<button class="btn small" type="button" data-kadd="' + i + '" style="margin-top:8px">+ Fast omkostning</button></div>';
  }

  function readChannelDraft(root) {
    draftDirty = true;
    U.$$('[data-ch]', root).forEach(function (box) {
      var i = +box.getAttribute('data-ch'), c = draft.channels[i];
      c.name = $('[data-cf=name]', box).value; c.transit = $('[data-cf=transit]', box).checked;
      c.costs = U.$$('[data-cost]', box).map(function (row) {
        var raw = $('[data-kf=amount]', row).value, n = U.pnum(raw);
        return { desc: $('[data-kf=desc]', row).value, cat: $('[data-kf=cat]', row).value, amount: raw.trim() !== '' && n !== null ? n : raw };
      });
    });
  }

  function bindMere(root) {
    U.$$('[data-ch] input, #s-sales', root).forEach(function (el) { el.addEventListener('input', function () { draftDirty = true; }); el.addEventListener('change', function () { draftDirty = true; }); });
    var cd = $('#m-newdev', root);
    cd.onclick = function () {
      cd.disabled = true;
      A.call('createPairingCode').then(function (c) {
        cd.disabled = false;
        $('#m-code', root).innerHTML = '<div class="banner ok" style="margin-top:12px"><div class="eyebrow">Kode til den nye enhed</div><div class="codebox" style="margin:6px 0">' + esc(c.display) + '</div>' +
          '<div class="small">Gælder til kl. ' + esc(c.expiresText) + ' og kan bruges én gang. Åbn appen på den nye enhed, og skriv koden.</div>' +
          (c.link ? '<div class="row" style="margin-top:8px"><button class="btn small" type="button" id="m-copylink">Kopiér link</button></div>' : '') + '</div>';
        var cl = $('#m-copylink', root);
        if (cl) cl.onclick = function () { U.copy(c.link).then(function (ok) { BA.toast(ok ? 'Linket er kopieret.' : 'Kunne ikke kopiere.'); }); };
      }, function (er) { cd.disabled = false; BA.toast(er.message); });
    };
    $('#m-logout', root).onclick = function () {
      BA.confirm('Log ud', 'Denne enhed logges ud og skal have en ny kode for at komme ind igen. Ændringer, der ikke er sendt endnu, går tabt.', 'Log ud', true).then(function (yes) { if (yes) BA.store.logout().then(function () { BA.emit('authlost', 'Du er logget ud.'); }); });
    };
    $('#m-sync', root).onclick = function () { BA.store.retry(); BA.toast('Henter …'); };
    $('#m-saveserver', root).onclick = function () {
      var v = $('#m-server', root).value.trim(), e = $('#m-serr', root);
      if (!SERVER_RE.test(v)) { e.textContent = 'Adressen skal ligne https://script.google.com/macros/s/…/exec'; return; }
      e.textContent = ''; U.safeStore.set('ba.server', v); BA.store.retry(); BA.toast('Adressen er gemt.');
    };

    // mål og regler: gemmes, når feltet forlades
    U.$$('[data-s]', root).forEach(function (el) {
      el.onchange = function () {
        var k = el.getAttribute('data-s'), err = $('#s-err', root); err.textContent = '';
        var val;
        if (k === 'sellerName') val = el.value.trim();
        else {
          var n = U.pnum(el.value);
          if (n === null || n < 0 || (k === 'stockDays' && (Math.floor(n) !== n || n < 1)) || (k === 'vat' && n > 100)) { el.classList.add('invalid'); err.textContent = 'Skriv et gyldigt tal.'; return; }
          el.classList.remove('invalid');
          val = k === 'vat' ? n / 100 : n;
        }
        var f = {}; f[k] = val;
        BA.store.updateSettings(f);
      };
    });
    $('#s-savesales', root).onclick = function () {
      var list = $('#s-sales', root).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      draft.sales = list.join('\n'); draftDirty = false; draftSrc = '';
      BA.store.updateSettings({ salesChannels: list });
    };

    // kanaler
    $('#c-add', root).onclick = function () { readChannelDraft(root); draft.channels.push({ name: '', transit: false, costs: [] }); V.mere(root); };
    U.$$('[data-cdel]', root).forEach(function (b) {
      b.onclick = function () {
        readChannelDraft(root);
        var i = +b.getAttribute('data-cdel'), name = draft.channels[i].name || 'kanalen';
        BA.confirm('Fjern kanal', 'Fjern “' + name + '”? Biler, der er købt via kanalen, beholder navnet.', 'Fjern', true).then(function (yes) { if (yes) { draft.channels.splice(i, 1); V.mere(root); } });
      };
    });
    U.$$('[data-kadd]', root).forEach(function (b) { b.onclick = function () { readChannelDraft(root); draft.channels[+b.getAttribute('data-kadd')].costs.push({ desc: '', cat: '', amount: '' }); V.mere(root); }; });
    U.$$('[data-kdel]', root).forEach(function (b) { b.onclick = function () { readChannelDraft(root); var p = b.getAttribute('data-kdel').split(':'); draft.channels[+p[0]].costs.splice(+p[1], 1); V.mere(root); }; });
    $('#c-save', root).onclick = function () {
      readChannelDraft(root);
      var err = $('#c-err', root); err.textContent = '';
      var out = [], seen = {};
      for (var i = 0; i < draft.channels.length; i++) {
        var c = draft.channels[i], name = String(c.name).trim().replace(/\s+/g, ' ');
        if (!name) { err.textContent = 'Alle kanaler skal have et navn.'; return; }
        if (seen[name.toLowerCase()]) { err.textContent = 'Der er to kanaler, der hedder “' + name + '”.'; return; }
        seen[name.toLowerCase()] = true;
        var costs = [];
        for (var j = 0; j < c.costs.length; j++) {
          var x = c.costs[j], amount = U.pnum(x.amount), desc = String(x.desc).trim();
          if (!desc && !String(x.amount).trim() && !String(x.cat).trim()) continue;
          if (!desc) { err.textContent = 'Alle faste omkostninger på “' + name + '” skal have en tekst.'; return; }
          if (amount === null) { err.textContent = 'Beløbet på “' + desc + '” mangler eller er forkert.'; return; }
          costs.push({ desc: desc, cat: String(x.cat).trim(), amount: amount });
        }
        out.push({ name: name, transit: !!c.transit, costs: costs });
      }
      if (!out.length) { err.textContent = 'Der skal være mindst én kanal.'; return; }
      draft = null; draftDirty = false;
      BA.store.updateSettings({ channels: out });
      BA.toast('Kanalerne er gemt.');
    };
  }
  BA.resetMereDraft = function () { draft = null; };
})();
