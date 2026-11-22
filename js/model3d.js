/* XO LAB — 3D layer: multi-format loading, wireframe modes, material override,
 * and audio-triggered dust destruction / reformation. three.js r170, bundled locally.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const BUNDLE = 'vendor/three/three-all-0.170.0.bundle.js', DRACO = 'vendor/three/draco-decoder-inline.js';
  const UNSUPPORTED_EXT = { KHR_texture_basisu: 'Basis/KTX2 textures' };

  const M = (XO.model = {
    T: null, THREE: null, renderer: null, scene: null, camera: null, pivot: null, root: null, mixer: null,
    clips: [], action: null, animPlaying: false, speed: 1, loaded: false, fileName: '', format: '',
    rotX: 0, rotY: 0, zoom: 1, spin: false, width: 0, height: 0, warnings: [],
    wireKey: '', wireGroup: null, wireMats: [], matKey: '',
    dust: { phase: 'idle', t0: 0, points: null, log: [] },
  });

  function loadScript(src, test) {
    return new Promise((resolve, reject) => {
      if (test()) return resolve();
      const s = document.createElement('script'); s.src = src;
      s.onload = () => (test() ? resolve() : reject(new Error('Failed to initialise ' + src)));
      s.onerror = () => reject(new Error('Missing file: ' + src));
      document.head.appendChild(s);
    });
  }
  let enginePromise = null;
  function loadEngine() {
    if (!enginePromise) enginePromise = loadScript(BUNDLE, () => !!window.XO_THREE).then(() => { M.T = window.XO_THREE; M.THREE = M.T.THREE; }).catch((e) => { enginePromise = null; throw new Error('3D engine file is missing (' + BUNDLE + ').'); });
    return enginePromise;
  }
  async function dracoLoader(manager) {
    await loadScript(DRACO, () => !!window.XO_DRACO);
    const d = new M.T.DRACOLoader(manager);
    const wasm = Uint8Array.from(atob(window.XO_DRACO.wasm), (c) => c.charCodeAt(0)).buffer;
    // serve the decoder from memory (fetching local files is blocked on file://)
    d._loadLibrary = (url) => Promise.resolve(url.endsWith('.wasm') ? wasm.slice(0) : window.XO_DRACO.wrapper);
    return d;
  }

  function ensureRenderer() {
    const THREE = M.THREE;
    if (M.renderer) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); }
    catch (e) { throw new Error('WebGL is not available in this browser, so 3D models can\'t be shown.'); }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    M.renderer = renderer;
    M.scene = new THREE.Scene();
    M.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.01, 1000);
    M.camera.position.z = 4;
    M.scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 4, 5); M.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8); rim.position.set(-4, 1, -3); M.scene.add(rim);
    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); XO.toast('3D graphics paused by the system — restoring…', true); });
    renderer.domElement.addEventListener('webglcontextrestored', () => { M.matKey = ''; M.wireKey = ''; if (XO.look3d) XO.look3d.envCache = {}; XO.toast('3D graphics restored.'); });
  }

  function disposeObj(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); });
      if (o.userData.origMat) (Array.isArray(o.userData.origMat) ? o.userData.origMat : [o.userData.origMat]).forEach((m) => m.dispose && m.dispose());
    });
  }

  const base = (p) => decodeURIComponent(String(p).split(/[\\/]/).pop().split('?')[0]).toLowerCase();

  async function readGltfJson(file) {
    const buf = await file.arrayBuffer(), dv = new DataView(buf);
    if (buf.byteLength >= 20 && dv.getUint32(0, true) === 0x46546c67) {
      const len = dv.getUint32(12, true), type = dv.getUint32(16, true);
      if (type !== 0x4e4f534a) throw new Error('This GLB file is damaged (no JSON chunk).');
      return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
    }
    try { return JSON.parse(new TextDecoder().decode(new Uint8Array(buf))); } catch (e) { throw new Error('This file is not a valid glTF/GLB model.'); }
  }

  /* ------------------------------ loading ------------------------------ */
  M.load = async function (files) {
    const list = Array.from(files);
    const order = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'ply', 'stl'];
    let main = null;
    for (const e of order) { main = list.find((f) => XO.ext(f.name) === e); if (main) break; }
    if (!main) throw new Error('Choose a 3D file: GLB, glTF, OBJ, FBX, STL, PLY or DAE (select its sidecar files with it).');
    const ext = XO.ext(main.name);
    const provided = new Map(list.filter((f) => f !== main).map((f) => [f.name.toLowerCase(), f]));
    const warnings = [];
    let needsDraco = false;

    if (ext === 'glb' || ext === 'gltf') {
      const json = await readGltfJson(main);
      const req = json.extensionsRequired || [];
      const bad = req.filter((x) => UNSUPPORTED_EXT[x]);
      if (bad.length) throw new Error('This model uses ' + bad.map((x) => UNSUPPORTED_EXT[x]).join(' + ') + ', which this build doesn\'t decode. Re-export it with PNG/JPG textures.');
      needsDraco = (json.extensionsUsed || []).includes('KHR_draco_mesh_compression');
      const refs = [];
      (json.buffers || []).forEach((b) => b.uri && !/^data:/i.test(b.uri) && refs.push(b.uri));
      (json.images || []).forEach((im) => im.uri && !/^data:/i.test(im.uri) && refs.push(im.uri));
      const missing = refs.filter((u) => !provided.has(base(u)));
      if (missing.length) throw new Error('This .gltf needs files that weren\'t selected: ' + missing.map(base).slice(0, 4).join(', ') + (missing.length > 4 ? '…' : '') + '. Select the .gltf together with those files, or use a .glb.');
    }

    await loadEngine();
    const THREE = M.THREE, T = M.T;
    ensureRenderer();
    M.unload();

    const urls = [], resourceUrls = new Map();
    const mainUrl = URL.createObjectURL(main); urls.push(mainUrl);
    provided.forEach((f, name) => { const u = URL.createObjectURL(f); urls.push(u); resourceUrls.set(name, u); });
    const ours = new Set(urls), failed = new Set();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (ours.has(url) || /^data:/i.test(url)) return url;
      const hit = resourceUrls.get(base(url));
      if (hit) return hit;
      if (/^blob:/i.test(url)) return url; // loader-created URLs for embedded images
      failed.add(base(url));
      return url;
    });
    manager.onError = (url) => { if (!/^blob:/i.test(url) || resourceUrls.has(base(url))) failed.add(base(url)); };

    let root, animations = [];
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new T.GLTFLoader(manager);
        if (needsDraco) loader.setDRACOLoader(await dracoLoader(manager));
        loader.setMeshoptDecoder(T.MeshoptDecoder);
        const gltf = await loader.loadAsync(mainUrl);
        root = gltf.scene || (gltf.scenes && gltf.scenes[0]); animations = gltf.animations || [];
      } else if (ext === 'obj') {
        const text = await main.text();
        const mtlNames = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
        const mtlFile = mtlNames.map((n) => provided.get(base(n))).find(Boolean);
        const objLoader = new T.OBJLoader(manager);
        if (mtlNames.length && !mtlFile) warnings.push(mtlNames.map(base).join(', '));
        if (mtlFile) {
          const mtlText = await mtlFile.text();
          [...mtlText.matchAll(/^\s*map_\w+\s+(?:-\S+\s+\S+\s+)*(.+?)\s*$/gm)].forEach((m) => { if (!provided.has(base(m[1]))) warnings.push(base(m[1])); });
          const mats = new T.MTLLoader(manager).parse(mtlText, '');
          mats.preload(); objLoader.setMaterials(mats);
        }
        root = objLoader.parse(text);
      } else if (ext === 'fbx') {
        root = new T.FBXLoader(manager).parse(await main.arrayBuffer(), '');
        animations = root.animations || [];
      } else if (ext === 'dae') {
        const col = new T.ColladaLoader(manager).parse(await main.text(), '');
        root = col.scene; animations = (col.scene && col.scene.animations) || [];
      } else if (ext === 'stl') {
        const geo = new T.STLLoader().parse(await main.arrayBuffer());
        if (!geo.attributes.normal) geo.computeVertexNormals();
        root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: geo.hasColors ? 0xffffff : 0xcfcfcf, vertexColors: !!geo.hasColors, roughness: 0.55, metalness: 0.1 }));
      } else if (ext === 'ply') {
        const geo = new T.PLYLoader().parse(await main.arrayBuffer());
        const hasColor = !!geo.attributes.color;
        if (geo.index) {
          if (!geo.attributes.normal) geo.computeVertexNormals();
          root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xcfcfcf, vertexColors: hasColor, roughness: 0.6 }));
        } else root = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xdddddd }));
      }
    } catch (err) {
      throw new Error('Could not read this ' + ext.toUpperCase() + ' model' + (err && err.message ? ' (' + String(err.message).slice(0, 140) + ')' : '') + '.');
    } finally {
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 4000); // textures may still be decoding
    }
    if (!root) throw new Error('This model has no scene to display.');

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('This model contains no visible geometry.');
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const pivot = new THREE.Group();
    root.position.sub(center);
    pivot.add(root);
    M.baseScale = 2.1 / largest; pivot.scale.setScalar(M.baseScale);
    M.scene.add(pivot);
    M.pivot = pivot; M.root = root;
    root.traverse((o) => { if (o.isMesh) { if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.userData.origMat = o.material; o.frustumCulled = false; } });
    M.clips = animations;
    M.mixer = M.clips.length ? new THREE.AnimationMixer(root) : null;
    M.action = null; M.animPlaying = false;
    M.loaded = true; M.fileName = main.name; M.format = ext;
    M.wireKey = ''; M.matKey = '';
    M.resetView();
    // missing sidecars reported after textures have had a moment to load
    await new Promise((r) => setTimeout(r, 120));
    failed.forEach((f) => warnings.push(f));
    M.warnings = [...new Set(warnings)];
    return { clips: M.clips.map((c, i) => c.name || 'Animation ' + (i + 1)), name: main.name, warnings: M.warnings, format: ext };
  };

  M.unload = function () {
    endDust(true);
    if (M.mixer) { M.mixer.stopAllAction(); M.mixer.uncacheRoot(M.mixer.getRoot()); }
    M.mixer = null; M.action = null; M.clips = []; M.animPlaying = false;
    if (M.wireGroup) { M.wireGroup.forEach((o) => { o.parent && o.parent.remove(o); o.geometry && o.geometry.dispose(); }); M.wireGroup = null; }
    M.wireMats.forEach((m) => m.dispose()); M.wireMats = [];
    if (M.root && XO.look3d) XO.look3d.restoreGeometry(M.root);
    if (XO.look3d) XO.look3d.resetMotion();
    if (M.pivot && M.scene) { M.scene.remove(M.pivot); disposeObj(M.pivot); }
    M.pivot = null; M.root = null;
    if (M.renderer) M.renderer.renderLists.dispose();
    M.loaded = false; M.fileName = ''; M.wireKey = ''; M.matKey = '';
  };

  /* ------------------------------ animation ------------------------------ */
  M.selectClip = function (index) {
    if (!M.mixer || !M.clips[index]) return;
    const was = M.animPlaying;
    if (M.action) M.action.stop();
    M.action = M.mixer.clipAction(M.clips[index]); M.action.reset(); M.action.play(); M.action.paused = !was;
  };
  M.playAnim = function () {
    if (!M.mixer || !M.clips.length) return false;
    if (!M.action) { M.action = M.mixer.clipAction(M.clips[0]); M.action.play(); }
    M.action.paused = false; if (!M.action.isRunning()) M.action.play();
    M.animPlaying = true; return true;
  };
  M.pauseAnim = function () { if (M.action) M.action.paused = true; M.animPlaying = false; };
  M.resetView = function () { M.rotX = 0; M.rotY = 0; M.zoom = 1; if (XO.look3d) XO.look3d.stopInertia(); };
  M.rotate = function (dx, dy) { M.rotY += dx * 0.009; M.rotX += dy * 0.009; if (XO.look3d) XO.look3d.dragVelocity(dx, dy); };
  M.zoomBy = function (f) { M.zoom = Math.min(3.5, Math.max(0.35, M.zoom * f)); };

  /* ------------------------------ materials ------------------------------ */
  let matcapTex = null;
  function matcap() {
    if (matcapTex) return matcapTex;
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(96, 80, 6, 128, 128, 140);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#e8e8e8'); g.addColorStop(0.45, '#6a6a6a'); g.addColorStop(0.62, '#1a1a1a'); g.addColorStop(0.8, '#9a9a9a'); g.addColorStop(1, '#2a2a2a');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    matcapTex = new M.THREE.CanvasTexture(c); matcapTex.colorSpace = M.THREE.SRGBColorSpace;
    return matcapTex;
  }
  function applyMaterial() {
    const S = XO.S.model, THREE = M.THREE;
    const key = S.material, LK = XO.look3d;
    const fullKey = key + (key === 'mercury' ? '|' + S.quality : LK && LK.isMetal(key) && S.smooth ? '|smooth' : '');
    if (fullKey !== M.matKey) {
      M.matKey = fullKey;
      if (LK) {
        LK.restoreGeometry(M.root);
        if (key === 'mercury') LK.prepareLiquidGeometry(M.root);
        else if (LK.isMetal(key) && S.smooth) LK.prepareSmoothGeometry(M.root);
      }
      M.root.traverse((o) => {
        if (!o.isMesh || !o.userData.origMat) return;
        if (o.material !== o.userData.origMat) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        if (key === 'original') { o.material = o.userData.origMat; return; }
        const make = (orig) => {
          const map = orig && orig.map ? orig.map : null;
          if (LK && LK.isMetal(key)) return LK.makeMetal(key, o);
          if (key === 'solid') return new THREE.MeshStandardMaterial({ color: S.cSolid, roughness: 0.45, metalness: 0.1 });
          if (key === 'matte') return new THREE.MeshStandardMaterial({ color: map ? 0xffffff : S.cSolid, map, roughness: 1, metalness: 0 });
          if (key === 'chrome') return new THREE.MeshMatcapMaterial({ color: S.cSolid, matcap: matcap() });
          return new THREE.MeshBasicMaterial({ color: map ? 0xffffff : S.cSolid, map });
        };
        o.material = Array.isArray(o.userData.origMat) ? o.userData.origMat.map(make) : make(o.userData.origMat);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.userData.override = true; });
      });
    }
    if (key !== 'original' && !(XO.look3d && XO.look3d.isMetal(key))) {
      M.root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.userData.override && !m.map) m.color.set(S.cSolid); else if (m.userData.override && key === 'chrome') m.color.set(S.cSolid); }); });
    }
  }

  /* ------------------------------ wireframe ------------------------------ */
  function buildWire() {
    const S = XO.S.model, THREE = M.THREE, T = M.T;
    const key = S.wire + '|' + S.edgeAngle + '|' + (S.wire === 'points' ? 'p' : '') + '|' + S.material;
    if (key === M.wireKey) return;
    M.wireKey = key;
    if (M.wireGroup) M.wireGroup.forEach((o) => { o.parent && o.parent.remove(o); if (!o.userData.sharedGeo && o.geometry) o.geometry.dispose(); });
    M.wireMats.forEach((m) => m.dispose());
    M.wireGroup = []; M.wireMats = [];
    if (S.wire === 'off') return;
    const lineMat = new T.LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthTest: true, worldUnits: false });
    const glowMat = new T.LineMaterial({ color: 0xffffff, linewidth: 6, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, worldUnits: false });
    const basicWire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffffff, transparent: true });
    const pointsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true });
    M.wireMats.push(lineMat, glowMat, basicWire, pointsMat);
    M.lineMat = lineMat; M.glowMat = glowMat; M.basicWire = basicWire; M.pointsMat = pointsMat;
    M.root.traverse((o) => {
      if (!o.isMesh || o.userData.isWire) return;
      const geo = o.userData.origGeo || o.geometry;
      if (S.wire === 'points') {
        const p = new THREE.Points(geo, pointsMat); p.userData.isWire = true; p.userData.sharedGeo = true; p.frustumCulled = false; o.add(p); M.wireGroup.push(p); return;
      }
      if (o.isSkinnedMesh || (geo.morphAttributes && Object.keys(geo.morphAttributes).length)) {
        // animated meshes: native 1-px wireframe that follows the skeleton
        const w = new THREE.SkinnedMesh(geo, basicWire);
        if (o.isSkinnedMesh) { w.bind(o.skeleton, o.bindMatrix); w.bindMode = o.bindMode; }
        w.position.copy(o.position); w.quaternion.copy(o.quaternion); w.scale.copy(o.scale);
        w.morphTargetInfluences = o.morphTargetInfluences; w.userData.isWire = true; w.userData.sharedGeo = true; w.frustumCulled = false;
        o.parent.add(w); M.wireGroup.push(w); return;
      }
      const lg = S.wire === 'edges' ? new T.LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, S.edgeAngle)) : new T.WireframeGeometry2(geo);
      const glow = new T.LineSegments2(lg, glowMat); glow.userData.isWire = true; glow.userData.sharedGeo = true; glow.frustumCulled = false;
      const line = new T.LineSegments2(lg, lineMat); line.userData.isWire = true; line.frustumCulled = false;
      o.add(glow); o.add(line); M.wireGroup.push(glow, line);
    });
  }
  function updateWire(w, h, energy) {
    const S = XO.S.model;
    const hideSolid = S.wire === 'wire' || S.wire === 'edges' || S.wire === 'points';
    M.root.traverse((o) => { if (o.isMesh && !o.userData.isWire) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.visible = !hideSolid; }); });
    if (S.wire === 'off' || !M.lineMat) return;
    const e = energy * S.wireAmt / 100;
    const col = new M.THREE.Color(S.cWire).lerp(new M.THREE.Color('#ffffff'), Math.min(1, e * 0.6));
    const op = Math.min(1, S.wireOpacity / 100 * (1 + e * 0.5));
    M.lineMat.color.copy(col); M.lineMat.linewidth = S.wireThick * (1 + e * 1.5); M.lineMat.opacity = op; M.lineMat.resolution.set(w, h);
    M.glowMat.color.copy(col); M.glowMat.linewidth = S.wireThick * 4 * (1 + e); M.glowMat.opacity = (S.wireGlow / 100) * 0.35 * op; M.glowMat.visible = S.wireGlow > 0; M.glowMat.resolution.set(w, h);
    M.basicWire.color.copy(col); M.basicWire.opacity = op;
    M.pointsMat.color.copy(col); M.pointsMat.size = S.pointSize * (1 + e); M.pointsMat.opacity = op;
  }

  /* ------------------------------ dust ------------------------------ */
  const DUST_VS = `
    attribute vec3 aDir; attribute vec3 aRand; attribute vec3 color;
    uniform float uP, uStrength, uTurb, uSpin, uTime, uSize, uFade; uniform vec3 uDrift;
    varying vec3 vCol; varying float vA; varying float vRot;
    void main(){
      vec3 pos = position;
      vec3 disp = aDir*uStrength*(0.4+aRand.x) + uDrift*(0.5+aRand.y);
      vec3 turb = vec3(sin(uTime*1.3+aRand.x*20.), cos(uTime*1.1+aRand.y*20.), sin(uTime*.9+aRand.z*20.))*uTurb;
      pos += (disp + turb*smoothstep(0.,.35,uP))*uP;
      float a = uSpin*uP*(aRand.z-.5)*6.;
      pos.xz = mat2(cos(a),-sin(a),sin(a),cos(a))*pos.xz;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(pos,1.);
      gl_PointSize = uSize*(.7+aRand.x*.6);
      vCol = color; vA = uFade>.5 ? 1.-uP*.45 : 1.; vRot = aRand.y*6.2832;
    }`;
  const DUST_FS = `
    uniform int uShape; uniform vec3 uColor; uniform float uUseColor;
    varying vec3 vCol; varying float vA; varying float vRot;
    void main(){
      vec2 c = gl_PointCoord-.5;
      if(uShape==0){ if(length(c)>.5) discard; }
      else if(uShape==2){ vec2 r = mat2(cos(vRot),-sin(vRot),sin(vRot),cos(vRot))*c; if(abs(r.x)*1.8+abs(r.y)>.5) discard; }
      gl_FragColor = vec4(mix(vCol,uColor,uUseColor), vA);
    }`;

  function texSampler(map) {
    try {
      const img = map && map.image; if (!img || !(img.width || img.naturalWidth)) return null;
      const c = document.createElement('canvas'); const w = Math.min(256, img.width || img.naturalWidth), h = Math.min(256, img.height || img.naturalHeight);
      c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
      return (u, v) => { const px = Math.min(w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * w))); const py = Math.min(h - 1, Math.max(0, Math.floor((1 - (((v % 1) + 1) % 1)) * h))); const i = (py * w + px) * 4; return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]; };
    } catch (e) { return null; }
  }

  function sampleDust() {
    const THREE = M.THREE, S = XO.S.model;
    M.pivot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(M.pivot.matrixWorld).invert();
    const meshes = [];
    M.root.traverse((o) => { if (o.isMesh && !o.userData.isWire && o.geometry && o.geometry.attributes.position) meshes.push(o); });
    if (!meshes.length) return null;
    const weights = meshes.map((m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const N = S.count;
    const pos = new Float32Array(N * 3), dir = new Float32Array(N * 3), rnd = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color(), uv = new THREE.Vector2();
    let k = 0;
    meshes.forEach((mesh, mi) => {
      let geo = mesh.geometry;
      if (mesh.isSkinnedMesh) {
        // bake the current animated pose so the burst starts from what's on screen
        const src = geo.attributes.position, baked = geo.clone(), v = new THREE.Vector3();
        for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i); mesh.applyBoneTransform(i, v); baked.attributes.position.setXYZ(i, v.x, v.y, v.z); }
        baked.computeVertexNormals(); geo = baked;
      }
      const tmp = new THREE.Mesh(geo);
      const sampler = new M.T.MeshSurfaceSampler(tmp).build();
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const om = Array.isArray(mesh.userData.origMat) ? mesh.userData.origMat[0] : mesh.userData.origMat || mat;
      const ts = texSampler(om && om.map);
      const baseCol = om && om.color ? om.color : new THREE.Color(1, 1, 1);
      const hasVC = !!geo.attributes.color && om && om.vertexColors;
      const m4 = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(m4);
      const count = mi === meshes.length - 1 ? N - k : Math.round(N * weights[mi] / total);
      for (let i = 0; i < count && k < N; i++, k++) {
        sampler.sample(p, n, hasVC ? c : undefined, uv);
        p.applyMatrix4(m4); n.applyMatrix3(nm).normalize();
        let r = baseCol.r, g = baseCol.g, b = baseCol.b;
        if (hasVC) { r *= c.r; g *= c.g; b *= c.b; }
        if (ts && geo.attributes.uv) { const t = ts(uv.x, uv.y); r *= t[0]; g *= t[1]; b *= t[2]; }
        pos.set([p.x, p.y, p.z], k * 3);
        const rx = Math.random() - 0.5, ry = Math.random() - 0.5, rz = Math.random() - 0.5;
        const len = Math.hypot(p.x, p.y, p.z) || 1;
        dir.set([n.x * 0.6 + p.x / len * 0.6 + rx * 0.5, n.y * 0.6 + p.y / len * 0.6 + ry * 0.5, n.z * 0.6 + p.z / len * 0.6 + rz * 0.5], k * 3);
        rnd.set([Math.random(), Math.random(), Math.random()], k * 3);
        col.set([r, g, b], k * 3);
      }
      if (geo !== mesh.geometry) geo.dispose();
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false,
      uniforms: { uP: { value: 0 }, uStrength: { value: 1 }, uTurb: { value: 0.2 }, uSpin: { value: 0 }, uTime: { value: 0 }, uSize: { value: 3 }, uFade: { value: 1 }, uDrift: { value: new THREE.Vector3() }, uShape: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uUseColor: { value: 0 } },
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    return pts;
  }

  M.triggerBurst = function (now) {
    if (!M.loaded || M.dust.phase !== 'idle') return false;
    const pts = sampleDust(); if (!pts) return false;
    M.dust.points = pts; M.pivot.add(pts);
    M.root.visible = false;
    M.dust.phase = 'destruct'; M.dust.t0 = now; M.dust.log.push(['destruct', now]);
    return true;
  };
  function endDust(silent) {
    const d = M.dust;
    if (d.points) { d.points.parent && d.points.parent.remove(d.points); d.points.geometry.dispose(); d.points.material.dispose(); d.points = null; }
    if (M.root) M.root.visible = true;
    if (!silent && d.phase !== 'idle') d.log.push(['idle', performance.now()]);
    d.phase = 'idle';
  }
  M.resetDust = function () { endDust(true); };
  const EASE = { linear: (t) => t, out: (t) => 1 - Math.pow(1 - t, 3), inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)) };

  function updateDust(now, time) {
    const d = M.dust, S = XO.S.model;
    if (d.phase === 'idle' || !d.points) return;
    const ease = EASE[S.ease] || EASE.out, el = (now - d.t0) / 1000;
    let p = 0;
    // phase boundaries are scheduled from the previous boundary (not the frame that noticed it), so frame jitter never accumulates
    if (d.phase === 'destruct') { const tt = Math.min(1, el / Math.max(0.01, S.dDur)); p = ease(tt); if (tt >= 1) { d.phase = 'hold'; d.t0 += Math.max(0.01, S.dDur) * 1000; d.log.push(['hold', now]); } }
    if (d.phase === 'hold') { const el2 = (now - d.t0) / 1000; p = 1; if (el2 >= S.hDur) { d.phase = 'reform'; d.t0 += S.hDur * 1000; d.log.push(['reform', now]); } }
    if (d.phase === 'reform') { const tt = Math.min(1, ((now - d.t0) / 1000) / Math.max(0.01, S.rDur)); p = 1 - ease(tt); if (tt >= 1) { endDust(false); return; } }
    const u = d.points.material.uniforms;
    u.uP.value = p; u.uStrength.value = 0.05 + S.strength / 100 * 2.4; u.uTurb.value = S.turbulence / 100 * 0.6; u.uSpin.value = S.spin3 / 100;
    u.uTime.value = time; u.uSize.value = S.pSize * (M.height / 720); u.uFade.value = S.fade ? 1 : 0;
    const dr = S.drift === 'up' ? [0, 1.2, 0] : S.drift === 'wind' ? [S.windX / 100 * 1.6, 0.25, 0] : [0, 0, 0];
    u.uDrift.value.set(dr[0], dr[1], dr[2]);
    u.uShape.value = { dot: 0, square: 1, shard: 2 }[S.pShape] || 0;
    u.uUseColor.value = S.dustColor === 'custom' ? 1 : 0; u.uColor.value.set(S.cDust);
  }

  /* ------------------------------ render ------------------------------ */
  M.render = function (dt, w, h, now, time, wireEnergy) {
    if (!M.loaded || !M.renderer) return null;
    w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
    if (w !== M.width || h !== M.height) {
      M.width = w; M.height = h; M.renderer.setSize(w, h, false);
      M.camera.aspect = w / h; M.camera.updateProjectionMatrix();
    }
    applyMaterial(); buildWire(); updateWire(w, h, wireEnergy || 0);
    if (M.mixer) M.mixer.update(M.animPlaying ? dt * (XO.S.model.speed / 100) : 0);
    const LK = XO.look3d;
    if (LK) { LK.motion(dt, now, time); LK.updateMetal(dt, M.root); LK.sceneFx(dt, now, time); }
    else { if (XO.S.model.spin) M.rotY += dt * 0.6; M.pivot.rotation.set(M.rotX, M.rotY, 0); M.camera.position.set(0, 0, 4 / M.zoom); }
    updateDust(now, time);
    M.renderer.render(M.scene, M.camera);
    return M.renderer.domElement;
  };
})();
