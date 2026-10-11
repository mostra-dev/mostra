# @mostra/protocol

The vocabulary every other package imports: IDs, protocol revisions, diagnostics, protocol
method schemas, and the one JSON-RPC 2.0 core every Mostra connection uses (D83). Audience:
everything. It runs in browsers, workers and Node, so it has no I/O and
imports nothing but `zod` (tools/package-map.ts).

## Invariants it owns

- **Additive evolution (D32, HO-07).** Within a revision, wire schemas only gain optional fields,
  definitions and enum values. The `api` job's schema check rejects anything else against the
  base; a breaking change needs a new entry in `HOST_PROTOCOL_REVISIONS`.
- **Stable diagnostic codes (AX-03).** A released code keeps its meaning and is never removed; mark
  it `deprecated` instead. Every code has a title, hint and docs text.
- **One JSON-RPC core (D83).** `src/rpc/` holds the only JSON-RPC implementation: `RpcPeer`,
  `RpcError`, the message schemas and newline framing. Every connection uses it: the host protocol,
  child-process messaging and the shell bridge. It has no batches in revision `2026-10-10`, no I/O
  and no Node built-ins, and its size is gated (`size-limit`). Errors always carry a diagnostic in
  `error.data`.
- **ID forms (INTERFACES §1).** IDs are opaque `<prefix>_<body>` strings; callers validate them and
  never read meaning from the body.

## Where things are

- `src/index.ts` is the public interface; `etc/protocol.api.md` is its committed API report.
- `src/diagnostics/codes/<area>.ts` holds one area's codes. Add codes with `pnpm gen diagnostic`
  ([playbook](../../docs/agents/add-diagnostic.md)).
- `src/rpc/` is the JSON-RPC core; a transport feeds `RpcPeer.receive` or `receiveLine` and sends
  what its `send` callback gets.
- `src/methods/` holds protocol methods. Add one with `pnpm gen protocol-method`
  ([playbook](../../docs/agents/add-protocol-method.md)).
- `scripts/wire-schemas.ts` lists the published JSON Schema bundles; `schemas/` holds them.

## Tests to run

`pnpm --filter @mostra/protocol test`, then `pnpm check --affected`. After a schema change, run
`pnpm --filter @mostra/protocol gen:schemas`; after a catalog change,
`node tools/docs/diagnostics.ts write`.

## Gotchas

- `isolatedDeclarations` is on, so every export needs an explicit type. Schemas are written as
  `export const X: z.ZodType<X> = …` next to a hand-written `interface X`: the public type stays
  readable and the schema is checked against it.
- Register every wire schema in `wireRegistry` with a stable `id`. The id is its name in the
  published JSON Schema and can't change within a revision.
- Use `exactOptional()` for optional fields, because `exactOptionalPropertyTypes` is on.
- Codes on the wire accept any area, so older clients survive newer codes. Producers use
  `createDiagnostic` with a cataloged code.
- The build keeps one module per source file (`unbundle`), so a browser bundle that imports only
  `RpcPeer` doesn't carry every diagnostic's text. Code in `src/rpc/` builds diagnostics from the
  HOST catalog alone (`hostDiagnostic`) for the same reason.
- No DOM or Node types: browser and timer globals the package needs are declared in
  `src/*.d.ts`.
