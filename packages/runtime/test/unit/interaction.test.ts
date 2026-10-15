/**
 * The interaction core against a real ledger, in-process (IN-01, IN-05 to IN-12, LL-01, LL-02):
 * property tests for compare-and-set, rebase and conflicts, and for event order; the submit
 * transaction under every policy; signals; `wait`; results; the outbox with a fake host. The
 * integration suite repeats the observable parts through a real instance.
 */
import { createHash } from "node:crypto";
import {
  ArtifactId,
  canonicalJson,
  type EventRecord,
  type FieldOp,
  type MutationResult,
  Results,
  RpcError,
  SubmissionEnvelope,
  ViewerId,
} from "@mostra/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { compactEvents, readEvents } from "../../src/interaction/events.ts";
import { applyMutation, documentFor, liveFields } from "../../src/interaction/fields.ts";
import { createInteraction } from "../../src/interaction/index.ts";
import { backoffMs } from "../../src/interaction/outbox.ts";
import { buildResults, nestFields, resultsMarkdown } from "../../src/interaction/results.ts";
import { raiseSignal } from "../../src/interaction/signals.ts";
import {
  type Snapshot,
  type SubmissionRow,
  SubmitConflict,
  submit,
} from "../../src/interaction/submissions.ts";
import { localViewerId, viewerForSpec } from "../../src/interaction/viewers.ts";
import { checkCondition, waitFor } from "../../src/interaction/wait.ts";
import type { Ledger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import type { Session } from "../../src/protocol-server/index.ts";
import {
  addArtifact,
  FakeHosts,
  freshLedger,
  mutationId,
  open,
  publishVersion,
  set,
  until,
  viewOf,
} from "../interaction-support.ts";

const agent = { kind: "agent" as const, id: "test-agent" };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic.code;
    throw error;
  }
  return undefined;
}

function mutate(
  ledger: Ledger,
  artifactId: string,
  ops: readonly FieldOp[],
  options: { base?: number; viewerId?: string; id?: string } = {},
): MutationResult {
  return ledger.write(
    (db) =>
      applyMutation(db, {
        artifactId,
        scope: options.viewerId === undefined ? "artifact" : "viewer",
        ...(options.viewerId !== undefined ? { viewerId: options.viewerId } : {}),
        mutationId: options.id ?? mutationId(),
        ...(options.base !== undefined ? { baseRevision: options.base } : {}),
        ops,
        actor: options.viewerId === undefined ? agent : { kind: "viewer", id: options.viewerId },
      }).result,
  );
}

function events(ledger: Ledger, artifactId?: string): EventRecord[] {
  return ledger.read(
    (db) =>
      readEvents(db, {
        filter: artifactId ? { artifacts: [artifactId] } : undefined,
        after: 0,
        limit: 1000,
        maxBytes: Number.POSITIVE_INFINITY,
      }).events,
  );
}

