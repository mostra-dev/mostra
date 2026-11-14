---
code: MOSTRA_PLUGIN_SHADOWED
severity: warning
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_SHADOWED

Plugin contribution shadowed. Severity: warning. Phase: contract.

## What it means

An artifact's plugin and one of the home's (`--global`) contribute the same exporter or CLI command. Nothing is refused: in this artifact its own plugin's contribution is used, and the home's everywhere else. A home install never breaks an artifact that worked.

## How to fix it

Nothing is needed when the artifact's own contribution is the one it should use. Otherwise remove it from the artifact (`mostra plugin remove <package> --artifact <path>`), and the home's is used.

## Hint

Remove one of the two plugins if the artifact should use the other's contribution.
