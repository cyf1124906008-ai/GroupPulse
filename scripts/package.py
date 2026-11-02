#!/usr/bin/env python3
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--platform',choices=['macos','windows'],required=True);args=parser.parse_args()
version=json.loads((ROOT/'package.json').read_text())['version'];folder=ROOT/'dist'/args.platform
report=json.loads((folder/'native-test.json').read_text(encoding='utf8'))
if not report.get('passed') or report.get('version')!=version:raise RuntimeError('Passing native test report required')
for name in ['overview-zh.png','overview-en.png','overview-dark.png','market-zh.png','prices-zh.png']:
    if not (ROOT/'docs/screenshots'/name).exists():raise RuntimeError('Missing synthetic screenshot: '+name)
name=f"GroupPulse-{version}-{'macOS-arm64' if args.platform=='macos' else 'Windows-x64'}.zip";output=ROOT/'dist'/name
if output.exists():output.unlink()
if args.platform=='macos':subprocess.run(['/usr/bin/ditto','-c','-k','--keepParent',str(folder),str(output)],check=True)
else:
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file in sorted(folder.rglob('*')):
            if file.is_file():z.write(file,str(file.relative_to(folder)))
digest=hashlib.sha256(output.read_bytes()).hexdigest();output.with_suffix('.zip.sha256').write_text(digest+'  '+name+'\n',encoding='utf8');print(output.name,digest)
