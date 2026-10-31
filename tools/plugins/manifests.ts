/**
 * The shapes of the manifests the plugin carries besides Agent Plugins' own (whose published
 * schemas are vendored beside this file): Claude Code's plugin and marketplace, its `.mcp.json`,
 * Gemini CLI's extension and the Codex marketplace. None of them publishes a schema, so each is
 * written here from its harness's reference (VERIFIED_FACTS, WP-14) and closed: a key the plugin
 * doesn't use is refused, so nothing (a `hooks`, `commands` or `agents` entry, a stray field) slips
 * into a manifest a directory scans (WP-14's Opus review, finding 5). A field a later package
 * needs is added here with its source.
 *
 * Sources, checked 2026-10-30: code.claude.com/docs/en/plugins-reference (the manifest's fields,
 * "Directory listing fields"), code.claude.com/docs/en/plugins/marketplace-reference,
 * code.claude.com/docs/en/mcp (`.mcp.json`), geminicli.com/docs/extensions/reference,
 * developers.openai.com/plugins/build/plugins (the marketplace and its policy values).
 */

const text = { type: "string", minLength: 1 } as const;
const https = { type: "string", pattern: "^https://" } as const;
const author = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: text, email: text, url: https },
} as const;
const keywords = { type: "array", items: text } as const;
const version = { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" } as const;
const name = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" } as const;

/** One local server: a command and its arguments, nothing else (no `env`: Muse Code refuses it). */
const stdioServer = {
  type: "object",
  required: ["command", "args"],
  additionalProperties: false,
  properties: { command: text, args: { type: "array", items: { type: "string" } } },
} as const;

/** Claude Code's `.claude-plugin/plugin.json`: the listing's fields, no component of any kind. */
export const CLAUDE_PLUGIN = {
  type: "object",
  required: ["name", "version", "description", "author", "license"],
  additionalProperties: false,
  properties: {
    name,
    displayName: text,
    version,
    description: text,
    author,
    homepage: https,
    repository: https,
    license: text,
    keywords,
    icon: { type: "string", pattern: "^\\./" },
    documentationUrl: https,
    supportUrl: https,
    privacyPolicyUrl: https,
    termsOfServiceUrl: https,
  },
} as const;

/** Claude Code's `.claude-plugin/marketplace.json`: this one plugin at the repository's root. */
export const CLAUDE_MARKETPLACE = {
  type: "object",
  required: ["name", "owner", "plugins"],
  additionalProperties: false,
  properties: {
    name,
    owner: author,
    description: text,
    plugins: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "object",
        required: ["name", "source"],
        additionalProperties: false,
        properties: {
          name,
          source: { const: "./" },
          description: text,
          version,
          author,
          homepage: https,
          repository: https,
          license: text,
          keywords,
        },
      },
    },
  },
} as const;

/** Claude Code's `.mcp.json`: local servers by command, remote ones by HTTPS URL. */
export const CLAUDE_MCP = {
  type: "object",
  required: ["mcpServers"],
  additionalProperties: false,
  properties: {
    mcpServers: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        oneOf: [
          stdioServer,
          {
            type: "object",
            required: ["type", "url"],
            additionalProperties: false,
            properties: { type: { const: "http" }, url: https },
          },
        ],
      },
    },
  },
} as const;

/** Gemini CLI's `gemini-extension.json`: no context file (nothing always loaded), no tools excluded. */
export const GEMINI_EXTENSION = {
  type: "object",
  required: ["name", "version", "description"],
  additionalProperties: false,
  properties: {
    name,
    version,
    description: text,
    mcpServers: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        oneOf: [
          stdioServer,
          {
            type: "object",
            required: ["httpUrl"],
            additionalProperties: false,
            properties: { httpUrl: https },
          },
        ],
      },
    },
  },
} as const;

/** The Codex marketplace (`.agents/plugins/marketplace.json`): this one plugin, local, at `./`. */
export const CODEX_MARKETPLACE = {
  type: "object",
  required: ["name", "plugins"],
  additionalProperties: false,
  properties: {
    name,
    interface: {
      type: "object",
      additionalProperties: false,
      properties: { displayName: text },
    },
    plugins: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "object",
        required: ["name", "source", "policy", "category"],
        additionalProperties: false,
        properties: {
          name,
          source: {
            type: "object",
            required: ["source", "path"],
            additionalProperties: false,
            properties: { source: { const: "local" }, path: { const: "./" } },
          },
          policy: {
            type: "object",
            required: ["installation", "authentication"],
            additionalProperties: false,
            properties: {
              installation: { enum: ["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"] },
              // The one value the reference names; another joins with its source.
              authentication: { enum: ["ON_INSTALL"] },
            },
          },
          category: text,
        },
      },
    },
  },
} as const;
