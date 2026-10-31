/**
 * `createMostra` (HO-04, D25, D58, D59): a JavaScript host's handle on its own Mostra instance.
 * It finds a verified runtime (the pinned bundle, downloaded once), spawns `mostra-runtime host`
 * for the host's home over stdio, opens the protocol session, serves the host's ports and offers
 * the calls every host makes. The instance lives exactly as long as this handle: `close()` ends
 * it, and so does the host's process exiting.
 *
 * ```ts
 * const mostra = await createMostra({
 *   home: "/var/lib/inbox/mostra",
 *   client: { name: "inbox-app", version: "1.4.0" },
 *   ports: { submissions: { deliver: async (envelope) => ({ accepted: true }) } },
 * });
 * const receipt = await mostra.publish("/work/inbox");
 * const outcome = await mostra.wait(receipt.artifactId, "submitted");
 * await mostra.close();
 * ```
 */
import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  type AnyMethod,
  ARTIFACT_PROGRESS,
  type ArtifactRef,
  type ArtifactSummary,
  artifactPublishMethod,
  artifactVerifyMethod,
  type CapabilityLink,
  type ControlsPolicy,
  createDiagnostic,
  type DependencyPolicy,
  type Diagnostic,
  type DraftMirror,
  EVENTS_NOTIFY,
  encodeLine,
  HOST_PROTOCOL_REVISIONS,
  type HomeConfig,
  type InstanceCapabilities,
  type InstanceInfo,
  LineSplitter,
  type LivePushParams,
  type LivePushResult,
  livePushMethod,
  type MethodDefinition,
  type MostraInitializeResult,
  mostraInitializeMethod,
  type PortAddressingExternalBaseParams,
  type PortAddressingExternalBaseResult,
  type PortIdentityResolveParams,
  type PortName,
  type PortSecretsGetParams,
  type PortTrustedControlsActivatedParams,
  type PublishReceipt,
  portAddressingExternalBaseMethod,
  portDraftsMirrorMethod,
  portIdentityResolveMethod,
  portSecretsGetMethod,
  portSubmissionsDeliverMethod,
  portTrustedControlsActivatedMethod,
  portTrustedControlsPolicyMethod,
  type Results,
  type ResultsMarkdown,
  RpcError,
  RpcPeer,
  receivable,
  resultsGetMethod,
  type ShareStartParams,
  type ShareStartResult,
  type ShareStopResult,
  type SourceRef,
  type StateGetResult,
  type StatePatchParams,
  type StatePatchResult,
  type SubmissionEnvelope,
  type SubmissionPolicy,
  type SubmissionsDeliverResult,
  type SubmitChannel,
  shareStartMethod,
  shareStopMethod,
  stateGetMethod,
  statePatchMethod,
  type VerifyVerdict,
  type ViewerSpec,
  type ViewUrlParams,
  viewUrlMethod,
  WAIT_MAX_MS,
  type WaitCondition,
  type WaitResult,
  waitMethod,
} from "@mostra/protocol";
import type { InstallProgress } from "./bundle/cache.ts";
import type { Environment } from "./bundle/setup.ts";
import { childEnvironment } from "./environment.ts";
import { type EventPage, type EventStreamOptions, openEventStream } from "./events.ts";
import { type Runtime, resolveRuntime } from "./runtime.ts";
import { sdkVersion } from "./version.ts";

/**
 * The ports a host may serve (INTERFACES §7). Each is optional and has a standalone default;
 * Mostra calls a port only on the instance this handle spawned, and every call is idempotent by
 * its stable ID, so a port may see the same call again after a crash.
 */
