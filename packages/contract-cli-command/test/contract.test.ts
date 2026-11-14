import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineCliCommand,
  isCliCommand,
  stampCompatible,
  VERSION,
} from "@mostra/contract-cli-command";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-cli-command", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineCliCommand({
      path: ["term", "record"],
      summary: "Record.",
      run: async () => ({ result: null }),
    });
    expect(defined.contract).toEqual({ name: "cli-command", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "cli-command", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isCliCommand(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() =>
      defineCliCommand({ path: ["Term"], summary: "Record.", run: async () => ({ result: null }) }),
    ).toThrow(/path/);
    expect(() =>
      defineCliCommand({
        path: ["a", "b", "c", "d", "e"],
        summary: "Record.",
        run: async () => ({ result: null }),
      }),
    ).toThrow(/path/);
    expect(() =>
      defineCliCommand({ path: ["term"], summary: "", run: async () => ({ result: null }) }),
    ).toThrow(/summary/);
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isCliCommand({
        ...defineCliCommand({
          path: ["term", "record"],
          summary: "Record.",
          run: async () => ({ result: null }),
        }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isCliCommand({})).toBe(false);
    expect(isCliCommand(null)).toBe(false);
    expect(stampCompatible({ name: "cli-command", version: "0.1.0" }, "cli-command", "0.1.3")).toBe(
      true,
    );
    expect(stampCompatible({ name: "cli-command", version: "0.1.4" }, "cli-command", "0.1.3")).toBe(
      true,
    );
    expect(stampCompatible({ name: "cli-command", version: "0.2.0" }, "cli-command", "0.1.3")).toBe(
      false,
    );
    expect(stampCompatible({ name: "cli-command", version: "1.2.0" }, "cli-command", "1.3.0")).toBe(
      true,
    );
    expect(stampCompatible({ name: "cli-command", version: "1.4.0" }, "cli-command", "1.3.0")).toBe(
      true,
    );
    expect(stampCompatible({ name: "cli-command", version: "2.0.0" }, "cli-command", "1.3.0")).toBe(
      false,
    );
    expect(stampCompatible({ name: "cli-command", version: "x" }, "cli-command", "1.3.0")).toBe(
      false,
    );
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
