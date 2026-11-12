/**
 * The operator's `limits` for a hosted page's relayed actions (MT-03; INTERFACES §18.3, §18.6;
 * D165 item 9): a real `mostra-runtime server` loads the fixture operator module, a real owner
 * instance shares the `actions` fixture to it, and a page presses its actions through the real
 * front and gateway. Before a run is recorded the server asks `run`, before a run waits for an
 * absent owner `run.wait`, before a plain call is relayed `call`; a refusal answers the operator's
 * words (403 `MOSTRA_REMOTE_LIMIT_REACHED`, or 503 `MOSTRA_REMOTE_QUEUE_FULL` for `run.wait`) with
 * nothing recorded or relayed and the link's use given back; a request that joins a recorded run
 * is never asked; and an operator that doesn't answer lets every one of them through.
 */
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientKey, FakeMail, openPage, type RunState } from "../action-page.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { type Call, control } from "../operator-support.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const OPERATOR = fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts", import.meta.url));
const MAIL_TOKEN = "tok-limits-0a1b2c3d4e5f";
/** A link's relayed actions a minute: low, so a use the operator refused would soon show. */
const PER_LINK = 3;

describe("`limits` for relayed actions (MT-03)", () => {
  let port: number;
  let controlPort: number;
  let server: RunningServer;
  let operator: ReturnType<typeof control>;
  let artifactId: string;
  const owner = new GatewayHome();
  const mail = new FakeMail();

  /** The `limits` calls of one operation for this artifact, so far. */
  const asked = async (operation: string): Promise<Call[]> =>
    (await operator.calls("limits")).filter(
      (call) => call.payload["operation"] === operation && call.payload["artifact"] === artifactId,
    );

  /** A link of its own (each share mints one), so no other case's actions count against it. */
  const freshLink = async (): Promise<string> =>
    ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000),
    ).url;

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
    controlPort = await freePort();
    server = await startServer({
      data: tempDir("operator-relay-data"),
      port,
      config: testConfig(port, {
        operator: OPERATOR,
        rateLimits: { perLink: { relayedRuns: { count: PER_LINK, per: "1m" } } },
      }),
      env: {
        MOSTRA_TEST_OPERATOR_PORT: String(controlPort),
        MOSTRA_TEST_OPERATOR_DISPATCH_MS: "100",
        MOSTRA_TEST_RELAY_SWEEP_MS: "200",
      },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    operator = control(controlPort);
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    ok(await owner.client.call("secret/set", { name: "MAIL_URL", value: mail.url }));
    ok(await owner.client.call("secret/set", { name: "MAIL_TOKEN", value: MAIL_TOKEN }));
    const dir = join(tempDir("operator-relay-actions"), "actions");
    cpSync(join(FIXTURES, "actions"), dir, { recursive: true });
    writeFileSync(
      join(dir, "index.tsx"),
      `import { defineArtifact } from "@mostra/react";
import { echo } from "./actions";

export const artifact = defineArtifact({
  title: "Relayed actions under limits",
  limits: { watchdogMs: 2000, heapMb: 96 },
  hosted: { actions: "link", offline: { actions: "queue", limit: "1h" } },
});

export default function Page() {
  return <button type="button" onClick={() => void echo("hi")}>Echo</button>;
}
`,
    );
    const receipt = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    );
    artifactId = receipt.artifactId;
    ok(await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000));
    await ownerOnline();
  }, 240_000);

  beforeEach(async () => {
    await operator.set({ limits: {} });
  });

  afterAll(async () => {
    mail.close();
    await owner.stop();
    await stopServer(server);
  });

  it("refuses a run and a call with the operator's words, records and relays nothing, and gives the link's use back", async () => {
    // A link of its own, allowed three relayed actions a minute: the refusals below would use them
    // up unless each gave its use back.
    const page = await openPage(await freshLink());
    const sent = mail.received.length;
    await operator.set({
      limits: {
        run: { code: "PLAN_RUNS", message: "This account runs 1000 actions a month." },
        call: { code: "PLAN_CALLS", message: "This account makes 5000 calls a month." },
      },
    });
    for (let attempt = 0; attempt < PER_LINK; attempt += 1) {
      const refused = await page.run("actions.ts#send", ["ada@example.com", "refused"], "kept-key");
      expect(refused.status, refused.body).toBe(403);
      expect(refused.json<{ code: string; message: string }>()).toMatchObject({
        code: "MOSTRA_REMOTE_LIMIT_REACHED",
        message: "This account runs 1000 actions a month.",
      });
    }
    const call = await page.call("actions.ts#send", ["ada@example.com", "a call"]);
    expect(call.status, call.body).toBe(403);
    expect(JSON.parse(call.body)).toMatchObject({
      code: "MOSTRA_REMOTE_LIMIT_REACHED",
      message: "This account makes 5000 calls a month.",
    });
    // Nothing ran on the owner, and nothing was recorded: the refused key starts a new run, and
    // the link still has its three uses a minute (the refusals gave each back).
    expect(mail.received.length).toBe(sent);
    const runs = await asked("run");
    expect(runs.length).toBeGreaterThanOrEqual(PER_LINK);
    expect(runs.at(-1)?.payload).toMatchObject({
      artifact: artifactId,
      operation: "run",
      quantity: 1,
    });
    expect(String(runs.at(-1)?.payload["routeId"])).toMatch(/^rte_[0-9A-Z]{26}$/);
    expect((await asked("call")).at(-1)?.payload).toMatchObject({ operation: "call", quantity: 1 });
    // The owner is connected: no run waits, so `run.wait` was never asked.
    expect(await asked("run.wait")).toHaveLength(0);

    await operator.set({ limits: {} });
    const started = await page.run("actions.ts#send", ["ada@example.com", "allowed"], "kept-key");
    expect(started.status, started.body).toBe(200);
    const state = started.json<RunState>();
    expect(state.joined).not.toBe(true);
    expect((await page.settled(state.runId)).status).toBe("succeeded");
    expect(mail.received.filter((entry) => entry.body === "allowed")).toHaveLength(1);
    expect(mail.received.some((entry) => entry.body === "refused" || entry.body === "a call")).toBe(
      false,
    );
  }, 120_000);

  it("never asks about a request that joins a run already recorded", async () => {
    const page = await openPage(await freshLink());
    const key = clientKey();
    const first = await page.run("actions.ts#echo", ["once"], undefined, key);
    expect(first.status, first.body).toBe(200);
    const before = (await asked("run")).length;
    await operator.set({
      limits: { run: { code: "PLAN_RUNS", message: "No more runs this month." } },
    });
    // The same request again (a retry): it joins the run it started, whatever the operator says.
    const again = await page.run("actions.ts#echo", ["once"], undefined, key);
    expect(again.status, again.body).toBe(200);
    expect(again.json<RunState>()).toMatchObject({
      runId: first.json<RunState>().runId,
      joined: true,
    });
    expect((await asked("run")).length).toBe(before);
  }, 60_000);

  it("lets runs and calls through while the operator doesn't answer", async () => {
    await operator.set({ limits: { run: "hang", call: "hang" } });
    const page = await openPage(await freshLink());
    const started = Date.now();
    const run = await page.run("actions.ts#echo", ["through the silence"]);
    expect(run.status, run.body).toBe(200);
    expect((await page.settled(run.json<RunState>().runId)).status).toBe("succeeded");
    const call = await page.call("actions.ts#echo", ["called"]);
    expect(call.status, call.body).toBe(200);
    expect(call.value).toMatchObject({ args: ["called"] });
    // Each waited the operator's 2 s at most (INTERFACES §18.6), not much past it.
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("asks `run.wait` when the owner is away, refusing a waiting run with the operator's words", async () => {
    const page = await openPage(await freshLink());
    await owner.stop();
    await operator.set({
      limits: { "run.wait": { code: "PLAN_QUEUE", message: "20 actions may wait an hour." } },
    });
    const refused = await page.run("actions.ts#send", ["grace@example.com", "waited"], "wait-key");
    expect(refused.status, refused.body).toBe(503);
    expect(refused.json<{ code: string; message: string }>()).toMatchObject({
      code: "MOSTRA_REMOTE_QUEUE_FULL",
      message: "20 actions may wait an hour.",
    });
    expect((await asked("run.wait")).at(-1)?.payload).toMatchObject({
      artifact: artifactId,
      operation: "run.wait",
      quantity: 1,
    });

    // With the operator silent the run waits: no answer never refuses one.
    await operator.set({ limits: { "run.wait": "hang" } });
    const waiting = await page.run("actions.ts#send", ["grace@example.com", "waited"], "wait-key");
    expect(waiting.status, waiting.body).toBe(200);
    const state = waiting.json<RunState>();
    expect(state.status).toBe("waiting");
    expect(state.joined).not.toBe(true);

    // The owner comes back: the waiting run runs, once.
    await owner.start({ env: ownerEnv(port) });
    await ownerOnline();
    expect((await page.settled(state.runId, 60_000)).status).toBe("succeeded");
    expect(mail.received.filter((entry) => entry.body === "waited")).toHaveLength(1);
  }, 180_000);
});
