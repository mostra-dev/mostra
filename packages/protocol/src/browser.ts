/**
 * The browser protocol (INTERFACES §4, D106): what the client runtime in an artifact's frame sends
 * to the gateway and receives from it. Published versions embed the client runtime, so a gateway
 * serves every revision it ever shipped (FAILURE_MODEL §7); within a revision payloads only grow.
 * Paths are `/_mostra/v/{revision}/…` on the artifact's origin.
 *
 * ```ts
 * const body: FieldsRequest = { mutationId, scope: "viewer", baseRevision: "3", viewId, ops };
 * await fetch(`/_mostra/v/${BROWSER_PROTOCOL_REVISION}/fields`, { method: "POST", body: … });
 * ```
 */
import * as z from "zod";
import type { EphemeralMessage } from "./actions.ts";
import { ArtifactId, Cursor, MutationId, ViewId } from "./ids.ts";
import {
  DocumentRevision,
  EventRecord,
  FieldOp,
  FieldState,
  SubmissionSummary,
  Viewer,
} from "./interaction.ts";
import { SubmissionPolicy } from "./manifest.ts";
import {
  REVIEW_SET_ID_PATTERN,
  SubmitChannel,
  TrustedControl,
  VersionRef,
  type ViewContext,
} from "./view.ts";
import { wireRegistry } from "./wire-registry.ts";

export {
  type DeliveryTarget,
  REVIEW_SET_ID_PATTERN,
  readViewContext,
  VersionRef,
  ViewContext,
  ViewContextWire,
} from "./view.ts";

/** Every browser-protocol revision this release serves, oldest first. */
export const BROWSER_PROTOCOL_REVISIONS: readonly ["2026-10-15"] = ["2026-10-15"];

/** The newest browser-protocol revision: what a client runtime built now speaks. */
export const BROWSER_PROTOCOL_REVISION = "2026-10-15";

/** The longest JSON a signal's payload may be, in UTF-8 bytes (D106). */
export const SIGNAL_PAYLOAD_MAX_BYTES: number = 64 * 1024;

/** `POST …/fields`: one mutation of the viewer's draft or the artifact's state. */
export interface FieldsRequest {
  /** A fresh `mut_` ID per change; a retry repeats it and gets the recorded result. */
  readonly mutationId: string;
  /** Which document: the viewer's draft or the artifact's shared state. */
  readonly scope: "viewer" | "artifact";
  /** The document revision the page last saw; fields changed after it come back as conflicts. */
  readonly baseRevision: DocumentRevision;
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** The field changes, applied together under one revision. */
  readonly ops: readonly FieldOp[];
}

/** The Zod schema of the `FieldsRequest` type. */
export const FieldsRequest: z.ZodType<FieldsRequest> = z
  .object({
    mutationId: MutationId.schema,
    scope: z.enum(["viewer", "artifact"]),
    baseRevision: DocumentRevision,
    viewId: ViewId.schema,
    ops: z.array(FieldOp).min(1).max(1000).readonly(),
  })
  .register(wireRegistry, {
    id: "FieldsRequest",
    description: "A browser mutation: its ID, scope, base revision, view and field ops.",
  });

/** `POST …/submit`: submit the viewer's draft from the artifact's own code (D40). */
export interface SubmitRequest {
  /** The view the page was opened as (D104); its version is what the submission names. */
  readonly viewId: string;
  /** The draft revision the viewer saw; another one is `MOSTRA_SUBMIT_REVISION_MOVED`. */
  readonly expectedRevision: DocumentRevision;
  /** Always `artifact` on this route; the shell's trusted Submit is the `shell` channel (D40). */
  readonly channel: "artifact";
}

/** The Zod schema of the `SubmitRequest` type. */
export const SubmitRequest: z.ZodType<SubmitRequest> = z
  .object({
    viewId: ViewId.schema,
    expectedRevision: DocumentRevision,
    channel: z.literal("artifact"),
  })
  .register(wireRegistry, {
    id: "SubmitRequest",
    description: "A browser submit: the view and the draft revision the viewer saw.",
  });

