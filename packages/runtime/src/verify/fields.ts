/**
 * Field-ID lint (AU-05, D52, D138 item 3): pure judgements over a version's static field scan
 * (`registry.json`'s `fields`, D109) and what the field probe saw mounted.
 *
 * - **Duplicate IDs**: one ID used with another hook kind, another scope or an initial value of
 *   another type is an error, whether the static scan or the page shows it.
 * - **Shared IDs**: the same ID mounted several times the same way is a deliberate shared value,
 *   a hint.
 * - **Changing IDs**: two fresh boots with identical inputs and one fixed clock; an ID mounted in
 *   one and not the other, that no literal ID of the scan names, is an error.
 */
import { createDiagnostic, type Diagnostic, type ProbedField } from "@mostra/protocol";
import type { FieldCoverage, FieldEntry } from "../builder/index.ts";

const where = (entry: FieldEntry): string =>
  `${entry.location.file}:${entry.location.line}:${entry.location.column}`;

/** Static duplicates: one literal ID named by two hooks, or with two literal scopes. */
export function staticFieldLint(coverage: FieldCoverage | undefined): Diagnostic[] {
  if (!coverage) return [];
  const byId = new Map<string, FieldEntry[]>();
  for (const entry of coverage.entries) {
    if (entry.id === undefined) continue;
    byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  }
  const findings: Diagnostic[] = [];
  for (const [id, entries] of byId) {
    const first = entries[0] as FieldEntry;
    const other = entries.find(
      (entry) =>
        entry.hook !== first.hook || (entry.scope ?? "viewer") !== (first.scope ?? "viewer"),
    );
    if (!other) continue;
    const how =
      other.hook !== first.hook
        ? `with ${first.hook} at ${where(first)} and ${other.hook} at ${where(other)}`
        : `with scope ${first.scope ?? "viewer"} at ${where(first)} and scope ${other.scope ?? "viewer"} at ${where(other)}`;
    findings.push(
      createDiagnostic("MOSTRA_FIELD_DUPLICATE_ID", {
        message: `The field ID "${id}" is used for two different fields: ${how}.`,
        location: other.location,
      }),
    );
  }
  return findings;
}

/** What the probe saw: conflicting mounts (errors) and IDs mounted more than once (hints). */
export function probedFieldLint(fields: readonly ProbedField[], viewport: string): Diagnostic[] {
  const findings: Diagnostic[] = [];
  for (const field of fields) {
    if (field.conflicts.length > 0) {
      findings.push(
        createDiagnostic("MOSTRA_FIELD_DUPLICATE_ID", {
          message: `The page mounted the field ID "${field.id}" for two different fields: ${field.conflicts.join("; ")}.`,
          location: { viewport },
        }),
      );
    } else if (field.mounts > 1) {
      findings.push(
        createDiagnostic("MOSTRA_FIELD_SHARED", {
          message: `${field.mounts} mounted components use the field ID "${field.id}" the same way, so they edit one saved value.`,
          location: { viewport },
        }),
      );
    }
  }
  return findings;
}

/** Whether a literal ID of the static scan names `id`. */
const literal = (coverage: FieldCoverage | undefined, id: string): boolean =>
  coverage?.entries.some((entry) => entry.id === id) ?? false;

/**
 * IDs that differ between two boots with identical inputs (D138 item 3): mounted in one and not
 * the other, and named by no literal ID of the scan.
 */
export function unstableFieldLint(
  first: readonly ProbedField[],
  second: readonly ProbedField[],
  coverage: FieldCoverage | undefined,
  viewport: string,
): Diagnostic[] {
  const mounted = (fields: readonly ProbedField[]): Set<string> =>
    new Set(fields.filter((field) => field.mounts > 0).map((field) => field.id));
  const a = mounted(first);
  const b = mounted(second);
  const changed = [...a].filter((id) => !b.has(id) && !literal(coverage, id));
  const appeared = [...b].filter((id) => !a.has(id) && !literal(coverage, id));
  if (changed.length === 0 && appeared.length === 0) return [];
  const sample = (ids: string[]): string =>
    ids
      .slice(0, 3)
      .map((id) => `"${id}"`)
      .join(", ");
  return [
    createDiagnostic("MOSTRA_FIELD_ID_UNSTABLE", {
      message: `Two loads of the page with identical inputs mounted different field IDs: ${sample(changed) || "none"} the first time, ${sample(appeared) || "none"} the second. A viewer's saved answers under them would be lost on reload.`,
      location: { viewport },
    }),
  ];
}
