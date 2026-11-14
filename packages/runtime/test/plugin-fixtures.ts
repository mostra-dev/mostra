/**
 * Plugin fixtures (WP-16): npm packages the local registry (`registry.ts`) serves, so `plugin/*`
 * and `pack/add` run against a real pnpm install. Two depend on the real contract packages, built
 * from this repository and served as they would be published; the rest stamp by hand where a test
 * needs a stamp no `define*` would make.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLUGIN_CONTRACTS } from "@mostra/protocol/plugin";
import type { FixturePackage } from "./registry.ts";

const contractDir = (name: string): string =>
  fileURLToPath(new URL(`../../contract-${name}/`, import.meta.url));

/** A contract package as the registry serves it: its built entry and its manifest's fields. */
function contractPackage(name: "exporter" | "cli-command"): FixturePackage {
  const dir = contractDir(name);
  const manifest = JSON.parse(readFileSync(`${dir}package.json`, "utf8")) as { version: string };
  return {
    name: `@mostra/contract-${name}`,
    version: manifest.version,
    manifest: {
      type: "module",
      license: "Apache-2.0",
      exports: { ".": "./dist/index.js" },
      main: "./dist/index.js",
    },
    files: { "dist/index.js": readFileSync(`${dir}dist/index.js`, "utf8") },
  };
}

/** The version of `contract` this runtime implements: what fixtures stamp and range on. */
export const implemented = (contract: keyof typeof PLUGIN_CONTRACTS): string =>
  PLUGIN_CONTRACTS[contract].implements.at(-1) as string;

const range = (contract: keyof typeof PLUGIN_CONTRACTS): string => implemented(contract);

