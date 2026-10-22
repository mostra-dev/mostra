/**
 * The unsupported-platform gate (D35, D146, RT-07). Every entry point calls it before it touches
 * the home: Mostra runs on macOS and Linux, on x64 and arm64, and fails closed elsewhere. Windows
 * (x64 and arm64) is being built (WP-W1 to WP-W3) and runs only behind the development switch
 * `MOSTRA_DEV_WINDOWS=1`, which only Mostra's own CI sets, so no release exposes a partial port.
 * WP-W3 removes the switch.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { OS } from "../platform/index.ts";

const OPERATING_SYSTEMS: readonly string[] = ["darwin", "linux"];
const ARCHITECTURES: readonly string[] = ["x64", "arm64"];

/** The development switch that admits Windows until WP-W3 (D146). */
export const WINDOWS_DEV_SWITCH = "MOSTRA_DEV_WINDOWS";

/** The platform as `<os>-<arch>`, as `InstanceInfo.platform` reports it. */
export function platformName(platform: string = OS, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

/**
 * Returns `MOSTRA_PLATFORM_UNSUPPORTED` for a platform Mostra doesn't run on, or `undefined` for
 * a supported one. Windows is supported only while `env` sets the development switch to `1`.
 */
export function checkPlatform(
  platform: string = OS,
  arch: string = process.arch,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Diagnostic | undefined {
  if (ARCHITECTURES.includes(arch)) {
    if (OPERATING_SYSTEMS.includes(platform)) return undefined;
    if (platform === "win32" && env[WINDOWS_DEV_SWITCH] === "1") return undefined;
  }
  const name =
    platform === "win32"
      ? `Windows (${platformName(platform, arch)})`
      : platformName(platform, arch);
  return createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
    message: `Mostra doesn't run on ${name}; it supports macOS and Linux on x64 and arm64.`,
  });
}
