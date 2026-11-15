---
code: MOSTRA_PLUGIN_PLATFORM_UNSUPPORTED
severity: warning
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_PLATFORM_UNSUPPORTED

Plugin doesn't name this system. Severity: warning. Phase: platform.

## What it means

The plugin's manifest lists the systems it runs on (`platforms`), and this one isn't among them. Mostra installs it anyway (it adds no capability limits), and says so, since its exporters, checks, connectors or commands may fail here.

## How to fix it

Use the plugin on a system it lists, or ask its author to support this one.

## Hint

Expect the plugin's Node.js parts to fail here, or use a plugin that supports this system.
