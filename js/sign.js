/* Prisskilt – ÉN fil, brugt af både appen (BA.sign) og serveren (SIGN_ i Apps Script).
 *
 * Ren logik: ingen skærm, ingen Google, intet net. byg-deploy.ps1 lægger filen ind i deploy\Code.gs (efter docs.js).
 *
 *   SIGN_.badges(car, udstyr, opts, today)  -> de mærker, der KAN vælges: [{ key, text, fits }]  (fits = appen foreslår det, men vælger det ikke)
 *   SIGN_.suggestEquipment(udstyr)          -> bilens udstyr sorteret, så det vigtigste står først
 *   SIGN_.clean(opts)                       -> { opts } eller { error }  (serveren stoler aldrig på appen)
 *   SIGN_.layout(input)                     -> { ops, warnings }  tegneliste i mm (A4 liggende, y fra toppen)
 *   SIGN_.toSvg(ops) / SIGN_.toPdf(ops)     -> forhåndsvisning (SVG) / PDF som binær tekst (1 tegn = 1 byte)
 *   SIGN_.qr(text)                          -> { size, mod } QR-kode (byte-tilstand, fejlrettelse M, version 1-10)
 *   SIGN_.publicView(car, udstyr, firm)     -> det, kundesiden må se (aldrig reg.nr., stelnummer, købspris, noter …)
 *
 * PDF'en laves i telefonen/pc'en (ikke hos Google): Googles HTML→PDF kan ikke lave liggende A4 med præcise mål, og
 * skiltet skal kunne printes med det samme – også uden net. Skrifterne er PDF'ens indbyggede Helvetica (ingen filer at hente).
 */
