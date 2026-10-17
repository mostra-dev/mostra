/**
 * Diagnostic codes of the REGRESSION area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the REGRESSION area, in the order they were added. */
export const regressionDiagnosticCodes = [
  "MOSTRA_REGRESSION_ARIA",
  "MOSTRA_REGRESSION_PIXELS",
  "MOSTRA_REGRESSION_FIELD_REMOVED",
  "MOSTRA_REGRESSION_ACTION_REMOVED",
  "MOSTRA_REGRESSION_LIVE_REMOVED",
  "MOSTRA_REGRESSION_PAGE_REMOVED",
  // gen:codes
] as const;

/** The codes of the REGRESSION area. */
export type RegressionDiagnosticCode = (typeof regressionDiagnosticCodes)[number];

/** The REGRESSION area's catalog entries. */
export const regressionDiagnostics: AreaCatalog<RegressionDiagnosticCode> = {
  MOSTRA_REGRESSION_ARIA: {
    severity: "warning",
    phase: "regression",
    title: "Controls or landmarks gone since the last passing version",
    hint: "Observed only: the last passing version had these controls or landmarks and this source doesn't; a change that removed them on purpose needs nothing more.",
    docs: {
      explanation:
        "Verify compared this source's accessibility snapshot with the newest version whose verdict passed, rendered in the same run with the same data. The controls or landmarks the message lists (by role and name) were there and aren't now. A redesign may remove them on purpose.",
      fix: "If they should be gone, nothing needs to change. If not, look at what removed them.",
    },
  },
  MOSTRA_REGRESSION_PIXELS: {
    severity: "warning",
    phase: "regression",
    title: "Page looks different from the last passing version",
    hint: "Observed only: this share of the viewport's pixels differs from the last passing version; an intended visual change shows here too and needs nothing more.",
    docs: {
      explanation:
        "Verify rendered the newest version whose verdict passed and this source at the same viewport, clock and data, and the share of pixels the message gives differs between them. Any intended visual change shows here too.",
      fix: "If the change is one you made on purpose, nothing needs to change. To see where it is, read the ARIA snapshots, or look at the diff image the message names if you can view images.",
    },
  },
  MOSTRA_REGRESSION_FIELD_REMOVED: {
    severity: "warning",
    phase: "contract",
    title: "Field gone since the last passing version",
    hint: "Observed only: answers saved under this field ID won't carry over to this version; a field removed on purpose needs nothing more.",
    docs: {
      explanation:
        "A field ID the last passing version used is gone from this source. Viewers' answers under it become orphans when they switch (D42): kept, shown read-only and delivered, but not editable. The message gives how many saved answers it affects.",
      fix: "If the field was renamed by mistake, keep its old ID. If it was removed on purpose, nothing needs to change.",
    },
  },
  MOSTRA_REGRESSION_ACTION_REMOVED: {
    severity: "warning",
    phase: "contract",
    title: "Server function gone since the last passing version",
    hint: "Observed only: the last passing version had this server function and this source doesn't; one removed on purpose needs nothing more.",
    docs: {
      explanation:
        'A `"use server"` export the last passing version had is gone. Pages of the older version still call it while they are open, and keyed runs started by it can\'t be started again.',
      fix: "If it was renamed by mistake, keep its name. If it was removed on purpose, nothing needs to change.",
    },
  },
  MOSTRA_REGRESSION_LIVE_REMOVED: {
    severity: "warning",
    phase: "contract",
    title: "Live source gone since the last passing version",
    hint: "Observed only: the last passing version had this live source and this source doesn't; one removed on purpose needs nothing more.",
    docs: {
      explanation:
        "A live source (`live.ts` export) the last passing version had is gone, so its producer stops and hosts that push to it push to a key no page reads.",
      fix: "If it was renamed by mistake, keep its name. If it was removed on purpose, nothing needs to change.",
    },
  },
  MOSTRA_REGRESSION_PAGE_REMOVED: {
    severity: "warning",
    phase: "contract",
    title: "Page route gone since the last passing version",
    hint: "Observed only: the last passing version had this page route and this source doesn't; one removed on purpose needs nothing more.",
    docs: {
      explanation:
        "A route of `pages/` the last passing version had is gone, so links and bookmarks to it now open the artifact's fallback page.",
      fix: "If it was renamed by mistake, keep its path. If it was removed on purpose, nothing needs to change.",
    },
  },
  // gen:entries
};
