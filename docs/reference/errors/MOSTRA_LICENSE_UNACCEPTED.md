---
code: MOSTRA_LICENSE_UNACCEPTED
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LICENSE_UNACCEPTED

License needs acknowledgment. Severity: error. Phase: contract.

## What it means

The install brings a license that isn't OSI-approved and isn't a public-domain dedication or another free license: a source-available or proprietary license, or one Mostra can't read. Such a license is accepted once per artifact (or for the home), by `--accept-license <id>` or by the host's policy, and the lockfile records it (D31). This is disclosure, not a limit: anyone may accept, and nothing was installed or recorded before they do. The message names each license, its class and the packages under it.

## How to fix it

Read the license's terms (the message gives its summary and URL when the plugin declares them), then add the plugin again with `--accept-license <id>` for each ID, as the fix shows.

## Hint

Read the license the message names, then run the command in this diagnostic's fix to accept it.
