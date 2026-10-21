/**
 * The interaction model a host builds on: submission policies, events with durable cursors,
 * signals, waits, artifact state, complete results, idempotent requests and durability across
 * restarts (IN-07 to IN-10, LL-02, H-02, H-03, H-06 to H-10).
 */
import { FORM, FORM_V2 } from "../fixtures.ts";
import { codeOf } from "../harness/client.ts";
import { check, type Scenario, same } from "../scenario.ts";
import type { Viewer } from "../viewer.ts";

/** Answers and submits on whichever channel the view allows. */
async function answerAndSubmit(viewer: Viewer, fields: Record<string, unknown>) {
  return viewer.answer(
    fields,
    viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell",
  );
}

async function code(answer: { json<T>(): T }): Promise<string | undefined> {
  return answer.json<{ code?: string }>().code;
}

/** IN-07, H-02, LL-02: every submission policy, decided by the host at publish. */
export const policies: Scenario = {
  id: "interaction.policies",
  title:
    "once per artifact answers a second submit with MOSTRA_SUBMIT_ALREADY and the existing submission; once per viewer, epochs and none behave as specified",
  covers: ["HO-05", "IN-07", "LL-02", "H-02"],
  async run(context) {
    await context.start();
    // once, per artifact (the default)
    const once = await context.published(FORM, { policy: { policy: "once" } });
    const first = await context.viewer(once.artifactId);
    const accepted = await answerAndSubmit(first, { name: "Ada" });
    same(accepted.status, 200, "the first submit under once");
    const second = await context.viewer(once.artifactId);
    const conflict = await answerAndSubmit(second, { name: "Grace" });
    check(conflict.status === 409, `a second submit under once answered ${conflict.status}`);
    same(await code(conflict), "MOSTRA_SUBMIT_ALREADY", "a second submit's code");
    same(
      conflict.json<{ submission?: { id: string } }>().submission?.id,
      accepted.json<{ id: string }>().id,
      "the existing submission carried beside the conflict",
    );
    // once, per viewer: each person once.
    const survey = await context.published(FORM, {
      policy: { policy: "once", scope: "per-viewer" },
    });
    for (const ref of ["ada@example.com", "grace@example.com"]) {
      const person = await context.viewer(survey.artifactId, { link: { viewer: { ref } } });
      same((await answerAndSubmit(person, { name: ref })).status, 200, `${ref}'s submit`);
    }
    const again = await context.viewer(survey.artifactId, {
      link: { viewer: { ref: "ada@example.com" } },
    });
    same(
      await code(await answerAndSubmit(again, { name: "again" })),
      "MOSTRA_SUBMIT_ALREADY",
      "a person's second submit",
    );
    // epochs: rounds linked to each other.
    const rounds = await context.published(FORM, { policy: { policy: "epochs" } });
    const person = await context.viewer(rounds.artifactId, { link: { viewer: { ref: "ada" } } });
    const one = (await answerAndSubmit(person, { name: "round 1" })).json<{
      id: string;
      epoch: number;
    }>();
    const written = await person.write({ name: "round 2" }, { baseRevision: "1" });
    const revision = written.json<{ revision: string }>().revision;
    const twoAnswer = await (person.ticket.submitChannels.includes("artifact")
      ? person.submit(revision)
      : person.shellSubmit(revision));
    same(twoAnswer.status, 200, "the second round's submit");
    const two = twoAnswer.json<{ id: string; epoch: number }>();
    same([one.epoch, two.epoch], [1, 2], "the rounds' epochs");
    const results = await context.results(rounds.artifactId, two.id);
    same(results.submission.previous, one.id, "the second round's previous submission");
    // none: no submission at all.
    const board = await context.published(FORM, { policy: { policy: "none" } });
    const viewer = await context.viewer(board.artifactId);
    same(viewer.ticket.policy.policy, "none", "the view's policy");
    same(
      await code(await answerAndSubmit(viewer, { name: "x" })),
      "MOSTRA_SUBMIT_POLICY_NONE",
      "a submit under none",
    );
    const wait = await context.host
      .call("wait", {
        artifact: { artifactId: board.artifactId },
        until: "submitted",
        timeoutMs: 0,
      })
      .then(
        () => undefined,
        (error: unknown) => codeOf(error),
      );
    same(wait, "MOSTRA_SUBMIT_POLICY_NONE", "wait --until submitted under none");
  },
};

