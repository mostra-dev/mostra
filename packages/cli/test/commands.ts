/**
 * Finding the Mostra commands a Markdown text shows, and whether each parses under the command
 * definitions: for the Agent Skill (`skill.test.ts`) and the `AGENTS.md` that `mostra new`
 * scaffolds (`contract.test.ts`), WP-14. And what else a text names of the CLI, held to this
 * release: flags written on their own, wait conditions and `mostra docs` topics (D174, MT-04).
 */
import { WaitCondition } from "@mostra/protocol";
import { commandName, type FlagDef } from "../src/command.ts";
import { COMMANDS } from "../src/commands/index.ts";
import { durationMs, GLOBAL_FLAGS, type Parsed, parseCommandLine } from "../src/parse.ts";

/** Splits a shell-like command into words, honoring quotes, up to a redirection, pipe or comment. */
export function words(command: string): string[] {
  const found: string[] = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const word = match[1] ?? match[2] ?? match[3] ?? "";
    if (match[3] !== undefined && ["<", ">", "|", "&&", ";", "#"].includes(word)) break;
    found.push(word);
  }
  return found;
}

/**
 * Every Mostra command a Markdown text shows, without the program: in inline code, and on the
 * lines of a shell code block, written as `mostra …` or `npx -y @mostra/cli@<version> …`.
 */
export function shownCommands(markdown: string): string[] {
  const found: string[] = [];
  const invocation = /^(?:mostra|npx -y @mostra\/cli@\S+)\s+(.*)$/;
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const command = invocation.exec((match[1] as string).trim());
    if (command) found.push(command[1] as string);
  }
  for (const block of markdown.matchAll(/```(?:sh|bash|shell|console)\n([\s\S]*?)```/g)) {
    for (const line of (block[1] as string).split("\n")) {
      const command = invocation.exec(line.replace(/^\$\s*/, "").trim());
      if (command) found.push(command[1] as string);
    }
  }
  return found;
}

/** Values of the kind a placeholder stands for; any other placeholder is a plain word. */
const PLACEHOLDER_VALUES: Readonly<Record<string, string>> = {
  condition: "submitted",
  duration: "30s",
  d: "1h",
};

/** A shown command with its placeholders (`<dir>`, `[flags]`, `…`) filled in. */
export function filled(command: string): string {
  return command
    .replace(/<([^>]+)>/g, (_, name: string) => PLACEHOLDER_VALUES[name] ?? "x")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/…/g, "");
}

/** Whether a shown command parses: it names a command or a group, or runs one as written. */
export function parsesAsShown(command: string): boolean {
  // `mostra <command>` (and `mostra <command> --help`) names any command, not one.
  if (/^<command>/.test(command.trim())) return true;
  const argv = words(filled(command));
  if (argv.length === 0) return false;
  const exact = COMMANDS.some(
    (definition) =>
      definition.path.length === argv.length &&
      definition.path.every((word, index) => argv[index] === word),
  );
  const group = argv.length === 1 && COMMANDS.some((definition) => definition.path[0] === argv[0]);
  if (exact || group) return true;
  try {
    parseCommandLine(COMMANDS, argv);
    return true;
  } catch {
    return false;
  }
}

/** A text without its fenced code blocks: the prose and its inline code. */
export function prose(markdown: string): string {
  return markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
}

/** Every inline code span of a text, trimmed. */
export function inlineSpans(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => (match[1] as string).trim());
}

/** Every flag a command or the program takes, by name (`--help` and `--version` are the runner's). */
const FLAGS_BY_NAME: ReadonlyMap<string, readonly FlagDef[]> = (() => {
  const byName = new Map<string, FlagDef[]>();
  const runner: FlagDef[] = [
    { name: "help", kind: "boolean", summary: "" },
    { name: "version", kind: "boolean", summary: "" },
  ];
  for (const flag of [
    ...GLOBAL_FLAGS,
    ...runner,
    ...COMMANDS.flatMap((command) => command.flags ?? []),
  ])
    byName.set(flag.name, [...(byName.get(flag.name) ?? []), flag]);
  return byName;
})();

