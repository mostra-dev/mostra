/**
 * Diagnostic codes of the PLATFORM area: the operating systems and architectures Mostra runs on
 * (D35, D146, RT-07).
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
    hint: "Run Mostra on macOS, glibc-based Linux or Windows, on an x64 or arm64 machine.",
    docs: {
      explanation:
        "Mostra runs on macOS, Linux with glibc and Windows, each on x64 and arm64. On any other operating system or architecture (32-bit Windows, musl-based Linux such as Alpine, BSDs) every entry point stops with this code before it creates or changes anything, because the process model, the control endpoint, storage and the runtime bundle are built and tested only on those platforms. The message names the platform that was detected.",
      fix: "Run Mostra on macOS, a glibc-based Linux or Windows, with an x64 or arm64 processor. On Alpine Linux, use a glibc-based image instead.",
    },
  },
  // gen:entries
};
