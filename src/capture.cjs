'use strict';
const { dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { verifyKey, decryptBuffer, readSnapshot } = require('./core/snapshot.cjs');
const C = require('./core/common.cjs');
function command(file, args) {
  return new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:'ignore'});child.on('error',()=>reject(Error('INITIALIZATION_FAILED')));child.on('exit',code=>code===0?resolve():reject(Error('INITIALIZATION_FAILED')));});
}
async function capture({ source, app, window, profile, progress, onKey }) {
  if(process.platform!=='darwin')throw Error('MAC_ONLY');
  if(!source?.databaseRoot)throw Error('CHOOSE_SOURCE_FIRST');
  const en=C.json(path.join(profile,'settings.json')).language==='en';
  if(spawnSync('/usr/bin/pgrep',['-x','WeChat']).status===0) {
    await dialog.showMessageBox(window,{type:'info',message:en?'Save unfinished messages and quit WeChat first.':'请先保存未发送的内容，并手动退出微信。',detail:en?'Then retry initialization. GroupPulse will prepare a temporary login copy without altering your installed app.':'退出后再点一次初始化。GroupPulse 会准备临时登录副本，不修改安装的原版微信。'});
    return {canceled:true};
  }
  const answer=await dialog.showMessageBox(window,{type:'question',title:'GroupPulse',message:en?'Prepare a temporary WeChat login copy?':'准备临时微信登录副本？',detail:en?'You will confirm or scan to log in. Only the database encryption key for the chosen local account is captured and verified locally. Your installed WeChat app remains unchanged. The copy needs about 1.1 GB temporarily and is removed afterwards.':'需要你在临时窗口扫码或确认登录。只捕获所选本机账号的数据库密钥，并在本机验证。原版微信程序不被修改。临时副本约需1.1GB空间，结束后清理。',buttons:[en?'Cancel':'取消',en?'Continue':'继续'],defaultId:0,cancelId:0});
  if(answer.response!==1)return {canceled:true};
  let original='/Applications/WeChat.app';
  if(!fs.existsSync(original)){const selected=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'WeChat',extensions:['app']}]});if(selected.canceled)return {canceled:true};original=selected.filePaths[0];}
  const root=fs.mkdtempSync(path.join(profile,'login-'));fs.chmodSync(root,0o700);const copy=path.join(root,'WeChat.app');let child;
  try{
    progress({phase:'copy',current:0});await command('/usr/bin/ditto',[original,copy]);
    const library=path.join(copy,'Contents/Frameworks/GroupPulseCapture.dylib');fs.copyFileSync(path.join(__dirname,'../native/key-capture.dylib'),library);
    await command('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements',copy]);
    const key=await new Promise((resolve,reject)=>{
      let incoming=Buffer.alloc(0),done=false;
      const finish=(error,key)=>{if(done){key?.fill(0);return;}done=true;clearTimeout(timer);error?reject(error):resolve(key);};
      child=spawn(path.join(copy,'Contents/MacOS/WeChat'),[],{env:{...process.env,DYLD_INSERT_LIBRARIES:library,GROUPPULSE_PRIVATE_KEY_FD:'3'},stdio:['ignore','ignore','ignore','pipe']});
      const timer=setTimeout(()=>finish(Error('INITIALIZATION_LOGIN_TIMEOUT')),300000);
      child.on('error',()=>finish(Error('INITIALIZATION_FAILED')));child.on('exit',()=>finish(Error('INITIALIZATION_CLOSED')));
      child.stdio[3].on('data',chunk=>{incoming=Buffer.concat([incoming,chunk]);chunk.fill(0);while(incoming.length>=52){const marker=incoming.indexOf('GPK1');if(marker<0){incoming=incoming.subarray(-3);break;}if(marker)incoming=incoming.subarray(marker);if(incoming.length<52)break;const candidate=Buffer.from(incoming.subarray(4,36));incoming.fill(0,4,36);incoming=incoming.subarray(52);if(!done&&verifyKey(candidate,path.join(source.databaseRoot,'session/session.db')))finish(null,candidate);else candidate.fill(0);}});
      progress({phase:'login'});
    });
    try{
      let accountId='';const file=path.join(root,'contact.db');const plain=decryptBuffer(key,readSnapshot(path.join(source.databaseRoot,'contact/contact.db')));
      try{fs.writeFileSync(file,plain,{mode:0o600});}finally{plain.fill(0);}
      const db=C.open(file);try{const candidates=[source.folderName,source.folderName.replace(/_[a-f0-9]{4,8}$/i,'')];for(const id of candidates)if(db.prepare('SELECT username FROM contact WHERE username=? LIMIT 1').get(id)){accountId=id;break;}}finally{db.close();}
      onKey(key);return {loaded:true,accountId};
    }finally{key.fill(0);}
  }finally{
    if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,3000);});}
    fs.rmSync(root,{recursive:true,force:true});
    spawn('/usr/bin/open',['-a',original],{stdio:'ignore'}).on('error',()=>{});
  }
}
module.exports={capture};
