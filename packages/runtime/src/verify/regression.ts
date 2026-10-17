/**
 * Regressions against the last passing version (AX-04, ROUND-3 §9, D137 item 4): contracts from
 * the two versions' `registry.json`, the controls and landmarks of their ARIA snapshots, and the
 * share of pixels that differ. Every regression is a warning that says what was observed (D72):
 * a redesign may change any of them on purpose.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { coverageMatcher, type VersionRegistry } from "../builder/index.ts";

/** The share of differing pixels above which a viewport counts as changed. */
export const PIXEL_THRESHOLD = 0.01;

/** The roles a regression of the ARIA snapshot compares: controls and landmarks. */
const COMPARED_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "form",
  "search",
  "region",
  "dialog",
]);

/**
 * The controls and landmarks of an ARIA snapshot, as `role "name"` with digits folded, so a
 * counter or a date in a name doesn't read as a removed control.
 */
export function ariaControls(snapshot: string): string[] {
  const found: string[] = [];
  for (const match of snapshot.matchAll(/^\s*- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/gm)) {
    const role = match[1] as string;
    if (!COMPARED_ROLES.has(role)) continue;
    const name = (match[2] ?? "").replace(/\d+/g, "#").trim();
    found.push(name ? `${role} "${name}"` : role);
  }
  return found;
}

/** The controls and landmarks the baseline had and the candidate doesn't, counting repeats. */
export function removedControls(baseline: string, candidate: string): string[] {
  const left = new Map<string, number>();
  for (const control of ariaControls(candidate)) left.set(control, (left.get(control) ?? 0) + 1);
  const removed: string[] = [];
  for (const control of ariaControls(baseline)) {
    const count = left.get(control) ?? 0;
    if (count > 0) left.set(control, count - 1);
    else removed.push(control);
  }
  return removed;
}

/** The ARIA regression of one viewport, if the baseline had controls the candidate lacks. */
export function ariaRegression(
  baseline: string,
  candidate: string,
  viewport: string,
): { readonly diagnostic: Diagnostic; readonly summary: string } | undefined {
  const removed = removedControls(baseline, candidate);
  if (removed.length === 0) return undefined;
  const shown = removed.slice(0, 5).join(", ");
  const more = removed.length > 5 ? ` and ${removed.length - 5} more` : "";
  const summary = `${viewport}: ${shown}${more}`;
  return {
    summary,
    diagnostic: createDiagnostic("MOSTRA_REGRESSION_ARIA", {
      message: `Observed at ${viewport}: the last passing version showed ${shown}${more}, which this source doesn't.`,
      location: { viewport },
    }),
  };
}

/** The pixel regression of one viewport, when its difference passes {@link PIXEL_THRESHOLD}. */
export function pixelRegression(
  ratio: number,
  sizeChanged: boolean,
  viewport: string,
  diffPath: string,
): Diagnostic | undefined {
  if (!sizeChanged && ratio <= PIXEL_THRESHOLD) return undefined;
  return createDiagnostic("MOSTRA_REGRESSION_PIXELS", {
    message: `Observed at ${viewport}: ${(ratio * 100).toFixed(1)} % of the pixels differ from the last passing version, rendered in the same run with the same clock and data. The difference is in ${diffPath}.`,
    location: { viewport },
  });
}

/**
 * What the candidate's registry drops of the baseline's: literal field IDs it no longer covers,
 * server functions, live sources and page routes. `savedAnswers` counts the answers the home holds
 * under a field ID, which become orphans when viewers switch (D42).
 */
export function contractRegressions(
  baseline: VersionRegistry,
  candidate: VersionRegistry,
  savedAnswers: (fieldId: string) => number,
): { readonly diagnostics: Diagnostic[]; readonly summary: string[] } {
  const diagnostics: Diagnostic[] = [];
  const summary: string[] = [];
  const covers = coverageMatcher(candidate.fields);
  const fields = new Set(
    (baseline.fields?.entries ?? []).flatMap((entry) => (entry.id !== undefined ? [entry.id] : [])),
  );
  for (const id of [...fields].sort()) {
    if (covers(id)) continue;
    const saved = savedAnswers(id);
    summary.push(`field ${id}`);
    diagnostics.push(
      createDiagnostic("MOSTRA_REGRESSION_FIELD_REMOVED", {
        message: `Observed: the last passing version used the field ID "${id}" and this source doesn't${saved > 0 ? `; ${saved} saved ${saved === 1 ? "answer" : "answers"} under it won't carry over` : ""}.`,
      }),
    );
  }
  const actions = new Set(candidate.actions.map((entry) => entry.id));
  for (const entry of baseline.actions) {
    if (actions.has(entry.id)) continue;
    summary.push(`action ${entry.id}`);
    diagnostics.push(
      createDiagnostic("MOSTRA_REGRESSION_ACTION_REMOVED", {
        message: `Observed: the last passing version had the server function ${entry.id} and this source doesn't.`,
      }),
    );
  }
  const sources = new Set(candidate.liveSources.map((entry) => entry.key));
  for (const entry of baseline.liveSources) {
    if (sources.has(entry.key)) continue;
    summary.push(`live source ${entry.key}`);
    diagnostics.push(
      createDiagnostic("MOSTRA_REGRESSION_LIVE_REMOVED", {
        message: `Observed: the last passing version had the live source ${entry.key} and this source doesn't.`,
      }),
    );
  }
  const pages = new Set(candidate.pages.map((page) => page.path));
  for (const page of baseline.pages) {
    if (pages.has(page.path)) continue;
    summary.push(`page ${page.path}`);
    diagnostics.push(
      createDiagnostic("MOSTRA_REGRESSION_PAGE_REMOVED", {
        message: `Observed: the last passing version had the page ${page.path} and this source doesn't.`,
      }),
    );
  }
  return { diagnostics, summary };
}
