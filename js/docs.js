/* Dokumenter og tjeklister (Fase 3) – ÉN fil, brugt af både appen (BA.docs) og serveren (DOCS_ i Apps Script).
 *
 * Den er ren logik: ingen skærm, ingen Google. byg-deploy.ps1 lægger filen ind i deploy\Code.gs, så PDF'en, serveren laver,
 * er bygget af NØJAGTIG samme skabelon som forhåndsvisningen i appen.
 *
 * Skabelonerne (slutseddel, engros-slutseddel, fuldmagt, køreseddel) har samme tekst og felter som det gamle Bilarkiv-program.
 * Layoutet er lavet med tabeller og enkel CSS (ingen flex/grid), fordi Googles PDF-omdannelse (Blob.getAs('application/pdf')) kun forstår det enkle.
 * Det virker i Køreseddel-appen, som bruger samme metode. Underskrifter er små PNG-billeder som data-adresser.
 *
 * html(kind, vals)          -> hele dokumentet som HTML (al tekst fra felterne er lavet om til ufarlig tekst)
 * clean(kind, vals)         -> rensede værdier eller { error: '…' }
 * defaults(kind, car, st, items, today) -> startværdier fra bilen
 * LISTS                     -> tjeklisterne (gennemgang ved ankomst, klargøring)
 */
