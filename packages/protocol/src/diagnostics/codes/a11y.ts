/**
 * Diagnostic codes of the A11Y area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the A11Y area, in the order they were added. */
export const a11yDiagnosticCodes = [
  "MOSTRA_A11Y_SERIOUS",
  "MOSTRA_A11Y_MINOR",
  // gen:codes
] as const;

/** The codes of the A11Y area. */
export type A11yDiagnosticCode = (typeof a11yDiagnosticCodes)[number];

/** The A11Y area's catalog entries. */
export const a11yDiagnostics: AreaCatalog<A11yDiagnosticCode> = {
  MOSTRA_A11Y_SERIOUS: {
    severity: "warning",
    phase: "a11y",
    title: "Serious accessibility problem",
    hint: "Read axe's description of the rule in the message; it names the elements it found.",
    docs: {
      explanation:
        "axe-core found a problem it rates critical or serious, such as a button with no accessible name or text with too little contrast. The message names axe's rule and the elements; `count` says how many.",
      fix: "Follow the rule's advice for each element named, for example add an `aria-label` to an icon button.",
    },
  },
  MOSTRA_A11Y_MINOR: {
    severity: "hint",
    phase: "a11y",
    title: "Minor accessibility problem",
    hint: "Read axe's description of the rule in the message.",
    docs: {
      explanation:
        "axe-core found a problem it rates moderate or minor. The message names axe's rule and the elements.",
      fix: "Optionally follow the rule's advice.",
    },
  },
  // gen:entries
};
