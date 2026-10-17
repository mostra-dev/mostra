/**
 * Diagnostic codes of the SECRET area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the SECRET area, in the order they were added. */
export const secretDiagnosticCodes = [
  "MOSTRA_SECRET_MISSING",
  // gen:codes
] as const;

/** The codes of the SECRET area. */
export type SecretDiagnosticCode = (typeof secretDiagnosticCodes)[number];

/** The SECRET area's catalog entries. */
export const secretDiagnostics: AreaCatalog<SecretDiagnosticCode> = {
  MOSTRA_SECRET_MISSING: {
    severity: "error",
    phase: "runtime",
    title: "Secret not set",
    hint: "Set the secret with `mostra secret set NAME`, reading the value from stdin.",
    docs: {
      explanation:
        "Server code called `secret(name)` for a secret that neither the host's `secrets` port, the artifact's own secrets nor the home's shared secrets hold (D44). The call throws, and an action run fails with this code.",
      fix: "Set the secret for the artifact (`mostra secret set NAME --artifact <path|id>`) or for every artifact of the home (`mostra secret set NAME`), passing the value on stdin, then run the action again. Secret values never go into the artifact's source.",
    },
  },
  // gen:entries
};
