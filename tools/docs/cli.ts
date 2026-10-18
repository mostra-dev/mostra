#!/usr/bin/env node
/**
 * The CLI reference (D140 item 16): `docs/reference/cli.md`, generated from the command
 * definitions in `@mostra/cli`, as `--help` prints them.
 *
 *   node --conditions=@mostra/source tools/docs/cli.ts write   regenerate it
 *   node --conditions=@mostra/source tools/docs/cli.ts check   fail when it is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fail, fromRoot } from "../lib/repo.ts";

// Loaded from source with the `@mostra/source` condition, so the reference never needs a build.
const { COMMANDS, referenceMarkdown } = (await import(
  pathToFileURL(fromRoot("packages/cli/src/index.ts")).href
)) as { COMMANDS: readonly unknown[]; referenceMarkdown(commands: readonly unknown[]): string };

const file = fromRoot("docs/reference/cli.md");
const text = referenceMarkdown(COMMANDS);
const mode = process.argv[2];
if (mode === "write") {
  writeFileSync(file, text);
  console.log(`✓ wrote ${COMMANDS.length} commands to docs/reference/cli.md`);
} else if (mode === "check") {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // Reported below.
  }
  if (current !== text) {
    fail(
      ["docs/reference/cli.md doesn't match the command definitions."],
      "Run `pnpm fix` and commit the result.",
    );
  }
  console.log(`✓ docs/reference/cli.md matches the ${COMMANDS.length} command definitions`);
} else {
  fail(["usage: node --conditions=@mostra/source tools/docs/cli.ts write|check"], "Unknown mode.");
}
