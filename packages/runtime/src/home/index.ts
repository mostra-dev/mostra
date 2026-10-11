/**
 * The home (DATA_MODEL §1; D81, D82, D84, D85; RT-06, RT-07): the platform gate, where a home and
 * its socket live, and taking ownership of a home or finding its owner.
 */
export { acquireHome, type OwnedHome } from "./acquire.ts";
export {
  prepareOwnedDirectory,
  resolveHomePath,
  resolveRuntimeDir,
  socketPathFor,
  socketPathLimit,
} from "./paths.ts";
export { checkPlatform, platformName } from "./platform.ts";
export type { InstanceRecord } from "./record.ts";
