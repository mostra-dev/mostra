---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/react": minor
"@mostra/cli": minor
---

Pausing, and the remote server's operator boundary (WP-30, RM-09, HO-09):

- `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (`artifact/pause`): a paused artifact stays viewable and its links keep working, while submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`, keeping the draft. On an owner instance the pause also goes to every server the artifact is hosted on; a pause the server's operator made is lifted only by the operator (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
- `mostra-runtime server` loads an operator module (`operator` in its configuration) and calls its ports with their time limits and no-op defaults: `limits` (shares, pushes and links fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE` when it doesn't answer, while views and answers proceed), `metering` and `events` (at least once, with stable IDs, across restarts), `abuse` (the shell's report control and the after-push hook), `policy` (interstitial, footer, after-submit line, link lifetimes), `routing` (hosts and link hosts an operator supplies, recorded for one home forever) and the server handle (quarantine, pause, suspension, link revocation, moving and restoring homes, removal), each acting on one hosted route or home only.
- Hosted links minted without a viewer act as one anonymous viewer per browser; per-IP and per-link submission rates (`rateLimits`) answer 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`; `X-Forwarded-For` is believed only from `trustedProxies`, read from the right, and IPv6 counts per /64.
- `FrameTicket` gains `paused` and `hosted` (the trusted chrome's facts), `Viewer` and `useViewer()` gain `verified`, and nine diagnostics join the catalog.
