import { Diagnostic, HOST_PROTOCOL_REVISIONS, negotiateRevision, Revision } from "@mostra/protocol";
import { describe, expect, it } from "vitest";

const r = (value: string): Revision => Revision.parse(value);

describe("Revision", () => {
  it("accepts real calendar dates only", () => {
    for (const good of ["2026-10-10", "2024-02-29", "2026-12-31"])
      expect(Revision.is(good)).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2025-02-29",
      "2026-13-01",
      "2026-1-01",
      "20261010",
      "2026-10-10T00:00:00Z",
      20261010,
    ]) {
      expect(Revision.is(bad)).toBe(false);
    }
    expect(Revision.schema.safeParse("2026-02-30").success).toBe(false);
  });

  it("the package declares at least one host protocol revision, newest first", () => {
    expect(HOST_PROTOCOL_REVISIONS.length).toBeGreaterThan(0);
    const sorted = [...HOST_PROTOCOL_REVISIONS].sort(Revision.compare).reverse();
    expect(HOST_PROTOCOL_REVISIONS).toEqual(sorted);
  });
});

describe("negotiateRevision", () => {
  const supported = [r("2027-03-01"), r("2026-10-10"), r("2026-06-01")];

  it("picks the newest revision both sides support, whatever the order offered", () => {
    expect(negotiateRevision(["2026-06-01", "2027-03-01", "2028-01-01"], supported)).toEqual({
      ok: true,
      revision: "2027-03-01",
    });
    expect(negotiateRevision(["2026-10-10", "2026-06-01"], supported)).toEqual({
      ok: true,
      revision: "2026-10-10",
    });
  });

  it("refuses with MOSTRA_HOST_REVISION_UNSUPPORTED when nothing is common", () => {
    const result = negotiateRevision(["2025-01-01", "2028-01-01"], supported);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Diagnostic.parse(result.diagnostic)).toEqual(result.diagnostic);
    expect(result.diagnostic).toMatchObject({
      code: "MOSTRA_HOST_REVISION_UNSUPPORTED",
      severity: "error",
      phase: "host",
      docs: "https://mostra-dev.github.io/mostra/errors/MOSTRA_HOST_REVISION_UNSUPPORTED",
      message:
        "The client offered host protocol revisions 2028-01-01, 2025-01-01; this instance supports 2027-03-01, 2026-10-10, 2026-06-01.",
    });
    expect(result.diagnostic.hint).toMatch(/\S/);
  });

  it("ignores malformed offers and never copies them into the message", () => {
    const result = negotiateRevision(["<script>", "2026-02-30", "x".repeat(10_000)], supported);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.message).toBe(
      "The client offered no valid host protocol revision; this instance supports 2027-03-01, 2026-10-10, 2026-06-01.",
    );
  });

  it("caps the listed revisions", () => {
    const offered = Array.from(
      { length: 20 },
      (_, i) => `2020-01-${String(i + 1).padStart(2, "0")}`,
    );
    const result = negotiateRevision(offered, supported);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.diagnostic.message).toContain("and 12 more");
  });

  it("uses the docs base the caller passes", () => {
    const result = negotiateRevision([], supported, {
      docsBase: "https://docs.example.test/mostra/",
    });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.diagnostic.docs).toBe(
      "https://docs.example.test/mostra/errors/MOSTRA_HOST_REVISION_UNSUPPORTED",
    );
  });
});
