/**
 * Diagnostic codes of the HOST area: the host protocol between clients and an instance.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the HOST area, in the order they were added. */
export const hostDiagnosticCodes = [
  "MOSTRA_HOST_REVISION_UNSUPPORTED",
  // gen:codes
] as const;

/** The codes of the HOST area. */
export type HostDiagnosticCode = (typeof hostDiagnosticCodes)[number];

/** The HOST area's catalog entries. */
export const hostDiagnostics: AreaCatalog<HostDiagnosticCode> = {
  MOSTRA_HOST_REVISION_UNSUPPORTED: {
    severity: "error",
    phase: "host",
    title: "No common host protocol revision",
    hint: "Run the client and the instance from the same Mostra release, for example with `mostra daemon restart`.",
    docs: {
      explanation:
        "A client and a Mostra instance agree on a host protocol revision when they connect (`mostra/initialize`). The client offers the revisions it speaks, and the instance picks the newest one it also supports. This code means the two lists have nothing in common, usually because the client and the running daemon come from Mostra releases far apart.",
      fix: "Restart the daemon so it runs the same release as the client: `mostra daemon restart`. Durable state survives the restart, and open views reconnect. A host that embeds Mostra updates its pinned Mostra runtime or its host library until both support a common revision.",
    },
  },
  // gen:entries
};
