/**
 * The command line, read against the command definitions (D140 item 13): the global flags, the
 * command path, its arguments and flags. Every failure is `MOSTRA_CLI_USAGE` or
 * `MOSTRA_CLI_UNKNOWN_COMMAND`, so `--json` mode reports it like any other error.
 */
import { parseArgs } from "node:util";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { type CommandDef, commandName, type FlagDef } from "./command.ts";

/** The flags every command takes (INTERFACES §9). */
export const GLOBAL_FLAGS: readonly FlagDef[] = [
  {
    name: "json",
    kind: "boolean",
    summary: "Print one JSON envelope on stdout (NDJSON for streams).",
  },
  {
    name: "home",
    kind: "string",
    value: "<dir>",
    summary: "Use this Mostra home instead of MOSTRA_HOME or the default.",
  },
  {
    name: "cwd",
    kind: "string",
    value: "<dir>",
    summary: "Resolve relative paths from this directory.",
  },
  {
    name: "timeout",
    kind: "duration",
    value: "<d>",
    summary: "Give up on the instance after this long (exit 4), such as 30s or 5m.",
  },
  {
    name: "help",
    kind: "boolean",
    summary: "Show this command's help; with --json, its definition.",
  },
];

/** What the command line asks for. */
export type Parsed =
  | { readonly kind: "version" }
  | { readonly kind: "help"; readonly command?: CommandDef; readonly group?: string }
  | {
      readonly kind: "run";
      readonly command: CommandDef;
      readonly args: Record<string, string | readonly string[] | undefined>;
      readonly flags: Record<string, string | number | boolean | readonly string[] | undefined>;
    };

