import * as z from "zod";
import { ArtifactId, ViewId } from "../../ids.ts";
import { Viewer } from "../../interaction.ts";
import { SubmissionPolicy } from "../../manifest.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { SubmitChannel, TrustedControl, VersionRef, type ViewContext } from "../../view.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `app/open` (INTERFACES §6, D175 item 4). */
export interface AppOpenParams {
  /** The artifact the link opens. */
  readonly artifactId: string;
  /** The link's secret: the `t` of its URL's fragment (`…#t=<secret>`). Holding it authorizes. */
  readonly token: string;
  /** A version to open by number, which a link pinned to another refuses (D97 item 9). */
  readonly version?: number;
}

/**
 * The result of `app/open`: the view this inline page is (D104), as a frame ticket names it, and
 * the app session its later `app/request` calls carry.
 */
export interface AppOpenResult extends ViewContext {
  /** The app session's secret (26 characters): only the page holds it. */
  readonly session: string;
  /** The link's scopes (D97): without `draft` the page saves nothing, without `submit` submits nothing. */
  readonly scopes: readonly string[];
  /** The viewer the page acts as (D104). */
  readonly viewer: Viewer;
  /** Whether this viewer follows the artifact's new versions (D63). */
  readonly follow: boolean;
  /** Whether the link opens this version only (D97 item 9). */
  readonly pinned: boolean;
  /** The version's server code keeps crashing and is parked (WP-08): its actions won't run. */
  readonly serverParked?: true;
  /** The artifact is paused (D165 item 14): it takes no submissions and runs no actions. */
  readonly paused?: { readonly by: "owner" | "operator"; readonly reason?: string };
}

const params: z.ZodType<AppOpenParams> = z
  .object({
    artifactId: ArtifactId.schema,
    token: z.string().min(1).max(256),
    version: z.int().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "AppOpenParams" });

const result: z.ZodType<AppOpenResult> = z
  .object({
    artifactId: ArtifactId.schema,
    viewId: ViewId.schema,
    version: VersionRef,
    latest: VersionRef,
    policy: SubmissionPolicy,
    submitChannels: z.array(SubmitChannel).min(1).max(2).readonly(),
    controls: z.array(TrustedControl).max(32).readonly(),
    target: z.enum(["live", "static", "mcp-app", "verify"]),
    session: z.string().length(26),
    scopes: z.array(z.string()).max(256).readonly(),
    viewer: Viewer,
    follow: z.boolean(),
    pinned: z.boolean(),
    serverParked: z.literal(true).exactOptional(),
    paused: z
      .object({
        by: z.enum(["owner", "operator"]),
        reason: z.string().max(500).exactOptional(),
      })
      .exactOptional(),
  })
  .register(wireRegistry, {
    id: "AppOpenResult",
    description: "An inline page's view (target mcp-app) and the app session it acts through.",
  });

/**
 * `app/open` (D175 item 4): an inline page, shown by an MCP Apps host, opens a view through its
 * link, as a browser's shell does with its frame ticket. The link's secret authorizes (D06),
 * refused as the shell's exchange refuses it; the answer is the view and an app session.
 */
export const appOpenMethod: MethodDefinition<AppOpenParams, AppOpenResult> = defineMethod({
  method: "app/open",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
