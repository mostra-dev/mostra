---
"@mostra/conformance": minor
---

New package: the host conformance kit. `mostra-conformance --host "<shim>"` runs scenarios (durability across restart, delivery once in effect, retries and outbox replay, draft mirrors, policies, events, signals, waits, long-lived state, results, request IDs, identity, trusted controls, secrets, server events, links, hygiene, the shell's bridge, version negotiation, process models, the authoring directory's removal, a host's privacy) against a host through the harness protocol, judged against an expected-failure baseline. `serveHarness` writes a TypeScript host's shim, and `mostra-conformance-reference-host` is the TypeScript reference host, with `--standalone` and `--break` modes.
