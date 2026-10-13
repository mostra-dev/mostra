import {
  createDiagnostic,
  DependencyPolicy,
  depsAddMethod,
  diagnosticCatalog,
  HomeConfig,
  hostMethods,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);

describe("deps/add (D95)", () => {
  it("is a mutating host method", () => {
    expect(hostMethods.map((method) => method.method)).toContain("deps/add");
    expect(depsAddMethod.mutating).toBe(true);
  });

  it("takes a source and at least one package spec", () => {
    const ok = depsAddMethod.params.safeParse({
      artifact: { path: "/abs/page.tsx" },
      packages: ["three@0.186.1", "@xyflow/react"],
      requestId: "r1",
    });
    expect(ok.success).toBe(true);
    expect(
      depsAddMethod.params.safeParse({
        artifact: { artifactId: "art_01JB8Z3QF6S7W3N8D5K2C4V9XG" },
        packages: ["x"],
      }).success,
    ).toBe(true);
    for (const bad of [
      { artifact: { path: "/a" }, packages: [] },
      { artifact: { path: "/a" }, packages: [""] },
      { packages: ["x"] },
    ]) {
      expect(depsAddMethod.params.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("answers with each package's exact version and the lockfile digest", () => {
    const result = {
      packages: [
        { name: "three", version: "0.186.1", warm: false },
        { name: "react", version: "19.3.0", warm: true },
      ],
      lockDigest: digest,
    };
    expect(depsAddMethod.result.parse(result)).toEqual(result);
    expect(depsAddMethod.result.safeParse({ ...result, lockDigest: "not-a-digest" }).success).toBe(
      false,
    );
  });
});

describe("the dependency policy (D43)", () => {
  it("is auto or explicit, set through HomeConfig", () => {
    expect(DependencyPolicy.parse("explicit")).toBe("explicit");
    expect(DependencyPolicy.safeParse("strict").success).toBe(false);
    expect(HomeConfig.parse({ dependencies: "auto" })).toEqual({ dependencies: "auto" });
    expect(HomeConfig.safeParse({ dependencies: "never" }).success).toBe(false);
  });
});

describe("the DEP codes", () => {
  it("are errors with complete text", () => {
    const codes = Object.keys(diagnosticCatalog).filter((code) => code.startsWith("MOSTRA_DEP_"));
    expect(codes).toEqual([
      "MOSTRA_DEP_MISSING",
      "MOSTRA_DEP_NOT_FOUND",
      "MOSTRA_DEP_OFFLINE",
      "MOSTRA_DEP_TIMEOUT",
      "MOSTRA_DEP_INSTALL_FAILED",
      "MOSTRA_DEP_WARM_CONFLICT",
      "MOSTRA_DEP_SPEC_INVALID",
    ]);
    const missing = createDiagnostic("MOSTRA_DEP_MISSING", {
      message: "three isn't in the warm set or the artifact's lockfile.",
      location: { file: "page.tsx", line: 2, column: 1 },
      fix: { kind: "command", command: "mostra add three --artifact /abs/page.tsx" },
    });
    expect(missing.severity).toBe("error");
    expect(missing.fix?.command).toContain("mostra add three");
  });
});
