/**
 * `artifact_verify` within a tool call's time (#157, D175 item 10): a call answers the verdict or,
 * past its wait, `running` with the stage reached; the same call again joins the run under way,
 * even from another request's server, and collects its verdict; nothing runs twice.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServerFactory, localWorkspace, type McpServerOptions } from "@mostra/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetVerifyRuns,
  VERIFY_ANSWER_MS,
  VERIFY_KEPT_MS,
  VERIFY_RUN_MAX_MS,
  verifyKey,
  verifyRunsKept,
  verifyWithin,
} from "../src/verify-run.ts";
import { fingerprintOf } from "../src/workspace.ts";
import { fakeDocs, fakeInstance } from "./support.ts";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Moves the fake clock a second at a time until `pending` settles: a call first reads its
 * directory's fingerprint, so its wait starts only once that read is done.
 */
async function answered<T>(pending: Promise<T>): Promise<T> {
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let step = 0; step < 120 && !settled; step++) await vi.advanceTimersByTimeAsync(1_000);
  return pending;
}

/**
 * A request timeout past anything these tests' fake clock reaches. Each step of the clock may
 * outrun the server's real work (its files read for the fingerprint) on a slow machine, and the
 * client's own 60 s limit would end a call these tests wait on; what they check is the server's
 * own 45 s answer, by the status it gives.
 */
const CLOCK_SAFE = { timeout: 30 * 60_000 } as const;

