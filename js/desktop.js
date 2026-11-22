/* XO LAB — top bar (undo / redo / project) and shortcuts for every platform, plus the Windows / Mac app menu. */
(function () {
  'use strict';
  const XO = window.XO, $ = XO.$, D = window.xoDesktop || null;
  XO.isDesktopApp = !!D;
  if (D) document.documentElement.classList.add('desktop-app', D.platform === 'darwin' ? 'mac' : 'win');

  const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|range|button|file)$/.test(a.type)) || a.isContentEditable)); };

  function undo() { if (typing()) { document.execCommand('undo'); return; } if (XO.history.undo()) XO.toast('Undo'); }
  function redo() { if (typing()) { document.execCommand('redo'); return; } if (XO.history.redo()) XO.toast('Redo'); }
  XO.undo = undo; XO.redo = redo;

  const ACTIONS = {
    'open-visual': () => $('#visualInput') && $('#visualInput').click(),
    'open-model': () => $('#modelInput') && $('#modelInput').click(),
    'open-audio': () => $('#audioInput') && $('#audioInput').click(),
    'open-project': () => XO.project.openPicker(),
    'save-project': () => XO.project.save(),
    undo, redo,
    play: () => XO.togglePlay && XO.togglePlay(),
  };
  function run(action) {
    const sp = $('#splash');
    if (sp && !sp.classList.contains('gone') && XO.qa) XO.qa.enter();
    const fn = ACTIONS[action]; if (fn) fn();
  }
  XO.runAction = run;

  // Keyboard (browser + iPad keyboards). In the desktop app the menu owns these keys, so skip them here.
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || D) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { if (!typing()) { e.preventDefault(); undo(); } }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { if (!typing()) { e.preventDefault(); redo(); } }
    else if (k === 's') { e.preventDefault(); run('save-project'); }
  });

  function topbar() {
    const bar = $('.topbar'); if (!bar || $('#undoBtn')) return;
    const box = document.createElement('div');
    box.className = 'top-tools';
    box.innerHTML = `<button class="tool" id="undoBtn" type="button" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled>↶</button><button class="tool" id="redoBtn" type="button" title="Redo" aria-label="Redo" disabled>↷</button><button class="tool proj" id="projectBtn" type="button" title="Save project (Ctrl/Cmd+S)"><span class="k">PROJECT</span> <span id="projectName">UNTITLED</span></button>`;
    bar.insertBefore(box, $('#topStatus'));
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    $('#projectBtn').addEventListener('click', () => { XO.showTab('media'); const s = $('#projectSave'); if (s) XO.revealInPanel(s, 'center'); });
    XO.history.onChange = (u, r) => { $('#undoBtn').disabled = !u; $('#redoBtn').disabled = !r; };
  }

  function init() {
    topbar();
    if (D) {
      D.onMenu(run);
      D.onSaved((info) => { if (info.state === 'completed') XO.toast('Saved: ' + info.path.split(/[\\/]/).pop()); else if (info.state === 'interrupted') XO.toast('Saving failed.', true); });
      D.setTitle(XO.project.name === 'UNTITLED' ? '' : XO.project.name);
    }
  }
  if (XO.ready) init(); else document.addEventListener('xo:ready', init, { once: true });
})();
