---
code: MOSTRA_TYPE_ERROR
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TYPE_ERROR

Type error. Severity: error. Phase: compile.

## What it means

TypeScript's checker (`tsc --noEmit`, TypeScript 7) found an error in the artifact's code. Verify checks with the artifact's own `tsconfig.json` when it has one, else in strict mode without the unused-variable rules, and resolves imports exactly as the build does. MDX isn't checked.

## How to fix it

Open the file at the reported line and fix the code, for example a missing property, a wrong argument type or a misspelled import.

## Hint

Fix the type error at the reported location; the message carries TypeScript's code and text.
