/**
 * The host-neutral core (HO-06, invariant 11, D01): no code, dependency or shipped text of the
 * core names a particular host. Hosts reach Mostra only through the generic ports and protocol;
 * a Jcode need is met by a generic mechanism (JCODE_HOST.md), never by Jcode code in Mostra.
 *
 *   node tools/audit/host-neutral.ts      fails on any host-specific identifier in the core
 *
 * The core is everything users install, embed or self-host: every package's `src/`, manifests,
 * README and AGENTS.md, every crate's sources and manifest, and the lockfiles (a host's package
 * would show there). The design documents name the first host on purpose and are not the core.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Identifiers of known hosts and their own contracts. A new host joins this list when one is
 * known; the identifiers are words, so "jcodex" or a path segment such as `.jcode` count too.
 */
export const HOST_IDENTIFIERS: readonly RegExp[] = [
  /jcode/i,
  /session_work(_v\d+)?/i,
  /attention_stream(_v\d+)?/i,
];

/** Directories never scanned: build output, dependencies, test fixtures of other tools. */
const SKIP = new Set(["node_modules", "dist", ".tsbuild", ".turbo", "target", "coverage"]);

/** Files of the core, relative to `root`. */
export function coreFiles(root: string = ROOT): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(root, path));
    }
  };
  for (const group of ["packages", "crates", "plugins"]) {
    let members: string[];
    try {
      members = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const member of members) {
      const base = join(root, group, member);
      if (!statSync(base).isDirectory()) continue;
      for (const sub of ["src", "build.rs"]) {
        try {
          if (statSync(join(base, sub)).isDirectory()) walk(join(base, sub));
          else files.push(relative(root, join(base, sub)));
        } catch {
          // not there
        }
      }
      for (const name of ["package.json", "Cargo.toml", "README.md", "AGENTS.md"]) {
        try {
          statSync(join(base, name));
          files.push(relative(root, join(base, name)));
        } catch {
          // not there
        }
      }
    }
  }
  files.push("pnpm-lock.yaml", "Cargo.lock", "docs/reference/cli.md");
  return files;
}

/** Each host-specific identifier in the core: `file:line: text`. */
export function hostNeutralProblems(root: string = ROOT): string[] {
  const problems: string[] = [];
  for (const file of coreFiles(root)) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, index) => {
      if (HOST_IDENTIFIERS.some((pattern) => pattern.test(line))) {
        problems.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return problems;
}

if (import.meta.main) {
  const problems = hostNeutralProblems();
  if (problems.length > 0) {
    console.error(
      `✗ host-neutral core (HO-06): the core names a host. Meet the need with a generic port or protocol feature instead:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`✓ host-neutral core: ${coreFiles().length} files name no host (HO-06)`);
  }
}
