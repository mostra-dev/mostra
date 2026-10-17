/**
 * How verify fails (FAILURE_MODEL §2, §9, §10; D137 items 5, 6, 7): out of time, at the smoke
 * test's budget, without a browser, and when its runner dies. A run that couldn't vouch for the
 * page is never cached, and the sandboxes a stopped instance left are removed at start.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactId, VerifyVerdict } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  connectTo,
  eventually,
  initializeParams,
  type LineClient,
  type Message,
  startDaemon,
  type TestHome,
  tempDir,
  verifiedHome,
} from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts/", import.meta.url));
const VERIFY_MS = 300_000;

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** Runs `fn` against a daemon of a fresh verified home with `env` added, then stops it. */
async function withDaemon(
  env: Record<string, string>,
  fn: (client: LineClient, home: TestHome) => Promise<void>,
  prepare?: (home: TestHome) => void,
): Promise<void> {
  const base = verifiedHome();
  const home = { ...base, env: { ...base.env, ...env } };
  prepare?.(home);
  const daemon = await startDaemon(home);
  const client = await connectTo(daemon.status.socket as string);
  try {
    result(await client.call("mostra/initialize", initializeParams()));
    await fn(client, home);
  } finally {
    await client.call("mostra/shutdown", {});
    await daemon.exited;
  }
}

const verifyOf = async (client: LineClient, path: string): Promise<VerifyVerdict> =>
  VerifyVerdict.parse(
    result(await client.call("artifact/verify", { source: { path } }, VERIFY_MS)),
  );

const codes = (verdict: VerifyVerdict, severity: string): string[] =>
  verdict.diagnostics.filter((d) => d.severity === severity).map((d) => d.code);

/** The verdict files the home's cache holds. */
const cachedVerdicts = (home: TestHome): string[] => {
  const dir = join(home.home, "cache", "verify");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
};

/** A page with a type error and a manifest `id`, so it can be published. */
function typed(): string {
  const dir = join(tempDir("verify-typed"), "typed");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.tsx"),
    `import { defineArtifact } from "@mostra/react";
export const artifact = defineArtifact({ id: "${ArtifactId.create()}", title: "Typed" });
const count: number = "three";
export default function Page() { return <main><h1>Count {count}</h1></main>; }
`,
  );
  return dir;
}

function single(): string {
  const dir = join(tempDir("verify-single"), "single-tsx");
  cpSync(join(FIXTURES, "single-tsx"), dir, { recursive: true });
  return join(dir, "page.tsx");
}

