# @mostra/sdk

## 0.5.0

### Patch Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A client no longer refuses an answer from a newer Mostra for a value it doesn't know yet. `RpcPeer.call` reads results, and the SDK reads port requests and event pages, through the new `receivable(schema)`: an enum value or a union member a newer instance added within the revision arrives as sent, while everything else is still checked ([#45](https://github.com/mostra-dev/mostra/issues/45)).

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Security updates: Vite 8.3.3 for the builder (its `launch-editor` could be led to run a command on Windows, GHSA-587h-7wmj-h5pm), Zod 4.6.6 for every wire schema (validating an oversized constrained collection could exhaust memory, GHSA-mrhx-c7xc-m3w5), and undici 8.12.2 for the SDK's bundle downloads (unbounded memory in its EventSource parser, GHSA-4qv8-2p9j-2685).
- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0

## 0.4.0

### Minor Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Adds `connectControl`, which opens a home's control endpoint as a client: its Unix socket, or on Windows its owner-only pipe through the runtime's helper, refusing a pipe another user created under the name, found beside the runtime the caller resolved.

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`973bd3c`](https://github.com/mostra-dev/mostra/commit/973bd3c2d13c63e8d97e25c67ae1a65adcc1f2fd) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, `connectControl` finds the helper from where the runtime's code really is, as the runtime itself does, so a runtime reached through a link still finds its helper.
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

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`7251965`](https://github.com/mostra-dev/mostra/commit/725196570ed56cf930213d4cffed1093c5863b8e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A host started without ports clears the record of the ports it always provides, so nothing waits for a port it no longer serves; and the bundle installer touches its lock while an install runs, so an install longer than an hour is never taken from it.
- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b)]:
  - @mostra/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`0939420`](https://github.com/mostra-dev/mostra/commit/093942093a22792ae14436320ecadaee4f66c0f2) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The first release of the SDK (HO-04): `createMostra({ home, ports })` spawns a JavaScript host's own Mostra instance on a verified runtime bundle and serves its `submissions`, `drafts`, `secrets` and `trustedControls` ports, with `publish`, `verify`, `wait`, `results`, `getState`, `patchState`, `pushLive`, `viewUrl`, an `events` stream with flow control and named resumption, and `call` for any other host protocol method. It also holds the bundle manager the CLI and `create-mostra` use: the pinned bundle downloaded through the environment's proxy, checked against its SHA-256, extracted and checked file by file, cached by digest and set up (`mostra-setup`).

### Patch Changes

- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
