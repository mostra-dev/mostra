/**
 * What a command is (D140 items 13, 16): a definition the parser, the help, the reference page,
 * `--help --json`, telemetry's command names and the contract tests all read. Commands never
 * print or exit on their own; they return a result (or throw a diagnostic) and the runner decides
 * the envelope, the human text and the exit code.
 */
import type { Diagnostic, MethodDefinition } from "@mostra/protocol";
import type { InstanceConnection } from "./client.ts";

/** A flag's value kind. Every flag is `--long`; booleans take no value. */
export type FlagKind = "boolean" | "string" | "number" | "duration" | "list";

/** One flag of a command. */
export interface FlagDef {
  /** The flag's name, without the dashes. */
  readonly name: string;
  /** What it takes. */
  readonly kind: FlagKind;
  /** One line for help: what it does. */
  readonly summary: string;
  /** The placeholder in usage and help: `<path>`, `<d>` … */
  readonly value?: string;
  /** The allowed values, for a closed set. */
  readonly choices?: readonly string[];
  /** The default, as help shows it. */
  readonly default?: string;
}

/** One positional argument. */
export interface ArgDef {
  /** The argument's name, as help shows it. */
  readonly name: string;
  /** One line for help: what it is. */
  readonly summary: string;
  /** Whether it may be left out. */
  readonly optional?: boolean;
  /** Whether it takes every remaining word (`<package…>`). */
  readonly variadic?: boolean;
}

/** What the runner gives a command. */
export interface CommandContext {
  /** The positional arguments, after the command path, by name. */
  readonly args: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The command's flags, parsed by kind (durations in milliseconds, lists as arrays). */
  readonly flags: Readonly<
    Record<string, string | number | boolean | readonly string[] | undefined>
  >;
  /** The working directory relative paths resolve from (`--cwd`, else the process's). */
  readonly cwd: string;
  /** Whether `--json` was given. */
  readonly json: boolean;
  /** The request timeout from `--timeout`, in milliseconds. */
  readonly timeoutMs: number | undefined;
  /** Calls a host protocol method on the home's instance, starting its daemon when needed. */
  call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R>;
  /** Reads the whole of stdin, for commands that take a value there. */
  readStdin(): Promise<string>;
  /** Writes one line of progress or a log line to stderr (never stdout). */
  log(line: string): void;
  /** Emits one event of a streaming command (an NDJSON line in `--json` mode). */
  emit(event: unknown, human?: string): void;
  /** Adds a warning to the envelope (and stderr). */
  warn(diagnostic: Diagnostic): void;
  /** The environment the CLI runs in. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether stdout and stdin are terminals. */
  readonly tty: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean };
  /** The resolved home and the CLI's own facts, for commands that report them. */
  readonly home: string;
  /** Records a telemetry event of this command (D140 item 8), when telemetry allows it. */
  record(event: TelemetryEventInput): void;
  /**
   * The session with the home's instance, starting its daemon unless `autostart` is false; then
   * `undefined` when none runs. `call` uses the same session.
   */
  connection(autostart?: boolean): Promise<InstanceConnection | undefined>;
  /** Runs the runtime binary (`mostra-runtime …`) and returns its exit code and stdout. */
  runtime(
    args: readonly string[],
    stdio?: "pipe" | "inherit",
  ): Promise<{ code: number; stdout: string }>;
  /** The CLI's config directory (D140 item 5). */
  readonly configDir: string;
  /** Writes to stderr. */
  readonly stderr: (text: string) => void;
  /** Writes to stdout as the command runs (`host`, `dev`'s stream without `--json`). */
  readonly stdout: (text: string) => void;
}

/** A command-specific telemetry event: its name and its own fields. */
export interface TelemetryEventInput {
  /** The event's name. */
  readonly event: "verify.result" | "publish.done" | "share.done";
  /** Its own fields; the schema keeps only the published ones. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** What a command's run returns. */
export interface CommandOutcome {
  /** The `result` of the envelope. */
  readonly result: unknown;
  /** The text for people (stdout); default: the result as indented JSON. */
  readonly human?: string;
  /** The exit code when it isn't 0: a failing verdict (1), `still_waiting` (5), conflicts (6). */
  readonly exit?: number;
  /** The command wrote its own stdout (`host`): the runner prints no envelope and no text. */
  readonly raw?: boolean;
}

/** One command. */
export interface CommandDef {
  /** Its words after `mostra`: `["daemon", "install"]`. */
  readonly path: readonly string[];
  /** One line: what it does. */
  readonly summary: string;
  /** Its positional arguments, in order. */
  readonly args?: readonly ArgDef[];
  /** Its own flags, besides the global ones. */
  readonly flags?: readonly FlagDef[];
  /** The result type `--json` puts in `result`, and its `mostra docs` topic. */
  readonly output: { readonly type: string; readonly topic: string };
  /** The exit codes it can end with, besides 2 and 3, which every command can. */
  readonly exits: readonly number[];
  /** One example invocation, without `mostra`. */
  readonly example: string;
  /** It reads stdin, so telemetry's question is never asked before it (D140 item 11). */
  readonly readsStdin?: boolean | ((flags: CommandContext["flags"]) => boolean);
  /** It never reaches an instance (`docs`, `telemetry`): no `instance` in its envelope. */
  readonly local?: boolean;
  /** It writes a stream of events before its result (NDJSON in `--json` mode). */
  readonly streams?: boolean;
  /** Telemetry and its question leave it alone (`telemetry`, `docs`, D140 item 11). */
  readonly quiet?: boolean;
  /** Does the command's work. */
  run(context: CommandContext): Promise<CommandOutcome>;
}

/** Defines a command; the identity function, for types. */
export function defineCommand(command: CommandDef): CommandDef {
  return command;
}

/** The command path as one string: `daemon install`. */
export function commandName(command: Pick<CommandDef, "path">): string {
  return command.path.join(" ");
}
