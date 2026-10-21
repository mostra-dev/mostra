/**
 * The host's ports, each with and without registration (HO-01): identity, trusted controls,
 * secrets, and what server code raises for the host (D108, D131, D143, AC-05, H-05, H-14).
 */
import { ACTIONS, FORM } from "../fixtures.ts";
import { check, type Scenario, same } from "../scenario.ts";
import { OpenError, resultOf } from "../viewer.ts";

/** D143: the identity port names the person behind a link minted without a viewer. */
export const identity: Scenario = {
  id: "ports.identity",
  title:
    "With an identity port, a link minted without a viewer acts as the person the host names from the request's headers (never its cookies); without one, as the home's local user",
  covers: ["HO-01", "HO-05", "H-05", "H-14"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM, { policy: { policy: "epochs" } });
    const headers = { "x-forwarded-user": "ada@example.com" };
    const viewer = await context.viewer(receipt.artifactId, { headers });
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    same((await viewer.answer({ name: "Ada" }, channel)).status, 200, "the submit");
    const read = await context.results(receipt.artifactId);
    if (!context.host.serves("identity")) {
      same(read.submission.viewer.kind, "local", "the viewer without an identity port");
      return;
    }
    same(
      [read.submission.viewer.kind, read.submission.viewer.ref],
      ["host", "ada@example.com"],
      "the person the host's identity port named",
    );
    const calls = (await context.store()).identity;
    const call = calls.at(-1);
    check(call, "the host's identity port was never asked");
    same(call.via, "local", "how the request reached the gateway");
    check(
      call.headers.includes("x-forwarded-user"),
      "the port didn't receive the request's headers",
    );
    check(
      !call.headers.some((name) => name === "cookie" || name.startsWith("x-mostra-")),
      `the port received Mostra's credentials (${call.headers.join(", ")})`,
    );
    // A link minted for a person keeps that person; the port isn't asked (D104).
    const minted = await context.viewer(receipt.artifactId, {
      link: { viewer: { ref: "grace@example.com", name: "Grace" } },
      headers,
    });
    same(
      (await context.store()).identity.length,
      calls.length,
      "identity calls for a link with a viewer",
    );
    same((await minted.answer({ name: "Grace" }, channel)).status, 200, "the minted link's submit");
    const graces = await context.results(receipt.artifactId);
    same(
      [graces.submission.viewer.kind, graces.submission.viewer.ref],
      ["token", "grace@example.com"],
      "the viewer a link was minted for",
    );
    if (context.host.supports("faults")) {
      // A host that can't answer refuses the link rather than guess (D143).
      await context.host.script({ port: "identity", answer: "fail" });
      const refused = await context.viewer(receipt.artifactId, { headers }).then(
        () => undefined,
        (error: unknown) => error,
      );
      check(refused instanceof OpenError, "a failing identity port still opened the link");
      same(
        [refused.status, refused.code],
        [503, "MOSTRA_HOST_IDENTITY_UNAVAILABLE"],
        "the refusal",
      );
      await context.host.script({ port: "identity", answer: null });
      const local = await context.viewer(receipt.artifactId, { headers });
      same(
        (await local.answer({ name: "local" }, channel)).status,
        200,
        "a submit as the local user",
      );
      same(
        (await context.results(receipt.artifactId)).submission.viewer.kind,
        "local",
        "a null answer's viewer",
      );
    }
  },
};

/** D108, H-05, SH-02: the host decides the channels; the artifact can't submit where it may not. */
export const trustedControls: Scenario = {
  id: "ports.trusted-controls",
  title:
    "The host's trustedControls policy decides each view's channels: the artifact channel is refused with MOSTRA_SUBMIT_CHANNEL_DENIED, the shell's trusted Submit records the shell channel, and the host hears it was used",
  covers: ["HO-01", "HO-05", "SH-02", "H-05"],
  async run(context) {
    await context.start();
    if (!context.host.serves("trustedControls")) {
      const receipt = await context.published(FORM);
      const viewer = await context.viewer(receipt.artifactId);
      same(
        [...viewer.ticket.submitChannels].sort(),
        ["artifact", "shell"],
        "the standalone channels (D40)",
      );
      same(
        (await viewer.answer({ name: "Ada" }, "artifact")).status,
        200,
        "an artifact-channel submit",
      );
      same(
        (await context.results(receipt.artifactId)).submission.channel,
        "artifact",
        "the recorded channel",
      );
      return;
    }
    if (context.host.supports("faults")) {
      await context.host.script({
        port: "trustedControls",
        answer: { submitChannels: ["shell"], controls: ["submit"] },
      });
    }
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    check(
      (await context.store()).policies.some((entry) => entry.artifactId === receipt.artifactId),
      "the host's policy wasn't asked when the view opened",
    );
    same(viewer.ticket.submitChannels, ["shell"], "the view's channels under the host's policy");
    const written = await viewer.write({ name: "Ada" });
    const revision = written.json<{ revision: string }>().revision;
    const denied = await viewer.submit(revision);
    same(
      [denied.status, denied.json<{ code?: string }>().code],
      [403, "MOSTRA_SUBMIT_CHANNEL_DENIED"],
      "the artifact channel's submit",
    );
    const trusted = await viewer.shellSubmit(revision);
    same(trusted.status, 200, "the shell's trusted Submit");
    same(
      (await context.results(receipt.artifactId)).submission.channel,
      "shell",
      "the recorded channel",
    );
    const activation = await context.eventually(
      "the host hears the trusted Submit was used",
      async () =>
        (await context.store()).activations.find(
          (entry) => entry.artifactId === receipt.artifactId,
        ),
    );
    same([activation.control, activation.viewId], ["submit", viewer.viewId], "the activation");
    if (context.host.supports("faults")) {
      // A policy that fails narrows the view to the shell channel (D108).
      await context.host.script({ port: "trustedControls", answer: "fail" });
      const other = await context.published(FORM);
      const narrowed = await context.viewer(other.artifactId);
      same(narrowed.ticket.submitChannels, ["shell"], "the channels when the host's policy fails");
    }
  },
};

