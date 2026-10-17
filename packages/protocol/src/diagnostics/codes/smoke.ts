/**
 * Diagnostic codes of the SMOKE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the SMOKE area, in the order they were added. */
export const smokeDiagnosticCodes = [
  "MOSTRA_SMOKE_NO_EFFECT",
  "MOSTRA_SMOKE_BUDGET",
  // gen:codes
] as const;

/** The codes of the SMOKE area. */
export type SmokeDiagnosticCode = (typeof smokeDiagnosticCodes)[number];

/** The SMOKE area's catalog entries. */
export const smokeDiagnostics: AreaCatalog<SmokeDiagnosticCode> = {
  MOSTRA_SMOKE_NO_EFFECT: {
    severity: "warning",
    phase: "smoke",
    title: "Control showed no effect",
    hint: "Observed only: using this control twice changed nothing verify could see; a control that acts on something verify can't observe needs no change.",
    docs: {
      explanation:
        "Verify's smoke test clicked or hovered the control the message names, once among the other controls and again after them, and saw no change either time: no change to the page, no request, no saved field, no navigation and no error. Controls that are disabled or already active (the selected tab) are skipped, and those that open on hover are hovered. A control can still be fine: it may act on something verify can't observe, such as the clipboard or a sound.",
      fix: "Read the control's handler. If it does what it should, nothing needs to change; if it is meant to change the page, look at why it doesn't.",
    },
  },
  MOSTRA_SMOKE_BUDGET: {
    severity: "hint",
    phase: "smoke",
    title: "Smoke test stopped at its budget",
    hint: "Nothing to fix: the smoke test stops after 200 interactions or 60 s.",
    docs: {
      explanation:
        "The page has more controls than the smoke test uses in one run, so it stopped at its budget. The controls it used are counted in `smoke.interactions`.",
      fix: "Nothing is required.",
    },
  },
  // gen:entries
};
