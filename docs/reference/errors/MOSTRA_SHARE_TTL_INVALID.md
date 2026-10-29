---
code: MOSTRA_SHARE_TTL_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_TTL_INVALID

Share lifetime refused. Severity: error. Phase: host.

## What it means

A public share (Funnel or Cloudflare) admits anyone holding its link, so it lasts 1 hour unless `ttl` says otherwise, and at most 7 days. Tailnet shares have no limit.

## How to fix it

Use a `ttl` of 7 days or less, and share again when it ends, or share inside the tailnet.

## Hint

Give a public share a lifetime of at most 7 days, such as `--ttl 24h`.
