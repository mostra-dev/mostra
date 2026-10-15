/**
 * What one view is (D104, D108): its artifact, version, policy, submit channels and trusted
 * controls. The browser protocol's frame ticket, the bridge's `ui/initialize` result and the
 * interaction core's channel policy share these shapes, so they live in a module of their own:
 * the bridge, which every version embeds, imports them without the interaction schemas.
 */
import * as z from "zod";
import { ArtifactId, VersionId, ViewId } from "./ids.ts";
import { SubmissionPolicy } from "./manifest.ts";
import { wireRegistry } from "./wire-registry.ts";

/** Where a submit came from (D40). */
export type SubmitChannel = "shell" | "artifact";

/** The Zod schema of the `SubmitChannel` type. */
export const SubmitChannel: z.ZodType<SubmitChannel> = z
  .enum(["shell", "artifact"])
  .register(wireRegistry, {
    id: "SubmitChannel",
    description: "Where a submit comes from: the shell's trusted Submit, or the artifact's code.",
  });

/**
 * A trusted control the shell renders outside the artifact's frame (D06, PRODUCT vocabulary):
 * Submit, Choose (review sets) and Approve. Open for later controls on the wire.
 */
export type TrustedControl = "submit" | "choose" | "approve" | (string & {});

/** The Zod schema of the `TrustedControl` type. */
export const TrustedControl: z.ZodType<TrustedControl> = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/)
  .register(wireRegistry, {
    id: "TrustedControl",
    description: "A trusted control the shell renders: submit, choose, approve; open for more.",
  });

/**
 * Which submit channels a view accepts and which trusted controls its shell renders (D40, D108):
 * the `trustedControls` port's answer, or the home's `HomeConfig.submitChannels`.
 */
export interface ControlsPolicy {
  /** The channels submissions may come through; at least one. */
  readonly submitChannels: readonly SubmitChannel[];
  /** The trusted controls the shell may render; absent: every control the artifact asks for. */
  readonly controls?: readonly TrustedControl[];
}

/** The Zod schema of the `ControlsPolicy` type. */
export const ControlsPolicy: z.ZodType<ControlsPolicy> = z
  .object({
    submitChannels: z.array(SubmitChannel).min(1).max(2).readonly(),
    controls: z.array(TrustedControl).max(32).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "ControlsPolicy",
    description:
      "Which submit channels a view accepts and which trusted controls its shell renders (D108).",
  });

/** A review set's ID: letters, digits, `_` and `-` (its choice is the field `review.<id>.choice`). */
export const REVIEW_SET_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,64}$/;

/** Where a client runtime runs (D111): Mostra's gateway, a static export, an MCP App, or `verify`. */
export type DeliveryTarget = "live" | "static" | "mcp-app" | "verify";

/** A version by ID and number. */
export interface VersionRef {
  /** The version's ID. */
  readonly id: string;
  /** Its number, for people. */
  readonly number: number;
}

/** The Zod schema of the `VersionRef` type. */
export const VersionRef: z.ZodType<VersionRef> = z
  .object({ id: VersionId.schema, number: z.int().min(1) })
  .register(wireRegistry, {
    id: "VersionRef",
    description: "A version by ID and number.",
  });

/**
 * What one view is (D104, D108): the shell learns it from its frame ticket and hands it to the
 * frame in `ui/initialize`'s result, so the client runtime names the view in every request and
 * knows what the host allows.
 */
export interface ViewContext {
  /** The artifact. */
  readonly artifactId: string;
  /** The view this frame load is; every mutation and submit names it (D104). */
  readonly viewId: string;
  /** The version the view shows. */
  readonly version: VersionRef;
  /** The artifact's latest version when the view opened. */
  readonly latest: VersionRef;
  /** The submission policy in force (D102). */
  readonly policy: SubmissionPolicy;
  /** The submit channels this view accepts (D108). */
  readonly submitChannels: readonly SubmitChannel[];
  /** The trusted controls the shell renders for this view (D108). */
  readonly controls: readonly TrustedControl[];
  /** Always `live` in a frame Mostra's shell hosts. */
  readonly target: DeliveryTarget;
}

/** The Zod schema of the `ViewContext` type. */
export const ViewContext: z.ZodType<ViewContext> = z
  .object({
    artifactId: ArtifactId.schema,
    viewId: ViewId.schema,
    version: VersionRef,
    latest: VersionRef,
    policy: SubmissionPolicy,
    submitChannels: z.array(SubmitChannel).min(1).max(2).readonly(),
    controls: z.array(TrustedControl).max(32).readonly(),
    target: z.enum(["live", "static", "mcp-app", "verify"]),
  })
  .register(wireRegistry, {
    id: "ViewContext",
    description:
      "What one view is: its artifact, view ID, version, latest version, policy, channels and controls.",
  });
