/**
 * The page's server side (WP-08): plain calls, action runs and live sources through
 * `ServerClient`, against a fake gateway that keeps runs and sources as Mostra does. Runs join by
 * key and by client key, survive a dropped answer, take lossy updates and read again on a gap;
 * live values never go back to an older revision and append mode keeps its window.
 */
import {
  type CallLine,
  type Frame,
  type LiveState,
  type RunDelta,
  type RunState,
  serializeAll,
  ValueWriter,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { MostraError } from "../src/runtime/errors.ts";
import { ServerClient } from "../src/runtime/server-client.ts";
import { NetworkError, type Transport } from "../src/runtime/transport.ts";

const VIEW = "vw_01J00000000000000000000000";

const resultBatches = async (value: unknown): Promise<Frame[][]> => {
  const batches: Frame[][] = [];
  const writer = new ValueWriter({ mode: "result", onBatch: (batch) => batches.push(batch) });
  await writer.write(value);
  await writer.done;
  return batches;
};

/** A gateway that keeps runs like the interaction core: by ID, key and client key. */
class FakeServer {
  readonly runs = new Map<string, RunState>();
  readonly started: string[] = [];
  readonly live = new Map<string, LiveState>();
  /** Requests to fail with a network error before they arrive. */
  dropStarts = 0;
  /** Answers to drop after the server applied the request. */
  loseAnswers = 0;
  liveRequests: { key: string; window?: number; refresh?: boolean }[][] = [];
  /** Holds every live read's answer until it settles. */
  liveGate: Promise<void> | undefined;
  #next = 1;

  transport(): Transport {
    return {
      snapshot: async () => {
        throw new Error("unused");
      },
      mutate: async () => {
        throw new Error("unused");
      },
      submit: async () => {
        throw new Error("unused");
      },
      signal: async () => {
        throw new Error("unused");
      },
      subscribe: () => () => {},
      call: (fnId, request) => this.#call(fnId, request.args),
      startRun: async (request) => {
        if (this.dropStarts > 0) {
          this.dropStarts -= 1;
          throw new NetworkError("offline");
        }
        const existing = [...this.runs.values()].find(
          (run) =>
            (run as RunState & { clientKey?: string }).clientKey === request.clientKey ||
            (request.key !== undefined && run.key === request.key && run.fnId === request.fnId),
        );
        let state: RunState;
        if (existing) state = { ...existing, joined: true };
        else {
          const runId = `run_${String(this.#next++).padStart(26, "0")}`;
          state = {
            runId,
            fnId: request.fnId,
            ...(request.key !== undefined ? { key: request.key } : {}),
            status: "queued",
            log: [],
            batches: [],
            startedAt: new Date().toISOString(),
          };
          this.runs.set(runId, { ...state, clientKey: request.clientKey } as RunState);
          this.started.push(runId);
        }
        if (this.loseAnswers > 0) {
          this.loseAnswers -= 1;
          throw new NetworkError("the answer was lost");
        }
        return state;
      },
      attachRuns: async (request) => ({
        runs: [
          ...(request.runIds ?? []).flatMap((id) =>
            this.runs.has(id) ? [this.runs.get(id) as RunState] : [],
          ),
          ...(request.keyed ?? []).flatMap((entry) =>
            [...this.runs.values()].filter(
              (run) => run.fnId === entry.fnId && run.key === entry.key,
            ),
          ),
        ],
      }),
      cancelRun: async (runId) => {
        const run = this.runs.get(runId) as RunState;
        const ended: RunState = { ...run, status: "cancelled", reason: "cancelled" };
        this.runs.set(runId, ended);
        return ended;
      },
      live: async (request) => {
        this.liveRequests.push([...request.keys]);
        await this.liveGate;
        return {
          sources: request.keys.map((entry) => {
            const state = this.live.get(entry.key) ?? { key: entry.key };
            if (entry.window === undefined || !state.ring) {
              const { ring: _ring, ...rest } = state;
              return rest;
            }
            return { ...state, ring: state.ring.slice(-entry.window) };
          }),
        };
      },
    };
  }

  async *#call(fnId: string, args: readonly (readonly Frame[])[]): AsyncIterable<CallLine> {
    if (fnId === "actions.ts#fails") {
      yield {
        end: {
          status: "failed",
          error: { code: "MOSTRA_ACTION_THREW", message: "Mail API returned 500" },
        },
      };
      return;
    }
    if (fnId === "actions.ts#count") {
      const writer: Frame[][] = [];
      const value = (async function* () {
        yield 1;
        yield 2;
      })();
      for (const batch of await resultBatches(value)) writer.push(batch);
      for (const batch of writer) yield { batch };
      yield { end: { status: "succeeded" } };
      return;
    }
    // Echoes its arguments.
    const { deserializeAll } = await import("@mostra/protocol");
    const decoded = await deserializeAll(args);
    for (const batch of await resultBatches({ echoed: decoded })) yield { batch };
    yield { end: { status: "succeeded" } };
  }

  /** Moves a run on, as its worker would, and returns the delta a stream would carry. */
  async advance(
    runId: string,
    change: {
      status?: RunState["status"];
      log?: string[];
      result?: unknown;
      error?: { code: string; message: string };
    },
  ): Promise<RunDelta> {
    const run = this.runs.get(runId) as RunState;
    const batches = change.result === undefined ? [] : await resultBatches(change.result);
    const next: RunState = {
      ...run,
      status: change.status ?? "running",
      log: [...run.log, ...(change.log ?? [])],
      batches: [...run.batches, ...batches],
      ...(change.error ? { error: change.error } : {}),
    };
    this.runs.set(runId, next);
    return {
      runId,
      status: next.status,
      logFrom: run.log.length,
      log: change.log ?? [],
      batchFrom: run.batches.length,
      batches,
      ...(change.error ? { error: change.error } : {}),
    };
  }
}

