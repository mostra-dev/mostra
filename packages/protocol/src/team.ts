/**
 * Team features (D121, D168; INTERFACES §2.3, §4, §6): expected respondents and their roster,
 * respondent status, the visibility policy, and presence. The host protocol's `roster/*` methods,
 * the browser protocol's `respondents` and `presence` routes and the client hooks
 * (`useRespondents`, `usePresence`) speak these shapes. Presence is never stored (D47): its shapes
 * travel only as ephemeral messages and answers.
 */
import * as z from "zod";
import { SubmissionId, ViewerId, ViewId } from "./ids.ts";
import { ViewerKind } from "./interaction.ts";
import { DEFAULT_TEAM_VISIBILITY, TeamSettings, TeamVisibility } from "./team-settings.ts";
import { wireRegistry } from "./wire-registry.ts";

export { DEFAULT_TEAM_VISIBILITY, TeamSettings, TeamVisibility };

// ── Respondents ──────────────────────────────────────────────────────────────────────────────

/** The most expected respondents one artifact's roster holds. */
export const ROSTER_MAX = 1000;

/**
 * An expected respondent as a host or agent names them (D121): the host's stable key for the
 * person (`view/url`'s `viewer.ref`, D104), their display name, and an email address a remote
 * server may send an invitation to (its operator's `invitations` port; nothing is sent locally).
 */
export interface RespondentSpec {
  /** The host's stable key for this person, such as an email or an account ID (D104). */
  readonly ref: string;
  /** The name people see; updated when given again. */
  readonly name?: string;
  /** Where a remote server's operator may send this person's invitation. Never sent by Mostra. */
  readonly email?: string;
}

/** The Zod schema of the `RespondentSpec` type. */
export const RespondentSpec: z.ZodType<RespondentSpec> = z
  .object({
    ref: z.string().min(1).max(256),
    name: z.string().min(1).max(256).exactOptional(),
    email: z
      .string()
      .max(320)
      .regex(/^[^\s@]+@[^\s@]+$/)
      .exactOptional(),
  })
  .register(wireRegistry, {
    id: "RespondentSpec",
    description: "An expected respondent: the host's stable key, a display name, an email.",
  });

/**
 * Where an expected respondent stands in the roster's current round (CO-03): `not-opened` (no view
 * of the artifact since the round began), `drafting` (opened it or wrote their draft since), or
 * `submitted` (a submission in the round). Open for later states on the wire.
 */
export type RespondentStatus = "not-opened" | "drafting" | "submitted";

/** The Zod schema of the `RespondentStatus` type. */
export const RespondentStatus: z.ZodType<RespondentStatus> = z
  .enum(["not-opened", "drafting", "submitted"])
  .register(wireRegistry, {
    id: "RespondentStatus",
    description: "Where a respondent stands in the round: not-opened, drafting or submitted.",
  });

/** How many respondents stand where, in the current round. */
export interface RosterCounts {
  /** Every expected respondent. */
  readonly total: number;
  /** How many haven't opened the artifact in the round. */
  readonly notOpened: number;
  /** How many opened it or wrote their draft in the round, without submitting. */
  readonly drafting: number;
  /** How many submitted in the round. */
  readonly submitted: number;
}

/** The Zod schema of the `RosterCounts` type. */
export const RosterCounts: z.ZodType<RosterCounts> = z
  .object({
    total: z.int().min(0),
    notOpened: z.int().min(0),
    drafting: z.int().min(0),
    submitted: z.int().min(0),
  })
  .register(wireRegistry, {
    id: "RosterCounts",
    description: "How many respondents have not opened, are drafting, or submitted in the round.",
  });

/** One expected respondent as agents and hosts read it (`roster/get`): everything. */
export interface Respondent {
  /** The host's stable key for the person. */
  readonly ref: string;
  /** The display name. */
  readonly name?: string;
  /** The invitation address, when one was given. */
  readonly email?: string;
  /** The viewer the person's personal link acts as (D104). */
  readonly viewerId: string;
  /** Where they stand in the current round. */
  readonly status: RespondentStatus;
  /** When they first opened the artifact. */
  readonly openedAt?: string;
  /** When they last opened it or wrote their draft. */
  readonly activeAt?: string;
  /** Their submission in the current round, when they made one. */
  readonly submission?: { readonly id: string; readonly at: string };
  /** How many submissions they made in all. */
  readonly submissions: number;
  /** Their personal link's token, for `view/rotate` and `view/revoke`; absent once revoked. */
  readonly tokenId?: string;
  /** When they joined the roster. */
  readonly addedAt: string;
}

