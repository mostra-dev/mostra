/**
 * Help, generated from the command definitions (D140 items 8 and 16): `--help` for people,
 * `--help --json` for agents (the definition itself), and `docs/reference/cli.md`, which CI
 * checks is current. The wording lives in the definitions; this module only lays it out.
 */
import { type CommandDef, commandName, type FlagDef } from "./command.ts";
import { EXIT } from "./exit.ts";
import { GLOBAL_FLAGS, topWords } from "./parse.ts";

const EXIT_MEANING: Readonly<Record<number, string>> = {
  [EXIT.ok]: "success",
  [EXIT.failure]:
    "artifact failure (verify failed, publish refused, the artifact's state refused the request)",
  [EXIT.usage]: "usage error",
  [EXIT.environment]:
    "environment error (no runtime, browser or socket; the home; an unsupported platform)",
  [EXIT.timeout]: "timeout (--timeout passed)",
  [EXIT.stillWaiting]: "still waiting (the wait timed out; the result says where to resume)",
  [EXIT.conflict]: "conflict (already submitted, a compare-and-set mismatch, a reused request ID)",
};

/** The usage line: `mostra open <artifact> [flags]`. */
export function usageLine(command: CommandDef): string {
  const args = (command.args ?? []).map((arg) => {
    const name = arg.variadic ? `<${arg.name}…>` : `<${arg.name}>`;
    return arg.optional ? `[${name}]` : name;
  });
  return [
    "mostra",
    ...command.path,
    ...args,
    ...((command.flags ?? []).length > 0 ? ["[flags]"] : []),
  ].join(" ");
}

function flagLine(flag: FlagDef): string {
  const name = `--${flag.name}${flag.kind === "boolean" ? "" : ` ${flag.value ?? `<${flag.kind}>`}`}`;
  const choices = flag.choices ? ` (${flag.choices.join(", ")})` : "";
  const fallback = flag.default !== undefined ? ` Default: ${flag.default}.` : "";
  return `  ${name.padEnd(28)} ${flag.summary}${choices}${fallback}`;
}

/** Commands that run until their connection or Ctrl-C ends them: `--timeout` doesn't bound them. */
export const UNBOUNDED: ReadonlySet<string> = new Set(["host", "dev"]);

/**
 * The global flags a command doesn't define again (`wait --timeout` is the wait's own); a command
 * `--timeout` doesn't bound has no `--timeout`.
 */
function globalFlagsOf(command: CommandDef): FlagDef[] {
  const own = new Set((command.flags ?? []).map((flag) => flag.name));
  if (UNBOUNDED.has(command.path[0] ?? "")) own.add("timeout");
  return GLOBAL_FLAGS.filter((flag) => !own.has(flag.name));
}

/** Every exit code a command can end with, sorted: `--timeout` can end any it bounds with 4. */
export function exitCodes(command: CommandDef): number[] {
  const bounded = !UNBOUNDED.has(command.path[0] ?? "") && command.path[0] !== "wait";
  return [
    ...new Set([
      EXIT.ok,
      ...command.exits,
      EXIT.usage,
      EXIT.environment,
      ...(bounded ? [EXIT.timeout] : []),
    ]),
  ].sort((a, b) => a - b);
}

/** One command's help, for people. */
export function commandHelp(command: CommandDef): string {
  const lines = [command.summary, "", "Usage:", `  ${usageLine(command)}`];
  if ((command.args ?? []).length > 0) {
    lines.push("", "Arguments:");
    for (const arg of command.args ?? [])
      lines.push(`  ${`<${arg.name}>`.padEnd(28)} ${arg.summary}`);
  }
  if ((command.flags ?? []).length > 0) {
    lines.push("", "Flags:");
    for (const flag of command.flags ?? []) lines.push(flagLine(flag));
  }
  lines.push("", "Global flags:");
  for (const flag of globalFlagsOf(command)) lines.push(flagLine(flag));
  lines.push("", `Output: ${command.output.type} (mostra docs ${command.output.topic})`);
  lines.push("", "Exit codes:");
  for (const code of exitCodes(command)) lines.push(`  ${code}  ${EXIT_MEANING[code] ?? ""}`);
  lines.push("", "Example:", `  mostra ${command.example}`, "");
  return lines.join("\n");
}

/** A group's help (`mostra daemon --help`): its commands. */
export function groupHelp(commands: readonly CommandDef[], group: string): string {
  const members = commands.filter((command) => command.path[0] === group);
  return [
    `mostra ${group}: ${members.length} commands.`,
    "",
    ...members.map((command) => `  ${commandName(command).padEnd(22)} ${command.summary}`),
    "",
    `Run "mostra ${group} <command> --help" for one of them.`,
    "",
  ].join("\n");
}

/** The top-level help: every command. */
export function topHelp(commands: readonly CommandDef[]): string {
  return [
    "Mostra, the agent artifact runtime: write ordinary React, verify it, publish it, share the link, wait for answers.",
    "",
    "Usage:",
    "  mostra <command> [arguments] [flags]",
    "",
    "Commands:",
    ...commands.map((command) => `  ${commandName(command).padEnd(22)} ${command.summary}`),
    "",
    "Global flags:",
    ...GLOBAL_FLAGS.map(flagLine),
    "",
    'Run "mostra <command> --help" for a command, and "mostra docs" for the reference.',
    "",
  ].join("\n");
}

/** One command's machine-readable definition (`--help --json`). */
export function commandDefinition(command: CommandDef): Record<string, unknown> {
  return {
    command: commandName(command),
    summary: command.summary,
    usage: usageLine(command),
    args: (command.args ?? []).map((arg) => ({
      name: arg.name,
      summary: arg.summary,
      optional: arg.optional === true,
      variadic: arg.variadic === true,
    })),
    flags: [...(command.flags ?? []), ...globalFlagsOf(command)].map((flag) => ({
      name: flag.name,
      type: flag.kind,
      summary: flag.summary,
      ...(flag.choices ? { choices: flag.choices } : {}),
      ...(flag.default !== undefined ? { default: flag.default } : {}),
      global: GLOBAL_FLAGS.includes(flag),
    })),
    output: command.output,
    exitCodes: exitCodes(command).map((code) => ({ code, meaning: EXIT_MEANING[code] ?? "" })),
    stdin: typeof command.readsStdin === "function" ? "sometimes" : command.readsStdin === true,
    streams: command.streams === true,
    example: `mostra ${command.example}`,
  };
}

/** `docs/reference/cli.md`: every command's help as one page. */
export function referenceMarkdown(commands: readonly CommandDef[]): string {
  const sections = commands.map(
    (command) =>
      `## mostra ${commandName(command)}\n\n\`\`\`text\n${commandHelp(command).trimEnd()}\n\`\`\`\n`,
  );
  return [
    "# The mostra CLI",
    "",
    "<!-- Generated from the command definitions in packages/cli/src/commands/. Don't edit; run `pnpm fix`. -->",
    "",
    'Every command takes `--json`, which prints one envelope on stdout: `{ "ok": true, "result", "instance", "warnings" }` or `{ "ok": false, "error", "warnings" }`. Streaming commands print one envelope per line, the last one carrying `result` or `error`. Logs and progress go to stderr. Without a terminal, or with `--json`, no command asks a question.',
    "",
    `Commands: ${topWords(commands)
      .map((word) => `\`${word}\``)
      .join(", ")}.`,
    "",
    ...sections,
  ].join("\n");
}
