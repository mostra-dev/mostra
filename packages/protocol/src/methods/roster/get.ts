import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { Roster } from "../../team.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `roster/get` (INTERFACES §6, D168). */
export interface RosterGetParams {
  /** The artifact. */
  readonly artifact: ArtifactRef;
}

/** The result of `roster/get`: the whole roster, whatever the visibility policy (CO-07). */
export type RosterGetResult = Roster;

const params: z.ZodType<RosterGetParams> = z
  .object({ artifact: ArtifactRef })
  .register(wireRegistry, { id: "RosterGetParams" });

/**
 * `roster/get`: every expected respondent with their status in the current round (CO-03), the
 * round, whether it is complete and its counts. Agents and hosts always read all of it (CO-07).
 */
export const rosterGetMethod: MethodDefinition<RosterGetParams, RosterGetResult> = defineMethod({
  method: "roster/get",
  direction: "client-to-instance",
  mutating: false,
  params,
  result: Roster,
});
