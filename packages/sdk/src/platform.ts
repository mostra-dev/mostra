/**
 * Which runtime bundle this machine takes (RT-01, D35): one per operating system and architecture
 * of v1, glibc only on Linux. Anything else fails closed before a download starts.
 */
import {
  BUNDLE_PLATFORMS,
  type BundlePlatform,
  createDiagnostic,
  RpcError,
} from "@mostra/protocol";

/** What the platform check reads: the running process by default. */
export interface PlatformFacts {
  /** `process.platform`. */
  readonly platform: string;
  /** `process.arch`. */
  readonly arch: string;
  /** The glibc release on Linux, `undefined` on musl or elsewhere. */
  readonly glibc?: string | undefined;
}

/** The facts of the running process. */
export function currentPlatform(): PlatformFacts {
  if (process.platform !== "linux") return { platform: process.platform, arch: process.arch };
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })
    ?.header;
  return { platform: process.platform, arch: process.arch, glibc: header?.glibcVersionRuntime };
}

/**
 * The bundle platform for these facts. Throws `MOSTRA_PLATFORM_UNSUPPORTED` for Windows, other
 * architectures and Linux without glibc, whose libraries the bundle's Node.js and browser need.
 */
export function bundlePlatform(facts: PlatformFacts = currentPlatform()): BundlePlatform {
  const name = `${facts.platform}-${facts.arch}`;
  const known = (BUNDLE_PLATFORMS as readonly string[]).includes(name);
  if (known && facts.platform === "linux" && facts.glibc === undefined) {
    throw unsupported(
      `Mostra's Linux bundle needs glibc, and this system has none (musl, as on Alpine Linux); it supports macOS and glibc-based Linux on x64 and arm64.`,
    );
  }
  if (!known) {
    const label = facts.platform === "win32" ? `Windows (${name})` : name;
    throw unsupported(
      `Mostra doesn't run on ${label}; it supports macOS and Linux on x64 and arm64.`,
    );
  }
  return name as BundlePlatform;
}

function unsupported(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", { message }));
}
