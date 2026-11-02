'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PAGE = 4096, RESERVE = 80;

function walChecksum(bytes, little, initial = [0, 0]) {
  if (bytes.length % 8) throw new Error('WAL 校验块不完整');
  let [a, b] = initial;
  const read = little ? bytes.readUInt32LE.bind(bytes) : bytes.readUInt32BE.bind(bytes);
  for (let i = 0; i < bytes.length; i += 8) {
    a = (a + read(i) + b) >>> 0;
    b = (b + read(i + 4) + a) >>> 0;
  }
  return [a, b];
}

function mergeWal(main, wal) {
  if (!wal.length) return main;
  if (main.length < PAGE || main.length % PAGE || wal.length < 32) throw new Error('数据库或 WAL 不完整');
  const magic = wal.readUInt32BE(0);
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== PAGE)
    throw new Error('不支持的 WAL 格式');
  const little = magic === 0x377f0682;
  let state = walChecksum(wal.subarray(0, 24), little);
  const same = (s, at) => s[0] === wal.readUInt32BE(at) && s[1] === wal.readUInt32BE(at + 4);
  if (!same(state, 24)) throw new Error('WAL 文件头校验失败');
  const salt = wal.subarray(16, 24);
  const pending = new Map(), committed = new Map();
  let count = null, available = main.length / PAGE;
  for (let at = 32; at + PAGE + 24 <= wal.length; at += PAGE + 24) {
    const frame = wal.subarray(at, at + 24);
    if (!frame.subarray(8, 16).equals(salt)) break;
    const number = frame.readUInt32BE(0), size = frame.readUInt32BE(4);
    if (number < 1 || number > 0xfffffffe || size > 0xfffffffe) throw new Error('WAL 页码无效');
    const page = wal.subarray(at + 24, at + 24 + PAGE);
    state = walChecksum(Buffer.concat([frame.subarray(0, 8), page]), little, state);
    if (!same(state, at + 16)) throw new Error('WAL 页校验失败');
    pending.set(number, page);
    if (size) {
      for (const [n, p] of pending) committed.set(n, p);
      pending.clear();
      for (const n of committed.keys()) if (n > size) committed.delete(n);
      count = size;
      available = Math.min(available, size);
    }
  }
  if (count === null) return main;
  if (count > available + committed.size) throw new Error('WAL 提交缺失数据库页');
  const out = Buffer.alloc(count * PAGE);
  for (let number = 1; number <= count; number++) {
    let page = committed.get(number);
    if (!page) {
      if (number > available) throw new Error('WAL 提交缺失新增页');
      page = main.subarray((number - 1) * PAGE, number * PAGE);
    }
    page.copy(out, (number - 1) * PAGE);
  }
  return out;
}

function metadata(file) {
  try { const s = fs.statSync(file, { bigint: true }); return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function sourceFingerprint(file) { return [metadata(file), metadata(file + '-wal')].join('|'); }
function readSnapshot(file, details = false) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'grouppulse-snapshot-'));
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = sourceFingerprint(file), mainCopy = path.join(temporary, 'db'), walCopy = path.join(temporary, 'wal');
      // Capture both encrypted files using APFS copy-on-write before reading
      // their bytes. Active WAL writes then cannot change the private copies.
      fs.copyFileSync(file, mainCopy, fs.constants.COPYFILE_FICLONE); fs.chmodSync(mainCopy, 0o600);
      let hasWal = true;
      try { fs.copyFileSync(file + '-wal', walCopy, fs.constants.COPYFILE_FICLONE); fs.chmodSync(walCopy, 0o600); }
      catch (e) { if (e.code !== 'ENOENT') throw e; hasWal = false; }
      if (before !== sourceFingerprint(file)) continue;
      const data = mergeWal(fs.readFileSync(mainCopy), hasWal ? fs.readFileSync(walCopy) : Buffer.alloc(0));
      return details ? { data, fingerprint: before } : data;
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  throw new Error('微信正在密集写入数据库，请稍后重试同步');
}

