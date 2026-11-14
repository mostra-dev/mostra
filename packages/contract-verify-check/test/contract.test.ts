import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineVerifyCheck,
  isVerifyCheck,
  stampCompatible,
  VERSION,
} from "@mostra/contract-verify-check";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-verify-check", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineVerifyCheck({ id: "frames", run: async () => ({ findings: [] }) });
    expect(defined.contract).toEqual({ name: "verify-check", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "verify-check", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isVerifyCheck(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() => defineVerifyCheck({ id: "-x", run: async () => ({ findings: [] }) })).toThrow(
      /id/,
    );
    expect(() => defineVerifyCheck({ id: "x", run: undefined as never })).toThrow(/run/);
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isVerifyCheck({
        ...defineVerifyCheck({ id: "frames", run: async () => ({ findings: [] }) }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isVerifyCheck({})).toBe(false);
    expect(isVerifyCheck(null)).toBe(false);
    expect(
      stampCompatible({ name: "verify-check", version: "0.1.0" }, "verify-check", "0.1.3"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "verify-check", version: "0.1.4" }, "verify-check", "0.1.3"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "verify-check", version: "0.2.0" }, "verify-check", "0.1.3"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "verify-check", version: "1.2.0" }, "verify-check", "1.3.0"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "verify-check", version: "1.4.0" }, "verify-check", "1.3.0"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "verify-check", version: "2.0.0" }, "verify-check", "1.3.0"),
    ).toBe(false);
    expect(stampCompatible({ name: "verify-check", version: "x" }, "verify-check", "1.3.0")).toBe(
      false,
    );
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
