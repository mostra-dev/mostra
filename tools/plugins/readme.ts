/**
 * The plugin's README (D147): what it is, how to install it in each harness, and everything it
 * runs, sends or fetches, every network destination included. Its disclosures follow from the
 * features that are on and from the release's telemetry endpoint, so the README is true of the
 * build it ships in. Human-facing prose, accepted by Mirza with the package's prose (D149).
 */
import type { PluginDefinition } from "./definition.ts";

/** What the README needs of the build. */
interface ReadmeInput {
  readonly version: string;
  readonly telemetryEndpoint: string;
}

/** The features the build turned on. */
interface Servers {
  readonly local: boolean;
  readonly remote: { readonly url: string; readonly privacy: string } | undefined;
}

/** Which README: the full plugin's, at the repository's root, or Claude's directory folder's (MT-07). */
interface ReadmeOptions {
  readonly variant: "plugin" | "claude-directory";
}

export function readme(
  definition: PluginDefinition,
  input: ReadmeInput,
  servers: Servers,
  options: ReadmeOptions = { variant: "plugin" },
): string {
  const lines =
    options.variant === "claude-directory"
      ? directoryHead(definition, input.version, servers)
      : pluginHead(definition, input.version, servers);
  lines.push(...shared(definition, input, servers, options));
  return lines.join("\n");
}

/** The full plugin's title, introduction and install table. */
function pluginHead(definition: PluginDefinition, version: string, servers: Servers): string[] {
  const slug = definition.repositorySlug;
  const cli = `npx -y @mostra/cli@${version}`;
  return [
    `# ${definition.displayName} for coding agents`,
    "",
    `${definition.longDescription}`,
    "",
    `This plugin gives your agent the Mostra Agent Skill: how to write, verify, publish and share an artifact, and read the answers back. It runs Mostra ${version} through \`${cli}\` when \`mostra\` isn't installed.${servers.local ? ` It also starts Mostra's local MCP server, pinned to the same release.` : ""} Mostra's source, documentation and issues are at ${definition.homepage}.`,
    "",
    "## Install",
    "",
    "| Harness | Install |",
    "|---|---|",
    `| Claude Code | \`claude plugin marketplace add ${slug}\`, then \`claude plugin install ${definition.name}@${definition.name}\` |`,
    `| Codex, and the ChatGPT desktop app | \`codex plugin marketplace add ${slug}\`, then install **${definition.displayName}** from the Plugins directory |`,
    `| GitHub Copilot CLI | \`copilot plugin marketplace add ${slug}\`, then \`copilot plugin install ${definition.name}@${definition.name}\` |`,
    `| Gemini CLI | \`gemini extensions install https://github.com/${slug}\` |`,
    `| Cursor | from the Cursor Marketplace; or copy this repository to \`~/.cursor/plugins/local/${definition.name}\` and reload Cursor |`,
    `| VS Code and other Agent Plugins clients | point the client's plugin installer at \`https://github.com/${slug}\` |`,
    `| Any agent that reads Agent Skills | \`npx skills add ${slug}\` |`,
    "",
    `Each release of Mostra publishes this repository again at the tag \`v<version>\`; pin a tag to stay on one release.`,
    "",
  ];
}

/**
 * The directory folder's title and introduction (MT-07): what it carries, how its server signs in,
 * and where the full plugin and the CLI are. The directory shows this README as the listing's
 * description.
 */
function directoryHead(definition: PluginDefinition, version: string, servers: Servers): string[] {
  const lines = [
    `# ${definition.displayName} for Claude`,
    "",
    `${definition.longDescription}`,
    "",
    `This plugin gives Claude the Mostra Agent Skill: how to write, verify, publish and share an artifact, and read the answers back.${servers.remote ? " It also connects Mostra's remote MCP server, whose tools take Claude through the same steps from any Claude app." : ""} Where Claude has a shell, as in Claude Code, the Skill can run Mostra ${version} itself, through \`npx -y @mostra/cli@${version}\` when \`mostra\` isn't installed.`,
    "",
    `This is the build of Mostra's plugin for Claude's directory. The full plugin, which also starts Mostra's local MCP server and installs in Claude Code, Codex, GitHub Copilot CLI, Gemini CLI, Cursor and other agents, is the root of ${definition.repository}. The \`mostra\` command line is the npm package \`@mostra/cli\`. Mostra's source, documentation and issues are at ${definition.homepage}.`,
    "",
  ];
  if (servers.remote) {
    lines.push(
      "## Connecting and signing in",
      "",
      `The plugin's one MCP server is Mostra's remote server at \`${servers.remote.url}\`. The first time Claude connects to it, you sign in on the server's own page with OAuth and approve the connection. Claude then works through its tools (\`artifact_create\`, \`artifact_verify\`, \`artifact_publish\` and the rest), and the server receives the requests Claude makes through them. Creating, verifying and publishing a page run on a computer of yours where Mostra runs and is signed in to the same server (\`mostra login\`); while it's off, those tools say so, and listing pages, waiting for answers and reading them keep working. Its privacy policy: ${servers.remote.privacy}.`,
      "",
    );
  }
  return lines;
}

