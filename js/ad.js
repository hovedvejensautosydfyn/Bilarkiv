/* Annoncetekst: gør AutoDesktops beskrivelse og bilens oplysninger om til en færdig annonce med emojis.
 * Faste regler (ingen AI, ingen net). Reglerne er flyttet 1:1 fra Annoncetekst-programmet på pc'en (Annoncetekst.html, funktionen byg()).
 *
 * BA.ad.prefill(car, items, raw, now)  -> felter til formularen (fra bilen + det, der kan læses i AutoDesktop-teksten)
 * BA.ad.build(fields)                  -> den færdige annoncetekst
 * BA.ad.newIntro(fields, step)         -> et nyt forslag til indledningen
 * BA.ad.analyse(raw, now)              -> det, der kan læses i teksten fra AutoDesktop
 * Ren logik: ingen skærm. (Kan afprøves uden browser-siden.)
 */
(function () {
  'use strict';
  var BA = window.BA = window.BA || {};

  var STD_BUND = '📍 Hovedvejens Auto Sydfyn, Hovedvejen 41, 5771 Stenstrup\n📲 Skriv eller ring for fremvisning og prøvetur\n🌐 Se flere biler på h-auto.dk';
  var STD_PERFEKT = 'første bil, pendlerbil eller bil nr. 2';
  var CHIPS = ['Anhængertræk aftageligt', 'Anhængertræk fast', 'Nøglefri døre', 'Tågelygter', 'Fjernbetjent centrallås', 'USB', 'CD/radio', 'DAB+ radio', 'Apple CarPlay / Android Auto', 'Navigation',
    'Parkeringssensor bag', 'Parkeringssensor for og bag', 'Bakkamera', '7 airbags, ESP, ABS og dæktrykssensor', 'Isofix', 'Regnsensor', 'Automatisk klimaanlæg'];
  var OMDOEB = [
    [/^musikstreaming via bluetooth$/i, 'Bluetooth-musikstreaming'],
    [/^multifunktionsrat og læderrat$/i, 'Multifunktionsrat i læder'],
    [/^læderrat og multifunktionsrat$/i, 'Multifunktionsrat i læder']
  ];
  var PRIORITET = [/anhængertræk/i, /klima|aircon/i, /sædevarme/i, /nøglefri/i, /fartpilot|adaptiv/i, /navigation|carplay|android/i,
    /bakkamera|parkeringssensor|p-sensor/i, /alufælge/i, /led|xenon|lygte|lys/i, /tonede/i,
    /bluetooth|musik|usb|radio|cd|dab/i, /håndfri/i, /rat/i, /elruder/i, /spejl/i, /centrallås/i,
    /bagsæde|isofix/i, /airbag|esp|abs|dæktryk/i];
  var TRIMS = ['exclusive', 'comfort', 'comfortline', 'highline', 'trendline', 'style', 'titanium', 'trend', 'active', 'elegance',
    'sport', 'sportline', 'glx', 'gls', 'limited', 'premium', 'prestige', 'allure', 'intens', 'zen', 'life', 'ambition', 'plus', 'luxury',
    'executive', 'momentum', 'inscription', 'edition', 'design', 'tekna', 'acenta', 'visia', 'n-connecta', 'gt', 'gt-line', 's-line',
    'advance', 'essentia', 'shine', 'feel', 'access', 'ambiente', 'titanium x', 'r-line', 'emotion', 'xcellence', 'fr', 'se', 'sel',
    'connect', 'business', 'platinum', 'attraction', 'selection', 'dynamic', 'urban', 'exclusive+', 'cool', 'lounge', 'pop', 'easy'];

  function rens(t) {
    return String(t || '').replace(/\*\*/g, '').replace(/ /g, ' ').replace(/\r/g, '')
      .replace(/^[ \t]*#+[ \t]*/gm, '')
      .replace(/^\s*Beskrivelse\s*\n/i, '');
  }
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function lines(s) { return String(s == null ? '' : s).split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function fmtKm(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function analyse(raw, now) {
    var t = rens(raw);
    var linjer = t.split('\n').map(function (l) { return l.trim(); });
    var r = { udstyr: [] };
    var titelIdx = -1;
    for (var q = 0; q < linjer.length; q++) if (linjer[q]) { titelIdx = q; break; }
    var titel = titelIdx >= 0 ? linjer[titelIdx] : '';
    var titelDele = titel.split(/\s+[–—-]\s+/);
    var navnDel = titelDele.shift() || '';
    titelDele.forEach(function (d) {
      if (/^\d{4}$/.test(d.trim())) r.aar = d.trim();
      else if (/km\s*$/i.test(d)) r.km = d.replace(/\s*km\s*$/i, '').trim();
    });
    navnDel = navnDel.replace(/(\d+)\s+(hk|hp)\b/i, '$1HK');
    var ord = navnDel.split(/\s+/).filter(Boolean);
    var motorIdx = -1, hkIdx = -1, i;
    for (i = 0; i < ord.length; i++) { if (motorIdx < 0 && /^\d[,.]\d$/.test(ord[i])) motorIdx = i; if (hkIdx < 0 && /^\d+\s*hk$/i.test(ord[i])) hkIdx = i; }
    if (hkIdx >= 0) r.hk = ord[hkIdx].replace(/hk/i, '').trim();
    var doerOrd = ord.filter(function (w) { return /^\d[dD]$/.test(w); })[0];
    if (doerOrd) r.doere = doerOrd[0];
    if (motorIdx > 0) {
      r.navn = ord.slice(0, motorIdx).join(' ');
      var efter = ord.slice(motorIdx + 1, hkIdx > motorIdx ? hkIdx : ord.length).filter(function (w) { return !/^\d[dD]$/.test(w) && !/^\d+\s*hk$/i.test(w); });
      var vIdx = -1;
      efter.forEach(function (w, j) { if (TRIMS.indexOf(w.toLowerCase()) >= 0) vIdx = j; });
      if (vIdx < 0) {
        for (var j = efter.length - 1; j >= 0; j--) {
          if (/^[A-Za-zÆØÅæøå+-]{3,}$/.test(efter[j]) && !/^(tsi|tdi|tfsi|dci|crdi|hdi|tce|puretech|ecoboost|vti|dualjet|boosterjet|mpi|gdi|cdti|cdi|bluehdi|skyactiv|hybrid|dsg|aut|automatic|stc|van)$/i.test(efter[j])) { vIdx = j; break; }
        }
      }
      if (vIdx >= 0) {
        r.variant = efter[vIdx];
        var motorOrd = efter.slice(0, vIdx).filter(function (w) { return !/^\d+V$/i.test(w); });
        r.motor = [ord[motorIdx]].concat(motorOrd).join(' ');
      } else r.motor = [ord[motorIdx]].concat(efter.filter(function (w) { return !/^\d+V$/i.test(w); })).join(' ');
    } else r.navn = ord.slice(0, 2).join(' ');

    var m;
    if (!r.km && (m = t.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*km(?![\/\w])/i))) r.km = m[1];
    if ((m = t.match(/indregistreret i (\d{4})/i))) r.aar = r.aar || m[1];
    if ((m = t.match(/\b(\d)-dørs\b/i)) || (m = t.match(/\b(\d|fem|tre|fire)\s+døre\b/i))) {
      var map = { tre: '3', fire: '4', fem: '5' }; r.doere = r.doere || map[m[1].toLowerCase()] || m[1];
    }
    var lille = t.toLowerCase();
    var braend = /plug-in/.test(lille) ? 'plug-in hybrid' : /hybrid/.test(lille) ? 'hybrid' : /diesel/.test(lille) ? 'diesel' : /benzin/.test(lille) ? 'benzin' : /\belbil\b|el-motor|elmotor/.test(lille) ? 'el' : '';
    var gear = /manuel(?:t|le)?\s+gear/.test(lille) ? 'Manuelt gear'
      : /automatgear|automatisk gear|automatgearkasse|\bdsg\b|\baut\.?\b|automatic|\bcvt\b|steptronic|tiptronic|\bedc\b|powershift/.test(lille) ? 'Automatgear'
      : /manuel/.test(lille) ? 'Manuelt gear' : '';
    r.gear = [gear, braend].filter(Boolean).join(', ');
    if ((m = t.match(/(\d+(?:,\d+)?)\s*km\/l/i))) r.kml = m[1];
    if ((m = t.match(/(halvårlig|årlig)\w*\s+(?:grøn\s+)?ejerafgift[^\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*kr/i))) r.afgift = m[2] + ' kr. ' + (/halv/i.test(m[1]) ? 'halvårligt' : 'om året');
    else if ((m = t.match(/ejerafgift[^\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*kr/i))) r.afgift = m[1] + ' kr.';
    var TALORD = { en: '1', to: '2', tre: '3', fire: '4', fem: '5' };
    if ((m = t.match(/\b(\d|en|to|tre|fire|fem)\s*(?:euro\s*)?NCAP/i))) r.ncap = TALORD[m[1].toLowerCase()] || m[1];
    if ((m = t.match(/synet\s+(?:til\s+)?(\d{1,2}\s*[\/.-]\s*\d{4})/i))) r.synet = m[1].replace(/\s/g, '').replace(/[.-]/, '/');
    if (/\bkæde\b|kamkæde|time?ringskæde/i.test(t) && !/tandrem/i.test(t)) r.rem = 'kaede';
    else if (/tandrem\s+(?:er\s+)?(?:ny\s*)?skiftet|ny tandrem|nyskiftet tandrem/i.test(t)) r.rem = 'remskiftet';
    r.ekstra = [];
    if (/nyserviceret|ny service\b|frisk service/i.test(t)) r.ekstra.push('🛠️ Leveres nyserviceret');
    else if (/overholdt service|fuld servicehistorik|servicebog/i.test(t)) r.ekstra.push('📘 Overholdt service');
    r.perfekt = /\bcombi\b|stationcar|\bvariant\b|touring|sportswagon|sports tourer|\bsw\b|\bstc\b|avant|\bestate\b|kombi/i.test(t) ? 'familiebil, pendlerbil eller til dig, der har brug for plads' : STD_PERFEKT;

    r.vigtigt = []; r.krog = [];
    var ADVARSEL = /engros|cvr|garanti|forbehold|som beset|eksport|defekt|handel/i;
    linjer.forEach(function (l, li) {
      if (li === titelIdx || !l) return;
      var ren = l.replace(/[_*\/]{2,}|^[_*\/]+|[_*\/]+$/g, '').trim();
      var bogst = ren.replace(/[^A-Za-zÆØÅæøå]/g, '');
      var store = ren.replace(/[^A-ZÆØÅ]/g, '').length;
      if (bogst.length >= 10 && (store / bogst.length > 0.7 || /^_?\/\//.test(l) || (/engros|uden garanti|cvr/i.test(ren) && ren.length < 160))) (ADVARSEL.test(ren) ? r.vigtigt : r.krog).push(ren);
    });

    r.fuld = [];
    var fuldIdx = -1;
    linjer.forEach(function (l, li) { if (fuldIdx < 0 && li !== titelIdx && (l.match(/,/g) || []).length >= 8 && !/[.!?]$/.test(l)) fuldIdx = li; });
    if (fuldIdx >= 0) {
      var SKIP = /^(servo|selealarm|bluetooth|alufælge|usb stik|aux stik|lev\. nyserviceret|leveres med .*|(fører|passager|side|gardin|knæ)-airbag)$/i;
      r.fuld = linjer[fuldIdx].split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x && !SKIP.test(x); });
    }
    linjer.forEach(function (l) { var u = l.match(/^[-•*–]\s+(.+)$/); if (u) r.udstyr.push(u[1].trim()); });
    var brugt = {};
    if (!r.udstyr.length) {
      var h = -1;
      linjer.forEach(function (l, li) { if (h < 0 && /udstyr\s*:?$/i.test(l) && l.length < 50) h = li; });
      if (h >= 0) {
        var k = h + 1;
        while (k < linjer.length && !linjer[k]) k++;
        for (; k < linjer.length && linjer[k]; k++) {
          var l2 = linjer[k];
          if (l2.length > 70 || /[.!?]$/.test(l2)) break;
          r.udstyr.push(l2.replace(/[,;]$/, '')); brugt[k] = true;
        }
      }
    }
    var FEJL = /virker ikke|ikke (?:ud til at )?(?:at )?virke|defekt|\bfejl(?!fri)|\bslid|slidt|ridse|\bbule|\brust|\bmangler|skal skiftes|bør skiftes|trænger til|\blyser|sensitiv|\bstøj|\blarm|utæt|\brevne|stenslag|\bskade|\bknæk|brækket|\bløs\b|sives|kan ikke|lækker|hakker|\blugt|\bplet|flænge|misfarv|kradse|skramme/i;
    var GENERISK = /hvis du|giver mulighed|praktisk|kontakt|oplyst til|er blandt|velegnet|fremvisning|uden (?:fejl|mangler|skader)|fejlfri/i;
    r.fejl = [];
    linjer.forEach(function (l, li) {
      if (li === titelIdx || li === fuldIdx || brugt[li] || !l || /^[-•*–]\s/.test(l)) return;
      l.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001').forEach(function (s) {   // (uden "lookbehind": ældre iPhones forstår det ikke)
        s = s.trim();
        if (s && FEJL.test(s) && !GENERISK.test(s) && !r.vigtigt.some(function (v) { return l.indexOf(v) >= 0; })) r.fejl.push(s.replace(/\.$/, ''));
      });
    });
    return r;
  }

  function omdoeb(x) {
    for (var i = 0; i < OMDOEB.length; i++) if (OMDOEB[i][0].test(x)) return OMDOEB[i][1];
    return x.replace(/^musikstreaming via bluetooth/i, 'Bluetooth-musikstreaming');
  }
  function sortEquip(liste) {
    var l = [], set = {};
    (liste || []).forEach(function (x) { x = omdoeb(String(x).trim()); if (!x) return; var k = x.toLowerCase(); if (!set[k]) { set[k] = 1; l.push(x); } });
    var taage = -1, ledlys = -1, nd = -1, ns = -1;
    l.forEach(function (x, i) {
      if (taage < 0 && /^tågelygter$/i.test(x)) taage = i;
      if (ledlys < 0 && /kørelys.* og /i.test(x)) ledlys = i;
      if (nd < 0 && /^nøglefri (døre|adgang|betjening)$/i.test(x)) nd = i;
      if (ns < 0 && /^nøglefri start$/i.test(x)) ns = i;
    });
    if (taage >= 0 && ledlys >= 0) { l[ledlys] = l[ledlys].replace(/ og /i, ', tågelygter og '); l.splice(taage, 1); }
    nd = -1; ns = -1;
    l.forEach(function (x, i) { if (nd < 0 && /^nøglefri (døre|adgang|betjening)$/i.test(x)) nd = i; if (ns < 0 && /^nøglefri start$/i.test(x)) ns = i; });
    if (nd >= 0 && ns >= 0) { l[ns] = 'Nøglefri døre og nøglefri start'; l.splice(nd, 1); }
    var score = function (x) { for (var i = 0; i < PRIORITET.length; i++) if (PRIORITET[i].test(x)) return i; return 99; };
    return l.map(function (x, i) { return { x: x, i: i, s: score(x) }; }).sort(function (a, b) { return a.s - b.s || a.i - b.i; }).map(function (o) { return o.x; });
  }

  function maanederTil(mmyyyy, now) {
    var nu = now || new Date();
    var m = String(mmyyyy || '').match(/(\d{1,2})\s*[\/.-]\s*(\d{4})/);
    if (!m) { var y = String(mmyyyy || '').match(/(\d{4})/); if (!y) return null; return (Number(y[1]) - nu.getFullYear()) * 12; }
    return (Number(m[2]) - nu.getFullYear()) * 12 + (Number(m[1]) - 1 - nu.getMonth());
  }
  function aarIDato(s) { var m = String(s || '').match(/(\d{4})/); return m ? m[1] : ''; }

  /** Salgspunkter, der findes ud fra bilens egne tal og udstyr. */
  function autoPunkter(r, udstyr, now) {
    var p = [];
    var u = (udstyr || []).join('\n');
    var km = Number(digits(r.km)), aar = Number(r.aar);
    var year = (now || new Date()).getFullYear();
    var alder = aar ? Math.max(1, year - aar) : 0;
    var engros = (r.vigtigt || []).some(function (x) { return /engros|cvr|garanti/i.test(x); });
    if (!engros && km && km < 150000 && alder && km / alder < 15000) p.push('🛣️ Kun ' + r.km + ' km – lavt for en ' + aar + "'er");
    var klima = /klima|aircon/i.test(u), varme = /sædevarme/i.test(u);
    if (klima && varme) p.push('❄️ Klimaanlæg og 🔥 sædevarme – god både sommer og vinter');
    if (/anhængertræk/i.test(u)) p.push('🪝 Anhængertræk – klar til trailer, cykelholder eller campingvogn');
    var afg = Number(String(r.afgift || '').replace(/kr.*$/i, '').replace(/\D/g, ''));
    if (afg && (/halv/.test(r.afgift) ? afg <= 600 : afg <= 1200)) p.push('💰 Kun ' + r.afgift + ' i ejerafgift');
    var sikker = (udstyr || []).filter(function (l) { return /nødbrems|vognbane|blindvinkel|adaptiv fartpilot|kollision/i.test(l); })[0];
    if (sikker) p.push('🛡️ ' + sikker.trim() + ' – ekstra sikkerhed');
    if (r.ncap === '5') p.push('⭐ 5 stjerner i Euro NCAP – en sikker bil');
    var nav = (udstyr || []).filter(function (l) { return /carplay|android auto|navigation/i.test(l); })[0];
    if (nav) p.push('📱 ' + nav.trim());
    return p.slice(0, 4);
  }

  /** Forslag til indledningen. Giver { list, idx }; idx vælges ud fra bilen, så forskellige biler får forskellige. */
  function intros(r, udstyr, now) {
    var model = [r.navn, r.variant].filter(Boolean).join(' ') || 'bil';
    var kort = r.navn || 'bilen';
    var u = (udstyr || []).map(function (x) { return x.trim(); }).filter(Boolean);
    var kmlTal = parseFloat(String(r.kml || '').replace(',', '.'));
    var km = Number(digits(r.km)), aar = Number(r.aar);
    var alder = aar ? Math.max(1, (now || new Date()).getFullYear() - aar) : 0;
    var L = [];
    var seed = function (s) { var a = 0; for (var i = 0; i < s.length; i++) a += s.charCodeAt(i); return a; };
    var list;
    if ((r.vigtigt || []).some(function (x) { return /engros|cvr|garanti/i.test(x); })) {
      list = ['Til dig med CVR-nummer: en billig ' + kort + ', der stadig kører. Se her 👇', 'Handelsbil til den rigtige pris – ' + model + ' sælges som den står 👇', 'Billig ' + kort + ' til handel eller eksport – først til mølle! 👇'];
      if (kmlTal >= 18) list.push('Billig ' + kort + ' der kører ' + r.kml + ' km/l – sælges engros som den står 👇');
      return { list: list, idx: seed(model + (r.km || '')) % list.length };
    }
    if (/familiebil/.test(r.perfekt || '')) {
      L.push('Brug for plads til familie, hund og indkøb? Så er denne ' + model + ' et godt bud! 👇');
      L.push('Masser af plads og lave driftsudgifter – ' + model + ' er klar til nye eventyr! 👇');
    }
    if (kmlTal >= 18) {
      L.push('Leder du efter en bil, der bare kører og næsten ikke koster noget at eje? Så er den her! 👇');
      L.push('Træt af at betale for meget for benzin? Denne ' + kort + ' kører ' + r.kml + ' km/l! ⛽👇');
    }
    if (km && km < 150000 && alder && km / alder < 15000) L.push('Kun ' + r.km + ' km på en ' + aar + "'er – den her er ikke kørt træt! 👇");
    if (u.length >= 10) {
      var top3 = u.slice(0, 3).map(function (x) { return x.toLowerCase(); });
      L.push('Veludstyret ' + model + ' med blandt andet ' + top3.slice(0, 2).join(', ') + ' og ' + top3[2] + '! 👇');
      L.push(u[0] + ', ' + u[1].toLowerCase() + ' og ' + u[2].toLowerCase() + ' – denne ' + kort + ' har det, du skal bruge! 👇');
    }
    if ((r.krog || []).length) L.push(r.krog[0].charAt(0) + r.krog[0].slice(1).toLowerCase() + ' – så er det nu, du skal slå til! 👇');
    L.push('Mangler du en pålidelig bil til hverdagen? Så tag et kig på denne ' + model + '! 👇');
    L.push('Her er en ' + model + ' til en fornuftig pris – se bare her 👇');
    var seen = {}; list = L.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    return { list: list, idx: seed(model + (r.km || '')) % list.length };
  }

  /** Felterne til formularen. car + items (bilens poster) fylder ud; raw er AutoDesktops tekst (må være tom). */
  function prefill(car, items, raw, now) {
    car = car || {};
    var r = analyse(raw || '', now);
    var equipCar = (items || []).filter(function (i) { return i.type === 'udstyr' && !i.deleted; }).map(function (i) { return i.name; });
    var udstyr = sortEquip((r.udstyr || []).length ? r.udstyr : equipCar);
    var fejlCar = (items || []).filter(function (i) { return i.type === 'fejl' && !i.fixed && !i.deleted; }).map(function (i) { return i.text; });
    var km = r.km || (car.km != null ? fmtKm(car.km) : '');
    var forste = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(car.firstReg || '')) forste = car.firstReg.slice(5, 7) + '/' + car.firstReg.slice(0, 4);
    var synet = r.synet || (/^\d{4}-\d{2}-\d{2}$/.test(car.nextInspection || '') ? car.nextInspection.slice(5, 7) + '/' + car.nextInspection.slice(0, 4) : '');
    var gearGuess = r.gear || [car.fuel ? String(car.fuel).toLowerCase() : ''].filter(Boolean).join(', ');
    var f = {
      navn: r.navn || car.model || '', variant: r.variant || car.variant || '', motor: r.motor || '', hk: r.hk || '', km: km, aar: r.aar || car.year || '', forstereg: forste,
      gear: gearGuess, doere: r.doere || '', farve: car.color || '', kml: r.kml || '', afgift: r.afgift || '', synet: synet, rem: r.rem || '', remkm: '',
      top: false, visafgift: false, visncap: false, ncap: r.ncap || '', ekstra: '', udstyr: udstyr.join('\n'), vigtigt: (r.vigtigt || []).join('\n'),
      fejl: ((r.fejl || []).length ? r.fejl : fejlCar).join('\n'), krog: (r.krog || []).join(' + '), overskrift: '', intro: '', perfekt: r.perfekt || STD_PERFEKT, bund: STD_BUND
    };
    var extra = (r.ekstra || []).concat(autoPunkter(r, udstyr, now));
    f.ekstra = extra.join('\n');
    var ints = intros(Object.assign({}, r, { navn: f.navn, variant: f.variant, km: km, aar: f.aar }), udstyr, now);
    f.intro = ints.list[ints.idx] || '';
    f.introIdx = ints.idx;
    f.fuld = r.fuld || [];
    return f;
  }

  /** Nyt forslag til indledningen (step = +1 for næste). Giver { intro, idx }. */
  function newIntro(f, step, now) {
    var r = { navn: f.navn, variant: f.variant, km: f.km, aar: f.aar, kml: f.kml, vigtigt: lines(f.vigtigt), krog: lines(f.krog ? f.krog.replace(/ \+ /g, '\n') : ''), perfekt: f.perfekt };
    var ints = intros(r, lines(f.udstyr), now);
    var idx = (((f.introIdx == null ? ints.idx : f.introIdx) + (step || 1)) % ints.list.length + ints.list.length) % ints.list.length;
    return { intro: ints.list[idx], idx: idx };
  }

  /** Den færdige annoncetekst ud fra felterne. */
  function build(f, now) {
    var v = function (k) { return String(f[k] == null ? '' : f[k]).trim(); };
    var navn = v('navn'), variant = v('variant'), synet = v('synet');
    var top = !!f.top;
    var kml = v('kml'), kmlTal = parseFloat(kml.replace(',', '.'));
    var braendstof = v('gear').toLowerCase();
    var udstyr = lines(f.udstyr);
    var overskrift = v('overskrift');
    if (!overskrift) {
      var krog = [];
      if (v('krog')) krog.push(v('krog').toUpperCase().replace(/[!.]+$/, ''));
      if (!krog.length && top) krog.push('TOPUDSTYRET');
      if (!v('krog') && synet && aarIDato(synet)) krog.push('SYNET TIL ' + aarIDato(synet));
      var kmTal = Number(digits(v('km')));
      if (!krog.length && kmlTal >= 18) krog.push('KUN ' + kml + ' KM/L');
      if (!krog.length && kmTal && kmTal < 100000) krog.push('KUN ' + v('km') + ' KM');
      if (!krog.length && /anhængertræk/i.test(udstyr.join('\n'))) krog.push('MED ANHÆNGERTRÆK');
      var titel = [navn, variant].filter(Boolean).join(' ').toUpperCase();
      overskrift = '🚗✨ ' + titel + (krog.length ? ' – ' + krog.join(' OG ') + '!' : '') + ' ✨🚗';
    }
    var punkter = [];
    if (kml) punkter.push('⛽ ' + kml + ' km/l' + (kmlTal >= 18 && !/el\b/.test(braendstof) ? ' – billig at køre i' : ''));
    var rem = v('rem');
    if (rem === 'kaede') punkter.push('🔧 Motor med kæde – ingen dyr tandrem, der skal skiftes');
    if (rem === 'remskiftet') punkter.push('🔧 Tandrem er skiftet' + (v('remkm') ? ' ved ' + v('remkm') : '') + ' – den store udgift er klaret');
    if (synet) {
      var mdr = maanederTil(synet, now);
      punkter.push('📅 Synet til ' + synet + (mdr !== null && mdr >= 12 ? ' – over et år uden bekymringer' : ''));
    }
    if (top && variant) punkter.push('👑 ' + variant + ' – den højeste udstyrsvariant');
    if (f.visafgift && v('afgift')) punkter.push('💰 Ejerafgift kun ' + v('afgift'));
    if (f.visncap && v('ncap')) punkter.push('⭐ ' + v('ncap') + ' stjerner i Euro NCAP');
    lines(f.ekstra).forEach(function (l) { punkter.push(l); });
    var fakta = [];
    var aar = v('aar'), forste = v('forstereg');
    if (aar) fakta.push('Årgang ' + aar + (forste ? ' (1. reg. ' + forste + ')' : ''));
    if (v('km')) fakta.push(v('km') + ' km');
    var motor = /^\d[,.]\d$/.test(v('motor')) ? v('motor') + '-liters motor' : v('motor');
    var motorLinje = [motor, v('hk') ? v('hk') + ' HK' : ''].filter(Boolean).join(', ');
    if (motorLinje) fakta.push(motorLinje);
    if (v('gear')) fakta.push(v('gear'));
    var farveLinje = [v('farve'), v('doere') ? v('doere') + ' døre' : ''].filter(Boolean).join(', ');
    if (farveLinje) fakta.push(farveLinje);
    var dele = [overskrift];
    var vigtigt = lines(f.vigtigt);
    if (vigtigt.length) dele.push(vigtigt.map(function (x) { return '⚠️ ' + x + ' ⚠️'; }).join('\n'));
    if (v('intro')) dele.push(v('intro'));
    if (punkter.length) dele.push(punkter.join('\n'));
    if (udstyr.length) dele.push('Udstyr:\n' + udstyr.map(function (x) { return '✅ ' + x; }).join('\n'));
    if (fakta.length) dele.push('Fakta:\n' + fakta.map(function (x) { return '▪️ ' + x; }).join('\n'));
    var fejl = lines(f.fejl);
    if (fejl.length) dele.push('Fejl og mangler:\n' + fejl.map(function (x) { return '❗ ' + x.replace(/\.$/, ''); }).join('\n'));
    if (v('perfekt')) dele.push('💡 Perfekt som ' + v('perfekt').replace(/[.!]+$/, '') + '!');
    if (v('bund')) dele.push(v('bund'));
    return dele.join('\n\n');
  }

  BA.ad = { STD_BUND: STD_BUND, STD_PERFEKT: STD_PERFEKT, CHIPS: CHIPS, analyse: analyse, sortEquip: sortEquip, autoPunkter: autoPunkter, intros: intros, prefill: prefill, newIntro: newIntro, build: build };
})();
