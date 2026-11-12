---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/react": minor
"@mostra/cli": minor
"@mostra/mcp": minor
"@mostra/conformance": minor
---

Teams (WP-31): expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, `results/list` for every submission, `useRespondents()` and `usePresence()` with opt-in cursor and selection sharing that is never stored, attribution of shared fields (who, by key, and when), and the manifest's `team.visibility` (`private` unless the artifact opts in). `mostra roster get|add|remove`, `mostra results --all`, `mostra share --cloud --respondent`, and `artifact_wait`'s team conditions. On a remote server, a hosted artifact's roster lives on its hosted home, `roster.completed` reaches the operator's events, and the operator's `invitations` port hands over each personal link to mail (no mailer ships). The conformance kit adds the scenarios `team.roster` and `team.waits`.
