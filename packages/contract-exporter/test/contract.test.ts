import { readFileSync } from "node:fs";
import {
  CONTRACT,
  defineExporter,
  isExporter,
  stampCompatible,
  VERSION,
} from "@mostra/contract-exporter";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", here), "utf8")) as {
  version: string;
};

describe("@mostra/contract-exporter", () => {
  it("stamps what it defines with its name and its package's version", () => {
    const defined = defineExporter({
      id: "pdf",
      output: { mediaType: "application/pdf", layout: "file" as const },
      export: async () => ({ files: [] }),
    });
    expect(defined.contract).toEqual({ name: "exporter", version: manifest.version });
    expect(CONTRACT).toEqual({ name: "exporter", version: VERSION });
    expect(VERSION).toBe(manifest.version);
    expect(isExporter(defined)).toBe(true);
  });

  it("refuses a definition that can't be loaded, naming what is wrong", () => {
    expect(() =>
      defineExporter({
        id: "Bad ID",
        output: { mediaType: "a/b", layout: "file" as const },
        export: async () => ({ files: [] }),
      }),
    ).toThrow(/id/);
    expect(() =>
      defineExporter({
        id: "x",
        output: { mediaType: "", layout: "file" as const },
        export: async () => ({ files: [] }),
      }),
    ).toThrow(/mediaType/);
    expect(() =>
      defineExporter({
        id: "x",
        output: { mediaType: "a/b", layout: "tree" as never },
        export: async () => ({ files: [] }),
      }),
    ).toThrow(/layout/);
  });

  it("knows only stamps of its own line, up to its own version", () => {
    expect(
      isExporter({
        ...defineExporter({
          id: "pdf",
          output: { mediaType: "application/pdf", layout: "file" as const },
          export: async () => ({ files: [] }),
        }),
        contract: { name: "other", version: VERSION },
      }),
    ).toBe(false);
    expect(isExporter({})).toBe(false);
    expect(isExporter(null)).toBe(false);
    expect(stampCompatible({ name: "exporter", version: "0.1.0" }, "exporter", "0.1.3")).toBe(true);
    expect(stampCompatible({ name: "exporter", version: "0.1.4" }, "exporter", "0.1.3")).toBe(
      false,
    );
    expect(stampCompatible({ name: "exporter", version: "0.2.0" }, "exporter", "0.1.3")).toBe(
      false,
    );
    expect(stampCompatible({ name: "exporter", version: "1.2.0" }, "exporter", "1.3.0")).toBe(true);
    expect(stampCompatible({ name: "exporter", version: "1.4.0" }, "exporter", "1.3.0")).toBe(
      false,
    );
    expect(stampCompatible({ name: "exporter", version: "2.0.0" }, "exporter", "1.3.0")).toBe(
      false,
    );
    expect(stampCompatible({ name: "exporter", version: "x" }, "exporter", "1.3.0")).toBe(false);
  });

  it("carries the contracts' shared module unchanged", () => {
    const ours = readFileSync(new URL("src/common.ts", here), "utf8");
    const exporter = readFileSync(new URL("../contract-exporter/src/common.ts", here), "utf8");
    expect(ours).toBe(exporter);
  });
});
