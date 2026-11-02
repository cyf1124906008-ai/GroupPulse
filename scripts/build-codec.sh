#!/usr/bin/env bash
# Build a separate LGPL executable from the unmodified official release source.
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v python3 >/dev/null 2>&1; then python3 scripts/prepare-codec.py; else python scripts/prepare-codec.py; fi
task_platform="${1:-macos}"
task_build="$PWD/.build/codec-${task_platform}"
task_source="$PWD/.build/ffmpeg-8.1.3"
mkdir -p "$task_build"
cd "$task_build"
task_flags=(--disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug --disable-x86asm --enable-small --disable-ffprobe --disable-avdevice --enable-avfilter --enable-filter=scale,format --enable-ffmpeg --enable-protocol=pipe --enable-demuxer=hevc --enable-parser=hevc --enable-decoder=hevc --enable-encoder=png --enable-muxer=image2pipe --enable-swscale --enable-zlib)
if [[ "$task_platform" == windows ]]; then
  task_flags+=(--target-os=mingw32 --arch=x86_64 --extra-ldflags=-static)
fi
"$task_source/configure" "${task_flags[@]}"
make -j4 ffmpeg
./ffmpeg -hide_banner -encoders | grep -q png
mkdir -p ../codec-bin
if [[ "$task_platform" == windows ]]; then cp ffmpeg.exe ../codec-bin/ffmpeg.exe; else cp ffmpeg ../codec-bin/ffmpeg; fi
printf '%s\n' "${task_flags[@]}" > ../codec-bin/configure-flags.txt
cp "$task_source/COPYING.LGPLv2.1" ../codec-bin/LICENSE.txt
