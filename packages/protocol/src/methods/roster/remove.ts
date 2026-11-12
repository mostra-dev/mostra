import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { ROSTER_MAX, Roster } from "../../team.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `roster/remove` (INTERFACES §6, D168). */
export interface RosterRemoveParams {
  /** The artifact. */
  readonly artifact: ArtifactRef;
  /** The respondents no longer expected, by `ref`; unknown ones are ignored. */
  readonly refs: readonly string[];
  /** Makes retries idempotent (H-03). */
  readonly requestId?: string;
}

/** The result of `roster/remove`. */
export interface RosterRemoveResult {
  /** The roster after the change. */
  readonly roster: Roster;
  /** The refs that were on the roster and left it. */
  readonly removed: readonly string[];
}

const params: z.ZodType<RosterRemoveParams> = z
  .object({
    artifact: ArtifactRef,
    refs: z.array(z.string().min(1).max(256)).min(1).max(ROSTER_MAX).readonly(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "RosterRemoveParams" });

const result: z.ZodType<RosterRemoveResult> = z
  .object({ roster: Roster, removed: z.array(z.string()).readonly() })
  .register(wireRegistry, { id: "RosterRemoveResult" });

/**
 * `roster/remove`: stops expecting answers from people (D168). Their personal links keep working
 * until revoked (`view/revoke`), and their drafts and submissions stay. Appends `roster.changed`,
 * and `roster.completed` when everyone still expected has answered.
 */
export const rosterRemoveMethod: MethodDefinition<RosterRemoveParams, RosterRemoveResult> =
  defineMethod({
    method: "roster/remove",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
