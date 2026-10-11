/**
 * Diagnostic codes of the PLATFORM area: the operating systems and architectures Mostra runs on
 * (D35, RT-07).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the PLATFORM area, in the order they were added. */
export const platformDiagnosticCodes = [
  "MOSTRA_PLATFORM_UNSUPPORTED",
  // gen:codes
] as const;

/** The codes of the PLATFORM area. */
export type PlatformDiagnosticCode = (typeof platformDiagnosticCodes)[number];

/** The PLATFORM area's catalog entries. */
export const platformDiagnostics: AreaCatalog<PlatformDiagnosticCode> = {
  MOSTRA_PLATFORM_UNSUPPORTED: {
    severity: "error",
    phase: "platform",
    title: "Unsupported platform",
    hint: "Run Mostra on macOS or Linux, on an x64 or arm64 machine.",
    docs: {
      explanation:
        "Mostra 1.0 runs on macOS and Linux, on x64 and arm64. On any other operating system or architecture, Windows included, every entry point stops with this code before it creates or changes anything, because the process model, sockets and storage are built and tested only on those platforms. The message names the platform that was detected.",
      fix: "Run Mostra on a macOS or Linux machine with an x64 or arm64 processor. Windows support is planned for a release after 1.0.",
    },
  },
  // gen:entries
};
