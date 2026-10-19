---
"@mostra/sdk": minor
---

The first release of the SDK (HO-04): `createMostra({ home, ports })` spawns a JavaScript host's own Mostra instance on a verified runtime bundle and serves its `submissions`, `drafts`, `secrets` and `trustedControls` ports, with `publish`, `verify`, `wait`, `results`, `getState`, `patchState`, `pushLive`, `viewUrl`, an `events` stream with flow control and named resumption, and `call` for any other host protocol method. It also holds the bundle manager the CLI and `create-mostra` use: the pinned bundle downloaded through the environment's proxy, checked against its SHA-256, extracted and checked file by file, cached by digest and set up (`mostra-setup`).
