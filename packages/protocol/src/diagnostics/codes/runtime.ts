/**
 * Diagnostic codes of the RUNTIME area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the RUNTIME area, in the order they were added. */
export const runtimeDiagnosticCodes = [
  "MOSTRA_RUNTIME_WORKER_CRASHED",
  "MOSTRA_RUNTIME_WORKER_PARKED",
  // gen:codes
] as const;

/** The codes of the RUNTIME area. */
export type RuntimeDiagnosticCode = (typeof runtimeDiagnosticCodes)[number];

/** The RUNTIME area's catalog entries. */
export const runtimeDiagnostics: AreaCatalog<RuntimeDiagnosticCode> = {
  MOSTRA_RUNTIME_WORKER_CRASHED: {
    severity: "error",
    phase: "runtime",
    title: "Artifact server code crashed",
    hint: "Read the cause and the worker's last output, fix the server code, and publish again.",
    docs: {
      explanation:
        "The artifact version's worker process exited while serving a call: it threw outside any call, ran out of its heap (1 GiB by default), or kept its event loop blocked past the watchdog (10 s by default). Other artifacts and the gateway keep working (RT-04). Mostra appends `worker.crashed` with the cause and starts the worker again on the next request, waiting longer after each crash (1 s up to 60 s).",
      fix: "Fix the crash in the server code. A long synchronous computation can raise `limits.watchdogMs` in the manifest, and a large data set `limits.heapMb`; both are stability limits, not security ones.",
    },
  },
  MOSTRA_RUNTIME_WORKER_PARKED: {
    severity: "error",
    phase: "runtime",
    title: "Artifact server code keeps crashing",
    hint: "Fix the server code and publish again, which clears the park; the message names the last crash's cause.",
    docs: {
      explanation:
        "The artifact version's worker crashed more than 5 times in 10 minutes, so Mostra stopped starting it (FAILURE_MODEL \u00a72). Calls, runs and live sources of that version answer this code until the park clears, and the shell tells the viewer that the artifact's server code keeps crashing.",
      fix: "Find the cause in the message and the worker's output, fix it, and publish again: a new publish, `verify` or a restart of the instance clears the park.",
    },
  },
  // gen:entries
};
