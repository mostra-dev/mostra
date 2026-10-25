---
"@mostra/cli": patch
---

`mostra verify`, `mostra doctor` and `mostra wait` treat a status they don't know, which a newer Mostra may send, as a failure: `verify` exits 0 only on a passing verdict, `doctor` fails on any check that isn't `ok` or `warning`, and `wait` ends with exit 1 instead of waiting again. A telemetry probe file Windows briefly holds no longer interrupts a command.