var SIGN_ = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Faste værdier
  // ---------------------------------------------------------------------------
  var URL_BASE = 'https://hovedvejensautosydfyn.github.io/Bilarkiv/b/?k=';   // kundesiden (skift til h-auto.dk her, når domænet virker – gamle skilte virker stadig)
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';                    // ingen i, l, o, 0, 1 (kan ikke forveksles)
  var CODE_LEN = 8;
  var CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
  var MAX_CODES = 20;           // en bil kan have fået koder fra flere telefoner, før serveren svarede: alle virker
  var LABELS = { '': '', afhent: 'AFHENTNINGSTILBUD', engros: 'ENGROS' };
  var LABEL_NAMES = { '': 'Intet', afhent: 'Afhentningstilbud', engros: 'Engros' };
  var MAX_BADGES = 6, WARN_BADGES = 4, MAX_EQUIP = 8, DEFAULT_EQUIP = 6;
  var RED = [216, 31, 38], BRIGHT_RED = [255, 59, 66], BLACK = [17, 17, 17], WHITE = [255, 255, 255], GREY = [68, 68, 68];
  var PAGE_W = 297, PAGE_H = 210;   // mm

  // ---------------------------------------------------------------------------
  // Små hjælpere
  // ---------------------------------------------------------------------------
  function clean(v, max) {
    var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmtInt(n) { n = Math.round(num(n)); var s = String(Math.abs(n)), out = ''; while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); } return (n < 0 ? '-' : '') + s + out; }
  function priceText(p) { return fmtInt(p) + ',-'; }
  function isoDays(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; }
  function udstyrText(list) { return (list || []).map(function (x) { return String(x || ''); }).join('\n'); }

  function newCode(randInt) {
    var s = '';
    for (var i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET.charAt(randInt(CODE_ALPHABET.length));
    return s;
  }
  function validCode(c) { return typeof c === 'string' && CODE_RE.test(c); }
  function url(code) { return URL_BASE + code; }

  // ---------------------------------------------------------------------------
  // Mærker (fremhæv): fast liste. Intet kommer på af sig selv – "fits" er kun et forslag i appen.
  // ---------------------------------------------------------------------------
  var BADGE_KEYS = ['nysynet', 'synettil', 'service', 'tandrem', 'kaede', 'garanti', 'lavkm', 'traek', 'klima'];
  var BADGE_NAMES = { nysynet: 'Nysynet', synettil: 'Synet til …', service: 'Nyserviceret', tandrem: 'Ny tandrem', kaede: 'Kæde – ingen tandrem', garanti: 'Garanti',
    lavkm: 'Lave km', traek: 'Anhængertræk', klima: 'Klima + sædevarme' };

  /** De mærker, der kan vælges til bilen lige nu: [{ key, name, text, fits }]. today = 'YYYY-MM-DD'. */
  function badges(car, udstyr, opts, today) {
    car = car || {}; opts = opts || {};
    var u = udstyrText(udstyr), out = [];
    var engros = opts.label === 'engros';
    var t = isoDays(today), mot = isoDays(car.motDate), next = isoDays(car.nextInspection);
    var km = num(car.km), year = num(car.year), thisYear = today ? +String(today).slice(0, 4) : 0;
    var age = year && thisYear ? Math.max(1, thisYear - year) : 0;
    function add(key, text, fits) { out.push({ key: key, name: BADGE_NAMES[key], text: text, fits: !!fits }); }
    if (mot !== null && t !== null && t - mot >= 0 && t - mot <= 180) add('nysynet', 'NYSYNET', t - mot <= 60);
    if (next !== null && t !== null && next > t) { var p = String(car.nextInspection).split('-'); add('synettil', 'SYNET TIL ' + p[1] + '/' + p[0], false); }
    add('service', 'NYSERVICERET', false);
    add('tandrem', 'NY TANDREM', false);
    add('kaede', 'KÆDE – INGEN TANDREM', false);
    var w = clean(opts.warranty, 30);
    if (w && !engros) add('garanti', (/garanti/i.test(w) ? w : w + ' garanti').toUpperCase(), false);
    if (km > 0 && !engros) add('lavkm', 'KUN ' + fmtInt(km) + ' KM', km < 150000 && age && km / age < 15000);
    if (/anhængertræk|anhaengertraek|trækkrog/i.test(u)) add('traek', 'ANHÆNGERTRÆK', true);
    if (/klima|aircon/i.test(u) && /sædevarme|saedevarme/i.test(u)) add('klima', 'KLIMA + SÆDEVARME', true);
    return out;
  }

  // Det vigtigste udstyr først (samme rækkefølge som en køber kigger efter).
  var EQUIP_PRIO = [/klima|aircon/i, /sædevarme/i, /bakkamera|kamera/i, /carplay|android auto/i, /navi/i, /fartpilot/i, /parkeringssensor|p-sensor|pdc|parkeringshjælp/i,
    /anhængertræk/i, /alufælge|alu-fælge|letmetalfælge/i, /panorama|soltag/i, /læder/i, /keyless|nøglefri/i, /led/i, /bluetooth/i, /el-ruder|elruder/i, /isofix/i];
  function suggestEquipment(udstyr) {
    var seen = {}, list = [];
    (udstyr || []).forEach(function (n) { var s = clean(n, 80); if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; list.push(s); } });
    function rank(s) { for (var i = 0; i < EQUIP_PRIO.length; i++) if (EQUIP_PRIO[i].test(s)) return i; return EQUIP_PRIO.length; }
    return list.map(function (s, i) { return { s: s, r: rank(s), i: i }; }).sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.s; });
  }
  function defaultEquipment(udstyr) { return suggestEquipment(udstyr).slice(0, DEFAULT_EQUIP); }

  /** Renser valgene (appen og serveren). Giver { opts } eller { error }. */
  function cleanOpts(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'Skiltets valg kan ikke læses.' };
    var label = o.label == null ? '' : String(o.label);
    if (!Object.prototype.hasOwnProperty.call(LABELS, label)) return { error: 'Ukendt skilt-mærke.' };
    var b = Array.isArray(o.badges) ? o.badges : [], seen = {}, badgesOut = [];
    for (var i = 0; i < b.length; i++) {
      var k = String(b[i]);
      if (BADGE_KEYS.indexOf(k) < 0) return { error: 'Ukendt mærke: ' + k.slice(0, 30) };
      if (!seen[k]) { seen[k] = true; badgesOut.push(k); }
    }
    if (badgesOut.length > MAX_BADGES) return { error: 'Højst ' + MAX_BADGES + ' mærker på et skilt.' };
    var e = Array.isArray(o.equipment) ? o.equipment : [], eq = [], seenE = {};
    for (var j = 0; j < e.length; j++) {
      var s = clean(e[j], 80);
      if (s && !seenE[s.toLowerCase()]) { seenE[s.toLowerCase()] = true; eq.push(s); }
    }
    if (eq.length > MAX_EQUIP) return { error: 'Højst ' + MAX_EQUIP + ' stykker udstyr på et skilt.' };
    var warranty = clean(o.warranty);
    if (warranty.length > 30) return { error: 'Garantien må højst være 30 tegn (fx "3 mdr.").' };
    var hk = clean(o.hk);
    if (hk && !/^\d{1,4}$/.test(hk)) return { error: 'HK skal være et tal (fx 95).' };
    return { opts: { label: label, badges: badgesOut, equipment: eq, warranty: warranty, hk: hk } };
  }

  // ---------------------------------------------------------------------------
  // Skrift: bredder for PDF'ens indbyggede Helvetica (1/1000 af skriftstørrelsen). Bruges til at få tekst til at passe.
  // ---------------------------------------------------------------------------
  var W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  var W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var W_EXTRA = { 'Æ': 1000, 'æ': 889, 'Ø': 778, 'ø': 611, 'Å': 722, 'å': 556, 'Ä': 722, 'ä': 556, 'Ö': 778, 'ö': 611, 'Ü': 722, 'ü': 611, 'É': 667, 'é': 556, 'è': 556, 'ß': 611,
    '–': 556, '—': 1000, '…': 1000, '·': 278, '•': 350, '€': 556, '’': 278, '‘': 278, '“': 500, '”': 500, '°': 400, '²': 333, '³': 333, '½': 834, '×': 584 };
  // WinAnsi: tegnene 0x80-0x9F er ikke Latin-1. Alt andet uden for Latin-1 kan PDF'ens indbyggede skrift ikke vise.
  var WIN = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };

  /** Teksten med kun de tegn, PDF'ens skrift kan vise (emojis og andet fjernes, typografiske tegn gøres enkle). */
  function printable(s) {
    s = String(s == null ? '' : s).replace(/[‐-‒]/g, '-').replace(/−/g, '-').replace(/[  -​ ]/g, ' ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i);
      if ((c >= 32 && c <= 126) || (c >= 0xA0 && c <= 0xFF) || WIN[ch]) out += ch;
      else if (c >= 0xD800 && c <= 0xDBFF) i++;   // emoji o.l. (to tegn i JavaScript)
    }
    return out.replace(/\s+/g, ' ').trim();
  }
  function charW(ch, bold) {
    var c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return (bold ? W_BOLD : W_REG)[c - 32];
    if (W_EXTRA[ch]) return W_EXTRA[ch];
    var base = ch.normalize ? ch.normalize('NFD').charAt(0) : '';
    if (base && base !== ch && base.charCodeAt(0) >= 32 && base.charCodeAt(0) <= 126) return (bold ? W_BOLD : W_REG)[base.charCodeAt(0) - 32];
    return 556;
  }
  var PT = 25.4 / 72;   // 1 punkt i mm
  /** Tekstens bredde i mm. size i punkter, cs = ekstra afstand mellem bogstaverne i punkter (kan være negativ). */
  function textWidth(text, size, bold, cs) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += charW(text.charAt(i), bold);
    return (w / 1000 * size + (cs || 0) * Math.max(0, text.length - 1)) * PT;
  }
  /** Største størrelse (højst max, mindst min), så teksten passer i bredden. Passer den ikke ved min, forkortes den med "…". */
  function fit(text, maxWidth, max, min, bold, csFactor) {
    var size = max;
    while (size > min && textWidth(text, size, bold, size * (csFactor || 0)) > maxWidth) size -= 0.5;
    var t = text;
    if (textWidth(t, size, bold, size * (csFactor || 0)) > maxWidth) {
      while (t.length > 1 && textWidth(t + '…', size, bold, size * (csFactor || 0)) > maxWidth) t = t.slice(0, -1);
      t = t.replace(/\s+$/, '') + '…';
    }
    return { text: t, size: size, cs: size * (csFactor || 0) };
  }
  function capH(size) { return 0.718 * size * PT; }   // Helveticas store bogstaver og tal er 71,8 % af størrelsen
  var MIN_PRICE_MM = 35, TARGET_PRICE_MM = 38, MIN_SQUEEZE = 0.78;
  /**
   * Prisen: så høj som pladsen tillader (mål: tallene ca. 38 mm, mindst 35 mm). Er den for bred, klemmes bogstaverne vandret
   * (ned til 78 %) i stedet for at gøre dem lavere – højden er det, der ses på afstand. Giver { text, size, cs, hs, byHeight }.
   */
  function priceFit(t, maxW, areaH) {
    var cs = -0.035, sizeH = Math.min(220, areaH * 0.92 / (0.718 * PT));
    var widthAt = function (s) { return textWidth(t, s, true, s * cs); };
    var sizeW = maxW / widthAt(1);                                    // størrelsen, hvor den fylder bredden uden at blive klemt
    var target = TARGET_PRICE_MM / (0.718 * PT);
    var size = Math.min(sizeH, Math.max(sizeW, target)), hs = Math.min(1, maxW / widthAt(size));
    if (hs < MIN_SQUEEZE) { hs = MIN_SQUEEZE; size = maxW / (widthAt(1) * MIN_SQUEEZE); }
    return { text: t, size: size, cs: size * cs, hs: hs, byHeight: size >= sizeH - 0.01 };
  }
  /** Model + variant – uden at gentage varianten, hvis den allerede står i modellen. */
  function titleOf(car) {
    var m = clean(car && car.model), v = clean(car && car.variant);
    return v && m.toLowerCase().indexOf(v.toLowerCase()) < 0 ? m + ' ' + v : m;
  }
  var QR_FRAME = 94, QR_QUIET = 4;   // hvid ramme i mm; med en kode på 33 moduler (version 4) bliver selve koden 75,7 mm

  // ---------------------------------------------------------------------------
  // QR-kode (ISO 18004): byte-tilstand, fejlrettelse M, version 1-10, bedste maske efter standardens strafpoint
  // ---------------------------------------------------------------------------
  var QR_TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];     // kodeord i alt pr. version
  var QR_ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];              // fejlrettelse pr. blok (M)
  var QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];                     // antal blokke (M)
  var QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 255;
  }
  function rsDivisor(degree) {
    var r = []; for (var i = 0; i < degree - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      for (var i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    });
    return r;
  }
  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(String(text)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function dataCodewords(v) { return QR_TOTAL[v] - QR_ECC[v] * QR_BLOCKS[v]; }

  function qr(text, forceMask) {
    var bytes = utf8(text), v;
    for (v = 1; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
    if (v > 10) throw new Error('Teksten er for lang til QR-koden.');
    var cap = dataCodewords(v) * 8, bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // Del i blokke, læg fejlrettelse til, og flet blokkene
    var nb = QR_BLOCKS[v], ecl = QR_ECC[v], raw = QR_TOTAL[v], short = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(ecl), blocks = [], k = 0;
    for (var bi = 0; bi < nb; bi++) {
      var dat = data.slice(k, k + shortLen - ecl + (bi < short ? 0 : 1)); k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (bi < short) dat.push(-1);   // pladsholder, så alle blokke er lige lange under fletningen
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (var c = 0; c < blocks[0].length; c++) blocks.forEach(function (bl, bix) { if (c !== shortLen - ecl || bix >= short) all.push(bl[c]); });
    var size = v * 4 + 17, mod = [], fn = [];
    for (var y = 0; y < size; y++) { mod.push([]); fn.push([]); for (var x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); } }
    function set(x, y, dark) { mod[y][x] = !!dark; fn[y][x] = true; }
    for (var t = 0; t < size; t++) { set(6, t, t % 2 === 0); set(t, 6, t % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var al = QR_ALIGN[v];
    for (var ai = 0; ai < al.length; ai++) for (var aj = 0; aj < al.length; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === al.length - 1) || (ai === al.length - 1 && aj === 0)) continue;
      for (var ady = -2; ady <= 2; ady++) for (var adx = -2; adx <= 2; adx++) set(al[ai] + adx, al[aj] + ady, Math.max(Math.abs(adx), Math.abs(ady)) !== 1);
    }
    function drawFormat(mask) {
      var d = (0 << 3) | mask, rem = d;   // M = 00
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var f = ((d << 10) | rem) ^ 0x5412, bit = function (n) { return ((f >>> n) & 1) !== 0; };
      for (var a = 0; a <= 5; a++) set(8, a, bit(a));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (var a2 = 9; a2 < 15; a2++) set(14 - a2, 8, bit(a2));
      for (var a3 = 0; a3 < 8; a3++) set(size - 1 - a3, 8, bit(a3));
      for (var a4 = 8; a4 < 15; a4++) set(8, size - 15 + a4, bit(a4));
      set(8, size - 8, true);
    }
    drawFormat(0);
    if (v >= 7) {
      var vr = v;
      for (var q2 = 0; q2 < 12; q2++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vb = (v << 12) | vr;
      for (var vi = 0; vi < 18; vi++) { var on = ((vb >>> vi) & 1) !== 0, va = size - 11 + vi % 3, vbb = Math.floor(vi / 3); set(va, vbb, on); set(vbb, va, on); }
    }
    // Data i zigzag fra nederste højre hjørne
    var bitIdx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var xq = right - jj, up = ((right + 1) & 2) === 0, yq = up ? size - 1 - vert : vert;
        if (!fn[yq][xq] && bitIdx < all.length * 8) { mod[yq][xq] = ((all[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0; bitIdx++; }
      }
    }
    function applyMask(m) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        if (fn[yy][xx]) continue;
        var inv;
        switch (m) {
          case 0: inv = (xx + yy) % 2 === 0; break;
          case 1: inv = yy % 2 === 0; break;
          case 2: inv = xx % 3 === 0; break;
          case 3: inv = (xx + yy) % 3 === 0; break;
          case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
          case 5: inv = (xx * yy) % 2 + (xx * yy) % 3 === 0; break;
          case 6: inv = ((xx * yy) % 2 + (xx * yy) % 3) % 2 === 0; break;
          default: inv = ((xx + yy) % 2 + (xx * yy) % 3) % 2 === 0;
        }
        if (inv) mod[yy][xx] = !mod[yy][xx];
      }
    }
    var best = typeof forceMask === 'number' ? forceMask : -1;
    if (best < 0) {
      var bestScore = Infinity;
      for (var m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        var sc = penalty(mod, size);
        if (sc < bestScore) { bestScore = sc; best = m; }
        applyMask(m);   // maskerne er deres egen modsætning
      }
    }
    applyMask(best); drawFormat(best);
    return { size: size, mod: mod, version: v, mask: best, codewords: all, blocks: blocks.map(function (bl) { return bl.filter(function (x) { return x >= 0; }); }), ecc: ecl };
  }
  function penalty(mod, size) {
    var score = 0, dark = 0, x, y;
    function lines(get) {
      for (var a = 0; a < size; a++) {
        var run = 1, row = [];
        for (var b = 0; b < size; b++) row.push(get(a, b));
        for (var c = 1; c <= size; c++) {
          if (c < size && row[c] === row[c - 1]) run++;
          else { if (run >= 5) score += 3 + run - 5; run = 1; }
        }
        var s = row.map(function (d) { return d ? '1' : '0'; }).join('');
        var re = /(?=(10111010000|00001011101))/g, hit;
        while ((hit = re.exec(s))) { score += 40; re.lastIndex = hit.index + 1; }
      }
    }
    lines(function (a, b) { return mod[a][b]; });
    lines(function (a, b) { return mod[b][a]; });
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var c0 = mod[y][x];
      if (c0 === mod[y][x + 1] && c0 === mod[y + 1][x] && c0 === mod[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
    var total = size * size, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return score + Math.max(0, k) * 10;
  }

  // ---------------------------------------------------------------------------
  // Skiltet: tegneliste i mm (y fra toppen). Samme liste bliver til SVG (forhåndsvisning) og PDF.
  //   { t:'rect', x, y, w, h, fill }  { t:'text', x, y (grundlinje), size (pt), bold, color, text, cs (pt) }
  //   { t:'line', pts:[[x,y]…], color, lw }  { t:'circle', x, y, r, fill }  { t:'qr', x, y, size, mod }
  // ---------------------------------------------------------------------------
  /**
   * input: { car, udstyr: [navne], opts (rensede), code, firm: { name, phone }, today }
   * Giver { ops, warnings, url }.
   */
  function layout(input) {
    var car = input.car || {}, o = input.opts || {}, firm = input.firm || {}, warnings = [];
    var ops = [], M = 8;
    function rect(x, y, w, h, fill) { ops.push({ t: 'rect', x: x, y: y, w: w, h: h, fill: fill }); }
    function text(x, y, f, bold, color, align) {
      var hs = f.hs || 1, w = textWidth(f.text, f.size, bold, f.cs) * hs, xx = align === 'center' ? x - w / 2 : x;
      ops.push({ t: 'text', x: xx, y: y, size: f.size, bold: !!bold, color: color, text: f.text, cs: f.cs || 0, w: w, hs: hs });
    }
    // Rød kant og sort søjle
    var colW = 98, colX = PAGE_W - M - colW, ccx = colX + colW / 2;
    rect(M, M, 10, PAGE_H - 2 * M, RED);
    rect(colX, M, colW, PAGE_H - 2 * M, BLACK);
    var x0 = M + 10 + 9, x1 = colX - 9, cw = x1 - x0;
    var top = M + 8;
    var lab = LABELS[o.label] || '';
    if (lab) {
      rect(M + 10, M, colX - M - 10, 17, RED);
      var lf = fit(lab, cw, 30, 16, true, 0.02);
      text(x0, M + (17 + capH(lf.size)) / 2, lf, true, WHITE);
      top = M + 17 + 9;
    }
    // Model og variant
    var title = printable(titleOf(car)) || 'Bil';
    var tf = fit(title, cw, 32, 18, true);
    var yTitle = top + capH(tf.size);
    text(x0, yTitle, tf, true, BLACK);
    // Årgang · km · brændstof · hk
    var info = [car.year ? String(car.year) : '', num(car.km) > 0 ? fmtInt(car.km) + ' km' : '', printable(car.fuel), o.hk ? o.hk + ' hk' : ''].filter(Boolean).join(' · ');
    var yInfo = yTitle;
    if (info) { var inf = fit(info, cw, 21, 13, true); yInfo = yTitle + 4 + capH(inf.size) + 2; text(x0, yInfo, inf, true, GREY); }
    // Udstyr nederst (to kolonner)
    var bottom = PAGE_H - M - 8;
    var eq = (o.equipment || []).map(printable).filter(Boolean).slice(0, MAX_EQUIP);
    var rows = Math.ceil(eq.length / 2), rowH = 8.2, eqTop = bottom;
    if (eq.length) {
      eqTop = bottom - rows * rowH - 2;
      rect(x0, eqTop, cw, 0.7, BLACK);
      var colw = (cw - 6) / 2;
      // Samme skriftstørrelse til alt udstyret (den største, alle kan stå i; et navn, der stadig er for langt, forkortes)
      var eqSize = eq.reduce(function (m, name) { return Math.min(m, fit(name, colw - 7, 16, 12, true).size); }, 16);
      eq.forEach(function (name, i) {
        var cx = x0 + (i % 2) * (colw + 6), base = eqTop + 3 + Math.floor(i / 2) * rowH + 5.6;
        ops.push({ t: 'line', pts: [[cx + 0.4, base - 2.4], [cx + 1.9, base - 0.6], [cx + 4.6, base - 4.6]], color: BLACK, lw: 0.9 });
        text(cx + 7, base, fit(name, colw - 7, eqSize, eqSize, true), true, BLACK);
      });
    }
    // Mærker (røde bokse, ombrydes)
    var all = badges(car, input.udstyr, o, input.today), byKey = {};
    all.forEach(function (b) { byKey[b.key] = b; });
    var chosen = (o.badges || []).filter(function (k) { return byKey[k]; }).map(function (k) { return byKey[k].text; });
    if ((o.badges || []).length > chosen.length) warnings.push('Et eller flere valgte mærker passer ikke på bilen længere og er udeladt.');
    if (chosen.length > WARN_BADGES) warnings.push('Mere end ' + WARN_BADGES + ' mærker gør skiltet rodet.');
    var bH = 12, bGap = 3, bPad = 4.5, lineList = [], cur = [], curW = 0;
    chosen.forEach(function (t) {
      var f = fit(printable(t), cw - 2 * bPad, 17, 11, true), w = textWidth(f.text, f.size, true, 0) + 2 * bPad;
      if (cur.length && curW + bGap + w > cw) { lineList.push(cur); cur = []; curW = 0; }
      cur.push({ f: f, w: w }); curW += (cur.length > 1 ? bGap : 0) + w;
    });
    if (cur.length) lineList.push(cur);
    var bBottom = eq.length ? eqTop - 6 : bottom, bTop = bBottom - lineList.length * bH - Math.max(0, lineList.length - 1) * bGap;
    lineList.forEach(function (ln, li) {
      var bx = x0, by = bTop + li * (bH + bGap);
      ln.forEach(function (b) {
        rect(bx, by, b.w, bH, RED);
        text(bx + bPad, by + (bH + capH(b.f.size)) / 2, b.f, true, WHITE);
        bx += b.w + bGap;
      });
    });
    // Prisen: så stor som muligt mellem info-linjen og mærkerne
    var areaTop = yInfo + 7, areaBottom = (lineList.length ? bTop : bBottom) - 6, areaH = Math.max(10, areaBottom - areaTop);
    var price = num(car.listPrice);
    if (price > 0) {
      var pf = priceFit(priceText(price), cw, areaH);
      text(x0, areaTop + (areaH + capH(pf.size)) / 2, pf, true, BLACK);
      var cmTxt = String(MIN_PRICE_MM / 10).replace('.', ',');
      if (capH(pf.size) < MIN_PRICE_MM) warnings.push(pf.byHeight ? 'Prisen bliver mindre end ' + cmTxt + ' cm høj. Fjern et mærke eller noget udstyr for at gøre den større.'
        : 'Prisen er så lang, at tallene bliver mindre end ' + cmTxt + ' cm høje.');
    } else warnings.push('Bilen har ingen pris.');
    // Sort søjle: kamera, "SCAN MED DIT KAMERA", QR, "SE ALT OM BILEN HER", firma og telefon
    var camY = M + 7;
    rect(ccx - 4, camY, 8, 2.6, WHITE);
    rect(ccx - 9, camY + 2.2, 18, 12, WHITE);
    ops.push({ t: 'circle', x: ccx, y: camY + 8.2, r: 4.2, fill: BLACK });
    ops.push({ t: 'circle', x: ccx, y: camY + 8.2, r: 2.5, fill: WHITE });
    var ss = 29, s1 = fit('SCAN MED', colW - 10, ss, ss, true), s2 = fit('DIT KAMERA', colW - 10, ss, ss, true);
    text(ccx, camY + 15 + 3 + capH(ss), s1, true, WHITE, 'center');
    text(ccx, camY + 15 + 3 + capH(ss) * 2 + 3.5, s2, true, WHITE, 'center');
    // QR: selve koden (uden den hvide stilhedszone på 4 moduler) skal være mindst 75 mm
    var qrSize = QR_FRAME, qrY = camY + 15 + 3 + capH(ss) * 2 + 3.5 + 4.5, link = url(input.code || '');
    var code = qr(link);
    rect(ccx - qrSize / 2, qrY, qrSize, qrSize, WHITE);
    ops.push({ t: 'qr', x: ccx - qrSize / 2, y: qrY, size: qrSize, mod: code.mod, quiet: QR_QUIET });
    var rs = 24, r1 = fit('SE ALT OM', colW - 10, rs, rs, true), r2 = fit('BILEN HER', colW - 10, rs, rs, true);
    var ry = qrY + qrSize + 4 + capH(rs);
    text(ccx, ry, r1, true, BRIGHT_RED, 'center');
    text(ccx, ry + capH(rs) + 2.8, r2, true, BRIGHT_RED, 'center');
    var phone = printable(firm.phone ? 'Tlf. ' + firm.phone : '');
    var fn = fit(printable(String(firm.name || '').toUpperCase()), colW - 8, 12, 8, true);
    var yPhone = PAGE_H - M - 6;
    if (phone) text(ccx, yPhone, fit(phone, colW - 8, 23, 14, true), true, WHITE, 'center');
    text(ccx, (phone ? yPhone - capH(23) - 3.5 : yPhone), fn, true, WHITE, 'center');
    return { ops: ops, warnings: warnings, url: link, qrVersion: code.version };
  }

  // ---------------------------------------------------------------------------
  // SVG (forhåndsvisning i appen) – samme tegneliste som PDF'en
  // ---------------------------------------------------------------------------
  function hex(c) { return '#' + c.map(function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
  function f2(n) { return String(Math.round(n * 100) / 100); }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function qrRuns(op) {
    var n = op.mod.length, cell = op.size / (n + 2 * op.quiet), out = [];
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (!op.mod[y][x]) { x++; continue; }
        var s = x; while (x < n && op.mod[y][x]) x++;
        out.push({ x: op.x + (op.quiet + s) * cell, y: op.y + (op.quiet + y) * cell, w: (x - s) * cell, h: cell });
      }
    }
    return out;
  }
  function toSvg(ops) {
    var h = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + PAGE_W + ' ' + PAGE_H + '" role="img" aria-label="Prisskilt">' +
      '<rect x="0" y="0" width="' + PAGE_W + '" height="' + PAGE_H + '" fill="#fff"/>';
    ops.forEach(function (op) {
      if (op.t === 'rect') h += '<rect x="' + f2(op.x) + '" y="' + f2(op.y) + '" width="' + f2(op.w) + '" height="' + f2(op.h) + '" fill="' + hex(op.fill) + '"/>';
      else if (op.t === 'circle') h += '<circle cx="' + f2(op.x) + '" cy="' + f2(op.y) + '" r="' + f2(op.r) + '" fill="' + hex(op.fill) + '"/>';
      else if (op.t === 'line') h += '<polyline points="' + op.pts.map(function (p) { return f2(p[0]) + ',' + f2(p[1]); }).join(' ') + '" fill="none" stroke="' + hex(op.color) + '" stroke-width="' + f2(op.lw) + '" stroke-linecap="round" stroke-linejoin="round"/>';
      else if (op.t === 'qr') h += '<path fill="#000" d="' + qrRuns(op).map(function (r) { return 'M' + f2(r.x) + ' ' + f2(r.y) + 'h' + f2(r.w) + 'v' + f2(r.h) + 'h-' + f2(r.w) + 'z'; }).join('') + '"/>';
      else if (op.t === 'text') h += '<text x="' + f2(op.x) + '" y="' + f2(op.y) + '" font-family="Helvetica, Arial, sans-serif" font-weight="' + (op.bold ? 'bold' : 'normal') + '" font-size="' + f2(op.size * PT) + '"' +
        (op.cs ? ' letter-spacing="' + f2(op.cs * PT) + '"' : '') + ' fill="' + hex(op.color) + '" textLength="' + f2(op.w) + '" lengthAdjust="spacingAndGlyphs">' + xmlEsc(op.text) + '</text>';
    });
    return h + '</svg>';
  }

  // ---------------------------------------------------------------------------
  // PDF (1.4, uden komprimering, indbyggede Helvetica-skrifter). Giver en binær tekst: hvert tegn er én byte.
  // ---------------------------------------------------------------------------
  function pdfNum(n) { var s = (Math.round(n * 100) / 100).toFixed(2); return s.replace(/\.?0+$/, '') || '0'; }
  function pt(mm) { return mm * 72 / 25.4; }
  function pdfStr(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), c = s.charCodeAt(i), b = WIN[ch] || c;
      if (b > 255) continue;
      if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
      else out += String.fromCharCode(b);
    }
    return '(' + out + ')';
  }
  function rgb(c, op) { return pdfNum(c[0] / 255) + ' ' + pdfNum(c[1] / 255) + ' ' + pdfNum(c[2] / 255) + ' ' + op; }
  function toPdf(ops, title) {
    var H = pt(PAGE_H), c = [];
    ops.forEach(function (op) {
      if (op.t === 'rect') c.push(rgb(op.fill, 'rg'), pdfNum(pt(op.x)) + ' ' + pdfNum(H - pt(op.y + op.h)) + ' ' + pdfNum(pt(op.w)) + ' ' + pdfNum(pt(op.h)) + ' re f');
      else if (op.t === 'circle') {
        var k = 0.5523 * pt(op.r), cx = pt(op.x), cy = H - pt(op.y), r = pt(op.r);
        c.push(rgb(op.fill, 'rg'), pdfNum(cx + r) + ' ' + pdfNum(cy) + ' m',
          [cx + r, cy + k, cx + k, cy + r, cx, cy + r].map(pdfNum).join(' ') + ' c', [cx - k, cy + r, cx - r, cy + k, cx - r, cy].map(pdfNum).join(' ') + ' c',
          [cx - r, cy - k, cx - k, cy - r, cx, cy - r].map(pdfNum).join(' ') + ' c', [cx + k, cy - r, cx + r, cy - k, cx + r, cy].map(pdfNum).join(' ') + ' c', 'f');
      } else if (op.t === 'line') {
        c.push(rgb(op.color, 'RG'), pdfNum(pt(op.lw)) + ' w 1 J 1 j');
        c.push(op.pts.map(function (p, i) { return pdfNum(pt(p[0])) + ' ' + pdfNum(H - pt(p[1])) + (i ? ' l' : ' m'); }).join(' ') + ' S');
      } else if (op.t === 'qr') {
        c.push('0 0 0 rg');
        qrRuns(op).forEach(function (r) { c.push(pdfNum(pt(r.x)) + ' ' + pdfNum(H - pt(r.y + r.h)) + ' ' + pdfNum(pt(r.w)) + ' ' + pdfNum(pt(r.h)) + ' re'); });
        c.push('f');
      } else if (op.t === 'text') {
        // Tz (vandret skalering i %) sættes ved HVER tekst: den hører til grafiktilstanden og ville ellers gælde for teksten efter
        c.push('BT /' + (op.bold ? 'F1' : 'F2') + ' ' + pdfNum(op.size) + ' Tf ' + pdfNum(op.cs || 0) + ' Tc ' + pdfNum((op.hs || 1) * 100) + ' Tz ' + rgb(op.color, 'rg') + ' ' + pdfNum(pt(op.x)) + ' ' + pdfNum(H - pt(op.y)) + ' Td ' + pdfStr(op.text) + ' Tj ET');
      }
    });
    var content = c.join('\n');
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pdfNum(pt(PAGE_W)) + ' ' + pdfNum(H) + '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Title ' + pdfStr(printable(title || 'Prisskilt').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')) + ' /Producer (Bilarkiv) >>'   // metadata er PDFDocEncoding: kun ASCII og Latin-1
    ];
    var out = '%PDF-1.4\n%âãÏÓ\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return out;
  }

  // ---------------------------------------------------------------------------
  // h-auto.dk: bilens side på hjemmesiden (billeder, beskrivelse og data fra AutoDesktop/Bilinfo)
  // ---------------------------------------------------------------------------
  var WEB_LIST_URL = 'https://h-auto.dk/biler-til-salg/';
  var WEB_CAR_URL = 'https://h-auto.dk/biler-til-salg/?easyvehicleid=';
  var WEB_ID_RE = /^AD\d{4,12}$/;
  var WEB_MODES = ['redirect', 'button'];
  var WEB_MODE_NAMES = { redirect: 'Send kunden direkte til h-auto.dk', button: 'Vis vores side med en knap til h-auto.dk' };
  function webUrl(id) { return WEB_ID_RE.test(String(id || '')) ? WEB_CAR_URL + id : ''; }
  function htmlText(s) {
    return clean(String(s || '').replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&(aelig|oslash|aring|AElig|Oslash|Aring|eacute|Eacute|uuml|ouml|auml|Uuml|Ouml|Auml|ndash|mdash);/g, function (m, n) {
        return { aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', eacute: 'é', Eacute: 'É', uuml: 'ü', ouml: 'ö', auml: 'ä', Uuml: 'Ü', Ouml: 'Ö', Auml: 'Ä', ndash: '–', mdash: '—' }[n];
      })
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  /**
   * Bilerne på h-auto.dk/biler-til-salg/: [{ id: 'AD5727280', name: 'VW Polo 1,2 TSI …', price: 89900 }].
   * Læser hjemmesidens liste over alle biler (links med easyvehicleid). Navn og pris tages fra linkteksten ("Navn – 89.900 kr."), ellers fra JSON-LD.
   */
  function parseWebList(html) {
    html = String(html || '');
    var out = [], byId = {}, re = /<a\b[^>]*href="[^"]*[?&]easyvehicleid=(AD\d{4,12})"[^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(html))) {
      var id = m[1], txt = htmlText(m[2]), name = txt, price = 0;
      var pm = /^(.*?)\s*[–-]\s*([\d.]+)\s*kr\.?$/i.exec(txt);
      if (pm) { name = clean(pm[1]); price = +pm[2].replace(/\./g, '') || 0; }
      if (!name || /^se bilen/i.test(name) || name.length < 3) name = '';
      if (!byId[id]) { byId[id] = { id: id, name: name, price: price }; out.push(byId[id]); }
      else { if (!byId[id].name && name) byId[id].name = name; if (!byId[id].price && price) byId[id].price = price; }
    }
    // Navne fra JSON-LD (schema.org ItemList), hvis linkteksten ikke havde dem
    var ld = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, b;
    while ((b = ld.exec(html))) {
      var o = null; try { o = JSON.parse(b[1]); } catch (e) { o = null; }
      var items = o && o.itemListElement && o.itemListElement.length ? o.itemListElement : [];
      for (var i = 0; i < items.length; i++) {
        var im = /[?&]easyvehicleid=(AD\d{4,12})/.exec(String(items[i] && items[i].url || ''));
        if (!im) continue;
        var nm = clean(items[i].name, 200);
        if (!byId[im[1]]) { byId[im[1]] = { id: im[1], name: nm, price: 0 }; out.push(byId[im[1]]); }
        else if (!byId[im[1]].name) byId[im[1]].name = nm;
      }
    }
    return out.filter(function (x) { return x.name; }).slice(0, 300);
  }
  function words(s) {
    s = clean(s).toLowerCase();
    if (s.normalize) s = s.replace(/[æøå]/g, function (c) { return { 'æ': '\u0001', 'ø': '\u0002', 'å': '\u0003' }[c]; }).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\u0001-\u0003]/g, function (c) { return { '\u0001': 'æ', '\u0002': 'ø', '\u0003': 'å' }[c]; });
    s = s.replace(/mercedes[- ]benz/g, 'mercedes').replace(/volkswagen/g, 'vw');
    return s.replace(/[^a-z0-9æøå,.]+/g, ' ').split(' ').filter(function (w) { return w.length >= 2 || /^\d$/.test(w); });
  }
  /**
   * Bilerne på hjemmesiden sorteret efter, hvor godt de passer til bilen: [{ id, name, price, score }]. score ≥ 5 = et godt forslag.
   * Modellen (første ord efter mærket, fx "polo", "i20") SKAL stå i navnet – ellers højst 4 point, så samme mærke + samme pris aldrig giver et forkert forslag.
   */
  function matchWeb(car, list) {
    car = car || {};
    var cw = words([car.model, car.variant].join(' ')), price = num(car.listPrice);
    var make = cw[0] || '', model = cw[1] || '';
    return (list || []).map(function (x) {
      var ww = words(x.name), s = 0, has = function (w) { return ww.indexOf(w) >= 0 || ww.indexOf(w.replace('.', ',')) >= 0; };
      if (make && ww[0] === make) s += 2;
      cw.slice(1).forEach(function (w) { if (has(w)) s += 1; });
      if (price > 0 && x.price === price) s += 4;
      if (!model || !has(model)) s = Math.min(s, 4);
      return { id: x.id, name: x.name, price: x.price, score: s };
    }).sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
  }
  /** Renser en kobling: { id, mode } eller null (ingen kobling). Giver { web } eller { error }. */
  function cleanWeb(w) {
    if (w == null || w === '') return { web: null };
    if (typeof w !== 'object' || Array.isArray(w)) return { error: 'Koblingen til h-auto.dk kan ikke læses.' };
    var id = String(w.id || ''), mode = String(w.mode || 'redirect');
    if (!WEB_ID_RE.test(id)) return { error: 'Bilens nummer på h-auto.dk ser forkert ud.' };
    if (WEB_MODES.indexOf(mode) < 0) return { error: 'Ukendt valg for kundesiden.' };
    return { web: { id: id, mode: mode, name: htmlText(w.name).slice(0, 120) } };
  }

  // ---------------------------------------------------------------------------
  // Kundesiden: kun salgsoplysninger
  // ---------------------------------------------------------------------------
  var SOLD_STATUSES = ['Solgt', 'Udleveret', 'Reklamation'];
  function publicFirm(firm) {
    firm = firm || {};
    return { name: firm.name || '', phone: firm.phone || '', street: firm.street || '', city: firm.city || '', email: firm.email || '', hours: firm.hours || '' };
  }
  /** car: bilen (med extra.sign), udstyr: navne, today: 'YYYY-MM-DD'. Giver kun det, kunden må se. */
  function publicView(car, udstyr, firm, today) {
    var f = publicFirm(firm);
    if (!car || car.deleted === true || car.deleted === 'Ja' || SOLD_STATUSES.indexOf(car.status) >= 0) return { ok: true, sold: true, firm: f };
    var sign = car.extra && car.extra.sign && typeof car.extra.sign === 'object' ? car.extra.sign : {};
    // Kun de gyldige dele af de gemte valg bruges (et ukendt mærke fjernes, resten bliver).
    var so = sign.opts && typeof sign.opts === 'object' ? sign.opts : {};
    var o = cleanOpts({ label: Object.prototype.hasOwnProperty.call(LABELS, so.label) ? so.label : '', badges: (Array.isArray(so.badges) ? so.badges : []).filter(function (k) { return BADGE_KEYS.indexOf(String(k)) >= 0; }).slice(0, MAX_BADGES),
      equipment: [], warranty: clean(so.warranty, 30), hk: /^\d{1,4}$/.test(clean(so.hk)) ? clean(so.hk) : '' }).opts;
    var all = badges(car, udstyr, o, today), byKey = {};
    all.forEach(function (b) { byKey[b.key] = b.text; });
    var eq = suggestEquipment(udstyr);
    // Bilens side på h-auto.dk (adressen bygges altid her af et gyldigt nummer – aldrig en fri adresse)
    var wc = cleanWeb(car.extra && car.extra.web), web = wc.web ? { url: webUrl(wc.web.id), mode: wc.web.mode } : null;
    return {
      ok: true, sold: false, firm: f, web: web,
      car: {
        model: clean(car.model, 100), variant: titleOf(car) === clean(car.model) ? '' : clean(car.variant, 100), year: num(car.year) || '', km: num(car.km) || 0, fuel: clean(car.fuel, 40), color: clean(car.color, 40),
        hk: o.hk || '', price: num(car.listPrice) || 0, label: LABEL_NAMES[o.label] && o.label ? LABEL_NAMES[o.label] : '',
        badges: (o.badges || []).filter(function (k) { return byKey[k]; }).map(function (k) { return byKey[k]; }),
        equipment: eq.slice(0, 200)
      }
    };
  }

  return {
    URL_BASE: URL_BASE, CODE_RE: CODE_RE, CODE_LEN: CODE_LEN, MAX_CODES: MAX_CODES, LABELS: LABELS, LABEL_NAMES: LABEL_NAMES, BADGE_KEYS: BADGE_KEYS, BADGE_NAMES: BADGE_NAMES,
    MAX_BADGES: MAX_BADGES, WARN_BADGES: WARN_BADGES, MAX_EQUIP: MAX_EQUIP, PAGE_W: PAGE_W, PAGE_H: PAGE_H, MIN_PRICE_MM: MIN_PRICE_MM, titleOf: titleOf,
    newCode: newCode, validCode: validCode, url: url, badges: badges, suggestEquipment: suggestEquipment, defaultEquipment: defaultEquipment, clean: cleanOpts,
    printable: printable, textWidth: textWidth, fit: fit, priceText: priceText, fmtInt: fmtInt,
    qr: qr, gfMul: gfMul, layout: layout, toSvg: toSvg, toPdf: toPdf, publicView: publicView, publicFirm: publicFirm,
    WEB_LIST_URL: WEB_LIST_URL, WEB_MODES: WEB_MODES, WEB_MODE_NAMES: WEB_MODE_NAMES, webUrl: webUrl, parseWebList: parseWebList, matchWeb: matchWeb, cleanWeb: cleanWeb
  };
})();
if (typeof window !== 'undefined' && window.BA) window.BA.sign = SIGN_;
