import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { CapabilityScope, Duration } from "../../capability.ts";
import { TokenId, VersionId } from "../../ids.ts";
import { Viewer, ViewerSpec } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `view/url` (INTERFACES §6, D97). */
export interface ViewUrlParams {
  /** The artifact the link opens. */
  readonly artifact: ArtifactRef;
  /**
   * The version the link opens, by number or ID. Without it the link opens the artifact's latest
   * version whenever it is used.
   */
  readonly version?: number | string;
  /** What the link allows (D97). Default: every scope. `view` is always included. */
  readonly scopes?: readonly CapabilityScope[];
  /** How long the link works, such as `24h` or `7d`. Default: until it is revoked (D63). */
  readonly ttl?: Duration;
  /**
   * The person the link acts for (D104): its sessions draft, submit and sign as that viewer, so
   * `once` per-viewer gives each person one submission. Absent: the home's local user.
   */
  readonly viewer?: ViewerSpec;
  /** Makes retries idempotent: a repeated `requestId` returns the same link (H-03). */
  readonly requestId?: string;
}

/** A capability link: what `view/url` and `view/rotate` return. */
export interface CapabilityLink {
  /** The capability URL. Holding it is the authorization (D06); share it like a password. */
  readonly url: string;
  /** The token's ID, for `view/rotate` and `view/revoke`. Never a secret. */
  readonly tokenId: string;
  /** The scopes the link carries, `view` included. */
  readonly scopes: readonly CapabilityScope[];
  /** When the link stops working; absent when it works until revoked. */
  readonly expiresAt?: string;
  /** The viewer the link acts for, when it was minted with one (D104). */
  readonly viewer?: Viewer;
}

/** The result of `view/url`. */
export type ViewUrlResult = CapabilityLink;

/** The Zod schema of the `CapabilityLink` type. */
export const CapabilityLink: z.ZodType<CapabilityLink> = z
  .object({
    url: z.string().min(1),
    tokenId: TokenId.schema,
    scopes: z.array(CapabilityScope).readonly(),
    expiresAt: z.iso.datetime().exactOptional(),
    viewer: Viewer.exactOptional(),
  })
  .register(wireRegistry, {
    id: "CapabilityLink",
    description: "A capability URL with its token ID, scopes and expiry.",
  });

const params: z.ZodType<ViewUrlParams> = z
  .object({
    artifact: ArtifactRef,
    version: z.union([z.int().min(1), VersionId.schema]).exactOptional(),
    scopes: z.array(CapabilityScope).min(1).readonly().exactOptional(),
    ttl: Duration.exactOptional(),
    viewer: ViewerSpec.exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ViewUrlParams" });

/**
 * `view/url`: mints a new capability link to an artifact, with the scopes and lifetime asked for.
 * Each call mints a separate token that `view/revoke` ends on its own; the artifact's default link
 * is the publish receipt's `url`.
 */
export const viewUrlMethod: MethodDefinition<ViewUrlParams, ViewUrlResult> = defineMethod({
  method: "view/url",
  direction: "client-to-instance",
  mutating: true,
  params,
  result: CapabilityLink,
});
