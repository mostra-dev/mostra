/**
 * Diagnostic codes of the ACTION area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ACTION area, in the order they were added. */
export const actionDiagnosticCodes = [
  "MOSTRA_ACTION_EXPORT_INVALID",
  // gen:codes
] as const;

/** The codes of the ACTION area. */
export type ActionDiagnosticCode = (typeof actionDiagnosticCodes)[number];

/** The ACTION area's catalog entries. */
export const actionDiagnostics: AreaCatalog<ActionDiagnosticCode> = {
  MOSTRA_ACTION_EXPORT_INVALID: {
    severity: "error",
    phase: "compile",
    title: "Server module exports something other than an async function",
    hint: 'Export only async functions from a "use server" module; move other exports to an ordinary module.',
    docs: {
      explanation:
        'A module that starts with `"use server"` makes every export a server function the page can call. React\'s contract allows only async functions there. Mostra reports this code for any other export (a constant, a class, a non-async function, `export *`), naming the export.',
      fix: "Make the function `async`, or move the value to a separate module without the directive and import it from both sides.",
    },
  },
  // gen:entries
};
