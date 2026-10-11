/**
 * Diagnostic codes of the TARGET area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the TARGET area, in the order they were added. */
export const targetDiagnosticCodes = [
  "MOSTRA_TARGET_UNAVAILABLE",
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
  // gen:entries
};