/** A run that ends when the test says. */
function controlled<V>() {
  let resolve!: (value: V) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<V>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("a verify run within a call's time (#157)", () => {
  it("answers running with the stage reached, and the same call again joins the run", async () => {
    const run = controlled<string>();
    let starts = 0;
    let reportStage: (name: string) => void = () => undefined;
    const start = async (stage: (name: string) => void) => {
      starts += 1;
      reportStage = stage;
      return run.promise;
    };
    const first = verifyWithin("k1", start, { waitMs: 20 });
    reportStage("render");
    expect(await first).toEqual({ done: false, stage: "render", elapsedSeconds: 0 });
    // Asked again while it runs: the same run, waited on again, its stages heard.
    const heard: string[] = [];
    const second = verifyWithin("k1", start, { waitMs: 5_000, onStage: (s) => heard.push(s) });
    reportStage("smoke");
    run.resolve("verdict");
    expect(await second).toEqual({ done: true, verdict: "verdict" });
    expect(starts).toBe(1);
    expect(heard).toEqual(["smoke"]);
    // Collected: the next call verifies afresh.
    expect(verifyRunsKept()).toBe(0);
    expect(await verifyWithin("k1", async () => "again", { waitMs: 1_000 })).toEqual({
      done: true,
      verdict: "again",
    });
    expect(verifyRunsKept()).toBe(0);
  });

  it("keeps a verdict that ended with no call waiting for the call that asks again, then forgets it", async () => {
    vi.useFakeTimers();
    const run = controlled<string>();
    const answer = verifyWithin("k2", () => run.promise, { waitMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await answer).done).toBe(false);
    run.resolve("late verdict");
    await vi.advanceTimersByTimeAsync(0);
    expect(verifyRunsKept()).toBe(1);
    // Asked again: the verdict of that run, not a new one.
    const collected = verifyWithin("k2", async () => "a new run", { waitMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await collected).toEqual({ done: true, verdict: "late verdict" });
    // Uncollected, it is kept only so long.
    const other = controlled<string>();
    const pending = verifyWithin("k3", () => other.promise, { waitMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    other.resolve("never asked for");
    await vi.advanceTimersByTimeAsync(VERIFY_KEPT_MS - 1);
    expect(verifyRunsKept()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(verifyRunsKept()).toBe(0);
  });

  it("throws a run's failure to the call that sees it, once", async () => {
    const run = controlled<string>();
    const answer = verifyWithin("k4", () => run.promise, { waitMs: 5_000 });
    run.reject(new Error("verify failed"));
    await expect(answer).rejects.toThrow("verify failed");
    expect(verifyRunsKept()).toBe(0);
  });
});

describe("a verify run answers only for the source it started on (Opus 6, Fable 4)", () => {
  it("starts afresh for a call whose directory's fingerprint changed, and joins on the same one", async () => {
    let print = "a";
    let started = 0;
    const ends = [controlled<unknown>(), controlled<unknown>(), controlled<unknown>()];
    const start = () => {
      started += 1;
      return (ends[started - 1] as ReturnType<typeof controlled<unknown>>).promise;
    };
    const fingerprint = async () => print;
    // Each run ends with no call collecting it: kept for the call that asks again.
    const keep = async (run: number) => {
      expect(await verifyWithin("fp", start, { waitMs: 0, fingerprint })).toMatchObject({
        done: false,
      });
      (ends[run] as ReturnType<typeof controlled<unknown>>).resolve({ run: run + 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await keep(0);
    // The same source: the kept verdict answers.
    expect(await verifyWithin("fp", start, { fingerprint })).toEqual({
      done: true,
      verdict: { run: 1 },
    });
    await keep(1);
    // Another source: a new run, never the kept one.
    print = "b";
    const fresh = verifyWithin("fp", start, { fingerprint, waitMs: 0 });
    expect(await fresh).toMatchObject({ done: false });
    expect(started).toBe(3);
  });

  it("never joins a run that went on longer than a run may", async () => {
    let clock = 0;
    let started = 0;
    const never = controlled<unknown>();
    await verifyWithin(
      "long",
      async () => {
        started += 1;
        return never.promise;
      },
      { waitMs: 0, now: () => clock },
    );
    clock = VERIFY_RUN_MAX_MS + 1;
    const again = await verifyWithin(
      "long",
      async () => {
        started += 1;
        return { status: "pass" };
      },
      { now: () => clock },
    );
    expect(again).toEqual({ done: true, verdict: { status: "pass" } });
    expect(started).toBe(2);
  });

  it("forgets an instance's runs on a directory and under it, never a sibling's or another instance's", async () => {
    const pending = controlled<unknown>();
    const keys = [
      verifyKey("home:a", "/w/page", ""),
      verifyKey("home:a", "/w/page/page.tsx", ""),
      verifyKey("home:a", "/w/page2", ""),
      verifyKey("home:b", "/w/page", ""),
    ];
    for (const key of keys) await verifyWithin(key, () => pending.promise, { waitMs: 0 });
    const before = verifyRunsKept();
    forgetVerifyRuns("home:a", "/w/page/");
    expect(before - verifyRunsKept()).toBe(2);
    forgetVerifyRuns("home:a", "/w/page2");
    forgetVerifyRuns("home:b", "/w/page");
    pending.resolve(undefined);
  });

  it("fingerprints a directory's files but node_modules, and a single file, and changes with them", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-mcp-print-"));
    const dir = join(root, "page");
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "index.tsx"), "one");
    const first = await fingerprintOf(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, "node_modules", "x.js"), "ignored");
    expect(await fingerprintOf(dir)).toBe(first);
    writeFileSync(join(dir, "index.tsx"), "two, longer");
    expect(await fingerprintOf(dir)).not.toBe(first);
    expect(await fingerprintOf(join(dir, "index.tsx"))).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintOf(join(root, "missing"))).toBeUndefined();
  });
});

// Each test steps a fake clock through a call's 45 s, a second at a time, with real HTTP and file
// work between the steps: a slow runner needs more than Vitest's default 5 s for that (CI run
// 44280075785). The bound is the runner's; what each test checks is unchanged.
describe("artifact_verify over Streamable HTTP, a server per request (#157)", {
  timeout: 60_000,
}, () => {
  it("starts afresh once the source changed, through the tools or beside them (Opus 6, Fable 4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const verdicts = [controlled<unknown>(), controlled<unknown>(), controlled<unknown>()];
    let calls = 0;
    const instance = fakeInstance({
      "artifact/verify": () => {
        const next = verdicts[calls] as ReturnType<typeof controlled<unknown>>;
        calls += 1;
        return next.promise;
      },
      "artifact/list": () => ({ artifacts: [] }),
    });
    const root = mkdtempSync(join(tmpdir(), "mostra-mcp-verify-"));
    mkdirSync(join(root, "page"));
    writeFileSync(join(root, "page", "index.tsx"), "export default () => null;");
    const options: McpServerOptions = {
      instance,
      workspace: localWorkspace(root),
      docs: fakeDocs,
      version: "0.0.0-test",
      scope: "home:edits",
    };
    const handler = createMcpHandler(createMcpServerFactory(options));
    const client = new Client({ name: "test-host", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    const verify = () =>
      client.callTool(
        { name: "artifact_verify", arguments: { dir: "page" } },
        CLOCK_SAFE,
      ) as Promise<{
        content: { type: string; text?: string }[];
      }>;
    const running = async () => {
      expect(JSON.parse((await answered(verify())).content[0]?.text ?? "")).toMatchObject({
        status: "running",
      });
    };
    try {
      await running();
      // A write through the tools: the run on the old source isn't joined.
      await client.callTool({
        name: "artifact_write",
        arguments: {
          dir: "page",
          files: [{ path: "index.tsx", content: "export default () => 1;" }],
        },
      });
      await running();
      expect(calls).toBe(2);
      // An edit beside the tools (an agent's own editor): the fingerprint tells.
      writeFileSync(join(root, "page", "index.tsx"), "export default () => 'edited';");
      const last = verify();
      for (let step = 0; step < 200 && calls < 3; step++) await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(3);
      (verdicts[2] as ReturnType<typeof controlled<unknown>>).resolve({
        status: "pass",
        diagnostics: [],
        screenshots: [],
      });
      expect(JSON.parse((await last).content[0]?.text ?? "")).toMatchObject({ status: "pass" });
      for (const verdict of verdicts.slice(0, 2)) verdict.resolve({ status: "fail" });
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it("answers running within its wait, and a later request collects the same run's verdict", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const verdict = controlled<unknown>();
    const instance = fakeInstance({
      "artifact/verify": (_params, progress) => {
        progress("compile");
        return verdict.promise;
      },
    });
    const root = mkdtempSync(join(tmpdir(), "mostra-mcp-verify-"));
    const options: McpServerOptions = {
      instance,
      workspace: localWorkspace(root),
      docs: fakeDocs,
      version: "0.0.0-test",
      scope: "home:test",
    };
    const handler = createMcpHandler(createMcpServerFactory(options));
    const client = new Client({ name: "test-host", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    try {
      const call = () =>
        client.callTool(
          { name: "artifact_verify", arguments: { dir: "page" } },
          CLOCK_SAFE,
        ) as Promise<{
          content: { type: string; text?: string }[];
          isError?: boolean;
        }>;
      const running = await answered(call());
      expect(running.isError, running.content[0]?.text).toBeFalsy();
      expect(JSON.parse(running.content[0]?.text ?? "")).toEqual({
        status: "running",
        stage: "compile",
        elapsedSeconds: VERIFY_ANSWER_MS / 1000,
      });
      // Another request, so another server: the same run, never a second verify.
      const second = call();
      await vi.advanceTimersByTimeAsync(10);
      verdict.resolve({ status: "pass", diagnostics: [], screenshots: [] });
      const done = await second;
      expect(JSON.parse(done.content[0]?.text ?? "")).toMatchObject({ status: "pass" });
      expect(instance.calls.filter((c) => c.method === "artifact/verify")).toHaveLength(1);
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
