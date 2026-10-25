---
"@mostra/runtime": patch
---

When an artifact's server code keeps crashing and its worker is parked, every live source of that version now says so (`MOSTRA_RUNTIME_WORKER_PARKED`). Before, a source whose producer was still starting at the last crash showed a generic failure, or nothing at all, and its page waited without a word (#42).
