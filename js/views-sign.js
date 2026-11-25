/* Prisskilt på bilsiden: vælg mærke, fremhævninger og udstyr, se skiltet, lav PDF'en i telefonen og print/del den med det samme.
 * Kopien gemmes under bilens Papirer gennem køen (BA.store.makeSign). Logikken (layout, QR, PDF) ligger i sign.js (BA.sign). */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;
  function SG() { return BA.sign; }

  function udstyrOf(car) { return BA.store.itemsOf(car.id, 'udstyr').map(function (i) { return i.name; }).filter(Boolean); }
  function lastSign(car) { var s = car.extra && car.extra.sign; return s && typeof s === 'object' ? s : null; }
  function randInt(n) {
    var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
    do { window.crypto.getRandomValues(a); } while (a[0] >= lim);
    return a[0] % n;
  }
  /**
   * Bilens QR-kode: den samme hele tiden (et printet skilt virker, selv om prisen ændres).
   * Også en kode fra et skilt, der stadig venter på at blive gemt (eller ikke kunne gemmes), genbruges – den kan allerede sidde i en bil.
   */
  function codeFor(car) {
    var s = lastSign(car), codes = s && Array.isArray(s.codes) ? s.codes.filter(SG().validCode) : [];
    if (codes.length) return codes[0];
    var pend = (BA.store.pendingSigns ? BA.store.pendingSigns(car.id) : []).filter(function (p) { return SG().validCode(p.code); });
    return pend.length ? pend[0].code : SG().newCode(randInt);
  }
  /** Kender serveren koden (er et skilt med den gemt)? Ellers virker kundesiden ikke endnu. */
  function codeSaved(car, code) { return BA.store.signCodeSaved ? BA.store.signCodeSaved(car.id, code) : false; }
  function standaloneIos() { try { return window.navigator.standalone === true; } catch (e) { return false; } }
  function hkFromAd(car) {
    try { var d = JSON.parse(U.safeStore.get('ba.ad.' + car.id) || 'null'); var hk = d && d.f && String(d.f.hk || '').replace(/\D/g, ''); return hk && hk.length <= 4 ? hk : ''; } catch (e) { return ''; }
  }
  function startOpts(car, udstyr) {
    var s = lastSign(car), prev = s && s.opts ? SG().clean(s.opts).opts : null;
    var have = {}; udstyr.forEach(function (n) { have[String(n).toLowerCase()] = true; });
    if (prev) {
      prev.equipment = prev.equipment.filter(function (n) { return have[n.toLowerCase()]; });
      if (!prev.equipment.length) prev.equipment = SG().defaultEquipment(udstyr);
      return prev;
    }
    return { label: '', badges: [], equipment: SG().defaultEquipment(udstyr), warranty: '', hk: hkFromAd(car) };
  }
  function fileName(car) { return 'Prisskilt ' + String([car.model, car.reg].filter(Boolean).join(' ') || 'bil').replace(/[\\\/:*?"<>|]/g, '') + ' ' + U.today() + '.pdf'; }
  function pdfBlob(bin) { var bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type: 'application/pdf' }); }
  function coarse() { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }

  /** Viser PDF'en, så den kan printes: på telefon via Del (Udskriv / Gem i Filer), ellers i en ny fane. */
  function showPdf(blob, name, preferShare) {
    var file = null;
    try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) { file = null; }
    if (preferShare && file && navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: name }).then(function () { return true; }, function (err) {
            if (err && err.name === 'AbortError') return true;   // brugeren lukkede delingen
            return openTab(blob, name);
          });
        }
      } catch (e2) { /* prøv en fane */ }
    }
    return Promise.resolve(openTab(blob, name));
  }
  BA.showPdf = showPdf;   // bruges også til at åbne/printe en PDF fra Papirer (views-car.js)
  function openTab(blob, name) {
    // En app, der er lagt på iPhonens hjemmeskærm, viser ofte en tom side for en blob-fane: hent filen i stedet
    if (standaloneIos()) { U.download(name, blob); BA.toast('PDF’en er hentet. Åbn den (Filer) og vælg Del → Udskriv.', { long: true }); return true; }
    var url = URL.createObjectURL(blob), win = null;
    try { win = window.open(url, '_blank'); } catch (e) { win = null; }
    if (!win) { U.download(name, blob); BA.toast('PDF’en er hentet. Åbn den og vælg Udskriv.', { long: true }); }
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    return true;
  }

  BA.signCarSection = function (car) {
    var s = lastSign(car), h = '';
    var pend = BA.store.pendingSigns ? BA.store.pendingSigns(car.id) : [];
    pend.forEach(function (p) {
      var txt = p.state === 'failed'
        ? (p.saved ? 'Et ældre prisskilt kunne ikke gemmes. QR-koden virker (et nyere skilt er gemt) – du kan slette det under Mere → Kunne ikke gemmes.'
          : '<span class="neg">Prisskiltet kunne ikke gemmes – QR-koden virker ikke, før det er sendt igen (Mere → Kunne ikke gemmes)</span>')
        : (p.saved ? 'Prisskiltet gemmes på bilen …' : 'Prisskiltet gemmes på bilen … QR-koden virker, når det er gemt');
      h += '<div class="li"><div class="main"><div class="t">' + txt + '</div></div></div>';
    });
    if (s && s.price) {
      var changed = +car.listPrice > 0 && +car.listPrice !== +s.price;
      var wl = car.extra && car.extra.web;
      if (wl && wl.id) h += '<div class="muted small" style="margin-top:6px">QR-koden: ' + (wl.mode === 'redirect' ? 'sender kunden direkte til bilens side på h-auto.dk' : 'kundesiden har en knap til h-auto.dk') + '</div>';
      h += '<div class="muted small" style="margin-top:6px">Sidste prisskilt: ' + esc(U.fmtLocal(s.at)) + ', ' + esc(SG().priceText(s.price)) + (changed ? ' · <span class="neg">prisen er ændret – print et nyt</span>' : '') + '</div>';
    }
    return h;
  };

  BA.signOpen = function (car) {
    var udstyr = udstyrOf(car), sorted = SG().suggestEquipment(udstyr), code = codeFor(car);
    var o = startOpts(car, udstyr), firm = BA.docs.FIRM, s = lastSign(car), made = null;
    var price = +car.listPrice || 0;
    var html = '<div class="docdlg signdlg"><div class="docform">' +
      (price > 0 ? '<div class="signprice"><span class="muted small">Pris på skiltet</span><b>' + esc(SG().priceText(price)) + '</b><span class="muted small">Ret prisen på bilen (Annonceret pris), hvis den er forkert.</span></div>'
        : '<div class="banner warn">Bilen har ingen pris. Skriv prisen på bilen under <b>Annonceret pris</b> først.</div>') +
      (s && s.price ? '<p class="muted small" style="margin:6px 0 0">Sidste skilt: ' + esc(U.fmtLocal(s.at)) + ', ' + esc(SG().priceText(s.price)) + '</p>' : '') +
      '<div class="docgrp"><h4>Mærke øverst</h4><div class="chips" role="group" aria-label="Mærke øverst" id="sg-label">' +
        ['', 'afhent', 'engros'].map(function (k) { return '<button type="button" class="chip big" data-label="' + k + '" aria-pressed="false">' + esc(SG().LABEL_NAMES[k]) + '</button>'; }).join('') + '</div></div>' +
      '<div class="docgrp"><div class="grid2"><div class="field"><label for="sg-warranty">Garanti på bilen</label><input id="sg-warranty" maxlength="30" placeholder="fx 3 mdr." autocomplete="off" value="' + esc(o.warranty) + '"></div>' +
        '<div class="field"><label for="sg-hk">HK (valgfrit)</label><input id="sg-hk" inputmode="numeric" maxlength="4" placeholder="fx 95" autocomplete="off" value="' + esc(o.hk) + '"></div></div>' +
        '<p class="muted small" style="margin:0">Tom garanti = intet garanti-mærke. Engros får aldrig garanti.</p></div>' +
      '<div class="docgrp"><h4>Fremhæv (tryk for at vælge)</h4><div class="chips" id="sg-badges"></div><p class="muted small" id="sg-bhint" style="margin:6px 0 0"></p></div>' +
      '<div class="docgrp"><h4>Udstyr på skiltet <span class="muted small" id="sg-ecount"></span></h4>' +
        (sorted.length ? '<div class="signeq" id="sg-equip">' + sorted.map(function (n, i) { return '<label class="check"><input type="checkbox" data-eq="' + i + '"><span>' + esc(n) + '</span></label>'; }).join('') + '</div>'
          : '<p class="muted small" style="margin:0">Bilen har intet udstyr endnu. Tilføj det under Udstyr på bilen.</p>') + '</div>' +
      '<div class="docgrp" id="sg-web"><h4>Kundesiden (når QR-koden scannes)</h4><div id="sg-webbody" aria-live="polite"><span class="muted small">Henter bilerne på h-auto.dk …</span></div></div>' +
      '<div class="errtxt" id="sg-warn" aria-live="polite"></div>' +
      '<p class="muted small" style="margin:8px 0 0">QR-koden fører til kundesiden: <a href="' + esc(SG().url(code)) + '" target="_blank" rel="noopener">' + esc(SG().url(code).replace(/^https:\/\//, '')) + '</a>' +
        (codeSaved(car, code) ? '' : ' <span id="sg-notyet">(virker, når skiltet er lavet og gemt på bilen – telefonen skal have net)</span>') + '</p>' +
      '</div><div class="docprev"><div class="signprev" id="sg-prev" aria-label="Forhåndsvisning af skiltet"></div></div></div>' +
      '<div class="signdone" id="sg-done" hidden><b>Skiltet er lavet ✓</b><span class="muted small">En kopi gemmes på bilen under Papirer. Print på liggende A4 i farve, 100 % (ikke “tilpas til siden”).</span>' +
        '<div class="btnrow"><button type="button" class="btn" id="sg-share">🖨️ Udskriv / del igen</button><button type="button" class="btn" id="sg-open">Åbn PDF</button></div></div>' +
      '<div class="actions"><button type="button" class="btn" data-close>Luk</button><button type="button" class="btn primary" id="sg-make"' + (price > 0 ? '' : ' disabled') + '>Lav PDF og print</button></div>';

    BA.modal('Prisskilt – ' + (car.model || 'bil'), html, function (box, close, api) {
      api.el.querySelector('.modal').classList.add('wide');
      function avail() { return SG().badges(car, udstyr, o, U.today()); }
      function drawBadges() {
        var list = avail(), keys = list.map(function (b) { return b.key; });
        o.badges = o.badges.filter(function (k) { return keys.indexOf(k) >= 0; });
        $('#sg-badges', box).innerHTML = list.map(function (b) {
          var on = o.badges.indexOf(b.key) >= 0;
          return '<button type="button" class="chip big' + (on ? ' sel' : '') + '" data-badge="' + esc(b.key) + '" aria-pressed="' + on + '">' + esc(b.text) + (b.fits && !on ? ' <span class="fits">passer</span>' : '') + '</button>';
        }).join('');
        var n = o.badges.length;
        $('#sg-bhint', box).textContent = n > SG().WARN_BADGES ? n + ' valgt – mere end ' + SG().WARN_BADGES + ' gør skiltet rodet.' : (n ? n + ' valgt.' : 'Intet kommer på af sig selv. “passer” er kun et forslag.');
      }
      function drawLabel() { U.$$('[data-label]', box).forEach(function (b) { var on = b.getAttribute('data-label') === o.label; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
      function drawEquip() {
        var n = o.equipment.length;
        U.$$('[data-eq]', box).forEach(function (cb) {
          var name = sorted[+cb.getAttribute('data-eq')], on = o.equipment.indexOf(name) >= 0;
          cb.checked = on; cb.disabled = !on && n >= SG().MAX_EQUIP;
        });
        var c = $('#sg-ecount', box); if (c) c.textContent = '(' + n + ' af højst ' + SG().MAX_EQUIP + ')';
      }
      function current() {
        // Udstyret står i den rækkefølge, det har på listen (vigtigst først)
        var eq = sorted.filter(function (n) { return o.equipment.indexOf(n) >= 0; });
        return SG().clean({ label: o.label, badges: o.badges, equipment: eq, warranty: o.warranty, hk: o.hk });
      }
      function render() {
        var c = current(), warn = $('#sg-warn', box);
        if (c.error) { warn.textContent = c.error; $('#sg-make', box).disabled = true; return null; }
        var L = SG().layout({ car: car, udstyr: udstyr, opts: c.opts, code: code, firm: firm, today: U.today() });
        $('#sg-prev', box).innerHTML = SG().toSvg(L.ops);
        warn.textContent = L.warnings.join(' ');
        $('#sg-make', box).disabled = !(price > 0);
        return { opts: c.opts, layout: L };
      }
      function redraw() { drawLabel(); drawBadges(); drawEquip(); render(); }

      box.addEventListener('click', function (e) {
        var lb = e.target.closest('[data-label]');
        if (lb) { o.label = lb.getAttribute('data-label'); redraw(); return; }
        var bb = e.target.closest('[data-badge]');
        if (bb) {
          var k = bb.getAttribute('data-badge'), i = o.badges.indexOf(k);
          if (i >= 0) o.badges.splice(i, 1);
          else if (o.badges.length >= SG().MAX_BADGES) { BA.toast('Højst ' + SG().MAX_BADGES + ' mærker på et skilt.'); return; }
          else o.badges.push(k);
          redraw();
        }
      });
      box.addEventListener('change', function (e) {
        var cb = e.target.closest ? e.target.closest('[data-eq]') : null;
        if (!cb) return;
        var name = sorted[+cb.getAttribute('data-eq')];
        o.equipment = o.equipment.filter(function (n) { return n !== name; });
        if (cb.checked) o.equipment.push(name);
        drawEquip(); render();
      });
      var tm = 0;
      box.addEventListener('input', function (e) {
        if (e.target.id === 'sg-warranty') o.warranty = e.target.value;
        else if (e.target.id === 'sg-hk') o.hk = e.target.value.replace(/\D/g, '').slice(0, 4);
        else return;
        clearTimeout(tm); tm = setTimeout(redraw, 200);
      });

      $('[data-close]', box).onclick = function () { close(); };
      $('#sg-make', box).onclick = function () {
        var r = render();
        if (!r || !(price > 0)) return;
        var bin = SG().toPdf(r.layout.ops, 'Prisskilt ' + (car.model || '')), name = fileName(car), blob = pdfBlob(bin);
        BA.store.makeSign(car.id, code, r.opts, price, btoa(bin));
        made = { blob: blob, name: name };
        $('#sg-done', box).hidden = false;
        $('#sg-make', box).textContent = 'Lav igen';
        showPdf(blob, name, coarse());
      };
      // ---------- kobling til bilens side på h-auto.dk ----------
      var webList = null, webErr = '', webPick = false, webMode = 'redirect';
      function curWeb() { var c = BA.store.car(car.id) || car; var w = c.extra && c.extra.web; return w && w.id ? w : null; }
      function webName(id) { var x = (webList || []).filter(function (v) { return v.id === id; })[0]; return x ? x.name + (x.price ? ' – ' + SG().fmtInt(x.price) + ' kr.' : '') : ''; }
      function modeChips(sel) {
        return '<div class="chips" role="group" aria-label="Hvad kunden ser" style="margin-top:8px">' + SG().WEB_MODES.map(function (m) {
          return '<button type="button" class="chip big' + (m === sel ? ' sel' : '') + '" data-webmode="' + m + '" aria-pressed="' + (m === sel) + '">' + esc(SG().WEB_MODE_NAMES[m]) + '</button>'; }).join('') + '</div>';
      }
      function selectHtml(selId) {
        var ms = SG().matchWeb(car, webList || []);
        return '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><select id="sg-websel" aria-label="Bil på h-auto.dk" style="flex:1;min-width:0">' +
          ms.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === selId ? ' selected' : '') + '>' + esc(x.name + (x.price ? ' – ' + SG().fmtInt(x.price) + ' kr.' : '')) + '</option>'; }).join('') +
          '</select><button type="button" class="btn small primary" id="sg-weblink">Kobl</button></div>' +
          '<button type="button" class="btn small ghost" id="sg-webretry" style="margin-top:4px">Står bilen der ikke? Hent listen igen</button>';
      }
      function drawWeb() {
        var el = $('#sg-webbody', box); if (!el) return;
        var w = curWeb(), h = '';
        if (w) {
          var nm = webName(w.id) || w.name || w.id, gone = webList && !webName(w.id);
          webMode = w.mode;
          h += '<div class="small">Koblet til <b>' + esc(nm) + '</b> · <a href="' + esc(SG().webUrl(w.id)) + '" target="_blank" rel="noopener">Åbn på h-auto.dk</a></div>' +
            (gone ? '<div class="small neg" style="margin-top:4px">Bilen står ikke på h-auto.dk lige nu – kunden får vores egen side, til den er tilbage.</div>' : '') +
            modeChips(w.mode) +
            '<div class="btnrow" style="margin-top:6px"><button type="button" class="btn small" id="sg-webchange">Skift bil</button><button type="button" class="btn small" id="sg-webdel">Fjern kobling</button></div>' +
            (webPick && webList ? selectHtml(w.id) : '');
        } else if (webErr) {
          h += '<div class="small neg">' + esc(webErr) + '</div><button type="button" class="btn small" id="sg-webretry" style="margin-top:6px">Prøv igen</button>' +
            '<div class="muted small" style="margin-top:4px">Uden kobling ser kunden vores egen side (pris, udstyr og ring/SMS).</div>';
        } else if (!webList) {
          h += '<span class="muted small">Henter bilerne på h-auto.dk …</span>';
        } else if (!webList.length) {
          h += '<span class="muted small">Der står ingen biler på h-auto.dk lige nu. Kunden ser vores egen side.</span>';
        } else {
          var best = SG().matchWeb(car, webList)[0];
          if (best && best.score >= 5 && !webPick) {
            h += '<div class="small">Forslag: <b>' + esc(best.name + (best.price ? ' – ' + SG().fmtInt(best.price) + ' kr.' : '')) + '</b></div>' + modeChips(webMode) +
              '<div class="btnrow" style="margin-top:6px"><button type="button" class="btn small primary" id="sg-webuse" data-id="' + esc(best.id) + '">Brug den</button><button type="button" class="btn small" id="sg-webchange">Vælg en anden</button></div>';
          } else {
            h += '<div class="muted small">Vælg bilen på h-auto.dk (uden kobling ser kunden vores egen side):</div>' + modeChips(webMode) + selectHtml(best ? best.id : '');
          }
        }
        el.innerHTML = h;
      }
      function link(id) {
        var x = (webList || []).filter(function (v) { return v.id === id; })[0];
        BA.store.setWebLink(car.id, { id: id, mode: webMode, name: x ? x.name : '' });
        webPick = false; drawWeb();
        BA.toast(webMode === 'redirect' ? 'Koblet. QR-koden sender nu kunden direkte til bilens side på h-auto.dk.' : 'Koblet. Kundesiden viser nu en knap til bilens side på h-auto.dk.', { long: true });
      }
      function loadWeb(fresh) {
        webErr = ''; drawWeb();
        BA.api.call('listWebCars', fresh ? { fresh: true } : {}, { timeout: 30000 }).then(function (res) { webList = (res && res.cars) || []; if (box.isConnected) drawWeb(); },
          function (err) { webErr = err && err.code === 'NET' ? 'Ingen forbindelse – kunne ikke hente bilerne fra h-auto.dk.' : ((err && err.message) || 'Kunne ikke hente bilerne fra h-auto.dk.'); if (box.isConnected) drawWeb(); });
      }
      box.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('#sg-web button') : null;
        if (!t) return;
        var mb = t.getAttribute('data-webmode');
        if (mb) { webMode = mb; var w = curWeb(); if (w && w.mode !== mb) { BA.store.setWebLink(car.id, { id: w.id, mode: mb, name: w.name || webName(w.id) }); } drawWeb(); return; }
        if (t.id === 'sg-webuse') link(t.getAttribute('data-id'));
        else if (t.id === 'sg-weblink') { var s = $('#sg-websel', box); if (s && s.value) link(s.value); }
        else if (t.id === 'sg-webchange') { webPick = true; if (!webList) loadWeb(true); drawWeb(); }
        else if (t.id === 'sg-webdel') { BA.store.setWebLink(car.id, null); webPick = false; drawWeb(); BA.toast('Koblingen er fjernet. Kunden ser vores egen side.'); }
        else if (t.id === 'sg-webretry') loadWeb(true);
      });
      loadWeb(false);

      $('#sg-share', box).onclick = function () { if (made) showPdf(made.blob, made.name, true); };
      $('#sg-open', box).onclick = function () { if (made) openTab(made.blob, made.name); };
      redraw();
    }, { noFocus: true });
  };
})();
