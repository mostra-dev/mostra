/**
 * Diagnostic codes of the REMOTE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the REMOTE area, in the order they were added. */
export const remoteDiagnosticCodes = [
  "MOSTRA_REMOTE_CONFIG_INVALID",
  // gen:codes
] as const;

/** The codes of the REMOTE area. */
export type RemoteDiagnosticCode = (typeof remoteDiagnosticCodes)[number];

/** The REMOTE area's catalog entries. */
export const remoteDiagnostics: AreaCatalog<RemoteDiagnosticCode> = {
  MOSTRA_REMOTE_CONFIG_INVALID: {
    severity: "error",
    phase: "host",
    title: "Remote server configuration can't be used",
    hint: "Fix the configuration key the message names, then start mostra-runtime server again.",
    docs: {
      explanation:
        "`mostra-runtime server` reads its configuration (the file `--config` names and `MOSTRA_SERVER_*` variables) before it serves anything, and stops when a key is missing, of the wrong type or out of range, naming the key. Nothing was served.",
      fix: "Correct the key the message names: `apiOrigin` must be an `https:` origin (or `http:` on loopback), and `domains.active` a host name.",
    },
  },
  // gen:entries
};
