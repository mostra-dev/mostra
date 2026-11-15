import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineConnector,
  isConnector,
  stampCompatible,
  VERSION,
} from "@mostra/contract-connector";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-connector", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineConnector({
      id: "files",
      config: { type: "object" },
      read: async () => ({ value: 1 }),
    });
    expect(defined.contract).toEqual({ name: "connector", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "connector", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isConnector(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() =>
      defineConnector({ id: "files", config: null as never, read: async () => ({ value: 1 }) }),
    ).toThrow(/config/);
    expect(() => defineConnector({ id: "files", config: {}, read: undefined as never })).toThrow(
      /read/,
    );
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isConnector({
        ...defineConnector({
          id: "files",
          config: { type: "object" },
          read: async () => ({ value: 1 }),
        }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isConnector({})).toBe(false);
    expect(isConnector(null)).toBe(false);
    expect(stampCompatible({ name: "connector", version: "0.1.0" }, "connector", "0.1.3")).toBe(
      true,
    );
    expect(stampCompatible({ name: "connector", version: "0.1.4" }, "connector", "0.1.3")).toBe(
      true,
    );
    expect(stampCompatible({ name: "connector", version: "0.2.0" }, "connector", "0.1.3")).toBe(
      false,
    );
    expect(stampCompatible({ name: "connector", version: "1.2.0" }, "connector", "1.3.0")).toBe(
      true,
    );
    expect(stampCompatible({ name: "connector", version: "1.4.0" }, "connector", "1.3.0")).toBe(
      true,
    );
    expect(stampCompatible({ name: "connector", version: "2.0.0" }, "connector", "1.3.0")).toBe(
      false,
    );
    expect(stampCompatible({ name: "connector", version: "x" }, "connector", "1.3.0")).toBe(false);
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
