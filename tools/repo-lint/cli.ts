#!/usr/bin/env node
/**
 * Repository rules no other tool checks (REPO_STANDARDS §3, §4, §6, §8; STANDARDS supply chain):
 *
 * - dependencies use only `catalog:` or `workspace:` specifiers, so every version lives in a catalog;
 * - every package under `packages/` is in the package map, is Apache-2.0, has README.md and
 *   AGENTS.md, and, when published, names this repository exactly (npm trusted publishing);
 * - every GitHub Action is pinned to a full commit SHA with a version comment, and every workflow
 *   sets top-level permissions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { fail, ROOT } from "../lib/repo.ts";
import { listPackages, type WorkspacePackage } from "../lib/workspace.ts";
import { PACKAGE_MAP } from "../package-map.ts";

const REPOSITORY = "git+https://github.com/mostra-dev/mostra.git";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Problems with dependency specifiers: each must come from a catalog or the workspace. */
export function specifierProblems(pkg: WorkspacePackage): string[] {
  const problems: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = (pkg.manifest[field] ?? {}) as Record<string, string>;
    for (const [name, spec] of Object.entries(deps)) {
      if (field === "peerDependencies") continue;
      if (!/^(catalog:[\w-]*|workspace:\*)$/.test(spec)) {
        problems.push(
          `${pkg.dir}/package.json ${field}.${name} is "${spec}": pin it in a pnpm-workspace.yaml catalog and use "catalog:".`,
        );
      }
    }
  }
  return problems;
}

/** Problems with a package under `packages/`: map membership, license, docs, repository field. */
export function packageProblems(pkg: WorkspacePackage, root: string = ROOT): string[] {
  if (!pkg.dir.startsWith("packages/")) return [];
  const problems: string[] = [];
  const rule = PACKAGE_MAP.find((candidate) => candidate.dir === pkg.dir);
  if (!rule || rule.name !== pkg.name) {
    problems.push(
      `${pkg.dir} (${pkg.name}) is not in tools/package-map.ts. Add it there first (REPO_STANDARDS §3).`,
    );
  }
  if (pkg.manifest["license"] !== "Apache-2.0")
    problems.push(`${pkg.dir}/package.json must have "license": "Apache-2.0" (D14).`);
  for (const file of ["README.md", "AGENTS.md"]) {
    if (!existsSync(join(root, pkg.dir, file)))
      problems.push(`${pkg.dir}/${file} is missing (REPO_STANDARDS §8).`);
  }
  if (!pkg.private) {
    const repository = pkg.manifest["repository"] as
      | { url?: string; directory?: string }
      | undefined;
    if (repository?.url !== REPOSITORY || repository.directory !== pkg.dir) {
      problems.push(
        `${pkg.dir}/package.json repository must be { "url": "${REPOSITORY}", "directory": "${pkg.dir}" } for npm trusted publishing.`,
      );
    }
  }
  return problems;
}

/** Problems with one workflow or action file's text. */
export function workflowProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match = /^\s*-?\s*uses:\s*([^\s#]+)\s*(#.*)?$/.exec(line);
    if (!match) return;
    const target = match[1] ?? "";
    if (target.startsWith("./")) return;
    if (target.startsWith("docker://")) {
      if (!/@sha256:[0-9a-f]{64}$/.test(target))
        problems.push(`${file}:${index + 1} docker action ${target} must be pinned by digest.`);
      return;
    }
    if (!/@[0-9a-f]{40}$/.test(target)) {
      problems.push(
        `${file}:${index + 1} ${target} must be pinned to a full commit SHA (STANDARDS supply chain).`,
      );
    } else if (!/^#\s*v?\d/.test(match[2]?.trim() ?? "")) {
      problems.push(
        `${file}:${index + 1} ${target} needs a version comment, such as "# v4.2.2", for Renovate.`,
      );
    }
  });
  if (file.includes(".github/workflows/")) {
    const parsed = parseYaml(text) as { permissions?: unknown } | null;
    if (!parsed || parsed.permissions === undefined) {
      problems.push(`${file} must set top-level permissions (default contents: read).`);
    }
  }
  return problems;
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.ya?ml$/.test(entry.name))
      files.push(join(entry.parentPath, entry.name));
  }
  return files;
}

function main(): void {
  const problems: string[] = [];
  const root = process.argv[2] ?? ROOT;
  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const packages = [
    ...listPackages(root),
    {
      name: "(root)",
      dir: ".",
      private: true,
      scripts: {},
      dependencies: [],
      manifest: rootPackage,
    },
  ];
  for (const pkg of packages)
    problems.push(...specifierProblems(pkg), ...packageProblems(pkg, root));
  for (const file of yamlFiles(join(root, ".github"))) {
    problems.push(...workflowProblems(relative(root, file), readFileSync(file, "utf8")));
  }
  if (problems.length > 0) fail(problems, "repository lint");
  console.log(
    `✓ repository lint: ${packages.length} manifests, catalog-only specifiers, pinned actions`,
  );
}

if (import.meta.main) main();
