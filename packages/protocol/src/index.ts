/**
 * `@mostra/protocol`: the shared vocabulary of every Mostra client, host and process. IDs,
 * protocol revisions and diagnostics, as TypeScript types with Zod schemas, published as JSON
 * Schema. It has no I/O and runs in browsers, workers and Node alike.
 *
 * @packageDocumentation
 */
export {
  type CreateDiagnosticOptions,
  createDiagnostic,
  diagnosticCatalog,
  type HostDiagnosticCode,
  type KnownDiagnosticCode,
} from "./diagnostics/codes/index.ts";
export {
  DIAGNOSTIC_AREAS,
  Diagnostic,
  type DiagnosticArea,
  type DiagnosticCode,
  DiagnosticFix,
  DiagnosticLocation,
  DiagnosticPhase,
  DiagnosticSeverity,
} from "./diagnostics/diagnostic.ts";
export {
  type AreaCatalog,
  DEFAULT_DOCS_BASE,
  type DiagnosticDetails,
  type DiagnosticSpec,
  docsUrl,
} from "./diagnostics/spec.ts";
export {
  ArtifactId,
  CommentId,
  Cursor,
  type GeneratedIdKind,
  type Id,
  type IdBody,
  type IdKind,
  type IdPrefix,
  MutationId,
  RunId,
  SubmissionId,
  ThreadId,
  TokenId,
  VersionId,
  type VersionIdKind,
  ViewerId,
  ViewId,
} from "./ids.ts";
export {
  HOST_PROTOCOL_REVISIONS,
  negotiateRevision,
  Revision,
  type RevisionNegotiation,
} from "./revision.ts";
