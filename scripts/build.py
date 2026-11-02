#!/usr/bin/env python3
"""Build only the independent source using SHA-256 pinned official Electron."""
from pathlib import Path
import argparse, hashlib, json, os, plistlib, re, shutil, stat, subprocess, urllib.request, zipfile
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.build/downloads'

def obtain(spec):
    file=CACHE/spec['file'];file.parent.mkdir(parents=True,exist_ok=True)
    if file.exists() and hashlib.sha256(file.read_bytes()).hexdigest()==spec['sha256']:return file
    request=urllib.request.Request(spec['url'],headers={'User-Agent':'GroupPulse-build'})
    temporary=file.with_suffix(file.suffix+'.part')
    with urllib.request.urlopen(request,timeout=180) as src,temporary.open('wb') as dst:shutil.copyfileobj(src,dst)
    if hashlib.sha256(temporary.read_bytes()).hexdigest()!=spec['sha256']:raise RuntimeError('Runtime checksum mismatch')
    temporary.replace(file);return file

def extract(archive,folder):
    folder.mkdir(parents=True,exist_ok=True)
    if os.name=='posix' and os.uname().sysname=='Darwin':subprocess.run(['/usr/bin/ditto','-x','-k',str(archive),str(folder)],check=True)
    else:
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                target=folder/info.filename
                if '..' in Path(info.filename).parts or Path(info.filename).is_absolute():raise RuntimeError('Unsafe runtime path')
                z.extract(info,folder)

def build(platform):
    codec=ROOT/'.build/codec-bin'/('ffmpeg.exe' if platform=='windows' else 'ffmpeg')
    if platform=='macos':
        os.environ['MACOSX_DEPLOYMENT_TARGET']='12.0'
        if codec.exists():
            metadata=subprocess.check_output(['/usr/bin/otool','-l',str(codec)],text=True)
            minimum=re.search(r'\bminos\s+(\d+(?:\.\d+)*)',metadata)
            if not minimum or tuple(map(int,minimum.group(1).split('.')[:2]))>(12,0):
                codec.unlink();shutil.rmtree(ROOT/'.build/codec-macos',ignore_errors=True)
    if not codec.exists():
        if platform=='macos':subprocess.run(['bash',str(ROOT/'scripts/build-codec.sh'),'macos'],cwd=ROOT,check=True)
        else:raise RuntimeError('Build the independent codec with scripts/build-codec.sh windows first')
    specs=json.loads((ROOT/'runtime-inputs.json').read_text());package=json.loads((ROOT/'package.json').read_text())
    spec=next(item for item in specs if item['file']==('electron-v43.0.0-darwin-arm64.zip' if platform=='macos' else 'electron-v43.0.0-win32-x64.zip'))
    archive=obtain(spec);out=ROOT/'dist'/platform
    if out.exists():shutil.rmtree(out)
    out.mkdir(parents=True)
    if platform=='macos':
        runtime=ROOT/'.build/runtime-macos'
        if not (runtime/'Electron.app').exists():extract(archive,runtime)
        app=out/'GroupPulse.app';subprocess.run(['/usr/bin/ditto',str(runtime/'Electron.app'),str(app)],check=True)
        resources=app/'Contents/Resources';(resources/'default_app.asar').unlink(missing_ok=True)
        executable=app/'Contents/MacOS/GroupPulse';(app/'Contents/MacOS/Electron').rename(executable)
        info=plistlib.loads((app/'Contents/Info.plist').read_bytes());info.update(CFBundleName='GroupPulse',CFBundleDisplayName='GroupPulse',CFBundleIdentifier='app.grouppulse.desktop',CFBundleExecutable='GroupPulse',CFBundleShortVersionString=package['version'],CFBundleVersion=package['version'],NSHumanReadableCopyright='GroupPulse contributors. PolyForm Noncommercial 1.0.0.')
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    else:
        app=out/'GroupPulse';extract(archive,app);resources=app/'resources';(resources/'default_app.asar').unlink(missing_ok=True)
        executable=app/'GroupPulse.exe';(app/'electron.exe').rename(executable)
    target=resources/'app';target.mkdir()
    for folder in ['src','assets','vendor','LICENSES']:
        if (ROOT/folder).exists():shutil.copytree(ROOT/folder,target/folder)
    for file in ['package.json','LICENSE','NOTICE.md']:
        if (ROOT/file).exists():shutil.copy2(ROOT/file,target/file)
    native=target/'native';native.mkdir()
    shutil.copy2(codec,native/codec.name)
    shutil.copy2(ROOT/'.build/codec-bin/configure-flags.txt',native/'ffmpeg-configure.txt')
    if platform=='macos':
        subprocess.run(['clang','-mmacosx-version-min=12.0','-O2','-dynamiclib',str(ROOT/'native/key_capture.c'),'-o',str(native/'key-capture.dylib')],check=True)
        iconset=ROOT/'.build/grouppulse.iconset';subprocess.run(['/usr/bin/swift',str(ROOT/'native/icon.swift'),str(iconset)],check=True)
        subprocess.run(['/usr/bin/iconutil','-c','icns',str(iconset),'-o',str(resources/'electron.icns')],check=True)
        subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(app)],check=True)
        subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True)
    elif os.name=='nt':
        edit=obtain(next(item for item in specs if item['file']=='rcedit-x64.exe'))
        subprocess.run([str(edit),str(executable),'--set-icon',str(ROOT/'assets/icon.ico'),'--set-version-string','ProductName','GroupPulse','--set-version-string','FileDescription','GroupPulse','--set-file-version',package['version'],'--set-product-version',package['version']],check=True)
    for folder in ['docs','LICENSES','assets']:
        if (ROOT/folder).exists():shutil.copytree(ROOT/folder,out/folder)
    for file in ['README.md','LICENSE','NOTICE.md']:
        if (ROOT/file).exists():shutil.copy2(ROOT/file,out/file)
    shutil.copy2(ROOT/'.build/downloads/ffmpeg-8.1.3.tar.xz',out/'ffmpeg-8.1.3.tar.xz')
    report={'product':'GroupPulse','version':package['version'],'platform':platform,'independent':True,'macOSDeploymentTarget':'12.0' if platform=='macos' else None,'runtime':spec,'productionNpmDependencies':0,'separateCodec':'FFmpeg 8.1.3, LGPL-2.1-or-later, official unmodified source included; configure flags in app/native','bundledOptionalCodec':'silk-wasm@3.7.1, npm integrity verified','files':{str(file.relative_to(target)):hashlib.sha256(file.read_bytes()).hexdigest() for file in target.rglob('*') if file.is_file()}}
    (out/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(str(executable))
    return out

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--platform',choices=['macos','windows'],required=True);args=parser.parse_args();build(args.platform)
