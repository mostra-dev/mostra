import * as z from "zod";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { Revision } from "../../revision.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * A host port name (INTERFACES §7). Port names are open strings on the wire, so an older instance
 * answers a newer port with a warning instead of refusing the session (D84). `ai` is reserved for
 * the AI port, which is not part of v1 (D46).
 */
export type PortName =
  | "identity"
  | "submissions"
  | "drafts"
  | "reviews"
  | "addressing"
  | "trustedControls"
  | "capture"
  | "secrets"
  | "pty"
  | "ai"
  | (string & {});

/** The Zod schema of the `PortName` type. */
export const PortName: z.ZodType<PortName, string> = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .register(wireRegistry, {
    id: "PortName",
    description:
      "A host port name: identity, submissions, drafts, reviews, addressing, trustedControls, capture, secrets, pty, or ai (reserved). Open for later ports.",
  });

/** The client that opens a connection. */
export interface ClientInfo {
  /** The client's name, for logs and status (`mostra-cli`, `jcode`). */
  readonly name: string;
  /** The client's own version. */
  readonly version: string;
}

/** What the client can handle (D84). */
export interface ClientCapabilities {
  /** Notification methods the client accepts. The instance sends no others. */
  readonly notifications?: readonly string[];
}

/**
 * Home settings from a spawning host (INTERFACES §6). Each setting arrives with the package that
 * implements it.
 */
export interface HomeConfig {
  /**
   * The home the client expects. A check, not a setting (D84): the instance chose and locked its
   * home at start-up, and refuses the session with `MOSTRA_HOME_MISMATCH` when this names a
   * different one.
   */
  readonly path?: string;
  /**
   * The dependency policy (D43, D95), kept in the home's `config.json` for every later client:
   * `auto` (the default) installs any package an artifact imports; `explicit` installs only what
   * `deps/add` adds and reports other imports as `MOSTRA_DEP_MISSING`.
   */
  readonly dependencies?: DependencyPolicy;
}

/** How packages enter an artifact's lockfile (D43). */
export type DependencyPolicy = "auto" | "explicit";

/** The Zod schema of the `DependencyPolicy` type. */
export const DependencyPolicy: z.ZodType<DependencyPolicy> = z
  .enum(["auto", "explicit"])
  .register(wireRegistry, {
    id: "DependencyPolicy",
    description:
      "How packages enter an artifact's lockfile: auto installs what artifacts import; explicit only what deps/add adds (D43).",
  });

/** The params of `mostra/initialize` (INTERFACES §6). */
export interface MostraInitializeParams {
  /** Who is connecting. */
  readonly client: ClientInfo;
  /**
   * The host protocol revisions the client speaks. The instance picks the newest one it also
   * supports, or refuses with `MOSTRA_HOST_REVISION_UNSUPPORTED`. Entries that aren't revisions
   * never match.
   */
  readonly revisions: readonly string[];
  /** What the client can handle. */
  readonly capabilities: ClientCapabilities;
  /**
   * Ports the client implements. The instance calls a port only on the connection that registered
   * it; ports it doesn't support get a `MOSTRA_HOST_PORT_UNSUPPORTED` warning.
   */
  readonly ports: readonly PortName[];
  /** Home settings and the home check. */
  readonly home?: HomeConfig;
}

/** The instance a client is connected to. */
export interface InstanceInfo {
  /** The runtime release (`@mostra/runtime` version). */
  readonly version: string;
  /** The home's real path. */
  readonly home: string;
  /** The platform as `<os>-<arch>`, for example `darwin-arm64`. */
  readonly platform: string;
  /** The supervisor's process ID. */
  readonly pid: number;
  /** `host` when spawned over stdio (`mostra-runtime host`), `daemon` when started as a daemon. */
  readonly mode: "host" | "daemon";
}

/** What the instance offers (D84). */
export interface InstanceCapabilities {
  /** Every method the instance serves. */
  readonly methods: readonly string[];
  /** Every notification the instance may send. */
  readonly notifications: readonly string[];
  /** The ports the instance calls when a client registers them. */
  readonly ports: readonly PortName[];
}

/** The result of `mostra/initialize`. */
export interface MostraInitializeResult {
  /** The negotiated host protocol revision: the newest both sides support. */
  readonly revision: Revision;
  /** The instance the client is connected to. */
  readonly instance: InstanceInfo;
  /** What the instance offers. */
  readonly capabilities: InstanceCapabilities;
  /** Warnings about the session, such as ports the instance doesn't support. */
  readonly warnings: readonly Diagnostic[];
}

/** The Zod schema of the `ClientInfo` type. */
export const ClientInfo: z.ZodType<ClientInfo> = z
  .object({ name: z.string().min(1), version: z.string() })
  .register(wireRegistry, { id: "ClientInfo", description: "The client that opens a connection." });

/** The Zod schema of the `ClientCapabilities` type. */
export const ClientCapabilities: z.ZodType<ClientCapabilities> = z
  .object({ notifications: z.array(z.string()).readonly().exactOptional() })
  .register(wireRegistry, {
    id: "ClientCapabilities",
    description: "What the client can handle: the notification methods it accepts.",
  });

/** The Zod schema of the `HomeConfig` type. */
export const HomeConfig: z.ZodType<HomeConfig> = z
  .object({
    path: z.string().min(1).exactOptional(),
    dependencies: DependencyPolicy.exactOptional(),
  })
  .register(wireRegistry, {
    id: "HomeConfig",
    description:
      "Home settings from a spawning host; path is a check against the instance's home (D84), dependencies the dependency policy (D43).",
  });

/** The Zod schema of the `InstanceInfo` type. */
export const InstanceInfo: z.ZodType<InstanceInfo> = z
  .object({
    version: z.string(),
    home: z.string(),
    platform: z.string(),
    pid: z.int().min(1),
    mode: z.enum(["host", "daemon"]),
  })
  .register(wireRegistry, {
    id: "InstanceInfo",
    description: "The instance a client is connected to.",
  });

/** The Zod schema of the `InstanceCapabilities` type. */
export const InstanceCapabilities: z.ZodType<InstanceCapabilities> = z
  .object({
    methods: z.array(z.string()).readonly(),
    notifications: z.array(z.string()).readonly(),
    ports: z.array(PortName).readonly(),
  })
  .register(wireRegistry, {
    id: "InstanceCapabilities",
    description: "What the instance offers: methods, notifications and supported ports.",
  });

const params: z.ZodType<MostraInitializeParams> = z
  .object({
    client: ClientInfo,
    revisions: z.array(z.string()).readonly(),
    capabilities: ClientCapabilities,
    ports: z.array(PortName).readonly(),
    home: HomeConfig.exactOptional(),
  })
  .register(wireRegistry, { id: "MostraInitializeParams" });

const result: z.ZodType<MostraInitializeResult> = z
  .object({
    revision: Revision.schema,
    instance: InstanceInfo,
    capabilities: InstanceCapabilities,
    warnings: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, { id: "MostraInitializeResult" });

/**
 * `mostra/initialize`: opens a session. It must be the first request on a connection and is sent
 * once. It negotiates the protocol revision, registers the client's ports on this connection and
 * checks the home (D59, D84).
 */
export const mostraInitializeMethod: MethodDefinition<
  MostraInitializeParams,
  MostraInitializeResult
> = defineMethod({
  method: "mostra/initialize",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
