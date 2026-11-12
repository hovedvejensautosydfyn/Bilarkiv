/* Bilsiden: forløb, økonomi, bildata, udstyr, fejl og mangler, opgaver, billeder, papirer, udgifter, timer, reklamationer, noter. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, A = BA.api, $ = U.$, esc = U.esc;
  var V = BA.views = BA.views || {};

  var CATS = {
    udgift: ['Reparation', 'Klargøring', 'Dæk/fælge', 'Rude', 'Syn', 'Transport', 'Andet'],
    time: ['Indkøb/afhentning', 'Klargøring', 'Fotos/annonce', 'Opkald/beskeder', 'Fremvisning/prøvetur', 'Papirarbejde', 'Reklamation'],
    claim: ['Motor', 'Gearkasse/kobling', 'Bremser', 'Undervogn/styretøj', 'Elektrisk', 'Aircondition/klima', 'Udstødning', 'Karrosseri/rust', 'Dæk/fælge', 'Andet']
  };
  var EXP_RULES = [['Transport', /transport|fragt|auto-?logik|afhent|ap.?gebyr|levering/], ['Syn', /syn\b|omsyn|nummerplade|plader/], ['Dæk/fælge', /dæk|fælg|hjul|afbalanc/], ['Rude', /rude|stenslag/],
    ['Klargøring', /klargør|rens|vask|polér|poler|lakstift|rubbing|ozon|smart.?repair|bule|interiør|sædebetræk|måtter|tæppe/],
    ['Reparation', /repar|service|tandrem|rem\b|bremse|kobling|olie|filter|lejer|støddæmp|udstødning|værksted|fjeder|batteri|rust|svejs|aircon|klima|pære|tænd|sensor|motor|gear|styre|bærearm|kugle|fejlfind|pumpe|køler|lambda|turbo|dyse/]];
  var CLAIM_RULES = [['Aircondition/klima', /aircon|klima|\bac\b|a\/c/], ['Bremser', /brems/], ['Gearkasse/kobling', /gear|kobling/], ['Udstødning', /udstødning|katalysator|lydpotte/],
    ['Undervogn/styretøj', /støddæmp|fjeder|bærearm|styre|kugle|lejer|krængning/], ['Elektrisk', /elektr|\bel\b|batteri|lys|pære|sensor|startmotor|generator|central|display|alarm/],
    ['Karrosseri/rust', /rust|lak|bule|karross|dør|skjold/], ['Dæk/fælge', /dæk|fælg/], ['Motor', /motor|olie|tandrem|rem\b|tænd|kølervæske|køler|lambda|turbo|tomgang|lækage/]];
  function guess(rules, txt) { var t = String(txt || '').toLowerCase(); if (!t.trim()) return ''; var m = rules.filter(function (r) { return r[1].test(t); })[0]; return m ? m[0] : ''; }

  // ---------------------------------------------------------------------------
  // Skemaer til dialogerne (ens opbygning for udgift, timer, reklamation, opgave …)
  // ---------------------------------------------------------------------------
  var FORMS = {
    udgift: { title: 'Udgift', fields: [['date', 'Dato', 'date'], ['desc', 'Hvad er pengene brugt på?', 'text', { req: 1, max: 200 }], ['cat', 'Kategori', 'text', { list: CATS.udgift, max: 60 }], ['amount', 'Beløb ex. moms (kr)', 'money', { req: 1 }]] },
    time: { title: 'Timer', fields: [['date', 'Dato', 'date'], ['desc', 'Hvad lavede du?', 'text', { max: 200 }], ['cat', 'Kategori', 'text', { list: CATS.time, max: 60 }], ['hours', 'Timer', 'hours', { req: 1 }]] },
    reklamation: { title: 'Reklamation', fields: [['date', 'Dato', 'date'], ['desc', 'Problem', 'text', { req: 1, max: 300 }], ['type', 'Fejltype', 'text', { list: CATS.claim, max: 60 }], ['fix', 'Løsning / hvem lavede det', 'text', { max: 300 }],
      ['kind', 'Afregning', 'select', { options: [{ value: '', label: 'Reparation (beløb ex. moms)' }, { value: 'Afslag i pris', label: 'Afslag i pris (sænker også brugtmomsen)' }] }], ['amount', 'Beløb (kr)', 'money']] },
    opgave: { title: 'Opgave', fields: [['text', 'Hvad skal laves?', 'text', { req: 1, max: 200 }], ['who', 'Hvem laver den?', 'select', { options: [{ value: '', label: 'Ikke bestemt' }, { value: 'selv', label: 'Selv' }, { value: 'værksted', label: 'Værksted' }] }],
      ['expPrice', 'Forventet pris (kr)', 'money'], ['expHours', 'Forventede timer', 'hours'], ['done', 'Er opgaven lavet?', 'check'], ['actPrice', 'Faktisk pris (kr)', 'money'], ['actHours', 'Faktiske timer', 'hours']] },
    fejl: { title: 'Fejl eller mangel', fields: [['text', 'Hvad er fejlen?', 'text', { req: 1, max: 300 }], ['note', 'Note (valgfri)', 'area', { max: 1000 }], ['fixed', 'Er den afhjulpet?', 'check']] }
  };

  function fieldHtml(f, val, name) {
    var k = f[0], label = f[1], kind = f[2], o = f[3] || {};
    var id = 'if-' + k;
    var v = val == null ? '' : val;
    if (kind === 'check') return '<label class="check"><input type="checkbox" id="' + id + '" data-k="' + k + '"' + (val ? ' checked' : '') + '> ' + esc(label) + '</label>';
    var inner;
    if (kind === 'select') inner = '<select id="' + id + '" data-k="' + k + '">' + BA.options(o.options, v) + '</select>';
    else if (kind === 'area') inner = '<textarea id="' + id + '" data-k="' + k + '" rows="3"' + (o.max ? ' maxlength="' + o.max + '"' : '') + '>' + esc(v) + '</textarea>';
    else if (kind === 'date') inner = '<input type="date" id="' + id + '" data-k="' + k + '" value="' + esc(v) + '">';
    else if (kind === 'money' || kind === 'hours') inner = '<input id="' + id + '" data-k="' + k + '" inputmode="decimal" value="' + esc(val == null ? '' : U.num(val)) + '" autocomplete="off">';
    else inner = '<input id="' + id + '" data-k="' + k + '" value="' + esc(v) + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.list ? ' list="dl-' + k + '-' + name + '"' : '') + ' autocomplete="off">';
    return '<div class="field"><label for="' + id + '">' + esc(label) + (o.req ? ' *' : '') + '</label>' + inner + (o.list ? '<datalist id="dl-' + k + '-' + name + '">' + o.list.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' : '') + '<div class="errtxt" data-err="' + k + '"></div></div>';
  }

  /** Åbner dialogen til at tilføje eller rette en post. */
  function openItemForm(type, car, item, defaults) {
    var spec = FORMS[type];
    var cur = item || Object.assign({}, BA.itemDefaults(type), defaults || {});
    if (!item && (type === 'udgift' || type === 'time' || type === 'reklamation') && !cur.date) cur.date = U.today();
    var fields = spec.fields.filter(function (f) { return type !== 'opgave' || item || (f[0] !== 'done' && f[0] !== 'actPrice' && f[0] !== 'actHours'); });
    var autoNote = item && item.auto === 'kanal' ? '<div class="banner warn">Denne udgift kom automatisk fra indkøbskanalen. Du kan rette eller slette den.</div>' : '';
    var html = autoNote + '<form novalidate>' + fields.map(function (f) { return fieldHtml(f, cur[f[0]], type); }).join('') +
      '<div class="actions">' + (item ? '<button type="button" class="btn danger" data-del>Slet</button>' : '') + '<button type="button" class="btn" data-cancel>Annullér</button><button type="submit" class="btn primary">Gem</button></div></form>';
    BA.modal((item ? 'Ret ' : 'Ny ') + spec.title.toLowerCase(), html, function (box, close) {
      var form = $('form', box);
      var descEl = $('[data-k=desc]', box), catEl = $('[data-k=cat]', box);
      if (descEl && catEl) descEl.onblur = function () { if (!catEl.value.trim()) { var g = guess(type === 'reklamation' ? CLAIM_RULES : EXP_RULES, descEl.value); if (g) catEl.value = g; } };
      if (type === 'reklamation') { var d2 = $('[data-k=desc]', box), t2 = $('[data-k=type]', box); d2.onblur = function () { if (!t2.value.trim()) { var g = guess(CLAIM_RULES, d2.value); if (g) t2.value = g; } }; }
      $('[data-cancel]', box).onclick = function () { close(); };
      var del = $('[data-del]', box);
      if (del) del.onclick = function () { close(); confirmDelete(item, FORMS[type].title.toLowerCase()); };
      form.onsubmit = function (e) {
        e.preventDefault();
        var out = {}, bad = false;
        U.$$('.errtxt', box).forEach(function (x) { x.textContent = ''; }); U.$$('.invalid', box).forEach(function (x) { x.classList.remove('invalid'); });
        fields.forEach(function (f) {
          var k = f[0], kind = f[2], o = f[3] || {}, el = $('[data-k=' + k + ']', box), v;
          if (kind === 'check') v = el.checked;
          else if (kind === 'money' || kind === 'hours') {
            var raw = el.value.trim();
            v = raw === '' ? null : U.pnum(raw);
            if (raw !== '' && (v === null || (kind === 'hours' && v < 0))) { err(k, 'Skriv et tal.'); bad = true; return; }
            if (o.req && v === null) { err(k, 'Skriv et beløb.'); bad = true; return; }
          } else {
            v = el.value.trim();
            if (kind === 'text') v = v.replace(/\s+/g, ' ');
            if (o.req && !v) { err(k, 'Det her felt skal udfyldes.'); bad = true; return; }
          }
          out[k] = v;
        });
        function err(k, m) { var e1 = $('[data-err=' + k + ']', box), inp = $('[data-k=' + k + ']', box); if (e1) e1.textContent = m; if (inp) inp.classList.add('invalid'); }
        if (bad) { var first = $('.invalid', box); if (first) first.focus(); return; }
        if (type === 'opgave' && out.done && !(item && item.done)) out.doneDate = U.today();
        if (item) BA.store.updateItem(item.id, out); else BA.store.addItem(car.id, type, out);
        close();
      };
    });
  }

  function confirmDelete(item, what) {
    BA.confirm('Slet ' + what, 'Er du sikker? Du kan fortryde lige efter.', 'Slet', true).then(function (yes) {
      if (!yes) return;
      var copy = BA.store.deleteItem(item.id);
      if (copy) BA.toast('Slettet.', { action: 'Fortryd', onAction: function () { BA.store.restoreItem(copy); }, ms: 9000 });
    });
  }

  // ---------------------------------------------------------------------------
  // Dele af siden
  // ---------------------------------------------------------------------------
  var openFlags = { exp: false, hours: false, log: false, claims: true };
  var logCache = {};
  var page = null;

  function secHead(title, count, right) {
    return '<div class="hd"><h2>' + esc(title) + (count != null ? ' <span class="cnt">' + count + '</span>' : '') + '</h2><div class="row">' + (right || '') + '</div></div>';
  }
  function toggleHead(key, title, count) {
    return '<div class="hd" data-toggle="' + key + '" role="button" tabindex="0" aria-expanded="' + (openFlags[key] ? 'true' : 'false') + '"><h2>' + esc(title) + (count != null ? ' <span class="cnt">' + count + '</span>' : '') + '</h2><span class="muted">' + (openFlags[key] ? '▲' : '▼') + '</span></div>';
  }

  var SECTIONS = [
    { id: 's-econ', col: 1, render: econ },
    { id: 's-sale', col: 1, render: saleSec, only: 'sold' },
    { id: 's-data', col: 1, render: dataSec },
    { id: 's-equip', col: 1, render: equipSec },
    { id: 's-defects', col: 1, render: defectsSec },
    { id: 's-tasks', col: 1, render: tasksSec },
    { id: 's-photos', col: 2, render: photosSec },
    { id: 's-docs', col: 2, render: docsSec },
    { id: 's-exp', col: 2, render: expSec, collapsible: 'exp' },
    { id: 's-hours', col: 2, render: hoursSec, collapsible: 'hours' },
    { id: 's-claims', col: 2, render: claimsSec, only: 'sold', collapsible: 'claims' },
    { id: 's-notes', col: 2, render: notesSec },
    { id: 's-log', col: 2, render: logSec, collapsible: 'log' },
    { id: 's-danger', col: 2, render: dangerSec }
  ];

  function itemsOf(car, type) { return BA.store.itemsOf(car.id, type); }
  function byCreated(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }

  // ----- økonomi -----
  function econ(car) {
    var st = BA.S.settings, r = BA.calc(car, BA.S.items, st);
    var cell = function (l, v, cls) { return '<div><div class="l">' + l + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>'; };
    var h = secHead('Økonomi');
    var cells = [];
    cells.push(cell('Købspris', U.kr(r.buy)));
    cells.push(cell('Udgifter', U.kr(r.exp)));
    cells.push(cell('Kostpris', U.kr(r.cost)));
    if (!r.sold && r.extra) cells.push(cell('Forventet ekstra (åbne opgaver)', U.kr(r.extra)));
    if (r.sold) {
      cells.push(cell('Salgspris', U.kr(U.pnum(car.soldPrice))));
      cells.push(cell('Brugtmoms', U.kr(r.vat)));
      cells.push(cell('Aktuel avance', U.kr(r.current), r.current < 0 ? 'neg' : 'pos'));
      if (r.claims) cells.push(cell('Reklamationer', U.kr(r.claims), 'neg'));
    } else {
      cells.push(cell('Annonceret', U.kr(U.pnum(car.listPrice))));
      cells.push(cell('Forv. avance efter brugtmoms', r.expected == null ? '–' : U.kr(r.expected), r.expected == null ? '' : r.expected < 0 ? 'neg' : r.expected < st.minProfit ? 'warn' : 'pos'));
    }
    cells.push(cell('Timer', U.hours(r.hrs)));
    cells.push(cell('Kr. pr. time', r.perHour == null ? '–' : U.kr(r.perHour), r.perHour == null ? '' : r.perHour < st.hourGoal ? 'neg' : 'pos'));
    cells.push(cell(r.sold ? 'Dage på lager' : 'Dage på lager', r.days == null ? '–' : r.days + (r.days === 1 ? ' dag' : ' dage'), !r.sold && r.days != null && r.days >= st.stockDays ? 'neg' : ''));
    h += '<div class="econ">' + cells.join('') + '</div>';
    var v = BA.verdict(r, st);
    if (v) h += '<div class="verdict ' + v.cls + '" role="status"><b>Kan det betale sig?</b> ' + esc(v.text) + '</div>';
    return h;
  }

  // ----- sælger / salg -----
  function inp(car, k, label, kind, extra) {
    var val = car[k];
    var shown = kind === 'price' || kind === 'int' ? (val == null ? '' : (kind === 'int' ? U.fmtN(val) : U.num(val))) : (val == null ? '' : val);
    var id = 'f-' + k;
    return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-f="' + k + '" data-kind="' + (kind || 'text') + '" value="' + esc(shown) + '" ' + (extra || '') + '></div>';
  }
  function saleSec(car) {
    var st = BA.S.settings;
    return secHead('Salg') + '<div class="grid2">' + inp(car, 'soldPrice', 'Salgspris (kr)', 'price', 'inputmode="decimal"') + inp(car, 'soldDate', 'Salgsdato', 'date', 'type="date"') + '</div>' +
      '<div class="grid2">' + inp(car, 'soldVia', 'Salgskanal', 'text', 'list="dl-via" maxlength="60"') + inp(car, 'buyer', 'Køber', 'text', 'maxlength="100"') + '</div>' +
      inp(car, 'buyerPhone', 'Købers telefon', 'tel', 'inputmode="tel" maxlength="20"') +
      '<datalist id="dl-via">' + (st.salesChannels || []).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<button class="btn small" type="button" data-act="reopen">Fortryd salg</button>';
  }

  // ----- bildata -----
  function dataSec(car) {
    var st = BA.S.settings;
    var chans = (st.channels || []).map(function (c) { return c.name; });
    if (car.channel && chans.indexOf(car.channel) < 0) chans.push(car.channel);
    return secHead('Bildata') +
      '<div class="grid2">' + inp(car, 'reg', 'Nummerplade', 'reg', 'maxlength="12" autocapitalize="characters"') + inp(car, 'year', 'Årgang', 'year', 'inputmode="numeric" maxlength="4"') + '</div>' +
      inp(car, 'model', 'Mærke og model', 'model', 'maxlength="100"') + inp(car, 'variant', 'Variant', 'text', 'maxlength="100"') +
      '<div class="grid2">' + inp(car, 'km', 'Km', 'int', 'inputmode="numeric"') + inp(car, 'fuel', 'Brændstof', 'text', 'list="dl-fuel" maxlength="40"') + '</div>' +
      '<div class="grid2">' + inp(car, 'color', 'Farve', 'text', 'maxlength="40"') + inp(car, 'firstReg', '1. registrering', 'date', 'type="date"') + '</div>' +
      inp(car, 'vin', 'Stelnummer', 'vin', 'maxlength="20" autocapitalize="characters"') +
      '<div class="field"><label for="f-channel">Indkøbskanal</label><select id="f-channel" data-f="channel" data-kind="text">' + BA.options(chans, car.channel, '—') + '</select></div>' +
      '<div class="grid3">' + inp(car, 'boughtDate', 'Købsdato', 'date', 'type="date"') + inp(car, 'buyPrice', 'Købspris (kr)', 'price', 'inputmode="decimal"') + inp(car, 'listPrice', 'Annonceret pris (kr)', 'price', 'inputmode="decimal"') + '</div>' +
      (car.motKm != null ? '<p class="muted small" style="margin:0">Seneste syn' + (car.motDate ? ' (' + esc(U.fmtDate(car.motDate)) + ')' : '') + ': ' + esc(U.fmtN(car.motKm)) + ' km' + (car.nextInspection ? ' · næste syn ' + esc(U.fmtDate(car.nextInspection)) : '') + '</p>' : '') +
      '<datalist id="dl-fuel"><option>Benzin<option>Diesel<option>El<option>Hybrid (benzin)<option>Plug-in hybrid</datalist>';
  }

  // ----- udstyr -----
  function equipSec(car) {
    var list = itemsOf(car, 'udstyr').sort(byCreated);
    return secHead('Udstyr', list.length) + (list.length ? '<div class="chips">' + list.map(function (e) {
      return '<span class="chip big' + (e.source === 'dmr' ? '' : ' acc') + '" title="' + (e.source === 'dmr' ? 'Fra registret' : 'Tilføjet af dig') + '">' + esc(e.name) + '<button type="button" data-act="eq-del" data-id="' + esc(e.id) + '" aria-label="Fjern ' + esc(e.name) + '">✕</button></span>';
    }).join('') + '</div>' : '<p class="muted small" style="margin:0">Intet udstyr endnu.</p>');
  }

  // ----- fejl og mangler -----
  function defectsSec(car) {
    var list = itemsOf(car, 'fejl').sort(byCreated);
    var uploads = BA.up.forCar(car.id).filter(function (u) { return u.parent; });
    return secHead('Fejl og mangler', list.length) + (list.length ? list.map(function (d) {
      var media = itemsOf(car, 'fil').filter(function (f) { return f.parent === d.id; }).sort(byCreated);
      var tasked = itemsOf(car, 'opgave').some(function (t) { return t.fromDefect === d.id; });
      return '<div class="li' + (d.fixed ? ' done' : '') + '"><label class="check" style="min-height:40px"><input type="checkbox" data-act="fix" data-id="' + esc(d.id) + '"' + (d.fixed ? ' checked' : '') + ' aria-label="Afhjulpet"></label>' +
        '<div class="main"><div class="t">' + esc(d.text) + '</div>' + (d.note ? '<div class="m">' + esc(d.note) + '</div>' : '') +
        (media.length ? '<div class="chips" style="margin-top:6px">' + media.map(function (m, i) { return '<button type="button" class="thumb mini" data-act="media" data-id="' + esc(m.id) + '" data-defect="' + esc(d.id) + '" aria-label="Åbn ' + esc(m.name) + '">' + (m.kind === 'video' ? '▶' : '<img data-iid="' + esc(m.id) + '" alt="" data-ph="Foto">') + '</button>'; }).join('') + '</div>' : '') +
        '<div class="row" style="margin-top:6px"><button type="button" class="btn small" data-act="def-media" data-id="' + esc(d.id) + '">📷 Foto/video</button>' +
        (tasked ? '<span class="chip ok">Er en opgave</span>' : '<button type="button" class="btn small" data-act="def-task" data-id="' + esc(d.id) + '">Gør til opgave</button>') + '</div></div>' +
        '<button class="icon-btn" type="button" data-act="def-edit" data-id="' + esc(d.id) + '" aria-label="Ret">✎</button><button class="icon-btn del" type="button" data-act="def-del" data-id="' + esc(d.id) + '" aria-label="Slet">✕</button></div>';
    }).join('') : '<p class="muted small" style="margin:0">Ingen fejl eller mangler noteret.</p>') + uploadRows(uploads);
  }

  // ----- opgaver -----
  function tasksSec(car) {
    var list = itemsOf(car, 'opgave').sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || byCreated(a, b); });
    var open = list.filter(function (t) { return !t.done; });
    var meta = function (t) {
      var parts = [];
      if (t.who) parts.push(t.who === 'selv' ? 'Selv' : 'Værksted');
      if (t.done) { parts.push('faktisk ' + U.kr(t.actPrice) + ' · ' + U.hours(t.actHours)); }
      else { if (t.expPrice != null) parts.push('forventet ' + U.kr(t.expPrice)); if (t.expHours != null) parts.push(U.hours(t.expHours)); }
      return parts.join(' · ');
    };
    return secHead('Opgaver', open.length + ' åbne' + (list.length > open.length ? ' · ' + (list.length - open.length) + ' lavet' : '')) + (list.length ? list.map(function (t) {
      return '<div class="li' + (t.done ? ' done' : '') + '"><label class="check" style="min-height:40px"><input type="checkbox" data-act="task-done" data-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + ' aria-label="Lavet"></label>' +
        '<div class="main"><div class="t">' + esc(t.text) + '</div><div class="m">' + esc(meta(t)) + '</div></div><button class="icon-btn" type="button" data-act="task-edit" data-id="' + esc(t.id) + '" aria-label="Ret">✎</button></div>';
    }).join('') : '<p class="muted small" style="margin:0">Ingen opgaver endnu. Skriv det, der skal laves – med pris og timer, hvis du ved det.</p>');
  }

  // Hurtig-indtastning står uden for det, der tegnes om, så feltet beholder fokus (og tastaturet på telefonen), mens listen opdateres.
  var FOOT = {
    's-equip': '<form class="addrow" data-add="udstyr"><input name="t" placeholder="Tilføj udstyr (fx Anhængertræk)" maxlength="120" aria-label="Nyt udstyr" autocomplete="off"><button class="btn" type="submit">Tilføj</button></form>',
    's-defects': '<form class="addrow" data-add="fejl"><input name="t" placeholder="Ny fejl eller mangel (fx Bule i venstre dør)" maxlength="300" aria-label="Ny fejl" autocomplete="off"><button class="btn" type="submit">Tilføj</button></form>',
    's-tasks': '<form class="addrow" data-add="opgave"><input name="t" placeholder="Ny opgave (fx Skift bremseklodser)" maxlength="200" aria-label="Ny opgave" autocomplete="off"><button class="btn" type="submit">Tilføj</button></form>' +
      '<button class="btn small" type="button" data-act="task-new" style="margin-top:8px">+ Opgave med pris og timer</button>'
  };

  // ----- billeder -----
  function uploadRows(ups) {
    if (!ups.length) return '';
    return '<div style="margin-top:10px">' + ups.map(function (u) {
      var label = u.status === 'wait' ? 'Venter …' : u.status === 'prep' ? 'Forbereder …' : u.status === 'send' ? 'Sender …' : u.status === 'done' ? 'Sendt ✓' : 'Fejl';
      return '<div class="upl"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(u.name) + '</span><span class="' + (u.status === 'error' ? 'neg' : u.status === 'done' ? 'pos' : 'muted') + '">' +
        (u.status === 'error' ? esc(u.err) + ' <button type="button" class="btn small" data-act="up-retry" data-id="' + esc(u.id) + '">Prøv igen</button> <button type="button" class="btn small ghost" data-act="up-dismiss" data-id="' + esc(u.id) + '">Fjern</button>' : label) + '</span></div>';
    }).join('') + '</div>';
  }
  function photosSec(car) {
    var photos = BA.photosOf(car.id);
    var cover = BA.coverOf(car);
    var shown = page && page.allPhotos ? photos : photos.slice(0, 30);
    var uploads = BA.up.forCar(car.id).filter(function (u) { return !u.parent && (u.kind === 'photo' || u.kind === 'video'); });
    return secHead('Billeder', photos.length, '<button class="btn small" type="button" data-act="photo-add">+ Billeder</button>' + (photos.length ? '<button class="btn small" type="button" data-act="zip">Hent alle</button>' : '')) +
      (shown.length ? '<div class="thumbs">' + shown.map(function (p, i) {
        return '<button type="button" class="thumb" data-act="photo-open" data-id="' + esc(p.id) + '" aria-label="Åbn ' + esc(p.name) + '">' +
          (p.kind === 'video' ? '▶ Video<br>' + esc(p.name) : '<img data-iid="' + esc(p.id) + '" alt="' + esc(p.name) + '" data-ph="Intet billede">') +
          (cover && cover.id === p.id ? '<span class="cov chip ok">Forside</span>' : '') + '</button>';
      }).join('') + '</div>' + (photos.length > shown.length ? '<button class="btn small" type="button" data-act="photos-all" style="margin-top:10px">Vis alle ' + photos.length + '</button>' : '') : '<p class="muted small" style="margin:0">Ingen billeder endnu. Tryk “+ Billeder”, og vælg fra telefonen eller tag nye.</p>') + uploadRows(uploads);
  }

  // ----- papirer -----
  function docsSec(car) {
    var docs = itemsOf(car, 'fil').filter(function (f) { return f.kind !== 'photo' && f.kind !== 'video' && !f.parent; }).sort(byCreated);
    var uploads = BA.up.forCar(car.id).filter(function (u) { return !u.parent && u.kind !== 'photo' && u.kind !== 'video'; });
    return secHead('Papirer', docs.length, '<button class="btn small" type="button" data-act="doc-add">+ Papir</button>') + (docs.length ? docs.map(function (d) {
      return '<div class="li"><div class="main"><div class="t"><button type="button" class="btn ghost small" style="text-transform:none;letter-spacing:0;padding:0;min-height:30px;color:var(--accent)" data-act="doc-open" data-id="' + esc(d.id) + '">' + esc(d.name) + '</button></div>' +
        '<div class="m">' + (d.size ? Math.round(d.size / 1000) + ' kB · ' : '') + esc(U.fmtDate(d.added)) + '</div></div>' +
        '<select data-act="doc-kind" data-id="' + esc(d.id) + '" aria-label="Type" style="width:auto;min-height:36px;padding:4px 8px;font-size:14px">' + BA.options(BA.DOC_KINDS, d.kind) + '</select>' +
        '<button class="icon-btn del" type="button" data-act="doc-del" data-id="' + esc(d.id) + '" aria-label="Slet">✕</button></div>';
    }).join('') : '<p class="muted small" style="margin:0">Ingen papirer endnu (slutseddel, registreringsattest, synsrapport …).</p>') + uploadRows(uploads);
  }

  // ----- udgifter, timer, reklamationer -----
  function expSec(car) {
    var list = itemsOf(car, 'udgift').sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || byCreated(a, b); });
    var doneTasks = itemsOf(car, 'opgave').filter(function (t) { return t.done && t.actPrice; });
    var r = BA.calc(car, BA.S.items, BA.S.settings);
    var body = '<table class="lines"><thead><tr><th>Dato</th><th>Hvad</th><th class="r">Beløb</th></tr></thead><tbody>' + list.map(function (x) {
      return '<tr class="click" tabindex="0" data-act="exp-edit" data-id="' + esc(x.id) + '"><td>' + esc(U.fmtDate(x.date)) + '</td><td>' + esc(x.desc) + (x.cat ? '<div class="m muted small">' + esc(x.cat) + (x.auto === 'kanal' ? ' · fast omkostning' : '') + '</div>' : '') + '</td><td class="r">' + U.kr(x.amount) + '</td></tr>';
    }).join('') + doneTasks.map(function (t) { return '<tr><td>' + esc(U.fmtDate(t.doneDate)) + '</td><td>' + esc(t.text) + '<div class="muted small">fra opgave</div></td><td class="r">' + U.kr(t.actPrice) + '</td></tr>'; }).join('') + '</tbody></table>';
    return toggleHead('exp', 'Udgifter', U.kr(r.exp)) + '<div class="bd">' + (list.length || doneTasks.length ? body : '<p class="muted small" style="margin:0 0 8px">Ingen udgifter endnu.</p>') +
      '<button class="btn small" type="button" data-act="exp-new" style="margin-top:10px">+ Tilføj udgift</button></div>';
  }
  function hoursSec(car) {
    var list = itemsOf(car, 'time').sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || byCreated(a, b); });
    var r = BA.calc(car, BA.S.items, BA.S.settings);
    return toggleHead('hours', 'Timer', U.hours(r.hrs)) + '<div class="bd">' + (list.length ? '<table class="lines"><thead><tr><th>Dato</th><th>Hvad</th><th class="r">Timer</th></tr></thead><tbody>' + list.map(function (x) {
      return '<tr class="click" tabindex="0" data-act="time-edit" data-id="' + esc(x.id) + '"><td>' + esc(U.fmtDate(x.date)) + '</td><td>' + esc(x.desc || x.cat || '–') + (x.cat && x.desc ? '<div class="muted small">' + esc(x.cat) + '</div>' : '') + '</td><td class="r">' + U.hours(x.hours) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted small" style="margin:0 0 8px">Ingen timer endnu. Timer på afkrydsede opgaver tælles med automatisk.</p>') +
      '<button class="btn small" type="button" data-act="time-new" style="margin-top:10px">+ Tilføj timer</button></div>';
  }
  function claimsSec(car) {
    var list = itemsOf(car, 'reklamation').sort(byCreated);
    var r = BA.calc(car, BA.S.items, BA.S.settings);
    return toggleHead('claims', 'Reklamationer', list.length ? list.length + ' · ' + U.kr(r.claims) : 0) + '<div class="bd">' + (list.length ? '<table class="lines"><thead><tr><th>Dato</th><th>Problem</th><th class="r">Beløb</th></tr></thead><tbody>' + list.map(function (x) {
      return '<tr class="click" tabindex="0" data-act="claim-edit" data-id="' + esc(x.id) + '"><td>' + esc(U.fmtDate(x.date)) + '</td><td>' + esc(x.desc) + '<div class="muted small">' + esc([x.type, x.kind, x.fix].filter(Boolean).join(' · ')) + '</div></td><td class="r">' + U.kr(x.amount) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted small" style="margin:0 0 8px">Ingen reklamationer.</p>') +
      '<button class="btn small" type="button" data-act="claim-new" style="margin-top:10px">+ Tilføj reklamation</button></div>';
  }

  function notesSec(car) {
    return secHead('Noter') + '<div class="field" style="margin:0"><textarea id="f-notes" data-f="notes" data-kind="note" rows="4" maxlength="4000" aria-label="Noter">' + esc(car.notes || '') + '</textarea></div>';
  }

  function logSec(car) {
    var c = logCache[car.id];
    var body;
    if (!openFlags.log) body = '';
    else if (!c) body = '<p class="muted small"><span class="spin"></span> Henter …</p>';
    else if (c.err) body = '<p class="neg small">' + esc(c.err) + '</p>';
    else body = c.log.length ? '<div class="small">' + c.log.map(function (l) { return '<div class="li"><div class="main"><div class="t">' + esc(l.action) + ': ' + esc(l.text) + '</div><div class="m">' + esc(U.fmtTime(l.at)) + ' · ' + esc(l.who) + '</div></div></div>'; }).join('') + '</div>' : '<p class="muted small">Ingen ændringer endnu.</p>';
    return toggleHead('log', 'Aktivitet (hvem ændrede hvad)') + '<div class="bd">' + body + '</div>';
  }

  function dangerSec(car) {
    return secHead('Slet') + '<p class="muted small" style="margin-top:0">Sletter bilen fra listerne. Billeder og papirer bliver liggende i Drive, og du kan fortryde lige efter.</p><button class="btn danger" type="button" data-act="del-car">Slet bilen</button>';
  }

  // ---------------------------------------------------------------------------
  // Header og forløb
  // ---------------------------------------------------------------------------
  function headHtml(car) {
    var sub = [car.variant, car.year, car.km != null ? U.fmtN(car.km) + ' km' : null, car.fuel, car.color].filter(Boolean).join(' · ');
    return '<div class="carhead"><div>' + U.plate(car.reg, true) + '<h1>' + esc(car.model || 'Uden navn') + '</h1><div class="muted">' + esc(sub) + '</div></div>' +
      '<div class="row"><span class="chip big ' + BA.statusClass(car.status) + '">' + esc(car.status) + '</span><button class="btn" type="button" data-act="adcopy">Kopiér til AutoDesktop</button></div></div>';
  }
  function stepsHtml(car) {
    var sold = BA.isSold(car.status), cur = BA.STATUSES.indexOf(car.status);
    var list = sold ? BA.STATUSES.slice(BA.SOLD_FROM) : BA.STATUSES.slice(0, BA.SOLD_FROM + 1);
    var h = '<div class="steps" role="group" aria-label="Bilens forløb">' + list.map(function (s) {
      var i = BA.STATUSES.indexOf(s);
      return '<button type="button" class="step ' + (i < cur ? 'done' : i === cur ? 'now' : '') + '" data-act="step" data-status="' + esc(s) + '"' + (i === cur ? ' aria-current="step"' : '') + '>' + esc(s) + '</button>';
    }).join('') + '</div>';
    var next = null;
    if (!sold && cur < BA.SOLD_FROM - 1) next = { label: 'Næste trin: ' + BA.STATUSES[cur + 1], status: BA.STATUSES[cur + 1] };
    else if (!sold) next = { label: 'Markér som solgt', status: 'Solgt' };
    else if (cur === BA.SOLD_FROM) next = { label: 'Næste trin: Udleveret', status: 'Udleveret' };
    if (next) h += '<button type="button" class="btn primary big" data-act="step" data-status="' + esc(next.status) + '" style="margin-bottom:14px">' + esc(next.label) + '</button>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Tegning og opdatering
  // ---------------------------------------------------------------------------
  function shell(car) {
    var sold = BA.isSold(car.status);
    var cols = [[], []];
    SECTIONS.forEach(function (s) {
      cols[s.col - 1].push('<section class="card' + (s.collapsible ? ' collapsible' + (openFlags[s.collapsible] ? ' open' : '') : '') + '" id="' + s.id + '"' + (s.only === 'sold' && !sold ? ' hidden' : '') + '><div data-body></div>' + (FOOT[s.id] || '') + '</section>');
    });
    return '<a class="crumb" href="' + (sold ? '#/solgte' : '#/lager') + '">‹ ' + (sold ? 'Solgte biler' : 'Biler på lager') + '</a>' + BA.offlineBanner() +
      '<div id="c-head"></div><div id="c-steps"></div><div class="cols"><div>' + cols[0].join('') + '</div><div>' + cols[1].join('') + '</div></div>';
  }

  V.bil = function (root, id) {
    var car = BA.store.car(id);
    if (!car) {
      if (!BA.S.loaded) { root.innerHTML = '<div class="skeleton"></div>'; page = null; return; }
      root.innerHTML = '<div class="empty">Bilen findes ikke (mere). <a href="#/lager">Til lageret</a></div>'; page = null; return;
    }
    if (!page || page.id !== id || page.root !== root || !root.querySelector('#c-head')) {
      page = { id: id, root: root, cache: {}, allPhotos: false, shellSold: BA.isSold(car.status) };
      root.innerHTML = shell(car);
      bindPage(root);
    }
    var sold = BA.isSold(car.status);
    if (sold !== page.shellSold) { page = null; V.bil(root, id); return; }   // bilen skiftede mellem lager og solgt: ny ramme
    paint(root, car);
  };

  function setHtml(el, key, html) {
    if (page.cache[key] === html) return;
    if (BA.focusInside(el)) { page.dirty = true; return; }
    el.innerHTML = html; page.cache[key] = html;
    BA.img.hydrate(el);
  }
  function paint(root, car) {
    page.dirty = false;
    setHtml($('#c-head', root), 'head', headHtml(car));
    setHtml($('#c-steps', root), 'steps', stepsHtml(car));
    SECTIONS.forEach(function (s) {
      var el = $('#' + s.id, root);
      if (!el) return;
      if (s.collapsible) el.classList.toggle('open', !!openFlags[s.collapsible]);
      setHtml(el.querySelector('[data-body]'), s.id, s.render(car));
    });
  }
  V.bilUpdate = function (root) { if (page && page.root === root) V.bil(root, page.id); };
  V.bilReset = function () { page = null; };

  // ---------------------------------------------------------------------------
  // Hændelser
  // ---------------------------------------------------------------------------
  function saveField(el, root) {
    var car = BA.store.car(page.id); if (!car) return;
    var k = el.getAttribute('data-f'), kind = el.getAttribute('data-kind'), val;
    el.classList.remove('invalid');
    var fail = function (m) { el.classList.add('invalid'); BA.toast(m); };
    if (kind === 'price' || kind === 'int') {
      var n = BA.readNumber(el, kind === 'int' ? 'int' : 'price');
      if (!n.ok) return fail(kind === 'int' ? 'Skriv et helt tal.' : 'Skriv et beløb.');
      val = n.value;
    } else {
      val = el.tagName === 'TEXTAREA' ? el.value.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : el.value.trim().replace(/\s+/g, ' ');
      if (kind === 'reg') { val = val.toUpperCase().replace(/[\s.\-]/g, ''); if (!/^[A-Z0-9]{2,8}$/.test(val)) return fail('Nummerpladen ser forkert ud.'); }
      if (kind === 'model' && !val) return fail('Mærke og model kan ikke være tomt.');
      if (kind === 'year' && val && !/^(19|20)\d{2}$/.test(val)) return fail('Årgang skal være et årstal, fx 2019.');
      if (kind === 'vin') { val = val.toUpperCase().replace(/\s/g, ''); if (val && !/^[A-Z0-9]{5,20}$/.test(val)) return fail('Stelnummeret må kun have bogstaver og tal (5-20 tegn).'); }
      if (kind === 'date' && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return fail('Ugyldig dato.');
    }
    var f = {}; f[k] = val;
    if (!BA.store.updateCar(car.id, f)) { // uændret: ret visningen (fx stort/småt)
      if (el.tagName !== 'TEXTAREA' && kind !== 'price' && kind !== 'int') el.value = val;
    }
  }

  function setStatus(car, status) {
    if (status === car.status) return;
    var toSold = BA.isSold(status), fromSold = BA.isSold(car.status);
    if (!fromSold && toSold) { openSale(car); return; }
    if (fromSold && !toSold) {
      BA.confirm('Fortryd salg', 'Bilen flyttes tilbage på lager, og salgsoplysningerne (pris, dato, køber) fjernes. De gemmes i aktivitetsloggen. Fortsæt?', 'Fortryd salg', true).then(function (yes) {
        if (!yes) return;
        BA.store.reopenSale(car.id);
        if (status !== 'Annonceret') BA.store.updateCar(car.id, { status: status });
      });
      return;
    }
    BA.store.updateCar(car.id, { status: status });
  }

  function openSale(car) {
    var st = BA.S.settings;
    var html = '<form novalidate><div class="field"><label for="sd-price">Salgspris (kr) *</label><input id="sd-price" inputmode="decimal" value="' + esc(car.listPrice != null ? U.num(car.listPrice) : '') + '" autocomplete="off"><div class="errtxt" id="sd-perr"></div></div>' +
      '<div class="grid2"><div class="field"><label for="sd-date">Salgsdato</label><input id="sd-date" type="date" value="' + U.today() + '"></div>' +
      '<div class="field"><label for="sd-via">Salgskanal</label><input id="sd-via" list="sd-vias" maxlength="60" autocomplete="off"><datalist id="sd-vias">' + (st.salesChannels || []).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="grid2"><div class="field"><label for="sd-buyer">Køber</label><input id="sd-buyer" maxlength="100" autocomplete="off"></div><div class="field"><label for="sd-phone">Telefon</label><input id="sd-phone" inputmode="tel" maxlength="20" autocomplete="off"></div></div>' +
      '<div class="actions"><button type="button" class="btn" data-cancel>Annullér</button><button type="submit" class="btn primary">Markér som solgt</button></div></form>';
    BA.modal('Markér som solgt', html, function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      $('form', box).onsubmit = function (e) {
        e.preventDefault();
        var price = U.pnum($('#sd-price', box).value), err = $('#sd-perr', box);
        if (price === null || price < 0) { err.textContent = 'Skriv salgsprisen.'; $('#sd-price', box).classList.add('invalid'); return; }
        var phone = $('#sd-phone', box).value.trim();
        if (phone && !/^[0-9+() \-]{3,20}$/.test(phone)) { err.textContent = 'Telefonnummeret ser forkert ud.'; return; }
        BA.store.markSold(car.id, { soldPrice: price, soldDate: $('#sd-date', box).value || U.today(), soldVia: $('#sd-via', box).value.trim(), buyer: $('#sd-buyer', box).value.trim(), buyerPhone: phone });
        close();
        BA.toast('Bilen er markeret som solgt.');
      };
    });
  }

  function openAd(car) {
    var fields = BA.adFields(car, BA.S.items);
    var html = '<div class="row" style="margin-bottom:8px"><button type="button" class="btn primary" data-copyall>Kopiér alt</button></div>' +
      fields.map(function (f, i) { return '<div class="copyrow"><div class="k">' + esc(f.label) + '</div><div class="v">' + (f.value ? esc(f.value) : '<span class="muted">–</span>') + '</div>' + (f.value ? '<button type="button" class="btn small" data-copy="' + i + '">Kopiér</button>' : '') + '</div>'; }).join('') +
      '<div class="actions"><button type="button" class="btn" data-cancel>Luk</button></div>';
    BA.modal('Kopiér til AutoDesktop', html, function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      var done = function (ok, what) { BA.toast(ok ? what + ' er kopieret.' : 'Kunne ikke kopiere. Mærk teksten og kopiér selv.'); };
      $('[data-copyall]', box).onclick = function () { U.copy(BA.adAll(car, BA.S.items)).then(function (ok) { done(ok, 'Alt'); }); };
      U.$$('[data-copy]', box).forEach(function (b) { b.onclick = function () { var f = fields[+b.getAttribute('data-copy')]; U.copy(f.value).then(function (ok) { done(ok, f.label); }); }; });
    });
  }

  function pickFiles(accept, multiple, cb, capture) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple; inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    if (capture) inp.setAttribute('capture', 'environment');
    document.body.appendChild(inp);
    inp.onchange = function () { var files = Array.prototype.slice.call(inp.files || []); inp.remove(); if (files.length) cb(files); };
    inp.click();
    // Fjern inputtet igen, hvis dialogen blev lukket uden valg.
    setTimeout(function () { if (inp.isConnected && !(inp.files && inp.files.length)) { window.addEventListener('focus', function once() { window.removeEventListener('focus', once); setTimeout(function () { if (inp.isConnected && !(inp.files && inp.files.length)) inp.remove(); }, 1500); }); } }, 0);
  }

  // ----- billedvisning -----
  function openLightbox(list, index, opts) {
    opts = opts || {};
    var i = Math.max(0, index), el = document.createElement('div');
    el.className = 'lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Billedvisning');
    document.body.appendChild(el);
    var closed = false, blobUrl = '';
    function close() { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); if (blobUrl) URL.revokeObjectURL(blobUrl); el.remove(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    }
    document.addEventListener('keydown', onKey, true);
    function go(d) { var n = i + d; if (n < 0 || n >= list.length) return; i = n; show(); }
    function show() {
      var p = list[i], car = BA.store.car(opts.carId);
      if (!p) { close(); return; }
      var isCover = car && car.cover === p.id;
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
      el.innerHTML = '<div class="bar"><div>' + esc(p.name) + ' <span class="muted">(' + (i + 1) + '/' + list.length + ')</span></div><div class="row">' +
        (p.kind === 'photo' && !p.parent && car ? '<button type="button" class="btn small" data-lb="cover"' + (isCover ? ' disabled' : '') + '>' + (isCover ? 'Er forsidebillede' : 'Brug som forside') + '</button>' : '') +
        '<button type="button" class="btn small" data-lb="dl">Hent</button><button type="button" class="btn small danger" data-lb="del">Slet</button><button type="button" class="btn small" data-lb="close">Luk ✕</button></div></div>' +
        '<div class="stage" id="lb-stage"><span class="spin"></span></div>' + (list.length > 1 ? '<button type="button" class="nav-btn l" data-lb="prev" aria-label="Forrige">‹</button><button type="button" class="nav-btn r" data-lb="next" aria-label="Næste">›</button>' : '') +
        '<div class="cap" id="lb-cap"></div>';
      var stage = $('#lb-stage', el), idNow = p.id;
      var fail = function (m) { if (list[i] && list[i].id === idNow) { stage.innerHTML = '<div class="muted" style="padding:20px;text-align:center">' + esc(m) + '</div>'; } };
      if (p.kind === 'video') {
        BA.img.file(p.id).then(function (f) { if (list[i].id !== idNow || closed) return; blobUrl = URL.createObjectURL(f.blob); stage.innerHTML = '<video controls playsinline src="' + blobUrl + '"></video>'; }, function (er) { fail(er.message); });
      } else {
        BA.img.full(p.id).then(function (url) {
          if (list[i].id !== idNow || closed) return;
          stage.innerHTML = '<img alt="' + esc(p.name) + '" src="' + url + '">';
          if (p.needsConvert) $('#lb-cap', el).textContent = 'Dette er en HEIC-fil, der ikke kunne laves om til JPG. Du ser en forhåndsvisning fra Drive.';
        }, function (er) { fail(er.message); });
      }
    }
    el.onclick = function (e) {
      var b = e.target.closest('[data-lb]'); if (!b) return;
      var a = b.getAttribute('data-lb'), p = list[i];
      if (a === 'close') close();
      else if (a === 'prev') go(-1); else if (a === 'next') go(1);
      else if (a === 'cover') { BA.store.updateCar(opts.carId, { cover: p.id }); BA.toast('Forsidebilledet er ændret.'); show(); }
      else if (a === 'dl') { BA.img.file(p.id).then(function (f) { U.download(f.name, f.blob); }, function (er) { BA.toast(er.message); }); }
      else if (a === 'del') {
        BA.confirm('Slet ' + (p.kind === 'video' ? 'video' : 'billede'), 'Er du sikker? Du kan fortryde lige efter.', 'Slet', true).then(function (yes) {
          if (!yes || closed) return;
          var copy = BA.store.deleteItem(p.id);
          if (copy) BA.toast('Slettet.', { action: 'Fortryd', onAction: function () { BA.store.restoreItem(copy); }, ms: 9000 });
          list.splice(i, 1);
          if (!list.length) close(); else { if (i >= list.length) i = list.length - 1; show(); }
        });
      }
    };
    var sx = null;
    el.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); }, { passive: true });
    show();
  }

  function runAct(el, root) {
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    var car = BA.store.car(page.id); if (!car) return;
    var item = id ? BA.store.item(id) : null;
    switch (act) {
      case 'step': setStatus(car, el.getAttribute('data-status')); break;
      case 'sell': openSale(car); break;
      case 'reopen': setStatus(car, 'Annonceret'); break;
      case 'adcopy': openAd(car); break;
      case 'eq-del': if (item) confirmDelete(item, 'udstyr'); break;
      case 'fix': if (item) BA.store.updateItem(item.id, { fixed: el.checked }); break;
      case 'def-edit': if (item) openItemForm('fejl', car, item); break;
      case 'def-del': if (item) confirmDelete(item, 'fejl'); break;
      case 'def-task': if (item) { BA.store.addItem(car.id, 'opgave', { text: item.text, fromDefect: item.id }); BA.toast('Opgaven er oprettet. Tilføj pris og timer ved at trykke ✎.'); } break;
      case 'def-media': if (item) pickFiles('image/*,video/mp4,video/quicktime', true, function (files) { BA.up.add(car.id, files, { parent: item.id }); }); break;
      case 'media': if (item) { var list = itemsOf(car, 'fil').filter(function (f) { return f.parent === el.getAttribute('data-defect'); }).sort(byCreated); openLightbox(list, list.indexOf(list.filter(function (f) { return f.id === id; })[0]), { carId: car.id }); } break;
      case 'task-done':
        if (!item) break;
        if (el.checked) {
          el.checked = false;
          BA.modal('Opgaven er lavet', '<p style="margin:0 0 10px">' + esc(item.text) + '</p><form novalidate><div class="grid2"><div class="field"><label for="td-p">Faktisk pris (kr)</label><input id="td-p" inputmode="decimal" value="' + esc(item.actPrice != null ? U.num(item.actPrice) : (item.expPrice != null ? U.num(item.expPrice) : '')) + '"></div>' +
            '<div class="field"><label for="td-h">Faktiske timer</label><input id="td-h" inputmode="decimal" value="' + esc(item.actHours != null ? U.num(item.actHours) : (item.expHours != null ? U.num(item.expHours) : '')) + '"></div></div><div class="errtxt" id="td-e"></div>' +
            '<div class="actions"><button type="button" class="btn" data-cancel>Annullér</button><button type="submit" class="btn primary">Gem som lavet</button></div></form>', function (box, close) {
            $('[data-cancel]', box).onclick = function () { close(); };
            $('form', box).onsubmit = function (e) {
              e.preventDefault();
              var p = $('#td-p', box).value.trim(), h = $('#td-h', box).value.trim(), pn = p === '' ? null : U.pnum(p), hn = h === '' ? null : U.pnum(h);
              if ((p !== '' && pn === null) || (h !== '' && (hn === null || hn < 0))) { $('#td-e', box).textContent = 'Skriv tal – eller lad feltet stå tomt.'; return; }
              BA.store.updateItem(item.id, { done: true, doneDate: U.today(), actPrice: pn, actHours: hn });
              close();
            };
          });
        } else BA.store.updateItem(item.id, { done: false });
        break;
      case 'task-edit': if (item) openItemForm('opgave', car, item); break;
      case 'task-new': openItemForm('opgave', car, null); break;
      case 'exp-new': openItemForm('udgift', car, null); break;
      case 'exp-edit': if (item) openItemForm('udgift', car, item); break;
      case 'time-new': openItemForm('time', car, null); break;
      case 'time-edit': if (item) openItemForm('time', car, item); break;
      case 'claim-new': openItemForm('reklamation', car, null); break;
      case 'claim-edit': if (item) openItemForm('reklamation', car, item); break;
      case 'photo-add': pickFiles('image/*,video/mp4,video/quicktime', true, function (files) { BA.up.add(car.id, files, {}); }); break;
      case 'photos-all': page.allPhotos = true; page.cache['s-photos'] = null; paint(root, car); break;
      case 'photo-open': { var ph = BA.photosOf(car.id); openLightbox(ph, ph.indexOf(ph.filter(function (f) { return f.id === id; })[0]), { carId: car.id }); break; }
      case 'zip': zipAll(car, el); break;
      case 'doc-add': pickFiles('application/pdf,image/*', true, function (files) { BA.up.add(car.id, files, { docKind: 'Andet' }); }); break;
      case 'doc-open': if (item) { BA.toast('Henter …'); BA.img.file(item.id).then(function (f) { var u = URL.createObjectURL(f.blob); var w = window.open(u, '_blank'); if (!w) U.download(f.name, f.blob); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); }, function (er) { BA.toast(er.message); }); } break;
      case 'doc-kind': if (item) BA.store.updateItem(item.id, { kind: el.value }); break;
      case 'doc-del': if (item) confirmDelete(item, 'papir'); break;
      case 'up-retry': BA.up.retry(id); break;
      case 'up-dismiss': BA.up.dismiss(id); break;
      case 'del-car':
        BA.confirm('Slet bilen', 'Slet ' + (car.reg || '') + ' ' + (car.model || '') + '? Bilen forsvinder fra listerne. Du kan fortryde lige efter.', 'Slet bilen', true).then(function (yes) {
          if (!yes) return;
          var carCopy = JSON.parse(JSON.stringify(car)), itemsCopy = JSON.parse(JSON.stringify(BA.store.itemsOf(car.id)));
          BA.store.deleteCar(car.id);
          BA.go(BA.isSold(car.status) ? '#/solgte' : '#/lager');
          BA.toast('Bilen er slettet.', { action: 'Fortryd', onAction: function () { BA.store.restoreCar(carCopy, itemsCopy); BA.go('#/bil/' + carCopy.id); }, ms: 12000 });
        });
        break;
    }
  }

  function zipAll(car, btn) {
    var photos = BA.photosOf(car.id);
    if (!photos.length) return;
    btn.disabled = true;
    BA.img.zipCar(car, photos, function (n, total) { BA.toast('Henter billede ' + n + ' af ' + total + ' …', { ms: 60000 }); }).then(function (blob) {
      btn.disabled = false;
      U.download((car.reg || 'bil') + '-billeder.zip', blob);
      BA.toast(blob.failed && blob.failed.length ? 'Hentet – men disse filer kunne ikke komme med: ' + blob.failed.slice(0, 4).join(', ') + (blob.failed.length > 4 ? ' m.fl.' : '') + '. Hent dem i Google Drive.' : 'Billederne er hentet.', { long: true });
    }, function (er) { btn.disabled = false; BA.toast('Kunne ikke hente alle billeder: ' + er.message, { long: true }); });
  }

  function bindPage(root) {
    if (root.__baBound) return;
    root.__baBound = true;
    root.addEventListener('click', function (e) {
      if (!page) return;
      var t = e.target.closest('[data-toggle]');
      if (t) { var k = t.getAttribute('data-toggle'); openFlags[k] = !openFlags[k]; if (k === 'log' && openFlags.log) loadLog(root); page.cache = {}; V.bilUpdate(root); return; }
      var el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      var tag = el.tagName;
      if (tag === 'SELECT' || (tag === 'INPUT' && el.type === 'checkbox')) return;   // håndteres af change
      runAct(el, root);
    });
    root.addEventListener('keydown', function (e) {
      if (!page) return;
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-act], [data-toggle]')) { e.preventDefault(); e.target.click(); }
    });
    root.addEventListener('change', function (e) {
      if (!page) return;
      var el = e.target;
      if (el.matches('[data-f]')) { saveField(el, root); return; }
      if (el.matches('select[data-act], input[type=checkbox][data-act]')) runAct(el, root);
    });
    root.addEventListener('submit', function (e) {
      if (!page) return;
      var form = e.target.closest('form[data-add]'); if (!form) return;
      e.preventDefault();
      var t = form.elements.t.value.trim().replace(/\s+/g, ' ');
      if (!t) return;
      var type = form.getAttribute('data-add'), car = BA.store.car(page.id);
      if (!car) return;
      if (type === 'udstyr') {
        if (itemsOf(car, 'udstyr').some(function (x) { return x.name.toLowerCase() === t.toLowerCase(); })) { BA.toast('Det udstyr er der allerede.'); form.elements.t.value = ''; return; }
        BA.store.addItem(car.id, 'udstyr', { name: t, source: 'egen' });
      } else if (type === 'fejl') BA.store.addItem(car.id, 'fejl', { text: t });
      else if (type === 'opgave') BA.store.addItem(car.id, 'opgave', { text: t });
      form.elements.t.value = '';
      form.elements.t.focus();
    });
    root.addEventListener('focusout', function () { setTimeout(function () { if (page && page.dirty && !BA.focusInside(root)) V.bilUpdate(root); }, 80); });
  }
  // En ændring blev afvist: tegn alt om efter serverens værdier (også felter, der ellers ville vise den ikke-gemte værdi).
  BA.on('rollback', function () { if (page && page.root && page.root.isConnected) { page.cache = {}; V.bilUpdate(page.root); } });
  BA.on('uploads', function () { if (page && page.root && page.root.isConnected) V.bilUpdate(page.root); });

  function loadLog(root) {
    var id = page.id;
    A.call('getLog', { carId: id, limit: 60 }).then(function (res) { logCache[id] = { log: res.log }; if (page && page.id === id) { page.cache = {}; V.bilUpdate(root); } },
      function (er) { logCache[id] = { err: er.message, log: [] }; if (page && page.id === id) { page.cache = {}; V.bilUpdate(root); } });
  }
  BA.on('data', function () { /* logCache nulstilles ved næste åbning af aktivitet */ });
  BA.clearLogCache = function () { logCache = {}; };
})();
