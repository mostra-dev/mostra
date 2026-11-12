import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { Cursor } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { type ResultsGetResult, ResultsGetResult as ResultsGetResultSchema } from "./get.ts";

/** The most submissions one `results/list` answer carries. */
export const RESULTS_LIST_MAX = 100;

/** The params of `results/list` (INTERFACES §6, §8, D168). */
export interface ResultsListParams {
  /** The artifact whose submissions to read. */
  readonly artifact: ArtifactRef;
  /** Only submissions made after this cursor; absent: from the first. */
  readonly after?: string;
  /** At most this many, oldest first (1 to 100, default 100). */
  readonly limit?: number;
  /** `json` (the default): the Results structure of each; `md`: each as Markdown. */
  readonly format?: "json" | "md";
}

/** The result of `results/list`. */
export interface ResultsListResult {
  /** The submissions, oldest first, each as `results/get` gives it. */
  readonly results: readonly ResultsGetResult[];
  /** The cursor to read on from: the last submission's, or `after` when none came. */
  readonly cursor: string;
  /** Whether more submissions follow the cursor. */
  readonly more: boolean;
}

const params: z.ZodType<ResultsListParams> = z
  .object({
    artifact: ArtifactRef,
    after: Cursor.schema.exactOptional(),
    limit: z.int().min(1).max(RESULTS_LIST_MAX).exactOptional(),
    format: z.enum(["json", "md"]).exactOptional(),
  })
  .register(wireRegistry, { id: "ResultsListParams" });

const result: z.ZodType<ResultsListResult> = z
  .object({
    results: z.array(ResultsGetResultSchema).readonly(),
    cursor: Cursor.schema,
    more: z.boolean(),
  })
  .register(wireRegistry, { id: "ResultsListResult" });

/**
 * `results/list`: every submission of an artifact after a cursor, oldest first, as `results/get`
 * gives each (J14: all five answers once the roster completed). Page on with `cursor` while `more`.
 */
export const resultsListMethod: MethodDefinition<ResultsListParams, ResultsListResult> =
  defineMethod({
    method: "results/list",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
