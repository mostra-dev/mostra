---
code: MOSTRA_REMOTE_NOT_OWNER_INSTANCE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_NOT_OWNER_INSTANCE

Another instance owns this hosted artifact. Severity: error. Phase: host.

## What it means

A hosted artifact has one owner instance: the one that shared it. It alone receives the artifact's submissions, relayed runs and authoring, and only it pushes versions of it (D165 item 1b). Another instance of the same account reads and waits through the hosted home.

## How to fix it

Run the command on the instance the message names. Moving an artifact to another owner instance isn't part of this release.

## Hint

Share or push this artifact from its owner instance, named in the message.