/** Why a flag's value, as a text shows it, is one no command takes it with; none when it is. */
function valueProblem(name: string, defs: readonly FlagDef[], value: string): string | undefined {
  if (name === "until")
    return WaitCondition.safeParse(value).success
      ? undefined
      : `"${value}" isn't a condition mostra wait takes`;
  const fits = defs.some((def) => {
    if (def.kind === "boolean") return false;
    if (def.choices) return def.choices.includes(value);
    if (def.kind === "number") return /^\d+$/.test(value);
    if (def.kind === "duration") {
      try {
        durationMs(value);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  });
  return fits ? undefined : `no command takes --${name} with "${value}"`;
}

/**
 * The flags a text names on their own, in inline code outside a full command (`--browser`,
 * `--screenshots always`, `--until submitted:all`), that no command of this release takes as
 * written: an unknown flag, a value outside its choices, a condition `mostra wait` refuses. A
 * value that is a placeholder (`--after <cursor>`) stands for any. CSS variables are written
 * `var(--name)`, so a span that starts with `--` is a flag.
 */
export function flagProblems(markdown: string): string[] {
  const problems: string[] = [];
  for (const span of inlineSpans(prose(markdown))) {
    const match = /^--([a-z][a-z0-9-]*)(?:[ =](.+))?$/.exec(span);
    if (!match) continue;
    const name = match[1] as string;
    const raw = match[2];
    const defs = FLAGS_BY_NAME.get(name);
    if (defs === undefined) {
      problems.push(`\`${span}\`: no command takes --${name}`);
      continue;
    }
    if (raw === undefined || /<[^>]+>|…/.test(raw)) continue;
    const problem = valueProblem(name, defs, raw.trim());
    if (problem !== undefined) problems.push(`\`${span}\`: ${problem}`);
  }
  return problems;
}

/**
 * Why a shown command, which parses, still names something this release doesn't have: a wait
 * condition `mostra wait` refuses (`--until` takes any text on the command line), or a `mostra
 * docs` topic the bundled reference lacks. None when it names only what exists.
 */
export function shownProblem(command: string, topics: ReadonlySet<string>): string | undefined {
  if (/^<command>/.test(command.trim())) return undefined;
  let parsed: Parsed;
  try {
    parsed = parseCommandLine(COMMANDS, words(filled(command)));
  } catch {
    return undefined; // `parsesAsShown` reports it.
  }
  if (parsed.kind !== "run") return undefined;
  // A placeholder stands for any value: judge only what the text writes out.
  const shown = words(command);
  const written = (value: string | undefined): value is string =>
    value !== undefined && !/<[^>]+>|…/.test(value);
  const untilAt = shown.findIndex((word) => word === "--until" || word.startsWith("--until="));
  const until =
    untilAt === -1
      ? undefined
      : (shown[untilAt] as string).startsWith("--until=")
        ? (shown[untilAt] as string).slice("--until=".length)
        : shown[untilAt + 1];
  if (written(until)) {
    const problem = valueProblem("until", [], until);
    if (problem !== undefined) return `mostra ${command}: ${problem}`;
  }
  // `docs`' one argument, past any flag (and its value) written before it (`docs --json guide`).
  let topic: string | undefined;
  for (let index = 1; shown[0] === "docs" && index < shown.length; index += 1) {
    const word = shown[index] as string;
    if (!word.startsWith("-")) {
      topic = word;
      break;
    }
    const takesValue = FLAGS_BY_NAME.get(word.replace(/^--/, ""))?.some(
      (def) => def.kind !== "boolean",
    );
    if (takesValue && !word.includes("=")) index += 1;
  }
  if (commandName(parsed.command) === "docs" && written(topic) && !topics.has(topic))
    return `mostra ${command}: "${topic}" isn't a topic of mostra docs`;
  return undefined;
}
