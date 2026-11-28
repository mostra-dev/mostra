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
import { describe, expect, it, vi } from "vitest";
import { MostraError } from "../src/runtime/errors.ts";
import { RENEW_MS, ServerClient } from "../src/runtime/server-client.ts";
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
  attachRequests: Parameters<NonNullable<Transport["attachRuns"]>>[0][] = [];
  /** Holds every start's answer until it settles (the run exists on the server meanwhile). */
  startGate: Promise<void> | undefined;
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
        if (this.startGate) await this.startGate;
        return state;
      },
      attachRuns: async (request) => {
        this.attachRequests.push(request);
        const held = new Map((request.held ?? []).map((entry) => [entry.runId, entry]));
        return {
          runs: [
            ...(request.runIds ?? []).flatMap((id) => {
              const run = this.runs.get(id);
              if (!run) return [];
              const from = held.get(id);
              if (!from) return [run];
              // As the interaction core answers: only what the page doesn't hold.
              return [
                {
                  ...run,
                  log: run.log.slice(from.log),
                  batches: run.batches.slice(from.batches),
                  ...(from.log > 0 ? { logFrom: from.log } : {}),
                  ...(from.batches > 0 ? { batchFrom: from.batches } : {}),
                },
              ];
            }),
            ...(request.keyed ?? []).flatMap((entry) =>
              [...this.runs.values()].filter(
                (run) => run.fnId === entry.fnId && run.key === entry.key,
              ),
            ),
          ],
        };
      },
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

  it("rejects a relayed run whose outcome is unknown, and shows the end its owner reports later (D165)", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#send", ["ada"]);
    const settled = page.settled(runId);
    page.receive({
      kind: "run",
      run: await server.advance(runId, {
        status: "unknown",
        error: { code: "MOSTRA_REMOTE_OWNER_OFFLINE", message: "It may have taken effect." },
      }),
    });
    await expect(settled).rejects.toMatchObject({ code: "MOSTRA_REMOTE_OWNER_OFFLINE" });
    expect(page.run(runId)).toMatchObject({ status: "unknown" });
    page.receive({
      kind: "run",
      run: await server.advance(runId, { status: "succeeded", result: { sent: true } }),
    });
    expect(page.run(runId)).toMatchObject({ status: "succeeded" });
  });

  it("keeps a run's end that arrives before the answer that starts it (WP-09's Opus review)", async () => {
    const server = new FakeServer();
    const page = client(server);
    let open!: () => void;
    server.startGate = new Promise((resolve) => {
      open = resolve;
    });
    const starting = page.startRun("actions.ts#send", []);
    while (server.started.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const runId = server.started[0] as string;
    // The worker was fast: its end reaches the page before the start's answer.
    page.receive({
      kind: "run",
      run: await server.advance(runId, { status: "succeeded", log: ["done"], result: 7 }),
    });
    open();
    await starting;
    await expect(page.settled(runId)).resolves.toBe(7);
    expect(page.run(runId)).toMatchObject({ status: "succeeded", log: ["done"] });
    // Known at once, not at the next renewal.
    expect(server.attachRequests).toEqual([]);
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

  it("renews by sending what it holds, and takes only what is newer (Opus review 14)", async () => {
    const server = new FakeServer();
    const page = client(server);
    const { runId } = await page.startRun("actions.ts#send", []);
    page.receive({ kind: "run", run: await server.advance(runId, { log: ["one", "two"] }) });
    await server.advance(runId, { log: ["three"] }); // dropped on the stream
    page.resync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.attachRequests.at(-1)?.held).toEqual([{ runId, log: 2, batches: 0 }]);
    expect(page.run(runId)?.log).toEqual(["one", "two", "three"]);
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

  it("renews its interest a lease's renewal after it read, however long the answer takes to apply", async () => {
    const server = new FakeServer();
    server.live.set("cpu", await state("cpu", 1, 1));
    // The read is answered only later; a slow page applies an answer behind every update before it.
    let answer: () => void = () => {};
    server.liveGate = new Promise((resolve) => {
      answer = resolve;
    });
    const armed: { ms: number; fn: () => void }[] = [];
    const page = new ServerClient({
      transport: server.transport(),
      viewId: VIEW,
      timers: {
        setTimeout: (fn, ms) => armed.push({ fn, ms }),
        clearTimeout: () => {},
      },
    });
    const stop = page.watchLive("cpu", 10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests).toHaveLength(1);
    // The renewal is due a renewal after the read went out, while its answer is still on its way.
    expect(armed.map((timer) => timer.ms)).toEqual([RENEW_MS]);
    armed[0]?.fn();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests).toHaveLength(2);
    answer();
    stop();
  });

  it("renews a ring it holds whole without reading it again, and reads it after a gap, a reconnect or a value the stream never brought (AC-08)", async () => {
    const server = new FakeServer();
    const entry = async (n: number) => ({
      revision: String(n),
      at: "",
      value: await serializeAll(n, { mode: "argument" }),
    });
    const set = async (revision: number, ring: number[]) =>
      server.live.set("cpu", {
        ...(await state("cpu", revision, revision)),
        ring: await Promise.all(ring.map(entry)),
      });
    const update = async (n: number) =>
      page.receive({
        kind: "live",
        live: {
          key: "cpu",
          revision: String(n),
          value: await serializeAll(n, { mode: "argument" }),
        },
      });
    const armed: (() => void)[] = [];
    const page = new ServerClient({
      transport: server.transport(),
      viewId: VIEW,
      timers: { setTimeout: (fn) => armed.push(fn), clearTimeout: () => {} },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    const renew = async () => {
      armed.at(-1)?.();
      await settle();
    };
    const asked = () => server.liveRequests.at(-1);
    await set(3, [1, 2, 3]);
    page.watchLive("cpu", 3);
    await settle();
    expect(asked()).toEqual([{ key: "cpu", window: 3 }]);
    await update(4);
    await settle();
    expect(page.liveView("cpu")?.ring).toEqual([2, 3, 4]);
    // Held whole: the renewal reads the latest value alone, and the ring stays as the stream made it.
    await set(4, [2, 3, 4]);
    await renew();
    expect(asked()).toEqual([{ key: "cpu", window: 1 }]);
    expect(page.liveView("cpu")?.ring).toEqual([2, 3, 4]);
    // A value the stream skipped: the ring is read again.
    await set(6, [4, 5, 6]);
    await update(6);
    await settle();
    expect(asked()).toEqual([{ key: "cpu", window: 3 }]);
    expect(page.liveView("cpu")?.ring).toEqual([4, 5, 6]);
    // A read answers a value the stream hasn't brought: waited for, never taken from the read, and
    // still missing at the next renewal, the ring is read again.
    await set(9, [7, 8, 9]);
    await renew();
    expect(asked()).toEqual([{ key: "cpu", window: 1 }]);
    expect(page.liveView("cpu")?.ring).toEqual([4, 5, 6]);
    await renew();
    expect(asked()).toEqual([{ key: "cpu", window: 3 }]);
    expect(page.liveView("cpu")?.ring).toEqual([7, 8, 9]);
    // A reconnect may have lost updates: the ring is read again.
    page.resync();
    await settle();
    expect(asked()).toEqual([{ key: "cpu", window: 3 }]);
  });

  it("renews its lease from the stream's own messages when its timers run late", async () => {
    const server = new FakeServer();
    server.live.set("cpu", await state("cpu", 1, 1));
    // Timers that never run: a page busy taking in a burst.
    const page = new ServerClient({
      transport: server.transport(),
      viewId: VIEW,
      timers: { setTimeout: () => undefined, clearTimeout: () => {} },
    });
    const start = Date.now();
    let now = start;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      page.watchLive("cpu", 10);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(server.liveRequests).toHaveLength(1);
      const update = async (n: number) =>
        page.receive({
          kind: "live",
          live: {
            key: "cpu",
            revision: String(n),
            value: await serializeAll(n, { mode: "argument" }),
          },
        });
      now = start + RENEW_MS - 1;
      await update(2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(server.liveRequests).toHaveLength(1);
      now = start + RENEW_MS;
      await update(3);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(server.liveRequests).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("gives the page's event loop turns while it applies a burst that arrived at once (AC-08)", async () => {
    const server = new FakeServer();
    server.live.set("cpu", await state("cpu", 0, 0));
    const page = client(server);
    page.watchLive("cpu", 5000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const values = await Promise.all(
      Array.from({ length: 3000 }, (_, index) => serializeAll(index + 1, { mode: "argument" })),
    );
    // One chunk of the stream: every value received in one task.
    for (const [index, value] of values.entries()) {
      page.receive({ kind: "live", live: { key: "cpu", revision: String(index + 1), value } });
    }
    // A timer due at once runs before the burst is applied: the page took turns.
    const applied = await new Promise<number>((resolve) => {
      setTimeout(() => resolve(page.liveView("cpu")?.ring.length ?? 0), 0);
    });
    expect(applied).toBeLessThan(3000);
    await expect.poll(() => page.liveView("cpu")?.ring.length, { timeout: 30_000 }).toBe(3000);
    expect(page.liveView("cpu")?.ring.at(-1)).toBe(3000);
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

  it("decodes and shows only the newest of a burst of values in latest mode (Opus review 12)", async () => {
    const server = new FakeServer();
    server.live.set("ticks", await state("ticks", 1, 1));
    const page = client(server);
    page.watchLive("ticks");
    await new Promise((resolve) => setTimeout(resolve, 10));
    let notified = 0;
    page.subscribe(() => {
      notified += 1;
    });
    const burst = await Promise.all(
      Array.from({ length: 200 }, async (_, index) => ({
        key: "ticks",
        revision: String(index + 2),
        value: await serializeAll(index + 2, { mode: "argument" }),
      })),
    );
    // Arriving in one tick, as a stream's backlog does, and one late, older value among them.
    for (const live of burst) page.receive({ kind: "live", live });
    page.receive({ kind: "live", live: burst[10] as (typeof burst)[number] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page.liveView("ticks")).toMatchObject({ data: 201, revision: "201" });
    // Two values decoded (the first, then the newest), so a handful of notifications at most.
    expect(notified).toBeLessThanOrEqual(3);
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

  it("isn't loading a key nothing produces, nor one whose producer only streams (WP-14's Opus review)", async () => {
    // A key only `mostra push` writes: no value yet, and none on its way. Verify mustn't wait for
    // it on every render and every smoke interaction.
    const server = new FakeServer();
    const page = client(server);
    page.watchLive("builds");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("builds")).toMatchObject({ loading: false });
    expect(page.pending()).toBe(0);

    // Read before its worker said it only streams: awaiting, then told no first load is coming.
    server.live.set("ticks", { key: "ticks", awaiting: true });
    page.watchLive("ticks");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.pending()).toBe(1);
    page.receive({ kind: "live", live: { key: "ticks", awaiting: false } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("ticks")).toMatchObject({ loading: false });
    expect(page.pending()).toBe(0);
    // Its first value still shows when it comes.
    page.receive({
      kind: "live",
      live: { key: "ticks", revision: "1", value: await serializeAll(3, { mode: "argument" }) },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("ticks")).toMatchObject({ loading: false, data: 3 });
  });

  it("says a hosted source's owner is offline, keeps its last value, and clears it when a value comes (D165 item 4)", async () => {
    const server = new FakeServer();
    server.live.set("prices", {
      key: "prices",
      revision: "4",
      at: "2026-11-06T10:00:00.000Z",
      value: await serializeAll({ eur: 1.08 }, { mode: "argument" }),
      ownerOffline: true,
    });
    const page = client(server);
    page.watchLive("prices");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("prices")).toMatchObject({
      loading: false,
      data: { eur: 1.08 },
      at: "2026-11-06T10:00:00.000Z",
      ownerOffline: true,
    });
    // Its owner is back: the next value came from its producer.
    page.receive({
      kind: "live",
      live: {
        key: "prices",
        revision: "5",
        value: await serializeAll({ eur: 1.09 }, { mode: "argument" }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("prices")?.data).toEqual({ eur: 1.09 });
    expect(page.liveView("prices")?.ownerOffline).toBeUndefined();
  });

  it("stays loading, and pending for verify, until the first value or error arrives (WP-14)", async () => {
    // A producer whose first load is on its way (`awaiting`): the page is still loading, and
    // verify must keep waiting for it, or it screenshots an empty dashboard.
    const server = new FakeServer();
    server.live.set("deploys", { key: "deploys", awaiting: true });
    const page = client(server);
    page.watchLive("deploys");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.liveRequests).toHaveLength(1);
    expect(page.liveView("deploys")).toMatchObject({ loading: true });
    expect(page.pending()).toBe(1);
    page.receive({
      kind: "live",
      live: {
        key: "deploys",
        revision: "1",
        value: await serializeAll({ today: 14 }, { mode: "argument" }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("deploys")).toMatchObject({ loading: false, data: { today: 14 } });
    expect(page.pending()).toBe(0);

    // A producer that failed before its first value isn't loading any more: it has an error.
    server.live.set("broken", {
      key: "broken",
      awaiting: true,
      error: { code: "MOSTRA_LIVE_SOURCE_FAILED", message: "down" },
    });
    page.watchLive("broken");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.liveView("broken")).toMatchObject({ loading: false, error: { message: "down" } });
    expect(page.pending()).toBe(0);
  });
});