/** IN-08, H-09: a named, filtered subscription resumes after what it acknowledged, restarts included. */
export const subscriptions: Scenario = {
  id: "events.subscription",
  title:
    "A host's named, filtered event stream sees only the types it asked for, in cursor order, and resumes after its acknowledged cursor across an instance restart",
  covers: ["HO-01", "HO-05", "IN-08", "H-09"],
  needs: ["events"],
  async run(context) {
    await context.start();
    const name = "conformance-host";
    const filter = { types: ["submission.created"] };
    // A new name starts now: nothing earlier is read.
    same(
      (await context.host.events({ name, filter, pages: 1, timeoutMs: 500 })).pages.length,
      0,
      "pages for a new name",
    );
    const submit = async (who: string): Promise<string> => {
      const receipt = await context.published(FORM);
      const viewer = await context.viewer(receipt.artifactId);
      return (await answerAndSubmit(viewer, { name: who })).json<{ id: string }>().id;
    };
    const first = await submit("Ada");
    const read = await context.host.events({ name, filter, pages: 1, timeoutMs: 10_000 });
    const events = read.pages.flatMap((page) => page.events);
    same(
      events.map((event) => event.type),
      ["submission.created"],
      "the filtered stream's events",
    );
    same(
      (events[0]?.["payload"] as { submissionId?: string } | undefined)?.submissionId,
      first,
      "the submission it names",
    );
    await context.restart();
    const second = await submit("Grace");
    const resumed = await context.host.events({ name, filter, pages: 1, timeoutMs: 10_000 });
    const after = resumed.pages.flatMap((page) => page.events);
    same(
      after.map((event) => (event["payload"] as { submissionId?: string }).submissionId),
      [second],
      "the resumed stream: the next submission, no repeat, no gap",
    );
    const cursors = [...events, ...after].map((event) => BigInt(event.cursor));
    check(
      cursors.every((cursor, i) => i === 0 || cursor > (cursors[i - 1] as bigint)),
      "cursors in order",
    );
  },
};

/** IN-09: signals are events; Mostra wakes nobody. */
export const signals: Scenario = {
  id: "events.signals",
  title:
    "A page's signal and every submit appear as signal.raised events the host filters; Mostra calls no port and wakes nobody for them",
  covers: ["HO-05", "IN-09", "H-09"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const before = await context.store();
    same((await viewer.signal("ping", { n: 1 })).status, 200, "a page's signal");
    const raised = await context.events({
      artifacts: [receipt.artifactId],
      types: ["signal.raised"],
    });
    const ping = raised.events.find((event) => event.payload?.["name"] === "ping");
    check(ping, "no signal.raised for the page's signal");
    same(ping.payload["source"], "artifact", "the signal's source");
    same(ping.payload["payload"], { n: 1 }, "the signal's payload");
    const after = await context.store();
    same(after.deliveries.length, before.deliveries.length, "deliveries a signal caused");
    same(after.drafts.length, before.drafts.length, "draft mirrors a signal caused");
    same((await answerAndSubmit(viewer, { name: "Ada" })).status, 200, "the submit");
    const all = await context.events({ artifacts: [receipt.artifactId], types: ["signal.*"] });
    check(
      all.events.some((event) => event.payload?.["name"] === "submit"),
      "a submit raises no signal.raised named submit (D106)",
    );
  },
};