describe("fields: compare-and-set, rebase, conflicts and replay (IN-01, LL-01)", () => {
  it("keeps revisions monotonic, applies an op only when its field is unchanged since the base, and replays mutation IDs (property)", () => {
    const fieldId = fc.constantFrom("a", "b", "c.d", "c.e");
    const op = fc.oneof(
      fc.record({ id: fieldId, value: fc.integer({ min: 0, max: 9 }) }),
      fc.record({ id: fieldId, delete: fc.constant(true as const) }),
    );
    const command = fc.record({
      ops: fc.uniqueArray(op, { minLength: 1, maxLength: 4, selector: (entry) => entry.id }),
      base: fc.oneof(fc.constant("latest" as const), fc.constant("none" as const), fc.nat()),
      replay: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(command, { minLength: 1, maxLength: 25 }), (commands) => {
        const { ledger } = freshLedger();
        const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
        const model = new Map<string, { value: unknown; rev: number; deleted: boolean }>();
        let revision = 0;
        const done: { id: string; ops: FieldOp[]; base?: number; result: MutationResult }[] = [];
        for (const entry of commands) {
          if (entry.replay && done.length > 0) {
            const earlier = done[entry.ops.length % done.length] as (typeof done)[number];
            const replayed = mutate(ledger, artifactId, earlier.ops, {
              id: earlier.id,
              ...(earlier.base !== undefined ? { base: earlier.base } : {}),
            });
            expect(replayed).toEqual(earlier.result);
            continue;
          }
          const base =
            entry.base === "latest"
              ? revision
              : entry.base === "none"
                ? undefined
                : entry.base % (revision + 1);
          const ops = entry.ops as FieldOp[];
          const applied: string[] = [];
          const conflicts: string[] = [];
          let changed = false;
          for (const change of ops) {
            const current = model.get(change.id);
            if (base !== undefined && current && current.rev > base) {
              conflicts.push(change.id);
              continue;
            }
            applied.push(change.id);
            if (change.delete) {
              if (current && !current.deleted) {
                model.set(change.id, { value: null, rev: revision + 1, deleted: true });
                changed = true;
              }
            } else {
              model.set(change.id, { value: change.value, rev: revision + 1, deleted: false });
              changed = true;
            }
          }
          if (changed) revision += 1;
          const id = mutationId();
          const result = mutate(ledger, artifactId, ops, {
            id,
            ...(base !== undefined ? { base } : {}),
          });
          expect(result.revision).toBe(String(revision));
          expect(result.applied).toEqual(applied);
          expect(result.conflicts.map((conflict) => conflict.id)).toEqual(conflicts);
          for (const conflict of result.conflicts) {
            const current = model.get(conflict.id);
            expect(conflict.revision).toBe(String(current?.rev));
            if (current?.deleted) expect(conflict.deleted).toBe(true);
            else expect(conflict.value).toEqual(current?.value);
          }
          done.push({ id, ops, ...(base !== undefined ? { base } : {}), result });
        }
        const stored = ledger.read((db) => {
          const document = documentFor(db, artifactId, null);
          return { revision: document?.revision ?? 0, fields: liveFields(db, document?.id) };
        });
        expect(stored.revision).toBe(revision);
        const expected = Object.fromEntries(
          [...model].filter(([, field]) => !field.deleted).map(([id, field]) => [id, field.value]),
        );
        expect(
          Object.fromEntries(Object.entries(stored.fields).map(([id, field]) => [id, field.value])),
        ).toEqual(expected);
        // One state.changed per revision, in order.
        const changes = events(ledger, artifactId).filter(
          (event) => event.type === "state.changed",
        );
        expect(changes.map((event) => event.payload["revision"])).toEqual(
          Array.from({ length: revision }, (_, index) => String(index + 1)),
        );
        ledger.close();
      }),
      { numRuns: 60 },
    );
  });

  it("rebases edits to different fields and reports a same-field edit as a conflict on both sides (LL-01)", () => {
    const { ledger } = freshLedger();
    const { artifactId, versions } = addArtifact(ledger, {
      id: ArtifactId.create(),
      policy: { policy: "none" },
    });
    const { viewerId } = viewOf(ledger, artifactId, versions[0] as string);
    const start = mutate(ledger, artifactId, [set("tasks.today", ["write"]), set("owner", "ana")]);
    expect(start.revision).toBe("1");
    // The agent and the viewer both start from revision 1.
    const agentWrite = mutate(ledger, artifactId, [set("tasks.today", ["write", "ship"])], {
      base: 1,
    });
    expect(agentWrite).toMatchObject({ revision: "2", applied: ["tasks.today"], conflicts: [] });
    const viewerWrite = ledger.write(
      (db) =>
        applyMutation(db, {
          artifactId,
          scope: "artifact",
          mutationId: mutationId(),
          baseRevision: 1,
          ops: [set("tasks.today", ["write", "review"]), set("owner", "ben")],
          actor: { kind: "viewer", id: viewerId },
        }).result,
    );
    // Non-overlapping: owner applies. Overlapping: tasks.today is a conflict with the agent's value.
    expect(viewerWrite.applied).toEqual(["owner"]);
    expect(viewerWrite.conflicts).toEqual([
      expect.objectContaining({
        id: "tasks.today",
        revision: "2",
        value: ["write", "ship"],
        updatedBy: agent,
      }),
    ]);
    // The agent writing from revision 1 again now sees the viewer's change as its conflict.
    const agentAgain = mutate(ledger, artifactId, [set("owner", "cy")], { base: 1 });
    expect(agentAgain.conflicts).toEqual([
      expect.objectContaining({
        id: "owner",
        value: "ben",
        updatedBy: { kind: "viewer", id: viewerId },
      }),
    ]);
    const types = events(ledger, artifactId).map((event) => event.type);
    expect(types.filter((type) => type === "state.changed")).toHaveLength(3);
    expect(types.filter((type) => type === "state.conflict")).toHaveLength(2);
  });

  it("refuses a mutation ID sent again with other contents (MOSTRA_FIELD_MUTATION_ID_REUSED)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    const id = mutationId();
    mutate(ledger, artifactId, [set("a", 1)], { id });
    expect(mutate(ledger, artifactId, [set("a", 1)], { id }).revision).toBe("1");
    expect(codeOf(() => mutate(ledger, artifactId, [set("a", 2)], { id }))).toBe(
      "MOSTRA_FIELD_MUTATION_ID_REUSED",
    );
  });

  it("refuses values over 1 MiB and documents over 16 MiB whole, never truncating (DATA_MODEL §5)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    const big = "x".repeat(1024 * 1024);
    expect(codeOf(() => mutate(ledger, artifactId, [set("a", big)]))).toBe(
      "MOSTRA_FIELD_TOO_LARGE",
    );
    const nearly = "x".repeat(1024 * 1024 - 10);
    for (let index = 0; index < 16; index++) mutate(ledger, artifactId, [set(`f${index}`, nearly)]);
    expect(codeOf(() => mutate(ledger, artifactId, [set("f16", nearly)]))).toBe(
      "MOSTRA_FIELD_TOO_LARGE",
    );
    // Replacing a value counts its new size, not both.
    expect(mutate(ledger, artifactId, [set("f0", "small")]).applied).toEqual(["f0"]);
    expect(
      ledger.read((db) => Object.keys(liveFields(db, documentFor(db, artifactId, null)?.id))),
    ).toHaveLength(16);
  });

  it("refuses invalid field IDs and ops", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    expect(codeOf(() => mutate(ledger, artifactId, [set("a..b", 1)]))).toBe(
      "MOSTRA_FIELD_ID_INVALID",
    );
    expect(codeOf(() => mutate(ledger, artifactId, [set("a", 1), set("a", 2)]))).toBe(
      "MOSTRA_HOST_INVALID_PARAMS",
    );
    expect(codeOf(() => mutate(ledger, artifactId, [{ id: "a" }]))).toBe(
      "MOSTRA_HOST_INVALID_PARAMS",
    );
    expect(codeOf(() => mutate(ledger, artifactId, [set("a", Number.NaN)]))).toBe(
      "MOSTRA_HOST_INVALID_PARAMS",
    );
  });

  it("keeps sensitive values in the document and out of events (D52)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    mutate(ledger, artifactId, [
      set("token", "hunter2-secret", { sensitive: true }),
      set("plain", "hi"),
    ]);
    mutate(ledger, artifactId, [set("token", "still-secret")]);
    const text = JSON.stringify(events(ledger, artifactId));
    expect(text).not.toContain("hunter2-secret");
    expect(text).not.toContain("still-secret");
    expect(text).toContain('"plain"');
    const stored = ledger.read((db) => liveFields(db, documentFor(db, artifactId, null)?.id));
    expect(stored["token"]).toMatchObject({ value: "still-secret", sensitive: true });
  });

  it("refuses moving a document's revision or epoch back (trigger)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    mutate(ledger, artifactId, [set("a", 1)]);
    expect(() =>
      ledger.write((db) =>
        db.run("UPDATE document SET revision = 0 WHERE artifact_id = ?", artifactId),
      ),
    ).toThrow(/only grow/);
  });
});

