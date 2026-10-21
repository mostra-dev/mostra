/**
 * The kit against real hosts on real instances of the runtime built beside this package (HO-05):
 * the TypeScript reference host with every port, the same host with none (Mostra's standalone
 * adapters), and the deliberately broken host, which fails exactly the scenarios its faults break
 * and passes with its baseline. The Rust reference host runs in the `conformance` job.
 */
import { join } from "node:path";
import { readBaseline, runConformance, SCENARIOS, type ScenarioOutcome } from "@mostra/conformance";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const REFERENCE = `node --conditions=@mostra/source ${join(ROOT, "src", "reference-host.ts")}`;
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
      "secrets",
    ]);
  });

  it("the standalone adapters (a host with no ports) pass, and port scenarios take the default path", async () => {
    const report = await runConformance({ host: `${REFERENCE} --standalone` });
    const failed = report.outcomes.filter((outcome) => outcome.status === "failed");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    const status = statuses(report.outcomes);
    expect(status["ports.identity"]).toBe("passed");
    expect(status["ports.trusted-controls"]).toBe("passed");
    expect(status["delivery.submission"]).toBe("passed");
    expect(status["delivery.exactly-once"]).toBe("skipped");
  });

  it("a broken host fails exactly the scenarios its faults break, and its baseline turns the run green", async () => {
    const host = `${REFERENCE} --break store-duplicates,drafts-as-submissions,ignore-policy`;
    const only = ["delivery.", "drafts.", "ports.trusted-controls", "session.negotiation"];
    const bare = await runConformance({ host, only });
    expect(bare.ok).toBe(false);
    expect(statuses(bare.outcomes)).toEqual({
      "session.negotiation": "passed",
      "delivery.submission": "passed",
      "delivery.exactly-once": "failed",
      "delivery.retry": "passed",
      "delivery.outbox-replay": "skipped",
      "drafts.mirror": "failed",
      "ports.trusted-controls": "failed",
    });
    const baseline = readBaseline(
      join(ROOT, "baselines", "reference-host-ts-broken.json"),
      SCENARIOS.map((scenario) => scenario.id),
    );
    const judged = await runConformance({ host, only, baseline });
    expect(judged.ok).toBe(true);
    expect(statuses(judged.outcomes)["delivery.exactly-once"]).toBe("expected-failure");
    // The same baseline against a host that isn't broken is stale: the run goes red.
    const stale = await runConformance({ host: REFERENCE, only: ["drafts."], baseline });
    expect(stale.ok).toBe(false);
    expect(statuses(stale.outcomes)["drafts.mirror"]).toBe("unexpected-pass");
  });
});
