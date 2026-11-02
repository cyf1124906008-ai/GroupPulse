'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, safeStorage, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const C = require('./core/common.cjs');
const Model = require('./core/model.cjs');
app.setName('GroupPulse');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');
protocol.registerSchemesAsPrivileged([{ scheme: 'grouppulse-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const explicit = app.commandLine.getSwitchValue('user-data-dir');
if (!app.requestSingleInstanceLock()) app.exit(0);
const profile = explicit || path.join(app.getPath('appData'), 'GroupPulse');
app.setPath('userData', profile); fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
const settingsFile = path.join(profile, 'settings.json');
let settings = { language: 'zh-CN', theme: 'light', autoSync: true, remoteMedia: false, tracked: [], ignore: [], ...C.json(settingsFile) };
const demo = app.commandLine.hasSwitch('demo');
if (demo && (!C.json(path.join(profile, 'grouppulse-demo.json')).synthetic || !settings.demo || settings.source?.selfId !== 'wxid_gp_demo')) throw new Error('INVALID_DEMO_PROFILE');
let window, activeWorker = null, activeController = null, queue = Promise.resolve(), databaseKey = null, keyInfo = null, imageKey = '', locked = Boolean(settings.lock), sourceChoice = null;
const workers = new Set();
let syncing = false, mediaActive = 0; const mediaWaiters = [], previews = new Map();
const send = (channel, value) => { if (window && !window.isDestroyed()) window.webContents.send('grouppulse:' + channel, value); };
const english = () => settings.language === 'en';
const choose = (zh, en) => english() ? en : zh;
const manifest = () => C.json(path.join(profile, 'current.json'));
function save() { C.atomic(settingsFile, settings); }
function redact() {
  const { databaseKeyCipher, modelKeyCipher, imageKeyCipher, lock, ...publicSettings } = settings;
  return { ...publicSettings, hasDatabaseKey: Boolean(databaseKeyCipher || databaseKey), hasModelKey: Boolean(modelKeyCipher), hasImageKey: Boolean(imageKeyCipher), lockEnabled: Boolean(lock), demo };
}
function seal(value) { if (demo) throw new Error('DEMO_NO_SYSTEM_KEYS'); if (!safeStorage.isEncryptionAvailable()) throw new Error('SYSTEM_STORAGE_UNAVAILABLE'); return safeStorage.encryptString(value).toString('base64'); }
function unseal(value) { if (!value) return ''; if (demo) throw new Error('DEMO_NO_SYSTEM_KEYS'); return safeStorage.decryptString(Buffer.from(value, 'base64')); }
function runWorker(action, value, extra = {}, media = false) {
  return new Promise((resolve, reject) => {
    const child = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { action, value, profile, config: { source: settings.source, remoteMedia: settings.remoteMedia, ffmpeg: settings.ffmpeg || path.join(__dirname, '../native', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), imageKey, imageXor: settings.imageXor }, ...extra } });
    workers.add(child);
    if (!media) activeWorker = child; let finished = false;
    const finish = (error, result) => { if (finished) return; finished = true; workers.delete(child); if (activeWorker === child) activeWorker = null; error ? reject(error) : resolve(result); };
    child.on('message', data => { if (data.progress) send('progress', data.progress); else if (data.error) finish(new Error(data.error)); else if ('result' in data) finish(null, data.result); });
    child.on('error', error => finish(error)); child.on('exit', () => finish(new Error('STOPPED')));
  });
}
function task(action, value = {}, extra) { const result = queue.then(() => runWorker(action, value, extra)); queue = result.catch(() => {}); return result; }
async function mediaTask(value) {
  if (mediaActive >= 2) await new Promise(resolve => mediaWaiters.push(resolve)); mediaActive++;
  try { if (locked) throw new Error('LOCKED'); return await runWorker('media', value, {}, true); } finally { mediaActive--; mediaWaiters.shift()?.(); }
}
async function refresh(explicit = false) {
  if (locked) throw new Error('LOCKED');
  if (!settings.source) throw new Error('IMPORT_FIRST');
  if (syncing) return { busy: true };
  if (settings.source.encrypted && !databaseKey) {
    if (!explicit) return { needsKey: true };
    const key = unseal(settings.databaseKeyCipher); if (!key) throw new Error('DATABASE_KEY_REQUIRED'); databaseKey = Buffer.from(key, 'hex');
  }
  if (explicit && settings.imageKeyCipher && !imageKey) imageKey = unseal(settings.imageKeyCipher);
  syncing = true;
  try {
    const result = await task('synchronize', { force: explicit }, { rawKey: databaseKey });
    if (result.changed) { previews.clear(); send('changed', { source: true, updatedAt: result.updatedAt }); }
    return result;
  } finally { syncing = false; send('progress', { phase: 'idle' }); }
}
function menu() {
  const template = [];
  if (process.platform === 'darwin') template.push({ label: 'GroupPulse', submenu: [{ role: 'about', label: choose('关于 GroupPulse', 'About GroupPulse') }, { type: 'separator' }, { role: 'hide', label: choose('隐藏 GroupPulse', 'Hide GroupPulse') }, { role: 'unhide', label: choose('显示全部', 'Show all') }, { type: 'separator' }, { role: 'quit', label: choose('退出 GroupPulse', 'Quit GroupPulse') }] });
  template.push({ label: choose('编辑', 'Edit'), submenu: [{ role: 'undo', label: choose('撤销', 'Undo') }, { role: 'redo', label: choose('重做', 'Redo') }, { type: 'separator' }, { role: 'cut', label: choose('剪切', 'Cut') }, { role: 'copy', label: choose('复制', 'Copy') }, { role: 'paste', label: choose('粘贴', 'Paste') }, { role: 'selectAll', label: choose('全选', 'Select all') }] });
  template.push({ label: choose('视图', 'View'), submenu: [{ role: 'resetZoom', label: choose('实际大小', 'Actual size') }, { role: 'zoomIn', label: choose('放大', 'Zoom in') }, { role: 'zoomOut', label: choose('缩小', 'Zoom out') }, { type: 'separator' }, { role: 'togglefullscreen', label: choose('切换全屏', 'Toggle fullscreen') }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const dbActions = new Set(['threads', 'messages', 'message', 'contacts', 'moments', 'resources', 'statistics', 'dashboard', 'market', 'prices', 'evidence']);
async function handle(action, value = {}) {
  if (action === 'bootstrap') return { settings: locked ? { language: settings.language, theme: settings.theme, lockEnabled: true } : redact(), locked, current: locked ? null : manifest(), version: app.getVersion(), platform: process.platform, independent: true };
  if (action === 'window') {
    if (value.command === 'minimize') window.minimize(); else if (value.command === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); else if (value.command === 'close') window.close(); return {};
  }
  if (action === 'unlock') {
    const lock = settings.lock; if (!lock) { locked = false; return {}; }
    const actual = crypto.scryptSync(String(value.password || ''), Buffer.from(lock.salt, 'hex'), 32);
    if (!crypto.timingSafeEqual(actual, Buffer.from(lock.hash, 'hex'))) throw new Error('PASSWORD_INCORRECT');
    locked = false; return {};
  }
  if (locked) throw new Error('LOCKED');
  if (dbActions.has(action)) return task(action, value);
  if (action === 'settings') return redact();
  if (action === 'saveSettings') {
    if (['zh-CN', 'en'].includes(value.language)) settings.language = value.language;
    if (['light', 'dark', 'system'].includes(value.theme)) settings.theme = value.theme;
    if (typeof value.autoSync === 'boolean') settings.autoSync = value.autoSync;
    if (typeof value.remoteMedia === 'boolean') settings.remoteMedia = value.remoteMedia;
    if (typeof value.autoCollect === 'boolean') settings.autoCollect = value.autoCollect;
    for (const field of ['tracked', 'ignore']) if (Array.isArray(value[field])) settings[field] = [...new Set(value[field].map(String).map(s => s.trim()).filter(Boolean))].slice(0, 200);
    if (value.model) {
      const model = value.model;
      settings.model = { baseURL: String(model.baseURL || '').trim().slice(0, 1000), model: String(model.model || '').trim().slice(0, 200), protocol: ['openai', 'responses', 'anthropic', 'google'].includes(model.protocol) ? model.protocol : 'openai' };
      if (model.apiKey) settings.modelKeyCipher = seal(String(model.apiKey));
      if (model.clearKey === true) delete settings.modelKeyCipher;
    }
    if (value.imageKey) { if (!/^[a-f0-9]{32}$/i.test(value.imageKey)) throw new Error('IMAGE_KEY_INVALID'); settings.imageKeyCipher = seal(value.imageKey); imageKey = value.imageKey; }
    save(); previews.clear(); menu(); return redact();
  }
  if (action === 'chooseSource' || action === 'chooseMediaRoot') {
    const selected = await dialog.showOpenDialog(window, { title: choose('选择微信账号或明文数据库目录', 'Choose an account or plaintext database folder'), properties: ['openDirectory'] });
    if (selected.canceled) return { canceled: true };
    if (action === 'chooseMediaRoot') { if (!settings.source) throw new Error('IMPORT_FIRST'); settings.source.mediaRoot = fs.realpathSync(selected.filePaths[0]); save(); return redact(); }
    const source = await task('inspect', { path: selected.filePaths[0] }); sourceChoice = { ...source, token: crypto.randomUUID() }; return sourceChoice;
  }
  if (action === 'import') {
    if (!sourceChoice || sourceChoice.token !== value.token) throw new Error('CHOOSE_SOURCE_FIRST');
    const source = { ...sourceChoice, selfId: String(value.selfId || '').trim() }; delete source.token;
    if (source.selfId && !/^[A-Za-z0-9_.@-]{3,128}$/.test(source.selfId)) throw new Error('ACCOUNT_ID_INVALID');
    let key = value.key ? Buffer.from(String(value.key), 'hex') : keyInfo;
    if (source.encrypted && (!key || key.length !== 32 || !/^[a-f0-9]{64}$/i.test(key.toString('hex')))) throw new Error('DATABASE_KEY_REQUIRED');
    if (source.encrypted && !require('./core/snapshot.cjs').verifyKey(key, path.join(source.databaseRoot, 'session/session.db'))) throw new Error('DATABASE_KEY_INVALID');
    const protectedKey = source.encrypted && value.remember !== false ? seal(key.toString('hex')) : '';
    syncing = true;
    try {
      const result = await task('synchronize', {}, { config: { ...settings, source }, rawKey: source.encrypted ? key : null });
      databaseKey?.fill(0); databaseKey = key ? Buffer.from(key) : null; keyInfo?.fill(0); keyInfo = null;
      settings.source = source; settings.databaseKeyCipher = protectedKey; save(); previews.clear(); sourceChoice = null;
      send('changed', { source: true, updatedAt: result.updatedAt }); return result;
    } finally { key?.fill(0); syncing = false; send('progress', { phase: 'idle' }); }
  }
  if (action === 'refresh') return refresh(true);
  if (action === 'cancel') { activeController?.abort(); activeWorker?.terminate(); return {}; }
  if (action === 'copyText') { const text = String(value.text || ''); if (text.length > 4000000) throw new Error('TEXT_TOO_LARGE'); clipboard.writeText(text); return { copied: true }; }
  if (action === 'revealResource') {
    const current = manifest(), db = C.open(current.index);
    try { const row = db.prepare('SELECT path FROM media WHERE key=? LIMIT 1').get(String(value.key)); if (!row) throw new Error('MEDIA_NOT_FOUND'); shell.showItemInFolder(C.safeFile(settings.source.mediaRoot, path.join(settings.source.mediaRoot, row.path))); } finally { db.close(); }
    return {};
  }
  if (action === 'copy') {
    const message = await task('message', String(value.id)); if (!message) throw new Error('MESSAGE_NOT_FOUND');
    const text = value.mode === 'identity' ? [message.senderName, message.senderId, message.alias].filter(Boolean).join('\n') : value.mode === 'source' ? [message.threadName, message.senderName + ' · ' + message.senderId, new Date(message.timestamp * 1000).toLocaleString(settings.language), message.raw || message.body].join('\n') : message.raw || message.body;
    clipboard.writeText(text); return { copied: true };
  }
  if (action === 'saveMessage') {
    const message = await task('message', String(value.id)); if (!message) throw new Error('MESSAGE_NOT_FOUND');
    const file = path.join(profile, 'saved-' + C.hash(settings.source?.databaseRoot || '').slice(0, 20) + '.json'), saved = C.json(file, []), index = saved.findIndex(item => item.id === message.id);
    if (index >= 0) saved.splice(index, 1); else saved.unshift({ id: message.id, threadId: message.threadId, body: message.body, senderName: message.senderName, threadName: message.threadName, timestamp: message.timestamp });
    C.atomic(file, saved); return { saved: index < 0 };
  }
  if (action === 'saved') return C.json(path.join(profile, 'saved-' + C.hash(settings.source?.databaseRoot || '').slice(0, 20) + '.json'), []);
  if (action === 'export') {
    const format = ['json', 'html'].includes(value.format) ? value.format : 'csv';
    const destination = await dialog.showSaveDialog(window, { title: choose('导出当前筛选', 'Export current filters'), defaultPath: 'GroupPulse-' + new Date().toISOString().slice(0, 10) + '.' + format, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (destination.canceled) return { canceled: true };
    return task('export', { output: destination.filePath, format, options: value.options || {}, scope: value.scope || 'search', language: settings.language });
  }
  if (action === 'modelPreview') {
    if (!settings.model?.baseURL || !settings.model?.model) throw new Error('CONFIGURE_MODEL_FIRST');
    const evidence = await task('evidence', { ...(value.options || {}), samples: Math.min(60, Number(value.samples) || 30) });
    const request = Model.requestFor(settings.model, evidence, value.question, settings.language);
    const id = crypto.randomUUID(), preview = { id, evidence, question: String(value.question || '').slice(0, 4000), index: manifest().index, model: JSON.stringify(settings.model), created: Date.now() };
    previews.clear(); previews.set(id, preview);
    return { id, destination: request.url, model: settings.model.model, samples: evidence.samples.length, groups: evidence.groups, eligible: evidence.eligible, characters: evidence.characters };
  }
  if (action === 'modelRun') {
    const preview = previews.get(value.id); previews.delete(value.id);
    if (!preview || Date.now() - preview.created > 300000 || preview.index !== manifest().index || preview.model !== JSON.stringify(settings.model)) throw new Error('MODEL_PREVIEW_EXPIRED');
    const text = choose('将向以下模型服务发送群名、发送者显示名、时间和原文摘录。不会发送整个数据库、图片、语音或密钥。', 'Send conversation names, sender display names, timestamps and original excerpts to this model service. The complete database, images, audio and database keys are not sent.');
    const result = await dialog.showMessageBox(window, { type: 'question', title: choose('确认发送给模型', 'Confirm sending to the model'), message: choose('发送这些摘录进行分析？', 'Send these excerpts for analysis?'), detail: text + '\n\n' + settings.model.baseURL + '\n' + settings.model.model + '\n\n' + preview.evidence.samples.length + choose(' 条摘录，约 ', ' excerpts, about ') + preview.evidence.characters + choose(' 字符。模型服务可能计费。', ' characters. Provider charges may apply.'), buttons: [choose('取消', 'Cancel'), choose('发送并分析', 'Send and analyze')], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) return { canceled: true };
    activeController = new AbortController();
    try { return await Model.run(settings.model, preview.evidence, preview.question, settings.language, unseal(settings.modelKeyCipher), activeController.signal); }
    finally { activeController = null; }
  }
  if (action === 'setLock') {
    const password = String(value.password || ''); if (password && password.length < 6) throw new Error('PASSWORD_TOO_SHORT');
    if (password) { const salt = crypto.randomBytes(16); settings.lock = { salt: salt.toString('hex'), hash: crypto.scryptSync(password, salt, 32).toString('hex') }; } else delete settings.lock;
    save(); return { enabled: Boolean(settings.lock) };
  }
  if (action === 'lock') { if (!settings.lock) throw new Error('CONFIGURE_LOCK_FIRST'); locked = true; databaseKey?.fill(0); databaseKey = null; keyInfo?.fill(0); keyInfo = null; imageKey = ''; activeController?.abort(); for (const worker of workers) worker.terminate(); previews.clear(); send('changed', { locked: true }); return {}; }
  if (action === 'chooseDecoder') {
    const selected = await dialog.showOpenDialog(window, { title: choose('选择本机 FFmpeg 程序', 'Choose a local FFmpeg executable'), properties: ['openFile'] });
    if (selected.canceled) return { canceled: true }; settings.ffmpeg = fs.realpathSync(selected.filePaths[0]); save(); return redact();
  }
  if (action === 'openLink') {
    const url = new URL(String(value.url)); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('LINK_NOT_ALLOWED');
    await shell.openExternal(url.href); return {};
  }
  if (action === 'captureKey') return require('./capture.cjs').capture({ source: sourceChoice, app, window, profile, progress: value => send('progress', value), onKey: key => { keyInfo?.fill(0); keyInfo = Buffer.from(key); } });
  if (action === 'importKeyInfo') {
    if (process.platform !== 'win32') throw new Error('WINDOWS_ONLY');
    const result = await dialog.showOpenDialog(window, { title: 'ChatTrace .keyinfo', filters: [{ name: 'ChatTrace', extensions: ['keyinfo'] }], properties: ['openFile'] });
    if (result.canceled) return { canceled: true };
    const loaded = await require('./dpapi.cjs').importKeyInfo(result.filePaths[0]); keyInfo?.fill(0); keyInfo = loaded.raw; return { loaded: true, accountId: loaded.accountId };
  }
  throw new Error('ACTION_NOT_ALLOWED');
}
app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: 'GroupPulse', applicationVersion: app.getVersion(), copyright: '© GroupPulse contributors. PolyForm Noncommercial 1.0.0.' });
  menu();
  protocol.handle('grouppulse-media', async request => {
    if (locked || !window || window.isDestroyed()) return new Response('', { status: 403 });
    try {
      const url = new URL(request.url), [kind, id, item] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (url.hostname !== 'local' || !id || id.length > 200) return new Response('', { status: 400 });
      const result = await mediaTask({ kind, id, item });
      if (locked) return new Response('', { status: 403 });
      C.safeFile(result.original ? settings.source.mediaRoot : path.join(profile, 'cache/media'), result.file);
      return require('./core/media-response.cjs').respond(result.file, result.type, request, result.firstFrameOnly);
    } catch { return new Response('', { status: 404 }); }
  });
  const ui = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
  window = new BrowserWindow({ title: 'GroupPulse', width: 1420, height: 920, minWidth: 920, minHeight: 640, frame: false, enableLargerThanScreen: process.env.GROUPPULSE_CI === '1' && demo, backgroundColor: settings.theme === 'dark' ? '#172735' : '#f4f7fa', icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('grouppulse:request', async (event, request) => {
    try {
      if (!window || window.isDestroyed() || event.sender.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.sender.getURL().split('#')[0] !== ui) return { ok: false, error: 'WINDOW_NOT_ALLOWED' };
      return { ok: true, value: await handle(String(request?.action), request?.value) };
    }
    catch (error) { return { ok: false, error: error.message || 'OPERATION_FAILED' }; }
  });
  if (process.env.GROUPPULSE_CI === '1' && app.commandLine.hasSwitch('native-test')) require('./native-test.cjs').install({ app, window, handle });
  await window.loadFile(path.join(__dirname, 'ui/index.html'));
  const timer = setInterval(() => { if (!locked && settings.autoSync && settings.source && !syncing) refresh(false).catch(() => send('progress', { phase: 'error' })); }, 60000); timer.unref();
  if (settings.source && !locked && !settings.source.encrypted) refresh(false).catch(() => send('progress', { phase: 'error' }));
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { databaseKey?.fill(0); keyInfo?.fill(0); activeController?.abort(); for (const worker of workers) worker.terminate(); });

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
