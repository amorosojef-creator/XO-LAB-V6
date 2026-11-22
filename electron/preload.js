// XO LAB — the only bridge between the web app and the desktop. Exposes a few safe functions, nothing else.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xoDesktop', {
  platform: process.platform, // 'win32' | 'darwin'
  info: () => ipcRenderer.invoke('xo:info'),
  setAwake: (on) => ipcRenderer.send('xo:awake', !!on),
  setTitle: (title) => ipcRenderer.send('xo:title', String(title || '')),
  onMenu: (fn) => ipcRenderer.on('xo:menu', (e, action) => fn(action)),
  onSaved: (fn) => ipcRenderer.on('xo:saved', (e, info) => fn(info)),
});
