/**
 * The submit transaction (IN-05, IN-07, IN-12; ARCHITECTURE §6, D39, D40, D103, D106). One ledger
 * transaction resolves the view to its exact version, checks the policy in force and the draft
 * revision the viewer saw, reads the canonical persisted draft and artifact state, computes the
 * snapshot's digest, inserts the immutable submission, enqueues one delivery per host, and
 * appends `submission.created` and the `submit` signal. A submission is never made from content
 * the page sent: only from what the ledger holds (IN-06).
 */
import { createHash } from "node:crypto";
import {
  canonicalJson,
  createDiagnostic,
  DeliveryId,
  type DeliveryState,
  type DeliveryStatus,
  type OrphanedField,
  RpcError,
  SubmissionId,
  type SubmissionPolicy,
  type SubmissionSummary,
  type SubmitChannel,
  type Viewer,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";
import { documentFor, type FieldRow } from "./fields.ts";
import { storedPolicy } from "./policy.ts";
import { raiseSubmitSignal, SUBMIT_SIGNAL } from "./signals.ts";
import { type ViewRow, viewControls, viewer as viewerById, viewFor } from "./viewers.ts";

/** The most signals a snapshot keeps: the view's newest. */
export const SNAPSHOT_SIGNALS_MAX = 100;

/** The most signal payload text a snapshot keeps. */
export const SNAPSHOT_SIGNAL_BYTES_MAX: number = 1024 * 1024;

/**
 * The longest snapshot, in characters: the two 16 MiB documents, labels and signals fit, and the
 * results built from it stay well inside one 64 Mi-character protocol message.
 */
export const SNAPSHOT_MAX_LENGTH: number = 40 * 1024 * 1024;

/**
 * The owner of the built-in adapter's deliveries, which accepts at once (D58, D105): empty, since
 * a client name never is, so no host can be taken for it.
 */
export const BUILT_IN_OWNER = "";

/** One field as a snapshot keeps it. */
export interface SnapshotField {
  readonly value: unknown;
  readonly label?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
}

/**
 * The canonical answer document of a submission (DATA_MODEL §3 `snapshot_json`): everything the
 * results are made of, frozen at submit. Its digest is the SHA-256 of its RFC 8785 form.
 */
export interface Snapshot {
  readonly schema: 1;
  readonly submissionId: string;
  readonly at: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  readonly viewId: string;
  readonly viewer: Viewer;
  readonly channel: SubmitChannel;
  readonly policy: SubmissionPolicy;
  readonly epoch: number;
  readonly previous?: string;
  readonly staleView: boolean;
  readonly latestVersion?: number;
  readonly draft: { readonly revision: string; readonly fields: Record<string, SnapshotField> };
  readonly state?: { readonly revision: string; readonly fields: Record<string, SnapshotField> };
  readonly orphaned: readonly {
    readonly id: string;
    readonly label?: string;
    readonly value: unknown;
    readonly fromVersion: number;
  }[];
  readonly signals: readonly {
    readonly name: string;
    readonly at: string;
    readonly payload?: unknown;
  }[];
  readonly signalsOmitted?: number;
  readonly signalsCompacted?: true;
}

/** A `submission` row. */
export interface SubmissionRow {
  readonly id: string;
  readonly position: number;
  readonly artifact_id: string;
  readonly version_id: string;
  readonly view_id: string;
  readonly viewer_id: string;
  readonly channel: SubmitChannel;
  readonly policy_json: string;
  readonly epoch: number;
  readonly scope_key: string;
  readonly previous_id: string | null;
  readonly draft_document_id: number;
  readonly draft_revision: number;
  readonly state_revision: number | null;
  readonly latest_version_number: number | null;
  readonly snapshot_json: string;
  readonly digest: string;
  readonly stale_view: number;
  readonly created_at: string;
}

interface DeliveryRow {
  readonly id: string;
  readonly port_owner: string;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly reason: string | null;
  readonly last_error_json: string | null;
  readonly updated_at: string;
}

/**
 * A refused submit that carries the submission already made (H-02): `MOSTRA_SUBMIT_ALREADY` under
 * `once`. The gateway answers it with the submission beside the diagnostic.
 */
export class SubmitConflict extends RpcError {
  readonly submission: SubmissionSummary;

  constructor(message: string, submission: SubmissionSummary) {
    super(createDiagnostic("MOSTRA_SUBMIT_ALREADY", { message }));
    this.submission = submission;
  }
}

const SEVERITY: Readonly<Record<DeliveryState, number>> = {
  delivered: 0,
  pending: 1,
  rejected: 2,
  undeliverable: 3,
};

/** A submission's deliveries. */
export function deliveriesOf(db: LedgerDb, submissionId: string): DeliveryStatus[] {
  return db
    .all<DeliveryRow>(
      "SELECT * FROM delivery WHERE submission_id = ? ORDER BY port_owner",
      submissionId,
    )
    .map((row) => ({
      deliveryId: row.id,
      owner: row.port_owner,
      state: row.state,
      attempts: row.attempts,
      ...(row.reason !== null ? { reason: row.reason } : {}),
      ...(row.state === "pending" && row.last_error_json !== null
        ? { waiting: true as const }
        : {}),
      updatedAt: row.updated_at,
    }));
}

/** Every delivery's state summed up: the worst of them (`delivered` when there are none). */
export function overallDelivery(deliveries: readonly DeliveryStatus[]): DeliveryState {
  let worst: DeliveryState = "delivered";
  for (const delivery of deliveries)
    if (SEVERITY[delivery.state] > SEVERITY[worst]) worst = delivery.state;
  return worst;
}

/** A submission as a submit answers it. */
export function submissionSummary(db: LedgerDb, row: SubmissionRow): SubmissionSummary {
  const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  return {
    id: row.id,
    at: row.created_at,
    epoch: row.epoch,
    channel: row.channel,
    versionId: row.version_id,
    version: snapshot.version,
    viewId: row.view_id,
    staleView: row.stale_view === 1,
    draftRevision: String(row.draft_revision),
    digest: row.digest,
    ...(() => {
      const deliveries = deliveriesOf(db, row.id);
      return { delivery: overallDelivery(deliveries), deliveries };
    })(),
  };
}

/** The submission that closes a viewer's draft under `once`, if any (D106). */
export function closingSubmission(
  db: LedgerDb,
  artifactId: string,
  viewerId: string,
): SubmissionRow | undefined {
  const artifact = db.get<{ policy_json: string | null }>(
    "SELECT policy_json FROM artifact WHERE id = ?",
    artifactId,
  );
  if (!artifact) return undefined;
  const policy = storedPolicy(artifact.policy_json);
  if (policy.policy !== "once") return undefined;
  return policy.scope === "per-viewer"
    ? db.get<SubmissionRow>(
        "SELECT * FROM submission WHERE artifact_id = ? AND viewer_id = ? ORDER BY position LIMIT 1",
        artifactId,
        viewerId,
      )
    : db.get<SubmissionRow>(
        "SELECT * FROM submission WHERE artifact_id = ? ORDER BY position LIMIT 1",
        artifactId,
      );
}

/** Refuses a write to a draft that a `once` submission closed (D106). */
export function assertDraftOpen(db: LedgerDb, artifactId: string, viewerId: string): void {
  const closing = closingSubmission(db, artifactId, viewerId);
  if (closing) {
    throw new SubmitConflict(
      `A submission made at ${closing.created_at} closed this draft: the artifact takes one submission.`,
      submissionSummary(db, closing),
    );
  }
}

function snapshotFields(rows: readonly FieldRow[]): Record<string, SnapshotField> {
  // fromEntries defines own properties, so a field ID such as `__proto__` stays a field.
  return Object.fromEntries(
    rows.map((row) => [
      row.field_id,
      {
        value: JSON.parse(row.value_json) as unknown,
        ...(row.label !== null ? { label: row.label } : {}),
        ...(row.required !== null ? { required: row.required === 1 } : {}),
        ...(row.sensitive === 1 ? { sensitive: true } : {}),
      },
    ]),
  );
}

/**
 * Refuses a submit through a channel the view doesn't accept (D40, D108):
 * `MOSTRA_SUBMIT_CHANNEL_DENIED`.
 */
export function assertChannel(view: ViewRow, channel: SubmitChannel): void {
  if (viewControls(view).submitChannels.includes(channel)) return;
  throw new RpcError(
    createDiagnostic("MOSTRA_SUBMIT_CHANNEL_DENIED", {
      message:
        channel === "artifact"
          ? "This view takes submissions and choices from the shell's trusted controls only."
          : "This view takes submissions and choices from the artifact's own code only.",
    }),
  );
}

/**
 * Draft fields a view's version doesn't cover, as results deliver them (D42, D109). A field
 * records the version whose view last wrote it; one written before Mostra kept that (an
 * unreleased ledger of WP-06's time, which migration 6 fills from its events where it can) is
 * attributed to version 1, the earliest it can have come from.
 */
export function orphansOf(rows: readonly FieldRow[]): OrphanedField[] {
  return rows.map((row) => ({
    id: row.field_id,
    ...(row.label !== null ? { label: row.label } : {}),
    value: JSON.parse(row.value_json) as unknown,
    fromVersion: row.version_number ?? 1,
  }));
}

/** What a submit names. */
export interface SubmitInput {
  readonly artifactId: string;
  /** The viewer whose session submits. */
  readonly viewerId: string;
  /** The link the page's session came from: the view must be one it opened. */
  readonly tokenId?: string;
  /** The view the page was opened as; its version is what the submission names (D104). */
  readonly viewId: string;
  /** The draft revision the viewer saw. */
  readonly expectedRevision: number;
  readonly channel: SubmitChannel;
  /** The hosts to deliver to (D105): registered or expected now; empty for the built-in adapter. */
  readonly owners: readonly string[];
  /** Whether the view's version covers a field ID (D109); the others are the orphans. */
  readonly covers: (versionId: string) => (fieldId: string) => boolean;
}

/** What a submit did. */
export interface SubmitOutcome {
  readonly submission: SubmissionSummary;
  /** `false` when it returned an earlier submission of the same view and revision (D22). */
  readonly created: boolean;
}

/**
 * Submits a viewer's draft, in the caller's write transaction (ARCHITECTURE §6). Refusals:
 * `MOSTRA_SUBMIT_VIEW_INVALID` for a view of another viewer or artifact,
 * `MOSTRA_SUBMIT_POLICY_NONE`, `MOSTRA_SUBMIT_ALREADY` (a {@link SubmitConflict}) under `once`,
 * `MOSTRA_SUBMIT_REVISION_MOVED` when the draft changed since the viewer saw it.
 */
export function submit(db: LedgerDb, input: SubmitInput): SubmitOutcome {
  // 1. The view, and through it the exact version the viewer saw, and the channels it accepts.
  const view = viewFor(db, input.viewId, input.artifactId, input.viewerId, input.tokenId);
  assertChannel(view, input.channel);
  const draft = documentFor(db, input.artifactId, input.viewerId, true);
  // A repeat of the same submit (double click, retry, a second request in flight) gets the
  // submission it made (D22), whatever has happened since.
  const repeat = db.get<SubmissionRow>(
    "SELECT * FROM submission WHERE view_id = ? AND draft_document_id = ? AND draft_revision = ? ORDER BY position DESC LIMIT 1",
    view.id,
    draft.id,
    input.expectedRevision,
  );
  if (repeat)
    return { submission: { ...submissionSummary(db, repeat), duplicate: true }, created: false };

  // 2. The policy in force.
  const artifact = db.get<{ policy_json: string | null; latest_version_id: string | null }>(
    "SELECT policy_json, latest_version_id FROM artifact WHERE id = ?",
    input.artifactId,
  );
  if (!artifact) throw new Error(`No artifact ${input.artifactId}.`);
  const policy = storedPolicy(artifact.policy_json);
  if (policy.policy === "none") {
    throw new RpcError(
      createDiagnostic("MOSTRA_SUBMIT_POLICY_NONE", {
        message: "This artifact's submission policy is none: it takes no submissions.",
      }),
    );
  }
  const closing = closingSubmission(db, input.artifactId, input.viewerId);
  if (closing) {
    throw new SubmitConflict(
      `This artifact takes one submission ${policy.policy === "once" && policy.scope === "per-viewer" ? "per viewer" : "in all"}, and it was made at ${closing.created_at}.`,
      submissionSummary(db, closing),
    );
  }

  // 3. The draft revision the viewer saw.
  if (draft.revision !== input.expectedRevision) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SUBMIT_REVISION_MOVED", {
        message: `The draft is at revision ${draft.revision}, not ${input.expectedRevision}: it changed after the viewer saw it.`,
      }),
    );
  }

  // 4. The canonical persisted draft and the artifact state at its current revision.
  const draftRows = db.all<FieldRow>(
    "SELECT * FROM field WHERE document_id = ? AND deleted = 0 ORDER BY field_id",
    draft.id,
  );
  const state = documentFor(db, input.artifactId, null);
  const stateRows = state
    ? db.all<FieldRow>(
        "SELECT * FROM field WHERE document_id = ? AND deleted = 0 ORDER BY field_id",
        state.id,
      )
    : [];
  const version = db.get<{ number: number }>(
    "SELECT number FROM version WHERE id = ?",
    view.version_id,
  ) as { number: number };
  const covered = input.covers(view.version_id);
  const latest =
    artifact.latest_version_id === null
      ? undefined
      : db.get<{ id: string; number: number }>(
          "SELECT id, number FROM version WHERE id = ?",
          artifact.latest_version_id,
        );
  const staleView = latest !== undefined && latest.id !== view.version_id;

  // Epochs (D103): the viewer's next round; once: the one submission of its scope.
  const scopeKey =
    policy.policy === "once" && policy.scope === "per-artifact" ? "" : input.viewerId;
  const previous =
    policy.policy === "epochs"
      ? db.get<{ id: string; epoch: number }>(
          "SELECT id, epoch FROM submission WHERE artifact_id = ? AND viewer_id = ? ORDER BY position DESC LIMIT 1",
          input.artifactId,
          input.viewerId,
        )
      : undefined;
  const epoch =
    policy.policy === "epochs"
      ? Math.max(
          draft.epoch,
          (db.get<{ epoch: number | null }>(
            "SELECT MAX(epoch) AS epoch FROM submission WHERE artifact_id = ? AND scope_key = ?",
            input.artifactId,
            scopeKey,
          )?.epoch ?? 0) + 1,
        )
      : 1;

  const submissionId = SubmissionId.create();
  const at = new Date().toISOString();
  const viewerRecord = viewerById(db, input.viewerId);
  // The view's signals, newest first up to the limits, so a snapshot stays bounded however many
  // a page raised (Claude review finding 2); the count left out is recorded.
  const signalRows = db.all<{ at: string; payload_json: string }>(
    "SELECT at, payload_json FROM event WHERE artifact_id = ? AND type = 'signal.raised' AND json_extract(payload_json, '$.viewId') = ? AND json_extract(payload_json, '$.name') != ? ORDER BY cursor DESC LIMIT ?",
    input.artifactId,
    view.id,
    SUBMIT_SIGNAL,
    SNAPSHOT_SIGNALS_MAX,
  );
  const signals: { name: string; at: string; payload?: unknown }[] = [];
  let signalBytes = 0;
  for (const row of signalRows) {
    signalBytes += row.payload_json.length;
    if (signalBytes > SNAPSHOT_SIGNAL_BYTES_MAX) break;
    const payload = JSON.parse(row.payload_json) as { name: string; payload?: unknown };
    signals.unshift({
      name: payload.name,
      at: row.at,
      ...(payload.payload !== undefined ? { payload: payload.payload } : {}),
    });
  }
  const signalCount =
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM event WHERE artifact_id = ? AND type = 'signal.raised' AND json_extract(payload_json, '$.viewId') = ? AND json_extract(payload_json, '$.name') != ?",
      input.artifactId,
      view.id,
      SUBMIT_SIGNAL,
    )?.n ?? 0;
  const signalsOmitted = signalCount - signals.length;
  // Compaction may have removed some of the view's signals; the snapshot says so (finding 10).
  const signalsCompacted =
    view.opened_cursor !== null &&
    db.get(
      "SELECT 1 FROM event WHERE artifact_id = ? AND type = 'artifact.compacted' AND cursor >= ? AND json_extract(payload_json, '$.types.\"signal.raised\"') > 0",
      input.artifactId,
      view.opened_cursor,
    ) !== undefined;
  const snapshot: Snapshot = {
    schema: 1,
    submissionId,
    at,
    artifactId: input.artifactId,
    versionId: view.version_id,
    version: version.number,
    viewId: view.id,
    viewer: viewerRecord,
    channel: input.channel,
    policy,
    epoch,
    ...(previous ? { previous: previous.id } : {}),
    staleView,
    ...(staleView && latest ? { latestVersion: latest.number } : {}),
    draft: {
      revision: String(draft.revision),
      fields: snapshotFields(draftRows.filter((row) => covered(row.field_id))),
    },
    ...(state
      ? { state: { revision: String(state.revision), fields: snapshotFields(stateRows) } }
      : {}),
    // Fields the view's version doesn't cover are delivered too, labelled (D42, D109).
    orphaned: orphansOf(draftRows.filter((row) => !covered(row.field_id))),
    signals,
    ...(signalsOmitted > 0 ? { signalsOmitted } : {}),
    ...(signalsCompacted ? { signalsCompacted: true as const } : {}),
  };

  // 5. The digest of the canonical snapshot, which must fit one protocol message with room to
  // spare, or no host could ever receive it.
  const snapshotJson = canonicalJson(snapshot);
  if (snapshotJson.length > SNAPSHOT_MAX_LENGTH) {
    throw new RpcError(
      createDiagnostic("MOSTRA_FIELD_TOO_LARGE", {
        message: `This submission would be ${snapshotJson.length} characters, more than a submission may hold (${SNAPSHOT_MAX_LENGTH}).`,
      }),
    );
  }
  const digest = createHash("sha256").update(snapshotJson, "utf8").digest("hex");

  // 8 (first, for its cursor). `submission.created`; its cursor is the submission's position,
  // the order deliveries replay in.
  const actor = { kind: "viewer" as const, id: input.viewerId };
  const causation = { submissionId };
  const position = Number(
    appendEvent(db, {
      artifactId: input.artifactId,
      type: "submission.created",
      actor,
      causation,
      payload: {
        submissionId,
        versionId: view.version_id,
        version: version.number,
        viewId: view.id,
        viewerId: input.viewerId,
        channel: input.channel,
        epoch,
        staleView,
        digest,
      },
    }),
  );
  // 6. The immutable submission.
  db.run(
    `INSERT INTO submission (id, position, artifact_id, version_id, view_id, viewer_id, channel, policy_json, epoch, scope_key,
       previous_id, draft_document_id, draft_revision, state_revision, latest_version_number, snapshot_json, digest, stale_view, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    submissionId,
    position,
    input.artifactId,
    view.version_id,
    view.id,
    input.viewerId,
    input.channel,
    JSON.stringify(policy),
    epoch,
    scopeKey,
    previous?.id ?? null,
    draft.id,
    draft.revision,
    state?.revision ?? null,
    staleView && latest ? latest.number : null,
    snapshotJson,
    digest,
    staleView ? 1 : 0,
    at,
  );
  // The next round starts with the same values (D103).
  if (policy.policy === "epochs") {
    db.run("UPDATE document SET epoch = ? WHERE id = ?", epoch + 1, draft.id);
  }
  // 7. One delivery per host, durable with the submission (IN-12).
  const owners = input.owners.length > 0 ? [...new Set(input.owners)].sort() : [BUILT_IN_OWNER];
  for (const owner of owners) {
    db.run(
      "INSERT INTO delivery (id, submission_id, position, port_owner, state, attempts, next_attempt_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
      DeliveryId.create(),
      submissionId,
      position,
      owner,
      at,
      at,
    );
  }
  // Submit is the standard signal (D106).
  raiseSubmitSignal(db, {
    artifactId: input.artifactId,
    submissionId,
    channel: input.channel,
    actor,
    viewId: view.id,
  });
  const row = db.get<SubmissionRow>(
    "SELECT * FROM submission WHERE id = ?",
    submissionId,
  ) as SubmissionRow;
  return { submission: submissionSummary(db, row), created: true };
}
