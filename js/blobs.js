/* XO LAB — live blob tracking + HUD (v3).
 * Detection: the picture is sampled on a 160-cell grid; cells are BRIGHT / DARK / MOTION;
 * connected blobs are matched frame to frame (stable IDs), smoothed and drawn as a HUD.
 * It finds shapes by brightness or movement — not faces or objects.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
  const GRID = 160;

  /* ======================= detection ======================= */
  const D = (XO.detector = { canvas: document.createElement('canvas'), ctx: null, prev: null, tracks: [], nextId: 1, error: false, lastFrameChange: -1e9, cut: 0, count: 0 });
  D.ctx = D.canvas.getContext('2d', { willReadFrequently: true });
  D.reset = function () { D.prev = null; D.tracks = []; D.nextId = 1; D.error = false; D.lastFrameChange = -1e9; ghosts.length = 0; };

  D.analyse = function (source, sw, sh, now, fresh) {
    const s = XO.S.blob;
    if (D.error || !source || !sw || !sh) return;
    if (s.detect === 'motion' && !fresh) { age(now); return; }
    const gw = sw >= sh ? GRID : Math.max(8, Math.round(GRID * sw / sh));
    const gh = sw >= sh ? Math.max(8, Math.round(GRID * sh / sw)) : GRID;
    if (D.canvas.width !== gw || D.canvas.height !== gh) { D.canvas.width = gw; D.canvas.height = gh; D.prev = null; }
    let data;
    try { D.ctx.fillStyle = '#000'; D.ctx.fillRect(0, 0, gw, gh); D.ctx.drawImage(source, 0, 0, gw, gh); data = D.ctx.getImageData(0, 0, gw, gh).data; }
    catch (e) { D.error = true; D.tracks = []; return; }
    const n = gw * gh, L = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    const on = new Uint8Array(n);
    if (s.detect === 'motion') {
      const prev = D.prev; D.prev = L;
      if (!prev || prev.length !== n) { age(now); return; }
      let total = 0; const cut = Math.max(6, (100 - s.sens) * 0.4); D.cut = cut;
      for (let i = 0; i < n; i++) { const d = Math.abs(L[i] - prev[i]); total += d; on[i] = d > cut ? 1 : 0; }
      if (total === 0) { age(now); return; }
    } else {
      D.prev = null;
      const cut = s.detect === 'bright' ? 255 - s.sens * 2.4 : s.sens * 2.4; D.cut = cut;
      if (s.detect === 'bright') for (let i = 0; i < n; i++) on[i] = L[i] > cut ? 1 : 0;
      else for (let i = 0; i < n; i++) on[i] = L[i] < cut ? 1 : 0;
    }
    D.lastFrameChange = now;
    const dil = new Uint8Array(n);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (on[i] || (x > 0 && on[i - 1]) || (x < gw - 1 && on[i + 1]) || (y > 0 && on[i - gw]) || (y < gh - 1 && on[i + gw])) dil[i] = 1;
    }
    const seen = new Uint8Array(n), found = [], stack = [];
    for (let i = 0; i < n; i++) {
      if (!dil[i] || seen[i]) continue;
      stack.length = 0; stack.push(i); seen[i] = 1;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, real = 0, sx = 0, sy = 0;
      while (stack.length) {
        const k = stack.pop(), x = k % gw, y = (k / gw) | 0;
        if (on[k]) { real++; sx += x; sy += y; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && dil[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
        if (x < gw - 1 && dil[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
        if (y > 0 && dil[k - gw] && !seen[k - gw]) { seen[k - gw] = 1; stack.push(k - gw); }
        if (y < gh - 1 && dil[k + gw] && !seen[k + gw]) { seen[k + gw] = 1; stack.push(k + gw); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (real < s.minCells || (bw * bh) / n > 0.3) continue;
      found.push({ x: x0 / gw, y: y0 / gh, w: bw / gw, h: bh / gh, cx: (sx / real + 0.5) / gw, cy: (sy / real + 0.5) / gh, n: real, conf: Math.min(0.99, 0.5 + 0.5 * real / (bw * bh)) });
    }
    if (s.detect === 'motion') mergeNear(found, 0.5, 2 / gw);
    found.sort((a, b) => b.n - a.n);
    match(found.slice(0, s.maxBlobs), now);
  };
  function mergeNear(list, grow, pad) {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j], ga = grow * Math.max(a.w, a.h) + pad, gb = grow * Math.max(b.w, b.h) + pad;
        if (a.x - ga < b.x + b.w + gb && a.x + a.w + ga > b.x - gb && a.y - ga < b.y + b.h + gb && a.y + a.h + ga > b.y - gb) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.max(a.x + a.w, b.x + b.w) - x, h = Math.max(a.y + a.h, b.y + b.h) - y;
          if (w * h > 0.3) continue;
          const nn = a.n + b.n;
          list[i] = { x, y, w, h, n: nn, cx: (a.cx * a.n + b.cx * b.n) / nn, cy: (a.cy * a.n + b.cy * b.n) / nn, conf: (a.conf * a.n + b.conf * b.n) / nn };
          list.splice(j, 1); merged = true; break outer;
        }
      }
    }
  }
  function match(found, now) {
    const free = D.tracks.slice();
    found.forEach((f) => {
      let best = null, bd = 1e9; const reach = Math.max(0.1, 0.75 * Math.max(f.w, f.h));
      free.forEach((t) => { const d = Math.hypot(t.tcx - f.cx, t.tcy - f.cy); if (d < bd && d < reach) { bd = d; best = t; } });
      if (best) { free.splice(free.indexOf(best), 1); Object.assign(best, { tx: f.x, ty: f.y, tw: f.w, th: f.h, tcx: f.cx, tcy: f.cy, conf: f.conf, n: f.n, seen: now }); }
      else {
        const t = { id: D.nextId, x: f.x, y: f.y, w: f.w, h: f.h, cx: f.cx, cy: f.cy, tx: f.x, ty: f.y, tw: f.w, th: f.h, tcx: f.cx, tcy: f.cy, conf: f.conf, n: f.n, born: now, seen: now, alpha: 0, label: null, rolls: 0, rp: Math.random() };
        D.tracks.push(t); D.nextId = D.nextId >= 999 ? 1 : D.nextId + 1;
      }
    });
    age(now);
  }
  function age(now) { D.tracks = D.tracks.filter((t) => now - t.seen < 320); }
  function smoothTracks(dt, now) {
    const sm = Math.min(0.95, XO.S.blob.smooth / 100), f = 1 - Math.pow(sm, dt * 60);
    D.tracks.forEach((t) => {
      t.x += (t.tx - t.x) * f; t.y += (t.ty - t.y) * f; t.w += (t.tw - t.w) * f; t.h += (t.th - t.h) * f; t.cx += (t.tcx - t.cx) * f; t.cy += (t.tcy - t.cy) * f;
      const target = now - t.seen > 90 ? Math.max(0, 1 - (now - t.seen - 90) / 230) : 1;
      t.alpha += (target - t.alpha) * Math.min(1, dt * 14);
    });
    D.count = D.tracks.filter((t) => now - t.seen < 90).length;
  }
  const hash = (id) => { let h = (id * 2654435761) >>> 0; h ^= h >>> 15; return (h % 1000) / 1000; };

  /* ======================= labels + random characters ======================= */
  const GLYPHS = { latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', sym: '#%&@/\\<>[]{}*+=', kata: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン' };
  function glyphSet() { const g = XO.S.blob.glyphs; return g === 'latin' ? GLYPHS.latin : g === 'katakana' ? GLYPHS.kata : g === 'all' ? GLYPHS.latin + GLYPHS.sym + GLYPHS.kata : GLYPHS.latin + GLYPHS.sym; }
  const rndGlyph = (set) => set[(Math.random() * set.length) | 0];
  XO.wordBank = function () {
    const custom = (XO.S.blob.customWords || '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
    return custom.length ? custom.concat(XO.WORDS) : XO.WORDS;
  };
  XO.customWordsList = () => (XO.S.blob.customWords || '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
  const MODES = ['id', 'word', 'hex', 'wordnum', 'rand', 'conf'];

  function liveText(t, mode, box) {
    switch (mode) {
      case 'id': return 'OBJ ' + String(t.id).padStart(2, '0');
      case 'conf': return t.conf.toFixed(2);
      case 'coords': return 'X' + Math.round(box.mx) + ' Y' + Math.round(box.my);
      default: return null;
    }
  }
  function newTarget(t) {
    const s = XO.S.blob;
    let mode = s.labelMode === 'mixed' ? MODES[t.rolls % MODES.length] : s.labelMode;
    t.mode = mode;
    const custom = XO.customWordsList();
    const pickWord = () => (custom.length && Math.random() < 0.5 ? custom[(Math.random() * custom.length) | 0] : XO.wordBank()[(Math.random() * XO.wordBank().length) | 0]);
    let txt;
    if (mode === 'word') txt = pickWord();
    else if (mode === 'wordnum') txt = pickWord() + ' ' + String((Math.random() * 99) | 0).padStart(2, '0');
    else if (mode === 'rand') txt = String((Math.random() * 9999) | 0).padStart(4, '0');
    else if (mode === 'hex') txt = '0x' + ((Math.random() * 65535) | 0).toString(16).toUpperCase().padStart(4, '0');
    else txt = null; // live modes
    return txt;
  }
  function roll(t, now) {
    const s = XO.S.blob;
    t.rolls++;
    const target = newTarget(t);
    t.label = { target, shown: [], resolveAt: [], last: now };
    const len = target ? target.length : 10;
    for (let i = 0; i < len; i++) t.label.resolveAt[i] = now + s.resolve * ((i + 1) / len) * (0.6 + 0.4 * Math.random());
  }
  function labelText(t, box, now, dt, energy) {
    const s = XO.S.blob;
    if (!t.label) roll(t, now);
    const lab = t.label;
    const target = lab.target != null ? lab.target : liveText(t, t.mode, box) || '';
    const set = glyphSet();
    const rate = s.scrSpeed * (1 + 4 * energy * s.scrAudio / 100);
    const step = Math.random() < rate * dt;
    let out = '';
    for (let i = 0; i < target.length; i++) {
      const ch = target[i];
      if (ch === ' ') { out += ' '; continue; }
      if (lab.resolveAt[i] === undefined) lab.resolveAt[i] = now;
      // audio energy keeps knocking resolved characters back into scramble
      if (now >= lab.resolveAt[i] && energy > 0 && Math.random() < energy * s.scrAudio / 100 * dt * 6) lab.resolveAt[i] = now + 60 + Math.random() * 120;
      if (now < lab.resolveAt[i]) { if (step || !lab.shown[i] || lab.shown[i] === ch) lab.shown[i] = rndGlyph(set); out += lab.shown[i]; }
      else { lab.shown[i] = ch; out += ch; }
    }
    if (t.mode === 'conf' && energy > 0) { const j = (Math.random() - 0.5) * energy * 0.2; out = Math.max(0, Math.min(0.99, t.conf + j)).toFixed(2); }
    return s.upper ? out.toUpperCase() : out;
  }
  function scrambleAll(now, amount) { D.tracks.forEach((t) => { if (!t.label) return; t.label.resolveAt = t.label.resolveAt.map((r) => (Math.random() < amount ? now + XO.S.blob.resolve * Math.random() : r)); }); }

  /* ======================= reactions ======================= */
  const R = (XO.blobReact = { env: 0, hits: 0 });
  const ghosts = [];

  /* ======================= drawing ======================= */
  const scratch = document.createElement('canvas'), sctx = scratch.getContext('2d', { willReadFrequently: true });

  function shapePath(ctx, shape, b) {
    ctx.beginPath();
    const { x, y, w, h } = b;
    if (shape === 'circle' || shape === 'reticle' || shape === 'glow') { ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); }
    else if (shape === 'rounded') { const r = Math.min(w, h) * 0.22; if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
    else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const px = x + w / 2 + Math.cos(a) * w / 2, py = y + h / 2 + Math.sin(a) * h / 2; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
    else ctx.rect(x, y, w, h);
  }

  function applyStyle(ctx, style, b, src, shape, k, now, tint) {
    if (style === 'outline' || !src) return;
    const x = Math.round(b.x), y = Math.round(b.y), w = Math.max(2, Math.round(b.w)), h = Math.max(2, Math.round(b.h));
    ctx.save();
    shapePath(ctx, shape === 'brackets' || shape === 'cross' || shape === 'double' || shape === 'dashed' ? 'rect' : shape, b);
    ctx.clip();
    if (style === 'invert') { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); }
    else if (style === 'filled') { ctx.globalAlpha *= 0.4; ctx.fillStyle = tint; ctx.fillRect(x, y, w, h); }
    else if (style === 'tint') { ctx.globalCompositeOperation = 'color'; ctx.globalAlpha *= 0.85; ctx.fillStyle = tint; ctx.fillRect(x, y, w, h); }
    else if (style === 'pixel' || style === 'blur') {
      const f = style === 'pixel' ? Math.max(4, 9 * k) : Math.max(6, 14 * k);
      const sw = Math.max(1, Math.round(w / f)), sh = Math.max(1, Math.round(h / f));
      scratch.width = sw; scratch.height = sh; sctx.imageSmoothingEnabled = true; sctx.drawImage(src, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = style === 'blur'; ctx.drawImage(scratch, 0, 0, sw, sh, x, y, w, h); ctx.imageSmoothingEnabled = true;
      if (style === 'blur') { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, y, w, h); }
    } else if (style === 'zoom') {
      ctx.drawImage(src, x + w / 4, y + h / 4, w / 2, h / 2, x, y, w, h);
    } else if (style === 'threshold') {
      const sw = Math.min(w, 160), sh = Math.max(1, Math.round(h * sw / w));
      scratch.width = sw; scratch.height = sh; sctx.drawImage(src, x, y, w, h, 0, 0, sw, sh);
      const id = sctx.getImageData(0, 0, sw, sh), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8 > 128 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      sctx.putImageData(id, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(scratch, x, y, w, h); ctx.imageSmoothingEnabled = true;
    } else if (style === 'glitch') {
      const slices = 6, seed = Math.floor(now / 80);
      for (let i = 0; i < slices; i++) {
        const sy = y + (h * i) / slices, shh = h / slices + 1, off = (hash(seed * 31 + i + b.id) - 0.5) * w * 0.35;
        ctx.drawImage(src, x, sy, w, shh, x + off, sy, w, shh);
      }
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha *= 0.35; ctx.fillStyle = '#ff0040'; ctx.fillRect(x + 3 * k, y, w, h); ctx.fillStyle = '#00e5ff'; ctx.fillRect(x - 3 * k, y, w, h);
    }
    ctx.restore();
  }

  function strokeShape(ctx, shape, b, col, lw, k) {
    const { x, y, w, h } = b;
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    const brackets = (len, thick) => {
      ctx.lineWidth = thick; ctx.beginPath();
      [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => { ctx.moveTo(px + sx * len, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * len); });
      ctx.stroke(); ctx.lineWidth = lw;
    };
    const c = Math.min(w, h) * 0.25;
    switch (shape) {
      case 'brackets': brackets(c, lw * 2.2); return { bracketsDone: true };
      case 'cross': { const r = Math.min(w, h) / 2; ctx.beginPath(); ctx.moveTo(x + w / 2 - r, y + h / 2); ctx.lineTo(x + w / 2 + r, y + h / 2); ctx.moveTo(x + w / 2, y + h / 2 - r); ctx.lineTo(x + w / 2, y + h / 2 + r); ctx.stroke(); return { bracketsDone: true, noCross: true }; }
      case 'reticle': {
        shapePath(ctx, 'circle', b); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.18, h * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => { ctx.moveTo(x + w / 2 + dx * w * 0.5, y + h / 2 + dy * h * 0.5); ctx.lineTo(x + w / 2 + dx * w * 0.3, y + h / 2 + dy * h * 0.3); }); ctx.stroke();
        return { bracketsDone: true };
      }
      case 'double': ctx.strokeRect(x, y, w, h); ctx.strokeRect(x + 4 * k, y + 4 * k, w - 8 * k, h - 8 * k); break;
      case 'dashed': ctx.setLineDash([6 * k, 4 * k]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); break;
      case 'circle': case 'rounded': case 'hex': shapePath(ctx, shape, b); ctx.stroke(); return { bracketsDone: true };
      default: ctx.strokeRect(x, y, w, h);
    }
    brackets(c, lw * 2.4);
    return { bracketsDone: true };
  }

  const lerpHex = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * t))); return 'rgb(' + c.join(',') + ')'; };

  /**
   * Draw the HUD over the composited frame.
   * map(u,v) -> [x,y] canvas px for source-normalised coords; scale(w,h) -> [pw,ph]
   */
  XO.drawBlobs = function (ctx, W, H, map, scl, src, dt, now, audio) {
    const s = XO.S.blob, k = Math.min(W, H) / 720;
    smoothTracks(dt, now);
    if (!s.on) return { count: 0, main: null };
    const e = audio.energy(s.band);
    // band hit for this effect
    if (audio.trigger('blob', s.band, s.bandThr / 100, s.bandCooldown, now)) {
      R.env = 1; R.hits++;
      if (s.reroll) D.tracks.forEach((t) => roll(t, now));
      else if (s.rScramble > 0) scrambleAll(now, s.rScramble / 100);
      if (s.rScramble > 0 && s.reroll) scrambleAll(now, s.rScramble / 100);
      if (s.rGhost > 0) for (let g = 0; g < Math.ceil(s.rGhost / 20); g++) { const t = D.tracks[(Math.random() * D.tracks.length) | 0]; if (t) ghosts.push({ cx: t.cx + (Math.random() - 0.5) * 0.15, cy: t.cy + (Math.random() - 0.5) * 0.15, w: t.w * (0.6 + Math.random()), h: t.h * (0.6 + Math.random()), born: now }); }
    } else R.env *= Math.exp(-dt * 8);
    const env = R.env;

    const live = D.tracks.filter((t) => t.alpha > 0.02).sort((a, b) => b.n - a.n);
    const grow = (s.rGrow / 100) * (e * 0.6 + env * 0.4);
    const jit = (s.rJitter / 100) * (e * 0.6 + env * 0.6) * 14 * k;
    const boxes = [];
    live.forEach((t) => {
      const [mx, my] = map(t.cx, t.cy);
      const [bcx, bcy] = map(t.x + t.w / 2, t.y + t.h / 2);
      let [bw, bh] = scl(t.w, t.h);
      if (s.fixed) { bw = bh = s.fixedSize * k; }
      if (s.square || s.shape === 'square') { const m = Math.max(bw, bh); bw = bh = m; }
      const pad = s.padding * k;
      bw = Math.min(s.maxSize * k, Math.max(s.minSize * k, bw + pad * 2)); bh = Math.min(s.maxSize * k, Math.max(s.minSize * k, bh + pad * 2));
      bw *= 1 + grow; bh *= 1 + grow;
      const jx = jit ? (Math.random() - 0.5) * jit : 0, jy = jit ? (Math.random() - 0.5) * jit : 0;
      const cxp = (s.fixed ? mx : bcx) + jx, cyp = (s.fixed ? my : bcy) + jy;
      if (cxp < -bw || cxp > W + bw || cyp < -bh || cyp > H + bh) return;
      boxes.push({ t, id: t.id, x: cxp - bw / 2, y: cyp - bh / 2, w: bw, h: bh, mx: mx + jx, my: my + jy });
    });

    ctx.save();
    // link lines
    if (s.link !== 'none' && boxes.length > 1) {
      const edges = [];
      if (s.link === 'mst') {
        const inTree = [0], rest = boxes.map((_, i) => i).slice(1);
        while (rest.length) { let bi = -1, bj = -1, bd = 1e12; inTree.forEach((i) => rest.forEach((j) => { const d = (boxes[i].mx - boxes[j].mx) ** 2 + (boxes[i].my - boxes[j].my) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } })); edges.push([bi, bj]); inTree.push(bj); rest.splice(rest.indexOf(bj), 1); }
      } else if (s.link === 'chain') { const ord = boxes.map((b, i) => i).sort((a, b) => boxes[a].id - boxes[b].id); for (let i = 1; i < ord.length; i++) edges.push([ord[i - 1], ord[i]]); }
      else if (s.link === 'near') { boxes.forEach((b, i) => { boxes.map((c, j) => [j, (b.mx - c.mx) ** 2 + (b.my - c.my) ** 2]).filter(([j]) => j !== i).sort((a, c) => a[1] - c[1]).slice(0, 2).forEach(([j]) => { if (!edges.some(([a, c]) => (a === j && c === i))) edges.push([i, j]); }); }); }
      else if (s.link === 'center') for (let i = 1; i < boxes.length; i++) edges.push([0, i]);
      const pulse = (s.rLine / 100) * (e * 0.6 + env);
      ctx.strokeStyle = s.cLine; ctx.lineWidth = s.linkW * k * (1 + pulse * 1.5);
      ctx.globalAlpha = Math.min(1, s.linkOpacity / 100 * (1 + pulse));
      if (s.linkDash) ctx.setLineDash([6 * k, 5 * k]);
      ctx.beginPath(); edges.forEach(([i, j]) => { ctx.moveTo(boxes[i].mx, boxes[i].my); ctx.lineTo(boxes[j].mx, boxes[j].my); }); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // ghost boxes
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i], age2 = (now - g.born) / 380; if (age2 > 1) { ghosts.splice(i, 1); continue; }
      const [gx, gy] = map(g.cx, g.cy), [gw, gh] = scl(g.w, g.h);
      ctx.globalAlpha = (1 - age2) * 0.8; ctx.setLineDash([4 * k, 4 * k]); ctx.strokeStyle = s.cBox; ctx.lineWidth = s.lineW * k;
      ctx.strokeRect(gx - gw / 2, gy - gh / 2, Math.max(8 * k, gw), Math.max(8 * k, gh)); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    const fs = Math.max(7, Math.round(s.fontSize * k)), lw = Math.max(0.5, s.lineW * k);
    const placed = [];
    const overlaps = (r) => placed.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
    boxes.forEach((b, idx) => {
      const t = b.t, main = idx === 0;
      ctx.globalAlpha = t.alpha;
      let col = main && s.accentOn ? s.cAccent : s.cBox;
      const cshift = (s.rColor / 100) * (e * 0.7 + env * 0.5);
      if (cshift > 0.02) col = lerpHex(col.startsWith('#') ? col : s.cBox, s.cAccent, Math.min(1, cshift));
      const bracketCol = main && s.accentOn ? s.cAccent : s.cBracket;
      if (s.shape === 'glow') {
        const r = Math.max(b.w, b.h) / 2 * (1 + e * 0.3), g = ctx.createRadialGradient(b.mx, b.my, 2 * k, b.mx, b.my, r);
        g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.3, s.cTint + 'aa'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(b.mx, b.my, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        const styled = s.style !== 'outline' && hash(t.id) < s.styledPct / 100;
        const flash = s.styleFlash ? env : 0;
        if (styled) applyStyle(ctx, s.style, b, src, s.shape, k, now, s.cTint);
        else if (flash > 0.15 && s.style !== 'outline') { ctx.save(); ctx.globalAlpha = t.alpha * flash; applyStyle(ctx, s.style, b, src, s.shape, k, now, s.cTint); ctx.restore(); }
        if (s.rFlash > 0 && env > 0.05) { ctx.save(); ctx.globalAlpha = t.alpha * env * s.rFlash / 100; applyStyle(ctx, 'invert', b, src, s.shape, k, now, s.cTint); ctx.restore(); }
        const r = strokeShape(ctx, s.shape, b, col, lw, k);
        if (s.cBracket !== s.cBox && r.bracketsDone && ['rect', 'square', 'double', 'dashed'].includes(s.shape)) {
          const c = Math.min(b.w, b.h) * 0.25; ctx.strokeStyle = bracketCol; ctx.lineWidth = lw * 2.4; ctx.beginPath();
          [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]].forEach(([px, py, sx, sy]) => { ctx.moveTo(px + sx * c, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * c); }); ctx.stroke();
        }
        if (!r.noCross) {
          const ch = Math.max(4 * k, Math.min(b.w, b.h) * 0.12); ctx.strokeStyle = s.cCross; ctx.lineWidth = lw; ctx.beginPath();
          ctx.moveTo(b.mx - ch, b.my); ctx.lineTo(b.mx + ch, b.my); ctx.moveTo(b.mx, b.my - ch); ctx.lineTo(b.mx, b.my + ch); ctx.stroke();
        }
      }
      // label
      if (s.labelMode !== 'none') {
        const text = labelText(t, b, now, dt, e);
        if (text) {
          ctx.font = fs + 'px ' + MONO; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(text).width + fs * 0.8, th = fs * 1.45;
          let pos = s.labelPos === 'random' ? ['top', 'bottom', 'inside'][Math.floor(t.rp * 3)] : s.labelPos;
          let ly = pos === 'bottom' ? b.y + b.h : pos === 'inside' ? b.y + 2 * k : b.y - th;
          if (pos === 'top' && ly < 2) ly = b.y + b.h;
          const rect = { x: b.x, y: ly, w: tw, h: th };
          if (!overlaps(rect)) {
            placed.push(rect);
            ctx.fillStyle = main && s.accentOn ? s.cAccent : s.cLabelBg; ctx.fillRect(b.x, ly, tw, th);
            ctx.fillStyle = s.cLabelText; ctx.fillText(text, b.x + fs * 0.4, ly + th / 2 + 0.5);
            b.labelText = text;
          }
        }
      }
      if (s.coords && idx < 3) {
        ctx.fillStyle = col; ctx.font = Math.round(fs * 0.85) + 'px ' + MONO; ctx.textBaseline = 'middle';
        const jx = e > 0 && s.scrAudio > 0 ? Math.round((Math.random() - 0.5) * e * 6 * s.scrAudio / 100) : 0;
        ctx.fillText('X' + (Math.round(b.mx) + jx) + ' Y' + Math.round(b.my), b.x, b.y + b.h + fs * 0.8);
      }
    });
    ctx.globalAlpha = 1;
    if (s.readout) {
      ctx.font = Math.round(fs * 0.95) + 'px ' + MONO; ctx.textBaseline = 'top'; ctx.fillStyle = s.cBox; ctx.globalAlpha = 0.9;
      const bpm = audio.effectiveBpm ? Math.round(audio.effectiveBpm()) : 0;
      ctx.fillText('BLOB TRACK  ' + (D.count ? '● ACTIVE' : '○ SEARCHING') + '  OBJ ' + String(D.count).padStart(2, '0') + '  ' + s.detect.toUpperCase() + (audio.isPlaying() ? '  ' + bpm + ' BPM  ' + (s.band !== 'off' ? s.band.toUpperCase() + ' ' + Math.round(e * 100) : '') : ''), 22 * k, H - 34 * k);
    }
    ctx.restore();
    XO.lastBoxes = boxes;
    const m = boxes[0];
    return { count: D.count, main: m ? { x: m.mx / W, y: 1 - m.my / H } : null };
  };
})();