/** What both READMEs say: what the plugin runs, sends and fetches, usage data and the license. */
function shared(
  definition: PluginDefinition,
  input: ReadmeInput,
  servers: Servers,
  options: ReadmeOptions,
): string[] {
  const { version } = input;
  const cli = `npx -y @mostra/cli@${version}`;
  const lines: string[] = [
    "## What it runs, sends and fetches",
    "",
    options.variant === "claude-directory"
      ? "The plugin has no hooks and starts no program. When Claude has a shell and follows the Skill:"
      : servers.local
        ? "The plugin has no hooks. Your harness starts its MCP server (below) when a session begins; the rest runs when your agent follows the Skill or uses the server's tools:"
        : "The plugin has no hooks and runs nothing on its own. When your agent follows the Skill:",
    "",
    `- **It runs \`mostra\`** on your computer, or \`${cli}\` where \`mostra\` isn't installed.`,
    "- **The first run downloads Mostra** (no account, nothing sent about you), the MCP server's first start included:",
    `  - the \`@mostra/cli\` package from the npm registry (\`registry.npmjs.org\`, or the registry your npm is set to);`,
    `  - Mostra's runtime for your platform from its GitHub release (\`github.com/mostra-dev/mostra/releases/download/v${version}/\`, served from GitHub's download hosts), checked against the SHA-256 the package pins;`,
    "  - the headless Chromium that `mostra verify` renders pages in, from Playwright's download server (`cdn.playwright.dev`), checked file by file against the pins in the runtime.",
    "- **Packages your agent's pages import** that Mostra doesn't already carry are installed from the npm registry, the first time a page needs them.",
    "- **Pages and their server code run on your computer.** Mostra serves them on `127.0.0.1` only, behind private links. What a page or its server code does (call an API, send an email) is what your agent wrote; Mostra adds no restrictions and no network calls of its own.",
    "- **Sharing beyond your computer happens only when asked:** `mostra share --tailnet` uses your installed Tailscale (your tailnet), and `mostra share --public` your installed Tailscale Funnel or Cloudflare's `cloudflared` (a `trycloudflare.com` address). Each share ends when stopped or when its link expires.",
  ];
  if (servers.local) {
    lines.push(
      `- **The MCP server this plugin starts** (\`${cli} ${definition.features.localMcp.args.join(" ")}\`) runs on your computer, speaks only to your agent over stdio, and sends no usage data: \`--embedded\` marks it as started on your behalf. Artifacts its tools create go in \`~/mostra-artifacts\` unless your agent names another directory, and it opens a page in your browser only when your agent asks it to.`,
    );
  }
  // The directory's README says this in its own section, where the server is its whole point.
  if (servers.remote !== undefined && options.variant === "plugin") {
    lines.push(
      `- **The remote MCP server** at \`${servers.remote.url}\` is used only when you connect it and sign in with OAuth; it receives the requests your agent makes through it. Its privacy policy: ${servers.remote.privacy}.`,
    );
  }
  lines.push("", "## Usage data", "");
  if (input.telemetryEndpoint === "") {
    lines.push(
      `Mostra ${version} sends no usage data: this release's \`mostra\` command has no telemetry endpoint. A later release that can send anonymous usage events will say so here, name its endpoint, and list its events in \`mostra docs telemetry\`.`,
    );
  } else {
    lines.push(
      `When you run \`mostra\` yourself, it can send anonymous usage events (the command, its outcome and duration, the Mostra version, the platform, and which agent ran it; never your pages, paths, links, answers or identity) to \`${input.telemetryEndpoint}\`. In the EU, the EEA, the UK, Switzerland, and where the time zone is UTC or unknown, it asks first and sends nothing until you agree. \`mostra docs telemetry\` lists every event.`,
    );
  }
  lines.push(
    "",
    "Turn it off with any of these: `mostra telemetry off`, `DO_NOT_TRACK=1` or `MOSTRA_TELEMETRY=0` in the environment. Mostra started by a program on your behalf (an SDK, a host application, or an MCP server a plugin starts) never sends usage data.",
    "",
    "## License",
    "",
    `Apache-2.0, like Mostra. See \`LICENSE\` and \`NOTICE\`.`,
    "",
  );
  return lines;
}
