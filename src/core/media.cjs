'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('./common.cjs');
const Codec = require('./media-codec.cjs');
const { Isaac } = require('./isaac.cjs');
function mediaType(bytes) {
  return Codec.imageType(bytes) || (bytes.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' ? 'audio/wav' : null);
}
function wav(pcm, rate = 24000) {
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function voice(generation, message) {
  const folder = path.join(generation, 'source/message'); if (!fs.existsSync(folder)) return null;
  for (const name of fs.readdirSync(folder).filter(name => /^media_\d+\.db$/.test(name))) {
    const db = C.open(path.join(folder, name));
    try {
      const table = C.tables(db).find(name => name.toLowerCase() === 'voiceinfo'); if (!table) continue;
      let row;
      if (message.server_id && message.server_id !== '0') row = db.prepare('SELECT voice_data FROM ' + C.quote(table) + ' WHERE svr_id=? LIMIT 1').get(BigInt(message.server_id));
      if (!row && C.tables(db).includes('Name2Id')) {
        const contact = db.prepare('SELECT rowid AS id FROM Name2Id WHERE user_name=? LIMIT 1').get(message.thread);
        if (contact) row = db.prepare('SELECT voice_data FROM ' + C.quote(table) + ' WHERE chat_name_id=? AND local_id=? AND create_time=? LIMIT 1').get(contact.id, message.local_id, message.time);
      }
      if (row?.voice_data?.length) return Buffer.from(row.voice_data);
    } finally { db.close(); }
  }
  return null;
}
function packedKeys(value, depth = 0) {
  const buffer = Buffer.from(value || []), found = new Set(buffer.toString('latin1').match(/[0-9a-f]{32}/gi) || []);
  if (depth > 5 || buffer.length > 1024 * 1024) return [...found];
  let at = 0;
  function integer() { let n = 0n, shift = 0n; for (let k = 0; k < 10 && at < buffer.length; k++) { const b = buffer[at++]; n |= BigInt(b & 127) << shift; if (b < 128) return n; shift += 7n; } throw Error('PACKED'); }
  try {
    while (at < buffer.length) {
      const wire = Number(integer() & 7n);
      if (wire === 0) integer();
      else if (wire === 1) at += 8;
      else if (wire === 5) at += 4;
      else if (wire === 2) {
        const length = Number(integer()); if (length < 0 || length > buffer.length - at) break;
        const bytes = buffer.subarray(at, at + length); at += length;
        if (length === 16) found.add(bytes.toString('hex'));
        if (length === 32 && /^[a-f0-9]{32}$/i.test(bytes.toString())) found.add(bytes.toString());
        for (const key of packedKeys(bytes, depth + 1)) found.add(key);
      } else break;
    }
  } catch {}
  return [...found].map(key => key.toLowerCase());
}
const approvedHost = url => url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && /^(?:mmsns(?:\.[a-z0-9-]+)?\.qpic\.cn|mmsns(?:\.c2c)?\.wechat\.com|wx\.qlogo\.cn)$/i.test(url.hostname);
async function download(url) {
  const parsed = new URL(url); if (!approvedHost(parsed)) throw new Error('MEDIA_HOST_NOT_ALLOWED');
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error('MEDIA_DOWNLOAD_FAILED');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 32 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('MEDIA_TOO_LARGE'); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
function sourceKeys(generation, message) {
  const keys = new Set(message.media_key ? [message.media_key] : []);
  const file = C.safeFile(path.join(generation, 'source'), path.join(generation, 'source', message.shard));
  const db = C.open(file);
  try {
    const available = C.columns(db, message.source_table);
    if (available.includes('packed_info_data')) {
      const row = db.prepare('SELECT packed_info_data FROM ' + C.quote(message.source_table) + ' WHERE local_id=? LIMIT 1').get(message.local_id);
      for (const key of packedKeys(row?.packed_info_data)) keys.add(key);
    }
  } finally { db.close(); }
  const resources = path.join(generation, 'source/message/message_resource.db');
  if (fs.existsSync(resources)) {
    const source = C.open(resources);
    try {
      for (const table of C.tables(source)) {
        const fields = C.columns(source, table); if (!fields.includes('message_local_id')) continue;
        const filters = ['message_local_id=?'], values = [message.local_id];
        if (fields.includes('message_create_time')) { filters.push('message_create_time=?'); values.push(message.time); }
        if (fields.includes('chat_id') && C.tables(source).includes('ChatName2Id')) {
          const row = source.prepare('SELECT rowid AS id FROM ChatName2Id WHERE user_name=? LIMIT 1').get(message.thread);
          if (row) { filters.push('chat_id=?'); values.push(row.id); }
        }
        const collect = row => { for (const value of Object.values(row)) {
          if (value instanceof Uint8Array) for (const key of packedKeys(value)) keys.add(key);
          else if (/^[a-f0-9]{32}$/i.test(String(value))) keys.add(String(value).toLowerCase());
        } };
        for (const row of C.rows(source, 'SELECT * FROM ' + C.quote(table) + ' WHERE ' + filters.join(' AND ') + ' LIMIT 50', values)) {
          collect(row);
          if (row.message_id && C.tables(source).includes('MessageResourceDetail')) for (const detail of C.rows(source, 'SELECT packed_info FROM MessageResourceDetail WHERE message_id=? LIMIT 100', [row.message_id])) collect(detail);
        }
      }
    } finally { source.close(); }
  }
  return [...keys];
}
function localMedia(index, keys, root) {
  for (const key of keys) {
    const rows = index.prepare("SELECT path FROM media WHERE key=? ORDER BY (path LIKE '%_t.%'),(path LIKE '%_thumb.%'),size DESC").all(key);
    for (const row of rows) { try { return C.safeFile(root, path.join(root, row.path)); } catch {} }
  }
  return null;
}
function avatar(generation, id) {
  for (const relative of ['head_image/head_image.db', 'contact/head_image.db']) {
    const file = path.join(generation, 'source', relative); if (!fs.existsSync(file)) continue;
    const db = C.open(file);
    try {
      for (const table of C.tables(db)) {
        const fields = C.columns(db, table), user = ['username', 'user_name', 'usr_name'].find(name => fields.includes(name));
        if (!user) continue;
        const row = db.prepare('SELECT * FROM ' + C.quote(table) + ' WHERE ' + C.quote(user) + '=? LIMIT 1').get(id);
        for (const value of Object.values(row || {})) if (value instanceof Uint8Array && Codec.imageType(Buffer.from(value))) return Buffer.from(value);
      }
    } finally { db.close(); }
  }
  return null;
}
async function resolve(profile, config, value) {
  const manifest = C.json(path.join(profile, 'current.json'));
  if (!manifest.index || !C.inside(path.join(profile, 'generations'), manifest.index)) throw new Error('IMPORT_FIRST');
  const index = C.open(manifest.index); let bytes, file, firstFrameOnly = false;
  try {
    if (value.kind === 'avatar') {
      if (!index.prepare('SELECT id FROM contacts WHERE id=?').get(String(value.id))) throw new Error('MEDIA_NOT_FOUND');
      bytes = avatar(manifest.generation, String(value.id));
      if (!bytes && config.remoteMedia) {
        const contact = index.prepare('SELECT avatar FROM contacts WHERE id=?').get(String(value.id));
        if (contact.avatar) bytes = await download(contact.avatar);
      }
    } else if (value.kind === 'message') {
      const message = index.prepare('SELECT * FROM messages WHERE id=?').get(String(value.id)); if (!message) throw new Error('MESSAGE_NOT_FOUND');
      if (message.type === 34) bytes = voice(manifest.generation, message);
      if (!bytes) file = localMedia(index, sourceKeys(manifest.generation, message), config.source.mediaRoot);
    } else if (value.kind === 'resource') {
      file = localMedia(index, [String(value.id)], config.source.mediaRoot);
    } else if (value.kind === 'moment') {
      const post = index.prepare('SELECT media FROM moments WHERE id=?').get(String(value.id));
      const item = post && JSON.parse(post.media)[Number(value.item)]; if (!item) throw new Error('MEDIA_NOT_FOUND');
      file = item.md5 ? localMedia(index, [item.md5.toLowerCase()], config.source.mediaRoot) : null;
      if (!file && config.remoteMedia && item.url) {
        bytes = await download(item.url);
        if (!mediaType(bytes) && /^\d{1,20}$/.test(item.seed)) {
          const count = item.type === '6' || item.type === '15' ? Math.min(131072, bytes.length) : bytes.length;
          const stream = new Isaac(item.seed).bytes(count); for (let at = 0; at < count; at++) bytes[at] ^= stream[at];
        }
      }
    } else throw new Error('MEDIA_KIND_INVALID');
    if (file) {
      const fd = fs.openSync(file, 'r'), head = Buffer.alloc(64); try { fs.readSync(fd, head, 0, 64, 0); } finally { fs.closeSync(fd); }
      if (mediaType(head) === 'video/mp4') return { file, type: 'video/mp4', original: true, firstFrameOnly: false };
      if (fs.statSync(file).size > 64 * 1024 * 1024) throw new Error('MEDIA_TOO_LARGE');
      bytes = fs.readFileSync(file);
      if (!mediaType(bytes) && !require('../../vendor/silk-wasm').isSilk(bytes) && !Codec.isWxgf(bytes)) {
        const keys = Codec.candidateKeys(config.source.mediaRoot, config.source.selfId, config.source.appData);
        if (config.imageKey && /^[a-f0-9]{32}$/i.test(config.imageKey)) keys.unshift({ key: Buffer.from(config.imageKey, 'hex'), xor: Number(config.imageXor || 0) });
        try { bytes = Codec.decodeDat(bytes, keys); } finally { for (const item of keys) item.key.fill(0); }
      }
    }
    if (!bytes) throw new Error(config.remoteMedia ? 'MEDIA_NOT_CACHED' : 'MEDIA_LOCAL_ONLY');
    const silk = require('../../vendor/silk-wasm');
    if (silk.isSilk(bytes)) { const decoded = await silk.decode(bytes, 24000); bytes = wav(Buffer.from(decoded.data)); }
    if (Codec.isWxgf(bytes)) { const decoded = await Codec.unwrapWxgf(bytes, config.ffmpeg); bytes = decoded.data; firstFrameOnly = decoded.firstFrameOnly; }
    const type = mediaType(bytes); if (!type) throw new Error('MEDIA_FORMAT_UNSUPPORTED');
    const cache = path.join(profile, 'cache/media'); fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const output = path.join(cache, C.hash(bytes.toString('base64')) + '.image');
    if (!fs.existsSync(output)) fs.writeFileSync(output, bytes, { mode: 0o600 });
    return { file: output, type, firstFrameOnly };
  } finally { index.close(); }
}
module.exports = { resolve, packedKeys, approvedHost, voice, mediaType, wav };
