---
code: MOSTRA_HYGIENE_REQUEST_MALFORMED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_REQUEST_MALFORMED

Malformed request. Severity: error. Phase: hygiene.

## What it means

The gateway refused a request it can't interpret safely: a repeated `Host` or `Origin` header, a request target that isn't a path, an encoded `/` or `..` that would leave the served tree, a body that isn't valid JSON, or a header with control characters. It answers 400 rather than guess.

## How to fix it

Send a single request with one `Host` header and a plain path. Browsers always do; this usually means a hand-written client or a probe.

## Hint

Send one well-formed HTTP request with a path that starts with `/`.
