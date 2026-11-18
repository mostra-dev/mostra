/**
 * What an idle hosted home writes (MT-05; DATA_MODEL §7.1, INTERFACES §18.2): a real
 * `mostra-runtime server` with a real owner instance linked and its page shared. While nothing
 * happens, the server's directory takes no transaction at all, as a WAL replicator reading it from
 * its own process sees (`PRAGMA data_version`); a submission moves the home's head and a relayed
 * run its relay mark, and the next tick writes each to `home_cursor`; at the server's stop the
 * row holds the home's marks. (A restore still rotates the home's incarnation from the marks:
 * `binding.test.ts` and `restore.test.ts`.)
 */
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPage } from "../action-page.ts";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { control } from "../operator-support.ts";
import {
  deviceSignIn,
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  send,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const FIXTURES = new URL("../fixtures/artifacts/", import.meta.url);
/** The marker's tick in this suite (10 s in production). */
const TICK_MS = 100;

interface Marks {
  readonly incarnation: string;
  readonly high_cursor: number;
  readonly relay_high: number;
  readonly updated_at: string;
}

describe("what an idle hosted home writes (MT-05)", () => {
  let port: number;
  let server: RunningServer;
  const data = join(tempDir("idle-marks-data"), "data");
  const owner = new GatewayHome();
  let url = "";
  let directory: Database.Database;
  let home: Database.Database;

  /** The directory's commits a replicator has seen since the last look, at most one a look. */
  let seen = 0;
  const committed = (): boolean => {
    const now = directory.pragma("data_version", { simple: true }) as number;
    const moved = now !== seen;
    seen = now;
    return moved;
  };
  const marks = (): Marks =>
    directory.prepare("SELECT * FROM home_cursor").get() as unknown as Marks;
  const head = (): number =>
    (home.prepare("SELECT MAX(cursor) AS head FROM event").get() as { head: number }).head;
  const relayHigh = (): number =>
    (home.prepare("SELECT MAX(relay_seq) AS high FROM relay_run").get() as { high: number | null })
      .high ?? 0;

  /** Thirty ticks with nothing happening: no transaction in the directory, the row unchanged. */
  const quiet = async (): Promise<void> => {
    const before = marks();
    committed();
    for (let tick = 0; tick < 30; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, TICK_MS));
      expect(committed(), `a commit at tick ${tick}`).toBe(false);
    }
    expect(marks()).toEqual(before);
  };

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({
      data,
      port,
      config: testConfig(port),
      env: { MOSTRA_TEST_CURSOR_MARK_MS: String(TICK_MS) },
    });
    expect(server.status.status, server.stderr()).toBe("started");
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    const dir = join(tempDir("idle-marks-artifact"), "idle");
    cpSync(new URL("actions", FIXTURES), dir, { recursive: true });
    writeFileSync(
      join(dir, "index.tsx"),
      `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Idle",
  submission: { policy: "epochs" },
  hosted: { actions: "link" },
});

export default function Page() {
  const [answer, setAnswer] = useField("answer", "");
  return <input value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
`,
    );
    const artifactId = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    ).artifactId;
    url = ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }, 60_000),
    ).url;
    // A replicator's view of the server's databases, from connections of its own.
    directory = new Database(join(data, "server.sqlite"), { readonly: true });
    const homePath = (
      directory.prepare("SELECT data_path FROM home").get() as { data_path: string }
    ).data_path;
    home = new Database(join(data, homePath, "store", "ledger.sqlite"), { readonly: true });
    // The share's own writes have settled once the row holds the head.
    await eventually(async () => marks()?.high_cursor === head(), 10_000);
  }, 240_000);

  let stopped = false;
  afterAll(async () => {
    if (home?.open) home.close();
    directory?.close();
    if (!stopped) {
      await owner.stop();
      await stopServer(server);
    }
  });

  it("takes no transaction while nothing happens, the owner linked and its page shared", async () => {
    await quiet();
  }, 30_000);

  it("writes a moved head and a moved relay mark at the next tick, then is quiet again", async () => {
    // A submission appends events to the hosted home: its head moves.
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value: "yes" }],
      },
      csrf: opened.frameCsrf,
    });
    expect(fields.status, fields.body).toBe(200);
    const submitted = await browser.fetchJson(
      opened.link.shell,
      `${new URL(url).pathname}/_mostra/v/${REVISION}/submit`,
      {
        body: {
          viewId: opened.viewId,
          expectedRevision: fields.json<{ revision: string }>().revision,
        },
        csrf: opened.shellCsrf,
      },
    );
    expect(submitted.status, submitted.body).toBe(200);
    const before = marks();
    await eventually(async () => marks().high_cursor === head(), 5_000);
    expect(marks().high_cursor).toBeGreaterThan(before.high_cursor);
    expect(marks().incarnation).toBe(before.incarnation);

    // A relayed run takes the next relay sequence: the relay mark moves.
    const page = await openPage(url);
    const run = await page.run("actions.ts#echo", ["hello"]);
    expect(run.status, run.body).toBe(200);
    expect((await page.settled(run.json<{ runId: string }>().runId)).status).toBe("succeeded");
    expect(relayHigh()).toBeGreaterThan(0);
    await eventually(
      async () => marks().relay_high === relayHigh() && marks().high_cursor === head(),
      5_000,
    );

    // Its pages left open and nothing else happening, the directory is quiet again.
    await quiet();
  }, 120_000);

  it("holds the home's marks once the server stops", async () => {
    const reached = { high_cursor: head(), relay_high: relayHigh() };
    home.close();
    stopped = true;
    await owner.stop();
    await stopServer(server);
    expect(marks()).toMatchObject(reached);
  }, 60_000);
});

