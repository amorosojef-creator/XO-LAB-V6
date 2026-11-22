/* XO LAB — undo / redo for every setting.
 * Watches the whole settings object; a change that has stayed put for one beat (~350 ms) becomes one undo
 * step, so dragging a slider is one step, not hundreds. 50 steps deep. Media files are not part of undo. */
(function () {
  'use strict';
  const XO = window.XO;
  const LIMIT = 50, TICK = 350;
  const H = (XO.history = { undoStack: [], redoStack: [], onChange: null });
  let committed = '', pending = '', paused = false;

  const now = () => JSON.stringify(XO.S);
  function notify() { if (H.onChange) H.onChange(H.canUndo(), H.canRedo()); }

  H.canUndo = () => H.undoStack.length > 0;
  H.canRedo = () => H.redoStack.length > 0;
  H.reset = function () { H.undoStack = []; H.redoStack = []; committed = pending = now(); notify(); };

  /** Record any finished change right away (e.g. before an undo, or before a project is saved). */
  H.flush = function () {
    const cur = now();
    if (cur !== committed) {
      H.undoStack.push(committed);
      if (H.undoStack.length > LIMIT) H.undoStack.shift();
      H.redoStack = [];
      committed = pending = cur;
      notify();
    }
  };
  function apply(json) {
    paused = true;
    XO.applySnapshot(JSON.parse(json));
    if (XO.afterLoadState) XO.afterLoadState();
    committed = pending = now();
    paused = false;
    notify();
  }
  H.undo = function () {
    H.flush();
    if (!H.undoStack.length) return false;
    H.redoStack.push(committed);
    apply(H.undoStack.pop());
    return true;
  };
  H.redo = function () {
    H.flush();
    if (!H.redoStack.length) return false;
    H.undoStack.push(committed);
    apply(H.redoStack.pop());
    return true;
  };
  /** Run fn without recording it (e.g. loading a project replaces history instead). */
  H.silently = async function (fn) { paused = true; try { return await fn(); } finally { committed = pending = now(); paused = false; } };

  setInterval(() => {
    if (paused) return;
    const cur = now();
    if (cur === committed) { pending = cur; return; }
    if (cur === pending) H.flush(); // unchanged for one tick → it's a finished edit
    else pending = cur;
  }, TICK);

  committed = pending = now();
})();
