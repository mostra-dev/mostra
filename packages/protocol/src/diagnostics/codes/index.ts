/**
 * The diagnostic catalog, assembled from one source file per area. `pnpm gen diagnostic` keeps
 * the lists below in step with the area files; edit the area files, not these lists.
 */
import type { Diagnostic } from "../diagnostic.ts";
import { buildDiagnostic, type DiagnosticDetails, type DiagnosticSpec } from "../spec.ts";
import { type ActionDiagnosticCode, actionDiagnostics } from "./action.ts";
import { type ArtifactDiagnosticCode, artifactDiagnostics } from "./artifact.ts";
import { type BuildDiagnosticCode, buildDiagnostics } from "./build.ts";
// gen:area-imports
import { type DepDiagnosticCode, depDiagnostics } from "./dep.ts";
import { type EnvDiagnosticCode, envDiagnostics } from "./env.ts";
import { type HomeDiagnosticCode, homeDiagnostics } from "./home.ts";
import { type HostDiagnosticCode, hostDiagnostics } from "./host.ts";
import { type ManifestDiagnosticCode, manifestDiagnostics } from "./manifest.ts";
import { type PlatformDiagnosticCode, platformDiagnostics } from "./platform.ts";
import { type PublishDiagnosticCode, publishDiagnostics } from "./publish.ts";
import { type TargetDiagnosticCode, targetDiagnostics } from "./target.ts";

export { type ActionDiagnosticCode, actionDiagnosticCodes } from "./action.ts";
export { type ArtifactDiagnosticCode, artifactDiagnosticCodes } from "./artifact.ts";
export { type BuildDiagnosticCode, buildDiagnosticCodes } from "./build.ts";
// gen:area-exports
export { type DepDiagnosticCode, depDiagnosticCodes } from "./dep.ts";
export { type EnvDiagnosticCode, envDiagnosticCodes } from "./env.ts";
export { type HomeDiagnosticCode, homeDiagnosticCodes } from "./home.ts";
export { type HostDiagnosticCode, hostDiagnosticCodes } from "./host.ts";
export { type ManifestDiagnosticCode, manifestDiagnosticCodes } from "./manifest.ts";
export { type PlatformDiagnosticCode, platformDiagnosticCodes } from "./platform.ts";
export { type PublishDiagnosticCode, publishDiagnosticCodes } from "./publish.ts";
export { type TargetDiagnosticCode, targetDiagnosticCodes } from "./target.ts";

/** Every code in the catalog. Codes are semver surface and are never removed (AX-03). */
export type KnownDiagnosticCode =
  // gen:area-codes
  | DepDiagnosticCode
  | EnvDiagnosticCode
  | TargetDiagnosticCode
  | ArtifactDiagnosticCode
  | PublishDiagnosticCode
  | ActionDiagnosticCode
  | BuildDiagnosticCode
  | ManifestDiagnosticCode
  | HomeDiagnosticCode
  | PlatformDiagnosticCode
  | HostDiagnosticCode;

/** Every cataloged code with its severity, phase, title, default hint and docs text. */
export const diagnosticCatalog: Readonly<Record<KnownDiagnosticCode, DiagnosticSpec>> = {
  // gen:area-spreads
  ...depDiagnostics,
  ...envDiagnostics,
  ...targetDiagnostics,
  ...artifactDiagnostics,
  ...publishDiagnostics,
  ...actionDiagnostics,
  ...buildDiagnostics,
  ...manifestDiagnostics,
  ...homeDiagnostics,
  ...platformDiagnostics,
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
