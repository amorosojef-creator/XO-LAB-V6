// XO LAB smoke test — loads the app in headless Chrome, exercises the v3.1 + v5 features and renders a real export.
// Needs Google Chrome / Chromium installed. Run: npm test   (set CHROME_PATH if Chrome isn't found)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome not found — set CHROME_PATH.'); process.exit(1); }

// ---- test media: a 128 BPM drum loop (WAV) and a low-poly sphere (OBJ) ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xolab-'));
function wav(file, secs) {
  const sr = 44100, n = Math.round(sr * secs), beat = 60 / 128, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr, bt = t % beat, ht = (t + beat / 2) % beat;
    let v = bt < 0.25 ? 0.9 * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 10) : 0;
    if (ht < 0.05) v += 0.25 * rnd() * Math.exp(-ht * 80);
    v = Math.max(-1, Math.min(1, v * 0.8)) * 32000;
    buf.writeInt16LE(v | 0, 44 + i * 4); buf.writeInt16LE(v | 0, 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
function obj(file) {
  let v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let k = 0; k < 2; k++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => { const key = Math.min(a, b) + '_' + Math.max(a, b); if (cache.has(key)) return cache.get(key); const p = v[a].map((c, i) => (c + v[b][i]) / 2), l = Math.hypot(...p); v.push(p.map((c) => c / l)); cache.set(key, v.length - 1); return v.length - 1; };
    f.forEach(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
    f = nf;
  }
  fs.writeFileSync(file, v.map((p) => 'v ' + p.join(' ')).join('\n') + '\n' + f.map((t) => 'f ' + t.map((i) => i + 1).join(' ')).join('\n') + '\n');
}
wav(path.join(tmp, 'beat.wav'), 6); obj(path.join(tmp, 'orb.obj'));

const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), String(port), root], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const results = []; let failed = false;
const check = (name, ok, detail) => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) failed = true; };
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.tap('#enter');
  check('viewport blocks pinch zoom', /user-scalable=no/.test(await page.getAttribute('meta[name=viewport]', 'content')));
  check('page touch-action is pan only', (await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)) === 'pan-x pan-y');

  await page.setInputFiles('#modelInput', path.join(tmp, 'orb.obj'));
  await page.waitForFunction(() => XO.model.loaded, null, { timeout: 30000 });
  await page.setInputFiles('#audioInput', path.join(tmp, 'beat.wav'));
  await page.waitForFunction(() => XO.audio.decoded, null, { timeout: 30000 });
  check('3D model + audio load', true);

  const live = await page.evaluate(async () => {
    document.querySelector('[data-motion="PEAK"]').click();
    Object.assign(XO.S.model, { material: 'mercury' }); Object.assign(XO.S.scene, { stars: true, ring: true, grid: true, lasers: true, motes: true, fog: true });
    XO.S.out.quality = '50'; XO.applyOutputSize();
    await XO.qa.playAll(); await new Promise((r) => setTimeout(r, 2500));
    let liquid = false; XO.model.root.traverse((o) => { if (o.isMesh && o.material && o.material.userData && o.material.userData.metal === 'mercury') liquid = true; });
    const fxErrors = [];
    for (const t of XO.FILTER_ORDER) { XO.S.fx.stack = [XO.makeFilter(t)]; await new Promise((r) => setTimeout(r, 60)); if (XO.gl.fxError) fxErrors.push(t + ': ' + XO.gl.fxError); }
    XO.S.fx.stack = []; XO.qa.pauseAll();
    return { liquid, moved: Math.abs(XO.model.pivot.rotation.y) > 0.01, fxErrors, filters: XO.FILTER_ORDER.length };
  });
  check('liquid mercury material active', live.liquid);
  check('motion preset moves the model', live.moved);
  check('all ' + live.filters + ' filters compile', !live.fxErrors.length, live.fxErrors.join('; '));

  await page.evaluate(() => { Object.assign(XO.S.out, { size: '720', fps: '30', aspect: '16:9', aIn: 1, aOut: 3, aOffset: 0.5, fadeOut: 0.5, durMode: 'audio' }); XO.syncUI(); XO.applyOutputSize(); XO.syncTimeline(); });
  await page.waitForFunction(() => !document.getElementById('renderBtn').disabled, null, { timeout: 20000 });
  await page.evaluate(() => XO.qa.renderExport());
  const out = await page.evaluate(async () => { const f = XO.exporter.lastFile; return f ? { name: f.name, size: f.size, head: Array.from(new Uint8Array(await f.slice(0, 12).arrayBuffer())) } : null; });
  check('render & export produced a file', !!out && out.size > 10000, out ? out.name + ' · ' + (out.size / 1024).toFixed(0) + ' KB' : 'no file');
  check('export is an MP4/MOV container', !!out && String.fromCharCode(...out.head.slice(4, 8)) === 'ftyp');
  check('app back to live mode after render', await page.evaluate(() => !XO.exporter.rendering && !XO.audio.offline));
  // ---------------- v5: undo / redo ----------------
  const hist = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    XO.history.reset();
    await XO.qa.playAll(); await wait(1500); // playing alone must not create undo steps
    const idleSteps = XO.history.undoStack.length;
    XO.qa.pauseAll();
    const before = XO.S.blob.sens;
    XO.set('blob.sens', 90); XO.syncUI(); await wait(900);
    XO.set('media.zoom', 150); XO.syncUI(); await wait(900);
    const steps = XO.history.undoStack.length;
    XO.undo(); const afterUndo1 = XO.S.media.zoom;
    XO.undo(); const afterUndo2 = XO.S.blob.sens;
    XO.redo(); const afterRedo = XO.S.blob.sens;
    const btn = !document.getElementById('undoBtn').disabled && !document.getElementById('redoBtn').disabled;
    return { idleSteps, steps, afterUndo1, afterUndo2, before, afterRedo, btn };
  });
  check('playback creates no undo steps', hist.idleSteps === 0, 'steps: ' + hist.idleSteps);
  check('undo / redo settings', hist.steps === 2 && hist.afterUndo1 === 100 && hist.afterUndo2 === hist.before && hist.afterRedo === 90 && hist.btn, JSON.stringify(hist));

  // ---------------- v5: project save → open round trip ----------------
  const proj = await page.evaluate(async () => {
    XO.set('blob.sens', 77); XO.set('model.cWire', '#ff00aa'); XO.S.fx.stack = [XO.makeFilter(XO.FILTER_ORDER[0])]; XO.afterLoadState();
    XO.scenes.save('SMOKE SCENE');
    const blob = await XO.project.build('SMOKE SET');
    const file = new File([blob], 'SMOKE SET.xolab');
    const names = [...(await XO.project._unzip(file)).keys()];
    // wipe the session, then reopen the project
    XO.media.clearAudio(); XO.resetAll(); XO.afterLoadState(); XO.scenes.remove('SMOKE SCENE');
    const cleared = !XO.audio.loaded && XO.S.blob.sens !== 77;
    const r = await XO.project.open(file);
    await new Promise((res) => setTimeout(res, 300));
    return {
      names, cleared, missing: r.missing, name: XO.project.name, size: blob.size,
      sens: XO.S.blob.sens, wire: XO.S.model.cWire, fx: XO.S.fx.stack.length,
      model: XO.model.loaded && XO.state.V.kind === 'model', audio: XO.audio.loaded,
      scene: !!XO.scenes.list().find((x) => x.name === 'SMOKE SCENE'),
      shown: document.getElementById('projectName').textContent, undoClear: XO.history.undoStack.length === 0,
    };
  });
  check('project file holds settings + media', proj.names.includes('project.json') && proj.names.some((n) => n.startsWith('media/model/')) && proj.names.some((n) => n.startsWith('media/audio_')), proj.names.join(', ') + ' · ' + (proj.size / 1024).toFixed(0) + ' KB');
  check('project reopens settings, scenes, model and audio', proj.cleared && proj.sens === 77 && proj.wire === '#ff00aa' && proj.fx === 1 && proj.model && proj.audio && proj.scene && !proj.missing.length, JSON.stringify(proj));
  check('project name shown in top bar', proj.shown === 'SMOKE SET');
  const recent = await page.evaluate(async () => {
    const blob = await XO.project.build('RECENT SET');
    await XO.project.openFile(new File([blob], 'RECENT SET.xolab'));
    await new Promise((r) => setTimeout(r, 300));
    const zipBytes = Array.from(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
    return { names: (await XO.project.recent()).map((r) => r.name), rows: document.querySelectorAll('#recentList [data-recent]').length, zipBytes };
  });
  check('recent projects kept on this device', recent.names.includes('RECENT SET') && recent.rows >= 1, recent.names.join(', '));
  check('project file is a standard zip', recent.zipBytes.join(',') === '80,75,3,4');
  const oldScene = await page.evaluate(() => { XO.applySnapshot(XO.migrate({ blob: { sens: 33 } }, '3.1.0')); const ok = XO.S.blob.sens === 33 && XO.S.model.material === 'original' && XO.S.out.size === '1080'; XO.resetAll(); XO.afterLoadState(); return ok; });
  check('V3 scene migrates (missing settings get defaults)', oldScene);

  // ---------------- v5.0.1: live audio input ----------------
  const liveIn = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    XO.showTab('media');
    await XO.live.startAudio();
    const A = XO.audio;
    let peak = 0; for (let i = 0; i < 40; i++) { await wait(50); peak = Math.max(peak, A.raw); } // the fake mic beeps once a second
    const r = { on: A.live.on, label: A.live.label, raw: peak, speakers: A.gain.gain.value, btn: document.getElementById('liveAudioBtn').textContent, devices: document.querySelectorAll('#liveAudioDevice option').length };
    XO.set('audio.liveGain', 200); XO.onSetting('audio.liveGain', 200); await wait(200); r.gain = A.live.gain.gain.value;
    XO.set('media.volume', 80); XO.onSetting('media.volume', 80); await wait(200); r.speakersAfterVolume = A.gain.gain.value;
    XO.live.stopAudio(); await wait(300);
    r.offOn = A.live.on; r.speakersAfter = A.gain.gain.value; r.stream = A.live.stream;
    XO.set('audio.liveGain', 100); XO.set('media.volume', 90); XO.onSetting('media.volume', 90);
    return r;
  });
  check('live audio input starts and the visuals hear it', liveIn.on && liveIn.raw > 0.01 && /STOP/.test(liveIn.btn), 'input: ' + liveIn.label + ' · peak level ' + liveIn.raw.toFixed(3));
  check('live audio never plays out loud (no feedback)', liveIn.speakers < 0.01 && liveIn.speakersAfterVolume < 0.01, 'speaker gain while live: ' + liveIn.speakers.toFixed(3) + ' / after volume change: ' + liveIn.speakersAfterVolume.toFixed(3));
  check('live gain slider changes the input level', Math.abs(liveIn.gain - 2) < 0.05, 'gain ' + liveIn.gain);
  check('stopping live audio restores the track', !liveIn.offOn && liveIn.speakersAfter > 0.5 && liveIn.stream === null, 'speaker gain ' + liveIn.speakersAfter.toFixed(2));

  // ---------------- v5.0.1: live camera ----------------
  const cam = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    XO.set('blob.on', true); XO.syncUI();
    await XO.live.startCamera();
    await wait(1200);
    const V = XO.state.V, c = document.getElementById('view');
    const px = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    const r = { kind: V.kind, w: V.w, h: V.h, tag: document.getElementById('modeTag').textContent, px: Array.from(px).slice(0, 3), blobs: XO.lastInfo ? XO.lastInfo.count : -1, btn: document.getElementById('cameraBtn').textContent };
    let toast = ''; const t = XO.toast; XO.toast = (m) => { toast = m; }; await XO.qa.renderExport(); XO.toast = t; r.exportMsg = toast;
    XO.set('media.camMirror', !XO.S.media.camMirror); await wait(200); r.mirrorOk = true;
    const stream = XO.cam.stream;
    XO.live.stopCamera(); await wait(300);
    r.after = XO.state.V.kind; r.stopped = stream.getTracks().every((tr) => tr.readyState === 'ended');
    return r;
  });
  check('live camera becomes the visual', cam.kind === 'camera' && cam.w > 0 && /LIVE CAMERA/.test(cam.tag) && /STOP/.test(cam.btn), cam.w + '×' + cam.h + ' · ' + cam.tag);
  check('camera picture reaches the stage', cam.px.some((v) => v > 20), 'centre pixel rgb(' + cam.px.join(',') + ')');
  check('blob tracking runs on the camera', cam.blobs >= 0, cam.blobs + ' boxes');
  check('export explains the camera is live-only', /can't be rendered offline/.test(cam.exportMsg));
  check('stopping the camera releases it', cam.after === null && cam.stopped);

  // ---------------- v5.1: MIDI — every control type ----------------
  const mid = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = XO.midi, H = (...d) => M.handle({ data: d }), F = () => M._flush();
    const el = (k) => document.querySelector('input[type="range"][data-k="' + k + '"]');
    const R = {};
    localStorage.removeItem('xolab-midi-v2'); M.reload(); M.map = M.profiles[M.active].map;
    const learn = async (target, msgs) => { M.setLearning(true); M.pick(target); msgs.forEach((d) => H(...d)); M._finishLearn(); M.setLearning(false); };
    // 1. absolute knob, learned + detected
    await learn({ t: 'range', k: 'blob.sens' }, [[0xb0, 21, 10], [0xb0, 21, 20], [0xb0, 21, 30]]);
    const k1 = M.map['cc:1:21']; R.knobType = k1 && k1.type;
    k1.takeover = false; k1.smooth = 0;
    H(0xb0, 21, 127); F(); R.knobMax = XO.S.blob.sens; H(0xb0, 21, 0); F(); R.knobMin = XO.S.blob.sens;
    Object.assign(k1.targets[0], { min: 0.25, max: 0.75 }); H(0xb0, 21, 127); F(); R.rangeMax = XO.S.blob.sens;
    k1.targets[0].invert = true; H(0xb0, 21, 127); F(); R.inverted = XO.S.blob.sens;
    Object.assign(k1.targets[0], { min: 0, max: 1, invert: false, curve: 'exp' }); H(0xb0, 21, 64); F(); R.expMid = XO.S.blob.sens;
    k1.targets[0].curve = 'log'; H(0xb0, 21, 64); F(); R.logMid = XO.S.blob.sens;
    k1.targets[0].curve = 'linear';
    // 2. endless encoders: detection + each format
    await learn({ t: 'range', k: 'blob.maxBlobs' }, [[0xb0, 22, 1], [0xb0, 22, 1], [0xb0, 22, 1]]);
    const e1 = M.map['cc:1:22']; R.encType = e1 && e1.type + '/' + e1.rel; e1.accel = false; e1.smooth = 0;
    XO.set('blob.maxBlobs', 10); XO.syncUI();
    for (let i = 0; i < 5; i++) H(0xb0, 22, 1); F(); R.encUp = XO.S.blob.maxBlobs;
    H(0xb0, 22, 127); H(0xb0, 22, 126); F(); R.encDown = XO.S.blob.maxBlobs;
    await learn({ t: 'range', k: 'blob.minCells' }, [[0xb0, 23, 65], [0xb0, 23, 65], [0xb0, 23, 63]]); R.offsetDet = M.map['cc:1:23'].rel;
    await learn({ t: 'range', k: 'blob.smooth' }, [[0xb0, 24, 1], [0xb0, 24, 1], [0xb0, 24, 65]]); R.signDet = M.map['cc:1:24'].rel;
    R.decode = [M.decodeRel(65, 'offset'), M.decodeRel(63, 'offset'), M.decodeRel(66, 'sign'), M.decodeRel(126, 'twos')].join(',');
    M.map['cc:1:22'].accel = true; XO.set('blob.maxBlobs', 5); XO.syncUI(); H(0xb0, 22, 1); H(0xb0, 22, 1); H(0xb0, 22, 1); F(); R.accel = XO.S.blob.maxBlobs; // fast clicks move further
    // 3. fader soft takeover
    await learn({ t: 'range', k: 'media.zoom' }, [[0xb0, 0, 40], [0xb0, 0, 50], [0xb0, 0, 60]]);
    const fd = M.map['cc:1:0']; fd.type = 'fader'; fd.takeover = true; fd.smooth = 0;
    XO.set('media.zoom', 175); XO.syncUI(); M.takeoverState().clear();
    H(0xb0, 0, 10); F(); R.noJump = XO.S.media.zoom; R.waiting = M.live['cc:1:0'] && M.live['cc:1:0'].waiting !== undefined;
    H(0xb0, 0, 40); F(); H(0xb0, 0, 70); F(); R.pickedUp = XO.S.media.zoom;
    // 4. buttons: momentary, toggle, trigger
    await learn({ t: 'action', a: 'blackout' }, [[0x90, 36, 100], [0x80, 36, 0]]); R.momType = M.map['note:1:36'].type;
    H(0x90, 36, 100); R.blackOn = XO.perform.blackout; H(0x80, 36, 0); R.blackOff = XO.perform.blackout;
    M.map['note:1:37'] = Object.assign(M.defaults('toggle'), { targets: [{ tg: { t: 'action', a: 'freeze' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    H(0x90, 37, 100); H(0x80, 37, 0); R.tog1 = XO.perform.freeze; H(0x90, 37, 100); H(0x80, 37, 0); R.tog2 = XO.perform.freeze;
    M.map['note:1:38'] = Object.assign(M.defaults('trigger'), { targets: [{ tg: { t: 'toggle', k: 'blob.on' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    const b0 = XO.S.blob.on; H(0x90, 38, 100); await wait(30); const b1 = XO.S.blob.on; H(0x80, 38, 0); await wait(30); const b2 = XO.S.blob.on;
    R.trigger = b1 !== b0 && b2 === b1;
    // 5. pad velocity
    M.map['note:1:40'] = Object.assign(M.defaults('pad'), { targets: [{ tg: { t: 'range', k: 'dof.amount' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    M.map['note:1:40'].smooth = 0; H(0x90, 40, 64); F(); R.velocity = XO.S.dof.amount; H(0x80, 40, 0);
    // 6. aftertouch pressure
    M.map['cat:1'] = Object.assign(M.defaults('pressure'), { targets: [{ tg: { t: 'range', k: 'dof.bokeh' }, min: 0, max: 1, invert: false, curve: 'linear' }] }); M.map['cat:1'].smooth = 0;
    H(0xd0, 127); F(); R.pressureHi = XO.S.dof.bokeh; H(0xd0, 0); F(); R.pressureLo = XO.S.dof.bokeh;
    // 7. 14-bit CC
    M.map['cc:1:7'] = Object.assign(M.defaults('fader'), { hiRes: true, takeover: false, smooth: 0, targets: [{ tg: { t: 'range', k: 'dof.size' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    H(0xb0, 7, 64); H(0xb0, 39, 77); F(); R.hiResN = M.live['cc:1:7'].n;
    // 8. pitch bend
    M.map['pb:1'] = Object.assign(M.defaults('pitchbend'), { smooth: 0, targets: [{ tg: { t: 'range', k: 'dof.falloff' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    H(0xe0, 0, 64); F(); R.pbMid = M.live['pb:1'].n; H(0xe0, 127, 127); F(); R.pbTop = XO.S.dof.falloff;
    // 9. macro: one fader → 3 targets with their own ranges
    M.map['cc:1:8'] = Object.assign(M.defaults('fader'), { takeover: false, smooth: 0, targets: [
      { tg: { t: 'range', k: 'blob.sens' }, min: 0, max: 1, invert: false, curve: 'linear' },
      { tg: { t: 'range', k: 'dof.amount' }, min: 0.5, max: 1, invert: false, curve: 'linear' },
      { tg: { t: 'range', k: 'media.posX' }, min: 0, max: 1, invert: true, curve: 'linear' }] });
    H(0xb0, 8, 127); F(); R.macro = [XO.S.blob.sens, XO.S.dof.amount, XO.S.media.posX];
    // 10. shift layer
    M.map['note:1:1'] = Object.assign(M.defaults('momentary'), { targets: [{ tg: { t: 'shift' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    M.map['cc:1:30'] = Object.assign(M.defaults('knob'), { takeover: false, smooth: 0, targets: [{ tg: { t: 'range', k: 'media.posY' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    M.map['S|cc:1:30'] = Object.assign(M.defaults('knob'), { takeover: false, smooth: 0, targets: [{ tg: { t: 'range', k: 'blob.minCells' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    XO.set('media.posY', 0); XO.set('blob.minCells', 1); XO.syncUI();
    H(0x90, 1, 127); H(0xb0, 30, 127); F(); const sh1 = [XO.S.media.posY, XO.S.blob.minCells]; H(0x80, 1, 0);
    H(0xb0, 30, 0); F(); R.shift = { held: sh1, after: [XO.S.media.posY, XO.S.blob.minCells] };
    // 11. crossfader scene morph
    XO.resetAll(); XO.afterLoadState(); XO.set('blob.sens', 10); XO.scenes.save('XF A'); XO.set('blob.sens', 90); XO.scenes.save('XF B');
    M.map['cc:1:9'] = Object.assign(M.defaults('crossfader'), { smooth: 0, sceneA: 'XF A', sceneB: 'XF B', targets: [{ tg: { t: 'xfade' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    H(0xb0, 9, 0); F(); R.xfA = XO.S.blob.sens; H(0xb0, 9, 127); F(); R.xfB = XO.S.blob.sens; H(0xb0, 9, 32); F(); R.xfQuarter = XO.S.blob.sens;
    // 12. program change → scene slot
    M.map['pc:1'] = Object.assign(M.defaults('program'), { targets: [] });
    const scList = XO.scenes.list().map((x) => x.name), idxB = scList.indexOf('XF B'), idxA = scList.indexOf('XF A');
    H(0xc0, idxA); R.pcA = XO.S.blob.sens; H(0xc0, idxB); R.pcB = XO.S.blob.sens;
    // 13. MIDI clock → BPM (fake clock at exactly 125 BPM)
    M.prefs.clockSync = true; const realNow = performance.now.bind(performance); let fake = realNow();
    performance.now = () => fake;
    for (let i = 0; i < 60; i++) { fake += 60000 / (125 * 24); H(0xf8); }
    performance.now = realNow; R.clockBpm = M.clock.bpm; R.clockMode = XO.S.audio.bpmMode; R.audioBpm = XO.audio.effectiveBpm();
    M.prefs.clockSync = false; XO.S.audio.bpmMode = 'auto';
    // 14. a burst of 500 CC messages in one second must not cost frames
    const count = (ms) => new Promise((res) => { let n = 0; const end = performance.now() + ms; const f = (t) => { n++; if (t < end) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); });
    const base = await count(1000);
    let sent = 0, handlerMs = 0;
    const tmr = setInterval(() => { for (let i = 0; i < 25 && sent < 500; i++, sent++) { const t0 = performance.now(); H(0xb0, 8, sent % 128); handlerMs += performance.now() - t0; } }, 40);
    const burst = await count(1000); clearInterval(tmr);
    while (sent < 500) { const t0 = performance.now(); H(0xb0, 8, sent % 128); handlerMs += performance.now() - t0; sent++; }
    const t1 = performance.now(); F(); const applyMs = performance.now() - t1;
    R.burst = { base, burst, sent, handlerMs: +handlerMs.toFixed(1), applyMs: +applyMs.toFixed(1) };
    // 15. old 5.0.1 mappings convert and still work
    localStorage.removeItem('xolab-midi-v2'); localStorage.setItem('xolab-midi-map-v1', JSON.stringify({ 'cc:1:21': { t: 'range', k: 'blob.sens' }, 'note:1:36': { t: 'toggle', k: 'blob.on' } }));
    M.reload(); R.migrated = Object.keys(M.map).map((k) => k + '=' + M.map[k].type).join(', ');
    H(0xb0, 21, 127); F(); R.migratedWorks = XO.S.blob.sens === +el('blob.sens').max;
    localStorage.removeItem('xolab-midi-map-v1');
    // 16. starter profiles: every target exists
    const missing = [];
    Object.keys(XO.MIDI_STARTERS).forEach((n) => { const map = XO.MIDI_STARTERS[n].build(); Object.values(map).forEach((m) => m.targets.forEach((t) => { if ((t.tg.t === 'range' || t.tg.t === 'toggle') && !document.querySelector('[data-k="' + t.tg.k + '"]')) missing.push(n + ':' + t.tg.k); if (t.tg.t === 'action' && !M.ACTIONS[t.tg.a]) missing.push(n + ':' + t.tg.a); })); });
    R.starters = { n: Object.keys(XO.MIDI_STARTERS).length, missing };
    // 17. profile export → import round trip
    const ex = M.exportProfile(); const imported = M.importProfile(JSON.parse(JSON.stringify(ex)), 'Round trip');
    R.profile = imported === 'Round trip' && Object.keys(M.map).length === Object.keys(ex.map).length;
    // 18. UI: MIDI tab renders rows + editor
    XO.showTab('midi'); M.renderList(); const firstRow = document.querySelector('#midiList [data-open]'); if (firstRow) firstRow.click(); await wait(50);
    R.ui = { rows: document.querySelectorAll('#midiList .midi-map').length, editor: !!document.querySelector('#midiList .midi-edit'), curve: !!document.getElementById('midiCurve'), chips: document.querySelectorAll('[data-midi-action]').length };
    XO.perform.blackout = false; XO.perform.freeze = false; XO.resetAll(); XO.afterLoadState();
    return R;
  });
  const sensMax = 100, near = (a, b, t = 1.01) => Math.abs(a - b) <= t;
  check('MIDI knob: learned as absolute, full range', mid.knobType === 'knob' && mid.knobMax === sensMax && mid.knobMin === 0, mid.knobType + ' · ' + mid.knobMin + '…' + mid.knobMax);
  check('MIDI knob: range, invert and curves', mid.rangeMax === 75 && mid.inverted === 25 && near(mid.expMid, 25.4, 1.5) && near(mid.logMid, 71, 1.5), 'range→' + mid.rangeMax + ' invert→' + mid.inverted + ' exp(½)→' + mid.expMid + ' log(½)→' + mid.logMid);
  check('MIDI encoder: detected and steps up / down', mid.encType === 'encoder/twos' && mid.encUp === 15 && mid.encDown === 12, mid.encType + ' · 10 +5 → ' + mid.encUp + ', −3 → ' + mid.encDown);
  check('MIDI encoder: all relative formats', mid.offsetDet === 'offset' && mid.signDet === 'sign' && mid.decode === '1,-1,-2,-2', 'detected offset=' + mid.offsetDet + ' sign=' + mid.signDet + ' · decode ' + mid.decode);
  check('MIDI encoder: acceleration on fast turns', mid.accel > 8, '3 quick clicks from 5 → ' + mid.accel);
  check('MIDI fader: soft takeover, no jump', mid.noJump === 175 && mid.waiting && mid.pickedUp !== 175, 'held at ' + mid.noJump + ' until crossing, then ' + mid.pickedUp);
  check('MIDI buttons: momentary (learned), toggle, trigger', mid.momType === 'momentary' && mid.blackOn === true && mid.blackOff === false && mid.tog1 === true && mid.tog2 === false && mid.trigger, 'momentary ' + mid.blackOn + '/' + mid.blackOff + ' · toggle ' + mid.tog1 + '/' + mid.tog2 + ' · trigger once ' + mid.trigger);
  check('MIDI pad velocity sets the amount', near(mid.velocity, 50, 1.5), 'velocity 64 → ' + mid.velocity + '%');
  check('MIDI pressure (aftertouch)', mid.pressureHi === 100 && mid.pressureLo === 0);
  check('MIDI 14-bit CC is finer than 1/127', Math.abs(mid.hiResN * 127 - Math.round(mid.hiResN * 127)) > 0.01, 'n = ' + mid.hiResN.toFixed(5));
  check('MIDI pitch bend (centre + top)', near(mid.pbMid, 0.5, 0.001) && mid.pbTop === 100, 'centre ' + mid.pbMid.toFixed(3) + ' · top → ' + mid.pbTop);
  check('MIDI macro: one fader, 3 targets, own ranges', mid.macro[0] === 100 && mid.macro[1] === 100 && mid.macro[2] === -100, mid.macro.join(' / '));
  check('MIDI shift layer', mid.shift.held[1] === 80 && mid.shift.held[0] === 0 && mid.shift.after[0] === -100, JSON.stringify(mid.shift));
  check('MIDI crossfader morphs Scene A ↔ B', mid.xfA === 10 && mid.xfB === 90 && near(mid.xfQuarter, 30.2, 1.5), 'A ' + mid.xfA + ' · ¼ ' + mid.xfQuarter.toFixed(1) + ' · B ' + mid.xfB);
  check('MIDI program change loads a scene slot', mid.pcA === 10 && mid.pcB === 90);
  check('MIDI clock sets the tempo', near(mid.clockBpm, 125, 0.2) && mid.clockMode === 'clock' && near(mid.audioBpm, 125, 0.2), mid.clockBpm + ' BPM · mode ' + mid.clockMode + ' · visuals use ' + mid.audioBpm);
  // All 500 messages must cost less than one frame of work; where the machine draws at a real frame rate (≥ 30 fps), frames must stay within 10%.
  const realFps = mid.burst.base >= 30;
  check('MIDI burst: 500 messages cost under one frame', mid.burst.sent === 500 && mid.burst.handlerMs + mid.burst.applyMs < 16 && (!realFps || mid.burst.burst >= mid.burst.base * 0.9), 'handling ' + mid.burst.handlerMs + ' ms + applying ' + mid.burst.applyMs + ' ms for 500 messages · frames ' + mid.burst.burst + ' vs ' + mid.burst.base + (realFps ? '' : ' (software GPU here — frame check runs on real hardware)'));
  check('MIDI 5.0.1 mappings convert and work', /cc:1:21=knob/.test(mid.migrated) && /note:1:36=toggle/.test(mid.migrated) && mid.migratedWorks, mid.migrated);
  check('MIDI starter profiles point at real controls', !mid.starters.missing.length, mid.starters.n + ' starters' + (mid.starters.missing.length ? ' · missing ' + mid.starters.missing.join(', ') : ''));
  check('MIDI profile export / import', mid.profile);
  check('MIDI tab: list, editor, curve, learn chips', mid.ui.rows > 0 && mid.ui.editor && mid.ui.curve && mid.ui.chips >= 15, JSON.stringify(mid.ui));

  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(failed ? '\nSMOKE TEST FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
