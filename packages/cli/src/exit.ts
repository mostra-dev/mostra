/**
 * The exit codes (INTERFACES §9, D140 item 16): one table keyed by diagnostic code, so every
 * command ends the same way for the same failure. Each area has a code, and a few codes differ
 * from their area; the table is total over the catalog by construction, and a test checks every
 * catalog code against it.
 */
import type { DiagnosticArea } from "@mostra/protocol";

/** The exit codes of INTERFACES §9. */
export const EXIT = {
  /** Success, or `verify` passed. */
  ok: 0,
  /** Artifact failure: verify failed, publish refused, a request the artifact's state refused. */
  failure: 1,
  /** Usage error. */
  usage: 2,
  /** Environment error: no runtime, browser or socket; the home; an unsupported platform. */
  environment: 3,
  /** Timeout: `--timeout` passed before the instance answered. */
  timeout: 4,
  /** `wait` ended `still_waiting`: not an error, the status is in the result. */
  stillWaiting: 5,
  /** Conflict: `once` already submitted, a compare-and-set mismatch, a reused request ID. */
  conflict: 6,
} as const;

/** One of {@link EXIT}'s codes. */
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Each area's exit code. Every area is here: a new one fails the type check until it is. */
const BY_AREA: Readonly<Record<DiagnosticArea, ExitCode>> = {
  MANIFEST: EXIT.failure,
  BUILD: EXIT.failure,
  TYPE: EXIT.failure,
  LINT: EXIT.failure,
  DEP: EXIT.failure,
  KIT: EXIT.failure,
  FIELD: EXIT.failure,
  ACTION: EXIT.failure,
  LIVE: EXIT.failure,
  RUNTIME: EXIT.failure,
  CONSOLE: EXIT.failure,
  NETWORK: EXIT.failure,
  A11Y: EXIT.failure,
  VISUAL: EXIT.failure,
  SMOKE: EXIT.failure,
  REGRESSION: EXIT.failure,
  TERM: EXIT.failure,
  PUBLISH: EXIT.failure,
  SUBMIT: EXIT.failure,
  HOST: EXIT.environment,
  HOME: EXIT.environment,
  HYGIENE: EXIT.failure,
  SECRET: EXIT.failure,
  SHARE: EXIT.environment,
  VERIFY: EXIT.failure,
  TARGET: EXIT.failure,
  ENV: EXIT.environment,
  PLATFORM: EXIT.environment,
  ARTIFACT: EXIT.failure,
  CLI: EXIT.usage,
};

/** Codes whose exit code isn't their area's. */
const BY_CODE: Readonly<Record<string, ExitCode>> = {
  MOSTRA_HOST_TIMEOUT: EXIT.timeout,
  MOSTRA_HOST_INVALID_PARAMS: EXIT.usage,
  MOSTRA_HOST_REQUEST_ID_REUSED: EXIT.conflict,
  MOSTRA_HOST_CURSOR_COMPACTED: EXIT.failure,
  MOSTRA_HOST_SUBSCRIPTION_UNKNOWN: EXIT.usage,
  MOSTRA_SUBMIT_ALREADY: EXIT.conflict,
  MOSTRA_SUBMIT_REVISION_MOVED: EXIT.conflict,
  MOSTRA_FIELD_CONFLICT: EXIT.conflict,
  MOSTRA_FIELD_MUTATION_ID_REUSED: EXIT.conflict,
  MOSTRA_PUBLISH_ID_CONFLICT: EXIT.failure,
  MOSTRA_HOME_INTEGRITY: EXIT.failure,
  MOSTRA_HOME_NOT_ALWAYS_ON: EXIT.ok,
  MOSTRA_VERIFY_CRASHED: EXIT.environment,
};

/** The exit code a diagnostic ends a command with. An unknown area is an environment error. */
export function exitCodeFor(code: string): ExitCode {
  const exact = BY_CODE[code];
  if (exact !== undefined) return exact;
  const area = /^MOSTRA_([A-Z0-9]+)_/.exec(code)?.[1];
  return (area !== undefined ? BY_AREA[area as DiagnosticArea] : undefined) ?? EXIT.environment;
}
