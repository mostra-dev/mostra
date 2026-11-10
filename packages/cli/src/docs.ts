/**
 * `mostra docs` (D140 item 17): the reference that ships with the CLI, by stable slug. The
 * diagnostic pages are keyed by code (`mostra docs MOSTRA_DEP_MISSING`, as hints say), beside the
 * CLI reference and the telemetry page. The Agent Skill (`skills/mostra/`, WP-14) is in it too, as
 * `guide` and `guide/<name>`, so an agent whose harness has no Skill reads the same text through
 * the CLI. This index is the one source WP-15's `docs_search` and WP-26's site read.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type DocsTopic, docsIndex as indexOf } from "@mostra/mcp";
import { fromSource, packageRoot } from "./version.ts";

/** Where the reference is: bundled in the build (`dist/reference`), or the repository's. */
export function referenceDir(): string {
  const bundled = join(packageRoot(), "dist", "reference");
  return !fromSource() && existsSync(bundled)
    ? bundled
    : join(packageRoot(), "..", "..", "docs", "reference");
}

/** Where the Agent Skill is: bundled in the build (`dist/skill`), or the repository's. */
export function skillDir(): string {
  const bundled = join(packageRoot(), "dist", "skill");
  return !fromSource() && existsSync(bundled)
    ? bundled
    : join(packageRoot(), "..", "..", "skills", "mostra");
}

/** Every topic of the reference this CLI ships, the pages first and then the codes, sorted. */
export function docsIndex(dir: string = referenceDir()): DocsTopic[] {
  return indexOf(dir, skillDir());
}

export {
  type DocsTopic,
  indexMarkdown,
  MCP_GUIDE_LINKS,
  nearestTopics,
  topicMarkdown,
} from "@mostra/mcp";
