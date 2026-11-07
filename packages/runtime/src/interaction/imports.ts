/**
 * The owner instance's copies of its hosted homes' records (D165 item 1, DATA_MODEL §7.3): the
 * submissions a hosted home delivers to it, stored with their hosted IDs, digest and snapshot and
 * enqueued to the owner's own hosts in the same transaction, so remote submissions reach local hosts
 * through the local outbox (RM-02, H-04); and the events the sync cursor follows, each appended
 * once, with where it came from.
 */
import { createHash } from "node:crypto";
import {
  type EventOrigin,
  type EventRecord,
  type SubmissionEnvelope,
  type SubmissionsDeliverResult,
  ViewerId,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent, originJson } from "./events.ts";
import { documentFor } from "./fields.ts";
import type { Snapshot } from "./submissions.ts";

/** The built-in adapter's owner name, as `submit` uses it (D105). */
import { BUILT_IN_OWNER } from "./submissions.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A local delivery's ID for an imported submission and one of the owner's hosts: `dlv_` and 26
 * Crockford base32 characters of SHA-256(submission ID ‖ 0x00 ‖ host owner), its first two bits
 * cleared so it reads as a ULID. A re-import (the owner's home restored) repeats it, so a host
 * that dedupes by delivery ID sees one delivery (DATA_MODEL §7.3, D105's identity).
 */
export function importedDeliveryId(submissionId: string, owner: string): string {
  const digest = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from(submissionId, "utf8"),
        Buffer.from([0]),
        Buffer.from(owner, "utf8"),
      ]),
    )
    .digest();
  digest[0] = (digest[0] as number) & 0x3f;
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += CROCKFORD.charAt((buffer >> bits) & 31);
    }
    if (out.length >= 26) break;
  }
  return `dlv_${out}`;
}

/** Where an imported record came from, without its own cursor. */
export interface ImportSource {
  /** The server's API origin. */
  readonly server: string;
  /** A short, stable key of the server: imported viewers' references are prefixed by it. */
  readonly serverKey: string;
  /** The hosted home and its incarnation now. */
  readonly home: string;
  readonly incarnation: string;
}

/** What {@link importSubmission} needs. */
export interface SubmissionImport {
  readonly envelope: SubmissionEnvelope;
  readonly source: ImportSource;
  /** The owner's own hosts for submissions, or none (the built-in adapter accepts). */
  readonly owners: readonly string[];
  /** Whether this instance owns the artifact on that server (its `hosted_artifact` row). */
  readonly owned: (db: LedgerDb, artifactId: string) => boolean;
}

/**
 * Stores a delivered hosted submission and its local deliveries in the caller's transaction, and
 * answers the hosted home as a host does (D105): `accepted` once it is durable here, a repeat of
 * one already held too; a submission it can never hold is refused for good.
 */
