/* XO LAB — audio engine: playback, live input (mic / line-in), frequency bands, onsets, triggers, BPM, record tap */
(function () {
  'use strict';
  const XO = window.XO;

  // floors are in linear amplitude (0..1 of the analyser's max), so leakage between bands stays near zero
  const BANDS = {
    bass: { lo: 20, hi: 150, floor: 0.1 },
    mid: { lo: 150, hi: 2000, floor: 0.04 },
    high: { lo: 2000, hi: 16000, floor: 0.02 },
    full: { lo: 20, hi: 16000, floor: 0.03 },
    custom: { lo: 300, hi: 1200, floor: 0.04 },
  };
  // byte (dB-scaled) → linear amplitude lookup
  const LIN = new Float32Array(256);

  const A = (XO.audio = {
    el: null, ctx: null, analyser: null, gain: null, recordDest: null, bins: null,
    url: '', fileName: '', loaded: false, file: null, decoded: null, decodedFor: null, offline: null,
    level: 0, raw: 0, bass: 0, beat: 0, beatCount: 0,
    bands: {}, volume: 0.9,
    bpm: 0, bpmConf: 0, lastBeatTime: 0, tapBpm: 0,
    _hist: [], _riseAvg: 0, _lastBeat: 0, _onsets: [], _taps: [], _trig: {},
    live: { on: false, stream: null, src: null, gain: null, deviceId: '', label: '' },
  });
  Object.keys(BANDS).forEach((k) => { A.bands[k] = { e: 0, raw: 0, norm: 0, peak: BANDS[k].floor, hit: false, hitCount: 0, lastHit: 0, armed: true, env: 0 }; });

  A.init = function (audioEl) { A.el = audioEl; A.el.volume = 1; };
  A.supported = () => !!(window.AudioContext || window.webkitAudioContext);

  // Must be called from a user gesture on iOS. Safe to call repeatedly.
  A.ensureContext = function () {
    if (!A.supported()) return null;
    if (!A.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      A.ctx = new Ctx();
      A.analyser = A.ctx.createAnalyser();
      A.analyser.fftSize = 2048;
      A.analyser.smoothingTimeConstant = 0.5;
      A.bins = new Uint8Array(A.analyser.frequencyBinCount);
      A.gain = A.ctx.createGain();
      A.gain.gain.value = A.volume;
      const src = A.ctx.createMediaElementSource(A.el);
      src.connect(A.analyser);            // analysis is pre-volume
      A.analyser.connect(A.gain);
      A.gain.connect(A.ctx.destination);
      if (A.ctx.createMediaStreamDestination) {
        A.recordDest = A.ctx.createMediaStreamDestination();
        A.analyser.connect(A.recordDest); // export always gets full-level audio
      }
    }
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    return A.ctx;
  };

  A.load = function (file) {
    return new Promise((resolve, reject) => {
      A.unload();
      A.url = URL.createObjectURL(file);
      A.fileName = file.name; A.file = file;
      const el = A.el;
      const done = () => { cleanup(); A.loaded = true; resolve(el.duration); };
      const fail = () => { cleanup(); A.unload(); reject(new Error('This audio format can\'t be played by this browser.')); };
      const cleanup = () => { el.removeEventListener('loadedmetadata', done); el.removeEventListener('error', fail); };
      el.addEventListener('loadedmetadata', done);
      el.addEventListener('error', fail);
      el.src = A.url;
      el.load();
    });
  };
  function resetBands() { Object.keys(A.bands).forEach((k) => { const b = A.bands[k]; b.peak = BANDS[k].floor; b.e = 0; b.norm = 0; b.armed = true; }); A._onsets = []; A._hist = []; A._riseAvg = 0; }
  A.resetBands = resetBands;
  A.unload = function () {
    resetBands();
    if (A.el) { A.el.pause(); A.el.removeAttribute('src'); A.el.load(); }
    if (A.url) URL.revokeObjectURL(A.url);
    A.url = ''; A.fileName = ''; A.loaded = false; A.file = null; A.decoded = null; A.decodedFor = null;
  };

  /** Decodes the whole track to PCM (for trimming, waveform and offline rendering). Cached per file. */
  A.decode = async function () {
    if (!A.file) return null;
    if (A.decoded && A.decodedFor === A.file) return A.decoded;
    if (A._decoding && A._decodingFor === A.file) return A._decoding;
    const file = A.file;
    A._decodingFor = file;
    A._decoding = (async () => {
      const ctx = A.ensureContext() || new (window.AudioContext || window.webkitAudioContext)();
      const buf = await file.arrayBuffer();
      const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
      if (A.file === file) { A.decoded = audio; A.decodedFor = file; }
      return audio;
    })();
    try { return await A._decoding; } finally { A._decoding = null; A._decodingFor = null; }
  };
  A.setVolume = function (v) { A.volume = v; if (A.gain) A.gain.gain.setTargetAtTime(A.live.on ? 0 : v, A.ctx.currentTime, 0.02); }; // live input never reaches the speakers
  A.play = function () { if (!A.loaded || A.live.on) return Promise.resolve(false); A.ensureContext(); return A.el.play().then(() => true).catch(() => false); };
  A.pause = () => { if (A.el) A.el.pause(); };
  A.isPlaying = () => !!(A.offline || A.live.on || (A.loaded && A.el && !A.el.paused));

  /* ---------------- live input: microphone, audio interface, DJ mixer line-in ----------------
   * The live signal feeds the analyser only. It is never sent to the speakers (no feedback loop), and while it's on
   * the track output is muted so the visuals follow the room / mixer. */
  A.liveSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && A.supported();
  A.liveDevices = async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || 'Audio input ' + (i + 1) }));
  };
  A.startLive = async function (deviceId) {
    if (!A.liveSupported()) throw new Error('Live audio input isn\'t available here.');
    A.ensureContext();
    const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    if (deviceId) constraints.audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    A.stopLive(true);
    A.pause();
    const L = A.live;
    L.stream = stream;
    L.src = A.ctx.createMediaStreamSource(stream);
    L.gain = A.ctx.createGain();
    L.gain.gain.value = (XO.S.audio.liveGain || 100) / 100;
    L.src.connect(L.gain); L.gain.connect(A.analyser);
    A.gain.gain.setTargetAtTime(0, A.ctx.currentTime, 0.01); // nothing from the analyser reaches the speakers
    const tr = stream.getAudioTracks()[0];
    L.label = (tr && tr.label) || 'Live input';
    L.deviceId = (tr && tr.getSettings && tr.getSettings().deviceId) || deviceId || '';
    L.on = true;
    resetBands();
    if (tr) tr.addEventListener('ended', () => { A.stopLive(); if (A.onLiveChange) A.onLiveChange(); });
    if (A.ctx.state === 'suspended') await A.ctx.resume().catch(() => {});
    return L.label;
  };
  A.stopLive = function (keepMuted) {
    const L = A.live;
    if (L.src) { try { L.src.disconnect(); L.gain.disconnect(); } catch (e) { /* already gone */ } }
    if (L.stream) L.stream.getTracks().forEach((t) => t.stop());
    const was = L.on;
    Object.assign(L, { on: false, stream: null, src: null, gain: null });
    if (was) resetBands();
    if (!keepMuted && A.gain) A.gain.gain.setTargetAtTime(A.volume, A.ctx.currentTime, 0.02);
  };
  A.setLiveGain = function (pct) { if (A.live.gain) A.live.gain.gain.setTargetAtTime(pct / 100, A.ctx.currentTime, 0.02); };

  function buildLin() {
    const lo = A.analyser ? A.analyser.minDecibels : -100, hi = A.analyser ? A.analyser.maxDecibels : -30;
    for (let v = 0; v < 256; v++) LIN[v] = v === 0 ? 0 : Math.pow(10, (lo + (v / 255) * (hi - lo) - hi) / 20);
    LIN.ready = true;
  }
  // RMS of linear magnitudes in the band (0..1); the analyser's bytes are dB-scaled
  function bandRaw(lo, hi, binHz, n) {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(n - 1, Math.ceil(hi / binHz));
    let s = 0; for (let i = a; i <= b; i++) { const l = LIN[A.bins[i]]; s += l * l; }
    return Math.sqrt(s / Math.max(1, b - a + 1));
  }
  function byteMean(lo, hi, binHz, n) {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(n - 1, Math.ceil(hi / binHz));
    let s = 0; for (let i = a; i <= b; i++) s += A.bins[i];
    return s / Math.max(1, b - a + 1) / 255;
  }

  // Called once per rendered frame
  A.update = function (dt, now) {
    const S = XO.S.audio;
    BANDS.custom.lo = Math.min(S.customLo, S.customHi - 10); BANDS.custom.hi = Math.max(S.customHi, S.customLo + 10);
    const off = A.offline;
    const playing = off ? true : A.analyser && A.isPlaying();
    if (playing && !A._wasPlaying) A._resumeAt = now; // analyser still holds the old spectrum for a moment
    A._wasPlaying = playing;
    if (!playing) {
      A.raw = 0; A.bass = 0; A._hist.length = 0;
      A.level += (0 - A.level) * Math.min(1, dt * 6);
      A.beat *= Math.exp(-dt * 7);
      Object.keys(A.bands).forEach((k) => { const b = A.bands[k]; b.raw = 0; b.norm = 0; b.e += (0 - b.e) * Math.min(1, dt * 8); b.hit = false; b.armed = true; b.env *= Math.exp(-dt * 8); });
      return;
    }
    if (off) { if (!A.bins || A.bins.length !== off.bins.length) A.bins = new Uint8Array(off.bins.length); A.bins.set(off.bins); }
    else A.analyser.getByteFrequencyData(A.bins);
    if (!LIN.ready) buildLin();
    const n = A.bins.length, binHz = off ? off.sampleRate / (n * 2) : A.ctx.sampleRate / A.analyser.fftSize;
    A.binHz = binHz;
    let sum = 0; for (let i = 0; i < n; i++) sum += A.bins[i];
    A.raw = sum / n / 255;
    A.level += (A.raw - A.level) * Math.min(1, dt * 9.6);

    const thr = { bass: S.thrBass, mid: S.thrMid, high: S.thrHigh, full: S.thrFull, custom: S.thrFull };
    A.settling = now - (A._resumeAt || 0) < 150;
    Object.keys(BANDS).forEach((k) => {
      const cfg = BANDS[k], b = A.bands[k];
      b.raw = bandRaw(cfg.lo, cfg.hi, binHz, n);
      // auto-gain: normalise to a slowly decaying peak (with a floor so silence stays silent)
      b.peak = Math.max(b.raw, b.peak * Math.exp(-dt * 0.25), cfg.floor);
      b.norm = Math.min(1, b.raw / b.peak);
      b.e += (b.norm - b.e) * Math.min(1, dt * (b.norm > b.e ? 30 : 6)); // fast attack, slower release
      const t = thr[k] / 100;
      b.hit = false;
      if (!A.settling && b.norm >= t && b.armed && now - b.lastHit >= S.cooldown) { b.hit = true; b.armed = false; b.lastHit = now; b.hitCount++; b.env = 1; }
      else b.env *= Math.exp(-dt * 8);
      if (b.norm < t * 0.8) b.armed = true;
    });
    A.bass = A.bands.bass.raw; // linear energy: quiet leakage from hats/synths stays far below the kick

    // Kick onset (rise in bass over ~120 ms) → beat envelope + BPM estimate
    A._hist.push([now, A.bass]);
    while (A._hist.length && now - A._hist[0][0] > 120) A._hist.shift();
    let floor = A.bass; for (const h of A._hist) if (h[1] < floor) floor = h[1];
    const rise = A.bass - floor;
    if (!A.settling && A.bass > 0.2 && rise > Math.max(0.12, A._riseAvg * 0.5) && now - A._lastBeat > 200) {
      A._riseAvg += (rise - A._riseAvg) * 0.3;
      A._lastBeat = now; A.lastBeatTime = now; A.beat = 1; A.beatCount++;
      A._onsets.push(now); if (A._onsets.length > 24) A._onsets.shift();
      estimateBpm();
    } else A.beat *= Math.exp(-dt * 7);
  };

  function estimateBpm() {
    const iv = [];
    for (let i = 1; i < A._onsets.length; i++) { const d = (A._onsets[i] - A._onsets[i - 1]) / 1000; if (d > 0.25 && d < 1.5) iv.push(d); }
    if (iv.length < 3) return;
    iv.sort((a, b) => a - b);
    let bpm = 60 / iv[Math.floor(iv.length / 2)];
    while (bpm < 80) bpm *= 2; while (bpm > 180) bpm /= 2;
    const med = iv[Math.floor(iv.length / 2)];
    A.bpmConf = iv.filter((d) => Math.abs(d - med) / med < 0.08).length / iv.length;
    A.bpm = Math.round(bpm * 10) / 10;
  }

  A.tap = function (now) {
    if (A._taps.length && now - A._taps[A._taps.length - 1] > 2000) A._taps = [];
    A._taps.push(now); if (A._taps.length > 6) A._taps.shift();
    if (A._taps.length >= 3) {
      const iv = []; for (let i = 1; i < A._taps.length; i++) iv.push(A._taps[i] - A._taps[i - 1]);
      A.tapBpm = Math.round(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length) * 10) / 10;
      A._tapRef = now;
    }
    return A.tapBpm;
  };

  A.effectiveBpm = function () {
    const S = XO.S.audio;
    if (S.bpmMode === 'manual') return S.bpm;
    if (S.bpmMode === 'clock') return (XO.midi && XO.midi.clock.bpm) || S.bpm;
    if (S.bpmMode === 'tap') return A.tapBpm || S.bpm;
    return A.bpm || S.bpm;
  };
  A.beatRef = function () { const m = XO.S.audio.bpmMode; if (m === 'clock' && XO.midi && XO.midi.clock.beatAt) return XO.midi.clock.beatAt; return m === 'tap' && A._tapRef ? A._tapRef : A.lastBeatTime; };

  // Smoothed energy of a band (0..1), 0 when 'off'
  A.energy = (band) => (band && band !== 'off' && A.bands[band] ? A.bands[band].e : 0);

  /** Per-effect trigger: fires once when `band` rises above thr (0..1), re-arms below 80%. */
  A.trigger = function (key, band, thr, cooldownMs, now) {
    if (!band || band === 'off' || !A.bands[band]) return false;
    const st = A._trig[key] || (A._trig[key] = { armed: true, last: -1e9 });
    const v = A.bands[band].norm;
    if (!A.isPlaying() || A.settling) { st.armed = true; return false; }
    if (v >= thr && st.armed && now - st.last >= cooldownMs) { st.armed = false; st.last = now; return true; }
    if (v < thr * 0.8) st.armed = true;
    return false;
  };

  A.recordTracks = () => (A.recordDest ? A.recordDest.stream.getAudioTracks() : []);

  /** n log-spaced bands (40 Hz – 12 kHz), each auto-gained to 0..1. Used by the spectrum ring. */
  const specPeak = {};
  A.spectrum = function (n) {
    const out = new Float32Array(n);
    if (!A.isPlaying() || !A.bins || !A.binHz) return out;
    if (!LIN.ready) buildLin();
    const peaks = specPeak[n] || (specPeak[n] = new Float32Array(n).fill(0.05)), lo = Math.log(40), hi = Math.log(12000), nb = A.bins.length;
    for (let i = 0; i < n; i++) {
      const f0 = Math.exp(lo + (hi - lo) * i / n), f1 = Math.exp(lo + (hi - lo) * (i + 1) / n);
      const a = Math.max(1, Math.floor(f0 / A.binHz)), b = Math.min(nb - 1, Math.max(a, Math.ceil(f1 / A.binHz)));
      let s = 0; for (let k = a; k <= b; k++) { const l = LIN[A.bins[k]]; s += l * l; }
      const v = Math.sqrt(s / (b - a + 1));
      peaks[i] = Math.max(v, peaks[i] * 0.995, 0.01);
      out[i] = Math.min(1, v / peaks[i]);
    }
    return out;
  };

  /* ---------- offline analyser: reproduces AnalyserNode (fftSize 2048, Blackman window, smoothing 0.5, -100…-30 dB) ---------- */
  A.OfflineAnalyser = function (buffer, opts) {
    const N = 2048, half = N / 2, sr = buffer.sampleRate, minDb = -100, maxDb = -30, tau = 0.5;
    const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);
    const re = new Float32Array(N), im = new Float32Array(N), smooth = new Float32Array(half), bytes = new Uint8Array(half);
    const rev = new Uint32Array(N); for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float32Array(half), sin = new Float32Array(half); for (let i = 0; i < half; i++) { cos[i] = Math.cos(-2 * Math.PI * i / N); sin[i] = Math.sin(-2 * Math.PI * i / N); }
    function fft() {
      for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= N; size <<= 1) {
        const h = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) for (let j = 0; j < h; j++) {
          const k = j * step, a = i + j, b = a + h, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    /** Spectrum for the 2048 samples ending at `t` seconds of the source (null = silence). */
    this.frame = function (t) {
      const end = t == null ? -1 : Math.floor(t * sr);
      const nc = chans.length, len = chans[0].length;
      for (let i = 0; i < N; i++) {
        const idx = end - N + i; let v = 0;
        if (idx >= 0 && idx < len) { for (let c = 0; c < nc; c++) v += chans[c][idx]; v /= nc; }
        re[i] = v * win[i]; im[i] = 0;
      }
      fft();
      const range = 255 / (maxDb - minDb);
      for (let k = 0; k < half; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
        smooth[k] = tau * smooth[k] + (1 - tau) * mag;
        const db = smooth[k] > 0 ? 20 * Math.log10(smooth[k]) : -Infinity;
        bytes[k] = Math.max(0, Math.min(255, Math.floor((db - minDb) * range)));
      }
      return bytes;
    };
    this.sampleRate = sr;
    void opts;
  };
})();
