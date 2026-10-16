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

/**
 * A view as a page reads it from `ui/initialize` (Claude review finding 5): every published
 * version embeds the page's reader, so it takes values a later Mostra may add (a channel, a
 * policy, a target) without refusing the whole view; {@link readViewContext} reads them safely.
 */
export interface ViewContextWire {
  /** The artifact. */
  readonly artifactId: string;
  /** The view this frame load is (D104). */
  readonly viewId: string;
  /** The version the view shows. */
  readonly version: VersionRef;
  /** The artifact's latest version when the view opened. */
  readonly latest: VersionRef;
  /** The submission policy in force (D102); a later policy or scope is read as `once` per viewer. */
  readonly policy: {
    /** `once`, `epochs`, `none`, or one a later release adds. */
    readonly policy: string;
    /** `per-artifact` or `per-viewer` under `once`, or one a later release adds. */
    readonly scope?: string;
  };
  /** The submit channels the view accepts (D108); channels this release doesn't know are not allowed. */
  readonly submitChannels: readonly string[];
  /** The trusted controls the shell renders for the view (D108). */
  readonly controls: readonly string[];
  /** Where the page runs (D111); a target this release doesn't know is read as `live`. */
  readonly target: string;
}

/** The Zod schema of the `ViewContextWire` type: open where later revisions may add values. */
export const ViewContextWire: z.ZodType<ViewContextWire> = z.looseObject({
  artifactId: ArtifactId.schema,
  viewId: ViewId.schema,
  version: VersionRef,
  latest: VersionRef,
  policy: z.looseObject({ policy: z.string(), scope: z.string().exactOptional() }),
  submitChannels: z.array(z.string()).max(16).readonly(),
  controls: z.array(z.string()).max(32).readonly(),
  target: z.string(),
}) as z.ZodType<ViewContextWire>;

const CONTROL_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The view a page acts on, with every value this release doesn't know read the safe way: an
 * unknown channel isn't allowed (the shell's stays), an unknown policy or `once` scope is read as
 * `once` per viewer (the page may submit and the server decides; it closes on its own submission
 * only), and an unknown target as `live`.
 */
export function readViewContext(wire: ViewContextWire): ViewContext {
  const channels = (["shell", "artifact"] as const).filter((channel) =>
    wire.submitChannels.includes(channel),
  );
  const { policy: name, scope } = wire.policy;
  const policy: SubmissionPolicy =
    name === "none"
      ? { policy: "none" }
      : name === "epochs"
        ? { policy: "epochs" }
        : name === "once" && (scope === undefined || scope === "per-artifact")
          ? { policy: "once", scope: "per-artifact" }
          : { policy: "once", scope: "per-viewer" };
  const target = (["live", "static", "mcp-app", "verify"] as const).find(
    (known) => known === wire.target,
  );
  return {
    artifactId: wire.artifactId,
    viewId: wire.viewId,
    version: wire.version,
    latest: wire.latest,
    policy,
    submitChannels: channels.length > 0 ? channels : ["shell"],
    controls: wire.controls.filter((control) => CONTROL_NAME.test(control)),
    target: target ?? "live",
  };
}
