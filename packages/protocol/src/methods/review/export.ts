import * as z from "zod";
import { AbsolutePath, ArtifactRef } from "../../artifact.ts";
import { ArtifactId, SubmissionId } from "../../ids.ts";
import { ResultComment, Viewer } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `review/export` (INTERFACES §6, RV-05). */
export interface ReviewExportParams {
  /** The artifact whose review to export. */
  readonly artifact: ArtifactRef;
  /**
   * A submission whose comments and choices to export, as it carried them; absent: every thread of
   * the artifact as it stands now, every viewer's, and each viewer's choices.
   */
  readonly submission?: string;
  /** `md` (the default): Markdown for agents to read; `json`: the `ReviewExport` structure. */
  readonly format?: "md" | "json";
  /**
   * A directory to write into: `review.md` or `review.json`, and each captured crop as
   * `crops/<threadId>.png`, which the document names relative to it. Absent: the document is the
   * answer's `content`, and crop paths name the files in the home.
   */
  readonly out?: string;
}

/** A review as `review/export` writes it in JSON. */
export interface ReviewExport {
  /** The artifact, as its latest version names it. */
  readonly artifact: { readonly id: string; readonly title: string };
  /** The submission exported, when one was named. */
  readonly submission?: {
    readonly id: string;
    readonly at: string;
    readonly viewer: Viewer;
    readonly version: number;
  };
  /** The review sets' choices (D65). */
  readonly choices: readonly {
    readonly reviewSetId: string;
    readonly candidateId: string;
    readonly label?: string;
    /** Whose choice it is, in an export of the artifact as it stands. */
    readonly viewer?: Viewer;
  }[];
  /** The comment threads with every anchor layer and their crops' paths (RV-05). */
  readonly comments: readonly ResultComment[];
}

/** The Zod schema of the `ReviewExport` type. */
export const ReviewExport: z.ZodType<ReviewExport> = z
  .object({
    artifact: z.object({ id: ArtifactId.schema, title: z.string() }),
    submission: z
      .object({
        id: SubmissionId.schema,
        at: z.iso.datetime(),
        viewer: Viewer,
        version: z.int().min(1),
      })
      .exactOptional(),
    choices: z
      .array(
        z.object({
          reviewSetId: z.string(),
          candidateId: z.string(),
          label: z.string().exactOptional(),
          viewer: Viewer.exactOptional(),
        }),
      )
      .readonly(),
    comments: z.array(ResultComment).readonly(),
  })
  .register(wireRegistry, {
    id: "ReviewExport",
    description:
      "An artifact's review for agents: its choices and comment threads with every anchor layer and crop path.",
  });

/** The result of `review/export`. */
export interface ReviewExportResult {
  /** The format written. */
  readonly format: "md" | "json";
  /** How many threads and how many crops the export holds. */
  readonly threads: number;
  /** How many of them have a captured crop. */
  readonly crops: number;
  /** The document written, with `out`. */
  readonly path?: string;
  /** The document itself, without `out`. */
  readonly content?: string;
}

const params: z.ZodType<ReviewExportParams> = z
  .object({
    artifact: ArtifactRef,
    submission: SubmissionId.schema.exactOptional(),
    format: z.enum(["md", "json"]).exactOptional(),
    out: AbsolutePath.exactOptional(),
  })
  .register(wireRegistry, { id: "ReviewExportParams" });

const result: z.ZodType<ReviewExportResult> = z
  .object({
    format: z.enum(["md", "json"]),
    threads: z.int().min(0),
    crops: z.int().min(0),
    path: z.string().exactOptional(),
    content: z.string().exactOptional(),
  })
  .register(wireRegistry, { id: "ReviewExportResult" });

/**
 * `review/export`: an artifact's review for agents, as Markdown or JSON (RV-05): its choices and
 * comment threads with every anchor layer and the path of each crop, written into a directory with
 * the crops beside it, or returned as text. Fails with `MOSTRA_SUBMIT_NOT_FOUND` for a submission
 * the artifact doesn't have.
 */
export const reviewExportMethod: MethodDefinition<ReviewExportParams, ReviewExportResult> =
  defineMethod({
    method: "review/export",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
