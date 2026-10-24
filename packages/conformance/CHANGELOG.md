# @mostra/conformance

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
