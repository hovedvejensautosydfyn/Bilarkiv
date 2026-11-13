/* To-do-reglerne – ÉN fil, brugt af både appen (BA.todo) og serveren (TODO_ i Apps Script).
 *
 * Den er ren logik: ingen skærm, ingen Google, ingen tidszone-opslag (det får den udefra i ctx.local).
 * byg-deploy.ps1 lægger filen ind i deploy\Code.gs, så Telegram-påmindelserne bruger NØJAGTIG de samme regler som appen.
 *
 * compute(ctx) giver en sorteret liste af linjer: { key, kind, prio, carId, text, sub, at, label, action, ... }
 *   prio: 0 = Haster, 1 = I dag, 2 = Senere
 *   action: hvad knappen gør, når linjen krydses af:
 *     { kind: 'tick', tick: 'charge'|'pricecheck'|'regcert'|'dereg'|'dispute', carId }   (en ny tick-post på bilen)
 *     { kind: 'todo', id }      (egen opgave: done = true)
 *     { kind: 'booking', id }   (booking: done = true)
 *     null                      (kun en henvisning til bilen)
 * ctx = { now (ms), cars (ikke slettede), items (ikke slettede), settings, local(ms) -> 'YYYY-MM-DD HH:MM' (dansk tid) }
 * Alle tidspunkter er UTC-millisekunder (som statusAt på bilerne). Datoer er 'YYYY-MM-DD'.
 */
