# @mostra/protocol

The shared vocabulary of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact
runtime: the types every Mostra client, host and process agree on, as TypeScript types with Zod
schemas and published JSON Schema. It has no I/O and runs in browsers, workers and Node alike.

```sh
npm install @mostra/protocol
```

## What it contains

- **IDs.** One kind per entity (`ArtifactId`, `VersionId`, `ViewId`, `SubmissionId` and so on),
  each a type and a value: `ArtifactId.parse(input)`, `MutationId.create()`, `ArtifactId.schema`
  inside a Zod object. Version IDs are content-addressed: `VersionId.fromSha256(digest)`. Event
  cursors are decimal strings (`Cursor`).
- **Protocol revisions.** Dated revisions (`2026-10-10`) and `negotiateRevision(offered,
  supported)`, which picks the newest common revision or returns the
  `MOSTRA_HOST_REVISION_UNSUPPORTED` diagnostic.
- **Diagnostics.** The one error shape of every Mostra interface (`Diagnostic`), the catalog of
  stable codes with their docs (`diagnosticCatalog`) and `createDiagnostic(code, details)`.
- **Protocol methods.** `defineMethod` and the registry of host protocol methods.
- **JSON Schema.** `schemas/protocol.schema.json` (2020-12) and `schemas/protocol.draft-07.json`,
  exported as `@mostra/protocol/schemas/*`.

```ts
import { ArtifactId, negotiateRevision } from "@mostra/protocol";

const id = ArtifactId.parse("art_01J9ZQ3W4X5Y6Z7A8B9C0D1E2F");
const outcome = negotiateRevision(["2026-10-10"]);
if (!outcome.ok) console.error(outcome.diagnostic.message);
```

Interfaces change additively within a protocol revision; a breaking change needs a new revision.
The package stays at 0.x until the host protocol freezes.

## License

Apache-2.0.
