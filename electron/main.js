// XO LAB — desktop app (Windows + macOS). Wraps the same web app the browser and iPhone use.
// The app is served from a private app:// address so storage, WebCodecs export, mic, camera and MIDI all work offline.
'use strict';
const { app, BrowserWindow, Menu, protocol, net, session, shell, ipcMain, dialog, systemPreferences, powerSaveBlocker, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const HOST = 'xo-lab';
const START_URL = `${SCHEME}://${HOST}/index.html`;
const WEB_ROOT = path.join(__dirname, '..', 'www');
const RELEASES = 'https://github.com/amorosojef-creator/XO-LAB-V5/releases';
const isMac = process.platform === 'darwin';

// Headless CI / VMs have no GPU: let Chromium use its software renderer so WebGL still works.
if (process.env.XO_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
// Automated tests only: a fake mic/camera with no permission popup.
if (process.env.XO_FAKE_MEDIA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
}]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

/* ---------------- window size memory ---------------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return null; }
}
function saveState(win) {
  try {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));
  } catch (e) { /* not important */ }
}
function onScreen(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 80 && b.y + b.height > a.y;
  });
}

/* ---------------- serving the app ---------------- */
function serveApp() {
  protocol.handle(SCHEME, (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('Not found', { status: 404 });
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(WEB_ROOT, p));
    if (!file.startsWith(WEB_ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* ---------------- permissions: mic, camera, MIDI, fullscreen ---------------- */
const ALLOWED = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'clipboard-sanitized-write', 'window-management', 'speaker-selection', 'pointerLock']);
function setupPermissions(ses) {
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED.has(permission) && String(origin || '').startsWith(`${SCHEME}://${HOST}`));
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (!ALLOWED.has(permission) || !String(details.requestingUrl || '').startsWith(`${SCHEME}://${HOST}`)) return callback(false);
    if (permission === 'media' && isMac) {
      // macOS asks the user once per app (System Settings → Privacy & Security → Microphone / Camera).
      const types = details.mediaTypes || [];
      try {
        if (types.includes('audio') && !(await systemPreferences.askForMediaAccess('microphone'))) return callback(false);
        if (types.includes('video') && !(await systemPreferences.askForMediaAccess('camera'))) return callback(false);
      } catch (e) { /* older macOS: Chromium asks instead */ }
    }
    callback(true);
  });
}

/* ---------------- downloads: exports & project files ---------------- */
function setupDownloads(ses) {
  ses.on('will-download', (event, item) => {
    const name = item.getFilename();
    const folder = /\.(mp4|mov|webm|gif)$/i.test(name) ? 'videos' : 'documents';
    let defaultPath = name;
    try { defaultPath = path.join(app.getPath(folder), name); } catch (e) { /* fall back to the name */ }
    item.setSaveDialogOptions({ title: 'Save ' + name, defaultPath });
    item.once('done', (e, state) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) win.webContents.send('xo:saved', { state, path: state === 'completed' ? item.getSavePath() : '' });
    });
  });
}

/* ---------------- keep the screen awake while playing / rendering ---------------- */
let blocker = -1;
ipcMain.on('xo:awake', (e, on) => {
  if (on && blocker < 0) blocker = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && blocker >= 0) { powerSaveBlocker.stop(blocker); blocker = -1; }
});
ipcMain.handle('xo:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome }));
ipcMain.on('xo:title', (e, title) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setTitle(title ? title + ' — XO LAB' : 'XO LAB'); });

/* ---------------- menu ---------------- */
function send(action) { const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; if (w) w.webContents.send('xo:menu', action); }
function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  const template = [
    ...(isMac ? [{ label: 'XO LAB', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        item('Open Visual…', 'CmdOrCtrl+O', 'open-visual'),
        item('Open 3D Model…', 'CmdOrCtrl+Shift+M', 'open-model'),
        item('Open Audio…', 'CmdOrCtrl+Shift+A', 'open-audio'),
        { type: 'separator' },
        item('Open Project…', 'CmdOrCtrl+Shift+O', 'open-project'),
        item('Save Project…', 'CmdOrCtrl+S', 'save-project'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'CmdOrCtrl+Z', 'undo'),
        item('Redo', isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', 'redo'),
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Play / Pause', 'Space', 'play'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload', label: 'Reload App' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Check for Updates…', click: () => shell.openExternal(RELEASES) },
        { label: 'How to Install', click: () => shell.openExternal('https://github.com/amorosojef-creator/XO-LAB-V5/blob/main/INSTALL.md') },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'About XO LAB', click: () => dialog.showMessageBox({ type: 'info', title: 'About XO LAB', message: 'XO LAB ' + app.getVersion(), detail: 'Audio-reactive live visuals for DJs.\nYour files never leave this computer.' }) }]),
      ],
    },
  ];
  // "Space" as a menu accelerator would steal the key from text fields — keep it as a label only.
  template.forEach((m) => (m.submenu || []).forEach((s) => { if (s.accelerator === 'Space') { s.accelerator = undefined; s.label += '\tSpace'; } }));
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- main window ---------------- */
let mainWin = null;
function createWindow() {
  const st = loadState();
  const b = onScreen(st) ? st : { width: 1440, height: 900 };
  mainWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 1024, minHeight: 640,
    backgroundColor: '#000000', title: 'XO LAB', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    ...(isMac ? { titleBarStyle: 'default' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false,
    },
  });
  if (st && st.maximized) mainWin.maximize();
  if (st && st.fullscreen) mainWin.setFullScreen(true);
  mainWin.webContents.setVisualZoomLevelLimits(1, 1); // trackpad pinch never zooms the UI
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${SCHEME}://${HOST}`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWin.once('ready-to-show', () => mainWin.show());
  ['resize', 'move', 'close'].forEach((ev) => mainWin.on(ev, () => saveState(mainWin)));
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.loadURL(START_URL);
}

app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.whenReady().then(() => {
  serveApp();
  setupPermissions(session.defaultSession);
  setupDownloads(session.defaultSession);
  buildMenu();
  if (isMac) app.setAboutPanelOptions({ applicationName: 'XO LAB', applicationVersion: app.getVersion(), credits: 'Audio-reactive live visuals for DJs.' });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
