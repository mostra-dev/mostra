#!/usr/bin/env node
/**
 * Repository rules no other tool checks (REPO_STANDARDS §3, §4, §6, §8; STANDARDS supply chain):
 *
 * - dependencies use only `catalog:` or `workspace:` specifiers, so every version lives in a catalog;
 * - every package under `packages/` is in the package map, is Apache-2.0, has README.md and
 *   AGENTS.md, and, when published, names this repository exactly (npm trusted publishing);
 * - `LICENSE` is the canonical Apache-2.0 text and `NOTICE` exists (D14);
 * - every GitHub Action is pinned to a full commit SHA with a version comment, and every workflow
 *   sets top-level permissions;
 * - Changesets releases every published package but the extension contracts (versioned on their
 *   own, D30) as one fixed group, so one Mostra version names one runtime bundle (RT-01), and
 *   never versions or tags a private package;
 * - every published package declares its Node.js line, and everything it brings along admits that
 *   line (#92, `engines.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { fail, ROOT } from "../lib/repo.ts";
import { listPackages, type WorkspacePackage } from "../lib/workspace.ts";
import { PACKAGE_MAP } from "../package-map.ts";
import { crateProblems, skillPinProblems } from "../release/versions.ts";
import { workspaceEngineProblems } from "./engines.ts";

const REPOSITORY = "git+https://github.com/mostra-dev/mostra.git";
/** SHA-256 of the canonical Apache License 2.0 text (apache.org/licenses/LICENSE-2.0.txt). */
const APACHE_2_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

/** Problems with the license files at the repository root. */
export function licenseProblems(root: string): string[] {
  const problems: string[] = [];
  const license = join(root, "LICENSE");
  if (!existsSync(license)) problems.push("LICENSE is missing (D14).");
  else if (createHash("sha256").update(readFileSync(license)).digest("hex") !== APACHE_2_SHA256) {
    problems.push("LICENSE is not the canonical Apache-2.0 text (D14).");
  }
  if (!existsSync(join(root, "NOTICE"))) problems.push("NOTICE is missing (D14).");
  return problems;
}
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

/** Packages released on their own versions: the extension contracts (D30). */
const OWN_VERSION = /^@mostra\/contract-/;

/**
 * The imports in `source` that aren't Node.js built-ins (`node:`): a script the release's
 * `publish` job runs has only the checkout and Node.js there, no installed packages, and the job
 * holds the publishing credentials, so it runs nothing installed (EN-05).
 */
export function privilegedImportProblems(source: string, file: string): string[] {
  const problems: string[] = [];
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] as string);
  for (const specifier of specifiers) {
    if (!specifier.startsWith("node:"))
      problems.push(
        `${file} imports "${specifier}", but the release's publish job runs it with Node.js built-ins only.`,
      );
  }
  return problems;
}

/** The scripts `.github/workflows/release.yml`'s `publish` job runs with `node`, and their problems. */
function publishJobProblems(root: string): string[] {
  const file = join(root, ".github", "workflows", "release.yml");
  if (!existsSync(file)) return [];
  const workflow = parseYaml(readFileSync(file, "utf8")) as {
    jobs?: Record<string, { steps?: { run?: string }[] }>;
  };
  const steps = workflow.jobs?.["publish"]?.steps ?? [];
  const problems: string[] = [];
  for (const step of steps) {
    for (const match of (step.run ?? "").matchAll(/\bnode\s+(\S+\.(?:ts|mjs|js))\b/g)) {
      const script = match[1] as string;
      const path = join(root, script);
      if (!existsSync(path))
        problems.push(`release.yml's publish job runs ${script}, which doesn't exist.`);
      else problems.push(...privilegedImportProblems(readFileSync(path, "utf8"), script));
    }
  }
  return problems;
}

