/**
 * The CLI's platform gate (D35, D146, RT-07), the runtime's rule (`home/platform.ts` in
 * `@mostra/runtime`) repeated where the CLI must decide before it reaches any runtime: macOS and
 * Linux on x64 and arm64; Windows on x64 and arm64 only behind the development switch
 * `MOSTRA_DEV_WINDOWS=1`, which only Mostra's CI sets until WP-W3; everything else fails closed.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import type { Environment } from "./home.ts";

/** `MOSTRA_PLATFORM_UNSUPPORTED` for a platform Mostra doesn't run on, else `undefined`. */
export function checkPlatform(
  platform: string,
  arch: string,
  env: Environment,
): Diagnostic | undefined {
  if (arch === "x64" || arch === "arm64") {
    if (platform === "darwin" || platform === "linux") return undefined;
    if (platform === "win32" && env["MOSTRA_DEV_WINDOWS"] === "1") return undefined;
  }
  const name = platform === "win32" ? `Windows (${platform}-${arch})` : `${platform}-${arch}`;
  return createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
    message: `Mostra doesn't run on ${name}; it supports macOS and Linux on x64 and arm64.`,
  });
}
