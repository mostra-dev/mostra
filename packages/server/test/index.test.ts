/**
 * `@mostra/server` through its public entries: the request context is per call across `await`s
 * (D19 seam 3, RS-01), `abortSignal` follows the current call into `fetch` and timers (AC-04),
 * and every helper reaches the installed host with the call it ran in.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  abortSignal,
  defineLive,
  dryRun,
  emit,
  log,
  MostraServerError,
  progress,
  secret,
  signal,
  state,
  viewer,
} from "@mostra/server";
import {
  currentCall,
  installServerHost,
  liveSourceOptions,
  parseDuration,
  runWithContext,
  type ServerCallContext,
  type ServerHost,
} from "@mostra/server/host";
import { beforeEach, describe, expect, it } from "vitest";

interface Recorded {
  readonly method: string;
  readonly callId: string | undefined;
  readonly args: readonly unknown[];
}

const recorded: Recorded[] = [];

const host: ServerHost = {
  secret(name) {
    if (name === "MAIL_TOKEN") return "tok-123456789";
    throw new MostraServerError("MOSTRA_SECRET_MISSING", `No secret ${name}.`);
  },
  progress: (callId, p) => recorded.push({ method: "progress", callId, args: [p] }),
  log: (callId, line) => recorded.push({ method: "log", callId, args: [line] }),
  signal: (callId, name, payload) =>
    recorded.push({ method: "signal", callId, args: [name, payload] }),
  emit: (callId, type, payload) => recorded.push({ method: "emit", callId, args: [type, payload] }),
  async stateGet() {
    return { revision: "4", fields: { todo: { value: ["a"] }, gone: { deleted: true } } };
  },
  async statePatch(callId, ops, options) {
    recorded.push({ method: "statePatch", callId, args: [ops, options] });
    const conflicts =
      options.baseRevision === "1"
        ? ops.map((op) => ({
            id: op.id,
            revision: "5",
            value: null,
            updatedBy: { kind: "viewer" },
          }))
        : [];
    return { revision: "5", applied: ops.map((op) => op.id), conflicts } as never;
  },
};

function context(callId: string, extra: Partial<ServerCallContext> = {}): ServerCallContext {
  return {
    kind: "run",
    callId,
    runId: `run_${callId}`,
    dryRun: false,
    signal: new AbortController().signal,
    ...extra,
  };
}

beforeEach(() => {
  recorded.length = 0;
  installServerHost(host);
});

describe("the request context (D19 seam 3)", () => {
  it("keeps each concurrent call's viewer and run across awaits", async () => {
    const seen: string[] = [];
    const one = async (id: string, delays: number[]): Promise<void> => {
      for (const delay of delays) {
        await sleep(delay);
        seen.push(`${id}:${viewer()?.id}:${currentCall()?.runId}`);
        progress({ message: id });
      }
    };
    await Promise.all([
      runWithContext(context("a", { viewer: { id: "vwr_A" } }), () => one("a", [15, 1, 10])),
      runWithContext(context("b", { viewer: { id: "vwr_B" } }), () => one("b", [1, 12, 1])),
    ]);
    expect(seen.filter((entry) => entry.startsWith("a"))).toEqual([
      "a:vwr_A:run_a",
      "a:vwr_A:run_a",
      "a:vwr_A:run_a",
    ]);
    expect(seen.filter((entry) => entry.startsWith("b"))).toEqual([
      "b:vwr_B:run_b",
      "b:vwr_B:run_b",
      "b:vwr_B:run_b",
    ]);
    // Progress reports carry their own call's ID, whichever finished first.
    for (const entry of recorded) {
      expect(entry.callId).toBe((entry.args[0] as { message: string }).message);
    }
  });

  it("knows no call outside a call: dryRun is false, viewer undefined, progress dropped", () => {
    expect(dryRun()).toBe(false);
    expect(viewer()).toBeUndefined();
    progress({ fraction: 0.5 });
    expect(recorded).toEqual([]);
    log("at load");
    expect(recorded).toEqual([{ method: "log", callId: undefined, args: ["at load"] }]);
  });

  it("reports dryRun only for verify's smoke test (D55)", () => {
    expect(runWithContext(context("d", { dryRun: true }), dryRun)).toBe(true);
    expect(runWithContext(context("e"), dryRun)).toBe(false);
  });

  it("clamps progress and caps its message", () => {
    runWithContext(context("p"), () => progress({ fraction: 7, message: "x".repeat(2000) }));
    const [entry] = recorded;
    expect(entry?.args[0]).toEqual({ fraction: 1, message: "x".repeat(1000) });
  });
});

describe("abortSignal (AC-04)", () => {
  it("is the current call's signal, and stops fetch and timers", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => response.end("late"), 3000).unref();
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const other = new AbortController();
    const outcomes: string[] = [];
    try {
      await Promise.all([
        runWithContext(context("c", { signal: controller.signal }), async () => {
          expect(abortSignal).toBeInstanceOf(AbortSignal);
          setTimeout(() => controller.abort(new Error("cancelled by the viewer")), 50);
          await fetch(`http://127.0.0.1:${port}/`, { signal: abortSignal }).catch((error: Error) =>
            outcomes.push(`fetch:${error.message}`),
          );
          await sleep(5000, undefined, { signal: abortSignal }).catch((error: Error) =>
            outcomes.push(`timer:${error.name}`),
          );
          expect(abortSignal.aborted).toBe(true);
          expect(() => abortSignal.throwIfAborted()).toThrow("cancelled by the viewer");
        }),
        runWithContext(context("o", { signal: other.signal }), async () => {
          await sleep(120);
          // Another call's signal is untouched.
          expect(abortSignal.aborted).toBe(false);
        }),
      ]);
    } finally {
      server.close();
    }
    expect(outcomes).toEqual(["fetch:cancelled by the viewer", "timer:AbortError"]);
    // Outside a call it never aborts.
    expect(abortSignal.aborted).toBe(false);
  });
});

describe("abortSignal listeners", () => {
  it("run in the call that added them, even when the abort comes from outside it", async () => {
    const controller = new AbortController();
    const reasons: unknown[] = [];
    const removed = (): void => {
      reasons.push("removed listener ran");
    };
    runWithContext(context("l", { signal: controller.signal }), () => {
      abortSignal.addEventListener("abort", () => reasons.push(abortSignal.reason));
      abortSignal.addEventListener("abort", removed);
      abortSignal.removeEventListener("abort", removed);
      abortSignal.onabort = () => reasons.push(currentCall()?.callId);
    });
    controller.abort("viewer cancelled");
    expect(reasons).toEqual(["viewer cancelled", "l"]);
  });

  it("run one shared listener in each call that added it (GPT review finding 5)", () => {
    const first = new AbortController();
    const second = new AbortController();
    const seen: unknown[] = [];
    // A module-level callback, added by two calls.
    const onAbort = (): void => {
      seen.push([currentCall()?.callId, abortSignal.reason]);
    };
    runWithContext(context("first", { signal: first.signal }), () => {
      abortSignal.addEventListener("abort", onAbort);
    });
    runWithContext(context("second", { signal: second.signal }), () => {
      abortSignal.addEventListener("abort", onAbort);
    });
    second.abort("second cancelled");
    expect(seen).toEqual([["second", "second cancelled"]]);
    // Removing it in one call leaves the other's.
    runWithContext(context("second", { signal: second.signal }), () => {
      abortSignal.removeEventListener("abort", onAbort);
    });
    first.abort("first cancelled");
    expect(seen).toEqual([
      ["second", "second cancelled"],
      ["first", "first cancelled"],
    ]);
  });
});

describe("secrets, signals and host events", () => {
  it("reads secrets through the host and throws MOSTRA_SECRET_MISSING", () => {
    expect(secret("MAIL_TOKEN")).toBe("tok-123456789");
    expect(() => secret("NOPE")).toThrow(
      expect.objectContaining({ code: "MOSTRA_SECRET_MISSING" }),
    );
  });

  it("raises signals and host events with the call's ID", () => {
    runWithContext(context("s"), () => {
      signal("reply-sent", { id: 1 });
      emit("host.mail.sent", { id: 1 });
    });
    expect(recorded).toEqual([
      { method: "signal", callId: "s", args: ["reply-sent", { id: 1 }] },
      { method: "emit", callId: "s", args: ["host.mail.sent", { id: 1 }] },
    ]);
  });

  it("refuses bad names, the reserved submit and payloads over 64 KiB", () => {
    for (const name of ["", "a b", "submit", "x".repeat(65)]) {
      expect(() => signal(name)).toThrow(
        expect.objectContaining({ code: "MOSTRA_SUBMIT_SIGNAL_INVALID" }),
      );
    }
    expect(() => signal("big", { blob: "x".repeat(70_000) })).toThrow(
      expect.objectContaining({ code: "MOSTRA_SUBMIT_SIGNAL_INVALID" }),
    );
    for (const type of ["mail.sent", "host.", "host.a b"]) {
      expect(() => emit(type as `host.${string}`)).toThrow(
        expect.objectContaining({ code: "MOSTRA_ACTION_EVENT_INVALID" }),
      );
    }
    expect(() => emit("host.x", { n: Number.NaN } as never)).toThrow(
      expect.objectContaining({ code: "MOSTRA_ACTION_EVENT_INVALID" }),
    );
    expect(recorded).toEqual([]);
  });
});

describe("artifact state (D63)", () => {
  it("gets a field, missing and deleted ones as undefined", async () => {
    expect(await state.get("todo")).toEqual(["a"]);
    expect(await state.get("gone")).toBeUndefined();
    expect(await state.get("other")).toBeUndefined();
  });

  it("sets and patches through the host with the call's ID, conflicts surfaced", async () => {
    await runWithContext(context("w"), async () => {
      expect(await state.set("todo", ["a", "b"], { mutationId: "mut_1" })).toEqual({
        revision: "5",
      });
      expect(
        await state.patch([
          { id: "x", value: 1 },
          { id: "y", delete: true },
        ]),
      ).toEqual({
        revision: "5",
        conflicts: [],
      });
      await expect(state.set("todo", [], { baseRevision: "1" })).rejects.toMatchObject({
        code: "MOSTRA_FIELD_CONFLICT",
      });
      expect(await state.patch([{ id: "x", value: 2 }], { baseRevision: "1" })).toEqual({
        revision: "5",
        conflicts: ["x"],
      });
    });
    expect(recorded[0]).toEqual({
      method: "statePatch",
      callId: "w",
      args: [[{ id: "todo", value: ["a", "b"] }], { mutationId: "mut_1" }],
    });
    expect(recorded[1]?.args[0]).toEqual([
      { id: "x", value: 1 },
      { id: "y", delete: true },
    ]);
  });
});

describe("defineLive (D56)", () => {
  it("marks a source the worker recognizes, and nothing else", () => {
    const load = async (): Promise<number> => 1;
    const source = defineLive({ load, refresh: "5s", ring: 10, always: true });
    expect(liveSourceOptions(source)).toEqual({ load, refresh: "5s", ring: 10, always: true });
    expect(liveSourceOptions({ load })).toBeUndefined();
    expect(liveSourceOptions(null)).toBeUndefined();
  });

  it("refuses a source without load or stream, a bad refresh, a bad ring", () => {
    expect(() => defineLive({})).toThrow(/load function, a stream function/);
    expect(() => defineLive({ load: async () => 1, refresh: "soon" })).toThrow(/duration/);
    expect(() => defineLive({ load: async () => 1, refresh: "500ms" })).toThrow(/duration/);
    expect(() => defineLive({ load: async () => 1, ring: 0 })).toThrow(/positive integer/);
  });

  it("reads durations from 1 s to 24 h", () => {
    expect(parseDuration("1s")).toBe(1000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("24h")).toBe(86_400_000);
    expect(() => parseDuration("25h")).toThrow();
    expect(() => parseDuration("0s")).toThrow();
  });
});

describe("outside a worker", () => {
  it("names where server code must run", async () => {
    installServerHost(undefined as never);
    expect(() => secret("X")).toThrow(
      expect.objectContaining({ code: "MOSTRA_TARGET_UNAVAILABLE" }),
    );
  });
});
