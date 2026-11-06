/**
 * A hosted home's ledger under a backup replicator, and how fast a closed home opens (WP-29;
 * D165 items 0b and 6, DATA_MODEL §7.2):
 * - Litestream (Apache-2.0, a test tool, never shipped) replicates a live hosted ledger from its
 *   own process while the server keeps taking answers, and the replica restores with them all.
 *   It runs where `MOSTRA_TEST_LITESTREAM` names the binary; elsewhere it is skipped, saying so.
 * - A home closed for idleness opens on its next request in under 250 ms at the 95th percentile
 *   (measured and printed; CI's slower runners are held to 500 ms).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
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
const LITESTREAM = process.env["MOSTRA_TEST_LITESTREAM"];
const FIXTURES = new URL("../fixtures/artifacts/", import.meta.url);

describe("a hosted home's ledger and its open time (D165 items 0b, 6)", () => {
  let port: number;
  let server: RunningServer;
  const data = join(tempDir("replica-data"), "data");
  const owner = new GatewayHome();
  let url = "";
  let replicator: ChildProcess | undefined;

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({
      data,
      port,
      // A replicator asks for checkpoints of its own (VERIFIED_FACTS, WP-28); homes close fast.
      config: {
        ...testConfig(port),
        ledger: { walAutocheckpoint: 0 },
        homes: { idleCloseMinutes: 0.01 },
      },
    });
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    const dir = join(tempDir("replica-artifact"), "rounds");
    cpSync(new URL("single-tsx", FIXTURES), dir, { recursive: true });
    writeFileSync(
      join(dir, "page.tsx"),
      `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({ title: "Rounds", submission: { policy: "epochs" } });

export default function Page() {
  const [answer, setAnswer] = useField("answer", "");
  return <input value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
`,
    );
    const artifactId = ok<{ artifactId: string }>(
      await owner.client.call(
        "artifact/publish",
        { source: { path: join(dir, "page.tsx") } },
        120_000,
      ),
    ).artifactId;
    url = ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
    ).url;
  }, 240_000);

  afterAll(async () => {
    replicator?.kill("SIGTERM");
    await owner.stop();
    await stopServer(server);
  });

  const answer = async (value: string): Promise<number> => {
    const browser = new Browser();
    const opened = await openLink(browser, url);
    const fields = await browser.fetchJson(opened.frameOrigin, `/_mostra/v/${REVISION}/fields`, {
      body: {
        mutationId: MutationId.create(),
        scope: "viewer",
        baseRevision: "0",
        viewId: opened.viewId,
        ops: [{ id: "answer", value }],
      },
      csrf: opened.frameCsrf,
    });
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
    return submitted.status;
  };

  it.skipIf(LITESTREAM === undefined)(
    "is read by a backup replicator while it serves, and its replica restores with every answer",
    async () => {
      expect(await answer("first")).toBe(200);
      const homes = join(data, "homes");
      const [home] = readdirSync(homes);
      const ledger = join(homes, home as string, "store", "ledger.sqlite");
      expect(existsSync(ledger)).toBe(true);
      const replica = `file://${join(tempDir("replica"), "replica")}`;
      replicator = spawn(LITESTREAM as string, ["replicate", ledger, replica], { stdio: "ignore" });
      // The server keeps taking answers while the replicator holds its read transaction.
      for (let n = 0; n < 10; n += 1) expect(await answer(`answer ${n}`)).toBe(200);
      const restored = join(tempDir("replica-restored"), "ledger.sqlite");
      await eventually(() => {
        try {
          execFileSync(LITESTREAM as string, ["restore", "-o", restored, replica], {
            stdio: "ignore",
          });
        } catch {
          return false;
        }
        const db = new Database(restored, { readonly: true });
        try {
          const count = db.prepare("SELECT COUNT(*) AS n FROM submission").get() as { n: number };
          return count.n >= 11;
        } finally {
          db.close();
        }
      }, 30_000);
    },
    120_000,
  );

  it("opens a home closed for idleness in under 250 ms at the 95th percentile", async () => {
    // Nothing keeps the home open: no owner binding, no views.
    await owner.stop();
    const path = new URL(url).pathname;
    const host = new URL(url).host;
    const times: number[] = [];
    for (let n = 0; n < 20; n += 1) {
      // Closed after 0.6 s idle, swept every 150 ms: measured only once the home is closed.
      await eventually(async () => {
        const health = await send(port, `api.localhost:${port}`, "/health");
        return JSON.parse(health.body).homes === 0;
      }, 10_000);
      const started = performance.now();
      const reply = await send(port, host, path);
      times.push(performance.now() - started);
      expect(reply.status).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] as number;
    console.log(
      `hosted home open time: p50 ${times[9]?.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times.at(-1)?.toFixed(1)} ms`,
    );
    expect(p95).toBeLessThan(process.env["CI"] ? 500 : 250);
    await owner.start({ env: ownerEnv(port) });
  }, 120_000);
});
