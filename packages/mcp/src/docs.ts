/**
 * The bundled reference (D140 item 17, D162): the CLI reference, the telemetry and self-hosting pages, every
 * diagnostic code and the Agent Skill as `guide` topics, read from the directories a package ships.
 * `mostra docs` and both MCP servers read it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { DEFAULT_DOCS_BASE } from "@mostra/protocol";
import type { DocsTopicSummary, McpDocs } from "./ports.ts";

/** One topic of the reference. */
export interface DocsTopic {
  /** Its stable slug: `cli`, `telemetry`, a diagnostic code, `guide` or `guide/<name>`. */
  readonly topic: string;
  /** Its title, from the page's first heading. */
  readonly title: string;
  /** Where the docs site serves it. */
  readonly url: string;
  /** Its Markdown file, or a guide topic's first file. */
  readonly file: string;
  /**
   * A guide topic that isn't one Markdown page (a stylesheet, an example): its files, relative to
   * the Skill's `assets/`, each shown as code.
   */
  readonly files?: readonly string[];
}

function titleOf(file: string): string {
  const first = readFileSync(file, "utf8")
    .split("\n")
    .find((line) => line.startsWith("# "));
  return first ? first.slice(2).trim() : "";
}

/** Every topic, the pages first and then the codes, sorted. */
/**
 * Every topic of the reference in `referenceDir` and the Agent Skill in `skillDir`: the pages first,
 * then the guide, then the codes, sorted.
 */
export function docsIndex(referenceDir: string, skillDir: string): DocsTopic[] {
  const dir = referenceDir;
  const base = DEFAULT_DOCS_BASE.replace(/\/+$/, "");
  const pages: DocsTopic[] = [];
  for (const topic of ["cli", "telemetry", "self-hosting"]) {
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
  return [...pages, ...guideTopics(skillDir, base), ...errors];
}

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : 1);

