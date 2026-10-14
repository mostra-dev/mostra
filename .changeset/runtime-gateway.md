---
"@mostra/runtime": minor
---

Add the gateway (WP-05): every instance serves the shell and each opened artifact on stably leased
loopback ports, turns capability links into origin-bound `HttpOnly; SameSite=Strict` sessions with
single-use frame tickets, checks every request's Host, Origin, CSRF token, content type and scope,
and serves published versions straight from disk with no process. `view/url`, `view/rotate` and
`view/revoke` mint, replace and end capability links; every publish receipt carries the artifact's
default link; `instance/status` reports where the gateway listens. `mostra-runtime host|daemon`
take `--bind` and `--url-host` for a wider bind. Every mutating method now refuses a `requestId`
reused with other parameters (`MOSTRA_HOST_REQUEST_ID_REUSED`) instead of replaying another
request's result.
