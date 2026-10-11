---
code: MOSTRA_HOST_PORT_UNSUPPORTED
severity: warning
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_PORT_UNSUPPORTED

Port not supported by this instance. Severity: warning. Phase: host.

## What it means

The client registered a port this instance doesn't call, so registering it has no effect. The port may be reserved for a later release (such as `ai`), or the client may be newer than the instance. The session continues without the port, and Mostra uses its standalone behavior instead.

## How to fix it

Register only the ports listed in `capabilities.ports` of the `mostra/initialize` result. If the host needs the port, upgrade the instance to a release that supports it.

## Hint

Leave the port out of `mostra/initialize`, or run a Mostra release that lists it in `capabilities.ports`.