export interface Ports {
  /**
   * Names the person behind a link minted without a viewer, from the request's headers (D143):
   * `{ ref, name? }` (one viewer per `ref`), or `null` for the home's local user. Answer within
   * 5 s; a failure refuses the link rather than guess.
   */
  readonly identity?: {
    resolve(request: PortIdentityResolveParams): ViewerSpec | null | Promise<ViewerSpec | null>;
  };
  /** Receives each submission once it is durable (D58, D105). Answer within 30 s. */
  readonly submissions?: {
    deliver(
      envelope: SubmissionEnvelope,
    ): SubmissionsDeliverResult | Promise<SubmissionsDeliverResult>;
  };
  /** Receives each viewer draft's latest revision, best effort, never retried (IN-06). */
  readonly drafts?: { mirror(draft: DraftMirror): void | Promise<void> };
  /**
   * Gives one of an artifact's listeners an external address (HO-10, D158 item 6): the origin of
   * the host's own tunnel that forwards to `request.local`, which joins the links Mostra mints
   * and its Host allowlist; `null` keeps the loopback address, and withdraws one given before.
   * Answer within 5 s.
   */
  readonly addressing?: {
    externalBase(
      request: PortAddressingExternalBaseParams,
    ): PortAddressingExternalBaseResult | Promise<PortAddressingExternalBaseResult>;
  };
  /** Answers `secret()` first, before the home's store (D131); `null` falls back. */
  readonly secrets?: {
    get(request: PortSecretsGetParams): string | null | Promise<string | null>;
  };
  /** Decides each view's submit channels and trusted controls (D108). Answer within 5 s. */
  readonly trustedControls?: {
    policy(artifact: ArtifactSummary): ControlsPolicy | Promise<ControlsPolicy>;
    activated?(event: PortTrustedControlsActivatedParams): void | Promise<void>;
  };
}

/** Home settings a host chooses (INTERFACES §6 `HomeConfig`), kept in the home's `config.json`. */
export interface HomeSettings {
  /** The submission policy for artifacts whose publish names none (D102). */
  readonly submission?: SubmissionPolicy;
  /** The channels that may submit (D40, D108); absent, both. */
  readonly submitChannels?: readonly SubmitChannel[];
  /** How packages enter an artifact's lockfile (D43, D95). */
  readonly dependencies?: DependencyPolicy;
}

/** Options of {@link createMostra}. */
export interface MostraOptions {
  /** The home this host owns (D45). Created 0700 when missing. */
  readonly home: string;
  /**
   * Who the host is. The name owns the host's deliveries across restarts (D105), so keep it
   * stable; it defaults to `mostra-sdk`.
   */
  readonly client?: { readonly name: string; readonly version?: string };
  /** The ports this host serves. */
  readonly ports?: Ports;
  /**
   * Whether submissions made while this host is away wait for it (D105): the registered ports
   * are recorded as ports this host always provides. Default `true`; `false` leaves the home's
   * record as it is.
   */
  readonly expectPorts?: boolean;
  /** Home settings, kept in the home's `config.json` for every later client. */
  readonly settings?: HomeSettings;
  /** An extracted runtime bundle to use instead of the pinned one. */
  readonly bundle?: string;
  /** The gateway's bind address and URL host (D99); loopback by default. */
  readonly bind?: string;
  /** The host name URLs use, which a wildcard `bind` needs (D99). */
  readonly urlHost?: string;
  /** The instance's environment. Default: this process's. */
  readonly env?: Environment;
  /** Each line the instance logs (JSON, on its stderr). A callback that throws is ignored. */
  readonly onLog?: (line: string) => void;
  /** Progress of the first download or setup of the runtime bundle. A throw is ignored. */
  readonly onProgress?: (progress: InstallProgress) => void;
  /**
   * An exception a port threw; the instance got `MOSTRA_HOST_INTERNAL_ERROR` and will retry. A
   * callback that throws is ignored, and the instance is answered all the same.
   */
  readonly onPortError?: (error: unknown, method: string) => void;
  /** Gives up finding the runtime and starting the instance. */
  readonly signal?: AbortSignal;
}

/** How the instance ended. */
export interface InstanceExit {
  /** Its exit code: 0 after a clean stop. */
  readonly code: number | null;
  /** The signal that ended it, if one did. */
  readonly signal: NodeJS.Signals | null;
}

/** An artifact by ID (`art_…`), by source path, or as the protocol's reference. */
export type ArtifactInput = string | ArtifactRef;

