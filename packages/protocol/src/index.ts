/**
 * `@mostra/protocol`: the shared vocabulary of every Mostra client, host and process. IDs,
 * protocol revisions, diagnostics and host protocol methods, as TypeScript types with Zod schemas,
 * published as JSON Schema, plus the one JSON-RPC 2.0 core every Mostra connection uses (D83). It
 * has no I/O and runs in browsers, workers and Node alike.
 *
 * @packageDocumentation
 */
export {
  ACTION_ARGS_MAX,
  ACTION_RESULT_MAX,
  ActionError,
  Batches,
  type CallLine,
  CallRequest,
  type EphemeralMessage,
  isFinalRunStatus,
  LIVE_KEY_PATTERN,
  LIVE_RING_DEFAULT,
  LIVE_RING_MAX,
  LIVE_VALUE_MAX,
  LiveRequest,
  type LiveState,
  type LiveUpdate,
  RUN_KEY_MAX,
  RUN_LOG_MAX,
  RUN_LOG_TRUNCATED,
  RUN_STATUSES,
  RunAttachRequest,
  RunCancelRequest,
  type RunDelta,
  RunProgress,
  type RunReason,
  RunRequest,
  RunState,
  type RunStatus,
  SECRET_NAME_PATTERN,
  SECRET_VALUE_MAX,
} from "./actions.ts";
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
  BRIDGE_FIELDS_MAX,
  BRIDGE_MESSAGES,
  BRIDGE_TEXT_MAX,
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
  CONTROL_LABEL_MAX,
  type ControlRequest,
  connectBridge,
  type FieldRegistration,
  type FieldsParams,
  type FlushResult,
  MCP_APPS_PROTOCOL_VERSION,
  mostraControlsRequest,
  mostraFieldFocus,
  mostraFields,
  mostraFlush,
  mostraPage,
  mostraReady,
  mostraVersionAvailable,
  OPEN_LINK_SCHEMES,
  type SaveState,
  type SubmitBlocker,
  type UiInitializeParams,
  type UiInitializeResult,
  uiInitialize,
  uiInitialized,
  uiOpenLink,
  uiSizeChanged,
  type VersionAvailableParams,
} from "./bridge.ts";
export {
  BROWSER_PROTOCOL_REVISION,
  BROWSER_PROTOCOL_REVISIONS,
  CarryOver,
  ChooseRequest,
  type DeliveryTarget,
  DocumentSnapshot,
  FieldsRequest,
  FollowRequest,
  FrameTicket,
  OrphanedField,
  PollResult,
  REVIEW_SET_ID_PATTERN,
  readViewContext,
  ShellSubmitRequest,
  SIGNAL_PAYLOAD_MAX_BYTES,
  SignalRequest,
  StreamSnapshot,
  SubmitRequest,
  VersionRef,
  ViewContext,
  ViewContextWire,
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
  type A11yDiagnosticCode,
  type ActionDiagnosticCode,
  type ArtifactDiagnosticCode,
  a11yDiagnosticCodes,
  actionDiagnosticCodes,
  artifactDiagnosticCodes,
  type BuildDiagnosticCode,
  buildDiagnosticCodes,
  type CliDiagnosticCode,
  type ConsoleDiagnosticCode,
  type CreateDiagnosticOptions,
  cliDiagnosticCodes,
  consoleDiagnosticCodes,
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
  type LiveDiagnosticCode,
  liveDiagnosticCodes,
  type ManifestDiagnosticCode,
  manifestDiagnosticCodes,
  type NetworkDiagnosticCode,
  networkDiagnosticCodes,
  type PlatformDiagnosticCode,
  type PublishDiagnosticCode,
  platformDiagnosticCodes,
  publishDiagnosticCodes,
  type RegressionDiagnosticCode,
  type RuntimeDiagnosticCode,
  regressionDiagnosticCodes,
  runtimeDiagnosticCodes,
  type SecretDiagnosticCode,
  type SmokeDiagnosticCode,
  type SubmitDiagnosticCode,
  secretDiagnosticCodes,
  smokeDiagnosticCodes,
  submitDiagnosticCodes,
  type TargetDiagnosticCode,
  type TypeDiagnosticCode,
  targetDiagnosticCodes,
  typeDiagnosticCodes,
  type VerifyDiagnosticCode,
  verifyDiagnosticCodes,
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
  ControlsPolicy,
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
  SubmitChannel,
  TrustedControl,
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
  type ArtifactVerifyParams,
  type ArtifactVerifyResult,
  artifactVerifyMethod,
} from "./methods/artifact/verify.ts";
export {
  AddedPackage,
  type DepsAddParams,
  type DepsAddResult,
  depsAddMethod,
} from "./methods/deps/add.ts";
export {
  DEV_NOTIFY,
  type DevEventKind,
  DevNotifyParams,
  type DevStartParams,
  type DevStartResult,
  devStartMethod,
} from "./methods/dev/start.ts";
export { type DevStopParams, type DevStopResult, devStopMethod } from "./methods/dev/stop.ts";
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
export {
  type GcCompactEvents,
  type GcCompacted,
  type GcCount,
  type GcRunParams,
  type GcRunResult,
  type GcVersion,
  gcRunMethod,
} from "./methods/gc/run.ts";
export { hostMethods } from "./methods/index.ts";
export {
  type InstanceCheck,
  type InstanceCheckParams,
  type InstanceCheckResult,
  instanceCheckMethod,
} from "./methods/instance/check.ts";
export {
  ChildProcessStatus,
  DeliveryCounts,
  GatewayStatus,
  type InstanceStatusParams,
  type InstanceStatusResult,
  instanceStatusMethod,
  WorkerStatus,
} from "./methods/instance/status.ts";
export { type LivePushParams, type LivePushResult, livePushMethod } from "./methods/live/push.ts";
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
  type PortSecretsGetParams,
  type PortSecretsGetResult,
  portSecretsGetMethod,
} from "./methods/port/secrets-get.ts";
export {
  portSubmissionsDeliverMethod,
  SubmissionEnvelope,
  type SubmissionsDeliverResult,
} from "./methods/port/submissions-deliver.ts";
export {
  type PortTrustedControlsActivatedParams,
  type PortTrustedControlsActivatedResult,
  portTrustedControlsActivatedMethod,
} from "./methods/port/trusted-controls-activated.ts";
export {
  type PortTrustedControlsPolicyParams,
  type PortTrustedControlsPolicyResult,
  portTrustedControlsPolicyMethod,
} from "./methods/port/trusted-controls-policy.ts";
export {
  type ResultsGetParams,
  type ResultsGetResult,
  ResultsMarkdown,
  resultsGetMethod,
} from "./methods/results/get.ts";
export {
  type SecretDeleteParams,
  type SecretDeleteResult,
  secretDeleteMethod,
} from "./methods/secret/delete.ts";
export {
  type SecretListParams,
  type SecretListResult,
  secretListMethod,
} from "./methods/secret/list.ts";
export {
  SecretEntry,
  type SecretSetParams,
  type SecretSetResult,
  secretSetMethod,
} from "./methods/secret/set.ts";
export { type StateGetParams, type StateGetResult, stateGetMethod } from "./methods/state/get.ts";
export {
  type StatePatchParams,
  type StatePatchResult,
  statePatchMethod,
} from "./methods/state/patch.ts";
export {
  type ViewDefaultParams,
  type ViewDefaultResult,
  viewDefaultMethod,
} from "./methods/view/default.ts";
export {
  type ViewLaunchParams,
  type ViewLaunchResult,
  viewLaunchMethod,
} from "./methods/view/launch.ts";
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
export {
  type AnyFunction,
  ARGUMENT_BIGINT_DIGITS_MAX,
  checkArgumentFrames,
  deserializeAll,
  type Frame,
  fromBase64,
  RemoteError,
  SerializationError,
  type SerializeMode,
  serializeAll,
  toBase64,
  UNSERIALIZABLE_CODE,
  ValueReader,
  type ValueReaderOptions,
  ValueWriter,
  type ValueWriterOptions,
  type WireError,
  wireError,
} from "./serializer.ts";
export {
  ARTIFACT_PROGRESS,
  ArtifactProgressParams,
  ariaSummary,
  type CompareRequest,
  type CompareResult,
  DEFAULT_VIEWPORTS,
  estimateImageTokens,
  type ProbedField,
  type RenderRequest,
  type RenderResult,
  ScreenshotPolicy,
  type TokenEstimate,
  VERIFY_PROBE,
  VERIFY_REPORT,
  VERIFY_RUNNER_METHODS,
  type VerdictAria,
  type VerdictScreenshot,
  VerifyVerdict,
  type VerifyViewport,
  viewportsFor,
} from "./verify.ts";
export {
  type CallContext,
  DEFAULT_WORKER_LIMITS,
  type LiveSourceInfo,
  ServerEmitParams,
  ServerLiveValueParams,
  ServerLogParams,
  ServerProgressParams,
  ServerSecretParams,
  ServerSignalParams,
  ServerStateGetParams,
  ServerStatePatchParams,
  type ServerStatePatchResult,
  WORKER_CHANNEL_REVISION,
  WORKER_METHODS,
  WorkerBatchParams,
  WorkerCallOutcome,
  WorkerCallParams,
  type WorkerCancelParams,
  type WorkerLimits,
  type WorkerLiveParams,
  WorkerPingResult,
  WorkerStartParams,
  WorkerStartResult,
  WorkerVersionRef,
} from "./worker.ts";