export function importSubmission(db: LedgerDb, input: SubmissionImport): SubmissionsDeliverResult {
  const { envelope, source } = input;
  const refuse = (reason: string): SubmissionsDeliverResult => ({
    accepted: false,
    reason,
    retry: false,
  });
  if (db.get("SELECT 1 FROM submission WHERE id = ?", envelope.submissionId))
    return { accepted: true };
  if (envelope.snapshot === undefined) return refuse("invalid: the delivery carries no snapshot");
  const digest = createHash("sha256").update(envelope.snapshot, "utf8").digest("hex");
  if (digest !== envelope.results.submission.digest) {
    return refuse("invalid: the snapshot doesn't match the submission's digest");
  }
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(envelope.snapshot) as Snapshot;
  } catch {
    return refuse("invalid: the snapshot isn't JSON");
  }
  if (
    snapshot.submissionId !== envelope.submissionId ||
    snapshot.artifactId !== envelope.artifactId ||
    typeof snapshot.versionId !== "string" ||
    typeof snapshot.viewId !== "string"
  ) {
    return refuse("invalid: the snapshot names another submission");
  }
  if (!input.owned(db, snapshot.artifactId)) {
    // Never sent to an instance that doesn't own the artifact (D165 item 1b); refused for good.
    return refuse("undeliverable: this instance doesn't own the artifact");
  }
  if (
    !db.get(
      "SELECT 1 FROM version WHERE id = ? AND artifact_id = ?",
      snapshot.versionId,
      snapshot.artifactId,
    )
  ) {
    return refuse("undeliverable: this instance doesn't hold the submission's version");
  }

  // The viewer, as a row of its kind keyed by the server (DATA_MODEL §7.3).
  const hostedViewer = snapshot.viewer;
  const kind = hostedViewer.kind === "local" ? "token" : hostedViewer.kind;
  const ref = `${source.serverKey}:${hostedViewer.ref ?? hostedViewer.id}`;
  let viewerId = db.get<{ id: string }>(
    "SELECT id FROM viewer WHERE kind = ? AND external_ref = ?",
    kind,
    ref,
  )?.id;
  if (viewerId === undefined) {
    viewerId = db.get("SELECT 1 FROM viewer WHERE id = ?", hostedViewer.id)
      ? ViewerId.create()
      : hostedViewer.id;
    db.run(
      "INSERT INTO viewer (id, kind, external_ref, name, created_at) VALUES (?, ?, ?, ?, ?)",
      viewerId,
      kind,
      ref,
      hostedViewer.name ?? null,
      snapshot.at,
    );
  }
  // The view it named, under its hosted ID, so the submission names exactly what its tab showed.
  const view = db.get<{ artifact_id: string }>(
    "SELECT artifact_id FROM view WHERE id = ?",
    snapshot.viewId,
  );
  if (view && view.artifact_id !== snapshot.artifactId)
    return refuse("invalid: the view is another artifact's");
  if (!view) {
    db.run(
      "INSERT INTO view (id, artifact_id, version_id, viewer_id, token_id, opened_cursor, opened_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
      snapshot.viewId,
      snapshot.artifactId,
      snapshot.versionId,
      viewerId,
      snapshot.at,
    );
  }
  const draft = documentFor(db, snapshot.artifactId, viewerId, true);
  const previous =
    snapshot.previous !== undefined &&
    db.get("SELECT 1 FROM submission WHERE id = ?", snapshot.previous)
      ? snapshot.previous
      : null;
  const origin = {
    server: source.server,
    home: source.home,
    incarnation: source.incarnation,
    cursor: envelope.cursor ?? ("0" as EventOrigin["cursor"]),
  };
  // Its own `submission.created` here, whose cursor is its local position (the order the owner's
  // deliveries replay in); the followed hosted one is never appended itself.
  const localPosition = Number(
    appendEvent(db, {
      artifactId: snapshot.artifactId,
      type: "submission.created",
      actor: { kind: "viewer", id: viewerId },
      causation: { submissionId: snapshot.submissionId },
      payload: {
        submissionId: snapshot.submissionId,
        versionId: snapshot.versionId,
        version: snapshot.version,
        viewId: snapshot.viewId,
        viewerId,
        channel: snapshot.channel,
        epoch: snapshot.epoch,
        staleView: snapshot.staleView,
        digest,
        imported: true,
      },
    }),
  );
  db.run(
    `INSERT INTO submission (id, position, artifact_id, version_id, view_id, viewer_id, channel, policy_json, epoch, scope_key,
       previous_id, draft_document_id, draft_revision, state_revision, latest_version_number, snapshot_json, digest, stale_view,
       request_id, created_at, origin_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    snapshot.submissionId,
    localPosition,
    snapshot.artifactId,
    snapshot.versionId,
    snapshot.viewId,
    viewerId,
    snapshot.channel,
    JSON.stringify(snapshot.policy),
    snapshot.epoch,
    // Hosted answers are their own audience (D165 item 1): they never meet the owner's own links'
    // `once` scopes, and each imported submission is its own key.
    `remote:${source.serverKey}:${snapshot.submissionId}`,
    previous,
    draft.id,
    Number(snapshot.draft.revision),
    snapshot.state ? Number(snapshot.state.revision) : null,
    snapshot.latestVersion ?? null,
    envelope.snapshot,
    digest,
    snapshot.staleView ? 1 : 0,
    snapshot.at,
    originJson(origin),
  );
  const at = new Date().toISOString();
  const owners = input.owners.length > 0 ? [...new Set(input.owners)].sort() : [BUILT_IN_OWNER];
  for (const owner of owners) {
    db.run(
      "INSERT INTO delivery (id, submission_id, position, port_owner, state, attempts, next_attempt_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
      importedDeliveryId(snapshot.submissionId, owner),
      snapshot.submissionId,
      localPosition,
      owner,
      at,
      at,
    );
  }
  return { accepted: true };
}

/**
 * Types a follow never copies: the owner publishes its versions itself, and its own deliveries
 * record their own outcomes. (A hosted `submission.created` is never appended either: its
 * submission arrives as a delivery, below.)
 */
const NOT_FOLLOWED = new Set([
  "artifact.created",
  "version.published",
  "submission.retrying",
  "submission.delivered",
  "submission.rejected",
  "submission.undeliverable",
]);

/** The outcome of copying one page of followed events. */
export interface FollowOutcome {
  /** Events appended now. */
  readonly appended: number;
  /** Hosted submissions named by a followed `submission.created` that this home lacks. */
  readonly missing: readonly string[];
}

/**
 * Copies a page of the hosted home's events into this home's log, in the caller's transaction:
 * only the artifacts this instance owns, each event once (its origin is unique), with local
 * cursors. A followed `submission.created` this home lacks is reported, so the caller has it
 * delivered again rather than appending a record without its submission.
 */
export function followEvents(
  db: LedgerDb,
  input: {
    readonly events: readonly EventRecord[];
    readonly source: ImportSource;
    readonly owned: (db: LedgerDb, artifactId: string) => boolean;
  },
): FollowOutcome {
  let appended = 0;
  const missing: string[] = [];
  for (const event of input.events) {
    if (event.artifactId === null || !input.owned(db, event.artifactId)) continue;
    if (event.type === "submission.created") {
      const id = event.payload["submissionId"];
      if (typeof id === "string" && !db.get("SELECT 1 FROM submission WHERE id = ?", id))
        missing.push(id);
      continue;
    }
    if (NOT_FOLLOWED.has(event.type)) continue;
    // A run this home ran for the hosted home records its own events (relayed); the hosted copy
    // of them would say each twice (Opus review of WP-29). Events of a run that never reached this
    // home (it waited, failed while the owner was offline, was cancelled unsent) are copied.
    if (event.type.startsWith("action.")) {
      const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
      if (typeof runId === "string" && db.get("SELECT 1 FROM action_run WHERE id = ?", runId)) {
        continue;
      }
    }
    const origin: EventOrigin = {
      server: input.source.server,
      home: input.source.home,
      incarnation: input.source.incarnation,
      cursor: event.cursor,
    };
    if (db.get("SELECT 1 FROM event WHERE origin_json = ?", originJson(origin))) continue;
    appendEvent(db, {
      artifactId: event.artifactId,
      type: event.type,
      actor: event.actor,
      ...(event.causation !== undefined ? { causation: event.causation } : {}),
      payload: event.payload,
      origin,
    });
    appended += 1;
  }
  return { appended, missing };
}
