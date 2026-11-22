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

  // ---------------------------------------------------------------------------
  // Bilens forløb (Fase 5): Købt → Gennemgang → Klargøring → Til salg → Solgt → Udleveret.
  // Det gemte status-navn er uændret ("Ankommet" = Gennemgang, "Annonceret" = Til salg), og de gamle trin (Under transport, Gennemgået,
  // Fotograferet) lægges ind under det nærmeste nye trin, så eksisterende biler virker uden at blive flyttet.
  // ---------------------------------------------------------------------------
  var STAGE_LABELS = { 'Købt': 'Købt', 'Ankommet': 'Gennemgang', 'Klargøring': 'Klargøring', 'Annonceret': 'Til salg', 'Solgt': 'Solgt', 'Udleveret': 'Udleveret', 'Reklamation': 'Reklamation' };
  var LEGACY_STAGE = { 'Under transport': 'Købt', 'Gennemgået': 'Ankommet', 'Fotograferet': 'Klargøring' };
  var STAGE_PATH = ['Købt', 'Ankommet', 'Klargøring', 'Annonceret', 'Solgt', 'Udleveret'];
  var MIN_PHOTOS = 10;             // billeder, før en bil kan sættes til salg (kan springes over med en begrundelse)
  function isTrade(chan) { return /^byttebil$/i.test(String(chan || '').trim()); }
  function stageOf(status) { return LEGACY_STAGE[status] || status; }
  function stageLabel(status) { var s = stageOf(status); return STAGE_LABELS[s] || s; }

  function idx(status) { return ORDER.indexOf(status); }
  /** På lager til reglerne: Ankommet … Annonceret. */
  function onStock(car) { var i = idx(car.status); return i >= 2 && i <= 6; }
  function notSold(car) { var i = idx(car.status); return i < 7; }
  function carLabel(c) { var t = ((c.reg ? c.reg + ' ' : '') + (c.model || '')).trim(); return t || 'bilen'; }
  function fmtKr(n) { var s = String(Math.round(+n || 0)), out = ''; while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); } return s + out + ' kr.'; }

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
    // En byttebil er heller ikke din, før du har trykket Overtaget (du overtager den, når kunden henter sin bil)
    if (!channelTransit(st, car.channel) && !isTrade(car.channel)) list.unshift('Købt');
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

  // ---------------------------------------------------------------------------
  // Bilens forløb og låsen (Fase 5)
  // ---------------------------------------------------------------------------
  /**
   * Et krav kan besvares på tre måder: af sig selv (det er gjort), ved at du bekræfter det ("ok" på en tjek-post i listen "krav"),
   * eller ved at du siger "ikke relevant" med en begrundelse ("ikke"). Der er én post pr. (bil, krav) – se DOCS_.tjekId.
   */
  function kravItem(items, carId, key) {
    var best = null;
    (items || []).forEach(function (it) {
      if (it.type !== 'tjek' || it.deleted || it.carId !== carId || it.list !== 'krav' || it.key !== key) return;
      if (!best || (it.updatedAt || 0) >= (best.updatedAt || 0)) best = it;
    });
    return best;
  }
  function itemsOfCar(items, carId, type) {
    return (items || []).filter(function (it) { return it.type === type && !it.deleted && it.carId === carId; });
  }
  function photoCount(items, carId) {
    return itemsOfCar(items, carId, 'fil').filter(function (f) { return f.kind === 'photo' && !f.parent; }).length;
  }
  /** Registreringsattesten er modtaget og lagt i mappen: afkrydset, ELLER der ligger en fil af typen "Registreringsattest" på bilen. */
  function regcertDone(items, carId) {
    if (lastTick(items, carId, 'regcert')) return true;
    return itemsOfCar(items, carId, 'fil').some(function (f) { return f.kind === 'Registreringsattest'; });
  }
  function isLevering(t) { return t.phase === 'levering'; }
  /** Hvor bilen er annonceret (rullemenuen "Annonceret" på bilen): tjek-poster i listen krav med nøglen annonce_<sted>, state ok. */
  var AD_CHANNELS = [['bilinfo', 'Bilinfo'], ['autodesktop', 'AutoDesktop'], ['facebook', 'Facebook Marketplace'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']];
  function adOn(items, carId, key) { var k = kravItem(items, carId, 'annonce_' + key); return !!k && k.state === 'ok'; }
  /** Tvist-fristen er afklaret: afkrydset, eller du har sagt "ikke relevant" (med begrundelse) til kravet på Klargøring. */
  function disputeSettled(items, carId) {
    if (lastTick(items, carId, 'dispute')) return true;
    var k = kravItem(items, carId, 'tvist');
    return !!k && k.state === 'ikke';
  }
  /**
   * Trinnet bilen stod på, før den blev solgt (fra statusHistory). "Fortryd salg" sætter bilen tilbage dér, så et salg før annoncering ikke bagefter gør bilen "til salg"
   * uden at kravene er klaret. Uden historik (biler fra det gamle program): Annonceret, som før.
   */
  function statusBeforeSale(car) {
    var h = car && car.extra && Array.isArray(car.extra.statusHistory) ? car.extra.statusHistory : [];
    for (var i = h.length - 1; i >= 0; i--) { var s = h[i] && h[i].s; if (idx(s) >= 0 && idx(s) < 7) return s; }
    return 'Annonceret';
  }
  /** Punkter i gennemgangen, der er svaret "Fejl" på, men som endnu ikke er blevet til en fejl/mangel eller en opgave (deres tekst begynder med punktets tekst). */
  function unhandledFinds(items, carId, docs, prog) {
    var labels = {}; docs.listItems('gennemgang').forEach(function (i) { labels[i.k] = i.t; });
    var fejl = itemsOfCar(items, carId, 'fejl'), opg = itemsOfCar(items, carId, 'opgave'), out = [];
    Object.keys(prog.byKey).forEach(function (k) {
      var lab = labels[k]; if (!lab || prog.byKey[k].state !== 'fejl') return;
      var has = fejl.some(function (f) { return String(f.text).indexOf(lab) === 0; }) || opg.some(function (o) { return String(o.text).indexOf(lab) === 0; });
      if (!has) out.push(k);
    });
    return out;
  }

  /**
   * Hvor står bilen, hvad mangler der, og hvad er næste knap? ctx = { items, settings, now, belowMin(car) -> true/false/null }.
   * Giver { stage, label, next: { to, label, sale? }, reqs, open, locked, warnings, guide, levering: { open, done } }
   *   reqs: [{ key, short, text, ok, auto, manual, skipped, confirmed, skippable, detail, why, action }]
   *   locked = der mangler noget (knappen til næste trin er låst). Køres ens i appen og på serveren.
   */
  function flow(car, ctx) {
    ctx = ctx || {};
    var st = settingsOf(ctx.settings), chan = car.channel;
    // Kun bilens egne poster (compute() giver en færdig opdeling pr. bil med, så en stor lagerliste ikke gennemløbes igen og igen)
    var items = ctx.byCar ? (ctx.byCar[car.id] || []) : (ctx.items || []).filter(function (it) { return it.carId === car.id; });
    var stage = stageOf(car.status), docs = docsApi();
    var out = { stage: stage, label: STAGE_LABELS[stage] || stage, reqs: [], warnings: [], next: null, guide: [], open: 0, locked: false, levering: { open: [], done: 0 } };
    var tasks = itemsOfCar(items, car.id, 'opgave');
    // Fra Til salg og frem hører ALLE åbne opgaver til "før levering" (også dem, der er lavet på andre måder end med hurtigfeltet, og dem, der var åbne, før bilen blev sat til salg).
    var late = stage === 'Annonceret' || stage === 'Solgt';
    out.levering.open = tasks.filter(function (t) { return !t.done && (late || isLevering(t)); });
    out.levering.done = tasks.filter(function (t) { return t.done && (late || isLevering(t)); }).length;

    function add(key, short, text, autoOk, o) {
      o = o || {};
      var k = kravItem(items, car.id, key), state = k ? k.state : '';
      // Et krav, der skal bekræftes (manual), kan ikke springes over: bekræftelsen ER din godkendelse. "pris" kan heller ikke springes over.
      var skipped = state === 'ikke' && o.skippable !== false && !o.manual, confirmed = !!o.manual && state === 'ok';
      out.reqs.push({ key: key, short: short, text: text, auto: !!autoOk, manual: !!o.manual, skipped: skipped, confirmed: confirmed, ok: !!autoOk || skipped || confirmed,
        skippable: o.skippable !== false && !o.manual, detail: o.detail || '', why: skipped ? String((k && k.note) || '') : '', action: o.action || null });
    }

    if (stage === 'Købt') {
      var trade = isTrade(chan);
      out.next = { to: 'Ankommet', label: trade ? 'Overtaget' : 'Modtaget' };
      out.guide = trade
        ? ['Byttebilen er aftalt og købsaftalen er skrevet under, men bilen er ikke din endnu.', 'Du overtager den, når kunden henter sin bil. Tryk Overtaget, når du har den.', 'Tjek ved overtagelsen: begge nøgler, servicebog og registreringsattest. Så skal bilen afmeldes eller omregistreres.']
        : ['Bilen er købt.', 'Når den står hos dig, så tryk ' + out.next.label + '.' + (channelFlag(st, chan, 'dispute') ? ' Så starter tvist-uret på 24 timer.' : '')];
    } else if (stage === 'Ankommet') {
      var g = docs ? docs.progress('gennemgang', items, car.id) : { done: 0, total: 0, fejl: 0 };
      var finds = docs && g.total > 0 ? unhandledFinds(items, car.id, docs, g) : [];
      add('gennemgang', 'gennemgang', 'Gennemgangen er besvaret, og alle fund er gjort til fejl eller opgaver', (g.total > 0 ? g.done >= g.total : true) && finds.length === 0,
        { detail: g.done + ' af ' + g.total + (g.fejl ? ' · ' + g.fejl + ' fejl fundet' : '') + (finds.length ? ' · ' + finds.length + (finds.length === 1 ? ' fund mangler at blive til en fejl eller opgave' : ' fund mangler at blive til fejl eller opgaver') : ''), action: { t: 'checklist', list: 'gennemgang' } });
      out.next = { to: 'Klargøring', label: 'Gennemgået' };
      out.guide = ['Gå bilen igennem (ca. 1 time, med prøvetur). Tryk OK, Fejl eller Ikke relevant ved hvert punkt.', 'Et fund kan med ét tryk blive til en fejl/mangel eller en opgave.', 'Skriv ekstra ting, der skal laves før annoncering, i feltet herunder.'];
    } else if (stage === 'Klargøring') {
      if (channelFlag(st, chan, 'dispute') && arrivedAt(car, st)) {
        add('tvist', 'tvist-frist', 'Tvist-fristen er afklaret', lastTick(items, car.id, 'dispute') > 0, { action: { t: 'tick', tick: 'dispute', label: 'Afklaret' } });
      }
      var openDef = itemsOfCar(items, car.id, 'fejl').filter(function (d) { return !d.fixed && !d.accepted; });
      add('fejl', 'fejl og mangler', 'Alle fejl og mangler er afgjort (udbedret eller accepteret af dig)', openDef.length === 0,
        { detail: openDef.length ? openDef.length + (openDef.length === 1 ? ' mangler at blive afgjort' : ' mangler at blive afgjort') : '', action: { t: 'goto', id: 's-defects' } });
      var openTasks = tasks.filter(function (t) { return !isLevering(t) && !t.done; });
      add('opgaver', 'opgaver', 'Alle opgaver er lavet', openTasks.length === 0, { detail: openTasks.length ? openTasks.length + ' åbne' : '', action: { t: 'goto', id: 's-tasks' } });
      var pk = docs ? docs.progress('klargoering', items, car.id) : { done: 0, total: 0 };
      add('klargoering', 'klargøringsliste', 'Klargøringslisten er færdig', pk.total > 0 ? pk.done >= pk.total : true, { detail: pk.done + ' af ' + pk.total, action: { t: 'checklist', list: 'klargoering' } });
      var pn = photoCount(items, car.id);
      add('billeder', 'billeder', 'Mindst ' + MIN_PHOTOS + ' billeder (ét er forsiden)', pn >= MIN_PHOTOS, { detail: pn + ' af ' + MIN_PHOTOS, action: { t: 'photos' } });
      add('udstyr', 'udstyr', 'Udstyr er skrevet ind', itemsOfCar(items, car.id, 'udstyr').length > 0, { action: { t: 'goto', id: 's-equip' } });
      var hasPrice = +car.listPrice > 0;
      add('pris', 'pris', 'Annonceret pris er sat', hasPrice, { skippable: false, action: { t: 'goto', id: 's-data' } });
      if (hasPrice && typeof ctx.belowMin === 'function' && ctx.belowMin(car) === true) {
        add('avance', 'avance', 'Avancen er under grænsen – jeg accepterer den', false, { manual: true, action: { t: 'goto', id: 's-econ' } });
      }
      // Sættes kryds ved både Bilinfo og AutoDesktop i rullemenuen "Annonceret" øverst på bilen, er kravet klaret; ellers kan du bekræfte det her
      var onBi = adOn(items, car.id, 'bilinfo'), onAd = adOn(items, car.id, 'autodesktop');
      add('annonce', 'annonce', 'Annoncen er lagt op på AutoDesktop og Bilinfo', onBi && onAd, { manual: true, detail: onBi && onAd ? '' : (onBi ? 'Bilinfo ✓ · AutoDesktop mangler' : onAd ? 'AutoDesktop ✓ · Bilinfo mangler' : 'Sæt kryds under “Annonceret” øverst, eller tryk Det er gjort'), action: { t: 'ad' } });
      out.next = { to: 'Annonceret', label: 'Klargjort + til salg' };
      out.guide = ['Lav det, der står på listen herunder. Bilen kan først sættes til salg, når alt er gjort.', 'Skal der laves noget ekstra, som ikke er standard, før bilen annonceres? Skriv det i feltet herunder – så kan bilen ikke sættes til salg, før det er lavet.'];
    } else if (stage === 'Annonceret') {
      out.next = { to: 'Solgt', label: 'Markér som solgt', sale: true };
      out.guide = ['Bilen er til salg. Under “Hvis nogen spørger” står alt, du skal bruge til kunden.', 'Skal der laves noget, før bilen kan leveres? Skriv det i feltet herunder – bilen kan ikke markeres udleveret, før det er lavet.'];
    } else if (stage === 'Solgt') {
      add('levering', 'før levering', 'Alt, der skulle laves før levering, er lavet', out.levering.open.length === 0,
        { detail: out.levering.open.length ? out.levering.open.length + ' åbne' : '', action: { t: 'goto', id: 's-tasks' } });
      SALE_STEPS.forEach(function (s) {
        add('salg_' + s[0], s[1].toLowerCase(), s[1], lastTick(items, car.id, s[0]) > 0, { action: { t: 'tick', tick: s[0], label: s[2] } });
      });
      out.next = { to: 'Udleveret', label: 'Udleveret' };
      out.guide = ['Bilen er solgt. Gå listen igennem, indtil den er udleveret.', 'Skriv ekstra ting, der skal laves før levering, i feltet herunder.'];
    }

    // Advarsler: de blokerer ikke, men skal ses. Registreringsattesten (kommer med UPS efter 2-7 dage).
    if (['Ankommet', 'Klargøring', 'Annonceret', 'Solgt'].indexOf(stage) >= 0 && channelTransit(st, chan) && arrivedAt(car, st) && !regcertDone(items, car.id)) {
      out.warnings.push({ key: 'regcert', text: 'Registreringsattesten er ikke modtaget og lagt i mappen endnu.', action: { t: 'tick', tick: 'regcert', label: 'Modtaget' } });
    }
    // Afmeld/omregistrer (byttebil og privat): en advarsel og en afkrydsning, ikke en lås
    if (['Ankommet', 'Klargøring', 'Annonceret', 'Solgt'].indexOf(stage) >= 0 && channelFlag(st, chan, 'dereg') && arrivedAt(car, st) && !lastTick(items, car.id, 'dereg')) {
      out.warnings.push({ key: 'dereg', text: 'Bilen er ikke afmeldt eller omregistreret endnu.', action: { t: 'tick', tick: 'dereg', label: 'Gjort' } });
    }
    // Tvist-fristen (AutoProff): på Klargøring er den et krav; på Gennemgang og Solgt (en bil kan sælges få timer efter ankomsten) er den en advarsel
    if ((stage === 'Ankommet' || stage === 'Solgt') && channelFlag(st, chan, 'dispute') && arrivedAt(car, st) && !disputeSettled(items, car.id)) {
      out.warnings.push({ key: 'tvist', text: 'Tvist-fristen (24 timer efter ankomst) er ikke afklaret endnu.', action: { t: 'tick', tick: 'dispute', label: 'Afklaret' } });
    }
    // Må en bil, der ikke er kommet endnu, markeres solgt? Ikke hvis kanalen har transport eller tvist-ur: så ville ankomsten (og tvist-uret) aldrig blive registreret.
    out.sellEarly = stage === 'Ankommet' || stage === 'Klargøring' || (stage === 'Købt' && !channelTransit(st, chan) && !channelFlag(st, chan, 'dispute') && !isTrade(chan));
    out.open = out.reqs.filter(function (r) { return !r.ok; }).length;
    out.locked = out.open > 0;
    return out;
  }

  function compute(ctx) {
    var now = ctx.now, st = settingsOf(ctx.settings), local = ctx.local;
    var today = local(now).slice(0, 10);
    var cars = ctx.cars || [], items = ctx.items || [], map = byId(cars), last = tickIndex(items, map);
    // Posterne opdelt pr. bil, én gang (forløbet slår op her i stedet for at gennemløbe hele listen for hver bil)
    var byCar = {}; items.forEach(function (it) { if (it.carId) (byCar[it.carId] = byCar[it.carId] || []).push(it); });
    var fctx = { now: now, items: items, settings: ctx.settings, belowMin: ctx.belowMin, byCar: byCar };
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
      // Tvist-ur og attest gælder også, når bilen er solgt (men ikke udleveret): en AutoProff-bil kan sælges få timer efter ankomsten, og fristen løber alligevel.
      if (arr && idx(c.status) <= 7) {
        // 3. Tvist-ur (24 timer efter ankomst, hvis kanalen har det). Forsvinder først, når det er krydset af – men 24 t efter fristen er den ikke "Haster" mere.
        if (channelFlag(st, c.channel, 'dispute') && !disputeSettled(byCar[c.id] || [], c.id)) {
          var deadline = arr + DISPUTE_HOURS * HOUR, left = deadline - now;
          add({ key: 'dispute:' + c.id, kind: 'dispute', prio: left < -DAY ? 2 : (left < 6 * HOUR ? 0 : 1), carId: c.id, text: 'Tvist-frist på ' + carLabel(c),
            sub: left > 0 ? fmtLeft(left) + ' tilbage' : 'Fristen er overskredet for ' + fmtLeft(-left) + ' siden',
            at: deadline, deadline: deadline, label: 'Afklaret', action: { kind: 'tick', tick: 'dispute', carId: c.id } });
        }
        // 4. Registreringsattest: kun for transport-kanaler (AutoProff m.fl.): attesten kommer med UPS 2-7 dage efter. Ved køb fra privat får du den i hånden.
        // Linjen står der fra ankomsten (som en afkrydsning, "Senere" de første dage), og den forsvinder af sig selv, når der ligger en fil af typen
        // "Registreringsattest" på bilen. Efter 3 dage er den "I dag", efter 7 dage "Haster".
        if (channelTransit(st, c.channel) && !regcertDone(byCar[c.id] || [], c.id)) {
          var since = Math.max(0, now - arr);
          add({ key: 'regcert:' + c.id, kind: 'regcert', prio: since >= 7 * DAY ? 0 : (since >= CERT_DAYS * DAY ? 1 : 2), carId: c.id, text: 'Registreringsattest på ' + carLabel(c) + ' modtaget og lagt i mappen',
            sub: 'Bilen ankom ' + fmtAgo(since), at: arr + CERT_DAYS * DAY, label: 'Modtaget', action: { kind: 'tick', tick: 'regcert', carId: c.id } });
        }
        // 5. Afmeld / omregistrer
        if (notSold(c) && channelFlag(st, c.channel, 'dereg') && !last[c.id + '|dereg']) {
          add({ key: 'dereg:' + c.id, kind: 'dereg', prio: 1, carId: c.id, text: 'Afmeld / omregistrer ' + carLabel(c),
            sub: 'Købt via ' + (c.channel || 'privat'), at: arr, label: 'Gjort', action: { kind: 'tick', tick: 'dereg', carId: c.id } });
        }
      }
    });

    // 5b. Bilens forløb (Fase 5): ÉN rolig linje pr. bil, der siger, hvad der skal ske på det trin, bilen står på.
    //     (Erstatter de gamle linjer for gennemgang, klargøring og åbne opgaver.) Detaljerne står på bilen.
    cars.forEach(function (c) {
      var f = flow(c, fctx), sa = (c.extra && c.extra.statusAt) || {}, label = carLabel(c);
      var shorts = f.reqs.filter(function (r) { return !r.ok; }).map(function (r) { return r.short; });
      if (f.stage === 'Købt') {
        var bd2 = dayNum(c.boughtDate), td2 = dayNum(today), wait = bd2 !== null && td2 !== null ? Math.max(0, td2 - bd2) : 0;
        add({ key: 'flow:' + c.id, kind: 'flow', prio: wait >= 7 && !isTrade(c.channel) ? 1 : 2, carId: c.id, text: isTrade(c.channel) ? label + ' (byttebil) overtages, når kunden henter sin bil – tryk ' + f.next.label + ', når du har den' : label + ' er købt – tryk ' + f.next.label + ', når den er her',
          sub: wait > 0 ? 'Købt for ' + wait + (wait === 1 ? ' dag' : ' dage') + ' siden' : 'Købt i dag', at: bd2 !== null ? bd2 * DAY : NEVER, label: '', action: null });
      } else if (f.stage === 'Ankommet') {
        var arr2 = arrivedAt(c, st), g = f.reqs[0];
        add({ key: 'flow:' + c.id, kind: 'flow', prio: !f.locked || (arr2 && now - arr2 >= DAY) ? 1 : 2, carId: c.id,
          text: f.locked ? 'Gennemgang af ' + label + ': ' + (g ? g.detail : '') : label + ': gennemgangen er besvaret – tryk Gennemgået', sub: f.locked ? 'Tjeklisten ligger på bilen' : '', at: arr2 || NEVER, label: '', action: null });
      } else if (f.stage === 'Klargøring') {
        var since2 = typeof sa['Klargøring'] === 'number' ? sa['Klargøring'] : 0;
        add({ key: 'flow:' + c.id, kind: 'flow', prio: !f.locked || (since2 && now - since2 >= 2 * DAY) ? 1 : 2, carId: c.id,
          text: f.locked ? label + ': mangler ' + f.open + (f.open === 1 ? ' ting' : ' ting') + ' før salg' : label + ' er klar – tryk Klargjort + til salg', sub: f.locked ? 'Mangler: ' + shorts.slice(0, 4).join(', ') + (shorts.length > 4 ? ' m.fl.' : '') : '',
          at: since2 || NEVER, label: '', action: null });
      } else if (f.stage === 'Annonceret' && f.levering.open.length) {
        add({ key: 'flow:' + c.id, kind: 'flow', prio: 2, carId: c.id, text: label + ': ' + f.levering.open.length + (f.levering.open.length === 1 ? ' ting skal' : ' ting skal') + ' laves før levering',
          sub: f.levering.open.slice(0, 3).map(function (t) { return t.text; }).join(', '), at: NEVER, label: '', action: null });
      }
    });

    // 5c. Salgsforløb (Fase 3): efter salget og til bilen er Udleveret – ét skridt ad gangen. Derefter: ting før levering, og så "tryk Udleveret".
    cars.forEach(function (c) {
      if (c.status !== 'Solgt') return;
      var step = null;
      for (var si = 0; si < SALE_STEPS.length; si++) { if (!last[c.id + '|' + SALE_STEPS[si][0]]) { step = SALE_STEPS[si]; break; } }
      var at = (c.extra && c.extra.statusAt && c.extra.statusAt.Solgt) || NEVER;
      if (step) {
        add({ key: 'sale:' + c.id, kind: 'sale', prio: 1, carId: c.id, text: 'Solgt – ' + carLabel(c) + ': ' + step[1], sub: 'Skridt ' + (si + 1) + ' af ' + SALE_STEPS.length,
          at: at, label: step[2], action: { kind: 'tick', tick: step[0], carId: c.id } });
        return;
      }
      var lv = flow(c, fctx).levering.open;
      if (lv.length) add({ key: 'flow:' + c.id, kind: 'flow', prio: 1, carId: c.id, text: carLabel(c) + ': ' + lv.length + (lv.length === 1 ? ' ting skal' : ' ting skal') + ' laves før levering', sub: lv.slice(0, 3).map(function (t) { return t.text; }).join(', '), at: at, label: '', action: null });
      else add({ key: 'flow:' + c.id, kind: 'flow', prio: 1, carId: c.id, text: carLabel(c) + ' er klar til levering – tryk Udleveret', sub: '', at: at, label: '', action: null });
    });

    // 5d. Prisskilt: prisen er ændret, efter at skiltet blev printet (skiltet i bilen viser den gamle pris)
    cars.forEach(function (c) {
      var sg = c.extra && c.extra.sign;
      if (!notSold(c) || !sg || typeof sg !== 'object' || !(+sg.price > 0)) return;
      var nowPrice = +c.listPrice || 0;
      if (!(nowPrice > 0) || nowPrice === +sg.price) return;
      add({ key: 'sign:' + c.id, kind: 'sign', prio: 1, carId: c.id, text: 'Print nyt prisskilt til ' + carLabel(c),
        sub: 'Skiltet i bilen siger ' + fmtKr(sg.price) + ' – prisen er nu ' + fmtKr(nowPrice), at: typeof sg.at === 'number' ? sg.at : NEVER, label: '', action: null });
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

    out.sort(function (a, b) { return a.prio - b.prio || a.at - b.at || (a.text < b.text ? -1 : a.text > b.text ? 1 : (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); });
    return out;
  }

  /** Antal der kræver handling nu (Haster + I dag): tallet på fanen. */
  function count(list) { return (list || []).filter(function (e) { return e.prio <= 1; }).length; }

  return {
    ORDER: ORDER, DEFAULTS: DEFAULTS, TICK_KINDS: TICK_KINDS, SALE_STEPS: SALE_STEPS, BOOKING_KINDS: BOOKING_KINDS, GROUPS: GROUPS,
    compute: compute, count: count, chargeInfo: chargeInfo, bookings: bookings, lastTick: lastTick, settingsOf: settingsOf, channelFlag: channelFlag,
    carLabel: carLabel, fmtLeft: fmtLeft, fmtAgo: fmtAgo, fmtIso: fmtIso, dayNum: dayNum, addDaysIso: addDaysIso, bookingText: bookingText, bookingSub: bookingSub,
    onStock: onStock, arrivedAt: arrivedAt, channelTransit: channelTransit,
    AD_CHANNELS: AD_CHANNELS, adOn: adOn, statusBeforeSale: statusBeforeSale, STAGE_LABELS: STAGE_LABELS, STAGE_PATH: STAGE_PATH, MIN_PHOTOS: MIN_PHOTOS, stageOf: stageOf, stageLabel: stageLabel, flow: flow, kravItem: kravItem, regcertDone: regcertDone, photoCount: photoCount
  };
})();
if (typeof window !== 'undefined' && window.BA) window.BA.todo = TODO_;
