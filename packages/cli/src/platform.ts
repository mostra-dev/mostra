/**
 * The CLI's platform gate (D35, D146, RT-07), the runtime's rule (`home/platform.ts` in
 * `@mostra/runtime`) repeated where the CLI must decide before it reaches any runtime: macOS,
 * Linux and Windows on x64 and arm64; everything else fails closed.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";

/** `MOSTRA_PLATFORM_UNSUPPORTED` for a platform Mostra doesn't run on, else `undefined`. */
export function checkPlatform(platform: string, arch: string): Diagnostic | undefined {
  const supported = platform === "darwin" || platform === "linux" || platform === "win32";
  if (supported && (arch === "x64" || arch === "arm64")) return undefined;
  const name = platform === "win32" ? `Windows (${platform}-${arch})` : `${platform}-${arch}`;
  return createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
    message: `Mostra doesn't run on ${name}; it supports macOS, Linux and Windows on x64 and arm64.`,
  });
}
