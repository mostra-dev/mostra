/**
 * The plugin's second build, for Claude's plugin directory (MT-07): the folder
 * `claude-directory/` of the plugin's repository, built in the same run from the same definition
 * and the same Skill as the full plugin at the repository's root.
 *
 * The directory takes from an organization that isn't verified only Markdown, plain text, JSON,
 * YAML and images, and no local (stdio) MCP server, while "MCP servers that Claude Code connects to
 * at a public URL can stay" (VERIFIED_FACTS, MT-07). So the folder holds the Skill with each
 * example artifact as one Markdown file, the remote MCP server alone, its manifest, icon,
 * marketplace, README and license, and nothing that starts a program, sets where packages come
 * from or reads an environment variable. The only change to the Skill is `forClaudeDirectory`:
 * its links to the examples' directories point at their Markdown files, and its `compatibility`
 * field names both ways in. `check.ts` holds the folder to the directory's rules
 * (`checkClaudeDirectory`).
 */
import { parse as parseYaml } from "yaml";
import type { PluginDefinition } from "./definition.ts";
import { readme } from "./readme.ts";

/** The folder in the plugin's repository; the directory's submission names it as its plugin path. */
export const CLAUDE_DIRECTORY = "claude-directory";

/** Where the Skill keeps its examples: one directory per artifact, one Markdown file per artifact here. */
export const EXAMPLES = "assets/examples";

/** Where the folder's icon goes, as the root's Claude manifest has it. */
export const DIRECTORY_ICON = ".claude-plugin/icon.png";

/** The first line of every Markdown example: what it is, and how its blocks become files. */
export const EXAMPLE_INTRO =
  "A complete artifact that passes `mostra verify`. Each block below is one file: write it into the artifact's directory at the path its heading gives.";

/** The fence language of each file an example may hold, by extension. */
const LANGUAGES: Readonly<Record<string, string>> = {
  tsx: "tsx",
  ts: "ts",
  jsx: "jsx",
  js: "js",
  mdx: "mdx",
  md: "md",
  css: "css",
  json: "json",
};

