/**
 * Pausing an artifact (D165 item 14, RM-09): a paused artifact stays viewable and its shell says
 * so; it takes no submissions (the submit transaction refuses them) and runs no actions until it
 * is resumed, and every draft is kept. The owner pauses and resumes its own pause; an operator's
 * pause is resumed only by the operator. One row per party that paused it (`artifact_pause`,
 * DATA_MODEL §7.2), in local and hosted homes alike; each change appends `artifact.paused` or
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

/**
 * The artifact's pause, or `undefined` when it isn't paused: the operator's when both paused it,
 * since only the operator lifts that one.
 */
export function pauseOf(db: LedgerDb, artifactId: string): Pause | undefined {
  const row = db.get<{ by: PausedBy; reason: string | null; paused_at: string }>(
    "SELECT by, reason, paused_at FROM artifact_pause WHERE artifact_id = ? ORDER BY by = 'operator' DESC LIMIT 1",
    artifactId,
  );
  return row
    ? { by: row.by, ...(row.reason !== null ? { reason: row.reason } : {}), at: row.paused_at }
    : undefined;
}

/**
 * Pauses or resumes an artifact, in the caller's write transaction, as `by`. The owner's pause and
 * the operator's are kept apart (one row each): pausing again keeps the earlier pause of the same
 * party, and a resume lifts only its own party's, so the artifact takes answers again once no
 * pause is left. The owner resuming while the operator's pause stands is
 * `MOSTRA_REMOTE_PAUSED_BY_OPERATOR`, and changes nothing.
 */
export function setPause(
  db: LedgerDb,
  artifactId: string,
  change: { readonly paused: boolean; readonly by: PausedBy; readonly reason?: string },
): { readonly paused: boolean; readonly by?: PausedBy } {
  const own = db.get<{ by: PausedBy }>(
    "SELECT by FROM artifact_pause WHERE artifact_id = ? AND by = ?",
    artifactId,
    change.by,
  );
  const actor = change.by === "operator" ? { kind: "mostra" as const } : { kind: "agent" as const };
  if (change.paused) {
    if (!own) {
      const before = pauseOf(db, artifactId);
      db.run(
        "INSERT INTO artifact_pause (artifact_id, by, reason, paused_at) VALUES (?, ?, ?, ?)",
        artifactId,
        change.by,
        change.reason ?? null,
        new Date().toISOString(),
      );
      // Open pages learn of a change they can see: a first pause, or the operator's over the owner's.
      if (before === undefined || change.by === "operator") {
        appendEvent(db, {
          artifactId,
          type: "artifact.paused",
          actor,
          payload: {
            by: change.by,
            ...(change.reason !== undefined ? { reason: change.reason } : {}),
          },
        });
      }
    }
    const now = pauseOf(db, artifactId) as Pause;
    return { paused: true, by: now.by };
  }
  // The owner can't lift a pause while the operator's stands: nothing changes, its own included.
  if (change.by === "owner" && pauseOf(db, artifactId)?.by === "operator") {
    throw new RpcError(
      createDiagnostic("MOSTRA_REMOTE_PAUSED_BY_OPERATOR", {
        message: "The server's operator paused this artifact; only the operator resumes it.",
      }),
    );
  }
  if (own) {
    db.run("DELETE FROM artifact_pause WHERE artifact_id = ? AND by = ?", artifactId, change.by);
  }
  const left = pauseOf(db, artifactId);
  if (left === undefined) {
    if (own) {
      appendEvent(db, { artifactId, type: "artifact.resumed", actor, payload: { by: change.by } });
    }
    return { paused: false };
  }
  // The operator lifted its own pause; the owner's stays, and so does the page's notice.
  if (own) {
    appendEvent(db, {
      artifactId,
      type: "artifact.paused",
      actor: { kind: "agent" },
      payload: { by: left.by, ...(left.reason !== undefined ? { reason: left.reason } : {}) },
    });
  }
  return { paused: true, by: left.by };
}
