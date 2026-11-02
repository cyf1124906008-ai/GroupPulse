# GroupPulse 2.0.0 validation

Validation is performed on the independent application, not on a renamed previous executable.

- Backend: authenticated SQLCipher pages, committed WAL merge, live SQLite WAL backup, independent shard identities, large message IDs, compressed text, source context, intent rules, quote units, filtered statistics, full exports, media decoding, byte ranges and model request cancellation boundaries.
- Native macOS / Windows: built executable, sandboxed preload, explicit searches and highlights, long hit previews, language switch with filter retention, original sender/context, Moments/contacts, matching/quotes, export/bookmarks/sync, canceled AI and app lock. Windows additionally exercises CurrentUser DPAPI with a Unicode filename.
- All screenshots and CI native tests use synthetic fixtures. No real API is charged; native tests record keychain and network call counters. No account databases or credentials are uploaded to CI.
- A local readonly compatibility check was also performed on an existing database snapshot. That check is local evidence, not a guarantee for other WeChat versions, and no real conversations or identities are included in the repository.

Each release attaches `native-test.json` results for its platform and source/runtime hashes in `build-report.json`. Read the attached reports for the exact runner runtime and checks that passed. macOS packages target Apple Silicon; Windows packages target x64. Real Windows WeChat login/key acquisition is not validated by the synthetic DPAPI test.

Known limits: unsaved/deleted content cannot be restored; expired remote media may fail; WXGF is a first-frame preview; local image parameters and encrypted database formats can change; ad-hoc/unsigned packages may need manual OS confirmation. Large imports and all-pair exports need extra time and disk space.
