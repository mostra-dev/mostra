/**
 * The relay (WP-29, RM-04; INTERFACES §18.3, FAILURE_MODEL §11.1, D165 item 4): a hosted page's
 * actions run on its owner instance, through a real `mostra-runtime server` and a real owner
 * instance, with a counting fake mail server as the side effect. A run pressed on the hosted page
 * runs once on the owner with the owner's secrets; while the owner is offline it waits (`queue`) or
 * ends at once (`fail`), in a capped queue that drains in order at the drain rate when the owner
 * returns; a run whose end the owner never reported within the offline limit is `unknown`, and the
 * reported end replaces it once; a repeated relay message starts nothing; a lost acknowledgement is
 * sent again and joins; an owner restored to before runs it accepted makes them `unknown`; and no
 * relay message carries a secret.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { deserializeAll, type Frame } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ActionPage, FakeMail, openPage, type RunState, resultOf } from "../action-page.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  freePort,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const MAIL_TOKEN = "tok-relay-5e4d3c2b1a09";
const FIXTURES = new URL("../fixtures/artifacts/", import.meta.url);

/** A TCP proxy between the owner and the server that can cut every connection and refuse more. */
async function cuttableProxy(target: number): Promise<{
  port: number;
  server: Server;
  cut(on: boolean): void;
}> {
  let cutting = false;
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    if (cutting) {
      client.destroy();
      return;
    }
    const upstream = connect(target, "127.0.0.1");
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream);
    upstream.pipe(client);
    const end = (): void => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", end);
    upstream.on("error", end);
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );
  return {
    port,
    server,
    cut(on) {
      cutting = on;
      if (on) for (const socket of sockets) socket.destroy();
    },
  };
}

/** The `actions` fixture under a manifest of the test's own. */
function fixture(name: string, hosted: string): string {
  const dir = join(tempDir(`relay-${name}`), name);
  cpSync(new URL("actions", FIXTURES), dir, { recursive: true });
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact } from "@mostra/react";
import { echo } from "./actions";

export const artifact = defineArtifact({
  title: "Relay ${name}",
  limits: { watchdogMs: 2000, heapMb: 96 },
  hosted: ${hosted},
});

