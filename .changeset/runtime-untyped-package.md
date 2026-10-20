---
"@mostra/runtime": patch
---

`verify` no longer fails an artifact that imports an npm package without type declarations: TypeScript's TS7016 alone made the type check exit 1, which verify read as a check that never ran (`MOSTRA_TYPE_ERROR`) beside the intended `MOSTRA_TYPE_UNTYPED_PACKAGE` warning (D138 item 8). Any error TypeScript printed now explains its exit, whatever severity Mostra gives it.
