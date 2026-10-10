/**
 * The diagnostic catalog, assembled from one source file per area. `pnpm gen diagnostic` keeps
 * the lists below in step with the area files; edit the area files, not these lists.
 */
import type { Diagnostic } from "../diagnostic.ts";
import { buildDiagnostic, type DiagnosticDetails, type DiagnosticSpec } from "../spec.ts";
// gen:area-imports
import { type HostDiagnosticCode, hostDiagnostics } from "./host.ts";

// gen:area-exports
export { type HostDiagnosticCode, hostDiagnosticCodes } from "./host.ts";

/** Every code in the catalog. Codes are semver surface and are never removed (AX-03). */
export type KnownDiagnosticCode =
  // gen:area-codes
  HostDiagnosticCode;

/** Every cataloged code with its severity, phase, title, default hint and docs text. */
export const diagnosticCatalog: Readonly<Record<KnownDiagnosticCode, DiagnosticSpec>> = {
  // gen:area-spreads
  ...hostDiagnostics,
};

/** Options for {@link createDiagnostic}. */
export interface CreateDiagnosticOptions {
  /** The docs site base URL. Defaults to `DEFAULT_DOCS_BASE`. */
  readonly docsBase?: string;
}

/**
 * Creates the diagnostic for one occurrence of a cataloged code. Severity, phase, the default hint
 * and the docs link come from the catalog.
 *
 * ```ts
 * createDiagnostic("MOSTRA_HOST_REVISION_UNSUPPORTED", {
 *   message: "The client offered 2026-01-01; this instance supports 2026-10-10.",
 * });
 * ```
 */
export function createDiagnostic(
  code: KnownDiagnosticCode,
  details: DiagnosticDetails,
  options: CreateDiagnosticOptions = {},
): Diagnostic {
  return buildDiagnostic(code, diagnosticCatalog[code], details, options.docsBase);
}
