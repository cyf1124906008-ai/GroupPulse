'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
// CurrentUser DPAPI interoperability; ChatTrace's MIT notice is retained.
async function importKeyInfo(file) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_ONLY');
  const script = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Security;$p=[Console]::In.ReadToEnd();$bytes=[IO.File]::ReadAllBytes($p);$clear=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($clear))";
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { windowsHide:true,stdio:['pipe','pipe','ignore'] });
    let done = false, size = 0; const chunks = [];
    const timer = setTimeout(() => { child.kill(); finish(Error('KEY_IMPORT_TIMEOUT')); },30000);
    function finish(error, value) { if(done){value?.raw?.fill(0);return;}done=true;clearTimeout(timer);for(const chunk of chunks)chunk.fill(0);error?reject(error):resolve(value); }
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>65536){chunk.fill(0);child.kill();finish(Error('KEY_IMPORT_TOO_LARGE'));}else chunks.push(chunk);});
    child.on('error',()=>finish(Error('KEY_IMPORT_FAILED')));
    child.on('close',code=>{if(done)return;if(code!==0)return finish(Error('KEY_IMPORT_CURRENT_USER_REQUIRED'));const clear=Buffer.concat(chunks);try{const value=JSON.parse(clear.toString('utf8').replace(/^\uFEFF/,''));const raw=Buffer.from(String(value.password_b64||''),'base64');if(raw.length!==32){raw.fill(0);throw Error();}finish(null,{raw,accountId:String(value.account_id||'')});}catch{finish(Error('KEY_IMPORT_FORMAT_INVALID'));}finally{clear.fill(0);}});
    child.stdin.on('error',()=>{});child.stdin.end(file);
  });
}
module.exports = { importKeyInfo };
