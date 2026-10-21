import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  check,
  NotApplicable,
  readBaseline,
  runConformance,
  SCENARIOS,
  type Scenario,
} from "@mostra/conformance";
import { describe, expect, it } from "vitest";

/** A shim that answers initialize and nothing else needed by these scenarios. */
const SHIM = join(import.meta.dirname, "..", "fixtures", "echo-shim.ts");
const HOST = `node --conditions=@mostra/source ${SHIM}`;

function scenario(id: string, run: Scenario["run"], needs?: string[]): Scenario {
  return { id, title: id, covers: ["HO-05"], ...(needs ? { needs } : {}), run };
}

const passes = scenario("t.passes", async () => {});
const fails = scenario("t.fails", async () => check(false, "the property doesn't hold"));
const skips = scenario("t.skips", async () => {
  throw new NotApplicable("no such port");
});
const needsFaults = scenario("t.needs-faults", async () => {}, ["faults"]);

describe("baselines (HO-05)", () => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-"));
  const write = (name: string, value: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return path;
  };

  it("reads a baseline that names known scenarios", () => {
    const path = write("ok.json", {
      schemaVersion: 1,
      expectedFailures: { "delivery.exactly-once": "not yet" },
    });
    expect(
      readBaseline(
        path,
        SCENARIOS.map((s) => s.id),
      ).expectedFailures,
    ).toEqual({
      "delivery.exactly-once": "not yet",
    });
  });

  it("refuses a typo, a wrong shape, an empty reason and a file that isn't JSON", () => {
    const known = SCENARIOS.map((s) => s.id);
    expect(() =>
      readBaseline(
        write("typo.json", { schemaVersion: 1, expectedFailures: { "delivery.exactly": "x" } }),
        known,
      ),
    ).toThrow(/doesn't have: delivery.exactly/);
    expect(() => readBaseline(write("shape.json", { expectedFailures: {} }), known)).toThrow(
      /isn't a conformance baseline/,
    );
    expect(() =>
      readBaseline(
        write("empty.json", { schemaVersion: 1, expectedFailures: { "session.negotiation": "" } }),
        known,
      ),
    ).toThrow(/isn't a conformance baseline/);
    expect(() => readBaseline(write("bad.json", "{"), known)).toThrow(/readable JSON/);
  });

  it("every bundled baseline names only scenarios the kit has", () => {
    const path = join(
      import.meta.dirname,
      "..",
      "..",
      "baselines",
      "reference-host-ts-broken.json",
    );
    expect(
      Object.keys(
        readBaseline(
          path,
          SCENARIOS.map((s) => s.id),
        ).expectedFailures,
      ),
    ).toHaveLength(3);
  });
});

describe("the runner's judgement (HO-05)", () => {
  it("passes, fails, skips, and skips a scenario whose feature the host lacks", async () => {
    const report = await runConformance({
      host: HOST,
      scenarios: [passes, fails, skips, needsFaults],
    });
    expect(report.outcomes.map((o) => [o.id, o.status])).toEqual([
      ["t.passes", "passed"],
      ["t.fails", "failed"],
      ["t.skips", "skipped"],
      ["t.needs-faults", "skipped"],
    ]);
    expect(report.outcomes[1]?.reason).toBe("the property doesn't hold");
    expect(report.ok).toBe(false);
    expect(report.host?.host.name).toBe("echo-shim");
  });

  it("an expected failure keeps the run green; a stale baseline entry turns it red", async () => {
    const expected = await runConformance({
      host: HOST,
      scenarios: [passes, fails],
      baseline: { schemaVersion: 1, expectedFailures: { "t.fails": "known gap" } },
    });
    expect(expected.outcomes.map((o) => o.status)).toEqual(["passed", "expected-failure"]);
    expect(expected.ok).toBe(true);
    const stale = await runConformance({
      host: HOST,
      scenarios: [passes, fails],
      baseline: { schemaVersion: 1, expectedFailures: { "t.passes": "was broken once" } },
    });
    expect(stale.outcomes.map((o) => o.status)).toEqual(["unexpected-pass", "failed"]);
    expect(stale.outcomes[0]?.reason).toMatch(/remove it from the baseline/);
    expect(stale.ok).toBe(false);
  });

  it("bounds each scenario in time and selects by ID prefix", async () => {
    const slow = scenario("t.slow", () => new Promise(() => undefined));
    const report = await runConformance({
      host: HOST,
      scenarios: [slow, passes],
      only: ["t.sl"],
      timeoutMs: 300,
    });
    expect(report.outcomes.map((o) => [o.id, o.status])).toEqual([["t.slow", "failed"]]);
    expect(report.outcomes[0]?.reason).toMatch(/didn't finish within/);
  });

  it("a host shim that doesn't start fails the scenario with the reason", async () => {
    const report = await runConformance({ host: "exit 7", scenarios: [passes] });
    expect(report.outcomes[0]?.status).toBe("failed");
    expect(report.outcomes[0]?.reason).toMatch(/exited/);
  });
});

describe("scenario IDs", () => {
  it("are unique, group.name shaped, and each covers HO-05", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(s.covers).toContain("HO-05");
    }
  });
});
