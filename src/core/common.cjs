'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
const norm = value => String(value ?? '').normalize('NFKC').toLowerCase();
const json = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function open(file, readOnly = true) {
  const db = new DatabaseSync(file, { readOnly, timeout: 10000, allowExtension: false });
  db.exec('PRAGMA trusted_schema=OFF;');
  db.function('gp_norm', { deterministic: true }, norm);
  if (readOnly) db.exec('PRAGMA query_only=ON;');
  return db;
}
function rows(db, sql, params = []) { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(...params); }
function columns(db, table) { return rows(db, 'PRAGMA table_info(' + quote(table) + ')').map(row => String(row.name)); }
function tables(db) { return rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(row => String(row.name)); }
const pick = (row, keys, fallback = '') => keys.map(key => row[key]).find(value => value !== undefined && value !== null) ?? fallback;
const string = value => value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value ?? '');
function inside(root, file) { const rel = path.relative(path.resolve(root), path.resolve(file)); return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function safeFile(root, file) { const real = fs.realpathSync(file); if (!inside(fs.realpathSync(root), real)) throw new Error('SOURCE_PATH_ESCAPE'); return real; }
function xmlText(value) {
  return string(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; });
}
function tag(xml, name) { const match = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(string(xml)); return match ? xmlText(match[1]) : ''; }
const plainXml = xml => xmlText(string(xml).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const csvCell = value => '"' + String(value ?? '').replace(/^[=+\-@\t\r]/, value => "'" + value).replace(/"/g, '""') + '"';
const csv = lines => '\ufeff' + lines.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
function bounds(options = {}) {
  let begin = options.begin === undefined ? 0 : Number(options.begin), end = options.until === undefined ? 0 : Number(options.until);
  if (options.start) begin = new Date(String(options.start) + 'T00:00:00').getTime() / 1000;
  if (options.end) { const date = new Date(String(options.end) + 'T00:00:00'); date.setDate(date.getDate() + 1); end = date.getTime() / 1000; }
  if (!Number.isFinite(begin) || !Number.isFinite(end) || begin < 0 || end < 0 || (end && begin > end)) throw new Error('INVALID_DATE_RANGE');
  return { begin, end };
}
module.exports = { hash, quote, norm, json, atomic, open, rows, tables, columns, pick, string, inside, safeFile, xmlText, tag, plainXml, csv, bounds };
