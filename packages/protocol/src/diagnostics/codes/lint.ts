/**
 * Diagnostic codes of the LINT area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the LINT area, in the order they were added. */
export const lintDiagnosticCodes = [
  "MOSTRA_LINT_API_CHANGED",
  // gen:codes
] as const;

/** The codes of the LINT area. */
export type LintDiagnosticCode = (typeof lintDiagnosticCodes)[number];

/** The LINT area's catalog entries. */
export const lintDiagnostics: AreaCatalog<LintDiagnosticCode> = {
  MOSTRA_LINT_API_CHANGED: {
    severity: "warning",
    phase: "lint",
    title: "An API changed in a recent major release",
    hint: "Write the new form the fix shows, or run `mostra verify <artifact> --fix` to apply every such fix.",
    docs: {
      explanation:
        "A library the page uses changed this API in a recent major release, and the page uses the old form: an import that moved (`framer-motion`, `react-router-dom`, `reactflow`, TanStack Table 8's `useReactTable`), a call that is deprecated (Zod 3's `z.string().email()`, Mermaid's `init`), or a Tailwind CSS 3 class or directive that Tailwind CSS 4 writes another way, which does nothing now. Models trained before the release write the old form; it may still build, but it breaks or silently does nothing in the version Mostra ships.",
      fix: "Each finding carries a machine-applicable fix with the new form: apply it, or run `mostra verify <artifact> --fix`, which applies every fix verify found and verifies again.",
    },
  },
  // gen:entries
};
