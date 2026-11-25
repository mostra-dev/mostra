/**
 * The kit against real hosts on real instances of the runtime built beside this package (HO-05):
 * the TypeScript reference host with every port, sharing to a server the kit runs, and with a
 * team. Its other modes (standalone, unscripted, broken) are `kit-adapters.test.ts`. The Rust
 * reference host runs in the `conformance` job.
 */
import { join } from "node:path";
import { runConformance, type ScenarioOutcome } from "@mostra/conformance";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
// Quoted: the command line runs through the system's shell, `cmd.exe` on Windows.
const REFERENCE = `node --conditions=@mostra/source "${join(ROOT, "src", "reference-host.ts")}"`;
/** The kit runs its shell scenario only where a browser is installed; CI's clients job has one. */
const statuses = (outcomes: readonly ScenarioOutcome[]): Record<string, string> =>
  Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.status]));

describe("the conformance kit (HO-05)", () => {
  it("the TypeScript reference host passes every scenario that applies to it", async () => {
    const report = await runConformance({ host: REFERENCE });
    const failed = report.outcomes.filter((outcome) => outcome.status === "failed");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    // It spawns its instance and serves every port: only attach-mode replay doesn't apply.
    expect(
      report.outcomes
        .filter((outcome) => outcome.status === "skipped")
        .map((outcome) => outcome.id),
    ).toEqual(["delivery.outbox-replay"]);
    expect(report.host?.ports).toEqual([
      "submissions",
      "drafts",
      "identity",
      "trustedControls",
      "addressing",
      "reviews",
      "capture",
      "secrets",
    ]);
  });

  it("judges a host whose instance shares to a server the kit runs: delivery and the relay (WP-29)", async () => {
    const report = await runConformance({ host: REFERENCE, only: ["remote."] });
    expect(statuses(report.outcomes)).toEqual({
      "remote.delivery": "passed",
      "remote.relay": "passed",
    });
  });

  it("judges a host's team: personal links, status and the waits for everyone (WP-31)", async () => {
    const report = await runConformance({ host: REFERENCE, only: ["team."] });
    expect(statuses(report.outcomes), JSON.stringify(report.outcomes, null, 2)).toEqual({
      "team.roster": "passed",
      "team.waits": "passed",
    });
  });
});
