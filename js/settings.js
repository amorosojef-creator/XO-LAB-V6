/* XO LAB — settings model: defaults, path access, palettes, scenes */
(function () {
  'use strict';
  const XO = (window.XO = window.XO || {});

  const DEFAULTS = {
    media: { fit: 'fill', posX: 0, posY: 0, zoom: 100, imgMax: '2048', volume: 90, camMirror: true },
    bg: { mode: 'solid', color: '#000000', gType: 'linear', gStops: '2', gAngle: 90, g1: '#000000', g2: '#1b1b1f', g3: '#000000', imgFit: 'fill', blur: 60, darken: 55, filterBg: false },
    out: {
      aspect: 'source', size: '1080', customW: 1920, customH: 1080, quality: '100',
      fps: '30', vq: 'high', container: 'auto',
      aIn: 0, aOut: 0, aOffset: 0, fadeIn: 0, fadeOut: 1, aVol: 100,
      durMode: 'audio', dur: 15, extend: 'silence',
      vIn: 0, vOut: 0, vEnd: 'loop', vFadeIn: 0, vFadeOut: 0,
      incHud: true, incStrobe: true, incDof: true,
    },
    audio: { thrBass: 70, thrMid: 70, thrHigh: 70, thrFull: 70, cooldown: 120, customLo: 300, customHi: 1200, bpmMode: 'auto', bpm: 128, liveGain: 100 },
    model: {
      speed: 100, spin: false,
      wire: 'off', wireThick: 2, wireOpacity: 100, wireGlow: 0, edgeAngle: 20, pointSize: 3, wireBand: 'off', wireAmt: 50,
      material: 'original',
      metal: 100, rough: 6, env: 'studio', envInt: 100, clearcoat: 40, irid: false, rim: 25, cRim: '#ffffff',
      flowSpeed: 35, flowScale: 30, wave: 45, drip: 'none', liqBand: 'bass', liqAmt: 60, quality: 'med', smooth: true,
      burstAuto: true, burstBand: 'bass', burstThr: 85, burstCooldown: 1200, dDur: 0.5, hDur: 0.25, rDur: 0.9, ease: 'out',
      strength: 32, turbulence: 35, drift: 'out', windX: 30, spin3: 30, count: 30000, pSize: 3.5, pShape: 'dot', dustColor: 'texture', fade: true,
      cWire: '#ffffff', cSolid: '#d9d9d9', cDust: '#ffffff',
    },
    scene: {
      stars: false, starsSpeed: 30, starsBand: 'bass', cStars: '#ffffff',
      motes: false, motesBand: 'mid', cMotes: '#ffffff',
      ring: false, ringSize: 30, ringHeight: 50, cRing: '#ffffff',
      grid: false, gridSpeed: 30, gridBand: 'bass', cGrid: '#ff2bd6',
      lasers: false, laserBand: 'bass', laserBright: 80, cLaser: '#00e5ff',
      fog: false, fogDensity: 25, cFog: '#000000',
    },
    blob: {
      on: true, detect: 'bright', sens: 42, maxBlobs: 12, minCells: 6, smooth: 65, detectOn: 'source',
      padding: 2, minSize: 10, maxSize: 600, fixed: false, fixedSize: 80, square: false,
      shape: 'rect', lineW: 1.4, style: 'invert', styledPct: 25, styleFlash: true,
      link: 'mst', linkW: 1.4, linkDash: false, linkOpacity: 55,
      labelMode: 'word', fontSize: 12, labelPos: 'top', upper: true, readout: true, coords: true, customWords: '',
      glyphs: 'latin+sym', scrSpeed: 18, resolve: 450, reroll: true, scrAudio: 70,
      band: 'bass', bandThr: 75, bandCooldown: 180,
      rFlash: 70, rGrow: 40, rJitter: 0, rScramble: 70, rColor: 0, rLine: 40, rGhost: 0,
      accentOn: false,
      cBox: '#ffffff', cBracket: '#ffffff', cCross: '#ffffff', cLabelBg: '#ffffff', cLabelText: '#000000', cLine: '#ffffff', cAccent: '#ff3b2f', cTint: '#ffffff',
    },
    dof: { on: false, follow: false, fx: 50, fy: 50, size: 22, falloff: 30, amount: 70, shape: 'circle', bokeh: 30 },
    fx: { stack: [], fxColors: null },
    fxc: { ink: '#000000', paper: '#f2f2ef', duoA: '#0a0a0c', duoB: '#f2f2ef', edge: '#ffffff', t1: '#000000', t2: '#ff2b55', t3: '#ffe14d', ascii: '#f2f2ef', asciiBg: '#000000', tint: '#ff2b55', led: '#ffffff' },
    strobe: {
      on: false, type: 'white', color: '#ffffff', p1: '#ffffff', p2: '#ff2b55', p3: '#00e5ff', p4: '#c6ff00',
      rate: 'bpm', div: '1/4', hz: 2, band: 'bass', thr: 80, duty: 30, intensity: 100, fade: true, layer: 'top', unlocked: false, acknowledged: false,
    },
  };

  if (XO.look3d) Object.assign(DEFAULTS.model, XO.look3d.motionDefaults());
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const S = (XO.S = clone(DEFAULTS));
  XO.DEFAULTS = DEFAULTS;

  XO.get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
  XO.set = (path, v) => { const ks = path.split('.'); let o = S; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; };
  XO.getDefault = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), DEFAULTS);

  XO.resetPaths = function (paths) { paths.forEach((p) => { const d = XO.getDefault(p); if (d !== undefined) XO.set(p, clone(d)); }); };
  XO.resetAll = function () { const fresh = clone(DEFAULTS); Object.keys(fresh).forEach((k) => { S[k] = fresh[k]; }); };
  XO.snapshot = () => clone(S);
  XO.applySnapshot = function (snap) {
    const fresh = clone(DEFAULTS);
    Object.keys(fresh).forEach((sec) => {
      S[sec] = Object.assign(fresh[sec], snap && snap[sec] ? snap[sec] : {});
    });
    if (snap && snap.fx && Array.isArray(snap.fx.stack)) S.fx.stack = clone(snap.fx.stack);
  };

  /* ---------- migration: older scenes / projects ----------
   * applySnapshot already fills every missing setting with today's default, so a V3 scene simply gains the new
   * V5 settings at their defaults. Renamed or reshaped settings are fixed here, keyed by the version that saved them. */
  XO.migrate = function (snap, fromVersion) {
    const s = clone(snap || {});
    const major = parseInt(String(fromVersion || '3'), 10) || 3;
    if (major < 5) { /* V3 / V4 → V5: no renamed keys yet; new sections come from DEFAULTS */ }
    return s;
  };

  /* ---------- palettes (one tap; background stays pure black) ---------- */
  function pal(hud, label, labelText, line, accent, wire, dust, strobe, cyc, fxc) {
    return {
      'blob.cBox': hud, 'blob.cBracket': hud, 'blob.cCross': hud, 'blob.cLabelBg': label, 'blob.cLabelText': labelText, 'blob.cLine': line, 'blob.cAccent': accent, 'blob.cTint': accent,
      'model.cWire': wire, 'model.cDust': dust, 'strobe.color': strobe,
      'strobe.p1': cyc[0], 'strobe.p2': cyc[1], 'strobe.p3': cyc[2], 'strobe.p4': cyc[3],
      'fxc.ink': fxc[0], 'fxc.paper': fxc[1], 'fxc.duoA': fxc[0], 'fxc.duoB': fxc[1], 'fxc.edge': fxc[2], 'fxc.t1': fxc[3], 'fxc.t2': fxc[4], 'fxc.t3': fxc[5], 'fxc.ascii': fxc[1], 'fxc.asciiBg': fxc[0], 'fxc.tint': accent, 'fxc.led': fxc[2],
      'bg.color': '#000000',
    };
  }
  XO.PALETTES = {
    Mono: pal('#ffffff', '#ffffff', '#000000', '#ffffff', '#ff3b2f', '#ffffff', '#ffffff', '#ffffff', ['#ffffff', '#ff2b55', '#00e5ff', '#c6ff00'], ['#000000', '#f2f2ef', '#ffffff', '#000000', '#ff2b55', '#ffe14d']),
    Acid: pal('#c6ff00', '#c6ff00', '#000000', '#c6ff00', '#ffffff', '#c6ff00', '#c6ff00', '#c6ff00', ['#c6ff00', '#ffffff', '#c6ff00', '#000000'], ['#000000', '#c6ff00', '#c6ff00', '#000000', '#3a5a00', '#c6ff00']),
    Cyber: pal('#00e5ff', '#ff2bd6', '#000000', '#00e5ff', '#ff2bd6', '#00e5ff', '#ff2bd6', '#ff2bd6', ['#ff2bd6', '#00e5ff', '#ffffff', '#7a2bff'], ['#12001f', '#00e5ff', '#ff2bd6', '#12001f', '#ff2bd6', '#00e5ff']),
    Infrared: pal('#ff3b2f', '#ff3b2f', '#000000', '#ff6a3d', '#ffd000', '#ff3b2f', '#ffb000', '#ff3b2f', ['#ff3b2f', '#ffd000', '#ffffff', '#ff0080'], ['#140000', '#ffd0a0', '#ff3b2f', '#000000', '#ff0040', '#ffd000']),
    Blood: pal('#ff1a1a', '#ff1a1a', '#000000', '#ff1a1a', '#ffffff', '#ff1a1a', '#ff1a1a', '#ff1a1a', ['#ff1a1a', '#000000', '#ffffff', '#7a0000'], ['#000000', '#ff1a1a', '#ff1a1a', '#000000', '#7a0000', '#ff1a1a']),
    Ice: pal('#bfefff', '#bfefff', '#001018', '#5ac8ff', '#ffffff', '#bfefff', '#ffffff', '#bfefff', ['#bfefff', '#5ac8ff', '#ffffff', '#1a5aff'], ['#00101a', '#e6f8ff', '#5ac8ff', '#00101a', '#1a5aff', '#bfefff']),
  };
  XO.applyPalette = function (name) { const p = XO.PALETTES[name]; if (p) Object.keys(p).forEach((k) => XO.set(k, p[k])); };

  /* ---------- scenes (localStorage, guarded) ---------- */
  const KEY = 'xolab.scenes.v3';
  function readScenes() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function writeScenes(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  XO.scenes = {
    list: readScenes,
    save(name) { const l = readScenes(); const i = l.findIndex((s) => s.name === name); const entry = { name, at: Date.now(), v: '5.1.0', S: XO.snapshot() }; if (i >= 0) l[i] = entry; else l.push(entry); return writeScenes(l); },
    load(name) { const s = readScenes().find((x) => x.name === name); if (!s) return false; XO.applySnapshot(XO.migrate(s.S, s.v)); return true; },
    remove(name) { return writeScenes(readScenes().filter((s) => s.name !== name)); },
    rename(oldN, newN) { const l = readScenes(); const s = l.find((x) => x.name === oldN); if (!s || l.some((x) => x.name === newN)) return false; s.name = newN; return writeScenes(l); },
    duplicate(name) { const l = readScenes(); const s = l.find((x) => x.name === name); if (!s) return false; let n = name + ' copy', i = 2; while (l.some((x) => x.name === n)) n = name + ' copy ' + i++; l.push({ name: n, at: Date.now(), S: clone(s.S) }); writeScenes(l); return n; },
    exportJSON() { return JSON.stringify({ app: 'XO LAB', version: 5, scenes: readScenes() }, null, 1); },
    importJSON(text) { const d = JSON.parse(text); const incoming = Array.isArray(d) ? d : d.scenes; if (!Array.isArray(incoming)) throw new Error('No scenes in this file.'); const l = readScenes(); incoming.forEach((s) => { if (!s || !s.name || !s.S) return; const i = l.findIndex((x) => x.name === s.name); if (i >= 0) l[i] = s; else l.push(s); }); writeScenes(l); return incoming.length; },
    byIndex(i) { return readScenes()[i]; },
  };

  /* ---------- user filter presets ---------- */
  const FKEY = 'xolab.fxpresets.v3';
  XO.userFxPresets = {
    list() { try { return JSON.parse(localStorage.getItem(FKEY) || '[]'); } catch (e) { return []; } },
    save(name, stack) { const l = this.list().filter((p) => p.name !== name); l.push({ name, stack: clone(stack) }); try { localStorage.setItem(FKEY, JSON.stringify(l)); return true; } catch (e) { return false; } },
  };
})();
