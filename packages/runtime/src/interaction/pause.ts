/**
 * Pausing an artifact (D165 item 14, RM-09): a paused artifact stays viewable and its shell says
 * so; it takes no submissions (the submit transaction refuses them) and runs no actions until it
 * is resumed, and every draft is kept. The owner pauses and resumes its own pause; an operator's
 * pause is resumed only by the operator. One row per paused artifact (`artifact_pause`, DATA_MODEL
 * §7.2), in local and hosted homes alike; each change appends `artifact.paused` or
 * `artifact.resumed`, so open pages learn of it.
 */
import { createDiagnostic, type PausedBy, RpcError } from "@mostra/protocol";
import type { LedgerDb } from "../ledger/index.ts";
import { appendEvent } from "./events.ts";

/** An artifact's pause, while it is paused. */
export interface Pause {
  readonly by: PausedBy;
  readonly reason?: string;
  readonly at: string;
}

/** The artifact's pause, or `undefined` when it isn't paused. */
export function pauseOf(db: LedgerDb, artifactId: string): Pause | undefined {
  const row = db.get<{ by: PausedBy; reason: string | null; paused_at: string }>(
    "SELECT by, reason, paused_at FROM artifact_pause WHERE artifact_id = ?",
    artifactId,
  );
  return row
    ? { by: row.by, ...(row.reason !== null ? { reason: row.reason } : {}), at: row.paused_at }
    : undefined;
}

/**
 * Pauses or resumes an artifact, in the caller's write transaction, as `by`. Pausing what is
 * paused keeps the earlier pause (an operator's pause over an owner's takes it over, so only the
 * operator ends it); resuming what isn't paused does nothing. The owner resuming an operator's
 * pause is `MOSTRA_REMOTE_PAUSED_BY_OPERATOR`.
 */
export function setPause(
  db: LedgerDb,
  artifactId: string,
  change: { readonly paused: boolean; readonly by: PausedBy; readonly reason?: string },
): { readonly paused: boolean; readonly by?: PausedBy } {
  const current = pauseOf(db, artifactId);
  if (change.paused) {
    if (current && (current.by === "operator" || change.by === "owner")) {
      return { paused: true, by: current.by };
    }
    db.run(
      `INSERT INTO artifact_pause (artifact_id, by, reason, paused_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (artifact_id) DO UPDATE SET by = excluded.by, reason = excluded.reason,
           paused_at = excluded.paused_at`,
      artifactId,
      change.by,
      change.reason ?? null,
      new Date().toISOString(),
    );
    appendEvent(db, {
      artifactId,
      type: "artifact.paused",
      actor: change.by === "operator" ? { kind: "mostra" } : { kind: "agent" },
      payload: { by: change.by, ...(change.reason !== undefined ? { reason: change.reason } : {}) },
    });
    return { paused: true, by: change.by };
  }
  if (!current) return { paused: false };
  if (current.by === "operator" && change.by === "owner") {
    throw new RpcError(
      createDiagnostic("MOSTRA_REMOTE_PAUSED_BY_OPERATOR", {
        message: "The server's operator paused this artifact; only the operator resumes it.",
      }),
    );
  }
  db.run("DELETE FROM artifact_pause WHERE artifact_id = ?", artifactId);
  appendEvent(db, {
    artifactId,
    type: "artifact.resumed",
    actor: change.by === "operator" ? { kind: "mostra" } : { kind: "agent" },
    payload: { by: change.by },
  });
  return { paused: false };
}
