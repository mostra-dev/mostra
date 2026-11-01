/**
 * Finding the Mostra commands a Markdown text shows, and whether each parses under the command
 * definitions: for the Agent Skill (`skill.test.ts`) and the `AGENTS.md` that `mostra new`
 * scaffolds (`contract.test.ts`), WP-14.
 */
import { COMMANDS } from "../src/commands/index.ts";
import { parseCommandLine } from "../src/parse.ts";

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
