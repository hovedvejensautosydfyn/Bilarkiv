/* Forbindelse til serveren, lokal kopi af data og køen af ændringer.
 *
 * Alt, brugeren ændrer, lægges i en kø og sendes til serveren én ad gangen. Imens vises ændringen med det samme (en "overlejring"
 * oven på det, serveren sidst sagde). Køen huskes i telefonen, så en ændring ikke går tabt, hvis forbindelsen er væk.
 * Hver ændring sender den værdi, den tog udgangspunkt i (from). Er den ændret af en anden i mellemtiden, hører den ikke til køen mere.
 *
 * INTET SMIDES VÆK: en ændring, serveren afviser (eller som en anden skriver kom først med), flyttes til listen "Kunne ikke gemmes"
 * (Mere), hvor den kan rettes og sendes igen eller slettes af brugeren selv. Midlertidige fejl (net, optaget, serverfejl) prøves igen.
 * Det, der skal huskes, skrives både til localStorage (hurtigt, overlever at appen lukkes) og IndexedDB (stort). Den store lokale kopi af
 * arkivet ligger kun i IndexedDB, så den aldrig fylder localStorage op. Kan køen ikke gemmes, vises en tydelig advarsel.
 *
 * Appen og serveren kan ikke komme ud af takt: serveren melder sit versionsnummer, og er den for gammel, holdes køen tilbage.
 * Hentning: kun det ændrede siden sidst (eller ingenting, hvis intet er ændret). En fuld hentning sker ved start, hvert 10. minut og ved "Hent nyt nu". */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u;
  var LS = { key: 'ba.key', server: 'ba.server', person: 'ba.person', cacheOld: 'ba.cache.v1', queue: 'ba.queue.v1', failed: 'ba.failed.v1', qperson: 'ba.queue.person' };
  var TIMEOUT_MS = 45000, UPLOAD_TIMEOUT_MS = 180000;
  /** Laveste serverversion, appen kan arbejde sammen med (Code.gs: SERVER_VERSION). */
  var NEEDS_SERVER = 4;
  var FULL_EVERY_MS = 10 * 60 * 1000, OVERLAP_MS = 60000, MAX_SERVER_FAILS = 8;

  // ---------------------------------------------------------------------------
  // IndexedDB (stort lager til den lokale kopi og en ekstra kopi af køen)
  // ---------------------------------------------------------------------------
  var kvDb = null, kvOpening = null;
  function kvOpen() {
    if (kvDb) return Promise.resolve(kvDb);
    if (kvOpening) return kvOpening;
    kvOpening = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('bilarkiv-data', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { kvDb = req.result; resolve(kvDb); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return kvOpening;
  }
  function kvGet(key) {
    return kvOpen().then(function (d) {
      if (!d) return undefined;
      return new Promise(function (resolve) {
        try { var r = d.transaction('kv').objectStore('kv').get(key); r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { resolve(undefined); }; } catch (e) { resolve(undefined); }
      });
    });
  }
  function kvPut(key, value) {
    return kvOpen().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
          tx.onabort = function () { resolve(false); };
        } catch (e) { kvDb = null; kvOpening = null; resolve(false); }   // forbindelsen til lageret er død (kendt på iPhone): åbn den igen næste gang
      });
    });
  }
  function kvDel(key) {
    return kvOpen().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        try { var tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = function () { resolve(true); }; tx.onerror = tx.onabort = function () { resolve(false); }; } catch (e) { resolve(false); }
      });
    });
  }

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
    [LS.key, LS.person, LS.cacheOld, LS.queue, LS.failed, LS.qperson, 'ba.newcar'].forEach(U.safeStore.del);
    if (BA.clearDrafts) BA.clearDrafts(true);   // kladder til dokumenter, annoncer og byttebil (kundeoplysninger og underskrifter) følger ikke med til den næste, der logger ind
    kvDel('cache'); kvDel('queue'); kvDel('failed');
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
  var DEFAULT_SETTINGS = { vat: 0.2, hourGoal: 500, monthGoal: 60000, stockDays: 60, minProfit: 20000, sellerName: '', channels: [], salesChannels: [], priceCheckDays: [30, 45, 60], chargeHours: 48, morningHour: 8 };
  var S = BA.S = { ready: false, cars: [], items: [], settings: DEFAULT_SETTINGS, device: null, online: true, lastSync: 0, error: '', pending: 0, savedAt: 0, loaded: false,
    serverVersion: 0, serverOld: false, versionOk: false, storageWarn: false, failedCount: 0, backup: null, reminders: null };
  var base = { cars: [], items: [], settings: null };
  var Q = [];          // ændringer, der venter på at blive sendt
  var Fl = [];         // ændringer, der ikke kunne gemmes (venter på, at brugeren retter, sender igen eller sletter dem)
  var stamp = { time: 0, rev: -1 };   // serverens tid og ændringstæller ved sidste hentning
  var lastFull = 0;
  var maps = { car: {}, item: {}, byCar: {} };
  var epoch = 0, pumping = false, refreshing = false, retryTimer = 0, retryN = 0, refreshAgain = false, fullNext = false;

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
    reklamation: { date: '', desc: '', ctype: '', fix: '', kind: '', amount: null },
    abonnement: { name: '', cat: '', amount: null, freq: 'Månedlig', start: '', end: '' }, enkeltudgift: { date: '', desc: '', cat: '', amount: null },
    tick: { kind: '', at: null }, todo: { text: '', due: '', done: false, doneAt: null, note: '' },
    booking: { start: null, kind: 'Prøvetur', who: '', phone: '', note: '', done: false, cancelled: false },
    tjek: { list: '', key: '', state: '', note: '', at: null }
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
    S.failedCount = Fl.length;
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

  // ---------------------------------------------------------------------------
  // Lokal kopi og huskede lister
  // ---------------------------------------------------------------------------
  var cacheTimer = 0;
  function saveCacheSoon() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      if (!S.loaded) return;
      var snapshot = { base: base, device: S.device, lastSync: S.lastSync, stamp: stamp, lastFull: lastFull, backup: S.backup };
      kvPut('cache', snapshot).then(function (ok) {
        if (ok) { U.safeStore.del(LS.cacheOld); return; }
        // IndexedDB virker ikke (fx privat fane): forsøg igen næste gang, og brug kun det lille lager, hvis kopien er lille.
        // En stor kopi må ikke fylde det lille lager op, for dér ligger køen af ændringer. Kopien kan altid hentes igen fra serveren.
        kvDb = null; kvOpening = null;
        var json = JSON.stringify(snapshot);
        if (json.length < 200000) U.safeStore.set(LS.cacheOld, json);
      });
    }, 600);
  }

  /**
   * Gemmer en liste (køen eller listen over det, der ikke kunne gemmes) både i localStorage og IndexedDB.
   * localStorage gemmer med det samme (overlever, at appen lukkes), IndexedDB er en ekstra kopi.
   * Kan localStorage ikke gemme (fuldt), slettes den gamle udgave dér (den ville være forældet), og IndexedDB bruges ved næste start.
   * Giver false, hvis det lille lager ikke kunne gemme: så vises en advarsel.
   */
  function saveList(lsKey, kvKey, list) {
    var json = JSON.stringify(list);
    var ok = U.safeStore.set(lsKey, json);
    if (!ok) { U.safeStore.del(lsKey); }
    kvPut(kvKey, list).then(function (saved) {
      if (!ok && !saved) { S.storageWarn = true; BA.emit('status'); }
    });
    return ok;
  }
  function loadList(lsKey, kvKey) {
    var raw = U.safeStore.get(lsKey);
    if (raw != null) {
      try { var a = JSON.parse(raw); if (Array.isArray(a)) return Promise.resolve(a); } catch (e) { /* ødelagt: prøv IndexedDB */ }
    }
    return kvGet(kvKey).then(function (v) { return Array.isArray(v) ? v : []; });
  }
  function noteStorage(ok) {
    var warn = !ok;
    if (warn !== S.storageWarn) { S.storageWarn = warn; BA.emit('status'); }
  }
  function saveQ() {
    noteStorage(saveList(LS.queue, 'queue', Q));
    if (Q.length && !U.safeStore.get(LS.qperson)) U.safeStore.set(LS.qperson, U.safeStore.get(LS.person) || '');
    if (!Q.length) U.safeStore.del(LS.qperson);
  }
  function saveFailed() {
    S.failedCount = Fl.length;
    noteStorage(saveList(LS.failed, 'failed', Fl));
    BA.emit('failed'); BA.emit('status');
  }
  /** Hvem skrev de ændringer, der venter? (Bruges, hvis en anden person logger ind på enheden.) */
  BA.store.queuePerson = function () { return U.safeStore.get(LS.qperson) || ''; };
  BA.store.dropQueue = function () { Q = []; saveQ(); commit(); };

  /** Henter det, telefonen har gemt: kopien af arkivet, køen og listen over det, der ikke kunne gemmes. Giver et løfte, der er true, hvis der var en brugbar kopi. */
  BA.store.loadLocal = function () {
    var cacheP = kvGet('cache').then(function (c) {
      if (c && c.base) return c;
      try { return JSON.parse(U.safeStore.get(LS.cacheOld) || 'null'); } catch (e) { return null; }   // gammel udgave i det lille lager
    });
    return Promise.all([cacheP, loadList(LS.queue, 'queue'), loadList(LS.failed, 'failed')]).then(function (r) {
      var c = r[0];
      if (c && c.base && Array.isArray(c.base.cars) && Array.isArray(c.base.items) && c.base.settings) {
        base = c.base; S.device = c.device || null; S.lastSync = c.lastSync || 0; S.loaded = true;
        stamp = c.stamp && typeof c.stamp.time === 'number' ? c.stamp : { time: 0, rev: -1 }; lastFull = c.lastFull || 0; S.backup = c.backup || null;
      }
      Q = r[1].filter(function (o) { return o && typeof o.fn === 'string' && o.fx; });
      Fl = r[2].filter(function (g) { return g && Array.isArray(g.ops) && g.ops.length; });
      S.failedCount = Fl.length;
      if (S.loaded) commit(); else BA.emit('status');
      return S.loaded;
    });
  };

  // ---------------------------------------------------------------------------
  // Serverens version
  // ---------------------------------------------------------------------------
  function noteServerVersion(v) {
    v = Number(v) || 1;
    var old = v < NEEDS_SERVER;
    var changed = old !== S.serverOld || v !== S.serverVersion;
    S.serverVersion = v; S.serverOld = old; S.versionOk = !old;
    if (changed) BA.emit('status');
  }
  /** Tjekker (én gang pr. start) at serveren er ny nok, før ændringer sendes. En gammel server kender ikke "ping". */
  function ensureVersion() {
    if (S.versionOk) return Promise.resolve(true);
    return A.call('ping').then(function (res) { noteServerVersion(res.serverVersion); return S.versionOk; }, function (err) {
      if (err.code === 'INPUT' && /^Ukendt handling/.test(err.message)) { noteServerVersion(1); return false; }
      throw err;
    });
  }

  // ---------------------------------------------------------------------------
  // Hent fra serveren (kun det ændrede)
  // ---------------------------------------------------------------------------
  function mergeDelta(res) {
    var cars = {}, items = {};
    base.cars.forEach(function (c) { cars[c.id] = c; });
    base.items.forEach(function (i) { items[i.id] = i; });
    var goneCars = {};
    (res.cars || []).forEach(function (c) {
      if (c.deleted) { delete cars[c.id]; goneCars[c.id] = true; } else cars[c.id] = c;
    });
    (res.items || []).forEach(function (it) {
      if (it.deleted) delete items[it.id]; else items[it.id] = it;
    });
    base.cars = Object.keys(cars).map(function (k) { return cars[k]; });
    base.items = Object.keys(items).map(function (k) { return items[k]; }).filter(function (i) { return !goneCars[i.carId]; });
    if (res.settings) base.settings = res.settings;
  }

  BA.store.refresh = function (opts) {
    opts = opts || {};
    if (refreshing) { refreshAgain = true; if (opts.full) fullNext = true; return Promise.resolve(); }
    if (pumping || Q.length) return Promise.resolve();
    refreshing = true;
    var startEpoch = epoch;
    var full = !!opts.full || fullNext || !S.loaded || !(stamp.time > 0) || Date.now() - lastFull > FULL_EVERY_MS;
    fullNext = false;
    var arg = full ? undefined : { since: Math.max(1, stamp.time - OVERLAP_MS), rev: stamp.rev, gen: stamp.gen };
    return A.call('getState', arg).then(function (res) {
      refreshing = false;
      if (epoch !== startEpoch || Q.length || pumping) { setTimeout(BA.store.refresh, 400); return; }
      noteServerVersion(res.serverVersion);
      if (res.unchanged) {
        // Intet nyt: ingen data at tegne om.
        stamp = { time: res.serverTime, rev: res.rev, gen: res.gen };
        S.lastSync = Date.now(); S.online = true; S.ready = true; S.backup = res.backup || S.backup; S.reminders = res.reminders || S.reminders;
        if (res.device) S.device = res.device;
        saveCacheSoon(); BA.emit('status');
      } else {
        if (res.delta) mergeDelta(res);
        else { base = { cars: res.cars || [], items: res.items || [], settings: res.settings || DEFAULT_SETTINGS }; lastFull = Date.now(); }
        stamp = typeof res.rev === 'number' && res.serverTime > 0 ? { time: res.serverTime, rev: res.rev, gen: res.gen } : { time: 0, rev: -1 };   // en gammel server har ingen tæller: altid fuld hentning
        S.device = res.device || S.device; S.lastSync = Date.now(); S.loaded = true; S.ready = true; S.online = true; S.backup = res.backup || null; S.reminders = res.reminders || null;
        if (res.statuses && res.statuses.length) BA.STATUSES = res.statuses;
        if (S.device && S.device.person) U.safeStore.set(LS.person, S.device.person);
        commit();
      }
      if (refreshAgain) { refreshAgain = false; setTimeout(BA.store.refresh, 200); }
    }, function (err) {
      refreshing = false;
      if (err.code === 'NET') { S.online = false; BA.emit('status'); if (!S.loaded) BA.emit('loadfail', err); return; }
      if (err.code === 'AUTH') return;
      S.error = err.message; BA.emit('status'); if (!S.loaded) BA.emit('loadfail', err);
    });
  };

  // ---------------------------------------------------------------------------
  // Køen
  // ---------------------------------------------------------------------------
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
      case 'makeDocument':
        upsertItem(res.item);
        if (res.removed) base.items = base.items.filter(function (i) { return i.id !== res.removed; });
        if (res.car) upsertCar(res.car);
        break;
    }
    if (op.fn === 'restoreCar' && res.car) {
      // Bilens poster kom ikke med: hent dem igen (serveren sender alle poster på en bil, der er ændret).
      setTimeout(BA.store.refresh, 300);
    }
  }

  var lastToast = '';
  function softToast(msg) { if (msg === lastToast) return; lastToast = msg; setTimeout(function () { lastToast = ''; }, 3000); BA.toast(msg, { long: true }); }

  BA.store.hold = function (on) { S.hold = !!on; };

  function scheduleRetry(err) {
    S.online = false; S.offlineWhy = err.code === 'NET' ? 'net' : 'server'; S.error = ''; BA.emit('status');
    clearTimeout(retryTimer);
    retryN++;
    retryTimer = setTimeout(pump, Math.min(30000, 2000 * Math.pow(2, Math.min(retryN, 4))));
  }

  function pump() {
    if (pumping || !Q.length || S.hold) return;
    pumping = true; BA.emit('status');
    ensureVersion().then(function (ok) {
      if (!ok) { pumping = false; S.online = true; BA.emit('status'); return; }   // serveren er for gammel: ændringerne bliver liggende, til den er opdateret
      var op = Q[0];
      return A.call(op.fn, op.arg, op.fn === 'makeDocument' ? { timeout: UPLOAD_TIMEOUT_MS } : undefined).then(function (res) { sent(op, res); }, function (err) { failed(op, err); });
    }, function (err) { failed(null, err); });
  }

  function sent(op, res) {
    onOk(op, res);
    Q.shift(); epoch++; saveQ();
    pumping = false; S.online = true; retryN = 0;
    if (!Q.length) S.savedAt = Date.now();
    BA.emit('qprogress');
    commit();
    if (Q.length) pump(); else { setTimeout(function () { BA.emit('status'); }, 2600); }
  }

  function failed(op, err) {
    pumping = false;
    var code = err.code;
    if (code === 'AUTH') { BA.emit('status'); return; }
    if (op && code === 'SERVER') { op.fails = (op.fails || 0) + 1; saveQ(); }
    // Midlertidige fejl (ingen forbindelse, serveren optaget, serverfejl) prøves igen og igen.
    // Giver samme ændring serverfejl 8 gange i træk, flyttes den til "Kunne ikke gemmes" (ikke slettet), så resten af køen ikke blokeres.
    if (!op || code === 'NET' || code === 'SETUP' || code === 'BUSY' || (code === 'SERVER' && op.fails < MAX_SERVER_FAILS)) { scheduleRetry(err); return; }
    if (code === 'INPUT' && /^Ukendt handling/.test(err.message)) { noteServerVersion(1); return; }   // serveren er for gammel: bliv i køen
    // Allerede væk på serveren: sletning behøver ikke gentages.
    if (code === 'NOTFOUND' && (op.fn === 'deleteItem' || op.fn === 'deleteCar')) { Q.shift(); epoch++; saveQ(); commit(); setTimeout(BA.store.refresh, 300); if (Q.length) pump(); return; }
    parkOp(op, err);
    BA.emit('rollback', { fn: op.fn, id: op.arg && op.arg.id, keys: op.arg && op.arg.fields ? Object.keys(op.arg.fields) : [] });
    if (Q.length) pump();
  }

  // ---------- det, der ikke kunne gemmes ----------
  var LABELS = { reg: 'Nummerplade', model: 'Mærke og model', variant: 'Variant', year: 'Årgang', vin: 'Stelnummer', fuel: 'Brændstof', color: 'Farve', firstReg: '1. registrering', km: 'Km',
    channel: 'Indkøbskanal', boughtDate: 'Købsdato', buyPrice: 'Købspris', listPrice: 'Annonceret pris', status: 'Status', soldDate: 'Salgsdato', soldPrice: 'Salgspris', soldVia: 'Salgskanal',
    buyer: 'Køber', buyerPhone: 'Købers telefon', notes: 'Noter', cover: 'Forsidebillede', listedDate: 'Sat til salg', name: 'Navn', text: 'Tekst', note: 'Note', desc: 'Beskrivelse',
    amount: 'Beløb', hours: 'Timer', date: 'Dato', cat: 'Kategori', expPrice: 'Forventet pris', expHours: 'Forventede timer', actPrice: 'Faktisk pris', actHours: 'Faktiske timer', done: 'Lavet',
    fixed: 'Afhjulpet', who: 'Hvem', kind: 'Type', fix: 'Løsning', ctype: 'Fejltype', hourGoal: 'Mål: kr. pr. time', monthGoal: 'Mål pr. måned', stockDays: 'Advar efter dage', minProfit: 'Advar under (kr)',
    vat: 'Brugtmoms', sellerName: 'Sælgerens navn', channels: 'Indkøbskanaler', salesChannels: 'Salgskanaler', source: 'Kilde',
    start: 'Tidspunkt', at: 'Tidspunkt', doneAt: 'Udført', due: 'Frist', phone: 'Telefon', cancelled: 'Aflyst',
    priceCheckDays: 'Pris-tjek efter dage', chargeHours: 'Lader flyttes hver (timer)', morningHour: 'Morgenbesked kl.',
    list: 'Tjekliste', key: 'Punkt', state: 'Svar' };
  BA.store.fieldLabel = function (k) { return LABELS[k] || k; };
  var TYPE_NAMES = { udstyr: 'udstyr', fejl: 'fejl', opgave: 'opgave', udgift: 'udgift', time: 'timer', reklamation: 'reklamation', abonnement: 'fast udgift', enkeltudgift: 'enkeltudgift',
    tick: 'afkrydsning', todo: 'egen opgave', booking: 'booking', tjek: 'tjekpunkt' };
  var TICK_NAMES = { charge: 'Ladet', pricecheck: 'Pris tjekket', regcert: 'Registreringsattest modtaget', dereg: 'Afmeldt / omregistreret', dispute: 'Tvist afklaret',
    invoice: 'Faktura sendt', paid: 'Betalt', inspect: 'Synshal / indregistrering', pickup: 'Klar til afhentning' };
  BA.store.tickName = function (k) { return TICK_NAMES[k] || k; };
  function shortVal(v) {
    if (v === null || v === undefined || v === '') return '(tom)';
    if (v === true) return 'ja'; if (v === false) return 'nej';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 400 ? s.slice(0, 400) + ' …' : s;
  }
  BA.store.shortVal = shortVal;
  function itemName(it) {
    if (it.type === 'booking') return (it.kind || 'Booking') + ' ' + U.fmtLocal(it.start);
    if (it.type === 'tick') return BA.store.tickName(it.kind);
    return it.name || it.text || it.desc || '';
  }
  function carLabel(id) {
    var c = maps.car[id];
    return c ? ((c.reg ? c.reg + ' ' : '') + (c.model || '')).trim() : 'bilen';
  }
  function fieldLines(fields) {
    return Object.keys(fields || {}).map(function (k) {
      var v = fields[k];
      if ((k === 'start' || k === 'at' || k === 'doneAt') && typeof v === 'number') v = U.fmtLocal(v);
      return (LABELS[k] || k) + ': ' + shortVal(v);
    });
  }
  /** Læsbar beskrivelse af en ændring: { title, lines }. Laves, mens bilen og posten stadig kendes. */
  function describeOp(op) {
    var a = op.arg || {};
    switch (op.fn) {
      case 'createCar': return { title: 'Ny bil ' + [a.fields && a.fields.reg, a.fields && a.fields.model].filter(Boolean).join(' '), lines: fieldLines(a.fields).concat((a.equipment || []).length ? ['Udstyr: ' + a.equipment.map(function (e) { return e.name; }).join(', ')] : []) };
      case 'updateCar': return { title: 'Ændring på ' + carLabel(a.id), lines: fieldLines(a.fields) };
      case 'markSold': return { title: 'Salg af ' + carLabel(a.id), lines: fieldLines({ soldPrice: a.soldPrice, soldDate: a.soldDate, soldVia: a.soldVia, buyer: a.buyer, buyerPhone: a.buyerPhone }) };
      case 'reopenSale': return { title: 'Fortryd salg af ' + carLabel(a.id), lines: [] };
      case 'deleteCar': return { title: 'Sletning af ' + carLabel(a.id), lines: [] };
      case 'restoreCar': return { title: 'Gendan ' + carLabel(a.id), lines: [] };
      case 'addItem':
        if (a.type === 'tick') return { title: 'Afkrydsning “' + BA.store.tickName(a.data && a.data.kind) + '” på ' + carLabel(a.carId), lines: a.data && a.data.at ? ['Tidspunkt: ' + U.fmtLocal(a.data.at)] : [] };
        return { title: 'Ny ' + (TYPE_NAMES[a.type] || 'post') + (a.carId ? ' på ' + carLabel(a.carId) : ''), lines: fieldLines(a.data) };
      case 'updateItem': { var it = maps.item[a.id]; return { title: 'Ændring af ' + (it ? (TYPE_NAMES[it.type] || 'post') + ' "' + itemName(it) + '"' : 'en post') + (it && it.carId ? ' på ' + carLabel(it.carId) : ''), lines: fieldLines(a.fields) }; }
      case 'deleteItem': case 'restoreItem': { var it2 = maps.item[a.id]; return { title: (op.fn === 'deleteItem' ? 'Sletning af ' : 'Gendan ') + (it2 ? (TYPE_NAMES[it2.type] || 'post') + ' "' + itemName(it2) + '"' : 'en post'), lines: [] }; }
      case 'updateSettings': return { title: 'Ændring af indstillinger', lines: fieldLines(a.fields) };
      case 'makeDocument': {
        var dv = a.vals || {}, dlabel = (BA.docs && BA.docs.SPECS[a.kind] && BA.docs.SPECS[a.kind].label) || 'dokument';
        return { title: 'PDF: ' + dlabel + ' på ' + carLabel(a.carId), lines: [dv.custName || dv.buyerName ? 'Navn: ' + (dv.custName || dv.buyerName) : '', dv.price ? 'Pris: ' + dv.price + ' kr.' : '', dv.sigCust ? 'Med underskrift' : ''].filter(Boolean) };
      }
    }
    return { title: op.fn, lines: [] };
  }

  /** Flytter en ændring (og det, der hører til den, hvis den opretter noget) fra køen til listen "Kunne ikke gemmes". */
  function parkOp(op, err) {
    var isConflict = err.code === 'CONFLICT';
    var ops = [op];
    var carIds = [];
    var desc = describeOp(op);
    Q.shift();
    // Opretter ændringen en bil eller en post, kan de ændringer, der kommer efter og hører til den, ikke sendes uden den: de følger med.
    // Det gælder også ændringer af udstyr og faste omkostninger, der blev oprettet sammen med bilen (de kender kun postens eget id),
    // og poster der blev lagt på bilen bagefter: alt, hvis id hører til det, der ikke blev oprettet, følger med (i samme rækkefølge).
    var createdId = op.fn === 'createCar' ? op.arg.id : (op.fn === 'addItem' ? op.arg.id : '');
    if (createdId) {
      var owned = {};
      owned[createdId] = true;
      if (op.fn === 'createCar' && op.fx && op.fx.items) op.fx.items.forEach(function (it) { owned[it.id] = true; });
      var grew = true;
      var taken = {};
      while (grew) {
        grew = false;
        Q.forEach(function (o, i) {
          if (taken[i]) return;
          var a = o.arg || {};
          if (owned[a.id] || (a.carId && owned[a.carId])) {
            taken[i] = true; grew = true;
            if (o.fn === 'addItem' || o.fn === 'createCar') owned[a.id] = true;
          }
        });
      }
      var rest = [];
      Q.forEach(function (o, i) { if (taken[i]) ops.push(o); else rest.push(o); });
      Q = rest;
      if (op.fn === 'createCar') carIds.push(createdId);
    }
    var vals = {};
    if (isConflict && err.data) {
      var cur = err.data.car || err.data.item || err.data.settings || null;
      (err.data.conflicts || []).forEach(function (k) { if (cur) vals[k] = cur[k]; });
      if (err.data.car) { base.cars = base.cars.filter(function (c) { return c.id !== err.data.car.id; }); base.cars.push(err.data.car); }
      if (err.data.item) { base.items = base.items.filter(function (i) { return i.id !== err.data.item.id; }); base.items.push(err.data.item); }
      if (err.data.settings) base.settings = err.data.settings;
    }
    Fl.push({ id: U.uid(), kind: isConflict ? 'conflict' : 'rejected', code: err.code, msg: err.message, at: Date.now(), who: person(), title: desc.title,
      lines: desc.lines.concat(ops.slice(1).map(function (o) { var d = describeOp(o); return '+ ' + d.title; })), ops: ops, carIds: carIds, owned: Object.keys(owned || {}), vals: vals, conflicts: isConflict && err.data ? (err.data.conflicts || []) : [] });
    epoch++; saveQ(); saveFailed();
    if (isConflict) softToast(err.message + ' Din værdi ligger under Mere → Kunne ikke gemmes.');
    else { softToast('En ændring kunne ikke gemmes: ' + err.message + ' Den ligger under Mere → Kunne ikke gemmes.'); setTimeout(BA.store.refresh, 300); }
    commit();
  }

  BA.store.failed = function () { return Fl.slice(); };
  BA.store.failedCount = function () { return Fl.length; };
  function findFailed(gid) { for (var i = 0; i < Fl.length; i++) if (Fl[i].id === gid) return Fl[i]; return null; }
  function removeFailed(gid) { Fl = Fl.filter(function (g) { return g.id !== gid; }); saveFailed(); }
  /** Send igen. Ved en konflikt: opts.useMine = brug min værdi (den sendes nu med serverens nuværende værdi som udgangspunkt). */
  BA.store.retryFailed = function (gid, opts) {
    var g = findFailed(gid); if (!g) return false;
    opts = opts || {};
    g.ops.forEach(function (op, i) {
      op.fails = 0;
      if (opts.useMine && i === 0 && op.fn === 'addItem' && g.conflicts && g.conflicts.length && op.arg && op.arg.data) {
        // En ny post med et id, der allerede findes med andet indhold (fx to enheder svarede forskelligt på samme tjekpunkt): "brug min" bliver en rettelse af den eksisterende post.
        var fields = {}, from = {};
        g.conflicts.forEach(function (k) { fields[k] = op.arg.data[k]; from[k] = g.vals && g.vals[k] !== undefined ? g.vals[k] : null; });
        op.fn = 'updateItem'; op.arg = { id: op.arg.id, fields: fields, from: from }; op.fx = { k: 'itemset', id: op.arg.id, fields: fields };
      }
      if (opts.useMine && i === 0 && op.arg && op.arg.from) Object.keys(g.vals || {}).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(op.arg.from, k)) op.arg.from[k] = g.vals[k] === undefined ? null : g.vals[k]; });
      Q.push(op);
    });
    removeFailed(gid); saveQ(); epoch++; commit(); retryN = 0; clearTimeout(retryTimer); pump();
    return true;
  };
  BA.store.dropFailed = function (gid) {
    var g = findFailed(gid); if (!g) return false;
    removeFailed(gid); commit();
    return g;
  };
  /** Billeder, der venter på en bil, som ikke kunne oprettes, skal blive hos bilen: køen sender dem ikke, så længe bilen er parkeret. */
  BA.store.copyTextOf = function (g) { return [g.title].concat(g.lines || []).join('\n'); };
  /** Retter en bil, der ikke kunne oprettes: giver oplysningerne til formularen "Ny bil". */
  BA.store.failedCreate = function (gid) {
    var g = findFailed(gid);
    return g && g.ops[0] && g.ops[0].fn === 'createCar' ? clone(g.ops[0].arg) : null;
  };
  /** Sender en rettet bil igen (samme id, så billeder og andet, der venter, stadig hører til). */
  BA.store.resubmitCar = function (gid, input) {
    var g = findFailed(gid); if (!g) return null;
    var built = buildCreate(Object.assign({}, input, { costIds: g.ops[0].arg.costIds }));
    g.ops[0] = built.op;
    g.ops.forEach(function (op) { op.fails = 0; Q.push(op); });
    removeFailed(gid); saveQ(); epoch++; commit(); retryN = 0; clearTimeout(retryTimer); pump();
    return built.car;
  };

  BA.store.retry = function () {
    retryN = 0; clearTimeout(retryTimer); S.error = ''; S.versionOk = false; BA.emit('status');
    pump(); BA.store.refresh({ full: true });
  };
  BA.store.queueLength = function () { return Q.length; };
  BA.store.__queue = function () { return Q; };   // kun til testene
  /** Ligger der en ikke-sendt ændring for denne bil (fx at den skal oprettes) – også en, der ikke kunne gemmes endnu? */
  BA.store.hasPendingFor = function (carId, parent) {
    return Q.some(function (o) { return o.arg && (o.arg.id === carId || o.arg.carId === carId); }) ||
      Fl.some(function (g) { return (g.carIds && g.carIds.indexOf(carId) >= 0) || (parent && g.owned && g.owned.indexOf(parent) >= 0); });   // også billeder til en fejl, der ikke kunne gemmes
  };

  window.addEventListener('online', function () { if (A.hasKey()) BA.store.retry(); });

  // ---------------------------------------------------------------------------
  // Ændringer (kaldes af skærmbillederne)
  // ---------------------------------------------------------------------------
  function now() { return Date.now(); }
  function person() { return (S.device && S.device.person) || U.safeStore.get(LS.person) || ''; }

  /**
   * shown (valgfri): de værdier, felterne VISTE, da brugeren begyndte at skrive. Sendes som udgangspunkt (from) i stedet for den nuværende
   * værdi, så en anden skrivers ændring, som kom ind imens brugeren skrev, giver en konflikt i stedet for at blive overskrevet uset.
   */
  BA.store.updateCar = function (id, fields, shown) {
    var car = maps.car[id]; if (!car) return false;
    var from = {}, changed = {}, any = false;
    Object.keys(fields).forEach(function (k) {
      if (JSON.stringify(car[k] == null ? '' : car[k]) !== JSON.stringify(fields[k] == null ? '' : fields[k])) {
        var seen = shown && Object.prototype.hasOwnProperty.call(shown, k) ? shown[k] : car[k];
        from[k] = seen === undefined ? null : seen; changed[k] = fields[k]; any = true;
      }
    });
    if (!any) return false;
    // Sættes bilen til Annonceret, begynder dagene "til salg" (serveren gør det samme).
    if (changed.status === 'Annonceret' && !car.listedDate && !('listedDate' in changed)) { from.listedDate = car.listedDate || ''; changed.listedDate = U.today(); }
    enqueue('updateCar', { id: id, fields: changed, from: from }, { k: 'carset', id: id, fields: changed });
    return true;
  };

  /** Laver "opret bil"-ændringen. Udstyr og faste omkostninger får deres rigtige id'er med det samme, så de kan rettes og slettes, før serveren har svaret. */
  function buildCreate(input) {
    var f = input.fields;
    var car = Object.assign(clone(CAR_BLANK), f, { id: input.id });
    var ch = findChannel(S.settings, f.channel);
    car.channel = ch ? ch.name : '';
    car.status = ch && ch.transit ? 'Under transport' : 'Købt';
    car.boughtDate = car.boughtDate || U.today();
    car.createdAt = now(); car.updatedAt = now(); car.createdBy = person(); car.updatedBy = person();
    var givenCostIds = Array.isArray(input.costIds) ? input.costIds : [];   // en bil, der sendes igen: samme id'er som før, så ændringer af gebyrerne stadig passer
    var equipment = (input.equipment || []).map(function (e) { return { id: e.id && /^[a-z0-9]{8,24}$/.test(e.id) ? e.id : U.uid(), name: e.name, source: e.source || 'egen' }; });
    var items = [];
    equipment.forEach(function (e) { items.push(Object.assign(BA.itemDefaults('udstyr'), { id: e.id, carId: input.id, type: 'udstyr', name: e.name, source: e.source, rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() })); });
    var costIds = [];
    if (ch && input.applyChannelCosts !== false) ch.costs.forEach(function (c, i) {
      var cid = givenCostIds[i] && /^[a-z0-9]{8,24}$/.test(givenCostIds[i]) ? givenCostIds[i] : U.uid(); costIds.push(cid);
      items.push(Object.assign(BA.itemDefaults('udgift'), { id: cid, carId: input.id, type: 'udgift', date: car.boughtDate, desc: c.desc, cat: c.cat, amount: c.amount, auto: 'kanal', rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() }));
    });
    return { car: car, op: { fn: 'createCar', arg: { id: input.id, fields: f, equipment: equipment, costIds: costIds, applyChannelCosts: input.applyChannelCosts !== false }, fx: { k: 'car+', car: car, items: items }, t: Date.now() } };
  }

  BA.store.createCar = function (input) {
    var built = buildCreate(input);
    enqueue(built.op.fn, built.op.arg, built.op.fx);
    return built.car;
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
  /**
   * Fase 3: lav et dokument som PDF på bilen. Går gennem køen (virker uden net, og underskriften kan ikke tabes). Serveren bygger PDF'en af oplysningerne.
   * replaceId: et tidligere dokument, der skal erstattes (ellers bliver det gamle liggende). Giver id'et på den nye fil-post.
   */
  BA.store.makeDocument = function (carId, kind, vals, replaceId) {
    var id = U.uid();
    var arg = { id: id, carId: carId, kind: kind, vals: vals };
    if (replaceId) arg.replaceId = replaceId;
    enqueue('makeDocument', arg, { k: 'none' });
    return id;
  };
  /** Dokumenter, der venter på at blive lavet på serveren: [{ id, kind }] (også dem, der ikke kunne gemmes). */
  BA.store.pendingDocs = function (carId) {
    var out = [];
    Q.forEach(function (o) { if (o.fn === 'makeDocument' && o.arg && o.arg.carId === carId) out.push({ id: o.arg.id, kind: o.arg.kind, state: 'wait' }); });
    Fl.forEach(function (g) { g.ops.forEach(function (o) { if (o.fn === 'makeDocument' && o.arg && o.arg.carId === carId) out.push({ id: o.arg.id, kind: o.arg.kind, state: 'failed' }); }); });
    return out;
  };
  /** Svar på et punkt på en tjekliste (fast id pr. bil+liste+punkt: samme punkt giver altid samme post). state: ok | fejl | ikke | '' (ryd). */
  BA.store.setTjek = function (carId, list, key, state, note) {
    var id = BA.docs.tjekId(carId, list, key), cur = maps.item[id];
    if (cur && !cur.deleted) {
      var fields = { state: state, at: now() };
      if (note != null) fields.note = note;
      return BA.store.updateItem(id, fields);
    }
    var item = Object.assign(BA.itemDefaults('tjek'), { list: list, key: key, state: state, note: note || '', at: now() }, { id: id, carId: carId, type: 'tjek', rev: 1, createdAt: now(), createdBy: person(), updatedAt: now(), updatedBy: person() });
    enqueue('addItem', { id: id, carId: carId, type: 'tjek', data: { list: list, key: key, state: state, note: note || '', at: item.at } }, { k: 'item+', item: item });
    return true;
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
    return A.call('logoutDevice').then(function () { return true; }, function () { return false; }).then(function () { A.clearAll(); base = { cars: [], items: [], settings: null }; Q = []; Fl = []; stamp = { time: 0, rev: -1 }; S.loaded = false; S.ready = false; S.storageWarn = false; commit(); });
  };

  // Regelmæssig opdatering, når appen er åben (let: serveren svarer kun "uændret", hvis intet er sket).
  setInterval(function () {
    if (document.visibilityState !== 'visible' || !A.hasKey()) return;
    if (S.serverOld && Q.length) { S.versionOk = false; pump(); return; }   // har serveren fået den nye version?
    if (!Q.length) BA.store.refresh();
  }, 45000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && A.hasKey()) { if (Q.length) pump(); else BA.store.refresh(); } });
  window.addEventListener('beforeunload', function (e) {
    if (Q.length || (BA.up && BA.up.busy && BA.up.busy())) { e.preventDefault(); e.returnValue = ''; }
  });
})();