/** The Zod schema of the `Respondent` type. */
export const Respondent: z.ZodType<Respondent> = z
  .object({
    ref: z.string(),
    name: z.string().exactOptional(),
    email: z.string().exactOptional(),
    viewerId: ViewerId.schema,
    status: RespondentStatus,
    openedAt: z.iso.datetime().exactOptional(),
    activeAt: z.iso.datetime().exactOptional(),
    submission: z.object({ id: SubmissionId.schema, at: z.iso.datetime() }).exactOptional(),
    submissions: z.int().min(0),
    tokenId: z.string().exactOptional(),
    addedAt: z.iso.datetime(),
  })
  .register(wireRegistry, {
    id: "Respondent",
    description:
      "An expected respondent as agents and hosts read it: name, viewer, status and submission.",
  });

/** An artifact's roster as agents and hosts read it (`roster/get`). */
export interface Roster {
  /** The roster's round (D168): always 1 under `once`; under `epochs`, one more after each completion. */
  readonly round: number;
  /** Whether every expected respondent has submitted in the round; an empty roster never has. */
  readonly complete: boolean;
  /** What viewers see of each other (the manifest's `team.visibility`). */
  readonly visibility: TeamVisibility;
  /** How many stand where in the round. */
  readonly counts: RosterCounts;
  /** Every expected respondent, in the order they joined. */
  readonly respondents: readonly Respondent[];
}

/** The Zod schema of the `Roster` type. */
export const Roster: z.ZodType<Roster> = z
  .object({
    round: z.int().min(1),
    complete: z.boolean(),
    visibility: TeamVisibility,
    counts: RosterCounts,
    respondents: z.array(Respondent).readonly(),
  })
  .register(wireRegistry, {
    id: "Roster",
    description: "An artifact's expected respondents with their status, the round and its counts.",
  });

/**
 * Another viewer as a page may see them: an opaque key that is stable for one viewer of one
 * artifact (never a viewer or view ID, D104), their display name and how Mostra knows them.
 */
export interface Peer {
  /** Stable for one viewer of one artifact, different across artifacts; `self` marks the page's own. */
  readonly key: string;
  /** Whether this is the page's own viewer. */
  readonly self: boolean;
  /** The display name, when one is known. */
  readonly name?: string;
  /** How Mostra knows the viewer. */
  readonly kind: ViewerKind;
  /** On a hosted link: whether a provider verified the name (D165 item 8). */
  readonly verified?: boolean;
}

const peerShape = {
  key: z.string().min(1).max(64),
  self: z.boolean(),
  name: z.string().exactOptional(),
  kind: ViewerKind,
  verified: z.boolean().exactOptional(),
};

/** One respondent as a page sees them under the visibility policy. */
export interface RespondentForPage extends Peer {
  /** Where they stand in the round. */
  readonly status: RespondentStatus;
  /** When they first opened the artifact. */
  readonly openedAt?: string;
  /** When they submitted in the round. */
  readonly submittedAt?: string;
}

/** The Zod schema of the `RespondentForPage` type. */
export const RespondentForPage: z.ZodType<RespondentForPage> = z
  .object({
    ...peerShape,
    status: RespondentStatus,
    openedAt: z.iso.datetime().exactOptional(),
    submittedAt: z.iso.datetime().exactOptional(),
  })
  .register(wireRegistry, {
    id: "RespondentForPage",
    description: "A respondent as a page sees them: key, name, status, when opened and submitted.",
  });

/**
 * The roster as one page may see it (CO-03, CO-07): under `private` only the viewer's own entry,
 * under `counts` also the counts and whether the round is complete, under `names` every respondent.
 * The owner's page sees as under `names`.
 */
export interface RosterForPage {
  /** The policy that decided what this answer holds. */
  readonly visibility: TeamVisibility;
  /** Whether this page's viewer sees everything as the artifact's owner. */
  readonly owner: boolean;
  /** The roster's round (always 1 under `once`). */
  readonly round: number;
  /** The viewer's own entry, when they are an expected respondent. */
  readonly self?: RespondentForPage;
  /** Under `counts` and `names`, and for the owner. */
  readonly counts?: RosterCounts;
  /** Under `counts` and `names`, and for the owner. */
  readonly complete?: boolean;
  /** Under `names`, and for the owner: every respondent, in the order they joined. */
  readonly respondents?: readonly RespondentForPage[];
}

/** The Zod schema of the `RosterForPage` type. */
export const RosterForPage: z.ZodType<RosterForPage> = z
  .object({
    visibility: TeamVisibility,
    owner: z.boolean(),
    round: z.int().min(1),
    self: RespondentForPage.exactOptional(),
    counts: RosterCounts.exactOptional(),
    complete: z.boolean().exactOptional(),
    respondents: z.array(RespondentForPage).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "RosterForPage",
    description: "The roster as a page may see it under the visibility policy (CO-07).",
  });

/** `POST …/respondents`: reads the roster as the page may see it and follows it for a minute. */
export interface RespondentsRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
}

