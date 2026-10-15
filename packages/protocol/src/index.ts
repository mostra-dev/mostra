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
  type AnyBridgeMessage,
  BRIDGE_MESSAGES,
  type Bridge,
  type BridgeEvent,
  type BridgeHostContext,
  type BridgeImplementation,
  type BridgeMessage,
  type BridgeOptions,
  type BridgePeer,
  type BridgeReceiver,
  type BridgeRejection,
  type BridgeSide,
  connectBridge,
  MCP_APPS_PROTOCOL_VERSION,
  mostraReady,
  OPEN_LINK_SCHEMES,
  type UiInitializeParams,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
  uiOpenLink,
  uiSizeChanged,
} from "./bridge.ts";
export {
  BROWSER_PROTOCOL_REVISION,
  BROWSER_PROTOCOL_REVISIONS,
  DocumentSnapshot,
  FieldsRequest,
  PollResult,
  SIGNAL_PAYLOAD_MAX_BYTES,
  SignalRequest,
  StreamSnapshot,
  SubmitRequest,
} from "./browser.ts";
export { canonicalJson } from "./canonical.ts";
export {
  ALL_SCOPES,
  CapabilityScope,
  Duration,
  durationMs,
  normalizeScopes,
  scopeAllows,
} from "./capability.ts";
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
  type FieldDiagnosticCode,
  fieldDiagnosticCodes,
  type HomeDiagnosticCode,
  type HostDiagnosticCode,
  type HygieneDiagnosticCode,
  homeDiagnosticCodes,
  hostDiagnosticCodes,
  hygieneDiagnosticCodes,
  type KnownDiagnosticCode,
  type ManifestDiagnosticCode,
  manifestDiagnosticCodes,
  type PlatformDiagnosticCode,
  type PublishDiagnosticCode,
  platformDiagnosticCodes,
  publishDiagnosticCodes,
  type SubmitDiagnosticCode,
  submitDiagnosticCodes,
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
  CSRF_HEADER,
  checkRequest,
  headerValue,
  isJsonContentType,
  type Refusal,
  type RequestFacts,
  type RequestIntent,
  type RequestPolicy,
  refusal,
  safeEqual,
  safePath,
} from "./hygiene.ts";
export {
  ArtifactId,
  CommentId,
  Cursor,
  DeliveryId,
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
  Actor,
  type DeliveryState,
  DeliveryStatus,
  DocumentRevision,
  EventFilter,
  EventRecord,
  EventTypePattern,
  FIELD_ID_MAX_LENGTH,
  FieldConflict,
  FieldOp,
  type FieldScope,
  FieldState,
  isFieldId,
  MutationResult,
  type Rect,
  ResultComment,
  Results,
  SIGNAL_NAME_PATTERN,
  SubmissionSummary,
  type SubmitChannel,
  Viewer,
  type ViewerKind,
  ViewerSpec,
  type Viewport,
  WaitCondition,
} from "./interaction.ts";
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
export {
  type EventsAckParams,
  type EventsAckResult,
  eventsAckMethod,
} from "./methods/events/ack.ts";
export {
  EVENTS_READ_MAX,
  type EventsReadParams,
  type EventsReadResult,
  eventsReadMethod,
} from "./methods/events/read.ts";
export {
  EVENTS_NOTIFY,
  EventsNotifyParams,
  type EventsSubscribeParams,
  type EventsSubscribeResult,
  eventsSubscribeMethod,
} from "./methods/events/subscribe.ts";
export {
  type EventsUnsubscribeParams,
  type EventsUnsubscribeResult,
  eventsUnsubscribeMethod,
} from "./methods/events/unsubscribe.ts";
export { hostMethods } from "./methods/index.ts";
export {
  ChildProcessStatus,
  DeliveryCounts,
  GatewayStatus,
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
  DraftMirror,
  type DraftsMirrorResult,
  portDraftsMirrorMethod,
} from "./methods/port/drafts-mirror.ts";
export {
  portSubmissionsDeliverMethod,
  SubmissionEnvelope,
  type SubmissionsDeliverResult,
} from "./methods/port/submissions-deliver.ts";
export {
  type ResultsGetParams,
  type ResultsGetResult,
  ResultsMarkdown,
  resultsGetMethod,
} from "./methods/results/get.ts";
export { type StateGetParams, type StateGetResult, stateGetMethod } from "./methods/state/get.ts";
export {
  type StatePatchParams,
  type StatePatchResult,
  statePatchMethod,
} from "./methods/state/patch.ts";
export {
  type ViewRevokeParams,
  type ViewRevokeResult,
  viewRevokeMethod,
} from "./methods/view/revoke.ts";
export {
  type ViewRotateParams,
  type ViewRotateResult,
  viewRotateMethod,
} from "./methods/view/rotate.ts";
export {
  CapabilityLink,
  type ViewUrlParams,
  type ViewUrlResult,
  viewUrlMethod,
} from "./methods/view/url.ts";
export {
  WAIT_MAX_MS,
  type WaitParams,
  type WaitResult,
  waitMethod,
} from "./methods/wait/wait.ts";
export {
  HOST_PROTOCOL_REVISIONS,
  negotiateRevision,
  Revision,
  type RevisionNegotiation,
} from "./revision.ts";
// gen:method-exports
export { JSON_RPC_ERROR_CODES, RpcError } from "./rpc/error.ts";
export { encodeLine, LineSplitter, MAX_LINE_LENGTH } from "./rpc/lines.ts";
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
