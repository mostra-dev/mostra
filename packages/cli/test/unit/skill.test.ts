/**
 * The Agent Skill (`skills/mostra/`, AX-06, WP-14) holds as an Agent Skill and as Mostra's
 * documentation: its frontmatter meets the Agent Skills specification (agentskills.io), every
 * relative link and anchor resolves, every `mostra …` it shows parses under the command
 * definitions, every author-facing export and every command an author uses is documented, and the
 * examples carry the baseline stylesheet unchanged. Mechanism only: the prose is Mirza's to accept
 * (D149), never tested by its wording.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTools } from "@mostra/mcp";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { commandName } from "../../src/command.ts";
import { COMMANDS } from "../../src/commands/index.ts";
import { docsIndex } from "../../src/docs.ts";
import {
  filled,
  flagProblems,
  parsesAsShown,
  prose,
  shownCommands,
  shownProblem,
  words,
} from "../commands.ts";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SKILL = join(REPO, "skills", "mostra");

/** Every file below `dir`, relative to it. */
function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? filesBelow(path).map((inner) => join(entry.name, inner))
      : [entry.name];
  });
}

const MARKDOWN = filesBelow(SKILL)
  .filter((file) => file.endsWith(".md"))
  .sort();
const read = (file: string): string => readFileSync(join(SKILL, file), "utf8");
const ALL_TEXT = MARKDOWN.map(read).join("\n");

