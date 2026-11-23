/**
 * Holds a built plugin to every harness's rules and to the directories' review rules (AX-10, D147,
 * WP-14). Each problem names the rule it breaks; an empty list is a plugin that loads in each
 * harness's documented layout and passes what the directories check first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { walkTree } from "../lib/files.ts";
import {
  CLAUDE_DIRECTORY,
  EXAMPLES,
  exampleNames,
  forClaudeDirectory,
  splitExampleMarkdown,
} from "./claude-directory.ts";
import type { PluginDefinition } from "./definition.ts";
import {
  CLAUDE_MARKETPLACE,
  CLAUDE_MCP,
  CLAUDE_PLUGIN,
  CODEX_MARKETPLACE,
  DIRECTORY_MCP,
  DIRECTORY_PLUGIN,
  GEMINI_EXTENSION,
} from "./manifests.ts";

const SCHEMAS = new URL("./schemas/agent-plugins-1.0.0/", import.meta.url);

/** What the checks compare the plugin against. */
export interface CheckInput {
  /** The release it must pin. */
  readonly version: string;
  /** The Mostra repository, whose Skill the plugin's copy must equal byte for byte. */
  readonly root: string;
  /** The release's telemetry endpoint, which the README must name when there is one. */
  readonly telemetryEndpoint: string;
}

function readJson(
  dir: string,
  path: string,
  problems: string[],
): Record<string, unknown> | undefined {
  const file = join(dir, path);
  if (!existsSync(file)) {
    problems.push(`${path} is missing`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    problems.push(`${path} isn't JSON: ${(error as Error).message}`);
    return undefined;
  }
}

/** Every string anywhere inside a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Whether a JSON value holds the key anywhere. */
function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(([name, inner]) => name === key || hasKey(inner, key));
  return false;
}

/** Names Claude Code refuses as passing for Anthropic's own plugins. */
function claudeNameProblem(name: string): string | undefined {
  const folded = name.toLowerCase().replace(/[-_.\s]+/g, "-");
  if (/^(claude|anthropic|anthropics|cc-plugin)-/.test(folded))
    return "starts with a reserved prefix";
  if (["claude", "anthropic", "anthropics", "claude-code", "claude-mods"].includes(folded))
    return "is reserved";
  if (/official/.test(folded) && /claude|anthropic/.test(folded)) return "claims to be official";
  return undefined;
}

/**
 * What OpenAI's directory refuses inside a plugin: plans, upgrades, trials (D147). Phrases, not
 * words, since the Skill speaks of event subscriptions and upgrades of packages.
 */
const COMMERCIAL =
  /\b(upgrade (to|your)|pricing|free trial|trial (plan|version|period)|(pro|paid|premium|subscription|business) plans?|subscribe (to|now)|plans? (and|&) pricing)\b/i;

/** Package launchers, and how each names an exact version of the package it runs. */
const LAUNCHERS: Record<string, RegExp> = {
  npx: /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
  bunx: /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
  uvx: /^[A-Za-z0-9][\w.-]*==\d+(\.\d+)*([a-z]+\d*)?$/,
};
/** A command inside the plugin itself, which the plugin's own version pins. */
const BUNDLED_COMMAND =
  /^(\.\/|\$\{(PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|extensionPath)\})/;

/**
 * Whether a local server's launch runs an exact version (Anthropic blocks any launcher that
 * doesn't; WP-14's Opus review, finding 8): a package launcher whose package names one, or a
 * program the plugin carries. A bare command runs whatever the machine has.
 */
function launchProblem(command: string, args: readonly string[]): string | undefined {
  const launcher = LAUNCHERS[command];
  if (launcher === undefined)
    return BUNDLED_COMMAND.test(command)
      ? undefined
      : `runs ${command}, which no version pins: launch an exact package version or a program the plugin carries`;
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const from = args.indexOf("--from");
  const pkg = command === "uvx" && from >= 0 ? args[from + 1] : operands[0];
  if (pkg === undefined) return `runs ${command} with no package`;
  return launcher.test(pkg) ? undefined : `runs ${command} ${pkg}, which isn't an exact version`;
}

/** Every server a manifest declares, by name. */
function serversOf(
  manifest: Record<string, unknown> | undefined,
): [string, Record<string, unknown>][] {
  const servers = manifest?.["mcpServers"];
  if (servers === null || typeof servers !== "object") return [];
  return Object.entries(servers as Record<string, Record<string, unknown>>);
}

