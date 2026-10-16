/**
 * Workers, actions and live data through a real `mostra-runtime daemon` (WP-08): pages call
 * server functions and start durable action runs over the browser protocol; workers start on
 * first need, one per version, with the artifact's full capability, and crash, run out of memory
 * or hang without taking the gateway or another artifact with them; secrets reach server code by
 * name and never anything Mostra keeps; live sources flow without durable events.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializeAll, type Frame } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientKey, FakeMail, openPage, type RunState, resultOf } from "../action-page.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { connectTo, eventually, initializeParams, tempDir } from "../support.ts";

const MAIL_TOKEN = "tok-live-9f8e7d6c5b4a";

/** `@mostra/worker`'s built entry, which both launchers run. */
const WORKER_MAIN = fileURLToPath(new URL("../../../worker/dist/main.js", import.meta.url));
const WORKER_HOST = fileURLToPath(new URL("../fixtures/worker-host.mjs", import.meta.url));

/** Starts the separately started worker host (D124) for a home, and waits until it listens. */
async function startWorkerHost(home: string): Promise<{ socket: string; process: ChildProcess }> {
  const socket = join(tempDir("wh", true), "host.sock");
  const child = spawn(
    process.execPath,
    [WORKER_HOST, "--socket", socket, "--home", home, "--worker", WORKER_MAIN],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`worker host exited (${code})`)));
  });
  return { socket, process: child };
}

