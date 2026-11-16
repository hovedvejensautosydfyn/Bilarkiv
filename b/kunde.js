/* Kundesiden (offentlig): viser en bil til salg efter et QR-scan på prisskiltet.
 * Henter KUN bilens salgsoplysninger fra serveren (doGet ?k=kode → SIGN_.publicView). Ingen login, ingen cookies, intet gemmes. */
(function () {
  'use strict';
  // Serverens adresse (Apps Script-webappen). Ikke hemmelig: uden en enhedsnøgle kan man kun hente kundesiden for en kendt kode.
  var API = 'https://script.google.com/macros/s/AKfycbyBXvB72otb7yfawNry7eVIyERRLhaTwq6An9Y2_d9kSPgCWDTMMHWIJde8ZBrxjqNsnA/exec';
  // Bruges kun, hvis serveren ikke svarer (så kunden altid kan ringe).
  var FALLBACK_FIRM = { name: 'Hovedvejens Auto Sydfyn', phone: '60 99 25 85', street: 'Hovedvejen 41', city: '5771 Stenstrup', hours: 'Hverdage 8–18, weekend efter aftale' };
  var CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
  var main = document.getElementById('main');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function fmtInt(n) { var s = String(Math.round(Math.abs(+n || 0))), out = ''; while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); } return s + out; }
  function digits(p) { return String(p || '').replace(/\D/g, ''); }
  function tel(firm) { var d = digits(firm.phone); return d.length === 8 ? '+45' + d : d; }

  function contact(firm, smsText) {
    var c = el('div', 'card');
    var cta = el('div', 'cta'), t = tel(firm);
    if (t) {
      var call = el('a', 'btn main', '📞 Ring ' + (firm.phone || '')); call.href = 'tel:' + t; cta.appendChild(call);
      var sms = el('a', 'btn', '💬 Send en SMS'); sms.href = 'sms:' + t + (smsText ? '?&body=' + encodeURIComponent(smsText) : ''); cta.appendChild(sms);
    }
    var addr = [firm.street, firm.city].filter(Boolean).join(', ');
    if (addr) {
      var map = el('a', 'btn', '📍 Find vej'); map.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr); map.target = '_blank'; map.rel = 'noopener'; cta.appendChild(map);
    }
    c.appendChild(cta);
    var info = el('p', 'info');
    if (addr) { info.appendChild(el('b', '', firm.name || '')); info.appendChild(document.createTextNode(' · ' + addr)); }
    if (firm.hours) { info.appendChild(el('br')); info.appendChild(document.createTextNode('Åbent: ' + firm.hours)); }
    c.appendChild(info);
    return c;
  }

  function message(title, text, firm) {
    main.innerHTML = '';
    var m = el('div', 'card msg'); m.appendChild(el('h1', '', title)); m.appendChild(el('p', 'info', text));
    main.appendChild(m); main.appendChild(contact(firm || FALLBACK_FIRM));
  }

  // Kun bilens side på h-auto.dk må åbnes herfra (aldrig en vilkårlig adresse)
  var WEB_RE = /^https:\/\/h-auto\.dk\/biler-til-salg\/\?easyvehicleid=AD\d{4,12}$/;
  var go = function (url) { location.replace(url); };

  function show(res) {
    var firm = res.firm && res.firm.phone ? res.firm : FALLBACK_FIRM;
    if (res.sold) { document.title = 'Solgt – ' + (firm.name || ''); message('Denne bil er solgt', 'Ring og hør om vores andre biler – vi har jævnligt nye biler på lager.', firm); return; }
    var car = res.car || {};
    var web = res.web && WEB_RE.test(String(res.web.url || '')) ? res.web : null;
    if (web && web.mode === 'redirect') {
      // Send kunden direkte til bilens side på hjemmesiden (alle billeder og hele beskrivelsen)
      main.innerHTML = '';
      var r = el('div', 'card msg'); r.appendChild(el('h1', '', car.model || 'Bilen'));
      var p0 = el('p', 'info', 'Viser bilen på h-auto.dk … '); var a0 = el('a', '', 'Tryk her, hvis der ikke sker noget'); a0.href = web.url; p0.appendChild(a0); r.appendChild(p0);
      main.appendChild(r); main.appendChild(contact(firm));
      go(web.url);
      return;
    }
    var name = [car.model, car.variant].filter(Boolean).join(' ');
    document.title = (car.model || 'Bil') + ' – ' + (firm.name || '');
    main.innerHTML = '';
    var c = el('div', 'card');
    if (car.label) c.appendChild(el('div', 'ribbon', car.label));
    c.appendChild(el('h1', '', car.model || 'Bil'));
    if (car.variant) c.appendChild(el('p', 'variant', car.variant));
    if (car.price > 0) { var p = el('p', 'price', fmtInt(car.price)); p.appendChild(el('small', '', 'kr.')); c.appendChild(p); }
    if (web) { var wb = el('a', 'btn main webbtn', '📸 Se alle billeder og hele beskrivelsen'); wb.href = web.url; c.appendChild(wb); }
    var facts = el('div', 'facts');
    [['Årgang', car.year], ['Kilometer', car.km > 0 ? fmtInt(car.km) + ' km' : ''], ['Brændstof', car.fuel], ['Farve', car.color], ['HK', car.hk ? car.hk + ' hk' : '']].forEach(function (f) {
      if (!f[1]) return;
      var d = el('div', 'fact'); d.appendChild(el('div', 'l', f[0])); d.appendChild(el('div', 'v', f[1])); facts.appendChild(d);
    });
    c.appendChild(facts);
    if (car.badges && car.badges.length) { var b = el('div', 'badges'); car.badges.forEach(function (t) { b.appendChild(el('span', '', t)); }); c.appendChild(b); }
    main.appendChild(c);
    main.appendChild(contact(firm, 'Hej! Jeg er interesseret i ' + (name || 'bilen') + (car.price > 0 ? ' til ' + fmtInt(car.price) + ' kr.' : '') + ' Er den stadig til salg?'));
    if (car.equipment && car.equipment.length) {
      var e = el('div', 'card'); e.appendChild(el('h2', '', 'Udstyr'));
      var ul = el('ul', 'eq'); car.equipment.forEach(function (n) { ul.appendChild(el('li', '', n)); }); e.appendChild(ul);
      main.appendChild(e);
    }
    var f = el('footer', '', 'Ret til fejl og ændringer forbeholdes. Ring for at høre mere eller aftale en prøvetur.');
    main.appendChild(f);
  }

  window.KUNDE_TEST = { show: show, message: message, fallback: FALLBACK_FIRM, setGo: function (fn) { go = fn; } };   // kun til testene (test/app-ui-tests.html)

  var k = '';
  try { k = new URLSearchParams(location.search).get('k') || ''; } catch (e) { k = ''; }
  k = k.trim().toLowerCase();
  if (!CODE_RE.test(k) || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(API)) { message('Bilen kunne ikke findes', 'Linket ser forkert ud. Ring til os, så hjælper vi.', FALLBACK_FIRM); return; }

  var done = false, timer = setTimeout(function () { if (!done) { done = true; message('Siden svarer ikke lige nu', 'Prøv igen om lidt – eller ring til os.', FALLBACK_FIRM); } }, 20000);
  fetch(API + '?k=' + encodeURIComponent(k), { method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (done) return; done = true; clearTimeout(timer);
      if (res && res.ok) show(res);
      else if (res && res.code === 'NOTFOUND') message('Bilen kunne ikke findes', 'Den er måske ikke til salg længere. Ring og hør om vores andre biler.', res.firm);
      else message('Siden svarer ikke lige nu', 'Prøv igen om lidt – eller ring til os.', res && res.firm);
    }, function () {
      if (done) return; done = true; clearTimeout(timer);
      message('Siden svarer ikke lige nu', 'Tjek din forbindelse og prøv igen – eller ring til os.', FALLBACK_FIRM);
    });
})();
