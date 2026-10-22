/**
 * The process manager (RT-09): every child in its own process group, recorded with PID and start
 * time, reaped after a supervisor crash, with typed JSON-RPC messages over Node IPC.
 */

export { isSameProcess, listProcesses, readProcess } from "../platform/index.ts";
export {
  connectToSupervisor,
  type SupervisorConnection,
  type SupervisorConnectionOptions,
} from "./child.ts";
export { artifactEnvironment } from "./environment.ts";
export {
  type ChildExit,
  type ChildHandle,
  openProcessManager,
  type ProcessManager,
  type ReapedChild,
  type SpawnSpec,
} from "./manager.ts";