var DOCS_ = (function () {
  'use strict';

  var FIRM = { name: 'Hovedvejens Auto Sydfyn', cvr: '35913971', street: 'Hovedvejen 41', city: '5771 Stenstrup', phone: '22124493', email: 'info@h-auto.dk' };
  var KORE_PHONE = '60 99 25 85', PLATE = 'KR 23';
  var VAT_OPT = { brugt: 'Brugtmoms', alm: 'Alm. moms', fri: 'Momsfri' };
  var MAX_SIG = 120000;       // tegn i en underskrift (data-adresse) – små PNG'er er ca. 5-30 kB
  var MAX_SHORT = 200, MAX_AREA = 1500;

  // ---------------------------------------------------------------------------
  // Felter til hvert dokument: [nøgle, tekst, type, bredde]. type: text | date | area | vat. bredde 2 = hele rækken.
  // ---------------------------------------------------------------------------
  var VEH = [['reg', 'Reg.nr.'], ['vin', 'Stelnummer'], ['model', 'Mærke/model', 'text', 2], ['variant', 'Variant', 'text', 2], ['firstReg', '1. reg.'], ['km', 'Kilometer'], ['fuel', 'Brændstof']];
  var BUYER_PRIVATE = [['buyerName', 'Navn'], ['buyerAddress', 'Adresse'], ['buyerCity', 'Postnr./by'], ['buyerPhone', 'Tlf.'], ['buyerEmail', 'E-mail']];
  var BUYER_BIZ = [['buyerName', 'Firma'], ['buyerCvr', 'CVR'], ['buyerAddress', 'Adresse'], ['buyerContact', 'Kontakt'], ['buyerPhone', 'Tlf. / mail']];

  var SPECS = {
    slut: { label: 'Slutseddel', type: 'Slutseddel', groups: [
      ['Køretøj', VEH],
      ['Køber (kan også skrives i hånden)', BUYER_PRIVATE],
      ['Pris og betaling', [['price', 'Købspris (kr.)'], ['vat', 'Moms', 'vat'], ['delivery', 'Leveringsdato', 'date'], ['payment', 'Betaling']]],
      ['Byttebil (kan også skrives i hånden)', [['tradeReg', 'Reg.nr.'], ['tradeModel', 'Model'], ['tradeValue', 'Værdi (kr.)']]],
      ['Tilbehør og aftaler', [['accessories', 'Tilbehør', 'area'], ['agreements', 'Særlige aftaler / fejl og mangler', 'area']]],
      ['Underskrift', [['date', 'Dato', 'date'], ['sellerName', 'Sælgers navn']]]] },
    engros: { label: 'Engros-slutseddel', type: 'Slutseddel', groups: [
      ['Køretøj', VEH],
      ['Køber (forhandler)', BUYER_BIZ],
      ['Pris og betaling', [['price', 'Pris (kr.)'], ['vat', 'Moms', 'vat'], ['delivery', 'Leveringsdato', 'date'], ['payment', 'Betaling', 'text', 2]]],
      ['Aftaler', [['agreements', 'Særlige aftaler / kendte fejl og mangler', 'area']]],
      ['Underskrift', [['date', 'Dato', 'date'], ['sellerName', 'Sælgers navn']]]] },
    kore: { label: 'Køreseddel', type: 'Køreseddel', groups: [
      ['Bil og tidspunkt', [['model', 'Bilmærke og model', 'text', 2], ['reg', 'Reg.nr.'], ['vin', 'Stelnummer'], ['plate', 'Prøveskilt nr.'], ['date', 'Dato', 'date']]],
      ['Forhandler', [['sellerName', 'Dit navn']]]] },
    fuld: { label: 'Fuldmagt', type: 'Fuldmagt', groups: [
      ['Køretøj', [['reg', 'Reg.nr.'], ['vin', 'Stelnummer'], ['model', 'Mærke/model', 'text', 2], ['variant', 'Variant', 'text', 2], ['firstReg', '1. reg.']]],
      ['Forsikring (kan også skrives i hånden)', [['insurer', 'Forsikringsselskab'], ['policy', 'Police-/aftalenr.']]],
      ['Underskrift', [['date', 'Dato', 'date']]]] },
    bytte: { label: 'Købsaftale – byttebil', type: 'Byttebil-slutseddel', groups: [
      ['Sælger (kunden)', [['custName', 'Navn'], ['custAddress', 'Adresse'], ['custCity', 'Postnr./by'], ['custPhone', 'Tlf.'], ['custEmail', 'E-mail']]],
      ['Køretøj', VEH],
      ['Pris og betaling', [['price', 'Aftalt pris (kr.)'], ['payment', 'Betaling / modregning', 'text', 2], ['tradeAgainst', 'Modregnes i køb af bil (valgfri)', 'text', 2]]],
      ['Kendte fejl og aftaler', [['agreements', 'Fejl, mangler og aftaler', 'area']]],
      ['Underskrift', [['date', 'Dato', 'date'], ['sellerName', 'Købers navn (Hovedvejens Auto)']]]] }
  };
  var KINDS = ['slut', 'engros', 'fuld', 'kore', 'bytte'];
  var SIG_KEYS = ['sigCust', 'sigBuyer'];

  function fieldList(kind) {
    var out = [];
    (SPECS[kind] ? SPECS[kind].groups : []).forEach(function (g) { g[1].forEach(function (f) { out.push(f); }); });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Små hjælpere
  // ---------------------------------------------------------------------------
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nfmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pnum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s|kr\.?|km/gi, '').replace(/,[-–]+$/, '');   // "45.000,-" og "45.000 kr"
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function fmtDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s || ''); }
  function isoOk(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; }
  function sigOk(s) { return typeof s === 'string' && s.length <= MAX_SIG && /^data:image\/png;base64,[A-Za-z0-9+\/]{40,}={0,2}$/.test(s); }
  function safeName(t) { return String(t == null ? '' : t).replace(/[\\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  // ---------------------------------------------------------------------------
  /** 1. registrering som dd-mm-åååå (ISO-datoen vises ikke på papir), ellers årgangen. */
  function regDate(car) { return isoOk(car.firstReg) ? fmtDate(car.firstReg) : (car.firstReg || car.year || ''); }
  // Startværdier fra bilen
  // ---------------------------------------------------------------------------
  /** items: bilens poster (kun de ikke-slettede), bruges til at foreslå "kendte fejl". */
  function defaults(kind, car, st, items, today) {
    car = car || {}; st = st || {}; today = today || '';
    var price = pnum(car.soldPrice) != null ? pnum(car.soldPrice) : pnum(car.listPrice);
    var km = pnum(car.km);
    var seller = st.sellerName || '';
    var defects = (items || []).filter(function (i) { return i.type === 'fejl' && !i.fixed && !i.deleted; }).map(function (i) { return i.text; }).join('\n');   // kun fejl-teksten: den interne note er til Oliver og kommer ikke automatisk på kundens papir
    var name = [car.model, car.year].filter(Boolean).join(' ');
    if (kind === 'kore') return { model: name, reg: car.reg || '', vin: car.vin || '', plate: PLATE, date: today, sellerName: seller };
    if (kind === 'fuld') return { reg: car.reg || '', vin: car.vin || '', model: car.model || '', variant: car.variant || '', firstReg: regDate(car), insurer: '', policy: '', date: car.soldDate || today };
    var common = { reg: car.reg || '', vin: car.vin || '', model: car.model || '', variant: car.variant || '', firstReg: regDate(car), km: km == null ? '' : nfmt(km), fuel: car.fuel || '',
      price: price == null ? '' : nfmt(price), vat: 'brugt', delivery: car.soldDate || today, agreements: defects, date: car.soldDate || today, sellerName: seller,
      buyerName: car.buyer || '', buyerAddress: '', buyerCity: '', buyerPhone: car.buyerPhone || '', buyerEmail: '', buyerCvr: '', buyerContact: '' };
    if (kind === 'engros') return Object.assign(common, { payment: 'Bankoverførsel – bilen udleveres, når hele beløbet er modtaget' });
    if (kind === 'bytte') {
      return { custName: '', custAddress: '', custCity: '', custPhone: '', custEmail: '', reg: car.reg || '', vin: car.vin || '', model: car.model || '', variant: car.variant || '', firstReg: regDate(car),
        km: km == null ? '' : nfmt(km), fuel: car.fuel || '', price: '', payment: 'Bankoverførsel', tradeAgainst: '', agreements: '', date: today, sellerName: seller };
    }
    return Object.assign(common, { payment: 'Bankoverførsel', tradeReg: '', tradeModel: '', tradeValue: '', accessories: '' });
  }

  // ---------------------------------------------------------------------------
  // Rensning af det, brugeren har skrevet (bruges af serveren, og appen kan bruge den før afsendelse)
  // ---------------------------------------------------------------------------
  function clean(kind, vals) {
    if (!SPECS[kind]) return { error: 'Ukendt dokument.' };
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) return { error: 'Dokumentets oplysninger kan ikke læses.' };
    var out = {};
    var bad = '';
    fieldList(kind).forEach(function (f) {
      var k = f[0], type = f[2] || 'text';
      var v = vals[k];
      if (v == null) v = '';
      if (typeof v === 'number') v = String(v);
      if (typeof v !== 'string') { bad = bad || 'Feltet "' + f[1] + '" er ikke tekst.'; return; }
      v = v.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
      if (type === 'area') v = v.trim();
      else v = v.replace(/\s+/g, ' ').trim();
      if (type === 'date') { if (v && !isoOk(v)) { bad = bad || 'Datoen i "' + f[1] + '" er ikke gyldig.'; return; } }
      else if (type === 'vat') { if (!VAT_OPT[v]) v = 'brugt'; }
      else if (v.length > (type === 'area' ? MAX_AREA : MAX_SHORT)) { bad = bad || 'Feltet "' + f[1] + '" er for langt.'; return; }
      out[k] = v;
    });
    if (bad) return { error: bad };
    if (kind === 'bytte') {
      SIG_KEYS.forEach(function (k) {
        var v = vals[k];
        if (v == null || v === '') { out[k] = ''; return; }
        if (!sigOk(v)) { bad = bad || 'Underskriften kan ikke læses (den skal være et lille PNG-billede).'; return; }
        out[k] = v;
      });
      if (bad) return { error: bad };
    }
    return { vals: out };
  }

  /**
   * Felter, der kommer fra BILEN (bilen er sandheden, som i det gamle program): de gemmes ikke til næste dokument og hentes aldrig fra et gammelt dokument
   * eller en gammel kladde. Rettes bilens reg.nr., km eller pris, får det næste dokument de nye værdier.
   */
  var CAR_KEYS = ['reg', 'vin', 'model', 'variant', 'firstReg', 'km', 'fuel', 'price', 'delivery', 'date'];
  /** Det, der gemmes på bilen til næste gang: alt undtagen underskrifter og bilens egne felter. */
  function storable(vals) {
    var o = {};
    Object.keys(vals || {}).forEach(function (k) { if (SIG_KEYS.indexOf(k) < 0 && CAR_KEYS.indexOf(k) < 0) o[k] = vals[k]; });
    return o;
  }
  /**
   * Starter et dokument: bilens aktuelle værdier, oven på dem det, der blev husket (forrige dokument, kladde) – men IKKE bilens egne felter,
   * med den undtagelse, at brugeren selv har rettet et af dem i en kladde (draft.c = værdierne, formularen blev åbnet med).
   * remembered: { v, c } eller et almindeligt objekt (gammel kladde uden c).
   */
  function mergeRemembered(base, prevVals, draft) {
    var out = Object.assign({}, base);
    Object.keys(prevVals || {}).forEach(function (k) { if (CAR_KEYS.indexOf(k) < 0 && k in base) out[k] = prevVals[k]; });
    if (draft && typeof draft === 'object') {
      var dv = draft.v && typeof draft.v === 'object' ? draft.v : draft, dc = draft.v && draft.c && typeof draft.c === 'object' ? draft.c : null;
      Object.keys(dv).forEach(function (k) {
        if (!(k in base)) return;
        if (CAR_KEYS.indexOf(k) >= 0) { if (dc && k in dc && dv[k] !== dc[k]) out[k] = dv[k]; return; }   // bilens felter: kun hvis brugeren selv rettede dem i kladden
        out[k] = dv[k];
      });
    }
    return out;
  }

  function fileName(kind, vals, car, today) {
    var reg = String((vals && vals.reg) || (car && car.reg) || '').toUpperCase().replace(/\s/g, '');
    var date = (vals && vals.date) || today || '';
    var who = reg || (vals && vals.model) || (car && car.model) || '';
    var base = { slut: 'Slutseddel ', engros: 'Slutseddel engros ', fuld: 'Fuldmagt ', kore: 'Køreseddel ', bytte: 'Købsaftale byttebil ' }[kind] || 'Dokument ';
    return safeName(base + who + ' ' + date).slice(0, 100) + '.pdf';
  }

  // ---------------------------------------------------------------------------
  // HTML (tabeller + enkel CSS, så Googles PDF-omdannelse og browserens udskrift ser ens ud)
  // ---------------------------------------------------------------------------
  var CSS = 'body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;line-height:1.4;color:#1a1a1a;margin:0}' +
    'table{border-collapse:collapse;width:100%}td,th{vertical-align:top;text-align:left;padding:0}' +
    '.top td{border-bottom:1px solid #cccccc;padding:0 0 7px 0;vertical-align:middle}.top .co{text-align:right;font-size:8pt;color:#666666;line-height:1.5}.top .co b{color:#1a1a1a;font-size:8.5pt}.top .nm{font-size:15pt;font-weight:bold}' +
    '.title{text-align:center;margin:10px 0 8px}.cap{font-size:7pt;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#8a8a8a}' +
    'h1{font-family:Georgia,"Times New Roman",serif;font-size:25pt;line-height:1.1;margin:2px 0;font-weight:bold}h1.sm{font-size:19pt}.sub{font-size:9pt;color:#666666}' +
    '.card{border:1px solid #d4d4d4;padding:6px 10px 8px 10px;width:48.5%}.gap{width:3%}' +
    '.fl td{border-bottom:1px dotted #a8a8a8;padding:3px 2px 2px 2px;height:17px}.fl td.l{width:26%;color:#6d6d6d;font-size:8.3pt}.fl td.v{font-weight:bold}.fl.w td.l{width:12%}' +
    '.sec{margin-top:11px}.sec h2{font-size:10pt;font-weight:bold;margin:0 0 3px 0}.sec h2 .n{color:#C8102E}' +
    '.g2 td.h{width:48.5%}.g2 td.gp{width:3%}' +
    '.opt{margin-right:14px;font-weight:normal}' +
    'ol.terms{margin:0;padding-left:20px;font-size:8.4pt;color:#333333}ol.terms li{margin:0 0 3px 0}' +
    '.sigs{margin-top:22px}.sigs td{width:46%;vertical-align:bottom}.sigs td.gp{width:8%}.sigs .s{font-size:8pt;color:#666666;padding-top:3px}.sigs .s b{color:#1a1a1a}' +
    '.sig3 td{width:31%;vertical-align:bottom}.sig3 td.gp{width:3.5%}.sig3 .s{font-size:7.6pt;color:#666666;text-transform:uppercase;letter-spacing:1px;text-align:center;padding-top:3px}' +
    '.foot{margin-top:14px;padding-top:5px;border-top:1px solid #dddddd;font-size:7pt;color:#999999;text-align:center}' +
    '.note{font-size:8pt;color:#555555;margin:5px 0 0 0}' +
    '.law{border:1px solid #d4d4d4;padding:6px 10px;font-size:6.3pt;line-height:1.35;color:#444444;margin-top:12px}.law p{margin:0 0 4px 0}.law .cap{text-align:center;margin-bottom:4px}' +
    '.decl p{margin:0 0 10px 0;font-size:9.6pt;line-height:1.5}.info{border:1px solid #d4d4d4;padding:9px 14px;margin-top:6px;font-size:8.8pt}.info ul{margin:4px 0 6px 0;padding-left:16px}.info li{margin-bottom:2px}' +
    '.ln{width:100%}';

  // Faste mål direkte på billedet (inline, så Googles PDF også ser dem): en underskrift er 600x180 px og sprænger ellers siden.
  function sigImg(src) { return sigOk(src) ? '<img alt="" src="' + src + '" width="140" height="42" style="height:42px;width:auto;max-width:100%">' : ''; }

  function html(kind, v) {
    v = v || {};
    var spec = SPECS[kind];
    if (!spec) return '';
    var e = function (k) { return esc(v[k] == null ? '' : String(v[k]).trim()); };
    var multi = function (k) { return e(k).replace(/\n/g, '<br>'); };
    var date = function (k) { return v[k] ? esc(fmtDate(v[k])) : ''; };
    var money = function (k) { var n = pnum(v[k]); return n == null ? '' : nfmt(n) + ' kr.'; };
    var row = function (l, val, cls) { return '<tr><td class="l">' + l + '</td><td class="v' + (cls ? ' ' + cls : '') + '">' + (val || '') + '</td></tr>'; };
    var fl = function (rows, cls) { return '<table class="fl' + (cls ? ' ' + cls : '') + '">' + rows.join('') + '</table>'; };
    var two = function (a, b) { return '<table class="g2"><tr><td class="h">' + a + '</td><td class="gp"></td><td class="h">' + b + '</td></tr></table>'; };
    var cards = function (capA, a, capB, b) {
      return '<table><tr><td class="card"><div class="cap">' + capA + '</div>' + fl(a) + '</td><td class="gap"></td><td class="card"><div class="cap">' + capB + '</div>' + fl(b) + '</td></tr></table>';
    };
    var top = function (right) { return '<table class="top"><tr><td><span class="nm">' + esc(FIRM.name) + '</span></td><td class="co">' + right + '</td></tr></table>'; };
    var foot = '<div class="foot">' + esc(FIRM.name) + ' · ' + esc(FIRM.street) + ', ' + esc(FIRM.city) + ' · CVR ' + esc(FIRM.cvr) + ' · ' + esc(FIRM.email) + '</div>';
    var n = 0;
    var sec = function (t, body) { return '<div class="sec"><h2><span class="n">§ ' + (++n) + '</span> ' + t + '</h2>' + body + '</div>'; };
    // A4-margener (som det gamle program: ca. 9 mm øverst og 16 mm i siderne) lavet med en tabelcelle med padding: Googles PDF-omdannelse ignorerer @page og body-margen.
    var doc = function (pages) { return '<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><title>' + esc(spec.label) + '</title><style>' + CSS + '</style></head><body><table class="pgw"><tr><td style="padding:34px 60px 28px 60px">' + pages + '</td></tr></table></body></html>'; };
    // En underskrifts-/datolinje: en tabelcelle med kant (ikke en tom div), så den ikke forsvinder, hvis PDF-omdannelsen dropper CSS.
    var LN = function (inner, align) { return '<table class="ln"><tr><td style="border-bottom:1px solid #222222;height:38px;vertical-align:bottom;text-align:' + (align || 'center') + ';font-weight:bold">' + (inner || '&nbsp;') + '</td></tr></table>'; };
    var blank = function (n) { return new Array(n + 1).join('_'); };   // tekst, ikke en tom span med kant: Googles PDF kan droppe CSS
    var cityOnly = FIRM.city.replace(/^\d+\s*/, '');

    if (kind === 'kore') {
      var p1 = top('<b>' + esc(FIRM.name) + '</b><br>Fast prøveskilt: ' + esc(PLATE) + '<br>Nr. ' + blank(8)) +
        '<div class="title"><div class="cap">Prøvekørsel i anledning af salg</div><h1 class="sm">Erklæring om kørsel med prøveskilte</h1><div class="sub">Ved demonstration eller prøve i anledning af salg</div></div>' +
        cards('Undertegnede forhandler', [row('Firma', esc(FIRM.name)), row('Adresse', esc(FIRM.street)), row('Postnr./by', esc(FIRM.city)), row('CVR / tlf.', esc(FIRM.cvr + ' · ' + KORE_PHONE)), row('Ansat', e('sellerName'))],
          'Har med ligeledes undertegnede fører', [row('Navn', ''), row('Adresse', ''), row('Postnr./by', ''), row('Tlf.', ''), row('Kørekort nr.', '')]) +
        sec('Indgået aftale om demonstrationskørsel med',
          two(fl([row('Mærke/model', e('model')), row('Reg.nr.', e('reg')), row('Stelnummer', e('vin'))]), fl([row('Prøveskilt nr.', e('plate')), row('Dato', date('date')), row('Påbegyndes', 'kl.'), row('Afsluttes senest', 'kl.')])) +
          '<p class="note">Selvstændig prøvekørsel må højst vare 3 timer, og denne erklæring skal medbringes under kørslen. Under prøvekørslen er føreren ansvarlig over for forhandleren efter dansk rets almindelige erstatningsregler – også for skader på køretøjet. Føreren betaler selv bøder og afgifter, der opstår under kørslen.</p>' +
          '<table class="sig3"><tr><td>' + LN('') + '<div class="s">Førers underskrift</div></td><td class="gp"></td><td>' + LN(date('date')) + '<div class="s">Dato</div></td><td class="gp"></td><td>' + LN('') + '<div class="s">Underskrift for forhandler</div></td></tr></table>') +
        sec('Kørslen er afsluttet', '<div style="margin-top:6px">Kørslen er afsluttet kl. ____ : ____</div>' +
          '<table class="sig3"><tr><td>' + LN('') + '<div class="s">Førers underskrift</div></td><td class="gp"></td><td>' + LN('') + '<div class="s">Dato</div></td><td class="gp"></td><td>' + LN('') + '<div class="s">Underskrift for forhandler</div></td></tr></table>') +
        '<div class="law"><div class="cap">Uddrag af bekendtgørelse om registrering af køretøjer – kørsel med prøveskilte i anledning af salg</div>' +
        '<p>§ 78. SKAT kan udlevere nummerplader i form af prøveskilte til erhvervsdrivende fysiske eller juridiske personer, der vedvarende og i et ikke uvæsentligt omfang har brug for skiltene i deres erhverv til kørsel som nævnt i §§ 77-80.</p>' +
        '<p>§ 79. Prøveskilte bruges til kørsel med uregistreret køretøj af en type, der skal registreres efter kapitel 2. Stk. 2. Prøveskilte må kun bruges til midlertidig eller lejlighedsvis kørsel til følgende formål: … 7) Demonstration af et køretøj for en forhandler eller dennes personale. 8) Demonstration eller prøve af et køretøj i anledning af salg. Kørslen må kun finde sted efter forudgående anmodning i hvert enkelt tilfælde fra en eventuel køber af et køretøj af den pågældende type.</p>' +
        '<p>§ 81. Et prøveskilt må, med de undtagelser der følger af stk. 2 og 3, kun bruges af den, der har fået udleveret prøveskiltet efter § 78, og de hos denne ansatte. Stk. 2. Ved demonstrationskørsel som nævnt i § 79, stk. 2, nr. 7 og 8, med et køretøj, der ikke kan medføre passagerer, kan køretøjet med prøveskilte udlånes til forhandleren og dennes personale eller den interesserede køber, dennes pårørende og personer, der bistår køberen med at bedømme køretøjet, til afprøvning for et kortere tidsrum inden for den nærmeste omegn. ' +
        'Stk. 3. Ved demonstrationskørsel som nævnt i § 79, stk. 2, nr. 7 og 8, med et køretøj, der kan medføre passagerer, kan køretøjet føres af de personer, som er nævnt i stk. 2, hvis prøveskilteindehaveren eller en ansat hos denne befinder sig i køretøjet under kørslen. Køretøjet kan endvidere udlånes til selvstændig afprøvning eller demonstrationskørsel, hvis kørslens varighed ikke overstiger 3 timer, og der under kørslen medbringes dokumentation for, at udlånet ikke overstiger 3 timer. Dokumentationen skal ske på en blanket, der er godkendt af SKAT, medmindre SKAT har tilladt, at dokumentationen kan ske på en nærmere angiven digital måde. Indehaveren af retten til prøveskiltet skal opbevare dokumentationen i 3 måneder efter, at kørslen har fundet sted.</p>' +
        '<p>§ 83. SKAT kan udlevere et prøvemærke til en fysisk eller juridisk person til kørsel som nævnt i § 79, stk. 1, stk. 2, nr. 1-10, og stk. 3, § 80 og § 81, stk. 1.</p><p><i>Skatteministeriets bekendtgørelse nr. 599 af 31. maj 2017.</i></p></div>';
      var p2 = '<div style="page-break-before:always"></div>' + top('<b>' + esc(FIRM.name) + '</b><br>' + esc(FIRM.street) + ', ' + esc(FIRM.city) + '<br>CVR ' + esc(FIRM.cvr)) +
        '<div class="title"><div class="cap">Bilag til køreseddel</div><h1 class="sm">Tro- og loveerklæring om vanvidskørsel</h1><div class="sub">Ved prøvekørsel i anledning af salg · ' + e('model') + (e('reg') ? ' · ' + e('reg') : '') + '</div></div>' +
        '<div class="decl">' +
        '<p>Jeg erklærer på tro og love, at hverken jeg eller nogen, jeg måtte overlade køretøjet til, vil køre bilen på en måde, der er vanvidskørsel efter færdselsloven, og som giver politiet ret til at beslaglægge og konfiskere køretøjet.</p>' +
        '<p>Jeg erklærer på tro og love, at jeg ikke tidligere er straffet for vanvidskørsel eller grovere overtrædelser af færdselsloven – fx gentagne overtrædelser eller overtrædelser, der har ført til frakendelse af førerretten eller fængselsstraf.</p>' +
        '<p>Med min underskrift accepterer jeg at være fuldt erstatningsansvarlig over for ' + esc(FIRM.name) + ' for køretøjets værdi samt eventuelle følgeomkostninger, hvis køretøjet konfiskeres af politiet som følge af kørsel, mens det er overladt til mig. Jeg er orienteret om, at kravet med tillæg af renter vil blive inddrevet ved civilt søgsmål, hvis det ikke betales rettidigt.</p>' +
        '<p>Jeg erklærer på tro og love, at jeg i tilfælde af konfiskation har mulighed for at erstatte køretøjet – enten kontant eller ved en løbende afdragsordning.</p></div>' +
        '<div class="info"><b>Det regnes som vanvidskørsel</b> (færdselsloven § 133 a):<ul><li>Uagtsomt manddrab eller betydelig skade på andres krop eller helbred under særligt skærpende omstændigheder</li><li>Særlig hensynsløs kørsel</li><li>Hastighedsoverskridelse på mere end 100 % ved kørsel over 100 km/t</li><li>Kørsel med 200 km/t eller derover</li><li>Spirituskørsel med en promille over 2,00</li></ul>Bilen kan konfiskeres, selvom føreren ikke ejer den. Vanvidskørsel kan straffes med fængsel og fører som udgangspunkt til ubetinget frakendelse af førerretten i mindst 3 år.</div>' +
        '<div class="sec" style="margin-top:26px">' + fl([row('Førers navn', '')]) + '</div>' +
        '<table class="sigs"><tr><td>' + LN(date('date'), 'left') + '<div class="s">Dato</div></td><td class="gp"></td><td>' + LN('') + '<div class="s">Førers underskrift</div></td></tr></table>' + foot;
      return doc(p1 + p2);
    }

    if (kind === 'fuld') {
      return doc(top('<b>' + esc(FIRM.name) + '</b><br>' + esc(FIRM.street) + ', ' + esc(FIRM.city) + '<br>CVR ' + esc(FIRM.cvr) + ' · Tlf. ' + esc(FIRM.phone)) +
        '<div class="title"><div class="cap">Registrering af køretøj</div><h1>Fuldmagt</h1><div class="sub">Til registrering i Motorregistret (DMR) i forbindelse med køb</div></div>' +
        cards('Fuldmagtsgiver (køber og ejer)', [row('Navn', ''), row('CPR/CVR', ''), row('Adresse', ''), row('Postnr./by', ''), row('Tlf.', '')],
          'Fuldmagtshaver', [row('Firma', esc(FIRM.name)), row('CVR', esc(FIRM.cvr)), row('Adresse', esc(FIRM.street)), row('Postnr./by', esc(FIRM.city)), row('Tlf. / mail', esc(FIRM.phone + ' · ' + FIRM.email))]) +
        sec('Køretøjet', two(fl([row('Mærke/model', e('model')), row('Reg.nr.', e('reg')), row('Stelnr.', e('vin'))]), fl([row('Variant', e('variant')), row('1. reg.', e('firstReg'))]))) +
        sec('Fuldmagten', '<p class="decl" style="margin:0 0 6px 0;font-size:9.4pt">Undertegnede giver hermed ' + esc(FIRM.name) + ' (CVR ' + esc(FIRM.cvr) + ') fuldmagt til på mine vegne at registrere ovennævnte køretøj i Motorregistret, herunder at:</p>' +
          '<ol class="terms"><li>registrere køretøjet i mit navn som ejer og bruger, eller med den bruger, der er anført nedenfor</li><li>bestille, modtage og montere nummerplader til køretøjet</li><li>tilknytte den forsikring, der er anført nedenfor</li><li>betale de gebyrer og afgifter, der hører til registreringen, efter aftale med mig</li><li>underskrive og indsende de dokumenter, der er nødvendige for registreringen</li></ol>') +
        sec('Forsikring og bruger', two(fl([row('Selskab', e('insurer')), row('Police-nr.', e('policy'))]), fl([row('Bruger', ''), row('Brugers CPR', '')])) + '<p class="note">Udfyld kun bruger, hvis en anden end ejeren skal stå som bruger af køretøjet.</p>') +
        '<p class="note" style="margin-top:14px">Fuldmagten gælder kun registreringen af det køretøj, der er nævnt ovenfor, og bortfalder, når registreringen er gennemført. Fuldmagtsgiver bekræfter, at oplysningerne er korrekte. CPR-nummeret bruges kun til registreringen.</p>' +
        '<table class="sigs"><tr><td>' + LN('') + '<div class="s"><b>Fuldmagtsgiver</b> (køber)<br>' + esc(cityOnly) + ', ' + (date('date') || blank(14)) + '</div></td><td class="gp"></td><td>' + LN('') + '<div class="s"><b>Bruger</b> (kun hvis en anden end ejer)<br>Dato: ' + blank(14) + '</div></td></tr></table>' + foot);
    }

    if (kind === 'bytte') {
      var vehRows = [row('Mærke/model', e('model')), row('Reg.nr.', e('reg')), row('Stelnr.', e('vin'))];
      var vehRows2 = [row('Variant', e('variant')), row('1. reg.', e('firstReg')), row('Km', e('km') ? e('km') + (/^[\d.]+$/.test(e('km')) ? ' km' : '') : ''), row('Brændstof', e('fuel'))];
      var h = top('<b>' + esc(FIRM.name) + '</b><br>' + esc(FIRM.street) + ', ' + esc(FIRM.city) + '<br>CVR ' + esc(FIRM.cvr) + ' · Tlf. ' + esc(FIRM.phone)) +
        '<div class="title"><div class="cap">Købsaftale</div><h1>Slutseddel</h1><div class="sub">Køb af brugt bil fra privat (byttebil)</div></div>' +
        cards('Sælger (kunden)', [row('Navn', e('custName')), row('CPR/CVR', ''), row('Adresse', e('custAddress')), row('Postnr./by', e('custCity')), row('Tlf.', e('custPhone')), row('E-mail', e('custEmail'))],
          'Køber', [row('Firma', esc(FIRM.name)), row('CVR', esc(FIRM.cvr)), row('Adresse', esc(FIRM.street + ', ' + FIRM.city)), row('Tlf.', esc(FIRM.phone)), row('E-mail', esc(FIRM.email))]) +
        sec('Køretøjet', two(fl(vehRows), fl(vehRows2))) +
        sec('Pris og betaling', two(fl([row('Aftalt pris', money('price')), row('Betaling', e('payment'))]), fl([row('Modregnes i køb af', e('tradeAgainst')), row('Dato', date('date'))]))) +
        sec('Kendte fejl, mangler og aftaler', fl([row('', multi('agreements') || '&nbsp;', ''), row('', '&nbsp;')], 'w')) +
        sec('Vilkår', '<ol class="terms"><li>Sælger erklærer at være ejer af køretøjet og berettiget til at sælge det, at køretøjet ikke er pantsat, leaset eller har anden restgæld, og at det ikke er anmeldt stjålet.</li>' +
          '<li>Sælger har oplyst alle kendte fejl, mangler og skader på køretøjet (se ovenfor). Køretøjet er besigtiget af køber og overtages som beset.</li>' +
          '<li>Kilometertallet er oplyst af sælger og aflæst på bilens instrumentering ved overdragelsen.</li>' +
          '<li>Ejendomsretten og risikoen overgår til køber ved udlevering af køretøjet, nøgler og papirer. Aftalt pris betales eller modregnes som anført ovenfor.</li>' +
          '<li>Sælger sørger for at afmelde sin forsikring. Bøder, afgifter og udgifter, der stammer fra tiden før overdragelsen, betales af sælger.</li></ol><p class="note">Vilkårene er et udkast og skal læses igennem før brug.</p>') +
        '<table class="sigs"><tr><td>' + LN(sigImg(v.sigCust)) + '<div class="s"><b>Sælger</b> · ' + (e('custName') || '&nbsp;') + '<br>' + esc(cityOnly) + ', ' + (date('date') || blank(14)) + '</div></td><td class="gp"></td>' +
        '<td>' + LN(sigImg(v.sigBuyer)) + '<div class="s"><b>Køber</b> · ' + esc(FIRM.name) + (e('sellerName') ? ' v/ ' + e('sellerName') : '') + '<br>' + esc(cityOnly) + ', ' + (date('date') || blank(14)) + '</div></td></tr></table>' + foot;
      return doc(h);
    }

    // slutseddel og engros-slutseddel
    var eng = kind === 'engros', price = pnum(v.price), trade = pnum(v.tradeValue);
    var buyerRows = eng ? [row('Firma', e('buyerName')), row('CVR', e('buyerCvr')), row('Adresse', e('buyerAddress')), row('Kontakt', e('buyerContact')), row('Tlf. / mail', e('buyerPhone'))]
      : [row('Navn', e('buyerName')), row('Adresse', e('buyerAddress')), row('Postnr./by', e('buyerCity')), row('Tlf.', e('buyerPhone')), row('E-mail', e('buyerEmail'))];
    var hh = top('<b>' + esc(FIRM.name) + '</b><br>' + esc(FIRM.street) + ', ' + esc(FIRM.city) + '<br>CVR ' + esc(FIRM.cvr) + ' · Tlf. ' + esc(FIRM.phone)) +
      '<div class="title"><div class="cap">Købsaftale</div><h1>Slutseddel</h1><div class="sub">' + (eng ? 'Engrossalg – handel mellem erhvervsdrivende' : 'Køb af brugt bil') + '</div></div>';
    hh += cards('Sælger', [row('Firma', esc(FIRM.name)), row('CVR', esc(FIRM.cvr)), row('Adresse', esc(FIRM.street + ', ' + FIRM.city)), row('Tlf.', esc(FIRM.phone)), row('E-mail', esc(FIRM.email))], 'Køber' + (eng ? ' (forhandler)' : ''), buyerRows);
    hh += sec('Køretøjet', two(fl([row('Mærke/model', e('model')), row('Reg.nr.', e('reg')), row('Stelnr.', e('vin'))]),
      fl([row('Variant', e('variant')), row('1. reg.', e('firstReg')), row('Km', e('km') ? e('km') + (/^[\d.]+$/.test(e('km')) ? ' km' : '') : ''), row('Brændstof', e('fuel'))])));
    var vat = Object.keys(VAT_OPT).map(function (a) { return '<span class="opt">' + (v.vat === a ? '[X] ' : '[&nbsp;&nbsp;] ') + esc(VAT_OPT[a]) + '</span>'; }).join('');
    var priceRows = [row(eng ? 'Pris' : 'Købspris', money('price')), row('Moms', vat), row('Betaling', e('payment'))];
    var priceRows2 = [row('Levering', date('delivery'))];
    if (v.vat === 'alm' && price != null) { priceRows2.push(row('Heraf moms', nfmt(price * 0.2) + ' kr. (25 %)')); priceRows2.push(row('Ekskl. moms', nfmt(price * 0.8) + ' kr.')); }
    hh += sec(eng ? 'Pris og betaling' : 'Købesum og betaling', two(fl(priceRows), fl(priceRows2)) +
      (eng && v.vat === 'brugt' ? '<p class="note">Brugtmoms – fortjenstmargenordningen for brugte varer. Momsen fremgår ikke og kan ikke fradrages af køber.</p>' : ''));
    if (!eng) hh += sec('Byttebil', two(fl([row('Reg.nr.', e('tradeReg')), row('Model', e('tradeModel'))]), fl([row('Værdi', money('tradeValue')), row('Til betaling', trade != null && price != null ? nfmt(price - trade) + ' kr.' : '')])));
    var multiRow = function (l, k) { return e(k) ? fl([row(l, multi(k))]) : fl([row(l, '&nbsp;'), row('', '&nbsp;')]); };
    hh += sec(eng ? 'Aftaler' : 'Tilbehør og aftaler', (eng ? '' : fl([row('Tilbehør', multi('accessories') || '&nbsp;')])) + multiRow(eng ? 'Kendte fejl' : 'Aftaler / fejl', 'agreements'));
    hh += sec('Vilkår', '<ol class="terms">' + (eng
      ? '<li>Køber er erhvervsdrivende og køber køretøjet som led i sin erhvervsvirksomhed.</li><li>Køretøjet sælges som beset og uden garanti. Da handlen sker mellem erhvervsdrivende, er reklamationsretten fraskrevet, medmindre andet fremgår af denne slutseddel.</li><li>Ejendomsretten overgår ved fuld betaling. Køretøjet udleveres, når hele købesummen er modtaget.</li><li>Køber sørger selv for afhentning, transport og omregistrering, medmindre andet er aftalt.</li><li>Kilometertallet er aflæst ved overdragelsen og oplyst efter bilens instrumentering.</li>'
      : '<li>Køber bekræfter at have besigtiget og prøvekørt køretøjet.</li><li>Ejendomsretten overgår ved fuld betaling.</li><li>Kilometertallet er aflæst ved overdragelsen og oplyst efter bilens instrumentering.</li><li>Eventuel garanti og reklamationsret følger købelovens regler samt de vilkår, der fremgår af denne slutseddel.</li>') + '</ol>');
    hh += '<table class="sigs"><tr><td>' + LN('') + '<div class="s"><b>Sælger</b> · ' + esc(FIRM.name) + (e('sellerName') ? ' v/ ' + e('sellerName') : '') + '<br>' + esc(cityOnly) + ', ' + (date('date') || '_______________') + '</div></td><td class="gp"></td><td>' + LN('') + '<div class="s"><b>Køber</b><br>Dato: _______________</div></td></tr></table>' + foot;
    return doc(hh);
  }

  // ---------------------------------------------------------------------------
  // Tjeklister
  // ---------------------------------------------------------------------------
  var STATES = ['ok', 'fejl', 'ikke'];
  var LISTS = {
    gennemgang: { title: 'Gennemgang ved ankomst', hint: 'Ca. 1 times gennemgang med prøvetur. Tryk OK, Fejl eller Ikke relevant ved hvert punkt. Fejl kan med ét tryk blive til en fejl/mangel eller en opgave.', groups: [
      { g: 'Før du kigger på bilen', items: [
        { k: 'g01', t: 'Stelnummer og reg.nr. passer til papirerne' },
        { k: 'g02', t: 'Synet er i orden (næste syn står i registret)' },
        { k: 'g03', t: 'Servicebog og ekstra nøgle følger med' },
        { k: 'g04', t: 'Stelnummeret er tjekket for tyveri/skade (VIN-tjek)' }] },
      { g: 'Karrosseri', items: [
        { k: 'g05', t: 'Ridser, buler og lakskader' },
        { k: 'g06', t: 'Spalter mellem paneler er ens (tegn på uheld)' },
        { k: 'g07', t: 'Lakken er ens over det hele (magnet/tryk: spartel)' },
        { k: 'g08', t: 'Forrude uden stenslag eller revner' },
        { k: 'g09', t: 'Forlygter er klare (ikke matte/gule)' },
        { k: 'g10', t: 'Rust: dørkarme, skærme, bund og udstødning' }] },
      { g: 'Hjul og dæk', items: [
        { k: 'g11', t: 'Mønsterdybde på alle 4 dæk' },
        { k: 'g12', t: 'Alle 4 dæk er ens og slidt ens' },
        { k: 'g13', t: 'Fælge uden skader' },
        { k: 'g14', t: 'Bremseskiver uden kraftig rust' },
        { k: 'g15', t: 'Reservehjul/lappesæt og donkraft er der' }] },
      { g: 'Under bilen', items: [
        { k: 'g16', t: 'Ingen lækager (motor, gearkasse, bagtøj)' },
        { k: 'g17', t: 'Understel uden rust eller kollisionsskader' },
        { k: 'g18', t: 'Støddæmpere, styretøj og kuglemuffer' },
        { k: 'g19', t: 'Udstødning uden hul eller rust' }] },
      { g: 'Motorrum (før start)', items: [
        { k: 'g20', t: 'Motorhjelm åbner og støtten holder' },
        { k: 'g21', t: 'Olieniveau og oliens farve (ingen metal, ikke "mælkeagtig")' },
        { k: 'g22', t: 'Intet skum under oliepåfyldningsdækslet' },
        { k: 'g23', t: 'Kølevæske, bremsevæske og sprinklervæske' },
        { k: 'g24', t: 'Slanger, remme, batteripoler og ledninger' },
        { k: 'g25', t: 'Ingen lækager eller nye dele, der skjuler noget' }] },
      { g: 'Start og fejlkoder', items: [
        { k: 'g26', t: 'Fejlkoder aflæst med OBD-scanner (ingen nyligt slettede koder)' },
        { k: 'g27', t: 'Koldstart: ingen mærkelige lyde eller røg' },
        { k: 'g28', t: 'Motoren starter uden at tage for lang tid' },
        { k: 'g29', t: 'Tomgang er rolig (ingen rystelser)' },
        { k: 'g30', t: 'Ingen røg fra udstødningen ved start' },
        { k: 'g31', t: 'Varmstart: samme tjek igen' }] },
      { g: 'Indvendigt', items: [
        { k: 'g32', t: 'Sæder: slid, flænger, pletter og lugt' },
        { k: 'g33', t: 'Sæder kan indstilles og sidder fast' },
        { k: 'g34', t: 'Måtter og gulv: fugt, lugt, pletter (kig under måtterne)' },
        { k: 'g35', t: 'Loft/himmel uden hængende stof eller vandspor' },
        { k: 'g36', t: 'Bagagerum: tæt, tørt og uden rust' },
        { k: 'g37', t: 'Slid på rat, gearknop og pedaler passer til kilometertallet' }] },
      { g: 'Udstyr og funktioner', items: [
        { k: 'g38', t: 'Alle ruder og elspejle' },
        { k: 'g39', t: 'Centrallås og nøgler' },
        { k: 'g40', t: 'Radio, højttalere, Bluetooth og USB' },
        { k: 'g41', t: 'Klimaanlæg og varme på alle trin og alle blæsere' },
        { k: 'g42', t: 'Sædevarme, soltag og parkeringssensorer (hvis de findes)' },
        { k: 'g43', t: 'Håndbremse holder bilen' },
        { k: 'g44', t: 'Alle lamper i instrumentbrættet slukker, og alle visere virker' },
        { k: 'g45', t: 'Viskere og sprinkler' }] },
      { g: 'Lygter', items: [
        { k: 'g46', t: 'Nær- og fjernlys' },
        { k: 'g47', t: 'Kørelys og tågelygter' },
        { k: 'g48', t: 'Blink og baglygter' },
        { k: 'g49', t: 'Bremselygter (også den høje)' }] },
      { g: 'Prøvetur', items: [
        { k: 'g50', t: 'Acceleration er jævn (ingen bank eller tøven)' },
        { k: 'g51', t: 'Gearskift er bløde, og koblingen glider ikke' },
        { k: 'g52', t: 'Bremser: bilen trækker ikke, ingen vibrationer eller lyde' },
        { k: 'g53', t: 'Styring: ingen lyde eller slør (stillestående og i kørsel)' },
        { k: 'g54', t: 'Bilen kører lige, uden vibrationer ved høj fart' },
        { k: 'g55', t: 'Ingen mærkelige lyde fra understel, hjul eller motor' },
        { k: 'g56', t: 'Temperaturen holder sig normal efter turen' }] }
    ] },
    klargoering: { title: 'Klargøring', hint: 'Tryk OK, når punktet er gjort. Tag billederne i billedrummet, mens bilen er ren.', groups: [
      { g: 'Rækkefølge', items: [
        { k: 'k01', t: 'Vask udvendigt' },
        { k: 'k02', t: 'Dørkarme' },
        { k: 'k03', t: 'Motorrum' },
        { k: 'k04', t: 'Støvsugning' },
        { k: 'k05', t: 'Indvendig vask' },
        { k: 'k06', t: 'Plastpleje' },
        { k: 'k07', t: 'Ozon', opt: true },
        { k: 'k08', t: 'Billeder i billedrum (mens bilen er ren)' }] }
    ] }
  };
  /** Alle punkter i en liste, flade: [{k,t,g,opt}] */
  function listItems(list) {
    var def = LISTS[list], out = [];
    if (!def) return out;
    def.groups.forEach(function (g) { g.items.forEach(function (it) { out.push({ k: it.k, t: it.t, g: g.g, opt: !!it.opt }); }); });
    return out;
  }
  /** Antal punkter, der skal besvares (ikke de valgfrie). */
  function listSize(list) { return listItems(list).filter(function (i) { return !i.opt; }).length; }
  /** Fast id til en tjekpost (samme bil + liste + punkt giver altid samme id; kun a-z og 0-9, 8-24 tegn). */
  function tjekId(carId, list, key) {
    var s = String(carId) + '|' + list + '|' + key, h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      h1 = (h1 ^ s.charCodeAt(i)) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + s.charCodeAt(i) * (i + 7)) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 15), 0x2c1b3c6d) >>> 0;
    }
    return 'tj' + h1.toString(36) + h2.toString(36);
  }
  /** Fremdrift for en bil: { done, total, fejl } ud fra bilens tjek-poster. */
  function progress(list, items, carId) {
    var valid = {}; listItems(list).forEach(function (i) { valid[i.k] = i; });
    var latest = {};
    (items || []).forEach(function (it) {
      if (it.type !== 'tjek' || it.deleted || it.carId !== carId || it.list !== list || !valid[it.key]) return;
      if (!latest[it.key] || (it.updatedAt || 0) >= (latest[it.key].updatedAt || 0)) latest[it.key] = it;
    });
    var done = 0, fejl = 0, answered = 0;
    Object.keys(latest).forEach(function (k) {
      var s = latest[k].state;
      if (STATES.indexOf(s) < 0) return;
      answered++;
      if (!valid[k].opt) done++;
      if (s === 'fejl') fejl++;
    });
    return { done: done, total: listSize(list), fejl: fejl, answered: answered, byKey: latest };
  }

  return {
    CAR_KEYS: CAR_KEYS, mergeRemembered: mergeRemembered, FIRM: FIRM, VAT_OPT: VAT_OPT, SPECS: SPECS, KINDS: KINDS, SIG_KEYS: SIG_KEYS, MAX_SIG: MAX_SIG, LISTS: LISTS, STATES: STATES,
    fieldList: fieldList, defaults: defaults, clean: clean, storable: storable, fileName: fileName, html: html, esc: esc, fmtDate: fmtDate, pnum: pnum, nfmt: nfmt, sigOk: sigOk,
    listItems: listItems, listSize: listSize, tjekId: tjekId, progress: progress
  };
})();
if (typeof window !== 'undefined' && window.BA) window.BA.docs = DOCS_;
