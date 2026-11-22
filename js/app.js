/* XO LAB v5 — app wiring, custom widgets, transport, output sizing, export, render loop */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$, $$ = XO.$$, A = XO.audio, M = XO.model, E = XO.exporter, G = XO.gl, ST = XO.strobe, D = XO.detector, S = XO.S, L = XO.look3d;
  const canvas = $('#view'), ctx = canvas.getContext('2d'), stage = $('#stage');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const video = document.createElement('video');
  video.muted = true; video.loop = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(video);
  A.init($('#audio'));
  G.init();

  const V = { kind: null, src: null, w: 0, h: 0, url: '', name: '', ver: 0, file: null };
  XO.state = { V, video };
  const MEDIA = (XO.mediaFiles = { visual: null, model: null, audio: null, bg: null }); // the files in use, so a project can save them
  const OUT = { full: { w: 1920, h: 1080 }, note: '', rendering: false };

  /* =========================== custom widgets =========================== */
  XO.customs.mediaInputs = (el) => {
    el.innerHTML = `
      <div class="upload">
        <label class="tile">＋ VISUAL<small>VIDEO · IMAGE</small><input id="visualInput" type="file" accept="image/*,video/*" data-route="visual" /></label>
        <label class="tile">＋ 3D MODEL<small>GLB OBJ FBX STL…</small><input id="modelInput" type="file" accept=".glb,.gltf,.obj,.mtl,.fbx,.stl,.ply,.dae,.bin,.png,.jpg,.jpeg,.webp,.tga" multiple data-route="model" /></label>
        <label class="tile">＋ AUDIO<small>MP3 · M4A · WAV</small><input id="audioInput" type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" data-route="audio" /></label>
      </div>
      <div class="file-row"><span class="file-k">VISUAL</span><span class="file-v" id="visualFile">None</span><button class="x" id="clearVisual" type="button" aria-label="Remove visual" disabled>✕</button></div>
      <div class="file-row"><span class="file-k">AUDIO</span><span class="file-v" id="audioName">No audio track loaded</span><button class="x" id="clearAudio" type="button" aria-label="Remove audio" disabled>✕</button></div>
      <div class="hint">Video plays muted — add the music as the audio track; it drives the effects and goes into the export.</div>`;
  };
  XO.customs.audioMonitor = (el) => {
    el.innerHTML = `<div class="monitor">${['bass', 'mid', 'high'].map((b) => `<div class="band" data-band="${b}"><span>${b.toUpperCase()}</span><div class="meter"><i></i><b></b></div><em></em></div>`).join('')}
      <div class="bpm-row"><span class="bpm" id="bpmOut">— BPM</span><button class="btn tap" id="tapBtn" type="button">TAP</button></div></div>`;
  };
  XO.customs.bgImage = (el) => {
    el.innerHTML = `<div class="file-row"><label class="btn small-btn">IMAGE…<input type="file" accept="image/*" id="bgInput" hidden /></label><span class="file-v" id="bgName">No background image</span><button class="x" id="clearBg" type="button" aria-label="Remove background image">✕</button></div>`;
  };
  XO.customs.animation = (el) => {
    el.innerHTML = `<select id="animationSelect" aria-label="3D animation" disabled><option>No animated model loaded</option></select>
      <div class="actions" style="margin-top:8px"><button class="btn" id="modelPlay" type="button" disabled>▶ PLAY ANIMATION</button><button class="btn" id="modelReset" type="button" disabled>RESET VIEW</button></div>
      <div class="sub" id="modelInfo" style="margin-top:8px">No model loaded</div>`;
  };
  XO.customs.burst = (el) => { el.innerHTML = `<div class="actions"><button class="btn primary" id="burstBtn" type="button">TRIGGER BURST [B]</button><div class="sub burst-state" id="burstState">IDLE</div></div>`; };
  XO.customs.trackStatus = (el) => { el.innerHTML = '<div class="sub track-status" id="trackStatus">Boxes lock onto the brightest areas of the picture.</div>'; };
  XO.customs.palettes = (el) => {
    el.innerHTML = '<div class="palettes">' + Object.keys(XO.PALETTES).map((n) => { const p = XO.PALETTES[n]; return `<button type="button" class="pal" data-palette="${n}"><i style="background:${p['blob.cBox']}"></i><i style="background:${p['blob.cLabelBg']}"></i><i style="background:${p['strobe.p2']}"></i><span>${n.toUpperCase()}</span></button>`; }).join('') + '</div><div class="hint">Palettes recolour the HUD, 3D, strobe and filter colours in one tap. The background stays pure black.</div>';
  };
  XO.customs.strobePad = (el) => {
    el.innerHTML = `<div class="safety" id="strobeSafety"></div>
      <button class="pad" id="strobePad" type="button">HOLD TO STROBE <small>[S]</small></button>
      <div class="sub" id="strobeRate">0.0 flashes/s</div>`;
  };
  XO.customs.filterStack = (el) => {
    el.innerHTML = `<div class="opt-label">PRESETS</div><div class="preset-row"><select id="fxPreset" aria-label="Filter preset"></select><button class="btn" id="fxSavePreset" type="button">SAVE</button></div>
      <div class="opt-label">ADD FILTER</div><div class="preset-row"><select id="fxAdd" aria-label="Add filter">${XO.FILTER_ORDER.map((t) => `<option value="${t}">${XO.FILTERS[t].name}</option>`).join('')}</select><button class="btn" id="fxAddBtn" type="button">＋ ADD</button></div>
      <div class="fx-list" id="fxList"></div><div class="sub" id="fxStatus"></div>`;
  };
  XO.customs.timeline = (el) => {
    el.innerHTML = `
      <div class="file-row"><span class="file-k">TRACK</span><span class="file-v" id="tlAudio">No audio track — load one in MEDIA</span></div>
      <div class="wave" id="wave" aria-label="Audio trim: drag the handles"><canvas id="waveCanvas" width="600" height="96"></canvas><i class="wh" id="whIn" data-h="in"><b>IN</b></i><i class="wh" id="whOut" data-h="out"><b>OUT</b></i><div class="wave-msg" id="waveMsg">Load an audio track to trim it</div></div>
      <div class="tgrid">
        <label class="tf"><span>AUDIO IN</span><input id="tIn" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <label class="tf"><span>AUDIO OUT</span><input id="tOut" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <label class="tf"><span>CLIP LENGTH</span><output id="tLen">--</output></label>
        <label class="tf"><span>STARTS AT</span><input id="tOffset" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <label class="tf"><span>FADE IN</span><input id="tFadeIn" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <label class="tf"><span>FADE OUT</span><input id="tFadeOut" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
      </div>
      <div id="vTrim" hidden>
        <div class="opt-label">VIDEO SOURCE TRIM</div>
        <div class="tgrid">
          <label class="tf"><span>VIDEO IN</span><input id="tVIn" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
          <label class="tf"><span>VIDEO OUT</span><input id="tVOut" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
          <label class="tf"><span>VIDEO LENGTH</span><output id="tVLen">--</output></label>
        </div>
        <div class="opt-label">WHEN THE VIDEO CLIP ENDS</div>
        <div class="seg" id="vEndSeg"><button type="button" data-value="loop">LOOP</button><button type="button" data-value="hold">HOLD LAST FRAME</button><button type="button" data-value="black">BLACK</button></div>
      </div>
      <div class="sub tl-total" id="tlTotal"></div>
      <div class="hint">Times are m:ss.cc or seconds. Drag IN / OUT on the waveform. "Starts at" delays the music in the video.</div>`;
  };
  XO.customs.renderBox = (el) => {
    el.innerHTML = `<div class="export-info" id="exportInfo">Checking encoder…</div>
      <div class="actions"><button class="btn" id="previewRange" type="button">▶ PREVIEW SELECTION</button><button class="btn primary" id="renderBtn" type="button">RENDER &amp; EXPORT</button></div>
      <div class="render-box" id="renderProg" hidden>
        <div class="progress"><i id="progressBar"></i></div>
        <div class="sub" id="renderStat">Preparing…</div>
        <button class="btn" id="renderCancel" type="button">CANCEL RENDER</button>
      </div>
      <div class="export-result" id="exportResult" hidden><div class="sub" id="exportSummary"></div><div class="actions"><a class="btn" id="downloadLink" href="#" download>DOWNLOAD</a><button class="btn primary" id="shareBtn" type="button" hidden>SAVE / SHARE</button></div></div>
      <div class="actions" style="margin-top:18px"><button class="btn" id="resetAll" type="button">RESET ALL SETTINGS</button></div>
      <div class="hint">Render builds the video frame by frame at full size and frame rate — it doesn't play in real time, so it never drops frames, even on a slow phone. Keep XO LAB open until it finishes.</div>`;
  };
  XO.customs.motionPresets = (el) => {
    el.innerHTML = '<div class="opt-label">MOTION PRESETS</div><div class="preset-pills">' + Object.keys(L.MOTION_PRESETS).map((n) => `<button type="button" class="btn mp" data-motion="${n}">${n}</button>`).join('') + '</div>';
  };
  XO.customs.scenes = (el) => {
    el.innerHTML = `<div class="preset-row"><button class="btn" id="sceneSave" type="button">＋ SAVE SCENE</button><button class="btn" id="sceneExport" type="button">EXPORT JSON</button><button class="btn" id="sceneImportBtn" type="button">IMPORT</button></div>
      <div class="scene-list" id="sceneList"></div><div class="hint">Keys 1–9 recall scenes 1–9. Scenes are stored in this browser.</div>`;
  };

  XO.SCHEMA.find((p) => p.id === 'fx').extraReset = ['fx.stack'];
  XO.buildPanels();
  // iOS greys out files whose type it doesn't know (.glb, .fbx, .obj …) when an accept list is set
  if (isIOS) { const mi = $('#modelInput'); if (mi) mi.removeAttribute('accept'); }

  /* =========================== no page zoom (pinch / double-tap) =========================== */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false }); // trackpad pinch on desktop

  /* =========================== screen wake lock =========================== */
  let wakeLock = null, wakeWanted = false;
  XO.wake = async function (on) {
    wakeWanted = on;
    if (window.xoDesktop) { window.xoDesktop.setAwake(on); return; }
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wakeWanted) XO.wake(true); });

  /* =========================== tabs =========================== */
  XO.showTab = function (name) {
    $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    $('#panels').scrollTop = 0;
  };
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) XO.showTab(b.dataset.tab); });
  $$('#tabbar button').forEach((b, i) => b.classList.toggle('on', i === 0));
  $$('.panel').forEach((p, i) => p.classList.toggle('active', i === 0));

  /* =========================== splash =========================== */
  function enter() { A.ensureContext(); $('#splash').classList.add('gone'); setTimeout(() => $('#splash') && $('#splash').remove(), 400); }
  $('#enter').addEventListener('click', enter);

  /* =========================== file routing =========================== */
  function routeFiles(fileList, hint) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    A.ensureContext();
    const kinds = files.map((f) => [f, XO.classify(f)]);
    const hasModel = kinds.some(([, k]) => k === 'model');
    if (hint === 'model' || hasModel) {
      if (!hasModel) { XO.toast('Choose a 3D file: GLB, glTF, OBJ, FBX, STL, PLY or DAE.', true); return; }
      setModel(kinds.filter(([, k]) => k === 'model' || k === 'model-part' || k === 'image').map(([f]) => f));
      const au = kinds.find(([, k]) => k === 'audio'); if (au) setAudio(au[0]);
      return;
    }
    const vis = kinds.find(([, k]) => k === 'image' || k === 'video'), aud = kinds.find(([, k]) => k === 'audio');
    if (hint === 'visual' && !vis) { XO.toast('That file isn\'t an image or video.', true); return; }
    if (hint === 'audio' && !aud) { XO.toast('That file isn\'t an audio track.', true); return; }
    if (vis && hint !== 'audio') (vis[1] === 'video' ? setVideo : setImage)(vis[0]);
    if (aud && hint !== 'visual') setAudio(aud[0]);
    if (!vis && !aud) XO.toast('Unsupported file type: ' + files[0].name, true);
  }
  document.addEventListener('change', (e) => { const inp = e.target; if (inp.matches && inp.matches('input[type=file][data-route]')) { routeFiles(inp.files, inp.dataset.route); inp.value = ''; } });
  ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) stage.classList.remove('dragover'); }));
  window.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('dragover'); if (e.dataTransfer && e.dataTransfer.files.length) routeFiles(e.dataTransfer.files); });

  /* live camera: a hidden <video> fed by getUserMedia; mirrored through a small canvas when asked */
  const cam = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
  cam.setAttribute('playsinline', ''); cam.setAttribute('muted', '');
  cam.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(cam);
  const camFlip = document.createElement('canvas'), camFlipCtx = camFlip.getContext('2d');
  XO.cam = { el: cam, stream: null, label: '', facing: '' };
  function camFrame() {
    if (!cam.videoWidth) return null;
    if (!S.media.camMirror) return cam;
    if (camFlip.width !== cam.videoWidth || camFlip.height !== cam.videoHeight) { camFlip.width = cam.videoWidth; camFlip.height = cam.videoHeight; }
    camFlipCtx.setTransform(-1, 0, 0, 1, camFlip.width, 0); camFlipCtx.drawImage(cam, 0, 0); camFlipCtx.setTransform(1, 0, 0, 1, 0, 0);
    return camFlip;
  }
  async function setCamera(stream, label) {
    releaseVisual();
    MEDIA.visual = null; MEDIA.model = null;
    XO.cam.stream = stream; XO.cam.label = label || 'Camera';
    cam.srcObject = stream;
    await cam.play().catch(() => {});
    if (!cam.videoWidth) await new Promise((r) => { const t = setTimeout(r, 4000); cam.addEventListener('loadedmetadata', () => { clearTimeout(t); r(); }, { once: true }); });
    Object.assign(V, { kind: 'camera', src: cam, w: cam.videoWidth || 1280, h: cam.videoHeight || 720, url: '', name: XO.cam.label, file: null }); V.ver++;
    $('#duration').textContent = 'LIVE CAMERA'; $('#timecode').textContent = V.w + '×' + V.h;
    visualLoaded('camera', XO.cam.label);
    const tr = stream.getVideoTracks()[0];
    if (tr) tr.addEventListener('ended', () => { if (V.kind === 'camera') { releaseVisual(); $('#empty').hidden = false; $('#visualFile').textContent = 'None'; $('#visualName').textContent = ''; $('#clearVisual').disabled = true; if (XO.onCameraChange) XO.onCameraChange(); } });
    return true;
  }
  function releaseVisual() {
    if (V.kind === 'camera') { if (XO.cam.stream) XO.cam.stream.getTracks().forEach((t) => t.stop()); cam.srcObject = null; XO.cam.stream = null; if (XO.onCameraChange) setTimeout(XO.onCameraChange, 0); }
    video.pause(); video.removeAttribute('src'); video.load();
    if (V.url) URL.revokeObjectURL(V.url);
    if (V.kind === 'model') M.unload();
    Object.assign(V, { kind: null, src: null, w: 0, h: 0, url: '', name: '', file: null }); V.ver++;
    D.reset(); G.resetSource();
    stage.classList.remove('model-mode'); modelControls(false);
  }
  function visualLoaded(kind, name) {
    $('#empty').hidden = true;
    $('#visualName').textContent = name; $('#visualFile').textContent = name; $('#clearVisual').disabled = false;
    $('#modeTag').textContent = kind === 'camera' ? 'LIVE CAMERA ' + V.w + '×' + V.h : kind === 'video' ? 'VIDEO ' + V.w + '×' + V.h : kind === 'image' ? 'IMAGE ' + V.w + '×' + V.h : '3D ' + (M.format || '').toUpperCase();
    updateTimelineEnabled(); applyOutputSize();
  }
  function setImage(file) { return new Promise((done) => {
    releaseVisual();
    MEDIA.visual = file; MEDIA.model = null;
    XO.loading(true, 'LOADING IMAGE');
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const lim = S.media.imgMax === 'original' ? Infinity : +S.media.imgMax;
      const cap = Math.min(lim, G.maxSize || 4096);
      const sc = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
      let src = img;
      if (sc < 1) { src = document.createElement('canvas'); src.width = Math.round(img.naturalWidth * sc); src.height = Math.round(img.naturalHeight * sc); src.getContext('2d').drawImage(img, 0, 0, src.width, src.height); }
      Object.assign(V, { kind: 'image', src, w: src.width || src.naturalWidth, h: src.height || src.naturalHeight, url, name: file.name, file }); V.ver++;
      XO.loading(false); $('#duration').textContent = 'IMAGE'; $('#timecode').textContent = img.naturalWidth + '×' + img.naturalHeight;
      if (sc < 1) XO.toast('Image scaled from ' + img.naturalWidth + '×' + img.naturalHeight + ' to ' + V.w + '×' + V.h + ' (image size limit).');
      visualLoaded('image', file.name); done(true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); XO.loading(false); MEDIA.visual = null; XO.toast('This image format isn\'t supported by this browser' + (/\.(heic|heif)$/i.test(file.name) ? ' (HEIC opens in Safari — or convert to JPG/PNG)' : '') + '.', true); done(false); };
    img.src = url;
  }); }
  function setVideo(file) { return new Promise((done) => {
    releaseVisual();
    MEDIA.visual = file; MEDIA.model = null;
    XO.loading(true, 'LOADING VIDEO');
    const url = URL.createObjectURL(file); V.url = url; V.name = file.name;
    const onReady = () => {
      cleanup();
      Object.assign(V, { kind: 'video', src: video, w: video.videoWidth, h: video.videoHeight, file }); V.ver++;
      S.out.vIn = 0; S.out.vOut = 0; syncTimeline();
      XO.loading(false); $('#duration').textContent = XO.fmtTime(video.duration);
      visualLoaded('video', file.name);
      if (anyPlaying() || A.isPlaying()) video.play().catch(() => {});
      done(true);
    };
    const onErr = () => { cleanup(); XO.loading(false); URL.revokeObjectURL(url); V.url = ''; MEDIA.visual = null; XO.toast('This video can\'t be decoded by this browser (try H.264 MP4). File: ' + file.name, true); done(false); };
    const cleanup = () => { video.removeEventListener('loadeddata', onReady); video.removeEventListener('error', onErr); };
    video.addEventListener('loadeddata', onReady); video.addEventListener('error', onErr);
    video.src = url; video.load();
  }); }
  async function setModel(files) {
    XO.loading(true, 'LOADING 3D'); $('#modeTag').textContent = 'LOADING 3D';
    try {
      if (V.kind && V.kind !== 'model') releaseVisual();
      const info = await M.load(files);
      MEDIA.model = files.slice(); MEDIA.visual = null;
      D.reset(); G.resetSource();
      Object.assign(V, { kind: 'model', src: null, w: 0, h: 0, url: '', name: info.name }); V.ver++;
      const sel = $('#animationSelect'); sel.innerHTML = '';
      if (info.clips.length) info.clips.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.append(o); });
      else sel.innerHTML = '<option>No animation clips in this model</option>';
      if (info.clips.length) M.selectClip(0);
      modelControls(true); stage.classList.add('model-mode');
      $('#modelInfo').textContent = info.format.toUpperCase() + ' · ' + (info.clips.length ? info.clips.length + ' clip' + (info.clips.length > 1 ? 's' : '') : 'no animation');
      $('#timecode').textContent = info.clips.length ? info.clips.length + ' CLIP' + (info.clips.length > 1 ? 'S' : '') : 'STATIC MODEL';
      $('#duration').textContent = '3D';
      visualLoaded('model', info.name);
      if (info.clips.length && A.isPlaying()) M.playAnim();
      setModelPlayLabel();
      if (info.warnings.length) XO.toast('Model loaded, but these files were missing: ' + info.warnings.slice(0, 4).join(', ') + '. Select them together with the model.', true, 9000);
      if (window.matchMedia('(max-width: 899px)').matches && !XO.restoring) XO.showTab('model');
      return true;
    } catch (err) {
      console.warn('[XO LAB] model not loaded:', err.message);
      $('#modeTag').textContent = V.kind === 'model' ? '3D' : V.kind ? V.kind.toUpperCase() : '3D UNAVAILABLE';
      XO.toast(err.message || 'Could not load this model.', true, 9000);
      return false;
    } finally { XO.loading(false); }
  }
  document.addEventListener('click', (e) => {
    if (e.target.id === 'clearVisual') {
      releaseVisual(); MEDIA.visual = null; MEDIA.model = null; $('#empty').hidden = false;
      $('#visualName').textContent = 'No visual loaded'; $('#visualFile').textContent = 'None'; $('#timecode').textContent = '00:00.00'; $('#duration').textContent = '--:--';
      $('#modeTag').textContent = 'LIVE PREVIEW'; $('#clearVisual').disabled = true; updateTimelineEnabled(); applyOutputSize();
    } else if (e.target.id === 'clearAudio') {
      A.unload(); MEDIA.audio = null; $('#audioName').textContent = 'No audio track loaded'; $('#clearAudio').disabled = true; $('#audioTag').textContent = 'AUDIO OFF'; updateTimelineEnabled(); updateExportInfo();
    } else if (e.target.id === 'clearBg') { G.setBgImage(null); MEDIA.bg = null; $('#bgName').textContent = 'No background image'; }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'bgInput' || !e.target.files[0]) return;
    setBgFile(e.target.files[0]); e.target.value = '';
  });
  function setBgFile(f) { return new Promise((done) => {
    const img = new Image();
    img.onload = () => { G.setBgImage(img); MEDIA.bg = f; $('#bgName').textContent = f.name; done(true); };
    img.onerror = () => { XO.toast('That background image can\'t be opened.', true); done(false); };
    img.src = URL.createObjectURL(f);
  }); }

  /* =========================== audio =========================== */
  async function setAudio(file) {
    $('#audioName').textContent = 'Loading ' + file.name + '…';
    try {
      const wasPlaying = anyPlaying();
      const dur = await A.load(file); A.ensureContext(); A.setVolume(S.media.volume / 100);
      MEDIA.audio = file;
      $('#audioName').textContent = file.name + (isFinite(dur) ? ' · ' + XO.fmtTime(dur) : '');
      $('#clearAudio').disabled = false; $('#audioTag').textContent = 'AUDIO READY';
      if (wasPlaying) A.play();
      S.out.aIn = 0; S.out.aOut = 0;
      updateTimelineEnabled(); updateExportInfo(); syncTimeline(); if (!XO.restoring) XO.toast('Track loaded — press ▶ to play.');
      decodeForTimeline(file);
      return true;
    } catch (err) { $('#audioName').textContent = 'No audio track loaded'; $('#audioTag').textContent = 'AUDIO OFF'; XO.toast(err.message + ' (' + file.name + ')', true); return false; }
  }
  A.el.addEventListener('play', () => { $('#audioTag').textContent = 'AUDIO PLAYING'; });
  A.el.addEventListener('pause', () => { if (A.loaded) $('#audioTag').textContent = 'AUDIO PAUSED'; });
  $('#tapBtn').addEventListener('click', () => { const b = A.tap(performance.now()); if (S.audio.bpmMode !== 'tap') { S.audio.bpmMode = 'tap'; XO.syncKey('audio.bpmMode'); XO.evalShow(); } if (b) XO.toast('Tap tempo: ' + b + ' BPM'); });

  /* =========================== transport =========================== */
  function anyPlaying() { return (V.kind === 'video' && !video.paused) || A.isPlaying() || V.kind === 'camera' || (V.kind === 'model' && M.animPlaying); }
  async function playAll() {
    if (!V.kind && !A.loaded) { XO.toast('Load a visual or an audio track first.'); return; }
    const c = A.ensureContext(), jobs = [];
    if (V.kind === 'video') jobs.push(video.play().catch(() => {}));
    if (A.loaded) jobs.push(A.play().then((ok) => { if (!ok) XO.toast('Tap ▶ again to start audio (browser blocked playback).', true); }));
    if (V.kind === 'model') { M.playAnim(); setModelPlayLabel(); }
    await Promise.all(jobs);
    if (c && c.state !== 'running' && A.loaded) $('#audioTag').textContent = 'AUDIO LOCKED · TAP ▶';
  }
  function pauseAll() { clearTimeout(previewTimer); previewTimer = 0; video.pause(); A.pause(); if (V.kind === 'model') { M.pauseAnim(); setModelPlayLabel(); } }
  let previewTimer = 0;
  function togglePlay() { if (anyPlaying()) pauseAll(); else playAll(); }
  $('#play').addEventListener('click', togglePlay);
  function masterMedia() { return V.kind === 'video' ? video : A.loaded ? A.el : null; }
  function updateTimelineEnabled() { $('#seek').disabled = !masterMedia(); }
  $('#seek').addEventListener('input', (e) => { const m = masterMedia(); if (m && isFinite(m.duration)) m.currentTime = (m.duration * e.target.value) / 1000; XO.paintRange(e.target); });

  /* =========================== 3D controls =========================== */
  function modelControls(loaded) {
    const has = loaded && M.clips.length > 0;
    $('#modelPlay').disabled = !has; $('#animationSelect').disabled = !has; $('#modelReset').disabled = !loaded;
    if (!loaded) { $('#animationSelect').innerHTML = '<option>No animated model loaded</option>'; $('#modelPlay').textContent = '▶ PLAY ANIMATION'; $('#modelInfo').textContent = 'No model loaded'; }
  }
  function setModelPlayLabel() { $('#modelPlay').textContent = !M.clips.length ? 'NO ANIMATION CLIPS' : M.animPlaying ? 'Ⅱ PAUSE ANIMATION' : '▶ PLAY ANIMATION'; }
  $('#modelPlay').addEventListener('click', () => { if (M.animPlaying) M.pauseAnim(); else M.playAnim(); setModelPlayLabel(); });
  $('#animationSelect').addEventListener('change', (e) => M.selectClip(+e.target.value));
  $('#modelReset').addEventListener('click', () => M.resetView());
  $('#burstBtn').addEventListener('click', () => { if (!M.loaded) { XO.toast('Load a 3D model first.'); return; } if (!M.triggerBurst(performance.now())) XO.toast('Burst already running.'); });

  const pointers = new Map(); let pinchDist = 0, lastTap = { t: 0, x: 0, y: 0 }, lastMove = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (V.kind === 'model') {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId);
      M.dragging = true; L.stopInertia();
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
      const now = performance.now();
      if (pointers.size === 1 && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) { M.resetView(); lastTap.t = 0; XO.toast('3D view reset.'); }
      else lastTap = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    if (S.dof.on && !S.dof.follow) { canvas.setPointerCapture(e.pointerId); setFocusFromEvent(e); canvas._focusDrag = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (canvas._focusDrag) { setFocusFromEvent(e); return; }
    if (!pointers.has(e.pointerId) || V.kind !== 'model') return;
    const p = pointers.get(e.pointerId);
    if (pointers.size === 1) { M.rotate(e.clientX - p.x, e.clientY - p.y); lastMove = performance.now(); }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchDist) M.zoomBy(d / pinchDist); pinchDist = d; L.stopInertia(); }
  });
  const endPointer = (e) => {
    const wasPinch = pointers.size > 1;
    pointers.delete(e.pointerId); pinchDist = 0; canvas._focusDrag = false;
    if (!pointers.size) { M.dragging = false; if (wasPinch || performance.now() - lastMove > 90) L.stopInertia(); }
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { if (V.kind !== 'model') return; e.preventDefault(); M.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function setFocusFromEvent(e) {
    // map from the letterboxed canvas element to canvas pixels (object-fit: contain)
    const r = canvas.getBoundingClientRect(), ar = canvas.width / canvas.height, er = r.width / r.height;
    let w = r.width, h = r.height, ox = 0, oy = 0;
    if (er > ar) { w = h * ar; ox = (r.width - w) / 2; } else { h = w / ar; oy = (r.height - h) / 2; }
    S.dof.fx = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - ox) / w)) * 100);
    S.dof.fy = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top - oy) / h)) * 100);
    XO.syncKey('dof.fx'); XO.syncKey('dof.fy');
  }

  /* =========================== filter stack =========================== */
  function presetOptions() {
    const user = XO.userFxPresets.list();
    $('#fxPreset').innerHTML = '<option value="">Choose a preset…</option>' + Object.keys(XO.FX_PRESETS).map((n) => `<option value="b:${esc(n)}">${esc(n)}</option>`).join('') + (user.length ? '<optgroup label="Saved">' + user.map((p) => `<option value="u:${esc(p.name)}">${esc(p.name)}</option>`).join('') + '</optgroup>' : '') + '<option value="clear">— Clear all filters —</option>';
  }
  function renderFxList() {
    const list = $('#fxList');
    if (!S.fx.stack.length) { list.innerHTML = '<div class="hint">No filters yet. Pick a preset or add filters; they apply top to bottom.</div>'; return; }
    list.innerHTML = S.fx.stack.map((f, i) => {
      const def = XO.FILTERS[f.type];
      const params = def.params.map((p) => p.seg
        ? `<div class="opt-label">${esc(p.label.toUpperCase())}</div><div class="seg fseg" data-f="${f.id}" data-fp="${p.k}">${p.seg.map((o) => `<button type="button" data-value="${o[0]}" class="${String(f.params[p.k]) === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`
        : `<div class="control"><div class="control-head">${esc(p.label)} <output>${f.params[p.k]}${p.fmt === '%' ? '%' : p.fmt ? ' ' + p.fmt : ''}</output></div><input class="range" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${f.params[p.k]}" data-f="${f.id}" data-fp="${p.k}"></div>`).join('');
      const colors = (def.colors || []).map((k) => `<div class="color-row"><span class="color-label">${esc(k.split('.')[1])}</span><input type="color" data-k="${k}" value="${XO.get(k)}"><input class="hex" data-hex="${k}" maxlength="7" value="${XO.get(k)}"><span class="swatches" data-sw="${k}"></span></div>`).join('');
      return `<div class="fx-item${f.on ? '' : ' off'}${f.solo ? ' solo' : ''}" data-fid="${f.id}">
        <div class="fx-head"><label class="toggle compact"><input type="checkbox" data-f="${f.id}" data-fa="on" ${f.on ? 'checked' : ''}><i></i></label><b>${i + 1}. ${esc(def.name)}</b>
          <button class="mini${f.solo ? ' on' : ''}" type="button" data-f="${f.id}" data-fa="solo">SOLO</button><button class="mini" type="button" data-f="${f.id}" data-fa="up" aria-label="Move up">▲</button><button class="mini" type="button" data-f="${f.id}" data-fa="down" aria-label="Move down">▼</button><button class="mini" type="button" data-f="${f.id}" data-fa="del" aria-label="Remove">✕</button></div>
        <div class="fx-body">
          <div class="control"><div class="control-head">Intensity <output>${f.intensity}%</output></div><input class="range" type="range" min="0" max="100" step="1" value="${f.intensity}" data-f="${f.id}" data-fp="intensity"></div>
          ${params}${colors}
          <div class="fx-audio"><div class="control"><div class="control-head">Reacts to</div><select data-f="${f.id}" data-fp="band">${[['off', 'OFF'], ['bass', 'BASS'], ['mid', 'MID'], ['high', 'HIGH'], ['full', 'FULL'], ['custom', 'CUSTOM']].map((o) => `<option value="${o[0]}" ${f.band === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
          <div class="control"><div class="control-head">Audio amount <output>${f.amt}%</output></div><input class="range" type="range" min="0" max="100" step="1" value="${f.amt}" data-f="${f.id}" data-fp="amt"></div></div>
        </div></div>`;
    }).join('');
    XO.paintAllRanges();
  }
  XO.renderFxList = renderFxList;
  const fxById = (id) => S.fx.stack.find((f) => f.id === id);
  $('#fxList').addEventListener('input', (e) => {
    const el = e.target, f = el.dataset.f && fxById(el.dataset.f); if (!f || !el.dataset.fp) return;
    const k = el.dataset.fp, v = +el.value;
    if (k === 'intensity' || k === 'amt') f[k] = v; else f.params[k] = v;
    const out = el.parentElement.querySelector('output'); if (out) { const pd = XO.FILTERS[f.type].params.find((p) => p.k === k); out.textContent = v + (k === 'intensity' || k === 'amt' || (pd && pd.fmt === '%') ? '%' : pd && pd.fmt ? ' ' + pd.fmt : ''); }
    XO.paintRange(el);
  });
  $('#fxList').addEventListener('change', (e) => {
    const el = e.target, f = el.dataset.f && fxById(el.dataset.f); if (!f) return;
    if (el.dataset.fa === 'on') { f.on = el.checked; el.closest('.fx-item').classList.toggle('off', !f.on); }
    else if (el.dataset.fp === 'band') f.band = el.value;
  });
  $('#fxList').addEventListener('click', (e) => {
    const sb = e.target.closest('.fseg button[data-value]');
    if (sb) { const seg = sb.parentElement, f = fxById(seg.dataset.f); f.params[seg.dataset.fp] = sb.dataset.value; XO.setSeg(seg, sb.dataset.value); return; }
    const b = e.target.closest('button[data-fa]'); if (!b) return;
    const i = S.fx.stack.findIndex((f) => f.id === b.dataset.f); if (i < 0) return;
    const a = b.dataset.fa, st = S.fx.stack;
    if (a === 'solo') { const was = st[i].solo; st.forEach((f) => { f.solo = false; }); st[i].solo = !was; }
    else if (a === 'up' && i > 0) [st[i - 1], st[i]] = [st[i], st[i - 1]];
    else if (a === 'down' && i < st.length - 1) [st[i + 1], st[i]] = [st[i], st[i + 1]];
    else if (a === 'del') st.splice(i, 1);
    renderFxList();
  });
  $('#fxAddBtn').addEventListener('click', () => { S.fx.stack.push(XO.makeFilter($('#fxAdd').value)); renderFxList(); });
  $('#fxPreset').addEventListener('change', (e) => {
    const v = e.target.value; if (!v) return;
    if (v === 'clear') S.fx.stack = [];
    else if (v.startsWith('b:')) S.fx.stack = XO.FX_PRESETS[v.slice(2)].map((p) => XO.makeFilter(p.type, p));
    else { const p = XO.userFxPresets.list().find((x) => x.name === v.slice(2)); if (p) S.fx.stack = p.stack.map((f) => XO.makeFilter(f.type, f)); }
    renderFxList(); e.target.value = '';
  });
  $('#fxSavePreset').addEventListener('click', async () => {
    if (!S.fx.stack.length) { XO.toast('Add some filters first.'); return; }
    const n = await XO.prompt('Save filter preset as', 'MY PRESET'); if (!n) return;
    XO.userFxPresets.save(n, S.fx.stack); presetOptions(); XO.toast('Preset saved: ' + n);
  });
  presetOptions(); renderFxList();

  /* =========================== palettes =========================== */
  document.addEventListener('click', (e) => { const p = e.target.closest('[data-palette]'); if (!p) return; XO.applyPalette(p.dataset.palette); XO.syncUI(); renderFxList(); XO.toast(p.dataset.palette + ' palette applied.'); });

  /* =========================== strobe =========================== */
  function strobeSafetyUI() {
    const s = S.strobe;
    $('#strobeSafety').innerHTML = s.unlocked
      ? `<b>FAST STROBE UNLOCKED</b> · up to ${ST.MAX_HZ} flashes/s <button class="mini" type="button" id="strobeLock">LOCK TO 3/s</button>`
      : `<b>PHOTOSENSITIVITY SAFE</b> · max ${ST.SAFE_HZ} flashes/s <button class="mini" type="button" id="strobeUnlock">UNLOCK FASTER</button>`;
  }
  async function strobeWarn() {
    if (S.strobe.acknowledged) return true;
    const ok = await XO.confirm('Flashing lights warning', 'Strobe effects can trigger seizures in people with photosensitive epilepsy. Strobe is limited to 3 flashes per second unless you unlock faster rates. Continue?', 'I UNDERSTAND');
    if (ok) S.strobe.acknowledged = true;
    return ok;
  }
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'strobeUnlock') {
      const ok = await XO.confirm('Unlock fast strobe?', 'Allows up to 15 flashes per second. Flashing above 3 per second is a known seizure risk — don\'t use it where people with photosensitive epilepsy may watch.', 'UNLOCK');
      if (ok) { S.strobe.unlocked = true; S.strobe.acknowledged = true; strobeSafetyUI(); }
    } else if (e.target.id === 'strobeLock') { S.strobe.unlocked = false; strobeSafetyUI(); }
  });
  const pad = $('#strobePad');
  const holdOn = async (e) => { e.preventDefault(); if (!(await strobeWarn())) return; ST.held = true; pad.classList.add('on'); };
  const holdOff = () => { ST.held = false; pad.classList.remove('on'); };
  XO.strobeHold = async (on) => { if (on) { if (!(await strobeWarn())) return false; ST.held = true; pad.classList.add('on'); } else { ST.held = false; pad.classList.remove('on'); } return true; };
  pad.addEventListener('pointerdown', holdOn); pad.addEventListener('pointerup', holdOff); pad.addEventListener('pointerleave', holdOff); pad.addEventListener('pointercancel', holdOff);
  strobeSafetyUI();

  /* =========================== scenes =========================== */
  function renderScenes() {
    const l = XO.scenes.list();
    $('#sceneList').innerHTML = l.length ? l.map((s, i) => `<div class="scene" data-scene="${esc(s.name)}"><span class="scene-n">${i < 9 ? i + 1 : '·'}</span><b>${esc(s.name)}</b><button class="mini" type="button" data-sa="load">LOAD</button><button class="mini" type="button" data-sa="ren">RENAME</button><button class="mini" type="button" data-sa="dup">DUP</button><button class="mini" type="button" data-sa="del">✕</button></div>`).join('') : '<div class="hint">No scenes saved yet.</div>';
  }
  function afterLoadState() { XO.syncUI(); renderFxList(); strobeSafetyUI(); D.reset(); applyOutputSize(); A.setVolume(S.media.volume / 100); }
  XO.afterLoadState = afterLoadState; XO.renderScenes = renderScenes;
  XO.loadScene = (name) => { if (XO.scenes.load(name)) { afterLoadState(); XO.toast('Scene loaded: ' + name); return true; } return false; };
  $('#sceneSave').addEventListener('click', async () => { const n = await XO.prompt('Scene name', 'SCENE ' + (XO.scenes.list().length + 1)); if (!n) return; if (XO.scenes.save(n)) { renderScenes(); XO.toast('Scene saved: ' + n); } else XO.toast('Could not save — browser storage is unavailable.', true); });
  $('#sceneList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sa]'); if (!b) return;
    const name = b.closest('[data-scene]').dataset.scene, a = b.dataset.sa;
    if (a === 'load') XO.loadScene(name);
    else if (a === 'del') { if (await XO.confirm('Delete scene?', name, 'DELETE')) { XO.scenes.remove(name); renderScenes(); } }
    else if (a === 'dup') { XO.scenes.duplicate(name); renderScenes(); }
    else if (a === 'ren') { const n = await XO.prompt('Rename scene', name); if (n && n !== name) { if (!XO.scenes.rename(name, n)) XO.toast('That name is taken.', true); renderScenes(); } }
  });
  $('#sceneExport').addEventListener('click', () => {
    const blob = new Blob([XO.scenes.exportJSON()], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'xo-lab-scenes.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('#sceneImportBtn').addEventListener('click', () => $('#sceneImport').click());
  $('#sceneImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = XO.scenes.importJSON(await f.text()); renderScenes(); XO.toast(n + ' scene(s) imported.'); } catch (err) { XO.toast('Import failed: ' + err.message, true); }
    e.target.value = '';
  });
  renderScenes();

  $('#resetAll').addEventListener('click', async () => {
    if (!(await XO.confirm('Reset everything?', 'All effect, colour, strobe and output settings go back to defaults. Saved scenes are kept.', 'RESET ALL'))) return;
    XO.resetAll(); afterLoadState(); XO.toast('All settings reset.');
  });

  /* =========================== settings hooks =========================== */
  XO.onSetting = function (k, v) {
    if (k.startsWith('out.')) { applyOutputSize(); syncTimeline(); }
    else if (k === 'blob.detect' || k === 'blob.detectOn') { D.reset(); }
    else if (k === 'media.volume') A.setVolume(v / 100);
    else if (k === 'audio.liveGain') A.setLiveGain(v);
    else if (k === 'media.imgMax' && V.kind === 'image' && V.file) setImage(V.file);
    else if (k === 'strobe.on' && v) { strobeWarn().then((ok) => { if (!ok) { S.strobe.on = false; XO.syncKey('strobe.on'); } }); }
    else if (k === 'strobe.hz') { if (v > ST.maxHz()) { S.strobe.hz = ST.maxHz(); XO.syncKey('strobe.hz'); XO.toast('Capped at ' + ST.maxHz() + ' flashes/s — unlock faster rates in the strobe panel.'); } }
    else if (k === 'dof.on' || k === 'dof.follow') $('#focusMark').hidden = !(S.dof.on);
  };
  XO.onReset = (pid) => { if (pid === 'fx') { S.fx.stack = []; renderFxList(); } if (pid === 'output') applyOutputSize(); if (pid === 'strobe') strobeSafetyUI(); };

  /* =========================== output size =========================== */
  const even = (n) => Math.max(16, Math.round(n / 2) * 2);
  function byShort(s, aw, ah) { return aw >= ah ? { w: s * aw / ah, h: s } : { w: s, h: s * ah / aw }; }
  function targetSize() {
    const o = S.out;
    let sw = V.w, sh = V.h; if (!sw || !sh || V.kind === 'model') { sw = 1920; sh = 1080; }
    const [aw, ah] = o.aspect === 'source' ? [sw, sh] : o.aspect.split(':').map(Number);
    let w, h;
    if (o.size === 'custom') { w = o.customW; h = o.customH; }
    else if (o.size === 'source') { if (o.aspect === 'source') { w = sw; h = sh; } else ({ w, h } = byShort(Math.min(sw, sh), aw, ah)); }
    else ({ w, h } = byShort(+o.size, aw, ah));
    let note = '';
    const req = [Math.round(w), Math.round(h)];
    const maxSide = G.maxSize || 4096, maxArea = isIOS ? 16777216 : 4096 * 4096 * 2;
    let sc = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxArea / (w * h)));
    if (sc < 1) { w *= sc; h *= sc; note = `Requested ${req[0]}×${req[1]} is above this device's limit (${isIOS ? 'iOS canvas memory cap' : 'max ' + maxSide + ' px per side'}) — using ${even(w)}×${even(h)}.`; }
    return { w: even(w), h: even(h), note };
  }
  function applyOutputSize() {
    if (OUT.rendering) return;
    const t = targetSize(); OUT.full = { w: t.w, h: t.h }; OUT.note = t.note;
    const q = +S.out.quality / 100;
    const w = even(t.w * q), h = even(t.h * q);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; D.reset(); }
    document.documentElement.style.setProperty('--ar', (t.w / t.h).toFixed(4));
    if (XO.syncTimeline) syncTimeline(); else updateExportInfo();
  }
  XO.applyOutputSize = applyOutputSize;

  /* =========================== timeline (trim) =========================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function fmtT(sec) { if (!isFinite(sec) || sec < 0) sec = 0; const m = Math.floor(sec / 60), s2 = sec - m * 60; return m + ':' + (s2 < 10 ? '0' : '') + s2.toFixed(2); }
  function parseT(str) {
    str = String(str || '').trim().replace(',', '.'); if (!str) return NaN;
    if (str.includes(':')) { const [m, sec] = str.split(':'); return (+m || 0) * 60 + (+sec || 0); }
    return +str;
  }
  function audioDur() { return A.decoded ? A.decoded.duration : A.el && isFinite(A.el.duration) ? A.el.duration : 0; }
  function exportPlan() {
    const o = S.out, hasA = !!A.loaded, aDur = audioDur();
    const aIn = clamp(o.aIn || 0, 0, Math.max(0, aDur - 0.1));
    const aOut = o.aOut > 0 ? clamp(o.aOut, aIn + 0.1, aDur || aIn + 0.1) : aDur;
    const clip = hasA ? Math.max(0, aOut - aIn) : 0;
    const offset = hasA ? Math.max(0, o.aOffset || 0) : 0;
    let total = !hasA || o.durMode === 'custom' ? +o.dur : offset + clip;
    total = clamp(total || 0, 0.5, 3600);
    const vDur = V.kind === 'video' && isFinite(video.duration) ? video.duration : 0;
    const vIn = clamp(o.vIn || 0, 0, Math.max(0, vDur - 0.05));
    const vOut = o.vOut > 0 ? clamp(o.vOut, vIn + 0.05, vDur || vIn + 0.05) : vDur;
    return { hasA, aDur, aIn, aOut, clip, offset, total, fadeIn: Math.max(0, o.fadeIn || 0), fadeOut: Math.max(0, o.fadeOut || 0), vol: o.aVol / 100, loop: o.durMode === 'custom' && o.extend === 'loop', fps: +o.fps, vDur, vIn, vOut };
  }
  function audioTimeAt(plan, t) {
    if (!plan.hasA) return null;
    let rel = t - plan.offset; if (rel < 0) return null;
    if (rel >= plan.clip) { if (!plan.loop || plan.clip <= 0) return null; rel %= plan.clip; }
    return plan.aIn + rel;
  }
  function videoTimeAt(plan, t) {
    if (V.kind !== 'video') return null;
    const len = Math.max(0.05, plan.vOut - plan.vIn);
    if (t < len) return plan.vIn + t;
    if (S.out.vEnd === 'loop') return plan.vIn + (t % len);
    if (S.out.vEnd === 'hold') return Math.max(plan.vIn, plan.vOut - 0.04);
    return null;
  }
  function visualFade(plan, t) {
    const o = S.out; let a = 0;
    if (o.vFadeIn > 0 && t < o.vFadeIn) a = Math.max(a, 1 - t / o.vFadeIn);
    if (o.vFadeOut > 0 && t > plan.total - o.vFadeOut) a = Math.max(a, (t - (plan.total - o.vFadeOut)) / o.vFadeOut);
    return clamp(a, 0, 1);
  }

  let peaks = null, peaksFor = null;
  async function decodeForTimeline(file) {
    if (file.size > 120 * 1048576) { $('#waveMsg').textContent = 'Long track — waveform skipped to save memory (trim still works)'; return; }
    $('#waveMsg').textContent = 'Reading waveform…';
    try { await A.decode(); if (A.file === file) { peaks = null; syncTimeline(); } }
    catch (e) { $('#waveMsg').textContent = 'Waveform unavailable for this file (trim still works)'; }
  }
  function drawWave() {
    const cv = $('#waveCanvas'), box = $('#wave'); if (!cv || !box) return;
    const w = Math.max(100, Math.round(box.clientWidth * (window.devicePixelRatio || 1))), h = Math.round(96 * (window.devicePixelRatio || 1));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; peaks = null; }
    const x = cv.getContext('2d'); x.fillStyle = '#0b0b0c'; x.fillRect(0, 0, w, h);
    const plan = exportPlan(), dur = plan.aDur;
    const fin = dur ? plan.aIn / dur : 0, fout = dur ? plan.aOut / dur : 1;
    $('#whIn').style.left = (fin * 100) + '%'; $('#whOut').style.left = (fout * 100) + '%';
    $('#whIn').hidden = $('#whOut').hidden = !A.loaded;
    const dec = A.decoded && A.decodedFor === A.file ? A.decoded : null;
    $('#waveMsg').hidden = !!dec;
    if (!A.loaded) $('#waveMsg').textContent = 'Load an audio track to trim it';
    if (!dec) return;
    if (!peaks || peaksFor !== dec || peaks.length !== w) {
      peaks = new Float32Array(w); peaksFor = dec;
      const d0 = dec.getChannelData(0), d1 = dec.numberOfChannels > 1 ? dec.getChannelData(1) : d0, per = Math.max(1, Math.floor(d0.length / w));
      for (let i = 0; i < w; i++) { let m = 0; const s0 = i * per; for (let k = 0; k < per; k += 8) { const v = Math.abs(d0[s0 + k] + d1[s0 + k]) * 0.5; if (v > m) m = v; } peaks[i] = m; }
      let mx = 0.0001; for (let i = 0; i < w; i++) mx = Math.max(mx, peaks[i]); for (let i = 0; i < w; i++) peaks[i] /= mx;
    }
    const mid = h / 2;
    for (let i = 0; i < w; i++) { const f = i / w, inside = f >= fin && f <= fout; x.fillStyle = inside ? '#f2f2ef' : '#3a3a3e'; const ph = Math.max(1, peaks[i] * (h * 0.46)); x.fillRect(i, mid - ph, 1, ph * 2); }
    x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 0, fin * w, h); x.fillRect(fout * w, 0, w - fout * w, h);
  }
  function syncTimeline() {
    if (!$('#tIn')) return;
    const plan = exportPlan(), act = document.activeElement;
    const setF = (id, v) => { const el = $(id); if (el && el !== act) el.value = fmtT(v); };
    $('#tlAudio').textContent = A.loaded ? (A.fileName + (plan.aDur ? ' · ' + fmtT(plan.aDur) : '')) : 'No audio track — load one in MEDIA';
    setF('#tIn', plan.aIn); setF('#tOut', plan.aOut); setF('#tOffset', plan.offset); setF('#tFadeIn', plan.fadeIn); setF('#tFadeOut', plan.fadeOut);
    $('#tLen').textContent = A.loaded ? fmtT(plan.clip) : '--';
    ['#tIn', '#tOut', '#tOffset', '#tFadeIn', '#tFadeOut'].forEach((id) => { $(id).disabled = !A.loaded; });
    $('#vTrim').hidden = V.kind !== 'video';
    if (V.kind === 'video') { setF('#tVIn', plan.vIn); setF('#tVOut', plan.vOut); $('#tVLen').textContent = fmtT(plan.vOut - plan.vIn); XO.setSeg($('#vEndSeg'), S.out.vEnd); }
    $('#tlTotal').textContent = 'EXPORT LENGTH · ' + fmtT(plan.total) + ' · ' + Math.round(plan.total * plan.fps) + ' FRAMES' + (!A.loaded ? ' · NO AUDIO (set a custom length below)' : '');
    drawWave(); updateExportInfo();
  }
  XO.syncTimeline = syncTimeline;
  const TF = { tIn: 'aIn', tOut: 'aOut', tOffset: 'aOffset', tFadeIn: 'fadeIn', tFadeOut: 'fadeOut', tVIn: 'vIn', tVOut: 'vOut' };
  document.addEventListener('change', (e) => {
    const k = TF[e.target.id]; if (!k) return;
    const v = parseT(e.target.value);
    if (isFinite(v) && v >= 0) {
      S.out[k] = v;
      const plan = exportPlan();
      if (k === 'aOut' && v <= plan.aIn) S.out.aOut = Math.min(plan.aDur, plan.aIn + 0.1);
      if (k === 'vOut' && v <= plan.vIn) S.out.vOut = Math.min(plan.vDur, plan.vIn + 0.05);
    }
    e.target.blur(); syncTimeline();
  });
  document.addEventListener('keydown', (e) => { if (TF[e.target.id] && e.key === 'Enter') e.target.blur(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#vEndSeg button[data-value]'); if (b) { S.out.vEnd = b.dataset.value; syncTimeline(); return; }
    const mp = e.target.closest('[data-motion]'); if (mp) { L.applyMotionPreset(mp.dataset.motion); L.resetMotion(); XO.syncUI(); XO.toast('Motion preset: ' + mp.dataset.motion); }
  });
  // drag IN / OUT on the waveform
  (function waveDrag() {
    const box = $('#wave'); if (!box) return;
    let which = null;
    const toTime = (e) => { const r = box.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * audioDur(); };
    box.addEventListener('pointerdown', (e) => {
      if (!A.loaded || !audioDur()) return;
      const t = toTime(e), plan = exportPlan();
      which = e.target.closest('.wh') ? e.target.closest('.wh').dataset.h : Math.abs(t - plan.aIn) < Math.abs(t - plan.aOut) ? 'in' : 'out';
      box.setPointerCapture(e.pointerId); move(e);
    });
    const move = (e) => {
      if (!which) return;
      const t = toTime(e), plan = exportPlan();
      if (which === 'in') S.out.aIn = clamp(t, 0, plan.aOut - 0.1); else S.out.aOut = clamp(t, plan.aIn + 0.1, plan.aDur);
      syncTimeline();
    };
    box.addEventListener('pointermove', move);
    const up = () => { which = null; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  })();
  window.addEventListener('resize', () => { peaks = null; drawWave(); });

  /* =========================== export info =========================== */
  let infoSeq = 0;
  function updateExportInfo() {
    if (OUT.rendering || !$('#exportInfo')) return;
    const plan = exportPlan(), seq = ++infoSeq, q = +S.out.quality;
    const frames = Math.round(plan.total * plan.fps);
    const audioLine = !A.loaded ? 'AUDIO · none loaded (video only)' : 'AUDIO · ' + fmtT(plan.clip) + ' clip from ' + fmtT(plan.aIn) + (plan.offset ? ', starts at ' + fmtT(plan.offset) : '');
    const heavy = OUT.full.w * OUT.full.h * frames > 3840 * 2160 * 60 * 90 ? '<br><span class="warn">Very long 4K render — it may take a while and use a lot of memory on a phone.</span>' : '';
    const base = 'SIZE · ' + OUT.full.w + '×' + OUT.full.h + ' · ' + plan.fps + ' fps' + '<br>LENGTH · ' + fmtT(plan.total) + ' · ' + frames + ' frames<br>' + audioLine + (OUT.note ? '<br><span class="warn">' + esc(OUT.note) + '</span>' : '') + heavy;
    $('#exportInfo').innerHTML = 'FORMAT · checking…<br>' + base;
    $('#resTag').textContent = OUT.full.w + '×' + OUT.full.h + (q < 100 ? ' · PREVIEW ' + q + '%' : '');
    E.detect(OUT.full.w, OUT.full.h, S.out.container === 'mov').then((sup) => {
      if (seq !== infoSeq || OUT.rendering) return;
      const btn = $('#renderBtn');
      if (!sup.ok) { $('#exportInfo').innerHTML = '<span class="warn">' + esc(sup.reason) + '</span><br>' + base; btn.disabled = true; return; }
      btn.disabled = false;
      $('#exportInfo').innerHTML = 'FORMAT · ' + esc(sup.label) + (sup.container === 'mov' && sup.audio === 'pcm-s16' && S.out.container !== 'mov' ? ' — no AAC encoder here, so audio is saved uncompressed in a MOV (plays in Photos)' : '') + '<br>' + base;
    });
  }
  XO.updateExportInfo = updateExportInfo;

  /* =========================== preview selection =========================== */
  $('#previewRange').addEventListener('click', async () => {
    const plan = exportPlan();
    if (!V.kind && !A.loaded) { XO.toast('Load a visual or audio track first.'); return; }
    pauseAll();
    if (plan.hasA) A.el.currentTime = plan.aIn;
    if (V.kind === 'video') { const vt = videoTimeAt(plan, 0); video.currentTime = vt == null ? 0 : vt; }
    await playAll();
    const len = plan.hasA ? Math.min(plan.clip, plan.total) : plan.total;
    previewTimer = setTimeout(() => { pauseAll(); XO.toast('Preview finished.'); }, Math.max(0.5, len) * 1000);
    XO.toast('Previewing ' + fmtT(len) + ' — tap ▶/Ⅱ to stop.');
  });

  /* =========================== render & export =========================== */
  function lockOutput(on) { $$('.lockable').forEach((s) => s.classList.toggle('locked', on)); }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function seekVideo(t) {
    return new Promise((res) => {
      if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) { res(); return; }
      let done = false; const fin = () => { if (done) return; done = true; video.removeEventListener('seeked', fin); clearTimeout(to); res(); };
      const to = setTimeout(fin, 5000);
      video.addEventListener('seeked', fin); video.currentTime = t;
    });
  }
  function resetForRender() {
    D.reset(); L.resetFx(); L.resetMotion();
    if (M.loaded) M.resetDust && M.resetDust();
    A.resetBands(); Object.keys(A.bands).forEach((k) => { const b = A.bands[k]; b.env = 0; b.lastHit = -1e9; });
    A._trig = {}; A._hist = []; A._riseAvg = 0; A._lastBeat = -1e9; A.beat = 0; A.level = 0; A._wasPlaying = false;
    ST.lastStart = -1e9; ST.flashUntil = 0; ST.anchor = null; ST.lastIdx = null; ST.flashes = [];
  }

  $('#renderBtn').addEventListener('click', renderExport);
  $('#renderCancel').addEventListener('click', () => { if (E.rendering) { E.cancelled = true; $('#renderStat').textContent = 'Cancelling…'; } });

  async function renderExport() {
    if (E.rendering) return;
    if (!V.kind) { XO.toast('Load a visual first (video, image or 3D model).', true); XO.showTab('media'); return; }
    if (V.kind === 'camera') { XO.toast('The live camera can\'t be rendered offline. Export works with a video, image or 3D model file — or record the screen while you perform.', true, 8000); return; }
    A.ensureContext();
    if (A.loaded && !A.decoded) {
      XO.loading(true, 'READING AUDIO');
      try { await A.decode(); } catch (err) { XO.loading(false); XO.toast('This audio file can\'t be decoded for export (' + (err && err.message || 'unknown error') + ').', true, 9000); return; }
      XO.loading(false); syncTimeline();
    }
    const plan = exportPlan(), size = { w: OUT.full.w, h: OUT.full.h };
    const sup = await E.detect(size.w, size.h, S.out.container === 'mov');
    if (!sup.ok) { XO.toast(sup.reason, true, 9000); return; }
    const frames = Math.max(1, Math.round(plan.total * plan.fps));

    // ---- enter render mode ----
    pauseAll();
    E.rendering = true; E.cancelled = false; OUT.rendering = true;
    const saved = { dof: S.dof.on, blob: S.blob.on, strobe: S.strobe.on, rand: Math.random, w: canvas.width, h: canvas.height, vTime: video.currentTime, anim: M.animPlaying, rot: [M.rotX, M.rotY, M.zoom] };
    if (!S.out.incDof) S.dof.on = false;
    if (!S.out.incHud) S.blob.on = false;
    if (!S.out.incStrobe) S.strobe.on = false;
    ST.held = false; $('#strobePad').classList.remove('on');
    Math.random = mulberry32(0x5eed1ab);
    canvas.width = size.w; canvas.height = size.h;
    resetForRender();
    lockOutput(true); XO.wake(true); XO.setStatus('RENDERING');
    $('#exportResult').hidden = true; $('#renderProg').hidden = false; $('#progressBar').style.width = '0%';
    $('#recTag').hidden = false; $('#recTime').textContent = '0%';
    $('#renderBtn').disabled = true; $('#previewRange').disabled = true; $('#play').disabled = true;
    const stat = (t) => { $('#renderStat').textContent = t; };
    let session = null, ok = false;
    try {
      let mix = null;
      if (plan.hasA && sup.audio) { stat('Mixing audio…'); mix = await E.mixAudio(A.decoded, plan); }
      stat('Starting encoder…');
      session = await E.session({ canvas, fps: plan.fps, quality: S.out.vq, support: sup, audioBuffer: mix });
      const an = plan.hasA ? new A.OfflineAnalyser(A.decoded) : null;
      A.offline = { bins: new Uint8Array(1024), sampleRate: an ? an.sampleRate : 48000 };
      if (V.kind === 'model' && M.clips.length && !M.animPlaying) M.playAnim();
      const base = 1e7, dt = 1 / plan.fps, t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (E.cancelled) throw new Error('cancelled');
        const t = i * dt;
        A.offline.bins = an ? an.frame(audioTimeAt(plan, t)) : A.offline.bins;
        let hasSrc = true;
        if (V.kind === 'video') { const vt = videoTimeAt(plan, t); if (vt == null) hasSrc = false; else await seekVideo(vt); }
        renderFrame(base + t * 1000, dt, t, { index: i, noSource: !hasSrc, fade: visualFade(plan, t) });
        await session.addFrame(t, dt);
        if (i % 3 === 0 || i === frames - 1) {
          const done = (i + 1) / frames, el = (performance.now() - t0) / 1000, left = el / done - el;
          $('#progressBar').style.width = (done * 100).toFixed(1) + '%'; $('#recTime').textContent = Math.floor(done * 100) + '%';
          stat('FRAME ' + (i + 1) + ' / ' + frames + ' · ' + Math.floor(done * 100) + '% · ' + (i > 5 ? fmtT(left).replace(/\.\d+$/, '') + ' left' : 'estimating…') + ' · ' + (((i + 1) / Math.max(0.001, el))).toFixed(1) + ' frames/s');
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      stat('Finishing file…');
      const res = await session.finish(); session = null;
      const r = E.makeResult(res.buffer, res.mime, res.ext, { width: size.w, height: size.h, seconds: plan.total, fps: plan.fps, hasAudio: !!mix, label: sup.label, secs: (performance.now() - t0) / 1000 });
      const mb = (r.size / 1048576).toFixed(r.size > 10485760 ? 0 : 1);
      $('#exportSummary').innerHTML = esc(r.label) + ' · ' + r.width + '×' + r.height + ' · ' + r.fps + ' fps · ' + fmtT(r.seconds) + ' · ' + mb + ' MB<br>Audio: ' + (r.hasAudio ? 'included' : 'none') + ' · rendered in ' + fmtT(r.secs).replace(/\.\d+$/, '') + '<br>' + esc(r.name);
      const a = $('#downloadLink'); a.href = r.url; a.download = r.name; a.hidden = E.isNative();
      $('#shareBtn').hidden = !E.canShareFile(); $('#exportResult').hidden = false;
      XO.lastExport = r; ok = true;
      XO.toast('Export ready: ' + r.name);
    } catch (err) {
      if (session) await session.cancel();
      if (err && err.message === 'cancelled') XO.toast('Render cancelled.');
      else { console.warn('[XO LAB] render failed', err); XO.toast('Render failed: ' + (err && err.message || err), true, 10000); }
    } finally {
      // ---- leave render mode, restore the live state ----
      A.offline = null; Math.random = saved.rand;
      S.dof.on = saved.dof; S.blob.on = saved.blob; S.strobe.on = saved.strobe;
      if (V.kind === 'model' && !saved.anim) { M.pauseAnim(); setModelPlayLabel(); }
      [M.rotX, M.rotY, M.zoom] = saved.rot;
      resetForRender();
      if (V.kind === 'video') { try { video.currentTime = saved.vTime; } catch (e) { /* ignore */ } }
      E.rendering = false; OUT.rendering = false;
      lockOutput(false); XO.wake(false); XO.setStatus(statusLine());
      $('#renderProg').hidden = true; $('#recTag').hidden = true; $('#renderBtn').disabled = false; $('#previewRange').disabled = false; $('#play').disabled = false;
      applyOutputSize(); syncTimeline();
      if (ok && !E.isNative() && !isIOS) $('#downloadLink').click();
    }
  }
  $('#shareBtn').addEventListener('click', async () => {
    const b = $('#shareBtn'), label = b.textContent;
    try { b.disabled = true; await E.share((f) => { b.textContent = 'PREPARING ' + Math.round(f * 100) + '%'; }); }
    catch (e) { if (e && e.name !== 'AbortError' && !/cancel/i.test(e.message || '')) XO.toast(e.message || String(e), true); }
    finally { b.disabled = false; b.textContent = label; }
  });

  /* =========================== keyboard =========================== */
  document.addEventListener('keydown', (e) => {
    const sp = $('#splash');
    if (sp && !sp.classList.contains('gone')) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(); } return; }
    if (!$('#dialog').hidden) return;
    const t = e.target; if (t.closest && t.closest('input,select,textarea')) return;
    if (e.code === 'Space') { if (t.closest && t.closest('button,a')) return; e.preventDefault(); togglePlay(); }
    else if (e.key === 'b' || e.key === 'B') { if (M.loaded) M.triggerBurst(performance.now()); }
    else if ((e.key === 's' || e.key === 'S') && !e.repeat) { strobeWarn().then((ok) => { if (ok) { ST.held = true; pad.classList.add('on'); } }); }
    else if (/^[1-9]$/.test(e.key)) { const sc = XO.scenes.byIndex(+e.key - 1); if (sc) XO.loadScene(sc.name); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === 's' || e.key === 'S') holdOff(); });

  /* =========================== render loop =========================== */
  XO.perf = { fps: 0, frames: 0, t0: performance.now() };
  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let videoFrames = 0;
  if (hasRVFC) { const onVF = () => { videoFrames++; video.requestVideoFrameCallback(onVF); }; video.requestVideoFrameCallback(onVF); }
  let last = performance.now(), lastUi = 0, wasPlayingLabel = null, lastTrackKey = null, lastMain = null, wasActive = false;
  const t0 = performance.now();

  /**
   * Draws one complete frame onto the stage canvas. Used by the live loop and by the offline renderer.
   * xo (export only): { index, noSource, fade }
   */
  function renderFrame(now, dt, time, xo) {
    A.update(dt, now);
    const W = canvas.width, H = canvas.height;

    let src = null, sw = 0, sh = 0, is3D = false, ver = V.ver;
    if (V.kind === 'image') { src = V.src; sw = V.w; sh = V.h; }
    else if (V.kind === 'video' && video.videoWidth > 0 && !(xo && xo.noSource)) { src = video; sw = video.videoWidth; sh = video.videoHeight; ver = xo ? V.ver * 1e6 + xo.index + 1 : hasRVFC ? V.ver * 1e6 + videoFrames : now; }
    else if (V.kind === 'camera' && !xo) { src = camFrame(); if (src) { sw = cam.videoWidth; sh = cam.videoHeight; ver = now; } }
    else if (V.kind === 'model') {
      if (S.model.burstAuto && M.dust.phase === 'idle' && A.trigger('burst', S.model.burstBand, S.model.burstThr / 100, S.model.burstCooldown, now)) M.triggerBurst(now);
      src = M.render(dt, W, H, now, time, A.energy(S.model.wireBand)); is3D = true; ver = now;
      if (src) { sw = src.width; sh = src.height; }
    }

    const out = G.render({ src, sw, sh, srcVersion: ver, W, H, time, is3D, energy: A.energy, focus: lastMain });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(out, 0, 0, W, H);

    // blob detection
    if (src && S.blob.on) {
      const filtered = S.blob.detectOn === 'filtered';
      const key = xo ? 'x' + xo.index : filtered ? 'f' + now : V.kind === 'video' ? (hasRVFC ? 'v' + videoFrames : 'v' + now) : V.kind === 'image' ? 'img' + V.ver : 'm' + now;
      const fresh = key !== lastTrackKey; lastTrackKey = key;
      D.analyse(filtered ? out : src, filtered ? W : sw, filtered ? H : sh, now, fresh);
    }
    const r = G.rect, filteredMap = S.blob.detectOn === 'filtered';
    const map = filteredMap ? (u, v) => [u * W, v * H] : (u, v) => [(r.x + u * r.w) * W, (1 - r.y - r.h + v * r.h) * H];
    const scl = filteredMap ? (w, h) => [w * W, h * H] : (w, h) => [w * r.w * W, h * r.h * H];

    ST.update(now, A);
    if (S.strobe.layer === 'under') ST.draw(ctx, W, H);
    const info = src ? XO.drawBlobs(ctx, W, H, map, scl, out, dt, now, A) : { count: 0, main: null };
    lastMain = info.main;
    if (S.strobe.layer !== 'under') ST.draw(ctx, W, H);
    if (xo && xo.fade > 0.001) { ctx.globalAlpha = xo.fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    XO.lastInfo = info;
  }
  XO.renderFrame = renderFrame;

  /* live performance helpers (MIDI / keyboard): blackout and freeze affect the live preview only, never exports */
  const PF = (XO.perform = { blackout: false, freeze: false, black: 0 });
  XO.frameHooks = XO.frameHooks || [];
  function frame(now) {
    requestAnimationFrame(frame);
    if (E.rendering) { last = now; return; } // the offline renderer owns the canvas
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    for (let i = 0; i < XO.frameHooks.length; i++) { try { XO.frameHooks[i](now, dt); } catch (e) { console.error(e); } }
    if (PF.freeze) A.update(dt, now); // hold the last picture; keep listening
    else renderFrame(now, dt, (now - t0) / 1000, null);
    PF.black += ((PF.blackout ? 1 : 0) - PF.black) * Math.min(1, dt * 18);
    if (PF.black > 0.004) { ctx.globalAlpha = Math.min(1, PF.black); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
    XO.perf.frames++;
    if (now - XO.perf.t0 > 1000) { XO.perf.fps = XO.perf.frames * 1000 / (now - XO.perf.t0); XO.perf.frames = 0; XO.perf.t0 = now; }
    const playingNow = anyPlaying();
    if (playingNow !== wasPlayingLabel) { wasPlayingLabel = playingNow; $('#play').textContent = playingNow ? 'Ⅱ' : '▶'; }
    if (playingNow !== wasActive) { wasActive = playingNow; XO.wake(playingNow); }
    if (now - lastUi > 100) { lastUi = now; uiTick(now); }
  }

  function uiTick(now) {
    // band meters + leds
    $$('.monitor .band').forEach((el) => {
      const b = A.bands[el.dataset.band], thr = S.audio['thr' + el.dataset.band[0].toUpperCase() + el.dataset.band.slice(1)];
      el.querySelector('i').style.width = (b.norm * 100).toFixed(0) + '%'; el.querySelector('b').style.left = thr + '%';
      el.querySelector('em').classList.toggle('hit', now - b.lastHit < 140);
    });
    ['Bass', 'Mid', 'High'].forEach((n) => $('#led' + n).classList.toggle('hit', now - A.bands[n.toLowerCase()].lastHit < 140));
    const bpm = A.effectiveBpm();
    $('#bpmOut').textContent = (bpm ? bpm.toFixed(1) : '—') + ' BPM · ' + (S.audio.bpmMode === 'auto' ? (A.bpm ? 'DETECTED' : 'DEFAULT') : S.audio.bpmMode.toUpperCase());
    // timeline
    const m = masterMedia();
    if (m && isFinite(m.duration) && m.duration > 0) {
      $('#timecode').textContent = XO.fmtTime(m.currentTime, true);
      $('#duration').textContent = XO.fmtTime(m.duration) + (m === A.el && V.kind ? ' TRACK' : '');
      if (document.activeElement !== $('#seek')) { $('#seek').value = Math.round((m.currentTime / m.duration) * 1000); XO.paintRange($('#seek')); }
    }
    // statuses
    if (S.blob.on && V.kind) {
      $('#trackStatus').textContent = D.error ? 'Picture data unavailable here — tracking off.' : (D.count ? 'TRACKING ' + D.count + ' BLOB' + (D.count > 1 ? 'S' : '') : 'SEARCHING · no blobs') + ' · ' + S.blob.detect.toUpperCase() + (S.blob.detect === 'motion' ? ' Δ>' + Math.round(D.cut) : (S.blob.detect === 'bright' ? ' >' : ' <') + Math.round(D.cut));
    }
    $('#burstState').textContent = M.loaded ? M.dust.phase.toUpperCase() + (S.model.burstAuto ? ' · AUTO ' + S.model.burstBand.toUpperCase() : ' · MANUAL') : 'NO MODEL';
    $('#strobeRate').textContent = ST.rate(now).toFixed(1) + ' flashes/s · cap ' + ST.maxHz() + '/s';
    $('#fxStatus').textContent = G.ok ? (G.fxError ? 'Filter error: ' + G.fxError : '') : 'WebGL2 is unavailable here — filters and depth of field are off; background and placement still work.';
    const fm = $('#focusMark');
    if (S.dof.on && G.focusUsed) { fm.hidden = false; const rr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(), ar = canvas.width / canvas.height, er = rr.width / rr.height; let w = rr.width, h = rr.height, ox = 0, oy = 0; if (er > ar) { w = h * ar; ox = (rr.width - w) / 2; } else { h = w / ar; oy = (rr.height - h) / 2; } fm.style.left = (rr.left - sr.left + ox + G.focusUsed.x * w) + 'px'; fm.style.top = (rr.top - sr.top + oy + (1 - G.focusUsed.y) * h) + 'px'; }
    else fm.hidden = true;
    const tag = $('#resTag'); if (!OUT.rendering) tag.textContent = OUT.full.w + '×' + OUT.full.h + (+S.out.quality < 100 ? ' · PREVIEW ' + S.out.quality + '%' : '') + ' · ' + Math.round(XO.perf.fps) + ' FPS';
  }

  function statusLine() { return (window.xoDesktop ? ({ darwin: 'MAC APP', win32: 'WINDOWS APP' }[window.xoDesktop.platform] || 'DESKTOP APP') : E.isNative() ? 'IPHONE APP' : location.protocol.startsWith('http') ? 'OFFLINE READY' : 'LOCAL FILE') + ' · ' + (G.ok ? 'GPU FX' : 'NO WEBGL2') + ' · LOCAL SESSION'; }

  /* =========================== init =========================== */
  applyOutputSize();
  XO.setStatus(statusLine());
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('pagehide', () => { if (V.url) URL.revokeObjectURL(V.url); });
  requestAnimationFrame(frame);
  syncTimeline();
  XO.media = { setImage, setVideo, setModel, setAudio, setBgFile, setCamera, clearVisual: () => $('#clearVisual').click(), clearAudio: () => $('#clearAudio').click(), clearBg: () => $('#clearBg').click() };
  XO.togglePlay = togglePlay;
  XO.qa = { routeFiles, playAll, pauseAll, enter, applyOutputSize, targetSize, OUT, exportPlan, renderExport, audioTimeAt, videoTimeAt };
  XO.ready = true; document.dispatchEvent(new Event('xo:ready'));
})();
