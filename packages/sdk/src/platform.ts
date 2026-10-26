/**
 * Which runtime bundle this machine takes (RT-01, RT-12, D35, D146): one per operating system and
 * architecture of v1 (macOS, glibc Linux and Windows, each on x64 and arm64). Anything else fails
 * closed before a download starts.
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

/** What {@link glibcRuntime} needs of `process.report`. */
interface Reporter {
  /** Node.js 22.13 and 23.3 or later; `@types/node` 24.19 doesn't declare it yet. */
  excludeNetwork?: boolean;
  getReport(): object;
}

/**
 * The glibc release Node.js reports, read from its diagnostic report's header. The report runs in
 * the caller's process (a host's server, say) and by default resolves the name of every open TCP
 * handle, synchronously; with `excludeNetwork` it does none of that (Opus review finding 4), as
 * detect-libc does. The setting is restored after.
 */
export function glibcRuntime(report: Reporter | undefined): string | undefined {
  if (report === undefined) return undefined;
  const before = report.excludeNetwork ?? false;
  report.excludeNetwork = true;
  try {
    return (report.getReport() as { header?: { glibcVersionRuntime?: string } }).header
      ?.glibcVersionRuntime;
  } finally {
    report.excludeNetwork = before;
  }
}

let facts: PlatformFacts | undefined;

/** The facts of the running process, read once. */
export function currentPlatform(): PlatformFacts {
  facts ??=
    process.platform === "linux"
      ? { platform: process.platform, arch: process.arch, glibc: glibcRuntime(process.report) }
      : { platform: process.platform, arch: process.arch };
  return facts;
}

/**
 * The bundle platform for these facts. Throws `MOSTRA_PLATFORM_UNSUPPORTED` for other systems and
 * architectures and for Linux without glibc, whose libraries the bundle's Node.js and browser need.
 */
export function bundlePlatform(facts: PlatformFacts = currentPlatform()): BundlePlatform {
  const name = `${facts.platform}-${facts.arch}`;
  const known = (BUNDLE_PLATFORMS as readonly string[]).includes(name);
  if (known && facts.platform === "linux" && facts.glibc === undefined) {
    throw unsupported(
      `Mostra's Linux bundle needs glibc, and this system has none (musl, as on Alpine Linux); it supports macOS, glibc-based Linux and Windows on x64 and arm64.`,
    );
  }
  if (!known) {
    const label = facts.platform === "win32" ? `Windows (${name})` : name;
    throw unsupported(
      `Mostra doesn't run on ${label}; it supports macOS, Linux and Windows on x64 and arm64.`,
    );
  }
  return name as BundlePlatform;
}

function unsupported(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", { message }));
}
