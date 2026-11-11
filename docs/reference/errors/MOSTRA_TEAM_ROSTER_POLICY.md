---
code: MOSTRA_TEAM_ROSTER_POLICY
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TEAM_ROSTER_POLICY

This artifact's policy can't wait for every respondent. Severity: error. Phase: host.

## What it means

`submitted:all` waits until every expected respondent has submitted, and `submitted:<N>` for N submissions. Both need a policy that takes a submission from each person: `once` with scope `per-viewer`, or `epochs`. Under `once` per-artifact the artifact takes one submission in all, so neither can be met beyond the first, and Mostra refuses the wait instead of letting it run forever.

## How to fix it

Publish again with `mostra publish <path> --policy once-per-viewer` (or `--policy epochs`), or wait for `submitted`.

## Hint

Publish with the submission policy once per-viewer or epochs, then wait again; or wait for submitted.