/** The global flags' values, read before anything else so a usage error still honors them. */
export interface GlobalFlags {
  readonly json: boolean;
  readonly home?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/** A usage error. */
export function usage(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_CLI_USAGE", { message }));
}

const DURATION = /^([1-9][0-9]*)(ms|s|m|h|d)$/;
const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** A duration flag's milliseconds: `30s`, `5m`, `2h`, `7d`, `500ms`. */
export function durationMs(value: string): number {
  const match = DURATION.exec(value);
  if (!match)
    throw usage(`"${value}" isn't a duration; use a number with ms, s, m, h or d, such as 30s.`);
  return Number(match[1]) * (UNIT_MS[match[2] as string] as number);
}

/**
 * Reads the global flags wherever they stand, before the command is known: `--json` anywhere
 * before `--` makes even a usage error a JSON envelope (D140 item 16).
 */
export function globalFlags(argv: readonly string[]): GlobalFlags {
  const end = argv.indexOf("--");
  const words = end === -1 ? argv : argv.slice(0, end);
  const value = (name: string): string | undefined => {
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index] as string;
      if (word === `--${name}`) return words[index + 1];
      if (word.startsWith(`--${name}=`)) return word.slice(name.length + 3);
    }
    return undefined;
  };
  const timeout = value("timeout");
  let timeoutMs: number | undefined;
  try {
    timeoutMs = timeout === undefined ? undefined : durationMs(timeout);
  } catch {
    timeoutMs = undefined;
  }
  const home = value("home");
  const cwd = value("cwd");
  return {
    json: words.includes("--json"),
    ...(home !== undefined ? { home } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

/** The command that names `words`' longest prefix. */
function findCommand(
  commands: readonly CommandDef[],
  words: readonly string[],
): { command: CommandDef; used: number } | undefined {
  let best: { command: CommandDef; used: number } | undefined;
  for (const command of commands) {
    const { path } = command;
    if (path.length <= words.length && path.every((word, index) => words[index] === word)) {
      if (!best || path.length > best.used) best = { command, used: path.length };
    }
  }
  return best;
}

/** The first words of every command: the groups and the single-word commands. */
export function topWords(commands: readonly CommandDef[]): string[] {
  return [...new Set(commands.map((command) => command.path[0] as string))].sort();
}

/** Parses the command line against the definitions. Throws a usage diagnostic. */
export function parseCommandLine(commands: readonly CommandDef[], argv: readonly string[]): Parsed {
  const bare = argv.filter((word) => word !== "--json");
  if (bare.length === 1 && (bare[0] === "--version" || bare[0] === "-v"))
    return { kind: "version" };
  // The command path is the leading words that aren't flags; global flags may stand before it.
  const words: string[] = [];
  const pathAt: number[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] as string;
    if (word === "--json" || word === "--help" || word === "-h") continue;
    if (word === "--home" || word === "--cwd" || word === "--timeout") {
      index += 1;
      continue;
    }
    if (/^--(home|cwd|timeout)=/.test(word)) continue;
    if (word.startsWith("-")) break;
    words.push(word);
    pathAt.push(index);
  }
  const helpAsked = argv.includes("--help") || argv.includes("-h");
  if (words.length === 0) {
    if (helpAsked || argv.every((word) => word === "--json")) return { kind: "help" };
    throw usage(`Name a command first; ${argv[0]} isn't one.`);
  }
  const found = findCommand(commands, words);
  if (!found) {
    const group = commands.filter((command) => command.path[0] === words[0]);
    if (group.length > 0) {
      if (helpAsked) return { kind: "help", group: words[0] as string };
      throw usage(
        `"mostra ${words[0]}" needs one of: ${group.map((command) => command.path.slice(1).join(" ")).join(", ")}.`,
      );
    }
    throw new RpcError(
      createDiagnostic("MOSTRA_CLI_UNKNOWN_COMMAND", {
        message: `"${words[0]}" isn't a mostra command. The commands are: ${topWords(commands).join(", ")}.`,
      }),
    );
  }
  const { command } = found;
  if (helpAsked) return { kind: "help", command };
  const used = new Set(pathAt.slice(0, found.used));
  const rest = argv.filter((_, index) => !used.has(index));
  const flagDefs = [...GLOBAL_FLAGS, ...(command.flags ?? [])];
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        flagDefs.map((flag) => [
          flag.name,
          { type: flag.kind === "boolean" ? "boolean" : "string" },
        ]),
      ) as Parameters<typeof parseArgs>[0] extends { options?: infer O } ? NonNullable<O> : never,
    });
  } catch (error) {
    throw usage(
      `${(error as Error).message.split(". To specify")[0]}. Run "mostra ${commandName(command)} --help".`,
    );
  }
  const flags: Record<string, string | number | boolean | readonly string[] | undefined> = {};
  for (const flag of command.flags ?? []) {
    const raw = parsed.values[flag.name];
    if (raw === undefined) continue;
    if (flag.kind === "boolean") {
      flags[flag.name] = raw === true;
      continue;
    }
    const text = String(raw);
    if (flag.choices && !flag.choices.includes(text)) {
      throw usage(`--${flag.name} takes one of ${flag.choices.join(", ")}; "${text}" isn't one.`);
    }
    if (flag.kind === "number") {
      const number = Number(text);
      if (!Number.isInteger(number) || number < 0)
        throw usage(`--${flag.name} takes a whole number; "${text}" isn't one.`);
      flags[flag.name] = number;
    } else if (flag.kind === "duration") {
      durationMs(text);
      flags[flag.name] = text;
    } else if (flag.kind === "list") {
      flags[flag.name] = text
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    } else flags[flag.name] = text;
  }
  const positionals = [...parsed.positionals];
  const args: Record<string, string | readonly string[] | undefined> = {};
  for (const arg of command.args ?? []) {
    if (arg.variadic) {
      if (positionals.length === 0 && !arg.optional)
        throw usage(`"mostra ${commandName(command)}" needs <${arg.name}…>.`);
      args[arg.name] = positionals.splice(0);
      continue;
    }
    const value = positionals.shift();
    if (value === undefined && !arg.optional)
      throw usage(`"mostra ${commandName(command)}" needs <${arg.name}>.`);
    args[arg.name] = value;
  }
  if (positionals.length > 0) {
    throw usage(
      `"mostra ${commandName(command)}" takes no argument "${positionals[0]}". Run "mostra ${commandName(command)} --help".`,
    );
  }
  if (typeof parsed.values["timeout"] === "string") durationMs(parsed.values["timeout"]);
  return { kind: "run", command, args, flags };
}
