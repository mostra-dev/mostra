/**
 * Diagnostic codes of the CONSOLE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the CONSOLE area, in the order they were added. */
export const consoleDiagnosticCodes = [
  "MOSTRA_CONSOLE_ERROR",
  "MOSTRA_CONSOLE_WARNING",
  // gen:codes
] as const;

/** The codes of the CONSOLE area. */
export type ConsoleDiagnosticCode = (typeof consoleDiagnosticCodes)[number];

/** The CONSOLE area's catalog entries. */
export const consoleDiagnostics: AreaCatalog<ConsoleDiagnosticCode> = {
  MOSTRA_CONSOLE_ERROR: {
    severity: "error",
    phase: "console",
    title: "Error logged to the console",
    hint: "Fix what the logged error describes; React logs errors its boundaries catch here too.",
    docs: {
      explanation:
        "The page logged an error with `console.error` while verify rendered it or used its controls. Errors caught by React error boundaries, the root's included, are logged this way. A viewer's page would log the same.",
      fix: "Read the message and fix its cause in the artifact's code. Errors logged by a library usually name what it was given.",
    },
  },
  MOSTRA_CONSOLE_WARNING: {
    severity: "hint",
    phase: "console",
    title: "Warning logged to the console",
    hint: "Read the warning; nothing is broken by it.",
    docs: {
      explanation:
        "The page logged a warning with `console.warn`. Warnings are often a library's advice, so they are hints.",
      fix: "Nothing is required.",
    },
  },
  // gen:entries
};