/** The plugin fixtures. */
export function pluginFixtures(): FixturePackage[] {
  const exporter = contractPackage("exporter");
  const command = contractPackage("cli-command");
  return [
    exporter,
    command,
    {
      // Exporters and CLI commands only: installable for an artifact or the home.
      name: "mostra-fixture-words",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        dependencies: {
          "@mostra/contract-exporter": exporter.version,
          "@mostra/contract-cli-command": command.version,
        },
        mostra: {
          name: "dev.mostra.fixtures/words",
          title: "Words",
          contracts: {
            exporter: `^${range("exporter")}`,
            "cli-command": `^${range("cli-command")}`,
          },
          contributes: {
            exporters: [{ id: "words", entry: "./exporter.js" }],
            cliCommands: [{ command: "words count", entry: "./command.js" }],
          },
          effects: ["filesystem"],
          license: "MIT",
        },
      },
      files: {
        "exporter.js": [
          'import { defineExporter } from "@mostra/contract-exporter";',
          "export default defineExporter({",
          '  id: "words",',
          '  output: { mediaType: "text/plain", layout: "file", extension: "txt" },',
          "  async export({ files, version, options }) {",
          '    const html = await files.readText("client/index.html");',
          "    const paths = await files.list();",
          "    return {",
          "      files: [",
          '        { path: "words.txt", content: version.title + ": " + paths.length + " files, " + html.length + " bytes, " + JSON.stringify(options) },',
          '        { path: "nested/bytes.bin", content: new Uint8Array([1, 2, 3]) },',
          "      ],",
          '      entry: "words.txt",',
          '      findings: [{ code: "COUNTED", severity: "hint", message: "Counted the files." }],',
          "    };",
          "  },",
          "});",
          "",
        ].join("\n"),
        "command.js": [
          'import { defineCliCommand } from "@mostra/contract-cli-command";',
          "export default defineCliCommand({",
          '  path: ["words", "count"],',
          '  summary: "Count the words of a sentence.",',
          '  args: [{ name: "sentence", summary: "The words.", variadic: true }],',
          "  async run({ args }, context) {",
          '    const status = await context.call("instance/status", {});',
          "    const words = Array.isArray(args.sentence) ? args.sentence : [];",
          "    return { result: { count: words.length, pid: status.instance.pid } };",
          "  },",
          "});",
          "",
        ].join("\n"),
      },
    },
    {
      // Contributes the exporter "words" too: a conflict with mostra-fixture-words.
      name: "mostra-fixture-words-twin",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/words-twin",
          contracts: { exporter: `^${range("exporter")}` },
          contributes: { exporters: [{ id: "words", entry: "./exporter.js" }] },
          license: "MIT",
        },
      },
      files: {
        "exporter.js": `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "words", output: { mediaType: "text/plain", layout: "file" }, async export() { return { files: [] }; } };\n`,
      },
    },
    {
      // Needs a contract line no release implements yet: out of range at install.
      name: "mostra-fixture-future",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/future",
          contracts: { exporter: "^9.0.0" },
          contributes: { exporters: [{ id: "future", entry: "./exporter.js" }] },
          license: "MIT",
        },
      },
      files: {
        "exporter.js": `export default { contract: { name: "exporter", version: "9.0.0" }, id: "future", output: { mediaType: "text/plain", layout: "file" }, async export() { return { files: [] }; } };\n`,
      },
    },
    {
      // Its range admits this release, but its entry was stamped by a newer contract package.
      name: "mostra-fixture-newer-stamp",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/newer-stamp",
          contracts: { exporter: `>=${range("exporter")}` },
          contributes: { exporters: [{ id: "newer", entry: "./exporter.js" }] },
          license: "MIT",
        },
      },
      files: {
        "exporter.js": `export default { contract: { name: "exporter", version: "9.0.0" }, id: "newer", output: { mediaType: "text/plain", layout: "file" }, async export() { return { files: [] }; } };\n`,
      },
    },
    {
      // A non-OSI engine, as Remotion's npm package ships: an unreadable license field, a
      // postinstall that must not run before its license is accepted (D31, D95).
      name: "fixture-engine",
      version: "2.0.0",
      manifest: {
        license: "SEE LICENSE IN LICENSE.md",
        scripts: {
          // In its own package directory, where a test looks for it.
          postinstall: "node -e \"require('fs').writeFileSync('engine-installed.txt', 'yes')\"",
        },
      },
      files: {
        "index.js": "module.exports = { engine: true };\n",
        "LICENSE.md": "Fixture Engine License: free for individuals; companies need a license.\n",
      },
    },
    {
      // The plugin that brings it, declaring its license so Mostra can disclose it.
      name: "mostra-fixture-engine-plugin",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        dependencies: { "fixture-engine": "2.0.0" },
        mostra: {
          name: "dev.mostra.fixtures/engine",
          contracts: { exporter: `^${range("exporter")}` },
          contributes: { exporters: [{ id: "engine-video", entry: "./exporter.js" }] },
          license: "MIT",
          bundledLicenses: [
            {
              package: "fixture-engine",
              license: "LicenseRef-FixtureEngine",
              class: "source-available",
              summary: "Free for individuals; companies need a license.",
              url: "https://example.com/fixture-engine/license",
            },
          ],
        },
      },
      files: {
        "exporter.js": `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "engine-video", output: { mediaType: "video/mp4", layout: "file" }, async export() { return { files: [] }; } };\n`,
      },
    },
    {
      // An engine runs in the page: such a plugin belongs to one artifact, never the home.
      name: "mostra-fixture-page-engine",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/page-engine",
          contracts: { "embed-engine": `^${range("embed-engine")}` },
          contributes: { embedEngines: [{ id: "marquee", entry: "./engine.js" }] },
          license: "MIT",
        },
      },
      files: {
        "engine.js": `export default { contract: { name: "embed-engine", version: ${JSON.stringify(implemented("embed-engine"))} }, id: "marquee", sources: ["text"], mount() { return { dispose() {} }; } };\n`,
      },
    },
    {
      // An exporter whose child dies in the middle of an export.
      name: "mostra-fixture-crash",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/crash",
          contracts: { exporter: `^${range("exporter")}` },
          contributes: { exporters: [{ id: "crash", entry: "./exporter.js" }] },
          license: "MIT",
        },
      },
      files: {
        "exporter.js": `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "crash", output: { mediaType: "text/plain", layout: "file" }, async export() { process.exit(7); } };\n`,
      },
    },
    {
      // Stands in for class-variance-authority, which shadcn's button imports (Apache-2.0, as the real one).
      name: "class-variance-authority",
      version: "0.7.1",
      manifest: { type: "module", license: "Apache-2.0", main: "./index.js" },
      files: {
        "index.js": [
          "export function cva(base, config = {}) {",
          "  return (props = {}) => {",
          "    const classes = [base];",
          "    for (const [name, values] of Object.entries(config.variants ?? {})) {",
          "      const value = props[name] ?? config.defaultVariants?.[name];",
          "      if (value !== undefined && values[value]) classes.push(values[value]);",
          "    }",
          "    if (props.className) classes.push(props.className);",
          '    return classes.filter(Boolean).join(" ");',
          "  };",
          "}",
          "",
        ].join("\n"),
      },
    },
    {
      // A plugin that carries a source pack, for `mostra add plugin:<package>/<item>`.
      name: "mostra-fixture-pack",
      version: "1.0.0",
      manifest: {
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/pack",
          contracts: {},
          contributes: { packs: [{ item: "./registry/greeting.json" }] },
          license: "MIT",
        },
      },
      files: {
        "registry/greeting.json": `${JSON.stringify(
          {
            $schema: "https://ui.shadcn.com/schema/registry-item.json",
            name: "greeting",
            type: "registry:component",
            files: [
              {
                path: "registry/greeting.tsx",
                type: "registry:component",
                content:
                  'export function Greeting() {\n  return <p className="greeting">Hello from a pack</p>;\n}\n',
              },
            ],
            cssVars: { theme: { "color-greeting": "oklch(0.6 0.2 30)" } },
            mostra: { base: "base", fields: ["greeting.name"], license: "MIT" },
          },
          null,
          2,
        )}\n`,
      },
    },
  ];
}
