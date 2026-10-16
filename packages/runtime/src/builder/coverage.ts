/**
 * Field coverage (D109): which field IDs a version's code can use, as the builder's static scan
 * records them in `registry.json`, and the one matcher the supervisor judges orphans with. Pure
 * and free of the bundler, so the supervisor and `verify` (WP-09) can use it.
 */

/** Where a field ID was found. */
export interface FieldLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** The client-runtime call that names a field. */
export type FieldHook = "useField" | "useChoice" | "useForm" | "storage";

/** One place the version's code names a field ID. */
export interface FieldEntry {
  /** A literal field ID. Exactly one of `id` and `template` is set. */
  readonly id?: string;
  /**
   * A template field ID: its literal parts around each `${…}` hole, so `reply.${m.id}` is
   * `["reply.", ""]`. A hole stands for any text.
   */
  readonly template?: readonly string[];
  /** The call that names it. */
  readonly hook: FieldHook;
  /** Its scope, when the code gives it literally; absent when unknown or the default (`viewer`). */
  readonly scope?: "viewer" | "artifact";
  /** Its literal `label`, `required` and `sensitive` options, for `verify` and the shell. */
  readonly label?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly location: FieldLocation;
}

/** The fields a version covers (D109). */
export interface FieldCoverage {
  /**
   * `true` when the version's code can use field IDs the scan couldn't know (a computed ID, a
   * hook passed around, a package that uses the hooks itself): the version then covers every
   * ID, so nothing is ever orphaned by a guess.
   */
  readonly open: boolean;
  /** Why the coverage is open, for `verify`'s hints; empty when it isn't. */
  readonly openReasons: readonly { readonly reason: string; readonly location?: FieldLocation }[];
  /** Every place a field ID is named, in source order. */
  readonly entries: readonly FieldEntry[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a version with this coverage covers a draft field ID (D109). A version without
 * coverage (built before WP-07) covers everything, as does an open one. Only entries that may be
 * viewer-scoped count: an artifact-scoped field never lives in a draft.
 */
export function coverageMatcher(coverage: FieldCoverage | undefined): (fieldId: string) => boolean {
  if (coverage === undefined || coverage.open) return () => true;
  const ids = new Set<string>();
  const templates: RegExp[] = [];
  for (const entry of coverage.entries) {
    if (entry.scope === "artifact") continue;
    if (entry.id !== undefined) ids.add(entry.id);
    else if (entry.template !== undefined) {
      templates.push(new RegExp(`^${entry.template.map(escapeRegExp).join("[\\s\\S]*")}$`));
    }
  }
  return (fieldId) => ids.has(fieldId) || templates.some((pattern) => pattern.test(fieldId));
}
