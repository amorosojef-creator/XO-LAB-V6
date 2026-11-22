/* XO LAB — MIDI tab: connect, learn, mapping list + editor, profiles, starter profiles, monitor. Engine: midi-engine.js */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$, $$ = XO.$$, M = XO.midi;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let openKey = null, selKey = null, learnForAdd = false;

  const srcName = (key) => {
    const layer = key.startsWith('S|') ? 'SHIFT + ' : '', [k, ch, n] = key.replace(/^S\|/, '').split(':');
    const chs = ch === '*' ? ' (any ch)' : ch !== '1' ? ' (ch ' + ch + ')' : '';
    const name = { cc: 'CC ' + n, note: 'Note ' + n, pb: 'Pitch bend', cat: 'Pressure', pat: 'Pad pressure ' + n, pc: 'Program change' }[k] || key;
    return layer + name + chs;
  };
  const targetsText = (m) => m.targets.map((t) => M.labelOf(t.tg)).join(' + ') || '(no target)';

  /* ---------------- status + controller section ---------------- */
  function renderStatus() {
    const s = $('#midiState'); if (!s) return;
    if (!M.supported) s.textContent = XO.exporter && XO.exporter.isNative() ? 'iPhone doesn\'t allow MIDI in apps like this. Use the Windows or Mac app for MIDI controllers.' : 'This browser has no MIDI. Use the Windows / Mac app, Chrome or Edge.';
    else if (M.status === 'blocked') s.textContent = 'MIDI access was blocked. Allow it and press TRY AGAIN.';
    else if (M.status === 'nosystem') s.textContent = 'This computer\'s MIDI system didn\'t start. Reconnect the controller and press TRY AGAIN.';
    else if (M.status !== 'on') s.textContent = 'Press CONNECT, then plug in your controller.';
    else s.textContent = M.inputs.length ? 'CONNECTED: ' + M.inputs.join(', ') : 'No controller found. Plug one in (USB) — it appears here by itself.';
    const c = $('#midiConnect'); if (c) { c.hidden = !M.supported || M.status === 'on'; c.textContent = M.status === 'off' ? 'CONNECT MIDI' : 'TRY AGAIN'; }
    const l = $('#midiLearn'); if (l) { l.textContent = M.learning ? '■ DONE' : 'MIDI LEARN'; l.classList.toggle('on', M.learning); l.disabled = !M.supported; }
    ['clockSync', 'led', 'inProjects'].forEach((p) => { const i = $('#midiPref-' + p); if (i) i.checked = !!M.prefs[p]; });
    const sel = $('#midiProfile');
    if (sel) { sel.innerHTML = Object.keys(M.profiles).map((n) => `<option value="${esc(n)}"${n === M.active ? ' selected' : ''}>${esc(n)}</option>`).join(''); }
    const del = $('#midiProfileDel'); if (del) del.disabled = Object.keys(M.profiles).length < 2;
  }

  XO.customs.midiConnect = (el) => {
    el.id = 'midiPanel';
    const starters = Object.keys(XO.MIDI_STARTERS || {});
    el.innerHTML = `<div class="live-row"><button class="btn" id="midiConnect" type="button">CONNECT MIDI</button><button class="btn" id="midiLearn" type="button">MIDI LEARN</button></div>
      <div class="sub" id="midiState"></div>
      <div class="opt-label" style="margin-top:12px">PROFILE</div>
      <div class="live-row"><select id="midiProfile" aria-label="MIDI profile"></select><button class="mini" id="midiProfileSave" type="button">SAVE AS</button><button class="mini" id="midiProfileDel" type="button">DELETE</button></div>
      <div class="live-row" style="margin-top:6px"><button class="mini" id="midiExport" type="button">EXPORT .XOMIDI</button><button class="mini" id="midiImport" type="button">IMPORT</button><input type="file" id="midiImportFile" hidden></div>
      <div class="live-row" style="margin-top:6px"><select id="midiStarter" aria-label="Starter profile"><option value="">Load a starter profile…</option>${starters.map((n) => `<option>${esc(n)}</option>`).join('')}</select></div>
      <div class="sub" id="midiStarterAbout"></div>
      <label class="toggle">Sync tempo to MIDI clock <input type="checkbox" id="midiPref-clockSync"><i></i></label>
      <label class="toggle">Light up controller pads (LED feedback) <input type="checkbox" id="midiPref-led"><i></i></label>
      <label class="toggle">Save MIDI mappings inside projects <input type="checkbox" id="midiPref-inProjects"><i></i></label>`;
    el.querySelector('#midiConnect').addEventListener('click', () => M.connect());
    el.querySelector('#midiLearn').addEventListener('click', () => { M.setLearning(!M.learning); learnForAdd = false; if (M.learning) XO.toast('MIDI LEARN: click a slider, switch, option, scene, button or an action chip below — then move a knob / fader or hit a pad.', false, 6000); else $$('.midi-target').forEach((x) => x.classList.remove('midi-target')); });
    el.querySelector('#midiProfile').addEventListener('change', (e) => { M.useProfile(e.target.value); openKey = null; renderList(); XO.toast('Profile: ' + M.active); });
    el.querySelector('#midiProfileSave').addEventListener('click', async () => { const n = await XO.prompt('Save MIDI profile as', M.active === 'Default' ? 'MY CONTROLLER' : M.active); if (n && M.saveProfileAs(n)) { renderStatus(); renderList(); } });
    el.querySelector('#midiProfileDel').addEventListener('click', async () => { if (await XO.confirm('Delete profile?', M.active, 'DELETE')) { M.deleteProfile(M.active); renderStatus(); renderList(); } });
    el.querySelector('#midiExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(M.exportProfile(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = M.active.replace(/[\\/:*?"<>|]/g, '_') + '.xomidi'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    });
    el.querySelector('#midiImport').addEventListener('click', () => el.querySelector('#midiImportFile').click());
    el.querySelector('#midiImportFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const n = M.importProfile(JSON.parse(await f.text())); renderStatus(); renderList(); XO.toast('Imported profile: ' + n); } catch (err) { XO.toast(err.message || 'Could not read that file.', true); } });
    el.querySelector('#midiStarter').addEventListener('change', (e) => {
      const name = e.target.value; e.target.value = ''; const st = XO.MIDI_STARTERS[name]; if (!st) return;
      const n = M.importProfile({ app: 'XO LAB', kind: 'midi-profile', name: name + ' (starter)', map: st.build() });
      $('#midiStarterAbout').textContent = st.about + ' Starter layout — move each control once with LEARN if something doesn\'t respond.';
      renderStatus(); renderList(); XO.toast('Loaded starter: ' + n);
    });
    ['clockSync', 'led', 'inProjects'].forEach((p) => el.querySelector('#midiPref-' + p).addEventListener('change', (e) => { M.prefs[p] = e.target.checked; M.save(); if (p === 'clockSync' && !e.target.checked && XO.S.audio.bpmMode === 'clock') { XO.S.audio.bpmMode = 'auto'; XO.syncKey('audio.bpmMode'); } }));
    renderStatus();
    if (M.supported && (window.xoDesktop || Object.keys(M.map).length)) setTimeout(() => M.connect(), 0);
  };

  /* ---------------- learn targets that aren't on-screen controls ---------------- */
  XO.customs.midiActions = (el) => {
    const chips = Object.keys(M.ACTIONS).map((a) => [a, M.ACTIONS[a].label]).concat([['shift', 'SHIFT (second layer)'], ['xfade', 'Crossfade Scene A ↔ B'], ['sceneSel', 'Scene select (knob)']]);
    el.innerHTML = `<div class="midi-chips">${chips.map(([a, l]) => `<button class="mini" type="button" data-midi-action="${a}">${esc(l)}</button>`).join('')}</div>
      <div class="hint">In MIDI LEARN, click one of these (or any slider, switch, option or scene in the other tabs), then move the control. Scene slot pads come with the starter profiles, or map a scene's LOAD button.</div>`;
  };

  /* ---------------- mapping list + editor ---------------- */
  function renderList() {
    const el = $('#midiList'); if (!el) return;
    const keys = Object.keys(M.map);
    if (!keys.length) { el.innerHTML = '<div class="sub">No mappings yet. Press MIDI LEARN, or load a starter profile.</div>'; return; }
    el.innerHTML = keys.map((key) => {
      const m = M.map[key], T = M.TYPES[m.type] || { icon: '?', label: m.type };
      return `<div class="midi-map${key === openKey ? ' open' : ''}${key === selKey ? ' sel' : ''}" data-key="${esc(key)}">
        <button class="midi-row" type="button" data-open="${esc(key)}"><span class="ico" title="${esc(T.label)}">${T.icon}</span><span class="src">${esc(srcName(key))}</span><span class="tgt">${esc(targetsText(m))}</span><span class="bar"><i></i><b></b></span></button>
        ${key === openKey ? editor(key, m) : ''}</div>`;
    }).join('');
    if (openKey) drawCurve();
  }
  M.renderList = renderList;

  function opt(list, val) { return Object.keys(list).map((k) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(typeof list[k] === 'string' ? list[k] : list[k].label)}</option>`).join(''); }
  function editor(key, m) {
    const type = m.type, cont = !M.isBtn(type) && !M.isRel(type) && type !== 'program', rel = M.isRel(type), btn = M.isBtn(type), isCC = /^(S\|)?cc:/.test(key);
    const sceneNames = XO.scenes.list().map((s) => s.name);
    const sceneOpts = (v) => '<option value="">—</option>' + sceneNames.map((n) => `<option${n === v ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const xf = type === 'crossfader' || m.targets.some((t) => t.tg.t === 'xfade');
    return `<div class="midi-edit" data-edit="${esc(key)}">
      <div class="me-grid">
        <label>Control type<select data-f="type">${opt(M.TYPES, type)}</select></label>
        ${rel ? `<label>Encoder format<select data-f="rel">${opt({ twos: 'Two\'s complement (1 up / 127 down)', offset: 'Binary offset (65 up / 63 down)', sign: 'Sign bit (1 up / 65 down)' }, m.rel)}</select></label>
          <label>Step per click<input type="number" data-f="step" min="0.1" max="50" step="0.1" value="${m.step}"></label>
          <label class="chk"><input type="checkbox" data-f="accel"${m.accel ? ' checked' : ''}> Acceleration</label>` : ''}
        ${btn ? `<label>Button mode<select data-f="btn">${opt({ '': 'Auto (' + (type === 'pad' ? 'trigger' : type) + ')', momentary: 'Momentary (while held)', toggle: 'Toggle', trigger: 'Trigger (one shot)' }, m.btn)}</select></label>
          <label>Velocity<select data-f="velocity">${opt({ ignore: 'Ignore hit strength', scale: 'Hit strength sets the amount' }, m.velocity)}</select></label>` : ''}
        ${cont ? `<label>Smoothing <em>${m.smooth} ms</em><input type="range" data-f="smooth" min="0" max="500" step="10" value="${m.smooth}"></label>
          <label class="chk"><input type="checkbox" data-f="takeover"${m.takeover ? ' checked' : ''}> Soft takeover (no jumps)</label>` : ''}
        ${type === 'crossfader' || type === 'pitchbend' ? `<label>Centre dead zone <em>${Math.round(m.dead * 100)}%</em><input type="range" data-f="dead" min="0" max="0.2" step="0.01" value="${m.dead}"></label>` : ''}
        ${xf ? `<label>Scene A (left)<select data-f="sceneA">${sceneOpts(m.sceneA)}</select></label><label>Scene B (right)<select data-f="sceneB">${sceneOpts(m.sceneB)}</select></label>` : ''}
        <label class="chk"><input type="checkbox" data-f="anyCh"${key.includes(':*') ? ' checked' : ''}> Any MIDI channel</label>
        ${isCC && cont ? `<label class="chk"><input type="checkbox" data-f="hiRes"${m.hiRes ? ' checked' : ''}> 14-bit (CC + CC+32)</label>` : ''}
      </div>
      <div class="me-curve"><canvas width="240" height="120" id="midiCurve" aria-label="Response curve"></canvas><div class="sub">Live response · ${esc(M.TYPES[type] ? M.TYPES[type].label : type)}</div></div>
      <div class="opt-label">TARGETS (${m.targets.length}/8)</div>
      ${m.targets.map((t, i) => `<div class="me-target" data-ti="${i}"><b>${esc(M.labelOf(t.tg))}</b>
        <label>Min<input type="number" data-t="min" min="0" max="100" value="${Math.round(t.min * 100)}">%</label>
        <label>Max<input type="number" data-t="max" min="0" max="100" value="${Math.round(t.max * 100)}">%</label>
        <label>Curve<select data-t="curve">${opt(M.CURVES, t.curve)}</select></label>
        <label class="chk"><input type="checkbox" data-t="invert"${t.invert ? ' checked' : ''}> Invert</label>
        <button class="mini" type="button" data-t-del="${i}" aria-label="Remove target"${m.targets.length < 2 ? ' disabled' : ''}>✕</button></div>`).join('')}
      <div class="live-row"><button class="mini" type="button" data-add-target>+ ADD TARGET</button><button class="mini" type="button" data-del-map>REMOVE MAPPING</button></div>
    </div>`;
  }

  function rekey(oldKey, anyCh) {
    const layer = oldKey.startsWith('S|') ? 'S|' : '', parts = oldKey.replace(/^S\|/, '').split(':');
    if (anyCh) { parts[1] = '*'; } else if (parts[1] === '*') parts[1] = '1';
    const nk = layer + parts.join(':'); if (nk === oldKey) return oldKey;
    M.map[nk] = M.map[oldKey]; delete M.map[oldKey]; return nk;
  }

  function onEdit(e) {
    const box = e.target.closest('[data-edit]'); if (!box) return;
    let key = box.dataset.edit; const m = M.map[key]; if (!m) return;
    const f = e.target.dataset.f, tf = e.target.dataset.t;
    if (f) {
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' || e.target.type === 'range' ? +e.target.value : e.target.value;
      if (f === 'type') { const keep = { targets: m.targets, sceneA: m.sceneA, sceneB: m.sceneB, hiRes: m.hiRes }; Object.assign(m, M.defaults(v), keep); }
      else if (f === 'anyCh') { key = rekey(key, v); openKey = key; }
      else m[f] = v;
      M.save();
      if (e.type === 'change' && (f === 'type' || f === 'anyCh')) renderList();
      else { const em = e.target.parentElement.querySelector('em'); if (em) em.textContent = f === 'dead' ? Math.round(v * 100) + '%' : v + ' ms'; }
      return;
    }
    if (tf) {
      const i = +e.target.closest('[data-ti]').dataset.ti, t = m.targets[i];
      if (tf === 'invert') t.invert = e.target.checked;
      else if (tf === 'curve') t.curve = e.target.value;
      else { const n = Math.min(100, Math.max(0, +e.target.value || 0)) / 100; t[tf] = n; }
      M.save(); drawCurve();
    }
  }

  function drawCurve() {
    const c = $('#midiCurve'); if (!c || !openKey || !M.map[openKey]) return;
    const m = M.map[openKey], t = m.targets[0] || { min: 0, max: 1, invert: false, curve: 'linear' }, g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((W * i) / 4, 0); g.lineTo((W * i) / 4, H); g.moveTo(0, (H * i) / 4); g.lineTo(W, (H * i) / 4); g.stroke(); }
    const y = (n) => { let x = t.invert ? 1 - n : n; x = M.curve(t.curve, x); return t.min + x * (t.max - t.min); };
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 60; i++) { const n = i / 60; const px = n * W, py = H - y(n) * H; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    const live = M.live[openKey];
    if (live && live.n !== undefined) { const px = live.n * W, py = H - y(live.n) * H; g.fillStyle = live.waiting !== undefined ? '#888' : '#fff'; g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill(); }
  }

  function paintBars() {
    $$('#midiList .midi-map').forEach((row) => {
      const live = M.live[row.dataset.key]; const bar = row.querySelector('.bar i'), ghost = row.querySelector('.bar b');
      if (!bar) return;
      const n = live ? (live.n !== undefined ? live.n : 0.5 + Math.max(-0.5, Math.min(0.5, (live.d || 0) / 20))) : 0;
      bar.style.width = (n * 100).toFixed(1) + '%';
      ghost.style.left = live && live.waiting !== undefined ? (live.waiting * 100).toFixed(1) + '%' : '-10px';
      row.classList.toggle('waiting', !!(live && live.waiting !== undefined));
    });
    drawCurve();
  }
  let barsQueued = false;
  function queueBars() { if (barsQueued) return; barsQueued = true; requestAnimationFrame(() => { barsQueued = false; paintBars(); }); }

  XO.customs.midiMappings = (el) => {
    el.innerHTML = '<div id="midiList" class="midi-list"></div><div class="hint">Tap a row to set its range, curve, smoothing, soft takeover, encoder format, button mode, velocity and extra targets. A grey marker means a fader is waiting to pick up the on-screen value.</div>';
    el.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { const k = o.dataset.open; openKey = openKey === k ? null : k; selKey = k; renderList(); return; }
      const box = e.target.closest('[data-edit]'); if (!box) return;
      const key = box.dataset.edit, m = M.map[key];
      if (e.target.closest('[data-del-map]')) { if (await XO.confirm('Remove mapping?', srcName(key) + ' → ' + targetsText(m), 'REMOVE')) { delete M.map[key]; openKey = null; M.save(); renderList(); } return; }
      const td = e.target.closest('[data-t-del]'); if (td) { m.targets.splice(+td.dataset.tDel, 1); M.save(); renderList(); return; }
      if (e.target.closest('[data-add-target]')) { M.setLearning(true); M.addTo = key; learnForAdd = true; renderStatus(); XO.toast('Click the control to add to ' + srcName(key) + ' (in any tab, or an action chip).', false, 6000); }
    });
    el.addEventListener('input', onEdit); el.addEventListener('change', onEdit);
    renderList();
  };

  /* ---------------- monitor ---------------- */
  XO.customs.midiMonitor = (el) => {
    el.innerHTML = '<div class="midi-log" id="midiLog" aria-live="off"></div><div class="live-row"><button class="mini" type="button" id="midiLogClear">CLEAR</button></div>';
    el.querySelector('#midiLogClear').addEventListener('click', () => { M.log.length = 0; paintLog(); });
    paintLog();
  };
  let logQueued = false;
  function paintLog() { const l = $('#midiLog'); if (l) l.innerHTML = M.log.length ? M.log.map((x) => '<div>' + esc(x) + '</div>').join('') : '<div class="sub">Move any control to see what it sends.</div>'; }

  M.onChange = () => { renderStatus(); };
  M.onMessage = () => { queueBars(); if (!logQueued) { logQueued = true; setTimeout(() => { logQueued = false; paintLog(); }, 80); } };
  M.onLearned = (key, m) => {
    $$('.midi-target').forEach((x) => x.classList.remove('midi-target'));
    if (learnForAdd) { learnForAdd = false; M.setLearning(false); openKey = key; }
    else XO.toast('Mapped ' + srcName(key) + ' → ' + targetsText(M.map[key]) + ' · ' + (M.TYPES[M.map[key].type] || {}).label);
    selKey = key; renderList(); renderStatus();
  };

  // keyboard in the MIDI tab (desktop)
  document.addEventListener('keydown', (e) => {
    const panel = document.querySelector('.panel.active[data-panel="midi"]'); if (!panel) return;
    const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') return;
    const keys = Object.keys(M.map);
    if (e.key === 'Escape' && M.learning) { M.setLearning(false); renderStatus(); }
    else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) { M.setLearning(!M.learning); renderStatus(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && keys.length) { e.preventDefault(); let i = keys.indexOf(selKey); i = e.key === 'ArrowDown' ? Math.min(keys.length - 1, i + 1) : Math.max(0, i - 1); selKey = keys[i]; openKey = selKey; renderList(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selKey && M.map[selKey]) { e.preventDefault(); delete M.map[selKey]; if (openKey === selKey) openKey = null; selKey = null; M.save(); renderList(); }
  });
})();