describe("events: order, filters and compaction (IN-08)", () => {
  it("orders every event totally by cursor, numbers each artifact's events without gaps, and pages without gaps or repeats across a restart (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 7 }),
        fc.constantFrom(
          undefined,
          ["state.changed"],
          ["state.*"],
          ["version.published", "state.changed"],
        ),
        (writers, page, types) => {
          const { ledger: first, storeDir } = freshLedger();
          const artifacts = [0, 1, 2].map(
            () => addArtifact(first, { id: ArtifactId.create() }).artifactId,
          );
          const half = Math.floor(writers.length / 2);
          writers.slice(0, half).forEach((writer, index) => {
            mutate(first, artifacts[writer] as string, [set(`f${index}`, index)]);
          });
          // A restart in the middle: cursors and sequences continue.
          first.close();
          const ledger = open(storeDir);
          writers.slice(half).forEach((writer, index) => {
            mutate(ledger, artifacts[writer] as string, [set(`g${index}`, index)]);
          });
          const all = events(ledger);
          const cursors = all.map((event) => Number(event.cursor));
          expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
          expect(new Set(cursors).size).toBe(cursors.length);
          for (const artifactId of artifacts) {
            const seqs = all
              .filter((event) => event.artifactId === artifactId)
              .map((event) => event.seq);
            expect(seqs).toEqual(seqs.map((_, index) => index + 1));
          }
          const filter = {
            artifacts: [artifacts[0] as string, artifacts[2] as string],
            ...(types ? { types } : {}),
          };
          const expected = all.filter(
            (event) =>
              filter.artifacts.includes(event.artifactId as string) &&
              (!types ||
                types.some((pattern) =>
                  pattern.endsWith(".*")
                    ? event.type.startsWith(pattern.slice(0, -1))
                    : pattern === event.type,
                )),
          );
          const paged: EventRecord[] = [];
          let after = 0;
          for (let guard = 0; guard < 500; guard++) {
            const read = ledger.read((db) => readEvents(db, { filter, after, limit: page }));
            paged.push(...read.events);
            if (Number(read.cursor) === after) break;
            after = Number(read.cursor);
          }
          expect(paged.map((event) => event.cursor)).toEqual(expected.map((event) => event.cursor));
          ledger.close();
        },
      ),
      { numRuns: 40 },
    );
  });

  it("replaces compacted events with one summary at the last replaced cursor, refuses a cursor inside the range, and lets a reader of the summary continue (GPT review findings 5, 6)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    for (let index = 0; index < 5; index++) mutate(ledger, artifactId, [set("a", index)]);
    const before = events(ledger, artifactId);
    const cut = Number(before[4]?.cursor);
    const summary = ledger.write((db) => compactEvents(db, artifactId, cut));
    expect(summary).toMatchObject({
      from: Number(before[0]?.cursor),
      through: Number(before[3]?.cursor),
      removed: 4,
      types: { "artifact.created": 1, "version.published": 1, "state.changed": 2 },
    });
    const after = events(ledger, artifactId);
    // The summary takes the last replaced cursor and sequence, so neither ever moves back.
    expect(after[0]).toMatchObject({
      type: "artifact.compacted",
      cursor: before[3]?.cursor,
      seq: before[3]?.seq,
    });
    expect(after.slice(1).map((event) => event.cursor)).toEqual(
      before.slice(4).map((event) => event.cursor),
    );
    const read = (from: number) =>
      ledger.read((db) =>
        readEvents(db, { filter: { artifacts: [artifactId] }, after: from, limit: 10 }),
      );
    // A reader that had an event inside the range can't continue silently.
    for (const index of [0, 1, 2]) {
      expect(codeOf(() => read(Number(before[index]?.cursor)))).toBe(
        "MOSTRA_HOST_CURSOR_COMPACTED",
      );
    }
    // A reader before the range gets the summary, and continues after it without a refusal.
    const fresh = read(0);
    expect(fresh.events[0]?.type).toBe("artifact.compacted");
    expect(read(Number(fresh.events[0]?.cursor)).events.map((event) => event.cursor)).toEqual(
      before.slice(4).map((event) => event.cursor),
    );
    // A filtered reader still sees the summary.
    const filtered = ledger.read((db) =>
      readEvents(db, { filter: { types: ["submission.created"] }, after: 0, limit: 10 }),
    );
    expect(filtered.events.map((event) => event.type)).toEqual(["artifact.compacted"]);
    // Compacting again over the summary and later events keeps everything the summary covered
    // (finding 6): a reader inside the first range is still refused.
    ledger.write((db) => compactEvents(db, artifactId, cut));
    ledger.write((db) => compactEvents(db, artifactId, Number(before[4]?.cursor) + 1));
    expect(events(ledger, artifactId)[0]).toMatchObject({
      type: "artifact.compacted",
      payload: { from: Number(before[0]?.cursor), through: Number(before[4]?.cursor), removed: 5 },
    });
    expect(codeOf(() => read(Number(before[1]?.cursor)))).toBe("MOSTRA_HOST_CURSOR_COMPACTED");
    // Compacting everything keeps the sequence going up (finding 5).
    const last = events(ledger, artifactId).at(-1);
    ledger.write((db) => compactEvents(db, artifactId, Number(last?.cursor) + 1));
    mutate(ledger, artifactId, [set("a", "next")]);
    const next = events(ledger, artifactId).at(-1);
    expect(next?.seq).toBe((last?.seq ?? 0) + 1);
    expect(Number(next?.cursor)).toBeGreaterThan(Number(last?.cursor));
  });

  it("bounds a page of events by size and continues where it stopped, so no notification outgrows the framing (GPT review finding 4)", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    const big = "x".repeat(900 * 1024);
    for (let index = 0; index < 12; index++) mutate(ledger, artifactId, [set(`f${index}`, big)]);
    const all = events(ledger, artifactId).filter((event) => event.type === "state.changed");
    const seen: string[] = [];
    let after = 0;
    for (let guard = 0; guard < 50; guard++) {
      const page = ledger.read((db) =>
        readEvents(db, {
          filter: { artifacts: [artifactId], types: ["state.changed"] },
          after,
          limit: 100,
        }),
      );
      // An absolute bound: about 8 MiB and one event's slack, whatever the constant says.
      expect(JSON.stringify(page.events).length).toBeLessThan(9 * 1024 * 1024);
      seen.push(...page.events.map((event) => event.cursor));
      if (Number(page.cursor) === after) break;
      after = Number(page.cursor);
    }
    expect(seen).toEqual(all.map((event) => event.cursor));
  });
});

/** A ledger with one artifact under `policy`, its two versions, and a view of each. */
function submitting(policy: unknown) {
  const { ledger } = freshLedger();
  const { artifactId, versions } = addArtifact(ledger, {
    id: ArtifactId.create(),
    policy,
    versions: 2,
  });
  const latest = viewOf(ledger, artifactId, versions[1] as string);
  const stale = viewOf(ledger, artifactId, versions[0] as string, latest.viewerId);
  const draft = (ops: FieldOp[], viewerId = latest.viewerId) =>
    ledger.write(
      (db) =>
        applyMutation(db, {
          artifactId,
          scope: "viewer",
          viewerId,
          mutationId: mutationId(),
          ops,
          actor: { kind: "viewer", id: viewerId },
        }).result,
    );
  const doSubmit = (
    viewId: string,
    expectedRevision: number,
    viewerId = latest.viewerId,
    owners: string[] = [],
  ) =>
    ledger.write((db) =>
      submit(db, { artifactId, viewerId, viewId, expectedRevision, channel: "shell", owners }),
    );
  return { ledger, artifactId, versions, latest, stale, draft, doSubmit };
}

