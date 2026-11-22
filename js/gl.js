/* XO LAB — WebGL2 compositor: placement → background → depth of field → filter chain.
 * Output: G.canvas (same size as the stage canvas). Falls back to a 2D compositor without WebGL2.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const G = (XO.gl = { ok: false, canvas: null, maxSize: 4096, rect: { x: 0, y: 0, w: 1, h: 1 } });

  let gl, quadVao, W = 0, H = 0, srcTex, bgTex, atlasTex, lastSrc = null, lastSrcVer = -1, bgImgVer = -1;
  const progs = {}, rts = {}, inst = {};

  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv=aPos*.5+.5; gl_Position=vec4(aPos,0.,1.); }`;
  const HEAD = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uTime; uniform float uI; uniform float uA; uniform vec4 uP; uniform vec3 uC1, uC2, uC3;
in vec2 vUv; out vec4 o;
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x), f.y); }
vec4 S(vec2 uv){ return texture(uTex, uv); }
`;

  const FS = {
    copy: HEAD + `void main(){ o=S(vUv); }`,
    place: HEAD + `uniform vec4 uRect; void main(){ vec2 u=(vUv-uRect.xy)/uRect.zw; if(any(lessThan(u,vec2(0.)))||any(greaterThan(u,vec2(1.)))) { o=vec4(0.); return; } o=texture(uTex,u); }`,
    over: HEAD + `uniform sampler2D uBg; void main(){ vec4 a=S(vUv); vec4 b=texture(uBg,vUv); o=vec4(mix(b.rgb,a.rgb,a.a),1.); }`,
    blur: HEAD + `uniform vec2 uDir; void main(){ vec4 c=S(vUv)*.2270270; c+=(S(vUv+uDir*1.3846)+S(vUv-uDir*1.3846))*.3162162; c+=(S(vUv+uDir*3.2308)+S(vUv-uDir*3.2308))*.0702703; o=c; }`,
    bg: HEAD + `uniform int uMode; uniform int uStops; uniform int uRadial; uniform float uAngle; uniform vec4 uImgRect; uniform float uDark; uniform sampler2D uImg;
      void main(){
        if(uMode==0){ o=vec4(uC1,1.); return; }
        if(uMode==1){ float t; vec2 cc=vUv-.5; if(uRadial==1){ t=clamp(length(cc*vec2(uRes.x/uRes.y,1.))*1.4,0.,1.); } else { float a=radians(uAngle); vec2 d=vec2(cos(a),sin(a)); t=clamp(dot(cc,d)/(abs(d.x)*.5+abs(d.y)*.5)*.5+.5,0.,1.); }
          vec3 c = uStops==3 ? (t<.5?mix(uC1,uC2,t*2.):mix(uC2,uC3,t*2.-1.)) : mix(uC1,uC2,t); o=vec4(c,1.); return; }
        if(uMode==2){ vec2 u=(vUv-uImgRect.xy)/uImgRect.zw; if(any(lessThan(u,vec2(0.)))||any(greaterThan(u,vec2(1.)))) { o=vec4(uC1,1.); return; } o=vec4(texture(uImg,u).rgb,1.); return; }
        o=vec4(texture(uImg,vUv).rgb*(1.-uDark),1.);
      }`,
    dof: HEAD + `uniform sampler2D uB1; uniform sampler2D uB2; uniform vec2 uFocus; uniform float uSize, uFall, uAmt, uBokeh; uniform int uShape;
      void main(){ vec4 s=S(vUv); vec4 b1=texture(uB1,vUv), b2=texture(uB2,vUv); float d;
        if(uShape==0) d=length((vUv-uFocus)*vec2(uRes.x/uRes.y,1.)); else if(uShape==1) d=abs(vUv.y-uFocus.y); else d=abs(vUv.x-uFocus.x);
        float m=smoothstep(uSize, uSize+uFall, d)*uAmt;
        vec4 c=mix(s,b1,clamp(m*2.,0.,1.)); c=mix(c,b2,clamp(m*2.-1.,0.,1.));
        c.rgb+=max(b2.rgb-.55,0.)*uBokeh*m*3.; o=c; }`,
  };

  function compile(name, fsSrc) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ' link: ' + gl.getProgramInfoLog(p));
    const u = {}; p.u = (n) => (n in u ? u[n] : (u[n] = gl.getUniformLocation(p, n)));
    return p;
  }
  function prog(name) {
    if (progs[name]) return progs[name];
    let src = FS[name];
    if (!src) {
      const def = XO.FILTERS[name.slice(3)];
      let decl = '';
      if (def.atlas) decl += 'uniform sampler2D uAtlas; uniform float uAtlasN;\n';
      if (def.history) decl += 'uniform sampler2DArray uHist; uniform float uHistN, uHistHead;\n';
      if (def.feedback) decl += 'uniform sampler2D uPrev;\n';
      src = HEAD + decl + def.glsl + '\nvoid main(){ o=fx(vUv); }';
    }
    return (progs[name] = compile(name, src));
  }

  function tex(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function rt(w, h) { const t = tex(w, h), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f, w, h }; }
  function freeRt(r) { if (r) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.f); } }

  function draw(p, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    gl.uniform2f(p.u('uRes'), w, h);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function use(p) { gl.useProgram(p); return p; }
  function bindTex(p, name, t, unit, target) { gl.useProgram(p); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target || gl.TEXTURE_2D, t); gl.uniform1i(p.u(name), unit); }
  const hex3 = (h) => { const n = parseInt(String(h).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

  G.init = function () {
    G.canvas = document.createElement('canvas');
    G.canvas.width = 16; G.canvas.height = 16;
    try { gl = G.canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }); } catch (e) { gl = null; }
    if (!gl) { G.ok = false; G.canvas2d = G.canvas.getContext('2d'); return false; }
    try {
      quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      srcTex = tex(2, 2); bgTex = tex(2, 2);
      ['copy', 'place', 'over', 'blur', 'bg', 'dof'].forEach(prog);
      G.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
      G.ok = true;
    } catch (e) { console.warn('[XO LAB] WebGL2 init failed', e); G.ok = false; }
    G.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.ok = false; G.lost = true; });
    return G.ok;
  };

  function resize(w, h) {
    if (w === W && h === H) return;
    W = w; H = h; G.canvas.width = w; G.canvas.height = h;
    Object.values(rts).forEach(freeRt);
    rts.A = rt(w, h); rts.B = rt(w, h); rts.V = rt(w, h); rts.BG = rt(w, h);
    const hw = Math.max(8, w >> 1), hh = Math.max(8, h >> 1), qw = Math.max(8, w >> 2), qh = Math.max(8, h >> 2), ew = Math.max(8, w >> 3), eh = Math.max(8, h >> 3);
    rts.H1 = rt(hw, hh); rts.H2 = rt(hw, hh); rts.Q1 = rt(qw, qh); rts.Q2 = rt(qw, qh); rts.E1 = rt(ew, eh); rts.E2 = rt(ew, eh);
    Object.keys(inst).forEach((id) => freeInst(id));
  }
  function freeInst(id) { const s = inst[id]; if (!s) return; if (s.prev) freeRt(s.prev); if (s.hist) { gl.deleteTexture(s.hist); gl.deleteFramebuffer(s.histFb); } delete inst[id]; }

  function upload(t, source, flip) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // Where the visual sits in output uv space (bottom-left origin)
  G.computeRect = function (sw, sh, W2, H2, fit, zoom, posX, posY) {
    const ao = W2 / H2, as = sw / sh;
    let w = 1, h = 1;
    if (fit === 'fit') { if (as > ao) h = ao / as; else w = as / ao; }
    else if (fit === 'fill') { if (as > ao) w = as / ao; else h = ao / as; }
    w *= zoom; h *= zoom;
    const cx = 0.5 + posX * 0.5, cy = 0.5 + posY * 0.5;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };

  function atlas() {
    if (atlasTex) return atlasTex;
    const chars = ' .:-=+*#%@', cw = 24, ch = 40, c = document.createElement('canvas');
    c.width = cw * chars.length; c.height = ch;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff';
    x.font = 'bold 34px Menlo, Consolas, "DejaVu Sans Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    [...chars].forEach((chr, i) => x.fillText(chr, i * cw + cw / 2, ch / 2 + 1));
    atlasTex = tex(c.width, c.height); upload(atlasTex, c, false); G.atlasN = chars.length;
    return atlasTex;
  }

  /**
   * Render one frame. opts: { src, sw, sh, srcVersion, W, H, time, energy(band), focus:{x,y}|null }
   */
  G.render = function (o) {
    const S = XO.S;
    if (!G.ok) return render2D(o);
    resize(o.W, o.H);
    const zoom = S.media.zoom / 100, pos = [S.media.posX / 100, S.media.posY / 100];
    const hasSrc = !!(o.src && o.sw && o.sh);
    if (hasSrc && (o.src !== lastSrc || o.srcVersion !== lastSrcVer)) { upload(srcTex, o.src, true); lastSrc = o.src; lastSrcVer = o.srcVersion; }
    G.rect = hasSrc ? G.computeRect(o.sw, o.sh, W, H, o.is3D ? 'stretch' : S.media.fit, o.is3D ? 1 : zoom, o.is3D ? 0 : pos[0], o.is3D ? 0 : pos[1]) : { x: 0, y: 0, w: 0, h: 0 };

    // 1. visual → V (transparent where there's no picture)
    let p = use(prog('place'));
    bindTex(p, 'uTex', srcTex, 0);
    gl.uniform4f(p.u('uRect'), G.rect.x, G.rect.y, G.rect.w, G.rect.h);
    draw(p, rts.V, W, H);

    // 2. background → BG
    const bg = S.bg; p = use(prog('bg'));
    const mode = { solid: 0, gradient: 1, image: 2, blur: 3 }[bg.mode] || 0;
    let m = mode;
    if (mode === 2) {
      if (G.bgImage && G.bgImageVer !== bgImgVer) { upload(bgTex, G.bgImage, true); bgImgVer = G.bgImageVer; }
      if (!G.bgImage) m = 0;
      else { const r = G.computeRect(G.bgImage.width || G.bgImage.naturalWidth, G.bgImage.height || G.bgImage.naturalHeight, W, H, bg.imgFit, 1, 0, 0); gl.uniform4f(p.u('uImgRect'), r.x, r.y, r.w, r.h); bindTex(p, 'uImg', bgTex, 1); }
    }
    if (mode === 3) {
      if (!hasSrc) m = 0;
      else {
        // blurred, darkened copy of the visual filling the frame
        const pl = use(prog('place')); bindTex(pl, 'uTex', srcTex, 0);
        const fr = G.computeRect(o.sw, o.sh, W, H, 'fill', 1.06, 0, 0); gl.uniform4f(pl.u('uRect'), fr.x, fr.y, fr.w, fr.h);
        draw(pl, rts.E1, rts.E1.w, rts.E1.h);
        const passes = 1 + Math.round(bg.blur / 25), br = use(prog('blur'));
        for (let i = 0; i < passes; i++) {
          bindTex(br, 'uTex', rts.E1.t, 0); gl.uniform2f(br.u('uDir'), (1 + bg.blur / 40) / rts.E1.w, 0); draw(br, rts.E2, rts.E2.w, rts.E2.h);
          bindTex(br, 'uTex', rts.E2.t, 0); gl.uniform2f(br.u('uDir'), 0, (1 + bg.blur / 40) / rts.E1.h); draw(br, rts.E1, rts.E1.w, rts.E1.h);
        }
        p = use(prog('bg')); bindTex(p, 'uImg', rts.E1.t, 1); gl.uniform1f(p.u('uDark'), bg.darken / 100);
      }
    }
    gl.useProgram(p);
    // the sampler must never point at the target (feedback loop) — park it on the bg image texture
    if (m === 0 || m === 1) bindTex(p, 'uImg', bgTex, 1);
    gl.uniform1i(p.u('uMode'), m); gl.uniform1i(p.u('uStops'), +bg.gStops); gl.uniform1i(p.u('uRadial'), bg.gType === 'radial' ? 1 : 0); gl.uniform1f(p.u('uAngle'), bg.gAngle);
    const c1 = hex3(m === 1 ? bg.g1 : bg.color), c2 = hex3(bg.g2), c3 = hex3(bg.g3);
    gl.uniform3f(p.u('uC1'), c1[0], c1[1], c1[2]); gl.uniform3f(p.u('uC2'), c2[0], c2[1], c2[2]); gl.uniform3f(p.u('uC3'), c3[0], c3[1], c3[2]);
    draw(p, rts.BG, W, H);

    // ping-pong helper
    let cur = rts.V;
    const next = () => (cur === rts.A ? rts.B : rts.A);
    if (S.bg.filterBg) { const n = next(); p = use(prog('over')); bindTex(p, 'uTex', cur.t, 0); bindTex(p, 'uBg', rts.BG.t, 1); draw(p, n, W, H); cur = n; }

    // 3. depth of field
    if (S.dof.on && hasSrc) {
      const cp = use(prog('copy')), br = use(prog('blur'));
      bindTex(cp, 'uTex', cur.t, 0); draw(cp, rts.H1, rts.H1.w, rts.H1.h);
      const r1 = 1 + S.dof.amount / 50;
      bindTex(br, 'uTex', rts.H1.t, 0); gl.uniform2f(br.u('uDir'), r1 / rts.H1.w, 0); draw(br, rts.H2, rts.H2.w, rts.H2.h);
      bindTex(br, 'uTex', rts.H2.t, 0); gl.uniform2f(br.u('uDir'), 0, r1 / rts.H1.h); draw(br, rts.H1, rts.H1.w, rts.H1.h);
      bindTex(cp, 'uTex', rts.H1.t, 0); draw(cp, rts.Q1, rts.Q1.w, rts.Q1.h);
      const r2 = 1.5 + S.dof.amount / 30;
      for (let i = 0; i < 2; i++) {
        bindTex(br, 'uTex', rts.Q1.t, 0); gl.uniform2f(br.u('uDir'), r2 / rts.Q1.w, 0); draw(br, rts.Q2, rts.Q2.w, rts.Q2.h);
        bindTex(br, 'uTex', rts.Q2.t, 0); gl.uniform2f(br.u('uDir'), 0, r2 / rts.Q1.h); draw(br, rts.Q1, rts.Q1.w, rts.Q1.h);
      }
      const n = next(); p = use(prog('dof'));
      bindTex(p, 'uTex', cur.t, 0); bindTex(p, 'uB1', rts.H1.t, 1); bindTex(p, 'uB2', rts.Q1.t, 2);
      const f = o.focus && S.dof.follow ? o.focus : { x: S.dof.fx / 100, y: 1 - S.dof.fy / 100 };
      G.focusUsed = f;
      gl.uniform2f(p.u('uFocus'), f.x, f.y); gl.uniform1f(p.u('uSize'), S.dof.size / 200); gl.uniform1f(p.u('uFall'), Math.max(0.005, S.dof.falloff / 200));
      gl.uniform1f(p.u('uAmt'), S.dof.amount / 100); gl.uniform1f(p.u('uBokeh'), S.dof.bokeh / 100); gl.uniform1i(p.u('uShape'), { circle: 0, hband: 1, vband: 2 }[S.dof.shape] || 0);
      draw(p, n, W, H); cur = n;
    }

    // 4. filter chain
    const stack = S.fx.stack, solo = stack.find((f) => f.solo && f.on);
    const live = new Set();
    G.fxError = null;
    stack.forEach((f) => {
      live.add(f.id);
      if (!f.on || (solo && f !== solo)) return;
      const def = XO.FILTERS[f.type]; if (!def) return;
      let fp;
      try { fp = prog('fx_' + f.type); } catch (e) { G.fxError = e.message; return; }
      const n = next(), st = inst[f.id] || (inst[f.id] = {});
      const e = o.energy(f.band) * f.amt / 100;
      const I = Math.min(2, f.intensity / 100 + e);
      if (def.history) {
        const hw = Math.min(W, 640), hh = Math.max(8, Math.round(hw * H / W)), N = 24;
        if (!st.hist || st.hw !== hw || st.hh !== hh) {
          if (st.hist) { gl.deleteTexture(st.hist); gl.deleteFramebuffer(st.histFb); }
          st.hist = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, st.hist);
          gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, hw, hh, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          st.histFb = gl.createFramebuffer(); st.hw = hw; st.hh = hh; st.N = N; st.head = 0;
        }
        st.head = (st.head + 1) % st.N;
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.histFb);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, st.hist, 0, st.head);
        const cp = use(prog('copy')); bindTex(cp, 'uTex', cur.t, 0);
        gl.viewport(0, 0, hw, hh); gl.useProgram(cp); gl.uniform2f(cp.u('uRes'), hw, hh); gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (def.feedback && !st.prev) { st.prev = rt(W, H); gl.bindFramebuffer(gl.FRAMEBUFFER, st.prev.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.useProgram(fp);
      bindTex(fp, 'uTex', cur.t, 0);
      if (def.atlas) { bindTex(fp, 'uAtlas', atlas(), 1); gl.uniform1f(fp.u('uAtlasN'), G.atlasN); }
      if (def.history) { bindTex(fp, 'uHist', st.hist, 2, gl.TEXTURE_2D_ARRAY); gl.uniform1f(fp.u('uHistN'), st.N); gl.uniform1f(fp.u('uHistHead'), st.head); }
      if (def.feedback) bindTex(fp, 'uPrev', st.prev.t, 3);
      const pv = def.params.map((pd) => +f.params[pd.k]);
      gl.uniform4f(fp.u('uP'), pv[0] || 0, pv[1] || 0, pv[2] || 0, pv[3] || 0);
      gl.uniform1f(fp.u('uI'), I); gl.uniform1f(fp.u('uA'), e); gl.uniform1f(fp.u('uTime'), o.time);
      const cols = (def.colors || []).map((k) => hex3(XO.get(k)));
      ['uC1', 'uC2', 'uC3'].forEach((u, i) => { const v = cols[i] || [1, 1, 1]; gl.uniform3f(fp.u(u), v[0], v[1], v[2]); });
      draw(fp, n, W, H);
      if (def.feedback) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, n.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.prev.f); gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); }
      cur = n;
    });
    Object.keys(inst).forEach((id) => { if (!live.has(id)) freeInst(id); });

    // 5. visual over background (when filters were visual-only)
    if (!S.bg.filterBg) { const n = next(); p = use(prog('over')); bindTex(p, 'uTex', cur.t, 0); bindTex(p, 'uBg', rts.BG.t, 1); draw(p, n, W, H); cur = n; }

    // 6. present
    p = use(prog('copy')); bindTex(p, 'uTex', cur.t, 0); draw(p, null, W, H);
    return G.canvas;
  };

  G.resetSource = () => { lastSrc = null; lastSrcVer = -1; };
  G.setBgImage = (img) => { G.bgImage = img; G.bgImageVer = (G.bgImageVer || 0) + 1; };

  /* -------- 2D fallback (no WebGL2): background + placement only -------- */
  function render2D(o) {
    const S = XO.S, c = G.canvas;
    if (!G.canvas2d) G.canvas2d = c.getContext('2d');
    const x = G.canvas2d;
    if (c.width !== o.W || c.height !== o.H) { c.width = o.W; c.height = o.H; }
    const w = o.W, h = o.H;
    if (S.bg.mode === 'gradient') {
      const g = S.bg.gType === 'radial' ? x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7) : (() => { const a = S.bg.gAngle * Math.PI / 180; return x.createLinearGradient(w / 2 - Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2, w / 2 + Math.cos(a) * w / 2, h / 2 - Math.sin(a) * h / 2); })();
      g.addColorStop(0, S.bg.g1); if (S.bg.gStops === '3') g.addColorStop(0.5, S.bg.g2); g.addColorStop(1, S.bg.gStops === '3' ? S.bg.g3 : S.bg.g2);
      x.fillStyle = g;
    } else x.fillStyle = S.bg.color;
    x.fillRect(0, 0, w, h);
    if (S.bg.mode === 'image' && G.bgImage) { const r = G.computeRect(G.bgImage.naturalWidth || G.bgImage.width, G.bgImage.naturalHeight || G.bgImage.height, w, h, S.bg.imgFit, 1, 0, 0); x.drawImage(G.bgImage, r.x * w, (1 - r.y - r.h) * h, r.w * w, r.h * h); }
    if (o.src && o.sw && o.sh) {
      const r = G.rect = G.computeRect(o.sw, o.sh, w, h, o.is3D ? 'stretch' : S.media.fit, o.is3D ? 1 : S.media.zoom / 100, o.is3D ? 0 : S.media.posX / 100, o.is3D ? 0 : S.media.posY / 100);
      x.drawImage(o.src, r.x * w, (1 - r.y - r.h) * h, r.w * w, r.h * h);
    }
    return c;
  }
})();
