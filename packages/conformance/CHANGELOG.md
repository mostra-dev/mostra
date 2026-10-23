# @mostra/conformance

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
