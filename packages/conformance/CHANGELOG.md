# @mostra/conformance

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
