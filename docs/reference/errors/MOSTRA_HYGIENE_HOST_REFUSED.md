---
code: MOSTRA_HYGIENE_HOST_REFUSED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_HOST_REFUSED

Host not served. Severity: error. Phase: hygiene.

## What it means

The request's `Host` header named a host this gateway doesn't serve. Each gateway listener accepts exactly the host and port its capability URLs use, so a page that rebinds its own DNS name to the loopback address can't reach an artifact (DNS rebinding). The gateway answers 421.

## How to fix it

Use the URL from `view/url` or the publish receipt as it is, without replacing `127.0.0.1` by `localhost` or another name. A gateway started with `--bind` and `--url-host` accepts the URL host it was given.

## Hint

Open the artifact through the exact link Mostra gave you.
