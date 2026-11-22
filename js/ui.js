/* XO LAB — UI helpers + schema builder/binder */
(function () {
  'use strict';
  const XO = (window.XO = window.XO || {});
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  XO.$ = $; XO.$$ = $$;

  // Scroll the settings panel (and only the panel) so `el` is visible. scrollIntoView would also scroll the page.
  XO.revealInPanel = function (el, where) {
    const box = document.getElementById('panels'); if (!el || !box) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    let top = box.scrollTop + (r.top - b.top) - 8;
    if (where === 'center') top -= (box.clientHeight - r.height) / 2 - 8;
    box.scrollTo({ top: Math.max(0, top), behavior: where === 'center' ? 'smooth' : 'auto' });
  };
  // The app is a fixed screen: if anything ever scrolls the page itself, put it straight back.
  const pinPage = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const se = document.scrollingElement; if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
    if (document.body && (document.body.scrollTop || document.body.scrollLeft)) { document.body.scrollTop = 0; document.body.scrollLeft = 0; }
  };
  window.addEventListener('scroll', pinPage, { passive: true });
  document.addEventListener('scroll', (e) => { const t = e.target; if (t && t.nodeType === 1 && t.closest && t.closest('.app') && !t.closest('#panels') && t.id !== 'tabbar' && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; } }, { capture: true, passive: true });
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  XO.paintRange = function (el) {
    const min = +el.min || 0, max = +el.max || 100;
    el.style.setProperty('--p', Math.max(0, Math.min(100, ((+el.value - min) / (max - min)) * 100)).toFixed(2) + '%');
  };
  XO.paintAllRanges = () => $$('input.range').forEach(XO.paintRange);

  let toastTimer = 0;
  XO.toast = function (msg, isError, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('err', !!isError); t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || (isError ? 6500 : 3200));
  };
  XO.setStatus = (txt) => { $('#topStatus').textContent = txt; };
  XO.loading = function (on, label) { $('#loading').hidden = !on; if (label) $('#loadingText').textContent = label; };

  // In-app confirm dialog (no blocking browser dialogs)
  XO.confirm = function (title, body, okLabel) {
    return new Promise((resolve) => {
      const d = $('#dialog');
      $('#dialogTitle').textContent = title; $('#dialogBody').textContent = body; $('#dialogOk').textContent = okLabel || 'OK';
      d.hidden = false;
      const done = (v) => { d.hidden = true; $('#dialogOk').onclick = $('#dialogCancel').onclick = null; resolve(v); };
      $('#dialogOk').onclick = () => done(true); $('#dialogCancel').onclick = () => done(false);
    });
  };
  XO.prompt = function (title, value) {
    return new Promise((resolve) => {
      const d = $('#dialog'), inp = $('#dialogInput');
      $('#dialogTitle').textContent = title; $('#dialogBody').textContent = ''; $('#dialogOk').textContent = 'OK';
      inp.hidden = false; inp.value = value || ''; d.hidden = false; setTimeout(() => inp.focus(), 30);
      const done = (v) => { d.hidden = true; inp.hidden = true; $('#dialogOk').onclick = $('#dialogCancel').onclick = null; resolve(v); };
      $('#dialogOk').onclick = () => done(inp.value.trim() || null); $('#dialogCancel').onclick = () => done(null);
    });
  };

  XO.fmtTime = function (sec, withHundredths) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    const base = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return withHundredths ? base + '.' + String(Math.floor((sec % 1) * 100)).padStart(2, '0') : base;
  };
  XO.ext = (name) => ((name || '').split('.').pop() || '').toLowerCase();
  XO.MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae'];
  XO.classify = function (file) {
    const t = file.type || '', e = XO.ext(file.name);
    if (XO.MODEL_EXT.includes(e)) return 'model';
    if (['bin', 'mtl', 'ktx2', 'tga'].includes(e)) return 'model-part';
    if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp'].includes(e)) return 'image';
    if (t.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ogv'].includes(e)) return 'video';
    if (t.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus', 'aif', 'aiff'].includes(e)) return 'audio';
    return 'other';
  };

  /* =================== schema builder =================== */
  XO.customs = {};
  const FMT = { '%': (v) => v + '%', ms: (v) => v + ' ms', s: (v) => (+v).toFixed(2) + ' s', px: (v) => v + ' px', '°': (v) => v + '°', Hz: (v) => v + ' Hz', '/s': (v) => v + '/s', '': (v) => String(v) };
  const fmtVal = (ctl, v) => (FMT[ctl.fmt] || FMT[''])(v);
  const CTL = {}; // k -> list of control defs (a key may appear in several panels)

  function showAttr(ctl) { return ctl.show ? ' data-show="' + esc(ctl.show) + '"' : ''; }
  function controlHTML(ctl) {
    if (ctl.k) (CTL[ctl.k] = CTL[ctl.k] || []).push(ctl);
    const lock = ctl.lock ? ' lockable' : '';
    switch (ctl.type) {
      case 'range':
        return '<div class="control' + lock + '"' + showAttr(ctl) + '><div class="control-head">' + esc(ctl.label) + ' <output data-out="' + ctl.k + '"></output></div><input class="range" type="range" data-k="' + ctl.k + '" min="' + ctl.min + '" max="' + ctl.max + '" step="' + ctl.step + '" aria-label="' + esc(ctl.label) + '"></div>';
      case 'toggle':
        return '<label class="toggle' + lock + '"' + showAttr(ctl) + '>' + esc(ctl.label) + ' <input type="checkbox" data-k="' + ctl.k + '"><i></i></label>';
      case 'seg':
        return '<div class="seg-wrap' + lock + '"' + showAttr(ctl) + '><div class="opt-label">' + esc(ctl.label.toUpperCase()) + '</div><div class="seg" data-k="' + ctl.k + '" role="radiogroup" aria-label="' + esc(ctl.label) + '">' + ctl.options.map((o) => '<button type="button" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div></div>';
      case 'select':
        return '<div class="control' + lock + '"' + showAttr(ctl) + '><div class="control-head">' + esc(ctl.label) + '</div><select data-k="' + ctl.k + '" aria-label="' + esc(ctl.label) + '">' + ctl.options.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></div>';
      case 'color':
        return '<div class="color-row"' + showAttr(ctl) + '><span class="color-label">' + esc(ctl.label) + '</span><input type="color" data-k="' + ctl.k + '" aria-label="' + esc(ctl.label) + '"><input class="hex" data-hex="' + ctl.k + '" maxlength="7" spellcheck="false" aria-label="' + esc(ctl.label) + ' hex"><span class="swatches" data-sw="' + ctl.k + '"></span></div>';
      case 'number':
        return '<div class="control num' + lock + '"' + showAttr(ctl) + '><div class="control-head">' + esc(ctl.label) + '</div><input type="number" data-k="' + ctl.k + '" min="' + ctl.min + '" max="' + ctl.max + '" inputmode="numeric"></div>';
      case 'text':
        return '<div class="control"' + showAttr(ctl) + '><div class="control-head">' + esc(ctl.label) + '</div><textarea data-k="' + ctl.k + '" rows="2" placeholder="' + esc(ctl.placeholder || '') + '"></textarea></div>';
      case 'hint':
        return '<div class="hint"' + showAttr(ctl) + '>' + esc(ctl.text) + '</div>';
      case 'custom':
        return '<div class="custom" data-custom="' + ctl.name + '"' + showAttr(ctl) + '></div>';
      default: return '';
    }
  }

  XO.buildPanels = function () {
    const panels = $('#panels'), tabbar = $('#tabbar');
    panels.innerHTML = ''; tabbar.innerHTML = '';
    XO.SCHEMA.forEach((p) => {
      const keys = [];
      let html = '<section class="panel" data-panel="' + p.id + '"><div class="panel-title">' + p.title + ' <span>' + p.sub + '</span><button class="mini" type="button" data-reset-panel="' + p.id + '" title="Reset this panel">RESET</button></div>';
      p.sections.forEach((s, si) => {
        const main = (s.controls || []).filter((c) => !c.adv), adv = (s.controls || []).filter((c) => c.adv);
        (s.controls || []).forEach((c) => c.k && keys.push(c.k));
        html += '<details class="sec"' + (s.id ? ' id="' + s.id + '"' : '') + ' open><summary><span>' + esc(s.title) + '</span>' + (s.colorGroup ? '<button class="mini clink" type="button" data-color-group="' + s.colorGroup + '">COLORS</button>' : '') + '</summary><div class="sec-body">';
        if (s.custom) html += '<div class="custom" data-custom="' + s.custom + '"></div>';
        html += main.map(controlHTML).join('');
        if (adv.length) html += '<details class="adv"><summary>ADVANCED</summary>' + adv.map(controlHTML).join('') + '</details>';
        html += '</div></details>';
      });
      html += '</section>';
      panels.insertAdjacentHTML('beforeend', html);
      p.keys = keys;
      tabbar.insertAdjacentHTML('beforeend', '<button type="button" data-tab="' + p.id + '"><svg viewBox="0 0 24 24">' + p.icon + '</svg>' + p.tab + '</button>');
    });
    $$('[data-custom]').forEach((el) => { const fn = XO.customs[el.dataset.custom]; if (fn) fn(el); });
    bind();
    XO.syncUI();
  };

  /* =================== binding =================== */
  const recent = [];
  function pushRecent(hex) { const i = recent.indexOf(hex); if (i >= 0) recent.splice(i, 1); recent.unshift(hex); if (recent.length > 6) recent.length = 6; paintSwatches(); }
  function paintSwatches() { $$('[data-sw]').forEach((el) => { el.innerHTML = recent.map((h) => '<button type="button" class="sw" data-swatch="' + h + '" style="background:' + h + '" aria-label="' + h + '"></button>').join(''); }); }
  const normHex = (v) => { v = String(v || '').trim(); if (!v.startsWith('#')) v = '#' + v; return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : /^#[0-9a-fA-F]{3}$/.test(v) ? ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase() : null; };

  function commit(k, v, fromEl) {
    XO.set(k, v);
    syncKey(k, fromEl);
    evalShow();
    if (XO.onSetting) XO.onSetting(k, v);
  }

  function bind() {
    const root = $('#panels');
    root.addEventListener('input', (e) => {
      const el = e.target, k = el.dataset.k;
      if (k && el.type === 'range') commit(k, +el.value, el);
      else if (k && el.type === 'color') commit(k, el.value.toLowerCase(), el);
      else if (k && el.tagName === 'TEXTAREA') commit(k, el.value, el);
    });
    root.addEventListener('change', (e) => {
      const el = e.target, k = el.dataset.k;
      if (k && el.type === 'checkbox') commit(k, el.checked, el);
      else if (k && el.tagName === 'SELECT') commit(k, el.value, el);
      else if (k && el.type === 'number') { const v = Math.max(+el.min || 1, Math.min(+el.max || 1e5, Math.round(+el.value || 0))); commit(k, v, null); }
      else if (k && el.type === 'color') pushRecent(el.value.toLowerCase());
      else if (el.dataset.hex) { const h = normHex(el.value); if (h) { commit(el.dataset.hex, h, null); pushRecent(h); } else syncKey(el.dataset.hex); }
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('.seg[data-k] button[data-value]');
      if (b) { const seg = b.parentElement; if (seg.closest('.locked')) return; commit(seg.dataset.k, b.dataset.value, null); return; }
      const sw = e.target.closest('[data-swatch]');
      if (sw) { const k = sw.parentElement.dataset.sw; commit(k, sw.dataset.swatch, null); return; }
      const cl = e.target.closest('[data-color-group]');
      if (cl) { e.preventDefault(); e.stopPropagation(); XO.showTab('color'); const g = $('#cg-' + cl.dataset.colorGroup); if (g) { g.open = true; XO.revealInPanel(g); g.classList.add('flash'); setTimeout(() => g.classList.remove('flash'), 900); } return; }
      const rp = e.target.closest('[data-reset-panel]');
      if (rp) { const p = XO.SCHEMA.find((x) => x.id === rp.dataset.resetPanel); XO.resetPaths(p.keys.concat(p.extraReset || [])); if (XO.onReset) XO.onReset(p.id); XO.syncUI(); XO.toast(p.title + ' reset to defaults.'); }
    });
  }

  function syncKey(k, skipEl) {
    const v = XO.get(k);
    $$('[data-k="' + k + '"]').forEach((el) => {
      if (el === skipEl) { if (el.type === 'range') XO.paintRange(el); return; }
      if (el.classList.contains('seg')) $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.value === String(v)));
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range') { el.value = v; XO.paintRange(el); }
      else el.value = v == null ? '' : v;
    });
    $$('[data-hex="' + k + '"]').forEach((el) => { if (document.activeElement !== el) el.value = v; });
    $$('[data-out="' + k + '"]').forEach((el) => { const ctl = (CTL[k] || [])[0]; el.textContent = ctl ? fmtVal(ctl, v) : v; });
  }

  function evalCond(expr) {
    let neg = false; if (expr[0] === '!') { neg = true; expr = expr.slice(1); }
    let res;
    if (expr.includes('=')) { const [k, vals] = expr.split('='); res = vals.split('|').includes(String(XO.get(k))); }
    else res = !!XO.get(expr);
    return neg ? !res : res;
  }
  function evalShow() { $$('[data-show]').forEach((el) => { el.hidden = !evalCond(el.dataset.show); }); }

  XO.syncUI = function () { Object.keys(CTL).forEach((k) => syncKey(k)); evalShow(); if (XO.onSync) XO.onSync(); };
  XO.evalShow = evalShow;
  XO.syncKey = syncKey;

  // segmented control helpers for custom widgets
  XO.setSeg = function (el, value) { $$('button[data-value]', el).forEach((b) => b.classList.toggle('on', b.dataset.value === String(value))); };
})();