/** A host's handle on its instance. */
export interface Mostra {
  /** The instance: release, home, platform, PID and mode. */
  readonly instance: InstanceInfo;
  /** What the instance serves. */
  readonly capabilities: InstanceCapabilities;
  /** The negotiated host protocol revision. */
  readonly revision: string;
  /** The session's warnings (an unsupported port, for example). */
  readonly warnings: readonly Diagnostic[];
  /** The runtime it runs on. */
  readonly runtime: Runtime;
  /** Resolves when the instance has exited, for whatever reason. */
  readonly closed: Promise<InstanceExit>;
  /** Calls any host protocol method by its definition from `@mostra/protocol`. */
  call<P, R>(method: MethodDefinition<P, R>, params: P, options?: CallOptions): Promise<R>;
  /** `artifact/publish`: verifies (D41) and publishes; durable before it resolves (H-07). */
  publish(
    source: ArtifactInput,
    options?: {
      readonly force?: boolean;
      readonly policy?: SubmissionPolicy;
      readonly requestId?: string;
    },
  ): Promise<PublishReceipt>;
  /** `artifact/verify`: one verdict, never a publish (D138). */
  verify(
    source: ArtifactInput,
    options?: { readonly screenshots?: "on-failure" | "always" | "never" },
  ): Promise<VerifyVerdict>;
  /**
   * `wait` (IN-10, D103): until the condition holds or `timeoutMs` passes (default: the longest
   * timer, about 24.8 days). `still_waiting` carries the cursor to wait from next; an aborted wait
   * rejects with the signal's reason and loses nothing.
   */
  wait(
    artifact: ArtifactInput,
    until: WaitCondition,
    options?: {
      readonly after?: string;
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<WaitResult>;
  /** `results/get`: a submission as JSON (the default) or Markdown (INTERFACES §8). */
  results(
    artifact: ArtifactInput,
    options?: { readonly submission?: string; readonly format?: "json" },
  ): Promise<Results>;
  /** `results/get` as Markdown, for an agent to read. */
  results(
    artifact: ArtifactInput,
    options: { readonly submission?: string; readonly format: "md" },
  ): Promise<ResultsMarkdown>;
  /** `state/get`: artifact-scoped fields (D63). */
  getState(artifact: ArtifactInput, ids?: readonly string[]): Promise<StateGetResult>;
  /** `state/patch`: writes artifact-scoped fields through compare-and-set (D63). */
  patchState(
    artifact: ArtifactInput,
    patch: Omit<StatePatchParams, "artifact">,
  ): Promise<StatePatchResult>;
  /** `live/push`: a live source's next value (D56). */
  pushLive(
    artifact: ArtifactInput,
    push: Omit<LivePushParams, "artifact">,
  ): Promise<LivePushResult>;
  /** `view/url`: a new capability link (D97). */
  viewUrl(
    artifact: ArtifactInput,
    options?: Omit<ViewUrlParams, "artifact">,
  ): Promise<CapabilityLink>;
  /**
   * `share/start`: opens the artifact through a tunnel this machine runs (D158): `tailnet`
   * (Tailscale Serve), or a public `funnel` or `cloudflare` share with a link that expires.
   */
  share(
    artifact: ArtifactInput,
    options: Omit<ShareStartParams, "artifact">,
  ): Promise<ShareStartResult>;
  /** `share/stop`: ends a share by its ID, and revokes its link. */
  stopShare(shareId: string): Promise<ShareStopResult>;
  /**
   * The events matching `options.filter`, page by page, in cursor order, with no gap across a
   * pause (`events/subscribe`). With a `name`, each page is acknowledged when the next one is
   * asked for, so a later stream of that name resumes after the last page handled.
   */
  events(options?: EventStreamOptions): AsyncIterable<EventPage>;
  /** Ends the instance: its stdio closes, and it is stopped if it doesn't exit within 10 s. */
  close(): Promise<InstanceExit>;
}

/** Options of one call. */
export interface CallOptions {
  /** Gives up after this many milliseconds with `MOSTRA_HOST_TIMEOUT`. Default: none. */
  readonly timeoutMs?: number;
}

/** The port methods the SDK serves, by port. */
const PORT_METHODS = {
  identity: [portIdentityResolveMethod],
  addressing: [portAddressingExternalBaseMethod],
  submissions: [portSubmissionsDeliverMethod],
  drafts: [portDraftsMirrorMethod],
  secrets: [portSecretsGetMethod],
  trustedControls: [portTrustedControlsPolicyMethod, portTrustedControlsActivatedMethod],
} as const satisfies Record<keyof Ports, readonly AnyMethod[]>;

/** The client name of an SDK host that names none. */
export const SDK_CLIENT_NAME = "mostra-sdk";

/** `art_…` is an artifact ID; anything else a source path, resolved against the working directory. */
export function artifactRef(input: ArtifactInput): ArtifactRef & SourceRef {
  if (typeof input !== "string") return input as ArtifactRef & SourceRef;
  return input.startsWith("art_") ? { artifactId: input } : { path: resolve(input) };
}

function closedError(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", { message }));
}

/** The handler for one port method, its params already checked. */
function portHandler(ports: Ports, method: string): ((params: unknown) => unknown) | undefined {
  switch (method) {
    case portIdentityResolveMethod.method:
      return (
        ports.identity && ((params) => ports.identity?.resolve(params as PortIdentityResolveParams))
      );
    case portAddressingExternalBaseMethod.method:
      return (
        ports.addressing &&
        ((params) => ports.addressing?.externalBase(params as PortAddressingExternalBaseParams))
      );
    case portSubmissionsDeliverMethod.method:
      return (
        ports.submissions && ((params) => ports.submissions?.deliver(params as SubmissionEnvelope))
      );
    case portDraftsMirrorMethod.method:
      return ports.drafts && ((params) => ports.drafts?.mirror(params as DraftMirror));
    case portSecretsGetMethod.method:
      return ports.secrets && ((params) => ports.secrets?.get(params as PortSecretsGetParams));
    case portTrustedControlsPolicyMethod.method:
      return (
        ports.trustedControls &&
        ((params) =>
          ports.trustedControls?.policy((params as { artifact: ArtifactSummary }).artifact))
      );
    case portTrustedControlsActivatedMethod.method:
      return (
        ports.trustedControls &&
        (async (params) => {
          await ports.trustedControls?.activated?.(params as PortTrustedControlsActivatedParams);
          return {};
        })
      );
    default:
      return undefined;
  }
}

/** The port names `ports` registers; anything unknown is a mistake worth failing on. */
function portNames(ports: Ports): PortName[] {
  const names: PortName[] = [];
  for (const [name, value] of Object.entries(ports)) {
    if (value === undefined) continue;
    if (!(name in PORT_METHODS)) {
      throw new TypeError(
        `createMostra: no port "${name}" (the SDK serves ${Object.keys(PORT_METHODS).join(", ")}).`,
      );
    }
    names.push(name as PortName);
  }
  return names;
}

/**
 * Ends the child: stdin closed (which stops it, D87), then SIGTERM after `graceMs`, then SIGKILL
 * after 5 s more. Windows has no signals between processes (D150 item 6): there the first of
 * them ends the process at once.
 */
function stopChild(
  child: ChildProcess,
  exited: Promise<InstanceExit>,
  graceMs: number,
): Promise<InstanceExit> {
  child.stdin?.end();
  const term = setTimeout(() => child.kill("SIGTERM"), graceMs);
  const kill = setTimeout(() => child.kill("SIGKILL"), graceMs + 5000);
  return exited.finally(() => {
    clearTimeout(term);
    clearTimeout(kill);
  });
}

/** `callback`, made unable to throw into its caller. */
function guarded<A extends unknown[]>(
  callback: ((...args: A) => void) | undefined,
): ((...args: A) => void) | undefined {
  if (callback === undefined) return undefined;
  return (...args: A) => {
    try {
      callback(...args);
    } catch {
      // The host's own code failed; Mostra's work goes on.
    }
  };
}

/**
 * Spawns an instance for `home` and opens its session. Rejects with the instance's own diagnostic
 * when it can't start (`MOSTRA_HOME_LOCKED`, `MOSTRA_PLATFORM_UNSUPPORTED` …), or with the
 * runtime's (`MOSTRA_ENV_BUNDLE_*`) when no verified runtime can be found.
 */
export async function createMostra(options: MostraOptions): Promise<Mostra> {
  // The host's callbacks run inside Mostra's own handlers (a pipe's data listener, the RPC
  // peer's error path, a download's progress): one that throws must never escape into the host's
  // process as an uncaught exception or unhandled rejection, nor stop an answer (Opus review
  // finding 6). A callback that throws is ignored.
  const onLog = guarded(options.onLog);
  const onProgress = guarded(options.onProgress);
  const onPortError = guarded(options.onPortError);
  const ports = options.ports ?? {};
  const names = portNames(ports);
  const env = options.env ?? process.env;
  const home = resolve(options.home);
  const runtime = await resolveRuntime({
    bundle: options.bundle,
    env,
    signal: options.signal,
    ...(onProgress ? { onProgress } : {}),
  });
  options.signal?.throwIfAborted();
  const args = [runtime.runtimeEntry, "host", "--home", home];
  if (options.bind !== undefined) args.push("--bind", options.bind);
  if (options.urlHost !== undefined) args.push("--url-host", options.urlHost);
  const child = spawn(runtime.node, args, {
    stdio: ["pipe", "pipe", "pipe"],
    // The host's environment, which on Windows keeps the system's own variables (D153).
    env: childEnvironment(env),
    // A Windows host with no console of its own (a desktop app) opens no window for its instance.
    windowsHide: true,
  });
  const logTail: string[] = [];
  const exited = new Promise<InstanceExit>((done) => {
    child.on("close", (code, signal) => done({ code, signal }));
    child.on("error", () => done({ code: null, signal: null }));
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  const errLines = new LineSplitter();
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    for (const line of errLines.push(chunk)) {
      logTail.push(line);
      if (logTail.length > 20) logTail.shift();
      onLog?.(line);
    }
  });

  const notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  const peer = new RpcPeer({
    send: (message) => {
      if (child.stdin?.writable) child.stdin.write(encodeLine(message));
    },
    onRequest: async (method, params) => {
      const definition = Object.values(PORT_METHODS)
        .flat()
        .find((candidate) => candidate.method === method) as
        | MethodDefinition<unknown, unknown>
        | undefined;
      const handler = definition && portHandler(ports, method);
      if (!definition || !handler) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
            message: `This host serves no method ${method}.`,
          }),
          -32601,
        );
      }
      // A newer instance may send enum values and union members this host's schemas don't
      // name yet (#45): the port's handler meets them, as it meets any value it can't act on.
      const parsed = receivable(definition.params).safeParse(params);
      if (!parsed.success) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
            message: `The params of ${method} don't match its schema.`,
          }),
          -32602,
        );
      }
      const answer = await handler(parsed.data);
      const checked = definition.result.safeParse(answer ?? null);
      if (!checked.success) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
            message: `The host's ${method} answered something its schema refuses.`,
          }),
        );
      }
      return checked.data;
    },
    onNotification: (method, params) => {
      for (const handler of notificationHandlers.get(method) ?? []) handler(params);
    },
    onInternalError: (error, method) => onPortError?.(error, method),
  });
  const lines = new LineSplitter();
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) peer.receiveLine(line);
  });
  child.stdout?.on("close", () => {
    peer.close(
      createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
        message: `The Mostra instance for ${home} exited${logTail.length > 0 ? `; its last log line: ${logTail.at(-1)}` : ""}.`,
      }),
    );
  });
  // A pipe to an instance that died fails its next write (EPIPE) on its own schedule. Without a
  // listener that error is an uncaught exception in the host's own process: every pipe has one,
  // and a write that failed ends the session at once, as the instance's exit does.
  child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
    peer.close(
      createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
        message: `The Mostra instance for ${home} stopped reading (${error.code ?? error.message}).`,
      }),
    );
  });
  child.stdout?.on("error", () => {});
  child.stderr?.on("error", () => {});

  const abort = (): void => {
    void stopChild(child, exited, 0);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const homeConfig: HomeConfig = {
    path: home,
    // What this host always provides, an empty list included: a host that stopped serving a port
    // clears the record, so its absence is never awaited (Opus review of WP-12, finding 7).
    ...(options.expectPorts !== false ? { ports: names } : {}),
    ...(options.settings?.submission ? { submission: options.settings.submission } : {}),
    ...(options.settings?.submitChannels
      ? { submitChannels: options.settings.submitChannels }
      : {}),
    ...(options.settings?.dependencies ? { dependencies: options.settings.dependencies } : {}),
  };
  let session: MostraInitializeResult;
  try {
    session = await peer.call(mostraInitializeMethod, {
      client: {
        name: options.client?.name ?? SDK_CLIENT_NAME,
        version: options.client?.version ?? sdkVersion(),
      },
      revisions: [...HOST_PROTOCOL_REVISIONS],
      capabilities: { notifications: [EVENTS_NOTIFY, ARTIFACT_PROGRESS] },
      ports: names,
      home: homeConfig,
    });
  } catch (error) {
    await stopChild(child, exited, 2000);
    if (spawnError) throw closedError(`Couldn't start ${runtime.node}: ${spawnError.message}`);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }

  const call = <P, R>(
    method: MethodDefinition<P, R>,
    params: P,
    callOptions?: CallOptions,
  ): Promise<R> =>
    peer.call(
      method,
      params,
      callOptions?.timeoutMs !== undefined ? { timeoutMs: callOptions.timeoutMs } : {},
    );
  let closing: Promise<InstanceExit> | undefined;

  const mostra: Mostra = {
    instance: session.instance,
    capabilities: session.capabilities,
    revision: session.revision,
    warnings: session.warnings,
    runtime,
    closed: exited,
    call,
    publish: (source, publishOptions = {}) =>
      call(artifactPublishMethod, { source: artifactRef(source), ...publishOptions }),
    verify: (source, verifyOptions = {}) =>
      call(artifactVerifyMethod, { source: artifactRef(source), ...verifyOptions }),
    wait: (artifact, until, waitOptions = {}) => {
      const signal = waitOptions.signal;
      // Checked before the request goes out: nothing is sent for a wait already given up, so no
      // answer is left without a handler (GPT review finding 4).
      if (signal?.aborted) return Promise.reject(signal.reason);
      const pending = call(waitMethod, {
        artifact: artifactRef(artifact),
        until,
        timeoutMs: waitOptions.timeoutMs ?? WAIT_MAX_MS,
        ...(waitOptions.after !== undefined ? { after: waitOptions.after } : {}),
      });
      if (!signal) return pending;
      // The instance's wait runs on until its own timeout; its late answer, or the connection's
      // end, is handled here and dropped.
      return new Promise<WaitResult>((done, fail) => {
        const onAbort = (): void => fail(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        pending.then(done, fail).finally(() => signal.removeEventListener("abort", onAbort));
      });
    },
    results: ((
      artifact: ArtifactInput,
      resultsOptions: { submission?: string; format?: "json" | "md" } = {},
    ) =>
      call(resultsGetMethod, {
        artifact: artifactRef(artifact),
        ...resultsOptions,
      })) as Mostra["results"],
    getState: (artifact, ids) =>
      call(stateGetMethod, { artifact: artifactRef(artifact), ...(ids ? { ids: [...ids] } : {}) }),
    patchState: (artifact, patch) =>
      call(statePatchMethod, { artifact: artifactRef(artifact), ...patch }),
    pushLive: (artifact, push) =>
      call(livePushMethod, { artifact: artifactRef(artifact), ...push }),
    viewUrl: (artifact, urlOptions = {}) =>
      call(viewUrlMethod, { artifact: artifactRef(artifact), ...urlOptions }),
    share: (artifact, shareOptions) =>
      call(shareStartMethod, { artifact: artifactRef(artifact), ...shareOptions }),
    stopShare: (shareId) => call(shareStopMethod, { shareId }),
    events: (streamOptions = {}) =>
      openEventStream(
        {
          call,
          onNotification: (handler) => {
            let set = notificationHandlers.get(EVENTS_NOTIFY);
            if (!set) {
              set = new Set();
              notificationHandlers.set(EVENTS_NOTIFY, set);
            }
            set.add(handler);
            return () => set?.delete(handler);
          },
          closed: exited.then(() => undefined),
        },
        streamOptions,
      ),
    close: () => {
      closing ??= stopChild(child, exited, 10_000);
      return closing;
    },
  };
  return mostra;
}
