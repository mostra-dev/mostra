import {
  HOST_PROTOCOL_REVISIONS,
  hostMethods,
  instanceStatusMethod,
  mostraInitializeMethod,
  mostraShutdownMethod,
  parseParams,
  RpcError,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const initialize = {
  client: { name: "jcode", version: "1.0.0" },
  revisions: ["2026-10-10", "2027-01-01", "not-a-revision"],
  capabilities: { notifications: ["events/notify"] },
  ports: ["submissions", "ai", "someFuturePort"],
  home: { path: "/Users/someone/.mostra" },
};

const instance = {
  version: "0.1.0",
  home: "/Users/someone/.mostra",
  platform: "darwin-arm64",
  pid: 4242,
  mode: "daemon",
};

describe("mostra/initialize", () => {
  it("accepts INTERFACES §6 params, including unknown port names and malformed offered revisions", () => {
    expect(parseParams(mostraInitializeMethod, initialize)).toEqual(initialize);
  });

  it("requires client, revisions, capabilities and ports", () => {
    for (const key of ["client", "revisions", "capabilities", "ports"] as const) {
      const { [key]: _, ...rest } = initialize;
      const error = (() => {
        try {
          parseParams(mostraInitializeMethod, rest);
        } catch (e) {
          return e;
        }
      })() as RpcError;
      expect(error).toBeInstanceOf(RpcError);
      expect(error.diagnostic.code).toBe("MOSTRA_HOST_INVALID_PARAMS");
      expect(error.diagnostic.message).toContain(key);
    }
  });

  it("rejects a port name that isn't an identifier", () => {
    expect(() =>
      parseParams(mostraInitializeMethod, { ...initialize, ports: ["Bad Port"] }),
    ).toThrow(RpcError);
  });

  it("accepts unknown fields, so newer clients reach older instances (D32)", () => {
    const parsed = mostraInitializeMethod.params.safeParse({ ...initialize, futureField: 1 });
    expect(parsed.success).toBe(true);
  });

  it("validates the result", () => {
    const result = {
      revision: HOST_PROTOCOL_REVISIONS[0],
      instance,
      capabilities: { methods: ["instance/status"], notifications: [], ports: [] },
      warnings: [],
    };
    expect(mostraInitializeMethod.result.safeParse(result).success).toBe(true);
    expect(
      mostraInitializeMethod.result.safeParse({
        ...result,
        instance: { ...instance, mode: "other" },
      }).success,
    ).toBe(false);
    expect(
      mostraInitializeMethod.result.safeParse({ ...result, instance: { ...instance, pid: 0 } })
        .success,
    ).toBe(false);
  });
});

describe("instance/status and mostra/shutdown", () => {
  it("validates the status result", () => {
    const status = {
      instance,
      startedAt: "2026-10-11T04:00:00.000Z",
      socket: "/Users/someone/.mostra/run/0123456789ABCDEF.sock",
      connections: 1,
      processes: [
        { pid: 7, kind: "builder", ownerRef: "builder", startedAt: "2026-10-11T04:00:01.000Z" },
      ],
    };
    expect(instanceStatusMethod.result.safeParse(status).success).toBe(true);
    expect(
      instanceStatusMethod.result.safeParse({ ...status, startedAt: "yesterday" }).success,
    ).toBe(false);
  });

  it("takes empty params and returns an empty result", () => {
    expect(parseParams(mostraShutdownMethod, undefined)).toEqual({});
    expect(mostraShutdownMethod.result.safeParse({}).success).toBe(true);
  });

  it("registers every session method", () => {
    const names = hostMethods.map((method) => method.method);
    expect(names).toEqual(
      expect.arrayContaining(["mostra/initialize", "mostra/shutdown", "instance/status"]),
    );
  });
});