/** IN-10: waits are level- or edge-triggered as specified, and a timeout loses nothing. */
export const waits: Scenario = {
  id: "interaction.wait",
  title:
    "wait returns still_waiting with a cursor on timeout and loses nothing; signal and state waits are edge-triggered after the cursor; submitted is level-triggered under once",
  covers: ["HO-05", "IN-10"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const artifact = { artifactId: receipt.artifactId };
    const timedOut = await context.host.call<{ status: string; cursor: string }>("wait", {
      artifact,
      until: "signal:ping",
      timeoutMs: 0,
    });
    same(timedOut.status, "still_waiting", "a wait that times out");
    const viewer = await context.viewer(receipt.artifactId);
    await viewer.signal("ping");
    const caught = await context.host.call<{ status: string; cursor: string }>("wait", {
      artifact,
      until: "signal:ping",
      after: timedOut.cursor,
      timeoutMs: 10_000,
    });
    same(caught.status, "satisfied", "a wait after the cursor of a timed-out wait");
    const edge = await context.host.call<{ status: string }>("wait", {
      artifact,
      until: "signal:ping",
      after: caught.cursor,
      timeoutMs: 0,
    });
    same(edge.status, "still_waiting", "the same signal waited for after its own cursor");
    const state = context.host.call<{ status: string }>("wait", {
      artifact,
      until: "state:done",
      after: caught.cursor,
      timeoutMs: 15_000,
    });
    await context.host.call("state/patch", {
      artifact,
      ops: [{ id: "done", value: true }],
      mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XC",
      as: "host",
    });
    same((await state).status, "satisfied", "a state wait when the host sets the field");
    await answerAndSubmit(viewer, { name: "Ada" });
    const level = await context.host.call<{ status: string; cursor: string }>("wait", {
      artifact,
      until: "submitted",
      timeoutMs: 0,
    });
    same(level.status, "satisfied", "submitted, after the fact, under once (level-triggered)");
    const levelAfter = await context.host.call<{ status: string }>("wait", {
      artifact,
      until: "submitted",
      after: level.cursor,
      timeoutMs: 0,
    });
    same(levelAfter.status, "satisfied", "submitted after a later cursor, under once per artifact");
  },
};

/** LL-02 and D63: artifact state shared by viewers and the host, with conflicts on both sides. */
export const longLived: Scenario = {
  id: "interaction.long-lived-state",
  title:
    "Under policy none, viewers and the host share artifact state through compare-and-set: an overlapping write is a conflict on either side, and every change is a state.changed event",
  covers: ["HO-05", "LL-02", "IN-07"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM, { policy: { policy: "none" } });
    const artifact = { artifactId: receipt.artifactId };
    const hostWrite = await context.host.call<{ revision: string }>("state/patch", {
      artifact,
      ops: [{ id: "count", value: 1 }],
      mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XD",
      as: "host",
    });
    const viewer = await context.viewer(receipt.artifactId);
    const stale = await viewer.write({ count: 5 }, { scope: "artifact", baseRevision: "0" });
    same(stale.status, 200, "a stale viewer write's status");
    const conflicts = stale.json<{ conflicts: { id: string }[] }>().conflicts;
    same(
      conflicts.map((conflict) => conflict.id),
      ["count"],
      "the viewer's conflicts",
    );
    const fresh = await viewer.write(
      { count: 2 },
      { scope: "artifact", baseRevision: hostWrite.revision },
    );
    const freshRevision = fresh.json<{ revision: string; conflicts: unknown[] }>();
    same(freshRevision.conflicts, [], "a viewer write on the current revision");
    const hostStale = await context.host.call<{ conflicts: { id: string }[] }>("state/patch", {
      artifact,
      ops: [{ id: "count", value: 9 }],
      baseRevision: hostWrite.revision,
      mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XE",
      as: "host",
    });
    same(
      hostStale.conflicts.map((conflict) => conflict.id),
      ["count"],
      "the host's conflicts on a field a viewer changed",
    );
    const state = await context.host.call<{ fields: Record<string, { value: unknown }> }>(
      "state/get",
      {
        artifact,
      },
    );
    same(state.fields["count"]?.value, 2, "the shared state");
    const changed = await context.events({
      artifacts: [receipt.artifactId],
      types: ["state.changed"],
    });
    same(changed.events.length, 2, "state.changed events (one per applied write)");
  },
};

/** H-06, H-08, H-10: results name exactly what the viewer saw, stale views flagged. */
export const results: Scenario = {
  id: "interaction.results",
  title:
    "results/get returns the complete submission: metadata, answers with labels, the exact version and view, a stale view flagged with the newer version, and Markdown",
  covers: ["HO-05", "IN-11", "H-06", "H-08", "H-10"],
  async run(context) {
    await context.start();
    const v1 = await context.published(FORM);
    const viewer = await context.viewer(v1.artifactId);
    context.rewrite(v1.dir, FORM_V2);
    const v2 = await context.publish(v1.dir);
    same(v2.version, 2, "the second version's number");
    const submitted = await viewer.answer(
      { name: "Ada", comment: "on the first version" },
      viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell",
      { name: "Your name", comment: "Comment" },
    );
    same(submitted.status, 200, "a submit from the older view");
    const read = await context.results(v1.artifactId);
    same(read.artifact.family, "questionnaire", "the artifact's family");
    same(read.artifact.links, [{ rel: "round-of", artifact: "conformance-round-1" }], "its links");
    const submission = read.submission;
    same(
      [submission.versionId, submission.version],
      [v1.versionId, 1],
      "the version the viewer saw",
    );
    same(submission.viewId, viewer.viewId, "the view");
    same(
      [submission.staleView, submission.latestVersion],
      [true, 2],
      "the stale view and the newer version",
    );
    same(read.answers, { name: "Ada", comment: "on the first version" }, "the answers");
    check(
      read.fields.some((field) => field.id === "name" && field.label === "Your name"),
      "the answers' labels",
    );
    const markdown = await context.host.call<{ markdown: string }>("results/get", {
      artifact: { artifactId: v1.artifactId },
      format: "md",
    });
    check(markdown.markdown.includes("Your name"), "the Markdown results name answers by label");
  },
};

