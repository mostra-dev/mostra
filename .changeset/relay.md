---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/react": minor
"@mostra/cli": patch
---

The relay: a hosted page's action runs and plain calls run on the artifact's owner instance, with its own secrets, over its binding (`port/relay.run`, `cancel`, `reconcile`, `call`; `relay/run.update`, `relay/call.batch`). While the owner is offline a run waits (`RunStatus` gains `waiting` in use and `unknown`), as the manifest's `hosted.offline` says: `queue` (up to its limit, then `failed` with reason `owner-offline`) or `fail` (at once), in a queue capped per artifact (`MOSTRA_REMOTE_QUEUE_FULL`) that drains in order at a bounded rate when the owner returns. A run the owner never reported within the limit is `unknown`, and its reported end replaces it once; after every reconnect the owner's accepted runs are reconciled before anything drains, and an owner restored to before runs it accepted makes them `unknown`. `RunState.ownerUnreachable` marks a running run whose owner is out of reach. By default only a signed-in viewer or a link minted for a named person may trigger a relayed action (`hosted.actions`, `MOSTRA_REMOTE_SIGN_IN_REQUIRED`). Hosted pages read their tallies. In `@mostra/react`, `run()` rejects for an `unknown` run, which keeps following for its owner's report.

Server code's signals, host events and shared state in a relayed run act on the hosted home (`relay/effect`; `state/patch`'s `causation`), and so do the owner's own `state/*` and `live/push` of a hosted artifact. A hosted page's live sources run on its owner while someone views (`port/relay.live`, `relay/live.value`), redacted before they leave; `LiveState.ownerOffline` marks a value its producer can't refresh while the owner is away.

A server's `rateLimits.perLink.relayedRuns` limits each link's relayed actions: past it a page gets 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`, before anything is recorded or relayed.

A relayed run its owner refuses before recording it ends `failed` with reason `owner-refused`; one the connected owner never answered is sent again, which joins the owner's record if it has one.

After its review: a hosted push's listing paths are checked for every system the server runs on; a binding with ports must name its own instance link; the newest session of a link is its own, and a failed reconcile is tried again; a run never ends without the output the relay lost; an expired waiting run is never sent; an `unknown` run is reconciled until the owner's end replaces it; a cancel pressed during an acknowledgement reaches the owner; followed pages and lost submissions survive a reconnect; a restore is told once; a refused push no longer blocks later ones; live values reach every server hosting an artifact.
