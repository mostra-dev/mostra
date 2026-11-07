---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/cli": patch
---

The remote server signs instances in and hosts their versions (WP-29, D165): `mostra-runtime
server` gains the device authorization grant (`/oauth/device`, `/oauth/token`, `/oauth/revoke`,
a device page that says approving links a machine, and a development identity provider for tests
and first runs), with tokens kept only as hashes and refresh tokens that rotate; the network
binding, the host protocol as JSON-RPC over WebSocket at `/host` with a bearer token, one message
per frame up to the line limit, a ping and `mostra/ping` every 20 s and a 45 s silence limit, an
in-band token refresh (`remote/token`) and a close within 60 s of a revoked grant; and
`hosted/push` with version files over HTTPS (`PUT /files/<sha256>`), which stores only the client
files a pending push names as missing, checks the listing against the output digest and never
stores server code. The protocol adds the methods `remote/login`, `remote/login.wait`,
`remote/logout`, `remote/status`, `remote/token` and `hosted/push`, `RemoteLink`, the `acct_`,
`hom_`, `lnk_` and `rte_` IDs, `mostra/initialize`'s `link` and `InstanceInfo`'s `hosted` mode,
`share/start`'s `via: "remote"` and `server`, and the `MOSTRA_REMOTE_*` diagnostics a hosted
artifact's owner and viewers meet.
