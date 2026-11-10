# @mostra/conformance

## 0.11.0

### Patch Changes

- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0
  - @mostra/sdk@0.11.0

## 0.10.0

### Minor Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`b119f05`](https://github.com/mostra-dev/mostra/commit/b119f05b57b252fdf9d1edd62ab010229e9890b1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Two remote scenarios, `remote.delivery` and `remote.relay`: the kit runs a remote server, signs the host's instance in through the host's own client, shares to it and answers the hosted page, checking that the answer reaches the host once through its instance's outbox and that a hosted page's actions run on the host's instance with its own secrets. The kit's viewer opens hosted links, keeping the shell's session in a header as the hosted shell does.

### Patch Changes

- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0
  - @mostra/sdk@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/protocol@0.9.0
  - @mostra/sdk@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7)]:
  - @mostra/protocol@0.8.0
  - @mostra/sdk@0.8.0

## 0.7.0

### Minor Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Sharing (D158). `mostra share <artifact> --tailnet` opens an artifact to the people of your tailnet through Tailscale Serve, each known by their tailnet identity; `mostra share <artifact> --public` opens it to anyone holding the link through a Cloudflare quick tunnel (or Tailscale Funnel with `--via funnel`), for 1 hour by default and 7 days at most. `mostra share stop` and `mostra share list` end and list shares; the host protocol has `share/start`, `share/stop` and `share/list`, and `instance/status` reports active shares, which keep a daemon running. Each tunnel address is a gateway face of its own on loopback, so a request is judged by the socket it came through, never by its `Host`. Frames on another site than their shell (a Cloudflare share, a host's external bases) enter in worker mode: a bootstrap page, Mostra's service worker, and single-use tickets for event streams, long polls and WebSockets; where a tunnel holds streams back, pages long-poll. Hosts get the `addressing` port (`port/addressing.externalBase`, HO-10) in the SDK, the Rust crate and the conformance kit, whose new `ports.addressing` scenario, and the shares in `ports.identity`, run through local stand-ins for `tailscale` and `cloudflared`.

### Patch Changes

- Updated dependencies [[`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a)]:
  - @mostra/protocol@0.7.0
  - @mostra/sdk@0.7.0

## 0.6.2

### Patch Changes

- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2
  - @mostra/sdk@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`f210c60`](https://github.com/mostra-dev/mostra/commit/f210c600415c9ab61263f13bd7b22ec3e76d8e58), [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81), [`a9519df`](https://github.com/mostra-dev/mostra/commit/a9519df6a55bc5887b6a3008b36ab5e6d249fcf1)]:
  - @mostra/sdk@0.6.1
  - @mostra/protocol@0.6.1

## 0.6.0

### Patch Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`cf0343a`](https://github.com/mostra-dev/mostra/commit/cf0343a1bb8e66b074a567587395c69a4501aa52) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows the conformance kit removes each scenario's home after the run, sealed versions included: it resets their access lists through the runtime's helper, which `@mostra/sdk` now exports as `windowsHelper` (the lookup every client uses), instead of leaving them in the temporary folder.

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`9d96c60`](https://github.com/mostra-dev/mostra/commit/9d96c60ebbc7994ea95a408a112580990852ba88) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows bundles copied by a tool that follows junctions (Explorer, `Copy-Item`, a move to another drive) are set up again instead of refused, and two setups of one bundle at once no longer fail. The conformance kit ends a host shim's whole process tree on Windows even after its shell exits, and judges Windows access lists exactly: an account alias counts as the user only by its SID, and every deny type and `CREATOR OWNER` are read as Windows applies them.

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `npm create mostra` installs and runs on Windows (x64 and arm64), from the Windows runtime bundles each release now carries with the others. The conformance kit's TypeScript reference host starts on Windows, and `MOSTRA_PLATFORM_UNSUPPORTED`'s hint and page name Windows among the supported platforms. The Rust crate `mostra-host`, released with them, spawns and attaches on Windows too, over the home's named pipe, which it refuses unless your user owns it.
- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`cf0343a`](https://github.com/mostra-dev/mostra/commit/cf0343a1bb8e66b074a567587395c69a4501aa52), [`9d96c60`](https://github.com/mostra-dev/mostra/commit/9d96c60ebbc7994ea95a408a112580990852ba88), [`7012f26`](https://github.com/mostra-dev/mostra/commit/7012f2605f7ab77c2e0de45218fca0f5b7de61ba), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0
  - @mostra/sdk@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0
  - @mostra/sdk@0.5.0

## 0.4.0

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`fd893ae`](https://github.com/mostra-dev/mostra/commit/fd893aee2dbcf801d409054220fd81db251de7d1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, `mostra open` writes its launch page under the user's own profile, never under a `%TEMP%` that other users may read. The conformance kit opens an instance's pipe through the SDK's `connectControl`, as every other client does.
- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f), [`973bd3c`](https://github.com/mostra-dev/mostra/commit/973bd3c2d13c63e8d97e25c67ae1a65adcc1f2fd), [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18)]:
  - @mostra/protocol@0.4.0
  - @mostra/sdk@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0
  - @mostra/sdk@0.3.0

## 0.2.0

### Minor Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`bb1ae39`](https://github.com/mostra-dev/mostra/commit/bb1ae3972d0100f4c71e77049ee37788d8fc831f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - New package: the host conformance kit. `mostra-conformance --host "<shim>"` runs scenarios (durability across restart, delivery once in effect, retries and outbox replay, draft mirrors, policies, events, signals, waits, long-lived state, results, request IDs, identity, trusted controls, secrets, server events, links, hygiene, the shell's bridge, version negotiation, process models, the authoring directory's removal, a host's privacy) against a host through the harness protocol, judged against an expected-failure baseline. `serveHarness` writes a TypeScript host's shim, and `mostra-conformance-reference-host` is the TypeScript reference host, with `--standalone` and `--break` modes.

### Patch Changes

- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b), [`8772efe`](https://github.com/mostra-dev/mostra/commit/8772efeaf48e77765e6c3953c213704dd35c8de5), [`7251965`](https://github.com/mostra-dev/mostra/commit/725196570ed56cf930213d4cffed1093c5863b8e)]:
  - @mostra/protocol@0.2.0
  - @mostra/sdk@0.2.0
