import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `dev/start` (INTERFACES §6, D140 item 12, VR-08). */
export interface DevStartParams {
  /** The artifact source to serve with hot reload. */
  readonly source: SourceRef;
  /** The loopback port for the dev page; one the operating system assigns when absent. */
  readonly port?: number;
}

/** The result of `dev/start`. */
export interface DevStartResult {
  /** The dev page, with the session's secret in its fragment (`#t=…`). Never a capability URL. */
  readonly url: string;
  /** The loopback port the dev page listens on. */
  readonly port: number;
  /** The session, for `dev/stop` and `dev/notify`. */
  readonly sessionId: string;
}

const params: z.ZodType<DevStartParams> = z
  .object({ source: SourceRef, port: z.int().min(1).max(65535).exactOptional() })
  .register(wireRegistry, { id: "DevStartParams" });

const result: z.ZodType<DevStartResult> = z
  .object({
    url: z.string().min(1),
    port: z.int().min(1).max(65535),
    sessionId: z.string().min(1),
  })
  .register(wireRegistry, { id: "DevStartResult", description: "A running dev session." });

/** The notification a dev session sends the connection that started it (D140 item 12). */
export const DEV_NOTIFY = "dev/notify";

/** What happened in a dev session. */
export type DevEventKind = "built" | "reloaded" | "server-restarted" | "submission" | "diagnostics";

/** The params of `dev/notify`. */
export interface DevNotifyParams {
  /** The session it happened in. */
  readonly sessionId: string;
  /** What happened. */
  readonly kind: DevEventKind;
  /** When it happened (RFC 3339, UTC). */
  readonly at: string;
  /** What the build or the server code reported (`built`, `diagnostics`, `server-restarted`). */
  readonly diagnostics?: readonly Diagnostic[];
  /** The changed files that caused it (`reloaded`, `server-restarted`), relative to the source. */
  readonly files?: readonly string[];
  /** A submission's Results JSON (INTERFACES §8), for `submission`; it was delivered nowhere. */
  readonly results?: unknown;
}

/** The Zod schema of `dev/notify`'s params. */
export const DevNotifyParams: z.ZodType<DevNotifyParams> = z
  .object({
    sessionId: z.string().min(1),
    kind: z.enum(["built", "reloaded", "server-restarted", "submission", "diagnostics"]),
    at: z.iso.datetime(),
    diagnostics: z.array(Diagnostic).readonly().exactOptional(),
    files: z.array(z.string()).readonly().exactOptional(),
    results: z.unknown().exactOptional(),
  })
  .register(wireRegistry, { id: "DevNotifyParams", description: "One event of a dev session." });

/**
 * `dev/start`: serves an artifact's source with Vite's hot module reload on its own loopback
 * port (VR-08, D140 item 12), with every server feature through a scratch sandbox like verify's:
 * nothing reaches the home's drafts, state, events, hosts or deliveries, and no capability URL
 * reaches it. The session belongs to this connection and ends when it closes or with `dev/stop`;
 * a client that accepts `dev/notify` receives its events.
 */
export const devStartMethod: MethodDefinition<DevStartParams, DevStartResult> = defineMethod({
  method: "dev/start",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
