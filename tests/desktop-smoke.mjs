// XO LAB desktop smoke test — starts the real Windows/Mac app (Electron), checks the app:// loader, storage,
// GPU effects, the menu bridge, permissions and a real render export. Run: npm run build && npm run test:desktop
// On a computer without a screen (CI on Linux) run it under xvfb-run.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!fs.existsSync(path.join(root, 'www', 'index.html'))) { console.error('Run "npm run build" first.'); process.exit(1); }

// test media: a short 128 BPM kick loop + a tiny OBJ
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xolab-desk-'));
(function wav(file, secs) {
  const sr = 44100, n = Math.round(sr * secs), beat = 60 / 128, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const t = (i / sr) % beat; const v = t < 0.2 ? Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 12) * 26000 : 0; buf.writeInt16LE(v | 0, 44 + i * 4); buf.writeInt16LE(v | 0, 46 + i * 4); }
  fs.writeFileSync(file, buf);
})(path.join(tmp, 'beat.wav'), 4);
fs.writeFileSync(path.join(tmp, 'tri.obj'), 'v 0 1 0\nv -1 -1 0\nv 1 -1 0\nv 0 0 1\nf 1 2 3\nf 1 2 4\nf 2 3 4\nf 3 1 4\n');

const results = []; let failed = false;
const check = (name, ok, detail) => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) failed = true; };

