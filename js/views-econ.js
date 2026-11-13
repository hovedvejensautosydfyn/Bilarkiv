/* Siden Overblik (Fase 3): resultat denne måned, lager, kr. pr. time, tabel pr. måned, pr. salgskanal, årsopgørelse, faste udgifter og Hent Excel. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;
  var V = BA.views = BA.views || {};
  var E = function () { return BA.econ; };
  var yearSel = '';

  function kpi(label, value, sub, cls) {
    return '<div class="kpi"><div class="l">' + esc(label) + '</div><div class="v ' + (cls || '') + '">' + value + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }
  function cls(n, good) { return n == null ? '' : n < 0 ? 'neg' : (good ? 'pos' : ''); }

  function monthTable(e, st) {
    var ctx = ctxNow();
    return '<div class="tblwrap"><table class="lines tbl"><thead><tr><th>Måned</th><th class="r">Købt</th><th class="r">Solgt</th><th class="r">Omsætning</th><th class="r">Avance biler</th><th class="r">Enkeltudg.</th><th class="r">Abonn.</th><th class="r">Resultat</th><th class="r">Timer</th><th class="r">Kr./time</th><th></th></tr></thead><tbody>' +
      e.months.map(function (m, i) {
        var o = E().monthStat(ctx, m), p = m.split('-');
        return '<tr' + (i === 0 ? ' class="cur"' : '') + '><td>' + esc(E().MONTHS[+p[1] - 1] + ' ' + p[0]) + '</td><td class="r">' + (o.bought || '–') + '</td><td class="r">' + (o.n || '–') + '</td><td class="r">' + (o.n ? U.kr(o.rev) : '–') + '</td>' +
          '<td class="r ' + (o.cur < 0 ? 'neg' : '') + '">' + (o.n ? U.kr(o.cur) : '–') + '</td><td class="r">' + (o.one ? U.kr(o.one) : '–') + '</td><td class="r">' + (o.sub ? U.kr(o.sub) : '–') + '</td>' +
          '<td class="r ' + (o.result < 0 ? 'neg' : o.result >= st.monthGoal ? 'pos' : '') + '"><b>' + U.kr(o.result) + '</b></td><td class="r">' + (o.h ? U.num(o.h) : '–') + '</td>' +
          '<td class="r ' + (o.ph == null ? '' : o.ph < st.hourGoal ? 'neg' : 'pos') + '">' + (o.ph == null ? '–' : U.kr(o.ph)) + '</td><td><button type="button" class="btn small" data-xlm="' + esc(m) + '" aria-label="Hent ' + esc(E().monthName(m)) + ' som Excel">Excel</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function ctxNow() { return { cars: BA.S.cars, items: BA.S.items.filter(function (i) { return !i.deleted; }), st: BA.S.settings }; }

  function yearBlock(ctx, today) {
    var thisY = today.slice(0, 4), years = {}; years[thisY] = 1;
    ctx.cars.forEach(function (c) { if (BA.isSold(c.status) && c.soldDate) years[c.soldDate.slice(0, 4)] = 1; });
    var list = Object.keys(years).sort().reverse();
    var y = yearSel && (yearSel === 'alle' || years[yearSel]) ? yearSel : thisY;
    var o = E().yearStats(ctx, y, today), st = ctx.st;
    var per = y === 'alle' ? 'i alt' : 'i ' + y, avg = function (v) { return o.n ? U.kr(v / o.n) : '–'; };
    var h = '<div class="card"><div class="hd"><h2>Opgørelse ' + esc(per) + '</h2><label class="muted small">Periode <select id="ov-year" style="width:auto;min-height:36px;padding:4px 8px">' +
      BA.options(list.map(function (v) { return { value: v, label: v }; }).concat([{ value: 'alle', label: 'Alle år' }]), y) + '</select></label></div><div class="kpis">' +
      kpi('Brugtmoms ' + per, U.kr(o.vat), o.n + (o.n === 1 ? ' solgt bil' : ' solgte biler') + ' · ' + U.num(st.vat * 100) + ' % af (salgspris − købspris)' + (o.vatBack ? ' · −' + U.kr(o.vatBack) + ' pga. afslag' : '') + (o.noPrice ? ' · <span class="neg">' + o.noPrice + ' mangler salgspris</span>' : '')) +
      (y === thisY ? kpi('Hvis lageret sælges', U.kr(o.vat + o.stockVat), '+ ' + U.kr(o.stockVat) + ' i brugtmoms fra ' + o.stockN + (o.stockN === 1 ? ' lagerbil' : ' lagerbiler') + ' til annonceret pris') : '') +
      kpi('Udgifter før salg', U.kr(o.exp), 'Gns. ' + avg(o.exp) + ' pr. bil · heraf reparation og klargøring ' + U.kr(o.rep) + (o.noCat ? ' · <span class="neg">' + o.noCat + ' uden kategori</span>' : '')) +
      kpi('Reklamationer', o.claimN + ' stk.', U.kr(o.claimSum) + ' i alt · ' + o.claimCars + ' af ' + o.n + ' biler' + (o.discN ? ' · heraf ' + o.discN + ' afslag for ' + U.kr(o.discSum) : ''), o.claimSum ? 'neg' : '') + '</div>';
    var cats = Object.keys(o.cat).map(function (k) { return [k, o.cat[k]]; }).sort(function (a, b) { return b[1].sum - a[1].sum; });
    if (cats.length) h += '<details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Udgifter fordelt på kategori</summary><div class="tblwrap"><table class="lines"><thead><tr><th>Kategori</th><th class="r">Biler</th><th class="r">I alt</th><th class="r">Gns. pr. solgt bil</th></tr></thead><tbody>' +
      cats.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="r">' + Object.keys(c[1].cars).length + '</td><td class="r">' + U.kr(c[1].sum) + '</td><td class="r">' + avg(c[1].sum) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    var types = Object.keys(o.types).map(function (k) { return [k, o.types[k]]; }).sort(function (a, b) { return b[1].n - a[1].n || b[1].sum - a[1].sum; });
    if (types.length) h += '<details style="margin-top:8px"><summary class="muted small" style="cursor:pointer">Reklamationer fordelt på fejltype</summary><div class="tblwrap"><table class="lines"><thead><tr><th>Fejltype</th><th class="r">Antal</th><th class="r">I alt</th><th class="r">Gns.</th></tr></thead><tbody>' +
      types.map(function (t) { return '<tr><td>' + esc(t[0]) + '</td><td class="r">' + t[1].n + '</td><td class="r">' + U.kr(t[1].sum) + '</td><td class="r">' + U.kr(t[1].sum / t[1].n) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return h + '<p class="muted small" style="margin:10px 0 0">Brugtmomsen tæller i salgsåret. Et afslag i prisen sænker salgsprisen og dermed brugtmomsen – få det bekræftet af din revisor. Tallene er et overblik: momsangivelsen skal stemme med dit regnskab.</p></div>';
  }

  function fixedBlock(today) {
    var subs = BA.S.items.filter(function (i) { return i.type === 'abonnement' && !i.deleted; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'da'); });
    var ones = BA.S.items.filter(function (i) { return i.type === 'enkeltudgift' && !i.deleted; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 12);
    var perMonth = subs.reduce(function (s, x) { return s + E().subMonthly(x, today); }, 0);
    return '<div class="card"><div class="hd"><h2>Faste udgifter</h2><button type="button" class="btn small" data-fx-new="abonnement">+ Fast udgift</button></div>' +
      (subs.length ? '<table class="lines"><thead><tr><th>Hvad</th><th>Hvor ofte</th><th class="r">Beløb</th><th class="r">Pr. måned</th></tr></thead><tbody>' + subs.map(function (x) {
        var ended = x.end && x.end < today;
        return '<tr class="click" tabindex="0" data-fx-edit="' + esc(x.id) + '"' + (ended ? ' style="opacity:.55"' : '') + '><td>' + esc(x.name) + (x.cat ? '<div class="m muted small">' + esc(x.cat) + '</div>' : '') + (ended ? '<div class="m muted small">Ophørt ' + esc(U.fmtDate(x.end)) + '</div>' : '') + '</td><td>' + esc(x.freq) + '</td><td class="r">' + U.kr(x.amount) + '</td><td class="r">' + (ended ? '–' : U.kr(E().subMonthly(x, today))) + '</td></tr>';
      }).join('') + '<tr><td colspan="3"><b>Samlet pr. måned</b></td><td class="r"><b>' + U.kr(perMonth) + '</b></td></tr></tbody></table>' : '<p class="muted small" style="margin:0">Ingen faste udgifter endnu (fx abonnementer, forsikring, leje).</p>') +
      '<div class="hd" style="margin-top:16px"><h2>Enkeltudgifter</h2><button type="button" class="btn small" data-fx-new="enkeltudgift">+ Udgift</button></div>' +
      (ones.length ? '<table class="lines"><thead><tr><th>Dato</th><th>Hvad</th><th class="r">Beløb</th></tr></thead><tbody>' + ones.map(function (x) {
        return '<tr class="click" tabindex="0" data-fx-edit="' + esc(x.id) + '"><td>' + esc(U.fmtDate(x.date)) + '</td><td>' + esc(x.desc) + (x.cat ? '<div class="m muted small">' + esc(x.cat) + '</div>' : '') + '</td><td class="r">' + U.kr(x.amount) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted small" style="margin:0">Ingen enkeltudgifter endnu (udgifter, der ikke hører til en bestemt bil).</p>') + '</div>';
  }

  V.overblik = function (root) {
    var st = BA.S.settings, ctx = ctxNow(), today = U.today();
    if (!BA.S.loaded) { root.innerHTML = '<div class="skeleton"></div>'; return; }
    var e = E().compute(ctx, today);
    var h = '<h1 class="page">Overblik</h1>' + BA.offlineBanner() + '<div class="row" style="margin-bottom:12px"><button type="button" class="btn primary" id="ov-xlsx">Hent Excel</button><a class="btn" href="#/mere">Mål og regler</a></div>' +
      '<div class="kpis">' +
      kpi('Resultat denne måned', U.kr(e.cur.result), e.cur.n + ' solgt · efter faste udgifter · mål ' + U.kr(st.monthGoal) + '<div class="goalbar"><i style="width:' + (e.goalPct * 100).toFixed(1) + '%"></i></div>', e.cur.result < 0 ? 'neg' : '') +
      kpi('På lager', String(e.stock.length), U.kr(e.tied) + ' bundet i biler' + (e.old ? ' · <span class="neg">' + e.old + ' over ' + st.stockDays + ' dage</span>' : '')) +
      kpi('Solgt i alt', String(e.sold.length), 'Gns. ' + (e.avgDays == null ? '–' : U.num(e.avgDays)) + ' dage på lager') +
      kpi('Aktuel avance i alt', U.kr(e.totCur), 'Gns. ' + (e.sold.length ? U.kr(e.totCur / e.sold.length) : '–') + ' pr. bil', cls(e.totCur)) +
      kpi('Kr. pr. time', e.totH ? U.kr(e.totCur / e.totH) : '–', U.num(e.totH) + ' timer · mål ' + U.kr(st.hourGoal), e.totH ? (e.totCur / e.totH < st.hourGoal ? 'neg' : 'pos') : '') +
      kpi('Reklamationer', U.kr(e.totCl), e.withClaims + ' biler') + '</div>' +
      '<div class="card"><div class="hd"><h2>Pr. måned</h2><span class="muted small">Reklamationer tæller i salgsmåneden</span></div>' + monthTable(e, st) + '</div>';
    var ch = Object.keys(e.channels).map(function (k) { return [k, e.channels[k]]; }).sort(function (a, b) { return b[1].n - a[1].n; });
    h += '<div class="card"><div class="hd"><h2>Pr. salgskanal</h2></div>' + (ch.length ? '<table class="lines"><thead><tr><th>Kanal</th><th class="r">Solgt</th><th class="r">Gns. avance</th><th class="r">Gns. dage</th></tr></thead><tbody>' +
      ch.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="r">' + c[1].n + '</td><td class="r">' + U.kr(c[1].cur / c[1].n) + '</td><td class="r">' + U.num(c[1].d / c[1].n) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted small" style="margin:0">Vises, når du har solgt biler.</p>') + '</div>';
    h += yearBlock(ctx, today) + fixedBlock(today);
    root.innerHTML = h;
    bind(root);
  };

  function download(name, blob) { U.download(name, blob); }
  function bind(root) {
    $('#ov-xlsx', root).onclick = function () {
      var ctx = ctxNow(), today = U.today(), e = E().compute(ctx, today), rows = E().carRows(ctx);
      download('Bilarkiv-overblik-' + today + '.xlsx', E().xlsx([{ name: 'Pr. måned', rows: E().monthRows(ctx, e.months) }, { name: 'Solgte biler', rows: rows.sold }, { name: 'Biler på lager', rows: rows.stock }]));
      BA.toast('Excel-filen er hentet.');
    };
    U.$$('[data-xlm]', root).forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute('data-xlm'); download('Bilarkiv-' + k + '.xlsx', E().xlsx(E().monthSheets(ctxNow(), k))); BA.toast('Excel-filen er hentet.'); };
    });
    var ys = $('#ov-year', root); if (ys) ys.onchange = function () { yearSel = ys.value; V.overblik(root); };
    U.$$('[data-fx-new]', root).forEach(function (b) { b.onclick = function () { fixedForm(b.getAttribute('data-fx-new'), null); }; });
    U.$$('[data-fx-edit]', root).forEach(function (r) {
      var go = function () { var it = BA.store.item(r.getAttribute('data-fx-edit')); if (it) fixedForm(it.type, it); };
      r.onclick = go; r.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
    });
  }

  var FX = {
    abonnement: { title: 'fast udgift', fields: [['name', 'Hvad er det? (fx Forsikring, Annonce, Leje)', 'text', { req: 1, max: 120 }], ['cat', 'Kategori', 'text', { max: 60 }], ['amount', 'Beløb ex. moms (kr)', 'money', { req: 1 }],
      ['freq', 'Hvor ofte betaler du?', 'select', { options: ['Månedlig', 'Kvartalsvis', 'Halvårlig', 'Årlig'] }], ['start', 'Første betaling (dato)', 'date', { req: 1 }], ['end', 'Ophører (valgfri)', 'date']] },
    enkeltudgift: { title: 'enkeltudgift', fields: [['date', 'Dato', 'date', { req: 1 }], ['desc', 'Hvad er pengene brugt på?', 'text', { req: 1, max: 200 }], ['cat', 'Kategori', 'text', { max: 60 }], ['amount', 'Beløb ex. moms (kr)', 'money', { req: 1 }]] }
  };
  function fixedForm(type, item) {
    var spec = FX[type], cur = item || Object.assign(BA.itemDefaults(type), type === 'enkeltudgift' ? { date: U.today() } : { start: U.today() });
    var html = '<form novalidate>' + spec.fields.map(function (f) {
      var k = f[0], kind = f[2], o = f[3] || {}, id = 'fx-' + k, v = cur[k] == null ? '' : cur[k], inner;
      if (kind === 'select') inner = '<select id="' + id + '" data-k="' + k + '">' + BA.options(o.options, v) + '</select>';
      else if (kind === 'date') inner = '<input type="date" id="' + id + '" data-k="' + k + '" value="' + esc(v) + '">';
      else if (kind === 'money') inner = '<input id="' + id + '" data-k="' + k + '" inputmode="decimal" value="' + esc(cur[k] == null ? '' : U.num(cur[k])) + '" autocomplete="off">';
      else inner = '<input id="' + id + '" data-k="' + k + '" value="' + esc(v) + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + ' autocomplete="off">';
      return '<div class="field"><label for="' + id + '">' + esc(f[1]) + (o.req ? ' *' : '') + '</label>' + inner + '<div class="errtxt" data-err="' + k + '"></div></div>';
    }).join('') + '<div class="actions">' + (item ? '<button type="button" class="btn danger" data-del>Slet</button>' : '') + '<button type="button" class="btn" data-cancel>Annullér</button><button type="submit" class="btn primary">Gem</button></div></form>';
    BA.modal((item ? 'Ret ' : 'Ny ') + spec.title, html, function (box, close) {
      $('[data-cancel]', box).onclick = function () { close(); };
      var del = $('[data-del]', box);
      if (del) del.onclick = function () {
        close();
        BA.confirm('Slet ' + spec.title, 'Er du sikker? Du kan fortryde lige efter.', 'Slet', true).then(function (yes) {
          if (!yes) return;
          var copy = BA.store.deleteItem(item.id);
          if (copy) BA.toast('Slettet.', { action: 'Fortryd', onAction: function () { BA.store.restoreItem(copy); }, ms: 9000 });
        });
      };
      $('form', box).onsubmit = function (ev) {
        ev.preventDefault();
        var out = {}, bad = false;
        U.$$('.errtxt', box).forEach(function (x) { x.textContent = ''; });
        spec.fields.forEach(function (f) {
          var k = f[0], kind = f[2], o = f[3] || {}, el = $('[data-k=' + k + ']', box), v = el.value.trim();
          var err = function (m) { $('[data-err=' + k + ']', box).textContent = m; bad = true; };
          if (kind === 'money') { var n = v === '' ? null : U.pnum(v); if (v !== '' && n === null) return err('Skriv et tal.'); if (o.req && n === null) return err('Skriv et beløb.'); out[k] = n; return; }
          if (o.req && !v) return err('Det her felt skal udfyldes.');
          out[k] = kind === 'text' ? v.replace(/\s+/g, ' ') : v;
        });
        if (type === 'abonnement' && out.end && out.start && out.end < out.start) { $('[data-err=end]', box).textContent = 'Slutdatoen er før startdatoen.'; bad = true; }
        if (bad) return;
        if (item) BA.store.updateItem(item.id, out); else BA.store.addItem('', type, out);
        close();
      };
    });
  }

  BA.on('data', function () { /* siden tegnes om af main.js, når data ændres */ });
})();
