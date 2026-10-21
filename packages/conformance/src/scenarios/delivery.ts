/**
 * Submissions reaching the host: durable first, delivered whole, once in effect across crashes,
 * retried while the host can't take them, replayed in order when it returns, and never confused
 * with draft mirrors (IN-06, IN-12, H-01, H-03, H-04, H-08).
 */
import { FORM } from "../fixtures.ts";
import { check, connectSocket, type Scenario, type ScenarioContext, same } from "../scenario.ts";

/** Publishes the form, answers it and submits on the artifact channel; the submission's ID. */
async function submitForm(
  context: ScenarioContext,
  fields: Record<string, unknown> = { name: "Ada", comment: "Looks good" },
): Promise<{ artifactId: string; submissionId: string }> {
  const receipt = await context.published(FORM);
  const viewer = await context.viewer(receipt.artifactId);
  const answer = await viewer.answer(
    fields,
    viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell",
  );
  same(answer.status, 200, `the submit's status (${answer.body})`);
  return { artifactId: receipt.artifactId, submissionId: answer.json<{ id: string }>().id };
}

/** H-01, H-08: the host receives the whole submission once, and Mostra's record agrees. */
export const delivered: Scenario = {
  id: "delivery.submission",
  title:
    "A submission is durable before delivery, reaches the host's submissions port once with the full results, and is readable through results/get",
  covers: ["HO-01", "HO-05", "IN-12", "H-01", "H-08"],
  async run(context) {
    await context.start();
    const { artifactId, submissionId } = await submitForm(context);
    // Durable at commit, whatever the delivery state (FAILURE_MODEL §4).
    const waited = await context.host.call<{ status: string }>("wait", {
      artifact: { artifactId },
      until: "submitted",
      timeoutMs: 0,
    });
    same(waited.status, "satisfied", "wait --until submitted right after the submit");
    if (context.host.serves("submissions")) {
      const stored = await context.eventually("the host's store holds the submission", async () =>
        (await context.store()).deliveries.find((entry) => entry.submissionId === submissionId),
      );
      same(stored.kind, "submission", "the envelope's kind");
      same(stored.stored, 1, "copies the host's store holds");
      check(stored.deliveryId.startsWith("dlv_"), `a delivery ID (${stored.deliveryId})`);
      const results = await context.eventually(
        "the delivery is recorded as delivered",
        async () => {
          const read = await context.results(artifactId);
          return read.submission.delivery === "delivered" ? read : undefined;
        },
      );
      same(results.submission.id, submissionId, "the submission results/get reads");
      same(results.answers, { name: "Ada", comment: "Looks good" }, "the answers");
    } else {
      // Standalone: Mostra's built-in adapter takes it at once (D58, D105).
      const results = await context.eventually("the built-in adapter accepts it", async () => {
        const read = await context.results(artifactId);
        return read.submission.delivery === "delivered" ? read : undefined;
      });
      same(results.answers, { name: "Ada", comment: "Looks good" }, "the answers");
    }
  },
};

/** H-03, IN-12: a crash after the host accepted redelivers the same delivery, stored once. */
export const exactlyOnce: Scenario = {
  id: "delivery.exactly-once",
  title:
    "When the instance dies after the host accepted a delivery but before recording it, the restarted instance redelivers the same deliveryId and the host stores it once",
  covers: ["HO-05", "IN-12", "H-03"],
  async run(context) {
    context.requirePort("submissions");
    // The instance kills itself between the host's answer and its record (FAILURE_MODEL §4).
    await context.start({ env: { MOSTRA_TEST_FAULTS: "deliver:after-answer:crash" } });
    const { artifactId, submissionId } = await submitForm(context);
    const first = await context.eventually("the host received the first attempt", async () =>
      (await context.store()).deliveries.find((entry) => entry.submissionId === submissionId),
    );
    await context.host.stopInstance().catch(() => undefined);
    await context.start();
    const after = await context.eventually("the restarted instance redelivers it", async () => {
      const entry = (await context.store()).deliveries.find(
        (candidate) => candidate.submissionId === submissionId,
      );
      return entry && entry.calls >= 2 ? entry : undefined;
    });
    same(after.deliveryId, first.deliveryId, "the redelivery's deliveryId");
    same(after.stored, 1, "copies the host's store holds after the redelivery");
    check(
      (after.attempts.at(-1) ?? 0) > (after.attempts[0] ?? 0),
      `the redelivery's attempt counts up (${after.attempts.join(", ")})`,
    );
    const results = await context.eventually("the delivery ends delivered", async () => {
      const read = await context.results(artifactId);
      return read.submission.delivery === "delivered" ? read : undefined;
    });
    same(results.submission.id, submissionId, "the submission");
  },
};