describe("verify's failures", () => {
  it(
    "runs out of time: a partial verdict with MOSTRA_VERIFY_TIMEOUT, never cached (FAILURE_MODEL §9)",
    async () => {
      await withDaemon({ MOSTRA_TEST_VERIFY_TIMEOUT_MS: "1500" }, async (client, home) => {
        const verdict = await verifyOf(client, single());
        expect(verdict.status).toBe("fail");
        expect(codes(verdict, "error")).toEqual(["MOSTRA_VERIFY_TIMEOUT"]);
        expect(verdict.diagnostics[0]?.message).toMatch(/during the \w+ stage/);
        expect(cachedVerdicts(home)).toEqual([]);
      });
    },
    VERIFY_MS,
  );

  it(
    "stops the smoke test at its budget with a hint, not an error",
    async () => {
      await withDaemon({ MOSTRA_TEST_SMOKE_INTERACTIONS: "1" }, async (client, home) => {
        const verdict = await verifyOf(client, single());
        expect(verdict.status).toBe("pass");
        expect(verdict.smoke.interactions).toBe(1);
        expect(verdict.diagnostics.find((d) => d.code === "MOSTRA_SMOKE_BUDGET")?.severity).toBe(
          "hint",
        );
        expect(cachedVerdicts(home)).toHaveLength(1);
      });
    },
    VERIFY_MS,
  );

  it(
    "without a browser: runs what needs none, reports the environment, and gates publish on it",
    async () => {
      await withDaemon(
        { PLAYWRIGHT_BROWSERS_PATH: join(tempDir("no-browsers"), "none") },
        async (client, home) => {
          const dir = typed();
          const verdict = await verifyOf(client, dir);
          expect(codes(verdict, "error").sort()).toEqual([
            "MOSTRA_ENV_BROWSER_MISSING",
            "MOSTRA_TYPE_ERROR",
          ]);
          expect(cachedVerdicts(home)).toEqual([]);
          // Without --force, publish fails closed with the environment's error.
          const refused = await client.call(
            "artifact/publish",
            { source: { path: dir } },
            VERIFY_MS,
          );
          expect(refused.error?.data.code).toBe("MOSTRA_ENV_BROWSER_MISSING");
          // With --force, every error code is recorded, and the version doesn't count as passing.
          const forced = result(
            await client.call(
              "artifact/publish",
              { source: { path: dir }, force: true },
              VERIFY_MS,
            ),
          ) as { versionId: string; forcedDiagnostics: string[] };
          expect([...forced.forcedDiagnostics].sort()).toEqual([
            "MOSTRA_ENV_BROWSER_MISSING",
            "MOSTRA_TYPE_ERROR",
          ]);
          const manifest = JSON.parse(
            readFileSync(join(home.home, "versions", forced.versionId, "manifest.json"), "utf8"),
          ) as { verify: { status: string } };
          expect(manifest.verify.status).toBe("fail");
        },
      );
    },
    VERIFY_MS,
  );

  it(
    "reports a runner that died as MOSTRA_VERIFY_CRASHED, and the next run starts a fresh one",
    async () => {
      await withDaemon({}, async (client, home) => {
        const watcher = await connectTo(
          JSON.parse(readFileSync(join(home.home, "instance.json"), "utf8")).socket as string,
        );
        result(await watcher.call("mostra/initialize", initializeParams()));
        const running = client.call("artifact/verify", { source: { path: single() } }, VERIFY_MS);
        let pid = 0;
        await eventually(async () => {
          const status = result(await watcher.call("instance/status", {})) as {
            processes: { kind: string; pid: number }[];
          };
          pid = status.processes.find((child) => child.kind === "verify")?.pid ?? 0;
          return pid > 0;
        }, 60_000);
        process.kill(pid, "SIGKILL");
        const verdict = VerifyVerdict.parse(result(await running));
        expect(codes(verdict, "error")).toEqual(["MOSTRA_VERIFY_CRASHED"]);
        expect(cachedVerdicts(home)).toEqual([]);
        // No sandbox outlives its run, crash or not.
        expect(readdirSync(join(home.home, "cache", "verify", "runs"))).toEqual([]);
        const again = await verifyOf(client, single());
        expect(again.status).toBe("pass");
        watcher.close();
      });
    },
    VERIFY_MS,
  );

  it(
    "removes the sandboxes a stopped instance left, at start (D137 item 1)",
    async () => {
      await withDaemon(
        {},
        async (_client, home) => {
          expect(readdirSync(join(home.home, "cache", "verify", "runs"))).toEqual([]);
        },
        (home) => {
          const left = join(home.home, "cache", "verify", "runs", "run_LEFTOVER", "store");
          mkdirSync(left, { recursive: true });
          writeFileSync(join(left, "ledger.sqlite"), "left behind");
        },
      );
    },
    VERIFY_MS,
  );
  it(
    "reports its stages as artifact/progress, only to a client that accepts it and asked",
    async () => {
      await withDaemon({}, async (client, home) => {
        const listener = await connectTo(
          JSON.parse(readFileSync(join(home.home, "instance.json"), "utf8")).socket as string,
        );
        result(
          await listener.call(
            "mostra/initialize",
            initializeParams({ capabilities: { notifications: ["artifact/progress"] } }),
          ),
        );
        const path = single();
        VerifyVerdict.parse(
          result(
            await listener.call(
              "artifact/verify",
              { source: { path }, progressToken: "p1" },
              VERIFY_MS,
            ),
          ),
        );
        const stages: string[] = [];
        for (;;) {
          const note = await listener
            .next((message) => message.method === "artifact/progress", 200)
            .catch(() => undefined);
          if (!note) break;
          const params = (note as unknown as { params: { progressToken: string; stage: string } })
            .params;
          expect(params.progressToken).toBe("p1");
          stages.push(params.stage);
        }
        expect(stages).toEqual(["prepare", "compile", "boot", "render", "smoke", "regression"]);
        // A client that didn't accept the notification gets none, even with a token.
        result(
          await client.call(
            "artifact/verify",
            { source: { path }, progressToken: "p2" },
            VERIFY_MS,
          ),
        );
        expect(
          await client
            .next((message) => message.method === "artifact/progress", 500)
            .catch(() => undefined),
        ).toBeUndefined();
        listener.close();
      });
    },
    VERIFY_MS,
  );
  it("stops a page that blocks the browser after it got ready, and reports the timeout (FAILURE_MODEL §9)", async () => {
    await withDaemon({ MOSTRA_TEST_VERIFY_TIMEOUT_MS: "6000" }, async (client, home) => {
      const dir = join(tempDir("verify-busy"), "busy");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "index.tsx"),
        `import { useEffect } from "react";
export default function Page() {
  // Ready first, then the main thread never yields again: every browser call waits forever.
  useEffect(() => {
    setTimeout(() => {
      for (;;) {}
    }, 300);
  }, []);
  return <main><h1>Busy</h1></main>;
}
`,
      );
      const started = Date.now();
      const verdict = await verifyOf(client, dir);
      // Within the limit and its grace, not whenever the browser gave up.
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(codes(verdict, "error")).toContain("MOSTRA_VERIFY_TIMEOUT");
      expect(cachedVerdicts(home)).toEqual([]);
      // The stuck runner and its browser are gone; the next verify starts fresh and passes.
      // (This test's 6 s limit is too short for a whole run; rendering both viewports shows the
      // fresh runner's browser answers.)
      const again = await verifyOf(client, single());
      expect(again.screenshots.map((shot) => shot.viewport)).toEqual(["desktop", "mobile"]);
    });
  }, 120_000);
});