/** `POST …/signal`: raise a named signal for the host's attention (IN-09). */
export interface SignalRequest {
  /** The view the page was opened as (D104). */
  readonly viewId: string;
  /** Letters, digits, `.`, `_` and `-`; `submit` is reserved. */
  readonly name: string;
  /** Any JSON, at most 64 KiB. */
  readonly payload?: unknown;
}

/** The Zod schema of the `SignalRequest` type. */
export const SignalRequest: z.ZodType<SignalRequest> = z
  .object({
    viewId: ViewId.schema,
    name: z.string().min(1).max(64),
    payload: z.unknown().exactOptional(),
  })
  .register(wireRegistry, {
    id: "SignalRequest",
    description: "A browser signal: the view, the signal's name and an optional JSON payload.",
  }) as z.ZodType<SignalRequest>;

/** A document as the page loads it: its revision and fields. */
export interface DocumentSnapshot {
  /** The document's revision. */
  readonly revision: DocumentRevision;
  /** The draft's epoch (D103); 1 for artifact state. */
  readonly epoch: number;
  /** Every field by ID. */
  readonly fields: Readonly<Record<string, FieldState>>;
}

/** The Zod schema of the `DocumentSnapshot` type. */
export const DocumentSnapshot: z.ZodType<DocumentSnapshot> = z
  .object({
    revision: DocumentRevision,
    epoch: z.int().min(1),
    fields: z.record(z.string(), FieldState),
  })
  .register(wireRegistry, {
    id: "DocumentSnapshot",
    description: "A document's revision, epoch and fields, as a page loads it.",
  });

/**
 * The first message of a browser event stream, and a poll's `snapshot`: where the page stands,
 * so it renders the canonical draft and state before applying events after `cursor`.
 */
export interface StreamSnapshot {
  /** Events after this cursor follow. */
  readonly cursor: string;
  /** Who the page acts as. */
  readonly viewer: Viewer;
  /** The viewer's draft. */
  readonly draft: DocumentSnapshot;
  /** The artifact's shared state. */
  readonly state: DocumentSnapshot;
  /** The submission that closed this draft, or this viewer's latest under `epochs`. */
  readonly submission?: SubmissionSummary;
  /**
   * The artifact's latest version when the snapshot was read (WP-07): a reader that missed its
   * `version.published` event (published between a frame ticket and the stream, or compacted)
   * still learns of it.
   */
  readonly latest?: VersionRef;
}

/** The Zod schema of the `StreamSnapshot` type. */
export const StreamSnapshot: z.ZodType<StreamSnapshot> = z
  .object({
    cursor: Cursor.schema,
    viewer: Viewer,
    draft: DocumentSnapshot,
    state: DocumentSnapshot,
    submission: SubmissionSummary.exactOptional(),
    latest: VersionRef.exactOptional(),
  })
  .register(wireRegistry, {
    id: "StreamSnapshot",
    description: "Where a page stands: cursor, viewer, draft, artifact state and its submission.",
  });

/** `GET …/events/poll`: the long-poll answer on the same cursor as the stream (D47). */
export interface PollResult {
  /** Where the next poll continues. */
  readonly cursor: string;
  /** The events for this page after the cursor asked for, in order. */
  readonly events: readonly EventRecord[];
  /** Present when the poll asked for none or its cursor was compacted away. */
  readonly snapshot?: StreamSnapshot;
  /**
   * Run and live updates for this view since its last poll (WP-08): lossy and never stored as
   * events, the long-poll's counterpart of the stream's `run` and `live` messages.
   */
  readonly ephemeral?: readonly EphemeralMessage[];
}

