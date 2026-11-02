'use strict';
const C = require('./common.cjs');
const { PriceAccumulator } = require('./prices.cjs');
const Market = require('./market.cjs');
const JOIN = ' FROM messages m LEFT JOIN contacts c ON c.id=m.sender JOIN threads t ON t.id=m.thread ';
const FIELDS = 'm.*,coalesce(c.name,m.sender) AS sender_name,c.nickname,c.remark,c.alias,t.name AS thread_name,t.is_group';
const STOP = new Set('这个 那个 今天 昨天 明天 可以 需要 不是 没有 还是 但是 因为 所以 已经 我们 你们 他们 什么 怎么 为什么 多少 一些 一个 一起 一下 谢谢 收到 消息 图片 视频 语音 表情 演示 原文 提供 使用 and the for this that with from have your you are will'.split(' '));
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function mapped(row) {
  return { id: row.id, threadId: row.thread, threadName: row.thread_name, senderId: row.sender,
    senderName: row.sender_name, nickname: row.nickname || '', alias: row.alias || '', remark: row.remark || '',
    timestamp: row.time, sent: Boolean(row.sent), type: row.type, subtype: row.subtype, body: row.body, raw: row.raw,
    shard: row.shard, localId: row.local_id, serverId: row.server_id, mediaKey: row.media_key, isGroup: Boolean(row.is_group) };
}
function where(options = {}, groupsOnly = false) {
  const clauses = [], values = [], { begin, end } = C.bounds(options);
  if (begin) { clauses.push('m.time>=?'); values.push(begin); }
  if (end) { clauses.push('m.time<?'); values.push(end); }
  if (groupsOnly) clauses.push('t.is_group=1');
  const ids = options.thread ? [String(options.thread)] : Array.isArray(options.groupIds) ? [...new Set(options.groupIds.map(String))] : [];
  if (ids.length > 2000) throw new Error('TOO_MANY_GROUPS');
  if (Array.isArray(options.groupIds) && !options.thread && options.groupIds.length === 0) clauses.push('0=1');
  if (ids.length) { clauses.push('m.thread IN (' + ids.map(() => '?').join(',') + ')'); values.push(...ids); }
  const terms = Array.isArray(options.terms) ? options.terms : String(options.query || '').split(/[,，;；\n]+/u);
  const filtered = [...new Set(terms.map(C.norm).map(term => term.trim()).filter(Boolean))].slice(0, 100);
  if (filtered.length) {
    clauses.push('(' + filtered.map(() => 'instr(m.normalized,?)>0').join(options.match === 'all' ? ' AND ' : ' OR ') + ')'); values.push(...filtered);
  }
  if (options.sender) {
    clauses.push("(instr(gp_norm(m.sender),?)>0 OR instr(gp_norm(coalesce(c.name,'')),?)>0 OR instr(gp_norm(coalesce(c.alias,'')),?)>0 OR instr(gp_norm(coalesce(c.remark,'')),?)>0 OR instr(gp_norm(coalesce(c.nickname,'')),?)>0)");
    values.push(...Array(5).fill(C.norm(options.sender).trim()));
  }
  if (options.type) { clauses.push('m.type=?'); values.push(Number(options.type)); }
  return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', values };
}
class Store {
  constructor(file) { this.db = C.open(file); }
  close() { this.db.close(); }
  *all(options = {}, groupsOnly = false) {
    const filter = where(options, groupsOnly);
    for (const row of this.db.prepare('SELECT ' + FIELDS + JOIN + filter.sql + ' ORDER BY m.time DESC,m.id DESC').iterate(...filter.values)) yield mapped(row);
  }
  status() {
    const result = this.db.prepare('SELECT count(*) AS messages,count(DISTINCT thread) AS threads,min(time) AS oldest,max(time) AS latest FROM messages').get();
    result.contacts = this.db.prepare('SELECT count(*) AS n FROM contacts WHERE is_group=0').get().n;
    result.groups = this.db.prepare('SELECT count(*) AS n FROM threads WHERE is_group=1').get().n;
    result.moments = this.db.prepare('SELECT count(*) AS n FROM moments').get().n;
    result.media = this.db.prepare('SELECT count(*) AS n FROM media').get().n;
    return result;
  }
  threads(options = {}) {
    const clauses = [], params = [];
    if (options.groupsOnly) clauses.push('is_group=1');
    if (options.query) { clauses.push('(instr(gp_norm(name),?)>0 OR instr(gp_norm(id),?)>0)'); params.push(C.norm(options.query), C.norm(options.query)); }
    const list = this.db.prepare('SELECT * FROM threads' + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') + ' ORDER BY last_time DESC,id').all(...params);
    return { items: list, total: list.length };
  }
  messages(options = {}) {
    const filter = where(options, Boolean(options.groupsOnly)), offset = Math.min(1000000, Math.max(0, Number(options.offset) || 0)), limit = 80;
    const count = this.db.prepare('SELECT count(*) AS n' + JOIN + filter.sql).get(...filter.values).n;
    let rows;
    if (options.reference) {
      const target = this.message(String(options.reference));
      if (!target || options.thread && target.threadId !== options.thread) throw new Error('MESSAGE_NOT_FOUND');
      const before = this.db.prepare('SELECT ' + FIELDS + JOIN + ' WHERE m.thread=? AND (m.time<? OR (m.time=? AND m.id<=?)) ORDER BY m.time DESC,m.id DESC LIMIT 20').all(target.threadId, target.timestamp, target.timestamp, target.id).reverse();
      const after = this.db.prepare('SELECT ' + FIELDS + JOIN + ' WHERE m.thread=? AND (m.time>? OR (m.time=? AND m.id>?)) ORDER BY m.time,m.id LIMIT 20').all(target.threadId, target.timestamp, target.timestamp, target.id);
      rows = [...before, ...after];
    } else rows = this.db.prepare('SELECT ' + FIELDS + JOIN + filter.sql + ' ORDER BY m.time DESC,m.id DESC LIMIT ? OFFSET ?').all(...filter.values, limit, offset);
    return { items: rows.map(mapped), total: count, offset, hasMore: !options.reference && offset + rows.length < count };
  }
  message(id) { const row = this.db.prepare('SELECT ' + FIELDS + JOIN + ' WHERE m.id=?').get(id); return row ? mapped(row) : null; }
  contacts(options = {}) {
    const values = [], clauses = ['is_group=0'];
    if (options.query) { clauses.push("(instr(gp_norm(id || ' ' || name || ' ' || nickname || ' ' || remark || ' ' || alias),?)>0)"); values.push(C.norm(options.query)); }
    const offset = Math.max(0, Number(options.offset) || 0), total = this.db.prepare('SELECT count(*) AS n FROM contacts WHERE ' + clauses.join(' AND ')).get(...values).n;
    return { items: this.db.prepare('SELECT * FROM contacts WHERE ' + clauses.join(' AND ') + ' ORDER BY name,id LIMIT 100 OFFSET ?').all(...values, offset), total, offset, hasMore: offset + 100 < total };
  }
  moments(options = {}) {
    const values = [], clauses = [], { begin, end } = C.bounds(options);
    if (begin) { clauses.push('s.time>=?'); values.push(begin); } if (end) { clauses.push('s.time<?'); values.push(end); }
    if (options.query) { clauses.push("instr(gp_norm(s.body || ' ' || s.author || ' ' || coalesce(c.name,'') || ' ' || coalesce(c.alias,'') || ' ' || coalesce(c.nickname,'') || ' ' || coalesce(c.remark,'')),?)>0"); values.push(C.norm(options.query)); }
    if (options.author) { clauses.push('s.author=?'); values.push(String(options.author)); }
    const sql = ' FROM moments s LEFT JOIN contacts c ON c.id=s.author' + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '');
    const total = this.db.prepare('SELECT count(*) AS n' + sql).get(...values).n, offset = Math.max(0, Number(options.offset) || 0);
    const items = this.db.prepare('SELECT s.*,coalesce(c.name,s.author) AS author_name' + sql + ' ORDER BY s.time DESC,s.id DESC LIMIT 40 OFFSET ?').all(...values, offset).map(row => ({ ...row, media: JSON.parse(row.media) }));
    return { items, total, offset, hasMore: offset + items.length < total };
  }
  resources(options = {}) {
    const term = C.norm(options.query || ''), offset = Math.max(0, Number(options.offset) || 0);
    const total = this.db.prepare('SELECT count(*) AS n FROM media WHERE instr(gp_norm(path),?)>0').get(term).n;
    return { items: this.db.prepare('SELECT * FROM media WHERE instr(gp_norm(path),?)>0 ORDER BY path LIMIT 100 OFFSET ?').all(term, offset), total, offset, hasMore: offset + 100 < total };
  }
  statistics(options = {}) {
    const filter = where(options, options.groupsOnly !== false), summary = this.db.prepare("SELECT count(*) AS messages,count(DISTINCT m.thread) AS groups,count(DISTINCT CASE WHEN m.sender NOT LIKE 'unknown:%' THEN m.sender END) AS senders,sum(m.sender LIKE 'unknown:%') AS unidentifiedMessages,sum(m.type=1) AS text,min(m.time) AS oldest,max(m.time) AS latest" + JOIN + filter.sql).get(...filter.values);
    const groups = this.db.prepare('SELECT m.thread AS id,t.name,count(*) AS count,max(m.time) AS latest' + JOIN + filter.sql + ' GROUP BY m.thread ORDER BY count DESC').all(...filter.values);
    const days = this.db.prepare("SELECT strftime('%Y-%m-%d',m.time,'unixepoch','localtime') AS day,count(*) AS count" + JOIN + filter.sql + ' GROUP BY day ORDER BY day').all(...filter.values);
    const hours = this.db.prepare("SELECT cast(strftime('%H',m.time,'unixepoch','localtime') AS INTEGER) AS hour,count(*) AS count" + JOIN + filter.sql + ' GROUP BY hour ORDER BY hour').all(...filter.values);
    const types = this.db.prepare('SELECT m.type,count(*) AS count' + JOIN + filter.sql + ' GROUP BY m.type ORDER BY count DESC').all(...filter.values);
    const frequencies = new Map(), tracked = (options.tracked || []).map(term => ({ term: String(term), messages: 0, occurrences: 0, groups: new Set(), senders: new Set() }));
    for (const item of this.all(options, options.groupsOnly !== false)) {
      const text = C.norm(item.body);
      for (const phrase of tracked) {
        const term = C.norm(phrase.term); if (!term) continue;
        let at = 0, count = 0; while ((at = text.indexOf(term, at)) >= 0) { count++; at += Math.max(1, term.length); }
        if (count) { phrase.messages++; phrase.occurrences += count; phrase.groups.add(item.threadId); phrase.senders.add(item.senderId); }
      }
      const unique = new Set();
      const clean = text.replace(/https?:\/\/\S+|\bwww\.\S+/g, ' ');
      for (const word of segmenter.segment(clean)) if (word.isWordLike && word.segment.length >= 2 && word.segment.length <= 30 && /[\p{L}]/u.test(word.segment) && !STOP.has(word.segment) && !(options.ignore || []).map(C.norm).includes(word.segment)) unique.add(word.segment);
      for (const term of unique) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    }
    const keywords = [...frequencies].map(([term, messages]) => ({ term, messages })).sort((a, b) => b.messages - a.messages || a.term.localeCompare(b.term)).slice(0, 60);
    return { summary, groups, days, hours, types, keywords, tracked: tracked.map(item => ({ ...item, groups: item.groups.size, senders: item.senders.size })) };
  }
  dashboard(options = {}) { return this.statistics({ ...options, begin: Math.floor(Date.now() / 1000) - 86400, groupsOnly: true }); }
  market(options = {}) {
    const hours = [1, 3, 6, 24].includes(Number(options.hours)) ? Number(options.hours) : 1;
    return { ...Market.collect(this.all({ ...options, query: '', sender: '', begin: options.begin ?? Math.floor(Date.now() / 1000) - hours * 3600 }, true), options), hours };
  }
  prices(options = {}) {
    const accumulator = new PriceAccumulator({ ...options, term: options.query || '', sender: options.sender || '' });
    for (const item of this.all({ ...options, query: '' }, true)) accumulator.add(item.body, { ref: item.id, senderId: item.senderId, sender: item.senderName, alias: item.alias,
      nickname: item.nickname, remark: item.remark, groupId: item.threadId, group: item.threadName, timestamp: item.timestamp, text: item.body, message: item });
    return accumulator.result();
  }
  evidence(options = {}) {
    const limit = Math.min(60, Math.max(1, Number(options.samples) || 30)), samples = [], groups = new Set(); let eligible = 0;
    for (const item of this.all(options, options.groupsOnly !== false)) {
      if (!item.body.trim()) continue; eligible++;
      if (samples.length < limit) { samples.push({ number: 'E' + String(samples.length + 1).padStart(3, '0'), id: item.id, group: item.threadName, sender: item.senderName, timestamp: item.timestamp, text: item.body.slice(0, 1000) }); groups.add(item.threadId); }
    }
    return { samples, eligible, groups: groups.size, characters: samples.reduce((n, item) => n + item.text.length, 0), method: 'latest-matching-excerpts' };
  }
  exportRows(options = {}) {
    return [['群聊 / Conversation', '发送者 / Sender', 'WXID', '微信号 / Alias', '时间 / Time', '类型 / Type', '原文 / Original', '本地消息 ID / Local ID', '消息分库 / Shard'],
      ...[...this.all(options, options.groupsOnly !== false)].map(item => [item.threadName, item.senderName, item.senderId, item.alias, new Date(item.timestamp * 1000).toISOString(), item.type, item.body || item.raw, item.localId, item.shard])];
  }
}
module.exports = { Store, where, mapped };
