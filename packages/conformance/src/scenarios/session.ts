/**
 * The session, process models, the home and privacy: what every host gets right before anything
 * else (HO-02, HO-08, RT-06, H-11, H-12, H-13, H-16).
 */
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { HOST_PROTOCOL_REVISIONS } from "@mostra/protocol";
import { FORM } from "../fixtures.ts";
import { codeOf } from "../harness/client.ts";
import { check, connectSocket, rpcCode, type Scenario, same } from "../scenario.ts";
import { send } from "../viewer.ts";

/** The session: a revision both sides speak, every registered port supported, order enforced. */
export const negotiation: Scenario = {
  id: "session.negotiation",
  title:
    "The host negotiates a revision the instance speaks, registers only ports it supports, and an instance refuses a client with no common revision",
  covers: ["HO-02", "HO-05", "H-13", "H-15"],
  async run(context) {
    const started = await context.start();
    check(
      (HOST_PROTOCOL_REVISIONS as readonly string[]).includes(started.revision),
      `the negotiated revision ${started.revision} isn't one this kit knows (${HOST_PROTOCOL_REVISIONS.join(", ")})`,
    );
    const unsupported = started.warnings.filter(
      (warning) => warning.code === "MOSTRA_HOST_PORT_UNSUPPORTED",
    );
    check(
      unsupported.length === 0,
      "the host registers a port the instance doesn't support (MOSTRA_HOST_PORT_UNSUPPORTED)",
    );
    // mostra/initialize is sent once per connection; the host's client surfaces the refusal.
    const again = await context.host.callRaw("mostra/initialize", {
      client: { name: "again", version: "0" },
      revisions: [...HOST_PROTOCOL_REVISIONS],
      capabilities: {},
      ports: [],
    });
    check("error" in again, "a second mostra/initialize on the host's connection was accepted");
    same(again.error.data.code, "MOSTRA_HOST_INITIALIZE_ORDER", "a second initialize's code");
    // A client with no revision in common is refused with a typed error; one with any is served.
    const socket = context.socket();
    check(socket, "the instance's home has no instance.json naming its socket (D81)");
    const old = await connectSocket(socket, ["2020-01-01"]);
    const refused = await old.initialize.then(
      () => undefined,
      (error: unknown) => rpcCode(error),
    );
    old.close();
    same(refused, "MOSTRA_HOST_REVISION_UNSUPPORTED", "a client offering only 2020-01-01");
    const mixed = await connectSocket(socket, ["2020-01-01", ...HOST_PROTOCOL_REVISIONS]);
    const answer = (await mixed.initialize) as { revision: string };
    mixed.close();
    same(
      answer.revision,
      started.revision,
      "the revision negotiated with an older and a current one",
    );
  },
};

/** One supervisor per home: a second host of the same home meets the lock, attached ones share it. */
export const processModels: Scenario = {
  id: "session.process-models",
  title:
    "A host spawns its instance over stdio or attaches to the home's daemon; a second spawn of the same home is refused with MOSTRA_HOME_LOCKED",
  covers: ["HO-05", "RT-06", "H-12"],
  async run(context) {
    const second = await context.anotherHost();
    if (context.host.supports("attach")) {
      const first = await context.start({ mode: "attach" });
      same(first.instance.mode, "daemon", "an attached host's instance mode");
      const other = await context.start({ mode: "attach", host: second });
      same(other.instance.pid, first.instance.pid, "the daemon two attached hosts reach");
      const third = await context.anotherHost();
      const locked = await context.start({ host: third }).then(
        () => undefined,
        (error: unknown) => codeOf(error),
      );
      same(locked, "MOSTRA_HOME_LOCKED", "a spawn while the daemon owns the home");
      await second.stopInstance();
      await context.host.stopInstance();
      return;
    }
    const first = await context.start();
    same(first.instance.mode, "host", "a spawned instance's mode");
    same(first.instance.pid > 0, true, "the instance reports its PID");
    const locked = await context.start({ host: second }).then(
      () => undefined,
      (error: unknown) => codeOf(error),
    );
    same(locked, "MOSTRA_HOME_LOCKED", "a second spawn of the same home");
  },
};

