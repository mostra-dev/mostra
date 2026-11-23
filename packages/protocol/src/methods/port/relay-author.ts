import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * What remote MCP may ask an owner instance to do for it (INTERFACES §18.8, D165 item 5): the
 * authoring methods of the host protocol, and the owner's workspace (`McpWorkspace`, its root and
 * its artifacts' files), verify's screenshots and a version's MCP App, which only that machine
 * holds or makes.
 */
export const RELAY_AUTHOR_METHODS = [
  "artifact/create",
  "artifact/verify",
  "artifact/publish",
  "artifact/get",
  "workspace/root",
  "workspace/allocate",
  "workspace/read",
  "workspace/apply",
  // A fingerprint of an artifact's files, so a verify answers only for its source (#157).
  "workspace/fingerprint",
  "verify/screenshot",
  // A review comment's crop, rendered by the owner's verify runner from what the hosted home sends
  // (WP-20, D182 item 4): `{ artifactId, versionId, threadId, viewId, viewerId, anchor, draft,
  // state }` → `{ png, width, height }`.
  "review/crop",
] as const;

/** One of {@link RELAY_AUTHOR_METHODS}. */
export type RelayAuthorMethod = (typeof RELAY_AUTHOR_METHODS)[number];

/** The params of `port/relay.author` (INTERFACES §18.3). */
export interface PortRelayAuthorParams {
  /** What to do on the owner instance. */
  readonly method: RelayAuthorMethod;
  /** Its params: the host protocol method's, or the workspace operation's. */
  readonly params: unknown;
}

/** The result of `port/relay.author`: the method's own result. */
export type PortRelayAuthorResult = unknown;

const params: z.ZodType<PortRelayAuthorParams> = z
  .object({ method: z.enum(RELAY_AUTHOR_METHODS), params: z.unknown() })
  .register(wireRegistry, { id: "PortRelayAuthorParams" });

const result: z.ZodType<PortRelayAuthorResult> = z
  .unknown()
  .register(wireRegistry, { id: "PortRelayAuthorResult" });

/**
 * `port/relay.author`: the remote MCP server relays an authoring step to the account's default
 * owner instance (D165 item 5), which runs it in its own workspace, builder and `verify`, and
 * answers its result or its diagnostic. A publish through it also hosts the version on the server
 * that asked and answers the hosted link. Workspace paths stay inside the owner's workspace.
 */
export const portRelayAuthorMethod: MethodDefinition<PortRelayAuthorParams, PortRelayAuthorResult> =
  defineMethod({
    method: "port/relay.author",
    direction: "instance-to-host",
    mutating: true,
    params,
    result,
  });
