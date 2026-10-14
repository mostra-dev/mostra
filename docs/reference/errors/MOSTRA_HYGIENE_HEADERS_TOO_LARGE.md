---
code: MOSTRA_HYGIENE_HEADERS_TOO_LARGE
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_HEADERS_TOO_LARGE

The request's headers are too large. Severity: error. Phase: hygiene.

## What it means

The request's headers passed the gateway's limit of 1 MiB, more than any browser sends for one host's cookies. Every port of the loopback host shares one cookie jar, so a page on any of them can fill it. The gateway answers 431 with `Clear-Site-Data: "cookies"`, which empties the host's cookies, so the next request works. Mostra's sessions go with them and come back when a link is opened again.

## How to fix it

Open the artifact's link again. If it keeps happening, find the page that sets the cookies: it runs on this host.

## Hint

Open the link again: this page cleared the cookies that made the request too large.
