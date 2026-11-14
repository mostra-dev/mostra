/**
 * Diagnostic codes of the LICENSE area: the licenses plugins and packs bring, and their acknowledgment (D31, EX-04).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the LICENSE area, in the order they were added. */
export const licenseDiagnosticCodes = [
  "MOSTRA_LICENSE_UNACCEPTED",
  "MOSTRA_LICENSE_UNDECLARED",
  "MOSTRA_LICENSE_MISMATCH",
  "MOSTRA_LICENSE_ACCEPT_INVALID",
  // gen:codes
] as const;

/** The codes of the LICENSE area. */
export type LicenseDiagnosticCode = (typeof licenseDiagnosticCodes)[number];

/** The LICENSE area's catalog entries. */
export const licenseDiagnostics: AreaCatalog<LicenseDiagnosticCode> = {
  MOSTRA_LICENSE_UNACCEPTED: {
    severity: "error",
    phase: "contract",
    title: "License needs acknowledgment",
    hint: "Read the license the message names, then run the command in this diagnostic's fix to accept it.",
    docs: {
      explanation:
        "The install brings a license that isn't OSI-approved and isn't a public-domain dedication or another free license: a source-available or proprietary license, or one Mostra can't read. Such a license is accepted once per artifact (or for the home), by `--accept-license <id>` or by the host's policy, and the lockfile records it (D31). This is disclosure, not a limit: anyone may accept, and nothing was installed or recorded before they do. The message names each license, its class and the packages under it.",
      fix: "Read the license's terms (the message gives its summary and URL when the plugin declares them), then add the plugin again with `--accept-license <id>` for each ID, as the fix shows.",
    },
  },
  MOSTRA_LICENSE_UNDECLARED: {
    severity: "warning",
    phase: "manifest",
    title: "Dependency license not declared",
    hint: "Declare the license in the plugin manifest's bundledLicenses, with a summary and a URL.",
    docs: {
      explanation:
        "A package the plugin brings has a license that needs an acknowledgment, and the manifest's `bundledLicenses` doesn't declare it, so the person installing sees only the package's own license field. Mostra still finds and discloses it from the installed packages.",
      fix: 'Add `{ "package": "<name>", "license": "<expression>", "summary": "\u2026", "url": "\u2026" }` to `bundledLicenses`.',
    },
  },
  MOSTRA_LICENSE_MISMATCH: {
    severity: "warning",
    phase: "manifest",
    title: "Declared license differs",
    hint: "Make the manifest's declaration match the package's own license field.",
    docs: {
      explanation:
        "The manifest declares a license for a package (in `bundledLicenses`, or its own `license`) that differs from the license field the package itself carries. Mostra discloses the package's own field, which it can read, and uses a declaration only where the field can't be read.",
      fix: "Correct the declaration, or the package's license field if the declaration is right.",
    },
  },
  MOSTRA_LICENSE_ACCEPT_INVALID: {
    severity: "error",
    phase: "host",
    title: "Accepted license not understood",
    hint: "Pass a license ID such as LicenseRef-Remotion, or * for every license.",
    docs: {
      explanation:
        "A value of `--accept-license` (or of the host's `licenses.accept`) is neither an SPDX license ID, nor a `LicenseRef-` reference, nor `*`.",
      fix: "Copy the ID from the `MOSTRA_LICENSE_UNACCEPTED` diagnostic that asked for it.",
    },
  },
  // gen:entries
};
