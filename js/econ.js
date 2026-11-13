/* Overblik og økonomi (Fase 3): samme regler som "Overblik" i det gamle Bilarkiv (monthStat, soldStats, renderOverview).
 * Ren logik uden skærm. Tallene for en enkelt bil kommer fra BA.calc (util.js), så bilsiden og overblikket altid er enige.
 *
 * BA.econ.compute(ctx, today)  ctx = { cars, items, st }  ->  alt til siden Overblik
 * BA.econ.monthStat(ctx, key)  ->  { key, bought, n, rev, at, cl, cur, h, one, sub, result, ph, missing }
 * BA.econ.yearStats(ctx, year, today) -> opgørelse for et år ('alle' = alle år)
 * BA.econ.xlsx(sheets)         -> Blob (.xlsx, lavet uden eksterne biblioteker). sheets = [{ name, rows: [[celle, …], …], header: true }]
 */
(function () {
  'use strict';
  var BA = window.BA = window.BA || {};
  var U = BA.u;
  var FREQ = { 'Månedlig': 1, 'Kvartalsvis': 3, 'Halvårlig': 6, 'Årlig': 12 };
  var MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

  function mIdx(iso) { var m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? (+m[1]) * 12 + (+m[2] - 1) : NaN; }
  function mKey(i) { var y = Math.floor(i / 12), m = i % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function monthName(key) { var p = key.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function num(v) { var n = U.pnum(v); return n == null ? 0 : n; }

  /** En fast udgift (abonnement) i en bestemt måned (månedsindeks). */
  function subCharge(s, mi) {
    var a = U.pnum(s.amount);
    if (a == null || !s.start) return 0;
    var st = mIdx(s.start), en = s.end ? mIdx(s.end) : Infinity, iv = FREQ[s.freq] || 1;
    if (isNaN(st) || mi < st || mi > en) return 0;
    return (mi - st) % iv === 0 ? a : 0;
  }
  /** Månedlig pris for en fast udgift (til visning af "pr. måned"). Ophørte giver 0. */
  function subMonthly(s, today) {
    var a = U.pnum(s.amount);
    if (a == null || !s.start) return 0;
    if (s.end && s.end < today) return 0;
    return a / (FREQ[s.freq] || 1);
  }

  function carCalcs(ctx) {
    if (ctx.__calc) return ctx.__calc;
    var m = {};
    ctx.cars.forEach(function (c) { m[c.id] = BA.calc(c, ctx.items, ctx.st); });
    ctx.__calc = m;
    return m;
  }

  function monthStat(ctx, key) {
    var mi = mIdx(key + '-01'), calcs = carCalcs(ctx);
    var o = { key: key, bought: 0, n: 0, rev: 0, at: 0, cl: 0, cur: 0, h: 0, one: 0, sub: 0 };
    ctx.cars.forEach(function (c) {
      if (c.boughtDate && c.boughtDate.slice(0, 7) === key) o.bought++;
      if (BA.isSold(c.status) && c.soldDate && c.soldDate.slice(0, 7) === key) {
        var r = calcs[c.id];
        o.n++; o.rev += num(c.soldPrice); o.at += r.atSale || 0; o.cl += r.claims; o.cur += r.current || 0; o.h += r.hrs;
      }
    });
    ctx.items.forEach(function (it) {
      if (it.deleted) return;
      if (it.type === 'enkeltudgift' && it.date && it.date.slice(0, 7) === key) o.one += num(it.amount);
      if (it.type === 'abonnement') o.sub += subCharge(it, mi);
    });
    o.result = o.cur - o.one - o.sub;
    o.ph = o.h ? o.cur / o.h : null;
    o.missing = Math.max(0, num(ctx.st.monthGoal) - o.result);
    return o;
  }

  /** Måneder fra nu og tilbage (nyeste først): mindst 12, højst maxBack+1, men helt tilbage til den første dato i arkivet. */
  function monthRange(ctx, today, maxBack) {
    var now = mIdx(today), first = now - 11;
    var ds = [];
    ctx.cars.forEach(function (c) { if (c.boughtDate) ds.push(c.boughtDate); if (c.soldDate) ds.push(c.soldDate); });
    ctx.items.forEach(function (x) { if (!x.deleted && x.type === 'enkeltudgift' && x.date) ds.push(x.date); });
    ds.forEach(function (d) { var i = mIdx(d); if (!isNaN(i)) first = Math.min(first, i); });
    first = Math.max(first, now - (maxBack || 35));
    var out = [];
    for (var i = now; i >= first; i--) out.push(mKey(i));
    return out;
  }

  function compute(ctx, today) {
    ctx.items = (ctx.items || []).filter(function (i) { return !i.deleted; });
    ctx.cars = ctx.cars || [];
    var st = ctx.st, calcs = carCalcs(ctx);
    var stock = ctx.cars.filter(function (c) { return !BA.isSold(c.status); });
    var sold = ctx.cars.filter(function (c) { return BA.isSold(c.status) && c.soldDate; });
    var tied = 0, old = 0;
    stock.forEach(function (c) { var r = calcs[c.id]; tied += r.cost; if (r.days != null && r.days >= num(st.stockDays)) old++; });
    var totCur = 0, totH = 0, totCl = 0, dayN = 0, dayS = 0, withClaims = 0;
    sold.forEach(function (c) { var r = calcs[c.id]; totCur += r.current || 0; totH += r.hrs; totCl += r.claims; if (r.claims) withClaims++; if (r.days != null) { dayS += r.days; dayN++; } });
    var months = monthRange(ctx, today, 23);
    var cur = monthStat(ctx, months[0]);
    var ch = {};
    sold.forEach(function (c) { var r = calcs[c.id], v = c.soldVia || 'Ikke angivet'; ch[v] = ch[v] || { n: 0, cur: 0, d: 0 }; ch[v].n++; ch[v].cur += r.current || 0; ch[v].d += r.days || 0; });
    var goal = num(st.monthGoal);
    return { stock: stock, sold: sold, tied: tied, old: old, totCur: totCur, totH: totH, totCl: totCl, withClaims: withClaims, avgDays: dayN ? dayS / dayN : null,
      months: months, cur: cur, goalPct: goal ? Math.max(0, Math.min(1, cur.result / goal)) : 0, channels: ch, calcs: calcs };
  }

  var REP = /repar|klarg/i;
  /** Opgørelse for et år (som "Opgørelse" i det gamle program): brugtmoms, udgifter før salg, reklamationer. year = '2026' eller 'alle'. */
  function yearStats(ctx, year, today) {
    var all = year === 'alle', calcs = carCalcs(ctx), st = ctx.st;
    var sold = ctx.cars.filter(function (c) { return BA.isSold(c.status) && c.soldDate && (all || c.soldDate.slice(0, 4) === year); });
    var o = { n: sold.length, vat: 0, vatBack: 0, noPrice: 0, exp: 0, rep: 0, cat: {}, claimN: 0, claimCars: 0, claimSum: 0, discN: 0, discSum: 0, types: {}, noCat: 0, stockVat: 0, stockN: 0 };
    var byCar = {};
    ctx.items.forEach(function (i) { (byCar[i.carId] = byCar[i.carId] || []).push(i); });
    sold.forEach(function (c) {
      var r = calcs[c.id];
      if (r.sold) { o.vat += r.vat || 0; o.vatBack += r.vatBack || 0; } else o.noPrice++;
      var mine = byCar[c.id] || [];
      mine.filter(function (x) { return x.type === 'udgift'; }).forEach(function (x) {
        var a = num(x.amount), raw = String(x.cat || '').trim(), k = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Uden kategori';
        if (!raw && a) o.noCat++;
        var g = o.cat[k] = o.cat[k] || { sum: 0, cars: {} };
        g.sum += a; g.cars[c.id] = 1; o.exp += a; if (REP.test(k)) o.rep += a;
      });
      var cl = mine.filter(function (x) { return x.type === 'reklamation' && (x.desc || x.fix || U.pnum(x.amount) != null); });
      if (cl.length) { o.claimCars++; o.claimN += cl.length; o.claimSum += U.sum(cl, 'amount'); }
      cl.forEach(function (x) {
        var a = num(x.amount), t = x.ctype || 'Ikke angivet', g = o.types[t] = o.types[t] || { n: 0, sum: 0 };
        g.n++; g.sum += a;
        if (x.kind === 'Afslag i pris') { o.discN++; o.discSum += a; }
      });
    });
    ctx.cars.filter(function (c) { return !BA.isSold(c.status); }).forEach(function (c) { var r = calcs[c.id]; if (r.expVat != null) { o.stockVat += r.expVat; o.stockN++; } });
    return o;
  }

  // ---------------------------------------------------------------------------
  // Excel (.xlsx uden eksterne biblioteker: en zip med nogle få XML-filer)
  // ---------------------------------------------------------------------------
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(rows, header) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    rows.forEach(function (row, r) {
      out.push('<row r="' + (r + 1) + '">');
      row.forEach(function (v, c) {
        if (v === null || v === undefined || v === '') return;
        var ref = colName(c) + (r + 1), s = header && r === 0 ? ' s="1"' : '';
        if (typeof v === 'number' && isFinite(v)) out.push('<c r="' + ref + '"' + s + '><v>' + v + '</v></c>');
        else out.push('<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
      });
      out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
  }
  /** Fanenavne i Excel: højst 31 tegn, uden : \ / ? * [ ] */
  function sheetName(n, used) {
    var s = String(n || 'Ark').replace(/[:\\\/?*\[\]]/g, ' ').trim().slice(0, 31) || 'Ark', base = s, k = 2;
    while (used[s.toLowerCase()]) { s = base.slice(0, 28) + ' ' + k++; }
    used[s.toLowerCase()] = 1;
    return s;
  }
  function xlsxFiles(sheets) {
    var enc = new TextEncoder(), used = {}, names = sheets.map(function (s) { return sheetName(s.name, used); });
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>';
    files.push({ name: '[Content_Types].xml', bytes: enc.encode(ct) });
    files.push({ name: '_rels/.rels', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: 'xl/workbook.xml', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) { return '<sheet name="' + xmlEsc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>') });
    files.push({ name: 'xl/_rels/workbook.xml.rels', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') });
    files.push({ name: 'xl/styles.xml', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>') });
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', bytes: enc.encode(sheetXml(s.rows, s.header !== false)) }); });
    return files;
  }
  function xlsx(sheets) {
    var blob = BA.img.zip(xlsxFiles(sheets));
    return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /** Rækkerne til Excel: solgte biler, biler på lager og måneder. Tal er ægte tal (ingen formatering), datoer som dd-mm-åååå. */
  function carRows(ctx) {
    var calcs = carCalcs(ctx);
    var sold = [['Reg.nr.', 'Bil', 'Købt', 'Solgt', 'Købspris', 'Udgifter før salg', 'Salgspris', 'Avance før brugtmoms', 'Brugtmoms', 'Reklamationer', 'Aktuel avance', 'Timer', 'Kr. pr. time', 'Dage på lager', 'Solgt via']];
    ctx.cars.filter(function (c) { return BA.isSold(c.status) && c.soldDate; }).sort(function (a, b) { return String(b.soldDate).localeCompare(String(a.soldDate)); }).forEach(function (c) {
      var r = calcs[c.id];
      sold.push([c.reg, c.model, U.fmtDate(c.boughtDate), U.fmtDate(c.soldDate), r.buy, r.exp, num(c.soldPrice), r.gross == null ? '' : r.gross, r.vat == null ? '' : r.vat, r.claims, r.current == null ? '' : r.current, r.hrs, r.perHour == null ? '' : r.perHour, r.days == null ? '' : r.days, c.soldVia]);
    });
    var stock = [['Reg.nr.', 'Bil', 'Status', 'Købt', 'Købspris', 'Udgifter', 'Kostpris', 'Annonceret pris', 'Forventet avance efter brugtmoms', 'Dage på lager']];
    ctx.cars.filter(function (c) { return !BA.isSold(c.status); }).forEach(function (c) {
      var r = calcs[c.id];
      stock.push([c.reg, c.model, c.status, U.fmtDate(c.boughtDate), r.buy, r.exp, r.cost, num(c.listPrice), r.expected == null ? '' : r.expected, r.days == null ? '' : r.days]);
    });
    return { sold: sold, stock: stock };
  }
  function monthRows(ctx, keys) {
    var rows = [['Måned', 'Købt', 'Solgt', 'Omsætning', 'Avance biler', 'Enkeltudgifter', 'Abonnementer', 'Resultat', 'Timer', 'Kr. pr. time']];
    keys.forEach(function (k) { var o = monthStat(ctx, k); rows.push([monthName(k), o.bought, o.n, o.rev, o.cur, o.one, o.sub, o.result, o.h, o.ph == null ? '' : o.ph]); });
    return rows;
  }
  /** Én måned som Excel: solgte biler i måneden + udgifter (enkeltudgifter og abonnementer). */
  function monthSheets(ctx, key) {
    var calcs = carCalcs(ctx), mi = mIdx(key + '-01');
    var cars = [['Reg.nr.', 'Bil', 'Solgt', 'Salgspris', 'Aktuel avance', 'Timer']];
    ctx.cars.filter(function (c) { return BA.isSold(c.status) && c.soldDate && c.soldDate.slice(0, 7) === key; }).forEach(function (c) { var r = calcs[c.id]; cars.push([c.reg, c.model, U.fmtDate(c.soldDate), num(c.soldPrice), r.current == null ? '' : r.current, r.hrs]); });
    var exp = [['Dato', 'Hvad', 'Kategori', 'Beløb']];
    ctx.items.forEach(function (x) { if (x.type === 'enkeltudgift' && x.date && x.date.slice(0, 7) === key) exp.push([U.fmtDate(x.date), x.desc, x.cat, num(x.amount)]); });
    ctx.items.forEach(function (x) { if (x.type === 'abonnement') { var a = subCharge(x, mi); if (a) exp.push(['', x.name + ' (' + (x.freq || '') + ')', x.cat, a]); } });
    return [{ name: 'Solgte i ' + monthName(key), rows: cars }, { name: 'Udgifter', rows: exp }, { name: 'Resultat', rows: monthRows(ctx, [key]) }];
  }

  BA.econ = { FREQ: FREQ, MONTHS: MONTHS, mIdx: mIdx, mKey: mKey, monthName: monthName, subCharge: subCharge, subMonthly: subMonthly, monthStat: monthStat, monthRange: monthRange, compute: compute,
    yearStats: yearStats, xlsx: xlsx, xlsxFiles: xlsxFiles, carRows: carRows, monthRows: monthRows, monthSheets: monthSheets, colName: colName };
})();
