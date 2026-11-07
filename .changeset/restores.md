---
"@mostra/runtime": minor
"@mostra/protocol": minor
---

A hosted home restored from a backup rotates its incarnation: after `mostra-runtime server --restored <homeId|all>`, when it opens below the high-water marks the server recorded for it, and when its owner instance reconnects with a committed cursor or relay mark above what it holds. The owner then continues after the restored head, keeps what it imported and records `remote.regressed`; a page whose cursor is past the head reads a fresh snapshot.

An owner instance whose home was restored from a backup reads the hosted submissions it lost again (`hosted/submission`) and imports each once, with its IDs and digest.
