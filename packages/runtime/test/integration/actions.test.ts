/**
 * Workers, actions and live data through a real `mostra-runtime daemon` (WP-08): pages call
 * server functions and start durable action runs over the browser protocol; workers start on
 * first need, one per version, with the artifact's full capability, and crash, run out of memory
 * or hang without taking the gateway or another artifact with them; secrets reach server code by
 * name and never anything Mostra keeps; live sources flow without durable events.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializeAll, type EventRecord, type Frame } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ActionPage,
  clientKey,
  FakeMail,
  openPage,
  type RunState,
  resultOf,
} from "../action-page.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import { connectTo, eventually, initializeParams, tempDir } from "../support.ts";

const MAIL_TOKEN = "tok-live-9f8e7d6c5b4a";

/** `@mostra/worker`'s built entry, which both launchers run. */
const WORKER_MAIN = fileURLToPath(new URL("../../../worker/dist/main.js", import.meta.url));
const WORKER_HOST = fileURLToPath(new URL("../fixtures/worker-host.mjs", import.meta.url));
/** The warm set's layout, which a version without on-demand packages resolves from (D135). */
const WARM = realpathSync(fileURLToPath(new URL("../../../warm/node_modules", import.meta.url)));

/** Starts the separately started worker host (D124) for a home, and waits until it listens. */
async function startWorkerHost(home: string): Promise<{ socket: string; process: ChildProcess }> {
  const socket = join(tempDir("wh", true), "host.sock");
  const child = spawn(
    process.execPath,
    [WORKER_HOST, "--socket", socket, "--home", home, "--worker", WORKER_MAIN, "--warm", WARM],
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
        // The supervisor's own environment, which no worker may inherit (D124, AC-06).
        MOSTRA_TEST_SUPERVISOR_ONLY: "supervisor-only-value",
        GITHUB_TOKEN: "ghp_supervisor_environment_token",
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
    // A host sees which viewer's call raised them (pages see only their own, Opus review 4).
    expect(events[1]?.payload).toMatchObject({
      name: "reply-sent",
      source: "action",
      payload: { id: 7 },
      viewerId: expect.stringMatching(/^vwr_/),
    });
    expect(events[2]?.payload).toEqual({
      data: { id: 7 },
      viewerId: expect.stringMatching(/^vwr_/),
    });
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
    // Progress and a live source's error are output too (GPT review findings 2 and 3).
    const progressed = (await page.run("actions.ts#progressLeak", [])).json<RunState>();
    let seenProgress: string | undefined;
    await eventually(async () => {
      const [now] = (await page.attach({ runIds: [progressed.runId] })).json<{
        runs: RunState[];
      }>().runs;
      seenProgress = now?.progress?.message;
      return seenProgress !== undefined;
    });
    expect(seenProgress).toBe("using [redacted]");
    expect((await page.settled(progressed.runId)).progress?.message).toBe("using [redacted]");
    let failure: { code?: string; message?: string } | undefined;
    await eventually(async () => {
      failure = (await page.live([{ key: "failing" }])).json<{
        sources: { error?: { code?: string; message?: string } }[];
      }>().sources[0]?.error;
      return failure !== undefined;
    });
    expect(failure?.message).toContain("upstream refused [redacted]");
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
        limit: 1000,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(MAIL_TOKEN);
    // The value only lives in the owner-only store: 0600 files in 0700 directories (D44).
    const stored = join(gateway.home.home, "secrets", actions.artifactId, "MAIL_TOKEN");
    expect(readFileSync(stored, "utf8")).toBe(MAIL_TOKEN);
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    expect(statSync(join(gateway.home.home, "secrets", actions.artifactId)).mode & 0o777).toBe(
      0o700,
    );
    expect(statSync(join(gateway.home.home, "secrets")).mode & 0o777).toBe(0o700);
  });

  it("gives server code no secret through its environment: only by name, through Mostra (D124)", async () => {
    const page = await openPage(actions.url);
    const seen = (await page.call("actions.ts#environment", [])).value as {
      env: Record<string, string>;
      argv: string[];
    };
    const env = seen.env;
    // Nor anything of the browser's: the link's secret, the session cookies, the CSRF token (D38).
    const secret = actions.url.split("#t=")[1] as string;
    const cookies = page.browser
      .cookiesFor(`${page.opened.frameOrigin}/`)
      .split("; ")
      .map((pair) => pair.split("=")[1] ?? "")
      .filter((value) => value.length > 0);
    const visible = JSON.stringify(seen);
    for (const value of [secret, page.opened.frameCsrf, ...cookies]) {
      expect(visible).not.toContain(value);
    }
    expect(cookies.length).toBeGreaterThan(0);
    expect(Object.keys(env)).not.toContain("MOSTRA_TEST_SUPERVISOR_ONLY");
    expect(Object.keys(env)).not.toContain("GITHUB_TOKEN");
    expect(JSON.stringify(env)).not.toContain(MAIL_TOKEN);
    expect(JSON.stringify(env)).not.toContain("ghp_supervisor_environment_token");
    // Nothing was hidden on the way either: the environment never held a secret to redact.
    expect(JSON.stringify(env)).not.toContain("[redacted]");
    // The same code reads the secret by name.
    expect((await page.call("actions.ts#holds", ["MAIL_TOKEN", MAIL_TOKEN])).value).toBe(true);
  });

  it("redacts a secret written into the home's store by hand while it ran (AC-06)", async () => {
    const dir = join(gateway.home.home, "secrets", "home");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "HAND_SET"), "hand-written-value-123", { mode: 0o600 });
    const page = await openPage(actions.url);
    expect(
      (await page.call("actions.ts#holds", ["HAND_SET", "hand-written-value-123"])).value,
    ).toBe(true);
    expect((await page.call("actions.ts#named", ["HAND_SET"])).value).toBe("[redacted]");
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
    // Nor can it follow a run of another function, even knowing its ID (GPT review finding 1):
    // it isn't attached, its updates never reach the narrow page, and it can't be cancelled.
    const full = await openPage(actions.url);
    const other = (
      await full.run("actions.ts#slow", [1500], `scoped.${Date.now()}`)
    ).json<RunState>();
    const polled = (await narrow.poll()).json<{ cursor: string }>();
    expect(
      (await narrow.attach({ runIds: [other.runId] })).json<{ runs: RunState[] }>().runs,
    ).toEqual([]);
    expect(
      (await narrow.attach({ keyed: [{ fnId: "actions.ts#slow", key: other.key ?? "" }] })).status,
    ).toBe(403);
    expect((await narrow.cancel(other.runId)).status).not.toBe(200);
    expect((await full.settled(other.runId)).status).toBe("succeeded");
    const heard = (await narrow.poll(polled.cursor, 1)).json<{ ephemeral?: unknown[] }>();
    expect(JSON.stringify(heard.ephemeral ?? [])).not.toContain(other.runId);
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

  /** The PIDs of the instance's workers, by version. */
  const workerPids = async (): Promise<Record<string, number | undefined>> =>
    Object.fromEntries(
      (
        ok<{ workers?: { versionId: string; pid?: number }[] }>(
          await gateway.client.call("instance/status", {}),
        ).workers ?? []
      ).map((worker) => [worker.versionId, worker.pid]),
    );

  it("refuses a symbol, an iterable or a huge bigint argument before any worker or run (Opus review 1)", async () => {
    const page = await openPage(actions.url);
    const before = workerPids();
    for (const root of [["$Sname"], ["$x1"], [`$n${"9".repeat(20_000)}`]]) {
      const args = [[{ c: 0, v: root }]];
      const call = await page.post("call/actions.ts%23echo", { viewId: page.opened.viewId, args });
      expect(call.status).toBe(400);
      expect(call.json<{ code: string }>().code).toBe("MOSTRA_ACTION_UNSERIALIZABLE");
      const key = `bad.${Date.now()}.${Math.random()}`;
      const run = await page.post("runs", {
        viewId: page.opened.viewId,
        fnId: "actions.ts#echo",
        args,
        key,
        clientKey: clientKey(),
      });
      expect(run.status).toBe(400);
      // Nothing was recorded: the key is still free.
      const found = (await page.attach({ keyed: [{ fnId: "actions.ts#echo", key }] })).json<{
        runs: RunState[];
      }>();
      expect(found.runs).toEqual([]);
    }
    expect(await workerPids()).toEqual(await before);
  });

  it("ends a run its action finished despite a cancel as succeeded, with its result (Opus review 3)", async () => {
    const page = await openPage(actions.url);
    const started = (await page.run("actions.ts#stubborn", [800])).json<RunState>();
    await eventually(async () => {
      const state = (await page.attach({ runIds: [started.runId] })).json<{ runs: RunState[] }>()
        .runs[0];
      return state?.status === "running";
    });
    expect((await page.cancel(started.runId)).status).toBe(200);
    const done = await page.settled(started.runId);
    expect(done.status).toBe("succeeded");
    expect(await resultOf(done)).toBe("sent anyway");
    // A plain call the same.
    expect((await page.call("actions.ts#stubborn", [10])).end).toEqual({ status: "succeeded" });
  });

  it("shows a page no other viewer's action events, signals or host events (Opus review 4)", async () => {
    const mine = await openPage(actions.url);
    const viewOnly = await openPage(
      (await gateway.link(actions.artifactId, { viewer: { ref: "vera" }, scopes: ["view"] })).url,
    );
    const { cursor } = (await viewOnly.poll()).json<{ cursor: string }>();
    const keyless = (await mine.run("actions.ts#raise", [])).json<RunState>();
    await mine.settled(keyless.runId);
    expect((await mine.call("actions.ts#raise", [])).end).toEqual({ status: "succeeded" });
    const seenBy = async (page: ActionPage): Promise<EventRecord[]> =>
      page.poll(cursor).then((answer) => answer.json<{ events: EventRecord[] }>().events);
    const theirs = await seenBy(viewOnly);
    expect(theirs.filter((event) => /^(action\.|host\.)/.test(event.type))).toEqual([]);
    expect(theirs.filter((event) => event.type === "signal.raised")).toEqual([]);
    // The page whose calls raised them sees its own, without anyone's viewer ID.
    const own = await seenBy(mine);
    expect(own.map((event) => event.type)).toEqual(
      expect.arrayContaining(["action.started", "action.succeeded", "signal.raised"]),
    );
    expect(own.some((event) => event.type.startsWith("host."))).toBe(false);
    expect(JSON.stringify(own)).not.toContain('"viewerId"');
  });

  it("refuses a function its version doesn't have, recording nothing (Opus review 6)", async () => {
    const page = await openPage(actions.url);
    const call = await page.call("actions.ts#doesNotExist", []);
    expect(call.status).toBe(404);
    const key = `missing.${Date.now()}`;
    const run = await page.post("runs", {
      viewId: page.opened.viewId,
      fnId: "actions.ts#doesNotExist",
      args: [[{ c: 0, v: [] }]],
      key,
      clientKey: clientKey(),
    });
    expect(run.status).toBe(404);
    expect(run.json<{ code: string }>().code).toBe("MOSTRA_ACTION_UNKNOWN_FUNCTION");
    const found = (await page.attach({ keyed: [{ fnId: "actions.ts#doesNotExist", key }] })).json<{
      runs: RunState[];
    }>();
    expect(found.runs).toEqual([]);
  });

  it("never joins a client key to a run of another function (Opus review 9)", async () => {
    const page = await openPage(actions.url);
    const narrow = await openPage(
      (await gateway.link(actions.artifactId, { scopes: ["view", "action:echo"] })).url,
    );
    const ck = clientKey();
    const slow = (await page.run("actions.ts#slow", [5_000], undefined, ck)).json<RunState>();
    const joined = await narrow.run("actions.ts#echo", [], undefined, ck);
    expect(joined.status).toBe(400);
    expect(joined.body).not.toContain(slow.runId);
    expect((await page.cancel(slow.runId)).status).toBe(200);
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
