---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/shell": minor
"@mostra/react": minor
---

An operator's `policy.link` may ask for `performance: { report: true }` (#167): each hosted page then sends one report of how long it took to be ready and how many errors it raised, which the server counts as `page.loads` and `page.errors` for the `metering` port and keeps nowhere. A page's `mostra/ready` carries its error count.
