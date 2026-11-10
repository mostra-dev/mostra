---
"@mostra/verify": patch
"@mostra/runtime": patch
"@mostra/cli": patch
---

Verify recovers from a browser or runner that failed under it (#106): a warm runner launches its browser again when the one it held died, a runner that failed in itself is replaced and the page rendered again on a fresh one, and `MOSTRA_VERIFY_CRASHED` says what the runner reported. Before, one browser lost (a disk that dropped out was the sighting) failed every later verify of that runner within a second.
