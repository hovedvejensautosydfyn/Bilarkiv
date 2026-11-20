/* Bilens forløb, låsen før salg/levering og svar-kortet (Fase 5).
 * Reglerne (hvad mangler der, er knappen låst) ligger i todo.js (BA.todo.flow) og er ens i appen og på serveren.
 * Her er kun skærmbilledet: kortet "Nu: …" på bilsiden, knapperne i det, og kortet "Hvis nogen spørger". */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;

  var PREV = { 'Ankommet': 'Købt', 'Klargøring': 'Ankommet', 'Annonceret': 'Klargøring', 'Udleveret': 'Solgt' };
  var ACTION_LABEL = { checklist: 'Åbn listen', goto: 'Vis', photos: '+ Billeder', ad: '✍️ Annoncetekst' };

  function itemsOf(car, type) { return BA.store.itemsOf(car.id, type); }
  /** Hvad mangler der på bilen lige nu? (også til tests) */
  BA.flowOf = function (car) { return BA.todo.flow(car, BA.todoCtx()); };

  // ---------------------------------------------------------------------------
  // Kortet "Nu: …"
  // ---------------------------------------------------------------------------
  function reqHtml(r) {
    var key = ' data-key="' + esc(r.key) + '"';
    var icon = '<span class="rq-ic' + (r.ok ? ' ok' : '') + '" aria-hidden="true">' + (r.ok ? '✓' : '○') + '</span>';
    var sub = r.skipped ? 'Ikke relevant: ' + (r.why || 'ingen begrundelse') : r.confirmed ? 'Bekræftet af dig' : r.detail;
    var btns = '';
    if (r.ok) {
      if (r.skipped || r.confirmed) btns = '<button type="button" class="btn small ghost" data-act="flow-undo"' + key + '>Fortryd</button>';
    } else {
      var a = r.action;
      if (a) btns += '<button type="button" class="btn small" data-act="flow-go"' + key + '>' + esc(a.t === 'tick' ? a.label : ACTION_LABEL[a.t] || 'Vis') + '</button>';
      if (r.manual) btns += '<button type="button" class="btn small primary" data-act="flow-confirm"' + key + '>Det er gjort ✓</button>';
      if (r.skippable) btns += '<button type="button" class="btn small ghost" data-act="flow-skip"' + key + '>Ikke relevant</button>';
    }
    return '<div class="rq ' + (r.ok ? 'ok' : 'open') + '" data-rq="' + esc(r.key) + '">' + icon + '<div class="main"><div class="t">' + esc(r.text) + '</div>' + (sub ? '<div class="m">' + esc(sub) + '</div>' : '') + '</div><div class="rq-b">' + btns + '</div></div>';
  }

  /** De åbne opgaver, der hører til det trin, bilen står på (før annoncering, eller før levering). */
  function openTasks(car, f) {
    var late = f.stage === 'Annonceret' || f.stage === 'Solgt';
    var list = late ? f.levering.open : itemsOf(car, 'opgave').filter(function (t) { return !t.done && t.phase !== 'levering'; });
    return { late: late, list: list.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }) };
  }

  BA.flowHtml = function (car) {
    var Tm = BA.todo, f = BA.flowOf(car), stage = f.stage, path = Tm.STAGE_PATH;
    var cur = stage === 'Reklamation' ? path.length - 1 : path.indexOf(stage);
    var h = '<div class="steps static" role="list" aria-label="Bilens forløb">' + path.map(function (s, i) {
      return '<span role="listitem" class="step ' + (i < cur ? 'done' : i === cur ? 'now' : '') + '"' + (i === cur ? ' aria-current="step"' : '') + '>' + esc(Tm.STAGE_LABELS[s]) + '</span>';
    }).join('') + '</div>';
    if (stage === 'Reklamation' || stage === 'Udleveret') {
      h += '<div class="card flow"><p class="muted" style="margin:0">Bilen er udleveret. Reklamationer og salgsoplysninger står længere nede.</p>' +
        (stage === 'Udleveret' ? '<button type="button" class="btn small ghost" data-act="flow-back" style="margin-top:8px">← Flyt tilbage til Solgt</button>' : '') + '</div>';
      return h;
    }
    h += '<div class="card flow" data-stage="' + esc(stage) + '"><div class="hd"><h2>Nu: ' + esc(f.label) + '</h2></div>';
    h += '<ul class="flowguide">' + f.guide.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
    f.warnings.forEach(function (w) {
      h += '<div class="banner warn flowwarn"><span>⚠️ ' + esc(w.text) + '</span><button type="button" class="btn small" data-act="flow-warn" data-tick="' + esc(w.action.tick) + '">✓ ' + esc(w.action.label) + '</button></div>';
    });
    if (f.reqs.length) h += '<div class="rqs" role="list">' + f.reqs.map(reqHtml).join('') + '</div>';
    var ot = openTasks(car, f);
    if (ot.list.length && stage !== 'Købt') {
      h += '<div class="rqtasks"><div class="eyebrow">' + (ot.late ? 'Skal laves før levering' : 'Skal laves før annoncering') + '</div>' + ot.list.map(function (t) {
        return '<div class="li"><label class="check" style="min-height:40px"><input type="checkbox" data-act="task-done" data-id="' + esc(t.id) + '" aria-label="Lavet: ' + esc(t.text) + '"></label>' +
          '<div class="main"><div class="t">' + esc(t.text) + '</div></div><button class="icon-btn" type="button" data-act="task-edit" data-id="' + esc(t.id) + '" aria-label="Ret">✎</button></div>';
      }).join('') + '</div>';
    }
    if (f.next) {
      h += '<button type="button" class="btn big flownext ' + (f.locked ? 'locked' : 'primary') + '" data-act="flow-next" aria-disabled="' + (f.locked ? 'true' : 'false') + '">' + (f.locked ? '🔒 ' : '') + esc(f.next.label) + '</button>';
      if (f.locked) h += '<div class="muted small flowlock" role="status">Låst: der mangler ' + f.open + (f.open === 1 ? ' ting' : ' ting') + ' ovenfor.</div>';
    }
    if (f.sellEarly) h += '<button type="button" class="btn small ghost" data-act="flow-sell" style="margin-top:10px">Er bilen solgt allerede? Markér som solgt</button>';
    if (PREV[stage]) h += '<button type="button" class="btn small ghost" data-act="flow-back" style="margin-top:10px">← Flyt tilbage til ' + esc(Tm.STAGE_LABELS[PREV[stage]]) + '</button>';
    return h + '</div>';
  };

  // ---------------------------------------------------------------------------
  // Knapperne
  // ---------------------------------------------------------------------------
  function reqByKey(car, key) { return BA.flowOf(car).reqs.filter(function (r) { return r.key === key; })[0] || null; }

  function skipDialog(car, r) {
    BA.modal('Ikke relevant', '<p style="margin:0 0 10px">' + esc(r.text) + '</p><form novalidate><div class="field"><label for="sk-why">Hvorfor er det ikke relevant? *</label><input id="sk-why" maxlength="300" autocomplete="off" aria-describedby="sk-err"><div class="errtxt" id="sk-err"></div></div>' +
      '<p class="muted small" style="margin:0 0 10px">Det er dit eget valg, og begrundelsen gemmes på bilen.</p>' +
      '<div class="actions"><button type="button" class="btn" data-cancel>Annullér</button><button type="submit" class="btn primary">Spring over</button></div></form>', function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      $('form', box).onsubmit = function (e) {
        e.preventDefault();
        var why = $('#sk-why', box).value.trim().replace(/\s+/g, ' ');
        if (why.length < 3) { $('#sk-err', box).textContent = 'Skriv en kort begrundelse.'; $('#sk-why', box).classList.add('invalid'); return; }
        BA.store.setTjek(car.id, 'krav', r.key, 'ikke', why);
        close();
      };
    });
  }

  function go(car, r) {
    var a = r.action; if (!a) return;
    if (a.t === 'checklist') { if (BA.docsOpen) BA.docsOpen.checklist(car, a.list); }
    else if (a.t === 'goto') { var el = document.getElementById(a.id); if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { el.scrollIntoView(); } } }
    else if (a.t === 'photos') BA.carHelpers.pickFiles('image/*,video/mp4,video/quicktime', true, function (files) { BA.up.add(car.id, files, {}); });
    else if (a.t === 'ad') { if (BA.docsOpen) BA.docsOpen.ad(car); }
    else if (a.t === 'tick') tick(car, a.tick);
  }
  function tick(car, kind) {
    if (BA.todo.lastTick(BA.S.items, car.id, kind)) return;
    var tid = BA.store.addItem(car.id, 'tick', { kind: kind, at: Date.now() });
    BA.toast(BA.store.tickName(kind) + ' ✓', { action: 'Fortryd', onAction: function () { BA.store.deleteItem(tid); }, ms: 7000 });
  }

  function next(car) {
    var f = BA.flowOf(car);
    if (!f.next) return;
    if (f.locked) {
      var miss = f.reqs.filter(function (r) { return !r.ok; });
      BA.toast('Der mangler: ' + miss.map(function (r) { return r.short; }).join(', ') + '.', { long: true });
      var first = document.querySelector('[data-rq="' + miss[0].key + '"]');
      if (first) { first.classList.add('flash'); setTimeout(function () { first.classList.remove('flash'); }, 1500); try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ingen */ } }
      return;
    }
    if (f.next.sale) { BA.carHelpers.openSale(car); return; }
    var to = f.next.to;
    var done = function () {
      BA.store.updateCar(car.id, { status: to });
      BA.toast(to === 'Ankommet' ? 'Bilen er modtaget. Gå den igennem.' : to === 'Klargøring' ? 'Gennemgangen er færdig. Nu skal bilen gøres klar.' : to === 'Annonceret' ? 'Bilen er sat til salg.' : 'Bilen er udleveret.');
    };
    if (to === 'Udleveret' && f.warnings.length) {
      BA.confirm('Der er en advarsel', f.warnings.map(function (w) { return w.text; }).join(' ') + ' Vil du alligevel markere bilen som udleveret?', 'Ja, udleveret', false).then(function (yes) { if (yes) done(); });
      return;
    }
    done();
  }

  BA.flowAct = function (act, car, el) {
    var key = el.getAttribute('data-key'), r;
    switch (act) {
      case 'flow-next': next(car); return true;
      case 'flow-sell': BA.carHelpers.openSale(car); return true;
      case 'flow-go': r = reqByKey(car, key); if (r) go(car, r); return true;
      case 'flow-confirm': r = reqByKey(car, key); if (r && r.manual) BA.store.setTjek(car.id, 'krav', key, 'ok', ''); return true;
      case 'flow-skip': r = reqByKey(car, key); if (r && r.skippable) skipDialog(car, r); return true;
      case 'flow-undo': BA.store.setTjek(car.id, 'krav', key, '', ''); return true;
      case 'flow-warn': tick(car, el.getAttribute('data-tick')); return true;
      case 'flow-back': {
        var from = BA.stage(car.status), to = PREV[from];
        if (!to) return true;
        BA.confirm('Flyt tilbage', 'Flyt bilen tilbage til ' + BA.todo.STAGE_LABELS[to] + '? Det, du allerede har afkrydset, bliver stående.', 'Flyt tilbage', false).then(function (yes) { if (yes) BA.store.updateCar(car.id, { status: to }); });
        return true;
      }
      case 'ans-copy': U.copy(answers(car).text).then(function (ok) { BA.toast(ok ? 'Kopieret. Indsæt det i en besked.' : 'Kunne ikke kopiere.'); }); return true;
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // "Hvis nogen spørger": alt, du skal bruge, når en kunde spørger – samlet ét sted
  // ---------------------------------------------------------------------------
  function dk(iso) { return iso ? U.fmtDate(iso) : ''; }
  function fileOf(car, kind) { return itemsOf(car, 'fil').some(function (f) { return f.kind === kind; }); }

  /** Svarene som liste af { q, a } og som tekst til en besked. Intet internt (kanal, købspris, noter) kommer med i teksten. */
  function answers(car) {
    var rows = [], lines = [];
    // copy: undefined = samme tekst i beskeden · false = kommer ikke med i beskeden · tekst = en anden (kundevenlig) tekst i beskeden
    function row(q, a, copy) { if (a === '' || a == null) return; rows.push({ q: q, a: a }); if (copy === false || copy === '') return; lines.push(q + ': ' + (typeof copy === 'string' ? copy : a)); }
    // Titlen: variant tages kun med, hvis den ikke allerede står i modellen (fx "… Comfortline 1.2 TSI" + "Comfortline")
    var model = String(car.model || '').trim(), variant = String(car.variant || '').trim();
    var title = variant && model.toLowerCase().indexOf(variant.toLowerCase()) < 0 ? model + ' ' + variant : model;
    lines.push(title + (car.reg ? ' (' + car.reg + ')' : ''));
    var price = U.pnum(car.listPrice);
    row('Pris', price != null && price > 0 ? U.kr(price) : '');
    row('Bilen', [car.year, car.km != null ? U.fmtN(car.km) + ' km' : '', car.fuel, car.color].filter(Boolean).join(' · '));
    row('1. registrering', dk(car.firstReg));
    row('Syn', car.nextInspection ? 'Næste syn ' + dk(car.nextInspection) : (car.motDate ? 'Seneste syn ' + dk(car.motDate) + (car.motKm != null ? ' ved ' + U.fmtN(car.motKm) + ' km' : '') : ''));
    var equip = itemsOf(car, 'udstyr').map(function (e) { return e.name; });
    row('Udstyr', equip.join(', '));
    var done = itemsOf(car, 'opgave').filter(function (t) { return t.done; }).sort(function (a, b) { return String(a.doneDate).localeCompare(String(b.doneDate)); });
    var doneTxt = done.map(function (t) { return t.text + (t.doneDate ? ' (' + dk(t.doneDate) + ')' : ''); }).join('; ');
    row('Hvad er lavet på bilen', doneTxt || 'Der er ikke noteret noget som lavet.', doneTxt ? undefined : false);
    // Til kunden: kun fejl, der er afgjort (udbedret, eller bilen sælges med dem), og uden dine egne noter. Uafgjorte fejl og noter står kun her på skærmen.
    var defectList = itemsOf(car, 'fejl'), defects = defectList.map(function (d) {
      var st = d.fixed ? 'udbedret' : d.accepted ? 'bilen sælges med den' : 'ikke afgjort endnu';
      return d.text + (d.note ? ' – ' + d.note : '') + ' (' + st + ')';
    });
    var shared = defectList.filter(function (d) { return d.accepted && !d.fixed; }).map(function (d) { return d.text; }).join('; ');
    row('Kendte fejl og mangler', defects.join('; ') || 'Ingen noteret.', shared || false);
    var g = BA.docs.progress('gennemgang', BA.S.items, car.id);
    if (g.done > 0) {
      var at = 0; Object.keys(g.byKey).forEach(function (k) { if ((g.byKey[k].at || 0) > at) at = g.byKey[k].at; });
      row('Gennemgang', g.done + ' af ' + g.total + ' punkter gennemgået' + (at ? ' den ' + U.fmtLocal(at).slice(0, 10) : '') + (g.fejl ? ', ' + g.fejl + (g.fejl === 1 ? ' fund' : ' fund') : ', ingen fund'), false);
    }
    var papers = [fileOf(car, 'Servicebog') ? 'servicebog ✓' : 'servicebog mangler', BA.todo.regcertDone(BA.S.items, car.id) ? 'registreringsattest ✓' : 'registreringsattest mangler', fileOf(car, 'Synsrapport') ? 'synsrapport ✓' : 'ingen synsrapport'];
    row('Papirer', papers.join(' · '), false);
    var bookings = BA.todo.bookings({ now: Date.now(), cars: [car], items: BA.S.items }, 30).map(function (x) { return x.booking.kind + ' ' + U.fmtLocal(x.booking.start) + (x.booking.who ? ' (' + x.booking.who + ')' : ''); });
    row('Aftalte prøveture', bookings.join('; '), false);
    var r = BA.calc(car, BA.S.items, BA.S.settings);
    row('Hos os siden', car.boughtDate ? dk(car.boughtDate) + (r.days != null ? ' (' + r.days + (r.days === 1 ? ' dag' : ' dage') + ')' : '') : '', false);
    row('Til salg i', r.listedDays != null ? r.listedDays + (r.listedDays === 1 ? ' dag' : ' dage') : '', false);
    row('Mine noter', car.notes ? String(car.notes) : '', false);
    return { rows: rows, text: lines.join('\n') };
  }
  BA.answers = answers;

  BA.answersSection = function (car) {
    if (BA.stage(car.status) === 'Købt') return '';
    var a = answers(car);
    return '<div class="hd"><h2>Hvis nogen spørger</h2><div class="row"><button type="button" class="btn small" data-act="ans-copy">Kopiér som besked</button></div></div>' +
      '<dl class="ans">' + a.rows.map(function (x) { return '<div class="ansrow"><dt>' + esc(x.q) + '</dt><dd>' + esc(x.a) + '</dd></div>'; }).join('') + '</dl>';
  };
})();