/** The Zod schema of the `PollResult` type. */
export const PollResult: z.ZodType<PollResult> = z
  .object({
    cursor: Cursor.schema,
    events: z.array(EventRecord).readonly(),
    snapshot: StreamSnapshot.exactOptional(),
    ephemeral: z.array(z.record(z.string(), z.unknown())).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "PollResult",
    description: "A long-poll answer: the cursor, the events after the asked one, and a snapshot.",
  }) as unknown as z.ZodType<PollResult>;

/**
 * `POST /a/{artifactId}/_mostra/ticket`'s answer on the shell origin: a single-use frame ticket,
 * the view it opens and what the shell needs to render the view's trusted controls (D104, D108).
 */
export interface FrameTicket extends ViewContext {
  /** The frame's entry URL, carrying the single-use ticket. */
  readonly src: string;
  /** The artifact's origin: the only origin the bridge accepts messages from. */
  readonly artifactOrigin: string;
  /** Whether this viewer follows the artifact's new versions (D63). */
  readonly follow: boolean;
  /** Whether the link opens this version only (D97 item 9): then the shell offers no newer one. */
  readonly pinned: boolean;
  /**
   * The version's server code keeps crashing and is parked (WP-08, FAILURE_MODEL §2): the shell
   * says so, since the page's actions and live data won't work until a new publish.
   */
  readonly serverParked?: true;
  /**
   * The frame shows `mostra dev`'s development preview of unpublished source (D140 item 12): the
   * shell says so, and it is never a published version.
   */
  readonly devPreview?: true;
  /**
   * `worker` when the shell and the artifact are two sites (a Cloudflare quick tunnel, a host's
   * addresses on two hosts): the frame enters through the bootstrap page and a service worker
   * (D70, D158 item 5). Absent: cookie mode.
   */
  readonly mode?: "worker";
}

/** The Zod schema of the `FrameTicket` type. */
export const FrameTicket: z.ZodType<FrameTicket> = z
  .object({
    artifactId: ArtifactId.schema,
    viewId: ViewId.schema,
    version: VersionRef,
    latest: VersionRef,
    policy: SubmissionPolicy,
    submitChannels: z.array(SubmitChannel).min(1).max(2).readonly(),
    controls: z.array(TrustedControl).max(32).readonly(),
    target: z.enum(["live", "static", "mcp-app", "verify"]),
    src: z.string().min(1),
    artifactOrigin: z.string().min(1),
    follow: z.boolean(),
    pinned: z.boolean(),
    serverParked: z.literal(true).exactOptional(),
    devPreview: z.literal(true).exactOptional(),
    mode: z.literal("worker").exactOptional(),
  })
  .register(wireRegistry, {
    id: "FrameTicket",
    description: "A frame ticket: the view it opens, where to load it, and the view's controls.",
  });

// ── Frame sessions in worker mode (WP-13, D70, D158 item 5) ───────────────────────────────

/**
 * The header Mostra's service worker adds to every same-origin request of a worker-mode frame:
 * its frame session's secret, which no cookie can carry across sites.
 */
export const FRAME_SESSION_HEADER = "x-mostra-frame";

/**
 * `POST /_mostra/enter` on the artifact's origin: the bootstrap page exchanges the shell's
 * single-use frame ticket, from `/_mostra/enter#t=…`, for a worker-mode frame session.
 */
export interface EnterRequest {
  /** The frame ticket. */
  readonly ticket: string;
}

/** The Zod schema of the `EnterRequest` type. */
export const EnterRequest: z.ZodType<EnterRequest> = z
  .object({ ticket: z.string().min(1).max(64) })
  .register(wireRegistry, { id: "EnterRequest", description: "A frame ticket to exchange." });

/** The answer to {@link EnterRequest}. */
export interface EnterResult {
  /** The frame session's secret, which the service worker sends as `X-Mostra-Frame`. */
  readonly session: string;
  /** The shell's origin: the only page the bootstrap reports to. */
  readonly shellOrigin: string;
}