describe("submit (IN-05, IN-06, IN-07, LL-02)", () => {
  it("snapshots the canonical persisted draft and artifact state, bound to the view's exact version, with a digest of its RFC 8785 form", () => {
    const { ledger, artifactId, versions, latest, draft, doSubmit } = submitting(undefined);
    draft([
      set("reply.m1", "Thursday works", { label: "Reply to Alice" }),
      set("layout", "b", { required: true }),
    ]);
    mutate(ledger, artifactId, [set("tasks", ["a"])]);
    const { submission, created } = doSubmit(latest.viewId, 1);
    expect(created).toBe(true);
    expect(submission).toMatchObject({
      versionId: versions[1],
      version: 2,
      viewId: latest.viewId,
      staleView: false,
      draftRevision: "1",
      channel: "shell",
      epoch: 1,
    });
    const row = ledger.read((db) =>
      db.get<SubmissionRow>("SELECT * FROM submission WHERE id = ?", submission.id),
    ) as SubmissionRow;
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    expect(snapshot.draft.fields).toEqual({
      layout: { value: "b", required: true },
      "reply.m1": { value: "Thursday works", label: "Reply to Alice" },
    });
    expect(snapshot.state?.fields).toEqual({ tasks: { value: ["a"] } });
    expect(row.snapshot_json).toBe(canonicalJson(snapshot));
    expect(row.digest).toBe(createHash("sha256").update(canonicalJson(snapshot)).digest("hex"));
    expect(submission.digest).toBe(row.digest);
    // A later edit of the draft changes nothing in the submission (IN-06).
    draft([set("layout", "c")]);
    const again = ledger.read((db) => buildResults(db, row));
    expect(again.answers).toEqual({ layout: "b", reply: { m1: "Thursday works" } });
  });

  it("flags a submission from an older version's view with the newer number (H-10)", () => {
    const { stale, doSubmit, versions } = submitting({ policy: "epochs" });
    const { submission } = doSubmit(stale.viewId, 0);
    expect(submission).toMatchObject({ versionId: versions[0], version: 1, staleView: true });
  });

  it("returns the original for a repeated submit of the same view and revision (D22)", () => {
    const { latest, draft, doSubmit, ledger } = submitting(undefined);
    draft([set("a", 1)]);
    const first = doSubmit(latest.viewId, 1);
    const second = doSubmit(latest.viewId, 1);
    expect(second.created).toBe(false);
    expect(second.submission).toMatchObject({ id: first.submission.id, duplicate: true });
    expect(
      ledger.read((db) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission"))?.n,
    ).toBe(1);
  });

  it("refuses a submit whose draft moved since the viewer saw it (MOSTRA_SUBMIT_REVISION_MOVED)", () => {
    const { latest, draft, doSubmit } = submitting(undefined);
    draft([set("a", 1)]);
    draft([set("a", 2)]);
    expect(codeOf(() => doSubmit(latest.viewId, 1))).toBe("MOSTRA_SUBMIT_REVISION_MOVED");
  });

  it("once per-artifact: one submission in all; a second is a typed conflict carrying it, and drafts close while state stays writable", () => {
    const { ledger, artifactId, versions, latest, draft, doSubmit } = submitting({
      policy: "once",
      scope: "per-artifact",
    });
    draft([set("a", 1)]);
    const first = doSubmit(latest.viewId, 1);
    const other = ledger.write((db) => viewerForSpec(db, { ref: "ben@example.com", name: "Ben" }));
    const otherView = viewOf(ledger, artifactId, versions[1] as string, other);
    let conflict: SubmitConflict | undefined;
    try {
      doSubmit(otherView.viewId, 0, other);
    } catch (error) {
      conflict = error as SubmitConflict;
    }
    expect(conflict).toBeInstanceOf(SubmitConflict);
    expect(conflict?.diagnostic.code).toBe("MOSTRA_SUBMIT_ALREADY");
    expect(conflict?.submission.id).toBe(first.submission.id);
    // Another tab of the same viewer is refused the same way.
    const tab = viewOf(ledger, artifactId, versions[1] as string, latest.viewerId);
    expect(codeOf(() => doSubmit(tab.viewId, 1))).toBe("MOSTRA_SUBMIT_ALREADY");
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts: new FakeHosts(),
      expectedHosts: () => [],
      artifacts: { resolve: () => artifactId },
    });
    expect(
      codeOf(() =>
        interaction.mutate(
          { artifactId, viewerId: other },
          {
            viewId: otherView.viewId,
            scope: "viewer",
            mutationId: mutationId(),
            baseRevision: 0,
            ops: [set("a", 2)],
          },
        ),
      ),
    ).toBe("MOSTRA_SUBMIT_ALREADY");
    expect(
      interaction.mutate(
        { artifactId, viewerId: other },
        {
          viewId: otherView.viewId,
          scope: "artifact",
          mutationId: mutationId(),
          baseRevision: 0,
          ops: [set("s", 1)],
        },
      ).applied,
    ).toEqual(["s"]);
  });

  it("once per-viewer: one submission per viewer", () => {
    const { ledger, artifactId, versions, latest, draft, doSubmit } = submitting({
      policy: "once",
      scope: "per-viewer",
    });
    draft([set("a", 1)]);
    doSubmit(latest.viewId, 1);
    const other = ledger.write((db) => viewerForSpec(db, { ref: "ben@example.com" }));
    const otherView = viewOf(ledger, artifactId, versions[1] as string, other);
    draft([set("a", 9)], other);
    expect(doSubmit(otherView.viewId, 1, other).created).toBe(true);
    const tab = viewOf(ledger, artifactId, versions[1] as string, other);
    expect(codeOf(() => doSubmit(tab.viewId, 1, other))).toBe("MOSTRA_SUBMIT_ALREADY");
  });

  it("epochs: each submission links to the viewer's previous one and the draft carries into the next epoch (D103)", () => {
    const { ledger, latest, draft, doSubmit } = submitting({ policy: "epochs" });
    draft([set("a", 1)]);
    const first = doSubmit(latest.viewId, 1);
    draft([set("a", 2)]);
    const second = doSubmit(latest.viewId, 2);
    draft([set("b", 3)]);
    const third = doSubmit(latest.viewId, 3);
    expect([first, second, third].map((entry) => entry.submission.epoch)).toEqual([1, 2, 3]);
    const rows = ledger.read((db) =>
      db.all<SubmissionRow>("SELECT * FROM submission ORDER BY position"),
    );
    expect(rows.map((row) => row.previous_id)).toEqual([
      null,
      first.submission.id,
      second.submission.id,
    ]);
    const snapshot = JSON.parse(rows[2]?.snapshot_json as string) as Snapshot;
    expect(snapshot.draft.fields).toEqual({ a: { value: 2 }, b: { value: 3 } });
  });

  it("none: refuses submit (MOSTRA_SUBMIT_POLICY_NONE) while state and signals work (LL-02)", () => {
    const { ledger, artifactId, latest, draft, doSubmit } = submitting({ policy: "none" });
    draft([set("a", 1)]);
    expect(codeOf(() => doSubmit(latest.viewId, 1))).toBe("MOSTRA_SUBMIT_POLICY_NONE");
    expect(mutate(ledger, artifactId, [set("today", ["x"])]).applied).toEqual(["today"]);
    ledger.write((db) =>
      raiseSignal(db, {
        artifactId,
        name: "ping-agent",
        source: "artifact",
        actor: { kind: "viewer", id: latest.viewerId },
        viewId: latest.viewId,
      }),
    );
    expect(events(ledger, artifactId).some((event) => event.type === "signal.raised")).toBe(true);
    expect(
      ledger.read((db) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission"))?.n,
    ).toBe(0);
  });

  it("keeps submissions write-once: the ledger refuses UPDATE and DELETE (invariant 4)", () => {
    const { ledger, latest, draft, doSubmit } = submitting(undefined);
    draft([set("a", 1)]);
    const { submission } = doSubmit(latest.viewId, 1);
    expect(() =>
      ledger.write((db) =>
        db.run("UPDATE submission SET snapshot_json = '{}' WHERE id = ?", submission.id),
      ),
    ).toThrow(/immutable/);
    expect(() =>
      ledger.write((db) => db.run("DELETE FROM submission WHERE id = ?", submission.id)),
    ).toThrow(/immutable/);
  });

  it("refuses a view of another viewer or artifact (MOSTRA_SUBMIT_VIEW_INVALID)", () => {
    const { ledger, latest, doSubmit } = submitting(undefined);
    const stranger = ledger.write((db) => viewerForSpec(db, { ref: "eve" }));
    expect(codeOf(() => doSubmit(latest.viewId, 0, stranger))).toBe("MOSTRA_SUBMIT_VIEW_INVALID");
    expect(codeOf(() => doSubmit("vw_01JB8Z3QF6S7W3N8D5K2C4V9XG", 0))).toBe(
      "MOSTRA_SUBMIT_VIEW_INVALID",
    );
  });

  it("raises the standard submit signal and enqueues one delivery per host in the same transaction (IN-09, IN-12)", () => {
    const { ledger, artifactId, latest, draft, doSubmit } = submitting(undefined);
    draft([set("a", 1)]);
    const { submission } = doSubmit(latest.viewId, 1, latest.viewerId, ["jcode", "other"]);
    const types = events(ledger, artifactId).map((event) => event.type);
    expect(types.slice(-2)).toEqual(["submission.created", "signal.raised"]);
    const deliveries = ledger.read((db) =>
      db.all<{ port_owner: string; state: string }>(
        "SELECT port_owner, state FROM delivery WHERE submission_id = ? ORDER BY port_owner",
        submission.id,
      ),
    );
    expect(deliveries).toEqual([
      { port_owner: "jcode", state: "pending" },
      { port_owner: "other", state: "pending" },
    ]);
  });
});

