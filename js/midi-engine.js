/* XO LAB — MIDI engine (5.1).
 * Every physical control has a type with its own behaviour: absolute knobs, endless encoders, faders with soft
 * takeover, crossfaders (scene morph), momentary / toggle / trigger buttons, velocity pads, pressure, jog wheels,
 * pitch bend, 14-bit CC, program change and MIDI clock. Values are collected in the MIDI callback and applied once
 * per animation frame, so a fast fader never costs frames. Mappings live in named profiles on this device. */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$;
  const STORE = 'xolab-midi-v2', OLD = 'xolab-midi-map-v1';

  const M = (XO.midi = {
    supported: typeof navigator.requestMIDIAccess === 'function',
    access: null, inputs: [], outputs: [], status: 'off', error: '',
    profiles: {}, active: 'Default', map: {}, prefs: { clockSync: false, led: false, inProjects: false },
    learning: false, target: null, addTo: null, shift: false, last: '', log: [], live: {},
    clock: { ticks: [], bpm: 0, beatAt: 0, count: 0, last: 0, running: false },
    onChange: null, onMessage: null, onLearned: null,
  });

  /* ============================== types ============================== */
  M.TYPES = {
    knob: { label: 'Knob (absolute)', group: 'cont', icon: '◔' },
    encoder: { label: 'Endless encoder (relative)', group: 'rel', icon: '⟳' },
    fader: { label: 'Fader / slider', group: 'cont', icon: '▮' },
    crossfader: { label: 'Crossfader', group: 'cont', icon: '⇔' },
    momentary: { label: 'Button: momentary (hold)', group: 'btn', icon: '●' },
    toggle: { label: 'Button: toggle', group: 'btn', icon: '◐' },
    trigger: { label: 'Button: trigger (one shot)', group: 'btn', icon: '○' },
    pad: { label: 'Pad with velocity', group: 'btn', icon: '▣' },
    pressure: { label: 'Pad pressure (aftertouch)', group: 'cont', icon: '▤' },
    jog: { label: 'Jog wheel', group: 'rel', icon: '◎' },
    pitchbend: { label: 'Pitch bend', group: 'cont', icon: '⇕' },
    program: { label: 'Program change → scene', group: 'prog', icon: '#' },
  };
  M.CURVES = { linear: 'Linear', exp: 'Exponential (fine at the low end)', log: 'Logarithmic (fine at the high end)', s: 'S-curve' };
  const curveFn = {
    linear: (x) => x, exp: (x) => x * x, log: (x) => Math.sqrt(x),
    s: (x) => x * x * (3 - 2 * x),
  };
  const curveInv = {
    linear: (y) => y, exp: (y) => Math.sqrt(y), log: (y) => y * y,
    s: (y) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (m * m * (3 - 2 * m) < y) lo = m; else hi = m; } return (lo + hi) / 2; },
  };
  M.curve = (name, x) => (curveFn[name] || curveFn.linear)(Math.min(1, Math.max(0, x)));

  function defaults(type) {
    const m = { type, targets: [], smooth: 0, takeover: false, step: 1, accel: true, rel: 'twos', btn: '', velocity: 'ignore', dead: 0.03, anyCh: false, hiRes: false, sceneA: '', sceneB: '' };
    if (type === 'fader' || type === 'knob') { m.smooth = 40; m.takeover = true; }
    if (type === 'crossfader') { m.smooth = 30; }
    if (type === 'pad') m.velocity = 'scale';
    if (type === 'pressure') m.smooth = 30;
    return m;
  }
  M.defaults = defaults;
  const isBtn = (t) => M.TYPES[t] && M.TYPES[t].group === 'btn';
  const isRel = (t) => M.TYPES[t] && M.TYPES[t].group === 'rel';
  M.isBtn = isBtn; M.isRel = isRel;

  /* ============================== storage ============================== */
  function save() {
    M.profiles[M.active] = { map: M.map };
    try { localStorage.setItem(STORE, JSON.stringify({ active: M.active, profiles: M.profiles, prefs: M.prefs })); } catch (e) { /* private mode */ }
    if (M.onChange) M.onChange();
  }
  M.save = save;
  function migrateV1(old) {
    const map = {};
    Object.keys(old || {}).forEach((src) => {
      const tg = old[src]; if (!tg) return;
      const type = src.startsWith('cc:') ? (tg.t === 'range' ? 'knob' : 'trigger') : (tg.t === 'range' ? 'pad' : tg.t === 'toggle' ? 'toggle' : 'trigger');
      const m = defaults(type); m.targets = [{ tg, min: 0, max: 1, invert: false, curve: 'linear' }];
      if (type === 'knob') { m.takeover = false; m.smooth = 0; } // 5.0.1 behaviour: jump straight to the knob
      if (type === 'pad') m.velocity = 'ignore';
      if (src.startsWith('cc:') && tg.t !== 'range') m.btn = 'trigger';
      map[src] = m;
    });
    return map;
  }
  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* */ }
    if (data && data.profiles) {
      M.profiles = data.profiles; M.active = data.active in data.profiles ? data.active : Object.keys(data.profiles)[0] || 'Default';
      M.prefs = Object.assign(M.prefs, data.prefs || {});
    } else {
      let old = null; try { old = JSON.parse(localStorage.getItem(OLD)); } catch (e) { /* */ }
      M.profiles = { Default: { map: old ? migrateV1(old) : {} } }; M.active = 'Default';
    }
    if (!M.profiles[M.active]) M.profiles[M.active] = { map: {} };
    M.map = M.profiles[M.active].map;
  }
  M.reload = load; M._migrateV1 = migrateV1;
  load();

  M.useProfile = function (name) { if (!M.profiles[name]) return false; M.profiles[M.active] = { map: M.map }; M.active = name; M.map = M.profiles[name].map; M.live = {}; tk.clear(); save(); return true; };
  M.saveProfileAs = function (name) { name = String(name || '').trim().slice(0, 40); if (!name) return false; M.profiles[name] = { map: JSON.parse(JSON.stringify(M.map)) }; M.active = name; M.map = M.profiles[name].map; save(); return true; };
  M.deleteProfile = function (name) { if (Object.keys(M.profiles).length < 2) return false; delete M.profiles[name]; if (M.active === name) { M.active = Object.keys(M.profiles)[0]; M.map = M.profiles[M.active].map; } save(); return true; };
  M.exportProfile = (name) => ({ app: 'XO LAB', kind: 'midi-profile', format: 2, name: name || M.active, map: (M.profiles[name || M.active] || { map: M.map }).map });
  M.importProfile = function (obj, nameOverride) {
    if (!obj || obj.app !== 'XO LAB' || obj.kind !== 'midi-profile' || typeof obj.map !== 'object') throw new Error('This isn\'t an XO LAB MIDI profile.');
    let name = String(nameOverride || obj.name || 'Imported').slice(0, 40), n = 2;
    const base = name; while (M.profiles[name]) name = base + ' ' + n++;
    const map = {}; Object.keys(obj.map).forEach((k) => { const m = obj.map[k]; if (m && Array.isArray(m.targets)) map[k] = Object.assign(defaults(m.type || 'knob'), m); });
    M.profiles[name] = { map }; M.useProfile(name);
    return name;
  };

  /* ============================== targets ============================== */
  M.ACTIONS = {
    play: { label: 'Play / pause', run: () => XO.togglePlay && XO.togglePlay() },
    tap: { label: 'Tap tempo', run: () => { const b = $('#tapBtn'); if (b) b.click(); } },
    blackout: { label: 'Blackout', hold: true, set: (on) => { XO.perform.blackout = on; }, get: () => XO.perform.blackout },
    freeze: { label: 'Freeze frame', hold: true, set: (on) => { XO.perform.freeze = on; }, get: () => XO.perform.freeze },
    strobe: { label: 'Strobe (while held)', hold: true, set: (on) => XO.strobeHold && XO.strobeHold(on), get: () => !!(XO.strobe && XO.strobe.held) },
    randomize: { label: 'Randomize this tab', run: () => randomizeTab() },
    nextScene: { label: 'Next scene', run: () => stepScene(1) },
    prevScene: { label: 'Previous scene', run: () => stepScene(-1) },
    undo: { label: 'Undo', run: () => XO.undo && XO.undo() },
    redo: { label: 'Redo', run: () => XO.redo && XO.redo() },
    liveAudio: { label: 'Live audio on / off', run: () => XO.live && (XO.audio.live.on ? XO.live.stopAudio() : XO.live.startAudio()) },
    camera: { label: 'Camera on / off', run: () => XO.live && (XO.state.V.kind === 'camera' ? XO.live.stopCamera() : XO.live.startCamera()) },
    saveProject: { label: 'Save project', run: () => XO.project && XO.project.save() },
  };
  let sceneIdx = -1;
  function scenes() { return XO.scenes.list(); }
  function loadSceneAt(i, wrap) { const l = scenes(); if (!l.length) return false; if (!wrap && i >= l.length) return false; sceneIdx = ((i % l.length) + l.length) % l.length; return XO.loadScene(l[sceneIdx].name); }
  function stepScene(d) { const l = scenes(); if (!l.length) { XO.toast('No scenes saved yet (Export tab → Scenes).', true); return; } loadSceneAt(sceneIdx < 0 ? (d > 0 ? 0 : l.length - 1) : sceneIdx + d, true); }
  function randomizeTab() {
    const panel = document.querySelector('.panel.active') || document.querySelector('.panel:not([hidden])');
    const ranges = panel ? Array.from(panel.querySelectorAll('input[type="range"][data-k]')).filter((r) => !/^(out|strobe)\./.test(r.dataset.k)) : [];
    if (!ranges.length) return;
    if (XO.history) XO.history.flush();
    ranges.forEach((r) => { const lo = +r.min, hi = +r.max, st = +r.step || 1; r.value = Math.round((lo + (0.2 + Math.random() * 0.6) * (hi - lo)) / st) * st; r.dispatchEvent(new Event('input', { bubbles: true })); });
    XO.toast('Randomized ' + ranges.length + ' settings — Undo brings them back.');
  }

  /** A target, saved by setting key / scene / action / element id so it survives reloads. */
  M.targetOf = function (el) {
    if (!el) return null;
    const act = el.closest('[data-midi-action]'); if (act) return act.dataset.midiAction === 'shift' ? { t: 'shift' } : act.dataset.midiAction === 'xfade' ? { t: 'xfade' } : act.dataset.midiAction === 'sceneSel' ? { t: 'sceneSel' } : { t: 'action', a: act.dataset.midiAction };
    const range = el.closest('input[type="range"][data-k]'); if (range) return { t: 'range', k: range.dataset.k };
    const tog = el.closest('label.toggle'); if (tog) { const i = tog.querySelector('input[type="checkbox"][data-k]'); if (i) return { t: 'toggle', k: i.dataset.k }; }
    const segBtn = el.closest('.seg[data-k] button[data-value]'); if (segBtn) return { t: 'seg', k: segBtn.closest('.seg').dataset.k, v: segBtn.dataset.value };
    const segBox = el.closest('.seg[data-k]'); if (segBox) return { t: 'segStep', k: segBox.dataset.k };
    const scene = el.closest('[data-scene]'); if (scene) return { t: 'scene', name: scene.dataset.scene };
    const btn = el.closest('button[id], .pad[id]'); if (btn && !btn.closest('#midiPanel')) return { t: 'btn', id: btn.id };
    return null;
  };
  const elCache = new Map(); // target → element; rebuilt if the panel was re-rendered
  M.elementOf = function (tg) {
    if (!tg) return null;
    const ck = tg.t + '|' + (tg.k || '') + '|' + (tg.v || '') + '|' + (tg.name || '') + '|' + (tg.id || '');
    const hit = elCache.get(ck); if (hit && hit.isConnected) return hit;
    const el = findEl(tg); if (el) elCache.set(ck, el); else elCache.delete(ck);
    return el;
  };
  function findEl(tg) {
    if (tg.t === 'range' || tg.t === 'toggle') return $('[data-k="' + tg.k + '"]');
    if (tg.t === 'seg') return $('.seg[data-k="' + tg.k + '"] button[data-value="' + CSS.escape(tg.v) + '"]');
    if (tg.t === 'segStep') return $('.seg[data-k="' + tg.k + '"]');
    if (tg.t === 'scene') return $('[data-scene="' + CSS.escape(tg.name) + '"] [data-sa="load"]');
    if (tg.t === 'btn') return document.getElementById(tg.id);
    return null;
  }
  M.labelOf = function (tg) {
    if (!tg) return '?';
    if (tg.t === 'action') return (M.ACTIONS[tg.a] || { label: tg.a }).label;
    if (tg.t === 'shift') return 'SHIFT (second layer)';
    if (tg.t === 'xfade') return 'Crossfade Scene A ↔ B';
    if (tg.t === 'sceneSel') return 'Scene select';
    if (tg.t === 'sceneAt') return 'Scene slot ' + (tg.i + 1);
    if (tg.t === 'scene') return 'Scene: ' + tg.name;
    if (tg.t === 'btn') { const b = document.getElementById(tg.id); return (b ? (b.getAttribute('aria-label') || b.textContent || tg.id) : tg.id).replace(/\s+/g, ' ').trim().slice(0, 32); }
    const el = $('[data-k="' + tg.k + '"]');
    const box = el && el.closest('.control, .toggle, .seg-wrap');
    const head = box && (box.querySelector('.control-head, .opt-label') || box);
    let name = head && head.childNodes[0] ? head.childNodes[0].textContent.trim() : tg.k;
    if (tg.t === 'seg') { const b = $('.seg[data-k="' + tg.k + '"] button[data-value="' + CSS.escape(tg.v) + '"]'); name += ' → ' + (b ? b.textContent.trim() : tg.v); }
    if (tg.t === 'segStep') name += ' (step through)';
    return (name || tg.k).slice(0, 40);
  };

  /* ============================== applying values ============================== */
  // goals are applied once per frame; smoothing glides toward them
  const goals = new Map(); // el → { goal, cur, tau }
  const tk = new Map();    // takeover state per mapping+target
  function rangeInfo(el) { return { lo: +el.min, hi: +el.max, st: +el.step || 1 }; }
  function setRange(el, v, smoothMs) {
    const g = goals.get(el);
    const cur = g ? g.cur : +el.value;
    goals.set(el, { goal: v, cur, tau: Math.max(0, smoothMs || 0) / 1000 });
  }
  function frameApply(now, dt) {
    if (!goals.size && !pendingXfade) return;
    goals.forEach((g, el) => {
      if (g.tau > 0) g.cur += (g.goal - g.cur) * (1 - Math.exp(-dt / (g.tau / 3))); else g.cur = g.goal;
      const { lo, hi, st } = rangeInfo(el);
      let v = Math.round(g.cur / st) * st; v = Math.min(hi, Math.max(lo, +v.toFixed(6)));
      if (+el.value !== v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
      if (Math.abs(g.goal - g.cur) < st * 0.5) { g.cur = g.goal; const fv = Math.min(hi, Math.max(lo, +(Math.round(g.goal / st) * st).toFixed(6))); if (+el.value !== fv) { el.value = fv; el.dispatchEvent(new Event('input', { bubbles: true })); } goals.delete(el); }
    });
    if (pendingXfade) { const p = pendingXfade; pendingXfade = null; applyXfade(p.m, p.n); }
  }
  (XO.frameHooks = XO.frameHooks || []).push(frameApply);
  M._flush = () => { for (let i = 0; i < 200 && (goals.size || pendingXfade); i++) frameApply(performance.now(), 0.05); }; // tests

  // normalized 0..1 → value on the target's own scale, through range / invert / curve
  function shape(t, n) { let x = t.invert ? 1 - n : n; x = M.curve(t.curve, x); return t.min + x * (t.max - t.min); }
  function unshape(t, f) { let x = t.max === t.min ? 0 : (f - t.min) / (t.max - t.min); x = (curveInv[t.curve] || curveInv.linear)(Math.min(1, Math.max(0, x))); return t.invert ? 1 - x : x; }

  function absToRange(m, mKey, i, t, el, n) {
    const { lo, hi, st } = rangeInfo(el);
    const f = shape(t, n), v = lo + f * (hi - lo);
    if (m.takeover) {
      const key = mKey + '#' + i; let s = tk.get(key);
      if (!s) { s = { caught: false, lastN: null, lastSet: null }; tk.set(key, s); }
      const pending = goals.get(el), screen = pending ? pending.goal : +el.value;
      if (s.caught && s.lastSet !== null && Math.abs(screen - s.lastSet) > st * 1.5 && !pending) s.caught = false; // changed elsewhere (scene, mouse)
      if (!s.caught) {
        const p = unshape(t, (screen - lo) / (hi - lo || 1));
        if (Math.abs(n - p) <= 0.03 || (s.lastN !== null && (s.lastN - p) * (n - p) <= 0)) s.caught = true;
        s.lastN = n;
        if (!s.caught) { M.live[mKey] = { n, waiting: p }; return; }
      }
      s.lastSet = v; s.lastN = n;
    }
    setRange(el, v, m.smooth);
  }
  M.takeoverState = (mKey) => tk;

  const hold = {}; // per mapping+target: value before a momentary press
  function press(m, mKey, down, vel) {
    const mode = m.btn || (m.type === 'pad' ? 'trigger' : m.type);
    m.targets.forEach((t, i) => {
      const tg = t.tg, key = mKey + '#' + i, el = M.elementOf(tg);
      const amount = m.velocity === 'scale' && vel ? vel : 1;
      if (tg.t === 'shift') { M.shift = mode === 'toggle' ? (down ? !M.shift : M.shift) : down; return; }
      if (tg.t === 'action') {
        const A = M.ACTIONS[tg.a]; if (!A) return;
        if (A.hold) {
          if (mode === 'momentary' || (!m.btn && m.type === 'momentary')) A.set(down);
          else if (down) A.set(!A.get());
        } else if (down) A.run();
        return;
      }
      if (tg.t === 'range' && el) {
        const { lo, hi } = rangeInfo(el);
        if (mode === 'momentary') {
          if (down) { hold[key] = goals.has(el) ? goals.get(el).goal : +el.value; setRange(el, lo + shape(t, amount) * (hi - lo), m.smooth); }
          else if (hold[key] !== undefined) { setRange(el, hold[key], m.smooth); delete hold[key]; }
        } else if (mode === 'toggle') {
          if (!down) return;
          const atMax = Math.abs(+el.value - (lo + shape(t, 1) * (hi - lo))) < (+el.step || 1);
          setRange(el, lo + shape(t, atMax ? 0 : amount) * (hi - lo), m.smooth);
        } else if (down) setRange(el, lo + shape(t, amount) * (hi - lo), m.smooth);
        return;
      }
      if (tg.t === 'toggle' && el) {
        if (mode === 'momentary') { if (down) { hold[key] = el.checked; if (!el.checked) click(el); } else if (hold[key] !== undefined) { if (el.checked !== hold[key]) click(el); delete hold[key]; } }
        else if (down) click(el);
        return;
      }
      if (tg.t === 'segStep' && el) { if (down) stepSeg(el, 1); return; }
      if (tg.t === 'sceneSel') { if (down) stepScene(1); return; }
      if (tg.t === 'sceneAt') { if (down) { if (!loadSceneAt(tg.i) && !scenes()[tg.i]) XO.toast('Scene slot ' + (tg.i + 1) + ' is empty — save more scenes (Export tab → Scenes).', true); } return; }
      if (down && el) click(el);
    });
  }
  function click(el) { M._acting = true; try { el.click(); } finally { M._acting = false; } }
  function segButtons(box) { return Array.from(box.querySelectorAll('button[data-value]')); }
  function stepSeg(box, d) { const b = segButtons(box); if (!b.length) return; let i = b.findIndex((x) => x.classList.contains('on') || x.getAttribute('aria-pressed') === 'true'); i = ((i < 0 ? 0 : i + d) % b.length + b.length) % b.length; click(b[i]); }

  const segAcc = {};
  function continuous(m, mKey, n) {
    M.live[mKey] = { n };
    if (m.type === 'crossfader' && m.dead && Math.abs(n - 0.5) < m.dead) n = 0.5;
    if (m.type === 'pitchbend' && m.dead && Math.abs(n - 0.5) < m.dead) n = 0.5;
    m.targets.forEach((t, i) => {
      const tg = t.tg, el = M.elementOf(tg), key = mKey + '#' + i;
      if (tg.t === 'range' && el) return absToRange(m, mKey, i, t, el, n);
      if (tg.t === 'xfade') { pendingXfade = { m, n: shape(t, n) }; return; }
      const f = shape(t, n);
      if (tg.t === 'toggle' && el) { const on = f >= 0.5; if (segAcc[key] === undefined || segAcc[key] !== on) { segAcc[key] = on; if (el.checked !== on) click(el); } return; }
      if (tg.t === 'segStep' && el) { const b = segButtons(el); const idx = Math.min(b.length - 1, Math.floor(f * b.length)); if (segAcc[key] !== idx) { segAcc[key] = idx; if (b[idx] && !b[idx].classList.contains('on')) click(b[idx]); } return; }
      if (tg.t === 'sceneSel') { const l = scenes(); if (!l.length) return; const idx = Math.min(l.length - 1, Math.floor(f * l.length)); if (segAcc[key] !== idx) { segAcc[key] = idx; loadSceneAt(idx); } return; }
      // buttons / actions / scenes / switches by threshold
      const down = f >= 0.5;
      if (segAcc[key] !== down) { segAcc[key] = down; const one = Object.assign({}, m, { targets: [t], btn: m.btn || (M.ACTIONS[tg.a] && M.ACTIONS[tg.a].hold ? 'momentary' : 'trigger') }); press(one, mKey + '~' + i, down, 1); }
    });
  }
  const relLast = {};
  function relative(m, mKey, steps) {
    if (m.accel) { const now = performance.now(), dt = now - (relLast[mKey] || 0); relLast[mKey] = now; if (dt < 25) steps *= 3; else if (dt < 60) steps *= 2; }
    M.live[mKey] = { d: steps };
    m.targets.forEach((t, i) => {
      const tg = t.tg, el = M.elementOf(tg), key = mKey + '#' + i, dir = t.invert ? -1 : 1;
      if (tg.t === 'range' && el) {
        const { lo, hi, st } = rangeInfo(el), base = goals.has(el) ? goals.get(el).goal : +el.value;
        const v = Math.min(lo + t.max * (hi - lo), Math.max(lo + t.min * (hi - lo), base + dir * steps * st * (m.step || 1)));
        setRange(el, v, m.smooth); return;
      }
      if (tg.t === 'segStep' && el) { segAcc[key] = (segAcc[key] || 0) + dir * steps; while (segAcc[key] >= 4) { segAcc[key] -= 4; stepSeg(el, 1); } while (segAcc[key] <= -4) { segAcc[key] += 4; stepSeg(el, -1); } return; }
      if (tg.t === 'sceneSel') { segAcc[key] = (segAcc[key] || 0) + dir * steps; while (segAcc[key] >= 4) { segAcc[key] -= 4; stepScene(1); } while (segAcc[key] <= -4) { segAcc[key] += 4; stepScene(-1); } return; }
      if (tg.t === 'toggle' && el) { const on = dir * steps > 0; if (el.checked !== on) click(el); }
    });
  }
  M.decodeRel = function (v, fmt) {
    if (fmt === 'offset') return v - 64;
    if (fmt === 'sign') return v & 64 ? -(v & 63) : v & 63;
    return v < 64 ? v : v - 128; // two's complement
  };

  /* ---------------- crossfader: morph between two scenes ---------------- */
  let pendingXfade = null, lastDiscrete = null, lastUi = 0;
  const lerpHex = (a, b, f) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f)); return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join(''); };
  function blend(a, b, f, path, out, changes, discrete) {
    Object.keys(b).forEach((k) => {
      const av = a ? a[k] : undefined, bv = b[k], p = path ? path + '.' + k : k;
      if (typeof bv === 'number' && typeof av === 'number') { out[k] = av + (bv - av) * f; changes.push([p, out[k]]); }
      else if (typeof bv === 'string' && typeof av === 'string' && /^#[0-9a-f]{6}$/i.test(av) && /^#[0-9a-f]{6}$/i.test(bv)) { out[k] = lerpHex(av, bv, f); changes.push([p, out[k]]); }
      else if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' && !Array.isArray(av)) { out[k] = {}; blend(av, bv, f, p, out[k], changes, discrete); }
      else { out[k] = f < 0.5 ? (av === undefined ? bv : av) : bv; discrete.push(p + '=' + JSON.stringify(out[k])); }
    });
  }
  function applyXfade(m, f) {
    const l = scenes(), A = l.find((s) => s.name === m.sceneA), B = l.find((s) => s.name === m.sceneB);
    if (!A || !B) { if (!M._xfWarned) { M._xfWarned = true; XO.toast('Pick Scene A and Scene B for the crossfader in the MIDI tab.', true); } return; }
    const out = {}, changes = [], discrete = [];
    blend(XO.migrate(A.S, A.v), XO.migrate(B.S, B.v), f, '', out, changes, discrete);
    const dkey = discrete.join('|');
    if (dkey !== lastDiscrete) { lastDiscrete = dkey; XO.applySnapshot(out); XO.afterLoadState(); return; }
    changes.forEach(([k, v]) => { const keys = k.split('.'); let o = XO.S; for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (!o) return; } if (o[keys[keys.length - 1]] !== v) { o[keys[keys.length - 1]] = v; if (XO.onSetting) XO.onSetting(k, v); } });
    const now = performance.now(); if (now - lastUi > 100) { lastUi = now; XO.syncUI(); }
  }
  M.morph = (m, f) => applyXfade(m, f);

  /* ============================== MIDI messages ============================== */
  const msb = {}, held = {};
  function find(src) {
    const parts = src.split(':'), anyKey = parts[0] + ':*' + (parts[2] !== undefined ? ':' + parts[2] : '');
    if (M.shift) { const s = M.map['S|' + src] || M.map['S|' + anyKey]; if (s) return ['S|' + src, s]; }
    if (M.map[src]) return [src, M.map[src]];
    if (M.map[anyKey]) return [anyKey, M.map[anyKey]];
    return null;
  }
  function logMsg(txt) { M.last = txt; M.log.unshift(txt); if (M.log.length > 50) M.log.length = 50; if (M.onMessage) M.onMessage(txt); }

  M.handle = function (e) {
    const d = e.data; if (!d || !d.length) return;
    const st = d[0], type = st & 0xf0, ch = (st & 0x0f) + 1, d1 = d[1] || 0, d2 = d[2] || 0;
    if (st >= 0xf8) return realtime(st);
    let src, kind, value = 0;
    if (type === 0xb0) { src = 'cc:' + ch + ':' + d1; kind = 'cc'; value = d2; logMsg('CC ' + d1 + ' · CH ' + ch + ' · ' + d2); }
    else if (type === 0x90 || type === 0x80) { src = 'note:' + ch + ':' + d1; kind = 'note'; value = type === 0x80 ? 0 : d2; logMsg('NOTE ' + d1 + ' · CH ' + ch + ' · ' + (value ? 'ON ' + value : 'OFF')); }
    else if (type === 0xe0) { src = 'pb:' + ch; kind = 'pb'; value = ((d2 << 7) | d1) / 16383; logMsg('PITCH BEND · CH ' + ch + ' · ' + ((d2 << 7) | d1)); }
    else if (type === 0xd0) { src = 'cat:' + ch; kind = 'cat'; value = d1; logMsg('PRESSURE · CH ' + ch + ' · ' + d1); }
    else if (type === 0xa0) { src = 'pat:' + ch + ':' + d1; kind = 'pat'; value = d2; logMsg('PAD PRESSURE ' + d1 + ' · CH ' + ch + ' · ' + d2); }
    else if (type === 0xc0) { src = 'pc:' + ch; kind = 'pc'; value = d1; logMsg('PROGRAM ' + d1 + ' · CH ' + ch); }
    else return;

    if (M.learning && M.target) return learnFeed(src, kind, value, d1);

    // 14-bit CC: CC n (0-31) is coarse, CC n+32 is fine
    if (kind === 'cc' && d1 >= 32 && d1 < 64) {
      const coarse = 'cc:' + ch + ':' + (d1 - 32), f = find(coarse);
      if (f && f[1].hiRes) { const hi = msb[coarse] || 0; return dispatch(f[0], f[1], 'abs', ((hi << 7) | d2) / 16383); }
    }
    const f = find(src); if (!f) return;
    const [mKey, m] = f;
    if (kind === 'cc' && m.hiRes) { msb[src] = d2; return dispatch(mKey, m, 'abs', (d2 << 7) / 16383); }
    if (kind === 'pc') { if (m.type === 'program') { loadSceneAt(value); M.live[mKey] = { n: value / 127 }; } return; }
    if (kind === 'pb') return dispatch(mKey, m, 'abs', value);
    if (kind === 'note') {
      const down = value > 0;
      if (m.type === 'pressure') return;
      if (held[mKey] === down && !isRel(m.type)) return;
      held[mKey] = down; M.live[mKey] = { n: down ? value / 127 : 0 };
      if (isBtn(m.type) || m.type === 'trigger') return press(m, mKey, down, value / 127);
      if (m.type === 'jog') return; // jog touch: handled by the jog's own mapping layer
      return press(Object.assign({}, m, { btn: 'momentary' }), mKey, down, value / 127);
    }
    // CC / aftertouch
    if (isRel(m.type)) { const steps = M.decodeRel(value, m.rel); if (steps) relative(m, mKey, steps); return; }
    if (isBtn(m.type)) { const down = value >= 64; if (held[mKey] === down) return; held[mKey] = down; M.live[mKey] = { n: value / 127 }; return press(m, mKey, down, value / 127); }
    return dispatch(mKey, m, 'abs', value / 127);
  };
  function dispatch(mKey, m, mode, n) { if (m.type === 'program') return; continuous(m, mKey, Math.min(1, Math.max(0, n))); }

  /* ---------------- MIDI clock: 24 ticks per beat ---------------- */
  function realtime(st) {
    const c = M.clock, now = performance.now();
    if (st === 0xf8) {
      if (!M.prefs.clockSync) return;
      if (c.last) { c.ticks.push(now - c.last); if (c.ticks.length > 48) c.ticks.shift(); }
      c.last = now; c.count = (c.count + 1) % 24;
      if (c.count === 0) c.beatAt = now;
      if (c.ticks.length >= 12) {
        const avg = c.ticks.reduce((a, b) => a + b, 0) / c.ticks.length;
        const bpm = Math.round((60000 / (avg * 24)) * 10) / 10;
        if (bpm > 20 && bpm < 300 && Math.abs(bpm - c.bpm) >= 0.1) { c.bpm = bpm; if (XO.S.audio.bpmMode !== 'clock') { XO.S.audio.bpmMode = 'clock'; XO.syncKey('audio.bpmMode'); if (XO.evalShow) XO.evalShow(); } }
      }
    } else if (st === 0xfa || st === 0xfb) { if (!M.prefs.clockSync) return; c.count = 0; c.beatAt = now; c.running = true; if (XO.qa && XO.audio.loaded && !XO.audio.isPlaying()) XO.qa.playAll(); logMsg('CLOCK START'); }
    else if (st === 0xfc) { if (!M.prefs.clockSync) return; c.running = false; if (XO.qa) XO.qa.pauseAll(); logMsg('CLOCK STOP'); }
  }

  /* ============================== learn ============================== */
  let learnBuf = null, learnTimer = 0;
  function learnFeed(src, kind, value, d1) {
    if (!learnBuf) {
      if ((kind === 'note' || kind === 'cc') && value === 0 && kind === 'note') return; // ignore a stray note-off
      learnBuf = { src, kind, values: [], extra: new Set(), offSeen: false, vel: new Set(), t0: performance.now() };
      clearTimeout(learnTimer); learnTimer = setTimeout(finishLearn, M.learnMs);
    }
    if (src === learnBuf.src) { learnBuf.values.push(value); if (kind === 'note') { if (value === 0) learnBuf.offSeen = true; else learnBuf.vel.add(value); } }
    else learnBuf.extra.add(src);
  }
  M.learnMs = 450;
  M.detect = function (b) {
    const r = { type: 'knob', rel: 'twos', hiRes: false, btn: '' };
    if (b.kind === 'pb') return Object.assign(r, { type: 'pitchbend' });
    if (b.kind === 'cat' || b.kind === 'pat') return Object.assign(r, { type: 'pressure' });
    if (b.kind === 'pc') return Object.assign(r, { type: 'program' });
    if (b.kind === 'note') return Object.assign(r, { type: b.offSeen ? 'momentary' : 'trigger' });
    const v = b.values;
    const [, ch, num] = b.src.split(':');
    if (+num < 32 && b.extra.has('cc:' + ch + ':' + (+num + 32))) r.hiRes = true;
    const distinct = new Set(v);
    if (v.length >= 2 && distinct.size <= 2 && v.every((x) => x === 0 || x === 127)) return Object.assign(r, { type: 'momentary', btn: '' });
    if (v.length === 1 && (v[0] === 127)) return Object.assign(r, { type: 'trigger' });
    // encoders repeat the same value on every click; absolute knobs only send changes
    const repeats = v.length >= 3 && v.length > distinct.size;
    const near64 = repeats && v.every((x) => x >= 56 && x <= 72 && x !== 64), small = repeats && v.every((x) => (x >= 1 && x <= 15) || (x >= 113 && x <= 127)), signish = repeats && v.every((x) => (x >= 1 && x <= 15) || (x >= 65 && x <= 79));
    if (v.length >= 2 && near64) return Object.assign(r, { type: 'encoder', rel: 'offset' });
    if (v.length >= 2 && small && !signish) return Object.assign(r, { type: 'encoder', rel: 'twos' });
    if (v.length >= 2 && signish && !small) return Object.assign(r, { type: 'encoder', rel: 'sign' });
    if (v.length >= 2 && small && signish) return Object.assign(r, { type: 'encoder', rel: 'twos' }); // only "up" moves seen
    return r;
  };
  function finishLearn() {
    const b = learnBuf; learnBuf = null; if (!b || !M.target) return;
    const det = M.detect(b), tg = M.target;
    let type = det.type;
    // what the target is decides the most useful button mode
    if (isBtn(type) || type === 'trigger') {
      if (tg.t === 'range') type = b.vel.size > 1 || (b.kind === 'note' && !b.offSeen) ? 'pad' : type;
      if (tg.t === 'toggle' && type === 'trigger') type = 'toggle';
      if (tg.t === 'action' && M.ACTIONS[tg.a] && M.ACTIONS[tg.a].hold && b.offSeen) type = 'momentary';
      if (tg.t === 'shift') type = 'momentary';
    }
    if (tg.t === 'xfade' && !isBtn(type) && !isRel(type)) type = 'crossfader';
    const layer = M.shift && tg.t !== 'shift' ? 'S|' : '';
    const key = layer + b.src;
    if (M.addTo && M.map[M.addTo]) { M.addTarget(M.addTo, tg); return; }
    const m = Object.assign(defaults(type), { rel: det.rel, hiRes: det.hiRes });
    m.targets = [{ tg, min: 0, max: 1, invert: false, curve: 'linear' }];
    M.map[key] = m; M.target = null; save();
    if (M.onLearned) M.onLearned(key, m);
  }
  /** Add one more target to an existing mapping (macro). Picked by clicking a control while "+ ADD TARGET" is armed. */
  M.addTarget = function (key, tg) {
    const m = M.map[key]; if (!m || !tg) return false;
    M.addTo = null; M.target = null;
    if (m.targets.length >= 8) { XO.toast('A control can drive up to 8 targets.', true); return false; }
    m.targets.push({ tg, min: 0, max: 1, invert: false, curve: 'linear' });
    save(); if (M.onLearned) M.onLearned(key, m);
    return true;
  };
  M._finishLearn = () => { clearTimeout(learnTimer); finishLearn(); }; // tests

  M.setLearning = function (on) { M.learning = on; M.target = null; M.addTo = null; learnBuf = null; clearTimeout(learnTimer); document.documentElement.classList.toggle('midi-learning', on); if (M.onChange) M.onChange(); };
  M.pick = function (tg) { M.target = tg; learnBuf = null; };

  /* ============================== connecting + LED feedback ============================== */
  M.connect = async function () {
    if (!M.supported) return false;
    try {
      M.access = await navigator.requestMIDIAccess({ sysex: false });
      M.access.onstatechange = attach;
      M.status = 'on'; attach();
    } catch (e) { M.status = e && e.name === 'InvalidStateError' ? 'nosystem' : 'blocked'; M.error = e && (e.name + ': ' + e.message); }
    if (M.onChange) M.onChange();
    return M.status === 'on';
  };
  function attach() {
    if (!M.access) return;
    M.inputs = []; M.outputs = [];
    M.access.inputs.forEach((i) => { i.onmidimessage = M.handle; if (i.state !== 'disconnected') M.inputs.push(i.name || 'MIDI device'); });
    M.access.outputs.forEach((o) => { if (o.state !== 'disconnected') M.outputs.push(o); });
    if (M.onChange) M.onChange();
  }
  const ledState = {};
  function ledTick() {
    if (!M.prefs.led || !M.outputs.length) return;
    Object.keys(M.map).forEach((key) => {
      const src = key.replace(/^S\|/, ''), [kind, ch, num] = src.split(':'); if (kind !== 'note' && kind !== 'cc') return;
      if (ch === '*') return;
      const m = M.map[key], t = m.targets[0]; if (!t) return;
      let on = false;
      if (t.tg.t === 'toggle') { const el = M.elementOf(t.tg); on = !!(el && el.checked); }
      else if (t.tg.t === 'action' && M.ACTIONS[t.tg.a] && M.ACTIONS[t.tg.a].get) on = !!M.ACTIONS[t.tg.a].get();
      else if (t.tg.t === 'scene') { const l = scenes(); on = sceneIdx >= 0 && l[sceneIdx] && l[sceneIdx].name === t.tg.name; }
      else if (t.tg.t === 'seg') { const b = M.elementOf(t.tg); on = !!(b && (b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true')); }
      else if (t.tg.t === 'shift') on = M.shift;
      else if (t.tg.t === 'sceneAt') on = sceneIdx === t.tg.i;
      else return;
      if (ledState[key] === on) return; ledState[key] = on;
      const msg = kind === 'note' ? [0x90 | (ch - 1), +num, on ? 127 : 0] : [0xb0 | (ch - 1), +num, on ? 127 : 0];
      M.outputs.forEach((o) => { try { o.send(msg); } catch (e) { /* port gone */ } });
    });
  }
  setInterval(ledTick, 120);

  // While learning, a click picks the control instead of using it.
  document.addEventListener('click', (e) => {
    if (!M.learning || M._acting) return;
    if (e.target.closest('#midiPanel') && !e.target.closest('[data-midi-action]')) return;
    const tg = M.targetOf(e.target); if (!tg) return;
    e.preventDefault(); e.stopPropagation();
    if (M.addTo) { const key = M.addTo; M.addTarget(key, tg); XO.toast('Added: ' + M.labelOf(tg)); return; }
    M.pick(tg);
    document.querySelectorAll('.midi-target').forEach((x) => x.classList.remove('midi-target'));
    (e.target.closest('.control, .toggle, .seg-wrap, .scene, [data-midi-action], button') || e.target).classList.add('midi-target');
    XO.toast((M.addTo ? 'Add target: ' : '') + M.labelOf(tg) + ' — now move a knob / fader or hit a pad.');
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!M.learning || M._acting || !e.target.matches('input[type="range"][data-k]')) return;
    e.preventDefault();
    if (M.addTo) return; // the click that follows adds it
    M.pick(M.targetOf(e.target));
    document.querySelectorAll('.midi-target').forEach((x) => x.classList.remove('midi-target'));
    (e.target.closest('.control') || e.target).classList.add('midi-target');
    XO.toast(M.labelOf(M.target) + ' — now move a knob or fader.');
  }, true);
})();
