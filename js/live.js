/* XO LAB — Live input panel: microphone / line-in audio and the live camera.
 * Works in the browser (HTTPS or localhost), the iPhone app and the Windows / Mac apps. */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$;
  const A = XO.audio;
  const store = { get: (k) => { try { return localStorage.getItem('xolab-' + k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem('xolab-' + k, v); } catch (e) { /* private mode */ } } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function permissionMessage(err, what) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      if (XO.isDesktopApp && window.xoDesktop.platform === 'darwin') return what + ' access is off. Open System Settings → Privacy & Security → ' + (what === 'Camera' ? 'Camera' : 'Microphone') + ', turn on XO LAB, then try again.';
      if (XO.exporter && XO.exporter.isNative()) return what + ' access is off. Open iPhone Settings → XO LAB and turn on ' + what + '.';
      return what + ' access was blocked. Allow it in the browser (the icon left of the address bar), then try again.';
    }
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No ' + what.toLowerCase() + ' found. Plug one in, or pick another in the list.';
    if (n === 'NotReadableError') return 'The ' + what.toLowerCase() + ' is busy in another app. Close that app and try again.';
    if (!window.isSecureContext) return what + ' needs a secure page (https:// or the installed app).';
    return 'Could not start the ' + what.toLowerCase() + ': ' + ((err && err.message) || err);
  }

  async function fillDevices(kind) {
    const sel = $(kind === 'audio' ? '#liveAudioDevice' : '#cameraDevice'); if (!sel) return;
    let list = [];
    try {
      if (kind === 'audio') list = await A.liveDevices();
      else list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || 'Camera ' + (i + 1) }));
    } catch (e) { /* not allowed yet */ }
    const want = kind === 'audio' ? (A.live.deviceId || store.get('audio-in')) : store.get('camera');
    const def = list.find((d) => d.id === 'default');
    const opts = [`<option value="">${kind === 'audio' ? 'Default input' : 'Default camera'}${def ? ' — ' + esc(def.label.replace(/^Default\s*-?\s*/i, '')) : ''}</option>`].concat(list.filter((d) => d.id && d.id !== 'default').map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`));
    sel.innerHTML = opts.join('');
    if (want && list.some((d) => d.id === want)) sel.value = want;
  }

  /* ---------------- live audio ---------------- */
  async function startAudio() {
    const id = $('#liveAudioDevice').value;
    XO.loading(true, 'STARTING LIVE AUDIO');
    try {
      if (XO.qa) XO.qa.pauseAll();
      const label = await A.startLive(id);
      store.set('audio-in', A.live.deviceId || id);
      await fillDevices('audio');
      XO.toast('Live audio on: ' + label);
    } catch (err) { XO.toast(permissionMessage(err, 'Microphone'), true, 9000); } finally { XO.loading(false); render(); }
  }
  function stopAudio() { A.stopLive(); render(); XO.toast('Live audio off — back to the track.'); }
  XO.live = { startAudio, stopAudio, startCamera, stopCamera, render };

  /* ---------------- camera ---------------- */
  async function startCamera(facing) {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { XO.toast('This device has no camera access here.', true); return; }
    const id = $('#cameraDevice') ? $('#cameraDevice').value : '';
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
    if (id) video.deviceId = { exact: id }; else if (facing) video.facingMode = facing;
    XO.loading(true, 'STARTING CAMERA');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const tr = stream.getVideoTracks()[0], st = (tr && tr.getSettings && tr.getSettings()) || {};
      store.set('camera', st.deviceId || id);
      // front cameras and webcams look natural mirrored; a back camera doesn't
      const face = st.facingMode || facing || '';
      if (face === 'environment' && XO.S.media.camMirror) { XO.S.media.camMirror = false; XO.syncKey('media.camMirror'); }
      else if (face === 'user' && !XO.S.media.camMirror) { XO.S.media.camMirror = true; XO.syncKey('media.camMirror'); }
      await XO.media.setCamera(stream, (tr && tr.label) || 'Camera');
      await fillDevices('video');
      XO.toast('Camera on. Blob tracking and every effect work on it live.');
    } catch (err) { XO.toast(permissionMessage(err, 'Camera'), true, 9000); } finally { XO.loading(false); render(); }
  }
  function stopCamera() { XO.media.clearVisual(); render(); }
  XO.onCameraChange = () => render();
  A.onLiveChange = () => render();

  function render() {
    const aOn = A.live.on, cOn = XO.state && XO.state.V.kind === 'camera';
    const ab = $('#liveAudioBtn'), cb = $('#cameraBtn');
    if (ab) { ab.textContent = aOn ? '■ STOP LIVE AUDIO' : '● START LIVE AUDIO'; ab.classList.toggle('on', aOn); }
    if (cb) { cb.textContent = cOn ? '■ STOP CAMERA' : '● START CAMERA'; cb.classList.toggle('on', cOn); }
    const as = $('#liveAudioState'); if (as) as.textContent = aOn ? 'LISTENING: ' + A.live.label : 'Off — the visuals follow the loaded track.';
    const cs = $('#cameraState'); if (cs) cs.textContent = cOn ? 'LIVE: ' + XO.cam.label + ' · ' + XO.state.V.w + '×' + XO.state.V.h : 'Off';
    const flip = $('#cameraFlip'); if (flip) flip.hidden = !(cOn && isTouch());
  }
  const isTouch = () => /iPad|iPhone|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // level meter (live input only)
  function meter() {
    const m = $('#liveMeter');
    if (m) { m.style.width = (A.live.on ? Math.min(100, A.raw * 260) : 0).toFixed(0) + '%'; m.parentElement.classList.toggle('hot', A.live.on && A.raw > 0.33); }
    requestAnimationFrame(meter);
  }

  XO.customs.liveInput = (el) => {
    const ok = A.liveSupported();
    el.innerHTML = `
      <div class="opt-label">LIVE AUDIO · MIC · AUDIO INTERFACE · DJ MIXER</div>
      <div class="live-row"><select id="liveAudioDevice" aria-label="Live audio input"><option value="">Default input</option></select><button class="btn" id="liveAudioBtn" type="button" ${ok ? '' : 'disabled'}>● START LIVE AUDIO</button></div>
      <div class="live-meter" aria-hidden="true"><i id="liveMeter"></i></div>
      <div class="sub" id="liveAudioState">Off — the visuals follow the loaded track.</div>
      <div class="opt-label" style="margin-top:12px">LIVE CAMERA</div>
      <div class="live-row"><select id="cameraDevice" aria-label="Camera"><option value="">Default camera</option></select><button class="btn" id="cameraBtn" type="button">● START CAMERA</button></div>
      <button class="btn" id="cameraFlip" type="button" hidden>⇄ SWITCH FRONT / BACK</button>
      <div class="sub" id="cameraState">Off</div>
      <div class="hint">${ok ? 'Live audio is only analysed, never played out loud, so there is no feedback. For the cleanest signal use your mixer\'s booth / record out into an audio interface. The camera is a live source: perform with it, but offline export needs a file.' : 'Live input isn\'t available in this browser. Use the installed app or a current Chrome, Edge or Safari over https://.'}</div>`;
    el.querySelector('#liveAudioBtn').addEventListener('click', () => (A.live.on ? stopAudio() : startAudio()));
    el.querySelector('#cameraBtn').addEventListener('click', () => (XO.state.V.kind === 'camera' ? stopCamera() : startCamera()));
    el.querySelector('#cameraFlip').addEventListener('click', () => { const back = XO.S.media.camMirror; $('#cameraDevice').value = ''; startCamera(back ? 'environment' : 'user'); });
    el.querySelector('#liveAudioDevice').addEventListener('change', () => { if (A.live.on) startAudio(); });
    el.querySelector('#cameraDevice').addEventListener('change', () => { if (XO.state.V.kind === 'camera') startCamera(); });
    fillDevices('audio'); fillDevices('video');
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { fillDevices('audio'); fillDevices('video'); });
    requestAnimationFrame(meter);
  };
})();
