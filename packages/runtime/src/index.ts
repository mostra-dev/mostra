/**
 * `@mostra/runtime`: the supervisor that owns a Mostra home. It takes the home's ledger lock,
 * serves the host protocol over stdio (`mostra-runtime host`) or the home's socket
 * (`mostra-runtime daemon`), and runs every child process in its own process group, reaping
 * leftovers after a crash. The `mostra-runtime` binary is the runtime bundle's entry point (D85);
 * this entry is for the packages and tests that start an instance in-process.
 *
 * @packageDocumentation
 */

export type { InstanceRecord } from "./home/index.ts";
export {
  type Instance,
  type InstanceStop,
  runtimeVersion,
  type StartedInstance,
  type StartInstanceOptions,
  startInstance,
} from "./instance/index.ts";
export type { Environment } from "./log.ts";
export {
  type ChildExit,
  type ChildHandle,
  connectToSupervisor,
  type ProcessManager,
  type ReapedChild,
  type SpawnSpec,
  type SupervisorConnection,
  type SupervisorConnectionOptions,
} from "./processes/index.ts";
