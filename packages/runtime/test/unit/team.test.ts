/**
 * Teams in the interaction core, in-process against a real ledger (D168; CO-01, CO-02, CO-03,
 * CO-07): the roster's rounds and completion as a property over interleavings under `once`
 * per-viewer and `epochs`, the `submitted:all` and `submitted:<N>` waits against a model, each
 * respondent's status, and what a page sees under each visibility setting.
 */
import {
  ArtifactId,
  type EventRecord,
  RpcError,
  type TeamVisibility,
  TokenId,
} from "@mostra/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { compactEvents, readEvents } from "../../src/interaction/events.ts";
import { createInteraction, type Interaction } from "../../src/interaction/index.ts";
import { viewerForSpec } from "../../src/interaction/viewers.ts";
import { checkCondition } from "../../src/interaction/wait.ts";
import type { Ledger, LedgerDb } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { addArtifact, FakeHosts, freshLedger, viewOf } from "../interaction-support.ts";

const PROPERTY_TIMEOUT_MS = process.platform === "win32" ? 120_000 : 60_000;
const agent = { kind: "agent" as const, id: "test-agent" };

/** A token row for a personal link: the roster names one, the gateway mints them for real. */
function fakeToken(db: LedgerDb, artifactId: string, viewerId: string): string {
  const id = TokenId.create();
  db.run(
    "INSERT INTO token (id, secret_hash, artifact_id, scopes_json, viewer_id, created_at, shell_origin) VALUES (?, ?, ?, '[\"view\"]', ?, ?, 'http://127.0.0.1:1')",
    id,
    `hash-${id}`,
    artifactId,
    viewerId,
    new Date().toISOString(),
  );
  return id;
}

function setup(policy: unknown, manifest?: Record<string, unknown>) {
  const { ledger } = freshLedger();
  const { artifactId, versions } = addArtifact(ledger, {
    id: ArtifactId.create(),
    policy,
    ...(manifest !== undefined ? { manifest } : {}),
  });
  const interaction = createInteraction({
    coverage: () => () => true,
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts: new FakeHosts(),
    expectedHosts: () => [],
    artifacts: { resolve: () => artifactId },
  });
  return { ledger, artifactId, versionId: versions[0] as string, interaction };
}

function add(
  ledger: Ledger,
  interaction: Interaction,
  artifactId: string,
  refs: readonly string[],
) {
  return ledger.write((db) =>
    interaction.addRespondents(db, {
      artifactId,
      respondents: refs.map((ref) => ({ ref, name: ref.toUpperCase() })),
      actor: agent,
      link: (viewerId, current) => current ?? fakeToken(db, artifactId, viewerId),
    }),
  );
}

function remove(
  ledger: Ledger,
  interaction: Interaction,
  artifactId: string,
  refs: readonly string[],
) {
  return ledger.write((db) =>
    interaction.removeRespondents(db, { artifactId, refs, actor: agent }),
  );
}

/** The viewer a respondent's personal link acts as (D104). */
function viewerOf(ledger: Ledger, ref: string): string {
  return ledger.read(
    (db) =>
      db.get<{ id: string }>("SELECT id FROM viewer WHERE kind = 'token' AND external_ref = ?", ref)
        ?.id as string,
  );
}

function submitAs(
  ledger: Ledger,
  interaction: Interaction,
  artifactId: string,
  versionId: string,
  viewerId: string,
): boolean {
  const view = viewOf(ledger, artifactId, versionId, viewerId);
  const revision = ledger.read(
    (db) =>
      db.get<{ revision: number }>(
        "SELECT revision FROM document WHERE artifact_id = ? AND viewer_id = ?",
        artifactId,
        viewerId,
      )?.revision ?? 0,
  );
  try {
    interaction.submit(
      { artifactId, viewerId },
      { viewId: view.viewId, expectedRevision: revision, channel: "artifact" },
    );
    return true;
  } catch (error) {
    if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_SUBMIT_ALREADY")
      return false;
    throw error;
  }
}

