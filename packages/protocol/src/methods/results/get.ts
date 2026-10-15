import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { SubmissionId } from "../../ids.ts";
import { Results } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `results/get` (INTERFACES §6, §8). */
export interface ResultsGetParams {
  /** The artifact whose submission to read. */
  readonly artifact: ArtifactRef;
  /** The submission to read; absent: the artifact's latest. */
  readonly submission?: string;
  /** `json` (the default): the Results structure; `md`: Markdown for agents to read. */
  readonly format?: "json" | "md";
}

/** Results rendered as Markdown (ROUND-2 §1.1). */
export interface ResultsMarkdown {
  /** The submission rendered. */
  readonly submissionId: string;
  /** The Markdown: a header with IDs, answers by label, choices, comments, actions, signals, orphans. */
  readonly markdown: string;
}

/** The result of `results/get`: the Results structure, or its Markdown for `format: "md"`. */
export type ResultsGetResult = Results | ResultsMarkdown;

const params: z.ZodType<ResultsGetParams> = z
  .object({
    artifact: ArtifactRef,
    submission: SubmissionId.schema.exactOptional(),
    format: z.enum(["json", "md"]).exactOptional(),
  })
  .register(wireRegistry, { id: "ResultsGetParams" });

/** The Zod schema of the `ResultsMarkdown` type. */
export const ResultsMarkdown: z.ZodType<ResultsMarkdown> = z
  .object({ submissionId: SubmissionId.schema, markdown: z.string() })
  .register(wireRegistry, {
    id: "ResultsMarkdown",
    description: "A submission's results as Markdown for agents.",
  });

const result: z.ZodType<ResultsGetResult> = z
  .union([Results, ResultsMarkdown])
  .register(wireRegistry, { id: "ResultsGetResult" });

/**
 * `results/get`: the complete submission (INTERFACES §8), as JSON or as Markdown. Fails with
 * `MOSTRA_SUBMIT_NOT_FOUND` when the artifact has no such submission yet.
 */
export const resultsGetMethod: MethodDefinition<ResultsGetParams, ResultsGetResult> = defineMethod({
  method: "results/get",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
