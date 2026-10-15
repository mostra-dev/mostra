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
import { Cursor, MutationId, ViewId } from "./ids.ts";
import {
  DocumentRevision,
  EventRecord,
  FieldOp,
  FieldState,
  SubmissionSummary,
  Viewer,
} from "./interaction.ts";
import { wireRegistry } from "./wire-registry.ts";

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
}

/** The Zod schema of the `StreamSnapshot` type. */
export const StreamSnapshot: z.ZodType<StreamSnapshot> = z
  .object({
    cursor: Cursor.schema,
    viewer: Viewer,
    draft: DocumentSnapshot,
    state: DocumentSnapshot,
    submission: SubmissionSummary.exactOptional(),
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
}

/** The Zod schema of the `PollResult` type. */
export const PollResult: z.ZodType<PollResult> = z
  .object({
    cursor: Cursor.schema,
    events: z.array(EventRecord).readonly(),
    snapshot: StreamSnapshot.exactOptional(),
  })
  .register(wireRegistry, {
    id: "PollResult",
    description: "A long-poll answer: the cursor, the events after the asked one, and a snapshot.",
  });
