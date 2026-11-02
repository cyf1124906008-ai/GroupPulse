'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createFixture } = require('../scripts/fixture.cjs');
const Import = require('../src/core/import.cjs');
const { Store } = require('../src/core/store.cjs');
const { intent, collect } = require('../src/core/market.cjs');
const { extractQuotes } = require('../src/core/prices.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grouppulse-independent-test-'));
const fixture = createFixture(path.join(root, 'fixture'));
const profile = path.join(root, 'profile');
let current;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('standalone SQLite ingestion is complete, readonly, cross-shard and independent of original app resources', async () => {
  const file = path.join(fixture.source, 'message/message_0.db'), before = digest(file);
  const source = { ...Import.inspect(fixture.source), selfId: fixture.selfId };
  current = await Import.synchronize(profile, source, null);
  assert.equal(current.stats.messages, fixture.messages); assert.equal(digest(file), before);
  const store = new Store(current.index);
  try {
    const status = store.status(); assert.equal(status.messages, fixture.messages); assert.equal(status.groups, 6); assert.equal(status.moments, 4);
    const found = store.messages({ query: '压缩检索标记' }); assert(found.total > 0); assert(found.items[0].body.includes('压缩检索标记'));
    assert.equal(found.items[0].serverId, String(9007199254740993n + 31n));
    const aria = store.messages({ sender: 'gp_aria_demo' }); assert(aria.total > 0); assert(aria.items.every(item => item.senderId === 'wxid_gp_aria'));
    assert(store.messages({ query: 'AWSB,0.2', match: 'all' }).items.every(item => item.body.includes('AWSB') && item.body.includes('0.2')));
    assert.equal(store.messages({ query: '<script>[' }).total, 0);
  } finally { store.close(); }
  const next = await Import.synchronize(profile, source, null); assert.equal(next.changed, false);
});
test('source context retains exact sender, unsigned message identifiers and neighboring records', () => {
  const store = new Store(current.index);
  try {
    const result = store.messages({ query: '0.15元/刀' }); const item = result.items[0];
    assert(item.body.length > 1000); assert.equal(item.threadId, 'gp_cloud@chatroom');
    const context = store.messages({ thread: item.threadId, reference: item.id });
    assert(context.items.some(row => row.id === item.id && row.body === item.body));
    assert(context.items.length > 1); assert.equal(store.message(item.id).localId, item.localId);
  } finally { store.close(); }
});
test('new matching logic preserves distinct identities, all repeated sources and explicit filter semantics', () => {
  assert.equal(intent('收到消息了').kind, ''); assert.equal(intent('今天出门').kind, '');
  assert.equal(intent('出售 AWSB').kind, 'offer'); assert.equal(intent('求购 AWSB').kind, 'request'); assert.equal(intent('出售 AWSB；求购 GPU').kind, 'review');
  const make = (id, sender, body, timestamp = 1) => ({ id, senderId: sender, senderName: '同名', alias: sender, body, timestamp, threadId: id + '@chatroom', threadName: '测试群', localId: '1', shard: 'message_0.db' });
  const rows = [make('a', 'seller-a', '出售 AWSB 0.2元/刀'), make('b', 'seller-a', '出售 AWSB 0.2元/刀', 2), make('c', 'seller-b', '出售 AWSB 0.2元/刀'), make('d', 'buyer-a', '求购 AWSB 开发额度')];
  const result = collect(rows); assert.equal(result.listings.length, 3); assert.equal(result.listings[0].sources.length, 2); assert.equal(result.pairs.length, 2);
  assert.equal(collect(rows, { query: 'awsb 缺货' }).filtered, 0); assert.equal(collect(rows, { exclude: 'buyer-a' }).pairs.length, 0);
});
test('quoted messages are not counted as offers from the current speaker', () => {
  const body = Import.messageBody({ local_type: 49, message_content: '<appmsg><title>核对一下信息</title><refermsg><content>出售 AWSB 0.01元/刀</content></refermsg></appmsg>' }, '');
  assert.equal(intent(body.text).kind, ''); assert(!body.text.includes('0.01'));
});
test('prices keep product, currency, period, explicit multipliers and plan labels separate', () => {
  const quotes = extractQuotes('Claude 8折；AWSB 0.2元/刀；100刀30元；倍率0.8；20x；¥120/月');
  assert(quotes.some(item => item.kind === 'discount' && item.value === 8));
  assert(quotes.some(item => item.kind === 'perUSD' && item.value === 0.3 && item.unit === 'CNY/USD'));
  assert(quotes.some(item => item.kind === 'multiplier' && item.value === 0.8));
  assert(quotes.some(item => item.kind === 'tier' && item.review));
  assert(quotes.some(item => item.kind === 'amount' && item.unit === 'CNY/月'));
});
test('statistics, custom phrases, Moments, contacts and exports use the same complete source index', () => {
  const store = new Store(current.index);
  try {
    const result = store.statistics({ tracked: ['AWSB', '不存在的词'] });
    assert(result.summary.messages > 0); assert.equal(result.groups.length, 6); assert(result.keywords.length > 0);
    assert(result.tracked[0].messages > 0); assert.equal(result.tracked[1].occurrences, 0);
    assert.equal(store.moments({ query: 'AWSB' }).total, 1); assert.equal(store.contacts({ query: 'gp_aria' }).total, 1);
    const prices = store.prices({ query: 'Claude' }); assert(prices.count > 0); assert(prices.records.every(item => item.text.toLowerCase().includes('claude')));
    assert(store.exportRows({}).length > 81);
    const evidence = store.evidence({ samples: 5 }); assert.equal(evidence.samples.length, 5); assert(evidence.eligible > evidence.samples.length); assert.equal(evidence.samples[0].number, 'E001');
  } finally { store.close(); }
});
