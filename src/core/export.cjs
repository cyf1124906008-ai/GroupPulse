'use strict';
const C = require('./common.cjs');
const { PriceAccumulator } = require('./prices.cjs');
const html = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function plan(store, { scope = 'search', options = {}, format = 'csv', language = 'zh-CN' } = {}) {
  let records, rows, data;
  if (scope === 'report' || format === 'html') {
    data = store.statistics(options); records = data.summary.messages;
    const title = language === 'en' ? 'GroupPulse · Local activity report' : 'GroupPulse · 本机活动报告';
    const groups = data.groups.map(row => `<tr><td>${html(row.name)}</td><td>${row.count}</td></tr>`).join('');
    const words = data.keywords.map(word => `<span>${html(word.term)} · ${word.messages}</span>`).join(' ');
    const body = `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#233a50;margin:40px auto;max-width:1000px;padding:0 24px;background:#f4f7fa}h1{font-size:36px}section{background:white;border:1px solid #d6e1e8;border-radius:12px;padding:24px;margin:25px 0}.metrics{display:flex;gap:40px;font-size:25px}td,th{padding:10px 20px;border-bottom:1px solid #d6e1e8;text-align:left}table{border-collapse:collapse;width:100%}span{display:inline-block;padding:5px 12px;border:1px solid #d6e1e8;border-radius:7px;margin:4px}small{color:#586d81}</style><h1>${title}</h1><p>${html(options.start || 'All')} — ${html(options.end || 'All')}</p><small>${language==='en'?'Counts include only records retained on this computer.':'仅统计这台电脑已保存的记录。'}</small><section class="metrics"><b>${data.summary.messages || 0} ${language==='en'?'messages':'条消息'}</b><b>${data.summary.groups || 0} ${language==='en'?'conversations':'个会话'}</b><b>${data.summary.senders || 0} ${language==='en'?'senders':'位发送者'}</b></section><section><h2>${language==='en'?'Conversations':'会话排行'}</h2><table><thead><tr><th>${language==='en'?'Conversation':'会话'}</th><th>${language==='en'?'Messages':'消息量'}</th></tr></thead><tbody>${groups}</tbody></table></section><section><h2>${language==='en'?'Keywords':'关键词'}</h2>${words}</section><section><h2>${language==='en'?'Daily activity':'每日活动'}</h2><table>${data.days.map(day=>`<tr><td>${html(day.day)}</td><td>${day.count}</td></tr>`).join('')}</table></section><small>GroupPulse · PolyForm Noncommercial 1.0.0</small></html>`;
    return { data, records, content: format === 'json' ? JSON.stringify(data,null,2) : body };
  }
  if (scope === 'prices') {
    const found = [], accumulator = new PriceAccumulator({ ...options, term: options.query || '' }, row => found.push(row));
    for (const item of store.all({ ...options, query: '' }, true)) accumulator.add(item.body, { ref:item.id,senderId:item.senderId,sender:item.senderName,alias:item.alias,nickname:item.nickname,remark:item.remark,groupId:item.threadId,group:item.threadName,timestamp:item.timestamp,text:item.body,source:item });
    data = { summary: accumulator.result(), quotes: found };
    rows = [['报价类型 / Type','数值 / Value','上限 / High','单位 / Unit','商品 / Product','待核对 / Review','报价原文 / Quote','群聊 / Group','发送者 / Sender','WXID','微信号 / Alias','时间 / Time','完整原文 / Original','原文 ID / Reference'],...found.map(item=>[item.quote.kind,item.quote.value,item.quote.high,item.quote.unit,item.quote.product,item.quote.review,item.quote.raw,item.group,item.sender,item.senderId,item.alias,new Date(item.timestamp*1000).toISOString(),item.text,item.ref])];
    records = found.length;
  } else if (scope === 'market') {
    data = store.market({ ...options, allPairs:true });
    if(options.kind === 'pairs') {
      rows = [['共同线索 / Shared','出方 / Seller','出方 WXID','出方原文 / Offer','出方来源 / Offer sources','收方 / Buyer','收方 WXID','收方原文 / Request','收方来源 / Request sources'],...data.pairs.map(pair=>[pair.shared.join(' / '),pair.offer.senderName,pair.offer.senderId,pair.offer.body,pair.offer.sources.map(s=>s.threadName+' '+new Date(s.timestamp*1000).toISOString()+' '+s.id).join('\n'),pair.request.senderName,pair.request.senderId,pair.request.body,pair.request.sources.map(s=>s.threadName+' '+new Date(s.timestamp*1000).toISOString()+' '+s.id).join('\n')])];
    } else rows = [['分类 / Type','发送者 / Sender','WXID','微信号 / Alias','完整原文 / Original','出现次数 / Occurrences','来源 / Sources'],...data.listings.map(item=>[item.intent,item.senderName,item.senderId,item.alias,item.body,item.sources.length,item.sources.map(s=>s.threadName+' '+new Date(s.timestamp*1000).toISOString()+' '+s.id).join('\n')])];
    records=rows.length-1;
  } else if(scope === 'contacts') {
    const list=store.db.prepare("SELECT * FROM contacts WHERE is_group=0 AND instr(gp_norm(id || ' ' || name || ' ' || alias || ' ' || nickname || ' ' || remark),?)>0 ORDER BY name").all(C.norm(options.query||''));
    data=list;rows=[['显示名称 / Name','WXID','微信号 / Alias','昵称 / Nickname','备注 / Remark'],...list.map(item=>[item.name,item.id,item.alias,item.nickname,item.remark])];records=list.length;
  } else if(scope === 'moments') {
    const list=[];let offset=0;for(;;){const batch=store.moments({...options,offset});list.push(...batch.items);if(!batch.hasMore)break;offset+=40;}
    data=list;rows=[['发送者 / Author','WXID','时间 / Time','原文 / Original','朋友圈 ID / Moment ID'],...list.map(item=>[item.author_name,item.author,new Date(item.time*1000).toISOString(),item.body,item.id])];records=list.length;
  } else { rows=store.exportRows(options);records=rows.length-1;data={version:1,messages:[...store.all(options,options.groupsOnly!==false)]}; }
  return { records, content: format==='json'?JSON.stringify(data,null,2):C.csv(rows) };
}
module.exports={plan};
