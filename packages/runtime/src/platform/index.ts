/**
 * The platform layer (WP-W1, RT-10): the one module that knows which operating system the runtime
 * runs on. Every difference between POSIX and Windows lives here: where homes live, owner-only
 * directories, the control endpoint, process identity, starting, ending and reaping children,
 * and the file operations whose semantics differ. Other modules ask it; none of them reads
 * `process.platform` (a test keeps it so). Windows work goes through `mostra-win`, the helper in
 * `crates/mostra-win`.
 */
export {
  type ControlListener,
  controlEndpoint,
  type LaunchPipe,
  listenControl,
} from "./control.ts";
export {
  defaultHome,
  OS,
  ownedDirectory,
  type PreparedDirectory,
  pathsOf,
  type RuntimeDirChoice,
  runtimeDirFor,
  socketPathLimit,
  WINDOWS,
} from "./directories.ts";
export { baseEnvironment } from "./environment.ts";
export {
  fsyncPath,
  linkDirectory,
  nameKey,
  removeTree,
  renamePath,
  renamePathSync,
  replaceDirectoryLink,
  samePath,
  sealPlaced,
  sealTree,
} from "./files.ts";
export { helperPath, runtimeRoot } from "./helper.ts";
export { isSameProcess, listProcesses, readProcess } from "./identity.ts";
export { adoptable, launch, reapRecorded } from "./launch.ts";