/** The Zod schema of the `EnterResult` type. */
export const EnterResult: z.ZodType<EnterResult> = z
  .object({ session: z.string().min(1), shellOrigin: z.string().min(1) })
  .register(wireRegistry, {
    id: "EnterResult",
    description: "A worker-mode frame session's secret and the shell's origin.",
  });

/**
 * `POST /_mostra/v/{rev}/ticket`: a single-use ticket that opens one event stream, long poll or
 * WebSocket of this session without it (`?ticket=`), so the request can bypass the service
 * worker (VERIFIED_FACTS: Firefox stalls on endless responses a worker passes on).
 */
export interface StreamTicketRequest {
  /** What it opens: `stream` (events and polls, the default) or `socket` (a WebSocket). */
  readonly purpose?: "stream" | "socket";
}

/** The Zod schema of the `StreamTicketRequest` type. */
export const StreamTicketRequest: z.ZodType<StreamTicketRequest> = z
  .object({ purpose: z.enum(["stream", "socket"]).exactOptional() })
  .register(wireRegistry, { id: "StreamTicketRequest" });

/** The answer to {@link StreamTicketRequest}. */
export interface StreamTicket {
  /** The ticket: 130 bits, single-use. */
  readonly ticket: string;
  /** When it stops working, 60 s after it was minted. */
  readonly expiresAt: string;
}

/** The Zod schema of the `StreamTicket` type. */
export const StreamTicket: z.ZodType<StreamTicket> = z
  .object({ ticket: z.string().min(1), expiresAt: z.iso.datetime() })
  .register(wireRegistry, {
    id: "StreamTicket",
    description: "A single-use ticket for one stream, poll or WebSocket.",
  });

/**
 * `GET /_mostra/session` on the artifact's origin: the frame session's facts for same-origin code.
 */
export interface FrameSessionFacts {
  /** The CSRF token every mutation sends as `X-Mostra-CSRF`. */
  readonly csrf: string;
  readonly artifactId: string;
  /** The shell's exact origin: the bridge's only peer. */
  readonly shellOrigin: string;
  /** The link's scopes. */
  readonly scopes: readonly string[];
  /** The viewer the page acts as (WP-07). */
  readonly viewer?: Viewer;
  /** The version the frame session entered. */
  readonly version?: VersionRef;
  /** How the frame authenticates (D70): absent means `cookie`. */
  readonly mode?: "cookie" | "worker";
  /**
   * `false` where event streams don't pass (a Cloudflare quick tunnel holds responses back until
   * they end): the page long-polls from the start (D47). Absent means streams pass.
   */
  readonly streams?: boolean;
}

/** The Zod schema of the `FrameSessionFacts` type. */
export const FrameSessionFacts: z.ZodType<FrameSessionFacts> = z
  .object({
    csrf: z.string().min(1),
    artifactId: ArtifactId.schema,
    shellOrigin: z.string().min(1),
    scopes: z.array(z.string()).readonly(),
    viewer: Viewer.exactOptional(),
    version: VersionRef.exactOptional(),
    mode: z.enum(["cookie", "worker"]).exactOptional(),
    streams: z.boolean().exactOptional(),
  })
  .register(wireRegistry, {
    id: "FrameSessionFacts",
    description: "A frame session's CSRF token, shell origin, scopes, viewer, version and mode.",
  });

// ── The shell's own routes (WP-07, on the shell origin) ──────────────────────────────────

/**
 * `POST /a/{artifactId}/_mostra/v/{rev}/submit`: the shell's trusted Submit (the `shell` channel,
 * D40). Only the shell's page can send it: the route takes the shell's session, its exact origin
 * and its CSRF token, none of which an artifact's page has.
 */
export interface ShellSubmitRequest {
  /** The view the shell's frame shows (D104); its version is what the submission names. */
  readonly viewId: string;
  /** The draft revision the viewer saw, after the frame flushed its saves. */
  readonly expectedRevision: DocumentRevision;
}