// The action suite runs against both launchers: the local one, and a worker host started on its
// own, reached over a socket with only a version reference and serializable messages (D124).
describe.each([
  ["the local launcher", false],
  ["a worker host started on its own, over a socket (D124)", true],
])("workers, actions and live data (WP-08), through %s", (_launcher, remote) => {
  const gateway = new GatewayHome();
  const mail = new FakeMail();
  let actions: Receipt & { dir: string };
  let host: { socket: string; process: ChildProcess } | undefined;

  beforeAll(async () => {
    await mail.start();
    if (remote) {
      mkdirSync(gateway.home.home, { recursive: true, mode: 0o700 });
      host = await startWorkerHost(realpathSync(gateway.home.home));
    }
    await gateway.start({
      env: {
        MOSTRA_TEST_WORKER_IDLE_MS: "4000",
        ...(host ? { MOSTRA_TEST_WORKER_HOST: host.socket } : {}),
      },
    });
    actions = await gateway.publish("actions");
    ok(await gateway.client.call("secret/set", { name: "MAIL_URL", value: mail.url }));
    ok(
      await gateway.client.call("secret/set", {
        name: "MAIL_TOKEN",
        value: MAIL_TOKEN,
        artifact: { artifactId: actions.artifactId },
      }),
    );
  }, 240_000);

  afterAll(async () => {
    mail.close();
    await gateway.stop();
    host?.process.kill("SIGTERM");
  });

  const workers = async () =>
    ok<{
      workers?: {
        versionId: string;
        state: string;
        pid?: number;
        crashes: number;
        lastCause?: string;
      }[];
    }>(await gateway.client.call("instance/status", {})).workers ?? [];

  it("calls a server function in a worker started on first need, one per version (RT-03)", async () => {
    expect(
      (await workers()).filter((w) => w.versionId === actions.versionId && w.state === "ready"),
    ).toEqual([]);
    const page = await openPage(actions.url);
    const echoed = await page.call("actions.ts#echo", [1, new Date(0), new Map([["k", 2n]])]);
    expect(echoed.status).toBe(200);
    expect(echoed.end).toEqual({ status: "succeeded" });
    expect(echoed.value).toMatchObject({ args: [1, new Date(0), new Map([["k", 2n]])] });
    const first = (await page.call("actions.ts#pid", [])).value;
    const second = (await (await openPage(actions.url)).call("actions.ts#pid", [])).value;
    expect(second).toBe(first);
    const ready = (await workers()).filter((w) => w.versionId === actions.versionId);
    if (!remote) {
      expect(ready).toMatchObject([{ state: "ready", pid: first }]);
      return;
    }
    // Through the host: the launch named the version by reference only, no directory, and
    // carried no secret in its environment (D124).
    expect(ready).toMatchObject([{ state: "ready" }]);
    const launches = readFileSync(`${host?.socket}.launches`, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      artifactId: actions.artifactId,
      version: { versionId: actions.versionId, locator: `home:versions/${actions.versionId}` },
    });
    expect(launches[0]).not.toHaveProperty("sourceDir");
    expect(JSON.stringify(launches[0])).not.toContain(gateway.home.home);
    expect(JSON.stringify(launches[0])).not.toContain(MAIL_TOKEN);
  });

  it("runs server code with full capability: a file, a process, the network (AC-01)", async () => {
    const page = await openPage(actions.url);
    const result = await page.call("actions.ts#capability", [mail.url.replace("/send", "/hello")]);
    expect(result.value).toMatchObject({
      file: true,
      process: "from a process",
      network: "hello from the network",
    });
  });

  it("records a run before it runs, streams it, and keeps it for a reloaded tab (AC-02)", async () => {
    const page = await openPage(actions.url);
    const started = (await page.run("actions.ts#count", [5])).json<RunState>();
    expect(started.status).toBe("queued");
    const done = await page.settled(started.runId);
    expect(done.status).toBe("succeeded");
    const items: unknown[] = [];
    for await (const item of (await resultOf(done)) as AsyncIterable<unknown>) items.push(item);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    // A reloaded tab (a new browser) finds the run again by its ID through the artifact's link.
    const reloaded = await openPage(actions.url);
    const again = (await reloaded.attach({ runIds: [started.runId] })).json<{ runs: RunState[] }>()
      .runs;
    expect(again[0]?.status).toBe("succeeded");
  });

  it("sends a keyed action once however often it is clicked, from tabs and reloads (AC-03)", async () => {
    const before = mail.received.length;
    const tabA = await openPage(actions.url);
    const tabB = await openPage(actions.url);
    const key = `send.${Date.now()}`;
    const clicks = await Promise.all([
      tabA.run("actions.ts#send", ["ada@example.com", "hi"], key),
      tabA.run("actions.ts#send", ["ada@example.com", "hi"], key),
      tabB.run("actions.ts#send", ["ada@example.com", "hi"], key),
    ]);
    const ids = new Set(clicks.map((click) => click.json<RunState>().runId));
    expect(ids.size).toBe(1);
    const [runId] = [...ids] as [string];
    const done = await tabA.settled(runId);
    expect(done.status).toBe("succeeded");
    // A reload after it finished: the key finds the same run, nothing is sent again.
    const reload = await openPage(actions.url);
    const joined = (
      await reload.run("actions.ts#send", ["ada@example.com", "hi"], key)
    ).json<RunState>();
    expect(joined).toMatchObject({ runId, status: "succeeded", joined: true });
    const found = (await reload.attach({ keyed: [{ fnId: "actions.ts#send", key }] })).json<{
      runs: RunState[];
    }>();
    expect(found.runs.map((run) => run.runId)).toEqual([runId]);
    expect(mail.received.length - before).toBe(1);
    expect(mail.received.at(-1)?.authorization).toBe(`Bearer ${MAIL_TOKEN}`);
    // A retried request (same client key) joins the run it started instead of starting another.
    const ck = clientKey();
    const first = (await tabB.run("actions.ts#echo", ["retry"], undefined, ck)).json<RunState>();
    const retry = (await tabB.run("actions.ts#echo", ["retry"], undefined, ck)).json<RunState>();
    expect(retry.runId).toBe(first.runId);
  });

  it("shares a keyed run with every viewer, and keeps a run without a key its viewer's own (D104, D130)", async () => {
    const mine = await openPage(actions.url);
    const ben = await openPage(
      (await gateway.link(actions.artifactId, { viewer: { ref: "ben", name: "Ben" } })).url,
    );
    // A run without a key: Ben can't read it, cancel it, or take its client key.
    const ck = clientKey();
    const own = (await mine.run("actions.ts#slow", [5_000], undefined, ck)).json<RunState>();
    expect((await ben.attach({ runIds: [own.runId] })).json<{ runs: RunState[] }>().runs).toEqual(
      [],
    );
    expect((await ben.cancel(own.runId)).status).toBe(404);
    expect((await ben.run("actions.ts#slow", [5_000], undefined, ck)).status).toBe(400);
    expect((await mine.cancel(own.runId)).status).toBe(200);
    // A keyed run is one invocation of the artifact: Ben's click joins it and sees how it ended.
    const key = `shared.${Date.now()}`;
    const first = (await mine.run("actions.ts#echo", ["once"], key)).json<RunState>();
    const joined = (await ben.run("actions.ts#echo", ["once"], key)).json<RunState>();
    expect(joined).toMatchObject({ runId: first.runId, joined: true });
    expect((await ben.settled(first.runId)).status).toBe("succeeded");
  });

  it("aborts a run's abortSignal on cancel, and the run ends cancelled (AC-04)", async () => {
    const page = await openPage(actions.url);
    const started = (await page.run("actions.ts#slow", [30_000])).json<RunState>();
    await eventually(async () => {
      const state = (await page.attach({ runIds: [started.runId] })).json<{ runs: RunState[] }>()
        .runs[0];
      return state?.status === "running" && state.log.includes("slow started");
    });
    expect((await page.cancel(started.runId)).status).toBe(200);
    const done = await page.settled(started.runId);
    expect(done).toMatchObject({ status: "cancelled", reason: "cancelled" });
    expect(done.progress).toEqual({ fraction: 0.25, message: "started" });
    expect(done.log).toEqual(["slow started", 'console line {"ms":30000}']);
  });

  it("raises signals and host events from a run, with the run as their cause, to a subscribed host (AC-05)", async () => {
    // A host subscribed to the artifact's signals and host events, as Jcode would be.
    const host = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await host.call(
        "mostra/initialize",
        initializeParams({ capabilities: { notifications: ["events/notify"] } }),
      ),
    );
    ok(
      await host.call("events/subscribe", {
        filter: { artifacts: [actions.artifactId], types: ["signal.raised", "host.*"] },
      }),
    );
    const page = await openPage(actions.url);
    const started = (await page.run("actions.ts#raise", [])).json<RunState>();
    expect((await page.settled(started.runId)).status).toBe("succeeded");
    const heard: { type: string; causation?: { runId?: string } }[] = [];
    while (heard.length < 2) {
      const note = (await host.next((m) => m.method === "events/notify", 15_000)) as {
        params: { events: { type: string; causation?: { runId?: string } }[] };
      };
      heard.push(...note.params.events);
    }
    host.close();
    expect(heard.map((event) => [event.type, event.causation?.runId])).toEqual([
      ["signal.raised", started.runId],
      ["host.mail.sent", started.runId],
    ]);
    const events = ok<{
      events: { type: string; causation?: { runId?: string }; payload: Record<string, unknown> }[];
    }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId], types: ["signal.raised", "host.*", "action.*"] },
      }),
    ).events.filter((event) => event.causation?.runId === started.runId);
    expect(events.map((event) => event.type)).toEqual([
      "action.started",
      "signal.raised",
      "host.mail.sent",
      "action.succeeded",
    ]);
    expect(events[1]?.payload).toMatchObject({
      name: "reply-sent",
      source: "action",
      payload: { id: 7 },
    });
    expect(events[2]?.payload).toEqual({ data: { id: 7 } });
  });

  it("writes artifact state as the agent (D63)", async () => {
    const page = await openPage(actions.url);
    const run = (await page.run("actions.ts#addTask", ["water the plants"])).json<RunState>();
    expect((await page.settled(run.runId)).status).toBe("succeeded");
    const state = ok<{ fields: Record<string, { value: unknown }> }>(
      await gateway.client.call("state/get", { artifact: { artifactId: actions.artifactId } }),
    );
    expect(state.fields["tasks"]?.value).toEqual(["water the plants"]);
  });

  it("keeps secrets out of logs, events, run logs, errors and the ledger (AC-06)", async () => {
    const page = await openPage(actions.url);
    const run = (await page.run("actions.ts#leak", [])).json<RunState>();
    const done = await page.settled(run.runId);
    expect(done.status).toBe("failed");
    expect(JSON.stringify(done)).not.toContain(MAIL_TOKEN);
    expect(done.error?.message).toBe("failed with [redacted]");
    expect(done.log).toContain("token is [redacted]");
    const revealed = (await page.run("actions.ts#reveal", [])).json<RunState>();
    expect(await resultOf(await page.settled(revealed.runId))).toEqual({ token: "[redacted]" });
    expect((await page.call("actions.ts#reveal", [])).value).toEqual({ token: "[redacted]" });
    const state = ok<{ fields: Record<string, { value: unknown }> }>(
      await gateway.client.call("state/get", { artifact: { artifactId: actions.artifactId } }),
    );
    expect(state.fields["leaked"]?.value).toBe("[redacted]");
    // The secret still works where it belongs: the mail server got it.
    expect((await page.call("actions.ts#send", ["x", "y"])).end).toEqual({ status: "succeeded" });
    expect(mail.received.at(-1)?.authorization).toBe(`Bearer ${MAIL_TOKEN}`);
    // Everything Mostra keeps: the logs, the ledger and its write-ahead log, the version store.
    const grep = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() && !entry.parentPath.includes(`${join(gateway.home.home, "secrets")}`),
        )
        .filter((entry) => readFileSync(join(entry.parentPath, entry.name)).includes(MAIL_TOKEN))
        .map((entry) => join(entry.parentPath, entry.name));
    expect(grep(gateway.home.home)).toEqual([]);
    const events = ok<{ events: unknown[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId] },
        limit: 100,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(MAIL_TOKEN);
    // The value only lives in the owner-only store.
    expect(
      readFileSync(join(gateway.home.home, "secrets", actions.artifactId, "MAIL_TOKEN"), "utf8"),
    ).toBe(MAIL_TOKEN);
  });

  it("refuses a link without the action's scope (D97 item 4)", async () => {
    const viewOnly = await gateway.link(actions.artifactId, { scopes: ["view"] });
    const page = await openPage(viewOnly.url);
    expect((await page.run("actions.ts#echo", [])).status).toBe(403);
    expect((await page.call("actions.ts#echo", [])).status).toBe(403);
    const one = await gateway.link(actions.artifactId, { scopes: ["view", "action:echo"] });
    const narrow = await openPage(one.url);
    expect((await narrow.call("actions.ts#echo", ["ok"])).end).toEqual({ status: "succeeded" });
    expect((await narrow.run("actions.ts#send", ["a", "b"])).status).toBe(403);
  });

  it("keeps a version without server code free of workers (RT-05)", async () => {
    const single = await gateway.publish("single-tsx", "page.tsx");
    await openPage(single.url);
    expect((await workers()).some((w) => w.versionId === single.versionId)).toBe(false);
  });

  it("delivers live values without durable events, and keeps the latest (LL-04, AC-07)", async () => {
    const page = await openPage(actions.url);
    // The artifact's newest cursor, read to the end, once the page is open.
    const before = ok<{ cursor: string }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId] },
        limit: 1000,
      }),
    );
    expect((await page.live([{ key: "counter" }, { key: "ticks", window: 10 }])).status).toBe(200);
    let state: { key: string; revision?: string; value?: Frame[][]; ring?: unknown[] }[] = [];
    await eventually(async () => {
      state = (await page.live([{ key: "counter" }, { key: "ticks", window: 10 }])).json<{
        sources: typeof state;
      }>().sources;
      return Number(state[0]?.revision ?? 0) >= 2 && (state[1]?.ring?.length ?? 0) === 10;
    }, 15_000);
    expect(await deserializeAll(state[0]?.value as Frame[][])).toMatchObject({
      loads: expect.any(Number),
    });
    // Long polls carry the updates as ephemeral messages.
    const snapshot = (await page.poll()).json<{ cursor: string }>();
    const polled = (await page.poll(snapshot.cursor, 2)).json<{ ephemeral?: { kind: string }[] }>();
    expect(polled.ephemeral?.some((message) => message.kind === "live")).toBe(true);
    // No durable event came of any of it.
    const after = ok<{ events: { type: string }[] }>(
      await gateway.client.call("events/read", {
        filter: { artifacts: [actions.artifactId] },
        after: before.cursor,
        limit: 100,
      }),
    );
    expect(after.events.filter((event) => !event.type.startsWith("view."))).toEqual([]);
    // Live data never rides a hot-reload channel: no version carries Vite's client (AC-07, D09).
    const assets = join(gateway.home.home, "versions", actions.versionId, "client");
    const built = readdirSync(assets, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(js|html)$/.test(file))
      .map((file) => readFileSync(join(assets, file), "utf8"))
      .join("\n");
    expect(built).not.toMatch(/@vite\/client|import\.meta\.hot|vite-hmr|__vite_ws/);
    // A push writes the same source (D56).
    const pushed = ok<{ revision: string }>(
      await gateway.client.call("live/push", {
        artifact: { artifactId: actions.artifactId },
        key: "pushed",
        value: { n: 1 },
      }),
    );
    expect(pushed.revision).toBe("1");
    const read = (await page.live([{ key: "pushed" }])).json<{ sources: { value: Frame[][] }[] }>();
    expect(await deserializeAll(read.sources[0]?.value as Frame[][])).toEqual({ n: 1 });
  });

  // Watching the owner's files needs them: a launcher elsewhere has the version, not the source.
  it.skipIf(remote)("reloads a watched source when its file changes (AC-07)", async () => {
    const page = await openPage(actions.url);
    const value = async () => {
      const source = (await page.live([{ key: "watched" }])).json<{
        sources: { value?: Frame[][] }[];
      }>().sources[0];
      return source?.value ? deserializeAll(source.value) : undefined;
    };
    await eventually(async () => JSON.stringify(await value()) === '{"value":1}', 15_000);
    writeFileSync(join(actions.dir, "data", "value.json"), '{"value":2}');
    await eventually(async () => JSON.stringify(await value()) === '{"value":2}', 15_000);
  });

  it("refuses arguments and stops results past 16 MiB, for calls and runs (D131)", async () => {
    const page = await openPage(actions.url);
    // A result past the bound stops the call and the run: nothing buffers without limit.
    const call = await page.call("actions.ts#huge", [17]);
    expect(call.end).toMatchObject({
      status: "failed",
      error: { code: "MOSTRA_ACTION_TOO_LARGE" },
    });
    const run = (await page.run("actions.ts#huge", [17])).json<RunState>();
    expect(await page.settled(run.runId)).toMatchObject({
      status: "failed",
      reason: "too-large",
      error: { code: "MOSTRA_ACTION_TOO_LARGE" },
    });
    // Within it, the result arrives whole.
    expect(((await page.call("actions.ts#huge", [1])).value as string).length).toBe(1024 * 1024);
    // Arguments past it are refused before any worker sees them.
    const big = "y".repeat(16 * 1024 * 1024 + 1);
    expect((await page.call("actions.ts#echo", [big])).status).toBe(413);
    expect((await page.run("actions.ts#echo", [big])).status).toBe(413);
  });

  it("caps a run's log at 1 MB with a marker (D47)", async () => {
    const page = await openPage(actions.url);
    const run = (await page.run("actions.ts#chatty", [])).json<RunState>();
    const done = await page.settled(run.runId);
    expect(done.status).toBe("succeeded");
    expect(done.log.at(-1)).toBe("[log truncated at 1 MB]");
    expect(done.log.join("\n").length).toBeLessThanOrEqual(1024 * 1024);
  });
});