/** A path a heading can carry and an artifact can hold: relative, plain, no `..`. */
const EXAMPLE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Text of an example file, refused when it isn't text that survives a fenced block unchanged. */
function exampleText(path: string, bytes: Buffer | string): string {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  if (buffer.includes(0)) throw new Error(`${path} isn't text: a Markdown example holds text only`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  if (text === "" || !text.endsWith("\n"))
    throw new Error(
      `${path} doesn't end with a newline, so its block couldn't give it back exactly`,
    );
  if (text.includes("\r")) throw new Error(`${path} has a carriage return; examples use \\n`);
  return text;
}

/** `index.*` first (the entry), then the rest by path. */
function exampleOrder(paths: Iterable<string>): string[] {
  const entry = (path: string) => (/^index\.[a-z]+$/.test(path) ? 0 : 1);
  return [...paths].sort((a, b) => entry(a) - entry(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * One example artifact as one Markdown file: the intro line, then each file under a heading with
 * its path and a fenced block in its language, `index.tsx` first. Each fence is longer than any run
 * of backticks in its file, so no line of the file can close it.
 */
export function exampleMarkdown(files: ReadonlyMap<string, Buffer | string>): string {
  if (files.size === 0) throw new Error("an example holds at least its entry");
  const blocks = exampleOrder(files.keys()).map((path) => {
    if (!EXAMPLE_PATH.test(path)) throw new Error(`${path} can't be an example's file path`);
    const extension = /\.([a-z]+)$/.exec(path)?.[1] ?? "";
    const language = LANGUAGES[extension];
    if (language === undefined)
      throw new Error(`${path}: no Markdown example holds a .${extension}`);
    const text = exampleText(path, files.get(path) as Buffer | string);
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `## ${path}\n\n${fence}${language}\n${text}${fence}\n`;
  });
  return `${EXAMPLE_INTRO}\n\n${blocks.join("\n")}`;
}

/**
 * The files a Markdown example gives back, by the path each block's heading names: the inverse of
 * `exampleMarkdown`, byte for byte. Throws on anything `exampleMarkdown` doesn't write.
 */
export function splitExampleMarkdown(markdown: string): Map<string, string> {
  const lines = markdown.split("\n");
  if (lines.at(-1) !== "") throw new Error("a Markdown example ends with a newline");
  lines.pop();
  if (lines[0] !== EXAMPLE_INTRO || lines[1] !== "")
    throw new Error("a Markdown example starts with its intro line");
  const files = new Map<string, string>();
  let at = 2;
  while (at < lines.length) {
    if (files.size > 0) {
      if (lines[at] !== "") throw new Error(`line ${at + 1}: a blank line separates two files`);
      at += 1;
    }
    const heading = /^## (.+)$/.exec(lines[at] ?? "");
    if (!heading || !EXAMPLE_PATH.test(heading[1] as string))
      throw new Error(`line ${at + 1}: expected "## <path>"`);
    const path = heading[1] as string;
    if (files.has(path)) throw new Error(`line ${at + 1}: ${path} appears twice`);
    if (lines[at + 1] !== "") throw new Error(`line ${at + 2}: a blank line follows the heading`);
    const open = /^(`{3,})([a-z]+)$/.exec(lines[at + 2] ?? "");
    if (!open) throw new Error(`line ${at + 3}: expected the block's opening fence`);
    const fence = open[1] as string;
    const close = lines.indexOf(fence, at + 3);
    if (close < 0) throw new Error(`${path}: its block is never closed`);
    files.set(path, `${lines.slice(at + 3, close).join("\n")}\n`);
    at = close + 1;
  }
  if (files.size === 0) throw new Error("a Markdown example holds at least one file");
  return files;
}

/** The example artifacts a Skill holds: each directory directly under `assets/examples/`. */
export function exampleNames(skill: ReadonlyMap<string, unknown>): string[] {
  const names = new Set<string>();
  for (const path of skill.keys()) {
    const match = new RegExp(`^${EXAMPLES}/([^/]+)/`).exec(path);
    if (match) names.add(match[1] as string);
  }
  return [...names].sort();
}

/**
 * The link rewrite: every mention of an example's directory (`assets/examples/<name>/`, which
 * `../assets/examples/<name>/` contains) becomes its Markdown file (`assets/examples/<name>.md`),
 * in a link's target and in its text alike. A path to a file inside an example's directory is left
 * as it is, so the link check names it.
 */
export function rewriteExampleLinks(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names)
    out = out.replace(
      new RegExp(`${EXAMPLES}/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?![\\w.-])`, "g"),
      `${EXAMPLES}/${name}.md`,
    );
  return out;
}

/** `SKILL.md` with its frontmatter's `compatibility` field replaced; read back to be sure. */
function withCompatibility(skillMd: string, compatibility: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
  if (!frontmatter) throw new Error("SKILL.md has no frontmatter");
  const lines = (frontmatter[1] as string).split("\n");
  const at = lines.flatMap((line, index) => (/^compatibility:/.test(line) ? [index] : []));
  if (at.length !== 1) throw new Error("SKILL.md's frontmatter needs one compatibility line");
  if (/[\n\r]/.test(compatibility)) throw new Error("the compatibility field is one line");
  lines[at[0] as number] = `compatibility: ${compatibility}`;
  const result = `---\n${lines.join("\n")}\n---\n${skillMd.slice(frontmatter[0].length)}`;
  let parsed: { compatibility?: unknown };
  try {
    parsed = parseYaml(lines.join("\n")) as { compatibility?: unknown };
  } catch (error) {
    throw new Error(`the compatibility field breaks SKILL.md's YAML: ${(error as Error).message}`);
  }
  if (parsed.compatibility !== compatibility)
    throw new Error(
      "the compatibility field doesn't read back as YAML gives it; quote or reword it",
    );
  return result;
}

/**
 * The one change the folder makes to the Skill (MT-07): each example directory becomes one
 * Markdown file, every link to an example's directory points at that file, and `SKILL.md`'s
 * `compatibility` field is the folder's. Every other byte is the repository's.
 *
 * `skill` maps each path below `skills/<name>/` to its bytes; the result does the same for the
 * folder's copy.
 */
export function forClaudeDirectory(
  skill: ReadonlyMap<string, Buffer>,
  compatibility: string,
): Map<string, Buffer> {
  const names = exampleNames(skill);
  const out = new Map<string, Buffer>();
  const examples = new Map<string, Map<string, Buffer>>(names.map((name) => [name, new Map()]));
  for (const [path, bytes] of skill) {
    const example = new RegExp(`^${EXAMPLES}/([^/]+)/(.+)$`).exec(path);
    if (example) {
      examples.get(example[1] as string)?.set(example[2] as string, bytes);
      continue;
    }
    if (!path.endsWith(".md")) {
      out.set(path, bytes);
      continue;
    }
    let text = rewriteExampleLinks(bytes.toString("utf8"), names);
    if (path === "SKILL.md") text = withCompatibility(text, compatibility);
    out.set(path, Buffer.from(text, "utf8"));
  }
  for (const [name, files] of examples) {
    const target = `${EXAMPLES}/${name}.md`;
    if (skill.has(target)) throw new Error(`${target} exists beside the example ${name}/`);
    out.set(target, Buffer.from(exampleMarkdown(files), "utf8"));
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** What the folder needs of the build. */
export interface DirectoryInput {
  readonly version: string;
  readonly telemetryEndpoint: string;
  /** Each Skill's files, by its name, then by path below `skills/<name>/`: the same bytes the root copies. */
  readonly skills: ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
  /** The listing icon's bytes, when the definition names one. */
  readonly icon: Buffer | undefined;
  readonly license: Buffer;
  readonly notice: Buffer;
  /** The remote server, when the feature is on: the folder's only MCP server. */
  readonly remote: { readonly url: string; readonly privacy: string } | undefined;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The marketplace's name in the folder, apart from the root's, so both can be added side by side. */
export const DIRECTORY_MARKETPLACE = "mostra-claude-directory";

/** The folder's tree, every path relative to `claude-directory/`. */
export function buildClaudeDirectory(
  definition: PluginDefinition,
  input: DirectoryInput,
): Map<string, string | Buffer> {
  const { version, remote } = input;
  const tree = new Map<string, string | Buffer>();
  const author = { name: definition.author.name, url: definition.author.url };
  // Only the fields Claude Code's manifest reference documents for a listing (VERIFIED_FACTS,
  // MT-07), and none the directory's report named unknown.
  tree.set(
    ".claude-plugin/plugin.json",
    json({
      name: definition.name,
      version,
      description: definition.description,
      author,
      homepage: definition.homepage,
      repository: definition.repository,
      license: definition.license,
      keywords: definition.keywords,
      ...(input.icon ? { icon: `./${DIRECTORY_ICON}` } : {}),
      ...(remote ? { privacyPolicyUrl: remote.privacy } : {}),
    }),
  );
  if (input.icon) tree.set(DIRECTORY_ICON, input.icon);
  tree.set(
    ".claude-plugin/marketplace.json",
    json({
      name: DIRECTORY_MARKETPLACE,
      owner: author,
      description: definition.description,
      plugins: [
        {
          name: definition.name,
          source: "./",
          description: definition.description,
          version,
          author,
          homepage: definition.homepage,
          repository: definition.repository,
          license: definition.license,
          keywords: definition.keywords,
        },
      ],
    }),
  );
  if (remote)
    tree.set(
      ".mcp.json",
      json({ mcpServers: { "mostra-remote": { type: "http", url: remote.url } } }),
    );
  for (const [name, files] of input.skills) {
    const copy = forClaudeDirectory(files, definition.features.claudeDirectory.compatibility);
    for (const [path, bytes] of copy) tree.set(`skills/${name}/${path}`, bytes);
  }
  tree.set(
    "README.md",
    readme(definition, input, { local: false, remote }, { variant: "claude-directory" }),
  );
  tree.set("LICENSE", input.license);
  tree.set("NOTICE", input.notice);
  return tree;
}