function events(ledger: Ledger, artifactId: string, type?: string): EventRecord[] {
  return ledger.read(
    (db) =>
      readEvents(db, {
        filter: { artifacts: [artifactId], ...(type ? { types: [type] } : {}) },
        after: 0,
        limit: 10_000,
        maxBytes: Number.POSITIVE_INFINITY,
      }).events,
  );
}

function check(
  ledger: Ledger,
  artifactId: string,
  until: string,
  after: number,
  explicit: boolean,
): EventRecord | undefined {
  const outcome = ledger.read((db) => checkCondition(db, artifactId, until, after, explicit));
  return "event" in outcome ? outcome.event : undefined;
}

function cursorNow(ledger: Ledger): number {
  return ledger.read(
    (db) => db.get<{ c: number | null }>("SELECT MAX(cursor) AS c FROM event")?.c ?? 0,
  );
}

const PEOPLE = ["ada", "grace", "edsger", "barbara", "alan", "outsider"] as const;

type Step =
  | { readonly kind: "submit"; readonly who: (typeof PEOPLE)[number] }
  | { readonly kind: "add"; readonly who: (typeof PEOPLE)[number] }
  | { readonly kind: "remove"; readonly who: (typeof PEOPLE)[number] }
  | { readonly kind: "open"; readonly who: (typeof PEOPLE)[number] };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({ kind: fc.constant("submit" as const), who: fc.constantFrom(...PEOPLE) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("add" as const), who: fc.constantFrom(...PEOPLE) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("remove" as const), who: fc.constantFrom(...PEOPLE) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("open" as const), who: fc.constantFrom(...PEOPLE) }),
  },
);

