# @mostra/shell

## 0.5.0

### Patch Changes

- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f)]:
  - @mostra/protocol@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0

## 0.2.0

### Minor Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`8772efe`](https://github.com/mostra-dev/mostra/commit/8772efeaf48e77765e6c3953c213704dd35c8de5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Hosts can name the people who open their links (D143): a host that registers the `identity` port is asked who a browser is when it exchanges a link minted without a viewer, and the session acts as that person (a viewer of kind `host`). `null` keeps the home's local user; a host that took identity over and can't answer refuses the link with `MOSTRA_HOST_IDENTITY_UNAVAILABLE`. The SDK serves it as `ports.identity.resolve`. The shell explains that refusal to the viewer.

### Patch Changes

- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b)]:
  - @mostra/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#29](https://github.com/mostra-dev/mostra/pull/29) [`ffc9ba5`](https://github.com/mostra-dev/mostra/commit/ffc9ba512599c25636faf88c182ee208c0780394) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Serve the CLI's methods (D140): `view/default`, one-time launch tickets (`view/launch`, exchanged
  by the shell from `#l=`), `instance/check`, and `gc/run`, which keeps every version a submission,
  view, run, session, live value, review set, field, live pinned link, baseline or follow names, and
  collects the rest as tombstones (`version_collected`, migration 9) along with unused snapshots, lock
  layouts, store packages and verify caches, serialized with publish, verify and installs. A home
  that a host spawned or configured is marked `hostConfigured` in `config.json`.
  
  Serve `mostra dev` (`dev/start`, `dev/stop`, `dev/notify`, D140 item 12): a development preview of
  unpublished source in its own sandbox, with Vite's hot updates through the gateway's checks, server
  code that runs for real and restarts when it changes, and submissions reported to the session and
  delivered nowhere. The shell marks it "Development preview, not published".

- [#14](https://github.com/mostra-dev/mostra/pull/14) [`518f468`](https://github.com/mostra-dev/mostra/commit/518f4684f43773969e8fb99fd8577d9af7e854fc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - First release of the shell: the trusted page a capability link opens. It exchanges the link's
  token for a session, removes the token from the address bar and shows the artifact in a frame on
  its own origin, over the validated bridge. The frame can't replace the shell page, and opening a
  second link for an artifact asks before it replaces the session.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`0a44d8b`](https://github.com/mostra-dev/mostra/commit/0a44d8b7a39107c31f17cf8a71661166c03c95de) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Say when a view's server code keeps crashing and is parked (WP-08), from the frame ticket and the
  `worker.crashed` event, until the next publish.

- [#20](https://github.com/mostra-dev/mostra/pull/20) [`df3b959`](https://github.com/mostra-dev/mostra/commit/df3b95986eebb913dc4e9a51a87d4fd90db7488e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the trusted controls and what surrounds them: the rail with the save state, the trusted zone
  with Submit and Choose (relabelled by the artifact, never rendered or clicked by it), required
  answers listed before a submit, the receipt with Mostra's record and each host's delivery
  (Submitted, Delivered, Pending delivery, Undeliverable), the version banner with the count of
  answers that wouldn't carry over, "Always follow this artifact", and the read-only "Not carried
  over" panel.

- [#27](https://github.com/mostra-dev/mostra/pull/27) [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` and publish's gate (WP-09, D138). `artifact/verify` builds and type-checks an artifact's source, renders it headlessly in a sandbox (a scratch ledger with the real interaction, actions, live and gateway code, so nothing of the home is touched), runs a smoke test that calls only server functions checking `dryRun()`, lints field IDs, compares the page with the last passing version (contracts, ARIA and pixels), and returns one `VerifyVerdict` with stable codes, screenshots at DPR 1 with token estimates for Claude, GPT and Gemini, ARIA snapshots and timings; `artifact/progress` reports its stages. `artifact/publish` reuses the verdict cached for the source and environment digests or runs verify, promotes verify's build, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and with `force` records the error codes; a source that didn't build is never published. Versions record `verify: { status, verifyRevision }` (migration 8). New diagnostic areas and codes: `VERIFY`, `TYPE`, `FIELD`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `SMOKE`, `REGRESSION`, `MOSTRA_PUBLISH_VERIFY_FAILED`, `MOSTRA_ENV_BROWSER_MISSING`. The client runtime installs a field probe for the `verify` target, and the shell shows only the frame for it. `@mostra/verify` is the new runner package. The warm set gains `@types/react`, `@types/react-dom` and `@types/node` for the type check.

### Patch Changes

- [#21](https://github.com/mostra-dev/mostra/pull/21) [`8ceb2a5`](https://github.com/mostra-dev/mostra/commit/8ceb2a5c4c93606ae4bcc067259f8c342f1236c9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A control request from the page no longer overwrites a newer state the shell's stream brought:
  the draft's revision, the "Not carried over" panel and delivery states stay current.
- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
