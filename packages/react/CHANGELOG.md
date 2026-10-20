# @mostra/react

## 0.1.0

### Minor Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Fixes from WP-08's Claude Opus review (D136). Arguments a page sends can't be registered symbols, async iterables, bigints of more than 10,000 digits or promises that never settle, and are checked before a run is recorded or a worker starts (`checkArgumentFrames`); a typed-array subclass such as `Buffer` crosses as its built-in base. A run whose action returned despite a cancel ends `succeeded` with its result. A page sees only its own viewer's signals from server code, no `host.*` event, `action.*` events only for runs it may see, and `worker.crashed` without its cause. An unknown function answers 404 before anything is recorded. A worker that dies during its start counts as one crash. Results and live values are redacted as values, bytes included; multi-line secrets line by line. A client key joins only a run of its own function. Live producers reconcile without scanning every artifact. Slow readers get coalesced run and live updates, pages render at most once per frame, and `runs/attach` takes `held` so a renewal reads only what is newer (`RunState.logFrom`, `batchFrom`). Migration 7 refuses replacing a run and changing its result batches.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add `useAction` and `useLive` (WP-08): durable action runs with keys, joining, re-attach after a
  reload, progress, log, partial results and cancel; live sources with latest and append modes, and
  `LiveSources` typed from `live.ts`. Server references now call the server (`setServerCallback`);
  the client runtime's entries carry `"use client"`.

- [#20](https://github.com/mostra-dev/mostra/pull/20) [`df3b959`](https://github.com/mostra-dev/mostra/commit/df3b95986eebb913dc4e9a51a87d4fd90db7488e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the client runtime (INTERFACES §2.3): `useField`, `useSubmit`, `useSubmitControl`,
  `useSignal`, `useChoice`, `useViewer` and `useArtifact`, with optimistic saves debounced and
  flushed on blur, `visibilitychange`, `pagehide` and before a submit, an IndexedDB journal that a
  closed tab or an offline page replays in order, per-field conflicts with "keep mine" and "take
  theirs", and convergence across tabs; a Claude-compatible `window.storage` backed by fields;
  `@mostra/react/form`, react-hook-form on Mostra fields; `@mostra/react/router`, which mounts
  `pages/` artifacts with the history their delivery target needs; `mountArtifact`; and
  `MostraError`, whose `code` is the diagnostic code.

- [#10](https://github.com/mostra-dev/mostra/pull/10) [`482b66d`](https://github.com/mostra-dev/mostra/commit/482b66d618a0dcadd0c57124833ddf26032a95ff) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - First release of `@mostra/react`: `defineArtifact`, the typed manifest helper artifacts declare in
  their entry, and `createServerReference`, the client stub Mostra's builder compiles `"use server"`
  exports into.

- [#14](https://github.com/mostra-dev/mostra/pull/14) [`0c51c9d`](https://github.com/mostra-dev/mostra/commit/0c51c9dea894d1dd3772d972c8125a0dad4e7af8) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the artifact end of the shell bridge (SH-04): `connectShell`, `reportReady` and `openLink`,
  which sends the viewer to a URL in a new tab through the shell. Every
  version's generated entry starts it, so a page inside Mostra's shell introduces itself with MCP
  Apps' `ui/initialize` and reports `mostra/ready`, accepting messages only from its shell's exact
  origin.

- [#27](https://github.com/mostra-dev/mostra/pull/27) [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` and publish's gate (WP-09, D138). `artifact/verify` builds and type-checks an artifact's source, renders it headlessly in a sandbox (a scratch ledger with the real interaction, actions, live and gateway code, so nothing of the home is touched), runs a smoke test that calls only server functions checking `dryRun()`, lints field IDs, compares the page with the last passing version (contracts, ARIA and pixels), and returns one `VerifyVerdict` with stable codes, screenshots at DPR 1 with token estimates for Claude, GPT and Gemini, ARIA snapshots and timings; `artifact/progress` reports its stages. `artifact/publish` reuses the verdict cached for the source and environment digests or runs verify, promotes verify's build, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and with `force` records the error codes; a source that didn't build is never published. Versions record `verify: { status, verifyRevision }` (migration 8). New diagnostic areas and codes: `VERIFY`, `TYPE`, `FIELD`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `SMOKE`, `REGRESSION`, `MOSTRA_PUBLISH_VERIFY_FAILED`, `MOSTRA_ENV_BROWSER_MISSING`. The client runtime installs a field probe for the `verify` target, and the shell shows only the frame for it. `@mostra/verify` is the new runner package. The warm set gains `@types/react`, `@types/react-dom` and `@types/node` for the type check.

### Patch Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`5b8ab1f`](https://github.com/mostra-dev/mostra/commit/5b8ab1fb31825286bd48a9767e17927f746c7f82) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useAction` shows the run of its current function and key: a component that changes its key no
  longer shows, cancels or joins the old key's run. `useLive` applies reads and updates of a source
  in the order they arrived, and a late read never takes newer points out of an append window.
- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
