'use strict';
const { createHash } = require('node:crypto');
const SearchPreview = require('./search-preview.js');
const numeric = String.raw`\d+(?:\.\d+)?`;
const money = String.raw`(?:元|块(?:钱)?|人民币|[¥￥]|rmb|cny)`;
const dollar = String.raw`(?:刀|美元|美金|usd)`;
const span = String.raw`(?<![\d.])(${numeric})(?:[ \t]{0,3}[-~～至到][ \t]{0,3}(${numeric}))?`;
const TYPES = { discount: '折扣', perUSD: '每美元价格', multiplier: '明确倍率', tier: 'X 标记 / 套餐档位', amount: '报价金额' };
function contextAt(text, index, length) {
  const left = Math.max(text.lastIndexOf('\n', index), text.lastIndexOf('；', index), text.lastIndexOf(';', index));
  const ends = [text.indexOf('\n', index + length), text.indexOf('；', index + length), text.indexOf(';', index + length)].filter(n => n >= 0);
  const right = ends.length ? Math.min(...ends) : text.length;
  return text.slice(Math.max(left + 1, index - 100), Math.min(right, index + length + 100)).trim();
}
function productAt(text, index, length) {
  const context = contextAt(text, index, length);
  const known = [...context.matchAll(/\b(?:aws[\s._-]*bedrock|awsb|gpu|claude(?:\s*code)?|chatgpt|gpt(?:[- .]?[0-9]+(?:\.[0-9]+)?)?|codex|gemini(?:\s*pro)?|deepseek|openrouter|ccmax|cc\s*max|cc(?:20x|5x)|copilot|cursor)\b/gi)];
  if (!known.length) return { product: '未注明商品', context, productKnown: false };
  // Only associate an explicitly nearby name. Retain the entire line to make
  // multi-product advertisements reviewable rather than claiming equivalence.
  const offset = context.indexOf(text.slice(index, index + length));
  const ordered = [...known].sort((a, b) => a.index - b.index);
  const nearest = [...known].sort((a, b) => Math.abs(a.index - offset) - Math.abs(b.index - offset))[0];
  const nextBrand = ordered.find(v => v.index > nearest.index)?.index ?? context.length;
  const plan = [...context.matchAll(/\b(5|20|100|200)\s*x\b/gi)].filter(v => v.index >= nearest.index && v.index < nextBrand)
    .sort((a, b) => Math.abs(a.index - offset) - Math.abs(b.index - offset))[0];
  const product = nearest[0].replace(/\s+/g, ' ').toLowerCase() + (plan ? ' ' + plan[1] + 'x' : '');
  return { product, context, productKnown: known.length === 1, productCandidates: [...new Set(known.map(m => m[0].toLowerCase()))] };
}
function extractQuotes(input) {
  const original = String(input).normalize('NFKC');
  const text = original.replace(/https?:\/\/\S+|\bwww\.\S+/gi, s => ' '.repeat(s.length)), found = [], occupied = [];
  function add(kind, match, value, high, unit, extra = {}) {
    if (!Number.isFinite(value) || value < 0 || value > 1e9 || (high !== undefined && (!Number.isFinite(high) || high < value))) return;
    const start = match.index, end = start + match[0].length;
    if (text[start - 1] === '-' && !/\d/.test(text[start - 2] || '')) return;
    if (occupied.some(r => start < r[1] && end > r[0])) return;
    occupied.push([start, end]);
    const nearby = productAt(original, start, match[0].length);
    const qualifierText = text.slice(Math.max(0, start - 8), Math.min(text.length, end + 8));
    const qualifier = high !== undefined ? '区间' : /(?:起|最低|低至|\+|以上)/.test(qualifierText) ? '起价/界限' : /(?:求|问|多少|吗|么|\?)/.test(qualifierText) ? '询价/待核对' : '原文标价';
    const valid = kind !== 'discount' || (value <= 10 && (high === undefined || high <= 10));
    found.push({ kind, label: TYPES[kind], raw: match[0], value, high: high ?? null, unit,
      index: start, end, ...nearby, qualifier, valid,
      review: !nearby.productKnown || !valid || qualifier !== '原文标价' || kind === 'tier' || unit.startsWith('币种未注'), ...extra });
  }
  for (const m of text.matchAll(new RegExp(span + String.raw`\s*折`, 'gi'))) add('discount', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), '折');
  for (const m of text.matchAll(/([一二两三四五六七八九十])(?:点([一二三四五六七八九]))?\s*折/g)) {
    const cn = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    add('discount', m, cn[m[1]] + (m[2] ? cn[m[2]] / 10 : 0), undefined, '折');
  }
  const per = new RegExp(span + String.raw`\s*(` + money + String.raw`)?\s*(?:[/／]\s*(?:每\s*)?|(?:一|每)\s*)` + dollar, 'gi');
  for (const m of text.matchAll(per)) add('perUSD', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), m[3] ? 'CNY/USD' : '币种未注/USD');
  const reversed = new RegExp(String.raw`(${numeric}|一|每)\s*` + dollar + String.raw`\s*(?:[=:=/]|只要|售价|价格|换|兑)?\s*(${numeric})\s*` + money, 'gi');
  for (const m of text.matchAll(reversed)) {
    const denominator = /一|每/.test(m[1]) ? 1 : Number(m[1]);
    if (denominator > 0) add('perUSD', m, Number(m[2]) / denominator, undefined, 'CNY/USD', { denominator, quoteAmount: Number(m[2]) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`倍率\s*[:：=]?\s*` + span + String.raw`\s*(?:倍|x|×)?`, 'gi'))) add('multiplier', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), '倍');
  for (const m of text.matchAll(new RegExp(span + String.raw`\s*倍(?:率)?`, 'gi'))) add('multiplier', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), '倍');
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.])` + span + String.raw`\s*[x×](?![\w])`, 'gi'))) add('tier', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), 'X（含义待核对）');
  for (const m of text.matchAll(new RegExp(span + String.raw`\s*(` + money + String.raw`|美元|美金|usd|刀)(?:\s*[/／]\s*(月|年|天|日|次|个|号))?`, 'gi'))) {
    const currency = /^(?:元|块(?:钱)?|人民币|[¥￥]|rmb|cny)$/i.test(m[3]) ? 'CNY' : 'USD';
    const period = m[4] || '周期未注';
    add('amount', m, Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), currency + '/' + period);
  }
  for (const m of text.matchAll(new RegExp(String.raw`([¥$])\s*` + span + String.raw`(?:\s*[/／]\s*(月|年|天|日|次|个|号))?`, 'g'))) add('amount', m, Number(m[2]), m[3] === undefined ? undefined : Number(m[3]), (m[1] === '$' ? 'USD' : 'CNY') + '/' + (m[4] || '周期未注'));
  return found.sort((a, b) => a.index - b.index);
}
function matchesText(text, options = {}, identity = {}) {
  const source = String(text).normalize('NFKC').toLocaleLowerCase();
  const queries = (Array.isArray(options.terms) ? options.terms : String(options.term || '').split(/[,，;；\n]+/)).map(s => String(s).trim().normalize('NFKC').toLocaleLowerCase()).filter(Boolean).slice(0, 100);
  if (queries.length && !(options.match === 'all' ? queries.every(t => source.includes(t)) : queries.some(t => source.includes(t)))) return false;
  if (options.sender) {
    const q = String(options.sender).trim().toLocaleLowerCase();
    if (![identity.senderId, identity.sender, identity.alias, identity.nickname, identity.remark].some(s => String(s || '').toLocaleLowerCase().includes(q))) return false;
  }
  return true;
}
class PriceAccumulator {
  constructor(options = {}, onRecord = null) { this.options = options; this.onRecord = onRecord; this.buckets = new Map(); this.records = []; this.count = 0; this.messages = 0; this.uniqueKeys = new Set(); this.messageKeys = new Set(); this.reviewCount = 0; }
  add(text, evidence) {
    if (!matchesText(text, this.options, evidence)) return;
    const quotes = extractQuotes(text), messageHash = createHash('sha256').update(String(evidence.senderId || evidence.sender)).update('\0').update(text.normalize('NFKC').replace(/\s+/g, ' ').trim()).digest('hex');
    for (const quote of quotes) {
      const o = this.options;
      if (o.kind && quote.kind !== o.kind) continue;
      if (o.unit && quote.unit !== o.unit) continue;
      if (o.product && !quote.product.toLocaleLowerCase().includes(String(o.product).toLocaleLowerCase())) continue;
      if (o.min !== '' && o.min !== undefined && o.min !== null && quote.value < Number(o.min)) continue;
      if (o.max !== '' && o.max !== undefined && o.max !== null && (quote.high ?? quote.value) > Number(o.max)) continue;
      if (o.reviewOnly && !quote.review) continue;
      this.count++; if (quote.review) this.reviewCount++;
      this.messageKeys.add(evidence.ref);
      const unique = messageHash + '/' + quote.index + '/' + quote.kind;
      const first = !this.uniqueKeys.has(unique); this.uniqueKeys.add(unique);
      const key = [quote.kind, quote.unit, quote.product, quote.value, quote.high ?? '', quote.qualifier].join('|');
      const bucket = this.buckets.get(key) || { key, kind: quote.kind, label: quote.label, unit: quote.unit, product: quote.product, value: quote.value, high: quote.high, qualifier: quote.qualifier,
        mentions: 0, uniqueQuotes: 0, senders: new Set(), groups: new Set(), latestTime: 0, review: quote.review };
      bucket.mentions++; if (first) bucket.uniqueQuotes++;
      bucket.senders.add(evidence.senderId || evidence.sender); bucket.groups.add(evidence.groupId); bucket.latestTime = Math.max(bucket.latestTime, evidence.timestamp);
      this.buckets.set(key, bucket);
      const row = { ...evidence, quote, quoteId: evidence.ref + '/' + quote.index };
      if (text.length > 1800) row.searchPreview = SearchPreview.preview(text, [quote.context, ...SearchPreview.terms(this.options.terms || this.options.term)]);
      this.onRecord?.(row, text);
      this.records.push(row);
      // Keep only the requested page, but compute frequency totals on all rows.
      const capacity = Math.min(10100, Math.max(0, Number(o.offset) || 0) + 100);
      if (this.records.length > capacity * 2) { this.records.sort(this.comparator()); this.records.length = capacity; }
    }
  }
  comparator() {
    const direction = this.options.sort === 'value-desc' ? -1 : 1;
    return this.options.sort?.startsWith('value')
      ? (a, b) => a.quote.kind.localeCompare(b.quote.kind) || a.quote.unit.localeCompare(b.quote.unit) || direction * (a.quote.value - b.quote.value) || b.timestamp - a.timestamp || a.quoteId.localeCompare(b.quoteId)
      : (a, b) => b.timestamp - a.timestamp || a.quoteId.localeCompare(b.quoteId);
  }
  result() {
    const offset = Math.min(10000, Math.max(0, Number(this.options.offset) || 0));
    return { count: this.count, messages: this.messageKeys.size, uniqueQuotes: this.uniqueKeys.size, reviewCount: this.reviewCount,
      buckets: [...this.buckets.values()].map(v => ({ ...v, senders: v.senders.size, groups: v.groups.size })).sort((a, b) => b.mentions - a.mentions || a.key.localeCompare(b.key)),
      records: this.records.sort(this.comparator()).slice(offset, offset + 100), offset, hasMore: this.count > offset + 100 && offset < 10000,
      method: '规则提取原文报价，按商品、单位、数值和标价条件分别计数。相同发送者的重复原文另做去重计数。X 标记不自动认定为价格倍率；未注明币种/商品/周期或询价的条目标为待核对。这些是群聊标价，不是成交价。' };
  }
}
module.exports = { TYPES, extractQuotes, matchesText, PriceAccumulator };
