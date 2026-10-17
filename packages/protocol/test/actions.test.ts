/**
 * The shapes of actions, live data and secrets through the public entry: the browser payloads, the
 * new host methods and the worker channel accept what they should and refuse the rest.
 */
import {
  isFinalRunStatus,
  LiveRequest,
  livePushMethod,
  parseParams,
  portSecretsGetMethod,
  RunAttachRequest,
  RunRequest,
  RunState,
  SECRET_NAME_PATTERN,
  secretDeleteMethod,
  secretListMethod,
  secretSetMethod,
  WorkerCallOutcome,
  WorkerStartParams,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const viewId = "vw_01JB0000000000000000000000";

describe("browser payloads", () => {
  it("takes a run request with a key and a client key", () => {
    const request = {
      viewId,
      fnId: "actions.ts#send",
      args: [[{ c: 0, v: [] }]],
      key: "send.1",
      clientKey: "ck-12345678",
    };
    expect(RunRequest.parse(request)).toEqual(request);
    expect(RunRequest.safeParse({ ...request, clientKey: "short" }).success).toBe(false);
    expect(RunRequest.safeParse({ ...request, key: "" }).success).toBe(false);
    expect(RunRequest.safeParse({ ...request, viewId: "nope" }).success).toBe(false);
  });

  it("attaches by ID or by function and key", () => {
    expect(
      RunAttachRequest.safeParse({ viewId, keyed: [{ fnId: "a.ts#b", key: "k" }] }).success,
    ).toBe(true);
    expect(
      RunAttachRequest.safeParse({ viewId, runIds: new Array(101).fill("run_x") }).success,
    ).toBe(false);
  });

  it("names live sources like export names, with bounded windows", () => {
    expect(LiveRequest.safeParse({ viewId, keys: [{ key: "inbox", window: 3600 }] }).success).toBe(
      true,
    );
    expect(LiveRequest.safeParse({ viewId, keys: [{ key: "not a key" }] }).success).toBe(false);
    expect(LiveRequest.safeParse({ viewId, keys: [{ key: "x", window: 0 }] }).success).toBe(false);
  });

  it("reads run states, the reserved waiting status among them", () => {
    const state = {
      runId: "run_1",
      fnId: "a.ts#b",
      status: "waiting",
      log: [],
      batches: [],
      startedAt: "2026-10-16T00:00:00.000Z",
    };
    expect(RunState.parse(state).status).toBe("waiting");
    expect(isFinalRunStatus("waiting")).toBe(false);
    expect(isFinalRunStatus("cancelled")).toBe(true);
  });
});

describe("host methods", () => {
  it("checks secret names and values, and never takes a requestId for them", () => {
    expect(parseParams(secretSetMethod, { name: "MAIL_TOKEN", value: "x" })).toEqual({
      name: "MAIL_TOKEN",
      value: "x",
    });
    expect(() => parseParams(secretSetMethod, { name: "1BAD", value: "x" })).toThrow();
    expect(() => parseParams(secretSetMethod, { name: "OK", value: "" })).toThrow();
    expect(() =>
      parseParams(secretSetMethod, { name: "OK", value: "x".repeat(64 * 1024 + 1) }),
    ).toThrow();
    expect(secretSetMethod.mutating).toBe(false);
    expect(secretDeleteMethod.mutating).toBe(false);
    expect(parseParams(secretListMethod, {})).toEqual({});
    expect(SECRET_NAME_PATTERN.test("smtp.password-2")).toBe(true);
  });

  it("pushes any JSON into a live source by key, idempotently by requestId", () => {
    const params = {
      artifact: { artifactId: "art_01JB0000000000000000000000" },
      key: "prices",
      value: { p: 1 },
      mode: "append",
      requestId: "r1",
    };
    expect(parseParams(livePushMethod, params)).toEqual(params);
    expect(livePushMethod.mutating).toBe(true);
    expect(() => parseParams(livePushMethod, { ...params, key: "a-b" })).toThrow();
  });

  it("asks a host's secrets port for one value, or null", () => {
    expect(portSecretsGetMethod.direction).toBe("instance-to-host");
    expect(portSecretsGetMethod.result.parse(null)).toBeNull();
    expect(portSecretsGetMethod.result.parse("v")).toBe("v");
  });
});

describe("the worker channel", () => {
  it("names a version by reference, never by path (D124)", () => {
    const start = {
      artifactId: "art_x",
      version: { versionId: "ver_x", outputDigest: "a".repeat(64), locator: "home:versions/ver_x" },
      entry: "server/entry.mjs",
      limits: { heapMb: 1024, watchdogMs: 10000, idleMinutes: 10 },
    };
    expect(WorkerStartParams.parse(start)).toEqual(start);
    expect(
      WorkerStartParams.safeParse({ ...start, version: { ...start.version, outputDigest: "x" } })
        .success,
    ).toBe(false);
  });

  it("reads a call's outcome", () => {
    expect(
      WorkerCallOutcome.parse({
        status: "failed",
        error: { message: "m", code: "MOSTRA_ACTION_THREW" },
      }),
    ).toBeDefined();
    expect(WorkerCallOutcome.safeParse({ status: "exploded" }).success).toBe(false);
  });
});
