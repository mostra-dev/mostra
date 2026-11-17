/**
 * `artifact_verify` within a tool call's time (#157, D175 item 10): a call answers the verdict or,
 * past its wait, `running` with the stage reached; the same call again joins the run under way,
 * even from another request's server, and collects its verdict; nothing runs twice.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServerFactory, localWorkspace, type McpServerOptions } from "@mostra/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VERIFY_ANSWER_MS,
  VERIFY_KEPT_MS,
  verifyRunsKept,
  verifyWithin,
} from "../src/verify-run.ts";
import { fakeDocs, fakeInstance } from "./support.ts";

afterEach(() => {
  vi.useRealTimers();
});

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

describe("artifact_verify over Streamable HTTP, a server per request (#157)", () => {
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
        client.callTool({ name: "artifact_verify", arguments: { dir: "page" } }) as Promise<{
          content: { type: string; text?: string }[];
          isError?: boolean;
        }>;
      const first = call();
      await vi.advanceTimersByTimeAsync(VERIFY_ANSWER_MS);
      const running = await first;
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