const client = (server: FakeServer) =>
  new ServerClient({ transport: server.transport(), viewId: VIEW });

describe("plain calls (D54)", () => {
  it("sends the arguments with the serializer and resolves with the result", async () => {
    const server = new FakeServer();
    const result = await client(server).call("actions.ts#echo", [
      1,
      new Date(0),
      new Map([["k", 2n]]),
    ]);
    expect(result).toEqual({ echoed: [1, new Date(0), new Map([["k", 2n]])] });
  });

  it("rejects with the action's diagnostic code", async () => {
    const error = await client(new FakeServer())
      .call("actions.ts#fails", [])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MostraError);
    expect(error).toMatchObject({ code: "MOSTRA_ACTION_THREW", message: "Mail API returned 500" });
  });

  it("streams an async iterable result", async () => {
    const items: unknown[] = [];
    for await (const item of (await client(new FakeServer()).call(
      "actions.ts#count",
      [],
    )) as AsyncIterable<unknown>) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
  });

  it("refuses where there is no Mostra server (a static export)", async () => {
    const error = await new ServerClient({}).call("actions.ts#echo", []).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "MOSTRA_TARGET_UNAVAILABLE" });
  });
});

describe("action runs (AC-02, AC-03, AC-04)", () => {
  it("follows a run's log and result through deltas, and settles with the result", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#send", ["ada"]);
    const settled = page.settled(runId);
    page.receive({ kind: "run", run: await server.advance(runId, { log: ["sending"] }) });
    expect(page.run(runId)).toMatchObject({ status: "running", log: ["sending"] });
    page.receive({
      kind: "run",
      run: await server.advance(runId, {
        status: "succeeded",
        log: ["sent"],
        result: { sent: true },
      }),
    });
    await expect(settled).resolves.toEqual({ sent: true });
    expect(page.run(runId)).toMatchObject({
      status: "succeeded",
      log: ["sending", "sent"],
      data: { sent: true },
    });
  });

  it("reads the run again when a delta skipped something (a dropped message)", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#send", []);
    await server.advance(runId, { log: ["one"] }); // never delivered
    page.receive({
      kind: "run",
      run: await server.advance(runId, { status: "succeeded", log: ["two"], result: 7 }),
    });
    await expect(page.settled(runId)).resolves.toBe(7);
    expect(page.run(runId)?.log).toEqual(["one", "two"]);
  });

  it("never takes a final state back for a late update", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#send", []);
    const late = await server.advance(runId, { log: ["late"] });
    page.receive({ kind: "run", run: late });
    page.receive({
      kind: "run",
      run: await server.advance(runId, {
        status: "failed",
        error: { code: "MOSTRA_ACTION_THREW", message: "no" },
      }),
    });
    // The same "running" update, delivered again after the end.
    page.receive({ kind: "run", run: late });
    expect(page.run(runId)?.status).toBe("failed");
    await expect(page.settled(runId)).rejects.toMatchObject({
      code: "MOSTRA_ACTION_THREW",
      message: "no",
    });
  });

  it("joins the run of a key, and a retried start joins its own run (AC-03)", async () => {
    const server = new FakeServer();
    const a = client(server);
    const b = client(server);
    const [first, second] = await Promise.all([
      a.startRun("actions.ts#send", ["x"], "send.1"),
      b.startRun("actions.ts#send", ["x"], "send.1"),
    ]);
    expect(second.runId).toBe(first.runId);
    // The network dropped the answer after the server recorded the run: the retry joins it.
    server.loseAnswers = 1;
    const retried = await a.startRun("actions.ts#send", ["y"]);
    expect(server.started).toEqual([first.runId, retried.runId]);
    // The request never arrived twice in a row: the start retries and still makes one run.
    server.dropStarts = 2;
    const again = await a.startRun("actions.ts#send", ["z"]);
    expect(server.started).toHaveLength(3);
    expect(server.started.at(-1)).toBe(again.runId);
  });

  it("finds a keyed run again after a reload (AC-02)", async () => {
    const server = new FakeServer();
    const { runId } = await client(server).startRun("actions.ts#send", [], "send.2");
    await server.advance(runId, { status: "succeeded", result: "done" });
    const reloaded = client(server);
    const [found] = await reloaded.attach({ keyed: [{ fnId: "actions.ts#send", key: "send.2" }] });
    expect(found).toMatchObject({ runId, status: "succeeded" });
    await expect(reloaded.settled(runId)).resolves.toBe("done");
    expect(reloaded.run(runId)?.data).toBe("done");
  });

  it("cancels: the run ends cancelled and its promise rejects (AC-04)", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#slow", []);
    await page.cancel(runId);
    await expect(page.settled(runId)).rejects.toMatchObject({ code: "MOSTRA_ACTION_CANCELLED" });
  });
});

