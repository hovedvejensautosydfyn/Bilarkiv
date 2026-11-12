/* Små hjælpere, formatering og alle beregninger (samme regler som det gamle Bilarkiv). */
(function () {
  'use strict';
  var BA = window.BA = window.BA || {};
  var U = BA.u = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  U.pad = function (n) { return (n < 10 ? '0' : '') + n; };

  /** 16 tegn af a-z og 0-9 (serveren kræver 8-24). */
  U.uid = function () {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '';
    var buf = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 16; i++) out += chars.charAt(buf[i] % 36);
    return out;
  };

  U.today = function () {
    var d = new Date();
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };

  U.daysBetween = function (a, b) {
    if (!a || !b) return null;
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  };

  /** Dansk tal: "35.000" = 35000, "1.234,5" = 1234,5. Tom/ugyldig tekst giver null. */
  U.pnum = function (v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s|kr\.?|km/gi, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  };

  var nf = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 });
  U.num = function (v) { return v == null || v === '' || !isFinite(v) ? '' : nf2.format(v); };
  U.kr = function (v) { return v == null || !isFinite(v) ? '–' : nf.format(Math.round(v)) + ' kr'; };
  U.fmtN = function (v) { return v == null || v === '' || !isFinite(v) ? '' : nf.format(v); };
  U.fmtDate = function (s) { if (!s) return '–'; var p = String(s).split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : s; };
  U.fmtTime = function (ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return U.pad(d.getDate()) + '-' + U.pad(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };
  U.hours = function (v) { return v == null ? '–' : nf2.format(v) + ' t'; };

  U.plate = function (reg, large) {
    if (!reg) return '<span class="chip">Ingen reg.nr.</span>';
    var t = String(reg).toUpperCase().replace(/\s/g, '');
    var m = t.match(/^([A-ZÆØÅ]{2})(\d{2})(\d{3})$/);
    return '<span class="plate' + (large ? ' lg' : '') + '"><span>' + U.esc(m ? m[1] + ' ' + m[2] + ' ' + m[3] : t) + '</span></span>';
  };

  U.debounce = function (fn, ms) {
    var t = null;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  };

  U.sum = function (list, f) { return (list || []).reduce(function (s, x) { var n = U.pnum(x[f]); return s + (n || 0); }, 0); };

  U.safeStore = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ingen lagring */ } }
  };

  /** Kopiér tekst til udklipsholderen (med reserve til ældre browsere). Giver true/false. */
  U.copy = function (text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  };

  U.download = function (name, blob) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  };

  U.b64ToBlob = function (b64, mime) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  U.dataUrlToBlob = function (url) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(url || '');
    return m ? U.b64ToBlob(m[2], m[1]) : null;
  };

  // ---------- små begivenheder ----------
  var handlers = {};
  BA.on = function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); };
  BA.emit = function (evt, arg) { (handlers[evt] || []).slice().forEach(function (fn) { try { fn(arg); } catch (e) { if (window.console) console.error(evt, e); } }); };

  // ---------- bilens forløb ----------
  BA.STATUSES = ['Købt', 'Under transport', 'Ankommet', 'Gennemgået', 'Klargøring', 'Fotograferet', 'Annonceret', 'Solgt', 'Udleveret', 'Reklamation'];
  BA.SOLD_FROM = 7;
  BA.isSold = function (status) { return BA.STATUSES.indexOf(status) >= BA.SOLD_FROM; };
  BA.statusClass = function (status) {
    var i = BA.STATUSES.indexOf(status);
    if (i >= BA.SOLD_FROM) return status === 'Reklamation' ? 'bad' : 'ok';
    if (status === 'Under transport') return 'warn';
    if (status === 'Annonceret') return 'acc';
    return '';
  };
  BA.DOC_KINDS = ['Slutseddel', 'Køreseddel', 'Fuldmagt', 'Købsfaktura', 'Registreringsattest', 'Synsrapport', 'Servicebog', 'Værkstedsfaktura', 'Andet'];
  BA.MAX_PROFIT_HINT = 20000;

  // ---------- beregninger (som calc() i det gamle Bilarkiv) ----------
  /**
   * Udgifter = udgiftslinjer + faktisk pris på afkrydsede opgaver. Forventet ekstra = forventet pris på åbne opgaver.
   * Timer = timelinjer + faktiske timer på afkrydsede opgaver.
   */
  BA.calc = function (car, items, st) {
    var mine = (items || []).filter(function (i) { return i.carId === car.id; });
    var of = function (t) { return mine.filter(function (i) { return i.type === t; }); };
    var tasks = of('opgave');
    var buy = U.pnum(car.buyPrice) || 0;
    var exp = U.sum(of('udgift'), 'amount') + U.sum(tasks.filter(function (t) { return t.done; }), 'actPrice');
    var extra = U.sum(tasks.filter(function (t) { return !t.done; }), 'expPrice');
    var hrs = U.sum(of('time'), 'hours') + U.sum(tasks.filter(function (t) { return t.done; }), 'actHours');
    var claimsList = of('reklamation');
    var claims = U.sum(claimsList, 'amount');
    var disc = U.sum(claimsList.filter(function (c) { return c.kind === 'Afslag i pris'; }), 'amount');
    var vatRate = st && st.vat != null ? st.vat : 0.2;
    var cost = buy + exp;
    var sp = U.pnum(car.soldPrice), lp = U.pnum(car.listPrice);
    var sold = BA.isSold(car.status) && sp != null;
    var r = { buy: buy, exp: exp, extra: extra, hrs: hrs, cost: cost, claims: claims, disc: disc, sold: sold, vatBack: 0 };
    if (sold) {
      r.gross = sp - cost;
      r.vatSale = Math.max(0, sp - buy) * vatRate;
      r.vat = Math.max(0, sp - disc - buy) * vatRate;
      r.vatBack = r.vatSale - r.vat;
      r.atSale = r.gross - r.vatSale;
      r.current = r.atSale - claims + r.vatBack;
      r.base = r.current;
    } else if (lp != null) {
      r.expBefore = lp - cost - extra;
      r.expVat = Math.max(0, lp - buy) * vatRate;
      r.expected = r.expBefore - r.expVat;
      r.base = r.expected;
    }
    r.perHour = hrs > 0 && r.base != null ? r.base / hrs : null;
    var end = BA.isSold(car.status) && car.soldDate ? car.soldDate : U.today();
    // days = dage siden køb. listedDays = dage til salg: fra den dag, bilen blev sat til Annonceret (ellers fra købsdatoen, hvis bilen allerede er annonceret/solgt).
    r.days = car.boughtDate ? U.daysBetween(car.boughtDate, end) : null;
    var listed = car.listedDate || (BA.STATUSES.indexOf(car.status) >= 6 ? car.boughtDate : '');
    r.listedDays = listed ? Math.max(0, U.daysBetween(listed, end)) : null;
    return r;
  };

  /** "Kan det betale sig?" – en kort dom ud fra forventet avance og grænsen i indstillingerne. */
  BA.verdict = function (r, st) {
    if (r.sold) return null;
    if (r.expected == null) return { cls: '', text: 'Skriv en annonceret pris for at se forventet avance.' };
    var min = st && st.minProfit != null ? st.minProfit : BA.MAX_PROFIT_HINT;
    if (r.expected < 0) return { cls: 'bad', text: 'Bilen giver underskud ved den annoncerede pris (' + U.kr(r.expected) + ').' };
    if (r.expected < min) return { cls: 'warn', text: 'Forventet avance er under ' + U.kr(min) + ' (' + U.kr(r.expected) + '). Overvej prisen eller omkostningerne.' };
    return { cls: 'ok', text: 'Ser fornuftig ud: forventet avance ' + U.kr(r.expected) + ' efter brugtmoms.' };
  };

  // ---------- kopiér til AutoDesktop ----------
  BA.adFields = function (car, items) {
    var mine = (items || []).filter(function (i) { return i.carId === car.id; });
    var equip = mine.filter(function (i) { return i.type === 'udstyr'; }).map(function (i) { return i.name; });
    var defects = mine.filter(function (i) { return i.type === 'fejl' && !i.fixed; }).map(function (i) { return i.text + (i.note ? ' (' + i.note + ')' : ''); });
    var list = [
      ['Mærke og model', car.model], ['Variant', car.variant], ['Årgang', car.year], ['Km', car.km != null ? U.fmtN(car.km) : ''],
      ['Brændstof', car.fuel], ['Farve', car.color], ['1. registrering', car.firstReg ? U.fmtDate(car.firstReg) : ''], ['Stelnummer', car.vin],
      ['Reg.nr.', car.reg], ['Pris', car.listPrice != null ? U.fmtN(car.listPrice) : ''],
      ['Udstyr', equip.join(', ')], ['Fejl og mangler', defects.join('; ')], ['Noter', car.notes]
    ];
    return list.map(function (x) { return { label: x[0], value: x[1] == null ? '' : String(x[1]) }; });
  };
  BA.adAll = function (car, items) {
    // Noter er interne og kommer ikke med i "Kopiér alt" (de kan kopieres for sig).
    return BA.adFields(car, items).filter(function (f) { return f.value && f.label !== 'Noter'; }).map(function (f) { return f.label + ': ' + f.value; }).join('\n');
  };
})();
