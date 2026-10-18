/**
 * `@mostra/cli`: the `mostra` command (D60, INTERFACES §9), a thin client of the host protocol
 * that agents and people run. Its binary is `mostra`; this entry exposes the runner and the
 * command definitions, for the generated reference and for tools that embed the CLI's surface.
 *
 * @packageDocumentation
 */

export type { InstanceConnection, InstanceSummary } from "./client.ts";
export type {
  ArgDef,
  CommandContext,
  CommandDef,
  CommandOutcome,
  FlagDef,
  FlagKind,
  TelemetryEventInput,
} from "./command.ts";
export { COMMANDS } from "./commands/index.ts";
export { EXIT, type ExitCode, exitCodeFor } from "./exit.ts";
export { commandDefinition, commandHelp, referenceMarkdown } from "./help.ts";
export type { Environment } from "./home.ts";
export { type RunnerIo, run } from "./run.ts";