describe("live sources (D56)", () => {
  const state = async (key: string, revision: number, value: unknown): Promise<LiveState> => ({
    key,
    revision: String(revision),
    at: new Date(0).toISOString(),
    value: await serializeAll(value, { mode: "argument" }),
  });

  it("reads a source once for every component showing it, and follows updates", async () => {
    const server = new FakeServer();
    server.live.set("inbox", await state("inbox", 3, { unread: 3 }));
    const page = client(server);
    const stopA = page.watchLive("inbox");
    const stopB = page.watchLive("inbox");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests).toHaveLength(1);
    expect(page.liveView("inbox")).toMatchObject({
      loading: false,
      data: { unread: 3 },
      revision: "3",
    });
    page.receive({
      kind: "live",
      live: {
        key: "inbox",
        revision: "4",
        value: await serializeAll({ unread: 4 }, { mode: "argument" }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("inbox")?.data).toEqual({ unread: 4 });
    // An older value arriving late never replaces a newer one.
    page.receive({
      kind: "live",
      live: {
        key: "inbox",
        revision: "2",
        value: await serializeAll({ unread: 2 }, { mode: "argument" }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("inbox")?.data).toEqual({ unread: 4 });
    // A failure keeps the last good value (FAILURE_MODEL §6).
    page.receive({
      kind: "live",
      live: { key: "inbox", error: { code: "MOSTRA_LIVE_SOURCE_FAILED", message: "down" } },
    });
    // Applied in arrival order, after the values before it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("inbox")).toMatchObject({
      data: { unread: 4 },
      error: { message: "down" },
    });
    stopA();
    stopB();
  });

  it("keeps an append window and asks for the ring", async () => {
    const server = new FakeServer();
    const ring = await Promise.all(
      [1, 2, 3].map(async (n) => ({
        revision: String(n),
        at: "",
        value: await serializeAll(n, { mode: "argument" }),
      })),
    );
    server.live.set("cpu", { ...(await state("cpu", 3, 3)), ring });
    const page = client(server);
    page.watchLive("cpu", 3);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests[0]).toEqual([{ key: "cpu", window: 3 }]);
    expect(page.liveView("cpu")?.ring).toEqual([1, 2, 3]);
    page.receive({
      kind: "live",
      live: { key: "cpu", revision: "4", value: await serializeAll(4, { mode: "argument" }) },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("cpu")?.ring).toEqual([2, 3, 4]);
  });

  it("keeps newer updates when an older read answers late (GPT review finding 6)", async () => {
    const server = new FakeServer();
    const ring = await Promise.all(
      [1, 2, 3].map(async (n) => ({
        revision: String(n),
        at: "",
        value: await serializeAll(n, { mode: "argument" }),
      })),
    );
    server.live.set("cpu", { ...(await state("cpu", 3, 3)), ring });
    let release = (): void => {};
    server.liveGate = new Promise((resolve) => {
      release = resolve;
    });
    const page = client(server);
    page.watchLive("cpu", 3);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Updates 4 and 5 arrive on the stream while the read of revision 3 is still on its way.
    for (const n of [4, 5]) {
      page.receive({
        kind: "live",
        live: {
          key: "cpu",
          revision: String(n),
          value: await serializeAll(n, { mode: "argument" }),
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page.liveView("cpu")).toMatchObject({ data: 5, revision: "5", ring: [3, 4, 5] });
  });

  it("asks the producer to load again on refresh", async () => {
    const server = new FakeServer();
    const page = client(server);
    page.watchLive("inbox");
    await new Promise((resolve) => setTimeout(resolve, 10));
    page.refreshLive("inbox");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests.at(-1)).toEqual([{ key: "inbox", refresh: true }]);
  });
});
