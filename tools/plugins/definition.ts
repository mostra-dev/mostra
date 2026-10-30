/**
 * The one definition of Mostra's harness plugin (AX-10, D147, WP-14): who it is, what it carries
 * and which features are on. `build.ts` turns it into the plugin's repository, with each harness's
 * manifest as a real copy beside the one `skills/mostra/`; `check.ts` holds the result to every
 * harness's rules and to the directories' review rules.
 *
 * A feature a later package delivers is off here until that package turns it on, and the
 * package's specification says so (`tools/design/wp_specs.py`). Turning one on is the flag and its
 * few values below; the generator, the checks and the README's disclosures follow from them.
 */

/** A local MCP server the plugin starts, pinned to the release (D147, D148). */
export interface LocalMcpFeature {
  /** On once `mostra mcp` exists and its D148 marker is settled (WP-15). */
  readonly enabled: boolean;
  /** The package that turns it on. */
  readonly owner: "WP-15";
  /**
   * The CLI's arguments after `npx -y @mostra/cli@<version>`. WP-15 adds the marker that makes a
   * plugin-started server embedded use (D148) as an argument: Muse Code refuses an `env` in a
   * plugin's MCP entry, and an argument reaches every harness the same way.
   */
  readonly args: readonly string[];
}

/** The remote MCP server with OAuth (D116, WP-30), for chat hosts and OpenAI's directory. */
export interface RemoteMcpFeature {
  /** On once WP-30's server is live at `url`. */
  readonly enabled: boolean;
  readonly owner: "WP-30";
  /** Its Streamable HTTP endpoint (HTTPS); required when enabled. */
  readonly url?: string;
  /**
   * The service's privacy policy (HTTPS); required when enabled. Anthropic's directory asks for
   * one from a plugin that connects to a remote server, and OpenAI's shows it.
   */
  readonly privacyPolicyUrl?: string;
}

/** The plugin's features. */
export interface PluginFeatures {
  readonly localMcp: LocalMcpFeature;
  readonly remoteMcp: RemoteMcpFeature;
}

/** Everything a harness or directory shows about the plugin. */
export interface PluginDefinition {
  /** The plugin's name in every harness and directory (D147: `mostra`). */
  readonly name: string;
  readonly displayName: string;
  /** One sentence: what it does and when an agent uses it. */
  readonly description: string;
  /** A few sentences for directories that show more. */
  readonly longDescription: string;
  readonly author: { readonly name: string; readonly url: string };
  readonly homepage: string;
  /** The plugin's own repository (D147): the generated tree is its whole content. */
  readonly repository: string;
  /** `owner/name` of that repository, for install commands. */
  readonly repositorySlug: string;
  readonly license: "Apache-2.0";
  readonly keywords: readonly string[];
  /** OpenAI's marketplace and directory category. */
  readonly category: string;
  /** Prompts OpenAI's apps offer as starters. */
  readonly defaultPrompts: readonly string[];
  /** The skills the plugin carries, each a real copy of `skills/<name>/`. */
  readonly skills: readonly string[];
  /**
   * The listing icon, a square PNG of 512 to 2048 px under 2 MB, as a path in this repository.
   * Anthropic's directory takes the icon of a plugin's first submission and never changes it, so
   * it is set before the first submission and kept.
   */
  readonly icon?: string;
  readonly features: PluginFeatures;
}

export const PLUGIN: PluginDefinition = {
  name: "mostra",
  displayName: "Mostra",
  description:
    "Communicate visually with the people you work for: write a React page, verify it, publish it behind a private link and get their answers back.",
  longDescription:
    "Mostra is the agent artifact runtime. Your agent writes an ordinary React page (questions, a choice between options, a plan to approve, a report, a dashboard), checks it in a headless browser, and publishes it on your machine behind a private link. People answer in the page; their answers are saved as they type and come back to the agent as results.",
  author: { name: "Mostra", url: "https://github.com/mostra-dev" },
  homepage: "https://github.com/mostra-dev/mostra",
  repository: "https://github.com/mostra-dev/mostra-plugin",
  repositorySlug: "mostra-dev/mostra-plugin",
  license: "Apache-2.0",
  keywords: ["artifacts", "react", "forms", "dashboards", "review", "human-in-the-loop"],
  category: "Productivity",
  defaultPrompts: [
    "Ask me these questions as a Mostra page and wait for my answers.",
    "Show me the three designs side by side in Mostra so I can pick one.",
  ],
  skills: ["mostra"],
  features: {
    localMcp: { enabled: false, owner: "WP-15", args: ["mcp"] },
    remoteMcp: { enabled: false, owner: "WP-30" },
  },
};