/** The Zod schema of the `RespondentsRequest` type. */
export const RespondentsRequest: z.ZodType<RespondentsRequest> = z
  .object({ viewId: ViewId.schema })
  .register(wireRegistry, {
    id: "RespondentsRequest",
    description: "Reads the roster as the page may see it, and follows it for a minute.",
  });

// ── Presence ─────────────────────────────────────────────────────────────────────────────────

/** The largest coordinate a shared cursor may carry, in CSS pixels. */
export const PRESENCE_COORDINATE_MAX = 10_000_000;

/** A shared pointer position, in the page's document coordinates (CSS pixels). */
export interface PresenceCursor {
  /** From the document's left edge. */
  readonly x: number;
  /** From the document's top edge. */
  readonly y: number;
}

/** The Zod schema of the `PresenceCursor` type. */
export const PresenceCursor: z.ZodType<PresenceCursor> = z
  .object({
    x: z.number().min(-PRESENCE_COORDINATE_MAX).max(PRESENCE_COORDINATE_MAX),
    y: z.number().min(-PRESENCE_COORDINATE_MAX).max(PRESENCE_COORDINATE_MAX),
  })
  .register(wireRegistry, {
    id: "PresenceCursor",
    description: "A shared pointer position in the page's document coordinates, in CSS pixels.",
  });

/**
 * A shared selection: the element the viewer is in (its `data-presence-id`, `id` or `name`) and,
 * in a text input, the selected range.
 */
export interface PresenceSelection {
  /** The element: its `data-presence-id`, `id` or `name`. */
  readonly element?: string;
  /** In a text input, where the selection starts. */
  readonly start?: number;
  /** In a text input, where it ends. */
  readonly end?: number;
}

/** The Zod schema of the `PresenceSelection` type. */
export const PresenceSelection: z.ZodType<PresenceSelection> = z
  .object({
    element: z.string().min(1).max(256).exactOptional(),
    start: z.int().min(0).max(PRESENCE_COORDINATE_MAX).exactOptional(),
    end: z.int().min(0).max(PRESENCE_COORDINATE_MAX).exactOptional(),
  })
  .register(wireRegistry, {
    id: "PresenceSelection",
    description: "A shared selection: the element the viewer is in and the selected text range.",
  });

/**
 * `POST …/presence`: the page joins presence for the next half minute, sharing what it gives
 * (CO-04). `cursor` and `selection` replace what the page shared (`null` stops sharing it); `leave`
 * ends the page's presence at once. Never stored.
 */
export interface PresenceRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** The pointer to share; `null` stops sharing it; absent leaves it as it was. */
  readonly cursor?: PresenceCursor | null;
  /** The selection to share; `null` stops sharing it; absent leaves it as it was. */
  readonly selection?: PresenceSelection | null;
  /** Ends the page's presence now. */
  readonly leave?: true;
}

/** The Zod schema of the `PresenceRequest` type. */
export const PresenceRequest: z.ZodType<PresenceRequest> = z
  .object({
    viewId: ViewId.schema,
    cursor: PresenceCursor.nullable().exactOptional(),
    selection: PresenceSelection.nullable().exactOptional(),
    leave: z.literal(true).exactOptional(),
  })
  .register(wireRegistry, {
    id: "PresenceRequest",
    description: "Joins presence for half a minute, sharing a cursor and a selection, or leaves.",
  });

/** A viewer present on the artifact now, as a page may see them. */
export interface PresencePeer extends Peer {
  /** Their pointer, when they share it. */
  readonly cursor?: PresenceCursor;
  /** Their selection, when they share it. */
  readonly selection?: PresenceSelection;
  /** When they last told Mostra anything. */
  readonly at: string;
}

/** The Zod schema of the `PresencePeer` type. */
export const PresencePeer: z.ZodType<PresencePeer> = z
  .object({
    ...peerShape,
    cursor: PresenceCursor.exactOptional(),
    selection: PresenceSelection.exactOptional(),
    at: z.iso.datetime(),
  })
  .register(wireRegistry, {
    id: "PresencePeer",
    description: "A viewer present now: key, name, and the cursor and selection they share.",
  });

/**
 * Who is present, as one page may see it (CO-04, CO-07): under `names` (or for the owner) every
 * present viewer with what they share; under `counts` how many others are present; under
 * `private` only the page's own viewer.
 */
export interface PresenceState {
  /** The policy that decided what this answer holds. */
  readonly visibility: TeamVisibility;
  /** Present viewers this page may see, its own first. */
  readonly peers: readonly PresencePeer[];
  /** How many other viewers are present, under `counts` and `names`. */
  readonly others?: number;
}

/** The Zod schema of the `PresenceState` type. */
export const PresenceState: z.ZodType<PresenceState> = z
  .object({
    visibility: TeamVisibility,
    peers: z.array(PresencePeer).readonly(),
    others: z.int().min(0).exactOptional(),
  })
  .register(wireRegistry, {
    id: "PresenceState",
    description: "Who is present, as a page may see them under the visibility policy.",
  });
