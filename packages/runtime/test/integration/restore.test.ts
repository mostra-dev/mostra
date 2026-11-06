/**
 * A hosted home restored from a lagging copy (WP-29, RM-02; INTERFACES §18.2, FAILURE_MODEL §11.2):
 * the whole data directory is copied while the server serves, traffic goes on, and the copy is put
 * back with no restore call. When the owner instance reconnects, its committed cursor and relay mark
 * are above what the home holds, so the home rotates its incarnation before answering; the owner
 * keeps everything it imported, follows on and records the regression; an update for a run the
 * restored home no longer knows is dropped and logged; and a viewer whose cursor is above the
 * restored head gets a fresh snapshot.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MutationId } from "@mostra/protocol";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ActionPage, openPage } from "../action-page.ts";
import { Browser, type Opened, openLink } from "../browser-client.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { eventually, removeAll, tempDir } from "../support.ts";

const REVISION = "2026-10-15";
const FIXTURES = new URL("../fixtures/artifacts/", import.meta.url);

/** Copies a live data directory as a backup tool would: each ledger through SQLite's own backup. */
async function lagging(data: string, into: string): Promise<void> {
  const walk = async (from: string, to: string): Promise<void> => {
    mkdirSync(to, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isDirectory()) await walk(source, target);
      else if (entry.name.endsWith(".lock") || /\.sqlite-(wal|shm)$/.test(entry.name)) continue;
      else if (entry.name.endsWith(".sqlite")) {
        const db = new Database(source, { readonly: true, fileMustExist: true });
        try {
          await db.backup(target);
        } finally {
          db.close();
        }
      } else cpSync(source, target);
    }
  };
  await walk(data, into);
}

