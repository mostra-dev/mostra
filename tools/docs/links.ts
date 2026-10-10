#!/usr/bin/env node
/**
 * Fails on a relative Markdown link whose target file doesn't exist. External links and pure
 * anchors are not checked here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail, fromRoot, git } from "../lib/repo.ts";

/** Broken relative links in one Markdown text located at `file` (repository-relative). */
export function brokenLinks(
  file: string,
  text: string,
  exists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const match of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? "";
    if (/^([a-z]+:|#|\/\/)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0] ?? "");
    if (path === "") continue;
    const resolved = join(dirname(file), path);
    if (!exists(resolved)) problems.push(`${file}: link to ${target} does not resolve`);
  }
  return problems;
}

function main(): void {
  const files = (git(["ls-files", "--cached", "--others", "--exclude-standard", "*.md"]) ?? "")
    .split("\n")
    .filter((file) => file && !file.startsWith("docs/research/") && existsSync(fromRoot(file)));
  const problems = files.flatMap((file) =>
    brokenLinks(file, readFileSync(fromRoot(file), "utf8"), (path) => existsSync(fromRoot(path))),
  );
  if (problems.length > 0) fail(problems, "Markdown links");
  console.log(`✓ links: ${files.length} Markdown files, every relative link resolves`);
}

if (import.meta.main) main();
