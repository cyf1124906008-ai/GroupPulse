#!/usr/bin/env python3
"""Audit only the public source allowlist; private profiles are never input."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[1]
FOLDERS=['src','native','assets','vendor','LICENSES','scripts','tests','docs','.github']
FILES=['.gitignore','.gitattributes','package.json','package-lock.json','runtime-inputs.json','LICENSE','NOTICE.md','README.md','SECURITY.md']
paths=[ROOT/name for name in FILES if (ROOT/name).is_file()]
for name in FOLDERS:paths.extend(p for p in (ROOT/name).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for file in paths:
    relative=str(file.relative_to(ROOT));assert file.suffix not in ['.db','.keyinfo','.asar'],relative
    assert not any(part in file.parts for part in ['node_modules','third_party','generations']),relative
    assert not file.is_symlink(),relative
    if file.suffix.lower() in ['.png','.ico','.hevc','.wasm']:continue
    value=file.read_text(encoding='utf8',errors='strict')
    assert not re.search(r'/Users/[A-Za-z0-9_.-]+/(?:Documents|Library)',value),relative+' has a private path'
    assert not re.search(r'wxid_(?!gp_)[A-Za-z0-9]{8,}',value),relative+' has a real account ID'
    assert not re.search(r'gh[pousr]_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',value),relative+' may contain a secret'
    if 'src/core/' in relative:assert not re.search(r'WeFlow|TradeBoard|wcdbWorker|main-upstream',value),relative+' depends on a previous application'
origin=json.loads((ROOT/'vendor/silk-wasm-origin.json').read_text())
actual={str(p.relative_to(ROOT/'vendor/silk-wasm')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'vendor/silk-wasm').rglob('*') if p.is_file()}
assert actual==origin['files'],'Vendor integrity mismatch'
for name in ['wechat-decrypt-LICENSE.txt','media-reference-MIT-LICENSE.txt','ChatTrace-MIT-LICENSE.txt','SILK-BSD-LICENSE.txt','FFmpeg-LGPL-2.1.txt','zlib-LICENSE.txt','rcedit-MIT-LICENSE.txt']:
    assert (ROOT/'LICENSES'/name).stat().st_size>100,name
print(json.dumps({'passed':True,'publicSourceFiles':len(paths),'vendorFilesVerified':len(actual),'privateProfilesIncluded':False,'legacyApplicationRuntimeIncluded':False}))
