# Security and private data

Please do not attach databases, `.keyinfo` files, decrypted snapshots, model API keys or unredacted chat screenshots to public issues. A useful report contains the GroupPulse version, operating system, operation, exact non-sensitive error code and a synthetic reproduction where possible.

Records are local unless you explicitly confirm an AI request or enable limited remote media download. Model requests contain bounded excerpts, conversation names, sender display names and timestamps. The third-party model provider's policies and prices apply.

App lock is an interface lock. Plaintext snapshots, indexes, exports and media caches are stored on disk; use OS disk encryption and protect your backups. API/database keys saved by this app use OS protected storage. No keys are included in the public source or releases.

The macOS local initialization helper is used only after explicit confirmation, on a temporary copy, to obtain the chosen account's database key; it is not activated at startup. Use only accounts and records you are authorized to access.
