#!/usr/bin/env python3
"""Launch the built app only with an isolated, synthetic profile."""
from pathlib import Path
import argparse, json, os, subprocess, shutil
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--platform',choices=['macos','windows'],required=True);args=parser.parse_args()
test=ROOT/'.build/native-test'
if test.exists():shutil.rmtree(test)
test.mkdir(parents=True)
script="const fs=require('node:fs'),path=require('node:path');const root=process.argv[1],{createFixture}=require('./scripts/fixture.cjs');const f=createFixture(path.join(root,'fixture'));const profile=path.join(root,'profile');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'grouppulse-demo.json'),JSON.stringify({synthetic:true}));fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({demo:true,language:'zh-CN',theme:'light',autoSync:false,tracked:['AWSB','GPU'],source:{databaseRoot:f.source,mediaRoot:f.mediaRoot,selfId:f.selfId,encrypted:false}}));require('./src/core/import.cjs').synchronize(profile,{...require('./src/core/import.cjs').inspect(f.source),selfId:f.selfId}).then(()=>console.log('Synthetic native profile ready'));"
subprocess.run(['node','-e',script,str(test)],cwd=ROOT,check=True)
executable=ROOT/'dist/macos/GroupPulse.app/Contents/MacOS/GroupPulse' if args.platform=='macos' else ROOT/'dist/windows/GroupPulse/GroupPulse.exe'
env=dict(os.environ,GROUPPULSE_CI='1',GROUPPULSE_TEST_HEVC=str(ROOT/'tests/fixtures/teal-frame.hevc'))
result=subprocess.run([str(executable),'--user-data-dir='+str(test/'profile'),'--demo','--native-test','--disable-gpu'],cwd=ROOT,env=env,timeout=180)
report=test/'profile/native-test.json'
if not report.exists():raise RuntimeError('Native test did not produce a result')
data=json.loads(report.read_text(encoding='utf8'));print(json.dumps(data,ensure_ascii=False,indent=2))
if result.returncode or not data.get('passed'):raise SystemExit(1)
shutil.copy2(report,ROOT/'dist'/args.platform/'native-test.json')
