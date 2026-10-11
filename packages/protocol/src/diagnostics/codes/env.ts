/**
 * Diagnostic codes of the ENV area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the ENV area, in the order they were added. */
export const envDiagnosticCodes = [
  "MOSTRA_ENV_WARM_MISSING",
  // gen:codes
] as const;

/** The codes of the ENV area. */
export type EnvDiagnosticCode = (typeof envDiagnosticCodes)[number];

/** The ENV area's catalog entries. */
export const envDiagnostics: AreaCatalog<EnvDiagnosticCode> = {
  MOSTRA_ENV_WARM_MISSING: {
    severity: "error",
    phase: "host",
    title: "Warm package set missing",
    hint: "Reinstall the Mostra runtime, or set `MOSTRA_WARM_DIR` to its warm package set.",
    docs: {
      explanation:
        "Builds resolve React, Tailwind and Mostra's own client packages from the warm package set that ships with the runtime. The runtime couldn't find it, which means the runtime installation is incomplete.",
      fix: "Reinstall Mostra so the runtime bundle is complete. A custom layout can point the runtime at the warm set's directory with `MOSTRA_WARM_DIR`.",
    },
  },
  // gen:entries
};
