---
code: MOSTRA_ENV_PORT_TAKEN
severity: warning
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_PORT_TAKEN

Leased port taken. Severity: warning. Phase: host.

## What it means

The shell's port or an artifact's port is leased per home and reused across restarts, so links keep working (D62, D99). At start-up another program held the leased port, so Mostra leased a new one. Links that named the old port stop working; the shell's port changing affects every link of the home.

## How to fix it

Mint new links with `view/url` (the publish receipt of the next publish carries the new default link too). Stop the program that took the port if you want the old links back; `mostra doctor` names it where it can.

## Hint

Open the artifact through a new link: `view/url` or `mostra open` mints one on the new port.
