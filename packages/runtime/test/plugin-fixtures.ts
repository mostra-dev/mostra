/**
 * Plugin fixtures (WP-16): npm packages the local registry (`registry.ts`) serves, so `plugin/*`
 * and `pack/add` run against a real pnpm install. Two depend on the real contract packages, built
 * from this repository and served as they would be published; the rest stamp by hand where a test
 * needs a stamp no `define*` would make.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLUGIN_CONTRACTS } from "@mostra/protocol/plugin";
import { oklch, THEME_REVISION } from "@mostra/themes";
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
    // Published now, as a contract is on its release's first day: plugins on it install at
    // once, whatever the release age (D173).
    time: new Date().toISOString(),
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
  const list = base(exporter, command);
  return [...list, ...reviewFixtures(list), ownMcpApp(), themePlugin()];
}

/** The primary colour the fixture theme gives (D181 item 4): a dark teal at AA on white. */
export const HARBOR_PRIMARY = oklch(0.42, 0.09, 200);

/**
 * The bytes of the fixture theme's face, which a page wearing it serves from the plugin: past the
 * build's 4 KiB inlining limit, as every real face is, so it is a file of the page's own.
 */
export const HARBOR_FACE = `wOF2 harbor display, a fixture\n${"harbor ".repeat(1024)}`;

/**
 * A plugin that contributes a theme layer (D181 item 4): a primary colour and a display face of
 * its own, its file in the plugin's own package, as a marketplace's theme would arrive.
 */
function themePlugin(): FixturePackage {
  const layer = {
    revision: THEME_REVISION,
    id: "harbor",
    name: "Harbor",
    description: "A fixture layer: a teal main action and a display face of its own.",
    modes: { light: { primary: HARBOR_PRIMARY, ring: HARBOR_PRIMARY } },
    faces: {
      display: {
        family: "Harbor Display",
        fallback: "ui-serif, serif",
        files: [
          {
            file: "fonts/harbor-display.woff2",
            weight: "400 700",
            style: "normal",
            unicodeRange: "U+0000-00FF",
          },
        ],
      },
    },
  };
  return {
    name: "mostra-fixture-theme",
    version: "1.0.0",
    manifest: {
      type: "module",
      license: "MIT",
      mostra: {
        name: "dev.mostra.fixtures/theme",
        contracts: {},
        contributes: { themes: [{ theme: "./themes/harbor.json" }] },
        license: "MIT",
      },
    },
    files: {
      "themes/harbor.json": JSON.stringify(layer),
      "fonts/harbor-display.woff2": HARBOR_FACE,
    },
  };
}

/**
 * A plugin with an MCP App exporter of its own (exporter ID `mcp-app`): installed for the home,
 * it takes the place of the one every home has (D175 item 3).
 */
function ownMcpApp(): FixturePackage {
  return {
    name: "mostra-fixture-own-app",
    version: "1.0.0",
    manifest: {
      type: "module",
      license: "MIT",
      mostra: {
        name: "dev.mostra.fixtures/own-app",
        contracts: { exporter: `^${range("exporter")}` },
        contributes: { exporters: [{ id: "mcp-app", entry: "./exporter.js" }] },
        license: "MIT",
      },
    },
    files: {
      "exporter.js": `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "mcp-app", output: { mediaType: "text/html;profile=mcp-app", layout: "directory" }, async export({ version }) { return { files: [{ path: "index.html", content: "<!doctype html><title>own app</title>" }, { path: "mcp-app.json", content: JSON.stringify({ uri: "ui://mostra/view/" + version.versionId, _meta: { ui: { prefersBorder: true } } }) }], entry: "index.html" }; } };\n`,
    },
  };
}

/** An exporter entry stamped by hand, returning one file. */
const stampedExporter = (id: string): string =>
  `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: ${JSON.stringify(id)}, output: { mediaType: "text/plain", layout: "directory" }, async export() { return { files: [{ path: "out.txt", content: ${JSON.stringify(id)} }] }; } };\n`;

/**
 * The fixtures of the WP-16 review's cases: a plugin upgrade that brings a license nobody
 * acknowledged, a plugin whose non-OSI engine is a peer, a plugin that calls a closed package
 * MIT, a license whose class changed, a command another begins with, an install script that
 * fails.
 */
