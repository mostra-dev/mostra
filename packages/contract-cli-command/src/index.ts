/**
 * `@mostra/contract-cli-command`: the contract a CLI command implements (D30, D60, ROUND-3 §6.1).
 * A plugin adds a command to `mostra` (`mostra term record`), defined like Mostra's own: its words,
 * arguments and flags, which `--help` and `--help --json` show, and a handler that returns a
 * result the CLI prints, as JSON with `--json`. The handler reaches Mostra only through the host
 * protocol (`context.call`), as every command does.
 *
 * ```ts
 * import { defineCliCommand } from "@mostra/contract-cli-command";
 *
 * export default defineCliCommand({
 *   path: ["term", "record"],
 *   summary: "Record a terminal session as asciicast v3.",
 *   args: [{ name: "command", summary: "The program to record.", variadic: true }],
 *   flags: [{ name: "out", kind: "string", value: "<file>", summary: "Where to write it." }],
 *   async run({ args, flags }, { call }) {
 *     const status = await call("instance/status", {});
 *     return { result: { recorded: args.command, out: flags.out, instance: status } };
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */
import { type BaseContext, type ContractStamp, type Json, stampCompatible } from "./common.ts";
import { VERSION } from "./version.ts";

export {
  type BaseContext,
  type Cancellation,
  type ContractStamp,
  type Json,
  type JsonSchema,
  stampCompatible,
} from "./common.ts";
export { VERSION } from "./version.ts";

/** This contract's stamp: what {@link defineCliCommand} puts on every command. */
export const CONTRACT: ContractStamp<"cli-command"> = { name: "cli-command", version: VERSION };

/** The pattern of a command word: lower case, digits and `-`, starting with a letter. */
export const COMMAND_WORD: RegExp = /^[a-z][a-z0-9-]{0,31}$/;

/** One positional argument. */
export interface CommandArg {
  /** Its name, as help shows it. */
  readonly name: string;
  /** One line for help. */
  readonly summary: string;
  /** It may be left out. */
  readonly optional?: boolean;
  /** It takes every remaining word. */
  readonly variadic?: boolean;
}

/** One flag (always `--long`). */
export interface CommandFlag {
  /** The flag's name, without the dashes. */
  readonly name: string;
  /** What it takes; booleans take no value, lists repeat or take commas. */
  readonly kind: "boolean" | "string" | "number" | "list";
  /** One line for help. */
  readonly summary: string;
  /** The placeholder in help: `<file>`. */
  readonly value?: string;
  /** The allowed values, for a closed set. */
  readonly choices?: readonly string[];
  /** The default, as help shows it. */
  readonly default?: string;
}

/** What a command's `run` receives. */
export interface CommandInput {
  /** Its arguments by name: a string, or every word of a variadic one. */
  readonly args: { readonly [name: string]: string | readonly string[] | undefined };
  /** Its flags by name, parsed by kind. */
  readonly flags: {
    readonly [name: string]: string | number | boolean | readonly string[] | undefined;
  };
  /** The directory relative paths resolve from (`--cwd`). */
  readonly cwd: string;
  /** Whether `--json` was given: write nothing to stdout, return the result. */
  readonly json: boolean;
}

/** What a command's calls receive besides their input. */
export interface CommandContext extends BaseContext {
  /** Calls a host protocol method on the home's instance (INTERFACES §6), starting its daemon. */
  call(method: string, params: { readonly [key: string]: Json }): Promise<Json>;
  /** Writes one line of progress to stderr. */
  progress(line: string): void;
}

/** What a command's `run` returns. */
export interface CommandResult {
  /** The `result` of the `--json` envelope. */
  readonly result: Json;
  /** The text for people; by default the result as indented JSON. */
  readonly human?: string;
  /** The exit code when it isn't 0. */
  readonly exit?: number;
}

/** What a plugin writes to define a CLI command. */
export interface CliCommandDefinition {
  /** Its words after `mostra`: `["term", "record"]`. Never one of Mostra's own commands. */
  readonly path: readonly string[];
  /** One line: what it does. */
  readonly summary: string;
  /** Its positional arguments, in order. */
  readonly args?: readonly CommandArg[];
  /** Its flags, besides `mostra`'s global ones. */
  readonly flags?: readonly CommandFlag[];
  /** One example invocation, without `mostra`. */
  readonly example?: string;
  /** Does the command's work. */
  run(input: CommandInput, context: CommandContext): Promise<CommandResult>;
}

/** A CLI command, as {@link defineCliCommand} returns it: the definition with its stamp. */
export interface CliCommand extends CliCommandDefinition {
  /** The contract's stamp, its name and version, which the define function sets. */
  readonly contract: ContractStamp<"cli-command">;
}

/** A command's ID, as manifests name it: its words joined by spaces. */
export function commandId(path: readonly string[]): string {
  return path.join(" ");
}

/**
 * Defines a CLI command: checks its words and stamps it with this contract's name and version.
 *
 * @throws TypeError when the words, the summary or `run` aren't valid.
 */
export function defineCliCommand<const T extends CliCommandDefinition>(
  definition: T,
): T & { readonly contract: ContractStamp<"cli-command"> } {
  if (
    !Array.isArray(definition.path) ||
    definition.path.length === 0 ||
    definition.path.length > 4 ||
    !definition.path.every((word) => typeof word === "string" && COMMAND_WORD.test(word))
  ) {
    throw new TypeError(
      "defineCliCommand needs path: one to four words of lower-case letters, digits and -.",
    );
  }
  if (typeof definition.summary !== "string" || definition.summary === "") {
    throw new TypeError("defineCliCommand needs a summary.");
  }
  if (typeof definition.run !== "function") {
    throw new TypeError("defineCliCommand needs a run function.");
  }
  return { ...definition, contract: CONTRACT };
}

/** Whether `value` is a CLI command stamped with a version of this contract this copy serves. */
export function isCliCommand(value: unknown): value is CliCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    stampCompatible((value as { contract?: unknown }).contract, CONTRACT.name, CONTRACT.version) &&
    typeof (value as { run?: unknown }).run === "function"
  );
}
