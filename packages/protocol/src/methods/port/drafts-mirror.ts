import * as z from "zod";
import { ArtifactId, ViewerId } from "../../ids.ts";
import { DocumentRevision } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** A viewer's draft, mirrored to a host as it changes (INTERFACES §7, D105). */
export interface DraftMirror {
  /** Always `draft`: a mirror is never a submission (IN-06). */
  readonly kind: "draft";
  /** The artifact. */
  readonly artifactId: string;
  /** Whose draft it is. */
  readonly viewerId: string;
  /** The draft's epoch (D103). */
  readonly epoch: number;
  /** The draft's revision; a later mirror has a higher one. */
  readonly revision: DocumentRevision;
  /** Every field of the draft by ID. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The result of `port/drafts.mirror`. */
export type DraftsMirrorResult = unknown;

/** The Zod schema of the `DraftMirror` type. */
export const DraftMirror: z.ZodType<DraftMirror> = z
  .object({
    kind: z.literal("draft"),
    artifactId: ArtifactId.schema,
    viewerId: ViewerId.schema,
    epoch: z.int().min(1),
    revision: DocumentRevision,
    fields: z.record(z.string(), z.unknown()),
  })
  .register(wireRegistry, {
    id: "DraftMirror",
    description: "A viewer's draft mirrored to a host: always kind draft, never a submission.",
  });

/**
 * `port/drafts.mirror`: Mostra sends the latest revision of a viewer's draft to a host that
 * registered the drafts port, best effort (D105). Mostra's ledger stays canonical (D58).
 */
export const portDraftsMirrorMethod: MethodDefinition<DraftMirror, DraftsMirrorResult> =
  defineMethod({
    method: "port/drafts.mirror",
    direction: "instance-to-host",
    mutating: false,
    params: DraftMirror,
    result: z.unknown(),
  });
