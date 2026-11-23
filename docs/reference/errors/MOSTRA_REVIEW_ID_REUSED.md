---
code: MOSTRA_REVIEW_ID_REUSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REVIEW_ID_REUSED

Thread or comment ID used twice. Severity: error. Phase: host.

## What it means

A thread or comment ID was sent again with other contents. IDs make retries safe: the same ID with the same contents answers the first result.

## How to fix it

Create a fresh `thr_` or `cmt_` ID for each new thread or comment.

## Hint

Make a new ID for a new thread or comment; repeat an ID only to retry the same one.