describe("signals (IN-09)", () => {
  it("validates names and payloads, reserves submit, and appends signal.raised and nothing else", () => {
    const { ledger, artifactId, latest } = submitting(undefined);
    const raise = (name: string, payload?: unknown) =>
      ledger.write((db) =>
        raiseSignal(db, {
          artifactId,
          name,
          ...(payload !== undefined ? { payload } : {}),
          source: "artifact",
          actor: { kind: "viewer", id: latest.viewerId },
          viewId: latest.viewId,
        }),
      );
    expect(codeOf(() => raise("submit"))).toBe("MOSTRA_SUBMIT_SIGNAL_INVALID");
    expect(codeOf(() => raise("-bad"))).toBe("MOSTRA_SUBMIT_SIGNAL_INVALID");
    expect(codeOf(() => raise("big", "x".repeat(70 * 1024)))).toBe("MOSTRA_SUBMIT_SIGNAL_INVALID");
    const before = ledger.read((db) => db.all("SELECT * FROM delivery").length);
    raise("ping-agent", { why: "look" });
    const last = events(ledger, artifactId).at(-1);
    expect(last).toMatchObject({
      type: "signal.raised",
      payload: { name: "ping-agent", source: "artifact", payload: { why: "look" } },
    });
    expect(ledger.read((db) => db.all("SELECT * FROM delivery").length)).toBe(before);
  });
});

