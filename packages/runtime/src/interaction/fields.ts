/**
 * Fields and documents (D22, D52, D63, D106; ARCHITECTURE §6). A document is a viewer's draft or
 * an artifact's shared state: a map from field ID to value, each field carrying the document
 * revision that last wrote it, under a revision that only grows. A mutation applies its ops
 * together: an op whose field changed after the mutation's base revision is a conflict and leaves
 * the field alone, the others apply under one new revision, and the result is recorded under the
 * mutation's ID so a retry replays it.
 */
import { createHash } from "node:crypto";
import {
  type Actor,
  canonicalJson,
  createDiagnostic,
  type FieldConflict,
  type FieldOp,
  type FieldScope,
  type FieldState,
  isFieldId,
  type MutationResult,
  RpcError,
} from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";

/** The largest field value, as UTF-8 JSON (DATA_MODEL §5). */
export const FIELD_VALUE_MAX_BYTES: number = 1024 * 1024;

/** The largest document: every live field value together (DATA_MODEL §5). */
export const DOCUMENT_MAX_BYTES: number = 16 * 1024 * 1024;

/** A `document` row. */
export interface DocumentRow {
  readonly id: number;
  readonly artifact_id: string;
  readonly scope: FieldScope;
  readonly viewer_id: string | null;
  readonly revision: number;
  readonly epoch: number;
  readonly size: number;
}

/** A `field` row. */
export interface FieldRow {
  readonly document_id: number;
  readonly field_id: string;
  readonly value_json: string;
  readonly deleted: number;
  readonly field_rev: number;
  readonly updated_by_json: string | null;
  readonly updated_at: string;
  readonly sensitive: number;
  readonly label: string | null;
  readonly required: number | null;
  readonly orphaned_from_version: number | null;
}

/**
 * The document for an artifact's state (`viewerId` null) or a viewer's draft, created when
 * `create` is set and it doesn't exist yet.
 */
export function documentFor(
  db: LedgerDb,
  artifactId: string,
  viewerId: string | null,
  create: true,
): DocumentRow;
export function documentFor(
  db: LedgerDb,
  artifactId: string,
  viewerId: string | null,
  create?: false,
): DocumentRow | undefined;
export function documentFor(
  db: LedgerDb,
  artifactId: string,
  viewerId: string | null,
  create = false,
): DocumentRow | undefined {
  const find = (): DocumentRow | undefined =>
    viewerId === null
      ? db.get<DocumentRow>(
          "SELECT * FROM document WHERE artifact_id = ? AND scope = 'artifact'",
          artifactId,
        )
      : db.get<DocumentRow>(
          "SELECT * FROM document WHERE artifact_id = ? AND scope = 'viewer' AND viewer_id = ?",
          artifactId,
          viewerId,
        );
  const found = find();
  if (found || !create) return found;
  db.run(
    "INSERT INTO document (artifact_id, scope, viewer_id) VALUES (?, ?, ?)",
    artifactId,
    viewerId === null ? "artifact" : "viewer",
    viewerId,
  );
  return find() as DocumentRow;
}

/** A live field as the wire carries it. */
export function fieldState(row: FieldRow): FieldState {
  return {
    value: JSON.parse(row.value_json) as unknown,
    revision: String(row.field_rev),
    ...(row.updated_by_json !== null
      ? { updatedBy: JSON.parse(row.updated_by_json) as Actor }
      : {}),
    updatedAt: row.updated_at,
    ...(row.label !== null ? { label: row.label } : {}),
    ...(row.required !== null ? { required: row.required === 1 } : {}),
    ...(row.sensitive === 1 ? { sensitive: true } : {}),
  };
}

/** A document's live fields (deleted and orphaned ones left out), by ID. */
export function liveFields(
  db: LedgerDb,
  documentId: number | undefined,
): Record<string, FieldState> {
  if (documentId === undefined) return {};
  const rows = db.all<FieldRow>(
    "SELECT * FROM field WHERE document_id = ? AND deleted = 0 AND orphaned_from_version IS NULL ORDER BY field_id",
    documentId,
  );
  return Object.fromEntries(rows.map((row) => [row.field_id, fieldState(row)]));
}

