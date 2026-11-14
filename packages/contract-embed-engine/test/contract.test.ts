import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineEmbedEngine,
  isEmbedEngine,
  stampCompatible,
  VERSION,
} from "@mostra/contract-embed-engine";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-embed-engine", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineEmbedEngine({
      id: "xterm",
      sources: ["terminal/asciicast"],
      mount: () => ({ dispose() {} }),
    });
    expect(defined.contract).toEqual({ name: "embed-engine", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "embed-engine", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isEmbedEngine(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() =>
      defineEmbedEngine({ id: "x", sources: [], mount: () => ({ dispose() {} }) }),
    ).toThrow(/sources/);
    expect(() =>
      defineEmbedEngine({ id: "", sources: ["a"], mount: () => ({ dispose() {} }) }),
    ).toThrow(/id/);
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isEmbedEngine({
        ...defineEmbedEngine({
          id: "xterm",
          sources: ["terminal/asciicast"],
          mount: () => ({ dispose() {} }),
        }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isEmbedEngine({})).toBe(false);
    expect(isEmbedEngine(null)).toBe(false);
    expect(
      stampCompatible({ name: "embed-engine", version: "0.1.0" }, "embed-engine", "0.1.3"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "embed-engine", version: "0.1.4" }, "embed-engine", "0.1.3"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "embed-engine", version: "0.2.0" }, "embed-engine", "0.1.3"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "embed-engine", version: "1.2.0" }, "embed-engine", "1.3.0"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "embed-engine", version: "1.4.0" }, "embed-engine", "1.3.0"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "embed-engine", version: "2.0.0" }, "embed-engine", "1.3.0"),
    ).toBe(false);
    expect(stampCompatible({ name: "embed-engine", version: "x" }, "embed-engine", "1.3.0")).toBe(
      false,
    );
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
