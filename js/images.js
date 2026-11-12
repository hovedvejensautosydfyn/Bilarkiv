/* Billeder: miniaturer, billedvisning, forberedelse før upload (HEIC bliver til JPG), upload-kø og zip. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, A = BA.api, esc = U.esc;
  var IMG = BA.img = {};
  var HEIC_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';

  // ---------------------------------------------------------------------------
  // Miniaturer (hentes i klumper, huskes i hukommelsen og i telefonen)
  // ---------------------------------------------------------------------------
  var mem = {}, waiting = {}, pendingIds = [], timer = 0, inflight = 0, missingUntil = {};
  var DATA_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  function okUrl(u) { return typeof u === 'string' && u.length < 14000000 && DATA_RE.test(u); }
  var db = null;

  function idbOpen() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('bilarkiv-thumbs', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('t'); };
        req.onsuccess = function () { db = req.result; resolve(db); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function idbGet(id) {
    return idbOpen().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try { var r = d.transaction('t').objectStore('t').get(id); r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { resolve(null); }; } catch (e) { resolve(null); }
      });
    });
  }
  function idbSet(id, v) {
    idbOpen().then(function (d) { if (!d) return; try { d.transaction('t', 'readwrite').objectStore('t').put(v, id); } catch (e) { /* ingen */ } });
  }

  function settle(id, url) {
    (waiting[id] || []).forEach(function (r) { r(url); });
    delete waiting[id];
  }

  function pumpThumbs() {
    while (inflight < 2 && pendingIds.length) {
      var ids = pendingIds.splice(0, 12);
      inflight++;
      (function (batch) {
        A.call('getImages', { ids: batch, size: 'thumb' }).then(function (res) {
          inflight--;
          batch.forEach(function (id) {
            if (res.images && okUrl(res.images[id])) { mem[id] = res.images[id]; idbSet(id, res.images[id]); settle(id, res.images[id]); }
            else if (res.skipped && res.skipped.indexOf(id) >= 0) { pendingIds.push(id); }
            else { missingUntil[id] = Date.now() + 60000; settle(id, null); }
          });
          pumpThumbs();
        }, function () {
          inflight--;
          batch.forEach(function (id) { settle(id, null); });   // prøves igen næste gang skærmen tegnes
          pumpThumbs();
        });
      })(ids);
    }
  }

  IMG.thumb = function (id) {
    if (mem[id]) return Promise.resolve(mem[id]);
    if (missingUntil[id] && missingUntil[id] > Date.now()) return Promise.resolve(null);
    return new Promise(function (resolve) {
      if (waiting[id]) { waiting[id].push(resolve); return; }
      waiting[id] = [resolve];
      idbGet(id).then(function (hit) {
        if (hit) { mem[id] = hit; settle(id, hit); return; }
        pendingIds.push(id);
        clearTimeout(timer);
        timer = setTimeout(pumpThumbs, 40);
      });
    });
  };

  var observer = null;
  function showThumb(el) {
    var id = el.getAttribute('data-iid');
    if (!id || el.getAttribute('data-hyd') === '1') return;
    el.setAttribute('data-hyd', '1');
    IMG.thumb(id).then(function (url) {
      if (!el.isConnected) return;
      if (url) { if (el.tagName === 'IMG') el.src = url; else el.style.backgroundImage = 'url(' + url + ')'; el.setAttribute('data-ok', '1'); }
      else {
        el.setAttribute('data-hyd', '0');
        var ph = el.getAttribute('data-ph') || 'Intet billede';
        if (el.tagName === 'IMG') { el.removeAttribute('src'); el.alt = ph; el.style.display = 'none'; if (el.parentNode && !el.parentNode.querySelector('.noimg')) { var s = document.createElement('span'); s.className = 'noimg'; s.textContent = ph; el.parentNode.appendChild(s); } }
      }
    });
  }
  /** Finder alle billeder med data-iid i root og henter dem, når de kommer til syne. */
  IMG.hydrate = function (root) {
    var els = U.$$('[data-iid]', root || document).filter(function (e) { return e.getAttribute('data-hyd') !== '1' && e.getAttribute('data-ok') !== '1'; });
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
      observer = observer || new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { observer.unobserve(en.target); showThumb(en.target); } });
      }, { rootMargin: '300px' });
      els.forEach(function (e) { observer.observe(e); });
      // Har siden ikke været synlig (fx i en baggrundsfane), kommer iagttageren aldrig: hent så dem, der ligger tæt på toppen.
      setTimeout(function () {
        els.forEach(function (e) {
          if (e.isConnected && e.getAttribute('data-hyd') !== '1' && e.getBoundingClientRect().top < window.innerHeight * 3) { observer.unobserve(e); showThumb(e); }
        });
      }, 1200);
    } else els.forEach(showThumb);
  };

  // ---------------------------------------------------------------------------
  // Fuldt billede og filer
  // ---------------------------------------------------------------------------
  var fullCache = {}, fullOrder = [];
  IMG.full = function (id) {
    if (fullCache[id]) return Promise.resolve(fullCache[id]);
    return A.call('getImages', { ids: [id], size: 'full' }, { timeout: 120000 }).then(function (res) {
      var url = res.images && res.images[id];
      if (!okUrl(url)) throw new Error('Billedet kunne ikke hentes.');
      fullCache[id] = url; fullOrder.push(id);
      while (fullOrder.length > 6) delete fullCache[fullOrder.shift()];
      return url;
    });
  };
  IMG.file = function (id) {
    return A.call('getFileData', { id: id }, { timeout: 170000 }).then(function (res) {
      return { name: res.name, mime: res.mime, blob: U.b64ToBlob(res.data, res.mime) };
    });
  };
  IMG.forget = function (id) { delete mem[id]; delete fullCache[id]; };

  // ---------------------------------------------------------------------------
  // Forberedelse før upload
  // ---------------------------------------------------------------------------
  function isHeic(file) { return /\.(heic|heif)$/i.test(file.name || '') || /heic|heif/i.test(file.type || ''); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Kunne ikke hente HEIC-omdanneren. Tjek internettet.')); };
      document.head.appendChild(s);
    });
  }
  function toBlobAsync(canvas, quality) {
    return new Promise(function (resolve, reject) { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Billedet kunne ikke gemmes som JPG.')); }, 'image/jpeg', quality); });
  }
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(new Error('Filen kunne ikke læses.')); };
      r.readAsDataURL(blob);
    });
  }
  IMG.blobToB64 = blobToB64;

  function decode(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Billedet kunne ikke læses.')); };
      img.src = url;
    });
  }
  function drawScaled(img, maxSide) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /** Billede -> JPG (højst 1800 px) + miniature (360 px). HEIC fra iPhone bliver lavet om til JPG her. Giver { data, thumb, mime, name }. */
  IMG.preparePhoto = function (file) {
    var step = isHeic(file) ? decode(file).catch(function () {
      return loadScript(HEIC_SCRIPT).then(function () {
        if (typeof window.heic2any !== 'function') throw new Error('HEIC-omdanneren kunne ikke startes.');
        return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      }).then(function (out) { return decode(Array.isArray(out) ? out[0] : out); });
    }) : decode(file);
    return step.then(function (img) {
      var big = drawScaled(img, 1800);
      return toBlobAsync(big, 0.82).then(function (b) {
        if (b.size > 5500000) return toBlobAsync(big, 0.6);
        return b;
      }).then(function (blob) {
        return toBlobAsync(drawScaled(img, 360), 0.7).then(function (tb) {
          return Promise.all([blobToB64(blob), blobToB64(tb)]).then(function (r) {
            return { data: r[0], thumb: r[1], mime: 'image/jpeg', name: String(file.name || 'billede').replace(/\.[^.]*$/, '') + '.jpg', size: blob.size };
          });
        });
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Upload-kø
  // ---------------------------------------------------------------------------
  var list = [], running = false;
  var UP = BA.up = {};
  UP.list = function () { return list; };
  UP.pending = function () { return list.filter(function (x) { return x.status === 'wait' || x.status === 'prep' || x.status === 'send'; }).length; };
  UP.busy = UP.pending;
  UP.forCar = function (carId) { return list.filter(function (x) { return x.carId === carId; }); };

  function kindOf(file, opts) {
    var type = (file.type || '').toLowerCase(), name = file.name || '';
    if (/^video\//.test(type) || /\.(mp4|mov|m4v)$/i.test(name)) return 'video';
    if (/^image\//.test(type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(name)) return opts.docKind ? opts.docKind : 'photo';
    return opts.docKind || 'Andet';
  }
  function mimeOf(file, kind) {
    var t = (file.type || '').toLowerCase(), n = (file.name || '').toLowerCase();
    if (kind === 'video') return /\.mov$/.test(n) || t === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
    if (t) return t;
    if (/\.pdf$/.test(n)) return 'application/pdf';
    if (/\.png$/.test(n)) return 'image/png';
    return 'image/jpeg';
  }

  /** opts: { docKind, parent }. Giver listen af nye poster i køen. */
  UP.add = function (carId, files, opts) {
    opts = opts || {};
    var added = [];
    Array.prototype.slice.call(files).forEach(function (file) {
      var kind = kindOf(file, opts);
      var entry = { id: U.uid(), carId: carId, file: file, name: file.name || 'fil', kind: kind, parent: opts.parent || '', status: 'wait', err: '' };
      if (kind === 'video' && file.size > 24000000) { entry.status = 'error'; entry.err = 'Videoen er for stor (højst 24 MB). Kort den ned, og prøv igen.'; }
      else if (kind !== 'photo' && kind !== 'video' && file.size > 20000000) { entry.status = 'error'; entry.err = 'Filen er for stor (højst 20 MB).'; }
      else if (kind !== 'photo' && kind !== 'video' && !/pdf|jpe?g|png/i.test(file.type || file.name)) { entry.status = 'error'; entry.err = 'Papirer skal være PDF, JPG eller PNG.'; }
      list.push(entry); added.push(entry);
      if (entry.status === 'wait') keep(entry);
    });
    BA.emit('uploads'); BA.emit('status');
    next();
    return added;
  };
  UP.retry = function (id) {
    list.forEach(function (x) { if (x.id === id && x.status === 'error' && x.file) { x.status = 'wait'; x.err = ''; } });
    BA.emit('uploads'); BA.emit('status'); next();
  };
  UP.dismiss = function (id) { list = list.filter(function (x) { return x.id !== id; }); unkeep(id); BA.emit('uploads'); BA.emit('status'); };

  // Filer, der venter på at blive sendt, gemmes i telefonen (IndexedDB), så de ikke går tabt, hvis forbindelsen er væk eller appen lukkes.
  var udb = null;
  function upOpen() {
    if (udb) return Promise.resolve(udb);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('bilarkiv-uploads', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('u', { keyPath: 'id' }); };
        req.onsuccess = function () { udb = req.result; resolve(udb); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function keep(e) {
    upOpen().then(function (d) {
      if (!d || !e.file) return;
      try { d.transaction('u', 'readwrite').objectStore('u').put({ id: e.id, carId: e.carId, name: e.name, kind: e.kind, parent: e.parent, type: e.file.type || '', file: e.file }); } catch (err) { /* ingen lagring */ }
    });
  }
  function unkeep(id) {
    upOpen().then(function (d) { if (d) { try { d.transaction('u', 'readwrite').objectStore('u').delete(id); } catch (err) { /* ingen */ } } });
  }
  /** Ved opstart: send de filer, der ikke nåede frem sidst. */
  UP.restore = function () {
    return upOpen().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        var r;
        try { r = d.transaction('u').objectStore('u').getAll(); } catch (e) { resolve(); return; }
        r.onsuccess = function () {
          (r.result || []).forEach(function (x) {
            if (list.some(function (l) { return l.id === x.id; }) || !x.file) return;
            var file = x.file instanceof File ? x.file : new File([x.file], x.name, { type: x.type });
            list.push({ id: x.id, carId: x.carId, file: file, name: x.name, kind: x.kind, parent: x.parent || '', status: 'wait', err: '' });
          });
          BA.emit('uploads'); BA.emit('status'); next(); resolve();
        };
        r.onerror = function () { resolve(); };
      });
    });
  };
  /** Prøv igen med dem, der fejlede på grund af nettet eller serveren. */
  UP.kick = function () {
    var any = false;
    list.forEach(function (x) { if (x.status === 'error' && x.retryable && x.file) { x.status = 'wait'; x.err = ''; any = true; } });
    if (any) { BA.emit('uploads'); BA.emit('status'); }
    next();
  };
  BA.on('qprogress', function () { next(); });   // en ændring i køen blev sendt (fx "opret bil"): filer, der ventede på den, kan nu sendes
  window.addEventListener('online', function () { if (A.hasKey()) UP.kick(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && A.hasKey()) UP.kick(); });
  setInterval(function () { if (A.hasKey() && document.visibilityState === 'visible') UP.kick(); }, 30000);
  UP.clearDone = function () { list = list.filter(function (x) { return x.status !== 'done'; }); BA.emit('uploads'); };

  function next() {
    if (running) return;
    // En fil sendes først, når bilen findes på serveren: ligger der en ikke-sendt ændring for bilen i køen (fx "opret bil"), venter filen.
    var e = list.filter(function (x) { return x.status === 'wait' && !BA.store.hasPendingFor(x.carId); })[0];
    if (!e) return;
    running = true;
    e.status = 'prep'; BA.emit('uploads'); BA.emit('status');
    var prep;
    if (e.kind === 'photo' || (e.kind !== 'video' && /^image\//i.test(e.file.type || '') && e.file.size > 5000000)) {
      prep = IMG.preparePhoto(e.file).then(function (p) { return { data: p.data, thumb: p.thumb, mime: p.mime, name: p.name, kind: e.kind === 'photo' ? 'photo' : e.kind }; });
    } else {
      prep = blobToB64(e.file).then(function (b64) { return { data: b64, thumb: '', mime: mimeOf(e.file, e.kind), name: e.name, kind: e.kind }; });
    }
    prep = prep.catch(function (er) { er.prep = true; throw er; });
    prep.then(function (p) {
      e.status = 'send'; BA.emit('uploads');
      return A.call('uploadFile', { id: e.id, carId: e.carId, name: p.name, kind: p.kind, mime: p.mime, data: p.data, thumb: p.thumb, parent: e.parent }, { timeout: 175000 });
    }).then(function (res) {
      e.status = 'done'; e.file = null; unkeep(e.id);
      BA.store.applyUpload(res);
      running = false; BA.emit('uploads'); BA.emit('status');
      setTimeout(function () { UP.dismiss(e.id); }, 5000);
      next();
    }, function (err) {
      e.status = 'error'; e.err = err.message || 'Filen blev ikke sendt.';
      // Net- og serverfejl prøves automatisk igen; en afvist fil (forkert type, bilen findes ikke mere) gør ikke, og slettes fra telefonen.
      // Fejl ved at gøre filen klar (fx HEIC, der ikke kan læses) er endelige; "bilen findes ikke" er midlertidigt, hvis bilen stadig findes i telefonen (den er måske endnu ikke oprettet på serveren).
      e.retryable = !err.prep && (/^(NET|BUSY|SERVER|SETUP|AUTH)$/.test(err.code || '') || (err.code === 'NOTFOUND' && !!BA.store.car(e.carId)));
      if (err.prep) e.err = e.err + ' Gør den til en JPG først, og prøv igen.';
      if (!e.retryable) unkeep(e.id);
      running = false; BA.emit('uploads'); BA.emit('status');
      next();
    });
  }

  // ---------------------------------------------------------------------------
  // Zip (uden komprimering – billeder er allerede komprimeret)
  // ---------------------------------------------------------------------------
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /** files: [{ name, bytes: Uint8Array }] -> Blob */
  IMG.zip = function (files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.bytes);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
    });
    var centralSize = central.reduce(function (s, p) { return s + (p.byteLength != null ? p.byteLength : p.length); }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  };

  /** Henter alle billeder på en bil én ad gangen og samler dem i en zip. onProgress(n, total). */
  IMG.zipCar = function (car, photos, onProgress) {
    var out = [], used = {}, i = 0, failed = [];
    function one() {
      if (i >= photos.length) { var blob = IMG.zip(out); blob.failed = failed; return Promise.resolve(blob); }
      var p = photos[i++];
      if (onProgress) onProgress(i, photos.length);
      return IMG.file(p.id).then(function (f) {
        return f.blob.arrayBuffer().then(function (buf) {
          var name = String(p.name || 'billede').replace(/[\\\/:*?"<>|]/g, '_'), n = name, k = 2;
          while (used[n.toLowerCase()]) n = name.replace(/(\.[^.]*)?$/, ' (' + (k++) + ')$1');
          used[n.toLowerCase()] = true;
          out.push({ name: n, bytes: new Uint8Array(buf) });
        });
      }).then(one, function (er) {
        if (er && er.code === 'AUTH') throw er;
        failed.push(p.name || 'fil');   // en fil, der ikke kan hentes (fx en stor video), stopper ikke resten
        return one();
      });
    }
    return one();
  };
})();