describe("the roster's completion and its waits (CO-02, D168)", () => {
  for (const policy of [{ policy: "once", scope: "per-viewer" }, { policy: "epochs" }] as const) {
    it(
      `under ${policy.policy === "once" ? "once per-viewer" : "epochs"}, completes exactly when the last expected respondent submits, once per completion, and submitted:all and submitted:<N> agree with a model (property)`,
      () => {
        fc.assert(
          fc.property(
            fc.subarray([...PEOPLE.slice(0, 5)], { minLength: 1 }),
            fc.array(step, { minLength: 1, maxLength: 30 }),
            fc.integer({ min: 1, max: 6 }),
            (initial, steps, n) => {
              const { ledger, artifactId, versionId, interaction } = setup(policy);
              add(ledger, interaction, artifactId, initial);
              const start = cursorNow(ledger);
              // The model: who is expected, who submitted when, and the round's start.
              const roster = new Set<string>(initial);
              const submitted: { who: string; at: number }[] = [];
              let round = 1;
              let roundStart = -1;
              let complete = false;
              let completions = 0;
              let firstAfterStart: number | undefined;
              let submissions = 0;
              const settle = (index: number): void => {
                const now =
                  roster.size > 0 &&
                  [...roster].every((who) =>
                    submitted.some((entry) => entry.who === who && entry.at > roundStart),
                  );
                if (now && !complete) {
                  completions += 1;
                  firstAfterStart ??= index;
                  if (policy.policy === "epochs") {
                    round += 1;
                    roundStart = index;
                    complete = false;
                    return;
                  }
                  complete = true;
                  return;
                }
                complete = now;
              };
              let completedCursorAtFirst: string | undefined;
              steps.forEach((entry, index) => {
                // Someone the roster never named is a viewer of a link minted for them, as a
                // respondent is (D104): one viewer per ref.
                const viewer = (): string =>
                  ledger.write((db) => viewerForSpec(db, { ref: entry.who }));
                if (entry.kind === "submit") {
                  const made = submitAs(ledger, interaction, artifactId, versionId, viewer());
                  if (made) {
                    submitted.push({ who: entry.who, at: index });
                    submissions += 1;
                    settle(index);
                  }
                } else if (entry.kind === "add") {
                  add(ledger, interaction, artifactId, [entry.who]);
                  roster.add(entry.who);
                  settle(index);
                } else if (entry.kind === "remove") {
                  remove(ledger, interaction, artifactId, [entry.who]);
                  roster.delete(entry.who);
                  settle(index);
                } else {
                  viewOf(ledger, artifactId, versionId, viewer());
                }
                const completedEvents = events(ledger, artifactId, "roster.completed");
                // Completions are told exactly as often as the model completes.
                expect(completedEvents).toHaveLength(completions);
                if (firstAfterStart === index && completedCursorAtFirst === undefined) {
                  completedCursorAtFirst = completedEvents.at(-1)?.cursor;
                }
                const read = interaction.roster(artifactId);
                expect(read.round).toBe(round);
                expect(read.counts.total).toBe(roster.size);
                // submitted:all after the start: the first completion after it, exactly then.
                const edge = check(ledger, artifactId, "submitted:all", start, true);
                expect(edge?.cursor).toBe(completedCursorAtFirst);
                if (policy.policy === "once") {
                  // Level-triggered without a cursor: holds exactly while the roster is complete.
                  expect(read.complete).toBe(complete);
                  const level = check(ledger, artifactId, "submitted:all", start, false);
                  expect(level !== undefined).toBe(complete);
                  if (level) expect(level.type).toBe("roster.completed");
                }
                // submitted:<N> after the start: the N-th submission, once there are N.
                const counted = check(ledger, artifactId, `submitted:${n}`, start, true);
                expect(counted !== undefined).toBe(submissions >= n);
                if (counted) expect(counted.type).toBe("submission.created");
              });
              ledger.close();
            },
          ),
          { numRuns: 25 },
        );
      },
      PROPERTY_TIMEOUT_MS,
    );
  }

  it("refuses submitted:all and submitted:N>1 under once per-artifact, and every count wait under none", () => {
    const perArtifact = setup({ policy: "once", scope: "per-artifact" });
    const code = (ledger: Ledger, artifactId: string, until: string): string | undefined => {
      try {
        check(ledger, artifactId, until, 0, false);
      } catch (error) {
        if (error instanceof RpcError) return error.diagnostic.code;
        throw error;
      }
      return undefined;
    };
    expect(code(perArtifact.ledger, perArtifact.artifactId, "submitted:all")).toBe(
      "MOSTRA_TEAM_ROSTER_POLICY",
    );
    expect(code(perArtifact.ledger, perArtifact.artifactId, "submitted:2")).toBe(
      "MOSTRA_TEAM_ROSTER_POLICY",
    );
    expect(code(perArtifact.ledger, perArtifact.artifactId, "submitted:1")).toBeUndefined();
    const none = setup({ policy: "none" });
    expect(code(none.ledger, none.artifactId, "submitted:all")).toBe("MOSTRA_SUBMIT_POLICY_NONE");
    expect(code(none.ledger, none.artifactId, "submitted:3")).toBe("MOSTRA_SUBMIT_POLICY_NONE");
  });

  it("an empty roster never completes, and a completed roster read after compaction still answers", () => {
    const { ledger, artifactId, versionId, interaction } = setup({
      policy: "once",
      scope: "per-viewer",
    });
    expect(check(ledger, artifactId, "submitted:all", 0, false)).toBeUndefined();
    add(ledger, interaction, artifactId, ["ada", "grace"]);
    submitAs(ledger, interaction, artifactId, versionId, viewerOf(ledger, "ada"));
    expect(check(ledger, artifactId, "submitted:all", 0, false)).toBeUndefined();
    submitAs(ledger, interaction, artifactId, versionId, viewerOf(ledger, "grace"));
    const completed = check(ledger, artifactId, "submitted:all", 0, false);
    expect(completed?.type).toBe("roster.completed");
    expect(completed?.payload["submissions"]).toHaveLength(2);
    // Compacting every event leaves the roster's state in the summary (DATA_MODEL §4).
    ledger.write((db) => compactEvents(db, artifactId, cursorNow(ledger) + 1));
    expect(
      events(ledger, artifactId).filter((event) => event.type === "roster.completed"),
    ).toHaveLength(0);
    const after = check(ledger, artifactId, "submitted:all", 0, false);
    expect(after?.cursor).toBe(completed?.cursor);
    // Removing everyone empties it: it is no longer complete.
    remove(ledger, interaction, artifactId, ["ada", "grace"]);
    expect(check(ledger, artifactId, "submitted:all", 0, false)).toBeUndefined();
  });
});

