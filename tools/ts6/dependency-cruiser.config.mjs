// dependency-cruiser rules for package map P2 (REPO_STANDARDS §3), generated from
// tools/package-map.ts so the rules and the map can't drift. Run through `pnpm check` (boundaries).
import { PACKAGE_MAP, RUNTIME_MODULES } from "../package-map.ts";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dirOf = (name) => PACKAGE_MAP.find((rule) => rule.name === name)?.dir;

const rules = [];

for (const pkg of PACKAGE_MAP) {
  const own = escape(pkg.dir);
  const allowedDirs = [pkg.dir, ...pkg.workspace.map(dirOf)].filter(Boolean).map(escapeRegex);
  rules.push({
    name: `boundary:${pkg.name}`,
    comment: `${pkg.name} may import only these workspace packages: ${pkg.workspace.join(", ") || "none"} (REPO_STANDARDS §3).`,
    severity: "error",
    from: { path: `^${own}/` },
    to: { path: "^(packages|plugins)/[^/]+/", pathNot: allowedDirs.map((dir) => `^${dir}/`) },
  });
  if (pkg.environment !== "node") {
    rules.push({
      name: `no-node-builtins:${pkg.name}`,
      comment: `${pkg.name} runs in the ${pkg.environment === "browser" ? "browser" : "browser and Node"}, so its source can't import Node built-ins.`,
      severity: "error",
      from: { path: `^${own}/src/` },
      to: { dependencyTypes: ["core"] },
    });
  }
  if (pkg.external !== "any") {
    rules.push({
      name: `external-allowlist:${pkg.name}`,
      comment: `${pkg.name} may import only these third-party packages: ${pkg.external.join(", ") || "none"}.`,
      severity: "error",
      from: { path: `^${own}/src/` },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-peer",
          "npm-optional",
          "npm-no-pkg",
          "npm-unknown",
        ],
        pathNot: pkg.external.map((name) => `node_modules/${escape(name)}/`),
      },
    });
  }
}

rules.push(
  {
    name: "runtime-module-internals",
    comment: `@mostra/runtime modules (${RUNTIME_MODULES.join(", ")}) import each other only through their index.ts.`,
    severity: "error",
    from: { path: "^packages/runtime/src/([^/]+)/" },
    to: {
      path: "^packages/runtime/src/[^/]+/.+",
      pathNot: ["^packages/runtime/src/$1/", "^packages/runtime/src/[^/]+/index\\.ts$"],
    },
  },
  {
    name: "runtime-vite-in-builder-only",
    comment: "Vite loads only in the builder child's entry (REPO_STANDARDS §3).",
    severity: "error",
    from: { path: "^packages/runtime/src/", pathNot: "^packages/runtime/src/builder/" },
    to: { path: "node_modules/vite/" },
  },
  {
    name: "no-circular",
    comment: "Circular imports hide the real dependency direction.",
    severity: "error",
    from: { path: "^(packages|plugins)/" },
    to: { circular: true },
  },
);

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: rules,
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.tsbuild|coverage)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["@mostra/source", "import", "types", "default"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
