/**
 * Builds the harness plugin's repository from its one definition (AX-10, D147, WP-14): every
 * harness's manifest beside one real copy of the Skill, the README that discloses everything the
 * plugin runs, sends or fetches, and the license. Pure: it reads the repository and returns the
 * tree; `writeTree` puts it on disk.
 *
 * The harnesses and what each reads (VERIFIED_FACTS, WP-14):
 * - Agent Plugins 1.0 (`plugin.json`, `mcp.json`, `skills/`): Codex and the ChatGPT desktop app
 *   (with `extensions.com.openai`), GitHub Copilot, Cursor, VS Code, Muse Code and other clients.
 * - Claude Code (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/`), whose manifest Grok
 *   Build's marketplace also takes.
 * - Gemini CLI (`gemini-extension.json` with `mcpServers`, `skills/`).
 * - Marketplaces: `.claude-plugin/marketplace.json` (Claude Code; Copilot CLI reads it too) and
 *   `.agents/plugins/marketplace.json` (Codex and the ChatGPT desktop app).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { walkTree } from "../lib/files.ts";
import { isReleaseVersion } from "../lib/release-version.ts";
import type { PluginDefinition } from "./definition.ts";
import { readme } from "./readme.ts";

/** The schema URLs of Agent Plugins 1.0. */
export const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** What a build takes besides the definition. */
export interface BuildInput {
  /** The Mostra repository: the Skill, LICENSE and NOTICE are read from it. */
  readonly root: string;
  /** The release the plugin pins (`@mostra/cli@<version>`) and carries as its version. */
  readonly version: string;
  /**
   * The standalone CLI's telemetry endpoint in this release, or empty when it has none (D140 item
   * 7): the same value the release bakes into the CLI, so the README discloses what is true.
   */
  readonly telemetryEndpoint: string;
}

/** The plugin's repository: path to contents, every file a real file. */
export type PluginTree = Map<string, string | Buffer>;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every file below `dir`, relative to it, sorted; a link is refused: the Skill holds real files. */
function filesBelow(dir: string): string[] {
  return walkTree(dir).flatMap((entry) => {
    if (entry.kind === "link")
      throw new Error(`${join(dir, entry.path)} is a link: the Skill holds real files`);
    return entry.kind === "file" ? [entry.path] : [];
  });
}

/** The local MCP server's launch, pinned to the release, when the feature is on. */
function localServer(definition: PluginDefinition, version: string) {
  const { localMcp } = definition.features;
  if (!localMcp.enabled) return undefined;
  return { command: "npx", args: ["-y", `@mostra/cli@${version}`, ...localMcp.args] };
}

/** The remote MCP server's URL and privacy policy, when the feature is on. */
function remoteServer(definition: PluginDefinition): { url: string; privacy: string } | undefined {
  const { remoteMcp } = definition.features;
  if (!remoteMcp.enabled) return undefined;
  if (remoteMcp.url === undefined || !remoteMcp.url.startsWith("https://"))
    throw new Error("remoteMcp is on without an https:// url");
  if (
    remoteMcp.privacyPolicyUrl === undefined ||
    !remoteMcp.privacyPolicyUrl.startsWith("https://")
  )
    throw new Error("remoteMcp is on without an https:// privacyPolicyUrl");
  return { url: remoteMcp.url, privacy: remoteMcp.privacyPolicyUrl };
}

/** Where the icon goes in the plugin, for Claude Code's listing and OpenAI's interface. */
export const ICON_PATHS = [".claude-plugin/icon.png", "assets/icon.png"] as const;

