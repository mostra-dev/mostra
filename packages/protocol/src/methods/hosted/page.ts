import * as z from "zod";
import { VersionId } from "../../ids.ts";
import { McpAppResourceMeta } from "../../mcp-apps.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { APP_PAGE_MAX_CHARS } from "../app/page.ts";

/** The params of `hosted/page` (INTERFACES §18.2, D175 item 8). */
export interface HostedPageParams {
  /** A version this owner pushed. */
  readonly versionId: string;
  /** Its MCP App, as `app/page` answers it on the owner. */
  readonly html: string;
  /** Its `_meta.ui`. */
  readonly meta: McpAppResourceMeta;
}

/** The result of `hosted/page`. */
export interface HostedPageResult {
  /** The SHA-256 of the page the hosted home keeps for the version. */
  readonly sha256: string;
}

const params: z.ZodType<HostedPageParams> = z
  .object({
    versionId: VersionId.schema,
    html: z.string().min(1).max(APP_PAGE_MAX_CHARS),
    meta: McpAppResourceMeta,
  })
  .register(wireRegistry, { id: "HostedPageParams" });

const result: z.ZodType<HostedPageResult> = z
  .object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) })
  .register(wireRegistry, { id: "HostedPageResult" });

/**
 * `hosted/page` (D175 item 8): an owner instance gives its hosted home the MCP App of a version it
 * pushed, so chat hosts show the page inline while the owner is away. Only the artifact's owner
 * link may; sending the same page again keeps one copy.
 */
export const hostedPageMethod: MethodDefinition<HostedPageParams, HostedPageResult> = defineMethod({
  method: "hosted/page",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
