/**
 * The manifest's `team` settings (D168): a module of its own, with no other import of the
 * protocol, so the manifest reads them without the team wire types.
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

/**
 * What viewers see of each other's respondent status and presence (CO-07, D168): `private` (their
 * own entry only), `counts` (their own entry and how many stand where), `names` (everyone's name and
 * status). The manifest's `team.visibility`; owners, agents and hosts always see everything.
 */
export type TeamVisibility = "private" | "counts" | "names";

/** The Zod schema of the `TeamVisibility` type. */
export const TeamVisibility: z.ZodType<TeamVisibility> = z
  .enum(["private", "counts", "names"])
  .register(wireRegistry, {
    id: "TeamVisibility",
    description: "What viewers see of each other: private, counts or names (D168).",
  });

/** The visibility an artifact gets when its manifest names none (D168: private unless it opts in). */
export const DEFAULT_TEAM_VISIBILITY: TeamVisibility = "private";

/** The manifest's `team` settings (D168). */
export interface TeamSettings {
  /** What viewers see of each other's status and presence; default `private`. */
  readonly visibility?: TeamVisibility;
}

/** The Zod schema of the `TeamSettings` type. */
export const TeamSettings: z.ZodType<TeamSettings> = z
  .object({ visibility: TeamVisibility.exactOptional() })
  .register(wireRegistry, {
    id: "TeamSettings",
    description: "An artifact's team settings: what viewers see of each other (D168).",
  });
