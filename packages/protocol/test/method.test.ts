import { defineMethod, hostMethods } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import * as z from "zod";

const define = (method: string) =>
  defineMethod({
    method,
    direction: "client-to-instance",
    mutating: false,
    params: z.object({}),
    result: z.object({}),
  });

describe("defineMethod", () => {
  it("accepts group/name and bare names", () => {
    for (const method of ["artifact/publish", "port/identity.resolve", "wait"]) {
      expect(define(method).method).toBe(method);
    }
  });

  it("rejects malformed names", () => {
    for (const method of ["Artifact/publish", "artifact/", "/x", "a/b/c", "artifact publish"]) {
      expect(() => define(method)).toThrow(/group\/name/);
    }
  });

  it("registers no method name twice", () => {
    const names = hostMethods.map((method) => method.method);
    expect(new Set(names).size).toBe(names.length);
  });
});