describe("Mostra decides nothing on a signal's behalf (IN-09, D10)", () => {
  it("records signals from the artifact, the shell (submit) and an action as signal.raised, and calls no host for any of them", async () => {
    const { ledger, artifactId, latest, draft } = submitting(undefined);
    const hosts = new FakeHosts();
    hosts.registered = [{ session: 1, owner: "host", ports: ["drafts"] }];
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts,
      expectedHosts: () => [],
      artifacts: { resolve: () => artifactId },
    });
    interaction.start();
    const page = { artifactId, viewerId: latest.viewerId };
    interaction.signal(page, { viewId: latest.viewId, name: "ping-agent", payload: { n: 1 } });
    // A server function's signal (WP-08 calls this through @mostra/server's `signal()`).
    ledger.write((db) =>
      raiseSignal(db, {
        artifactId,
        name: "reply-sent",
        source: "action",
        actor: { kind: "agent" },
        causation: { runId: "run_01JB8Z3QF6S7W3N8D5K2C4V9XG" },
      }),
    );
    draft([set("a", 1)]);
    ledger.write((db) =>
      submit(db, {
        artifactId,
        viewerId: latest.viewerId,
        viewId: latest.viewId,
        expectedRevision: 1,
        channel: "shell",
        owners: [],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const signals = events(ledger, artifactId).filter((event) => event.type === "signal.raised");
    expect(signals.map((event) => [event.payload["name"], event.payload["source"]])).toEqual([
      ["ping-agent", "artifact"],
      ["reply-sent", "action"],
      ["submit", "shell"],
    ]);
    // No port call, no notification: what a signal wakes is the host's own decision.
    expect(hosts.calls).toEqual([]);
    expect(hosts.notifications).toEqual([]);
    interaction.stop();
  });
});

describe("wait (IN-10)", () => {
  it("is level-triggered for submitted under once and edge-triggered after the cursor otherwise", () => {
    const { ledger, artifactId, latest, draft, doSubmit } = submitting(undefined);
    const check = (until: string, after: number) =>
      ledger.read((db) => checkCondition(db, artifactId, until, after));
    expect("cursor" in check("submitted", 0)).toBe(true);
    draft([set("a", 1)]);
    doSubmit(latest.viewId, 1);
    const end = Number(events(ledger).at(-1)?.cursor);
    // Level: still satisfied from a cursor after the submission.
    expect(check("submitted", end)).toMatchObject({ event: { type: "submission.created" } });
    // Edge: the submit signal is before `end`, so a wait from `end` doesn't see it.
    expect(check("signal:submit", end)).toEqual({ cursor: end });
    expect(check("signal:submit", 0)).toMatchObject({ event: { type: "signal.raised" } });
    mutate(ledger, artifactId, [set("today", 1)]);
    expect(check("state:today", end)).toMatchObject({ event: { type: "state.changed" } });
    expect(check("state:other", end)).toMatchObject({ cursor: end + 1 });
    expect(check("event:state.*", end)).toMatchObject({ event: { type: "state.changed" } });
  });

  it("is edge-triggered for submitted under epochs, and refused under none", () => {
    const epochs = submitting({ policy: "epochs" });
    epochs.draft([set("a", 1)]);
    epochs.doSubmit(epochs.latest.viewId, 1);
    const end = Number(events(epochs.ledger).at(-1)?.cursor);
    expect(
      epochs.ledger.read((db) => checkCondition(db, epochs.artifactId, "submitted", end)),
    ).toEqual({ cursor: end });
    const none = submitting({ policy: "none" });
    expect(
      codeOf(() => none.ledger.read((db) => checkCondition(db, none.artifactId, "submitted", 0))),
    ).toBe("MOSTRA_SUBMIT_POLICY_NONE");
  });

  it("times out with still_waiting and a cursor, and a later wait from that cursor returns what happened since", async () => {
    const { ledger, artifactId, latest } = submitting(undefined);
    const timedOut = await waitFor({ ledger, artifactId, until: "signal:ping", timeoutMs: 50 });
    expect(timedOut.status).toBe("still_waiting");
    ledger.write((db) =>
      raiseSignal(db, {
        artifactId,
        name: "ping",
        source: "artifact",
        actor: { kind: "viewer", id: latest.viewerId },
        viewId: latest.viewId,
      }),
    );
    const later = await waitFor({
      ledger,
      artifactId,
      until: "signal:ping",
      after: Number(timedOut.cursor),
      timeoutMs: 0,
    });
    expect(later).toMatchObject({
      status: "satisfied",
      event: { type: "signal.raised", payload: { name: "ping" } },
    });
  });

  it("wakes on the commit that satisfies it, and ends with still_waiting when aborted", async () => {
    const { ledger, artifactId, latest } = submitting(undefined);
    const waiting = waitFor({ ledger, artifactId, until: "signal:go", timeoutMs: 10_000 });
    setTimeout(
      () =>
        ledger.write((db) =>
          raiseSignal(db, {
            artifactId,
            name: "go",
            source: "artifact",
            actor: { kind: "viewer", id: latest.viewerId },
            viewId: latest.viewId,
          }),
        ),
      20,
    );
    const started = Date.now();
    expect(await waiting).toMatchObject({ status: "satisfied" });
    expect(Date.now() - started).toBeLessThan(5000);
    const abort = new AbortController();
    const aborted = waitFor({
      ledger,
      artifactId,
      until: "signal:never",
      timeoutMs: 10_000,
      signal: abort.signal,
    });
    abort.abort();
    expect(await aborted).toMatchObject({ status: "still_waiting" });
  });
});

describe("results (IN-11)", () => {
  it("returns the complete submission as JSON that validates against the Results schema", () => {
    const { ledger, artifactId, latest, draft, doSubmit } = submitting(undefined);
    draft([
      set("reply.m1", "Thanks", { label: "Reply to Alice" }),
      set("review.sidebar.choice", "b"),
      set("pin", "1234", { sensitive: true }),
    ]);
    mutate(ledger, artifactId, [set("tasks.today", ["ship"])]);
    ledger.write((db) =>
      raiseSignal(db, {
        artifactId,
        name: "ping",
        payload: { n: 1 },
        source: "artifact",
        actor: { kind: "viewer", id: latest.viewerId },
        viewId: latest.viewId,
      }),
    );
    const { submission } = doSubmit(latest.viewId, 1);
    const results = ledger.read((db) =>
      buildResults(
        db,
        db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE id = ?",
          submission.id,
        ) as SubmissionRow,
      ),
    );
    expect(Results.safeParse(results).success).toBe(true);
    expect(results).toMatchObject({
      artifact: {
        id: artifactId,
        title: "Sidebar review",
        family: "review",
        description: "Pick a sidebar",
      },
      submission: {
        id: submission.id,
        version: 2,
        policy: { policy: "once", scope: "per-artifact" },
        stateRevision: "1",
      },
      answers: { reply: { m1: "Thanks" }, review: { sidebar: { choice: "b" } }, pin: "1234" },
      state: { tasks: { today: ["ship"] } },
      choices: [{ reviewSetId: "sidebar", candidateId: "b" }],
      signals: [{ name: "ping", payload: { n: 1 } }],
    });
    expect(results.fields).toContainEqual({ id: "pin", sensitive: true, scope: "viewer" });
  });

  it("nests dotted IDs without merging into a value, and treats __proto__ as a plain key", () => {
    const nested = nestFields({
      a: { value: 1 },
      "a.b": { value: 2 },
      "x.y": { value: 3 },
      "x.z.w": { value: 4 },
      __proto__: { value: "p" },
    } as never);
    expect(JSON.parse(JSON.stringify(nested))).toEqual({
      a: 1,
      "a.b": 2,
      x: { y: 3, z: { w: 4 } },
      __proto__: "p",
    });
  });

  it("renders Markdown with the header, answers by label, state, choices, comments with crop paths, actions, signals and orphans (golden)", () => {
    const viewer = { id: "vwr_01JB8Z3QF6S7W3N8D5K2C4V9XG", kind: "token" as const, name: "Mirza" };
    const results: Results = {
      artifact: {
        id: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        title: "Sidebar review",
        family: "review",
        links: [{ rel: "follows", artifact: "art_01JB8Z3QF6S7W3N8D5K2C4V9XH" }],
      },
      submission: {
        id: "sub_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        at: "2026-10-15T09:00:00.000Z",
        epoch: 1,
        policy: { policy: "once", scope: "per-artifact" },
        channel: "shell",
        viewer,
        versionId: "ver_0000000000000000000000000A",
        version: 2,
        viewId: "vw_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        staleView: true,
        latestVersion: 3,
        draftRevision: "4",
        stateRevision: "2",
        digest: "d".repeat(64),
        delivery: "pending",
        deliveries: [
          {
            deliveryId: "dlv_01JB8Z3QF6S7W3N8D5K2C4V9XG",
            owner: "jcode",
            state: "pending",
            attempts: 1,
            updatedAt: "2026-10-15T09:00:01.000Z",
          },
        ],
      },
      answers: {},
      fields: [],
      choices: [{ reviewSetId: "sidebar", candidateId: "b", label: "Compact" }],
      comments: [
        {
          threadId: "thr_01JB8Z3QF6S7W3N8D5K2C4V9XG",
          status: "open",
          messages: [{ author: viewer, at: "2026-10-15T08:59:00.000Z", text: "Header too tall" }],
          anchor: { reviewId: "header", page: "/" },
          crop: { path: "blobs/abc.png", width: 320, height: 120 },
        },
      ],
      orphaned: [{ id: "old", label: "Old question", value: "kept", fromVersion: 1 }],
      actions: [
        {
          runId: "run_01JB8Z3QF6S7W3N8D5K2C4V9XG",
          action: "sendReply",
          status: "succeeded",
          at: "2026-10-15T08:58:00.000Z",
        },
      ],
      signals: [{ name: "ping", at: "2026-10-15T08:57:00.000Z" }],
    };
    const snapshot = {
      draft: {
        revision: "4",
        fields: {
          "reply.m1": { value: "Thanks,\nsee you", label: "Reply to Alice" },
          layout: { value: "b" },
        },
      },
      state: { revision: "2", fields: { "tasks.today": { value: ["ship"] } } },
    } as unknown as Snapshot;
    expect(resultsMarkdown(results, snapshot)).toBe(
      [
        "# Sidebar review: submission sub_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        "",
        "- Artifact: art_01JB8Z3QF6S7W3N8D5K2C4V9XG (`review`)",
        "- Version: ver_0000000000000000000000000A (version 2), a stale view: version 3 was the latest",
        '- View: vw_01JB8Z3QF6S7W3N8D5K2C4V9XG, channel shell, viewer "Mirza" (vwr_01JB8Z3QF6S7W3N8D5K2C4V9XG)',
        "- Submitted: 2026-10-15T09:00:00.000Z, epoch 1, policy once per-artifact",
        `- Draft revision 4, artifact state revision 2, digest ${"d".repeat(64)}`,
        '- Delivery: pending ("jcode": pending)',
        "- Links: `follows` `art_01JB8Z3QF6S7W3N8D5K2C4V9XH`",
        "",
        "## Answers",
        '- `layout`: "b"',
        '- "Reply to Alice" (`reply.m1`): ',
        "",
        "  ```text",
        "  Thanks,",
        "  see you",
        "  ```",
        "",
        "",
        "## Artifact state",
        '- `tasks.today`: `["ship"]`',
        "",
        "## Choices",
        '- `sidebar`: "b" ("Compact")',
        "",
        "## Comments",
        "- Thread thr_01JB8Z3QF6S7W3N8D5K2C4V9XG (open), crop `blobs/abc.png`, on `header`, page `/`",
        '  - "Mirza" at 2026-10-15T08:59:00.000Z: "Header too tall"',
        "",
        "## Actions run in this view",
        "- `sendReply`: succeeded at 2026-10-15T08:58:00.000Z (run run_01JB8Z3QF6S7W3N8D5K2C4V9XG)",
        "",
        "## Signals raised in this view",
        "- `ping` at 2026-10-15T08:57:00.000Z",
        "",
        "## Not carried over from an earlier version",
        '- "Old question" (`old`) from version 1: "kept"',
        "",
      ].join("\n"),
    );
  });
});

/** A connection as the protocol server reports it. */
function session(id: number, owner: string, ports: string[]): Session {
  return {
    id,
    kind: "socket",
    client: { name: owner, version: "1" },
    revision: "2026-10-10",
    ports: new Set(ports),
    notifications: new Set(),
    signal: new AbortController().signal,
  } as unknown as Session;
}

