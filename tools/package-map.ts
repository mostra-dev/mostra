/**
 * Package map P2 (REPO_STANDARDS §3, D65): every package Mostra will have, who it serves and what
 * it may depend on. This file is the single source for the dependency-cruiser boundary rules and
 * for `pnpm gen package`, so the rules for the whole map hold before most packages exist.
 */

/** Where a package's code runs, which decides whether Node built-ins are allowed. */
export type Environment = "neutral" | "browser" | "node";

/** One package of the map. */
export interface PackageRule {
  /** The npm name. */
  readonly name: string;
  /** The directory, relative to the repository root. */
  readonly dir: string;
  /** Who imports it (REPO_STANDARDS §3). */
  readonly audience: string;
  readonly environment: Environment;
  /** Workspace packages it may import. Imports of any other workspace package are violations. */
  readonly workspace: readonly string[];
  /**
   * Third-party packages it may import, or `"any"`. `"any"` still excludes what `environment`
   * rules out.
   */
  readonly external: readonly string[] | "any";
  /** Published to npm (then API reports, publint and attw apply). */
  readonly published: boolean;
}

const contract = (name: string): PackageRule => ({
  name: `@mostra/contract-${name}`,
  dir: `packages/contract-${name}`,
  audience: "plugin authors",
  environment: "neutral",
  workspace: ["@mostra/protocol"],
  external: [],
  published: true,
});

/** Every package in map P2. */
export const PACKAGE_MAP: readonly PackageRule[] = [
  {
    name: "@mostra/protocol",
    dir: "packages/protocol",
    audience: "everything",
    environment: "neutral",
    workspace: [],
    external: ["zod"],
    published: true,
  },
  {
    name: "@mostra/react",
    dir: "packages/react",
    audience: "artifact authors (browser)",
    environment: "browser",
    workspace: ["@mostra/protocol"],
    external: ["react", "react-dom", "react-router", "react-hook-form"],
    published: true,
  },
  {
    name: "@mostra/server",
    dir: "packages/server",
    audience: "artifact authors (worker)",
    environment: "node",
    workspace: ["@mostra/protocol"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/kit",
    dir: "packages/kit",
    audience: "artifact authors",
    environment: "browser",
    workspace: ["@mostra/protocol", "@mostra/react"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/runtime",
    dir: "packages/runtime",
    audience: "runtime bundle",
    environment: "node",
    workspace: ["@mostra/protocol"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/worker",
    dir: "packages/worker",
    audience: "runtime bundle",
    environment: "node",
    workspace: ["@mostra/protocol", "@mostra/server"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/verify",
    dir: "packages/verify",
    audience: "runtime bundle",
    environment: "node",
    workspace: ["@mostra/protocol"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/shell",
    dir: "packages/shell",
    audience: "runtime bundle",
    environment: "browser",
    // The kit's tokens join with the shell's design pass (WP-20).
    workspace: ["@mostra/protocol", "@mostra/kit"],
    external: "any",
    published: true,
  },
  {
    // The warm set (D91): the packages every artifact resolves with no package.json. It has no
    // code; the builder links each build's node_modules to its dependencies. Unpublished: the
    // runtime bundle ships it (WP-11).
    name: "@mostra/warm",
    dir: "packages/warm",
    audience: "runtime bundle (the warm set artifacts resolve)",
    environment: "browser",
    workspace: ["@mostra/react"],
    external: "any",
    published: false,
  },
  {
    name: "@mostra/pty-host",
    dir: "packages/pty-host",
    audience: "runtime bundle",
    environment: "node",
    workspace: ["@mostra/protocol"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/sdk",
    dir: "packages/sdk",
    audience: "JavaScript hosts",
    environment: "node",
    workspace: ["@mostra/protocol"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/cli",
    dir: "packages/cli",
    audience: "agents, people",
    environment: "node",
    workspace: ["@mostra/protocol", "@mostra/sdk"],
    external: "any",
    published: true,
  },
  {
    name: "create-mostra",
    dir: "packages/create-mostra",
    audience: "people",
    environment: "node",
    workspace: ["@mostra/cli"],
    external: "any",
    published: true,
  },
  {
    name: "@mostra/conformance",
    dir: "packages/conformance",
    audience: "host authors",
    environment: "node",
    workspace: ["@mostra/protocol", "@mostra/sdk"],
    external: "any",
    published: true,
  },
  contract("embed-engine"),
  contract("exporter"),
  contract("verify-check"),
  contract("anchor-provider"),
  contract("connector"),
  contract("cli-command"),
];

/**
 * The deep modules inside `@mostra/runtime` (REPO_STANDARDS §3). Each has one public `index.ts`,
 * and no module imports another's internals.
 */
export const RUNTIME_MODULES: readonly string[] = [
  "ledger",
  "interaction",
  "gateway",
  "addressing",
  "registry",
  "publish",
  "deps",
  "processes",
  "live",
  "actions",
  "workers",
  "secrets",
  "service",
  "share",
  "protocol-server",
  "builder",
  "home",
  "instance",
];

/** Finds a package of the map by npm name. */
export function packageRule(name: string): PackageRule | undefined {
  return PACKAGE_MAP.find((rule) => rule.name === name);
}
