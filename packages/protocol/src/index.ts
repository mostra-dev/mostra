/**
 * `@mostra/protocol`: the shared vocabulary of every Mostra client, host and process. IDs,
 * protocol revisions, diagnostics and host protocol methods, as TypeScript types with Zod schemas,
 * published as JSON Schema, plus the one JSON-RPC 2.0 core every Mostra connection uses (D83). It
 * has no I/O and runs in browsers, workers and Node alike.
 *
 * @packageDocumentation
 */
export {
  ArtifactDetail,
  ArtifactRef,
  ArtifactSummary,
  PublishReceipt,
  SourceRef,
  VersionSummary,
} from "./artifact.ts";
export {
  type ActionDiagnosticCode,
  type ArtifactDiagnosticCode,
  actionDiagnosticCodes,
  artifactDiagnosticCodes,
  type BuildDiagnosticCode,
  buildDiagnosticCodes,
  type CreateDiagnosticOptions,
  createDiagnostic,
  type DepDiagnosticCode,
  depDiagnosticCodes,
  diagnosticCatalog,
  type EnvDiagnosticCode,
  envDiagnosticCodes,
  type HomeDiagnosticCode,
  type HostDiagnosticCode,
  homeDiagnosticCodes,
  hostDiagnosticCodes,
  type KnownDiagnosticCode,
  type ManifestDiagnosticCode,
  manifestDiagnosticCodes,
  type PlatformDiagnosticCode,
  type PublishDiagnosticCode,
  platformDiagnosticCodes,
  publishDiagnosticCodes,
  type TargetDiagnosticCode,
  targetDiagnosticCodes,
} from "./diagnostics/codes/index.ts";
// gen:area-entry-exports (`pnpm gen diagnostic` adds a new area's exports here; Biome merges them)
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
  ARTIFACT_MANIFEST_KEYS,
  type ArtifactFamily,
  ArtifactLink,
  ArtifactManifest,
  type DemoSpec,
  SubmissionPolicy,
  type TerminalSpec,
} from "./manifest.ts";
export {
  type AnyMethod,
  defineMethod,
  type MethodDefinition,
  type MethodDirection,
} from "./method.ts";
export {
  type ArtifactCreateParams,
  type ArtifactCreateResult,
  artifactCreateMethod,
} from "./methods/artifact/create.ts";
export {
  type ArtifactGetParams,
  type ArtifactGetResult,
  artifactGetMethod,
} from "./methods/artifact/get.ts";
export {
  type ArtifactListFilter,
  type ArtifactListParams,
  type ArtifactListResult,
  artifactListMethod,
} from "./methods/artifact/list.ts";
export {
  type ArtifactPublishParams,
  type ArtifactPublishResult,
  artifactPublishMethod,
} from "./methods/artifact/publish.ts";
export {
  AddedPackage,
  type DepsAddParams,
  type DepsAddResult,
  depsAddMethod,
} from "./methods/deps/add.ts";
export { hostMethods } from "./methods/index.ts";
export {
  ChildProcessStatus,
  type InstanceStatusParams,
  type InstanceStatusResult,
  instanceStatusMethod,
} from "./methods/instance/status.ts";
export {
  ClientCapabilities,
  ClientInfo,
  DependencyPolicy,
  HomeConfig,
  InstanceCapabilities,
  InstanceInfo,
  type MostraInitializeParams,
  type MostraInitializeResult,
  mostraInitializeMethod,
  PortName,
} from "./methods/mostra/initialize.ts";
export {
  type MostraShutdownParams,
  type MostraShutdownResult,
  mostraShutdownMethod,
} from "./methods/mostra/shutdown.ts";
export {
  HOST_PROTOCOL_REVISIONS,
  negotiateRevision,
  Revision,
  type RevisionNegotiation,
} from "./revision.ts";
// gen:method-exports
export { JSON_RPC_ERROR_CODES, RpcError } from "./rpc/error.ts";
export { encodeLine, LineSplitter } from "./rpc/lines.ts";
export {
  type ClassifiedMessage,
  classifyMessage,
  JsonRpcErrorObject,
  JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  JsonRpcNotification,
  type JsonRpcParams,
  JsonRpcRequest,
  type JsonRpcResponse,
  JsonRpcSuccess,
} from "./rpc/messages.ts";
export {
  parseParams,
  RpcPeer,
  type RpcPeerOptions,
  type RpcRequestContext,
  type RpcRequestOptions,
} from "./rpc/peer.ts";
