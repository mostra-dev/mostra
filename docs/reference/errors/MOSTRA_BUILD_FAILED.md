---
code: MOSTRA_BUILD_FAILED
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_BUILD_FAILED

Build failed. Severity: error. Phase: compile.

## What it means

The builder couldn't bundle the artifact: a syntax error, an invalid JSX or MDX construct, a CSS error or another bundler error. The message carries the bundler's own explanation, and the location points at the file, line and column when the bundler reports one. Nothing was published.

## How to fix it

Open the reported file at the reported line and fix the code there. For MDX, check that JSX in the document is closed and that `{` and `<` in prose are escaped. Run `mostra verify` to see the same error with the type checker's findings.

## Hint

Fix the error at the reported location, then publish again.
