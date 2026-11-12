/* Forbindelse til serveren, lokal kopi af data og køen af ændringer.
 *
 * Alt, brugeren ændrer, lægges i en kø og sendes til serveren én ad gangen. Imens vises ændringen med det samme (en "overlejring"
 * oven på det, serveren sidst sagde). Køen huskes i telefonen, så en ændring ikke går tabt, hvis forbindelsen er væk.
 * Hver ændring sender den værdi, den tog udgangspunkt i (from). Er den ændret af en anden i mellemtiden, afvises den, og brugeren får besked. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u;
  var LS = { key: 'ba.key', server: 'ba.server', person: 'ba.person', cache: 'ba.cache.v1', queue: 'ba.queue.v1', qperson: 'ba.queue.person' };
  var TIMEOUT_MS = 45000, UPLOAD_TIMEOUT_MS = 180000;

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  var A = BA.api = {};
  A.server = function () { return U.safeStore.get(LS.server) || A._tmpServer || window.BILARKIV_API_URL || ''; };
  A.key = function () { return U.safeStore.get(LS.key) || A._memKey || ''; };
  A.hasKey = function () { return !!A.key(); };
  A.setLogin = function (server, key, person) {
    A._memKey = key;
    if (server) U.safeStore.set(LS.server, server);
    U.safeStore.set(LS.key, key);
    U.safeStore.set(LS.person, person || '');
  };
  /** Mistet adgang: kun nøglen glemmes. Ændringer, der venter, og den lokale kopi bliver liggende og sendes efter nyt login. */
  A.clearLogin = function () {
    A._memKey = '';
    U.safeStore.del(LS.key);
  };
  /** Bevidst log ud: alt lokalt glemmes. */
  A.clearAll = function () {
    A._memKey = '';
    [LS.key, LS.person, LS.cache, LS.queue, LS.qperson].forEach(U.safeStore.del);
  };

  function apiErr(message, code, data) { var e = new Error(message); e.code = code || ''; e.data = data || null; return e; }

  A.call = function (fn, arg, opts) {
    opts = opts || {};
    var url = A.server();
    if (!url) return Promise.reject(apiErr('Appen kender ikke serveren endnu. Skriv serverens adresse ved indlogning.', 'SETUP'));
    var body = JSON.stringify({ fn: fn, args: arg === undefined ? [] : [arg], key: fn === 'pair' ? '' : A.key() });
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || TIMEOUT_MS) : 0;
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (res.status === 401 || res.status === 403 || res.status === 404) throw apiErr('Serveren kan ikke nås med den adresse. Tjek adressen og at webappen er udgivet til "Alle".', 'SETUP');
        return res.text();
      })
      .then(function (text) {
        clearTimeout(timer);
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        if (!json || typeof json.ok !== 'boolean') {
          if (/^\s*</.test(text) && /ServiceLogin|accounts\.google\.com/i.test(text)) throw apiErr('Serveren kræver login hos Google. Udgiv webappen igen med adgang for "Alle".', 'SETUP');
          throw apiErr('Serveren svarede ikke som forventet. Prøv igen om lidt.', 'BUSY');
        }
        if (json.ok) return json.data;
        var extra = {};
        Object.keys(json).forEach(function (k) { if (k !== 'ok' && k !== 'error' && k !== 'code') extra[k] = json[k]; });
        var err = apiErr(String(json.error || 'Noget gik galt. Prøv igen.'), String(json.code || 'SERVER'), extra);
        if (err.code === 'AUTH' && fn !== 'pair') BA.emit('authlost', err.message);
        throw err;
      }, function (err) {
        clearTimeout(timer);
        if (err && err.code) throw err;
        if (err && err.name === 'AbortError') throw apiErr('Serveren svarer ikke lige nu. Prøv igen om lidt.', 'NET');
        throw apiErr('Ingen forbindelse. Tjek internettet og prøv igen.', 'NET');
      });
  };

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  var DEFAULT_SETTINGS = { vat: 0.2, hourGoal: 500, monthGoal: 60000, stockDays: 60, minProfit: 20000, sellerName: '', channels: [], salesChannels: [] };
  var S = BA.S = { ready: false, cars: [], items: [], settings: DEFAULT_SETTINGS, device: null, online: true, lastSync: 0, error: '', pending: 0, savedAt: 0, loaded: false };
  var base = { cars: [], items: [], settings: null };
  var Q = [];
  var maps = { car: {}, item: {}, byCar: {} };
  var epoch = 0, pumping = false, refreshing = false, retryTimer = 0, retryN = 0, refreshAgain = false;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function findChannel(settings, name) {
    var l = String(name || '').trim().toLowerCase();
    var list = (settings && settings.channels) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === l) return list[i];
    return null;
  }
  BA.findChannel = findChannel;

  var CAR_BLANK = { listedDate: '', id: '', reg: '', model: '', variant: '', year: '', vin: '', fuel: '', color: '', firstReg: '', km: null, channel: '', boughtDate: '', buyPrice: null, listPrice: null, status: 'Købt',
    soldDate: '', soldPrice: null, soldVia: '', buyer: '', buyerPhone: '', notes: '', cover: '', motKm: null, motDate: '', nextInspection: '', folderId: '', extra: {}, createdAt: 0, createdBy: '', updatedAt: 0, updatedBy: '', rev: 1, deleted: false };

  var ITEM_DEFAULTS = {
    udstyr: { name: '', source: 'egen' }, fejl: { text: '', note: '', fixed: false },
    opgave: { text: '', who: '', expPrice: null, expHours: null, done: false, doneDate: '', actPrice: null, actHours: null, fromDefect: '' },
    udgift: { date: '', desc: '', cat: '', amount: null, auto: '', defectId: '' }, time: { date: '', desc: '', cat: '', hours: null },
    reklamation: { date: '', desc: '', type: '', fix: '', kind: '', amount: null },
    abonnement: { name: '', cat: '', amount: null, freq: 'Månedlig', start: '', end: '' }, enkeltudgift: { date: '', desc: '', cat: '', amount: null }
  };
  BA.itemDefaults = function (type) { return clone(ITEM_DEFAULTS[type] || {}); };

  // ---------- overlejring: det, serveren sidst sagde + ændringer der venter ----------
  function applyFx(v, fx) {
    var c, i;
    switch (fx.k) {
      case 'car+':
        if (!v.cm[fx.car.id]) { c = clone(fx.car); v.cars.push(c); v.cm[c.id] = c; }
        (fx.items || []).forEach(function (it) { if (!v.im[it.id]) { var x = clone(it); v.items.push(x); v.im[x.id] = x; } });
        break;
      case 'carset':
        c = v.cm[fx.id]; if (c) Object.keys(fx.fields).forEach(function (k) { c[k] = fx.fields[k]; });
        break;
      case 'cardel':
        if (fx.deleted) { v.cars = v.cars.filter(function (x) { return x.id !== fx.id; }); delete v.cm[fx.id]; v.items = v.items.filter(function (x) { return x.carId !== fx.id; }); }
        else if (!v.cm[fx.id] && fx.car) { c = clone(fx.car); c.deleted = false; v.cars.push(c); v.cm[c.id] = c; (fx.items || []).forEach(function (it) { var y = clone(it); v.items.push(y); v.im[y.id] = y; }); }
        break;
      case 'item+':
        if (!v.im[fx.item.id]) { var it = clone(fx.item); v.items.push(it); v.im[it.id] = it; }
        break;
      case 'itemset':
        var t = v.im[fx.id]; if (t) Object.keys(fx.fields).forEach(function (k) { t[k] = fx.fields[k]; });
        break;
      case 'itemdel':
        if (fx.deleted) { v.items = v.items.filter(function (x) { return x.id !== fx.id; }); delete v.im[fx.id]; }
        else if (!v.im[fx.id] && fx.item) { var r = clone(fx.item); r.deleted = false; v.items.push(r); v.im[r.id] = r; }
        break;
      case 'settings':
        Object.keys(fx.fields).forEach(function (k) { v.settings[k] = fx.fields[k]; });
        break;
      case 'cover':
        c = v.cm[fx.id]; if (c) c.cover = fx.cover;
        break;
    }
  }

  function commit() {
    var v = { cars: base.cars.map(function (c) { return Object.assign({}, c); }), items: base.items.map(function (i) { return Object.assign({}, i); }), settings: Object.assign({}, base.settings || DEFAULT_SETTINGS), cm: {}, im: {} };
    v.cars.forEach(function (c) { v.cm[c.id] = c; });
    v.items.forEach(function (i) { v.im[i.id] = i; });
    Q.forEach(function (op) { try { applyFx(v, op.fx); } catch (e) { if (window.console) console.error('overlay', e); } });
    S.cars = v.cars; S.items = v.items; S.settings = v.settings;
    maps.car = v.cm; maps.item = v.im; maps.byCar = {};
    v.items.forEach(function (i) { (maps.byCar[i.carId] = maps.byCar[i.carId] || []).push(i); });
    S.pending = Q.length;
    saveCacheSoon();
    BA.emit('data');
    BA.emit('status');
  }

  BA.store = {
    car: function (id) { return maps.car[id] || null; },
    item: function (id) { return maps.item[id] || null; },
    itemsOf: function (carId, type) { var l = maps.byCar[carId] || []; return type ? l.filter(function (i) { return i.type === type; }) : l.slice(); },
    globals: function (type) { return S.items.filter(function (i) { return i.carId === '' && (!type || i.type === type); }); }
  };

  // ---------- lokal kopi ----------
  var cacheTimer = 0;
  function saveCacheSoon() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      if (!S.loaded) return;
      U.safeStore.set(LS.cache, JSON.stringify({ base: base, device: S.device, lastSync: S.lastSync }));
    }, 600);
  }
  function saveQ() {
    U.safeStore.set(LS.queue, JSON.stringify(Q));
    if (Q.length && !U.safeStore.get(LS.qperson)) U.safeStore.set(LS.qperson, U.safeStore.get(LS.person) || '');
    if (!Q.length) U.safeStore.del(LS.qperson);
  }
  /** Hvem skrev de ændringer, der venter? (Bruges, hvis en anden person logger ind på enheden.) */
  BA.store.queuePerson = function () { return U.safeStore.get(LS.qperson) || ''; };
  BA.store.dropQueue = function () { Q = []; saveQ(); commit(); };

  BA.store.loadLocal = function () {
    try {
      var c = JSON.parse(U.safeStore.get(LS.cache) || 'null');
      if (c && c.base && Array.isArray(c.base.cars) && Array.isArray(c.base.items) && c.base.settings) {
        base = c.base; S.device = c.device || null; S.lastSync = c.lastSync || 0; S.loaded = true;
      }
    } catch (e) { /* ingen brugbar kopi */ }
    try {
      var q = JSON.parse(U.safeStore.get(LS.queue) || '[]');
      Q = Array.isArray(q) ? q.filter(function (o) { return o && typeof o.fn === 'string' && o.fx; }) : [];
    } catch (e2) { Q = []; }
    if (S.loaded) commit();
    return S.loaded;
  };

  // ---------- hent fra serveren ----------
  BA.store.refresh = function () {
    if (refreshing) { refreshAgain = true; return Promise.resolve(); }
    if (pumping || Q.length) return Promise.resolve();
    refreshing = true;
    var startEpoch = epoch;
    return A.call('getState').then(function (res) {
      refreshing = false;
      if (epoch !== startEpoch || Q.length || pumping) { setTimeout(BA.store.refresh, 400); return; }
      base = { cars: res.cars || [], items: res.items || [], settings: res.settings || DEFAULT_SETTINGS };
      S.device = res.device || S.device; S.lastSync = Date.now(); S.loaded = true; S.ready = true; S.online = true;
      if (res.statuses && res.statuses.length) BA.STATUSES = res.statuses;
      if (S.device && S.device.person) U.safeStore.set(LS.person, S.device.person);
      commit();
      if (refreshAgain) { refreshAgain = false; setTimeout(BA.store.refresh, 200); }
    }, function (err) {
      refreshing = false;
      if (err.code === 'NET') { S.online = false; BA.emit('status'); if (!S.loaded) BA.emit('loadfail', err); return; }
      if (err.code === 'AUTH') return;
      S.error = err.message; BA.emit('status'); if (!S.loaded) BA.emit('loadfail', err);
    });
  };

  // ---------- køen ----------
  function enqueue(fn, arg, fx) {
    Q.push({ fn: fn, arg: arg, fx: fx, t: Date.now() });
    saveQ(); commit(); pump();
  }

  function onOk(op, res) {
    var upsertCar = function (car) {
      if (!car) return;
      base.cars = base.cars.filter(function (c) { return c.id !== car.id; });
      if (!car.deleted) base.cars.push(car);
      else base.items = base.items.filter(function (i) { return i.carId !== car.id; });
    };
    var upsertItem = function (item) {
      if (!item) return;
      base.items = base.items.filter(function (i) { return i.id !== item.id; });
      if (!item.deleted) base.items.push(item);
    };
    switch (op.fn) {
      case 'createCar': upsertCar(res.car); (res.items || []).forEach(upsertItem); break;
      case 'updateCar': case 'markSold': case 'reopenSale': case 'deleteCar': case 'restoreCar': upsertCar(res.car); break;
      case 'addItem': case 'updateItem': case 'deleteItem': case 'restoreItem': upsertItem(res.item); break;
      case 'updateSettings': base.settings = res.settings; break;
    }
    if (op.fn === 'restoreCar' && res.car) {
      // Bilens poster kom ikke med: hent dem igen.
      setTimeout(BA.store.refresh, 300);
    }
  }

  var lastToast = '';
  function softToast(msg) { if (msg === lastToast) return; lastToast = msg; setTimeout(function () { lastToast = ''; }, 3000); BA.toast(msg, { long: true }); }

  BA.store.hold = function (on) { S.hold = !!on; };
  function pump() {
    if (pumping || !Q.length || S.hold) return;
    pumping = true; BA.emit('status');
    var op = Q[0];
    A.call(op.fn, op.arg).then(function (res) {
      onOk(op, res);
      Q.shift(); epoch++; saveQ();
      pumping = false; S.online = true; retryN = 0;
      if (!Q.length) S.savedAt = Date.now();
      BA.emit('qprogress');
      commit();
      if (Q.length) pump(); else { setTimeout(function () { BA.emit('status'); }, 2600); }
    }, function (err) {
      pumping = false;
      // Midlertidige fejl (ingen forbindelse, serveren optaget) prøves igen og igen; en ændring kasseres aldrig på grund af dem.
      if (err.code === 'SERVER') { op.fails = (op.fails || 0) + 1; saveQ(); }
      if (err.code === 'NET' || err.code === 'SETUP' || err.code === 'BUSY' || (err.code === 'SERVER' && op.fails < 8)) {
        S.online = false; S.offlineWhy = err.code === 'NET' ? 'net' : 'server'; S.error = ''; BA.emit('status');
        clearTimeout(retryTimer);
        retryN++;
        retryTimer = setTimeout(pump, Math.min(30000, 2000 * Math.pow(2, Math.min(retryN, 4))));
        return;
      }
      if (err.code === 'AUTH') { BA.emit('status'); return; }
      Q.shift(); epoch++; saveQ();
      if (err.code === 'CONFLICT' && err.data) {
        if (err.data.car) { base.cars = base.cars.filter(function (c) { return c.id !== err.data.car.id; }); base.cars.push(err.data.car); }
        if (err.data.item) { base.items = base.items.filter(function (i) { return i.id !== err.data.item.id; }); base.items.push(err.data.item); }
        if (err.data.settings) base.settings = err.data.settings;
        softToast(err.message);
        S.error = '';
      } else {
        // Afvist: ændringen blev ikke gemt. Fejlen bliver stående i toppen, til brugeren trykker "Prøv igen", og skærmen vises, som serveren har det.
        S.error = 'Ændringen blev ikke gemt: ' + err.message;
        softToast(S.error);
        setTimeout(BA.store.refresh, 300);
      }
      commit();
      BA.emit('rollback');
      if (Q.length) pump();
    });
  }
  BA.store.retry = function () { retryN = 0; clearTimeout(retryTimer); S.error = ''; BA.emit('status'); pump(); BA.store.refresh(); };
  BA.store.queueLength = function () { return Q.length; };
  /** Ligger der en ikke-sendt ændring for denne bil (fx at den skal oprettes)? */
  BA.store.hasPendingFor = function (carId) { return Q.some(function (o) { return o.arg && (o.arg.id === carId || o.arg.carId === carId); }); };

  window.addEventListener('online', function () { if (A.hasKey()) BA.store.retry(); });

  // ---------------------------------------------------------------------------
  // Ændringer (kaldes af skærmbillederne)
  // ---------------------------------------------------------------------------
  function now() { return Date.now(); }
  function person() { return (S.device && S.device.person) || U.safeStore.get(LS.person) || ''; }

  BA.store.updateCar = function (id, fields) {
    var car = maps.car[id]; if (!car) return false;
    var from = {}, changed = {}, any = false;
    Object.keys(fields).forEach(function (k) {
      if (JSON.stringify(car[k] == null ? '' : car[k]) !== JSON.stringify(fields[k] == null ? '' : fields[k])) { from[k] = car[k] === undefined ? null : car[k]; changed[k] = fields[k]; any = true; }
    });
    if (!any) return false;
    // Sættes bilen til Annonceret, begynder dagene "til salg" (serveren gør det samme).
    if (changed.status === 'Annonceret' && !car.listedDate && !('listedDate' in changed)) { from.listedDate = car.listedDate || ''; changed.listedDate = U.today(); }
    enqueue('updateCar', { id: id, fields: changed, from: from }, { k: 'carset', id: id, fields: changed });
    return true;
  };

  BA.store.createCar = function (input) {
    var f = input.fields;
    var car = Object.assign(clone(CAR_BLANK), f, { id: input.id });
    var ch = findChannel(S.settings, f.channel);
    car.channel = ch ? ch.name : '';
    car.status = ch && ch.transit ? 'Under transport' : 'Købt';
    car.boughtDate = car.boughtDate || U.today();
    car.createdAt = now(); car.updatedAt = now(); car.createdBy = person(); car.updatedBy = person();
    var items = [];
    (input.equipment || []).forEach(function (e) { items.push(Object.assign(BA.itemDefaults('udstyr'), { id: U.uid(), carId: input.id, type: 'udstyr', name: e.name, source: e.source || 'egen', rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() })); });
    if (ch && input.applyChannelCosts !== false) ch.costs.forEach(function (c) { items.push(Object.assign(BA.itemDefaults('udgift'), { id: U.uid(), carId: input.id, type: 'udgift', date: car.boughtDate, desc: c.desc, cat: c.cat, amount: c.amount, auto: 'kanal', rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() })); });
    enqueue('createCar', { id: input.id, fields: f, equipment: input.equipment || [], applyChannelCosts: input.applyChannelCosts !== false }, { k: 'car+', car: car, items: items });
    return car;
  };

  BA.store.markSold = function (id, d) {
    var fields = { status: 'Solgt', soldPrice: d.soldPrice, soldDate: d.soldDate || U.today(), soldVia: d.soldVia || '', buyer: d.buyer || '', buyerPhone: d.buyerPhone || '' };
    enqueue('markSold', Object.assign({ id: id }, d), { k: 'carset', id: id, fields: fields });
  };
  BA.store.reopenSale = function (id) {
    enqueue('reopenSale', { id: id }, { k: 'carset', id: id, fields: { status: 'Annonceret', soldPrice: null, soldDate: '', soldVia: '', buyer: '', buyerPhone: '' } });
  };
  BA.store.deleteCar = function (id) {
    var car = maps.car[id]; if (!car) return;
    enqueue('deleteCar', { id: id }, { k: 'cardel', id: id, deleted: true });
  };
  BA.store.restoreCar = function (car, items) {
    enqueue('restoreCar', { id: car.id }, { k: 'cardel', id: car.id, deleted: false, car: car, items: items });
  };

  BA.store.addItem = function (carId, type, data) {
    var item = Object.assign(BA.itemDefaults(type), data, { id: U.uid(), carId: carId, type: type, rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() });
    var send = {}; Object.keys(data).forEach(function (k) { send[k] = data[k]; });
    enqueue('addItem', { id: item.id, carId: carId, type: type, data: send }, { k: 'item+', item: item });
    return item.id;
  };
  BA.store.updateItem = function (id, fields) {
    var it = maps.item[id]; if (!it) return false;
    var from = {}, changed = {}, any = false;
    Object.keys(fields).forEach(function (k) {
      if (JSON.stringify(it[k] == null ? '' : it[k]) !== JSON.stringify(fields[k] == null ? '' : fields[k])) { from[k] = it[k] === undefined ? null : it[k]; changed[k] = fields[k]; any = true; }
    });
    if (!any) return false;
    enqueue('updateItem', { id: id, fields: changed, from: from }, { k: 'itemset', id: id, fields: changed });
    return true;
  };
  BA.store.deleteItem = function (id) {
    var it = maps.item[id]; if (!it) return null;
    var copy = clone(it);
    enqueue('deleteItem', { id: id }, { k: 'itemdel', id: id, deleted: true });
    return copy;
  };
  BA.store.restoreItem = function (item) {
    enqueue('restoreItem', { id: item.id }, { k: 'itemdel', id: item.id, deleted: false, item: item });
  };
  BA.store.updateSettings = function (fields) {
    var from = {}, changed = {}, any = false;
    Object.keys(fields).forEach(function (k) {
      if (JSON.stringify(S.settings[k]) !== JSON.stringify(fields[k])) { from[k] = S.settings[k] === undefined ? null : S.settings[k]; changed[k] = fields[k]; any = true; }
    });
    if (!any) return false;
    enqueue('updateSettings', { fields: changed, from: from }, { k: 'settings', fields: changed });
    return true;
  };

  /** Svar fra uploadFile (kører uden om køen). */
  BA.store.applyUpload = function (res) {
    if (res.item) { base.items = base.items.filter(function (i) { return i.id !== res.item.id; }); base.items.push(res.item); }
    if (res.car) { base.cars = base.cars.filter(function (c) { return c.id !== res.car.id; }); base.cars.push(res.car); }
    epoch++;
    commit();
  };
  BA.store.afterConflict = function (err) {
    if (err.data && err.data.car) { base.cars = base.cars.filter(function (c) { return c.id !== err.data.car.id; }); base.cars.push(err.data.car); commit(); }
  };

  BA.store.logout = function () {
    return A.call('logoutDevice').then(function () { return true; }, function () { return false; }).then(function () { A.clearAll(); base = { cars: [], items: [], settings: null }; Q = []; S.loaded = false; S.ready = false; commit(); });
  };

  // Regelmæssig opdatering, når appen er åben.
  setInterval(function () { if (document.visibilityState === 'visible' && A.hasKey() && !Q.length) BA.store.refresh(); }, 45000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && A.hasKey()) { if (Q.length) pump(); else BA.store.refresh(); } });
  window.addEventListener('beforeunload', function (e) {
    if (Q.length || (BA.up && BA.up.busy && BA.up.busy())) { e.preventDefault(); e.returnValue = ''; }
  });
})();
