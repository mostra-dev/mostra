/**
 * Diagnostic codes of the RUNTIME area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the RUNTIME area, in the order they were added. */
export const runtimeDiagnosticCodes = [
  "MOSTRA_RUNTIME_WORKER_CRASHED",
  "MOSTRA_RUNTIME_WORKER_PARKED",
  "MOSTRA_RUNTIME_PAGE_ERROR",
  "MOSTRA_RUNTIME_BLANK",
  "MOSTRA_RUNTIME_NOT_READY",
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
  MOSTRA_RUNTIME_PAGE_ERROR: {
    severity: "error",
    phase: "runtime",
    title: "Uncaught error in the page",
    hint: "Fix the error the message names; it was thrown in the page and nothing caught it.",
    docs: {
      explanation:
        "The artifact's page threw an error that nothing caught, or a promise rejected with nothing handling it, while verify rendered it or while the smoke test used a control (the message says which). A viewer's page would meet the same error.",
      fix: "Find the stack's first frame in the artifact's code and fix the error there, or catch it where the page can recover.",
    },
  },
  MOSTRA_RUNTIME_BLANK: {
    severity: "error",
    phase: "runtime",
    title: "Page rendered nothing",
    hint: "Make the page render something visible; check its first render and its imports.",
    docs: {
      explanation:
        "After the page reported ready, no element had a visible box (text, image, SVG, canvas or video) and the screenshot was one uniform color. Usually the page threw during its first render, rendered nothing until data arrived, or hid everything with CSS.",
      fix: "Look at the other diagnostics for an error during the first render, and make the page show content (or a loading state) right away.",
    },
  },
  MOSTRA_RUNTIME_NOT_READY: {
    severity: "error",
    phase: "runtime",
    title: "Page never became ready",
    hint: "Make sure the entry's default export renders; check the other diagnostics for an error at load.",
    docs: {
      explanation:
        "The page never reported `mostra/ready`: the client runtime didn't mount it within the time verify allows, usually because the entry threw while loading or a module failed to load.",
      fix: "Fix the load error the other diagnostics report. A page that waits for data should render a loading state first.",
    },
  },
  // gen:entries
};
