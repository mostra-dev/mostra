/**
 * Diagnostic codes of the TARGET area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the TARGET area, in the order they were added. */
export const targetDiagnosticCodes = [
  "MOSTRA_TARGET_UNAVAILABLE",
  "MOSTRA_TARGET_CALL_TOO_LONG",
  // gen:codes
] as const;

/** The codes of the TARGET area. */
export type TargetDiagnosticCode = (typeof targetDiagnosticCodes)[number];

/** The TARGET area's catalog entries. */
export const targetDiagnostics: AreaCatalog<TargetDiagnosticCode> = {
  MOSTRA_TARGET_UNAVAILABLE: {
    severity: "error",
    phase: "runtime",
    title: "Not available in this delivery target",
    hint: "Open the published version through Mostra to use this feature.",
    docs: {
      explanation:
        "The page called something that needs Mostra's server, such as a server function, and this delivery target doesn't provide it: a static export, a file opened from disk, or a runtime without server support. The page keeps working without it.",
      fix: "Open the artifact through its Mostra link, where server functions, submissions and live data are available. In a static export, handle the error so the page explains what isn't available.",
    },
  },
  MOSTRA_TARGET_CALL_TOO_LONG: {
    severity: "error",
    phase: "runtime",
    title: "A call outlasted the chat host's limit",
    hint: "Make work that can take longer than 45 seconds an action run (useAction): a run outlives the call and reports its progress.",
    docs: {
      explanation:
        "A page shown inline in a chat host (an MCP App) reaches its server functions through the host's tool calls, which a host ends after about a minute. A plain call of a server function that hadn't finished within 45 seconds was stopped, and its result is lost: the function was asked to stop through its abort signal.",
      fix: "Call long work through useAction instead of calling the function directly: an action run is recorded before it starts, goes on after the call that started it, and the page follows its progress and result. In the full page, plain calls have no such limit.",
    },
  },
  // gen:entries
};
