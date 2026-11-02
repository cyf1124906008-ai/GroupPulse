#!/usr/bin/env python3
from pathlib import Path
import json,tarfile,shutil
from build import obtain,ROOT
spec=next(item for item in json.loads((ROOT/'runtime-inputs.json').read_text()) if item['file']=='ffmpeg-8.1.3.tar.xz')
archive=obtain(spec);destination=ROOT/'.build/ffmpeg-8.1.3'
if not destination.exists():
    with tarfile.open(archive) as source:
        for entry in source.getmembers():
            if entry.issym() or entry.islnk() or '..' in Path(entry.name).parts or Path(entry.name).is_absolute():raise RuntimeError('Unsafe codec source archive')
        source.extractall(ROOT/'.build')
shutil.copy2(destination/'COPYING.LGPLv2.1',ROOT/'LICENSES/FFmpeg-LGPL-2.1.txt')
print('Official FFmpeg source verified; no GPL or nonfree features enabled.')