/** Every file below `root`'s `prefix`, relative to `root`, sorted. */
function filesBelow(root: string, prefix: string): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .sort(byName)
    .flatMap((entry) => {
      const path = `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesBelow(root, path) : [path];
    });
}

/**
 * The Skill as topics: `guide` (its SKILL.md), `guide/<name>` for each reference,
 * `guide/<file>` for each asset (the baseline stylesheet), and `guide/examples/<name>` for each
 * example, every file of it.
 */
export function guideTopics(dir: string, base: string): DocsTopic[] {
  const skill = join(dir, "SKILL.md");
  if (!existsSync(skill)) return [];
  const topics: DocsTopic[] = [
    { topic: "guide", title: "Using Mostra", url: `${base}/guide`, file: skill },
  ];
  const references = join(dir, "references");
  if (existsSync(references)) {
    for (const name of readdirSync(references)
      .filter((entry) => entry.endsWith(".md"))
      .sort()) {
      const file = join(references, name);
      const slug = name.slice(0, -3);
      topics.push({
        topic: `guide/${slug}`,
        title: titleOf(file),
        url: `${base}/guide/${slug}`,
        file,
      });
    }
  }
  const assets = join(dir, "assets");
  if (!existsSync(assets)) return topics;
  for (const entry of readdirSync(assets, { withFileTypes: true }).sort(byName)) {
    if (!entry.isFile()) continue;
    topics.push({
      topic: `guide/${entry.name}`,
      title: entry.name,
      url: `${base}/guide/${entry.name}`,
      file: join(assets, entry.name),
      files: [entry.name],
    });
  }
  const examples = join(assets, "examples");
  if (!existsSync(examples)) return topics;
  for (const entry of readdirSync(examples, { withFileTypes: true }).sort(byName)) {
    if (!entry.isDirectory()) continue;
    const files = filesBelow(assets, `examples/${entry.name}`);
    if (files.length === 0) continue;
    topics.push({
      topic: `guide/examples/${entry.name}`,
      title: `Example: ${entry.name}`,
      url: `${base}/guide/examples/${entry.name}`,
      file: join(assets, files[0] as string),
      files,
    });
  }
  return topics;
}

const FENCE_LANGUAGES: Readonly<Record<string, string>> = {
  ".css": "css",
  ".json": "json",
  ".md": "md",
  ".mdx": "mdx",
  ".ts": "ts",
  ".tsx": "tsx",
};

/** How the guide's relative links read through the CLI, before each of its pages. */
export const GUIDE_LINKS: string =
  "> Read through `mostra docs`: a link to `references/<name>.md` is `mostra docs guide/<name>`, `assets/<file>` is `mostra docs guide/<file>`, and `assets/examples/<name>/` is `mostra docs guide/examples/<name>`.";

/** The same for the guide read through `mostra mcp` (D164): topics of `docs_search`, or resources. */
export const MCP_GUIDE_LINKS: string =
  "> Read through Mostra's MCP server: a link to `references/<name>.md` is the topic `guide/<name>`, `assets/<file>` is `guide/<file>`, and `assets/examples/<name>/` is `guide/examples/<name>`; read one with docs_search (`topic`) or the resource `mostra://docs/<topic>`. Where the guide runs a `mostra` command, use the tool of the same step (artifact_verify for `mostra verify`, artifact_wait for `mostra wait`).";

/**
 * A topic's Markdown. A guide page loses its frontmatter and says how its links read (through the
 * CLI by default, or `links`); a guide topic made of files shows each one as code under its path.
 */
export function topicMarkdown(topic: DocsTopic, dir: string, links: string = GUIDE_LINKS): string {
  if (topic.files !== undefined) {
    const parts = topic.files.map((path) => {
      const text = readFileSync(join(dir, "assets", path), "utf8");
      const fence = text.includes("```") ? "````" : "```";
      const body = text.endsWith("\n") ? text : `${text}\n`;
      return `## \`${path}\`\n\n${fence}${FENCE_LANGUAGES[extname(path)] ?? ""}\n${body}${fence}\n`;
    });
    return [`# ${topic.title}`, "", links, "", ...parts].join("\n");
  }
  const text = readFileSync(topic.file, "utf8");
  if (topic.topic !== "guide" && !topic.topic.startsWith("guide/")) return text;
  return [links, "", text.replace(/^---\n[\s\S]*?\n---\n+/, "")].join("\n");
}

/** The index as Markdown: what `mostra docs` prints without a topic. */
export function indexMarkdown(topics: readonly DocsTopic[]): string {
  const pages = topics.filter(
    (topic) => !topic.topic.startsWith("MOSTRA_") && !topic.topic.startsWith("guide"),
  );
  const guide = topics.filter(
    (topic) => topic.topic === "guide" || topic.topic.startsWith("guide/"),
  );
  const codes = topics.filter((topic) => topic.topic.startsWith("MOSTRA_"));
  return [
    "# Mostra reference",
    "",
    "Run `mostra docs <topic>` to read one. Diagnostic codes are topics too.",
    "",
    ...pages.map((topic) => `- \`${topic.topic}\`: ${topic.title}`),
    "",
    ...(guide.length > 0
      ? [
          "## Writing artifacts",
          "",
          ...guide.map((topic) => `- \`${topic.topic}\`: ${topic.title}`),
          "",
        ]
      : []),
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

/**
 * The bundled reference as the MCP server's docs (`docs_search`, `mostra://docs/{topic}`): the
 * reference and the Skill in two directories, read once and cached. The CLI gives the copies it
 * ships; the remote server the copies its build carries.
 */
export function fileDocs(options: {
  readonly referenceDir: string;
  readonly skillDir: string;
  readonly links?: string;
}): McpDocs {
  let topics: DocsTopic[] | undefined;
  const all = (): DocsTopic[] => {
    topics ??= docsIndex(options.referenceDir, options.skillDir);
    return topics;
  };
  const cache = new Map<string, string>();
  return {
    topics: (): DocsTopicSummary[] =>
      all().map((topic) => ({ topic: topic.topic, title: topic.title, url: topic.url })),
    read(topic) {
      const cached = cache.get(topic);
      if (cached !== undefined) return cached;
      const found = all().find((entry) => entry.topic === topic);
      if (found === undefined) return undefined;
      const markdown = topicMarkdown(found, options.skillDir, options.links ?? MCP_GUIDE_LINKS);
      cache.set(topic, markdown);
      return markdown;
    },
  };
}
