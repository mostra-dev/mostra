/**
 * The diagnostic catalog, assembled from one source file per area. `pnpm gen diagnostic` keeps
 * the lists below in step with the area files; edit the area files, not these lists.
 */
import type { Diagnostic } from "../diagnostic.ts";
import { buildDiagnostic, type DiagnosticDetails, type DiagnosticSpec } from "../spec.ts";
import { type A11yDiagnosticCode, a11yDiagnostics } from "./a11y.ts";
import { type ActionDiagnosticCode, actionDiagnostics } from "./action.ts";
import { type ArtifactDiagnosticCode, artifactDiagnostics } from "./artifact.ts";
import { type BuildDiagnosticCode, buildDiagnostics } from "./build.ts";
// gen:area-imports
import { type CliDiagnosticCode, cliDiagnostics } from "./cli.ts";
import { type ConsoleDiagnosticCode, consoleDiagnostics } from "./console.ts";
import { type DepDiagnosticCode, depDiagnostics } from "./dep.ts";
import { type EnvDiagnosticCode, envDiagnostics } from "./env.ts";
import { type FieldDiagnosticCode, fieldDiagnostics } from "./field.ts";
import { type HomeDiagnosticCode, homeDiagnostics } from "./home.ts";
import { type HostDiagnosticCode, hostDiagnostics } from "./host.ts";
import { type HygieneDiagnosticCode, hygieneDiagnostics } from "./hygiene.ts";
import { type LiveDiagnosticCode, liveDiagnostics } from "./live.ts";
import { type ManifestDiagnosticCode, manifestDiagnostics } from "./manifest.ts";
import { type NetworkDiagnosticCode, networkDiagnostics } from "./network.ts";
import { type PlatformDiagnosticCode, platformDiagnostics } from "./platform.ts";
import { type PublishDiagnosticCode, publishDiagnostics } from "./publish.ts";
import { type RegressionDiagnosticCode, regressionDiagnostics } from "./regression.ts";
import { type RuntimeDiagnosticCode, runtimeDiagnostics } from "./runtime.ts";
import { type SecretDiagnosticCode, secretDiagnostics } from "./secret.ts";
import { type SmokeDiagnosticCode, smokeDiagnostics } from "./smoke.ts";
import { type SubmitDiagnosticCode, submitDiagnostics } from "./submit.ts";
import { type TargetDiagnosticCode, targetDiagnostics } from "./target.ts";
import { type TypeDiagnosticCode, typeDiagnostics } from "./type.ts";
import { type VerifyDiagnosticCode, verifyDiagnostics } from "./verify.ts";

export { type A11yDiagnosticCode, a11yDiagnosticCodes } from "./a11y.ts";
export { type ActionDiagnosticCode, actionDiagnosticCodes } from "./action.ts";
export { type ArtifactDiagnosticCode, artifactDiagnosticCodes } from "./artifact.ts";
export { type BuildDiagnosticCode, buildDiagnosticCodes } from "./build.ts";
// gen:area-exports
export { type CliDiagnosticCode, cliDiagnosticCodes } from "./cli.ts";
export { type ConsoleDiagnosticCode, consoleDiagnosticCodes } from "./console.ts";
export { type DepDiagnosticCode, depDiagnosticCodes } from "./dep.ts";
export { type EnvDiagnosticCode, envDiagnosticCodes } from "./env.ts";
export { type FieldDiagnosticCode, fieldDiagnosticCodes } from "./field.ts";
export { type HomeDiagnosticCode, homeDiagnosticCodes } from "./home.ts";
export { type HostDiagnosticCode, hostDiagnosticCodes } from "./host.ts";
export { type HygieneDiagnosticCode, hygieneDiagnosticCodes } from "./hygiene.ts";
export { type LiveDiagnosticCode, liveDiagnosticCodes } from "./live.ts";
export { type ManifestDiagnosticCode, manifestDiagnosticCodes } from "./manifest.ts";
export { type NetworkDiagnosticCode, networkDiagnosticCodes } from "./network.ts";
export { type PlatformDiagnosticCode, platformDiagnosticCodes } from "./platform.ts";
export { type PublishDiagnosticCode, publishDiagnosticCodes } from "./publish.ts";
export { type RegressionDiagnosticCode, regressionDiagnosticCodes } from "./regression.ts";
export { type RuntimeDiagnosticCode, runtimeDiagnosticCodes } from "./runtime.ts";
export { type SecretDiagnosticCode, secretDiagnosticCodes } from "./secret.ts";
export { type SmokeDiagnosticCode, smokeDiagnosticCodes } from "./smoke.ts";
export { type SubmitDiagnosticCode, submitDiagnosticCodes } from "./submit.ts";
export { type TargetDiagnosticCode, targetDiagnosticCodes } from "./target.ts";
export { type TypeDiagnosticCode, typeDiagnosticCodes } from "./type.ts";
export { type VerifyDiagnosticCode, verifyDiagnosticCodes } from "./verify.ts";

/** Every code in the catalog. Codes are semver surface and are never removed (AX-03). */
export type KnownDiagnosticCode =
  // gen:area-codes
  | CliDiagnosticCode
  | RegressionDiagnosticCode
  | SmokeDiagnosticCode
  | A11yDiagnosticCode
  | NetworkDiagnosticCode
  | ConsoleDiagnosticCode
  | TypeDiagnosticCode
  | VerifyDiagnosticCode
  | LiveDiagnosticCode
  | SecretDiagnosticCode
  | RuntimeDiagnosticCode
  | FieldDiagnosticCode
  | SubmitDiagnosticCode
  | HygieneDiagnosticCode
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
  ...cliDiagnostics,
  ...regressionDiagnostics,
  ...smokeDiagnostics,
  ...a11yDiagnostics,
  ...networkDiagnostics,
  ...consoleDiagnostics,
  ...typeDiagnostics,
  ...verifyDiagnostics,
  ...liveDiagnostics,
  ...secretDiagnostics,
  ...runtimeDiagnostics,
  ...fieldDiagnostics,
  ...submitDiagnostics,
  ...hygieneDiagnostics,
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
