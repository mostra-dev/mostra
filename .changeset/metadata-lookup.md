---
"@mostra/runtime": patch
"@mostra/shell": patch
---

A Client ID Metadata Document is fetched again: the fetch's own DNS lookup answered Node.js with one address when it asked for all of them (its happy-eyeballs connect), so every document failed with "Invalid IP address: undefined" (found by claude.ai's connector). The hosted shell tells the viewer when it couldn't store its session, and that a reload will need the link again.