describe("an operator's metering window on a real server (MT-06, #203)", () => {
  it("closes one window on every multiple of the operator's window, one batch each, and writes the directory only then", async () => {
    const port = await freePort();
    const controlPort = await freePort();
    const data = join(tempDir("meter-window-data"), "data");
    const windowMs = 2_000;
    const server = await startServer({
      data,
      port,
      config: testConfig(port, {
        operator: fileURLToPath(new URL("../fixtures/operator.mjs", import.meta.url)),
        metering: { windowSeconds: windowMs / 1000 },
      }),
      env: {
        MOSTRA_TEST_OPERATOR_PORT: String(controlPort),
        MOSTRA_TEST_OPERATOR_DISPATCH_MS: "50",
      },
    });
    try {
      expect(server.status.status, server.stderr()).toBe("started");
      const operator = control(controlPort);
      // A person links a machine, which makes their home; a request on it opens it (a version
      // file no push asked for: refused, the home open all the same).
      const signed = await deviceSignIn(port, "Ada");
      const upload = await send(port, `api.localhost:${port}`, `/files/${"0".repeat(64)}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${signed.accessToken}` },
        body: "x",
      });
      expect(upload.status, upload.body).toBe(409);
      const directory = new Database(join(data, "server.sqlite"), { readonly: true });
      try {
        // Watch the directory's commits over five windows while the open home stays idle.
        let version = directory.pragma("data_version", { simple: true }) as number;
        let commits = 0;
        const until = Date.now() + 5 * windowMs + 500;
        while (Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          const now = directory.pragma("data_version", { simple: true }) as number;
          if (now !== version) commits += 1;
          version = now;
        }
        const batches = (await operator.calls("metering")).map(
          (call) => call.payload as unknown as { from: string; to: string },
        );
        expect(batches.length).toBeGreaterThanOrEqual(4);
        for (const batch of batches) {
          // Every window ends on a multiple of its length; every window but the first starts on one.
          expect(Date.parse(batch.to) % windowMs, batch.to).toBe(0);
        }
        for (const batch of batches.slice(1)) {
          expect(Date.parse(batch.from) % windowMs, batch.from).toBe(0);
          expect(Date.parse(batch.to) - Date.parse(batch.from)).toBe(windowMs);
        }
        // Each window queues its batch and drops it once the operator took it: two commits a
        // window at most, nothing between.
        expect(commits).toBeLessThanOrEqual(2 * (batches.length + 1));
      } finally {
        directory.close();
      }
    } finally {
      await stopServer(server);
    }
  }, 60_000);
});
