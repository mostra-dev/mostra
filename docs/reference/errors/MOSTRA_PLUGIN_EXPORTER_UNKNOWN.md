---
code: MOSTRA_PLUGIN_EXPORTER_UNKNOWN
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_EXPORTER_UNKNOWN

No such exporter. Severity: error. Phase: host.

## What it means

`mostra export <artifact> --as <id> --out <path>` names an exporter that neither Mostra builds in nor any plugin of the artifact or the home contributes. The message lists every exporter available for the artifact.

## How to fix it

Pick an exporter from the list, or install a plugin that contributes it: `mostra plugin add <package> --artifact <path>`.

## Hint

Use one of the exporters the message lists, or add a plugin that contributes this one.
