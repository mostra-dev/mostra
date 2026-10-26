import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EventRecord,
  MutationId,
  RpcError,
  type SubmissionEnvelope,
  type WaitResult,
} from "@mostra/protocol";
import { createMostra, type Mostra } from "@mostra/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventually, hostEnv, tempDir, Viewer, writeArtifact } from "../support.ts";

let dir: ReturnType<typeof tempDir>;
const open: Mostra[] = [];
beforeEach(() => {
  dir = tempDir("msdki");
});
afterEach(async () => {
  for (const mostra of open.splice(0)) await mostra.close();
  const { spawnSync } = await import("node:child_process");
  spawnSync("chmod", ["-R", "u+w", dir.path]);
  dir.cleanup();
});

async function host(options: Parameters<typeof createMostra>[0]): Promise<Mostra> {
  const mostra = await createMostra(options);
  open.push(mostra);
  return mostra;
}

describe("a JavaScript host through the SDK (HO-04)", () => {
  it("registers its ports, verifies and publishes, receives the delivery, waits and reads the results", async () => {
    const home = join(dir.path, "home");
    const deliveries: SubmissionEnvelope[] = [];
    const mostra = await host({
      home,
      client: { name: "sdk-test-host", version: "1.0.0" },
      env: hostEnv(dir.path),
      ports: {
        submissions: {
          deliver: (envelope) => {
            deliveries.push(envelope);
            return { accepted: true };
          },
        },
      },
    });
    expect(mostra.instance).toMatchObject({ mode: "host", home: expect.stringContaining("home") });
    expect(mostra.runtime.source).toBe("development");
    expect(mostra.warnings).toEqual([]);

    const source = writeArtifact(dir.path, "plan");
    const verdict = await mostra.verify(source);
    expect(verdict.status, JSON.stringify(verdict.diagnostics)).toBe("pass");
    const receipt = await mostra.publish(source);
    expect(receipt.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_/);

    // IN-10 through the SDK: nothing yet, a cursor to wait from, then the viewer's submission.
    const before = await mostra.wait(receipt.artifactId, "submitted", { timeoutMs: 0 });
    expect(before.status).toBe("still_waiting");
    const waiting = mostra.wait(receipt.artifactId, "submitted", {
      after: before.cursor,
      timeoutMs: 60_000,
    });
    const viewer = await new Viewer().open(receipt.url as string);
    const submitted = await viewer.answerAndSubmit({ plan: "approved" });
    expect(submitted.status).toBe(200);
    const satisfied = (await waiting) as Extract<WaitResult, { status: "satisfied" }>;
    expect(satisfied.status).toBe("satisfied");

    await eventually(() => deliveries.length === 1);
    const [envelope] = deliveries as [SubmissionEnvelope];
    expect(envelope).toMatchObject({
      kind: "submission",
      artifactId: receipt.artifactId,
      attempt: 1,
    });
    expect(envelope.results.answers).toEqual({ plan: "approved" });
    expect(envelope.results.submission.viewId).toBe(viewer.viewId);

    // The port's handler holds the envelope before its answer reaches the instance, which records
    // the delivery only then: "delivered" follows the handler, never precedes it.
    await eventually(
      async () => (await mostra.results(receipt.artifactId)).submission.delivery === "delivered",
    );
    const results = await mostra.results(receipt.artifactId);
    expect(results.submission.id).toBe(envelope.submissionId);
    expect(results.submission.delivery).toBe("delivered");
    const markdown = await mostra.results(receipt.artifactId, { format: "md" });
    expect(markdown.markdown).toContain("approved");

    // The home is a host's: it records the host and the ports it always provides (D105, D140).
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as {
      hostConfigured?: { client: string };
      expectedPorts?: Record<string, string[]>;
    };
    expect(config.hostConfigured).toBeDefined();
    expect(config.expectedPorts?.["sdk-test-host"]).toEqual(["submissions"]);

    const exit = await mostra.close();
    expect(exit.code).toBe(0);
    await expect(mostra.results(receipt.artifactId)).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_HOST_CONNECTION_CLOSED" },
    });

    // The same host started again without ports clears its record, so nothing waits for a port
    // it no longer serves (Opus review of WP-12, finding 7).
    const again = await host({ home, client: { name: "sdk-test-host" } });
    const cleared = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as {
      expectedPorts?: Record<string, string[]>;
    };
    expect(cleared.expectedPorts?.["sdk-test-host"]).toBeUndefined();
    await again.close();
  });

  it("redelivers with the same delivery ID when the host's port throws, and tells the host", async () => {
    const attempts: SubmissionEnvelope[] = [];
    const errors: string[] = [];
    const mostra = await host({
      home: join(dir.path, "home"),
      client: { name: "flaky-host" },
      env: hostEnv(dir.path, { MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" }),
      onPortError: (_error, method) => errors.push(method),
      ports: {
        submissions: {
          deliver: (envelope) => {
            attempts.push(envelope);
            if (attempts.length === 1) throw new Error("the database is down");
            return { accepted: true };
          },
        },
      },
    });
    const receipt = await mostra.publish(writeArtifact(dir.path, "flaky"));
    await (await new Viewer().open(receipt.url as string)).answerAndSubmit({ answer: 1 });
    await eventually(() => attempts.length === 2, 30_000);
    expect(attempts[1]?.deliveryId).toBe(attempts[0]?.deliveryId);
    expect(attempts[1]?.attempt).toBe(2);
    expect(errors).toEqual(["port/submissions.deliver"]);
    await eventually(
      async () => (await mostra.results(receipt.artifactId)).submission.delivery === "delivered",
    );
  });

  it("streams events in order, with no gap or repeat across a pause, and resumes a named stream after what it handled", async () => {
    const mostra = await host({
      home: join(dir.path, "home"),
      env: hostEnv(dir.path, { MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" }),
    });
    const receipt = await mostra.publish(writeArtifact(dir.path, "tasks"));
    const filter = { artifacts: [receipt.artifactId], types: ["state.changed"] };
    let written = 0;
    const write = async (count: number): Promise<void> => {
      for (let index = 0; index < count; index++, written++) {
        await mostra.patchState(receipt.artifactId, {
          mutationId: MutationId.create(),
          ops: [{ id: `task.${written}`, value: written }],
        });
        await new Promise((done) => setTimeout(done, 3));
      }
    };
    // A consumer slower than the writer, with room for two pages: the stream pauses and resumes.
    const pages: EventRecord[][] = [];
    const stream = mostra.events({
      filter,
      after: receipt.cursor,
      highWaterMark: 2,
      name: "tasks",
    });
    const writing = write(30);
    for await (const page of stream) {
      pages.push([...page.events]);
      await new Promise((done) => setTimeout(done, 25));
      if (pages.flat().length >= 20) break;
    }
    await writing;
    const first = pages.flat().map((event) => Number(event.cursor));
    expect(first).toEqual([...first].sort((a, b) => a - b));
    expect(new Set(first).size).toBe(first.length);
    expect(pages.length).toBeGreaterThan(2);

    // Every page but the one the loop broke out on was acknowledged; the next stream of the name
    // starts after them, so at most that last page comes again.
    await write(10);
    const unacknowledged = new Set((pages.at(-1) ?? []).map((event) => Number(event.cursor)));
    const rest: number[] = [];
    for await (const page of mostra.events({ filter, name: "tasks" })) {
      rest.push(...page.events.map((event) => Number(event.cursor)));
      if (new Set([...first, ...rest]).size >= 40) break;
    }
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
    expect(new Set(rest).size).toBe(rest.length);
    for (const cursor of rest.filter((value) => first.includes(value))) {
      expect(unacknowledged.has(cursor)).toBe(true);
    }
    expect(new Set([...first, ...rest]).size).toBe(40);
  });

  it("rejects an aborted wait without losing the submission it was waiting for", async () => {
    const mostra = await host({
      home: join(dir.path, "home"),
      env: hostEnv(dir.path, { MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" }),
    });
    const receipt = await mostra.publish(writeArtifact(dir.path, "aborted"));
    const controller = new AbortController();
    const waiting = mostra.wait(receipt.artifactId, "submitted", { signal: controller.signal });
    controller.abort(new Error("the agent moved on"));
    await expect(waiting).rejects.toThrow("the agent moved on");
    await (await new Viewer().open(receipt.url as string)).answerAndSubmit({ late: true });
    const later = await mostra.wait(receipt.artifactId, "submitted", { timeoutMs: 30_000 });
    expect(later.status).toBe("satisfied");
  });

  it("keeps going when the host's own callbacks throw: no uncaught error, and the delivery still lands (Opus review finding 6)", async () => {
    const escaped: unknown[] = [];
    const onEscaped = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on("unhandledRejection", onEscaped);
    process.on("uncaughtException", onEscaped);
    try {
      let logged = 0;
      let reported = 0;
      let attempts = 0;
      const mostra = await host({
        home: join(dir.path, "home"),
        client: { name: "throwing-host" },
        env: hostEnv(dir.path, { MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" }),
        onLog: () => {
          logged += 1;
          throw new Error("the host's logger is broken");
        },
        onPortError: () => {
          reported += 1;
          throw new Error("the host's error reporter is broken");
        },
        ports: {
          submissions: {
            deliver: () => {
              attempts += 1;
              if (attempts === 1) throw new Error("the database is down");
              return { accepted: true };
            },
          },
        },
      });
      const receipt = await mostra.publish(writeArtifact(dir.path, "throwing"));
      await (await new Viewer().open(receipt.url as string)).answerAndSubmit({ answer: 1 });
      await eventually(
        async () => (await mostra.results(receipt.artifactId)).submission.delivery === "delivered",
        30_000,
      );
      expect(attempts).toBe(2);
      expect(reported).toBe(1);
      expect(logged).toBeGreaterThan(0);
      expect(escaped).toEqual([]);
    } finally {
      process.off("unhandledRejection", onEscaped);
      process.off("uncaughtException", onEscaped);
    }
  });

  it("sends nothing for a wait already aborted, so no answer is left unhandled when the instance ends", async () => {
    const mostra = await host({ home: join(dir.path, "home"), env: hostEnv(dir.path) });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const controller = new AbortController();
      controller.abort(new Error("given up"));
      await expect(
        mostra.wait("art_00000000000000000000000000", "submitted", {
          signal: controller.signal,
          timeoutMs: 60_000,
        }),
      ).rejects.toThrow("given up");
      process.kill(mostra.instance.pid, "SIGKILL");
      await mostra.closed;
      await new Promise((done) => setTimeout(done, 200));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("survives its instance dying mid-call: every call rejects, the host process never crashes", async () => {
    const mostra = await host({ home: join(dir.path, "home"), env: hostEnv(dir.path) });
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    try {
      // Writes racing the instance's death: a pipe whose reader died answers EPIPE, which must
      // never surface as an unhandled stream error in the host's own process.
      const big = "x".repeat(4 * 1024 * 1024);
      process.kill(mostra.instance.pid, "SIGKILL");
      const calls = Array.from({ length: 20 }, () =>
        mostra.pushLive("art_00000000000000000000000000", { key: "k", value: big }).then(
          () => "answered",
          (error: unknown) => (error instanceof RpcError ? error.diagnostic.code : String(error)),
        ),
      );
      const outcomes = await Promise.all(calls);
      expect(new Set(outcomes)).toEqual(new Set(["MOSTRA_HOST_CONNECTION_CLOSED"]));
      // Windows sends no signal: Node.js ends the process with TerminateProcess, exit code 1.
      expect(await mostra.closed).toMatchObject(
        process.platform === "win32" ? { code: 1, signal: null } : { signal: "SIGKILL" },
      );
      await new Promise((done) => setTimeout(done, 200));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("refuses a port it can't serve, and reports a home another host owns with the instance's own code", async () => {
    await expect(
      createMostra({
        home: join(dir.path, "home"),
        env: hostEnv(dir.path),
        // `identity` is served since D143; `addressing` arrives with WP-13 (D143 item 1).
        ports: { addressing: { externalBase: () => null } } as never,
      }),
    ).rejects.toThrow('no port "addressing"');
    const home = join(dir.path, "home");
    await host({ home, env: hostEnv(dir.path) });
    const second = await createMostra({ home, env: hostEnv(dir.path) }).catch(
      (error: unknown) => error,
    );
    expect(second).toBeInstanceOf(RpcError);
    expect((second as RpcError).diagnostic.code).toBe("MOSTRA_HOME_LOCKED");
  });
});
