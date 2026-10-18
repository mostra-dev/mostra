import * as z from "zod";
import { ArtifactId, VersionId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** Event compaction, which `gc/run` does only when asked (D47, DATA_MODEL §4). */
export interface GcCompactEvents {
  /** Compact every artifact's events before this cursor. */
  readonly before: string;
}

/** The params of `gc/run` (INTERFACES §6, D140 item 18). */
export interface GcRunParams {
  /** List what a run would remove, and remove nothing. */
  readonly dryRun?: boolean;
  /** Also compact events before a cursor (`mostra gc --compact-events --before <cursor>`). */
  readonly compactEvents?: GcCompactEvents;
}

/** One version gc collects, or would: its files go, its row, ID and number stay (D140). */
export interface GcVersion {
  /** Its artifact. */
  readonly artifactId: string;
  /** Its ID, which stays in the ledger. */
  readonly versionId: string;
  /** Its number, which stays too. */
  readonly number: number;
  /** The bytes its directory holds. */
  readonly bytes: number;
}

/** What one kind of collection reclaims. */
export interface GcCount {
  /** How many items. */
  readonly count: number;
  /** How many bytes. */
  readonly bytes: number;
}

/** What event compaction did, per artifact. */
export interface GcCompacted {
  /** The artifacts whose events were compacted, with how many events each lost. */
  readonly artifacts: readonly { readonly artifactId: string; readonly removed: number }[];
  /** Every event removed. */
  readonly removed: number;
}

/** The result of `gc/run`: what it removed, or with `dryRun` what it would remove. */
export interface GcRunResult {
  /** Whether this was a dry run: then nothing was removed. */
  readonly dryRun: boolean;
  /** The unreferenced versions whose files go. */
  readonly versions: readonly GcVersion[];
  /** Source snapshots no kept version uses. */
  readonly snapshots: GcCount;
  /** Lock layouts in `deps/locks` no working lockfile and no kept version names (D95, D135). */
  readonly lockLayouts: GcCount;
  /** Packages `pnpm store prune` removes from the shared store. */
  readonly storePackages: GcCount;
  /** Build caches past the 5 GB cap, and verify's files no cached verdict names. */
  readonly caches: GcCount;
  /** Every byte reclaimed. */
  readonly bytes: number;
  /** Present when `compactEvents` was given. */
  readonly compacted?: GcCompacted;
}

const count = z.object({ count: z.int().min(0), bytes: z.int().min(0) });

const params: z.ZodType<GcRunParams> = z
  .object({
    dryRun: z.boolean().exactOptional(),
    compactEvents: z.object({ before: z.string().regex(/^[0-9]+$/) }).exactOptional(),
  })
  .register(wireRegistry, { id: "GcRunParams" });

const result: z.ZodType<GcRunResult> = z
  .object({
    dryRun: z.boolean(),
    versions: z
      .array(
        z.object({
          artifactId: ArtifactId.schema,
          versionId: VersionId.schema,
          number: z.int().min(1),
          bytes: z.int().min(0),
        }),
      )
      .readonly(),
    snapshots: count,
    lockLayouts: count,
    storePackages: count,
    caches: count,
    bytes: z.int().min(0),
    compacted: z
      .object({
        artifacts: z
          .array(z.object({ artifactId: ArtifactId.schema, removed: z.int().min(0) }))
          .readonly(),
        removed: z.int().min(0),
      })
      .exactOptional(),
  })
  .register(wireRegistry, { id: "GcRunResult", description: "What gc reclaimed." });

/**
 * `gc/run`: collects what nothing references (VR-06, D47, D140): versions' files (each keeps its
 * ledger row as a tombstone), unused source snapshots, lock layouts, the shared store's unused
 * packages and caches; with `compactEvents`, it also compacts events before a cursor. A dry run
 * lists exactly what a real run removes. It runs one at a time with publish, verify and installs.
 */
export const gcRunMethod: MethodDefinition<GcRunParams, GcRunResult> = defineMethod({
  method: "gc/run",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
