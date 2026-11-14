# @mostra/shell

## 0.14.0

### Minor Changes

- [#150](https://github.com/mostra-dev/mostra/pull/150) [`e4ff9df`](https://github.com/mostra-dev/mostra/commit/e4ff9df5de992bff2ab9f620ca86402f91a85ef6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The shell's chrome in Studio (D171): Figtree and Jost from `@mostra/themes`, one bar with the page's title and sender, the viewer's choices as buttons (a sheet on a phone), a status beside Submit in shape and colour instead of the seal's sentence, a footer with "Never enter passwords on this page.", Report and the made-with mark, one light-or-dark button, and a button that folds the chrome away to the status and the way back. The report dialog is a native dialog. On a phone Submit sits at the bottom, by the thumb. The shell's own pages (a link that doesn't work, two links) are cards in the same look.

### Patch Changes

- Updated dependencies [[`662f879`](https://github.com/mostra-dev/mostra/commit/662f8798d719446b15f583c3b285ce0fec097b89), [`c909aa3`](https://github.com/mostra-dev/mostra/commit/c909aa323c6db9863e2797807ee792a474e0ee31)]:
  - @mostra/themes@0.14.0
  - @mostra/protocol@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc)]:
  - @mostra/protocol@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c), [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b)]:
  - @mostra/protocol@0.12.0

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The hosted shell's trusted chrome (D161, WP-30): the sender line with the provider that verified the owner's name, the viewer with "Sign in" from the chrome (its state bound to the page's route and session, its code redeemed only there) and an anonymous viewer's own unverified name, "Never enter passwords on this page." and the report control in the footer, the paused notice, an operator's interstitial, after-submit line and made-with link, and plain pages for a page under review, a suspended account or a page moving. Every shell page now requires Trusted Types. A hosted submission refused for a rate, a limit, a pause or sign-in says so and keeps the draft.

### Patch Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`b9bea94`](https://github.com/mostra-dev/mostra/commit/b9bea94ba3edf30b08e00f087ecde8c4f00d94b2) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A Client ID Metadata Document is fetched again: the fetch's own DNS lookup answered Node.js with one address when it asked for all of them (its happy-eyeballs connect), so every document failed with "Invalid IP address: undefined" (found by claude.ai's connector). The hosted shell tells the viewer when it couldn't store its session, and that a reload will need the link again.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`27df61b`](https://github.com/mostra-dev/mostra/commit/27df61b518428bf70887dadc70d6230f01f766c1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A suspended account's refresh is refused for now (403 `temporarily_unavailable`), never as a sign-out; a hosted submit takes its rates before the operator's `limits` is asked and gets them back when the operator refuses; `rateLimits.perIp.requests` is applied to every request; the development device form checks the code before it resolves anyone; a hosted shell whose session isn't stored offers no sign-in.
- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0

## 0.10.0

### Minor Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A remote server serves hosted pages: `mostra share <artifact> --cloud` (the host protocol's `share/start { via: "remote" }`) pushes the latest version and mints a link on the hosted home, `https://<domain>/a/<routeId>#t=…`; the shell lives on the user-content domain's apex with its session in the `X-Mostra-Shell` header (`SHELL_SESSION_HEADER`), never a cookie, and frames on the route's own label in worker mode. A respondent there sees "Your answer was sent." and no delivery state; the owner instance receives the submission through its outbox. `share/list` and `share/stop` include remote shares, and a stopped one's hosted link is revoked. `VersionPush` carries the owner's submission policy in force.

### Patch Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`a76751c`](https://github.com/mostra-dev/mostra/commit/a76751ce4ee736b45de80ea715cab00b0f7d21b9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra open` says on stderr when it opened no browser and why, and `--browser` opens one from an agent's shell ([#114](https://github.com/mostra-dev/mostra/issues/114)). Under `epochs`, a new round's page no longer shows the last round's "Submitted" card; only the tab that submitted keeps its receipt ([#118](https://github.com/mostra-dev/mostra/issues/118)).
- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0

## 0.9.0

### Patch Changes

- [#112](https://github.com/mostra-dev/mostra/pull/112) [`c7ea80c`](https://github.com/mostra-dev/mostra/commit/c7ea80cd60ee03aef1fbd17c6d38003b287d153b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The READMEs say what the package carries today: fields, submissions, actions and live data in `@mostra/react`; the version banner and trusted controls in `@mostra/shell`.
- Updated dependencies [[`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/protocol@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7)]:
  - @mostra/protocol@0.8.0

## 0.7.0

### Minor Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Sharing (D158). `mostra share <artifact> --tailnet` opens an artifact to the people of your tailnet through Tailscale Serve, each known by their tailnet identity; `mostra share <artifact> --public` opens it to anyone holding the link through a Cloudflare quick tunnel (or Tailscale Funnel with `--via funnel`), for 1 hour by default and 7 days at most. `mostra share stop` and `mostra share list` end and list shares; the host protocol has `share/start`, `share/stop` and `share/list`, and `instance/status` reports active shares, which keep a daemon running. Each tunnel address is a gateway face of its own on loopback, so a request is judged by the socket it came through, never by its `Host`. Frames on another site than their shell (a Cloudflare share, a host's external bases) enter in worker mode: a bootstrap page, Mostra's service worker, and single-use tickets for event streams, long polls and WebSockets; where a tunnel holds streams back, pages long-poll. Hosts get the `addressing` port (`port/addressing.externalBase`, HO-10) in the SDK, the Rust crate and the conformance kit, whose new `ports.addressing` scenario, and the shares in `ports.identity`, run through local stand-ins for `tailscale` and `cloudflared`.

### Patch Changes

- Updated dependencies [[`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a)]:
  - @mostra/protocol@0.7.0

## 0.6.2

### Patch Changes

- [#94](https://github.com/mostra-dev/mostra/pull/94) [`4e81b4c`](https://github.com/mostra-dev/mostra/commit/4e81b4c1ceeb47808d3ef4296ec6a2172a2a847c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The shell loads the artifact's frame again when its load failed: a frame that loaded without greeting the shell within 6 s, or that greeted nothing within 12 s, is entered again with a new ticket, up to three times with a growing pause, after which the shell says the page didn't load. Before, such a frame stayed on "Connecting…" until the viewer reloaded. On Windows 11, Chromium's random local ports occasionally fail a connection with `ERR_NO_BUFFER_SPACE` ([#66](https://github.com/mostra-dev/mostra/issues/66), D157). `verify` drives the same shell, loads a failed frame again once, gives each frame entry its own wait for readiness, and counts failed requests of the frame the page ends in only, never of a frame the shell replaced.
- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2

## 0.6.1

### Patch Changes

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependency updates, each past its 7-day release age: React 19.3.1, React Router 8.5.0, Vite 8.3.4, Zod 4.6.7, `@hono/node-server` 2.1.5, undici 8.12.3, Playwright 1.64.1 (the same browsers as 1.64.0), and in the warm set Base UI 1.9.0, Radix 1.8.1, Motion 14.4.0, TanStack Table 9.3.1 and the other minor and patch releases of its libraries; the installer's pnpm 10.34.7.
- Updated dependencies [[`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81)]:
  - @mostra/protocol@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0

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
