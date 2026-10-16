/**
 * The interaction core's WP-07 parts, in-process against a real ledger: the channel recorded on
 * each view and checked by every submit and choice (SH-02, D108), the trusted Choose (D113),
 * orphans judged against a version's coverage with the version that wrote them (VR-05, D109),
 * follow (LL-03), and the delivery states a viewer sees (IN-13).
 */
import {
  ArtifactId,
  type ControlsPolicy,
  type EventRecord,
  MutationId,
  RpcError,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { appendEvent, readEvents } from "../../src/interaction/events.ts";
import { createInteraction, type Interaction } from "../../src/interaction/index.ts";
import { buildResults } from "../../src/interaction/results.ts";
import type { SubmissionRow } from "../../src/interaction/submissions.ts";
import { localViewerId } from "../../src/interaction/viewers.ts";
import { type Ledger, MIGRATIONS, openLedger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { addArtifact, FakeHosts, freshLedger, set, until } from "../interaction-support.ts";
import { tempDir } from "../support.ts";

const SHELL_ONLY: ControlsPolicy = { submitChannels: ["shell"] };
const ARTIFACT_ONLY: ControlsPolicy = { submitChannels: ["artifact"] };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RpcError) return error.diagnostic.code;
    throw error;
  }
  return undefined;
}

function events(ledger: Ledger, artifactId: string): EventRecord[] {
  return ledger.read(
    (db) =>
      readEvents(db, {
        filter: { artifacts: [artifactId] },
        after: 0,
        limit: 1000,
        maxBytes: Number.POSITIVE_INFINITY,
      }).events,
  );
}

/**
 * An artifact with two versions, where `uncovered` lists, per version number, the field IDs that
 * version's code doesn't name (everything else is covered).
 */
function setup(
  options: {
    policy?: unknown;
    uncovered?: Record<number, readonly string[]>;
    hosts?: FakeHosts;
    expected?: readonly string[];
  } = {},
) {
  const { ledger } = freshLedger();
  const { artifactId, versions } = addArtifact(ledger, {
    id: ArtifactId.create(),
    policy: options.policy,
    versions: 2,
  });
  const numberOf = new Map(versions.map((id, index) => [id, index + 1]));
  const interaction: Interaction = createInteraction({
    coverage: (versionId) => (fieldId) =>
      !(options.uncovered?.[numberOf.get(versionId) ?? 0] ?? []).includes(fieldId),
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts: options.hosts ?? new FakeHosts(),
    expectedHosts: () => options.expected ?? [],
    artifacts: { resolve: () => artifactId },
  });
  const viewerId = ledger.write((db) => localViewerId(db));
  const page = { artifactId, viewerId };
  const view = (number: 1 | 2, controls?: ControlsPolicy) =>
    interaction.openView({
      artifactId,
      versionId: versions[number - 1] as string,
      viewerId,
      ...(controls ? { controls } : {}),
    });
  const write = (viewId: string, base: number, ...ops: ReturnType<typeof set>[]) =>
    interaction.mutate(page, {
      viewId,
      scope: "viewer",
      mutationId: MutationId.create(),
      baseRevision: base,
      ops,
    });
  return { ledger, interaction, artifactId, versions, page, view, write };
}

