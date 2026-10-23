/**
 * Fault injection for tests (FAILURE_MODEL §3, VR-02, issue #7). A test that runs real Mostra
 * processes sets `MOSTRA_TEST_FAULTS` to a comma-separated list of `<point>:<action>` entries, and
 * the instance stops at those points: `throw` fails the operation there, `crash` kills the
 * supervisor with SIGKILL there, as a power cut or `kill -9` would, and `hang` makes the child the
 * point names hang (the module asks {@link Faults.hangs}; a builder told never to answer, so a test
 * of the build limit never races a fast build, issue #18). Without the variable every point
 * is a no-op. The points are named in the modules that call {@link Faults.at}.
 *
 * ```ts
 * faults.at("publish:after-promote"); // a crash here leaves a version directory with no row
 * ```
 */
import type { Environment } from "./log.ts";

/** What a fault point does. */
export type FaultAction = "throw" | "throw-once" | "crash" | "hang";

/** The test fault points of one instance. */
export interface Faults {
  /** Runs the fault configured for `point`, if any (`hang` is the caller's to act on). */
  at(point: string): void;
  /** Whether `point` is configured to `hang`. */
  hangs(point: string): boolean;
}

/** The variable tests set. It carries no secrets and changes nothing when unset. */
export const FAULTS_VARIABLE = "MOSTRA_TEST_FAULTS";

/** No faults: every point is a no-op. */
export const noFaults: Faults = { at() {}, hangs: () => false };

/** The error a `throw` fault raises. */
export class InjectedFault extends Error {
  constructor(point: string) {
    super(`Injected fault at ${point} (${FAULTS_VARIABLE}).`);
    this.name = "InjectedFault";
  }
}

/** Reads the faults configured in `env`. Unknown actions are ignored. */
export function faultsFrom(env: Environment): Faults {
  const spec = env[FAULTS_VARIABLE];
  if (!spec) return noFaults;
  const configured = new Map<string, FaultAction>();
  for (const entry of spec.split(",")) {
    const separator = entry.lastIndexOf(":");
    const point = entry.slice(0, separator).trim();
    const action = entry.slice(separator + 1).trim();
    if (
      point &&
      (action === "throw" || action === "throw-once" || action === "crash" || action === "hang")
    )
      configured.set(point, action);
  }
  return {
    hangs: (point) => configured.get(point) === "hang",
    at(point) {
      const action = configured.get(point);
      if (action === "throw") throw new InjectedFault(point);
      if (action === "throw-once") {
        configured.delete(point);
        throw new InjectedFault(point);
      }
      if (action === "crash") {
        process.kill(process.pid, "SIGKILL");
        // The signal is delivered at once; block until it lands so no later step runs.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
      }
    },
  };
}