// XO_APP_PATH = test an already-packaged app (e.g. dist/linux-unpacked/xo-lab) instead of the source folder.
const packaged = process.env.XO_APP_PATH;
const app = await electron.launch({
  executablePath: packaged || require('electron'),
  args: packaged ? ['--no-sandbox'] : [root, '--no-sandbox'],
  env: { ...process.env, XO_SOFTWARE_GL: '1', XO_FAKE_MEDIA: '1' },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.XO && XO.ready, null, { timeout: 30000 });
  check('loads from app:// (offline, no server)', page.url().startsWith('app://xo-lab/'), page.url());
  check('desktop bridge present', await page.evaluate(() => !!window.xoDesktop && typeof window.xoDesktop.onMenu === 'function' && typeof require === 'undefined'));
  const info = await page.evaluate(() => window.xoDesktop.info());
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  check('app version ' + pkgVersion, info.version === pkgVersion, `Electron ${info.electron} · Chromium ${info.chrome} · ${info.platform}-${info.arch}`);
  await page.click('#enter');
  check('status shows the desktop app', /APP/.test(await page.textContent('#topStatus')), await page.textContent('#topStatus'));
  const env = await page.evaluate(async () => {
    let ls = false; try { localStorage.setItem('xo-test', '1'); ls = localStorage.getItem('xo-test') === '1'; } catch (e) { /* */ }
    let idb = false; try { idb = await new Promise((r) => { const q = indexedDB.open('xo-test', 1); q.onsuccess = () => r(true); q.onerror = () => r(false); }); } catch (e) { /* */ }
    return { ls, idb, secure: window.isSecureContext, webgl2: !!document.createElement('canvas').getContext('webgl2'), webcodecs: typeof VideoEncoder !== 'undefined', midi: typeof navigator.requestMIDIAccess === 'function', media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  });
  check('storage works (scenes, projects)', env.ls && env.idb);
  check('secure context + WebGL2 + WebCodecs', env.secure && env.webgl2 && env.webcodecs, JSON.stringify(env));
  check('mic / camera / MIDI APIs available', env.media && env.midi);
  const mic = await page.evaluate(async () => {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const n = st.getAudioTracks().length; st.getTracks().forEach((t) => t.stop()); return 'granted, ' + n + ' track'; } catch (e) { return 'denied: ' + e.name; }
  });
  check('microphone permission is granted to the app', /^granted/.test(mic), mic);

  // menu → renderer bridge (File ▸ Open Visual is the same path)
  const menuOk = await (async () => {
    await page.evaluate(() => { XO.history.reset(); XO.set('blob.sens', 91); XO.syncUI(); });
    await page.waitForTimeout(900);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('xo:menu', 'undo'));
    await page.waitForTimeout(200);
    return page.evaluate(() => XO.S.blob.sens !== 91);
  })();
  check('Edit ▸ Undo from the app menu', menuOk);
  check('menu has File / Edit / View / Help', await app.evaluate(({ Menu }) => { const l = Menu.getApplicationMenu().items.map((i) => i.label); return ['File', 'Edit', 'View', 'Help'].every((x) => l.includes(x)); }));

  // media + GPU + render
  await page.setInputFiles('#modelInput', path.join(tmp, 'tri.obj'));
  await page.waitForFunction(() => XO.model.loaded, null, { timeout: 30000 });
  await page.setInputFiles('#audioInput', path.join(tmp, 'beat.wav'));
  await page.waitForFunction(() => XO.audio.decoded, null, { timeout: 30000 });
  const fx = await page.evaluate(async () => { const bad = []; for (const t of XO.FILTER_ORDER) { XO.S.fx.stack = [XO.makeFilter(t)]; await new Promise((r) => setTimeout(r, 40)); if (XO.gl.fxError) bad.push(t); } XO.S.fx.stack = []; return { n: XO.FILTER_ORDER.length, bad }; });
  check('all ' + fx.n + ' GPU filters compile', !fx.bad.length, fx.bad.join(', '));
  await page.evaluate(() => { Object.assign(XO.S.out, { size: '720', fps: '30', aspect: '16:9', aIn: 0, aOut: 1.5, durMode: 'audio' }); XO.syncUI(); XO.applyOutputSize(); XO.syncTimeline(); });
  await page.waitForFunction(() => !document.getElementById('renderBtn').disabled, null, { timeout: 20000 });
  await page.evaluate(() => XO.qa.renderExport());
  const out = await page.evaluate(async () => { const f = XO.exporter.lastFile; return f ? { name: f.name, size: f.size, head: Array.from(new Uint8Array(await f.slice(4, 8).arrayBuffer())) } : null; });
  check('render & export works in the desktop app', !!out && out.size > 5000 && String.fromCharCode(...out.head) === 'ftyp', out ? out.name + ' · ' + (out.size / 1024).toFixed(0) + ' KB' : 'no file');
  // live input inside the desktop app
  const live = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await XO.live.startAudio();
    let peak = 0; for (let i = 0; i < 40; i++) { await wait(50); peak = Math.max(peak, XO.audio.raw); }
    const a = { on: XO.audio.live.on, peak, speakers: XO.audio.gain.gain.value };
    XO.live.stopAudio();
    await XO.live.startCamera(); await wait(800);
    const c = { kind: XO.state.V.kind, w: XO.state.V.w };
    XO.live.stopCamera();
    await XO.midi.connect();
    // a knob mapped in the desktop app drives a slider
    XO.midi.map['cc:1:21'] = Object.assign(XO.midi.defaults('knob'), { takeover: false, smooth: 0, targets: [{ tg: { t: 'range', k: 'blob.sens' }, min: 0, max: 1, invert: false, curve: 'linear' }] });
    XO.midi.handle({ data: [0xb0, 21, 127] }); XO.midi._flush();
    const knob = XO.S.blob.sens; delete XO.midi.map['cc:1:21']; XO.midi.save();
    const perm = await navigator.permissions.query({ name: 'midi' }).then((q) => q.state, () => 'unknown');
    return { a, c, knob, midi: XO.midi.status, perm, err: XO.midi.error || '', midiText: document.getElementById('midiState').textContent };
  });
  check('live audio input works in the desktop app', live.a.on && live.a.peak > 0.01 && live.a.speakers < 0.01, 'peak ' + live.a.peak.toFixed(3));
  check('live camera works in the desktop app', live.c.kind === 'camera' && live.c.w > 0, live.c.w + ' px wide');
  // Linux CI machines have no MIDI system (no ALSA sequencer); Windows and macOS always do. Permission is what the app controls.
  check('MIDI engine drives a slider in the desktop app', live.knob === 100, 'CC21 127 → sensitivity ' + live.knob);
  check('MIDI permission granted in the desktop app', live.perm === 'granted' && (live.midi === 'on' || (process.platform === 'linux' && live.midi === 'nosystem')), 'permission ' + live.perm + ' · ' + (live.midi === 'on' ? 'connected' : live.err));
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(failed ? '\nDESKTOP SMOKE TEST FAILED' : '\nALL DESKTOP CHECKS PASSED');
process.exit(failed ? 1 : 0);
