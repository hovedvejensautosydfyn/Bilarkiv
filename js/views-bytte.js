/* Byttebil-købsaftale fra forsiden (Fase 3): Oliver køber bilen af kunden. Kunden skriver under med fingeren på telefonen.
 * Gem opretter byttebilen som ny bil (kanal Byttebil) OG laver købsaftalen som PDF på bilen. Alt går gennem køen: intet tabes, hvis nettet svigter.
 * Kladden (også underskrifterne) huskes i telefonen, indtil aftalen er gemt. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, A = BA.api, $ = U.$, esc = U.esc;
  var V = BA.views = BA.views || {};
  var KEY = 'ba.bytte';
  var MIN_INK = 80;   // mindste længde af en underskrift (i lærredets 600 enheder)
  var st = null;      // kladden
  var pads = {};

  var TEXT = ['reg', 'model', 'variant', 'year', 'vin', 'fuel', 'color', 'km', 'custName', 'custAddress', 'custCity', 'custPhone', 'custEmail', 'price', 'payment', 'tradeAgainst', 'agreements', 'date'];

  function blank() {
    var o = { sigCust: '', sigBuyer: '', firstRegIso: '', equip: [], looked: false, msg: '', savedAt: 0 };
    TEXT.forEach(function (k) { o[k] = ''; });
    o.payment = 'Bankoverførsel'; o.date = U.today();
    return o;
  }
  function load() {
    if (st) return st;
    st = blank();
    try { var s = JSON.parse(U.safeStore.get(KEY) || 'null'); if (s && typeof s === 'object') Object.keys(s).forEach(function (k) { if (k in st) st[k] = s[k]; }); } catch (e) { /* tom kladde */ }
    if (!st.date) st.date = U.today();
    return st;
  }
  var saveTm = 0;
  function save() {
    clearTimeout(saveTm);
    saveTm = setTimeout(function () { if (st) { st.savedAt = Date.now(); U.safeStore.set(KEY, JSON.stringify(st)); } }, 300);
  }
  function saveNow() { clearTimeout(saveTm); if (st) { st.savedAt = Date.now(); U.safeStore.set(KEY, JSON.stringify(st)); } }

  function docVals() {
    var s = st;
    return { custName: s.custName, custAddress: s.custAddress, custCity: s.custCity, custPhone: s.custPhone, custEmail: s.custEmail, reg: String(s.reg).replace(/[\s.\-]/g, '').toUpperCase(), vin: s.vin,
      model: s.model, variant: s.variant, firstReg: s.firstRegIso ? U.fmtDate(s.firstRegIso) : '', km: s.km, fuel: s.fuel, price: s.price, payment: s.payment, tradeAgainst: s.tradeAgainst,
      agreements: s.agreements, date: s.date, sellerName: (BA.S.settings && BA.S.settings.sellerName) || '', sigCust: s.sigCust, sigBuyer: s.sigBuyer };
  }

  // ---------- underskrift med fingeren ----------
  function makePad(canvas, initial, onChange) {
    var ctx = canvas.getContext('2d'), drawing = false, last = null, has = !!initial, ink = initial ? MIN_INK : 0;
    ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111111';
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; }
    function data() {
      var url = canvas.toDataURL('image/png');
      if (url.length > BA.docs.MAX_SIG) {   // for stor: tegn den mindre
        var t = document.createElement('canvas'); t.width = canvas.width / 2; t.height = canvas.height / 2;
        t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
        url = t.toDataURL('image/png');
      }
      return url;
    }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault(); drawing = true; last = pos(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ingen */ }
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.4, 0, 6.3); ctx.fill();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      e.preventDefault();
      var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ink += Math.sqrt((p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y)); last = p;
    });
    // En prik eller et lille streg er ikke en underskrift: først når der er tegnet nok (MIN_INK af 600 i bredden), tæller den med.
    function end() { if (!drawing) return; drawing = false; has = ink >= MIN_INK; onChange(has ? data() : ''); }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', function () { if (drawing) end(); });
    if (initial) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); }; img.src = initial; }
    return { clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); has = false; ink = 0; onChange(''); }, has: function () { return has; } };
  }

  function field(k, label, o) {
    o = o || {};
    var v = st[k] == null ? '' : st[k];
    var inner = o.area ? '<textarea id="by-' + k + '" data-by="' + k + '" rows="3" maxlength="1500">' + esc(v) + '</textarea>'
      : '<input id="by-' + k + '" data-by="' + k + '"' + (o.type ? ' type="' + o.type + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + ' maxlength="200" value="' + esc(v) + '" autocomplete="off"' + (o.cap ? ' autocapitalize="characters"' : '') + '>';
    return '<div class="field' + (o.wide ? ' wide' : '') + '"><label for="by-' + k + '">' + esc(label) + (o.req ? ' *' : '') + '</label>' + inner + '<div class="errtxt" data-err="' + k + '"></div></div>';
  }

  V.byttebilReset = function () { pads = {}; };

  V.bytte = function (root) {
    load();
    pads = {};
    root.innerHTML = '<a class="crumb" href="#/lager">‹ Biler på lager</a><h1 class="page">Byttebil – købsaftale</h1>' + BA.offlineBanner() +
      '<p class="muted" style="margin-top:-6px">Du køber bilen af kunden. Kunden skriver under med fingeren. Bilen oprettes som ny bil (kanal Byttebil), og aftalen ligger som PDF på bilen, klar til udskrift på kontoret.</p>' +
      '<div class="card"><div class="hd"><h2>1 · Bilen</h2></div><div class="row" style="align-items:flex-end"><div class="field" style="flex:1;margin:0"><label for="by-reg">Nummerplade</label><input id="by-reg" data-by="reg" value="' + esc(st.reg) + '" autocapitalize="characters" autocomplete="off" maxlength="12" class="plateinput"></div><button type="button" class="btn primary" id="by-look">Slå op</button></div><div class="errtxt" data-err="reg"></div>' +
      '<div id="by-msg" class="banner" ' + (st.msg ? '' : 'hidden') + '>' + esc(st.msg) + '</div>' +
      '<div class="grid2" style="margin-top:10px">' + field('model', 'Mærke og model', { req: 1, wide: 1 }) + field('variant', 'Variant', { wide: 1 }) + field('year', 'Årgang', { mode: 'numeric' }) + field('fuel', 'Brændstof') + field('vin', 'Stelnummer') + field('color', 'Farve') + field('km', 'Km nu', { mode: 'numeric' }) + '</div></div>' +
      '<div class="card"><div class="hd"><h2>2 · Kunden (sælger)</h2></div><div class="grid2">' + field('custName', 'Navn', { req: 1, wide: 1 }) + field('custAddress', 'Adresse', { wide: 1 }) + field('custCity', 'Postnr./by') + field('custPhone', 'Tlf.', { type: 'tel' }) + field('custEmail', 'E-mail', { wide: 1, type: 'email' }) + '</div><p class="muted small" style="margin:0">CPR/CVR står som en tom linje på papiret og skrives i hånden – det gemmes ikke i appen.</p></div>' +
      '<div class="card"><div class="hd"><h2>3 · Aftalen</h2></div><div class="grid2">' + field('price', 'Aftalt pris (kr)', { req: 1, mode: 'decimal' }) + field('date', 'Dato', { type: 'date' }) + field('payment', 'Betaling / modregning', { wide: 1 }) + field('tradeAgainst', 'Modregnes i køb af bil (valgfri)', { wide: 1 }) + field('agreements', 'Kendte fejl, mangler og aftaler', { area: 1 }) + '</div></div>' +
      '<div class="card"><div class="hd"><h2>4 · Underskrifter</h2></div><p class="muted small" style="margin:0 0 8px">Giv telefonen til kunden. Skriv med fingeren i feltet.</p>' +
      '<div class="padbox"><label>Kundens underskrift (sælger) *</label><canvas id="by-pad1" width="600" height="180" aria-label="Kundens underskrift"></canvas><div class="errtxt" data-err="sigCust"></div><button type="button" class="btn small" data-clear="1">Ryd og skriv igen</button></div>' +
      '<div class="padbox"><label>Din underskrift (køber, valgfri – kan også skrives på papiret)</label><canvas id="by-pad2" width="600" height="180" aria-label="Købers underskrift"></canvas><button type="button" class="btn small" data-clear="2">Ryd og skriv igen</button></div></div>' +
      '<details class="card" id="by-prevd"><summary class="muted" style="cursor:pointer;font-weight:600">Se udkastet</summary><div class="docframe-wrap" style="margin-top:10px"><iframe class="docframe" title="Udkast" tabindex="-1" sandbox="allow-same-origin"></iframe></div></details>' +
      '<div class="errtxt" id="by-err" style="margin:8px 0"></div><button type="button" class="btn primary big" id="by-go">Gem og opret byttebilen</button><button type="button" class="btn" id="by-print" style="margin-top:8px;width:100%">Udskriv udkastet</button><button type="button" class="btn ghost" id="by-reset" style="margin-top:8px">Start forfra</button>';
    bind(root);
  };

  function preview(root) {
    var det = $('#by-prevd', root); if (!det || !det.open) return;
    var fr = $('.docframe', det);
    fr.onload = function () { scale(det); };
    fr.srcdoc = BA.docs.html('bytte', docVals());
    setTimeout(function () { scale(det); }, 80);
  }
  function scale(det) {
    var wrap = $('.docframe-wrap', det), fr = $('.docframe', det);
    if (!wrap || !wrap.clientWidth) return;
    var k = wrap.clientWidth / 794, h = 1123;
    try { h = Math.max(1123, fr.contentDocument.documentElement.scrollHeight); } catch (e) { /* standard */ }
    fr.style.height = h + 'px'; fr.style.transform = 'scale(' + k + ')'; wrap.style.height = Math.ceil(h * k) + 'px';
  }

  function bind(root) {
    var tm = 0;
    root.oninput = function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-by');
      if (!k) return;
      st[k] = e.target.value; save();
      clearTimeout(tm); tm = setTimeout(function () { preview(root); }, 350);
    };
    var p1 = makePad($('#by-pad1', root), st.sigCust, function (d) { st.sigCust = d; saveNow(); preview(root); });
    var p2 = makePad($('#by-pad2', root), st.sigBuyer, function (d) { st.sigBuyer = d; saveNow(); preview(root); });
    pads = { 1: p1, 2: p2 };
    U.$$('[data-clear]', root).forEach(function (b) { b.onclick = function () { pads[b.getAttribute('data-clear')].clear(); }; });
    $('#by-prevd', root).addEventListener('toggle', function () { preview(root); });
    $('#by-look', root).onclick = function () { lookup(root); };
    $('#by-reset', root).onclick = function () {
      BA.confirm('Start forfra', 'Alt, du har skrevet og tegnet her, slettes.', 'Slet kladden', true).then(function (yes) { if (!yes) return; st = blank(); U.safeStore.del(KEY); V.bytte(root); });
    };
    $('#by-go', root).onclick = function () { go(root); };
    $('#by-print', root).onclick = function () { BA.docsPrint(BA.docs.html('bytte', docVals())); };
    window.addEventListener('resize', function r() { if (!root.isConnected) { window.removeEventListener('resize', r); return; } var d = $('#by-prevd', root); if (d && d.open) scale(d); });
  }

  function lookup(root) {
    var reg = String(st.reg).replace(/[\s.\-]/g, '').toUpperCase(), msg = $('#by-msg', root), btn = $('#by-look', root);
    var show = function (t) { st.msg = t; msg.textContent = t; msg.hidden = !t; save(); };
    if (!reg) { show('Skriv nummerpladen.'); return; }
    btn.disabled = true; btn.textContent = 'Slår op …';
    A.call('lookupPlate', { reg: reg }, { timeout: 40000 }).then(function (res) {
      btn.disabled = false; btn.textContent = 'Slå op';
      st.reg = res.reg || reg;
      if (res.existing) { show('Bilen findes allerede i Bilarkivet (' + res.existing.model + ', ' + res.existing.status + '). Tjek, at det ikke er en dublet.'); }
      var c = res.car;
      if (c) {
        st.model = c.model || st.model; st.variant = c.variant || st.variant; st.year = c.year || st.year; st.fuel = c.fuel || st.fuel; st.color = c.color || st.color; st.vin = c.vin || st.vin;
        st.firstRegIso = c.firstReg || st.firstRegIso;
        st.equip = (res.equipment || []).map(function (e) { return { name: e.name, source: 'dmr' }; });
        st.looked = true;
        if (!res.existing) show(res.statusNote || 'Oplysningerne er hentet fra registret. Skriv km-standen og tjek resten.');
      }
      save();
      V.bytte(root);
      var m2 = $('#by-msg', root); if (m2 && st.msg) { m2.textContent = st.msg; m2.hidden = false; }
    }, function (er) {
      btn.disabled = false; btn.textContent = 'Slå op';
      show(er.code === 'NET' ? 'Ingen forbindelse. Du kan stadig skrive oplysningerne selv og gemme aftalen.' : er.message);
    });
  }

  function go(root) {
    var errBox = $('#by-err', root);
    U.$$('.errtxt', root).forEach(function (x) { x.textContent = ''; }); errBox.textContent = '';
    var bad = false;
    function err(k, m) { var e = $('[data-err=' + k + ']', root); if (e) e.textContent = m; if (!bad) { var el = $('[data-by=' + k + ']', root) || $('#by-pad1', root); if (el && el.focus) el.focus(); } bad = true; }
    var reg = String(st.reg).replace(/[\s.\-]/g, '').toUpperCase();
    if (!String(st.model).trim()) err('model', 'Skriv mærke og model.');
    if (!String(st.custName).trim()) err('custName', 'Skriv kundens navn.');
    var price = U.pnum(st.price);
    if (price === null || price < 0) err('price', 'Skriv den aftalte pris.');
    if (reg && !/^[A-Z0-9]{2,8}$/.test(reg)) err('reg', 'Nummerpladen ser forkert ud.');
    if (reg && BA.S.cars.some(function (c) { return c.reg === reg && !BA.isSold(c.status); })) err('reg', 'Bilen ' + reg + ' findes allerede på lager.');
    var km = String(st.km).trim() === '' ? null : U.pnum(st.km);
    if (st.km && (km === null || km < 0 || Math.floor(km) !== km)) err('km', 'Km skal være et helt tal.');
    if (!BA.docs.sigOk(st.sigCust)) err('sigCust', 'Kunden skal skrive under (en hel underskrift, ikke kun en prik), før aftalen kan gemmes.');
    var c = BA.docs.clean('bytte', docVals());
    if (c.error && !bad) { errBox.textContent = c.error; bad = true; }
    if (bad) { if (!errBox.textContent) errBox.textContent = 'Ret det, der er markeret med rødt.'; return; }

    var chan = (BA.S.settings.channels || []).filter(function (x) { return /byttebil/i.test(x.name); })[0];
    var id = U.uid();
    var fields = { reg: reg, model: String(st.model).trim(), variant: String(st.variant).trim(), year: String(st.year).trim(), vin: String(st.vin).replace(/\s/g, '').toUpperCase(), fuel: String(st.fuel).trim(), color: String(st.color).trim(),
      firstReg: st.firstRegIso || '', km: km, channel: chan ? chan.name : 'Byttebil', boughtDate: st.date || U.today(), buyPrice: price,
      notes: 'Byttebil købt af ' + String(st.custName).trim() + (String(st.custPhone).trim() ? ' (tlf. ' + String(st.custPhone).trim() + ')' : '') + '.' };
    // opret bilen (som ny bil) og derefter dokumentet: køen sender dem i den rækkefølge, og følger hinanden, hvis noget går galt
    BA.store.createCar({ id: id, fields: fields, equipment: st.equip || [], applyChannelCosts: true });
    BA.store.makeDocument(id, 'bytte', c.vals);
    st = blank(); clearTimeout(saveTm); U.safeStore.del(KEY); pads = {};
    BA.toast('Byttebilen er oprettet. Købsaftalen laves som PDF og ligger under Papirer om et øjeblik.', { long: true });
    BA.go('#/bil/' + id);
  }
})();
