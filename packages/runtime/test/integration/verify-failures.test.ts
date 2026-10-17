/**
 * How verify fails (FAILURE_MODEL §2, §9, §10; D138 items 5, 6, 7): out of time, at the smoke
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

/** A stand-in runner (test/fixtures/fake-verify-runner.mjs) with its settings, as `MOSTRA_VERIFY_ENTRY`. */
function fakeRunner(settings: Record<string, string>): {
  readonly entry: string;
  readonly dir: string;
} {
  const dir = tempDir("verify-fake-runner");
  const entry = join(dir, "runner.mjs");
  writeFileSync(
    entry,
    `${Object.entries({ MOSTRA_TEST_FAKE_RUNNER_DIR: dir, ...settings })
      .map(([name, value]) => `process.env.${name} = ${JSON.stringify(value)};`)
      .join("\n")}
await import(${JSON.stringify(fileURLToPath(new URL("../fixtures/fake-verify-runner.mjs", import.meta.url)))});
`,
  );
  return { entry, dir };
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
    "removes the sandboxes a stopped instance left, at start (D138 item 1)",
    async () => {
      await withDaemon(
        {},
        async (_client, home) => {
          expect(readdirSync(join(home.home, "cache", "verify", "runs"))).toEqual([]);
          // A build cut off before it was complete, a verdict's temporary file and a screenshot
          // directory no verdict names go too (Opus review finding 9); a cached verdict stays.
          expect(readdirSync(join(home.home, "cache", "builds"))).toEqual([]);
          expect(readdirSync(join(home.home, "cache", "verify")).sort()).toEqual([
            "kept",
            "kept.json",
            "runs",
          ]);
        },
        (home) => {
          const left = join(home.home, "cache", "verify", "runs", "run_LEFTOVER", "store");
          mkdirSync(left, { recursive: true });
          writeFileSync(join(left, "ledger.sqlite"), "left behind");
          mkdirSync(join(home.home, "cache", "builds", "ver_X.tmp-1-2", "client"), {
            recursive: true,
          });
          const cache = join(home.home, "cache", "verify");
          mkdirSync(join(cache, "orphan"), { recursive: true });
          writeFileSync(join(cache, "orphan", "desktop.png"), "left behind");
          writeFileSync(join(cache, "half.json.1-2.tmp"), "left behind");
          mkdirSync(join(cache, "kept"), { recursive: true });
          writeFileSync(join(cache, "kept.json"), "{}");
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
  // Ready first; then, once verify starts looking at the page (its quiescence wait installs
  // __mostraQuiet), the main thread never yields again: every browser call into it waits forever.
  useEffect(() => {
    const id = setInterval(() => {
      if ((globalThis as { __mostraQuiet?: unknown }).__mostraQuiet) for (;;) {}
    }, 20);
    return () => clearInterval(id);
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
      // The stuck runner and its browser are gone, and the next verify starts a fresh one. The
      // source's first viewport renders before anything else, so its screenshot shows the fresh
      // browser answers (this test's 6 s may end the run after it, on a slow machine).
      const again = await verifyOf(client, single());
      expect(again.screenshots[0]?.viewport).toBe("desktop");
      expect(codes(again, "error")).not.toContain("MOSTRA_VERIFY_CRASHED");
    });
  }, 120_000);
  it(
    "verifies identical sources at two paths at once, each getting its verdict (GPT review finding 2)",
    async () => {
      await withDaemon({}, async (client, home) => {
        // Each starts while the one before renders: unserialized, a later start would delete the
        // earlier run's screenshots, or two would write one verdict file at once.
        const sources = [single(), single(), single()];
        const verdicts = await Promise.all(
          sources.map(async (path, index) => {
            await new Promise((resolve) => setTimeout(resolve, index * 1500));
            return verifyOf(client, path);
          }),
        );
        expect(new Set(verdicts.map((verdict) => verdict.artifact.sourceDigest)).size).toBe(1);
        expect(verdicts.map((verdict) => verdict.status)).toEqual(["pass", "pass", "pass"]);
        // One verdict for the shared key, and no temporary file left beside it.
        expect(cachedVerdicts(home)).toHaveLength(1);
        expect(
          readdirSync(join(home.home, "cache", "verify")).filter((name) => name.endsWith(".tmp")),
        ).toEqual([]);
      });
    },
    VERIFY_MS,
  );
  it(
    "keeps other runs going when one page blocks the browser: only its own render ends (Opus review finding 5)",
    async () => {
      await withDaemon({ MOSTRA_TEST_VERIFY_TIMEOUT_MS: "20000" }, async (client) => {
        const dir = join(tempDir("verify-busy-2"), "busy");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "index.tsx"),
          `import { useEffect } from "react";
export default function Page() {
  useEffect(() => { const id = setInterval(() => { if ((globalThis as { __mostraQuiet?: unknown }).__mostraQuiet) for (;;) {} }, 20); return () => clearInterval(id); }, []);
  return <main><h1>Busy</h1></main>;
}
`,
        );
        const busy = verifyOf(client, dir);
        // A correct page whose smoke test runs past the moment the stuck page's render is
        // abandoned (about 21 s in) and the moment recovery would stop the shared runner (29 s).
        const many = join(tempDir("verify-many"), "many");
        mkdirSync(many, { recursive: true });
        writeFileSync(
          join(many, "index.tsx"),
          `import { useState } from "react";
export default function Page() {
  const [count, setCount] = useState(0);
  return <main><h1>Many {count}</h1>{Array.from({ length: 60 }, (_, i) => <button type="button" key={i} onClick={() => setCount(i)}>Button {i}</button>)}</main>;
}
`,
        );
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        const fine = await verifyOf(client, many);
        const blocked = await busy;
        expect(codes(blocked, "error")).toContain("MOSTRA_VERIFY_TIMEOUT");
        expect(codes(fine, "error")).toEqual([]);
        expect(fine.status).toBe("pass");
      });
    },
    VERIFY_MS,
  );

  it(
    "stops a smoke test at the run's deadline with the budget's hint, never a timeout (Opus review finding 6)",
    async () => {
      await withDaemon({ MOSTRA_TEST_VERIFY_TIMEOUT_MS: "30000" }, async (client) => {
        const dir = join(tempDir("verify-buttons"), "buttons");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "index.tsx"),
          `import { useState } from "react";
export default function Page() {
  const [count, setCount] = useState(0);
  return <main><h1>Buttons {count}</h1>{Array.from({ length: 150 }, (_, i) => <button type="button" key={i} onClick={() => setCount(i)}>Button {i}</button>)}</main>;
}
`,
        );
        const verdict = await verifyOf(client, dir);
        expect(codes(verdict, "error")).toEqual([]);
        expect(verdict.diagnostics.map((d) => d.code)).toContain("MOSTRA_SMOKE_BUDGET");
      });
    },
    VERIFY_MS,
  );
  it("stops a runner that never answers and retries the renders it cut off (Opus review finding 5)", async () => {
    // A stand-in runner whose first render never answers and whose second is still in flight
    // when the supervisor stops it for the first one.
    const runner = fakeRunner({ MOSTRA_TEST_FAKE_RUNNER_DELAY_MS: "25000" });
    await withDaemon(
      { MOSTRA_VERIFY_ENTRY: runner.entry, MOSTRA_TEST_VERIFY_TIMEOUT_MS: "20000" },
      async (client) => {
        const started = Date.now();
        const stuck = verifyOf(client, single());
        // The second run's first render must be in flight when the supervisor stops the stuck
        // runner (about 28 s after the first run's browser stages began), and the second run's
        // own deadline must not have passed by then: 18 s leaves several seconds either side.
        await new Promise((resolve) => setTimeout(resolve, 18_000));
        const other = join(tempDir("verify-other"), "other");
        mkdirSync(other, { recursive: true });
        writeFileSync(
          join(other, "index.tsx"),
          "export default function Page() { return <main><h1>Other</h1></main>; }\n",
        );
        const cutOff = await verifyOf(client, other);
        const first = await stuck;
        // The stuck run ends with its timeout, within its limit and the grace after it.
        expect(codes(first, "error")).toContain("MOSTRA_VERIFY_TIMEOUT");
        expect(Date.now() - started).toBeLessThan(60_000);
        // The run whose render the recovery cut off was retried on a fresh runner.
        expect(codes(cutOff, "error")).toEqual([]);
        expect(cutOff.status).toBe("pass");
      },
    );
  }, 120_000); // Normally about 30 s; a supervisor that waits for the stuck runner forever fails here.
  it(
    "renders runs of one cache key one at a time (GPT review finding 2)",
    async () => {
      // Identical sources at three paths share one verdict file and one screenshot directory, so
      // their renders must never overlap; the stand-in runner records when each one ran.
      const runner = fakeRunner({ MOSTRA_TEST_FAKE_RUNNER_MODE: "record" });
      await withDaemon({ MOSTRA_VERIFY_ENTRY: runner.entry }, async (client) => {
        const verdicts = await Promise.all(
          [single(), single(), single()].map((path) => verifyOf(client, path)),
        );
        expect(verdicts.map((verdict) => verdict.status)).toEqual(["pass", "pass", "pass"]);
      });
      const renders = readFileSync(join(runner.dir, "renders.ndjson"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { outDir: string; start: number; end: number })
        .sort((a, b) => a.start - b.start);
      expect(new Set(renders.map((render) => render.outDir)).size).toBe(1);
      expect(renders.length).toBeGreaterThanOrEqual(6);
      for (const [index, render] of renders.entries()) {
        if (index > 0)
          expect(render.start).toBeGreaterThanOrEqual((renders[index - 1] as { end: number }).end);
      }
    },
    VERIFY_MS,
  );
});
