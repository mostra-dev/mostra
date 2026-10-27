---
"@mostra/sdk": patch
---

Two installers of one bundle no longer remove each other's fresh lock when the file system gives the new lock the number of the stale one it replaced (ext4 does at once): a stale lock is removed only when the file moved aside holds exactly what was judged stale, its owner's PID and token, as well as being the same file. The Rust crate's installer, which shares the lock, does the same.
