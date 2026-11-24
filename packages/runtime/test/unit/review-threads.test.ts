/**
 * The review layer's ledger side (WP-20; RV-02, RV-03, RV-05, CO-06, HO-11): threads, replies,
 * resolve and reopen, who sees them, mentions as host-only events, crops set once, the threads a
 * submission carries into its results, and the `reviews` port's mirror. Through the interaction
 * core's own methods, as the gateway's routes call them.
 */
import {
  ArtifactId,
  CommentId,
  type EventRecord,
  MutationId,
  type ReviewAnchor,
  RpcError,
  ThreadId,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { readEvents } from "../../src/interaction/events.ts";
import {
  createInteraction,
  type Interaction,
  type PageIdentity,
  peerKey,
  SubmitConflict,
} from "../../src/interaction/index.ts";
import { snapshotThreads } from "../../src/interaction/review.ts";
import { viewerForSpec } from "../../src/interaction/viewers.ts";
import type { Ledger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import type { Session } from "../../src/protocol-server/index.ts";
import { addArtifact, FakeHosts, freshLedger, until, viewOf } from "../interaction-support.ts";

const anchor: ReviewAnchor = {
  reviewId: "header.title",
  selectors: [
    { type: "CssSelector", value: "header > h1" },
    { type: "TextQuoteSelector", exact: "Airy", prefix: "Candidate B, ", suffix: ": more" },
  ],
  rect: { x: 120, y: 40, width: 480, height: 56 },
  viewport: { width: 1280, height: 800, dpr: 2 },
  page: "/",
  reviewSetId: "sidebar",
  candidateId: "airy",
  label: "Candidate B heading",
};

function setup(options: { manifest?: Record<string, unknown>; policy?: unknown } = {}) {
  const { ledger } = freshLedger();
  const hosts = new FakeHosts();
  const artifactId = ArtifactId.create();
  const { versions } = addArtifact(ledger, {
    id: artifactId,
    ...(options.manifest ? { manifest: options.manifest } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const interaction = createInteraction({
    coverage: () => () => true,
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts,
    expectedHosts: () => [],
    artifacts: { resolve: () => artifactId },
  });
  const versionId = versions[0] as string;
  const owner = viewOf(ledger, artifactId, versionId);
  const person = (ref: string) => {
    const viewerId = ledger.write((db) => viewerForSpec(db, { ref, name: ref.toUpperCase() }));
    return viewOf(ledger, artifactId, versionId, viewerId);
  };
  const page = (view: { viewerId: string }, scopes?: string[]): PageIdentity => ({
    artifactId,
    viewerId: view.viewerId,
    ...(scopes ? { scopes: scopes as unknown as NonNullable<PageIdentity["scopes"]> } : {}),
  });
  return { ledger, hosts, artifactId, versionId, interaction, owner, person, page };
}

const ids = () => ({ threadId: ThreadId.create(), commentId: CommentId.create() });

function start(
  interaction: Interaction,
  page: PageIdentity,
  viewId: string,
  text: string,
  extra: { mentions?: { key: string }[]; anchor?: ReviewAnchor } = {},
) {
  return interaction.createThread(page, {
    viewId,
    ...ids(),
    anchor: extra.anchor ?? anchor,
    text,
    ...(extra.mentions ? { mentions: extra.mentions } : {}),
  });
}

function eventsOf(ledger: Ledger, artifactId: string, type: string): EventRecord[] {
  return ledger
    .read((db) => readEvents(db, { filter: { artifacts: [artifactId] }, after: 0, limit: 1000 }))
    .events.filter((event) => event.type === type);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof RpcError || error instanceof SubmitConflict) return error.diagnostic.code;
    throw error;
  }
  return undefined;
}

describe("review threads", () => {
  it("starts, replies to, resolves and reopens a thread, each once, with its event", () => {
    const { interaction, owner, page, ledger, artifactId } = setup();
    const request = { viewId: owner.viewId, ...ids(), anchor, text: "The title wraps at 1280." };
    const made = interaction.createThread(page(owner), request);
    expect(made).toMatchObject({ status: "open", version: 1, crop: { state: "pending" } });
    expect(made.messages).toHaveLength(1);
    expect(made.messages[0]?.author.self).toBe(true);
    // The same request again (a retry whose answer was lost) answers the same thread.
    expect(interaction.createThread(page(owner), request).id).toBe(made.id);
    // Its IDs for another comment are refused.
    expect(codeOf(() => interaction.createThread(page(owner), { ...request, text: "Other" }))).toBe(
      "MOSTRA_REVIEW_ID_REUSED",
    );
    const replyId = CommentId.create();
    const replied = interaction.replyThread(page(owner), made.id, {
      viewId: owner.viewId,
      commentId: replyId,
      text: "Or shorten it.",
    });
    expect(replied.messages.map((message) => message.text)).toEqual([
      "The title wraps at 1280.",
      "Or shorten it.",
    ]);
    interaction.replyThread(page(owner), made.id, {
      viewId: owner.viewId,
      commentId: replyId,
      text: "Or shorten it.",
    });
    const resolved = interaction.setThreadStatus(page(owner), made.id, {
      viewId: owner.viewId,
      status: "resolved",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolved?.by.self).toBe(true);
    interaction.setThreadStatus(page(owner), made.id, { viewId: owner.viewId, status: "resolved" });
    expect(
      interaction.setThreadStatus(page(owner), made.id, { viewId: owner.viewId, status: "open" })
        .status,
    ).toBe("open");
    expect(eventsOf(ledger, artifactId, "review.thread.created")).toHaveLength(1);
    expect(eventsOf(ledger, artifactId, "review.comment.added")).toHaveLength(1);
    expect(eventsOf(ledger, artifactId, "review.thread.resolved")).toHaveLength(1);
    expect(eventsOf(ledger, artifactId, "review.thread.reopened")).toHaveLength(1);
    // Events name the anchor's layers to route on, never its quoted text.
    const created = eventsOf(ledger, artifactId, "review.thread.created")[0];
    expect(created?.payload["anchor"]).toEqual({
      reviewId: "header.title",
      page: "/",
      reviewSetId: "sidebar",
      candidateId: "airy",
    });
  });

  it("refuses a thread from a link without the review scope, and an unknown thread", () => {
    const { interaction, owner, page } = setup();
    expect(
      codeOf(() => start(interaction, page(owner, ["view", "draft"]), owner.viewId, "x")),
    ).toBe("MOSTRA_HYGIENE_SCOPE_DENIED");
    expect(
      codeOf(() =>
        interaction.replyThread(page(owner), ThreadId.create(), {
          viewId: owner.viewId,
          commentId: CommentId.create(),
          text: "x",
        }),
      ),
    ).toBe("MOSTRA_REVIEW_THREAD_NOT_FOUND");
    expect(interaction.reviewThreads(page(owner, ["view"]), owner.viewId).writable).toBe(false);
    expect(interaction.reviewThreads(page(owner), owner.viewId).writable).toBe(true);
  });

  it("shows a page its own threads, those it wrote in or is named in; the owner and names see all", () => {
    const { interaction, owner, person, page } = setup();
    const ada = person("ada");
    const bo = person("bo");
    const adas = start(interaction, page(ada), ada.viewId, "Ada's note");
    // Under the default `private`, Bo sees none of Ada's threads; the owner sees every thread.
    expect(interaction.reviewThreads(page(bo), bo.viewId).threads).toEqual([]);
    expect(interaction.reviewThreads(page(owner), owner.viewId).threads.map((t) => t.id)).toEqual([
      adas.id,
    ]);
    // Bo can't reply to a thread he can't see.
    expect(
      codeOf(() =>
        interaction.replyThread(page(bo), adas.id, {
          viewId: bo.viewId,
          commentId: CommentId.create(),
          text: "Hi",
        }),
      ),
    ).toBe("MOSTRA_REVIEW_THREAD_NOT_FOUND");
    // The owner mentions Bo in a reply: Bo sees the thread now, with people by key and name only.
    const boKey = peerKey(page(bo).artifactId, bo.viewerId);
    interaction.replyThread(page(owner), adas.id, {
      viewId: owner.viewId,
      commentId: CommentId.create(),
      text: "@BO what do you think?",
      mentions: [{ key: boKey }],
    });
    const seen = interaction.reviewThreads(page(bo), bo.viewId);
    expect(seen.threads.map((thread) => thread.id)).toEqual([adas.id]);
    const people = JSON.stringify(seen);
    expect(people).not.toContain(ada.viewerId);
    expect(people).not.toContain(owner.viewerId);
    expect(people).not.toContain('"ref"');
    expect(seen.threads[0]?.messages[1]?.mentions?.[0]).toMatchObject({ key: boKey, self: true });
  });

  it("shows a crop's picture to its viewer and the owner only, and no page why one failed (findings 2, 9)", () => {
    const { interaction, owner, person, page, ledger, artifactId } = setup();
    const ada = person("ada");
    const bo = person("bo");
    const adas = start(interaction, page(ada), ada.viewId, "Ada's note");
    interaction.setCrop(adas.id, {
      kind: "captured",
      blob: "d".repeat(64),
      width: 300,
      height: 200,
      source: "default",
    });
    const boKey = peerKey(artifactId, bo.viewerId);
    interaction.replyThread(page(owner), adas.id, {
      viewId: owner.viewId,
      commentId: CommentId.create(),
      text: "@BO look",
      mentions: [{ key: boKey }],
    });
    // Bo, named, sees the thread, without the picture of Ada's answers.
    const boSees = interaction.reviewThreads(page(bo), bo.viewId).threads[0];
    expect(boSees?.id).toBe(adas.id);
    expect(boSees?.crop).toMatchObject({ state: "captured", withheld: true });
    expect(interaction.threadCrop(page(bo), adas.id)).toBeUndefined();
    // Ada and the owner see it.
    for (const who of [ada, owner]) {
      expect(interaction.reviewThreads(page(who), who.viewId).threads[0]?.crop).not.toHaveProperty(
        "withheld",
      );
      expect(interaction.threadCrop(page(who), adas.id)).toEqual({ blob: "d".repeat(64) });
    }
    // A failed crop's reason (a path in the home here) stays with hosts and results.
    const failing = start(interaction, page(ada), ada.viewId, "Another");
    interaction.setCrop(failing.id, { kind: "failed", reason: "ENOENT: /Users/owner/.mostra/x" });
    const shown = interaction.reviewThreads(page(ada), ada.viewId);
    expect(JSON.stringify(shown)).not.toContain("/Users/owner");
    const pageEvents = interaction.pageEvents(page(ada), 0, 1000).events;
    expect(JSON.stringify(pageEvents)).not.toContain("/Users/owner");
    expect(JSON.stringify(eventsOf(ledger, artifactId, "review.crop.captured"))).toContain(
      "/Users/owner",
    );
  });

  it("shows every thread under names, by key and display name", () => {
    const { interaction, person, page } = setup({ manifest: { team: { visibility: "names" } } });
    const ada = person("ada");
    const bo = person("bo");
    start(interaction, page(ada), ada.viewId, "Ada's note");
    const seen = interaction.reviewThreads(page(bo), bo.viewId);
    expect(seen.threads).toHaveLength(1);
    expect(seen.threads[0]?.messages[0]?.author).toMatchObject({ name: "ADA", self: false });
    expect(seen.people.map((entry) => entry.name)).toContain("ADA");
  });
});

describe("mentions (CO-06)", () => {
  it("raises one host-only event per mentioned viewer per comment, naming them", () => {
    const { interaction, owner, person, page, ledger, artifactId } = setup();
    const bo = person("bo");
    const cy = person("cy");
    // Bo and Cy each start a thread, so the owner may mention them.
    start(interaction, page(bo), bo.viewId, "Bo's");
    start(interaction, page(cy), cy.viewId, "Cy's");
    const people = interaction.reviewThreads(page(owner), owner.viewId).people;
    const keys = people.map((entry) => ({ key: entry.key }));
    expect(people.map((entry) => entry.name).sort()).toEqual(["BO", "CY"]);
    // The same person twice is mentioned once.
    start(interaction, page(owner), owner.viewId, "@BO @CY @BO", {
      mentions: [...keys, keys[0] as { key: string }],
    });
    const events = eventsOf(ledger, artifactId, "review.mentioned");
    expect(events).toHaveLength(2);
    const named = events.map((event) => event.payload["mentioned"] as Record<string, unknown>);
    expect(named.map((entry) => entry["ref"]).sort()).toEqual(["bo", "cy"]);
    expect(named.map((entry) => entry["viewerId"]).sort()).toEqual(
      [bo.viewerId, cy.viewerId].sort(),
    );
    // Pages never hear of it, the mentioned person's included.
    const seen = interaction.pageEvents(page(bo), 0, 1000).events.map((event) => event.type);
    expect(seen).not.toContain("review.mentioned");
    // A key the page may not mention (itself, or nobody it knows) is refused, and nothing is kept.
    expect(
      codeOf(() =>
        start(interaction, page(bo), bo.viewId, "@me", {
          mentions: [{ key: peerKey(artifactId, bo.viewerId) }],
        }),
      ),
    ).toBe("MOSTRA_REVIEW_MENTION_UNKNOWN");
  });
});

describe("threads in submissions (RV-03, RV-05)", () => {
  it("keeps a submission inside its bounds however long the threads it carries (finding 4)", () => {
    const { interaction, owner, page, person, ledger, artifactId } = setup();
    const bo = person("bo");
    const long = "x".repeat(9_500);
    const threads: string[] = [];
    for (let thread = 0; thread < 10; thread += 1) {
      const made = start(interaction, page(bo), bo.viewId, `Bo's thread ${thread}`);
      threads.push(made.id);
      // Two replies through the interaction core, the rest written in one transaction, as the
      // ledger would hold them: 4,800 separate commits at synchronous=FULL take minutes on a slow
      // runner (Windows arm64), and the path a reply takes is proven by the replies above.
      for (let reply = 0; reply < 2; reply += 1) {
        interaction.replyThread(page(bo), made.id, {
          viewId: bo.viewId,
          commentId: CommentId.create(),
          text: long,
        });
      }
      ledger.write((db) => {
        for (let reply = 2; reply < 480; reply += 1) {
          db.run(
            "INSERT INTO comment (id, thread_id, author_viewer_id, text, mentions_json, at) VALUES (?, ?, ?, ?, NULL, ?)",
            CommentId.create(),
            made.id,
            bo.viewerId,
            long,
            new Date(Date.now() + reply).toISOString(),
          );
        }
      });
      // The owner writes once in each, so each is theirs to carry.
      interaction.replyThread(page(owner), made.id, {
        viewId: owner.viewId,
        commentId: CommentId.create(),
        text: `Owner's answer ${thread}`,
      });
    }
    // About 46 MB of comments: the submit is made all the same.
    const submission = interaction.submit(page(owner), {
      viewId: owner.viewId,
      expectedRevision: 0,
      channel: "shell",
    });
    const results = interaction.resultsOf(submission.id);
    expect(results?.comments).toHaveLength(10);
    for (const comment of results?.comments ?? []) {
      // The owner's own message stays, with the newest 50 of Bo's, and the rest is counted.
      expect(comment.messages.some((message) => message.text.startsWith("Owner's answer"))).toBe(
        true,
      );
      expect(comment.messages).toHaveLength(51);
      expect(comment.messagesOmitted).toBe(431);
    }
    // A smaller budget gives way message by message first: every thread, fewer of Bo's messages.
    const trimmed = ledger.read((db) => snapshotThreads(db, artifactId, owner.viewerId, 1_200_000));
    expect(trimmed.threads).toHaveLength(10);
    expect(trimmed.threadsOmitted).toBeUndefined();
    expect(
      trimmed.threads.reduce((sum, thread) => sum + (thread.messagesOmitted ?? 0), 0),
    ).toBeGreaterThan(4_310);
    expect(
      trimmed.threads.every((thread) =>
        thread.messages.some((message) => message.author.id === owner.viewerId),
      ),
    ).toBe(true);
    // One that fits fewer threads counts the ones it leaves out, and never refuses.
    const small = ledger.read((db) => snapshotThreads(db, artifactId, owner.viewerId, 3_000));
    expect(small.threads.length).toBeGreaterThan(0);
    expect(small.threads.length + (small.threadsOmitted ?? 0)).toBe(10);
    expect(small.threadsOmitted ?? 0).toBeGreaterThan(0);
    expect(
      small.threads.every((thread) => thread.messages.some((m) => m.author.id === owner.viewerId)),
    ).toBe(true);
  }, 120_000);

  it("carries the viewer's threads, their crops and messages into results and Markdown", async () => {
    const { interaction, owner, page, versionId } = setup();
    const made = start(interaction, page(owner), owner.viewId, "Make it `bold`\n## not a heading");
    interaction.setCrop(made.id, {
      kind: "captured",
      blob: "c".repeat(64),
      width: 528,
      height: 140,
      source: "capture",
    });
    // A crop is set once.
    interaction.setCrop(made.id, { kind: "failed", reason: "late" });
    expect(interaction.threadCrop(page(owner), made.id)).toEqual({ blob: "c".repeat(64) });
    const submission = interaction.submit(page(owner), {
      viewId: owner.viewId,
      expectedRevision: 0,
      channel: "shell",
    });
    const results = interaction.resultsOf(submission.id);
    expect(results?.comments).toHaveLength(1);
    expect(results?.comments[0]).toMatchObject({
      threadId: made.id,
      status: "open",
      anchor: { reviewId: "header.title", candidateId: "airy", page: "/" },
      crop: { path: `blobs/${"c".repeat(64)}.png`, width: 528, height: 140, state: "captured" },
    });
    expect(results?.comments[0]?.versionId).toBeUndefined();
    expect(results?.submission.versionId).toBe(versionId);
    const method = interaction.methods().find((entry) => entry.definition.method === "results/get");
    const md = (await method?.handle(
      { artifact: { artifactId: page(owner).artifactId }, submission: submission.id, format: "md" },
      {} as Session,
    )) as { markdown: string };
    const lines = md.markdown.split("\n");
    const at = lines.indexOf("## Comments");
    expect(lines[at + 1]).toContain(`Thread ${made.id} (open), crop `);
    expect(md.markdown).toContain("review ID `header.title`");
    // The viewer's text stays data: no heading is forged.
    expect(lines.filter((line) => line === "## not a heading")).toEqual([]);
    // Under `once` the closed draft takes no more comments.
    expect(codeOf(() => start(interaction, page(owner), owner.viewId, "late"))).toBe(
      "MOSTRA_SUBMIT_ALREADY",
    );
    // The thread is still listed to the page, read-only.
    expect(interaction.reviewThreads(page(owner), owner.viewId)).toMatchObject({ writable: false });
  });

  it("lists pending crops, and a submission records a crop still pending as pending", () => {
    const { interaction, owner, page } = setup();
    const made = start(interaction, page(owner), owner.viewId, "pending");
    expect(interaction.pendingCrops().map((job) => job.threadId)).toEqual([made.id]);
    expect(interaction.pendingCropsOf(page(owner).artifactId, owner.viewerId)).toEqual([made.id]);
    const submission = interaction.submit(page(owner), {
      viewId: owner.viewId,
      expectedRevision: 0,
      channel: "shell",
    });
    expect(interaction.resultsOf(submission.id)?.comments[0]?.crop).toEqual({
      path: "",
      width: 0,
      height: 0,
      state: "pending",
    });
  });
});

describe("the ledger keeps review rows as written (migration 20)", () => {
  it("refuses changing a comment, a thread's anchor, a crop once set, and deleting either", () => {
    const { interaction, owner, page, ledger } = setup();
    const made = start(interaction, page(owner), owner.viewId, "kept");
    const write =
      (sql: string, ...params: string[]) =>
      () =>
        ledger.write((db) => db.run(sql, ...params));
    expect(write("UPDATE comment SET text = 'changed'")).toThrow(/written once/);
    expect(write("DELETE FROM comment")).toThrow(/never deleted/);
    expect(write("UPDATE thread SET anchor_json = '{}'")).toThrow(/never change/);
    expect(write("DELETE FROM thread")).toThrow(/never deleted/);
    interaction.setCrop(made.id, { kind: "failed", reason: "no browser" });
    expect(
      write("UPDATE thread SET crop_state = 'pending', crop_error = NULL WHERE id = ?", made.id),
    ).toThrow(/set once/);
    // The status may change, as resolving a thread does.
    expect(write("UPDATE thread SET status = 'resolved' WHERE id = ?", made.id)).not.toThrow();
  });
});

describe("the reviews port (HO-11)", () => {
  it("mirrors each thread change and each choice, best effort, never as a submission", async () => {
    const { interaction, owner, page, hosts } = setup();
    hosts.registered = [{ session: 7, owner: "host", ports: ["reviews"] }];
    hosts.answer = async () => {
      throw new Error("the host failed");
    };
    const made = start(interaction, page(owner), owner.viewId, "mirrored");
    await until(() => hosts.calls.some((call) => call.method === "port/reviews.mirror"));
    const thread = hosts.calls.find((call) => call.method === "port/reviews.mirror");
    expect(thread?.params).toMatchObject({
      kind: "thread",
      viewerId: owner.viewerId,
      thread: { threadId: made.id, messages: [{ text: "mirrored" }] },
    });
    interaction.choose(page(owner), {
      viewId: owner.viewId,
      mutationId: MutationId.create(),
      baseRevision: 0,
      reviewSetId: "sidebar",
      candidateId: "airy",
      label: "Airy",
    });
    await until(() =>
      hosts.calls.some(
        (call) => call.method === "port/reviews.mirror" && call.params["kind"] === "choice",
      ),
    );
    const choice = hosts.calls.find((call) => call.params["kind"] === "choice");
    expect(choice?.params).toMatchObject({
      reviewSetId: "sidebar",
      candidateId: "airy",
      label: "Airy",
    });
    // A failed mirror is never retried.
    const before = hosts.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hosts.calls.length).toBe(before);
    expect(hosts.calls.some((call) => call.method === "port/submissions.deliver")).toBe(false);
  });
});
