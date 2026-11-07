---
"@mostra/react": minor
"@mostra/runtime": patch
---

`useLive` reports `ownerOffline: true` on a hosted page while the page's owner is offline, so its producer can't refresh the value: `data` stays the last value, from `at`. The Skill's sharing reference covers the `hosted` manifest key and what `waiting` and `unknown` runs mean.

A publish made after the owner's link had nothing left to push now reaches its servers: the push queue's drain no longer stays registered once it ended before its first await. A share to two servers hosts the artifact on both, and their answers reach the owner with their own origin.
