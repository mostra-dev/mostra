/**
 * Action runs in the ledger (DATA_MODEL §3, AC-02, AC-03): a run and its result batches are
 * write-once like submissions and versions, and a client key joins only its own request.
 */
import { ArtifactId } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  appendRunOutput,
  createOrJoinRun,
  finishRun,
  type NewRun,
} from "../../src/interaction/runs.ts";
import { addArtifact, freshLedger, viewOf } from "../interaction-support.ts";

function setup() {
  const { ledger } = freshLedger();
  const { artifactId, versions } = addArtifact(ledger, { id: ArtifactId.create() });
  const page = viewOf(ledger, artifactId, versions[0] as string);
  const run = (extra: Partial<NewRun> = {}): NewRun => ({
    artifactId,
    versionId: versions[0] as string,
    viewId: page.viewId,
    viewerId: page.viewerId,
    fnId: "actions.ts#send",
    args: [[{ c: 0, v: [] }]],
    clientKey: `ck-${Math.random()}`,
    actor: { kind: "viewer", id: page.viewerId },
    ...extra,
  });
  return { ledger, run };
}

describe("action runs in the ledger", () => {
  it("never replaces a run, and keeps a finished run's batches as they are (Opus review 11)", () => {
    const { ledger, run } = setup();
    const { row } = ledger.write((db) => createOrJoinRun(db, run({ key: "send.1" })));
    ledger.write((db) =>
      appendRunOutput(db, row.id, { lines: ["one"], batches: [[{ c: 0, v: "sent" }]] }),
    );
    ledger.write((db) => finishRun(db, row.id, { status: "succeeded" }));
    const refused = (sql: string, ...params: (string | number)[]) =>
      expect(() => ledger.write((db) => db.run(sql, ...params))).toThrow(
        /never replaced|never changes|kept with its run|no more result batches/,
      );
    const columns = Object.keys(
      ledger.read((db) =>
        db.get<Record<string, unknown>>("SELECT * FROM action_run WHERE id = ?", row.id),
      ) ?? {},
    ).filter((column) => (row as unknown as Record<string, unknown>)[column] !== null);
    refused(
      `INSERT OR REPLACE INTO action_run (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ...columns.map((column) =>
        column === "status"
          ? "queued"
          : ((row as unknown as Record<string, string | number>)[column] as string | number),
      ),
    );
    refused("DELETE FROM action_run_batch WHERE run_id = ?", row.id);
    refused("INSERT INTO action_run_batch (run_id, seq, batch_json) VALUES (?, 1, '[]')", row.id);
    refused(
      "INSERT OR REPLACE INTO action_run_batch (run_id, seq, batch_json) VALUES (?, 0, '[]')",
      row.id,
    );
    const stored = ledger.read((db) =>
      db.get<{ status: string; batches: number }>(
        "SELECT status, batches FROM action_run WHERE id = ?",
        row.id,
      ),
    );
    expect(stored).toEqual({ status: "succeeded", batches: 1 });
  });

  it("joins a retried client key only for the same function (Opus review 9)", () => {
    const { ledger, run } = setup();
    const first = run({ fnId: "actions.ts#slow", clientKey: "ck-shared" });
    const { row } = ledger.write((db) => createOrJoinRun(db, first));
    expect(ledger.write((db) => createOrJoinRun(db, first))).toMatchObject({
      joined: true,
      row: { id: row.id },
    });
    expect(() =>
      ledger.write((db) =>
        createOrJoinRun(db, run({ fnId: "actions.ts#echo", clientKey: "ck-shared" })),
      ),
    ).toThrow(/belongs to another request/);
  });
});
