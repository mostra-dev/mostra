---
code: MOSTRA_DEP_INSTALL_FAILED
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_INSTALL_FAILED

Package install failed. Severity: error. Phase: compile.

## What it means

The package installer failed for a reason other than a missing package or the network: most often a package's lifecycle script (`preinstall`, `install`, `postinstall`) exited with an error, or a downloaded package didn't match its integrity hash. Lifecycle scripts run in an install child in the artifact's directory with the artifact's environment. The message carries the end of the installer's output.

## How to fix it

Fix what the output names. For a failing install script, check what it needs (a compiler, a system library) or use another version of the package.

## Hint

Read the installer's output in the message, then fix the package spec or choose another version.
