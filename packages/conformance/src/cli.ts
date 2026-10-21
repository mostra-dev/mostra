#!/usr/bin/env node
/**
 * `mostra-conformance`: runs the host conformance kit (HO-05) against a host's harness shim.
 *
 *   mostra-conformance --host "<command>" [--baseline <file>] [--only <id-or-prefix>]…
 *                      [--verify] [--json] [--list]
 *
 * Exit codes: 0 the run passes (every failure expected by the baseline, no stale entry), 1 it
 * doesn't, 2 a usage error.
 */
import { parseArgs } from "node:util";
import { readBaseline } from "./baseline.ts";
import { runConformance, type ScenarioOutcome } from "./runner.ts";
import { SCENARIOS } from "./scenarios/index.ts";

const MARKS: Readonly<Record<ScenarioOutcome["status"], string>> = {
  passed: "pass",
  failed: "FAIL",
  skipped: "skip",
  "expected-failure": "xfail",
  "unexpected-pass": "XPASS",
};

function parse() {
  return parseArgs({
    options: {
      host: { type: "string" },
      baseline: { type: "string" },
      only: { type: "string", multiple: true },
      verify: { type: "boolean" },
      json: { type: "boolean" },
      list: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
}

async function main(): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse();
  } catch (error) {
    process.stderr.write(`mostra-conformance: ${(error as Error).message} (see --help).\n`);
    return 2;
  }
  const { values } = parsed;
  if (values.help) {
    process.stdout.write(
      [
        "Usage: mostra-conformance --host <command> [--baseline <file>] [--only <id>]… [--verify] [--json]",
        "       mostra-conformance --list",
        "",
        "Runs the host conformance scenarios against the harness shim <command> starts.",
        "Exit codes: 0 passes, 1 fails (a new failure, or a baseline entry that now passes), 2 usage.",
        "",
      ].join("\n"),
    );
    return 0;
  }
  if (values.list) {
    for (const scenario of SCENARIOS) {
      process.stdout.write(
        values.json
          ? `${JSON.stringify({ id: scenario.id, title: scenario.title, covers: scenario.covers, needs: scenario.needs ?? [] })}\n`
          : `${scenario.id}  ${scenario.title}\n`,
      );
    }
    return 0;
  }
  if (!values.host) {
    process.stderr.write("mostra-conformance: --host <command> is required (see --help).\n");
    return 2;
  }
  const known = SCENARIOS.map((scenario) => scenario.id);
  let baseline: ReturnType<typeof readBaseline> | undefined;
  try {
    baseline = values.baseline ? readBaseline(values.baseline, known) : undefined;
  } catch (error) {
    process.stderr.write(`mostra-conformance: ${(error as Error).message}\n`);
    return 2;
  }
  const report = await runConformance({
    host: values.host,
    ...(baseline ? { baseline } : {}),
    ...(values.only
      ? { only: values.only.flatMap((entry) => entry.split(",")).filter(Boolean) }
      : {}),
    verify: values.verify ?? false,
    onOutcome: (outcome) => {
      if (values.json) return;
      const reason = outcome.reason ? `\n        ${outcome.reason}` : "";
      process.stderr.write(
        `${MARKS[outcome.status].padEnd(5)} ${outcome.id} (${(outcome.durationMs / 1000).toFixed(1)} s)${reason}\n`,
      );
    },
  });
  if (values.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    const count = (status: ScenarioOutcome["status"]): number =>
      report.outcomes.filter((outcome) => outcome.status === status).length;
    process.stderr.write(
      `\n${report.host?.host.name ?? "host"}: ${count("passed")} passed, ${count("failed")} failed, ${count("expected-failure")} expected failures, ${count("unexpected-pass")} stale baseline entries, ${count("skipped")} skipped: ${report.ok ? "conformant" : "not conformant"}\n`,
    );
  }
  return report.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`mostra-conformance: ${(error as Error).stack ?? error}\n`);
    process.exitCode = 2;
  },
);