describe("the outbox (IN-12, IN-06)", () => {
  function outboxed(options: { expected?: string[] } = {}) {
    const setup = submitting(undefined);
    const hosts = new FakeHosts();
    const interaction = createInteraction({
      ledger: setup.ledger,
      log: silentLog,
      faults: noFaults,
      hosts,
      expectedHosts: () => options.expected ?? [],
      artifacts: { resolve: () => setup.artifactId },
    });
    return { ...setup, hosts, interaction };
  }

  it("keeps a submission made while its host is down pending, then replays the host's deliveries in submission order with stable IDs when it registers", async () => {
    const { ledger, artifactId, latest, draft, hosts, interaction } = outboxed({
      expected: ["jcode"],
    });
    ledger.write((db) =>
      db.run(
        "UPDATE artifact SET policy_json = ? WHERE id = ?",
        JSON.stringify({ policy: "epochs" }),
        artifactId,
      ),
    );
    interaction.start();
    const page = { artifactId, viewerId: latest.viewerId };
    const made: string[] = [];
    for (let round = 1; round <= 3; round++) {
      draft([set("round", round)]);
      made.push(
        interaction.submit(page, {
          viewId: latest.viewId,
          expectedRevision: round,
          channel: "artifact",
        }).id,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Durable and pending; nobody was called (D105: an expected host that isn't connected waits).
    expect(hosts.calls).toHaveLength(0);
    expect(interaction.deliveries()).toEqual([
      expect.objectContaining({ owner: "jcode", pending: 3, connected: false }),
    ]);
    hosts.registered = [{ session: 7, owner: "jcode", ports: ["submissions"] }];
    interaction.connected(session(7, "jcode", ["submissions"]));
    await until(() => hosts.calls.length === 3);
    expect(hosts.calls.map((call) => call.params["submissionId"])).toEqual(made);
    for (const call of hosts.calls) {
      expect(call.method).toBe("port/submissions.deliver");
      expect(SubmissionEnvelope.safeParse(call.params).success).toBe(true);
      expect(call.params["kind"]).toBe("submission");
    }
    await until(() => interaction.deliveries()[0]?.delivered === 3);
    expect(new Set(hosts.calls.map((call) => call.params["deliveryId"])).size).toBe(3);
    interaction.stop();
  });

  it("retries a retryable answer with backoff and never retries a terminal one", async () => {
    const { ledger, artifactId, latest, draft, hosts, interaction } = outboxed();
    hosts.registered = [{ session: 1, owner: "host", ports: ["submissions"] }];
    const answers = [
      { accepted: false, reason: "busy", retry: true },
      { accepted: false, reason: "undeliverable", retry: false },
    ];
    hosts.answer = async () => answers.shift() ?? { accepted: true };
    interaction.start();
    draft([set("a", 1)]);
    const submission = interaction.submit(
      { artifactId, viewerId: latest.viewerId },
      { viewId: latest.viewId, expectedRevision: 1, channel: "artifact" },
    );
    await until(() => hosts.calls.length === 2, 5000);
    expect(hosts.calls[0]?.params["deliveryId"]).toBe(hosts.calls[1]?.params["deliveryId"]);
    expect(hosts.calls[1]?.params["attempt"]).toBe(2);
    await until(() => interaction.deliveries()[0]?.undeliverable === 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(hosts.calls).toHaveLength(2);
    const types = events(ledger, artifactId).map((event) => event.type);
    expect(types).toContain("submission.undeliverable");
    expect(() =>
      ledger.write((db) =>
        db.run("UPDATE delivery SET state = 'pending' WHERE submission_id = ?", submission.id),
      ),
    ).toThrow(/never changes/);
    interaction.stop();
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(20)).toBe(300_000);
  });

  it("counts a duplicate answer as delivered and any other terminal reason as rejected", async () => {
    for (const [reason, state] of [
      ["duplicate", "delivered"],
      ["invalid", "rejected"],
    ] as const) {
      const { artifactId, latest, draft, hosts, interaction, ledger } = outboxed();
      hosts.registered = [{ session: 1, owner: "host", ports: ["submissions"] }];
      hosts.answer = async () => ({ accepted: false, reason, retry: false });
      interaction.start();
      draft([set("a", 1)]);
      interaction.submit(
        { artifactId, viewerId: latest.viewerId },
        { viewId: latest.viewId, expectedRevision: 1, channel: "artifact" },
      );
      await until(() => interaction.deliveries()[0]?.[state] === 1);
      expect(events(ledger, artifactId).map((event) => event.type)).toContain(
        `submission.${state}`,
      );
      interaction.stop();
    }
  });

  it("delivers through the built-in adapter when no host takes submissions", async () => {
    const { artifactId, latest, draft, hosts, interaction } = outboxed();
    interaction.start();
    draft([set("a", 1)]);
    interaction.submit(
      { artifactId, viewerId: latest.viewerId },
      { viewId: latest.viewId, expectedRevision: 1, channel: "artifact" },
    );
    await until(() => interaction.deliveries()[0]?.delivered === 1);
    // The built-in adapter is the empty owner: no host name can be taken for it (GPT review finding 2).
    expect(interaction.deliveries()[0]?.owner).toBe("");
    expect(hosts.calls).toHaveLength(0);
    interaction.stop();
  });

  it("mirrors drafts labelled as drafts through the drafts port only, never as a submission (IN-06)", async () => {
    const { artifactId, latest, hosts, interaction } = outboxed();
    hosts.registered = [{ session: 3, owner: "host", ports: ["drafts", "submissions"] }];
    interaction.start();
    interaction.mutate(
      { artifactId, viewerId: latest.viewerId },
      {
        viewId: latest.viewId,
        scope: "viewer",
        mutationId: mutationId(),
        baseRevision: 0,
        ops: [set("a", 1)],
      },
    );
    await until(() => hosts.calls.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hosts.calls.map((call) => call.method)).toEqual(["port/drafts.mirror"]);
    expect(hosts.calls[0]?.params).toMatchObject({
      kind: "draft",
      revision: "1",
      fields: { a: 1 },
      viewerId: latest.viewerId,
    });
    interaction.stop();
  });
});

describe("no path delivers a draft as a submission (IN-06)", () => {
  it("calls the submissions port only from the outbox, with an envelope built from a submission row", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "../../src");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
      file.endsWith(".ts"),
    );
    const callers = files.filter((file) =>
      /portSubmissionsDeliverMethod|port\/submissions\.deliver/.test(
        readFileSync(join(root, file), "utf8"),
      ),
    );
    expect(callers).toEqual(["interaction/outbox.ts"]);
    const outbox = readFileSync(join(root, "interaction/outbox.ts"), "utf8");
    // The envelope's results come from the immutable submission row, never a document.
    expect(outbox).toMatch(/kind: "submission",[\s\S]*results: buildResults\(db, submission\)/);
    expect(outbox).toMatch(/SELECT \* FROM submission WHERE id = \?/);
    // Drafts leave only through the drafts port, labelled as drafts.
    expect(outbox).toMatch(/kind: "draft"/);
  });
});