/** What a mutation needs besides its ops. */
export interface MutationInput {
  readonly artifactId: string;
  readonly scope: FieldScope;
  /** The draft's viewer, for `scope: "viewer"`. */
  readonly viewerId?: string;
  readonly mutationId: string;
  /** The revision the writer last saw; absent writes unconditionally (agents and hosts, D106). */
  readonly baseRevision?: number;
  readonly ops: readonly FieldOp[];
  readonly actor: Actor;
  /** The view a viewer's mutation came from, recorded as its cause. */
  readonly viewId?: string;
}

/** What {@link applyMutation} did, for the caller's follow-ups (mirrors, streams). */
export interface MutationOutcome {
  readonly result: MutationResult;
  /** Whether the document changed (a new revision committed). */
  readonly changed: boolean;
  /** Whether the result was replayed from an earlier attempt. */
  readonly replayed: boolean;
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message }), -32602);
}

function tooLarge(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_FIELD_TOO_LARGE", { message }));
}

/** Checks the ops before anything is read: IDs, one change each, JSON values within limits. */
function checkOps(ops: readonly FieldOp[]): Map<string, string | undefined> {
  if (ops.length === 0) throw invalid("A mutation needs at least one op.");
  const encoded = new Map<string, string | undefined>();
  for (const op of ops) {
    if (!isFieldId(op.id)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_FIELD_ID_INVALID", {
          message: `${JSON.stringify(op.id).slice(0, 80)} isn't a field ID.`,
        }),
      );
    }
    if (encoded.has(op.id)) throw invalid(`The field ${op.id} appears twice in one mutation.`);
    const deletes = op.delete === true;
    if (deletes === (op.value !== undefined)) {
      throw invalid(`The op for ${op.id} needs exactly one of value and delete.`);
    }
    if (deletes) {
      encoded.set(op.id, undefined);
      continue;
    }
    let json: string;
    try {
      // The canonical form checks it is JSON that I-JSON can hold; the stored text keeps the
      // writer's order, which reads back as the same value.
      canonicalJson(op.value);
      json = JSON.stringify(op.value);
    } catch {
      throw invalid(`The value of ${op.id} isn't JSON.`);
    }
    if (Buffer.byteLength(json, "utf8") > FIELD_VALUE_MAX_BYTES) {
      throw tooLarge(`The value of ${op.id} is larger than 1 MiB of JSON.`);
    }
    encoded.set(op.id, json);
  }
  return encoded;
}

/** The digest a mutation ID is recorded with: everything the mutation asked, as canonical JSON. */
function mutationDigest(input: MutationInput): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        artifactId: input.artifactId,
        scope: input.scope,
        viewerId: input.viewerId ?? null,
        baseRevision: input.baseRevision ?? null,
        ops: input.ops,
      }),
    )
    .digest("hex");
}

function conflictOf(row: FieldRow): FieldConflict {
  return {
    id: row.field_id,
    revision: String(row.field_rev),
    ...(row.deleted === 1 ? { deleted: true as const } : { value: JSON.parse(row.value_json) }),
    ...(row.updated_by_json !== null
      ? { updatedBy: JSON.parse(row.updated_by_json) as Actor }
      : {}),
    updatedAt: row.updated_at,
  };
}

/**
 * Applies a mutation inside the caller's write transaction (D22, IN-01, LL-01). The mutation ID
 * replays its recorded result; the same ID with other contents is
 * `MOSTRA_FIELD_MUTATION_ID_REUSED`. Each changed field takes the new revision; each conflict
 * names what the field holds now. Changes append `draft.changed` or `state.changed`, conflicts
 * `draft.conflict` or `state.conflict`, with sensitive values left out (D52).
 */
