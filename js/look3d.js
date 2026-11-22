/* XO LAB — 3D look: motion system, chrome / brushed metal / liquid mercury materials,
 * generated reflection environments (offline, nothing downloaded) and 3D scene effects.
 * Everything here is driven by the frame's dt / now / audio values only, so a fixed-timestep
 * offline render produces the same motion as the live preview.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const L = (XO.look3d = { envKey: '', envTex: null, envCache: {}, fx: null, mo: null });
  const M = () => XO.model;

  /* =============================== motion =============================== */
  // id, label, kind ('loop' = continuous, 'hit' = fires on a band hit), default band
  L.MOTIONS = [
    ['Float', 'Float / bob', 'loop', 'off'],
    ['Breathe', 'Breathe (slow scale)', 'loop', 'off'],
    ['Jelly', 'Jelly squash & stretch', 'loop', 'mid'],
    ['Sway', 'Sway (rock side to side)', 'loop', 'off'],
    ['Orbit', 'Orbit path', 'loop', 'off'],
    ['Tumble', 'Tumble (random axis)', 'loop', 'off'],
    ['Bounce', 'Beat bounce', 'hit', 'bass'],
    ['Kick', 'Spin kick', 'hit', 'bass'],
    ['Glitch', 'Glitch jitter', 'hit', 'high'],
    ['CamOrbit', 'Camera orbit', 'loop', 'off'],
    ['CamDolly', 'Dolly zoom on drops', 'hit', 'bass'],
    ['CamShake', 'Camera shake', 'hit', 'bass'],
  ];
  L.motionDefaults = function () {
    const d = { spinAxis: 'y', spinDir: 'cw', spinSpeed: 35, spinBand: 'off', inertia: true, orbitPath: 'circle' };
    L.MOTIONS.forEach(([id, , , band]) => { d['m' + id] = false; d['m' + id + 'Amt'] = 45; d['m' + id + 'Spd'] = 40; d['m' + id + 'Band'] = band; });
    return d;
  };
  // presets only touch motion keys
  const P = (o) => o;
  L.MOTION_PRESETS = {
    STILL: P({}),
    CHILL: P({ spin: true, spinSpeed: 18, mFloat: true, mFloatAmt: 35, mFloatSpd: 22, mBreathe: true, mBreatheAmt: 25, mBreatheSpd: 18, mCamOrbit: true, mCamOrbitAmt: 25, mCamOrbitSpd: 12 }),
    CLUB: P({ spin: true, spinSpeed: 35, spinBand: 'mid', mBounce: true, mBounceAmt: 55, mBounceBand: 'bass', mFloat: true, mFloatAmt: 25, mCamShake: true, mCamShakeAmt: 25, mCamShakeBand: 'bass' }),
    PEAK: P({ spin: true, spinSpeed: 55, spinBand: 'full', mBounce: true, mBounceAmt: 70, mKick: true, mKickAmt: 60, mKickBand: 'bass', mJelly: true, mJellyAmt: 45, mJellyBand: 'mid', mCamOrbit: true, mCamOrbitAmt: 40, mCamOrbitSpd: 30, mCamShake: true, mCamShakeAmt: 45, mCamDolly: true, mCamDollyAmt: 50 }),
    GLITCH: P({ spin: true, spinSpeed: 25, mGlitch: true, mGlitchAmt: 70, mGlitchBand: 'high', mJelly: true, mJellyAmt: 35, mJellySpd: 75, mTumble: true, mTumbleAmt: 40, mCamShake: true, mCamShakeAmt: 55, mCamShakeBand: 'bass' }),
  };
  L.applyMotionPreset = function (name) {
    const S = XO.S.model, base = L.motionDefaults(), p = L.MOTION_PRESETS[name] || {};
    Object.assign(S, base, { spin: false }, p);
  };

  function moState() {
    if (!L.mo) L.mo = { ph: {}, kickVel: 0, kickAng: 0, bounce: 0, glitchUntil: 0, glitch: [0, 0, 0, 0, 0], dolly: 0, shake: 0, shakeV: [0, 0, 0], spinAng: 0, vX: 0, vY: 0 };
    return L.mo;
  }
  L.resetMotion = function () { L.mo = null; };
  // integrate a phase so changing speed never makes the motion jump
  function phase(mo, key, speed, dt) { mo.ph[key] = (mo.ph[key] || 0) + speed * dt; return mo.ph[key]; }
  const smooth = (x) => x * x * (3 - 2 * x);
  function vnoise(t, seed) { // smooth 1-D value noise in -1..1
    const i = Math.floor(t), f = t - i, h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    return h(i) + (h(i + 1) - h(i)) * smooth(f);
  }

  /** Applies all motion to the pivot and camera. Called once per rendered frame. */
  L.motion = function (dt, now, time) {
    const m = M(), S = XO.S.model, A = XO.audio, mo = moState(), THREE = m.THREE;
    const amt = (id) => S['m' + id + 'Amt'] / 100, spd = (id) => S['m' + id + 'Spd'] / 100;
    const drive = (id) => { const b = S['m' + id + 'Band']; return b && b !== 'off' ? A.energy(b) : 0; };
    const on = (id) => !!S['m' + id];
    const hit = (id, thr, cool) => { const b = S['m' + id + 'Band']; return b && b !== 'off' && A.trigger('mo' + id, b, thr, cool, now); };

    // ---- user drag + inertia ----
    if (!m.dragging && S.inertia) { m.rotY += mo.vY * dt * 60; m.rotX += mo.vX * dt * 60; const k = Math.exp(-dt * 2.6); mo.vY *= k; mo.vX *= k; }
    else if (!S.inertia) { mo.vX = mo.vY = 0; }

    // ---- auto spin ----
    if (S.spin) {
      const e = S.spinBand !== 'off' ? A.energy(S.spinBand) : 0;
      mo.spinAng += dt * (0.15 + S.spinSpeed / 100 * 2.4) * (1 + e * 2) * (S.spinDir === 'ccw' ? -1 : 1);
    }
    let rx = m.rotX, ry = m.rotY, rz = 0;
    const ax = S.spinAxis;
    if (ax === 'y') ry += mo.spinAng; else if (ax === 'x') rx += mo.spinAng; else if (ax === 'z') rz += mo.spinAng; else { ry += mo.spinAng; rx += mo.spinAng * 0.6; }

    let px = 0, py = 0, pz = 0, sx = 1, sy = 1, sz = 1;
    if (on('Float')) { const a = amt('Float') * (1 + drive('Float') * 1.5), t = phase(mo, 'float', 0.4 + spd('Float') * 2.6, dt); py += Math.sin(t) * 0.22 * a; px += Math.sin(t * 0.53) * 0.06 * a; }
    if (on('Breathe')) { const a = amt('Breathe') * (1 + drive('Breathe') * 1.5), t = phase(mo, 'breathe', 0.25 + spd('Breathe') * 1.8, dt); const b = 1 + Math.sin(t) * 0.12 * a; sx *= b; sy *= b; sz *= b; }
    if (on('Jelly')) { const a = amt('Jelly') * (0.35 + drive('Jelly') * 1.6), t = phase(mo, 'jelly', 2 + spd('Jelly') * 14, dt); const j = Math.sin(t) * 0.16 * a; sy *= 1 + j; sx *= 1 - j * 0.5; sz *= 1 - j * 0.5; }
    if (on('Sway')) { const a = amt('Sway') * (1 + drive('Sway') * 1.5), t = phase(mo, 'sway', 0.5 + spd('Sway') * 3, dt); rz += Math.sin(t) * 0.45 * a; }
    if (on('Orbit')) {
      const a = amt('Orbit') * (1 + drive('Orbit')), t = phase(mo, 'orbit', 0.2 + spd('Orbit') * 2.2, dt), r = 0.75 * a;
      if (S.orbitPath === 'eight') { px += Math.sin(t) * r; py += Math.sin(t * 2) * r * 0.35; pz += Math.cos(t) * r * 0.4; }
      else { px += Math.sin(t) * r; pz += Math.cos(t) * r * 0.6; }
    }
    if (on('Tumble')) { const a = amt('Tumble') * (1 + drive('Tumble') * 1.5), t = phase(mo, 'tumble', 0.1 + spd('Tumble') * 0.9, dt); rx += vnoise(t, 1) * 1.6 * a; ry += vnoise(t, 2) * 1.6 * a; rz += vnoise(t, 3) * 0.9 * a; }

    // ---- hit-driven ----
    if (on('Bounce') && hit('Bounce', 0.72, 110)) mo.bounce = 1;
    mo.bounce *= Math.exp(-dt * (4 + spd('Bounce') * 12));
    if (on('Bounce')) { const b = mo.bounce, el = Math.sin((1 - b) * Math.PI * 3) * b * 0.25; const s = 1 + (b * 0.32 + el) * amt('Bounce'); sx *= s; sy *= s; sz *= s; }
    if (on('Kick') && hit('Kick', 0.75, 180)) mo.kickVel += (3 + spd('Kick') * 9) * amt('Kick');
    mo.kickAng += mo.kickVel * dt; mo.kickVel *= Math.exp(-dt * 3.2);
    ry += mo.kickAng;
    if (on('Glitch') && hit('Glitch', 0.7, 60)) {
      const a = amt('Glitch'); mo.glitchUntil = now + 50 + spd('Glitch') * 120;
      mo.glitch = [(Math.random() - 0.5) * 0.5 * a, (Math.random() - 0.5) * 0.35 * a, 0, (Math.random() - 0.5) * 0.9 * a, (Math.random() - 0.5) * 0.9 * a];
    }
    if (on('Glitch') && now < mo.glitchUntil) { px += mo.glitch[0]; py += mo.glitch[1]; rx += mo.glitch[3]; ry += mo.glitch[4]; }

    m.pivot.rotation.set(rx, ry, rz);
    m.pivot.position.set(px, py, pz);
    const bs = m.baseScale || 1;
    m.pivot.scale.set(bs * sx, bs * sy, bs * sz);

    // ---- camera ----
    const cam = m.camera;
    let dist = 4 / m.zoom, fov = 34;
    let cx = 0, cy = 0, cz = dist;
    if (on('CamOrbit')) {
      const a = amt('CamOrbit') * (1 + drive('CamOrbit')), t = phase(mo, 'cam', 0.08 + spd('CamOrbit') * 0.9, dt);
      const ang = Math.sin(t) * Math.PI * 0.9 * a, tilt = Math.sin(t * 0.7) * 0.5 * a;
      cx = Math.sin(ang) * dist; cz = Math.cos(ang) * dist; cy = Math.sin(tilt) * dist * 0.6;
    }
    if (on('CamDolly') && hit('CamDolly', 0.85, 900)) mo.dolly = 1;
    mo.dolly *= Math.exp(-dt * (1.2 + spd('CamDolly') * 3));
    if (on('CamDolly') && mo.dolly > 0.001) {
      // vertigo: move in while widening the lens so the object keeps its size
      const k = mo.dolly * amt('CamDolly'), f = 1 - 0.45 * k;
      cx *= f; cy *= f; cz *= f;
      fov = 2 * Math.atan(Math.tan((34 * Math.PI / 180) / 2) / f) * 180 / Math.PI;
    }
    if (on('CamShake') && hit('CamShake', 0.72, 90)) { mo.shake = 1; mo.shakeV = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]; }
    mo.shake *= Math.exp(-dt * (6 + spd('CamShake') * 14));
    let lx = 0, ly = 0;
    if (on('CamShake') && mo.shake > 0.002) {
      const k = mo.shake * amt('CamShake') * 0.22, w = Math.sin(now * 0.09);
      cx += mo.shakeV[0] * k * w; cy += mo.shakeV[1] * k * w; lx = mo.shakeV[2] * k * 0.4; ly = -mo.shakeV[0] * k * 0.3;
    }
    cam.position.set(cx, cy, cz);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.lookAt(lx, ly, 0);
  };
  L.dragVelocity = function (dx, dy) { const mo = moState(); mo.vY = dx * 0.009; mo.vX = dy * 0.009; };
  L.stopInertia = function () { const mo = moState(); mo.vX = mo.vY = 0; };

  /* ===================== reflection environments ===================== */
  function envScene(kind) {
    const THREE = M().THREE, scene = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
    scene.add(room);
    const light = (w, h, color, k, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); else m.lookAt(0, 0, 0); scene.add(m);
    };
    if (kind === 'studio') {
      room.material.color.set(0x2a2a2a);
      light(6, 4, 0xffffff, 9, [0, 5.8, 0], [Math.PI / 2, 0, 0]);
      light(3, 5, 0xffffff, 6, [-5.8, 1, 1]); light(3, 5, 0xffffff, 4, [5.8, 0.5, -1]);
      light(8, 0.6, 0xffffff, 3, [0, -1, -5.8]); light(2, 2, 0xffffff, 5, [2, 2, 5.8]);
    } else if (kind === 'neon') {
      room.material.color.set(0x050208);
      light(0.25, 9, 0xff2bd6, 12, [-5.5, 0, -2]); light(0.25, 9, 0x00e5ff, 12, [5.5, 0, -2]);
      light(9, 0.25, 0x7a2bff, 9, [0, 5.5, 0], [Math.PI / 2, 0, 0]); light(0.3, 7, 0x00e5ff, 7, [-2, 0, 5.8]); light(0.3, 7, 0xff2bd6, 7, [2.5, 0, 5.8]);
      light(9, 0.2, 0xffffff, 4, [0, -5, -5.8]);
    } else if (kind === 'club') {
      room.material.color.set(0x020202);
      light(1.2, 1.2, 0xff1f3d, 9, [-4, 4, 3]); light(1.2, 1.2, 0x2b5bff, 9, [4, 3.5, -3]); light(0.9, 0.9, 0xffffff, 7, [0, 5.8, 0], [Math.PI / 2, 0, 0]);
      light(10, 0.1, 0xffffff, 3, [0, 1, -5.9]); light(0.8, 0.8, 0xffb300, 6, [3, -3, 4]);
    } else { // sunset
      const g = new THREE.SphereGeometry(6, 32, 16), cols = [], pos = g.attributes.position, c = new THREE.Color();
      const top = new THREE.Color(0x2b0b4a), mid = new THREE.Color(0xff5a2b), hor = new THREE.Color(0xffc46b), bot = new THREE.Color(0x0a0612);
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 6; if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.85)); else if (y > -0.05) c.copy(hor).lerp(mid, (y + 0.05) / 0.2); else c.copy(bot).lerp(hor, Math.max(0, 1 + y / 0.3) * 0.3); cols.push(c.r * 2.2, c.g * 2.2, c.b * 2.2); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      scene.remove(room); scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const sun = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd28a).multiplyScalar(14) }));
      sun.position.set(-3, 0.6, -5); sun.lookAt(0, 0, 0); scene.add(sun);
    }
    return scene;
  }
  L.envTexture = function (kind) {
    const m = M();
    if (L.envCache[kind]) return L.envCache[kind];
    const THREE = m.THREE, pm = new THREE.PMREMGenerator(m.renderer);
    const scene = envScene(kind);
    const rt = pm.fromScene(scene, 0.035);
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pm.dispose();
    L.envCache[kind] = rt.texture;
    return rt.texture;
  };
  L.disposeEnvs = function () { Object.values(L.envCache).forEach((t) => t.dispose()); L.envCache = {}; };

  /* ===================== metal / liquid material ===================== */
  const NOISE = `
    vec3 xoMod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 xoMod289(vec4 x){return x-floor(x*(1./289.))*289.;}
    vec4 xoPerm(vec4 x){return xoMod289(((x*34.)+1.)*x);} vec4 xoTis(vec4 r){return 1.79284291400159-.85373472095314*r;}
    float xoSnoise(vec3 v){ const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
      vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx); vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=xoMod289(i);
      vec4 p=xoPerm(xoPerm(xoPerm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
      float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
      vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.)); vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=xoTis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
      return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3))); }
    float xoField(vec3 q){ vec3 s=q*xoScale+xoFlow*xoTime; return xoSnoise(s)*.62+xoSnoise(s*2.07+vec3(7.1,1.3,4.7))*.28+xoSnoise(s*4.3-vec3(3.7))*.1; }
  `;
  // shared uniforms (all metal materials read the same objects)
  const U = { xoTime: { value: 0 }, xoScale: { value: 1 }, xoAmp: { value: 0 }, xoFlow: { value: null }, xoRim: { value: 0 }, xoRimColor: { value: null } };
  L.isMetal = (key) => key === 'mchrome' || key === 'brushed' || key === 'mercury';

  L.makeMetal = function (key, mesh) {
    const THREE = M().THREE, S = XO.S.model;
    if (!U.xoFlow.value) { U.xoFlow.value = new THREE.Vector3(); U.xoRimColor.value = new THREE.Color(); }
    const mat = new THREE.MeshPhysicalMaterial({ color: S.cSolid, metalness: 1, roughness: 0.05 });
    mat.userData.metal = key;
    mesh.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3(); mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    const k = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    const liquid = key === 'mercury';
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { xoK: { value: k } });
      const decl = 'uniform float xoTime, xoScale, xoAmp, xoK; uniform vec3 xoFlow; float xoDisp = 0.;\n' + (liquid ? NOISE : '');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + decl);
      if (liquid) {
        sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          { vec3 xoP = position * xoK; vec3 xoN = normalize(objectNormal);
            vec3 xoT = normalize(abs(xoN.y) < .99 ? cross(xoN, vec3(0.,1.,0.)) : cross(xoN, vec3(1.,0.,0.))); vec3 xoB = cross(xoN, xoT);
            float xoE = .012; float h0 = xoField(xoP) * xoAmp, h1 = xoField(xoP + xoT * xoE) * xoAmp, h2 = xoField(xoP + xoB * xoE) * xoAmp;
            vec3 p0 = xoP + xoN * h0, p1 = xoP + xoT * xoE + xoN * h1, p2 = xoP + xoB * xoE + xoN * h2;
            objectNormal = normalize(cross(p1 - p0, p2 - p0)); xoDisp = h0 / xoK; }`);
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * xoDisp;');
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float xoRim; uniform vec3 xoRimColor;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `{ vec3 xoV = normalize(vViewPosition); float xoF = pow(1. - abs(dot(normalize(normal), xoV)), 3.); gl_FragColor.rgb += xoRimColor * xoF * xoRim; }
        #include <dithering_fragment>`);
    };
    mat.customProgramCacheKey = () => 'xo-metal-' + (liquid ? 'liquid' : 'solid');
    return mat;
  };

  // per-frame update of every metal material + the liquid flow
  L.updateMetal = function (dt, root) {
    const S = XO.S.model, A = XO.audio, THREE = M().THREE;
    const key = S.material; if (!L.isMetal(key)) return;
    const env = L.envTexture(S.env || 'studio');
    const e = S.liqBand && S.liqBand !== 'off' ? A.energy(S.liqBand) : 0;
    L.flowT = (L.flowT || 0) + dt * (0.05 + S.flowSpeed / 100 * 1.6) * (1 + e * S.liqAmt / 100 * 2);
    U.xoTime.value = L.flowT;
    U.xoScale.value = 0.6 + S.flowScale / 100 * 4.5;
    U.xoAmp.value = key === 'mercury' ? (0.02 + S.wave / 100 * 0.22) * (1 + e * S.liqAmt / 100 * 2.2) : 0;
    const dir = S.drip === 'down' ? [0, 1, 0] : S.drip === 'up' ? [0, -1, 0] : S.drip === 'wind' ? [-1, 0.2, 0] : [0.3, 0.2, 0.15];
    U.xoFlow.value.set(dir[0], dir[1], dir[2]);
    U.xoRim.value = S.rim / 100 * 1.6;
    U.xoRimColor.value.set(S.cRim);
    const rough = key === 'brushed' ? 0.3 + S.rough / 100 * 0.5 : S.rough / 100;
    root.traverse((o) => {
      if (!o.isMesh || o.userData.isWire) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (!m.userData.metal) return;
        m.envMap = env; m.envMapIntensity = S.envInt / 100 * 2.2;
        m.metalness = S.metal / 100; m.roughness = rough;
        m.color.set(S.cSolid);
        m.clearcoat = S.clearcoat / 100; m.clearcoatRoughness = 0.08;
        m.iridescence = S.irid ? 1 : 0; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 520];
        m.anisotropy = 0; // anisotropy needs UV tangents most imported models don't have (renders white)
      });
    });
  };

  /* --------- subdivision so low-poly models flow smoothly as liquid --------- */
  const CAPS = { low: 20000, med: 60000, high: 150000 };
  function smoothNormals(pos) {
    const n = pos.length / 3, map = new Map(), acc = new Float32Array(pos.length), out = new Float32Array(pos.length);
    const keyOf = (i) => Math.round(pos[i * 3] * 1e4) + ',' + Math.round(pos[i * 3 + 1] * 1e4) + ',' + Math.round(pos[i * 3 + 2] * 1e4);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = keyOf(i); let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } ids[i] = id; }
    const sum = new Float32Array(map.size * 3);
    for (let t = 0; t < n; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let j = 0; j < 3; j++) { const id = ids[t + j] * 3; sum[id] += nx; sum[id + 1] += ny; sum[id + 2] += nz; }
    }
    for (let i = 0; i < n; i++) { const id = ids[i] * 3, l = Math.hypot(sum[id], sum[id + 1], sum[id + 2]) || 1; out[i * 3] = sum[id] / l; out[i * 3 + 1] = sum[id + 1] / l; out[i * 3 + 2] = sum[id + 2] / l; }
    void acc; return out;
  }
  function subdivideOnce(pos, nor, uv) {
    const tris = pos.length / 9, P = new Float32Array(tris * 36), N = new Float32Array(tris * 36), T = uv ? new Float32Array(tris * 24) : null;
    let o = 0, ou = 0;
    const mid = (arr, a, b, d, out, oi) => { for (let k = 0; k < d; k++) out[oi + k] = (arr[a + k] + arr[b + k]) / 2; };
    for (let t = 0; t < tris; t++) {
      const i0 = t * 9, i1 = i0 + 3, i2 = i0 + 6, u0 = t * 6, u1 = u0 + 2, u2 = u0 + 4;
      const vp = [pos.slice(i0, i0 + 3), pos.slice(i1, i1 + 3), pos.slice(i2, i2 + 3)], vn = [nor.slice(i0, i0 + 3), nor.slice(i1, i1 + 3), nor.slice(i2, i2 + 3)];
      const mp = new Float32Array(9), mn = new Float32Array(9);
      mid(pos, i0, i1, 3, mp, 0); mid(pos, i1, i2, 3, mp, 3); mid(pos, i2, i0, 3, mp, 6);
      mid(nor, i0, i1, 3, mn, 0); mid(nor, i1, i2, 3, mn, 3); mid(nor, i2, i0, 3, mn, 6);
      for (let k = 0; k < 9; k += 3) { const l = Math.hypot(mn[k], mn[k + 1], mn[k + 2]) || 1; mn[k] /= l; mn[k + 1] /= l; mn[k + 2] /= l; }
      const m = [mp.slice(0, 3), mp.slice(3, 6), mp.slice(6, 9)], mN = [mn.slice(0, 3), mn.slice(3, 6), mn.slice(6, 9)];
      const faces = [[vp[0], m[0], m[2], vn[0], mN[0], mN[2]], [m[0], vp[1], m[1], mN[0], vn[1], mN[1]], [m[2], m[1], vp[2], mN[2], mN[1], vn[2]], [m[0], m[1], m[2], mN[0], mN[1], mN[2]]];
      faces.forEach((f) => { for (let k = 0; k < 3; k++) { P.set(f[k], o); N.set(f[k + 3], o); o += 3; } });
      if (T) {
        const tv = [uv.slice(u0, u0 + 2), uv.slice(u1, u1 + 2), uv.slice(u2, u2 + 2)], mt = new Float32Array(6);
        mid(uv, u0, u1, 2, mt, 0); mid(uv, u1, u2, 2, mt, 2); mid(uv, u2, u0, 2, mt, 4);
        const tm = [mt.slice(0, 2), mt.slice(2, 4), mt.slice(4, 6)];
        [[tv[0], tm[0], tm[2]], [tm[0], tv[1], tm[1]], [tm[2], tm[1], tv[2]], [tm[0], tm[1], tm[2]]].forEach((f) => f.forEach((v) => { T.set(v, ou); ou += 2; }));
      }
    }
    return [P, N, T];
  }
  /** Swaps meshes to a smoothed, subdivided copy (kept until the material changes back). */
  L.prepareLiquidGeometry = function (root) {
    const THREE = M().THREE, cap = CAPS[XO.S.model.quality] || CAPS.med;
    let total = 0; root.traverse((o) => { if (o.isMesh && !o.userData.isWire && o.geometry) total += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count); });
    root.traverse((o) => {
      if (!o.isMesh || o.userData.isWire || o.isSkinnedMesh || !o.geometry || o.userData.origGeo) return;
      if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      let pos = src.attributes.position.array, uv = src.attributes.uv ? src.attributes.uv.array : null;
      let nor = smoothNormals(pos);
      let count = pos.length / 3;
      const share = cap * (count / Math.max(1, total));
      while (count * 4 <= share && count < cap) { [pos, nor, uv] = subdivideOnce(pos, nor, uv); count = pos.length / 3; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      src.dispose();
      o.userData.origGeo = o.geometry; o.geometry = g;
    });
  };
  /** Smooth shading for chrome / brushed metal (faceted low-poly models look like crumpled foil otherwise). */
  L.prepareSmoothGeometry = function (root) {
    const THREE = M().THREE;
    root.traverse((o) => {
      if (!o.isMesh || o.userData.isWire || o.isSkinnedMesh || !o.geometry || o.userData.origGeo) return;
      if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      src.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(src.attributes.position.array), 3));
      o.userData.origGeo = o.geometry; o.geometry = src;
    });
  };
  L.restoreGeometry = function (root) {
    root.traverse((o) => { if (o.userData.origGeo) { o.geometry.dispose(); o.geometry = o.userData.origGeo; delete o.userData.origGeo; } });
  };

  /* =============================== scene effects =============================== */
  function buildFx() {
    const m = M(), THREE = m.THREE, g = new THREE.Group(); g.name = 'xo-scene-fx';
    const fx = { group: g };
    // starfield warp
    {
      const N = 2400, p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { let x, y; do { x = (Math.random() - 0.5) * 26; y = (Math.random() - 0.5) * 26; } while (Math.abs(x) < 1.4 && Math.abs(y) < 1.4); p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = -40 + Math.random() * 44; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      fx.stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      fx.stars.frustumCulled = false; g.add(fx.stars);
    }
    // floating motes
    {
      const N = 700, p = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++) { const r = 1.3 + Math.random() * 2.2, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1); p[i * 3] = r * Math.sin(b) * Math.cos(a); p[i * 3 + 1] = r * Math.cos(b); p[i * 3 + 2] = r * Math.sin(b) * Math.sin(a); seed[i] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      fx.motesBase = p.slice(); fx.motesSeed = seed;
      fx.motes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      fx.motes.frustumCulled = false; g.add(fx.motes);
    }
    // spectrum ring
    {
      const N = 64, geo = new THREE.BoxGeometry(0.035, 1, 0.035); geo.translate(0, 0.5, 0);
      fx.ring = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), N);
      fx.ringN = N; fx.ring.frustumCulled = false; g.add(fx.ring);
    }
    // retro grid floor
    {
      // kept entirely in front of the camera (lines that cross behind it get dropped on some GPUs)
      const size = 40, div = 40, cell = size / div, zFar = -40, zNear = 2, pts = [];
      for (let i = 0; i <= div; i++) { const x = -size / 2 + cell * i; pts.push(x, 0, zFar, x, 0, zNear); }
      for (let z = zFar; z <= zNear + 1e-6; z += cell) pts.push(-size / 2, 0, z, size / 2, 0, z);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      fx.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
      fx.grid.position.y = -1.35; fx.gridCell = cell; fx.grid.frustumCulled = false; g.add(fx.grid);
    }
    // lasers
    {
      fx.lasers = new THREE.Group(); const N = 10;
      const geo = new THREE.CylinderGeometry(0.012, 0.012, 30, 6, 1, true); geo.translate(0, 15, 0);
      fx.laserMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < N; i++) { const b = new THREE.Mesh(geo, fx.laserMat); b.rotation.z = -Math.PI / 2 + (i / (N - 1) - 0.5) * 2.4; b.frustumCulled = false; fx.lasers.add(b); }
      fx.lasers.position.set(0, -0.4, -5); g.add(fx.lasers);
    }
    fx.laserEnv = 0;
    m.scene.add(g);
    return fx;
  }
  L.sceneFx = function (dt, now, time) {
    const m = M(), S = XO.S.scene, A = XO.audio, THREE = m.THREE;
    if (!S) return;
    const any = S.stars || S.motes || S.ring || S.grid || S.lasers || S.fog;
    if (!any && !L.fx) return;
    if (!L.fx) L.fx = buildFx();
    const fx = L.fx, en = (b) => (b && b !== 'off' ? A.energy(b) : 0);
    // stars
    fx.stars.visible = !!S.stars;
    if (S.stars) {
      const e = en(S.starsBand), v = (1 + S.starsSpeed / 100 * 22) * (1 + e * 3) * dt, p = fx.stars.geometry.attributes.position, a = p.array, camZ = m.camera.position.z;
      for (let i = 2; i < a.length; i += 3) { a[i] += v; if (a[i] > camZ + 1) a[i] -= 44; }
      p.needsUpdate = true; fx.stars.material.color.set(S.cStars); fx.stars.material.size = 0.05 + e * 0.06 + S.starsSpeed / 100 * 0.04;
    }
    // motes
    fx.motes.visible = !!S.motes;
    if (S.motes) {
      const e = en(S.motesBand), p = fx.motes.geometry.attributes.position.array, b = fx.motesBase, sd = fx.motesSeed, k = 1 + e * 0.6;
      L.moteT = (L.moteT || 0) + dt * (0.3 + e);
      for (let i = 0; i < sd.length; i++) { const s = sd[i] * 6.28, t = L.moteT; p[i * 3] = b[i * 3] * k + Math.sin(t + s) * 0.12; p[i * 3 + 1] = b[i * 3 + 1] * k + Math.cos(t * 0.8 + s * 1.3) * 0.12; p[i * 3 + 2] = b[i * 3 + 2] * k + Math.sin(t * 0.6 + s * 2.1) * 0.12; }
      fx.motes.geometry.attributes.position.needsUpdate = true; fx.motes.material.color.set(S.cMotes); fx.motes.material.size = 1.6 + e * 3;
    }
    // spectrum ring
    fx.ring.visible = !!S.ring;
    if (S.ring) {
      const sp = A.spectrum(fx.ringN), M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), axis = new THREE.Vector3(0, 0, 1);
      L.ringRot = (L.ringRot || 0) + dt * 0.15;
      const R = 1.25 + S.ringSize / 100 * 0.9;
      for (let i = 0; i < fx.ringN; i++) {
        const a = (i / fx.ringN) * Math.PI * 2 + L.ringRot, h = 0.04 + sp[i] * (0.4 + S.ringHeight / 100 * 1.4);
        pos.set(Math.sin(a) * R, Math.cos(a) * R, -0.2); q.setFromAxisAngle(axis, -a); sc.set(1, h, 1);
        M4.compose(pos, q, sc); fx.ring.setMatrixAt(i, M4);
      }
      fx.ring.instanceMatrix.needsUpdate = true; fx.ring.material.color.set(S.cRing);
    }
    // grid
    fx.grid.visible = !!S.grid;
    if (S.grid) {
      const e = en(S.gridBand); L.gridZ = ((L.gridZ || 0) + dt * (0.4 + S.gridSpeed / 100 * 6) * (1 + e * 2)) % fx.gridCell;
      fx.grid.position.z = L.gridZ; fx.grid.material.color.set(S.cGrid); fx.grid.material.opacity = 0.35 + e * 0.5;
    }
    // lasers
    fx.lasers.visible = !!S.lasers;
    if (S.lasers) {
      if (S.laserBand !== 'off' && A.trigger('fxLaser', S.laserBand, 0.78, 140, now)) fx.laserEnv = 1;
      fx.laserEnv *= Math.exp(-dt * 5);
      const base = S.laserBand === 'off' ? 0.7 : 0;
      fx.laserMat.opacity = Math.min(1, base + fx.laserEnv) * (S.laserBright / 100);
      fx.laserMat.color.set(S.cLaser);
      L.laserT = (L.laserT || 0) + dt; fx.lasers.rotation.y = Math.sin(L.laserT * 0.6) * 0.5; fx.lasers.rotation.x = Math.sin(L.laserT * 0.37) * 0.15;
    }
    // fog
    if (S.fog) { if (!m.scene.fog) m.scene.fog = new THREE.FogExp2(0x000000, 0.1); m.scene.fog.color.set(S.cFog); m.scene.fog.density = S.fogDensity / 100 * 0.35; }
    else if (m.scene.fog) m.scene.fog = null;
  };
  L.resetFx = function () { L.gridZ = 0; L.ringRot = 0; L.laserT = 0; L.moteT = 0; L.flowT = 0; if (L.fx) L.fx.laserEnv = 0; };
})();
