/**
 * The unsupported-platform gate (D35, RT-07). Every entry point calls it before it touches the
 * home: Mostra 1.0 runs on macOS and Linux, on x64 and arm64, and fails closed elsewhere.
 */
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";

const OPERATING_SYSTEMS: readonly string[] = ["darwin", "linux"];
const ARCHITECTURES: readonly string[] = ["x64", "arm64"];

/** The platform as `<os>-<arch>`, as `InstanceInfo.platform` reports it. */
export function platformName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

/**
 * Returns `MOSTRA_PLATFORM_UNSUPPORTED` for a platform Mostra doesn't run on, or `undefined` for
 * a supported one.
 */
export function checkPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): Diagnostic | undefined {
  if (OPERATING_SYSTEMS.includes(platform) && ARCHITECTURES.includes(arch)) return undefined;
  const name =
    platform === "win32"
      ? `Windows (${platformName(platform, arch)})`
      : platformName(platform, arch);
  return createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
    message: `Mostra doesn't run on ${name}; it supports macOS and Linux on x64 and arm64.`,
  });
}
