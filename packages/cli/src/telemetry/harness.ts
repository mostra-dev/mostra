/**
 * Which agent ran the CLI (D140 item 9), from environment markers each agent documents or sets in
 * its source (VERIFIED_FACTS, WP-10). Only the agent's ID is ever sent, never a marker's value.
 */
import type { Environment } from "../home.ts";

/** The agents Mostra recognizes, in the order their markers are checked. */
export const HARNESSES = ["claude-code", "codex", "gemini-cli", "opencode", "cursor"] as const;

/** A recognized agent, `other` for an agent Mostra doesn't know, `none` for no agent at all. */
export type Harness = (typeof HARNESSES)[number] | "other" | "none";

/** Each agent's own marker. */
const MARKERS: Readonly<Record<(typeof HARNESSES)[number], string>> = {
  "claude-code": "CLAUDECODE",
  codex: "CODEX_THREAD_ID",
  "gemini-cli": "GEMINI_CLI",
  opencode: "OPENCODE",
  cursor: "CURSOR_AGENT",
};

const set = (value: string | undefined): boolean => value !== undefined && value !== "";

/**
 * The agent that ran this process: `AI_AGENT` when it starts with a known ID (the convention
 * `@vercel/detect-agent` reads), else the first agent whose own marker is set, else `other` when
 * `AI_AGENT` or `AGENT` names something else, else `none`. Cursor's editor terminal sets
 * `CURSOR_TRACE_ID` without `CURSOR_AGENT`: that is a person, so it isn't `cursor`.
 */
export function detectHarness(env: Environment): Harness {
  const declared = env["AI_AGENT"];
  if (set(declared)) {
    const known = HARNESSES.find((id) => declared?.startsWith(id));
    if (known) return known;
  }
  for (const id of HARNESSES) if (set(env[MARKERS[id]])) return id;
  if (set(declared) || set(env["AGENT"])) return "other";
  return "none";
}

/**
 * The known agent an MCP client is, by the `clientInfo.name` it sends (D140 item 8, D164 item 4),
 * as each was observed (VERIFIED_FACTS, WP-15): Claude Code sends `claude-code`, Codex
 * `codex-mcp-client`. Any other name is `other`; the name itself is never sent, since it can name
 * a private tool.
 */
const MCP_CLIENTS: Readonly<Record<string, (typeof HARNESSES)[number]>> = {
  "claude-code": "claude-code",
  "codex-mcp-client": "codex",
};

/** `mcp.session`'s fields for a client: its agent's ID, and its version only for a known one. */
export function mcpSessionFields(client: { readonly name: string; readonly version?: string }): {
  readonly client: (typeof HARNESSES)[number] | "other";
  readonly clientVersion?: string;
} {
  const known = Object.hasOwn(MCP_CLIENTS, client.name) ? MCP_CLIENTS[client.name] : undefined;
  if (known === undefined) return { client: "other" };
  const version = client.version;
  return version !== undefined && /^[0-9A-Za-z.+-]{1,32}$/.test(version)
    ? { client: known, clientVersion: version }
    : { client: known };
}