describe("each view's channels decide every submit and choice (SH-02, D108)", () => {
  it("records the controls a view was opened with; views before WP-07 allow both channels", () => {
    const { interaction, page, view } = setup();
    expect(interaction.viewControls(page, view(2, SHELL_ONLY))).toEqual(SHELL_ONLY);
    expect(interaction.viewControls(page, view(2))).toEqual({
      submitChannels: ["shell", "artifact"],
    });
  });

  it("refuses the artifact's submit on a shell-only view, also as a repeat of a shell submission, and records the shell's", () => {
    const { ledger, interaction, page, view, write, artifactId } = setup();
    const viewId = view(2, SHELL_ONLY);
    write(viewId, 0, set("name", "Ana"));
    expect(
      codeOf(() => interaction.submit(page, { viewId, expectedRevision: 1, channel: "artifact" })),
    ).toBe("MOSTRA_SUBMIT_CHANNEL_DENIED");
    const made = interaction.submit(page, { viewId, expectedRevision: 1, channel: "shell" });
    expect(made.channel).toBe("shell");
    // The same view and revision again would be a repeat; through the denied channel it is still
    // refused, so the artifact can't even learn the submission by repeating it.
    expect(
      codeOf(() => interaction.submit(page, { viewId, expectedRevision: 1, channel: "artifact" })),
    ).toBe("MOSTRA_SUBMIT_CHANNEL_DENIED");
    const row = ledger.read(
      (db) =>
        db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE artifact_id = ?",
          artifactId,
        ) as SubmissionRow,
    );
    const results = ledger.read((db) => buildResults(db, row));
    expect(results.submission.channel).toBe("shell");
    expect(results.submission.viewer.id).toBe(page.viewerId);
  });

  it("refuses the shell's submit and Choose on a view a host gave the artifact channel only", () => {
    const { interaction, page, view } = setup();
    const viewId = view(2, ARTIFACT_ONLY);
    expect(
      codeOf(() => interaction.submit(page, { viewId, expectedRevision: 0, channel: "shell" })),
    ).toBe("MOSTRA_SUBMIT_CHANNEL_DENIED");
    expect(
      codeOf(() =>
        interaction.choose(page, {
          viewId,
          mutationId: MutationId.create(),
          baseRevision: 0,
          reviewSetId: "layout",
          candidateId: "dense",
        }),
      ),
    ).toBe("MOSTRA_SUBMIT_CHANNEL_DENIED");
  });

  it("lets the shell's Choose write the choice with its label, and refuses the page writing it on a shell-only view", () => {
    const { ledger, interaction, page, view, write, artifactId } = setup();
    const viewId = view(2, SHELL_ONLY);
    expect(codeOf(() => write(viewId, 0, set("review.layout.choice", "airy")))).toBe(
      "MOSTRA_SUBMIT_CHANNEL_DENIED",
    );
    // Other fields stay the page's to write.
    expect(write(viewId, 0, set("name", "Ana")).applied).toEqual(["name"]);
    const chosen = interaction.choose(page, {
      viewId,
      mutationId: MutationId.create(),
      baseRevision: 1,
      reviewSetId: "layout",
      candidateId: "dense",
      label: "Dense",
    });
    expect(chosen.applied).toEqual(["review.layout.choice"]);
    const changed = events(ledger, artifactId).filter((event) => event.type === "draft.changed");
    expect(changed.at(-1)?.causation).toMatchObject({ channel: "shell" });
    const made = interaction.submit(page, { viewId, expectedRevision: 2, channel: "shell" });
    const row = ledger.read(
      (db) =>
        db.get<SubmissionRow>("SELECT * FROM submission WHERE id = ?", made.id) as SubmissionRow,
    );
    expect(ledger.read((db) => buildResults(db, row)).choices).toEqual([
      { reviewSetId: "layout", candidateId: "dense", label: "Dense" },
    ]);
  });

  it("lets the page choose where the artifact channel is allowed", () => {
    const { view, write } = setup();
    const viewId = view(2);
    expect(write(viewId, 0, set("review.layout.choice", "airy")).applied).toEqual([
      "review.layout.choice",
    ]);
  });
});

describe("orphans are judged against the version the view shows (VR-05, D109)", () => {
  it("keeps an answer the newer version doesn't name, shows it for carry-over, and delivers it as orphaned from the version that wrote it", () => {
    const { ledger, interaction, page, view, write, versions } = setup({
      uncovered: { 2: ["notes"] },
    });
    const v1 = view(1);
    write(v1, 0, set("name", "Ana"), set("notes", "only in 1", { label: "Notes" }));
    expect(interaction.carryOver(page, { id: versions[0] as string, number: 1 }).orphans).toEqual(
      [],
    );
    expect(interaction.carryOver(page, { id: versions[1] as string, number: 2 })).toEqual({
      version: { id: versions[1], number: 2 },
      orphans: [{ id: "notes", label: "Notes", value: "only in 1", fromVersion: 1 }],
    });
    const v2 = view(2);
    const made = interaction.submit(page, { viewId: v2, expectedRevision: 1, channel: "shell" });
    const row = ledger.read(
      (db) =>
        db.get<SubmissionRow>("SELECT * FROM submission WHERE id = ?", made.id) as SubmissionRow,
    );
    const results = ledger.read((db) => buildResults(db, row));
    expect(results.answers).toEqual({ name: "Ana" });
    expect(results.orphaned).toEqual([
      { id: "notes", label: "Notes", value: "only in 1", fromVersion: 1 },
    ]);
    // Nothing moved or dropped: the draft still holds it, as it was written.
    expect(interaction.pageSnapshot(page).draft.fields["notes"]).toMatchObject({
      value: "only in 1",
      label: "Notes",
    });
  });
});

describe("a page's snapshot names the latest version (GPT review finding 13)", () => {
  it("so a shell that missed version.published still learns of it", () => {
    const { interaction, page, versions } = setup();
    expect(interaction.pageSnapshot(page).latest).toEqual({ id: versions[1], number: 2 });
  });
});

describe("following (LL-03)", () => {
  it("is off until the viewer turns it on, and kept per viewer and artifact", () => {
    const { interaction, page } = setup();
    expect(interaction.following(page)).toBe(false);
    interaction.setFollowing(page, true);
    interaction.setFollowing(page, true);
    expect(interaction.following(page)).toBe(true);
    interaction.setFollowing(page, false);
    expect(interaction.following(page)).toBe(false);
  });
});

