/**
 * The files `pnpm gen package` writes for a package of the map: manifest, TypeScript projects,
 * build and test config, a placeholder entry with its test, README.md and an AGENTS.md skeleton.
 */
import type { PackageRule } from "../package-map.ts";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The generated files, as repository-relative paths with their content. */
export function packageFiles(rule: PackageRule): [string, string][] {
  const unscoped = rule.name.replace(/^@[^/]+\//, "");
  const node = rule.environment === "node";
  const dependencies: Record<string, string> = {};
  for (const dep of rule.workspace) dependencies[dep] = "workspace:*";
  const manifest = {
    name: rule.name,
    version: "0.0.0",
    description: `TODO: one sentence for ${rule.audience}.`,
    license: "Apache-2.0",
    author: "The Mostra Authors",
    homepage: `https://github.com/mostra-dev/mostra/tree/main/${rule.dir}#readme`,
    repository: {
      type: "git",
      url: "git+https://github.com/mostra-dev/mostra.git",
      directory: rule.dir,
    },
    bugs: "https://github.com/mostra-dev/mostra/issues",
    type: "module",
    sideEffects: false,
    exports: {
      ".": {
        "@mostra/source": "./src/index.ts",
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
      "./package.json": "./package.json",
    },
    files: ["dist", "src", "!src/**/*.test.ts"],
    engines: { node: ">=24" },
    publishConfig: { access: "public", provenance: true },
    scripts: { build: "tsdown", typecheck: "tsc -b", test: "vitest run", api: "mostra-tools api" },
    dependencies,
    devDependencies: {
      "@mostra/tools": "workspace:*",
      "@types/node": "catalog:",
      tsdown: "catalog:",
      typescript: "catalog:",
      vitest: "catalog:",
    },
  };
  return [
    [`${rule.dir}/package.json`, json(manifest)],
    [
      `${rule.dir}/tsconfig.json`,
      json({
        $schema: "https://json.schemastore.org/tsconfig",
        files: [],
        references: [{ path: "./tsconfig.src.json" }, { path: "./tsconfig.test.json" }],
      }),
    ],
    [
      `${rule.dir}/tsconfig.src.json`,
      json({
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          rootDir: "src",
          outDir: ".tsbuild/src",
          tsBuildInfoFile: ".tsbuild/src.tsbuildinfo",
          ...(node
            ? { types: ["node"] }
            : rule.environment === "browser"
              ? { lib: ["es2024", "dom", "dom.iterable"] }
              : {}),
        },
        include: ["src"],
      }),
    ],
    [
      `${rule.dir}/tsconfig.test.json`,
      json({
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          rootDir: ".",
          outDir: ".tsbuild/test",
          tsBuildInfoFile: ".tsbuild/test.tsbuildinfo",
          types: ["node"],
          isolatedDeclarations: false,
          rewriteRelativeImportExtensions: false,
          allowImportingTsExtensions: true,
        },
        include: ["test", "*.config.ts"],
        references: [{ path: "./tsconfig.src.json" }],
      }),
    ],
    [
      `${rule.dir}/tsdown.config.ts`,
      [
        'import { defineConfig } from "tsdown";',
        "",
        "export default defineConfig({",
        '  entry: ["src/index.ts"],',
        '  format: "esm",',
        `  platform: "${node ? "node" : rule.environment === "browser" ? "browser" : "neutral"}",`,
        '  target: "es2024",',
        "  dts: true,",
        "  sourcemap: true,",
        "  clean: true,",
        // Node builds would otherwise be named .mjs, which the exports map doesn't name.
        ...(node ? ["  fixedExtension: false,"] : []),
        '  tsconfig: "tsconfig.src.json",',
        "});",
        "",
      ].join("\n"),
    ],
    [
      `${rule.dir}/vitest.config.ts`,
      [
        'import { defineConfig } from "vitest/config";',
        "",
        "// Tests import the package by name, resolved to source through the `@mostra/source` condition.",
        "export default defineConfig({",
        '  resolve: { conditions: ["@mostra/source"] },',
        '  ssr: { resolve: { conditions: ["@mostra/source"] } },',
        '  test: { include: ["test/**/*.test.ts"] },',
        "});",
        "",
      ].join("\n"),
    ],
    [
      `${rule.dir}/src/index.ts`,
      [
        "/**",
        ` * \`${rule.name}\`: TODO, what this package gives ${rule.audience}.`,
        " *",
        " * @packageDocumentation",
        " */",
        "",
        "/** The package name. A placeholder export: replace it with the package's real interface. */",
        `export const PACKAGE_NAME: string = "${rule.name}";`,
        "",
      ].join("\n"),
    ],
    [
      `${rule.dir}/test/index.test.ts`,
      [
        'import { describe, expect, it } from "vitest";',
        `import { PACKAGE_NAME } from "${rule.name}";`,
        "",
        `describe("${rule.name}", () => {`,
        '  it("loads through its public entry point", () => {',
        `    expect(PACKAGE_NAME).toBe("${rule.name}");`,
        "  });",
        "});",
        "",
      ].join("\n"),
    ],
    [
      `${rule.dir}/README.md`,
      [
        `# ${rule.name}`,
        "",
        `TODO: what ${unscoped} does for ${rule.audience}, how to install it and a minimal example.`,
        "",
        "Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.",
        "",
      ].join("\n"),
    ],
    [
      `${rule.dir}/AGENTS.md`,
      [
        `# ${rule.name}`,
        "",
        `Audience: ${rule.audience}. Runs in: ${rule.environment}. May import: ${rule.workspace.join(", ") || "no workspace packages"} (tools/package-map.ts).`,
        "",
        "## Purpose",
        "",
        "TODO",
        "",
        "## Invariants it owns",
        "",
        "TODO",
        "",
        "## Public interface",
        "",
        "`src/index.ts`; the API report is `etc/" + unscoped + ".api.md`.",
        "",
        "## Tests to run",
        "",
        `\`pnpm --filter ${rule.name} test\`, then \`pnpm check --affected\`.`,
        "",
        "## Gotchas",
        "",
        "TODO",
        "",
      ].join("\n"),
    ],
  ];
}