/** The frontmatter of `SKILL.md`, and its body. */
function frontmatter(): { data: Record<string, unknown>; body: string } {
  const text = read("SKILL.md");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  return {
    data: parseYaml(match[1] as string) as Record<string, unknown>,
    body: text.slice(match[0].length),
  };
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
function anchors(markdown: string): Set<string> {
  const found = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^(```|````)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    found.add(
      (heading[1] as string)
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-"),
    );
  }
  return found;
}

/** Every exported value of an API report (`export function x`, `export const x`, `export class x`). */
function exportedValues(report: string): string[] {
  const names = new Set<string>();
  for (const match of report.matchAll(/^export (?:declare )?(?:function|const|class) (\w+)/gm))
    names.add(match[1] as string);
  return [...names].sort();
}

/** Every value `@mostra/react` (its subpaths too) and `@mostra/server` export to authors. */
function authorExports(): string[] {
  const react = exportedValues(readFileSync(join(REPO, "packages/react/etc/react.api.md"), "utf8"));
  const server = exportedValues(
    readFileSync(join(REPO, "packages/server/etc/server.api.md"), "utf8"),
  );
  const subpaths = ["form.ts", "router.ts"].flatMap((file) =>
    [
      ...readFileSync(join(REPO, "packages/react/src", file), "utf8").matchAll(
        /^export (?:async )?function (\w+)/gm,
      ),
    ].map((match) => match[1] as string),
  );
  return [...new Set([...react, ...server, ...subpaths])];
}

/**
 * Hooks the Skill names that aren't Mostra's, with whose they are. Any other `use…` name must be
 * one `@mostra/react` exports, so a misspelt or renamed hook (`useRespondent`) can't stand in the
 * text. Several are named as what not to write, so they are only listed, never imported.
 */
const OTHER_HOOKS: Readonly<Record<string, string>> = {
  useState: "React's",
  useParams: "React Router's",
  useTable: "TanStack Table 9's",
  useLegacyTable: "TanStack Table 9's, for code written for version 8",
  useReactTable: "TanStack Table 8's, named as what not to write",
  useReducedMotion: "Motion's",
  useFieldArray: "react-hook-form's",
};

/** The names of Mostra's MCP tools this release serves (D164). */
const TOOLS = new Set(createTools(async () => undefined).map((tool) => tool.name));

/**
 * Exports the generated entry and the runtime use, never artifact code, with why. Anything else a
 * package exports to authors is documented in the Skill.
 */
const INTERNAL_EXPORTS: Readonly<Record<string, string>> = {
  connectShell: "the generated entry connects the page to the shell",
  createServerReference: 'the builder\'s stubs for `"use server"` imports call it',
  mountArtifact: "the generated entry mounts the page",
  mountRoutes: "the generated entry mounts `pages/`",
  reportReady: "the generated entry reports readiness to the shell",
  setServerCallback: "mountArtifact installs the server transport",
  routeTree: "mountRoutes builds the route tree",
  historyMode: "mountRoutes picks the history mode by delivery target",
};

/** Commands an author has no use for, with why. Every other command is documented. */
const COMMANDS_NOT_FOR_AUTHORS: Readonly<Record<string, string>> = {
  host: "hosts spawn an instance over stdio; an author never runs it",
  "daemon start": "every command starts the daemon when it needs one",
  "daemon stop": "maintenance, not authoring",
  "daemon restart": "maintenance, not authoring",
  "daemon status": "maintenance, not authoring",
  "daemon uninstall": "the reverse of daemon install, documented beside it in --help",
  gc: "maintenance of the home, not authoring",
  "telemetry on": "a person's choice, not an agent's",
  "telemetry off": "a person's choice, not an agent's",
  "telemetry status": "a person's choice, not an agent's",
};

/**
 * What a link points at: its text for a file, `null` for a directory, `undefined` when nothing is
 * there. One read, so the answer can't change between a check and a use.
 */
function targetText(path: string): string | null | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EISDIR") return null;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

describe("the Agent Skill (AX-06)", () => {
  it("has the frontmatter the Agent Skills specification requires", () => {
    const { data, body } = frontmatter();
    // name: 1 to 64 lower-case letters, digits and single hyphens, the directory's own name.
    expect(data["name"]).toBe("mostra");
    expect(data["name"]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(String(data["name"]).length).toBeLessThanOrEqual(64);
    // description: what it does and when to use it, 1 to 1024 characters.
    expect(typeof data["description"]).toBe("string");
    const description = data["description"] as string;
    expect(description.trim().length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(data["license"]).toBe("Apache-2.0");
    expect(typeof data["compatibility"]).toBe("string");
    expect((data["compatibility"] as string).length).toBeLessThanOrEqual(500);
    // metadata: a map of strings.
    const metadata = data["metadata"] as Record<string, unknown>;
    for (const value of Object.values(metadata)) expect(typeof value).toBe("string");
    for (const key of Object.keys(data))
      expect(["name", "description", "license", "compatibility", "metadata"]).toContain(key);
    // The main file stays small: under 500 lines and about 5,000 tokens (D69's budget).
    expect(body.split("\n").length).toBeLessThan(500);
    expect(body.length / 4).toBeLessThan(5000);
  });

  it("resolves every relative link and anchor, and points at every reference", () => {
    const broken: string[] = [];
    for (const file of MARKDOWN) {
      const text = read(file);
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1] as string;
        if (/^[a-z]+:/.test(target)) continue;
        const [path, anchor] = target.split("#") as [string, string | undefined];
        const resolved =
          path === "" ? join(SKILL, file) : resolve(dirname(join(SKILL, file)), path);
        const linked = targetText(resolved);
        if (!resolved.startsWith(SKILL) || linked === undefined) {
          broken.push(`${file}: ${target}`);
          continue;
        }
        if (anchor !== undefined && linked !== null && !anchors(linked).has(anchor))
          broken.push(`${file}: ${target} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
    // Every reference has its own row in the references table, where an agent looks for it; a
    // link elsewhere in SKILL.md doesn't stand in for it.
    const skill = read("SKILL.md");
    for (const reference of readdirSync(join(SKILL, "references")))
      expect(skill, reference).toContain(`| [references/${reference}](references/${reference}) |`);
    // The walkthrough is a task too (D174 item 3): the task table points at it.
    const tasks = skill.slice(
      skill.indexOf("## What a page can do"),
      skill.indexOf("\n## ", skill.indexOf("## What a page can do") + 1),
    );
    expect(tasks).toContain("(references/walkthrough.md)");
  });

  it("shows only commands that exist, with flags they take", () => {
    const shown = MARKDOWN.flatMap((file) =>
      shownCommands(read(file)).map((command) => ({ file, command })),
    );
    expect(shown.length).toBeGreaterThan(30);
    const failing = shown.filter(({ command }) => !parsesAsShown(command));
    expect(failing).toEqual([]);
  });

  // D174 item 5: every command, flag, hook and tool the Skill names exists in the release it
  // ships with. The commands parse (above); this holds the rest to what the CLI's help, the
  // protocol, the bundled reference, the MCP server and `@mostra/react` have.
  it("names only flags, wait conditions, docs topics, tools and hooks this release has", () => {
    const topics = new Set(docsIndex().map((topic) => topic.topic));
    const problems = MARKDOWN.flatMap((file) => {
      const text = read(file);
      const shown = shownCommands(text).flatMap((command) => shownProblem(command, topics) ?? []);
      const tools = [
        ...prose(text).matchAll(/\b(?:artifact|state|live|docs)_[a-z]+(?:_[a-z]+)*\b/g),
      ]
        .map((match) => match[0])
        .filter((name) => !TOOLS.has(name))
        .map((name) => `${name} isn't one of Mostra's MCP tools`);
      const mostra = new Set(authorExports());
      const hooks = [...text.matchAll(/\buse[A-Z][A-Za-z0-9]*\b/g)]
        .map((match) => match[0])
        .filter((name) => !mostra.has(name) && !(name in OTHER_HOOKS))
        .map((name) => `${name} isn't a hook @mostra/react exports`);
      return [...flagProblems(text), ...shown, ...tools, ...hooks].map(
        (problem) => `${file}: ${problem}`,
      );
    });
    expect(problems).toEqual([]);
    // The walkthrough names its commands and tools (D174): a reference that named none would
    // pass this test by saying nothing.
    const walkthrough = read("references/walkthrough.md");
    expect(shownCommands(walkthrough).length).toBeGreaterThan(10);
    expect(prose(walkthrough)).toMatch(/\bartifact_open\b/);
    // A listed hook that no file names any more is stale.
    for (const name of Object.keys(OTHER_HOOKS))
      expect(ALL_TEXT, name).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it("documents every author-facing export of @mostra/react and @mostra/server", () => {
    const exported = authorExports();
    expect(exported).toEqual(
      expect.arrayContaining(["useField", "useAction", "secret", "useForm"]),
    );
    const missing = exported.filter(
      (name) => !(name in INTERNAL_EXPORTS) && !new RegExp(`\\b${name}\\b`).test(ALL_TEXT),
    );
    expect(missing).toEqual([]);
    // An exclusion that no longer names an export is stale.
    for (const name of Object.keys(INTERNAL_EXPORTS)) expect(exported).toContain(name);
  });

  it("documents every command an author uses", () => {
    const shown = new Set(
      MARKDOWN.flatMap((file) => shownCommands(read(file))).map((command) =>
        words(filled(command)).join(" "),
      ),
    );
    const missing = COMMANDS.map(commandName).filter(
      (name) =>
        !(name in COMMANDS_NOT_FOR_AUTHORS) &&
        ![...shown].some((command) => command === name || command.startsWith(`${name} `)),
    );
    expect(missing).toEqual([]);
    for (const name of Object.keys(COMMANDS_NOT_FOR_AUTHORS))
      expect(COMMANDS.map(commandName)).toContain(name);
  });

  it("gives every example the baseline stylesheet unchanged", () => {
    const studio = read("assets/studio.css");
    const examples = readdirSync(join(SKILL, "assets", "examples"));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const css = join(SKILL, "assets", "examples", example, "styles.css");
      expect(readFileSync(css, "utf8"), relative(SKILL, css)).toBe(studio);
    }
  });
});