describe("respondent status and the visibility policy (CO-03, CO-07)", () => {
  it("moves each respondent from not opened to drafting to submitted", () => {
    const { ledger, artifactId, versionId, interaction } = setup({
      policy: "once",
      scope: "per-viewer",
    });
    add(ledger, interaction, artifactId, ["ada", "grace", "alan"]);
    const status = () =>
      Object.fromEntries(
        interaction.roster(artifactId).respondents.map((one) => [one.ref, one.status]),
      );
    expect(status()).toEqual({ ada: "not-opened", grace: "not-opened", alan: "not-opened" });
    viewOf(ledger, artifactId, versionId, viewerOf(ledger, "grace"));
    submitAs(ledger, interaction, artifactId, versionId, viewerOf(ledger, "ada"));
    expect(status()).toEqual({ ada: "submitted", grace: "drafting", alan: "not-opened" });
    const read = interaction.roster(artifactId);
    expect(read.counts).toEqual({ total: 3, notOpened: 1, drafting: 1, submitted: 1 });
    expect(read.complete).toBe(false);
    expect(read.respondents[0]?.submission?.id).toMatch(/^sub_/);
  });

  for (const visibility of [
    "private",
    "counts",
    "names",
  ] as const satisfies readonly TeamVisibility[]) {
    it(`returns exactly what ${visibility} promises to a respondent's page, and everything to the owner's`, () => {
      const { ledger, artifactId, versionId, interaction } = setup(
        { policy: "once", scope: "per-viewer" },
        { team: { visibility } },
      );
      add(ledger, interaction, artifactId, ["ada", "grace"]);
      const ada = viewerOf(ledger, "ada");
      submitAs(ledger, interaction, artifactId, versionId, viewerOf(ledger, "grace"));
      const page = interaction.rosterForPage({ artifactId, viewerId: ada });
      expect(page.visibility).toBe(visibility);
      expect(page.owner).toBe(false);
      expect(page.self).toMatchObject({ self: true, name: "ADA", status: "not-opened" });
      if (visibility === "private") {
        expect(page.counts).toBeUndefined();
        expect(page.complete).toBeUndefined();
        expect(page.respondents).toBeUndefined();
      } else {
        expect(page.counts).toEqual({ total: 2, notOpened: 1, drafting: 0, submitted: 1 });
        expect(page.complete).toBe(false);
        if (visibility === "counts") expect(page.respondents).toBeUndefined();
        else
          expect(page.respondents?.map((one) => [one.name, one.status, one.self])).toEqual([
            ["ADA", "not-opened", true],
            ["GRACE", "submitted", false],
          ]);
      }
      // Never a ref, an email or a viewer ID of anyone.
      const text = JSON.stringify(page);
      expect(text).not.toContain(ada);
      expect(text).not.toContain(viewerOf(ledger, "grace"));
      expect(text).not.toContain('"ref"');
      // The owner (the home's local user) sees everyone, whatever the policy.
      const owner = viewOf(ledger, artifactId, versionId).viewerId;
      const theirs = interaction.rosterForPage({ artifactId, viewerId: owner });
      expect(theirs.owner).toBe(true);
      expect(theirs.self).toBeUndefined();
      expect(theirs.respondents).toHaveLength(2);
    });
  }

  it("keeps the roster's events from pages", () => {
    const { ledger, artifactId, versionId, interaction } = setup({
      policy: "once",
      scope: "per-viewer",
    });
    add(ledger, interaction, artifactId, ["ada"]);
    const ada = viewerOf(ledger, "ada");
    submitAs(ledger, interaction, artifactId, versionId, ada);
    expect(events(ledger, artifactId).map((event) => event.type)).toContain("roster.completed");
    const seen = interaction.pageEvents({ artifactId, viewerId: ada }, 0, 1000).events;
    expect(seen.some((event) => event.type.startsWith("roster."))).toBe(false);
  });
});
