/* XO LAB — panel schema. Every control is data; ui.js builds and binds it. */
(function () {
  'use strict';
  const XO = window.XO;
  const BANDS = [['off', 'OFF'], ['bass', 'BASS'], ['mid', 'MID'], ['high', 'HIGH'], ['full', 'FULL'], ['custom', 'CUSTOM']];
  const BANDS_ON = BANDS.slice(1);
  const r = (k, label, min, max, step, fmt, extra) => Object.assign({ type: 'range', k, label, min, max, step, fmt }, extra || {});
  const t = (k, label, extra) => Object.assign({ type: 'toggle', k, label }, extra || {});
  const seg = (k, label, options, extra) => Object.assign({ type: 'seg', k, label, options }, extra || {});
  const sel = (k, label, options, extra) => Object.assign({ type: 'select', k, label, options }, extra || {});
  const c = (k, label, extra) => Object.assign({ type: 'color', k, label }, extra || {});

  const METAL = 'model.material=mchrome|brushed|mercury';
  const MOTION_CONTROLS = [
    t('model.spin', 'Auto spin'), seg('model.spinAxis', 'Spin axis', [['y', 'Y'], ['x', 'X'], ['z', 'Z'], ['xy', 'X+Y']], { show: 'model.spin' }),
    seg('model.spinDir', 'Direction', [['cw', '↻ CW'], ['ccw', '↺ CCW']], { show: 'model.spin' }), r('model.spinSpeed', 'Spin speed', 0, 100, 1, '%', { show: 'model.spin' }),
    sel('model.spinBand', 'Spin speeds up on', BANDS, { show: 'model.spin' }),
  ];
  (XO.look3d ? XO.look3d.MOTIONS : []).forEach(([id, label, kind]) => {
    const k = 'model.m' + id;
    MOTION_CONTROLS.push(t(k, label));
    MOTION_CONTROLS.push(r(k + 'Amt', 'Amount', 0, 100, 1, '%', { show: k }));
    MOTION_CONTROLS.push(r(k + 'Spd', kind === 'hit' ? 'Snap-back speed' : 'Speed', 0, 100, 1, '%', { show: k }));
    MOTION_CONTROLS.push(sel(k + 'Band', kind === 'hit' ? 'Fires on' : 'Audio drive', kind === 'hit' ? BANDS_ON : BANDS, { show: k }));
    if (id === 'Orbit') MOTION_CONTROLS.push(seg('model.orbitPath', 'Path', [['circle', 'CIRCLE'], ['eight', 'FIGURE 8']], { show: k }));
  });
  MOTION_CONTROLS.push(t('model.inertia', 'Drag keeps gliding (inertia)', { adv: true }));

  XO.SCHEMA = [
    {
      id: 'media', tab: 'Media', title: 'MEDIA', sub: '01 / INPUT',
      icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 8v8M8 12h8"/>',
      sections: [
        { title: 'Input', custom: 'mediaInputs', controls: [r('media.volume', 'Track volume', 0, 100, 1, '%')] },
        { title: 'Live input', custom: 'liveInput', controls: [r('audio.liveGain', 'Live audio gain', 0, 400, 5, '%'), t('media.camMirror', 'Mirror camera')] },
        { title: 'Project', custom: 'project', controls: [] },
        {
          title: 'Audio monitor', custom: 'audioMonitor', controls: [
            r('audio.thrBass', 'Bass hit threshold', 5, 100, 1, '%'), r('audio.thrMid', 'Mid hit threshold', 5, 100, 1, '%'), r('audio.thrHigh', 'High hit threshold', 5, 100, 1, '%'),
            seg('audio.bpmMode', 'Tempo source', [['auto', 'AUTO BPM'], ['tap', 'TAP'], ['manual', 'MANUAL'], ['clock', 'MIDI CLOCK']]),
            r('audio.bpm', 'Manual BPM', 60, 200, 0.5, '', { show: 'audio.bpmMode=manual|tap' }),
            r('audio.cooldown', 'Hit cooldown', 40, 600, 10, 'ms', { adv: true }), r('audio.thrFull', 'Full / custom threshold', 5, 100, 1, '%', { adv: true }),
            r('audio.customLo', 'Custom band low', 20, 8000, 10, 'Hz', { adv: true }), r('audio.customHi', 'Custom band high', 40, 16000, 10, 'Hz', { adv: true }),
          ],
        },
        {
          title: 'Placement', controls: [
            seg('media.fit', 'Fit', [['fill', 'FILL'], ['fit', 'FIT'], ['stretch', 'STRETCH']]),
            r('media.zoom', 'Zoom', 50, 300, 1, '%'), r('media.posX', 'Position X', -100, 100, 1, ''), r('media.posY', 'Position Y', -100, 100, 1, ''),
            seg('media.imgMax', 'Image size limit', [['2048', '2048'], ['4096', '4096'], ['original', 'ORIGINAL']], { adv: true }),
          ],
        },
        {
          title: 'Background', colorGroup: 'bg', controls: [
            seg('bg.mode', 'Mode', [['solid', 'SOLID'], ['gradient', 'GRADIENT'], ['image', 'IMAGE'], ['blur', 'BLUR FILL']]),
            c('bg.color', 'Colour', { show: 'bg.mode=solid' }),
            seg('bg.gType', 'Gradient', [['linear', 'LINEAR'], ['radial', 'RADIAL']], { show: 'bg.mode=gradient' }),
            seg('bg.gStops', 'Stops', [['2', '2'], ['3', '3']], { show: 'bg.mode=gradient' }),
            r('bg.gAngle', 'Angle', 0, 360, 1, '°', { show: 'bg.mode=gradient' }),
            c('bg.g1', 'Stop 1', { show: 'bg.mode=gradient' }), c('bg.g2', 'Stop 2', { show: 'bg.mode=gradient' }), c('bg.g3', 'Stop 3', { show: 'bg.mode=gradient' }),
            { type: 'custom', name: 'bgImage', show: 'bg.mode=image' },
            seg('bg.imgFit', 'Image fit', [['fill', 'FILL'], ['fit', 'FIT']], { show: 'bg.mode=image' }),
            r('bg.blur', 'Blur', 0, 100, 1, '%', { show: 'bg.mode=blur' }), r('bg.darken', 'Darken', 0, 100, 1, '%', { show: 'bg.mode=blur' }),
            t('bg.filterBg', 'Apply filters to background too'),
          ],
        },
      ],
    },
    {
      id: 'model', tab: '3D', title: '3D OBJECT', sub: '02 / MODEL',
      icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
      sections: [
        { title: 'Model', custom: 'animation', controls: [r('model.speed', 'Animation speed', 25, 200, 1, '%'), { type: 'hint', text: 'GLB · glTF (+ .bin / textures) · OBJ (+ .mtl / textures) · FBX · STL · PLY · DAE. Select a model together with its sidecar files. Drag to rotate (it keeps gliding), pinch or scroll to zoom, double-tap to reset.' }] },
        { title: 'Motion', custom: 'motionPresets', controls: MOTION_CONTROLS },
        {
          title: 'Wireframe', colorGroup: 'model', controls: [
            sel('model.wire', 'Mode', [['off', 'Off'], ['wire', 'Wireframe only'], ['over', 'Wireframe over solid'], ['edges', 'Edges only'], ['points', 'Points']]),
            r('model.wireThick', 'Line thickness', 1, 8, 0.5, 'px', { show: 'model.wire=wire|over|edges' }),
            r('model.wireOpacity', 'Opacity', 5, 100, 1, '%', { show: '!model.wire=off' }),
            r('model.wireGlow', 'Glow', 0, 100, 1, '%', { show: 'model.wire=wire|over|edges' }),
            r('model.edgeAngle', 'Edge angle', 1, 90, 1, '°', { show: 'model.wire=edges' }),
            r('model.pointSize', 'Point size', 1, 12, 0.5, 'px', { show: 'model.wire=points' }),
            c('model.cWire', 'Line colour', { show: '!model.wire=off' }),
            sel('model.wireBand', 'Reacts to', BANDS, { show: '!model.wire=off' }),
            r('model.wireAmt', 'Audio amount', 0, 100, 1, '%', { show: '!model.wire=off' }),
          ],
        },
        {
          title: 'Material', colorGroup: 'model', controls: [
            sel('model.material', 'Material', [['original', 'Original'], ['solid', 'Solid colour'], ['matte', 'Matte'], ['chrome', 'Chrome (fast)'], ['mchrome', 'Chrome — real reflections'], ['brushed', 'Brushed metal'], ['mercury', 'Liquid mercury (flowing)'], ['unlit', 'Unlit flat']]),
            c('model.cSolid', 'Colour / tint', { show: '!model.material=original' }),
            sel('model.env', 'Reflections', [['studio', 'Studio softboxes'], ['neon', 'Neon tubes'], ['club', 'Dark club'], ['sunset', 'Sunset']], { show: METAL }),
            r('model.envInt', 'Reflection strength', 0, 100, 1, '%', { show: METAL }), r('model.metal', 'Metalness', 0, 100, 1, '%', { show: METAL }), r('model.rough', 'Roughness', 0, 100, 1, '%', { show: METAL }),
            t('model.smooth', 'Smooth shading (hide facets)', { show: 'model.material=mchrome|brushed' }),
            r('model.clearcoat', 'Clear coat', 0, 100, 1, '%', { show: METAL }), t('model.irid', 'Oil-slick shimmer (iridescence)', { show: METAL }),
            r('model.rim', 'Rim glow', 0, 100, 1, '%', { show: METAL }), c('model.cRim', 'Rim colour', { show: METAL }),
            r('model.flowSpeed', 'Flow speed', 0, 100, 1, '%', { show: 'model.material=mercury' }), r('model.flowScale', 'Flow scale', 0, 100, 1, '%', { show: 'model.material=mercury' }),
            r('model.wave', 'Wave height', 0, 100, 1, '%', { show: 'model.material=mercury' }),
            seg('model.drip', 'Flow direction', [['none', 'SWIRL'], ['down', 'DRIP'], ['up', 'RISE'], ['wind', 'WIND']], { show: 'model.material=mercury' }),
            sel('model.liqBand', 'Liquid reacts to', BANDS, { show: 'model.material=mercury' }), r('model.liqAmt', 'Audio amount', 0, 100, 1, '%', { show: 'model.material=mercury' }),
            seg('model.quality', 'Liquid detail', [['low', 'LOW'], ['med', 'MED'], ['high', 'HIGH']], { show: 'model.material=mercury' }),
            { type: 'hint', text: 'Chrome, brushed metal and mercury reflect a generated environment (works offline). Mercury smooths and subdivides the model so it can flow — for chrome lines on top, use Wireframe → Wireframe over solid. Use LOW detail on older iPhones.', show: METAL },
          ],
        },
        {
          title: 'Destruction · dust', colorGroup: 'model', custom: 'burst', controls: [
            t('model.burstAuto', 'Burst on audio hits'),
            sel('model.burstBand', 'Trigger band', BANDS_ON), r('model.burstThr', 'Trigger threshold', 10, 100, 1, '%'), r('model.burstCooldown', 'Cooldown', 100, 8000, 50, 'ms'),
            r('model.dDur', 'Destruction', 0.05, 5, 0.05, 's'), r('model.hDur', 'Hold', 0, 5, 0.05, 's'), r('model.rDur', 'Reconstruction', 0.05, 5, 0.05, 's'),
            sel('model.ease', 'Easing', [['out', 'Ease out'], ['inout', 'Ease in-out'], ['linear', 'Linear'], ['expo', 'Expo']]),
            r('model.strength', 'Explosion strength', 0, 100, 1, '%'), r('model.turbulence', 'Turbulence', 0, 100, 1, '%'),
            seg('model.drift', 'Drift', [['out', 'OUTWARD'], ['up', 'UP'], ['wind', 'WIND']]), r('model.windX', 'Wind direction', -100, 100, 1, '', { show: 'model.drift=wind' }),
            r('model.spin3', 'Spin', 0, 100, 1, '%'),
            r('model.count', 'Particle count', 2000, 80000, 1000, '', { adv: true }), r('model.pSize', 'Particle size', 1, 12, 0.5, 'px'),
            seg('model.pShape', 'Particle shape', [['dot', 'DOT'], ['square', 'SQUARE'], ['shard', 'SHARD']]),
            seg('model.dustColor', 'Dust colour', [['texture', 'FROM MODEL'], ['custom', 'CUSTOM']]), c('model.cDust', 'Dust colour', { show: 'model.dustColor=custom' }),
            t('model.fade', 'Fade while scattered'),
          ],
        },
        {
          title: 'Scene effects', colorGroup: 'scene', controls: [
            t('scene.stars', 'Starfield warp'), r('scene.starsSpeed', 'Warp speed', 0, 100, 1, '%', { show: 'scene.stars' }), sel('scene.starsBand', 'Speeds up on', BANDS, { show: 'scene.stars' }),
            t('scene.motes', 'Floating particles'), sel('scene.motesBand', 'Particles react to', BANDS, { show: 'scene.motes' }),
            t('scene.ring', 'Audio spectrum ring'), r('scene.ringSize', 'Ring size', 0, 100, 1, '%', { show: 'scene.ring' }), r('scene.ringHeight', 'Bar height', 0, 100, 1, '%', { show: 'scene.ring' }),
            t('scene.grid', 'Retro grid floor'), r('scene.gridSpeed', 'Grid speed', 0, 100, 1, '%', { show: 'scene.grid' }), sel('scene.gridBand', 'Grid reacts to', BANDS, { show: 'scene.grid' }),
            t('scene.lasers', 'Laser fan'), sel('scene.laserBand', 'Lasers fire on (OFF = always on)', BANDS, { show: 'scene.lasers' }), r('scene.laserBright', 'Laser brightness', 0, 100, 1, '%', { show: 'scene.lasers' }),
            t('scene.fog', 'Fog / haze'), r('scene.fogDensity', 'Fog density', 0, 100, 1, '%', { show: 'scene.fog' }),
            { type: 'hint', text: 'Scene effects render around the 3D model (load a model to see them).' },
          ],
        },
      ],
    },
    {
      id: 'blob', tab: 'Blob', title: 'BLOB TRACKING', sub: '03 / DETECT',
      icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
      sections: [
        {
          title: 'Detection', custom: 'trackStatus', controls: [
            t('blob.on', 'Blob tracking'), seg('blob.detect', 'Track', [['bright', 'BRIGHT'], ['dark', 'DARK'], ['motion', 'MOTION']]),
            r('blob.sens', 'Sensitivity', 0, 100, 1, ''), r('blob.maxBlobs', 'Max blobs', 1, 24, 1, ''), r('blob.minCells', 'Min blob size', 1, 80, 1, ''), r('blob.smooth', 'Track smoothing', 0, 95, 1, '%'),
            seg('blob.detectOn', 'Detect on', [['source', 'ORIGINAL'], ['filtered', 'FILTERED']], { adv: true }),
          ],
        },
        {
          title: 'Box size', controls: [
            r('blob.padding', 'Padding', 0, 60, 1, 'px'), t('blob.fixed', 'Fixed size'), r('blob.fixedSize', 'Fixed size', 10, 400, 1, 'px', { show: 'blob.fixed' }),
            t('blob.square', 'Square lock'), r('blob.minSize', 'Min box size', 4, 200, 1, 'px', { adv: true }), r('blob.maxSize', 'Max box size', 40, 1200, 10, 'px', { adv: true }),
          ],
        },
        {
          title: 'Shape & style', colorGroup: 'blob', controls: [
            sel('blob.shape', 'Shape', [['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'], ['rounded', 'Rounded'], ['brackets', 'Corner brackets only'], ['cross', 'Crosshair only'], ['reticle', 'Target reticle'], ['double', 'Double box'], ['dashed', 'Dashed box'], ['hex', 'Hexagon'], ['glow', 'Glow orb (classic)']]),
            r('blob.lineW', 'Line thickness', 0.5, 6, 0.1, 'px'),
            sel('blob.style', 'Inside the box', [['outline', 'Outline only'], ['filled', 'Filled'], ['invert', 'Inverted'], ['threshold', 'Threshold 1-bit'], ['pixel', 'Pixelated'], ['blur', 'Blurred / frosted'], ['zoom', 'Zoomed (magnifier)'], ['tint', 'Colour tint'], ['glitch', 'Glitch split']]),
            r('blob.styledPct', 'Boxes styled', 0, 100, 1, '%', { show: '!blob.style=outline' }), t('blob.styleFlash', 'Style flashes on hits (all boxes)'),
          ],
        },
        { title: 'Link lines', colorGroup: 'blob', controls: [sel('blob.link', 'Links', [['mst', 'Spanning tree'], ['chain', 'Chain'], ['near', 'Nearest neighbours'], ['center', 'To main blob'], ['none', 'None']]), r('blob.linkW', 'Thickness', 0.5, 6, 0.1, 'px'), r('blob.linkOpacity', 'Opacity', 5, 100, 1, '%'), t('blob.linkDash', 'Dashed')] },
        {
          title: 'Labels & text', colorGroup: 'blob', controls: [
            sel('blob.labelMode', 'Label shows', [['id', 'ID (OBJ 07)'], ['conf', 'Confidence'], ['coords', 'Coordinates'], ['rand', 'Random number'], ['hex', 'Hex code'], ['word', 'Word'], ['wordnum', 'Word + number'], ['mixed', 'Mixed (cycle)'], ['none', 'No label']]),
            r('blob.fontSize', 'Font size', 7, 32, 1, 'px'), seg('blob.labelPos', 'Position', [['top', 'TOP'], ['bottom', 'BOTTOM'], ['inside', 'INSIDE'], ['random', 'RANDOM']]),
            t('blob.upper', 'Uppercase'), t('blob.coords', 'X/Y under main boxes'), t('blob.readout', 'HUD readout'),
            { type: 'text', k: 'blob.customWords', label: 'Custom words (comma or new line)', placeholder: 'YOUR DJ NAME, VENUE, …' },
          ],
        },
        {
          title: 'Random characters', controls: [
            sel('blob.glyphs', 'Glyphs', [['latin', 'A–Z 0–9'], ['latin+sym', 'A–Z 0–9 + symbols'], ['katakana', 'Katakana'], ['all', 'All']]),
            r('blob.scrSpeed', 'Scramble speed', 1, 60, 1, '/s'), r('blob.resolve', 'Resolve time', 50, 2000, 10, 'ms'), t('blob.reroll', 'New word on each hit'), r('blob.scrAudio', 'Audio drives scramble', 0, 100, 1, '%'),
          ],
        },
        {
          title: 'Audio reaction', controls: [
            sel('blob.band', 'Reacts to', BANDS), r('blob.bandThr', 'Hit threshold', 10, 100, 1, '%'), r('blob.bandCooldown', 'Cooldown', 40, 2000, 10, 'ms'),
            { type: 'hint', text: 'Each reaction: 0 = off.' },
            r('blob.rFlash', 'Flash inverted', 0, 100, 1, '%'), r('blob.rGrow', 'Grow', 0, 100, 1, '%'), r('blob.rJitter', 'Jitter / shake', 0, 100, 1, '%'),
            r('blob.rScramble', 'Scramble on hit', 0, 100, 1, '%'), r('blob.rColor', 'Colour shift to accent', 0, 100, 1, '%'), r('blob.rLine', 'Line pulse', 0, 100, 1, '%'), r('blob.rGhost', 'Ghost boxes', 0, 100, 1, '%'),
            t('blob.accentOn', 'Accent colour on main blob'),
          ],
        },
      ],
    },
    {
      id: 'fx', tab: 'FX', title: 'FX', sub: '04 / FILTERS + DOF',
      icon: '<path d="M4 20L20 4M6 4v4M4 6h4M17 15v4M15 17h4M11 3.5l1 1M3.5 11l1 1"/>',
      sections: [
        { title: 'Filters', custom: 'filterStack', colorGroup: 'fxc' },
        {
          title: 'Depth of field', controls: [
            t('dof.on', 'Depth of field'), seg('dof.shape', 'Focus shape', [['circle', 'CIRCLE'], ['hband', 'TILT-SHIFT'], ['vband', 'VERTICAL']]),
            t('dof.follow', 'Focus follows main blob'), r('dof.fx', 'Focus X', 0, 100, 1, '%', { show: '!dof.follow' }), r('dof.fy', 'Focus Y', 0, 100, 1, '%', { show: '!dof.follow' }),
            r('dof.size', 'Focus size', 2, 80, 1, '%'), r('dof.falloff', 'Falloff', 1, 100, 1, '%'), r('dof.amount', 'Blur amount', 0, 100, 1, '%'), r('dof.bokeh', 'Bokeh highlights', 0, 100, 1, '%'),
            { type: 'hint', text: 'Focus-area blur (video has no depth data). Drag on the stage to place the focus.' },
          ],
        },
      ],
    },
    {
      id: 'strobe', tab: 'Strobe', title: 'STROBE', sub: '05 / FLASH',
      icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
      sections: [
        {
          title: 'Strobe', custom: 'strobePad', colorGroup: 'strobe', controls: [
            t('strobe.on', 'Strobe on'),
            sel('strobe.type', 'Type', [['invert', 'Invert (negative)'], ['white', 'White flash'], ['color', 'Colour flash'], ['blackout', 'Black-out'], ['cycle', 'Colour cycle']]),
            c('strobe.color', 'Flash colour', { show: 'strobe.type=color' }),
            seg('strobe.rate', 'Rate', [['bpm', 'BPM SYNC'], ['hz', 'FREE HZ'], ['audio', 'AUDIO HIT']]),
            seg('strobe.div', 'Note', [['1/1', '1/1'], ['1/2', '1/2'], ['1/4', '1/4'], ['1/8', '1/8'], ['1/16', '1/16']], { show: 'strobe.rate=bpm' }),
            r('strobe.hz', 'Speed', 0.5, 15, 0.5, 'Hz', { show: 'strobe.rate=hz' }),
            sel('strobe.band', 'Trigger band', BANDS_ON, { show: 'strobe.rate=audio' }), r('strobe.thr', 'Trigger threshold', 10, 100, 1, '%', { show: 'strobe.rate=audio' }),
            r('strobe.duty', 'Flash length', 5, 90, 1, '%'), r('strobe.intensity', 'Intensity', 5, 100, 1, '%'), t('strobe.fade', 'Fade out'),
            seg('strobe.layer', 'Layer', [['top', 'OVER EVERYTHING'], ['under', 'UNDER HUD']]),
          ],
        },
      ],
    },
    {
      id: 'midi', tab: 'MIDI', title: 'MIDI', sub: '06 / CONTROL',
      icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v6M11 6v6M15 6v6M5 12h4M9 12h4M13 12h4"/>',
      sections: [
        { title: 'Controller', custom: 'midiConnect', controls: [] },
        { title: 'Mappings', custom: 'midiMappings', controls: [] },
        { title: 'Learn targets', custom: 'midiActions', controls: [] },
        { title: 'MIDI monitor', custom: 'midiMonitor', controls: [] },
      ],
    },
    {
      id: 'color', tab: 'Color', title: 'COLOR', sub: '07 / PALETTE',
      icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 20.5c-1.5 0-2-1.2-1.2-2.4.8-1.2 0-2.6-1.4-2.6"/>',
      sections: [
        { title: 'Palettes', custom: 'palettes' },
        { title: 'Background', id: 'cg-bg', controls: [c('bg.color', 'Solid colour'), c('bg.g1', 'Gradient stop 1'), c('bg.g2', 'Gradient stop 2'), c('bg.g3', 'Gradient stop 3')] },
        { title: 'Blob HUD', id: 'cg-blob', controls: [c('blob.cBox', 'Box'), c('blob.cBracket', 'Corner brackets'), c('blob.cCross', 'Crosshair'), c('blob.cLabelBg', 'Label background'), c('blob.cLabelText', 'Label text'), c('blob.cLine', 'Link lines'), c('blob.cAccent', 'Accent (main blob)'), c('blob.cTint', 'Inside tint / fill')] },
        { title: '3D', id: 'cg-model', controls: [c('model.cWire', 'Wireframe line'), c('model.cSolid', 'Material colour / tint'), c('model.cRim', 'Metal rim glow'), c('model.cDust', 'Dust')] },
        { title: '3D scene effects', id: 'cg-scene', controls: [c('scene.cStars', 'Stars'), c('scene.cMotes', 'Particles'), c('scene.cRing', 'Spectrum ring'), c('scene.cGrid', 'Grid floor'), c('scene.cLaser', 'Lasers'), c('scene.cFog', 'Fog')] },
        { title: 'Strobe', id: 'cg-strobe', controls: [c('strobe.color', 'Flash colour'), c('strobe.p1', 'Cycle 1'), c('strobe.p2', 'Cycle 2'), c('strobe.p3', 'Cycle 3'), c('strobe.p4', 'Cycle 4')] },
        { title: 'Filters', id: 'cg-fxc', controls: [c('fxc.ink', 'Halftone / dither ink'), c('fxc.paper', 'Halftone / dither paper'), c('fxc.duoA', 'Duotone shadows'), c('fxc.duoB', 'Duotone highlights'), c('fxc.edge', 'Edge / neon line'), c('fxc.t1', 'Thermal cold'), c('fxc.t2', 'Thermal mid'), c('fxc.t3', 'Thermal hot'), c('fxc.ascii', 'ASCII ink'), c('fxc.asciiBg', 'ASCII background'), c('fxc.tint', 'Infrared / X-ray tint'), c('fxc.led', 'LED colour')] },
      ],
    },
    {
      id: 'output', tab: 'Export', title: 'EXPORT', sub: '08 / OUTPUT',
      icon: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 13v7h16v-7"/>',
      sections: [
        {
          title: 'Timeline · trim', custom: 'timeline', controls: [
            r('out.aVol', 'Track volume in the export', 0, 150, 1, '%', { lock: true }),
            seg('out.durMode', 'Export length', [['audio', 'MATCH AUDIO CLIP'], ['custom', 'CUSTOM']], { lock: true }),
            r('out.dur', 'Custom length', 1, 600, 0.5, 's', { show: 'out.durMode=custom', lock: true }),
            seg('out.extend', 'If longer than the audio clip', [['silence', 'SILENCE'], ['loop', 'LOOP AUDIO']], { show: 'out.durMode=custom', lock: true }),
            r('out.vFadeIn', 'Fade visuals in from black', 0, 10, 0.1, 's', { lock: true }), r('out.vFadeOut', 'Fade visuals out to black', 0, 10, 0.1, 's', { lock: true }),
          ],
        },
        {
          title: 'Output', controls: [
            seg('out.aspect', 'Aspect', [['source', 'SOURCE'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']], { lock: true }),
            seg('out.size', 'Size (MATCH = source resolution)', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K'], ['source', 'MATCH'], ['custom', 'CUSTOM']], { lock: true }),
            { type: 'number', k: 'out.customW', label: 'Width', min: 64, max: 8192, show: 'out.size=custom', lock: true }, { type: 'number', k: 'out.customH', label: 'Height', min: 64, max: 8192, show: 'out.size=custom', lock: true },
            seg('out.fps', 'Frame rate', [['24', '24'], ['30', '30'], ['60', '60']], { lock: true }),
            seg('out.vq', 'Video quality', [['medium', 'SMALL FILE'], ['high', 'HIGH'], ['veryhigh', 'MAX']], { lock: true }),
            seg('out.container', 'Format', [['auto', 'AUTO (MP4)'], ['mov', 'MOV']], { lock: true, adv: true }),
            seg('out.quality', 'Live preview quality', [['50', '50%'], ['75', '75%'], ['100', '100%']]),
          ],
        },
        {
          title: 'Include in export', controls: [
            t('out.incHud', 'Blob HUD'), t('out.incStrobe', 'Strobe'), t('out.incDof', 'Depth of field'),
          ],
        },
        { title: 'Render', custom: 'renderBox' },
        { title: 'Scenes', custom: 'scenes' },
      ],
    },
  ];
})();
