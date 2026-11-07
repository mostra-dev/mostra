/**
 * A host whose instance shares to a remote server (WP-29, RM-02, RM-04; INTERFACES §18): the kit
 * runs the server, the host's instance signs in by the device grant and shares through the host's
 * own client, and the kit answers the hosted page as a respondent would. Hosted submissions reach
 * the host through its instance's local outbox, with H-04's guarantees, and a hosted page's
 * actions run on the host's instance, with its secrets, through the relay.
 */
import { ACTIONS, FORM } from "../fixtures.ts";
import { type RemoteServer, signIn, startRemoteServer } from "../remote.ts";
import { check, type Scenario, type ScenarioContext, same } from "../scenario.ts";
import { resultOf, Viewer } from "../viewer.ts";

/** Starts a server and the host's instance, signed in to it. */
async function linked(context: ScenarioContext): Promise<RemoteServer> {
  const server = await startRemoteServer(context);
  await context.start({ env: server.env });
  await signIn(context, server);
  return server;
}

/** Shares `artifactId` to the server through the host; the hosted link. */
async function hostedLink(
  context: ScenarioContext,
  artifactId: string,
  params: Record<string, unknown> = {},
): Promise<string> {
  const shared = await context.host.call<{ url: string; via: string }>(
    "share/start",
    { artifact: { artifactId }, via: "remote", ...params },
    120_000,
  );
  same(shared.via, "remote", "the share's way");
  return shared.url;
}

/** RM-02, H-04: a hosted page's answer reaches the host once, through its instance's outbox. */
export const hostedDelivery: Scenario = {
  id: "remote.delivery",
  title:
    "An answer on a hosted link is told only that it was sent, reaches the host's submissions port once through its instance's local outbox, and reads locally with wait and results/get",
  covers: ["RM-02", "HO-05", "IN-12", "IN-13", "H-04"],
  async run(context) {
    const server = await linked(context);
    const receipt = await context.published(FORM);
    const url = await hostedLink(context, receipt.artifactId);
    check(
      new URL(url).host === `content.localhost:${server.port}` && url.includes("/a/rte_"),
      `a hosted link on the user-content domain, by route (${new URL(url).origin}${new URL(url).pathname})`,
    );
    const viewer = await Viewer.open(url);
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    const answer = await viewer.answer({ name: "Ada", comment: "From the server" }, channel);
    same(answer.status, 200, `the hosted submit's status (${answer.body})`);
    const summary = answer.json<{ id: string; deliveries?: unknown }>();
    // A respondent sees that the answer was sent, never its delivery (D165 item 1a).
    same(summary.deliveries, undefined, "the delivery states a respondent is shown");
    const waited = await context.host.call<{ status: string }>(
      "wait",
      { artifact: { artifactId: receipt.artifactId }, until: "submitted", timeoutMs: 60_000 },
      70_000,
    );
    same(waited.status, "satisfied", "wait --until submitted on the host's instance");
    const results = await context.eventually("results/get reads the hosted answer", async () => {
      const read = await context.results(receipt.artifactId);
      return read.submission.id === summary.id ? read : undefined;
    });
    same(results.answers, { name: "Ada", comment: "From the server" }, "the answers");
    check(
      (results.submission as { origin?: unknown }).origin !== undefined,
      "the submission names the hosted home it came from",
    );
    if (context.host.serves("submissions")) {
      const stored = await context.eventually("the host's store holds the submission", async () =>
        (await context.store()).deliveries.find((entry) => entry.submissionId === summary.id),
      );
      same(stored.stored, 1, "copies the host's store holds");
      // Once in effect: the same answer isn't delivered again however long the host waits.
      await new Promise((done) => setTimeout(done, 2_000));
      const later = (await context.store()).deliveries.filter(
        (entry) => entry.submissionId === summary.id,
      );
      same(later.length, 1, "deliveries of the hosted answer");
      same(later[0]?.stored, 1, "copies after a while");
    }
  },
};

/** RM-04: a hosted page's action runs once on the host's instance, with its secret. */
export const hostedRelay: Scenario = {
  id: "remote.relay",
  title:
    "An action pressed on a hosted page runs on the host's instance with the instance's own secret, and what it raises reaches the host's events",
  covers: ["RM-04", "AC-05", "HO-05"],
  async run(context) {
    await linked(context);
    const receipt = await context.published(ACTIONS);
    await context.host.call("secret/set", {
      name: "MAIL_KEY",
      value: "k-0123456789",
      artifact: { artifactId: receipt.artifactId },
    });
    // A named respondent may trigger relayed actions by default (D159).
    const url = await hostedLink(context, receipt.artifactId, {
      viewer: { ref: "grace@example.com", name: "Grace" },
    });
    const viewer = await Viewer.open(url);
    const length = await viewer.run("actions.ts#secretLength", ["MAIL_KEY"]);
    same(length.status, "succeeded", "the relayed run's end");
    same(await resultOf(length), 12, "the secret's length, read on the host's instance");
    const notified = await viewer.run("actions.ts#notify", ["grace@example.com"]);
    same(notified.status, "succeeded", "the second relayed run's end");
    await context.eventually("the host's instance follows what the run raised", async () => {
      const read = await context.host.call<{ events: { type: string }[] }>("events/read", {
        filter: { artifacts: [receipt.artifactId], types: ["host.mail.sent"] },
      });
      return read.events.length === 1 ? read : undefined;
    });
  },
};

/** Every remote scenario. */
export const REMOTE_SCENARIOS: readonly Scenario[] = [hostedDelivery, hostedRelay];