export default function Page() {
  return <button type="button" onClick={() => void echo("hi")}>Echo</button>;
}
`,
  );
  return dir;
}

describe("the relay (§18.3)", () => {
  let port: number;
  let server: RunningServer;
  let proxy: Awaited<ReturnType<typeof cuttableProxy>>;
  const owner = new GatewayHome();
  const mail = new FakeMail();
  const trace = join(tempDir("relay-trace"), "binding.ndjson");
  const serverData = tempDir("relay-server");
  /** The server's log lines so far. */
  const serverLog = (): string =>
    readdirSync(join(serverData, "logs"))
      .map((name) => readFileSync(join(serverData, "logs", name), "utf8"))
      .join("");
  const ownerEnv = (): NodeJS.ProcessEnv => ({
    MOSTRA_TEST_SERVER_ADDRESS: `127.0.0.1:${proxy.port}`,
    MOSTRA_TEST_BINDING_TRACE: trace,
    // An update the binding can't send within 200 ms is dropped, as one a long outage loses:
    // the reconcile after the reconnect, or a repeated relay message, has to bring it back.
    MOSTRA_TEST_RELAY_READY_MS: "200",
  });
  /** The hosted artifacts: their IDs and hosted links. */
  const hosted: Record<string, { artifactId: string; url: string; dir: string }> = {};

  const share = async (name: string, manifest: string, viewer?: string): Promise<void> => {
    const dir = fixture(name, manifest);
    const receipt = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    );
    const shared = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: receipt.artifactId },
        via: "remote",
        ...(viewer ? { viewer: { ref: viewer, name: viewer } } : {}),
      }),
    );
    hosted[name] = { artifactId: receipt.artifactId, url: shared.url, dir };
  };

  /** The run as the hosted page reads it now. */
  const stateOf = async (
    page: ActionPage,
    runId: string,
  ): Promise<RunState & { ownerUnreachable?: boolean }> =>
    (await page.attach({ runIds: [runId] })).json<{
      runs: (RunState & { ownerUnreachable?: boolean })[];
    }>().runs[0] as RunState;
  const until = async (page: ActionPage, runId: string, status: string, timeoutMs = 30_000) => {
    let state: RunState | undefined;
    await eventually(async () => {
      state = await stateOf(page, runId);
      return state?.status === status;
    }, timeoutMs);
    return state as RunState;
  };
  const runId = (answer: { status: number; body: string; json<T>(): T }): string => {
    expect(answer.status, answer.body).toBe(200);
    return answer.json<{ runId: string }>().runId;
  };
  const ownerOnline = async (): Promise<void> => {
    await eventually(async () => {
      const links = ok<{ links: { state: string }[] }>(
        await owner.client.call("remote/status", {}),
      ).links;
      return links[0]?.state === "connected";
    }, 30_000);
    // The hosted home reconciles before anything goes out: a beat for it.
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  beforeAll(async () => {
    await mail.start();
    port = await freePort();
    server = await startServer({
      data: serverData,
      port,
      config: {
        ...testConfig(port),
        relay: { waitingRunsPerArtifact: 3, drainPerSecond: 1 },
        // Far above what any other case here sends through one link in a minute.
        rateLimits: { perLink: { relayedRuns: { count: 40, per: "1m" } } },
      },
      env: { MOSTRA_TEST_RELAY_SWEEP_MS: "200", MOSTRA_TEST_RELAY_LIVE_MS: "500" },
    });
    proxy = await cuttableProxy(port);
    await owner.start({ env: ownerEnv() });
    await ownerSignIn(owner.client, port, "Ada");
    ok(await owner.client.call("secret/set", { name: "MAIL_URL", value: mail.url }));
    ok(await owner.client.call("secret/set", { name: "MAIL_TOKEN", value: MAIL_TOKEN }));
    await share("queue", `{ actions: "link", offline: { actions: "queue", limit: "1h" } }`);
    await share("fail", `{ actions: "link", offline: { actions: "fail" } }`);
    await share("short", `{ actions: "link", offline: { actions: "queue", limit: "2s" } }`);
    await share("default", `{}`);
  }, 240_000);

  afterAll(async () => {
    mail.close();
    await owner.stop();
    proxy?.server.close();
    await stopServer(server);
  });

  it("runs a hosted page's action once, on the owner, with the owner's secret", async () => {
    const page = await openPage(hosted["queue"]?.url as string);
    const before = mail.received.length;
    const clientKey = `ck-relay-${Date.now()}`;
    const started = await page.run(
      "actions.ts#send",
      ["ada@example.com", "hello"],
      undefined,
      clientKey,
    );
    const id = runId(started);
    // A retried request joins the run it started: one email.
    const again = await page.run(
      "actions.ts#send",
      ["ada@example.com", "hello"],
      undefined,
      clientKey,
    );
    expect(again.json<{ runId: string; joined?: boolean }>()).toMatchObject({
      runId: id,
      joined: true,
    });
    const ended = await page.settled(id);
    expect(ended.status, JSON.stringify(ended)).toBe("succeeded");
    expect(await resultOf(ended)).toMatchObject({ sent: true });
    expect(mail.received.length - before).toBe(1);
    expect(mail.received.at(-1)?.authorization).toBe(`Bearer ${MAIL_TOKEN}`);
    // A keyed run happens once, whoever presses it.
    const keyed = runId(
      await page.run("actions.ts#send", ["grace@example.com", "once"], "send-once"),
    );
    const other = await openPage(hosted["queue"]?.url as string);
    expect(
      runId(await other.run("actions.ts#send", ["grace@example.com", "once"], "send-once")),
    ).toBe(keyed);
    await page.settled(keyed);
    expect(mail.received.filter((entry) => entry.body === "once")).toHaveLength(1);
    // The owner recorded each under the hosted run's ID.
    const events = ok<{
      events: { type: string; payload: { runId?: string; relayed?: boolean } }[];
    }>(await owner.client.call("events/read", { filter: { types: ["action.*"] } })).events;
    expect(events.some((event) => event.payload.runId === id && event.payload.relayed)).toBe(true);
  }, 60_000);

  it("relays a plain call while the owner is connected", async () => {
    const page = await openPage(hosted["queue"]?.url as string);
    const echoed = await page.call("actions.ts#echo", [1, "two"]);
    expect(echoed.status, echoed.body).toBe(200);
    expect(echoed.end).toEqual({ status: "succeeded" });
    expect(echoed.value).toMatchObject({ args: [1, "two"] });
  }, 60_000);

  it("refuses a link's relayed actions past its rate, before anything is recorded or relayed (D159)", async () => {
    // A link of its own, so no other case's runs count against it.
    const flood = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: hosted["queue"]?.artifactId },
        via: "remote",
      }),
    );
    const page = await openPage(flood.url);
    const before = mail.received.length;
    for (let index = 0; index < 40; index += 1) {
      const call = await page.call("actions.ts#echo", [index]);
      expect(call.status, call.body).toBe(200);
    }
    const refused = await page.run("actions.ts#send", ["flood@example.com", "flood"]);
    expect(refused.status).toBe(429);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_RATE_LIMITED");
    expect(Number(refused.header("retry-after"))).toBeGreaterThan(0);
    const call = await page.call("actions.ts#echo", []);
    expect(call.status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mail.received.slice(before).some((entry) => entry.body === "flood")).toBe(false);
  }, 120_000);

  it("refuses a relayed action to a viewer who isn't signed in, unless the artifact opts in (D159)", async () => {
    const page = await openPage(hosted["default"]?.url as string);
    const refused = await page.run("actions.ts#echo", []);
    expect(refused.status).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_SIGN_IN_REQUIRED");
    const call = await page.call("actions.ts#echo", []);
    expect(call.status).toBe(403);
    // A link minted for a named person is an expected respondent's.
    const named = ok<{ url: string }>(
      await owner.client.call("share/start", {
        artifact: { artifactId: hosted["default"]?.artifactId },
        via: "remote",
        viewer: { ref: "grace@example.com", name: "Grace" },
      }),
    );
    const respondent = await openPage(named.url);
    const allowed = await respondent.run("actions.ts#echo", ["ok"]);
    expect((await respondent.settled(runId(allowed))).status).toBe("succeeded");
  }, 60_000);

  it("puts a relayed run's state, signals and host events on the hosted home, and the owner's own writes there", async () => {
    const artifactId = hosted["queue"]?.artifactId as string;
    const page = await openPage(hosted["queue"]?.url as string);
    const added = runId(await page.run("actions.ts#addTask", ["from the page"]));
    expect((await page.settled(added)).status).toBe("succeeded");
    const raised = runId(await page.run("actions.ts#raise", []));
    expect((await page.settled(raised)).status).toBe("succeeded");
    // The owner reads the hosted home's state, not a local copy: one copy of shared state.
    const state = ok<{ fields: Record<string, { value: unknown }> }>(
      await owner.client.call("state/get", { artifact: { artifactId } }),
    );
    expect(state.fields["tasks"]?.value).toEqual(["from the page"]);
    // The owner's own write goes there too, and the hosted page reads it.
    ok(
      await owner.client.call("state/patch", {
        artifact: { artifactId },
        ops: [{ id: "tasks", value: ["from the page", "from the agent"] }],
        mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XJ",
      }),
    );
    const again = await page.run("actions.ts#addTask", ["third"]);
    expect((await page.settled(runId(again))).status).toBe("succeeded");
    const after = ok<{ fields: Record<string, { value: unknown }> }>(
      await owner.client.call("state/get", { artifact: { artifactId } }),
    );
    expect(after.fields["tasks"]?.value).toEqual(["from the page", "from the agent", "third"]);
    // The signal and the host event were appended on the hosted home with the run's causation,
    // and reached the owner's own log through the follow.
    await eventually(async () => {
      // Followed from the hosted home (`origin`), never raised here first.
      const events = ok<{
        events: { type: string; causation?: { runId?: string }; origin?: unknown }[];
      }>(
        await owner.client.call("events/read", {
          filter: { artifacts: [artifactId], types: ["signal.raised", "host.*"] },
        }),
      ).events.filter((event) => event.causation?.runId === raised);
      expect(events.every((event) => event.origin !== undefined)).toBe(true);
      return (
        events.some((event) => event.type === "signal.raised") &&
        events.some((event) => event.type === "host.mail.sent")
      );
    }, 15_000);
    // A live value the owner pushes is the hosted page's.
    ok(
      await owner.client.call("live/push", {
        artifact: { artifactId },
        key: "headline",
        value: "from the owner",
      }),
    );
    const live = await page.live([{ key: "headline" }]);
    expect(live.status, live.body).toBe(200);
    expect(live.json<{ sources: { revision?: string }[] }>().sources[0]?.revision).toBeDefined();
  }, 60_000);

  it("runs a hosted page's live producers on the owner while it views, and keeps their values there", async () => {
    const page = await openPage(hosted["queue"]?.url as string);
    type Source = {
      key: string;
      revision?: string;
      value?: Frame[][];
      error?: { message: string };
      ownerOffline?: boolean;
    };
    const read = async (key: string): Promise<Source> => {
      const answer = await page.live([{ key }]);
      expect(answer.status, answer.body).toBe(200);
      return answer.json<{ sources: Source[] }>().sources[0] as Source;
    };
    let counter: Source | undefined;
    await eventually(async () => {
      counter = await read("counter");
      return counter.revision !== undefined;
    }, 20_000);
    expect(await deserializeAll(counter?.value ?? [])).toMatchObject({ loads: expect.any(Number) });
    expect(counter?.ownerOffline).toBeUndefined();
    // A producer's failure reaches the page redacted: the secret stayed on the owner.
    let failing: Source | undefined;
    await eventually(async () => {
      failing = await read("failing");
      return failing.error !== undefined;
    }, 20_000);
    expect(failing?.error?.message).not.toContain(MAIL_TOKEN);
    // With the owner away, the last value stays, marked.
    await owner.stop();
    try {
      await eventually(async () => (await read("counter")).ownerOffline === true, 10_000);
      expect((await read("counter")).revision).toBeDefined();
    } finally {
      await owner.start({ env: ownerEnv() });
      await ownerOnline();
    }
  }, 120_000);

  it("waits while the owner is offline, refuses past the cap, and drains in order at the rate", async () => {
    await owner.stop();
    const page = await openPage(hosted["queue"]?.url as string);
    const failing = await openPage(hosted["fail"]?.url as string);
    // Under `fail` a run ends at once, never sent: nothing happened.
    const failed = await failing.run("actions.ts#send", ["x@example.com", "never"]);
    const failedState = await until(failing, runId(failed), "failed", 5_000);
    expect(failedState.reason).toBe("owner-offline");
    // A plain call answers at once.
    const offlineCall = await page.call("actions.ts#echo", []);
    expect(offlineCall.status).toBe(503);
    expect(offlineCall.body).toContain("MOSTRA_REMOTE_OWNER_OFFLINE");
    // A hosted artifact's state is never written here alone while its server can't be reached.
    // (The owner itself is stopped here; its refusal is checked once it is back, below.)
    // Under `queue` runs wait, up to the cap.
    const ids: string[] = [];
    for (const to of ["a", "b", "c"]) {
      const started = await page.run("actions.ts#send", [`${to}@example.com`, `queued-${to}`]);
      ids.push(runId(started));
      expect(started.json<{ status: string }>().status).toBe("waiting");
    }
    const full = await page.run("actions.ts#send", ["d@example.com", "queued-d"]);
    expect(full.status).toBe(503);
    expect(full.json<{ code: string }>().code).toBe("MOSTRA_REMOTE_QUEUE_FULL");
    // A cancel before it is sent ends it here, without the owner.
    const cancelled = await page.cancel(ids[2] as string);
    expect(cancelled.json<{ status: string }>().status).toBe("cancelled");
    const another = runId(await page.run("actions.ts#send", ["e@example.com", "queued-e"]));
    ids[2] = another;
    const before = mail.received.length;
    await owner.start({ env: ownerEnv() });
    for (const id of ids) expect((await page.settled(id, 30_000)).status).toBe("succeeded");
    const sent = mail.received.slice(before);
    expect(sent.map((entry) => entry.body)).toEqual(["queued-a", "queued-b", "queued-e"]);
    // At most one a second: the third goes out two seconds after the first. Measured where the
    // owner records each run as it arrives (its `action.started`), so a worker the owner starts
    // cold for the first run doesn't shorten the gap the mails show.
    const arrived = ok<{
      events: { at: string; payload: { runId?: string; relayed?: boolean } }[];
    }>(
      await owner.client.call("events/read", { filter: { types: ["action.started"] } }),
    ).events.filter(
      (event) => event.payload.relayed === true && ids.includes(event.payload.runId as string),
    );
    const times = ids.map((id) =>
      Date.parse(arrived.find((event) => event.payload.runId === id)?.at ?? ""),
    );
    expect((times[2] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(1500);
    expect(mail.received.some((entry) => entry.body === "never" || entry.body === "queued-c")).toBe(
      false,
    );
  }, 120_000);

  it("ends a never-sent run failed at its limit, and a cut-off run unknown, which the owner's end replaces", async () => {
    const page = await openPage(hosted["short"]?.url as string);
    // Cut mid-run: the owner finishes and reports; past the limit the hosted run is unknown.
    const slow = runId(await page.run("actions.ts#slow", [4000]));
    await until(page, slow, "running", 15_000);
    proxy.cut(true);
    await eventually(async () => (await stateOf(page, slow)).ownerUnreachable === true, 10_000);
    // While the server can't be reached, a hosted artifact's state is refused, never written here.
    const refused = await owner.client.call(
      "state/patch",
      {
        artifact: { artifactId: hosted["short"]?.artifactId },
        ops: [{ id: "tasks", value: ["offline"] }],
        mutationId: "mut_01JB8Z3QF6S7W3N8D5K2C4V9XK",
      },
      20_000,
    );
    expect(JSON.stringify(refused)).toContain("MOSTRA_REMOTE_UNREACHABLE");
    const unknown = await until(page, slow, "unknown", 10_000);
    expect(unknown.error?.code).toBe("MOSTRA_REMOTE_OWNER_OFFLINE");
    // A run pressed now is never sent: at its limit it failed, and never happened.
    const never = runId(await page.run("actions.ts#send", ["late@example.com", "late"]));
    const late = await until(page, never, "failed", 10_000);
    expect(late.reason).toBe("owner-offline");
    proxy.cut(false);
    const replaced = await page.settled(slow, 60_000);
    expect(replaced.status).toBe("succeeded");
    expect(await resultOf(replaced)).toBe("finished");
    const events = ok<{ events: { type: string; payload: { runId?: string } }[] }>(
      await owner.client.call("events/read", { filter: { types: ["action.*"] } }),
    );
    void events;
    expect(mail.received.some((entry) => entry.body === "late")).toBe(false);
    await ownerOnline();
  }, 120_000);

  it("sends a run again when its acknowledgement was lost, and it happens once", async () => {
    await owner.stop();
    await owner.start({ env: { ...ownerEnv(), MOSTRA_TEST_RELAY_LOSE_ACK: "1" } });
    await ownerOnline();
    const page = await openPage(hosted["queue"]?.url as string);
    // A warm worker, so the run ends before the owner dials again: only the repeated message
    // can then bring its end back (its own update was dropped with the binding).
    expect((await page.call("actions.ts#echo", [])).status).toBe(200);
    const before = mail.received.length;
    const id = runId(await page.run("actions.ts#send", ["ack@example.com", "ack-lost"]));
    expect((await page.settled(id, 60_000)).status).toBe("succeeded");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mail.received.slice(before).filter((entry) => entry.body === "ack-lost")).toHaveLength(
      1,
    );
    await owner.stop();
    await owner.start({ env: ownerEnv() });
    await ownerOnline();
  }, 120_000);

  it("never ends a run without the output its owner sent while the relay was cut (Opus review of WP-29, 4)", async () => {
    await owner.stop();
    await owner.start({ env: { ...ownerEnv(), MOSTRA_TEST_RELAY_LOSE_ACK: "1" } });
    await ownerOnline();
    const page = await openPage(hosted["queue"]?.url as string);
    // The acknowledgement is lost with the connection, and the run's first lines go with it; the
    // run is still running when the owner dials again.
    const id = runId(await page.run("actions.ts#slow", [3000]));
    const state = await page.settled(id, 60_000);
    expect(state.status).toBe("succeeded");
    expect(state.log).toContain("slow started");
    expect(state.batches.length).toBeGreaterThan(0);
    // The owner made up what it lost itself, answering the repeated run with the run's whole
    // state: the hosted home never had to ask for it again.
    const asked = readFileSync(trace, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("in ") && line.includes("port/relay.reconcile"))
      .filter((line) => line.includes(id));
    expect(asked).toEqual([]);
    await owner.stop();
    await owner.start({ env: ownerEnv() });
    await ownerOnline();
  }, 120_000);

  it("ends a run its owner crashed during failed, interrupted, and reports it on reconnect", async () => {
    const page = await openPage(hosted["queue"]?.url as string);
    const id = runId(await page.run("actions.ts#slow", [60_000]));
    await until(page, id, "running", 15_000);
    // The owner's machine dies with the run in flight.
    owner.daemon.child.kill("SIGKILL");
    await owner.daemon.exited;
    owner.client.close();
    await owner.start({ env: ownerEnv() });
    await until(page, id, "failed", 30_000);
    const state = await stateOf(page, id);
    expect(state).toMatchObject({ status: "failed", reason: "interrupted" });
  }, 120_000);

  it("makes runs an owner restored to before it accepted them unknown, and never sends them again", async () => {
    const store = join(owner.home.home, "store");
    const backup = join(tempDir("relay-backup"), "store");
    await owner.stop();
    cpSync(store, backup, { recursive: true });
    await owner.start({ env: ownerEnv() });
    await ownerOnline();
    const page = await openPage(hosted["queue"]?.url as string);
    const id = runId(await page.run("actions.ts#slow", [60_000]));
    await until(page, id, "running", 15_000);
    await owner.stop();
    rmSync(store, { recursive: true, force: true });
    cpSync(backup, store, { recursive: true });
    await owner.start({ env: ownerEnv() });
    await until(page, id, "unknown", 30_000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await stateOf(page, id)).status).toBe("unknown");
    // The owner's own record of a relayed run says so; a followed hosted event doesn't.
    const events = ok<{ events: { payload: { runId?: string; relayed?: boolean } }[] }>(
      await owner.client.call("events/read", { filter: { types: ["action.started"] } }),
    ).events;
    expect(events.some((event) => event.payload.runId === id && event.payload.relayed)).toBe(false);
  }, 120_000);

  it("carries no secret in any relay message", async () => {
    const page = await openPage(hosted["queue"]?.url as string);
    // An action that logs, returns and throws the secret: every update passes the redactor.
    const leaked = runId(await page.run("actions.ts#leak", []));
    await page.settled(leaked);
    expect(existsSync(trace)).toBe(true);
    const text = readFileSync(trace, "utf8");
    expect(text).toContain("port/relay.run");
    expect(text).toContain("relay/run.update");
    expect(text.includes(MAIL_TOKEN)).toBe(false);
  }, 60_000);

  it("signs a forgotten link in again with no marks of the old one (Opus review of WP-29, 9)", async () => {
    // The owner accepts a relayed run: its relay mark is above zero.
    const page = await openPage(hosted["queue"]?.url as string);
    const id = runId(await page.run("actions.ts#echo", ["mark"]));
    expect((await page.settled(id, 60_000)).status).toBe("succeeded");
    const regressed = async (): Promise<number> =>
      ok<{ events: { type: string }[] }>(
        await owner.client.call("events/read", { filter: { types: ["remote.*"] } }),
      ).events.filter((event) => event.type === "remote.regressed").length;
    const before = await regressed();
    const rotations = serverLog().split("server.home_rotated").length;
    ok(await owner.client.call("remote/logout", { forget: true }));
    await ownerSignIn(owner.client, port, "Ada");
    await ownerOnline();
    // A new link, whose hosted home never saw a run of it: no restore to tell of, and the home
    // keeps its incarnation.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await regressed()).toBe(before);
    expect(serverLog().split("server.home_rotated").length).toBe(rotations);
  }, 60_000);
});