function reviewFixtures(list: readonly FixturePackage[]): FixturePackage[] {
  const words = list.find((pkg) => pkg.name === "mostra-fixture-words") as FixturePackage;
  const engine = list.find((pkg) => pkg.name === "mostra-fixture-engine-plugin") as FixturePackage;
  const manifest = (pkg: FixturePackage) => pkg.manifest as Record<string, unknown>;
  const mostra = (pkg: FixturePackage) => manifest(pkg)["mostra"] as Record<string, unknown>;
  return [
    {
      // Words 1.1.0 depends on the engine: an upgrade by `mostra add` brings its license. Its
      // time is older, so `latest` stays 1.0.0 for the tests that name no version.
      ...words,
      version: "1.1.0",
      time: "2025-12-01T00:00:00.000Z",
      manifest: {
        ...manifest(words),
        dependencies: {
          ...(manifest(words)["dependencies"] as Record<string, string>),
          "fixture-engine": "2.0.0",
        },
      },
    },
    {
      // The same engine, now declared proprietary: an earlier acknowledgment doesn't carry over.
      ...engine,
      version: "1.1.0",
      time: "2025-12-01T00:00:00.000Z",
      manifest: {
        ...manifest(engine),
        mostra: {
          ...mostra(engine),
          bundledLicenses: [
            {
              package: "fixture-engine",
              license: "LicenseRef-FixtureEngine",
              class: "proprietary",
            },
          ],
        },
      },
    },
    {
      // The engine as a peer, which the installer installs (`auto-install-peers`).
      name: "mostra-fixture-peer-plugin",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        peerDependencies: { "fixture-engine": "2.0.0" },
        mostra: {
          name: "dev.mostra.fixtures/peer",
          contracts: { exporter: `^${range("exporter")}` },
          contributes: { exporters: [{ id: "peer", entry: "./exporter.js" }] },
          license: "MIT",
        },
      },
      files: { "exporter.js": stampedExporter("peer") },
    },
    {
      // A package that says it is no one's to use.
      name: "fixture-closed",
      version: "1.0.0",
      manifest: { license: "UNLICENSED" },
      files: { "index.js": "module.exports = {};\n" },
    },
    {
      // A plugin that declares that closed package MIT, which Mostra can't confirm.
      name: "mostra-fixture-claims-mit",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        dependencies: { "fixture-closed": "1.0.0" },
        mostra: {
          name: "dev.mostra.fixtures/claims-mit",
          contracts: { exporter: `^${range("exporter")}` },
          contributes: { exporters: [{ id: "claims", entry: "./exporter.js" }] },
          // Its package.json says MIT: the manifest's word differs, and Mostra shows the field.
          license: "Apache-2.0",
          bundledLicenses: [{ package: "fixture-closed", license: "MIT" }],
        },
      },
      files: { "exporter.js": stampedExporter("claims") },
    },
    {
      // Its command is the first word of mostra-fixture-words' `words count`.
      name: "mostra-fixture-words-prefix",
      version: "1.0.0",
      manifest: {
        type: "module",
        license: "MIT",
        mostra: {
          name: "dev.mostra.fixtures/words-prefix",
          contracts: { "cli-command": `^${range("cli-command")}` },
          contributes: { cliCommands: [{ command: "words", entry: "./command.js" }] },
          license: "MIT",
        },
      },
      files: {
        "command.js": `export default { contract: { name: "cli-command", version: ${JSON.stringify(implemented("cli-command"))} }, path: ["words"], summary: "Words.", async run() { return { result: null }; } };\n`,
      },
    },
    {
      // An item's npm dependency whose install script fails.
      name: "fixture-failing-script",
      version: "1.0.0",
      manifest: {
        license: "MIT",
        scripts: { postinstall: 'node -e "process.exit(3)"' },
      },
      files: { "index.js": "module.exports = {};\n" },
    },
  ];
}

/** The fixtures every plugin test uses. */
function base(exporter: FixturePackage, command: FixturePackage): FixturePackage[] {
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
            exporters: [
              { id: "words", entry: "./exporter.js" },
              { id: "summary", entry: "./exporter.js", export: "summary" },
              { id: "clash", entry: "./exporter.js", export: "clash" },
            ],
            cliCommands: [{ command: "words count", entry: "./command.js" }],
          },
          effects: ["filesystem"],
          license: "MIT",
        },
      },
      files: {
        "exporter.js": [
          'import { defineExporter } from "@mostra/contract-exporter";',
          "// Server code is never an export's input, whichever way a path names it.",
          "const hidden = async (files) => {",
          "  let count = 0;",
          '  for (const path of ["server/entry.mjs", "./server/entry.mjs", "client/../server/entry.mjs", "SERVER/entry.mjs"]) {',
          "    try { await files.readText(path); } catch { count += 1; }",
          "  }",
          "  return count;",
          "};",
          "export default defineExporter({",
          '  id: "words",',
          '  output: { mediaType: "text/plain", layout: "directory" },',
          '  options: { type: "object", properties: { size: { type: "string", enum: ["a4", "letter"] } }, additionalProperties: false },',
          "  async export({ files, version, options }) {",
          '    const html = await files.readText("client/index.html");',
          "    const paths = await files.list();",
          "    const facts = {",
          "      server: version.server,",
          '      registry: typeof version.registry === "object" && version.registry !== null,',
          "      publishedAt: !Number.isNaN(Date.parse(version.publishedAt)),",
          "      hidden: await hidden(files),",
          '      listed: paths.some((path) => path.toLowerCase().startsWith("server")),',
          "    };",
          "    return {",
          "      files: [",
          '        { path: "words.txt", content: version.title + ": " + paths.length + " files, " + html.length + " bytes, " + JSON.stringify(options) + " " + JSON.stringify(facts) },',
          '        { path: "nested/bytes.bin", content: new Uint8Array([1, 2, 3]) },',
          "      ],",
          '      entry: "words.txt",',
          '      findings: [{ code: "COUNTED", severity: "hint", message: "Counted the files." }],',
          "    };",
          "  },",
          "});",
          "export const summary = defineExporter({",
          '  id: "summary",',
          '  output: { mediaType: "text/plain", layout: "file", extension: ".txt" },',
          "  async export({ version }) {",
          '    return { files: [{ path: "summary.txt", content: "version " + version.number }] };',
          "  },",
          "});",
          "export const clash = defineExporter({",
          '  id: "clash",',
          '  output: { mediaType: "text/plain", layout: "directory" },',
          "  async export() {",
          '    return { files: [{ path: "report", content: "a file" }, { path: "report/index.html", content: "under it" }] };',
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
        "exporter.js": `export default { contract: { name: "exporter", version: ${JSON.stringify(implemented("exporter"))} }, id: "words", output: { mediaType: "text/plain", layout: "directory" }, async export() { return { files: [{ path: "twin.txt", content: "twin" }] }; } };\n`,
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