export function applyMutation(db: LedgerDb, input: MutationInput): MutationOutcome {
  if ((input.scope === "viewer") !== (input.viewerId !== undefined)) {
    throw new Error("A draft mutation names its viewer, and only a draft mutation does.");
  }
  const encoded = checkOps(input.ops);
  const digest = mutationDigest(input);
  const recorded = db.get<{ params_digest: string; result_json: string }>(
    "SELECT params_digest, result_json FROM mutation WHERE id = ?",
    input.mutationId,
  );
  if (recorded) {
    if (recorded.params_digest !== digest) {
      throw new RpcError(
        createDiagnostic("MOSTRA_FIELD_MUTATION_ID_REUSED", {
          message: `The mutation ID ${input.mutationId} was used for another change.`,
        }),
      );
    }
    return {
      result: JSON.parse(recorded.result_json) as MutationResult,
      changed: false,
      replayed: true,
    };
  }

  const document = documentFor(db, input.artifactId, input.viewerId ?? null, true);
  const revision = document.revision + 1;
  const now = new Date().toISOString();
  const applied: string[] = [];
  const conflicts: FieldConflict[] = [];
  const changes: Record<string, unknown>[] = [];
  let size = document.size;
  const writes: (() => void)[] = [];
  for (const op of input.ops) {
    const row = db.get<FieldRow>(
      "SELECT * FROM field WHERE document_id = ? AND field_id = ?",
      document.id,
      op.id,
    );
    if (input.baseRevision !== undefined && row && row.field_rev > input.baseRevision) {
      conflicts.push(conflictOf(row));
      continue;
    }
    applied.push(op.id);
    const json = encoded.get(op.id);
    const oldSize =
      row && row.deleted === 0 && row.orphaned_from_version === null
        ? Buffer.byteLength(row.value_json, "utf8")
        : 0;
    const sensitive = op.sensitive ?? (row ? row.sensitive === 1 : false);
    if (json === undefined) {
      // Deleting what isn't there changes nothing and needs no new revision.
      if (!row || row.deleted === 1) continue;
      size -= oldSize;
      writes.push(() =>
        db.run(
          "UPDATE field SET value_json = 'null', deleted = 1, field_rev = ?, updated_by_json = ?, updated_at = ?, orphaned_from_version = NULL WHERE document_id = ? AND field_id = ?",
          revision,
          JSON.stringify(input.actor),
          now,
          document.id,
          op.id,
        ),
      );
      changes.push({ id: op.id, deleted: true });
      continue;
    }
    size += Buffer.byteLength(json, "utf8") - oldSize;
    const label = op.label ?? row?.label ?? null;
    const required = op.required !== undefined ? (op.required ? 1 : 0) : (row?.required ?? null);
    writes.push(() =>
      db.run(
        `INSERT INTO field (document_id, field_id, value_json, deleted, field_rev, updated_by_json, updated_at, sensitive, label, required, orphaned_from_version)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (document_id, field_id) DO UPDATE SET value_json = excluded.value_json, deleted = 0,
           field_rev = excluded.field_rev, updated_by_json = excluded.updated_by_json,
           updated_at = excluded.updated_at, sensitive = excluded.sensitive, label = excluded.label,
           required = excluded.required, orphaned_from_version = NULL`,
        document.id,
        op.id,
        json,
        revision,
        JSON.stringify(input.actor),
        now,
        sensitive ? 1 : 0,
        label,
        required,
      ),
    );
    changes.push(
      sensitive
        ? { id: op.id, sensitive: true }
        : { id: op.id, value: JSON.parse(json) as unknown },
    );
  }
  if (size > DOCUMENT_MAX_BYTES) {
    throw tooLarge(
      `This change would make the ${input.scope === "viewer" ? "draft" : "artifact state"} larger than 16 MiB.`,
    );
  }

  const changed = writes.length > 0;
  for (const write of writes) write();
  if (changed) {
    db.run("UPDATE document SET revision = ?, size = ? WHERE id = ?", revision, size, document.id);
  }
  const current = changed ? revision : document.revision;
  const causation = {
    mutationId: input.mutationId,
    ...(input.viewId !== undefined ? { viewId: input.viewId } : {}),
  };
  const subject =
    input.scope === "viewer" ? { viewerId: input.viewerId as string, epoch: document.epoch } : {};
  if (changed) {
    appendEvent(db, {
      artifactId: input.artifactId,
      type: input.scope === "viewer" ? "draft.changed" : "state.changed",
      actor: input.actor,
      causation,
      payload: { ...subject, revision: String(current), changes },
    });
  }
  if (conflicts.length > 0) {
    appendEvent(db, {
      artifactId: input.artifactId,
      type: input.scope === "viewer" ? "draft.conflict" : "state.conflict",
      actor: input.actor,
      causation,
      payload: {
        ...subject,
        revision: String(current),
        base: String(input.baseRevision),
        fields: conflicts.map((conflict) => ({ id: conflict.id, revision: conflict.revision })),
      },
    });
  }
  const result: MutationResult = { revision: String(current), applied, conflicts };
  db.run(
    "INSERT INTO mutation (id, document_id, params_digest, result_json, applied_at) VALUES (?, ?, ?, ?, ?)",
    input.mutationId,
    document.id,
    digest,
    JSON.stringify(result),
    now,
  );
  return { result, changed, replayed: false };
}