describe("a hosted home restored from a lagging copy (§18.2)", () => {
  let port: number;
  let server: RunningServer;
  const data = join(tempDir("restore-data"), "data");
  const backup = join(tempDir("restore-backup"), "data");
  const owner = new GatewayHome();
  let artifactId = "";
  let url = "";

  const start = async (): Promise<void> => {
    server = await startServer({
      data,
      port,
      config: testConfig(port),
      env: { MOSTRA_TEST_RELAY_SWEEP_MS: "200" },
    });
  };

  /** One respondent's answer, submitted through the trusted Submit. */
  const answer = async (
    value: string,
  ): Promise<{ id: string; browser: Browser; opened: Opened }> => {
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
    return { id: submitted.json<{ id: string }>().id, browser, opened };
  };
  const imported = async (id: string): Promise<void> =>
    eventually(async () => {
      const read = await owner.client.call("results/get", {
        artifact: { artifactId },
        submission: id,
      });
      return (read as { result?: unknown }).result !== undefined;
    }, 30_000);

  beforeAll(async () => {
    port = await freePort();
    await start();
    // The owner's relay updates wait for a binding that is coming back, so one sent after the
    // restore meets a home that no longer knows its run.
    await owner.start({ env: { ...ownerEnv(port), MOSTRA_TEST_RELAY_READY_MS: "60000" } });
    await ownerSignIn(owner.client, port, "Ada");
    const dir = join(tempDir("restore-artifact"), "rounds");
    cpSync(new URL("actions", FIXTURES), dir, { recursive: true });
    writeFileSync(
      join(dir, "index.tsx"),
      `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({
  title: "Restore",
  submission: { policy: "epochs" },
  hosted: { actions: "link" },
});

export default function Page() {
  const [answer, setAnswer] = useField("answer", "");
  return <input value={answer} onChange={(event) => setAnswer(event.target.value)} />;
}
`,
    );
    artifactId = ok<{ artifactId: string }>(
      await owner.client.call("artifact/publish", { source: { path: dir } }, 120_000),
    ).artifactId;
    url = ok<{ url: string }>(
      await owner.client.call("share/start", { artifact: { artifactId }, via: "remote" }),
    ).url;
  }, 240_000);

  afterAll(async () => {
    await owner.stop();
    await stopServer(server);
  });

  it("rotates on its owner's word, keeps the owner whole, and gives a page past its head a snapshot", async () => {
    const first = await answer("before the backup");
    await imported(first.id);
    const viewer = await answer("a viewer who stays");

    // The backup is taken while the server serves; traffic goes on after it.
    await lagging(data, backup);
    const second = await answer("after the backup");
    await imported(second.id);
    const pollAfter = await viewer.browser.fetchJson(
      viewer.opened.link.shell,
      `${new URL(url).pathname}/_mostra/v/${REVISION}/events/poll?view=${viewer.opened.viewId}&wait=0`,
    );
    const viewerCursor = pollAfter.json<{ cursor: string }>().cursor;
    // A run the owner accepts after the backup, still running when the server goes.
    const page: ActionPage = await openPage(url);
    const slow = await page.run("actions.ts#slow", [3000]);
    expect(slow.status, slow.body).toBe(200);
    const runId = slow.json<{ runId: string }>().runId;
    await eventually(async () => {
      const state = (await page.attach({ runIds: [runId] })).json<{ runs: { status: string }[] }>()
        .runs[0];
      return state?.status === "running";
    }, 15_000);

    // The machine is lost; the lagging copy comes back, with no restore call.
    await stopServer(server);
    removeAll(data);
    cpSync(backup, data, { recursive: true });
    await start();
    // The viewer who read past the restored head starts from a fresh snapshot.
    const resumed = await viewer.browser.fetchJson(
      viewer.opened.link.shell,
      `${new URL(url).pathname}/_mostra/v/${REVISION}/events/poll?view=${viewer.opened.viewId}&cursor=${viewerCursor}&wait=0`,
    );
    expect(resumed.status, resumed.body).toBe(200);
    expect(resumed.json<{ snapshot?: unknown }>().snapshot).toBeDefined();

    // The owner reconnects, and the home rotates: the owner records the regression.
    await eventually(async () => {
      const events = ok<{ events: { type: string }[] }>(
        await owner.client.call("events/read", { filter: { types: ["remote.*"] } }),
      ).events;
      return events.some((event) => event.type === "remote.regressed");
    }, 60_000);
    // It kept what it imported, and follows on: a new answer reaches it.
    await imported(second.id);
    const third = await answer("after the restore");
    await imported(third.id);
    // The run's end, sent after the reconnect, met a home that no longer knew it: dropped, logged.
    await eventually(() => {
      const logs = join(data, "logs");
      return readdirSync(logs).some((file) =>
        readFileSync(join(logs, file), "utf8").includes("relay.update_dropped"),
      );
    }, 30_000);
  }, 240_000);

  it("reads a submission its owner lost to a restore again, and imports it once", async () => {
    // The owner's home is backed up, takes an answer, then is restored to the backup: the
    // hosted home already counts that delivery done, so the owner finds the answer by
    // following it and reads it again (FAILURE_MODEL §11.2).
    const store = join(owner.home.home, "store");
    const saved = join(tempDir("owner-backup"), "store");
    await owner.stop();
    cpSync(store, saved, { recursive: true });
    await owner.start({ env: ownerEnv(port) });
    const lost = await answer("lost to the restore");
    await imported(lost.id);
    const first = ok<{ submission: { digest: string } }>(
      await owner.client.call("results/get", { artifact: { artifactId }, submission: lost.id }),
    );
    await owner.stop();
    removeAll(store);
    cpSync(saved, store, { recursive: true });
    await owner.start({ env: ownerEnv(port) });
    await imported(lost.id);
    const results = ok<{ submission: { digest: string; origin?: unknown } }>(
      await owner.client.call("results/get", { artifact: { artifactId }, submission: lost.id }),
    );
    // The same immutable submission: its digest is its snapshot's.
    expect(results.submission.digest).toBe(first.submission.digest);
    expect(results.submission.origin).toBeDefined();
    // Once: a repeated follow imports nothing more.
    const events = ok<{ events: { payload: { submissionId?: string } }[] }>(
      await owner.client.call("events/read", { filter: { types: ["submission.created"] } }),
    ).events;
    expect(events.filter((event) => event.payload.submissionId === lost.id)).toHaveLength(1);
    const log = readdirSync(join(owner.home.home, "logs"))
      .map((name) => readFileSync(join(owner.home.home, "logs", name), "utf8"))
      .join("");
    expect(log).toContain("link.submission_reimported");
  }, 180_000);
});
