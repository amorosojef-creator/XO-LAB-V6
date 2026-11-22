/* XO LAB — projects.
 * A project (.xolab) is a plain zip holding project.json (settings, scenes, filter presets) and the media in use
 * (visual or 3D model files, audio track, background image). Saved files open on every platform.
 * The last 6 projects are also kept on this device (IndexedDB) for one-tap reopening. */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FORMAT = 1, APP_VERSION = '5.1.0', RECENT_MAX = 6;
  const P = (XO.project = { name: 'UNTITLED', dirty: false, includeMedia: true });

  /* ------------------------------ zip (store only, no compression) ------------------------------ */
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  async function crc32(blob, onChunk) {
    let c = 0xffffffff; const CH = 8 * 1024 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      const b = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer());
      for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      if (onChunk) onChunk(Math.min(off + CH, blob.size));
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /** entries: [{ name, blob }] → Blob (.zip). Never copies media into memory: the zip is a list of slices. */
  async function zip(entries, onProgress) {
    const enc = new TextEncoder(), parts = [], central = [], now = dosTime(new Date());
    const total = entries.reduce((a, e) => a + e.blob.size, 0) || 1;
    let offset = 0, done = 0;
    if (total > 0xfffffff0) throw new Error('Project is larger than 4 GB — save it without media, or use shorter clips.');
    for (const e of entries) {
      const name = enc.encode(e.name), size = e.blob.size;
      const crc = await crc32(e.blob, (n) => onProgress && onProgress((done + n) / total));
      done += size;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, now.time, true); h.setUint16(12, now.date, true); h.setUint32(14, crc, true);
      h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, e.blob);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, now.time, true); c.setUint16(14, now.date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  /** Blob (.zip, stored entries) → Map(name → Blob). Compressed entries are rejected with a clear message. */
  async function unzip(blob) {
    const tailLen = Math.min(blob.size, 65557), tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This isn\'t an XO LAB project file.');
    const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder();
    const out = new Map(); let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('The project file is damaged.');
      const method = cd.getUint16(p + 10, true), size = cd.getUint32(p + 20, true), nLen = cd.getUint16(p + 28, true), xLen = cd.getUint16(p + 30, true), cLen = cd.getUint16(p + 32, true), lOff = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nLen));
      p += 46 + nLen + xLen + cLen;
      if (name.endsWith('/')) continue;
      if (method !== 0) throw new Error('This project was re-zipped with compression. Use the original .xolab file.');
      const lh = new DataView(await blob.slice(lOff, lOff + 30).arrayBuffer());
      const dataOff = lOff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      out.set(name, blob.slice(dataOff, dataOff + size));
    }
    return out;
  }
  P._zip = zip; P._unzip = unzip; // for tests

  /* ------------------------------ recent projects (this device) ------------------------------ */
  function idb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('No device storage'));
      const r = indexedDB.open('xolab', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('projects', mode), st = t.objectStore('projects'); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  P.recent = async function () {
    try { const all = await tx('readonly', (st) => st.getAll()); return (all || []).sort((a, b) => b.savedAt - a.savedAt).map(({ id, name, savedAt, size }) => ({ id, name, savedAt, size })); } catch (e) { return []; }
  };
  async function remember(name, blob) {
    try {
      const id = name.toLowerCase();
      await tx('readwrite', (st) => st.put({ id, name, savedAt: Date.now(), size: blob.size, blob }));
      const list = await P.recent();
      if (list.length > RECENT_MAX) await tx('readwrite', (st) => list.slice(RECENT_MAX).forEach((x) => st.delete(x.id)));
      return true;
    } catch (e) { console.warn('[XO LAB] recent projects not stored:', e && e.message); return false; }
  }
  async function forget(id) { try { await tx('readwrite', (st) => st.delete(id)); } catch (e) { /* ignore */ } }
  async function fromRecent(id) { const r = await tx('readonly', (st) => st.get(id)); return r ? new File([r.blob], r.name + '.xolab', { type: 'application/zip' }) : null; }

  /* ------------------------------ build / restore ------------------------------ */
  const safe = (s) => String(s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  const meta = (f, p) => ({ path: p, name: f.name, type: f.type || '', size: f.size });

  /** Collect the current session into a .xolab Blob. */
  P.build = async function (name, onProgress) {
    if (XO.history) XO.history.flush();
    const F = XO.mediaFiles || {}, V = XO.state.V, entries = [], media = {};
    if (P.includeMedia) {
      if (F.model && F.model.length && V.kind === 'model') media.model = F.model.map((f, i) => { const p = 'media/model/' + i + '_' + safe(f.name); entries.push({ name: p, blob: f }); return meta(f, p); });
      else if (F.visual && (V.kind === 'image' || V.kind === 'video')) { const p = 'media/visual_' + safe(F.visual.name); entries.push({ name: p, blob: F.visual }); media.visual = Object.assign(meta(F.visual, p), { kind: V.kind }); }
      if (F.audio && XO.audio.loaded) { const p = 'media/audio_' + safe(F.audio.name); entries.push({ name: p, blob: F.audio }); media.audio = meta(F.audio, p); }
      if (F.bg) { const p = 'media/bg_' + safe(F.bg.name); entries.push({ name: p, blob: F.bg }); media.bg = meta(F.bg, p); }
    }
    const manifest = {
      app: 'XO LAB', kind: 'project', format: FORMAT, version: APP_VERSION, name, savedAt: new Date().toISOString(),
      settings: XO.snapshot(), scenes: XO.scenes.list(), fxPresets: XO.userFxPresets.list(), media,
    };
    if (XO.midi && XO.midi.prefs.inProjects && Object.keys(XO.midi.map).length) manifest.midi = XO.midi.exportProfile();
    entries.unshift({ name: 'project.json', blob: new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }) });
    return zip(entries, onProgress);
  };

  /** Open a .xolab file (File/Blob). Replaces the media and settings; merges its scenes and filter presets. */
  P.open = async function (file) {
    const files = await unzip(file);
    const mBlob = files.get('project.json');
    if (!mBlob) throw new Error('This isn\'t an XO LAB project file.');
    const m = JSON.parse(await mBlob.text());
    if (m.app !== 'XO LAB' || m.kind !== 'project') throw new Error('This isn\'t an XO LAB project file.');
    if ((m.format || 1) > FORMAT) throw new Error('This project was made with a newer XO LAB. Please update the app.');
    const fileOf = (x) => (x && files.get(x.path) ? new File([files.get(x.path)], x.name, { type: x.type || '' }) : null);
    const media = m.media || {}, missing = [];
    XO.restoring = true;
    try {
      await XO.history.silently(async () => {
        XO.media.clearVisual(); XO.media.clearAudio(); XO.media.clearBg();
        if (media.model) { const fs = media.model.map(fileOf).filter(Boolean); if (fs.length) await XO.media.setModel(fs); else missing.push('3D model'); }
        else if (media.visual) { const f = fileOf(media.visual); if (f) await (media.visual.kind === 'video' ? XO.media.setVideo : XO.media.setImage)(f); else missing.push('visual'); }
        if (media.audio) { const f = fileOf(media.audio); if (f) await XO.media.setAudio(f); else missing.push('audio'); }
        if (media.bg) { const f = fileOf(media.bg); if (f) await XO.media.setBgFile(f); }
        XO.applySnapshot(XO.migrate(m.settings || {}, m.version));
        XO.afterLoadState();
        if (XO.syncTimeline) XO.syncTimeline();
        if (Array.isArray(m.scenes) && m.scenes.length) XO.scenes.importJSON(JSON.stringify({ scenes: m.scenes }));
        if (Array.isArray(m.fxPresets)) m.fxPresets.forEach((p) => p && p.name && XO.userFxPresets.save(p.name, p.stack || []));
        if (m.midi && XO.midi) { try { XO.midi.importProfile(m.midi, (m.name || 'Project') + ' MIDI'); if (XO.midi.renderList) XO.midi.renderList(); } catch (e) { /* not a valid profile: skip */ } }
      });
    } finally { XO.restoring = false; }
    XO.history.reset();
    setName(m.name || file.name.replace(/\.(xolab|zip)$/i, ''));
    if (XO.renderScenes) XO.renderScenes();
    return { name: P.name, missing, version: m.version };
  };

  /* ------------------------------ save / open with UI ------------------------------ */
  function setName(n) {
    P.name = String(n || 'UNTITLED').slice(0, 40); P.dirty = false;
    const el = $('#projectName'); if (el) el.textContent = P.name;
    if (window.xoDesktop) window.xoDesktop.setTitle(P.name);
    renderRecent();
  }
  P.setName = setName;
  function download(file) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  P.save = async function () {
    const name = await XO.prompt('Save project as', P.name === 'UNTITLED' ? 'MY SET' : P.name);
    if (!name) return false;
    XO.loading(true, 'SAVING PROJECT');
    try {
      const blob = await P.build(name, (f) => XO.loading(true, 'SAVING PROJECT ' + Math.round(f * 100) + '%'));
      const file = new File([blob], safe(name) + '.xolab', { type: 'application/zip' });
      const kept = await remember(name, blob);
      setName(name);
      const E = XO.exporter;
      if (E.isNative()) { XO.loading(true, 'PREPARING FILE'); await E.shareFile(file); }
      else if (!window.xoDesktop && /iPad|iPhone|iPod/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: file.name });
      else download(file);
      XO.toast('Project saved: ' + name + (kept ? '' : ' (not kept in Recent — device storage is full)'));
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false; // share sheet closed
      XO.toast('Could not save the project: ' + (err.message || err), true, 8000); return false;
    } finally { XO.loading(false); }
  };
  P.openFile = async function (file) {
    XO.loading(true, 'OPENING PROJECT');
    try {
      const r = await P.open(file);
      await remember(r.name, file);
      renderRecent();
      XO.toast('Project opened: ' + r.name + (r.missing.length ? ' — missing: ' + r.missing.join(', ') : ''), !!r.missing.length);
      return true;
    } catch (err) { XO.toast('Could not open the project: ' + (err.message || err), true, 8000); return false; } finally { XO.loading(false); }
  };
  P.openPicker = () => { const i = $('#projectInput'); if (i) i.click(); };

  async function renderRecent() {
    const el = $('#recentList'); if (!el) return;
    const list = await P.recent();
    if (!list.length) { el.innerHTML = '<div class="sub">No recent projects on this device yet.</div>'; return; }
    const fmt = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
    el.innerHTML = list.map((r) => `<div class="scene recent"><b>${esc(r.name)}</b><small>${new Date(r.savedAt).toLocaleDateString()} · ${fmt(r.size)}</small><button class="mini" type="button" data-recent="${encodeURIComponent(r.id)}">OPEN</button><button class="mini" type="button" data-forget="${encodeURIComponent(r.id)}" aria-label="Remove from recent">✕</button></div>`).join('');
  }
  P.renderRecent = renderRecent;

  XO.customs.project = (el) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    el.innerHTML = `<div class="preset-row"><button class="btn" id="projectSave" type="button">SAVE PROJECT</button><button class="btn" id="projectOpen" type="button">OPEN PROJECT</button></div>
      <input type="file" id="projectInput" ${isIOS ? '' : 'accept=".xolab,.zip,application/zip"'} hidden />
      <label class="toggle">Include media files in the project <input type="checkbox" id="projectMedia" checked><i></i></label>
      <div class="opt-label">RECENT ON THIS DEVICE</div><div class="scene-list" id="recentList"></div>
      <div class="hint">A project keeps your media, settings, scenes and filter presets in one .xolab file that opens on iPhone, Windows, Mac and the browser.</div>`;
    el.querySelector('#projectSave').addEventListener('click', () => P.save());
    el.querySelector('#projectOpen').addEventListener('click', () => P.openPicker());
    el.querySelector('#projectMedia').addEventListener('change', (e) => { P.includeMedia = e.target.checked; });
    el.querySelector('#projectInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) P.openFile(f); });
    el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-recent]'), x = e.target.closest('[data-forget]');
      if (r) { const f = await fromRecent(decodeURIComponent(r.dataset.recent)); if (f) P.openFile(f); }
      else if (x) { await forget(decodeURIComponent(x.dataset.forget)); renderRecent(); }
    });
    renderRecent();
  };
})();
