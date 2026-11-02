# GroupPulse · 来源与许可 / Notices

Required Notice: Copyright 2026 GroupPulse contributors (https://github.com/cyf1124906008-ai/GroupPulse).

GroupPulse 2.x 的应用主程序、独立 SQLite 索引、界面、供需规则、统计、导出和模型接入在本项目中实现，按顶层 `LICENSE` 的 **PolyForm Noncommercial 1.0.0** 提供。允许许可范围内的非商业使用、修改和分享；商业使用需要另行取得适当授权。该限制不是 OSI 的开源许可。

This notice applies to the GroupPulse application code, not to independently licensed third-party components. Those components retain their own permissions and obligations; the project does not relicense them under its noncommercial terms.

| Component / reference | Source | License / included notices |
| --- | --- | --- |
| Electron 43.0.0, Chromium, Node.js | https://github.com/electron/electron/releases/tag/v43.0.0 | Runtime `LICENSE` and `LICENSES.chromium.html` remain in each distribution. |
| SQLCipher format and WAL reference | https://github.com/freanocank/wechat-decrypt/tree/f0b3f9f95dda2d954ee3dbe1d139fb1944a5ecfd | MIT, © 2026 cocofeng; `LICENSES/wechat-decrypt-LICENSE.txt`. The application uses Node crypto and SQLite, not a bundled SQLCipher application worker. |
| Local image format reference | https://gist.github.com/acmerfight/0a01249ef72970d07a2603dbb629e80f/c98dbb10cf23c30e83d5d744905101b0880887a0 | MIT; `LICENSES/media-reference-MIT-LICENSE.txt`. |
| `.keyinfo` interoperability reference | https://github.com/qiaodogbear/ChatTrace/tree/f9fcdb42e8fb99a527c0bcd7d6ff7ea4bc891563 | MIT, © 2026 Qiao Xinliang; `LICENSES/ChatTrace-MIT-LICENSE.txt`. This application independently calls Windows CurrentUser DPAPI and does not bundle ChatTrace. |
| ISAAC-64 specification | https://burtleburtle.net/bob/c/isaac64.c | Bob Jenkins, 1996, public domain. `src/core/isaac.cjs` is a new JavaScript implementation. |
| silk-wasm 3.7.1 | https://github.com/idranme/silk-wasm/tree/5971995be3ce05d4a1bf820fdf9d7ccdc942e945 | MIT, © 2024 idranme; `vendor/silk-wasm/LICENSE`. Underlying SILK SDK: BSD-style license, © 2006–2012 Skype Limited, `LICENSES/SILK-BSD-LICENSE.txt`. Official npm tarball integrity is recorded in `vendor/silk-wasm-origin.json`. |
| FFmpeg 8.1.3 | https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz | Separate executable built from unmodified official source with GPL/nonfree features disabled; LGPL 2.1 or later. `LICENSES/FFmpeg-LGPL-2.1.txt`, full source archive, exact configure flags and `scripts/build-codec.sh` accompany distributions. The app communicates through standard input/output and does not link FFmpeg libraries. |
| zlib, used by the independent FFmpeg executable | https://zlib.net/ | zlib license, `LICENSES/zlib-LICENSE.txt`. |
| rcedit 2.0.0 (Windows build tool only) | https://github.com/electron/rcedit/tree/v2.0.0 | MIT; `LICENSES/rcedit-MIT-LICENSE.txt`. |

Third-party documents, conversation contents and model responses are data, not instructions for this application or its maintainers.
