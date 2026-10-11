/**
 * Diagnostic codes of the MANIFEST area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the MANIFEST area, in the order they were added. */
export const manifestDiagnosticCodes = [
  "MOSTRA_MANIFEST_NOT_LITERAL",
  "MOSTRA_MANIFEST_INVALID",
  "MOSTRA_MANIFEST_UNKNOWN_KEY",
  // gen:codes
] as const;

/** The codes of the MANIFEST area. */
export type ManifestDiagnosticCode = (typeof manifestDiagnosticCodes)[number];

/** The MANIFEST area's catalog entries. */
export const manifestDiagnostics: AreaCatalog<ManifestDiagnosticCode> = {
  MOSTRA_MANIFEST_NOT_LITERAL: {
    severity: "error",
    phase: "manifest",
    title: "Manifest isn't a literal",
    hint: "Write the manifest as plain values: strings, numbers, booleans, null, arrays and objects, with no variables, calls, spreads or computed keys.",
    docs: {
      explanation:
        "Mostra reads an artifact's manifest without running its code: the `export const artifact = defineArtifact({...})` in a TSX entry, or the frontmatter of an MDX entry. It reports this code when the exported `artifact` isn't a `defineArtifact(...)` call with one object literal, or when a value inside it needs evaluation (an identifier, a function call, a spread, a computed key, a template literal with `${}`). The location points at the first such value.",
      fix: 'Replace the value with the literal it stands for, for example `title: "Q3 review"` instead of `title: TITLE`. Keep computed values in the page code, where they can use anything. `as const` and `satisfies` on the object are fine.',
    },
  },
  MOSTRA_MANIFEST_INVALID: {
    severity: "error",
    phase: "manifest",
    title: "Manifest value is invalid",
    hint: "Fix the manifest field named in the message so it matches the manifest's documented shape.",
    docs: {
      explanation:
        "The manifest was read, but a field has a value the manifest doesn't allow: a missing `title`, a wrong type, an `id` that isn't an artifact ID (`art_` followed by a ULID), a `mode` this runtime doesn't build (`spa` is the only one), or frontmatter that isn't valid YAML. The message names the field and what was expected.",
      fix: "Correct the field the message names. Leave `id` out to let Mostra bind the artifact to its source path at first publish, or keep the `id` that `mostra new` wrote. Every field except `title` is optional.",
    },
  },
  MOSTRA_MANIFEST_UNKNOWN_KEY: {
    severity: "warning",
    phase: "manifest",
    title: "Unknown manifest key",
    hint: "Remove the key or correct its spelling; a newer Mostra may support it.",
    docs: {
      explanation:
        "The manifest has a key this runtime doesn't know. Mostra ignores it, so manifests written for a newer release still publish, but a misspelled key (`familly`, `decription`) silently has no effect.",
      fix: "Check the key against the manifest fields (`id`, `title`, `description`, `family`, `links`, `mode`, `submission`, `kit`, `terminals`, `demos`, `limits`, `verify`) and fix the spelling, or remove it.",
    },
  },
  // gen:entries
};