/** Problems with the release configuration: one fixed group of every core package published. */
export function releaseGroupProblems(
  config: { fixed?: unknown; privatePackages?: unknown },
  packages: readonly WorkspacePackage[],
): string[] {
  const problems: string[] = [];
  const core = packages
    .filter((pkg) => !pkg.private && !OWN_VERSION.test(pkg.name))
    .map((pkg) => pkg.name)
    .sort();
  const fixed = Array.isArray(config.fixed) ? (config.fixed as unknown[]) : [];
  const group =
    fixed.length === 1 && Array.isArray(fixed[0]) ? [...(fixed[0] as string[])].sort() : undefined;
  if (group === undefined) {
    problems.push(
      ".changeset/config.json must have exactly one fixed group: Mostra's published packages share one version (RT-01).",
    );
  } else {
    for (const name of core.filter((name) => !group.includes(name)))
      problems.push(`.changeset/config.json's fixed group lacks ${name}, a published package.`);
    for (const name of group.filter((name) => !core.includes(name)))
      problems.push(
        `.changeset/config.json's fixed group names ${name}, which isn't a published core package.`,
      );
  }
  const privates = config.privatePackages as { version?: unknown; tag?: unknown } | undefined;
  if (privates?.version !== false || privates?.tag !== false)
    problems.push(
      '.changeset/config.json must set "privatePackages": { "version": false, "tag": false }.',
    );
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

/** Every `uses:` value in a parsed workflow or action file, with where it sits. */
function usesValues(document: unknown): { where: string; target: string }[] {
  const found: { where: string; target: string }[] = [];
  const doc = (document ?? {}) as {
    jobs?: Record<string, { uses?: unknown; steps?: { uses?: unknown }[] }>;
    runs?: { steps?: { uses?: unknown }[] };
  };
  const steps = (where: string, list: { uses?: unknown }[] | undefined): void => {
    (Array.isArray(list) ? list : []).forEach((step, index) => {
      if (typeof step?.uses === "string")
        found.push({ where: `${where}.steps[${index}]`, target: step.uses });
    });
  };
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    if (typeof job?.uses === "string") found.push({ where: `jobs.${name}`, target: job.uses });
    steps(`jobs.${name}`, job?.steps);
  }
  steps("runs", doc.runs?.steps);
  return found;
}

/**
 * Problems with one workflow or action file: every action and reusable workflow pinned to a full
 * commit SHA with a version comment, and top-level permissions on workflows. The file is parsed,
 * so quoted keys and flow mappings can't hide a reference.
 */
export function workflowProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    return [`${file} is not valid YAML: ${(error as Error).message}`];
  }
  const lines = text.split("\n");
  for (const { where, target } of usesValues(document)) {
    if (target.startsWith("./")) continue;
    const at = `${file} ${where}`;
    if (target.startsWith("docker://")) {
      if (!/@sha256:[0-9a-f]{64}$/.test(target))
        problems.push(`${at}: docker action ${target} must be pinned by digest.`);
      continue;
    }
    if (!/@[0-9a-f]{40}$/.test(target)) {
      problems.push(
        `${at}: ${target} must be pinned to a full commit SHA (STANDARDS supply chain).`,
      );
      continue;
    }
    const line = lines.find((candidate) => candidate.includes(target)) ?? "";
    if (!/#\s*v?\d/.test(line.slice(line.indexOf(target) + target.length))) {
      problems.push(
        `${at}: ${target} needs a version comment on its line, such as "# v4.2.2", for Renovate.`,
      );
    }
  }
  if (file.includes(".github/workflows/")) {
    const parsed = document as { permissions?: unknown } | null;
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
  problems.push(...licenseProblems(root));
  for (const pkg of packages)
    problems.push(...specifierProblems(pkg), ...packageProblems(pkg, root));
  for (const file of yamlFiles(join(root, ".github"))) {
    problems.push(...workflowProblems(relative(root, file), readFileSync(file, "utf8")));
  }
  const changesets = JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8")) as {
    fixed?: unknown;
    privatePackages?: unknown;
  };
  problems.push(...releaseGroupProblems(changesets, listPackages(root)));
  problems.push(...publishJobProblems(root));
  // The host crate follows the release group's version (D143).
  problems.push(...crateProblems(root));
  // The Skill runs the CLI of the release it ships in (WP-14).
  problems.push(...skillPinProblems(root));
  problems.push(...workspaceEngineProblems(listPackages(root), root));
  if (problems.length > 0) fail(problems, "repository lint");
  console.log(
    `✓ repository lint: ${packages.length} manifests, catalog-only specifiers, pinned actions, one release group with its crate, a publish job on built-ins, Node.js lines that hold`,
  );
}

if (import.meta.main) main();
