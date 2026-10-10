import {
  createDiagnostic,
  DIAGNOSTIC_AREAS,
  Diagnostic,
  diagnosticCatalog,
  docsUrl,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

describe("Diagnostic schema", () => {
  const valid = {
    code: "MOSTRA_HOST_REVISION_UNSUPPORTED",
    severity: "error",
    message: "m",
    phase: "host",
    docs: "https://mostra-dev.github.io/mostra/errors/MOSTRA_HOST_REVISION_UNSUPPORTED",
  } as const;

  it("accepts the INTERFACES §13 shape with every optional part", () => {
    const full = {
      ...valid,
      hint: "Do this.",
      fix: { kind: "replace", file: "index.tsx", range: [1, 2, 1, 9], text: "render" },
      location: { file: "index.tsx", line: 1, column: 2 },
      count: 3,
    };
    expect(Diagnostic.parse(full)).toEqual(full);
    expect(
      Diagnostic.parse({ ...valid, location: { viewport: "1280x800", selector: "#a" } }),
    ).toBeTruthy();
  });

  it("accepts codes from areas this version doesn't know yet", () => {
    expect(Diagnostic.safeParse({ ...valid, code: "MOSTRA_FUTUREAREA_SOMETHING" }).success).toBe(
      true,
    );
  });

  it("rejects malformed diagnostics", () => {
    for (const bad of [
      { ...valid, code: "HOST_REVISION" },
      { ...valid, code: "MOSTRA_host_x" },
      { ...valid, severity: "fatal" },
      { ...valid, phase: "build" },
      { ...valid, docs: "not a url" },
      { ...valid, count: 0 },
      { ...valid, fix: { kind: "rewrite" } },
      { ...valid, location: { file: "a", line: 0, column: 1 } },
      { ...valid, hint: undefined },
    ]) {
      expect(Diagnostic.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("diagnostic catalog", () => {
  const entries = Object.entries(diagnosticCatalog);

  it("names every code MOSTRA_<AREA>_<NAME> with a known area", () => {
    for (const [code] of entries) {
      const area = DIAGNOSTIC_AREAS.find((a) => code.startsWith(`MOSTRA_${a}_`));
      expect(area, code).toBeDefined();
      expect(code).toMatch(/^MOSTRA_[A-Z0-9]+_[A-Z0-9_]+$/);
    }
  });

  it("gives every code a title, a hint and docs text", () => {
    for (const [code, spec] of entries) {
      for (const text of [spec.title, spec.hint, spec.docs.explanation, spec.docs.fix]) {
        expect(text.trim(), code).not.toBe("");
      }
    }
  });

  it("createDiagnostic fills severity, phase, hint and docs from the catalog", () => {
    const d = createDiagnostic("MOSTRA_HOST_REVISION_UNSUPPORTED", { message: "m" });
    const spec = diagnosticCatalog.MOSTRA_HOST_REVISION_UNSUPPORTED;
    expect(d).toEqual({
      code: "MOSTRA_HOST_REVISION_UNSUPPORTED",
      severity: spec.severity,
      phase: spec.phase,
      hint: spec.hint,
      message: "m",
      docs: docsUrl("MOSTRA_HOST_REVISION_UNSUPPORTED"),
    });
    expect(Diagnostic.parse(d)).toEqual(d);
    expect(
      createDiagnostic("MOSTRA_HOST_REVISION_UNSUPPORTED", { message: "m", hint: "Specific." })
        .hint,
    ).toBe("Specific.");
  });

  it("builds docs links under a configurable base", () => {
    expect(docsUrl("MOSTRA_X_Y", "https://example.test/docs///")).toBe(
      "https://example.test/docs/errors/MOSTRA_X_Y",
    );
  });
});
