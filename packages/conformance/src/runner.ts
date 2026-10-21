/**
 * Runs scenarios against a host (HO-05): each in a fresh directory with a fresh shim and home,
 * one at a time, each bounded in time; then judges the run against the host's baseline.
 */
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Baseline, NO_BASELINE } from "./baseline.ts";
import type { InitializeResult } from "./harness/protocol.ts";
import { NotApplicable, type RunSettings, type Scenario, ScenarioContext } from "./scenario.ts";
import { SCENARIOS } from "./scenarios/index.ts";

/** How one scenario went. */
export type ScenarioStatus =
  /** The property held. */
  | "passed"
  /** It didn't, and the baseline doesn't expect that: the run fails. */
  | "failed"
  /** The host lacks a port or feature the scenario needs. */
  | "skipped"
  /** It didn't, as the baseline expects. */
  | "expected-failure"
  /** It held, though the baseline expects it to fail: the baseline is stale, the run fails. */
  | "unexpected-pass";

/** One scenario's outcome. */
export interface ScenarioOutcome {
  /** The scenario's ID. */
  readonly id: string;
  /** What the scenario proves. */
  readonly title: string;
  /** The requirements and host needs it exercises. */
  readonly covers: readonly string[];
  /** How it went. */
  readonly status: ScenarioStatus;
  /** Why it failed or was skipped, or what the baseline says. */
  readonly reason?: string;
  /** How long it took. */
  readonly durationMs: number;
}

/** A run's report. */
export interface ConformanceReport {
  /** What the host said about itself. */
  readonly host: InitializeResult | undefined;
  /** Each scenario's outcome, in the order they ran. */
  readonly outcomes: readonly ScenarioOutcome[];
  /** Whether the run passes: nothing `failed` and nothing `unexpected-pass`. */
  readonly ok: boolean;
}

/** Options of {@link runConformance}. */
export interface RunOptions {
  /** The host's harness shim, as a command line (run through the shell). */
  readonly host: string;
  /** Variables for the shim's process, on top of this process's. */
  readonly hostEnv?: Readonly<Record<string, string>>;
  /** Only the scenarios whose ID equals or starts with one of these (`delivery.`). */
  readonly only?: readonly string[];
  /** The host's expected failures. */
  readonly baseline?: Baseline;
  /** Publish through verify's gate (needs the verify browser). Default false. */
  readonly verify?: boolean;
  /** Each scenario's time limit. Default 240 s. */
  readonly timeoutMs?: number;
  /** Where scenario directories go. Default a fresh directory under `/tmp` (short socket paths). */
  readonly workDir?: string;
  /** Each outcome as it is known. */
  readonly onOutcome?: (outcome: ScenarioOutcome) => void;
  /** The scenarios to choose from. Default every scenario of the kit. */
  readonly scenarios?: readonly Scenario[];
}

function selected(scenarios: readonly Scenario[], only: readonly string[] | undefined): Scenario[] {
  if (!only || only.length === 0) return [...scenarios];
  return scenarios.filter((scenario) =>
    only.some((prefix) => scenario.id === prefix || scenario.id.startsWith(prefix)),
  );
}

/** Runs one scenario: `passed`, `failed` or `skipped`, before the baseline. */
async function runOne(
  scenario: Scenario,
  settings: RunSettings,
  dir: string,
  timeoutMs: number,
): Promise<{ status: "passed" | "failed" | "skipped"; reason?: string; host?: InitializeResult }> {
  const context = new ScenarioContext(settings, dir);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await context.open();
    for (const feature of scenario.needs ?? []) context.requireFeature(feature);
    await Promise.race([
      scenario.run(context),
      new Promise<never>((_, fail) => {
        timer = setTimeout(
          () => fail(new Error(`the scenario didn't finish within ${timeoutMs / 1000} s`)),
          timeoutMs,
        );
      }),
    ]);
    return { status: "passed", ...(context.host.info ? { host: context.host.info } : {}) };
  } catch (error) {
    const host = context.host?.info;
    if (error instanceof NotApplicable)
      return { status: "skipped", reason: error.message, ...(host ? { host } : {}) };
    const stderr = context.host?.stderr.slice(-3).join(" | ");
    const message = (error as Error).message ?? String(error);
    return {
      status: "failed",
      reason:
        stderr && !(error as Error).name?.startsWith("Scenario")
          ? `${message} (host: ${stderr})`
          : message,
      ...(host ? { host } : {}),
    };
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
  }
}

/** Runs the kit's scenarios against a host and judges them against its baseline. */
export async function runConformance(options: RunOptions): Promise<ConformanceReport> {
  const baseline = options.baseline ?? NO_BASELINE;
  const settings: RunSettings = {
    host: options.host,
    hostEnv: options.hostEnv ?? {},
    verify: options.verify ?? false,
  };
  const root =
    options.workDir ?? mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "mc-"));
  const outcomes: ScenarioOutcome[] = [];
  let host: InitializeResult | undefined;
  let index = 0;
  for (const scenario of selected(options.scenarios ?? SCENARIOS, options.only)) {
    index += 1;
    const started = Date.now();
    const result = await runOne(
      scenario,
      settings,
      join(root, `s${index}`),
      options.timeoutMs ?? 240_000,
    );
    host ??= result.host;
    const expected = baseline.expectedFailures[scenario.id];
    let status: ScenarioStatus = result.status;
    let reason = result.reason;
    if (expected !== undefined && result.status === "failed") {
      status = "expected-failure";
      reason = `${expected} (${result.reason ?? "failed"})`;
    } else if (expected !== undefined && result.status === "passed") {
      status = "unexpected-pass";
      reason = `the baseline expects a failure (${expected}), and it passed: remove it from the baseline`;
    }
    const outcome: ScenarioOutcome = {
      id: scenario.id,
      title: scenario.title,
      covers: scenario.covers,
      status,
      ...(reason !== undefined ? { reason } : {}),
      durationMs: Date.now() - started,
    };
    outcomes.push(outcome);
    options.onOutcome?.(outcome);
  }
  // Each scenario removed its own directory; the run's own is removed when the kit made it.
  if (options.workDir === undefined) {
    try {
      rmdirSync(root);
    } catch {
      // Not empty: something a scenario couldn't remove stays for a look.
    }
  }
  return {
    host,
    outcomes,
    ok: outcomes.every(
      (outcome) => outcome.status !== "failed" && outcome.status !== "unexpected-pass",
    ),
  };
}
