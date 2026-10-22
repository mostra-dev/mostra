/**
 * A failed publish leaves no visible version (VR-02, FAILURE_MODEL §2, §3): a fault injected at
 * every publish step, as a crash (SIGKILL) or a thrown error, and a builder that crashes or hangs.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  connectTo,
  eventually,
  initializeParams,
  KILLED,
  type LineClient,
  type Message,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
} from "../support.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/artifacts/directory", import.meta.url));

function artifact(): string {
  const dir = join(tempDir("fault-art"), "dashboard");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const entries = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
/** Every file under `sources/`, which holds one directory per artifact. */
const snapshots = (home: TestHome): string[] =>
  entries(join(home.home, "sources")).flatMap((artifactDir) =>
    entries(join(home.home, "sources", artifactDir)),
  );
const storeState = (home: TestHome) => ({
  versions: entries(join(home.home, "versions")),
  snapshots: snapshots(home),
  staging: entries(join(home.home, "cache/staging")),
});

async function session(home: TestHome, faults?: string, extra: NodeJS.ProcessEnv = {}) {
  const env = { ...home.env, ...extra, ...(faults ? { MOSTRA_TEST_FAULTS: faults } : {}) };
  const daemon = await startDaemon(home, { env });
  const client = await connectTo(daemon.status.socket as string);
  const init = await client.call("mostra/initialize", initializeParams());
  expect(init.error).toBeUndefined();
  return { daemon, client };
}

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

async function stop(client: LineClient, exited: Promise<unknown>): Promise<void> {
  await client.call("mostra/shutdown", {});
  await exited;
}

/** The publish steps of ARCHITECTURE §3 that can fail before the version is visible. */
const POINTS = [
  "publish:after-snapshot",
  "publish:after-digests",
  "publish:after-build",
  "publish:after-archive",
  "publish:after-promote",
  "publish:in-commit",
] as const;

describe("a crash at any publish step leaves no visible version (VR-02)", () => {
  for (const point of POINTS) {
    it(`recovers from a crash at ${point}`, async () => {
      const home = testHome();
      const source = artifact();
      const crashing = await session(home, `${point}:crash`);
      crashing.client.sendRaw(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "artifact/publish",
          params: { source: { path: source } },
        }),
      );
      expect(await crashing.daemon.exited).toEqual(KILLED);

      // The crash left work in progress behind: staging, and from the archive step on, store files.
      const left = storeState(home);
      expect(left.staging.length).toBe(1);
      if (point === "publish:after-promote" || point === "publish:in-commit") {
        expect(left.versions.length).toBe(1);
      }
      if (
        point !== "publish:after-snapshot" &&
        point !== "publish:after-digests" &&
        point !== "publish:after-build"
      ) {
        expect(left.snapshots.length).toBe(1);
      }

      // The next start finds no version and removes every leftover.
      const next = await session(home);
      expect(result(await next.client.call("artifact/list", {}))).toEqual({ artifacts: [] });
      expect(storeState(home)).toEqual({ versions: [], snapshots: [], staging: [] });
      const receipt = result(
        await next.client.call("artifact/publish", { source: { path: source } }),
      );
      expect(receipt).toMatchObject({ version: 1, reused: false });
      await stop(next.client, next.daemon.exited);
    });
  }

  it("replays the committed receipt for a requestId retried after a crash (H-03)", async () => {
    const home = testHome();
    const source = artifact();
    const params = { source: { path: source }, requestId: "req-crash" };
    const crashing = await session(home, "publish:after-commit:crash");
    crashing.client.sendRaw(
      JSON.stringify({ jsonrpc: "2.0", id: 99, method: "artifact/publish", params }),
    );
    await crashing.daemon.exited;
    const next = await session(home);
    const replay = result(await next.client.call("artifact/publish", params));
    // The first attempt's receipt, never a "reused" one: the response the client missed.
    expect(replay).toMatchObject({ version: 1, reused: false });
    await stop(next.client, next.daemon.exited);
  });

  it("keeps a version committed just before a crash, and publishes it again as reused", async () => {
    const home = testHome();
    const source = artifact();
    const crashing = await session(home, "publish:after-commit:crash");
    crashing.client.sendRaw(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "artifact/publish",
        params: { source: { path: source } },
      }),
    );
    await crashing.daemon.exited;
    const next = await session(home);
    const listed = result(await next.client.call("artifact/list", {})) as { artifacts: unknown[] };
    expect(listed.artifacts).toHaveLength(1);
    expect(storeState(home)).toMatchObject({ staging: [] });
    expect(storeState(home).versions).toHaveLength(1);
    const again = result(await next.client.call("artifact/publish", { source: { path: source } }));
    expect(again).toMatchObject({ version: 1, reused: true });
    await stop(next.client, next.daemon.exited);
  });
});

