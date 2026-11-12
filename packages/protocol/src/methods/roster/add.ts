import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { CapabilityScope } from "../../capability.ts";
import { Duration } from "../../duration.ts";
import { VersionId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { RespondentSpec, ROSTER_MAX, Roster } from "../../team.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { CapabilityLink } from "../view/url.ts";

/** The params of `roster/add` (INTERFACES §6, D121, D168). */
export interface RosterAddParams {
  /** The artifact the people are expected to answer. */
  readonly artifact: ArtifactRef;
  /** The people expected to answer, by the host's stable key (D104); one already there is kept. */
  readonly respondents: readonly RespondentSpec[];
  /** What a new personal link allows (D97). Default: every scope. */
  readonly scopes?: readonly CapabilityScope[];
  /** How long a new personal link works. Default: until it is revoked (D63). */
  readonly ttl?: Duration;
  /** The version a new personal link opens, by number or ID; absent: the latest, always. */
  readonly version?: number | string;
  /** Makes retries idempotent (H-03). */
  readonly requestId?: string;
}

/** A respondent's personal link (CO-01). */
export interface RespondentLink {
  /** The respondent it is for. */
  readonly ref: string;
  /** Their link: it acts as their viewer (D104). Holding it is the authorization (D06). */
  readonly link: CapabilityLink;
}

/** The Zod schema of the `RespondentLink` type. */
export const RespondentLink: z.ZodType<RespondentLink> = z
  .object({ ref: z.string(), link: CapabilityLink })
  .register(wireRegistry, {
    id: "RespondentLink",
    description: "An expected respondent's personal link, acting as their viewer.",
  });

/** The result of `roster/add`. */
export interface RosterAddResult {
  /** The roster after the change. */
  readonly roster: Roster;
  /** The personal link of every respondent named, in the order given. */
  readonly links: readonly RespondentLink[];
}

const params: z.ZodType<RosterAddParams> = z
  .object({
    artifact: ArtifactRef,
    respondents: z.array(RespondentSpec).min(1).max(ROSTER_MAX).readonly(),
    scopes: z.array(CapabilityScope).min(1).readonly().exactOptional(),
    ttl: Duration.exactOptional(),
    version: z.union([z.int().min(1), VersionId.schema]).exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "RosterAddParams" });

const result: z.ZodType<RosterAddResult> = z
  .object({ roster: Roster, links: z.array(RespondentLink).readonly() })
  .register(wireRegistry, { id: "RosterAddResult" });

/**
 * `roster/add`: names people an artifact expects answers from and gives each a personal link that
 * acts as their viewer (CO-01). Idempotent by `ref`: a respondent already there keeps their link
 * (a revoked one is replaced), and a name given again replaces theirs. Appends `roster.changed`.
 */
export const rosterAddMethod: MethodDefinition<RosterAddParams, RosterAddResult> = defineMethod({
  method: "roster/add",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