/** H-03: request IDs make retries converge; the same ID for another request is refused. */
export const idempotency: Scenario = {
  id: "interaction.request-ids",
  title:
    "A retried request with the same requestId or mutationId returns the recorded result; the same ID with other parameters is refused",
  covers: ["HO-05", "H-03"],
  async run(context) {
    await context.start();
    const dir = context.author(FORM);
    const first = await context.publish(dir, { requestId: "req-publish-1" });
    const retried = await context.publish(dir, { requestId: "req-publish-1" });
    same(retried, first, "a retried publish's receipt");
    const reused = await context
      .publish(dir, { requestId: "req-publish-1", policy: { policy: "epochs" } })
      .then(
        () => undefined,
        (error: unknown) => codeOf(error),
      );
    same(reused, "MOSTRA_HOST_REQUEST_ID_REUSED", "a request ID reused with other parameters");
    const patch = {
      artifact: { artifactId: first.artifactId },
      ops: [{ id: "count", value: 3 }],
      mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XF",
      as: "host",
    };
    const once = await context.host.call("state/patch", patch);
    const twice = await context.host.call("state/patch", patch);
    same(twice, once, "a retried state/patch");
    const link = { artifact: { artifactId: first.artifactId }, requestId: "req-link-1" };
    same(
      (await context.host.call<{ url: string }>("view/url", link)).url,
      (await context.host.call<{ url: string }>("view/url", link)).url,
      "a retried view/url",
    );
  },
};

/** Durability: what Mostra acknowledged survives the instance stopping and starting again. */
export const durability: Scenario = {
  id: "interaction.durability",
  title:
    "Everything acknowledged (versions, drafts, state, submissions, events) survives the instance stopping and starting again",
  covers: ["HO-05", "IN-12", "H-04"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    await viewer.write({ comment: "a draft only" });
    await context.host.call("state/patch", {
      artifact: { artifactId: receipt.artifactId },
      ops: [{ id: "count", value: 7 }],
      mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XG",
      as: "host",
    });
    const submitter = await context.viewer(receipt.artifactId, {
      link: { viewer: { ref: "ada" } },
    });
    same((await answerAndSubmit(submitter, { name: "Ada" })).status, 200, "the submit");
    const before = await context.results(receipt.artifactId);
    const eventsBefore = await context.events({ artifacts: [receipt.artifactId] });
    await context.restart();
    const after = await context.results(receipt.artifactId);
    same(
      after.submission.digest,
      before.submission.digest,
      "the submission's digest after a restart",
    );
    const state = await context.host.call<{ fields: Record<string, { value: unknown }> }>(
      "state/get",
      {
        artifact: { artifactId: receipt.artifactId },
      },
    );
    same(state.fields["count"]?.value, 7, "artifact state after a restart");
    const eventsAfter = await context.events({ artifacts: [receipt.artifactId] });
    same(
      eventsAfter.events.slice(0, eventsBefore.events.length).map((event) => event.cursor),
      eventsBefore.events.map((event) => event.cursor),
      "the event log after a restart",
    );
    // The viewer's draft is still the canonical one: the same link continues it.
    const poll = await viewer.poll();
    same(
      poll.json<{ snapshot?: { draft?: { fields?: Record<string, { value: unknown }> } } }>()
        .snapshot?.draft?.fields?.["comment"]?.value,
      "a draft only",
      "the viewer's draft after a restart",
    );
  },
};

/** The interaction scenarios. */
export const INTERACTION_SCENARIOS: readonly Scenario[] = [
  policies,
  subscriptions,
  signals,
  waits,
  longLived,
  results,
  idempotency,
  durability,
];