describe("findings of the GPT-6.1-Sol review", () => {
  it("delivers to a host named like the built-in adapter, never marking its deliveries done unseen (finding 2)", async () => {
    const { artifactId, latest, draft, ledger } = submitting(undefined);
    const hosts = new FakeHosts();
    hosts.registered = [{ session: 1, owner: "mostra", ports: ["submissions"] }];
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts,
      expectedHosts: () => [],
      artifacts: { resolve: () => artifactId },
    });
    interaction.start();
    draft([set("a", 1)]);
    interaction.submit(
      { artifactId, viewerId: latest.viewerId },
      { viewId: latest.viewId, expectedRevision: 1, channel: "artifact" },
    );
    await until(() => hosts.calls.length === 1);
    expect(hosts.calls[0]?.method).toBe("port/submissions.deliver");
    await until(() => interaction.deliveries()[0]?.delivered === 1);
    expect(interaction.deliveries()).toEqual([
      expect.objectContaining({ owner: "mostra", delivered: 1 }),
    ]);
    interaction.stop();
  });

  it("tells a subscription that compaction overtook it, with the summary, and keeps delivering (finding 3)", async () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    const hosts = new FakeHosts();
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts,
      expectedHosts: () => [],
      artifacts: { resolve: () => artifactId },
    });
    interaction.start();
    const subscriber = {
      ...session(9, "host", []),
      notifications: new Set(["events/notify"]),
    } as Session;
    const subscribe = interaction
      .methods()
      .find((entry) => entry.definition.method === "events/subscribe");
    // Subscribed at cursor 1; the next events are compacted before the pump reaches them.
    const answer = (await subscribe?.handle(
      { after: "1", filter: { artifacts: [artifactId] } },
      subscriber,
    )) as {
      subscriptionId: string;
    };
    for (let index = 0; index < 4; index++) mutate(ledger, artifactId, [set("a", index)]);
    ledger.write((db) =>
      compactEvents(db, artifactId, Number(events(ledger, artifactId).at(-1)?.cursor)),
    );
    await until(() => hosts.notifications.length > 0);
    const first = hosts.notifications[0]?.params as {
      subscriptionId: string;
      events: EventRecord[];
      compacted?: { code: string };
    };
    expect(first.subscriptionId).toBe(answer.subscriptionId);
    expect(first.compacted?.code).toBe("MOSTRA_HOST_CURSOR_COMPACTED");
    expect(first.events[0]?.type).toBe("artifact.compacted");
    // It goes on: the event after the summary, and later commits, still arrive.
    mutate(ledger, artifactId, [set("a", "later")]);
    await until(() =>
      hosts.notifications.some((note) =>
        (note.params as { events: EventRecord[] }).events.some(
          (event) => event.payload["revision"] === "5",
        ),
      ),
    );
    interaction.stop();
  });

  it("delivers other artifacts' events around a compacted range, with no gap and no repeat (Claude review finding 1)", async () => {
    const { ledger } = freshLedger();
    const x = addArtifact(ledger, { id: ArtifactId.create() }).artifactId;
    const y = addArtifact(ledger, { id: ArtifactId.create() }).artifactId;
    const hosts = new FakeHosts();
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts,
      expectedHosts: () => [],
      artifacts: { resolve: () => x },
    });
    interaction.start();
    const subscriber = {
      ...session(9, "host", []),
      notifications: new Set(["events/notify"]),
    } as Session;
    const subscribe = interaction
      .methods()
      .find((entry) => entry.definition.method === "events/subscribe");
    mutate(ledger, x, [set("a", "first")]);
    const start = Number(events(ledger, x).at(-1)?.cursor);
    await subscribe?.handle({ after: String(start) }, subscriber);
    // X and Y interleave; then X is compacted before the pump has sent anything.
    for (let index = 0; index < 5; index++) {
      mutate(ledger, y, [set("b", index)]);
      mutate(ledger, x, [set("a", index)]);
    }
    mutate(ledger, y, [set("b", "last")]);
    const all = ledger.read((db) =>
      readEvents(db, { after: start, limit: 1000, maxBytes: Number.POSITIVE_INFINITY }),
    ).events;
    ledger.write((db) => compactEvents(db, x, Number(all.at(-1)?.cursor)));
    await until(() =>
      hosts.notifications.some(
        (note) => (note.params as { cursor: string }).cursor === all.at(-1)?.cursor,
      ),
    );
    const received = hosts.notifications.flatMap(
      (note) => (note.params as { events: EventRecord[] }).events,
    );
    const cursors = received.map((event) => Number(event.cursor));
    // In cursor order, each once.
    expect(cursors).toEqual([...new Set(cursors)].sort((a, b) => a - b));
    // Every Y event arrived; X's arrive as one summary in their place.
    expect(received.filter((event) => event.artifactId === y).map((event) => event.cursor)).toEqual(
      all.filter((event) => event.artifactId === y).map((event) => event.cursor),
    );
    expect(received.filter((event) => event.artifactId === x).map((event) => event.type)).toEqual([
      "artifact.compacted",
    ]);
    expect(
      hosts.notifications.some(
        (note) =>
          (note.params as { compacted?: { code: string } }).compacted?.code ===
          "MOSTRA_HOST_CURSOR_COMPACTED",
      ),
    ).toBe(true);
    interaction.stop();
  });

  it("replays a committed save after a submission closed the draft, instead of refusing it (finding 7)", () => {
    const { ledger, artifactId, versions, latest } = submitting(undefined);
    const interaction = createInteraction({
      ledger,
      log: silentLog,
      faults: noFaults,
      hosts: new FakeHosts(),
      expectedHosts: () => [],
      artifacts: { resolve: () => artifactId },
    });
    const page = { artifactId, viewerId: latest.viewerId };
    const save = {
      viewId: latest.viewId,
      scope: "viewer" as const,
      mutationId: mutationId(),
      baseRevision: 0,
      ops: [set("a", 1)],
    };
    const first = interaction.mutate(page, save);
    // Another tab submits before the first tab's retry of that save arrives.
    const tab = viewOf(ledger, artifactId, versions[1] as string, latest.viewerId);
    interaction.submit(page, { viewId: tab.viewId, expectedRevision: 1, channel: "artifact" });
    expect(interaction.mutate(page, save)).toEqual(first);
    // A new write is still refused.
    expect(codeOf(() => interaction.mutate(page, { ...save, mutationId: mutationId() }))).toBe(
      "MOSTRA_SUBMIT_ALREADY",
    );
  });
});

describe("viewers (D104)", () => {
  it("maps a host's key to one viewer, idempotently, and keeps one local user", () => {
    const { ledger } = freshLedger();
    const first = ledger.write((db) => viewerForSpec(db, { ref: "ana@example.com", name: "Ana" }));
    const again = ledger.write((db) =>
      viewerForSpec(db, { ref: "ana@example.com", name: "Ana B." }),
    );
    expect(again).toBe(first);
    expect(ViewerId.is(first)).toBe(true);
    expect(ledger.write((db) => localViewerId(db))).toBe(ledger.write((db) => localViewerId(db)));
    expect(
      ledger.read((db) => db.get<{ name: string }>("SELECT name FROM viewer WHERE id = ?", first))
        ?.name,
    ).toBe("Ana B.");
  });

  it("publishVersion helper moves the latest version", () => {
    const { ledger } = freshLedger();
    const { artifactId } = addArtifact(ledger, { id: ArtifactId.create() });
    const next = ledger.write((db) => publishVersion(db, artifactId, 2));
    expect(
      ledger.read((db) =>
        db.get<{ latest_version_id: string }>(
          "SELECT latest_version_id FROM artifact WHERE id = ?",
          artifactId,
        ),
      )?.latest_version_id,
    ).toBe(next);
  });
});
