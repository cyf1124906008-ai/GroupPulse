'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
function createFixture(root, { now = Math.floor(Date.now() / 1000), count = 120 } = {}) {
  if (fs.existsSync(root) && !fs.existsSync(path.join(root, 'grouppulse-fixture.json'))) throw new Error('Refusing to overwrite an unmarked directory');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'grouppulse-fixture.json'), JSON.stringify({ synthetic: true }));
  const source = path.join(root, 'account', 'decrypted'); fs.rmSync(source, { recursive: true, force: true });
  const selfId = 'wxid_gp_demo', people = [[selfId, 'GroupPulse Demo', 'gp_demo'], ['wxid_gp_aria', 'Aria · 演示', 'gp_aria_demo'], ['wxid_gp_noah', 'Noah · 演示', 'gp_noah_demo'], ['wxid_gp_mika', 'Mika · 演示', 'gp_mika_demo'], ['wxid_gp_lena', 'Lena · 演示', 'gp_lena_demo']];
  const groups = [['gp_cloud@chatroom', 'Cloud Exchange · 演示'], ['gp_builders@chatroom', 'AI Builders · 演示'], ['gp_gpu@chatroom', 'GPU Lab · 演示'], ['gp_product@chatroom', 'Product Notes · 演示'], ['gp_design@chatroom', 'Design Studio · 演示'], ['gp_release@chatroom', 'Release Room · 演示']];
  const roomTable = id => 'Msg_' + crypto.createHash('md5').update(id).digest('hex');
  function database(folder, name, schema) { const target = path.join(source, folder, name); fs.mkdirSync(path.dirname(target), { recursive: true }); const db = new DatabaseSync(target); db.exec(schema); return db; }
  const c = database('contact', 'contact.db', 'CREATE TABLE contact(username TEXT PRIMARY KEY,nick_name TEXT,remark TEXT,alias TEXT,small_head_url TEXT,big_head_url TEXT,local_type INTEGER,delete_flag INTEGER)');
  for (const [id, name, alias] of people) c.prepare('INSERT INTO contact VALUES(?,?,?,?,?,?,?,?)').run(id, name, name, alias, '', '', 1, 0);
  for (const [id, name] of groups) c.prepare('INSERT INTO contact VALUES(?,?,?,?,?,?,?,?)').run(id, name, name, '', '', '', 2, 0);
  c.close();
  const icon=fs.readFileSync(path.join(__dirname,'../assets/icon.png')),avatarDb=database('head_image','head_image.db','CREATE TABLE head_image(username TEXT PRIMARY KEY,image_buffer BLOB)');
  for(const [id] of [...people,...groups])avatarDb.prepare('INSERT INTO head_image VALUES(?,?)').run(id,icon);avatarDb.close();
  const imageKey=crypto.createHash('md5').update(icon).digest('hex'),imageFolder=path.join(path.dirname(source),'msg/attach');fs.mkdirSync(imageFolder,{recursive:true});fs.writeFileSync(path.join(imageFolder,imageKey+'.png'),icon);
  const s = database('session', 'session.db', 'CREATE TABLE SessionTable(username TEXT PRIMARY KEY,is_hidden INTEGER,last_timestamp INTEGER,sort_timestamp INTEGER,summary TEXT,unread_count INTEGER,last_sender_display_name TEXT)');
  for (const [id, name] of [...groups, ...people.slice(1, 3)]) s.prepare('INSERT INTO SessionTable VALUES(?,0,?,?,?,0,?)').run(id, now, now, '【合成演示】本机消息与信息整理', name);
  s.close();
  const samples = [
    '【演示】出售 AWSB 开发额度，0.2元/刀，明确倍率0.8。请核对有效期与来源。',
    '【演示】求购 AWSB 开发额度，预算0.18元/刀，需要说明使用条件。',
    '【演示】出 Claude 开发套餐，8折，¥120/月；20x仅为套餐标记。',
    '【演示】收 Claude 测试用量，核对价格、时间与发送者。',
    '【演示】今天讨论了 GPU、检索质量、模型API和关键词分析。',
    '【演示】搜索结果应该高亮关键词，长消息优先显示命中的句子。',
    '【演示】出售 GPU 云实例，¥80/天；性能倍率1.5，计价周期需单独核对。',
    '【演示】求购 GPU 测试实例，需要核对吞吐量和延迟。'
  ];
  let messages = 0, longMessageRef = null;
  for (let shard = 0; shard < 2; shard++) {
    const db = database('message', 'message_' + shard + '.db', 'CREATE TABLE Name2Id(user_name TEXT,is_session INTEGER)');
    const ordered = shard ? [...people].reverse() : people;
    for (const [id] of ordered) db.prepare('INSERT INTO Name2Id VALUES(?,0)').run(id);
    db.exec('BEGIN');
    for (const [g, group] of [...groups, ...people.slice(1, 3)].entries()) {
      const table = roomTable(group[0]);
      db.exec('CREATE TABLE "' + table + '"(local_id INTEGER PRIMARY KEY,server_id INTEGER,local_type INTEGER,create_time INTEGER,real_sender_id INTEGER,message_content TEXT,compress_content BLOB,packed_info_data BLOB,status INTEGER,sort_seq INTEGER)');
      const insert = db.prepare('INSERT INTO "' + table + '" VALUES(?,?,?,?,?,?,?,NULL,3,?)');
      const total = g < groups.length ? count - g * Math.floor(count / 12) : 6;
      for (let i = shard; i < total; i += 2) {
        const person = people[1 + i % 4], sender = ordered.findIndex(item => item[0] === person[0]) + 1;
        let content = samples[i % samples.length], type = 1;
        if (g === 0 && i === 22) { content = '【演示长消息】\n' + '背景说明用于测试长文本定位。\n'.repeat(80) + '\n出售 AWSB 现货，0.15元/刀；这句话应优先显示。'; longMessageRef = [shard, table, i + 1]; }
        if (g === 0 && i === 24) { type = 49; content = '<msg><appmsg><type>57</type><title>这里只讨论售后，并未出售</title><refermsg><content>出售 AWSB 0.01元/刀</content><displayname>被引用者</displayname></refermsg></appmsg></msg>'; }
        const compressed = i === 31 ? zlib.zstdCompressSync(Buffer.from(content + ' 压缩检索标记')) : null;
        insert.run(i + 1, 9007199254740993n + BigInt(g * 1000 + i), type, now - i * 75 - g * 110, sender, compressed ? '' : content, compressed, i + 1); messages++;
      }
    }
    db.exec('COMMIT'); db.close();
  }
  const sns = database('sns', 'sns.db', 'CREATE TABLE SnsTimeLine(tid INTEGER PRIMARY KEY,user_name TEXT,content TEXT)');
  for (let i = 0; i < 4; i++) sns.prepare('INSERT INTO SnsTimeLine VALUES(?,?,?)').run(1000 + i, people[1 + i % 4][0], '<TimelineObject><id>' + (1000 + i) + '</id><username>' + people[1 + i % 4][0] + '</username><createTime>' + (now - i * 3600) + '</createTime><contentDesc><![CDATA[' + ['【演示】今天整理了 AWSB 报价和 GPU 评测，所有结论都要核对原文。', '【演示】把重复的信息合并，把不同的发言人区分开。', 'English interface, original conversations unchanged. 【演示】', '【演示】关注关键词：Claude、倍率、每刀价格。'][i] + ']]></contentDesc><ContentObject><contentStyle>2</contentStyle><mediaList>'+(i===0?'<media><type>2</type><md5>'+imageKey+'</md5></media>':'')+'</mediaList></ContentObject></TimelineObject>');
  sns.close();
  return { source, selfId, people, groups, messages, moments: 4, now, longMessageRef, mediaRoot: path.dirname(source), synthetic: true };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '../.build/demo');
  const info = createFixture(root, { count: 180 });
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ language: 'zh-CN', theme: 'light', tracked: ['AWSB', 'Claude', 'GPU', '倍率'], autoSync: true, source: { databaseRoot: info.source, mediaRoot: info.mediaRoot, encrypted: false, selfId: info.selfId }, demo: true }));
  fs.writeFileSync(path.join(profile, 'grouppulse-demo.json'), JSON.stringify({ synthetic: true }));
  console.log(JSON.stringify({ synthetic: true, messages: info.messages, groups: info.groups.length, moments: info.moments, realWechatFilesRead: 0 }));
}
module.exports = { createFixture };
