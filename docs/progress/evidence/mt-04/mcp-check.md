# MT-04: the walkthrough's chat-app way, through the released `mostra mcp` (0.15.1, stdio, clean home), 2026-11-16

- tools: artifact_create, artifact_write, artifact_patch, artifact_verify, artifact_publish, artifact_open, artifact_wait, artifact_results, artifact_list, live_push, state_get, state_patch, docs_search
- artifact_create "Team lunch: pick a day" -> art_01M7HX7EVBZS0QVZ41SYPRG99F; artifact_write index.tsx (once per-viewer, team names, usePresence, useRespondents); artifact_verify -> pass; artifact_publish -> ok
- artifact_open with viewer {ref: ada@example.com, name: Ada Lovelace} and with {ref: sam@example.com, name: Sam Okafor} -> two links (url, tokenId, scopes, viewer)
- artifact_wait until submitted, before any answer (2 s) -> {"status":"still_waiting","cursor":"25"}
- each person's page: "Here now: <the other>." and "0 of 0 answered" (no roster through the tools)
- artifact_wait until submitted -> satisfied, submission.created, cursor 30, payload.submissionId sub_01M7HX8FNV5H6XA1XZ23RXRTQC
- artifact_wait until submitted after 30 -> satisfied, cursor 33, payload.submissionId sub_01M7HX8H78FZ0GDEGDCB01E4JD
- artifact_wait until submitted after 33 (2 s) -> {"status":"still_waiting","cursor":"35"}
- artifact_results with each submissionId -> Ada Lovelace: Day "Wednesday"; Sam Okafor: Day "Thursday"
- artifact_wait until submitted:all with no roster (2 s) -> still_waiting (an empty roster never completes; #183)
- live_push key today -> {"revision":"1"}
