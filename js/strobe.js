/* XO LAB — strobe with photosensitivity safety cap.
 * Default cap: 3 flashes/second. Up to 15 Hz only after an explicit unlock.
 */
(function () {
  'use strict';
  const XO = window.XO;
  const ST = (XO.strobe = { anchor: null, lastIdx: null, held: false, lastStart: -1e9, flashUntil: 0, flashLen: 0, cycle: 0, flashes: [], env: 0 });
  const DIV = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
  ST.SAFE_HZ = 3; ST.MAX_HZ = 15;
  ST.maxHz = () => (XO.S.strobe.unlocked ? ST.MAX_HZ : ST.SAFE_HZ);

  function start(now, lenMs) {
    const minGap = 1000 / ST.maxHz();
    if (now - ST.lastStart < minGap - 1) return false; // safety cap
    ST.lastStart = now; ST.flashUntil = now + lenMs; ST.flashLen = lenMs; ST.cycle++;
    ST.flashes.push(now); if (ST.flashes.length > 64) ST.flashes.shift();
    return true;
  }

  // Returns flash envelope 0..1 for this frame
  ST.update = function (now, audio) {
    const s = XO.S.strobe;
    const active = s.on || ST.held;
    if (active) {
      if (s.rate === 'audio') {
        if (audio.trigger('strobe', s.band, s.thr / 100, 0, now)) start(now, Math.max(25, s.duty * 4));
      } else {
        const period = s.rate === 'hz' ? 1000 / Math.min(s.hz, ST.maxHz()) : (60000 / Math.max(30, audio.effectiveBpm())) * DIV[s.div];
        const len = Math.max(16, period * s.duty / 100);
        const ref = s.rate === 'bpm' && audio.beatRef() ? audio.beatRef() : 0;
        // re-anchor the grid on each detected beat; count whole periods so slow devices never skip a flash
        if (ref !== ST.anchor) {
          ST.anchor = ref;
          ST.lastIdx = now - ST.lastStart < period * 0.5 ? 0 : -1; // a flash just fired for this beat
        }
        const idx = Math.floor((now - ST.anchor) / period);
        if (idx !== ST.lastIdx) { ST.lastIdx = idx; start(now, len); }
      }
    }
    if (!active) ST.flashUntil = 0; // switching off / releasing stops the flash immediately
    if (now < ST.flashUntil) {
      const p = 1 - (ST.flashUntil - now) / ST.flashLen;
      ST.env = s.fade ? 1 - p : 1;
    } else ST.env = 0;
    return ST.env;
  };

  ST.draw = function (ctx, W, H) {
    const s = XO.S.strobe, a = ST.env * s.intensity / 100;
    if (a <= 0.003) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    if (s.type === 'invert') { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff'; }
    else if (s.type === 'white') ctx.fillStyle = '#ffffff';
    else if (s.type === 'blackout') ctx.fillStyle = '#000000';
    else if (s.type === 'cycle') ctx.fillStyle = [s.p1, s.p2, s.p3, s.p4][ST.cycle % 4];
    else ctx.fillStyle = s.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  // Measured flash rate over the last 2 s (for the UI + tests)
  ST.rate = function (now) { const recent = ST.flashes.filter((t) => now - t < 2000); return recent.length / 2; };
})();
