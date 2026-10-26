/**
 * `@mostra/sdk`: Mostra for JavaScript hosts (HO-04). `createMostra({ home, ports })` spawns the
 * host's own instance on a verified runtime bundle and returns a handle for the calls a host
 * makes: publish, verify, wait, results, state, live values, links and events, plus any other
 * host protocol method through `call`.
 *
 * The bundle functions (`resolveRuntime`, `setupBundle` and the rest) are what the CLI and
 * `create-mostra` use to install and check the runtime; a host rarely needs them directly.
 *
 * Embedded use never sends telemetry (D119): this package contains no code that could.
 *
 * @packageDocumentation
 */

export {
  bundleDir,
  cacheRoot,
  type InstallOptions,
  type InstallProgress,
  installPinned,
} from "./bundle/cache.ts";
export { type DownloadProgress, redactUrl } from "./bundle/download.ts";
export {
  type Bundle,
  browsersDir,
  checkBrowser,
  checkFiles,
  type Environment,
  offline,
  readBundle,
  readSetup,
  type SetupOptions,
  type SetupStep,
  setupBundle,
  setupExtras,
} from "./bundle/setup.ts";
export {
  checkTree,
  describeTree,
  hashFile,
  linkStaysInside,
  safeRelative,
  type TreeProblems,
} from "./bundle/tree.ts";
export { type ControlOptions, connectControl, windowsHelper } from "./control.ts";
export type { EventPage, EventStreamOptions } from "./events.ts";
export {
  type ArtifactInput,
  artifactRef,
  type CallOptions,
  createMostra,
  type HomeSettings,
  type InstanceExit,
  type Mostra,
  type MostraOptions,
  type Ports,
  SDK_CLIENT_NAME,
} from "./mostra.ts";
export { bundlePlatform, currentPlatform, type PlatformFacts } from "./platform.ts";
export {
  enclosingBundle,
  type Runtime,
  type RuntimeOptions,
  readPins,
  resolveRuntime,
  runtimeOf,
} from "./runtime.ts";
export { sdkVersion } from "./version.ts";
