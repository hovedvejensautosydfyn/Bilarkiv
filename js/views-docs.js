/* Fase 3 på bilsiden: dokumenter (slutseddel m.m.), tjeklister, annoncetekst og salgsforløb.
 * Hænges på bilsiden af views-car.js via BA.docsCarSection (kortet) og BA.docsCarAct (knapperne). */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;
  var KORE_APP = 'https://hovedvejensautosydfyn.github.io/Koreseddel/';

  function D() { return BA.docs; }
  function itemsOf(car, type) { return BA.store.itemsOf(car.id, type); }

  // ---------------------------------------------------------------------------
  // Tidligere dokumenter på bilen (de, serveren har lavet: fil-poster med "doc")
  // ---------------------------------------------------------------------------
  function parseDoc(f) { try { var d = JSON.parse(f.doc || ''); return d && d.k && d.v ? d : null; } catch (e) { return null; } }
  /** Seneste dokument af en slags: { fil, k, v } eller null. */
  function lastMade(car, kind) {
    var best = null;
    itemsOf(car, 'fil').forEach(function (f) {
      var d = f.doc ? parseDoc(f) : null;
      if (d && d.k === kind && (!best || (f.createdAt || 0) >= (best.fil.createdAt || 0))) best = { fil: f, k: d.k, v: d.v };
    });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Kortet på bilsiden
  // ---------------------------------------------------------------------------
  BA.docsCarSection = function (car) {
    var sold = BA.isSold(car.status);
    var kinds = [['slut', 'Slutseddel'], ['engros', 'Engros-slutseddel'], ['fuld', 'Fuldmagt'], ['kore', 'Køreseddel']];
    var h = '<div class="hd"><h2>Dokumenter og lister</h2></div>';
    h += '<div class="btnrow">' + kinds.map(function (k) { return '<button type="button" class="btn small' + (sold && k[0] === 'slut' ? ' primary' : '') + '" data-act="doc-new" data-kind="' + k[0] + '">' + esc(k[1]) + '</button>'; }).join('') + '</div>';
    var pend = BA.store.pendingDocs ? BA.store.pendingDocs(car.id) : [];
    pend.forEach(function (p) {
      var label = (D().SPECS[p.kind] || {}).label || 'Dokument';
      h += '<div class="li"><div class="main"><div class="t">' + esc(label) + ' – ' + (p.state === 'failed' ? 'kunne ikke laves (se Mere → Kunne ikke gemmes)' : 'laves som PDF …') + '</div><div class="m muted small">Den ligger under Papirer, når den er færdig.</div></div></div>';
    });
    var g = D().progress('gennemgang', BA.S.items, car.id), k = D().progress('klargoering', BA.S.items, car.id);
    h += '<button type="button" class="listbtn" data-act="chk-open" data-list="gennemgang"><span>Gennemgang ved ankomst</span><b>' + g.done + ' af ' + g.total + (g.fejl ? ' · ' + g.fejl + ' fejl' : '') + ' ›</b></button>';
    h += '<button type="button" class="listbtn" data-act="chk-open" data-list="klargoering"><span>Klargøring</span><b>' + k.done + ' af ' + k.total + ' ›</b></button>';
    h += '<div class="btnrow" style="margin-top:10px"><button type="button" class="btn small" data-act="ad-open">✍️ Lav annoncetekst</button>' +
      '<a class="btn small" href="' + KORE_APP + '" target="_blank" rel="noopener" data-act="kore-app">Åbn Køreseddel-appen</a></div>' +
      '<div class="muted small" style="margin-top:6px">Køreseddel-appen kan ikke udfylde sig selv endnu. Knappen kopierer bilens oplysninger, så du kan indsætte dem der. “Køreseddel” ovenfor er papirblanketten.</div>';
    if (sold && (car.status === 'Solgt' || car.status === 'Udleveret' || car.status === 'Reklamation')) h += saleHtml(car);
    return h;
  };

  function saleHtml(car) {
    var T = BA.todo;
    var h = '<div class="hd" style="margin-top:14px"><h2>Salgsforløb</h2></div>';
    T.SALE_STEPS.forEach(function (s) {
      var at = T.lastTick(BA.S.items, car.id, s[0]);
      h += '<div class="li' + (at ? ' done' : '') + '"><div class="main"><div class="t">' + (at ? '✓ ' : '') + esc(s[1]) + '</div>' + (at ? '<div class="m muted small">' + esc(U.fmtLocal(at)) + '</div>' : '') + '</div>' +
        (at ? '' : '<button type="button" class="btn small" data-act="sale-step" data-tick="' + esc(s[0]) + '">' + esc(s[2]) + '</button>') + '</div>';
    });
    return h;
  }

  BA.docsCarAct = function (act, car, el) {
    switch (act) {
      case 'doc-new': openDoc(car, el.getAttribute('data-kind')); return true;
      case 'chk-open': openChecklist(car, el.getAttribute('data-list')); return true;
      case 'ad-open': openAd(car); return true;
      case 'kore-app': {
        var txt = [car.model, car.reg, car.vin].filter(Boolean).join(' · ');
        U.copy(txt).then(function (ok) { BA.toast(ok ? 'Bilens oplysninger er kopieret: ' + txt : 'Kunne ikke kopiere.', { long: true }); });
        return true;   // linket åbnes af browseren
      }
      case 'sale-step': {
        var kind = el.getAttribute('data-tick');
        if (BA.todo.lastTick(BA.S.items, car.id, kind)) return true;
        BA.store.addItem(car.id, 'tick', { kind: kind, at: Date.now() });
        BA.toast(BA.store.tickName(kind) + ' ✓');
        return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // Udskrift: åbner dokumentet i et nyt vindue og udskriver dér (på iPhone udskriver en iframe ofte hele appsiden)
  // ---------------------------------------------------------------------------
  BA.docsPrint = function (html) {
    var win = null;
    try { win = window.open('', '_blank'); } catch (e) { win = null; }
    if (!win) { BA.toast('Kunne ikke åbne udskrift (pop-up blev stoppet). Tillad pop-ups, eller brug “Gem som PDF på bilen”.', { long: true }); return false; }
    try {
      win.document.open(); win.document.write(html); win.document.close();
      setTimeout(function () { try { win.focus(); win.print(); } catch (e) { BA.toast('Kunne ikke udskrive. Brug “Gem som PDF på bilen” i stedet.', { long: true }); } }, 400);
      return true;
    } catch (e2) {
      try { win.close(); } catch (e3) { /* ingen */ }
      BA.toast('Kunne ikke udskrive. Brug “Gem som PDF på bilen” i stedet.', { long: true });
      return false;
    }
  };

  // ---------------------------------------------------------------------------
  // Kladder (dokumenter, annoncer, byttebil) ligger kun i telefonen og slettes efter 14 dage og ved Log ud (kundeoplysninger og underskrifter)
  // ---------------------------------------------------------------------------
  var DRAFT_MAX_AGE = 14 * 86400000;
  function draftKeys() {
    var out = [];
    try { var ls = window.localStorage; for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (/^ba\.(doc|ad)\./.test(k) || k === 'ba.bytte') out.push(k); } } catch (e) { /* ingen lagring */ }
    return out;
  }
  /**
   * Sletter kladder, der er ældre end 14 dage. Kaldes ved start.
   * En kladde UDEN tidspunkt (fra før tidspunkterne kom til) slettes ikke med det samme: den får tidspunktet "nu" og slettes først efter 14 dage. Ødelagte kladder slettes.
   */
  BA.cleanDrafts = function () {
    draftKeys().forEach(function (k) {
      var o = null;
      try { o = JSON.parse(U.safeStore.get(k) || 'null'); } catch (e) { o = null; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) { U.safeStore.del(k); return; }
      var field = k === 'ba.bytte' ? 'savedAt' : 't', t = +(o.t || o.savedAt) || 0;
      if (!t) { o[field] = Date.now(); U.safeStore.set(k, JSON.stringify(o)); return; }
      if (Date.now() - t > DRAFT_MAX_AGE) U.safeStore.del(k);
    });
  };
  /** Sletter alle kladder (ved Log ud). */
  BA.clearDrafts = function () { draftKeys().forEach(function (k) { U.safeStore.del(k); }); };

  // ---------------------------------------------------------------------------
  // Dokumentdialog: formular + udkast + udskriv + gem som PDF
  // ---------------------------------------------------------------------------
  function fieldHtml(f, vals) {
    var k = f[0], label = f[1], type = f[2] || 'text', span = f[3] === 2 || type === 'area';
    var id = 'dv-' + k, v = vals[k] == null ? '' : vals[k], inner;
    if (type === 'vat') inner = '<select id="' + id + '" data-dv="' + k + '">' + BA.options(Object.keys(D().VAT_OPT).map(function (a) { return { value: a, label: D().VAT_OPT[a] }; }), v) + '</select>';
    else if (type === 'area') inner = '<textarea id="' + id + '" data-dv="' + k + '" rows="3" maxlength="1500">' + esc(v) + '</textarea>';
    else if (type === 'date') inner = '<input type="date" id="' + id + '" data-dv="' + k + '" value="' + esc(v) + '">';
    else inner = '<input id="' + id + '" data-dv="' + k + '" value="' + esc(v) + '" maxlength="200" autocomplete="off">';
    return '<div class="field' + (span ? ' wide' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + inner + '</div>';
  }

  function scalePreview(box) {
    var wrap = $('.docframe-wrap', box), fr = $('.docframe', box);
    if (!wrap || !fr || !wrap.clientWidth) return;
    var k = wrap.clientWidth / 794, h = 1123;
    try { h = Math.max(1123, fr.contentDocument.documentElement.scrollHeight); } catch (e) { /* standard */ }
    fr.style.height = h + 'px';
    fr.style.transform = 'scale(' + k + ')';
    wrap.style.height = Math.ceil(h * k) + 'px';
  }

  function openDoc(car, kind) {
    var spec = D().SPECS[kind];
    if (!spec || kind === 'bytte') return;
    var key = 'ba.doc.' + car.id + '.' + kind;
    var saved = null;
    try { saved = JSON.parse(U.safeStore.get(key) || 'null'); } catch (e) { saved = null; }
    var closer = null;
    var prev = kind === 'kore' ? null : lastMade(car, kind);
    // Bilens egne felter (reg.nr., model, km, pris, datoer …) hentes ALTID fra bilen nu: et gammelt dokument eller en gammel kladde må ikke overskrive dem (bilen er sandheden).
    var base = D().defaults(kind, car, BA.S.settings, itemsOf(car), U.today());
    var vals = D().mergeRemembered(base, prev ? prev.v : {}, saved && typeof saved === 'object' ? saved : null);
    var carSnap = {}; D().CAR_KEYS.forEach(function (k) { if (k in base) carSnap[k] = base[k]; });
    var form = spec.groups.map(function (g) { return '<div class="docgrp"><h4>' + esc(g[0]) + '</h4><div class="grid2">' + g[1].map(function (f) { return fieldHtml(f, vals); }).join('') + '</div></div>'; }).join('');
    var hint = kind === 'kore' ? 'Førerens navn, adresse, kørekort og klokkeslæt står som tomme linjer og udfyldes i hånden. Side 2 er tro- og loveerklæringen om vanvidskørsel.'
      : kind === 'fuld' ? 'Køberens navn, CPR-/CVR-nr. og adresse står som tomme linjer og udfyldes i hånden (CPR-nummer gemmes aldrig i appen).'
      : 'Det, du ikke udfylder, står som tomme linjer til at skrive i hånden. Dokumentet bliver også liggende som PDF på bilen under Papirer.';
    var html = '<div class="docdlg"><div class="docform">' + form + '<p class="muted small" style="margin:0">' + esc(hint) + '</p>' +
      (prev ? '<div class="field" style="margin-top:12px"><label for="dv-mode">Der findes allerede en ' + esc(spec.label.toLowerCase()) + ' (' + esc(prev.fil.name) + ')</label><select id="dv-mode"><option value="new">Gem som ny version (behold den gamle)</option><option value="replace">Erstat den gamle</option></select></div>' : '') +
      '<div class="errtxt" id="dv-err"></div></div><div class="docprev"><div class="docframe-wrap"><iframe class="docframe" title="Udkast" tabindex="-1" sandbox="allow-same-origin allow-modals"></iframe></div></div></div>' +
      '<div class="actions"><button type="button" class="btn" data-close>Luk</button><button type="button" class="btn" data-print>Udskriv</button><button type="button" class="btn primary" data-save>Gem som PDF på bilen</button></div>';
    BA.modal(spec.label + ' – ' + (car.model || 'bil'), html, function (box, close, api) {
      api.el.querySelector('.modal').classList.add('wide');
      var fr = $('.docframe', box), tm = 0, saveTm = 0, finished = false;
      function readAll() { U.$$('[data-dv]', box).forEach(function (el) { vals[el.getAttribute('data-dv')] = el.value; }); }
      function draw() { fr.onload = function () { scalePreview(box); }; fr.srcdoc = D().html(kind, vals); setTimeout(function () { scalePreview(box); }, 60); }
      function saveDraft() { if (finished) return; readAll(); U.safeStore.set(key, JSON.stringify({ v: vals, c: carSnap, t: Date.now() })); }
      box.addEventListener('input', function (e) {
        if (!e.target.matches || !e.target.matches('[data-dv]')) return;
        clearTimeout(tm); tm = setTimeout(function () { readAll(); draw(); }, 300);
        clearTimeout(saveTm); saveTm = setTimeout(saveDraft, 500);
      });
      box.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('[data-dv]')) { saveDraft(); readAll(); draw(); } });
      window.addEventListener('resize', onResize);
      function onResize() { if (!box.isConnected) { window.removeEventListener('resize', onResize); return; } scalePreview(box); }
      $('[data-close]', box).onclick = function () { saveDraft(); close(); };
      $('[data-print]', box).onclick = function () { readAll(); BA.docsPrint(D().html(kind, vals)); };
      $('[data-save]', box).onclick = function () {
        readAll();
        var c = D().clean(kind, vals), err = $('#dv-err', box);
        if (c.error) { err.textContent = c.error; return; }
        err.textContent = '';
        var modeEl = $('#dv-mode', box), replaceId = prev && modeEl && modeEl.value === 'replace' ? prev.fil.id : '';
        BA.store.makeDocument(car.id, kind, c.vals, replaceId);
        finished = true; clearTimeout(tm); clearTimeout(saveTm);   // en ventende kladde-gem må ikke komme efter oprydningen
        U.safeStore.del(key);
        close();
        BA.toast('PDF’en laves nu. Den ligger under Papirer om et øjeblik.', { long: true });
      };
      // Lukkes dialogen på nogen måde (også Escape/tryk ved siden af): kladden gemmes, og ventende timere stoppes, så de ikke skriver en gammel kladde bagefter
      closer = function () { saveDraft(); finished = true; clearTimeout(tm); clearTimeout(saveTm); window.removeEventListener('resize', onResize); };
      draw();
    }, { noFocus: true, onClose: function () { if (closer) closer(); } });
  }

  // ---------------------------------------------------------------------------
  // Tjeklister
  // ---------------------------------------------------------------------------
  function openChecklist(car, list) {
    var def = D().LISTS[list];
    if (!def) return;
    var simple = list === 'klargoering';
    var html = '<p class="muted small" style="margin:0 0 10px">' + esc(def.hint) + '</p><div class="chkprog" id="chk-prog"></div>' +
      def.groups.map(function (g) {
        return '<div class="chkgrp"><h3>' + esc(g.g) + '</h3>' + g.items.map(function (it) {
          return '<div class="chkrow" data-k="' + it.k + '"><div class="chkt">' + esc(it.t) + (it.opt ? ' <span class="muted small">(valgfri)</span>' : '') + '</div>' +
            '<div class="chkbtns" role="group" aria-label="' + esc(it.t) + '"><button type="button" class="st ok" data-st="ok" aria-pressed="false">OK</button>' +
            (simple ? '' : '<button type="button" class="st fejl" data-st="fejl" aria-pressed="false">Fejl</button><button type="button" class="st ikke" data-st="ikke" aria-pressed="false">Ikke relevant</button>') + '</div>' +
            (simple ? '' : '<div class="chkfind" hidden><input class="chknote" maxlength="400" placeholder="Hvad er fejlen? (valgfri note)" aria-label="Note"><div class="row"><button type="button" class="btn small" data-mk="fejl">Gør til fejl/mangel</button><button type="button" class="btn small" data-mk="opgave">Gør til opgave</button><span class="muted small chkmsg"></span></div></div>') + '</div>';
        }).join('') + '</div>';
      }).join('') + '<div class="actions"><button type="button" class="btn primary" data-close>Færdig</button></div>';
    BA.modal(def.title + ' – ' + (car.model || 'bil'), html, function (box, close, api) {
      api.el.querySelector('.modal').classList.add('wide');
      var rows = {}; U.$$('.chkrow', box).forEach(function (r) { rows[r.getAttribute('data-k')] = r; });
      function sync() {
        var p = D().progress(list, BA.S.items, car.id);
        $('#chk-prog', box).innerHTML = '<b>' + p.done + ' af ' + p.total + '</b> besvaret' + (p.fejl ? ' · <span class="neg">' + p.fejl + ' fejl</span>' : '');
        Object.keys(rows).forEach(function (k) {
          var it = p.byKey[k], st = it ? it.state : '', row = rows[k];
          U.$$('.st', row).forEach(function (b) { var on = b.getAttribute('data-st') === st; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
          var find = $('.chkfind', row);
          if (find) {
            find.hidden = st !== 'fejl';
            var inp = $('.chknote', row); if (inp && document.activeElement !== inp && it && inp.value !== (it.note || '')) inp.value = it.note || '';
            var label = labelOf(k), curNote = inp ? inp.value.trim() : ((it && it.note) || ''), txt = label + (curNote ? ': ' + curNote : '');
            var has = itemsOf(car, 'fejl').some(function (f) { return f.text === label || f.text === txt.slice(0, 300); });
            var hasTask = itemsOf(car, 'opgave').some(function (o) { return o.text === txt.slice(0, 200); });
            $('.chkmsg', row).textContent = (has ? 'Ligger under Fejl og mangler ✓' : '') + (has && hasTask ? ' · ' : '') + (hasTask ? 'Opgave oprettet ✓' : '');
            // et fund kan kun gøres til fejl/opgave én gang (ellers får bilen dubletter)
            $('[data-mk="fejl"]', row).disabled = has; $('[data-mk="opgave"]', row).disabled = hasTask;
          }
          row.classList.toggle('done', st === 'ok' || st === 'ikke');
          row.classList.toggle('bad', st === 'fejl');
        });
      }
      function labelOf(k) { var all = D().listItems(list), m = all.filter(function (i) { return i.k === k; })[0]; return m ? m.t : k; }
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-st]');
        if (b) {
          var row = b.closest('.chkrow'), k = row.getAttribute('data-k'), want = b.getAttribute('data-st');
          var cur = (D().progress(list, BA.S.items, car.id).byKey[k] || {}).state || '';
          BA.store.setTjek(car.id, list, k, cur === want ? '' : want);
          return;
        }
        var mk = e.target.closest('[data-mk]');
        if (mk) {
          var row2 = mk.closest('.chkrow'), k2 = row2.getAttribute('data-k'), note = $('.chknote', row2).value.trim();
          var text = labelOf(k2) + (note ? ': ' + note : '');
          if (mk.disabled) return;
          if (mk.getAttribute('data-mk') === 'fejl') { BA.store.addItem(car.id, 'fejl', { text: text.slice(0, 300) }); BA.toast('Lagt under Fejl og mangler. Tilføj foto dér (📷).', { long: true }); }
          else { BA.store.addItem(car.id, 'opgave', { text: text.slice(0, 200) }); BA.toast('Opgaven er oprettet på bilen.'); }
          if (note) BA.store.setTjek(car.id, list, k2, 'fejl', note);
        }
      });
      box.addEventListener('change', function (e) {
        var inp = e.target.closest ? e.target.closest('.chknote') : null;
        if (!inp) return;
        var row = inp.closest('.chkrow'), k = row.getAttribute('data-k');
        BA.store.setTjek(car.id, list, k, 'fejl', inp.value.trim());
      });
      $('[data-close]', box).onclick = function () { close(); };
      var off = function () { if (!box.isConnected) { BA.off && BA.off('data', onData); return; } onData(); };
      function onData() { if (box.isConnected) sync(); }
      BA.on('data', off);
      sync();
    }, { noFocus: true });
  }

  // ---------------------------------------------------------------------------
  // Annoncetekst
  // ---------------------------------------------------------------------------
  var AD_FIELDS = [['navn', 'Mærke og model'], ['variant', 'Variant'], ['motor', 'Motor (fx 1,2)'], ['hk', 'HK'], ['km', 'Km'], ['aar', 'Årgang'], ['forstereg', '1. reg. (fx 06/2016)'], ['gear', 'Gear og brændstof'],
    ['doere', 'Døre'], ['farve', 'Farve'], ['kml', 'Km/l'], ['afgift', 'Ejerafgift'], ['synet', 'Synet til (fx 06/2027)'], ['remkm', 'Tandrem skiftet ved (km)']];
  function openAd(car) {
    var key = 'ba.ad.' + car.id, saved = null;
    try { saved = JSON.parse(U.safeStore.get(key) || 'null'); } catch (e) { saved = null; }
    var closer2 = null;
    var raw = saved && typeof saved.raw === 'string' ? saved.raw : '';
    var f = saved && saved.f ? saved.f : BA.ad.prefill(car, itemsOf(car), raw);
    var html = '<div class="field"><label for="ad-raw">1. Indsæt teksten fra AutoDesktop (valgfrit)</label><textarea id="ad-raw" rows="4" placeholder="Kopiér beskrivelsen fra AutoDesktop og indsæt den her …">' + esc(raw) + '</textarea>' +
      '<button type="button" class="btn small" id="ad-read" style="margin-top:6px">Læs teksten</button></div>' +
      '<div class="field"><label for="ad-out">2. Færdig annoncetekst</label><textarea id="ad-out" rows="12" spellcheck="false"></textarea></div>' +
      '<div class="actions" style="margin-top:0"><button type="button" class="btn" id="ad-newintro">🔄 Ny indledning</button><button type="button" class="btn primary" id="ad-copy">Kopiér annoncetekst</button></div>' +
      '<p class="muted small" style="margin:6px 0 10px">Samme tekst bruges i AutoDesktop og Bilinfo. Du kan rette direkte i den, men så bliver rettelsen overskrevet, hvis du ændrer felterne herunder.</p>' +
      '<details><summary class="muted small" style="cursor:pointer">3. Ret felterne</summary><div class="grid2" style="margin-top:8px">' +
      AD_FIELDS.map(function (a) { return '<div class="field"><label for="ad-' + a[0] + '">' + esc(a[1]) + '</label><input id="ad-' + a[0] + '" data-ad="' + a[0] + '" value="' + esc(f[a[0]] || '') + '" autocomplete="off"></div>'; }).join('') +
      '<div class="field"><label for="ad-rem">Kæde/tandrem</label><select id="ad-rem" data-ad="rem">' + BA.options([{ value: '', label: 'Ikke nævnt' }, { value: 'kaede', label: 'Kæde (ingen tandrem)' }, { value: 'remskiftet', label: 'Tandrem er skiftet' }], f.rem || '') + '</select></div></div>' +
      '<label class="check"><input type="checkbox" data-ad="top"' + (f.top ? ' checked' : '') + '> Topudstyret (overskrift)</label>' +
      '<label class="check"><input type="checkbox" data-ad="visafgift"' + (f.visafgift ? ' checked' : '') + '> Vis ejerafgift som salgspunkt</label>' +
      '<label class="check"><input type="checkbox" data-ad="visncap"' + (f.visncap ? ' checked' : '') + '> Vis Euro NCAP-stjerner (' + esc(f.ncap || 'ukendt') + ')</label>' +
      ['krog|Overskriftens krog (fx SYNET TIL 2027)', 'overskrift|Hele overskriften (tom = laves automatisk)', 'intro|Indledning', 'perfekt|Perfekt som …', 'bund|Bund (adresse m.m.)'].map(function (s) { var p = s.split('|'); return '<div class="field"><label for="ad-' + p[0] + '">' + esc(p[1]) + '</label><input id="ad-' + p[0] + '" data-ad="' + p[0] + '" value="' + esc(f[p[0]] || '') + '" autocomplete="off"></div>'; }).join('') +
      ['vigtigt|Vigtigt (advarsler, én pr. linje)', 'ekstra|Ekstra salgspunkter (én pr. linje)', 'udstyr|Udstyr (én pr. linje)', 'fejl|Fejl og mangler (én pr. linje)'].map(function (s) { var p = s.split('|'); return '<div class="field"><label for="ad-' + p[0] + '">' + esc(p[1]) + '</label><textarea id="ad-' + p[0] + '" data-ad="' + p[0] + '" rows="4">' + esc(f[p[0]] || '') + '</textarea></div>'; }).join('') +
      '</details><div class="actions"><button type="button" class="btn" data-close>Luk</button></div>';
    BA.modal('Annoncetekst – ' + (car.model || 'bil'), html, function (box, close, api) {
      api.el.querySelector('.modal').classList.add('wide-s');
      var out = $('#ad-out', box), tm = 0;
      function save() { U.safeStore.set(key, JSON.stringify({ raw: $('#ad-raw', box).value, f: f, t: Date.now() })); }
      function build() { out.value = BA.ad.build(f); }
      function readFields() {
        U.$$('[data-ad]', box).forEach(function (el) { var k = el.getAttribute('data-ad'); f[k] = el.type === 'checkbox' ? el.checked : el.value; });
      }
      function writeFields() {
        U.$$('[data-ad]', box).forEach(function (el) { var k = el.getAttribute('data-ad'); if (el.type === 'checkbox') el.checked = !!f[k]; else el.value = f[k] == null ? '' : f[k]; });
      }
      box.addEventListener('input', function (e) {
        if (!e.target.matches || !e.target.matches('[data-ad]')) { if (e.target.id === 'ad-raw') { clearTimeout(tm); tm = setTimeout(save, 500); } return; }
        readFields(); build(); clearTimeout(tm); tm = setTimeout(save, 500);
      });
      box.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('[data-ad]')) { readFields(); build(); save(); } });
      $('#ad-read', box).onclick = function () {
        var rawNow = $('#ad-raw', box).value;
        f = BA.ad.prefill(car, itemsOf(car), rawNow);
        writeFields(); build(); save();
        BA.toast(rawNow.trim() ? 'Teksten er læst. Tjek felterne under “Ret felterne”.' : 'Annoncen er lavet ud fra bilens oplysninger.', { long: true });
      };
      $('#ad-newintro', box).onclick = function () { var n = BA.ad.newIntro(f, 1); f.intro = n.intro; f.introIdx = n.idx; writeFields(); build(); save(); };
      $('#ad-copy', box).onclick = function () { U.copy(out.value).then(function (ok) { BA.toast(ok ? 'Annoncen er kopieret. Indsæt den i AutoDesktop og Bilinfo.' : 'Kunne ikke kopiere. Mærk teksten og kopiér selv.', { long: true }); }); };
      $('[data-close]', box).onclick = function () { save(); close(); };
      closer2 = function () { save(); clearTimeout(tm); };
      build();
    }, { noFocus: true, onClose: function () { if (closer2) closer2(); } });
  }

  BA.docsOpen = { doc: openDoc, checklist: openChecklist, ad: openAd, lastMade: lastMade, parseDoc: parseDoc };
})();
