/**
 * `@mostra/conformance`: prove a host's Mostra integration (HO-05, D143). The kit runs scenarios
 * (durability across restart, exactly-once delivery, outbox replay, identity, trusted controls,
 * hygiene, version negotiation, long-lived state, the authoring directory's removal and more)
 * against a host through the harness protocol, judges them against the host's expected-failure
 * baseline, and ships reference hosts to copy.
 *
 * ```ts
 * const report = await runConformance({ host: "node my-host-harness.js", baseline });
 * if (!report.ok) process.exitCode = 1;
 * ```
 *
 * @packageDocumentation
 */
export { type Baseline, NO_BASELINE, readBaseline } from "./baseline.ts";
export { FIXTURES, type Fixture } from "./fixtures.ts";
export { codeOf, HostUnderTest, InstanceError } from "./harness/client.ts";
export {
  type CallError,
  type CallParams,
  type CallResult,
  type EventsParams,
  type EventsResult,
  HARNESS_METHODS,
  HARNESS_REVISIONS,
  type HarnessFeature,
  type InitializeParams,
  type InitializeResult,
  type ScriptParams,
  type StartParams,
  type StartResult,
  type StoredDelivery,
  type StoreResult,
} from "./harness/protocol.ts";
export { type HarnessImplementation, serveHarness } from "./harness/serve.ts";
export { REFERENCE_FAULTS, ReferenceStore, runReferenceHost } from "./reference-host.ts";
export {
  type ConformanceReport,
  type RunOptions,
  runConformance,
  type ScenarioOutcome,
  type ScenarioStatus,
} from "./runner.ts";
export {
  check,
  NotApplicable,
  type RunSettings,
  type Scenario,
  ScenarioContext,
  ScenarioFailure,
  same,
} from "./scenario.ts";
export { SCENARIOS } from "./scenarios/index.ts";
export {
  type Answer,
  type Ask,
  Browser,
  OpenError,
  type ParsedLink,
  parseLink,
  type RunState,
  resultOf,
  send,
  Viewer,
} from "./viewer.ts";