/** IN-12, H-04: a host that can't take a delivery gets it again with backoff; terminal is final. */
export const retry: Scenario = {
  id: "delivery.retry",
  title:
    "A delivery the host answers retry: true stays pending and arrives when the host can take it; an undeliverable answer is final and never retried",
  covers: ["HO-05", "IN-12", "H-04"],
  needs: ["faults"],
  async run(context) {
    context.requirePort("submissions");
    await context.start();
    await context.host.script({ port: "submissions", answer: "retry" });
    const { artifactId, submissionId } = await submitForm(context);
    await context.eventually("the delivery is pending while the host can't take it", async () => {
      const read = await context.results(artifactId);
      return read.submission.delivery === "pending" ? read : undefined;
    });
    const retrying = await context.events({
      artifacts: [artifactId],
      types: ["submission.retrying"],
    });
    check(
      retrying.events.length > 0,
      "no submission.retrying event while the delivery waits (IN-13)",
    );
    await context.host.script({ port: "submissions", answer: "accept" });
    await context.eventually(
      "the delivery arrives once the host can take it",
      async () =>
        (await context.store()).deliveries.find((entry) => entry.submissionId === submissionId),
      45_000,
    );
    await context.eventually("the delivery ends delivered", async () => {
      const read = await context.results(artifactId);
      return read.submission.delivery === "delivered" ? read : undefined;
    });
    // A terminal answer: undeliverable, shown, and never retried.
    await context.host.script({ port: "submissions", answer: "undeliverable" });
    const second = await submitForm(context, { name: "Grace" });
    await context.eventually("the delivery ends undeliverable", async () => {
      const read = await context.results(second.artifactId);
      return read.submission.delivery === "undeliverable" ? read : undefined;
    });
    await context.host.script({ port: "submissions", answer: "accept" });
    await new Promise((done) => setTimeout(done, 3000));
    const store = await context.store();
    check(
      !store.deliveries.some((entry) => entry.submissionId === second.submissionId),
      "an undeliverable delivery was retried",
    );
  },
};

/** IN-12, H-04: submissions made while the host is away wait for it and replay in order. */
export const outboxReplay: Scenario = {
  id: "delivery.outbox-replay",
  title:
    "Submissions made while the host is away stay pending in the outbox and replay in submission order, each with its deliveryId, when the host attaches again",
  covers: ["HO-05", "IN-12", "H-04"],
  needs: ["attach"],
  async run(context) {
    context.requirePort("submissions");
    await context.start({ mode: "attach" });
    const first = await context.published(FORM);
    const second = await context.published(FORM);
    // The viewers open their links while the host is there (a host that serves identity refuses
    // new links while it is away, D143), then the host goes away and its daemon keeps the home,
    // expecting the host back (D105).
    const viewers = [
      await context.viewer(first.artifactId),
      await context.viewer(second.artifactId),
    ];
    await context.host.stopInstance();
    const submissions: string[] = [];
    for (const viewer of viewers) {
      // A host that took the channel policy over gave these views the shell channel (D108).
      const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
      const answer = await viewer.answer({ name: `Ada ${submissions.length + 1}` }, channel);
      same(answer.status, 200, `a submit while the host is away (${answer.body})`);
      submissions.push(answer.json<{ id: string }>().id);
    }
    // A daemon that keeps the home while its host is away records where clients find it: no
    // record is a defect, never a reason to skip (Opus review of WP-12, finding 11).
    const socket = context.socket();
    check(socket, "the daemon kept the home but left no instance.json to find it by");
    const kit = await connectSocket(socket);
    await kit.initialize;
    const pending = (await kit.peer.request("results/get", {
      artifact: { artifactId: first.artifactId },
    })) as { submission: { delivery: string } };
    kit.close();
    same(pending.submission.delivery, "pending", "a delivery while its host is away");
    check(
      (await context.store()).deliveries.length === 0,
      "the host received a delivery while it was away",
    );
    await context.start({ mode: "attach" });
    const store = await context.eventually("both deliveries replay", async () => {
      const read = await context.store();
      return read.deliveries.length >= 2 ? read : undefined;
    });
    same(
      store.deliveries.map((entry) => entry.submissionId),
      submissions,
      "the replay's order (submission order)",
    );
    check(
      store.deliveries.every((entry) => entry.stored === 1),
      "a replayed delivery stored twice",
    );
    await context.host.stopInstance();
  },
};

/** IN-06: drafts reach the host only as mirrors labelled `draft`, never as submissions. */
export const draftMirrors: Scenario = {
  id: "drafts.mirror",
  title:
    "Draft revisions reach the host only through drafts.mirror, labelled kind: draft, and never through the submissions port",
  covers: ["HO-01", "HO-05", "IN-06", "H-01"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const written = await viewer.write({ name: "Ada" });
    same(written.status, 200, "a draft write");
    if (context.host.serves("drafts")) {
      const mirror = await context.eventually("the host receives the draft's mirror", async () =>
        (await context.store()).drafts.find((entry) => entry.artifactId === receipt.artifactId),
      );
      same(mirror.kind, "draft", "the mirror's kind");
    }
    const before = await context.store();
    check(
      before.deliveries.every((entry) => entry.kind === "submission") &&
        !before.deliveries.some((entry) => entry.artifactId === receipt.artifactId),
      "a draft reached the host as a delivery before any submit (IN-06)",
    );
    const { revision } = written.json<{ revision: string }>();
    const submitted = await (viewer.ticket.submitChannels.includes("artifact")
      ? viewer.submit(revision)
      : viewer.shellSubmit(revision));
    same(submitted.status, 200, "the submit");
    if (context.host.serves("submissions")) {
      await context.eventually("the submission arrives", async () =>
        (await context.store()).deliveries.find((entry) => entry.artifactId === receipt.artifactId),
      );
      const after = await context.store();
      const delivered = after.deliveries.filter((entry) => entry.artifactId === receipt.artifactId);
      same(delivered.length, 1, "deliveries for the artifact");
      check(
        after.deliveries.every((entry) => entry.kind === "submission"),
        "the host stores something that isn't a submission as one (IN-06)",
      );
    }
  },
};

/** The delivery scenarios. */
export const DELIVERY_SCENARIOS: readonly Scenario[] = [
  delivered,
  exactlyOnce,
  retry,
  outboxReplay,
  draftMirrors,
];
