#!/usr/bin/env python3
"""Publish only artifacts from a verified build of this repository."""
from pathlib import Path
import hashlib,json,os,re,subprocess,time,zipfile
ROOT=Path(__file__).resolve().parents[1]
repo=os.environ['GROUPPULSE_REPOSITORY'];run=os.environ['GROUPPULSE_BUILD_RUN'];tag=os.environ['GROUPPULSE_RELEASE_TAG']
version=json.loads((ROOT/'package.json').read_text())['version']
assert re.fullmatch(r'\d+',run) and tag=='v'+version,'Invalid build run or version'
def gh(*args,check=True):
    return subprocess.run(['gh',*map(str,args)],capture_output=True,text=True,check=check)
for attempt in range(40):
    build=json.loads(gh('api',f'repos/{repo}/actions/runs/{run}').stdout)
    assert build['event'] in ['push','workflow_dispatch'] and build['path']=='.github/workflows/build.yml','Unexpected source workflow'
    if build['status']=='completed':break
    time.sleep(30)
else:raise RuntimeError('Build did not finish in time')
assert build['conclusion']=='success','Both native platform jobs must pass before publishing'
work=ROOT/'.build/release';work.mkdir(parents=True,exist_ok=True)
gh('run','download',run,'--repo',repo,'--dir',work/'artifacts')
assets=[];reports={}
for platform,label in [('macos','macOS-arm64'),('windows','Windows-x64')]:
    name=f'GroupPulse-{version}-{label}.zip';matches=list((work/'artifacts').rglob(name));assert len(matches)==1,name
    archive=matches[0];checksum=Path(str(archive)+'.sha256');expected=checksum.read_text().split()[0]
    digest=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest();assert digest==expected,'Archive checksum mismatch'
    native=list((work/'artifacts').rglob(f'{platform}/native-test.json'));assert len(native)==1
    report=json.loads(native[0].read_text());assert report['passed'] and report['version']==version and report['keychainCalls']==0 and report['networkCalls']==0,'Invalid native test result'
    assert len(report['checks'])>=12,'Incomplete native test suite'
    if platform=='windows':assert any('DPAPI' in check for check in report['checks'])
    proof=work/f'GroupPulse-{version}-{label}-native-test.json';proof.write_text(json.dumps(report,indent=2),encoding='utf8');assets.extend([archive,checksum,proof]);reports[platform]=report
    with zipfile.ZipFile(archive) as z:
        names=z.namelist();assert not any(re.search(r'(?:^|/)(?:settings\.json|current\.json|saved\.json|\.git|generations)(?:/|$)',name) for name in names),'Private profile in archive'
        assert not any(name.endswith(('.keyinfo','.db','.db-wal','.db-shm')) for name in names),'Private database in archive'
        assert any(name.endswith('/LICENSES/SILK-BSD-LICENSE.txt') or name=='LICENSES/SILK-BSD-LICENSE.txt' for name in names)
        if platform=='macos':
            metadata=json.loads(z.read(next(name for name in names if name.endswith('build-report.json'))));assert metadata.get('macOSDeploymentTarget')=='12.0'
            source=next(name for name in names if name.endswith('/ffmpeg-8.1.3.tar.xz') or name=='ffmpeg-8.1.3.tar.xz');(work/'ffmpeg-8.1.3.tar.xz').write_bytes(z.read(source))
spec=next(item for item in json.loads((ROOT/'runtime-inputs.json').read_text()) if item['file']=='ffmpeg-8.1.3.tar.xz')
assert hashlib.sha256((work/spec['file']).read_bytes()).hexdigest()==spec['sha256'];assets.append(work/spec['file'])
validation=work/f'GroupPulse-{version}-validation.json';validation.write_text(json.dumps({'product':'GroupPulse','version':version,'sourceCommit':build['head_sha'],'buildRun':build['html_url'],'reports':reports,'privateDataIncluded':False},indent=2),encoding='utf8');assets.append(validation)
existing=gh('release','view',tag,'--repo',repo,'--json','isDraft,targetCommitish',check=False)
if existing.returncode==0:
    release=json.loads(existing.stdout);assert release['isDraft'] and release['targetCommitish']==build['head_sha'],'Refusing to replace an existing published or different release'
else:gh('release','create',tag,'--repo',repo,'--target',build['head_sha'],'--title','GroupPulse '+version,'--notes-file',ROOT/'.github/RELEASE_NOTES.zh-en.md','--draft')
gh('release','upload',tag,'--repo',repo,*assets,'--clobber')
gh('release','edit',tag,'--repo',repo,'--draft=false','--latest')
print(json.dumps({'published':True,'tag':tag,'sourceCommit':build['head_sha'],'assets':[p.name for p in assets]}))