/** Builds the plugin's repository tree. */
export function buildPlugin(definition: PluginDefinition, input: BuildInput): PluginTree {
  const { version } = input;
  if (!isReleaseVersion(version)) throw new Error(`"${version}" isn't a release version`);
  const tree: PluginTree = new Map();
  const local = localServer(definition, version);
  const remote = remoteServer(definition);
  const author = { name: definition.author.name, url: definition.author.url };

  // Agent Plugins 1.0: the portable manifest, OpenAI's settings in its extension object.
  tree.set(
    "plugin.json",
    json({
      $schema: AGENT_PLUGINS_SCHEMA,
      name: definition.name,
      version,
      description: definition.description,
      author,
      homepage: definition.homepage,
      repository: definition.repository,
      license: definition.license,
      keywords: definition.keywords,
      extensions: {
        "com.openai": {
          // The Skill runs `mostra` on the user's computer: a desktop plugin.
          requires_local_executor: true,
          interface: {
            displayName: definition.displayName,
            shortDescription: definition.description,
            longDescription: definition.longDescription,
            developerName: definition.author.name,
            category: definition.category,
            websiteURL: definition.homepage,
            ...(remote ? { privacyPolicyURL: remote.privacy } : {}),
            ...(definition.icon
              ? { composerIcon: "./assets/icon.png", logo: "./assets/icon.png" }
              : {}),
            defaultPrompt: definition.defaultPrompts,
          },
        },
      },
    }),
  );
  if (local || remote) {
    tree.set(
      "mcp.json",
      json({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          ...(local ? { mostra: { type: "stdio", ...local } } : {}),
          ...(remote ? { "mostra-remote": { type: "streamable-http", url: remote.url } } : {}),
        },
      }),
    );
  }

  // Claude Code (and Grok Build's marketplace, which takes its manifest).
  tree.set(
    ".claude-plugin/plugin.json",
    json({
      name: definition.name,
      displayName: definition.displayName,
      version,
      description: definition.description,
      author,
      homepage: definition.homepage,
      documentationUrl: definition.documentationUrl,
      supportUrl: definition.supportUrl,
      repository: definition.repository,
      license: definition.license,
      keywords: definition.keywords,
      ...(definition.icon ? { icon: "./.claude-plugin/icon.png" } : {}),
      ...(remote ? { privacyPolicyUrl: remote.privacy } : {}),
    }),
  );
  if (local || remote) {
    tree.set(
      ".mcp.json",
      json({
        mcpServers: {
          ...(local ? { mostra: local } : {}),
          ...(remote ? { "mostra-remote": { type: "http", url: remote.url } } : {}),
        },
      }),
    );
  }
  tree.set(
    ".claude-plugin/marketplace.json",
    json({
      name: definition.name,
      owner: { name: definition.author.name, url: definition.author.url },
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

  // Codex and the ChatGPT desktop app's marketplace.
  tree.set(
    ".agents/plugins/marketplace.json",
    json({
      name: definition.name,
      interface: { displayName: definition.displayName },
      plugins: [
        {
          name: definition.name,
          source: { source: "local", path: "./" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: definition.category,
        },
      ],
    }),
  );

  // Gemini CLI.
  tree.set(
    "gemini-extension.json",
    json({
      name: definition.name,
      version,
      description: definition.description,
      ...(local || remote
        ? {
            mcpServers: {
              ...(local ? { mostra: local } : {}),
              ...(remote ? { "mostra-remote": { httpUrl: remote.url } } : {}),
            },
          }
        : {}),
    }),
  );

  // The Skill, a real copy of every file.
  for (const skill of definition.skills) {
    const source = join(input.root, "skills", skill);
    for (const file of filesBelow(source))
      tree.set(`skills/${skill}/${file}`, readFileSync(join(source, file)));
  }

  if (definition.icon) {
    const icon = readFileSync(join(input.root, definition.icon));
    for (const path of ICON_PATHS) tree.set(path, icon);
  }
  tree.set("README.md", readme(definition, input, { local: local !== undefined, remote }));
  tree.set("LICENSE", readFileSync(join(input.root, "LICENSE")));
  tree.set("NOTICE", readFileSync(join(input.root, "NOTICE")));
  return tree;
}

/** Writes a tree into `out`, which must be empty or absent. */
export function writeTree(tree: PluginTree, out: string): void {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new Error(`${out} isn't empty`);
  for (const [path, contents] of tree) {
    const file = join(out, path);
    if (relative(out, file).startsWith("..")) throw new Error(`${path} leaves the plugin`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}
