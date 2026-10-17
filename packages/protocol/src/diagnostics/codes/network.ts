/**
 * Diagnostic codes of the NETWORK area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the NETWORK area, in the order they were added. */
export const networkDiagnosticCodes = [
  "MOSTRA_NETWORK_REQUEST_FAILED",
  "MOSTRA_NETWORK_EXTERNAL_FAILED",
  // gen:codes
] as const;

/** The codes of the NETWORK area. */
export type NetworkDiagnosticCode = (typeof networkDiagnosticCodes)[number];

/** The NETWORK area's catalog entries. */
export const networkDiagnostics: AreaCatalog<NetworkDiagnosticCode> = {
  MOSTRA_NETWORK_REQUEST_FAILED: {
    severity: "error",
    phase: "network",
    title: "Request for the page's own resource failed",
    hint: "Check the path: a file the page loads from the artifact itself failed to load.",
    docs: {
      explanation:
        "A resource the page loaded from the artifact's own origin (the document, a script, a style, an image, a font, or a fetch by artifact code) failed or answered 4xx or 5xx. Requests the browser makes on its own, such as `/favicon.ico`, and Mostra's own protocol aren't counted.",
      fix: "Put the file in `public/` (served at the root) or import it from the code so the build includes it, and check the path's spelling.",
    },
  },
  MOSTRA_NETWORK_EXTERNAL_FAILED: {
    severity: "warning",
    phase: "network",
    title: "Request to another origin failed",
    hint: "A request to another origin failed while verify ran; check the URL and whether that service was reachable.",
    docs: {
      explanation:
        "A request the page made to another origin failed or answered 4xx or 5xx. It may be the environment (no network, a service that is down, a request the service refuses from this origin) rather than the code, so it is a warning.",
      fix: "Check the URL and the service. If the page depends on it, show a fallback when it fails.",
    },
  },
  // gen:entries
};
