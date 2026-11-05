/**
 * Counts by choice (RM-07, D165 item 12; DATA_MODEL §7.4): a manifest `tally` counts each accepted
 * submission's choice inside the submit transaction, and viewers read the counts under the live key
 * `$tally/<field>` with no artifact code: the live module here has a pool that fails every use, so
 * no worker could have produced them.
 */
import {
  ArtifactId,
  type EphemeralMessage,
  type LiveState,
  TALLY_LIVE_PREFIX,
  type TallyValue,
  VersionId,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { appendEvent } from "../../src/interaction/events.ts";
import {
  createEphemeralBus,
  createInteraction,
  type Interaction,
} from "../../src/interaction/index.ts";
import { viewerForSpec } from "../../src/interaction/viewers.ts";
import type { Ledger } from "../../src/ledger/index.ts";
import { createLive, type Live } from "../../src/live/index.ts";
import { silentLog } from "../../src/log.ts";
import type { WorkerPool } from "../../src/workers/index.ts";
import { FakeHosts, freshLedger, until } from "../interaction-support.ts";

const CHOICES = ["ship", "wait", "drop"] as const;

/** A pool that refuses every use: a tally needs no worker. */
const noWorkers = new Proxy(
  {},
  {
    get() {
      throw new Error("a tally must never reach a worker");
    },
  },
) as WorkerPool;

/** Inserts an artifact whose version `number` has `manifest`, the latest; returns its version. */
function publish(
  ledger: Ledger,
  artifactId: string,
  number: number,
  manifest: Record<string, unknown>,
): string {
  return ledger.write((db) => {
    if (number === 1) {
      db.run(
        "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, 'Poll', 'questionnaire', '[]', ?, ?, NULL)",
        artifactId,
        JSON.stringify({ policy: "once", scope: "per-viewer" }),
        new Date().toISOString(),
      );
      appendEvent(db, { artifactId, type: "artifact.created", payload: {} });
    }
    const digest = new Uint8Array(32);
    digest[0] = number;
    digest[1] = artifactId.charCodeAt(10);
    const id = VersionId.fromSha256(digest);
    db.run(
      "INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest, manifest_json, forced_codes_json, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      id,
      artifactId,
      number,
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({ title: "Poll", ...manifest }),
      new Date().toISOString(),
    );
    db.run("UPDATE artifact SET latest_version_id = ? WHERE id = ?", id, artifactId);
    appendEvent(db, { artifactId, type: "version.published", payload: { versionId: id, number } });
    return id;
  });
}

function setup(manifest: Record<string, unknown>) {
  const { ledger } = freshLedger();
  const artifactId = ArtifactId.create();
  const versionId = publish(ledger, artifactId, 1, manifest);
  const interaction: Interaction = createInteraction({
    coverage: () => () => true,
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts: new FakeHosts(),
    expectedHosts: () => [],
    artifacts: { resolve: () => artifactId },
  });
  const bus = createEphemeralBus();
  const live: Live = createLive({
    ledger,
    log: silentLog,
    bus,
    pool: noWorkers,
    interaction,
    latest: () => undefined,
    artifactsWithLive: () => [],
    version: () => undefined,
    reconcileMs: 60_000,
  });
  live.start();
  /** One respondent: their own viewer and view, their answer, their submit. */
  const respond = (n: number, answer: unknown, field = "decision") => {
    const viewerId = ledger.write((db) => viewerForSpec(db, { ref: `person-${n}` }));
    const page = { artifactId, viewerId };
    const viewId = interaction.openView({ artifactId, versionId, viewerId });
    const mutation = interaction.mutate(page, {
      viewId,
      scope: "viewer",
      mutationId: `mut_${String(n).padStart(26, "0")}`,
      baseRevision: 0,
      ops: [{ id: field, value: answer }],
    });
    return interaction.submit(page, {
      viewId,
      expectedRevision: Number(mutation.revision),
      channel: "artifact",
    });
  };
  /** What a page reads under the tally's key. */
  const read = (field = "decision"): { state: LiveState; value: TallyValue | undefined } => {
    const viewerId = ledger.write((db) => viewerForSpec(db, { ref: "reader" }));
    const viewId = interaction.openView({ artifactId, versionId, viewerId });
    const [state] = live.read(
      { artifactId, viewerId },
      { viewId, keys: [{ key: `${TALLY_LIVE_PREFIX}${field}` }] },
    );
    const value = (state?.value?.[0]?.[0] as { v?: TallyValue } | undefined)?.v;
    return { state: state as LiveState, value };
  };
  return { ledger, artifactId, versionId, interaction, bus, live, respond, read };
}

describe("counts by choice (RM-07)", () => {
  it("counts three hundred submissions across three choices exactly, in the submit transaction", () => {
    const { respond, read, ledger, artifactId } = setup({
      tally: [{ field: "decision", choices: [...CHOICES] }],
    });
    const expected = { ship: 0, wait: 0, drop: 0 };
    for (let n = 0; n < 300; n++) {
      const choice = CHOICES[n % 7 < 4 ? 0 : n % 7 < 6 ? 1 : 2] as (typeof CHOICES)[number];
      expected[choice] += 1;
      respond(n, choice);
    }
    expect(read().value).toEqual({ counts: expected, total: 300 });
    expect(read().state.revision).toBe("300");
    const rows = ledger.read((db) =>
      db.all<{ choice: string; count: number }>(
        "SELECT choice, count FROM tally WHERE artifact_id = ? ORDER BY choice",
        artifactId,
      ),
    );
    expect(Object.fromEntries(rows.map((row) => [row.choice, row.count]))).toEqual(expected);
  });

  it("counts nothing for a value outside the listed choices, or for none, so free text is never shown", () => {
    const { respond, read, ledger, artifactId } = setup({
      tally: [{ field: "decision", choices: [...CHOICES] }],
    });
    respond(1, "ship");
    respond(2, "my secret reason: ship it later");
    respond(3, { choice: "ship" });
    respond(4, ["ship"]);
    respond(5, "Ship");
    respond(6, "ship", "comment");
    expect(read().value).toEqual({ counts: { ship: 1, wait: 0, drop: 0 }, total: 1 });
    expect(JSON.stringify(read().state)).not.toContain("secret");
    // Nothing of the other answers is kept either: one row, and a revision of one.
    expect(read().state.revision).toBe("1");
    expect(
      ledger.read((db) =>
        db.all<{ choice: string }>("SELECT choice FROM tally WHERE artifact_id = ?", artifactId),
      ),
    ).toEqual([{ choice: "ship" }]);
  });

  it("shows only the total below minTotal, and the counts from it on", () => {
    const { respond, read } = setup({
      tally: [{ field: "decision", choices: [...CHOICES], minTotal: 3 }],
    });
    respond(1, "ship");
    respond(2, "wait");
    expect(read().value).toEqual({ total: 2 });
    respond(3, "ship");
    expect(read().value).toEqual({ counts: { ship: 2, wait: 1, drop: 0 }, total: 3 });
  });

  it("pushes the new counts on the live channel to a view reading them, with no worker running", async () => {
    const { respond, read, bus, artifactId, ledger, versionId, interaction } = setup({
      tally: [{ field: "decision", choices: [...CHOICES] }],
    });
    // A viewer reads the tally, then listens on its view's stream.
    const viewerId = ledger.write((db) => viewerForSpec(db, { ref: "watcher" }));
    const viewId = interaction.openView({ artifactId, versionId, viewerId });
    read();
    const heard: EphemeralMessage[] = [];
    bus.watchLive(artifactId, viewId, [{ key: `${TALLY_LIVE_PREFIX}decision` }]);
    bus.listen(artifactId, viewId, (message) => heard.push(message));
    respond(1, "drop");
    respond(2, "drop");
    await until(() => heard.length >= 2);
    const last = heard.at(-1) as Extract<EphemeralMessage, { kind: "live" }>;
    expect(last.live.key).toBe("$tally/decision");
    expect(last.live.revision).toBe("2");
    expect((last.live.value?.[0]?.[0] as { v: TallyValue } | undefined)?.v).toEqual({
      counts: { ship: 0, wait: 0, drop: 2 },
      total: 2,
    });
  });

  it("never lets a count go down, be replaced or be removed (triggers)", () => {
    const { respond, ledger, artifactId } = setup({
      tally: [{ field: "decision", choices: [...CHOICES] }],
    });
    respond(1, "ship");
    const attempts = [
      "UPDATE tally SET count = count - 1",
      "UPDATE tally SET choice = 'wait'",
      "DELETE FROM tally",
      `INSERT OR REPLACE INTO tally (artifact_id, field_id, choice, count) VALUES ('${artifactId}', 'decision', 'ship', 0)`,
    ];
    for (const sql of attempts) {
      expect(() => ledger.write((db) => db.run(sql))).toThrow(/tally/);
    }
    expect(ledger.read((db) => db.get<{ count: number }>("SELECT count FROM tally")?.count)).toBe(
      1,
    );
  });

  it("reads nothing for a field the latest version doesn't tally, and refuses a push to a tally's key", async () => {
    const { read, live, artifactId } = setup({});
    expect(read().state).toEqual({ key: "$tally/decision" });
    await expect(live.push(artifactId, { key: "$tally/decision", value: 1 })).rejects.toThrow();
  });
});
