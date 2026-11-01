/**
 * The host's ports, each with and without registration (HO-01): identity, addressing, trusted
 * controls, secrets, and what server code raises for the host (D108, D131, D143, D158, AC-05,
 * H-05, H-14).
 */
import { ACTIONS, FORM } from "../fixtures.ts";
import { check, type Scenario, type ScenarioContext, same, TUNNELS } from "../scenario.ts";
import { Browser, OpenError, resultOf, send, Viewer } from "../viewer.ts";

/** What `share/start` answers, as the scenarios read it. */
interface Shared {
  readonly shareId: string;
  readonly url: string;
  readonly tokenId: string;
  readonly mode: string;
}

/** The person the stand-in for Tailscale Serve names on every tailnet request (D158 item 2). */
const TAILNET_PERSON = { ref: "ada@example.com", name: "Ada Lövelace" };

/** Starts the host's instance with the stand-ins for `tailscale` and `cloudflared` (D158). */
function startWithTunnels(context: ScenarioContext): Promise<unknown> {
  return context.start({
    env: {
      MOSTRA_TEST_TUNNELS: TUNNELS,
      MOSTRA_FAKE_TAILNET_USER: `${TAILNET_PERSON.ref}|${TAILNET_PERSON.name}`,
    },
  });
}

/**
 * Opens a share of `artifactId` through `via`, answers on it, and returns the submission's viewer
 * with the identity calls the host saw meanwhile.
 */
async function answeredThrough(
  context: ScenarioContext,
  artifactId: string,
  via: "tailnet" | "cloudflare",
): Promise<{
  readonly shared: Shared;
  readonly viewer: { readonly kind: string; readonly ref?: string };
  readonly calls: Awaited<ReturnType<ScenarioContext["store"]>>["identity"];
}> {
  const before = context.host.serves("identity") ? (await context.store()).identity.length : 0;
  const shared = await context.host.call<Shared>(
    "share/start",
    { artifact: { artifactId }, via },
    120_000,
  );
  try {
    const viewer = await Viewer.open(shared.url);
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    same((await viewer.answer({ name: via }, channel)).status, 200, `the submit through ${via}`);
    const read = await context.results(artifactId);
    const calls = context.host.serves("identity")
      ? (await context.store()).identity.slice(before)
      : [];
    return { shared, viewer: read.submission.viewer, calls };
  } finally {
    await context.host.call("share/stop", { shareId: shared.shareId });
  }
}

