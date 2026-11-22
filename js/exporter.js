/* XO LAB — export by RENDERING, not recording.
 * Frames are rendered one by one at the export size (app.js drives the frame loop on a virtual clock),
 * encoded with WebCodecs and written to MP4 by Mediabunny (vendor/mediabunny). Audio is trimmed,
 * faded and mixed with an OfflineAudioContext, then encoded as AAC (MP4) — or PCM in a MOV when the
 * device has no AAC encoder. Nothing is recorded in real time, so a slow device still exports smooth video.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const MB = () => window.Mediabunny;
  const E = (XO.exporter = { rendering: false, cancelled: false, lastFile: null, lastUrl: '', support: null });

  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  E.isNative = isNative;

  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /** What this device can encode at w×h. Cached per size. */
  E.detect = async function (w, h, wantMov) {
    const key = w + 'x' + h + (wantMov ? 'm' : '');
    if (E.support && E.support.key === key) return E.support;
    const out = { key, ok: false, reason: '', video: null, audio: null, container: 'mp4', label: '' };
    if (!MB()) { out.reason = 'Export engine file is missing (vendor/mediabunny).'; return (E.support = out); }
    if (typeof VideoEncoder === 'undefined') { out.reason = 'This browser has no video encoder (WebCodecs). Use Safari on iOS 16.4+, Chrome or Edge.'; return (E.support = out); }
    const { canEncodeVideo, canEncodeAudio } = MB();
    for (const c of ['avc', 'hevc', 'vp9']) {
      try { if (await canEncodeVideo(c, { width: w, height: h })) { out.video = c; break; } } catch (e) { /* try next */ }
    }
    if (!out.video) { out.reason = 'This device can\'t encode video at ' + w + '×' + h + '. Try a smaller size.'; return (E.support = out); }
    let aac = false;
    try { aac = typeof AudioEncoder !== 'undefined' && (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })); } catch (e) { aac = false; }
    if (out.video === 'vp9') { out.container = 'webm'; let opus = false; try { opus = await canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 }); } catch (e) { /* none */ } out.audio = opus ? 'opus' : null; }
    else if (aac && !wantMov) { out.container = 'mp4'; out.audio = 'aac'; }
    else { out.container = 'mov'; out.audio = 'pcm-s16'; }
    const vname = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9' }[out.video], aname = { aac: 'AAC', 'pcm-s16': 'PCM', opus: 'Opus' }[out.audio] || 'no audio';
    out.label = out.container.toUpperCase() + ' (' + vname + ' / ' + aname + ')';
    out.ok = true;
    return (E.support = out);
  };

  /* ------------------------------ audio mix ------------------------------ */
  /**
   * plan: { total, aIn, aOut, offset, fadeIn, fadeOut, vol (0..1), loop (bool) } — seconds.
   * Returns a stereo AudioBuffer of exactly `total` seconds, or null when there's no audio.
   */
  E.mixAudio = async function (decoded, plan) {
    if (!decoded) return null;
    const sr = decoded.sampleRate >= 44100 ? decoded.sampleRate : 48000;
    const len = Math.max(1, Math.round(plan.total * sr));
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Off(2, len, sr);
    const clip = Math.max(0.01, plan.aOut - plan.aIn);
    const gain = ctx.createGain(); gain.connect(ctx.destination);
    const g = gain.gain, end = plan.total;
    g.setValueAtTime(plan.fadeIn > 0 ? 0 : plan.vol, 0);
    const startAt = Math.max(0, plan.offset || 0);
    if (plan.fadeIn > 0) { g.setValueAtTime(0, startAt); g.linearRampToValueAtTime(plan.vol, Math.min(end, startAt + plan.fadeIn)); }
    if (plan.fadeOut > 0) { const fs = Math.max(startAt, end - plan.fadeOut); g.setValueAtTime(plan.vol, fs); g.linearRampToValueAtTime(0, end); }
    let t = startAt, first = true;
    while (t < end - 1e-4) {
      const src = ctx.createBufferSource(); src.buffer = decoded; src.connect(gain);
      const dur = Math.min(clip, end - t);
      src.start(t, plan.aIn, dur);
      t += clip; first = false;
      if (!plan.loop) break;
    }
    void first;
    return await new Promise((res, rej) => { ctx.oncomplete = (e) => res(e.renderedBuffer); const p = ctx.startRendering(); if (p && p.then) p.then(res, rej); });
  };

  /* ------------------------------ encoder session ------------------------------ */
  /**
   * opts: { canvas, fps, quality ('medium'|'high'|'veryhigh'), support, audioBuffer }
   * Returns { addFrame(t), finish() -> {blob, ...}, cancel() }
   */
  E.session = async function (opts) {
    const mb = MB(), sup = opts.support;
    const Q = { medium: mb.QUALITY_MEDIUM, high: mb.QUALITY_HIGH, veryhigh: mb.QUALITY_VERY_HIGH }[opts.quality] || mb.QUALITY_HIGH;
    const format = sup.container === 'webm' ? new mb.WebMOutputFormat() : sup.container === 'mov' ? new mb.MovOutputFormat({ fastStart: 'in-memory' }) : new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new mb.Output({ format, target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(opts.canvas, { codec: sup.video, quality: Q, keyFrameInterval: 2, latencyMode: 'quality' });
    output.addVideoTrack(video, { frameRate: opts.fps });
    let audio = null;
    if (opts.audioBuffer && sup.audio) {
      audio = new mb.AudioBufferSource(sup.audio.startsWith('pcm') ? { codec: sup.audio } : { codec: sup.audio, quality: mb.QUALITY_HIGH });
      output.addAudioTrack(audio);
    }
    await output.start();
    let audioDone = !audio;
    const feedAudio = async () => {
      // feed in ~2 s chunks so long tracks don't need one huge copy
      const buf = opts.audioBuffer, sr = buf.sampleRate, chunk = sr * 2, ch = buf.numberOfChannels;
      for (let s = 0; s < buf.length; s += chunk) {
        if (E.cancelled) return;
        const n = Math.min(chunk, buf.length - s);
        const part = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
        for (let c = 0; c < ch; c++) part.copyToChannel(buf.getChannelData(c).subarray(s, s + n), c);
        await audio.add(part);
      }
      audioDone = true;
    };
    if (audio) await feedAudio(); // whole mix is known up front; video frames follow
    return {
      async addFrame(t, d) { await video.add(t, d); },
      async finish() {
        if (audio && !audioDone) await feedAudio();
        await output.finalize();
        const mime = sup.container === 'webm' ? 'video/webm' : sup.container === 'mov' ? 'video/quicktime' : 'video/mp4';
        return { buffer: output.target.buffer, mime, ext: sup.container };
      },
      async cancel() { try { await output.cancel(); } catch (e) { /* already closed */ } },
    };
  };

  E.makeResult = function (buffer, mime, ext, meta) {
    if (E.lastUrl) URL.revokeObjectURL(E.lastUrl);
    const name = 'xo-lab-' + stamp() + '.' + ext;
    const blob = new Blob([buffer], { type: mime });
    E.lastFile = new File([blob], name, { type: mime });
    E.lastUrl = URL.createObjectURL(blob);
    return Object.assign({ url: E.lastUrl, name, size: blob.size, mime }, meta);
  };

  /* ------------------------------ save / share ------------------------------ */
  E.canShareFile = function () {
    if (isNative()) return true;
    try { return !!(E.lastFile && navigator.canShare && navigator.canShare({ files: [E.lastFile] })); } catch (e) { return false; }
  };
  function b64(bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  /** iPhone app: write the file to the app cache in chunks, then open the share sheet (Save Video → Photos). */
  async function nativeShare(file, onProgress) {
    const P = window.Capacitor.Plugins, FS = P.Filesystem, SH = P.Share;
    if (!FS || !SH) throw new Error('Save plugins are missing from this build.');
    const bytes = new Uint8Array(await file.arrayBuffer()), CHUNK = 3 * 1024 * 1024; // multiple of 3 → clean base64 joins
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const data = b64(bytes.subarray(i, i + CHUNK));
      if (i === 0) await FS.writeFile({ path: file.name, data, directory: 'CACHE' });
      else await FS.appendFile({ path: file.name, data, directory: 'CACHE' });
      if (onProgress) onProgress(Math.min(1, (i + CHUNK) / bytes.length));
    }
    const { uri } = await FS.getUri({ path: file.name, directory: 'CACHE' });
    await SH.share({ title: file.name, files: [uri] });
  }
  /** Save / share any file: iPhone app → share sheet; browsers with file sharing → navigator.share. */
  E.shareFile = async function (file, onProgress) {
    if (isNative()) return nativeShare(file, onProgress);
    return navigator.share({ files: [file], title: file.name });
  };
  E.share = async function (onProgress) {
    if (!E.lastFile) throw new Error('Nothing exported yet.');
    if (isNative()) return nativeShare(E.lastFile, onProgress);
    return navigator.share({ files: [E.lastFile], title: E.lastFile.name });
  };
})();
