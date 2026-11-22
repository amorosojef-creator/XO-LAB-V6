/* XO LAB — starter MIDI profiles for common controllers.
 * They use each controller's factory layout as published by the maker. Exact numbers can differ with firmware,
 * templates or editor settings, so every starter says "check with LEARN" in the app. All use the same musical
 * layout: faders = big moves, knobs = detail, one row of pads = scene slots 1–8, another = live actions. */
(function () {
  'use strict';
  const XO = window.XO;
  const FADERS = ['media.zoom', 'media.posX', 'media.posY', 'blob.sens', 'blob.maxBlobs', 'dof.amount', 'strobe.hz', 'media.volume'];
  const KNOBS = ['model.spin3', 'dof.size', 'dof.falloff', 'dof.bokeh', 'blob.smooth', 'blob.minCells', 'audio.liveGain', 'audio.bpm'];
  const ACTIONS = [['blackout', 'momentary'], ['freeze', 'momentary'], ['strobe', 'momentary'], ['randomize', 'trigger'], ['undo', 'trigger'], ['redo', 'trigger'], ['liveAudio', 'trigger'], ['camera', 'trigger']];
  const T = (tg) => ({ tg, min: 0, max: 1, invert: false, curve: 'linear' });

  function layout(o) {
    const D = XO.midi.defaults, map = {};
    (o.faders || []).forEach((src, i) => { if (!FADERS[i]) return; map[src] = Object.assign(D('fader'), { targets: [T({ t: 'range', k: FADERS[i] })] }); });
    (o.knobs || []).forEach((src, i) => { if (!KNOBS[i]) return; map[src] = Object.assign(D(o.encoders ? 'encoder' : 'knob'), { targets: [T({ t: 'range', k: KNOBS[i] })] }); });
    (o.scenes || []).forEach((src, i) => { map[src] = Object.assign(D('trigger'), { targets: [T({ t: 'sceneAt', i })] }); });
    (o.actions || []).forEach((src, i) => { const a = ACTIONS[i]; if (!a) return; map[src] = Object.assign(D(a[1]), { targets: [T({ t: 'action', a: a[0] })] }); });
    Object.keys(o.extra || {}).forEach((src) => { const [type, tg] = o.extra[src]; map[src] = Object.assign(D(type), { targets: [T(tg)] }); });
    if (o.master) map[o.master] = Object.assign(D('fader'), { targets: [T({ t: 'range', k: 'audio.liveGain' })] });
    return map;
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const cc = (ch, nums) => nums.map((n) => 'cc:' + ch + ':' + n);
  const note = (ch, nums) => nums.map((n) => 'note:' + ch + ':' + n);

  XO.MIDI_STARTERS = {
    'Korg nanoKONTROL2': {
      about: 'CC mode, MIDI channel 1 (factory). Faders, knobs, S = scene slots, M = actions, transport = play / tap / scenes.',
      build: () => layout({
        faders: cc(1, range(0, 7)), knobs: cc(1, range(16, 23)), scenes: cc(1, range(32, 39)), actions: cc(1, range(48, 55)),
        extra: { 'cc:1:41': ['trigger', { t: 'action', a: 'play' }], 'cc:1:46': ['trigger', { t: 'action', a: 'tap' }], 'cc:1:58': ['trigger', { t: 'action', a: 'prevScene' }], 'cc:1:59': ['trigger', { t: 'action', a: 'nextScene' }], 'cc:1:61': ['trigger', { t: 'action', a: 'undo' }], 'cc:1:62': ['trigger', { t: 'action', a: 'redo' }] },
      }),
    },
    'Akai MIDImix': {
      about: 'Factory map, channel 1. Top knob row, 8 faders + master, MUTE = scene slots, REC ARM = actions.',
      build: () => layout({
        faders: cc(1, [19, 23, 27, 31, 49, 53, 57, 61]), knobs: cc(1, [16, 20, 24, 28, 46, 50, 54, 58]), master: 'cc:1:62',
        scenes: note(1, [1, 4, 7, 10, 13, 16, 19, 22]), actions: note(1, [3, 6, 9, 12, 15, 18, 21, 24]),
      }),
    },
    'Novation Launch Control XL': {
      about: 'Factory template 1 (MIDI channel 9). Top knob row, 8 faders, track focus = scene slots, track control = actions.',
      build: () => layout({ faders: cc(9, range(77, 84)), knobs: cc(9, range(13, 20)), scenes: note(9, [41, 42, 43, 44, 57, 58, 59, 60]), actions: note(9, [73, 74, 75, 76, 89, 90, 91, 92]) }),
    },
    'Akai APC mini mk2': {
      about: 'Factory map, channel 1. 8 faders, scene-launch buttons = scene slots, bottom pad row = actions, SHIFT = SHIFT.',
      build: () => layout({ faders: cc(1, range(48, 55)), scenes: note(1, range(112, 119)), actions: note(1, range(0, 7)), extra: { 'note:1:122': ['momentary', { t: 'shift' }], 'cc:1:56': ['fader', { t: 'range', k: 'audio.liveGain' }] } }),
    },
    'Generic pads + knobs': {
      about: 'Common default for pad controllers: knobs CC 1–8 on channel 1, pads note 36 up (36–43 scene slots, 44–51 actions).',
      build: () => layout({ knobs: cc(1, range(1, 8)), scenes: note(1, range(36, 43)), actions: note(1, range(44, 51)) }),
    },
  };
  XO.MIDI_LAYOUT = { FADERS, KNOBS, ACTIONS };
})();
