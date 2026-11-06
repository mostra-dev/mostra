import * as z from "zod";
import { SubmissionId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { SubmissionEnvelope } from "../port/submissions-deliver.ts";

/** The params of `hosted/submission` (INTERFACES §18.2). */
export interface HostedSubmissionParams {
  /** The hosted submission the owner instance is missing. */
  readonly submissionId: string;
}

/** The result of `hosted/submission`: the submission as its delivery to this owner carries it. */
export type HostedSubmissionResult = SubmissionEnvelope;

const params: z.ZodType<HostedSubmissionParams> = z
  .object({ submissionId: SubmissionId.schema })
  .register(wireRegistry, { id: "HostedSubmissionParams" });

/**
 * `hosted/submission`: an owner instance reads one of its artifacts' hosted submissions again,
 * with its snapshot, when it follows a `submission.created` it doesn't hold (its home was restored
 * from a backup taken before it, FAILURE_MODEL §11.2), and imports it as a delivery would.
 */
export const hostedSubmissionMethod: MethodDefinition<
  HostedSubmissionParams,
  HostedSubmissionResult
> = defineMethod({
  method: "hosted/submission",
  direction: "client-to-instance",
  mutating: false,
  params,
  result: SubmissionEnvelope,
});
