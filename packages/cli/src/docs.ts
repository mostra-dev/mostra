/**
 * `mostra docs` (D140 item 17): the reference that ships with the CLI, by stable slug. The
 * diagnostic pages are keyed by code (`mostra docs MOSTRA_DEP_MISSING`, as hints say), beside the
 * CLI reference and the telemetry page. This index is the one source WP-15's `docs_search` and
 * WP-26's site read.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DOCS_BASE } from "@mostra/protocol";
import { fromSource, packageRoot } from "./version.ts";

/** One topic of the reference. */
export interface DocsTopic {
  /** Its stable slug: `cli`, `telemetry`, `errors`, or a diagnostic code. */
  readonly topic: string;
  /** Its title, from the page's first heading. */
  readonly title: string;
  /** Where the docs site serves it. */
  readonly url: string;
  /** Its Markdown file. */
  readonly file: string;
}

/** Where the reference is: bundled in the build (`dist/reference`), or the repository's. */
export function referenceDir(): string {
  const bundled = join(packageRoot(), "dist", "reference");
  return !fromSource() && existsSync(bundled)
    ? bundled
    : join(packageRoot(), "..", "..", "docs", "reference");
}

function titleOf(file: string): string {
  const first = readFileSync(file, "utf8")
    .split("\n")
    .find((line) => line.startsWith("# "));
  return first ? first.slice(2).trim() : "";
}

/** Every topic, the pages first and then the codes, sorted. */
export function docsIndex(dir: string = referenceDir()): DocsTopic[] {
  const base = DEFAULT_DOCS_BASE.replace(/\/+$/, "");
  const pages: DocsTopic[] = [];
  for (const topic of ["cli", "telemetry"]) {
    const file = join(dir, `${topic}.md`);
    if (existsSync(file))
      pages.push({ topic, title: titleOf(file), url: `${base}/${topic}`, file });
  }
  const errorsDir = join(dir, "errors");
  const codes = existsSync(errorsDir)
    ? readdirSync(errorsDir)
        .filter((name) => /^MOSTRA_[A-Z0-9_]+\.md$/.test(name))
        .sort()
    : [];
  const errors: DocsTopic[] = codes.map((name) => {
    const code = name.slice(0, -3);
    const file = join(errorsDir, name);
    return { topic: code, title: titleOf(file), url: `${base}/errors/${code}`, file };
  });
  return [...pages, ...errors];
}

/** The index as Markdown: what `mostra docs` prints without a topic. */
export function indexMarkdown(topics: readonly DocsTopic[]): string {
  const pages = topics.filter((topic) => !topic.topic.startsWith("MOSTRA_"));
  const codes = topics.filter((topic) => topic.topic.startsWith("MOSTRA_"));
  return [
    "# Mostra reference",
    "",
    "Run `mostra docs <topic>` to read one. Diagnostic codes are topics too.",
    "",
    ...pages.map((topic) => `- \`${topic.topic}\`: ${topic.title}`),
    "",
    "## Diagnostic codes",
    "",
    ...codes.map((topic) => `- \`${topic.topic}\`: ${topic.title}`),
    "",
  ].join("\n");
}

/** The topics nearest an unknown one, for its usage error. */
export function nearestTopics(wanted: string, topics: readonly DocsTopic[], count = 3): string[] {
  const target = wanted.toUpperCase();
  const scored = topics.map((topic) => {
    const name = topic.topic.toUpperCase();
    const contains = name.includes(target) || target.includes(name) ? 0 : 1;
    return { topic: topic.topic, score: contains * 100 + distance(name, target) };
  });
  return scored
    .sort((a, b) => a.score - b.score || (a.topic < b.topic ? -1 : 1))
    .slice(0, count)
    .map((item) => item.topic);
}

/** Levenshtein distance. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] as number;
}
