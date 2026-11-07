---
"@mostra/protocol": minor
"@mostra/react": minor
"@mostra/runtime": minor
---

Counts by choice: a manifest's `tally` names a fixed-choice field, and Mostra counts each accepted submission's choice in the submit transaction and pushes the counts to viewers under `useLive("$tally/<field>")`, with no server code. A value outside the listed choices counts nothing, and below `minTotal` viewers see only the total. The manifest also takes `hosted`, the settings a remote server reads. A page that long-polls (behind a quick tunnel) now hears of an action's end at once, instead of up to 20 seconds later, because the shell's own poll of the same view no longer takes the page's run updates (#119).