function keys(raw, salt) {
  const enc = crypto.pbkdf2Sync(raw, salt, 256000, 32, 'sha512');
  const macSalt = Buffer.from(salt.map(n => n ^ 0x3a));
  const mac = crypto.pbkdf2Sync(enc, macSalt, 2, 32, 'sha512');
  return { enc, mac };
}
function verifyPage(page, number, mac) {
  const numberBytes = Buffer.alloc(4); numberBytes.writeUInt32LE(number);
  const digest = crypto.createHmac('sha512', mac)
    .update(page.subarray(number === 1 ? 16 : 0, PAGE - 64)).update(numberBytes).digest();
  return crypto.timingSafeEqual(digest, page.subarray(PAGE - 64));
}
function verifyKey(raw, file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const page = Buffer.alloc(PAGE);
    if (fs.readSync(fd, page, 0, PAGE, 0) !== PAGE) return false;
    const { enc, mac } = keys(raw, page.subarray(0, 16));
    const valid = verifyPage(page, 1, mac);
    enc.fill(0); mac.fill(0);
    return valid;
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function decryptBuffer(raw, data) {
  if (data.length < PAGE || data.length % PAGE) throw new Error('数据库长度无效');
  if (data.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) return Buffer.from(data);
  const { enc, mac } = keys(raw, data.subarray(0, 16));
  try {
    const out = Buffer.alloc(data.length);
    Buffer.from('SQLite format 3\0').copy(out);
    for (let at = 0, number = 1; at < data.length; at += PAGE, number++) {
      const page = data.subarray(at, at + PAGE);
      if (!verifyPage(page, number, mac)) throw new Error(`密钥不匹配或第 ${number} 页认证失败`);
      const start = number === 1 ? 16 : 0;
      const decipher = crypto.createDecipheriv('aes-256-cbc', enc, page.subarray(PAGE - RESERVE, PAGE - RESERVE + 16));
      decipher.setAutoPadding(false);
      const plain = Buffer.concat([decipher.update(page.subarray(start, PAGE - RESERVE)), decipher.final()]);
      plain.copy(out, at + start);
      page.subarray(PAGE - RESERVE).copy(out, at + PAGE - RESERVE);
    }
    return out;
  } finally { enc.fill(0); mac.fill(0); }
}
function listDatabases(root) {
  const found = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith('.db')) found.push(file);
    }
  }
  walk(root);
  return found.sort();
}

function decryptAccount(accountDir, raw, destination, progress = () => {}) {
  const source = path.join(accountDir, 'db_storage');
  const files = listDatabases(source);
  if (!files.length) throw new Error('账号目录里没有数据库');
  const primary = path.join(source, 'session/session.db');
  const fd = fs.openSync(primary, 'r'), header = Buffer.alloc(16);
  try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (!header.equals(Buffer.from('SQLite format 3\0')) && !verifyKey(raw, primary)) throw new Error('本机数据库密钥校验未通过');
  const stage = destination + '.staging-' + crypto.randomUUID();
  const backup = destination + '.previous';
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  const results = [];
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(path.join(destination, '.grouppulse-snapshot.json'), 'utf8')); } catch {}
  const fingerprints = {};
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index], rel = path.relative(source, file);
      progress({ current: index + 1, total: files.length, file: rel });
      if (fs.statSync(file).size === 0) { results.push({ file: rel, skipped: 'empty' }); continue; }
      const target = path.join(stage, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const oldFile = path.join(destination, rel), fingerprint = sourceFingerprint(file);
      const reusable = previous.accountDir === accountDir && previous.fingerprints?.[rel] === fingerprint && fs.existsSync(oldFile);
      if (reusable) {
        // APFS clone is copy-on-write: no file is shared for later mutation.
        fs.copyFileSync(oldFile, target, fs.constants.COPYFILE_FICLONE);
        fs.chmodSync(target, 0o600); fingerprints[rel] = fingerprint;
      } else {
        const snapshot = readSnapshot(file, true);
        const plain = decryptBuffer(raw, snapshot.data);
        try { fs.writeFileSync(target, plain, { mode: 0o600 }); }
        finally { plain.fill(0); }
        fingerprints[rel] = snapshot.fingerprint;
      }
      const db = new DatabaseSync(target, { readOnly: true });
      try { db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get(); }
      finally { db.close(); }
      results.push({ file: rel, bytes: fs.statSync(target).size, reused: reusable });
    }
    for (const [rel, table] of [['session/session.db', 'SessionTable'], ['contact/contact.db', 'contact']]) {
      const db = new DatabaseSync(path.join(stage, rel), { readOnly: true });
      try { db.prepare(`SELECT COUNT(*) FROM "${table}"`).get(); } finally { db.close(); }
    }
    if (!results.some(r => /^message\/message_\d+\.db$/.test(r.file) && r.bytes)) throw new Error('没有可读的消息分库');
    fs.writeFileSync(path.join(stage, '.grouppulse-snapshot.json'), JSON.stringify({ accountDir, fingerprints, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try { fs.renameSync(stage, destination); }
    catch (e) { if (fs.existsSync(backup)) fs.renameSync(backup, destination); throw e; }
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
    return results;
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}
module.exports = { PAGE, keys, walChecksum, mergeWal, readSnapshot, sourceFingerprint, listDatabases, verifyKey, decryptBuffer, decryptAccount };
