# Independent application and build

GroupPulse 2.x has its own Electron main process, sandboxed preload bridge, HTML/CSS/JavaScript interface, Node SQLite data model and background workers. No application ASAR, database worker, proprietary organizer implementation or previous repository history is a build input.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/main.cjs`, `preload.cjs` | Native dialogs, strict IPC, system key storage, app lock, worker orchestration, local media protocol. |
| `src/core/import.cjs`, `snapshot.cjs` | Readonly SQLite backup including WAL, authenticated SQLCipher-format snapshots, complete cross-shard index, atomic generations. |
| `src/core/store.cjs` | Bound-parameter queries, exact source identity, statistics, keywords and evidence. |
| `src/core/market.cjs`, `prices.cjs` | Independently implemented intent rules, deduplication, product candidates and quote units. |
| `src/core/media*.cjs`, `isaac.cjs` | Path-safe cached media, DAT decoding, remote host allowlist, independent uint64 stream implementation, SILK/WAV and range streaming. |
| `src/core/model.cjs`, `export.cjs` | Explicit model requests with bounded evidence; full filtered CSV/JSON/HTML export. |
| `src/ui` | Original interface; no React, browser server, third-party product front end or remote script. |
| `native` | Original macOS key initialization helper and icon generation. |
| `vendor/silk-wasm` | Verified independent npm codec, preserved MIT and SDK notices. |
| `scripts`, `tests` | Pinned official runtime inputs, separate LGPL codec build, synthetic fixtures and native platform tests. |

## Build

Use Node 24.17+ (24.x) and Python 3.9+. On macOS use Apple Silicon and Xcode Command Line Tools. `python3 scripts/build.py --platform macos` builds the separate minimal FFmpeg first, then verifies and assembles the official Electron runtime. It applies a local ad-hoc signature, not a Developer ID or notarization.

On Windows use an MSYS2 MINGW64 shell with `make`, `mingw-w64-x86_64-gcc` and `mingw-w64-x86_64-zlib`, plus Node/Python on PATH:

```sh
bash scripts/build-codec.sh windows
python scripts/build.py --platform windows
python scripts/run-native-tests.py --platform windows
python scripts/package.py --platform windows
```

The workflow `.github/workflows/build.yml` runs both operating systems. Runtime/archive checksums are pinned in `runtime-inputs.json`; no private runtime repository or user profile is required. Minimal FFmpeg is built from the unmodified official archive; GPL and nonfree features, network protocols and unused codecs are disabled. The archive and exact configuration are included for independent rebuilding under FFmpeg's own license.

## Demo and verification

`node scripts/fixture.cjs` creates `.build/demo` with fabricated conversations, accounts and prices. After building, launch the executable with `--user-data-dir=<absolute .build/demo/profile path> --demo`. Demo mode refuses unmarked profiles and cannot save system credentials.

`node --test tests/*.test.cjs` runs backend tests. `scripts/run-native-tests.py` launches the actual built app in a separate synthetic profile. Test-only UI control is enabled only with `GROUPPULSE_CI=1 --native-test` and a synthetic marker; it never targets a user's normal application session.

Do not commit `.build`, `dist`, SQLite files, profiles, decrypted records, `.keyinfo`, API keys or private screenshots. `scripts/audit.py` checks the source allowlist, vendor digests and obvious secrets. Reports cover the tested fixtures and platforms; they do not imply all WeChat versions or account layouts work.

## Data and performance boundaries

The first import builds a complete index in a worker. Memory and disk usage depend on local history size; old/current generations are retained for recovery. Subsequent source changes rebuild a consistent generation; this favors correctness over minimal incremental work. Existing data remains queryable after failed or canceled imports.

Source tables are mapped per message shard; uint64-like identifiers are retained as strings. Sender IDs are not inferred from display names. Unmapped tables and missing identities are preserved visibly. Referenced messages are retained as raw XML but excluded from attributing quoted prices or offers to the current speaker.

Keyword statistics are local word segmentation, not a semantic model. Listing pairs are candidates based on shared product/text evidence, not guaranteed matches. The interface displays up to 2,000 pairs; exported matching pairs include the complete filtered set. Very large exports and matching sets require corresponding memory and disk space.

No server login, outgoing chat automation, remote history restoration or continuous server-side monitoring is implemented. Only data retained on this computer can be inspected. Mac key initialization and Windows `.keyinfo` depend on the supported local client/OS formats and may need updates as those formats change.
