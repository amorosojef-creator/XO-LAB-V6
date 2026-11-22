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
const browser = await chromium.launch({ executablePath: chrome, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.tap('#enter');
  check('viewport blocks pinch zoom', /user-scalable=no/.test(await page.getAttribute('meta[name=viewport]', 'content')));
  check('page touch-action is pan only', (await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)) === 'pan-x pan-y');

  // 5.0.1: the app must never scroll as a page (toggle clicks used to push the whole UI up and leave black below)
  const pin = await page.evaluate(async () => {
    const out = { docH: document.documentElement.scrollHeight, vh: innerHeight, jumps: [] };
    for (const tab of ['media', 'track', 'model', 'fx', 'strobe', 'output']) {
      XO.showTab(tab);
      const tg = [...document.querySelectorAll('.panel.active label.toggle')].filter((l) => l.offsetParent);
      for (const l of tg.slice(-2)) { l.click(); await new Promise((r) => setTimeout(r, 30)); l.click(); }
      const top = document.querySelector('.topbar').getBoundingClientRect().top;
      if (scrollY || document.documentElement.scrollTop || document.querySelector('.app').scrollTop || top < 0) out.jumps.push(tab + ':' + Math.round(top));
    }
    out.docH = Math.max(out.docH, document.documentElement.scrollHeight); XO.showTab('media'); XO.history.reset();
    return out;
  });
  check('app stays pinned to the window (no page scroll on toggle clicks)', pin.docH <= pin.vh + 1 && !pin.jumps.length, JSON.stringify(pin));

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

  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close(); server.kill(); fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(failed ? '\nSMOKE TEST FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