/** D143: the identity port names the person behind a link minted without a viewer. */
export const identity: Scenario = {
  id: "ports.identity",
  title:
    "With an identity port, a link minted without a viewer acts as the person the host names from the request's headers (never its cookies); without one, as the home's local user",
  covers: ["HO-01", "HO-05", "H-05", "H-14"],
  async run(context) {
    await context.start();
    const receipt = await context.published(FORM, { policy: { policy: "epochs" } });
    // The exchange carries a cookie and a Mostra header, so the filter that keeps them from the
    // host is really tested (Opus review of WP-12, finding 9).
    const headers = {
      "x-forwarded-user": "ada@example.com",
      cookie: "elsewhere=1",
      "x-mostra-csrf": "not-for-the-host",
    };
    const viewer = await context.viewer(receipt.artifactId, { headers });
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    same((await viewer.answer({ name: "Ada" }, channel)).status, 200, "the submit");
    const read = await context.results(receipt.artifactId);
    if (!context.host.serves("identity")) {
      same(read.submission.viewer.kind, "local", "the viewer without an identity port");
      return;
    }
    const calls = (await context.store()).identity;
    const call = calls.at(-1);
    check(call, "the host's identity port was never asked");
    // The session acts as whoever the host named, in its own terms (D143 item 2): the kit judges
    // the session by the host's answer, not by any one way of naming people.
    check(
      call.answer !== undefined,
      "the host's store doesn't report what its identity port answered (harness/store)",
    );
    same(
      call.answer === null
        ? [read.submission.viewer.kind]
        : [read.submission.viewer.kind, read.submission.viewer.ref],
      call.answer === null ? ["local"] : ["host", call.answer.ref],
      "the submission's viewer, by the host's answer",
    );
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
    await sharedIdentity(context);
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

/**
 * D143 item 2, D158 item 2: through Tailscale Serve the identity port hears `via: "tailnet"` with
 * Serve's identity headers, and through a public share `via: "token"`; a host's answer names the
 * person, and without one the tailnet person, or the link itself, is the viewer, never the home's
 * local user.
 */
async function sharedIdentity(context: ScenarioContext): Promise<void> {
  await context.host.stopInstance();
  await startWithTunnels(context);
  const receipt = await context.published(FORM, { policy: { policy: "epochs" } });
  for (const via of ["tailnet", "cloudflare"] as const) {
    const { shared, viewer, calls } = await answeredThrough(context, receipt.artifactId, via);
    const call = calls.at(-1);
    const expected = via === "tailnet" ? "tailnet" : "token";
    if (call !== undefined) {
      same(call.via, expected, `how a request through ${via} reached the gateway`);
      if (via === "tailnet") {
        check(
          call.headers.includes("tailscale-user-login"),
          "the port didn't receive Tailscale Serve's identity headers",
        );
      }
    } else {
      check(!context.host.serves("identity"), `the identity port wasn't asked through ${via}`);
    }
    if (call?.answer) {
      same(
        [viewer.kind, viewer.ref],
        ["host", call.answer.ref],
        `the viewer the host named (${via})`,
      );
    } else if (via === "tailnet") {
      same([viewer.kind, viewer.ref], ["tailnet", TAILNET_PERSON.ref], "the tailnet person");
    } else {
      same(
        [viewer.kind, viewer.ref],
        ["token", `link:${shared.tokenId}`],
        "the public link's viewer",
      );
    }
  }
}

/**
 * HO-10, D158 item 6: a host's `addressing` port gives the external base of an artifact's links.
 * The base appears in the links Mostra mints and passes the Host and Origin checks, a frame on
 * another site enters in worker mode, a base the host withdraws stops working, and without the
 * port every link stays on loopback.
 */
export const addressing: Scenario = {
  id: "ports.addressing",
  title:
    "With an addressing port, the links Mostra mints use the host's external base, which passes the Host and Origin checks and opens a frame on another site in worker mode; a withdrawn base stops working; without the port, links stay on loopback",
  covers: ["HO-01", "HO-05", "HO-10", "HY-07", "H-14"],
  async run(context) {
    await context.start();
    // Epochs: the loopback link after the withdrawal answers again (a once artifact takes one).
    const receipt = await context.published(FORM, { policy: { policy: "epochs" } });
    const loopback = (link: string): boolean =>
      ["127.0.0.1", "[::1]"].includes(new URL(link).hostname);
    if (!context.host.serves("addressing")) {
      check(receipt.url !== undefined && loopback(receipt.url), "the publish receipt's link");
      check(loopback(await context.link(receipt.artifactId)), "a minted link without the port");
      return;
    }
    // A host that can be scripted puts the shell and the artifact on two sites (`localhost` and
    // `127.0.0.1` are as cross-site as two tunnel hostnames); any other host is judged by its own
    // answers.
    if (context.host.supports("faults")) {
      await context.host.script({
        port: "addressing",
        answer: { shellHost: "localhost", artifactHost: "127.0.0.1" },
      });
    }
    const link = await context.link(receipt.artifactId);
    const calls = (await context.store()).addressing ?? [];
    const asked = calls.filter(
      (call) => call.artifactId === receipt.artifactId && call.listener === "shell",
    );
    const answer = asked.at(-1)?.answer;
    check(asked.length > 0, "the host's addressing port wasn't asked for the link's base");
    if (!answer) {
      check(loopback(link), "a link whose host gave no base");
      return;
    }
    same(new URL(link).origin, answer.origin, "the minted link's base");
    const local = asked.at(-1)?.local as string;
    check(loopback(local), `the loopback origin the host forwards to (${local})`);
    const viewer = await Viewer.open(link);
    const frameBase = (await context.store()).addressing?.findLast(
      (call) => call.artifactId === receipt.artifactId && call.listener === "artifact",
    )?.answer;
    if (frameBase) {
      same(viewer.ticket.artifactOrigin, frameBase.origin, "the frame's base");
      const crossSite = new URL(frameBase.origin).hostname !== new URL(answer.origin).hostname;
      same(
        viewer.ticket.mode ?? "cookie",
        frameBase.mode ?? (crossSite ? "worker" : "cookie"),
        "the frame's session mode",
      );
    }
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    same((await viewer.answer({ name: "Ada" }, channel)).status, 200, "a submit at the base");
    const polled = await viewer.poll();
    same(polled.status, 200, "the page's long poll at the base");
    // The base passes the Host and Origin checks; another Host or Origin is refused.
    const parsed = new URL(link);
    const strangerHost = await send({
      url: `${parsed.origin}/a/${receipt.artifactId}`,
      headers: { host: `evil.example:${parsed.port}`, accept: "text/html" },
    });
    same(strangerHost.status, 421, "another Host at the base");
    const otherOrigin = await new Browser().ask({
      method: "POST",
      url: `${parsed.origin}/a/${receipt.artifactId}/_mostra/session`,
      headers: {
        origin: local,
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ token: new URLSearchParams(parsed.hash.slice(1)).get("t") }),
    });
    same(otherOrigin.status, 403, "an exchange from another origin");
    if (!context.host.supports("faults")) return;
    // The host withdraws its base: new links are on loopback, and the old one stops working.
    await context.host.script({ port: "addressing", answer: null });
    const after = await context.link(receipt.artifactId);
    check(loopback(after), `a link minted after the base was withdrawn (${after})`);
    const stale = await Viewer.open(link).then(
      () => "opened",
      (error: unknown) => (error instanceof OpenError ? error.status : "unreachable"),
    );
    check(stale !== "opened", "a link at a withdrawn base still opened");
    const reopened = await Viewer.open(after);
    same((await reopened.answer({ name: "Grace" }, channel)).status, 200, "a submit on loopback");
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
    // A host that can script its policy is asked for shell-only, the case hosts that need
    // provenance use (H-05); any other host is judged by the policy it answered itself.
    const scripted = context.host.supports("faults")
      ? { submitChannels: ["shell"], controls: ["submit"] }
      : undefined;
    if (scripted) await context.host.script({ port: "trustedControls", answer: scripted });
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const asked = (await context.store()).policies.find(
      (entry) => entry.artifactId === receipt.artifactId,
    );
    check(asked, "the host's policy wasn't asked when the view opened");
    const policy = scripted ?? asked.answer;
    check(
      policy,
      "the host's store doesn't report what its trustedControls policy answered (harness/store)",
    );
    same(
      [...viewer.ticket.submitChannels].sort(),
      [...policy.submitChannels].sort(),
      "the view's channels under the host's policy",
    );
    const written = await viewer.write({ name: "Ada" });
    const revision = written.json<{ revision: string }>().revision;
    const artifactAllowed = policy.submitChannels.includes("artifact");
    if (!artifactAllowed) {
      const denied = await viewer.submit(revision);
      same(
        [denied.status, denied.json<{ code?: string }>().code],
        [403, "MOSTRA_SUBMIT_CHANNEL_DENIED"],
        "the artifact channel's submit",
      );
    }
    if (!policy.submitChannels.includes("shell")) {
      // A host that allows the artifact channel alone: the page's submit is recorded as such.
      same((await viewer.submit(revision)).status, 200, "the artifact channel's submit");
      same(
        (await context.results(receipt.artifactId)).submission.channel,
        "artifact",
        "the recorded channel",
      );
      return;
    }
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
  addressing,
  trustedControls,
  secrets,
  serverEvents,
];
