# @mostra/sdk

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

- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2

## 0.6.1

### Patch Changes

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`f210c60`](https://github.com/mostra-dev/mostra/commit/f210c600415c9ab61263f13bd7b22ec3e76d8e58) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A first install of the runtime bundle is 3 to 5 times faster: about 1.5 minutes instead of 7 on Windows arm64, 45 s instead of 3 minutes on Windows x64, 20 s instead of 70 on Linux. The archive's files are written straight into the new directory as they are read, with the same refusals as before (only files, directories and links, nothing outside the bundle's directory, no path twice, links made last so nothing is written through one), and every file is still checked against the bundle's file list.

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependency updates, each past its 7-day release age: React 19.3.1, React Router 8.5.0, Vite 8.3.4, Zod 4.6.7, `@hono/node-server` 2.1.5, undici 8.12.3, Playwright 1.64.1 (the same browsers as 1.64.0), and in the warm set Base UI 1.9.0, Radix 1.8.1, Motion 14.4.0, TanStack Table 9.3.1 and the other minor and patch releases of its libraries; the installer's pnpm 10.34.7.

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`a9519df`](https://github.com/mostra-dev/mostra/commit/a9519df6a55bc5887b6a3008b36ab5e6d249fcf1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Two installers of one bundle no longer remove each other's fresh lock when the file system gives the new lock the number of the stale one it replaced (ext4 does at once): a stale lock is removed only when the file moved aside holds exactly what was judged stale, its owner's PID and token, as well as being the same file. The Rust crate's installer, which shares the lock, does the same.
- Updated dependencies [[`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81)]:
  - @mostra/protocol@0.6.1

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`7012f26`](https://github.com/mostra-dev/mostra/commit/7012f2605f7ab77c2e0de45218fca0f5b7de61ba) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows hosts run on Mostra's Windows bundles: the platform gate takes win32 x64 and arm64, the bundle cache is `%LOCALAPPDATA%\mostra-cache`, a Windows archive's links (which it never carries) are made as junctions at setup, so an ordinary user installs one, a moved Windows bundle is set up again, and a rename an antivirus scan holds for a moment is tried again. The instance a host spawns opens no console window.

### Patch Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`cf0343a`](https://github.com/mostra-dev/mostra/commit/cf0343a1bb8e66b074a567587395c69a4501aa52) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows the conformance kit removes each scenario's home after the run, sealed versions included: it resets their access lists through the runtime's helper, which `@mostra/sdk` now exports as `windowsHelper` (the lookup every client uses), instead of leaving them in the temporary folder.

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`9d96c60`](https://github.com/mostra-dev/mostra/commit/9d96c60ebbc7994ea95a408a112580990852ba88) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows bundles copied by a tool that follows junctions (Explorer, `Copy-Item`, a move to another drive) are set up again instead of refused, and two setups of one bundle at once no longer fail. The conformance kit ends a host shim's whole process tree on Windows even after its shell exits, and judges Windows access lists exactly: an account alias counts as the user only by its SID, and every deny type and `CREATOR OWNER` are read as Windows applies them.
- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0

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
