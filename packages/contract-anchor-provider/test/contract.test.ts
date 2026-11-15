import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineAnchorProvider,
  isAnchorProvider,
  stampCompatible,
  VERSION,
} from "@mostra/contract-anchor-provider";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-anchor-provider", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineAnchorProvider({
      id: "chart-datum",
      kind: "chart-datum",
      serialize: () => undefined,
      resolve: () => undefined,
    });
    expect(defined.contract).toEqual({ name: "anchor-provider", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "anchor-provider", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isAnchorProvider(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() =>
      defineAnchorProvider({
        id: "x",
        kind: "Not A Kind",
        serialize: () => undefined,
        resolve: () => undefined,
      }),
    ).toThrow(/kind/);
    expect(() =>
      defineAnchorProvider({
        id: "x",
        kind: "k",
        serialize: () => undefined,
        resolve: undefined as never,
      }),
    ).toThrow(/resolve/);
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isAnchorProvider({
        ...defineAnchorProvider({
          id: "chart-datum",
          kind: "chart-datum",
          serialize: () => undefined,
          resolve: () => undefined,
        }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isAnchorProvider({})).toBe(false);
    expect(isAnchorProvider(null)).toBe(false);
    expect(
      stampCompatible({ name: "anchor-provider", version: "0.1.0" }, "anchor-provider", "0.1.3"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "anchor-provider", version: "0.1.4" }, "anchor-provider", "0.1.3"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "anchor-provider", version: "0.2.0" }, "anchor-provider", "0.1.3"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "anchor-provider", version: "1.2.0" }, "anchor-provider", "1.3.0"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "anchor-provider", version: "1.4.0" }, "anchor-provider", "1.3.0"),
    ).toBe(true);
    expect(
      stampCompatible({ name: "anchor-provider", version: "2.0.0" }, "anchor-provider", "1.3.0"),
    ).toBe(false);
    expect(
      stampCompatible({ name: "anchor-provider", version: "x" }, "anchor-provider", "1.3.0"),
    ).toBe(false);
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