/** The Zod schema of the `ShellSubmitRequest` type. */
export const ShellSubmitRequest: z.ZodType<ShellSubmitRequest> = z
  .object({ viewId: ViewId.schema, expectedRevision: DocumentRevision })
  .register(wireRegistry, {
    id: "ShellSubmitRequest",
    description: "The shell's trusted Submit: the view and the draft revision the viewer saw.",
  });

/**
 * `POST /a/{artifactId}/_mostra/v/{rev}/review/choose`: the shell's trusted Choose (D65, D113).
 * It writes the viewer's draft field `review.<reviewSetId>.choice` like any mutation, so a stale
 * base revision comes back as a conflict.
 */
export interface ChooseRequest {
  /** The view the shell's frame shows. */
  readonly viewId: string;
  /** A fresh `mut_` ID; a retry repeats it. */
  readonly mutationId: string;
  /** The draft revision the shell last saw. */
  readonly baseRevision: DocumentRevision;
  /** The review set. */
  readonly reviewSetId: string;
  /** The chosen candidate's ID. */
  readonly candidateId: string;
  /** The candidate's label, kept with the choice for results. */
  readonly label?: string;
}

/** The Zod schema of the `ChooseRequest` type. */
export const ChooseRequest: z.ZodType<ChooseRequest> = z
  .object({
    viewId: ViewId.schema,
    mutationId: MutationId.schema,
    baseRevision: DocumentRevision,
    reviewSetId: z.string().regex(REVIEW_SET_ID_PATTERN),
    candidateId: z.string().min(1).max(256),
    label: z.string().max(256).exactOptional(),
  })
  .register(wireRegistry, {
    id: "ChooseRequest",
    description:
      "The shell's trusted Choose: the view, mutation, base revision, set and candidate.",
  });

/** `POST /a/{artifactId}/_mostra/v/{rev}/follow`: the viewer's "Always follow this artifact" (D63). */
export interface FollowRequest {
  /** `true` to load new versions automatically, `false` to stop. */
  readonly follow: boolean;
}

/** The Zod schema of the `FollowRequest` type. */
export const FollowRequest: z.ZodType<FollowRequest> = z
  .object({ follow: z.boolean() })
  .register(wireRegistry, {
    id: "FollowRequest",
    description: "Whether the viewer follows the artifact's new versions.",
  });

/** A draft field a version doesn't cover (D42, D109): kept, shown read-only and delivered. */
export interface OrphanedField {
  /** The field's ID. */
  readonly id: string;
  /** Its label, when it has one. */
  readonly label?: string;
  /** Its value. */
  readonly value: unknown;
  /** The version whose view last wrote it. */
  readonly fromVersion: number;
}

/** The Zod schema of the `OrphanedField` type. */
export const OrphanedField: z.ZodType<OrphanedField> = z
  .object({
    id: z.string(),
    label: z.string().exactOptional(),
    value: z.unknown(),
    fromVersion: z.int().min(1),
  })
  .register(wireRegistry, {
    id: "OrphanedField",
    description: "A draft field a version doesn't cover: its ID, label, value and source version.",
  }) as z.ZodType<OrphanedField>;

/**
 * `GET /a/{artifactId}/_mostra/v/{rev}/carry?version=<number>`: which of the viewer's answers a
 * version doesn't carry over (D42, D109). The banner counts them before a switch; the "Not
 * carried over" panel lists them for the version shown.
 */
export interface CarryOver {
  /** The version asked about. */
  readonly version: VersionRef;
  /** The viewer's draft fields the version doesn't cover. */
  readonly orphans: readonly OrphanedField[];
}

/** The Zod schema of the `CarryOver` type. */
export const CarryOver: z.ZodType<CarryOver> = z
  .object({ version: VersionRef, orphans: z.array(OrphanedField).readonly() })
  .register(wireRegistry, {
    id: "CarryOver",
    description: "The viewer's answers a version doesn't carry over.",
  });
