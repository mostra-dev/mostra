# @mostra/shell

The trusted page a Mostra link opens. It runs on its own origin, exchanges the link's capability
token for a session, removes the token from the address bar, and shows the artifact in a frame on
the artifact's own origin, talking to it over the validated bridge (`@mostra/protocol`).

The package ships built files only (`dist/`), which the runtime's gateway serves at
`/_mostra/shell/`; there is nothing to import. Build it with `pnpm --filter @mostra/shell build`.
It carries the version banner and the trusted controls; the review overlay joins it in a later
release.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