/** D131: secret() asks the host first; the value never reaches events or results. */
export const secrets: Scenario = {
  id: "ports.secrets",
  title:
    "secret() in server code asks the host's secrets port first and falls back to the home's store on null; the value appears in no event",
  covers: ["HO-01", "HO-05"],
  async run(context) {
    await context.start();
    await context.host.call("secret/set", { name: "HOME_ONLY", value: "from-the-home-store" });
    const receipt = await context.published(ACTIONS);
    const viewer = await context.viewer(receipt.artifactId);
    const fromHome = await viewer.run("actions.ts#secretLength", ["HOME_ONLY"]);
    same(
      fromHome.status,
      "succeeded",
      `a run reading the home's secret (${JSON.stringify(fromHome["error"] ?? "")})`,
    );
    same(await resultOf(fromHome), "from-the-home-store".length, "the home secret's length");
    if (context.host.serves("secrets") && context.host.supports("faults")) {
      await context.host.script({ port: "secrets", answer: { API_KEY: "s3cret-from-the-host" } });
      const fromHost = await viewer.run("actions.ts#secretLength", ["API_KEY"]);
      same(await resultOf(fromHost), "s3cret-from-the-host".length, "the host secret's length");
      check(
        (await context.store()).secrets.some((entry) => entry.name === "API_KEY"),
        "the host's secrets port wasn't asked",
      );
      const events = await context.events({ artifacts: [receipt.artifactId] });
      check(
        !JSON.stringify(events).includes("s3cret-from-the-host"),
        "a secret reached the event log",
      );
    }
  },
};

/** AC-05, IN-09: server code's signals and host events reach the host as events, with the run. */
export const serverEvents: Scenario = {
  id: "ports.server-events",
  title:
    "An action's signal() and emit() reach the host as signal.raised (source action) and host.* events caused by the run; Mostra wakes nobody for them",
  covers: ["HO-05", "IN-09", "AC-05", "H-09"],
  async run(context) {
    await context.start();
    const receipt = await context.published(ACTIONS);
    const viewer = await context.viewer(receipt.artifactId);
    const before = await context.store();
    const run = await viewer.run("actions.ts#notify", ["ada@example.com"]);
    same(run.status, "succeeded", `the action run (${JSON.stringify(run["error"] ?? "")})`);
    const read = await context.events({
      artifacts: [receipt.artifactId],
      types: ["signal.raised", "host.*", "action.*"],
    });
    const types = read.events.map((event) => event.type as string);
    const signal = read.events.find((event) => event.type === "signal.raised");
    const emitted = read.events.find((event) => event.type === "host.mail.sent");
    check(signal && emitted, `the run's signal or host event is missing (${types.join(", ")})`);
    same([signal.payload["name"], signal.payload["source"]], ["mail.sent", "action"], "the signal");
    same(signal.causation?.["runId"], run.runId, "the signal's causing run");
    same(emitted.payload["data"], { to: "ada@example.com" }, "the host event's data");
    const started = types.indexOf("action.started");
    const ended = types.indexOf("action.succeeded");
    check(
      started >= 0 &&
        ended > types.indexOf("host.mail.sent") &&
        started < types.indexOf("signal.raised"),
      `the order of the run's events (${types.join(", ")})`,
    );
    const after = await context.store();
    same(after.deliveries.length, before.deliveries.length, "deliveries the run caused");
  },
};

/** The port scenarios. */
export const PORT_SCENARIOS: readonly Scenario[] = [
  identity,
  trustedControls,
  secrets,
  serverEvents,
];
