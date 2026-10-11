import {
  ArtifactManifest,
  artifactCreateMethod,
  artifactGetMethod,
  artifactListMethod,
  artifactPublishMethod,
  createDiagnostic,
  diagnosticCatalog,
  hostMethods,
  PublishReceipt,
} from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const id = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";

describe("ArtifactManifest (INTERFACES §2.2, AU-04)", () => {
  it("accepts a full manifest and a title-only one", () => {
    expect(
      ArtifactManifest.parse({
        id,
        title: "Q3 review",
        description: "Pick one",
        family: "review",
        links: [{ rel: "round-of", artifact: id }],
        mode: "spa",
        submission: { policy: "once", scope: "per-viewer" },
        kit: { base: "radix" },
        terminals: { htop: { command: ["htop"], cols: 120, input: true } },
        demos: { app: { command: ["pnpm", "dev"], ready: "Local:" }, other: { attach: 5173 } },
        limits: { heapMb: 512 },
        verify: { viewports: ["1280x800"], smoke: false },
      }).title,
    ).toBe("Q3 review");
    expect(ArtifactManifest.parse({ title: "Only a title" })).toEqual({ title: "Only a title" });
  });

  it("rejects what the manifest doesn't allow", () => {
    for (const bad of [
      {},
      { title: "" },
      { title: 3 },
      { title: "x", id: "my-dashboard" },
      { title: "x", mode: "rsc" },
      { title: "x", submission: { policy: "twice" } },
      { title: "x", kit: { base: "aria" } },
      { title: "x", links: [{ rel: "follows" }] },
    ]) {
      expect(ArtifactManifest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts unknown keys, so newer manifests still read (they are warnings, FAILURE_MODEL §10)", () => {
    expect(ArtifactManifest.safeParse({ title: "x", deck: { theme: "dark" } }).success).toBe(true);
    expect(ArtifactManifest.parse({ title: "x", deck: {} })).toEqual({
      title: "x",
    });
  });
});

describe("artifact methods (INTERFACES §6)", () => {
  it("are registered, with publish and create mutating", () => {
    const names = hostMethods.map((method) => method.method);
    expect(names).toEqual(
      expect.arrayContaining([
        "artifact/create",
        "artifact/publish",
        "artifact/list",
        "artifact/get",
      ]),
    );
    expect(artifactPublishMethod.mutating).toBe(true);
    expect(artifactCreateMethod.mutating).toBe(true);
    expect(artifactListMethod.mutating).toBe(false);
    expect(artifactGetMethod.mutating).toBe(false);
  });

  it("take absolute source paths or artifact IDs", () => {
    const publish = artifactPublishMethod.params;
    expect(publish.safeParse({ source: { path: "/tmp/a" } }).success).toBe(true);
    expect(publish.safeParse({ source: { artifactId: id }, requestId: "r1" }).success).toBe(true);
    expect(publish.safeParse({ source: { path: "relative/a" } }).success).toBe(false);
    expect(publish.safeParse({ source: { artifactId: "art_nope" } }).success).toBe(false);
    expect(publish.safeParse({ source: { path: "/a" }, policy: { policy: "none" } }).success).toBe(
      true,
    );
    expect(artifactGetMethod.params.safeParse({ artifact: { path: "/a" } }).success).toBe(true);
    expect(artifactGetMethod.params.safeParse({ artifact: "art_x" }).success).toBe(false);
    expect(artifactCreateMethod.params.safeParse({ dir: "./a" }).success).toBe(false);
  });

  it("let a receipt omit the URL until the gateway serves views (D90)", () => {
    const receipt = {
      artifactId: id,
      versionId: "ver_0123456789ABCDEFGHJKMNPQRS",
      version: 1,
      cursor: "7",
      reused: false,
    };
    expect(PublishReceipt.safeParse(receipt).success).toBe(true);
    expect(PublishReceipt.safeParse({ ...receipt, url: "http://127.0.0.1:4000/" }).success).toBe(
      true,
    );
    expect(PublishReceipt.safeParse({ ...receipt, cursor: "07" }).success).toBe(false);
  });
});

describe("WP-03 diagnostic codes", () => {
  it("are cataloged with text", () => {
    for (const code of [
      "MOSTRA_MANIFEST_NOT_LITERAL",
      "MOSTRA_PUBLISH_ID_CONFLICT",
      "MOSTRA_ARTIFACT_NOT_FOUND",
      "MOSTRA_BUILD_FAILED",
      "MOSTRA_HOME_INTEGRITY",
    ] as const) {
      expect(diagnosticCatalog[code].hint.length).toBeGreaterThan(10);
      expect(createDiagnostic(code, { message: "m" }).code).toBe(code);
    }
    expect(diagnosticCatalog.MOSTRA_MANIFEST_UNKNOWN_KEY.severity).toBe("warning");
  });
});
