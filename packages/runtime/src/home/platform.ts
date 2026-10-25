/**
 * The unsupported-platform gate (D35, D146, RT-07). Every entry point calls it before it touches
 * the home: Mostra runs on macOS, Linux and Windows, on x64 and arm64, and fails closed elsewhere.
 * Windows was built behind a development switch by WP-W1 to WP-W3, and is supported since WP-W3
 * like the others.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import { OS } from "../platform/index.ts";

const OPERATING_SYSTEMS: readonly string[] = ["darwin", "linux", "win32"];
const ARCHITECTURES: readonly string[] = ["x64", "arm64"];

/** The platform as `<os>-<arch>`, as `InstanceInfo.platform` reports it. */
export function platformName(platform: string = OS, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

/**
 * Returns `MOSTRA_PLATFORM_UNSUPPORTED` for a platform Mostra doesn't run on, or `undefined` for
 * a supported one.
 */
export function checkPlatform(
  platform: string = OS,
  arch: string = process.arch,
): Diagnostic | undefined {
  if (ARCHITECTURES.includes(arch) && OPERATING_SYSTEMS.includes(platform)) return undefined;
  const name =
    platform === "win32"
      ? `Windows (${platformName(platform, arch)})`
      : platformName(platform, arch);
  return createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
    message: `Mostra doesn't run on ${name}; it supports macOS, Linux and Windows on x64 and arm64.`,
  });
}
