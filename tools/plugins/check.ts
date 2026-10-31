/**
 * Holds a built plugin to every harness's rules and to the directories' review rules (AX-10, D147,
 * WP-14). Each problem names the rule it breaks; an empty list is a plugin that loads in each
 * harness's documented layout and passes what the directories check first.
 */
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { walkTree } from "../lib/files.ts";
import type { PluginDefinition } from "./definition.ts";
import {
  CLAUDE_MARKETPLACE,
  CLAUDE_MCP,
  CLAUDE_PLUGIN,
  CODEX_MARKETPLACE,
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

/** Every path below `dir`, relative to it, directories included; links listed, never followed. */
function walk(dir: string): string[] {
  return walkTree(dir).map((entry) => entry.path);
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
  const paths = walk(dir).filter((path) => path !== ".git" && !path.startsWith(".git/"));
  const folded = new Map<string, string>();
  let files = 0;
  for (const path of paths) {
    const stat = lstatSync(join(dir, path));
    const name = path.split("/").at(-1) as string;
    if (stat.isSymbolicLink()) problems.push(`${path} is a link; every file must be a real copy`);
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
    if (!stat.isFile()) continue;
    files += 1;
    const kind = MEDIA.exec(name)?.[1]?.toLowerCase();
    if (kind === undefined && !isText(readFileSync(join(dir, path))))
      problems.push(`${path} is a binary file other than an image or a font`);
    if (kind === undefined && stat.size >= 256 * 1024) problems.push(`${path} is 256 KiB or more`);
    if (stat.size >= 5 * 1024 * 1024) problems.push(`${path} is 5 MiB or more`);
  }
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
  for (const path of paths) {
    if (!path.endsWith(".json") || path.startsWith("skills/")) continue;
    if (!lstatSync(join(dir, path)).isFile()) continue;
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(dir, path), "utf8"));
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
    const copy = join(dir, "skills", skill);
    const source = join(input.root, "skills", skill);
    if (!existsSync(join(copy, "SKILL.md"))) {
      problems.push(`skills/${skill}/SKILL.md is missing`);
      continue;
    }
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(
      readFileSync(join(copy, "SKILL.md"), "utf8"),
    );
    const name = frontmatter
      ? (parseYaml(frontmatter[1] as string) as { name?: unknown }).name
      : undefined;
    if (name !== skill)
      problems.push(`skills/${skill}/SKILL.md names ${String(name)}, not ${skill}`);
    const files = (root: string) =>
      walk(root)
        .filter((path) => statSync(join(root, path)).isFile())
        .sort();
    const expected = files(source);
    const actual = files(copy);
    if (expected.join("\n") !== actual.join("\n"))
      problems.push(`skills/${skill} doesn't hold exactly the files of the repository's Skill`);
    for (const path of expected) {
      if (!existsSync(join(copy, path))) continue;
      if (!readFileSync(join(copy, path)).equals(readFileSync(join(source, path))))
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
  for (const path of paths) {
    if (!/\.(md|json|ts|tsx|js|mjs|css|txt)$/.test(path) || !lstatSync(join(dir, path)).isFile())
      continue;
    const found = ENVIRONMENT_CREDENTIAL.exec(readFileSync(join(dir, path), "utf8"));
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
  for (const path of paths) {
    const file = join(dir, path);
    if (!lstatSync(file).isFile() || MEDIA.test(path)) continue;
    const found = COMMERCIAL.exec(readFileSync(file, "utf8"));
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
  return problems;
}

/** A PNG's width and height from its IHDR chunk, or undefined when it isn't a PNG. */
function pngSize(png: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) return undefined;
  if (png.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
