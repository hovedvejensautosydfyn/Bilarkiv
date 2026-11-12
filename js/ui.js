/* Fælles dele af skærmen: beskeder, dialoger, bekræftelser og gem-status. */
(function () {
  'use strict';
  var BA = window.BA, U = BA.u, $ = U.$, esc = U.esc;

  // ---------- besked nederst ----------
  var toastTimer = 0;
  BA.toast = function (msg, opts) {
    opts = opts || {};
    var el = $('#toast');
    if (!el) return;
    el.innerHTML = '<span></span>' + (opts.action ? '<button type="button" data-toast-act>' + esc(opts.action) + '</button>' : '');
    el.firstChild.textContent = msg;
    el.hidden = false;
    var act = el.querySelector('[data-toast-act]');
    if (act) act.onclick = function () { el.hidden = true; clearTimeout(toastTimer); if (opts.onAction) opts.onAction(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, opts.ms || (opts.long ? 6500 : 3200));
  };

  // ---------- dialoger ----------
  var openModals = [];
  /** Åbner en dialog. build(box, close) fylder den. Giver { close }. */
  BA.modal = function (title, html, onBind, opts) {
    opts = opts || {};
    var ovl = document.createElement('div');
    ovl.className = 'ovl';
    ovl.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2><div class="mbody">' + html + '</div></div>';
    document.body.appendChild(ovl);
    var prevFocus = document.activeElement;
    var closed = false;
    function close(reason) {
      if (closed) return; closed = true;
      ovl.remove(); openModals = openModals.filter(function (m) { return m !== api; });
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (e) { /* ingen */ } }
      if (opts.onClose) opts.onClose(reason);
    }
    function onKey(e) {
      if (openModals[openModals.length - 1] !== api) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (!opts.sticky) close('esc'); }
      if (e.key === 'Tab') {
        var f = U.$$('button, input, select, textarea, a[href]', ovl).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    var api = { el: ovl, box: ovl.querySelector('.mbody'), close: close };
    openModals.push(api);
    document.addEventListener('keydown', onKey, true);
    ovl.addEventListener('mousedown', function (e) { if (e.target === ovl && !opts.sticky) close('backdrop'); });
    if (onBind) onBind(api.box, close, api);
    var first = ovl.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button');
    if (first && !opts.noFocus) { try { first.focus(); } catch (e) { /* ingen */ } }
    return api;
  };
  BA.closeAllModals = function () { openModals.slice().forEach(function (m) { m.close('all'); }); };

  /** Bekræftelse: giver et løfte, der er true ved ja. */
  BA.confirm = function (title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      BA.modal(title, '<p style="margin:0 0 4px">' + esc(text) + '</p><div class="actions"><button type="button" class="btn" data-no>Annullér</button><button type="button" class="btn ' + (danger ? 'danger' : 'primary') + '" data-yes>' + esc(okLabel || 'Ja') + '</button></div>',
        function (box, close) {
          box.querySelector('[data-no]').onclick = function () { done = true; close(); resolve(false); };
          box.querySelector('[data-yes]').onclick = function () { done = true; close(); resolve(true); };
        }, { onClose: function () { if (!done) resolve(false); } });
    });
  };

  // ---------- gem-status i topbjælken ----------
  var stateEl = null;
  function renderState() {
    stateEl = stateEl || $('#savestate');
    if (!stateEl) return;
    var S = BA.S, n = BA.store.queueLength(), up = BA.up && BA.up.pending ? BA.up.pending() : 0;
    var cls = '', html = '';
    var why = S.offlineWhy === 'server' ? 'Serveren svarer ikke' : 'Ikke forbundet';
    if (!S.online && n) { cls = 'bad'; html = why + ' – ' + n + (n === 1 ? ' ændring venter' : ' ændringer venter') + ' <button type="button" data-retry>Prøv igen</button>'; }
    else if (!S.online) { cls = 'work'; html = why + ' – viser sidst hentede'; }
    else if (S.error) { cls = 'bad'; html = '<span class="clip"></span> <button type="button" data-retry>OK</button>'; }
    else if (n || up) { cls = 'work'; html = '<span class="spin"></span> Gemmer …'; }
    else if (Date.now() - S.savedAt < 2500) { cls = 'ok'; html = 'Gemt ✓'; }
    stateEl.className = 'savestate ' + cls;
    stateEl.innerHTML = html;
    stateEl.setAttribute('role', 'status');
    var clip = stateEl.querySelector('.clip');
    if (clip) clip.textContent = S.error;
    var b = stateEl.querySelector('[data-retry]');
    if (b) b.onclick = function () { BA.store.retry(); };
  }
  BA.on('status', renderState);

  /** Står der en ugemt rettelse i et felt, mens noget andet skal tegnes om, venter vi med at tegne. */
  BA.focusInside = function (root) {
    var a = document.activeElement;
    if (!a || !root || !root.contains(a)) return false;
    if (a.tagName === 'TEXTAREA') return true;
    return a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file)$/.test(a.type);
  };

  // ---------- små byggeklodser ----------
  BA.options = function (list, selected, blank) {
    var h = blank != null ? '<option value="">' + esc(blank) + '</option>' : '';
    return h + list.map(function (v) { var val = typeof v === 'object' ? v.value : v, lab = typeof v === 'object' ? v.label : v; return '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('');
  };

  /** Tal-felter: viser og læser dansk. Giver { ok, value }. */
  BA.readNumber = function (input, kind) {
    var raw = input.value.trim();
    if (raw === '') { input.classList.remove('invalid'); return { ok: true, value: null }; }
    var n = U.pnum(raw);
    var bad = n === null || (kind === 'int' && Math.floor(n) !== n) || (kind !== 'money' && n < 0);
    input.classList.toggle('invalid', bad);
    return bad ? { ok: false, value: null } : { ok: true, value: n };
  };
})();