var TODO_ = (function () {
  'use strict';

  var ORDER = ['Købt', 'Under transport', 'Ankommet', 'Gennemgået', 'Klargøring', 'Fotograferet', 'Annonceret', 'Solgt', 'Udleveret', 'Reklamation'];
  var HOUR = 3600000, DAY = 86400000, NEVER = 9e15;
  var DEFAULTS = { priceCheckDays: [30, 45, 60], chargeHours: 48, morningHour: 8 };
  var TICK_KINDS = ['charge', 'pricecheck', 'regcert', 'dereg', 'dispute', 'invoice', 'paid', 'inspect', 'pickup'];
  // Salgsforløbet efter salg (Fase 3): ét skridt ad gangen, til bilen er Udleveret. [afkrydsning, hvad skal gøres, knaptekst]
  var SALE_STEPS = [['invoice', 'Send faktura til køber', 'Faktura sendt'], ['paid', 'Vent på betalingen', 'Betalt'], ['inspect', 'Synshal / indregistrering i kundens navn', 'Gjort'], ['pickup', 'Gør bilen klar til afhentning', 'Klar til afhentning']];
  /** Tjeklisterne (DOCS_ i Apps Script, BA.docs i appen). */
  function docsApi() {
    try {
      if (typeof DOCS_ !== 'undefined' && DOCS_) return DOCS_;
      if (typeof window !== 'undefined' && window.BA && window.BA.docs) return window.BA.docs;
    } catch (e) { /* ingen tjeklister */ }
    return null;
  }
  var BOOKING_KINDS = ['Prøvetur', 'Fremvisning'];
  var GROUPS = ['Haster', 'I dag', 'Senere'];
  var ARRIVAL_STATUSES = ['Ankommet', 'Gennemgået', 'Klargøring', 'Fotograferet', 'Annonceret'];
  var REPEAT_DAYS = 15;            // efter den sidste pris-grænse: tjek prisen igen hver 15. dag
  var DISPUTE_HOURS = 24;          // AutoProff: tvist-frist efter ankomst
  var CERT_DAYS = 3;               // registreringsattesten kommer med UPS 2-7 dage efter: mind efter 3 dage
  var BOOKING_GRACE = 2 * HOUR;    // en booking, der er mere end 2 timer gammel og ikke afkrydset, vises som "Markér som afholdt"

  function idx(status) { return ORDER.indexOf(status); }
  /** På lager til reglerne: Ankommet … Annonceret. */
  function onStock(car) { var i = idx(car.status); return i >= 2 && i <= 6; }
  function notSold(car) { var i = idx(car.status); return i < 7; }
  function carLabel(c) { var t = ((c.reg ? c.reg + ' ' : '') + (c.model || '')).trim(); return t || 'bilen'; }

  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null;
  }
  function addDaysIso(iso, n) {
    var d = dayNum(iso);
    return d === null ? '' : new Date((d + n) * DAY).toISOString().slice(0, 10);
  }
  function fmtIso(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : String(iso || ''); }

  /** "12 t 30 min", "45 min", "2 d 3 t" (afrundet nedad til hele minutter). */
  function fmtLeft(ms) {
    var mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h < 24) return h + ' t' + (m ? ' ' + m + ' min' : '');
    var d = Math.floor(h / 24), hh = h % 24;
    return d + ' d' + (hh ? ' ' + hh + ' t' : '');
  }
  function fmtAgo(ms) {
    if (ms < 60000) return 'lige nu';
    var h = ms / HOUR;
    if (h < 1) return 'for ' + Math.floor(ms / 60000) + ' min siden';
    if (h < 24) return 'for ' + Math.floor(h) + ' t siden';
    var d = Math.floor(h / 24);
    return 'for ' + d + (d === 1 ? ' dag' : ' dage') + ' siden';
  }

  function settingsOf(st) {
    st = st || {};
    var days = Array.isArray(st.priceCheckDays) ? st.priceCheckDays.map(Number).filter(function (n) { return isFinite(n) && n >= 1; }) : [];
    days.sort(function (a, b) { return a - b; });
    var uniq = days.filter(function (n, i) { return i === 0 || n !== days[i - 1]; });
    var ch = Number(st.chargeHours), mh = Number(st.morningHour);
    return {
      priceCheckDays: uniq.length ? uniq : DEFAULTS.priceCheckDays.slice(),
      chargeHours: isFinite(ch) && ch >= 1 ? ch : DEFAULTS.chargeHours,
      morningHour: isFinite(mh) && mh >= 0 && mh <= 23 ? mh : DEFAULTS.morningHour,
      channels: Array.isArray(st.channels) ? st.channels : []
    };
  }
  /** Kanalens flag. Mangler flaget (gamle indstillinger), udledes det af navnet: AutoProff har tvist-ur, Byttebil og Privat skal afmeldes/omregistreres. */
  function channelFlag(st, channelName, key) {
    var name = String(channelName || '').trim().toLowerCase();
    var list = st.channels || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].name || '').trim().toLowerCase() === name) {
        if (typeof list[i][key] === 'boolean') return list[i][key];
        break;
      }
    }
    if (key === 'dispute') return name === 'autoproff';
    if (key === 'dereg') return name === 'byttebil' || name === 'privat';
    return false;
  }
  /** Er kanalen en transport-kanal (bilen kommer med transport, fx AutoProff)? Mangler flaget i indstillingerne, udledes det af navnet. */
  function channelTransit(st, channelName) {
    var name = String(channelName || '').trim().toLowerCase(), list = st.channels || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].name || '').trim().toLowerCase() === name) { if (typeof list[i].transit === 'boolean') return list[i].transit; break; }
    }
    return name === 'autoproff';
  }
  /**
   * Hvornår kom bilen? Det TIDLIGSTE statusAt-stempel blandt Ankommet … Annonceret (og for en kanal uden transport også Købt: bilen er jo hos dig med det samme).
   * Så et oversprunget "Ankommet" ikke slår tvist-ur, attest og afmeld ihjel. En bil helt uden stempler (kom ind før fase 2) giver 0 = ingen automatiske linjer.
   */
  function arrivedAt(car, st) {
    var sa = car && car.extra && car.extra.statusAt;
    if (!sa || typeof sa !== 'object') return 0;
    // Kun biler oprettet i Bilarkiv 2 (de har et Købt- eller Under transport-stempel fra createCar). Biler overført fra det gamle program har ingen
    // stempler, og et enkelt stempel fra fx "Fortryd salg" (Annonceret) må ikke give dem falske tvist-/attest-/afmeld-linjer.
    var born = function (s) { return typeof sa[s] === 'number' && sa[s] > 0; };
    if (!born('Købt') && !born('Under transport')) return 0;
    st = st || settingsOf({});
    var list = ARRIVAL_STATUSES.slice();
    if (!channelTransit(st, car.channel)) list.unshift('Købt');
    var best = 0;
    list.forEach(function (s) { var t = sa[s]; if (typeof t === 'number' && t > 0 && (!best || t < best)) best = t; });
    return best;
  }

  /** Seneste tick pr. (bil, art). */
  function tickIndex(items, carById) {
    var last = {};
    (items || []).forEach(function (it) {
      if (it.type !== 'tick' || it.deleted || !carById[it.carId] || typeof it.at !== 'number') return;
      var k = it.carId + '|' + it.kind;
      if (!(k in last) || it.at > last[k]) last[k] = it.at;
    });
    return last;
  }
  function lastTick(items, carId, kind) {
    var best = 0;
    (items || []).forEach(function (it) { if (it.type === 'tick' && !it.deleted && it.carId === carId && it.kind === kind && typeof it.at === 'number' && it.at > best) best = it.at; });
    return best;
  }

  function byId(cars) { var m = {}; (cars || []).forEach(function (c) { m[c.id] = c; }); return m; }

  /** Laderen: hvornår skal den flyttes, og hvortil? Giver { lastAny, nextDue, due, targetId, active }. */
  function chargeInfo(ctx) {
    var st = settingsOf(ctx.settings), cars = ctx.cars || [], map = byId(cars), last = tickIndex(ctx.items, map);
    var lastAny = 0, lastId = '';
    cars.forEach(function (c) { var t = last[c.id + '|charge']; if (t && t > lastAny) lastAny = t; });
    // id på den seneste afkrydsning = "runden" (bruges som stabil nøgle til Telegram-beskeden)
    (ctx.items || []).forEach(function (it) { if (it.type === 'tick' && !it.deleted && it.kind === 'charge' && map[it.carId] && it.at === lastAny && (!lastId || it.id < lastId)) lastId = it.id; });
    var active = cars.filter(onStock);
    var nextDue = lastAny ? lastAny + st.chargeHours * HOUR : 0;
    var target = null;
    active.forEach(function (c) {
      var a = last[c.id + '|charge'] || 0;
      if (!target) { target = { car: c, last: a }; return; }
      var better = a < target.last || (a === target.last && (String(c.boughtDate || '9999') < String(target.car.boughtDate || '9999') || (String(c.boughtDate || '9999') === String(target.car.boughtDate || '9999') && String(c.id) < String(target.car.id))));
      if (better) target = { car: c, last: a };
    });
    return { lastAny: lastAny, lastId: lastId, nextDue: nextDue, due: !!target && ctx.now >= nextDue, targetId: target ? target.car.id : '', targetLast: target ? target.last : 0, active: active.length };
  }

  function bookingText(b, car, local, withDate) {
    var l = local(b.start);
    var when = (withDate ? l.slice(8, 10) + '-' + l.slice(5, 7) + ' ' : '') + 'kl. ' + l.slice(11, 16);
    return (b.kind || 'Prøvetur') + ' ' + when + ' – ' + carLabel(car);
  }
  function bookingSub(b) {
    return [b.who, b.phone, b.note].filter(Boolean).join(' · ');
  }

  /** Kommende bookinger (ikke afkrydsset, ikke aflyst) fra nu − 2 t og de næste "days" dage, sorteret. Giver [{ booking, car }]. */
  function bookings(ctx, days) {
    var map = byId(ctx.cars), out = [];
    (ctx.items || []).forEach(function (it) {
      if (it.type !== 'booking' || it.deleted || it.done || it.cancelled || typeof it.start !== 'number') return;
      var car = map[it.carId]; if (!car) return;
      if (it.start < ctx.now - BOOKING_GRACE || it.start > ctx.now + days * DAY) return;
      out.push({ booking: it, car: car });
    });
    out.sort(function (a, b) { return a.booking.start - b.booking.start || (a.booking.id < b.booking.id ? -1 : 1); });
    return out;
  }

  function compute(ctx) {
    var now = ctx.now, st = settingsOf(ctx.settings), local = ctx.local;
    var today = local(now).slice(0, 10);
    var cars = ctx.cars || [], items = ctx.items || [], map = byId(cars), last = tickIndex(items, map);
    var out = [];
    function add(e) { e.at = typeof e.at === 'number' ? e.at : NEVER; out.push(e); }

    // 1. Laderen (én lader i rotation)
    var ci = chargeInfo(ctx);
    if (ci.due && ci.targetId) {
      var tc = map[ci.targetId];
      var overdue = ci.lastAny ? now - ci.nextDue : 0;
      add({ key: 'charge', kind: 'charge', prio: overdue >= DAY ? 0 : 1, carId: tc.id, text: 'Sæt laderen på ' + carLabel(tc),
        sub: ci.targetLast ? 'Denne bil blev sidst ladet ' + fmtAgo(now - ci.targetLast) : 'Denne bil er ikke ladet endnu',
        at: ci.nextDue || now, label: 'Ladet', lastAny: ci.lastAny, lastId: ci.lastId, action: { kind: 'tick', tick: 'charge', carId: tc.id } });
    }

    cars.forEach(function (c) {
      var arr = arrivedAt(c, st);
      if (onStock(c)) {
        // 2. Pristjek: 30/45/60 dage (kan indstilles), derefter hver 15. dag
        var bd = dayNum(c.boughtDate), td = dayNum(today);
        if (bd !== null && td !== null) {
          var days = td - bd, th = st.priceCheckDays, tmax = null;
          for (var i = 0; i < th.length; i++) if (th[i] <= days) tmax = th[i];
          var lastT = th[th.length - 1];
          if (tmax !== null && days > lastT) tmax = lastT + Math.floor((days - lastT) / REPEAT_DAYS) * REPEAT_DAYS;
          if (tmax !== null) {
            var dueDate = addDaysIso(c.boughtDate, tmax), lt = last[c.id + '|pricecheck'];
            if (!(lt && local(lt).slice(0, 10) >= dueDate)) {
              add({ key: 'price:' + c.id, kind: 'pricecheck', prio: 1, carId: c.id, text: carLabel(c) + ' har stået i ' + days + ' dage – tjek prisen',
                sub: 'Grænse: ' + tmax + ' dage', at: dayNum(dueDate) * DAY, label: 'Pris tjekket', action: { kind: 'tick', tick: 'pricecheck', carId: c.id } });
            }
          }
        }
      }
      // De tre ankomst-regler gælder alle biler, der ikke er solgt, og som har et ankomsttidspunkt (arrivedAt): også en bil, der sprang
      // "Ankommet" over, og en Privat/Byttebil, der står på "Købt". Biler helt uden stempler (kom ind før fase 2) får dem ikke.
      if (arr && notSold(c)) {
        // 3. Tvist-ur (24 timer efter ankomst, hvis kanalen har det). Forsvinder først, når det er krydset af – men 24 t efter fristen er den ikke "Haster" mere.
        if (channelFlag(st, c.channel, 'dispute') && !last[c.id + '|dispute']) {
          var deadline = arr + DISPUTE_HOURS * HOUR, left = deadline - now;
          add({ key: 'dispute:' + c.id, kind: 'dispute', prio: left < -DAY ? 2 : (left < 6 * HOUR ? 0 : 1), carId: c.id, text: 'Tvist-frist på ' + carLabel(c),
            sub: left > 0 ? fmtLeft(left) + ' tilbage' : 'Fristen er overskredet for ' + fmtLeft(-left) + ' siden',
            at: deadline, deadline: deadline, label: 'Afklaret', action: { kind: 'tick', tick: 'dispute', carId: c.id } });
        }
        // 4. Registreringsattest: kun for transport-kanaler (AutoProff m.fl.): attesten kommer med UPS 2-7 dage efter. Ved køb fra privat får du den i hånden.
        if (channelTransit(st, c.channel) && !last[c.id + '|regcert'] && now >= arr + CERT_DAYS * DAY) {
          var since = now - arr;
          add({ key: 'regcert:' + c.id, kind: 'regcert', prio: since >= 7 * DAY ? 0 : 1, carId: c.id, text: 'Mangler registreringsattest på ' + carLabel(c),
            sub: 'Bilen ankom ' + fmtAgo(since), at: arr + CERT_DAYS * DAY, label: 'Modtaget', action: { kind: 'tick', tick: 'regcert', carId: c.id } });
        }
        // 5. Afmeld / omregistrer
        if (channelFlag(st, c.channel, 'dereg') && !last[c.id + '|dereg']) {
          add({ key: 'dereg:' + c.id, kind: 'dereg', prio: 1, carId: c.id, text: 'Afmeld / omregistrer ' + carLabel(c),
            sub: 'Købt via ' + (c.channel || 'privat'), at: arr, label: 'Gjort', action: { kind: 'tick', tick: 'dereg', carId: c.id } });
        }
      }
    });

    // 5b. Tjeklister (Fase 3): gennemgang ved ankomst og klargøring – en rolig linje med fremdrift, indtil listen er besvaret
    var docs = docsApi();
    if (docs) cars.forEach(function (c) {
      var arr2 = arrivedAt(c, st);
      if (c.status === 'Ankommet') {
        var pg = docs.progress('gennemgang', items, c.id);
        if (pg.done < pg.total) add({ key: 'gen:' + c.id, kind: 'gennemgang', prio: arr2 && now - arr2 >= DAY ? 1 : 2, carId: c.id, text: 'Gennemgang af ' + carLabel(c) + ': ' + pg.done + ' af ' + pg.total,
          sub: pg.fejl ? pg.fejl + (pg.fejl === 1 ? ' fejl fundet' : ' fejl fundet') : 'Tjeklisten ligger på bilen', at: arr2 || NEVER, label: '', action: null });
      }
      if (c.status === 'Klargøring') {
        var pk = docs.progress('klargoering', items, c.id);
        if (pk.done < pk.total) add({ key: 'klar:' + c.id, kind: 'klargoering', prio: 2, carId: c.id, text: 'Klargøring af ' + carLabel(c) + ': ' + pk.done + ' af ' + pk.total,
          sub: 'Tjeklisten ligger på bilen', at: NEVER, label: '', action: null });
      }
    });

    // 5c. Salgsforløb (Fase 3): efter salget og til bilen er Udleveret – ét skridt ad gangen
    cars.forEach(function (c) {
      if (c.status !== 'Solgt') return;
      var step = null;
      for (var si = 0; si < SALE_STEPS.length; si++) { if (!last[c.id + '|' + SALE_STEPS[si][0]]) { step = SALE_STEPS[si]; break; } }
      if (!step) return;
      var done = si;
      add({ key: 'sale:' + c.id, kind: 'sale', prio: 1, carId: c.id, text: 'Solgt – ' + carLabel(c) + ': ' + step[1], sub: 'Skridt ' + (done + 1) + ' af ' + SALE_STEPS.length,
        at: (c.extra && c.extra.statusAt && c.extra.statusAt.Solgt) || NEVER, label: step[2], action: { kind: 'tick', tick: step[0], carId: c.id } });
    });

    // 6. Bookinger: i dag, og forfaldne
    items.forEach(function (it) {
      if (it.type !== 'booking' || it.deleted || it.done || it.cancelled || typeof it.start !== 'number') return;
      var car = map[it.carId]; if (!car) return;
      if (it.start < now - BOOKING_GRACE) {
        add({ key: 'booking:' + it.id, kind: 'booking', prio: 0, carId: car.id, text: 'Markér som afholdt: ' + bookingText(it, car, local, true), sub: bookingSub(it),
          at: it.start, label: 'Afholdt', id: it.id, action: { kind: 'booking', id: it.id } });
      } else if (local(it.start).slice(0, 10) === today) {
        add({ key: 'booking:' + it.id, kind: 'booking', prio: 1, carId: car.id, text: bookingText(it, car, local, false), sub: bookingSub(it),
          at: it.start, label: 'Afholdt', id: it.id, start: it.start, action: { kind: 'booking', id: it.id } });
      }
    });

    // 7. Egne opgaver
    items.forEach(function (it) {
      if (it.type !== 'todo' || it.deleted || it.done) return;
      var car = it.carId ? map[it.carId] : null;
      if (it.carId && !car) return;
      var due = it.due || '';
      var prio = due && due < today ? 0 : (due && due === today ? 1 : 2);
      var sub = due ? (due < today ? 'Forfaldt ' + fmtIso(due) : (due === today ? 'I dag' : 'Frist ' + fmtIso(due))) : '';
      if (car) sub = (sub ? sub + ' · ' : '') + 'Bil: ' + carLabel(car);
      if (it.note) sub = (sub ? sub + ' · ' : '') + it.note;
      add({ key: 'todo:' + it.id, kind: 'todo', prio: prio, carId: it.carId || '', text: it.text, sub: sub, at: due ? dayNum(due) * DAY : NEVER, label: 'Udført', id: it.id, action: { kind: 'todo', id: it.id } });
    });

    // 8. Åbne opgaver på bilerne (kun en henvisning)
    var open = {};
    items.forEach(function (it) { if (it.type === 'opgave' && !it.deleted && !it.done && map[it.carId] && notSold(map[it.carId])) open[it.carId] = (open[it.carId] || 0) + 1; });
    Object.keys(open).forEach(function (id) {
      var n = open[id];
      add({ key: 'tasks:' + id, kind: 'tasks', prio: 2, carId: id, text: carLabel(map[id]) + ': ' + n + (n === 1 ? ' opgave åben' : ' opgaver åbne'), sub: '', at: NEVER, label: '', action: null });
    });

    out.sort(function (a, b) { return a.prio - b.prio || a.at - b.at || (a.text < b.text ? -1 : a.text > b.text ? 1 : (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); });
    return out;
  }

  /** Antal der kræver handling nu (Haster + I dag): tallet på fanen. */
  function count(list) { return (list || []).filter(function (e) { return e.prio <= 1; }).length; }

  return {
    ORDER: ORDER, DEFAULTS: DEFAULTS, TICK_KINDS: TICK_KINDS, SALE_STEPS: SALE_STEPS, BOOKING_KINDS: BOOKING_KINDS, GROUPS: GROUPS,
    compute: compute, count: count, chargeInfo: chargeInfo, bookings: bookings, lastTick: lastTick, settingsOf: settingsOf, channelFlag: channelFlag,
    carLabel: carLabel, fmtLeft: fmtLeft, fmtAgo: fmtAgo, fmtIso: fmtIso, dayNum: dayNum, addDaysIso: addDaysIso, bookingText: bookingText, bookingSub: bookingSub,
    onStock: onStock, arrivedAt: arrivedAt, channelTransit: channelTransit
  };
})();
if (typeof window !== 'undefined' && window.BA) window.BA.todo = TODO_;
