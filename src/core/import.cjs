'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { backup } = require('node:sqlite');
const C = require('./common.cjs');
const Snapshot = require('./snapshot.cjs');
const HEADER = Buffer.from('SQLite format 3\0');
function inspect(selected) {
  const root = fs.realpathSync(selected);
  const candidates = [root, path.join(root, 'db_storage'), path.join(root, 'decrypted')];
  const databaseRoot = candidates.find(folder => fs.existsSync(path.join(folder, 'session/session.db')) && fs.existsSync(path.join(folder, 'contact/contact.db')));
  if (!databaseRoot) throw new Error('SOURCE_NOT_SUPPORTED');
  const file = path.join(databaseRoot, 'session/session.db'), fd = fs.openSync(file, 'r'), head = Buffer.alloc(16);
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  return { databaseRoot, mediaRoot: path.basename(databaseRoot) === 'db_storage' || path.basename(databaseRoot) === 'decrypted' ? path.dirname(databaseRoot) : root,
    encrypted: !head.equals(HEADER), folderName: path.basename(root) };
}
function decode(value) {
  if (!(value instanceof Uint8Array)) return String(value ?? '');
  const buffer = Buffer.from(value);
  if (!buffer.length) return '';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    try { return zlib.zstdDecompressSync(buffer, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'); } catch { return ''; }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return ''; }
}
function messageBody(row, sender) {
  let content = decode(C.pick(row, ['message_content', 'content', 'StrContent']));
  if (!content) content = decode(C.pick(row, ['compress_content', 'CompressContent', 'compressed_content']));
  const prefix = /^([A-Za-z0-9_@.\-]{3,128}):\n/.exec(content);
  if (prefix && (!sender || prefix[1] === sender)) content = content.slice(prefix[0].length);
  const type = Number(BigInt(C.pick(row, ['local_type', 'Type', 'type'], 1)) & 0xffffffffn);
  if (type === 1) return { raw: content, text: content, type };
  if (type === 49) {
    const kind = C.tag(content, 'type');
    // A quoted speaker's text is not attributed to the current sender.
    const app = content.replace(/<refermsg\b[^>]*>[\s\S]*?<\/refermsg>/gi, '');
    const text = [C.tag(app, 'title'), C.tag(app, 'des')].filter(Boolean).join('\n');
    return { raw: content, text: text || C.plainXml(app).slice(0, 4000), type, subtype: kind };
  }
  return { raw: content, text: type === 10000 || type === 10002 ? C.plainXml(content) : '', type };
}
const SCHEMA = `
 PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
 CREATE TABLE contacts(id TEXT PRIMARY KEY,name TEXT,nickname TEXT,remark TEXT,alias TEXT,avatar TEXT,is_group INTEGER);
 CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,is_group INTEGER,summary TEXT,unread INTEGER,last_time INTEGER DEFAULT 0,total INTEGER DEFAULT 0);
 CREATE TABLE messages(id TEXT PRIMARY KEY,thread TEXT,sender TEXT,sent INTEGER,time INTEGER,type INTEGER,subtype TEXT,body TEXT,raw TEXT,normalized TEXT,shard TEXT,source_table TEXT,local_id TEXT,server_id TEXT,media_key TEXT);
 CREATE INDEX message_time ON messages(time DESC,id); CREATE INDEX message_thread ON messages(thread,time DESC,id); CREATE INDEX message_sender ON messages(sender,time DESC);
 CREATE TABLE moments(id TEXT PRIMARY KEY,author TEXT,time INTEGER,body TEXT,raw TEXT,media TEXT);
 CREATE INDEX moment_time ON moments(time DESC,id);
 CREATE TABLE media(key TEXT,path TEXT,size INTEGER,extension TEXT,PRIMARY KEY(key,path));
 CREATE INDEX media_key ON media(key);
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
`;
async function copyDatabases(config, stage, rawKey, progress) {
  const files = Snapshot.listDatabases(config.databaseRoot);
  let count = 0; const captured = [];
  for (const source of files) {
    C.safeFile(config.databaseRoot, source);
    const relative = path.relative(config.databaseRoot, source), target = path.join(stage, 'source', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const capturedFingerprint = Snapshot.sourceFingerprint(source); captured.push([relative, capturedFingerprint]);
    if (fs.statSync(source).size === 0) continue;
    progress({ phase: 'copy', current: ++count, total: files.length });
    const fd = fs.openSync(source, 'r'), head = Buffer.alloc(16);
    try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (head.equals(HEADER)) {
      const db = C.open(source);
      try { await backup(db, target); } finally { db.close(); }
    } else {
      if (!rawKey || rawKey.length !== 32) throw new Error('DATABASE_KEY_REQUIRED');
      const clear = Snapshot.decryptBuffer(rawKey, Snapshot.readSnapshot(source));
      try { fs.writeFileSync(target, clear, { mode: 0o600 }); } finally { clear.fill(0); }
    }
    fs.chmodSync(target, 0o600);
    const check = C.open(target); try { check.prepare('SELECT count(*) FROM sqlite_master').get(); } finally { check.close(); }
  }
  return captured;
}
function ingest(source, db, config, progress) {
  let warnings = [], messageCount = 0, momentCount = 0;
  const insertContact = db.prepare('INSERT OR REPLACE INTO contacts VALUES(?,?,?,?,?,?,?)');
  const insertThread = db.prepare('INSERT OR REPLACE INTO threads(id,name,is_group,summary,unread,last_time) VALUES(?,?,?,?,?,?)');
  const contactsFile = path.join(source, 'contact/contact.db'), sessionFile = path.join(source, 'session/session.db');
  const contactDb = C.open(contactsFile);
  const known = new Map();
  try {
    const table = C.tables(contactDb).find(name => name.toLowerCase() === 'contact');
    if (!table) throw new Error('CONTACT_SCHEMA_UNSUPPORTED');
    for (const row of C.rows(contactDb, 'SELECT * FROM ' + C.quote(table))) {
      const id = C.string(C.pick(row, ['username', 'user_name', 'UserName'])); if (!id) continue;
      const remark = C.string(C.pick(row, ['remark', 'Remark'])), nickname = C.string(C.pick(row, ['nick_name', 'nickname', 'NickName'])), alias = C.string(C.pick(row, ['alias', 'Alias']));
      const name = remark || nickname || alias || id, group = Number(id.endsWith('@chatroom'));
      known.set(crypto.createHash('md5').update(id).digest('hex'), id);
      insertContact.run(id, name, nickname, remark, alias, C.string(C.pick(row, ['small_head_url', 'big_head_url'])), group);
    }
  } finally { contactDb.close(); }
  const sessionsDb = C.open(sessionFile);
  try {
    const name = C.tables(sessionsDb).find(name => name.toLowerCase() === 'sessiontable');
    if (!name) throw new Error('SESSION_SCHEMA_UNSUPPORTED');
    for (const row of C.rows(sessionsDb, 'SELECT * FROM ' + C.quote(name))) {
      const id = C.string(C.pick(row, ['username', 'user_name'])); if (!id) continue;
      known.set(crypto.createHash('md5').update(id).digest('hex'), id);
      const contact = db.prepare('SELECT name FROM contacts WHERE id=?').get(id);
      insertThread.run(id, contact?.name || id, Number(id.endsWith('@chatroom')), decode(row.summary), Number(row.unread_count || 0), Number(row.last_timestamp || row.sort_timestamp || 0));
    }
  } finally { sessionsDb.close(); }
  const insert = db.prepare('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const messageFiles = Snapshot.listDatabases(source).filter(file => /(?:^|[/\\])message_\d+\.db$/i.test(file));
  if (!messageFiles.length) throw new Error('MESSAGE_DATABASES_MISSING');
  for (const [shardNumber, file] of messageFiles.entries()) {
    const input = C.open(file), shard = path.relative(source, file).split(path.sep).join('/');
    try {
      const names = new Map();
      const mapping = C.tables(input).find(name => name.toLowerCase() === 'name2id');
      if (mapping) for (const row of C.rows(input, 'SELECT rowid AS gp_rowid,* FROM ' + C.quote(mapping))) {
        const id = C.string(C.pick(row, ['user_name', 'username']));
        names.set(String(row.gp_rowid), id); known.set(crypto.createHash('md5').update(id).digest('hex'), id);
      }
      for (const table of C.tables(input).filter(table => /^Msg_[0-9a-f]{32}$/i.test(table))) {
        const thread = known.get(table.slice(4).toLowerCase()) || 'unmapped:' + table.slice(4);
        if (!db.prepare('SELECT id FROM threads WHERE id=?').get(thread)) {
          const contact = db.prepare('SELECT name FROM contacts WHERE id=?').get(thread);
          insertThread.run(thread, contact?.name || thread, Number(thread.endsWith('@chatroom')), '', 0, 0);
        }
        const statement = input.prepare('SELECT rowid AS gp_rowid,* FROM ' + C.quote(table)); statement.setReadBigInts(true);
        for (const row of statement.iterate()) {
          const sender = names.get(String(row.real_sender_id)) || C.string(C.pick(row, ['sender_username', 'sender']));
          const body = messageBody(row, sender);
          const local = C.string(row.local_id ?? row.gp_rowid), server = C.string(row.server_id), time = Number(row.create_time || 0);
          const ref = C.hash([shard, table, local, server].join('\0')).slice(0, 32);
          const key = /\bmd5=["']([0-9a-f]{32})["']/i.exec(body.raw)?.[1] || C.tag(body.raw, 'md5') || (decode(row.packed_info_data).match(/[0-9a-f]{32}/i) || [''])[0];
          insert.run(ref, thread, sender || 'unknown:' + ref, Number(Boolean(config.selfId && sender === config.selfId)), time, body.type, body.subtype || '', body.text, body.raw,
            C.norm(body.text), shard, table, local, server, key.toLowerCase());
          messageCount++; if (messageCount % 5000 === 0) progress({ phase: 'index', current: messageCount, shard: shardNumber + 1, total: messageFiles.length });
        }
      }
    } catch (error) { throw new Error('MESSAGE_SCHEMA_ERROR: ' + error.message); }
    finally { input.close(); }
  }
  db.exec('UPDATE threads SET total=(SELECT count(*) FROM messages WHERE thread=threads.id),last_time=coalesce((SELECT max(time) FROM messages WHERE thread=threads.id),last_time);');
  const snsFiles = Snapshot.listDatabases(source).filter(file => /(?:sns|sns_timeline)\.db$/i.test(file));
  const insertMoment = db.prepare('INSERT OR REPLACE INTO moments VALUES(?,?,?,?,?,?)');
  for (const file of snsFiles) {
    const input = C.open(file);
    try {
      for (const table of C.tables(input).filter(name => /snstimeline/i.test(name))) for (const row of C.rows(input, 'SELECT * FROM ' + C.quote(table))) {
        const raw = decode(C.pick(row, ['content', 'content_xml', 'xml']));
        if (!raw) { warnings.push('MOMENT_CONTENT_UNREADABLE'); continue; }
        const id = C.string(C.pick(row, ['tid', 'sns_id', 'id'])) || C.tag(raw, 'id') || C.hash(raw).slice(0, 24);
        const author = C.string(C.pick(row, ['user_name', 'username'])) || C.tag(raw, 'username');
        const media = [];
        for (const match of raw.matchAll(/<media(?:\s[^>]*)?>([\s\S]*?)<\/media>/gi)) {
          const xml = match[1], full = /<url\b([^>]*)>([\s\S]*?)<\/url>/i.exec(xml), thumb = /<thumb\b([^>]*)>([\s\S]*?)<\/thumb>/i.exec(xml);
          const attrs = Object.fromEntries([...(full?.[1] || thumb?.[1] || '').matchAll(/([\w_]+)=["']([^"']*)["']/g)].map(match => [match[1], C.xmlText(match[2])]));
          const seed = attrs.key || attrs.enc_key || C.tag(xml, 'key') || '';
          let url = C.xmlText(full?.[2] || thumb?.[2] || '');
          try { const parsed = new URL(url); parsed.protocol = 'https:'; if (attrs.token) { parsed.searchParams.set('token', attrs.token); parsed.searchParams.set('idx', attrs.enc_idx || '1'); } url = parsed.href; } catch {}
          media.push({ url, thumbnail: C.xmlText(thumb?.[2] || ''), md5: attrs.md5 || C.tag(xml, 'md5'), seed, type: C.tag(xml, 'type') });
        }
        insertMoment.run(id, author, Number(C.tag(raw, 'createTime') || row.create_time || 0), C.tag(raw, 'contentDesc'), raw, JSON.stringify(media)); momentCount++;
      }
    } finally { input.close(); }
  }
  return { messages: messageCount, moments: momentCount, warnings: [...new Set(warnings)] };
}
function mediaIndex(db, mediaRoot, progress) {
  if (!mediaRoot || !fs.existsSync(mediaRoot)) return 0;
  const insert = db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?)'); let count = 0;
  const roots = ['msg/attach', 'msg/video', 'msg/file', 'FileStorage', 'head_image', 'headimage', 'avatar', 'resource', 'res'];
  function walk(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(folder, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) {
        const md5 = /([a-f0-9]{32})/i.exec(item.name)?.[1] || '';
        if (md5 || /\.(?:dat|jpg|jpeg|png|gif|webp|mp4|silk|heic)$/i.test(item.name)) {
          insert.run(md5.toLowerCase() || C.hash(file), path.relative(mediaRoot, file), fs.statSync(file).size, path.extname(file).slice(1).toLowerCase());
          count++; if (count % 2000 === 0) progress({ phase: 'media', current: count });
        }
      }
    }
  }
  for (const relative of roots) { const folder = path.join(mediaRoot, relative); if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) walk(folder); }
  return count;
}
function signature(config) {
  return sourceSignature(config, Snapshot.listDatabases(config.databaseRoot).map(file => [path.relative(config.databaseRoot, file), Snapshot.sourceFingerprint(file)]));
}
function sourceSignature(config, fingerprints) { return C.hash(JSON.stringify({ files: fingerprints, selfId: config.selfId || '', mediaRoot: config.mediaRoot || '' })); }
async function synchronize(profile, config, rawKey, progress = () => {}) {
  const folder = path.join(profile, 'generations'); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const manifest = C.json(path.join(profile, 'current.json')), fingerprint = signature(config);
  if (!config.force && manifest.source === config.databaseRoot && manifest.fingerprint === fingerprint && fs.existsSync(manifest.index || '')) return { ...manifest, changed: false };
  const stage = path.join(folder, crypto.randomUUID()); fs.mkdirSync(stage, { mode: 0o700 });
  try {
    const fingerprints = await copyDatabases(config, stage, rawKey, progress);
    const index = path.join(stage, 'index.db'), db = C.open(index, false); let stats;
    try {
      db.exec(SCHEMA); db.exec('BEGIN');
      stats = ingest(path.join(stage, 'source'), db, config, progress);
      stats.media = mediaIndex(db, config.mediaRoot, progress);
      db.prepare('INSERT INTO metadata VALUES(?,?)').run('source', config.databaseRoot);
      db.exec('COMMIT; PRAGMA optimize;');
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('INDEX_INTEGRITY_ERROR');
    } finally { db.close(); }
    fs.chmodSync(index, 0o600);
    const result = { index, generation: stage, source: config.databaseRoot, fingerprint: sourceSignature(config, fingerprints), updatedAt: new Date().toISOString(), stats, changed: true };
    C.atomic(path.join(profile, 'current.json'), result);
    const keep = new Set([stage, manifest.generation]);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory() && !keep.has(path.join(folder, entry.name))) { try { fs.rmSync(path.join(folder, entry.name), { recursive: true, force: true }); } catch { /* A media reader may still hold this old generation on Windows. Retry next sync. */ } }
    return result;
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}
module.exports = { inspect, decode, messageBody, synchronize, signature, SCHEMA };
