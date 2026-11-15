/**
 * Diagnostic codes of the PLUGIN area: plugins, their manifests, contracts and contributions (D30, INTERFACES §14).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the PLUGIN area, in the order they were added. */
export const pluginDiagnosticCodes = [
  "MOSTRA_PLUGIN_MANIFEST_INVALID",
  "MOSTRA_PLUGIN_MANIFEST_WARNING",
  "MOSTRA_PLUGIN_NOT_A_PLUGIN",
  "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED",
  "MOSTRA_PLUGIN_CONFLICT",
  "MOSTRA_PLUGIN_ENTRY_INVALID",
  "MOSTRA_PLUGIN_SCOPE_INVALID",
  "MOSTRA_PLUGIN_NOT_INSTALLED",
  "MOSTRA_PLUGIN_PLATFORM_UNSUPPORTED",
  "MOSTRA_PLUGIN_EXPORTER_UNKNOWN",
  "MOSTRA_PLUGIN_FAILED",
  "MOSTRA_PLUGIN_OPTIONS_INVALID",
  "MOSTRA_PLUGIN_SHADOWED",
  // gen:codes
] as const;

/** The codes of the PLUGIN area. */
export type PluginDiagnosticCode = (typeof pluginDiagnosticCodes)[number];

/** The PLUGIN area's catalog entries. */
export const pluginDiagnostics: AreaCatalog<PluginDiagnosticCode> = {
  MOSTRA_PLUGIN_MANIFEST_INVALID: {
    severity: "error",
    phase: "manifest",
    title: "Plugin manifest invalid",
    hint: "Fix the field this diagnostic names in the plugin's package.json, then run `mostra plugin validate` again.",
    docs: {
      explanation:
        "A field of the plugin's manifest, the `\"mostra\"` key of its `package.json`, isn't one Mostra can load: a required field is missing, a value has the wrong form, a contribution kind has no contract range, an ID is contributed twice, a command would take one of `mostra`'s own words, or a license isn't an SPDX expression. The location points at the field, and `mostra plugin validate` reports every one at once.",
      fix: "Correct the field (the message says what it expects) and validate again. The manifest's shape is published as JSON Schema in `@mostra/protocol/schemas/plugin-manifest.schema.json`.",
    },
  },
  MOSTRA_PLUGIN_MANIFEST_WARNING: {
    severity: "warning",
    phase: "manifest",
    title: "Plugin manifest questionable",
    hint: "Check the field this diagnostic names; Mostra loads the plugin and ignores what it doesn't know.",
    docs: {
      explanation:
        "The plugin's manifest has something this Mostra release loads around: a key it doesn't know, an effect or a system it doesn't know, or a contract declared with nothing contributed to it. Manifests grow additively, so a newer plugin may carry keys an older Mostra skips; a misspelled key is skipped the same way, which can leave a contribution or a license undeclared.",
      fix: "Correct the field if it is a mistake. If it is something a newer Mostra reads, nothing is needed.",
    },
  },
  MOSTRA_PLUGIN_NOT_A_PLUGIN: {
    severity: "error",
    phase: "manifest",
    title: "Not a Mostra plugin",
    hint: 'Add the package with `mostra add` if it is an ordinary package, or give it a "mostra" manifest if it is a plugin.',
    docs: {
      explanation:
        'The package has no `"mostra"` key in its `package.json`, so it contributes nothing Mostra could load. `mostra plugin add` installs only plugins; ordinary npm packages go through `mostra add`.',
      fix: "Run `mostra add <package> --artifact <path>` for an ordinary package. For a plugin you write, add the manifest (`mostra docs guide/plugins`) and run `mostra plugin validate`.",
    },
  },
  MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED: {
    severity: "error",
    phase: "contract",
    title: "Contract version not implemented",
    hint: "Install a version of the plugin built for this Mostra's contracts, or update Mostra.",
    docs: {
      explanation:
        "The plugin declares a contract range, or carries a definition stamped with a contract version, that this Mostra release doesn't serve. Each extension contract is its own package with its own version (D30): within a line changes are additive, so Mostra serves stamps of its line up to the version it implements, and a range must admit that version. The message names the contract, the plugin's range or stamp, and the version this release implements. Mostra reports it when the plugin is added, and when `verify` or `publish` loads it, so an artifact whose plugin a newer runtime no longer serves is told before it is published.",
      fix: "Add a release of the plugin whose range admits the version the message names (`mostra plugin add <package>@<version> --artifact <path>`), or run a Mostra release that implements the plugin's contract version, or remove the plugin with `mostra plugin remove`.",
    },
  },
  MOSTRA_PLUGIN_CONFLICT: {
    severity: "error",
    phase: "contract",
    title: "Plugins contribute the same ID",
    hint: "Remove one of the two plugins the message names, or use releases whose IDs differ.",
    docs: {
      explanation:
        "Two plugins of one artifact, or one of the artifact's and one of the home's, contribute the same ID to the same contract (two exporters `pdf`, two commands `term record`), or a plugin takes an ID Mostra builds in (the exporters `static`, `html`, `bundle` and `snapshot`). Nothing is overridden silently (ROUND-3 \u00a76.4): the message names both sides.",
      fix: "Remove one plugin with `mostra plugin remove <package> --artifact <path>` (or `--global`), then add the other again if needed.",
    },
  },
  MOSTRA_PLUGIN_ENTRY_INVALID: {
    severity: "error",
    phase: "contract",
    title: "Plugin entry doesn't load",
    hint: "Fix the module the message names so it exports the definition its contract's define function returns.",
    docs: {
      explanation:
        "A contribution's `entry` module is missing from the package, leaves it, failed to load, or doesn't export (at `export`, `default` when absent) a definition stamped by the contract's blueprint (`defineExporter`, `defineCliCommand` \u2026) with the ID the manifest gives. Mostra reads the stamp from the loaded object itself, in a child process of the instance, so a manifest alone can't claim a contract. Contributions that run in the page (embed engines, anchor providers) are checked when the page uses them.",
      fix: "Build the plugin so the module exists, export the value its `define*` function returns, and keep the manifest's ID equal to the definition's. Then run `mostra plugin validate <dir>`.",
    },
  },
  MOSTRA_PLUGIN_SCOPE_INVALID: {
    severity: "error",
    phase: "contract",
    title: "Plugin can't be installed there",
    hint: "Install the plugin for an artifact with `--artifact`, or pass exactly one of `--artifact` and `--global`.",
    docs: {
      explanation:
        "Plugins are installed for one artifact (recorded in its lockfile, part of its versions) or, when they contribute only exporters and CLI commands, for the whole home (ROUND-3 \u00a76.4). This plugin contributes something that changes what an artifact's version is (an embed engine, a verify check, an anchor provider, a connector or a pack), so it can't be installed for the home; or the call named both scopes or neither.",
      fix: "Run `mostra plugin add <package> --artifact <path>` for each artifact that uses it.",
    },
  },
  MOSTRA_PLUGIN_NOT_INSTALLED: {
    severity: "error",
    phase: "host",
    title: "Plugin not installed",
    hint: "Check the package name against `mostra plugin list`.",
    docs: {
      explanation:
        "The package isn't one of the plugins of the artifact (or of the home) the call names, so there is nothing to remove.",
      fix: "List the scope's plugins with `mostra plugin list --artifact <path>` (or `--global`) and use a name from it.",
    },
  },
  MOSTRA_PLUGIN_PLATFORM_UNSUPPORTED: {
    severity: "warning",
    phase: "platform",
    title: "Plugin doesn't name this system",
    hint: "Expect the plugin's Node.js parts to fail here, or use a plugin that supports this system.",
    docs: {
      explanation:
        "The plugin's manifest lists the systems it runs on (`platforms`), and this one isn't among them. Mostra installs it anyway (it adds no capability limits), and says so, since its exporters, checks, connectors or commands may fail here.",
      fix: "Use the plugin on a system it lists, or ask its author to support this one.",
    },
  },
  MOSTRA_PLUGIN_EXPORTER_UNKNOWN: {
    severity: "error",
    phase: "host",
    title: "No such exporter",
    hint: "Use one of the exporters the message lists, or add a plugin that contributes this one.",
    docs: {
      explanation:
        "`mostra export <artifact> --as <id> --out <path>` names an exporter that neither Mostra builds in nor any plugin of the artifact or the home contributes. The message lists every exporter available for the artifact.",
      fix: "Pick an exporter from the list, or install a plugin that contributes it: `mostra plugin add <package> --artifact <path>`.",
    },
  },
  MOSTRA_PLUGIN_FAILED: {
    severity: "error",
    phase: "runtime",
    title: "Plugin failed",
    hint: "Read the plugin's error in the message and report it to the plugin's author if it isn't yours to fix.",
    docs: {
      explanation:
        "A plugin's contribution threw, returned something its contract doesn't allow (a file outside the export, a result that isn't JSON), or ran past its time limit while Mostra ran it. It runs in a child process of the instance, so the instance and other artifacts are unaffected; nothing it returned was kept.",
      fix: "Fix the contribution if it is your plugin; otherwise update or remove it (`mostra plugin remove`).",
    },
  },
  MOSTRA_PLUGIN_OPTIONS_INVALID: {
    severity: "error",
    phase: "contract",
    title: "Exporter options invalid",
    hint: "Give the options the exporter's schema asks for, each as `--option name=value`.",
    docs: {
      explanation:
        "The options given to a plugin's exporter don't fit the JSON Schema its definition declares (`options`), or it declares none and was given some. Mostra checks them in the plugin's child before the exporter runs, so nothing was exported.",
      fix: "Read the exporter's options in its plugin's documentation (`mostra plugin list` names the plugin), and run `mostra export <artifact> --as <exporter> --out <path> --option name=value` with them. A value that reads as JSON (`3`, `true`, `[\"a\"]`) is passed as that value, anything else as text.",
    },
  },
  MOSTRA_PLUGIN_SHADOWED: {
    severity: "warning",
    phase: "contract",
    title: "Plugin contribution shadowed",
    hint: "Remove one of the two plugins if the artifact should use the other's contribution.",
    docs: {
      explanation:
        "An artifact's plugin and one of the home's (`--global`) contribute the same exporter or CLI command. Nothing is refused: in this artifact its own plugin's contribution is used, and the home's everywhere else. A home install never breaks an artifact that worked.",
      fix: "Nothing is needed when the artifact's own contribution is the one it should use. Otherwise remove it from the artifact (`mostra plugin remove <package> --artifact <path>`), and the home's is used.",
    },
  },
  // gen:entries
};
