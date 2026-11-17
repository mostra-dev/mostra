import * as z from "zod";
import { ArtifactId, VersionId } from "../../ids.ts";
import { McpAppResourceMeta } from "../../mcp-apps.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The longest MCP App page an instance answers: one self-contained HTML document (16 MiB). */
export const APP_PAGE_MAX_CHARS: number = 16 * 1024 * 1024;

/** The params of `app/page` (INTERFACES §6, D175 items 1, 4). */
export interface AppPageParams {
  /** The version whose MCP App to answer. */
  readonly versionId: string;
}

/** The result of `app/page`: the version's MCP App, as its `ui://` resource carries it. */
export interface AppPageResult {
  /** The artifact the version belongs to. */
  readonly artifactId: string;
  /** Its `ui://mostra/view/<versionId>` URI. */
  readonly uri: string;
  /** The single-file HTML5 document. */
  readonly html: string;
  /** Its `_meta.ui`: the origins it declares and its border preference. */
  readonly meta: McpAppResourceMeta;
}

const params: z.ZodType<AppPageParams> = z
  .object({ versionId: VersionId.schema })
  .register(wireRegistry, { id: "AppPageParams" });

const result: z.ZodType<AppPageResult> = z
  .object({
    artifactId: ArtifactId.schema,
    uri: z.string().min(1).max(128),
    html: z.string().min(1).max(APP_PAGE_MAX_CHARS),
    meta: McpAppResourceMeta,
  })
  .register(wireRegistry, { id: "AppPageResult" });

/**
 * `app/page` (D175 items 1, 4): a version's MCP App, exported by the `mcp-app` exporter (the
 * bundled first-party plugin unless the home or the artifact has its own) and kept by version.
 * A hosted home makes its own, from the version's client files it holds, with the exporter Mostra
 * carries, and keeps it.
 */
export const appPageMethod: MethodDefinition<AppPageParams, AppPageResult> = defineMethod({
  method: "app/page",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
