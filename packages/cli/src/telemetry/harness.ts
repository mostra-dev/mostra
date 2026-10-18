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
