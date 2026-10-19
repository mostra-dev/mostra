#!/usr/bin/env node
/**
 * The GitHub release's notes (EN-05): each fixed-group package's `CHANGELOG.md` section for the
 * release's version (written by `changeset version`), then how to install and check the bundles.
 *
 *   node packages/bundle/scripts/notes.ts > notes.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const config = JSON.parse(readFileSync(join(ROOT, ".changeset", "config.json"), "utf8")) as {
  fixed: string[][];
};
const names = config.fixed[0] ?? [];
const dirOf = (name: string): string =>
  join(ROOT, "packages", name.startsWith("@mostra/") ? name.slice("@mostra/".length) : name);
const version = (
  JSON.parse(readFileSync(join(dirOf("@mostra/sdk"), "package.json"), "utf8")) as {
    version: string;
  }
).version;

/** The `## <version>` section of a changelog, without its heading. */
function section(text: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

const parts: string[] = [`# Mostra ${version}`, ""];
for (const name of names) {
  const file = join(dirOf(name), "CHANGELOG.md");
  const body = existsSync(file) ? section(readFileSync(file, "utf8")) : undefined;
  if (body) parts.push(`## ${name}`, "", body, "");
}
parts.push(
  "## Install",
  "",
  "```sh",
  "npm create mostra@latest my-artifact",
  "```",
  "",
  "The runtime bundles below carry Mostra's own Node.js, so nothing else needs Node.js. To install one by hand, check it first:",
  "",
  "```sh",
  "sha256sum -c SHA256SUMS --ignore-missing   # shasum -a 256 -c on macOS",
  "gh attestation verify mostra-<version>-<platform>.tar.gz --repo mostra-dev/mostra",
  "```",
  "",
  "then extract it and run its `bin/mostra-setup` once.",
  "",
);
process.stdout.write(parts.join("\n"));