describe("what the viewer sees of a delivery (IN-13)", () => {
  it("marks a delivery waiting, once, while its expected host is away, then delivered", async () => {
    const hosts = new FakeHosts();
    const { ledger, interaction, page, view, write, artifactId } = setup({
      hosts,
      expected: ["jcode"],
    });
    interaction.start();
    try {
      const viewId = view(2);
      write(viewId, 0, set("name", "Ana"));
      const made = interaction.submit(page, { viewId, expectedRevision: 1, channel: "shell" });
      expect(made.deliveries?.map((delivery) => delivery.owner)).toEqual(["jcode"]);
      const retrying = () =>
        events(ledger, artifactId).filter((event) => event.type === "submission.retrying");
      await until(() => retrying().length === 1);
      expect(interaction.pageSnapshot(page).submission?.deliveries?.[0]).toMatchObject({
        owner: "jcode",
        state: "pending",
        waiting: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(retrying()).toHaveLength(1);
      hosts.registered = [{ session: 1, owner: "jcode", ports: ["submissions"] }];
      interaction.connected({
        id: 1,
        client: { name: "jcode", version: "1" },
        ports: new Set(["submissions"]),
      } as never);
      await until(() => events(ledger, artifactId).some((e) => e.type === "submission.delivered"));
      expect(interaction.pageSnapshot(page).submission).toMatchObject({ delivery: "delivered" });
    } finally {
      interaction.stop();
    }
  });
});

describe("migration 6 (D108, D109, D63)", () => {
  it("gives each draft field the version whose view last wrote it, from the draft events; unknown stays unknown", () => {
    const storeDir = `${tempDir("mostra-m6")}/store`;
    const owner = { pid: process.pid, startTime: "boot/1" };
    const at = (migrations: typeof MIGRATIONS) => {
      const opening = openLedger({
        storeDir,
        runtimeVersion: "1.0.0",
        owner,
        log: silentLog,
        migrations,
      });
      if (!opening.ok) throw new Error("locked");
      return opening.ledger;
    };
    // A ledger as WP-06 left it.
    const before = at(MIGRATIONS.filter((migration) => migration.version <= 5));
    expect(before.schemaVersion).toBe(5);
    const { artifactId, versions } = addArtifact(before, { id: ArtifactId.create(), versions: 2 });
    const now = new Date().toISOString();
    before.write((db) => {
      db.run(
        "INSERT INTO viewer (id, kind, external_ref, created_at) VALUES ('vwr_01J00000000000000000000000', 'local', 'local', ?)",
        now,
      );
      const views: readonly (readonly [string, string])[] = [
        ["vw_01J00000000000000000000001", versions[0] as string],
        ["vw_01J00000000000000000000002", versions[1] as string],
      ];
      for (const [view, version] of views) {
        db.run(
          "INSERT INTO view (id, artifact_id, version_id, viewer_id, opened_at) VALUES (?, ?, ?, 'vwr_01J00000000000000000000000', ?)",
          view,
          artifactId,
          version,
          now,
        );
      }
      db.run(
        "INSERT INTO document (id, artifact_id, scope, viewer_id, revision) VALUES (1, ?, 'viewer', 'vwr_01J00000000000000000000000', 3)",
        artifactId,
      );
      for (const [field, rev] of [
        ["a", 3],
        ["b", 2],
        ["c", 1],
      ] as const) {
        db.run(
          "INSERT INTO field (document_id, field_id, value_json, field_rev, updated_at) VALUES (1, ?, '1', ?, ?)",
          field,
          rev,
          now,
        );
      }
      const change = (viewId: string, ids: string[]) =>
        appendEvent(db, {
          artifactId,
          type: "draft.changed",
          causation: { viewId },
          payload: {
            viewerId: "vwr_01J00000000000000000000000",
            changes: ids.map((id) => ({ id, value: 1 })),
          },
        });
      // "c" was written too, but its event is gone (compaction): its version stays unknown.
      change("vw_01J00000000000000000000001", ["a", "b"]);
      change("vw_01J00000000000000000000002", ["a"]);
    });
    before.close();
    const after = at(MIGRATIONS);
    expect(after.migrated).toMatchObject({ from: 5 });
    expect(
      after.read((db) =>
        db.all<{ field_id: string; version_number: number | null }>(
          "SELECT field_id, version_number FROM field ORDER BY field_id",
        ),
      ),
    ).toEqual([
      { field_id: "a", version_number: 2 },
      { field_id: "b", version_number: 1 },
      { field_id: "c", version_number: null },
    ]);
    expect(
      after.read((db) => db.all<{ name: string }>("SELECT name FROM pragma_table_info('view')")),
    ).toContainEqual({ name: "controls_json" });
    after.close();
  });
});