/**
 * HO-08 and H-11: the host chooses the home, and what was published stays readable after the
 * authoring directory is removed and the instance restarts.
 */
export const authoringRemoved: Scenario = {
  id: "home.authoring-removed",
  title:
    "The host chooses the home; artifacts, versions and submissions stay readable after the authoring directory is removed",
  covers: ["HO-05", "HO-08", "H-11"],
  async run(context) {
    const started = await context.start();
    same(started.instance.home, realpathSync(context.home), "the home the instance owns");
    const receipt = await context.published(FORM);
    const viewer = await context.viewer(receipt.artifactId);
    const channel = viewer.ticket.submitChannels.includes("artifact") ? "artifact" : "shell";
    const submitted = await viewer.answer({ name: "Ada", comment: "kept" }, channel);
    same(submitted.status, 200, "the submit's status");
    const before = await context.results(receipt.artifactId);
    rmSync(receipt.dir, { recursive: true, force: true });
    await context.restart();
    const byId = await context.host.call<{ id: string; versions: { id: string }[] }>(
      "artifact/get",
      { artifact: { artifactId: receipt.artifactId } },
    );
    same(byId.versions[0]?.id, receipt.versionId, "the version, by artifact ID");
    const byPath = await context.host.call<{ id: string }>("artifact/get", {
      artifact: { path: receipt.dir },
    });
    same(byPath.id, receipt.artifactId, "the artifact its deleted path still names");
    const after = await context.results(receipt.artifactId);
    same(after.submission.digest, before.submission.digest, "the submission's digest");
    same(after.answers, before.answers, "the submission's answers");
    // The version still serves: its files live in the home, not in the authoring directory.
    const again = await context.viewer(receipt.artifactId);
    const page = await again.browser.ask({
      url: `${again.ticket.artifactOrigin}/`,
      headers: { accept: "text/html", "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" },
    });
    same(page.status, 200, "the version's page after the source is gone");
    check(
      statSync(join(context.home, "sources", receipt.artifactId)).isDirectory(),
      "the home keeps the version's source snapshot (DATA_MODEL §1)",
    );
  },
};

/** H-16: a host-embedded instance sends no telemetry, keeps its home private, binds loopback. */
export const privacy: Scenario = {
  id: "home.privacy",
  title:
    "A host's home is marked host-configured (no telemetry), owner-only (0700, secrets 0600), and its gateway binds loopback",
  covers: ["HO-05", "H-16", "EN-08"],
  async run(context) {
    const started = await context.start();
    const config = JSON.parse(readFileSync(join(context.home, "config.json"), "utf8")) as {
      hostConfigured?: { client: string };
    };
    check(config.hostConfigured, "config.json has no hostConfigured mark (D140 item 4)");
    same(statSync(context.home).mode & 0o777, 0o700, "the home's mode");
    await context.host.call("secret/set", { name: "CONFORMANCE_TOKEN", value: "kept-private-123" });
    same(
      statSync(join(context.home, "secrets", "home", "CONFORMANCE_TOKEN")).mode & 0o777,
      0o600,
      "a secret's mode",
    );
    const status = await context.host.call<{ gateway?: { bind: string; shell: string } }>(
      "instance/status",
      {},
    );
    same(status.gateway?.bind, "127.0.0.1", "the gateway's bind address");
    // Nothing answers on any address but loopback: the shell's port on the machine's name fails.
    const shell = new URL(status.gateway?.shell ?? "http://127.0.0.1:1");
    const elsewhere = await send({ url: `http://localhost:${shell.port}/` }).catch(() => undefined);
    check(
      elsewhere === undefined || elsewhere.status === 421,
      `the shell answered a request for another host name (${elsewhere?.status})`,
    );
    same(started.instance.mode === "host" || started.instance.mode === "daemon", true, "the mode");
  },
};

/** The session scenarios. */
export const SESSION_SCENARIOS: readonly Scenario[] = [
  negotiation,
  processModels,
  authoringRemoved,
  privacy,
];