describe("a failure at any publish step leaves no visible version and nothing behind (VR-02)", () => {
  for (const point of POINTS) {
    it(`cleans up after a failure at ${point}`, async () => {
      const home = testHome();
      const source = artifact();
      const { daemon, client } = await session(home, `${point}:throw`);
      const response = await client.call("artifact/publish", { source: { path: source } });
      expect(response.error?.data.code).toBe("MOSTRA_HOST_INTERNAL_ERROR");
      expect(result(await client.call("artifact/list", {}))).toEqual({ artifacts: [] });
      expect(storeState(home)).toEqual({ versions: [], snapshots: [], staging: [] });
      await stop(client, daemon.exited);
    });
  }
});

describe("artifact/create retried after a crash (H-03, review finding 4)", () => {
  it("completes the creation the first attempt recorded", async () => {
    const home = testHome();
    const dir = join(tempDir("create-crash"), "plan");
    const params = { dir, title: "Plan", requestId: "create-1" };
    const crashing = await session(home, "create:after-record:crash");
    crashing.client.sendRaw(
      JSON.stringify({ jsonrpc: "2.0", id: 98, method: "artifact/create", params }),
    );
    await crashing.daemon.exited;
    expect(existsSync(join(dir, "index.tsx"))).toBe(false);

    const next = await session(home);
    const created = result(await next.client.call("artifact/create", params)) as {
      artifactId: string;
      dir: string;
    };
    expect(readFileSync(join(dir, "index.tsx"), "utf8")).toContain(created.artifactId);
    // A write cut short is completed too, and the same request keeps answering the same.
    writeFileSync(
      join(dir, "index.tsx"),
      readFileSync(join(dir, "index.tsx"), "utf8").slice(0, 40),
    );
    expect(result(await next.client.call("artifact/create", params))).toEqual(created);
    expect(readFileSync(join(dir, "index.tsx"), "utf8")).toContain('title: "Plan"');
    // And the artifact publishes with that identity.
    const receipt = result(await next.client.call("artifact/publish", { source: { path: dir } }));
    expect(receipt).toMatchObject({ artifactId: created.artifactId });
    await stop(next.client, next.daemon.exited);
  });
});

describe("builder failures (FAILURE_MODEL §2, §9)", () => {
  async function builderPid(client: LineClient): Promise<number> {
    let pid = 0;
    await eventually(
      async () => {
        const status = result(await client.call("instance/status")) as {
          processes: { pid: number; kind: string }[];
        };
        pid = status.processes.find((child) => child.kind === "builder")?.pid ?? 0;
        return pid > 0;
      },
      30_000,
      "a builder child",
    );
    return pid;
  }

  it("reports a builder that dies as MOSTRA_BUILD_CRASHED, and publishes nothing", async () => {
    const home = testHome();
    // Held before it builds (a fault point), so the build can't finish before it is killed.
    const { daemon, client } = await session(home, undefined, {
      MOSTRA_TEST_FAULTS: "builder:build:hang",
    });
    const publishing = client.call("artifact/publish", { source: { path: artifact() } });
    process.kill(await builderPid(client), "SIGKILL");
    const response = await publishing;
    expect(response.error?.data.code).toBe("MOSTRA_BUILD_CRASHED");
    expect(result(await client.call("artifact/list", {}))).toEqual({ artifacts: [] });
    expect(storeState(home)).toEqual({ versions: [], snapshots: [], staging: [] });
    await stop(client, daemon.exited);
  });

  it("stops a builder that hangs with MOSTRA_BUILD_TIMEOUT, and publishes nothing", async () => {
    const home = testHome();
    // The builder never answers (a fault point), so a fast build can't finish first (issue #18).
    const { daemon, client } = await session(home, undefined, {
      MOSTRA_TEST_BUILD_TIMEOUT_MS: "3000",
      MOSTRA_TEST_FAULTS: "builder:build:hang",
    });
    const response = await client.call("artifact/publish", { source: { path: artifact() } });
    expect(response.error?.data.code).toBe("MOSTRA_BUILD_TIMEOUT");
    await eventually(
      async () => {
        const status = result(await client.call("instance/status")) as { processes: unknown[] };
        return status.processes.length === 0;
      },
      15_000,
      "the hung builder to be stopped",
    );
    expect(storeState(home)).toEqual({ versions: [], snapshots: [], staging: [] });
    await stop(client, daemon.exited);
  });
});