/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Files operating systems leave behind, which Anthropic's validator blocks. */
const SYSTEM_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX"]);
/** Package-manager files that set a registry or source, blocked beside a package launcher. */
const PACKAGE_SOURCES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "bunfig.toml",
  "uv.toml",
  "pip.conf",
]);
/** Images and fonts, the only binary files the validator reads. */
const MEDIA = /\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i;
/**
 * A credential read from the user's environment (`$GITHUB_TOKEN`): held by Anthropic's scan even
 * in an example, since it may be sent somewhere.
 */
const ENVIRONMENT_CREDENTIAL =
  /\$\{?[A-Z][A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)\b/;

/** Whether a file is text: UTF-8 without NUL bytes. */
function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function checkPlugin(
  dir: string,
  definition: PluginDefinition,
  input: CheckInput,
): string[] {
  const problems: string[] = [];
  const { version } = input;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = (name: string) =>
    JSON.parse(readFileSync(new URL(`${name}.schema.json`, SCHEMAS), "utf8")) as object;
  const validatePlugin = ajv.compile(schema("plugin"));
  const validateMcp = ajv.compile(schema("mcp"));

  // Real files only: no links, nothing a harness or a scan would skip or follow out; files
  // Anthropic's validator reads (its pre-submission checklist, VERIFIED_FACTS WP-14).
  // Each file is read once, here; every later rule judges these bytes (no check-then-read).
  const entries = walkTree(dir).filter(
    (entry) => entry.path !== ".git" && !entry.path.startsWith(".git/"),
  );
  const paths = entries.map((entry) => entry.path);
  const contents = new Map<string, Buffer>();
  const folded = new Map<string, string>();
  for (const { path, kind: entryKind } of entries) {
    const name = path.split("/").at(-1) as string;
    if (entryKind === "link") problems.push(`${path} is a link; every file must be a real copy`);
    if (/[:*?"<>|\\]/.test(path) || /[. ]$/.test(name) || WINDOWS_DEVICE.test(name))
      problems.push(`${path} has a name Windows or macOS refuses`);
    const other = folded.get(path.toLowerCase());
    if (other !== undefined) problems.push(`${path} and ${other} differ only in case`);
    folded.set(path.toLowerCase(), path);
    if (SYSTEM_FILES.has(name)) problems.push(`${path} is an operating system's file; remove it`);
    if (PACKAGE_SOURCES.has(name))
      problems.push(
        `${path} sets a package source, which Anthropic's scan blocks beside a launcher`,
      );
    if (entryKind !== "file") continue;
    const bytes = readFileSync(join(dir, path));
    contents.set(path, bytes);
    const kind = MEDIA.exec(name)?.[1]?.toLowerCase();
    if (kind === undefined && !isText(bytes))
      problems.push(`${path} is a binary file other than an image or a font`);
    if (kind === undefined && bytes.length >= 256 * 1024)
      problems.push(`${path} is 256 KiB or more`);
    if (bytes.length >= 5 * 1024 * 1024) problems.push(`${path} is 5 MiB or more`);
  }
  const files = contents.size;
  if (files > 512) problems.push(`the plugin has ${files} files; Anthropic's validator reads 512`);
  if (existsSync(join(dir, "package.json")))
    problems.push("package.json at the root: a lockfile beside it installs packages on install");
  if (existsSync(join(dir, ".gitattributes")))
    problems.push(".gitattributes can stop Anthropic's validator; the plugin has none");
  if (paths.some((path) => path === "hooks" || path.startsWith("hooks/")))
    problems.push("the plugin has a hooks directory; it must have no hooks (D147)");

  // Agent Plugins 1.0.
  const portable = readJson(dir, "plugin.json", problems);
  if (portable && !validatePlugin(portable))
    problems.push(
      `plugin.json breaks the Agent Plugins schema: ${ajv.errorsText(validatePlugin.errors)}`,
    );
  const mcp = existsSync(join(dir, "mcp.json")) ? readJson(dir, "mcp.json", problems) : undefined;
  if (mcp && !validateMcp(mcp))
    problems.push(
      `mcp.json breaks the Agent Plugins MCP schema: ${ajv.errorsText(validateMcp.errors)}`,
    );

  // Claude Code, Gemini CLI and the marketplaces, each held to its closed shape (manifests.ts).
  const claude = readJson(dir, ".claude-plugin/plugin.json", problems);
  if (claude) {
    const reserved = claudeNameProblem(String(claude["name"]));
    if (reserved) problems.push(`.claude-plugin/plugin.json's name ${reserved}`);
  }
  const claudeMarket = readJson(dir, ".claude-plugin/marketplace.json", problems);
  const codexMarket = readJson(dir, ".agents/plugins/marketplace.json", problems);
  const gemini = readJson(dir, "gemini-extension.json", problems);
  const claudeMcp = existsSync(join(dir, ".mcp.json"))
    ? readJson(dir, ".mcp.json", problems)
    : undefined;
  const shapes = [
    [".claude-plugin/plugin.json", claude, CLAUDE_PLUGIN],
    [".claude-plugin/marketplace.json", claudeMarket, CLAUDE_MARKETPLACE],
    [".agents/plugins/marketplace.json", codexMarket, CODEX_MARKETPLACE],
    ["gemini-extension.json", gemini, GEMINI_EXTENSION],
    [".mcp.json", claudeMcp, CLAUDE_MCP],
  ] as const;
  for (const [path, manifest, shape] of shapes) {
    if (!manifest) continue;
    const validate = ajv.compile(shape);
    if (!validate(manifest))
      problems.push(`${path} breaks its harness's shape: ${ajv.errorsText(validate.errors)}`);
  }

  // One name and one version everywhere, the release's.
  const named = [
    ["plugin.json", portable],
    [".claude-plugin/plugin.json", claude],
    ["gemini-extension.json", gemini],
  ] as const;
  for (const [path, manifest] of named) {
    if (!manifest) continue;
    if (manifest["name"] !== definition.name)
      problems.push(`${path} names ${String(manifest["name"])}, not ${definition.name}`);
    if (manifest["version"] !== version)
      problems.push(`${path} is at ${String(manifest["version"])}, not the release's ${version}`);
  }
  for (const [path, market] of [
    [".claude-plugin/marketplace.json", claudeMarket],
    [".agents/plugins/marketplace.json", codexMarket],
  ] as const) {
    const entry = (market?.["plugins"] as Record<string, unknown>[] | undefined)?.[0];
    if (entry && entry["name"] !== definition.name)
      problems.push(`${path} lists ${String(entry["name"])}, not ${definition.name}`);
  }

  // No hooks anywhere a harness reads one (D147): no JSON file of the plugin outside its Skill
  // holds a `hooks` key, inline marketplace entries and server configurations included.
  for (const [path, bytes] of contents) {
    if (!path.endsWith(".json") || path.startsWith("skills/")) continue;
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue; // reported where the file is read as a manifest
    }
    if (hasKey(value, "hooks")) problems.push(`${path} declares hooks; D147 allows none`);
  }

  // Every server's launch runs an exact version, Mostra's this release's; every remote is HTTPS.
  for (const [path, manifest] of [
    ["mcp.json", mcp],
    [".mcp.json", claudeMcp],
    ["gemini-extension.json", gemini],
  ] as const) {
    for (const [server, config] of serversOf(manifest)) {
      if (typeof config["command"] === "string") {
        const args = Array.isArray(config["args"]) ? (config["args"] as string[]) : [];
        const problem = launchProblem(config["command"], args);
        if (problem) problems.push(`${path}'s server ${server} ${problem}`);
      }
      for (const field of ["url", "httpUrl"])
        if (typeof config[field] === "string" && !(config[field] as string).startsWith("https://"))
          problems.push(`${path}'s server ${server} isn't HTTPS`);
    }
  }
  for (const text of [portable, mcp, claude, gemini, claudeMcp].flatMap(strings)) {
    for (const match of text.matchAll(/@mostra\/cli(@[^\s"]*)?/g)) {
      if (match[1] !== `@${version}`)
        problems.push(`"${text}" launches @mostra/cli${match[1] ?? ""}, not @${version}`);
    }
  }

  // The features decide the MCP servers, in every harness alike.
  const { localMcp, remoteMcp } = definition.features;
  const wantsServers = localMcp.enabled || remoteMcp.enabled;
  const unproven = (["darwin", "linux", "win32"] as const).filter(
    (system) => !localMcp.verifiedOn.includes(system),
  );
  if (localMcp.enabled && unproven.length > 0)
    problems.push(
      `features.localMcp is on but its launch wasn't started from every harness on ${unproven.join(", ")} (docs/agents/check-harness-plugins.md, step 3)`,
    );
  // A server the plugin starts runs on the person's behalf: embedded use, which sends nothing
  // whatever their CLI's telemetry setting (D148). The marker is the launch's own argument, since
  // Muse Code refuses `env` in a plugin's MCP entry (D162 item 5, D164 item 4).
  if (localMcp.enabled && (localMcp.args[0] !== "mcp" || !localMcp.args.includes("--embedded")))
    problems.push(
      `features.localMcp launches \`mostra ${localMcp.args.join(" ")}\`, not \`mostra mcp --embedded\` (D148: a plugin's server sends no telemetry)`,
    );
  const serverFiles = [
    ["mcp.json", existsSync(join(dir, "mcp.json"))],
    [".mcp.json", existsSync(join(dir, ".mcp.json"))],
    ["gemini-extension.json's mcpServers", gemini?.["mcpServers"] !== undefined],
  ] as const;
  for (const [what, present] of serverFiles) {
    if (present && !wantsServers) problems.push(`${what} declares a server no feature turns on`);
    if (!present && wantsServers) problems.push(`${what} is missing while a server feature is on`);
  }

  // The Skill: an Agent Skill whose name is its directory, byte for byte the repository's.
  for (const skill of definition.skills) {
    const source = join(input.root, "skills", skill);
    const main = contents.get(`skills/${skill}/SKILL.md`);
    if (main === undefined) {
      problems.push(`skills/${skill}/SKILL.md is missing`);
      continue;
    }
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(main.toString("utf8"));
    const name = frontmatter
      ? (parseYaml(frontmatter[1] as string) as { name?: unknown }).name
      : undefined;
    if (name !== skill)
      problems.push(`skills/${skill}/SKILL.md names ${String(name)}, not ${skill}`);
    // The copy's bytes are the ones read above; the source's are read once each.
    const prefix = `skills/${skill}/`;
    const actual = [...contents.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort();
    const expected = walkTree(source)
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path);
    if (expected.join("\n") !== actual.join("\n"))
      problems.push(`skills/${skill} doesn't hold exactly the files of the repository's Skill`);
    for (const path of expected) {
      const copied = contents.get(`${prefix}${path}`);
      if (copied !== undefined && !copied.equals(readFileSync(join(source, path))))
        problems.push(`skills/${skill}/${path} differs from the repository's`);
    }
  }

  // The README discloses everything the plugin runs, sends or fetches (D147).
  const readme = existsSync(join(dir, "README.md"))
    ? readFileSync(join(dir, "README.md"), "utf8")
    : "";
  const prose = readme.replace(/```[\s\S]*?```/g, "");
  if (prose.split(/\s+/).filter(Boolean).length < 40)
    problems.push("README.md has under 40 words outside code blocks");
  for (const [path, bytes] of contents) {
    if (!/\.(md|json|ts|tsx|js|mjs|css|txt)$/.test(path)) continue;
    const found = ENVIRONMENT_CREDENTIAL.exec(bytes.toString("utf8"));
    if (found)
      problems.push(`${path} reads ${found[0]} from the environment; Anthropic's scan holds that`);
  }
  const destinations = [
    "registry.npmjs.org",
    `github.com/mostra-dev/mostra/releases/download/v${version}/`,
    "cdn.playwright.dev",
    "trycloudflare.com",
    "Tailscale",
    ...(input.telemetryEndpoint === "" ? [] : [input.telemetryEndpoint]),
    ...(remoteMcp.enabled && remoteMcp.url ? [remoteMcp.url] : []),
    ...(remoteMcp.enabled && remoteMcp.privacyPolicyUrl ? [remoteMcp.privacyPolicyUrl] : []),
  ];
  for (const destination of destinations)
    if (!readme.includes(destination)) problems.push(`README.md doesn't disclose ${destination}`);
  if (!/telemetry off/.test(readme) || !/DO_NOT_TRACK=1/.test(readme))
    problems.push("README.md doesn't say how to turn usage data off");
  if (input.telemetryEndpoint === "" && !/sends no usage data/.test(readme))
    problems.push("README.md doesn't say this release sends no usage data");

  // OpenAI's directory: no plans, upgrades or trials anywhere in the plugin (D147), its Skill and
  // its marketplaces included.
  for (const [path, bytes] of contents) {
    if (MEDIA.test(path)) continue;
    const found = COMMERCIAL.exec(bytes.toString("utf8"));
    if (found)
      problems.push(`${path} says "${found[0]}"; the plugin shows no plans, upgrades or trials`);
  }

  // The listing icon, where there is one: a square PNG of 512 to 2048 px under 2 MB (Anthropic).
  if (definition.icon !== undefined) {
    for (const path of [".claude-plugin/icon.png", "assets/icon.png"]) {
      const file = join(dir, path);
      if (!existsSync(file)) {
        problems.push(`${path} is missing while the definition names an icon`);
        continue;
      }
      const png = readFileSync(file);
      const size = pngSize(png);
      if (size === undefined) problems.push(`${path} isn't a PNG`);
      else if (size.width !== size.height || size.width < 512 || size.width > 2048)
        problems.push(
          `${path} is ${size.width}×${size.height}; the icon is square, 512 to 2048 px`,
        );
      if (png.length >= 2 * 1024 * 1024) problems.push(`${path} is 2 MB or more`);
    }
  }

  // Trip-wire for WP-15: once the CLI has `mostra mcp`, the plugin starts it.
  const cliReference = join(input.root, "docs", "reference", "cli.md");
  if (
    existsSync(cliReference) &&
    /^## mostra mcp\b/m.test(readFileSync(cliReference, "utf8")) &&
    !localMcp.enabled
  )
    problems.push(
      "the CLI has `mostra mcp` but the plugin doesn't start it: WP-15 turns on features.localMcp in tools/plugins/definition.ts",
    );

  // Claude's directory's folder (MT-07), held to the directory's own rules beside these.
  const folder = join(dir, CLAUDE_DIRECTORY);
  if (definition.features.claudeDirectory.enabled)
    problems.push(...checkClaudeDirectory(folder, definition, input));
  else if (existsSync(folder))
    problems.push(`${CLAUDE_DIRECTORY}/ is there while features.claudeDirectory is off`);
  return problems;
}

/** A PNG's width and height from its IHDR chunk, or undefined when it isn't a PNG. */
function pngSize(png: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) return undefined;
  if (png.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------------------------
// Claude's plugin directory's folder (MT-07)

/** Where each directory rule was read. */
const PORTAL_REPORT =
  "claude.ai/directory/manage, the directory's report on the 0.18.0 submission (VERIFIED_FACTS, MT-07)";
const CHECKLIST = "claude.com/docs/plugins/pre-submission-checklist";
const MANIFEST_REFERENCE = "code.claude.com/docs/en/plugins/manifest-reference";

/** A folder the directory's rules judge: every entry, and every file's bytes, read once. */
interface DirectoryFolder {
  readonly entries: readonly { readonly path: string; readonly kind: string }[];
  readonly files: ReadonlyMap<string, Buffer>;
  readonly definition: PluginDefinition;
  readonly input: CheckInput;
}

/** One of the directory's rules: what it holds, where it was read and when, and its check. */
interface DirectoryRule {
  readonly rule: string;
  readonly source: string;
  readonly read: string;
  readonly check: (folder: DirectoryFolder) => string[];
}

/** Text, by extension (or none, as `LICENSE` and `NOTICE`): Markdown, plain text, JSON, YAML. */
const DIRECTORY_TEXT = /(^|\/)[^/.]+$|\.(md|txt|json|ya?ml)$/i;
/** Images, by extension, each with the bytes its format starts with. */
const DIRECTORY_IMAGES: readonly (readonly [RegExp, (bytes: Buffer) => boolean])[] = [
  [
    /\.png$/i,
    (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ],
  [/\.jpe?g$/i, (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  [/\.gif$/i, (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString("latin1"))],
  [
    /\.webp$/i,
    (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  ],
  [/\.ico$/i, (b) => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))],
];
/** Package managers' manifests, lockfiles and source settings. */
const PACKAGE_MANAGER_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "requirements.txt",
  "pyproject.toml",
  "uv.lock",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "Gemfile",
  "Gemfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  ".pypirc",
  ...PACKAGE_SOURCES,
]);
/** Directories that hold components the folder carries none of. */
const COMPONENT_DIRECTORIES = ["bin", "hooks", "commands", "agents", "output-styles", "monitors"];

/** Every relative link target of a Markdown text (inline links and images), without its anchor. */
function markdownLinks(text: string): string[] {
  const prose = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
  const inline = [...prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)];
  const references = [...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];
  return [...inline, ...references]
    .map((match) => match[1] as string)
    .filter((target) => !/^([a-z][a-z0-9+.-]*:|#)/i.test(target))
    .map((target) => {
      const path = target.split("#")[0] as string;
      try {
        return decodeURI(path);
      } catch {
        return path;
      }
    });
}

/** The repository's Skill, each file by its path below `skills/<name>/`. */
function repositorySkill(root: string, name: string): Map<string, Buffer> {
  const source = join(root, "skills", name);
  return new Map(
    walkTree(source)
      .filter((entry) => entry.kind === "file")
      .map((entry) => [entry.path, readFileSync(join(source, entry.path))] as const),
  );
}

/** A JSON file's object, or undefined when it's absent or not a JSON object. */
function parseJson(bytes: Buffer | undefined): Record<string, unknown> | undefined {
  if (bytes === undefined) return undefined;
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Closed shapes, compiled once. */
const shapes = new Ajv2020({ allErrors: true, strict: false });
const directoryPlugin = shapes.compile(DIRECTORY_PLUGIN);
const directoryMcp = shapes.compile(DIRECTORY_MCP);
const directoryMarketplace = shapes.compile(CLAUDE_MARKETPLACE);

/** The Skill rule: the folder's copy is `forClaudeDirectory` of the repository's, exactly. */
function skillProblems({ files, definition, input }: DirectoryFolder): string[] {
  const { compatibility } = definition.features.claudeDirectory;
  // No skill but the definition's: an indexer would list another one beside the Skill.
  const others = new Set(
    [...files.keys()]
      .map((path) => /^skills\/([^/]+)\//.exec(path)?.[1])
      .filter((name): name is string => name !== undefined && !definition.skills.includes(name)),
  );
  const extra = [...others].map(
    (name) => `skills/${name}/ is a skill the definition doesn't carry`,
  );
  return extra.concat(
    definition.skills.flatMap((name) => {
      const prefix = `skills/${name}/`;
      const source = repositorySkill(input.root, name);
      const expected = forClaudeDirectory(source, compatibility);
      const actual = new Map(
        [...files]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, bytes]) => [path.slice(prefix.length), bytes] as const),
      );
      const problems: string[] = [];
      if ([...expected.keys()].join("\n") !== [...actual.keys()].sort().join("\n"))
        problems.push(
          `${prefix} doesn't hold exactly the repository's Skill with its examples as Markdown`,
        );
      for (const [path, bytes] of expected) {
        const copied = actual.get(path);
        if (copied !== undefined && !copied.equals(bytes))
          problems.push(
            `${prefix}${path} differs from the repository's Skill as the folder has it`,
          );
      }
      // Each Markdown example gives back its source example's files, byte for byte.
      for (const example of exampleNames(source)) {
        const markdown = actual.get(`${EXAMPLES}/${example}.md`);
        if (markdown === undefined) continue;
        const own = `${EXAMPLES}/${example}/`;
        const want = [...source].filter(([path]) => path.startsWith(own));
        try {
          const back = splitExampleMarkdown(markdown.toString("utf8"));
          if (back.size !== want.length)
            problems.push(`${prefix}${EXAMPLES}/${example}.md doesn't hold the example's files`);
          for (const [path, bytes] of want) {
            const file = path.slice(own.length);
            if (back.get(file) !== bytes.toString("utf8"))
              problems.push(`${prefix}${EXAMPLES}/${example}.md doesn't give back ${file} exactly`);
          }
        } catch (error) {
          problems.push(`${prefix}${EXAMPLES}/${example}.md: ${(error as Error).message}`);
        }
      }
      const main = actual.get("SKILL.md")?.toString("utf8") ?? "";
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(main);
      const field = frontmatter
        ? (parseYaml(frontmatter[1] as string) as { compatibility?: unknown }).compatibility
        : undefined;
      if (field !== compatibility)
        problems.push(`${prefix}SKILL.md's compatibility isn't the folder's`);
      if (typeof field === "string" && field.length > 500)
        problems.push(`${prefix}SKILL.md's compatibility is over 500 characters`);
      return problems;
    }),
  );
}

const DIRECTORY_RULES: readonly DirectoryRule[] = [
  {
    rule: "regular files and folders only: no symbolic link, submodule or other entry",
    source: CHECKLIST,
    read: "2026-11-22",
    check: ({ entries }) =>
      entries.flatMap(({ path, kind }) =>
        kind === "link" || kind === "other" ? [`${path} isn't a regular file or folder`] : [],
      ),
  },
  {
    rule: "every file is UTF-8 Markdown, plain text, JSON or YAML, or a PNG, JPEG, GIF, WebP or ICO image",
    source: PORTAL_REPORT,
    read: "2026-11-21",
    check: ({ files }) =>
      [...files].flatMap(([path, bytes]) => {
        const image = DIRECTORY_IMAGES.find(([pattern]) => pattern.test(path));
        if (image) return image[1](bytes) ? [] : [`${path} isn't the image its name says`];
        if (!DIRECTORY_TEXT.test(path))
          return [`${path} isn't Markdown, plain text, JSON, YAML or an image the directory takes`];
        return isText(bytes) ? [] : [`${path} isn't UTF-8 text`];
      }),
  },
  {
    rule: "no file starts with #!",
    source: PORTAL_REPORT,
    read: "2026-11-21",
    check: ({ files }) =>
      [...files].flatMap(([path, bytes]) =>
        bytes.subarray(0, 2).toString("latin1") === "#!" ? [`${path} starts with #!`] : [],
      ),
  },
  {
    rule: "no package manager's manifest, lockfile or source setting",
    source: `${PORTAL_REPORT}; ${CHECKLIST}`,
    read: "2026-11-22",
    check: ({ entries }) =>
      entries.flatMap(({ path }) =>
        PACKAGE_MANAGER_FILES.has(path.split("/").at(-1) as string)
          ? [`${path} is a package manager's file`]
          : [],
      ),
  },
  {
    rule: "one .claude-plugin/ and one .mcp.json, at the folder's root",
    source: PORTAL_REPORT,
    read: "2026-11-21",
    check: ({ entries }) =>
      entries.flatMap(({ path }) => {
        const name = path.split("/").at(-1) as string;
        if (name === ".claude-plugin" && path !== ".claude-plugin")
          return [`${path} is a second .claude-plugin folder`];
        if (name === ".mcp.json" && path !== ".mcp.json") return [`${path} is a second .mcp.json`];
        if (name === "mcp.json") return [`${path} declares servers outside .mcp.json`];
        return [];
      }),
  },
  {
    rule: "no .svg but the manifest's icon",
    source: PORTAL_REPORT,
    read: "2026-11-21",
    check: ({ files }) => {
      const manifest = parseJson(files.get(".claude-plugin/plugin.json"));
      const icon = String(manifest?.["icon"] ?? "").replace(/^\.\//, "");
      return [...files.keys()].flatMap((path) =>
        path.toLowerCase().endsWith(".svg") && path !== icon
          ? [`${path} is an .svg other than the icon`]
          : [],
      );
    },
  },
  {
    rule: ".mcp.json declares only servers at an https:// URL, none that starts a program",
    source: `${PORTAL_REPORT}; ${CHECKLIST}`,
    read: "2026-11-22",
    check: ({ files, definition }) => {
      const mcp = files.get(".mcp.json");
      const remote = definition.features.remoteMcp;
      if (mcp === undefined)
        return remote.enabled ? [".mcp.json is missing while features.remoteMcp is on"] : [];
      if (!remote.enabled) return [".mcp.json declares a server no feature turns on"];
      const value = parseJson(mcp);
      if (value === undefined) return [".mcp.json isn't a JSON object"];
      const servers = serversOf(value);
      const problems = servers.flatMap(([server, config]) =>
        "command" in config ? [`.mcp.json's server ${server} starts a program`] : [],
      );
      if (!directoryMcp(value))
        problems.push(`.mcp.json breaks its shape: ${shapes.errorsText(directoryMcp.errors)}`);
      if (!servers.some(([, config]) => config["url"] === remote.url))
        problems.push(`.mcp.json doesn't name the remote server ${String(remote.url)}`);
      return problems;
    },
  },
  {
    rule: "the manifest holds only the listing's documented fields, and no component",
    source: `${MANIFEST_REFERENCE}; ${PORTAL_REPORT}`,
    read: "2026-11-22",
    check: ({ files, definition, input }) => {
      const manifest = parseJson(files.get(".claude-plugin/plugin.json"));
      if (manifest === undefined) return [".claude-plugin/plugin.json is missing or isn't JSON"];
      const problems: string[] = [];
      if (!directoryPlugin(manifest))
        problems.push(
          `.claude-plugin/plugin.json breaks its shape: ${shapes.errorsText(directoryPlugin.errors)}`,
        );
      if (manifest["name"] !== definition.name)
        problems.push(`.claude-plugin/plugin.json names ${String(manifest["name"])}`);
      if (manifest["version"] !== input.version)
        problems.push(
          `.claude-plugin/plugin.json is at ${String(manifest["version"])}, not ${input.version}`,
        );
      const icon = manifest["icon"];
      if (typeof icon === "string" && !files.has(icon.replace(/^\.\//, "")))
        problems.push(`.claude-plugin/plugin.json's icon ${icon} isn't in the folder`);
      if (definition.icon !== undefined && icon === undefined)
        problems.push(
          ".claude-plugin/plugin.json names no icon, which the listing takes from its first submission",
        );
      const market = parseJson(files.get(".claude-plugin/marketplace.json"));
      if (market === undefined)
        problems.push(".claude-plugin/marketplace.json is missing or isn't JSON");
      else if (!directoryMarketplace(market))
        problems.push(
          `.claude-plugin/marketplace.json breaks its shape: ${shapes.errorsText(directoryMarketplace.errors)}`,
        );
      return problems;
    },
  },
  {
    rule: "nothing starts a program, sets where packages come from or reads an environment variable",
    source: `${PORTAL_REPORT}; ${CHECKLIST}; ${MANIFEST_REFERENCE}`,
    read: "2026-11-22",
    check: ({ entries, files }) => [
      ...entries.flatMap(({ path, kind }) =>
        kind === "directory" && COMPONENT_DIRECTORIES.includes(path)
          ? [`${path}/ is a folder of components the folder carries none of`]
          : [],
      ),
      ...[...files].flatMap(([path, bytes]) => {
        if (!path.endsWith(".json")) return [];
        const problems: string[] = [];
        const value = parseJson(bytes);
        if (value !== undefined && hasKey(value, "hooks")) problems.push(`${path} declares hooks`);
        if (bytes.toString("utf8").includes("${")) problems.push(`${path} reads a variable`);
        return problems;
      }),
    ],
  },
  {
    rule: "every relative link in a Markdown file resolves to a file or folder inside the folder",
    source: `${CHECKLIST} (people who install a plugin get only its folder)`,
    read: "2026-11-22",
    check: ({ entries, files }) => {
      const present = new Set(entries.map((entry) => entry.path));
      return [...files].flatMap(([path, bytes]) => {
        if (!path.endsWith(".md")) return [];
        const base = posix.dirname(path);
        return markdownLinks(bytes.toString("utf8")).flatMap((target) => {
          if (posix.isAbsolute(target)) return [`${path} links to ${target}, outside the folder`];
          const resolved = posix.normalize(posix.join(base, target)).replace(/\/$/, "");
          if (resolved === ".." || resolved.startsWith("../"))
            return [`${path} links to ${target}, outside the folder`];
          return present.has(resolved)
            ? []
            : [`${path} links to ${target}, which the folder lacks`];
        });
      });
    },
  },
  {
    rule: "the Skill is the repository's, but for its examples as Markdown, their links and its compatibility field",
    source: "MT-07's specification",
    read: "2026-11-22",
    check: skillProblems,
  },
  {
    rule: "a README of at least 40 words outside code blocks that discloses the remote server, its sign-in and its privacy policy, and a LICENSE",
    source: CHECKLIST,
    read: "2026-11-22",
    check: ({ files, definition }) => {
      const problems: string[] = [];
      const readme = files.get("README.md")?.toString("utf8");
      if (readme === undefined) problems.push("README.md is missing");
      else {
        const prose = readme.replace(/```[\s\S]*?```/g, "");
        if (prose.split(/\s+/).filter(Boolean).length < 40)
          problems.push("README.md has under 40 words outside code blocks");
        const { remoteMcp } = definition.features;
        if (remoteMcp.enabled) {
          for (const destination of [remoteMcp.url, remoteMcp.privacyPolicyUrl])
            if (destination !== undefined && !readme.includes(destination))
              problems.push(`README.md doesn't disclose ${destination}`);
          if (!/sign in/i.test(readme))
            problems.push("README.md doesn't say how the server signs in");
        }
      }
      if (!files.has("LICENSE")) problems.push("LICENSE is missing");
      return problems;
    },
  },
];

/** The directory's rules as the check holds them: each with its source and the day it was read. */
export function claudeDirectoryRules(): readonly {
  readonly rule: string;
  readonly source: string;
  readonly read: string;
}[] {
  return DIRECTORY_RULES.map(({ rule, source, read }) => ({ rule, source, read }));
}

/**
 * Holds the folder `claude-directory/` to the rules Claude's plugin directory applies to a plugin
 * from an organization that isn't verified (MT-07). Each problem names the path it found and the
 * rule it breaks, with that rule's source and the day it was read; an empty list is a folder with
 * nothing the directory blocks, as far as a repository can tell offline. The portal's own
 * validation goes further (docs/agents/check-harness-plugins.md).
 */
export function checkClaudeDirectory(
  dir: string,
  definition: PluginDefinition,
  input: CheckInput,
): string[] {
  if (!existsSync(dir))
    return [`${CLAUDE_DIRECTORY}/ is missing while features.claudeDirectory is on`];
  const entries = walkTree(dir);
  const files = new Map(
    entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => [entry.path, readFileSync(join(dir, entry.path))] as const),
  );
  const folder: DirectoryFolder = { entries, files, definition, input };
  const problems: string[] = [];
  for (const rule of DIRECTORY_RULES)
    for (const problem of rule.check(folder))
      problems.push(
        `${CLAUDE_DIRECTORY}/${problem} (the directory's rule: ${rule.rule}; ${rule.source}, read ${rule.read})`,
      );
  return problems;
}
