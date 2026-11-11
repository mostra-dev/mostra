---
code: MOSTRA_TEAM_ROSTER_TOO_LARGE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TEAM_ROSTER_TOO_LARGE

Roster larger than 1,000 respondents. Severity: error. Phase: host.

## What it means

A roster lists the people an artifact expects answers from, each with a personal link and a status. It holds at most 1,000 of them. Nothing was added: the roster is as it was.

## How to fix it

Remove respondents you no longer expect (`mostra roster remove`), or, for a page many people answer, share one link and wait for `submitted:<N>` instead.

## Hint

Name at most 1,000 expected respondents; share one link for everyone else instead.
