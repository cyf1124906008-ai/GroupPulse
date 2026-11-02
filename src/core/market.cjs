'use strict';
// Independent intent and candidate-matching implementation, specified by the
// GroupPulse product requirements. No supplied organizer implementation is used.
const { hash, norm } = require('./common.cjs');
const productNames = [
  ['awsb', /\baws[\s._-]*bedrock\b|\bawsb\b/iu], ['claude', /\bclaude\b/iu], ['ccmax', /\bcc[\s._-]*max\b/iu],
  ['codex', /\bcodex\b/iu], ['gemini', /\bgemini\b/iu], ['gpt', /\b(?:chatgpt|gpt[-\s]?\d*)\b/iu],
  ['gpu', /\bgpu\b|显卡|算力/iu], ['google', /\bgoogle\b|谷歌/iu]
];
const generic = new Set('出售 求购 采购 供货 现货 转售 转让 买入 卖出 出售中 测试 希望 需要 联系 可以 支持 价格 报价 原文 演示 用量 预算 商品 开发 收购 api http https www com per usd cny the and for with from'.split(' '));
const words = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function intent(input) {
  const body = norm(input), signals = [];
  const patterns = [
    ['offer', /出售|转售|供货|(?:^|[\s，,。;；：:])(?:出|卖)(?=[\sA-Za-z\u4e00-\u9fff])|现货可出|对外提供/gu],
    ['request', /求购|收购|采购|(?:^|[\s，,。;；：:])(?:收|买)(?=[\sA-Za-z\u4e00-\u9fff])|想买|想收|急收/gu]
  ];
  for (const [kind, expression] of patterns) for (const match of body.matchAll(expression)) {
    const text = match[0].trim(), after = body.slice(match.index + match[0].length);
    if (/^(?:到|款|费|藏|起|尾|入|据)/u.test(after) && /收$/.test(text)) continue;
    if (/^(?:门|发|现|来|去|差|错)/u.test(after) && /出$/.test(text)) continue;
    if (/(?:不|没|未|禁止|停止)\s*$/.test(body.slice(Math.max(0, match.index - 4), match.index))) continue;
    signals.push({ kind, text });
  }
  const kinds = new Set(signals.map(signal => signal.kind));
  return { kind: kinds.size > 1 ? 'review' : [...kinds][0] || '', signals };
}
function products(body, custom = []) {
  const text = norm(body).replace(/https?:\/\/\S+|www\.\S+/g, ' '), result = new Set();
  for (const [product, expression] of productNames) if (expression.test(text)) result.add(product);
  for (const phrase of custom) if (String(phrase).trim().length >= 2 && text.includes(norm(phrase).trim())) result.add(norm(phrase).trim());
  for (const item of words.segment(text)) {
    if (!item.isWordLike) continue;
    const token = item.segment;
    if (token.length >= 2 && token.length <= 24 && /[\p{L}]/u.test(token) && !generic.has(token) && !/^wxid_/.test(token)) result.add(token);
  }
  // Synonym spellings do not create additional evidence of a match.
  if (result.has('awsb')) for (const word of ['aws', 'bedrock']) result.delete(word);
  if (result.has('google')) result.delete('谷歌');
  return result;
}
const filterTerms = text => [...new Set(norm(text).split(/[\s,，、;；]+/u).filter(Boolean))];
const identityText = message => norm([message.body, message.senderId, message.senderName, message.alias, message.nickname, message.remark].join('\n')).replace(/[\s_-]+/g, '');
function contains(message, terms, all) { const text = identityText(message); return !terms.length || (all ? terms.every(term => text.includes(term.replace(/[\s_-]+/g, ''))) : terms.some(term => text.includes(term.replace(/[\s_-]+/g, '')))); }
function collect(messages, options = {}) {
  const merged = new Map(); let checked = 0, latest = 0, unclassified = 0;
  const groups = new Set(), authors = new Set();
  for (const message of messages) {
    checked++; groups.add(message.threadId); latest = Math.max(latest, message.timestamp);
    const found = intent(message.body); if (!found.kind) { unclassified++; continue; }
    const author = message.senderId.startsWith('unknown:') ? message.id : message.senderId;
    const key = hash(author + '\0' + norm(message.body).replace(/\s+/g, ' ').trim());
    const source = { id: message.id, threadId: message.threadId, threadName: message.threadName, timestamp: message.timestamp, localId: message.localId, shard: message.shard };
    let listing = merged.get(key);
    if (!listing) {
      listing = { ...message, listingId: key.slice(0, 24), intent: found.kind, signals: found.signals, sources: [] };
      merged.set(key, listing);
    }
    listing.sources.push(source);
    if (message.timestamp > listing.timestamp) Object.assign(listing, message);
    if(!message.senderId.startsWith('unknown:')) authors.add(author);
  }
  const listings = [...merged.values()].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  const include = filterTerms(options.query), exclude = filterTerms(options.exclude);
  const blocked = item => exclude.length && contains(item, exclude, false);
  const accepted = item => contains(item, include, true) && !blocked(item);
  const totals = { all: listings.length, offer: 0, request: 0, review: 0 };
  const inverted = new Map(), tags = new Map();
  for (const item of listings) {
    totals[item.intent]++; const values = products(item.body, options.tracked || []); tags.set(item.listingId, values);
    if (item.intent === 'request') for (const value of values) { if (!inverted.has(value)) inverted.set(value, []); inverted.get(value).push(item); }
  }
  const pairs = [], seen = new Set(); let pairCount = 0;
  const maximum = options.allPairs ? Infinity : 2000;
  const compare = (a,b) => b.score-a.score || Math.max(b.offer.timestamp,b.request.timestamp)-Math.max(a.offer.timestamp,a.request.timestamp);
  for (const offer of listings.filter(item => item.intent === 'offer')) {
    const candidates = new Map();
    for (const token of tags.get(offer.listingId)) for (const request of inverted.get(token) || []) {
      if (offer.senderId === request.senderId && !offer.senderId.startsWith('unknown:')) continue;
      if (!candidates.has(request.listingId)) candidates.set(request.listingId, { request, shared: [] });
      candidates.get(request.listingId).shared.push(token);
    }
    for (const { request, shared } of candidates.values()) {
      const offerProducts = productNames.filter(([name])=>tags.get(offer.listingId).has(name)).map(([name])=>name);
      const requestProducts = productNames.filter(([name])=>tags.get(request.listingId).has(name)).map(([name])=>name);
      if(offerProducts.length&&requestProducts.length&&!offerProducts.some(name=>requestProducts.includes(name)))continue;
      const key = offer.listingId + '/' + request.listingId; if (seen.has(key)) continue; seen.add(key);
      if (blocked(offer) || blocked(request) || !(accepted(offer) || accepted(request))) continue;
      const sharedProducts = shared.filter(token => productNames.some(([id]) => id === token) || (options.tracked || []).map(norm).includes(token));
      const score = sharedProducts.length * 4 + shared.length;
      pairs.push({ id: key, offer, request, shared: [...sharedProducts, ...shared.filter(token => !sharedProducts.includes(token))].slice(0, 5), score });
      pairCount++;if(pairs.length>maximum*2){pairs.sort(compare);pairs.length=maximum;}
    }
  }
  pairs.sort(compare);if(pairs.length>maximum)pairs.length=maximum;
  const visible = listings.filter(item => accepted(item) && (!options.kind || options.kind === 'all' || item.intent === options.kind));
  return { listings: visible, pairs, pairCount, pairDisplayLimit:Number.isFinite(maximum)?maximum:null, totals, checked, latest, groups: groups.size, authors: authors.size, unclassified, filtered: visible.length };
}
module.exports = { intent, products, collect, filterTerms };
