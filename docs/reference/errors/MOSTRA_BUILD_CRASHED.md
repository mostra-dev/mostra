---
code: MOSTRA_BUILD_CRASHED
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_BUILD_CRASHED

Builder crashed. Severity: error. Phase: compile.

## What it means

The builder child process exited before it finished, for example after running out of memory or on a signal. The supervisor and everything else in the instance keep working, and nothing was published. The message carries the builder's last lines of error output.

## How to fix it

Run the publish again, which starts a fresh builder. A crash that repeats points at the artifact's size or at a defect in Mostra: very large inline data is better kept in `public/` or loaded through a live source.

## Hint

Publish again; if it crashes again, report the builder's last output from the message.
