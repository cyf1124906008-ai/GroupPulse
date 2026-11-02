'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['bootstrap', 'chooseSource', 'chooseMediaRoot', 'chooseDecoder', 'import', 'refresh', 'cancel', 'threads', 'messages', 'message', 'contacts', 'moments', 'resources', 'statistics', 'dashboard', 'market', 'prices', 'evidence', 'settings', 'saveSettings', 'copy', 'copyText', 'revealResource', 'export', 'saveMessage', 'saved', 'modelPreview', 'modelRun', 'lock', 'unlock', 'setLock', 'window', 'openLink', 'captureKey', 'importKeyInfo']);
contextBridge.exposeInMainWorld('groupPulse', {
  invoke: (action, value = {}) => allowed.has(action) ? ipcRenderer.invoke('grouppulse:request', { action, value }) : Promise.resolve({ ok: false, error: 'ACTION_NOT_ALLOWED' }),
  onProgress: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('grouppulse:progress', listener); return () => ipcRenderer.removeListener('grouppulse:progress', listener); },
  onChanged: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('grouppulse:changed', listener); return () => ipcRenderer.removeListener('grouppulse:changed', listener); }
});
