/**
 * Plugins and packs (D30, D31, INTERFACES §14): `plugin validate|add|list|remove`, thin clients of
 * `plugin/*`. `add` (in `authoring.ts`) installs packs through `pack/add`, and `export --as` runs a
 * plugin's exporter through `plugin/export`.
 */
import { resolve } from "node:path";
import {
  type LicenseDisclosure,
  type PluginSummary,
  pluginAddMethod,
  pluginListMethod,
  pluginRemoveMethod,
  pluginValidateMethod,
  type SourceRef,
} from "@mostra/protocol";
import { type CommandContext, type CommandDef, defineCommand, type FlagDef } from "../command.ts";
import { EXIT } from "../exit.ts";
import { usage } from "../parse.ts";
import { flag, sourceRef } from "./shared.ts";

/** `--artifact` and `--global`: where a plugin is installed (`--home` names the home itself). */
const SCOPE_FLAGS: readonly FlagDef[] = [
  {
    name: "artifact",
    kind: "string",
    value: "<path|id>",
    summary:
      "The artifact whose lockfile records the plugins. Default: the one in the current directory.",
  },
  {
    name: "global",
    kind: "boolean",
    summary:
      "The home's own plugins instead, for every artifact of the home (exporters and CLI commands only).",
  },
];

const ACCEPT_FLAG: FlagDef = {
  name: "accept-license",
  kind: "list",
  value: "<id>",
  summary:
    "Acknowledge a license the install brings (LicenseRef-Remotion), recorded in the lockfile. Repeat or comma-separate.",
};

/** The scope the flags name: the home, or an artifact (the current directory's by default). */
function scope(context: CommandContext): { artifact: SourceRef } | { home: true } {
  if (context.flags["global"] === true) {
    if (flag(context, "artifact") !== undefined)
      throw usage("Give --artifact or --global, not both.");
    return { home: true };
  }
  return { artifact: sourceRef(flag(context, "artifact") ?? ".", context.cwd) };
}

/** The list of a `list` flag. */
function list(context: CommandContext, name: string): string[] {
  const value = context.flags[name];
  return Array.isArray(value) ? [...value] : [];
}

/** People's view of plugins: one line each, then what loading them found. */
function describePlugins(plugins: readonly PluginSummary[]): string {
  if (plugins.length === 0) return "No plugins.\n";
  return plugins
    .map((plugin) => {
      const lines = [
        `${plugin.package}@${plugin.version} (${plugin.name}, ${plugin.scope}): ${plugin.contributions.map((item) => `${item.contract} ${item.id}`).join(", ") || "packs only"}${plugin.status === "error" ? "  [doesn't load]" : ""}`,
      ];
      for (const diagnostic of plugin.diagnostics) {
        lines.push(`  ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
      }
      return lines.join("\n");
    })
    .join("\n")
    .concat("\n");
}

/** People's view of licenses: each with its class and where its acknowledgment stands. */
function describeLicenses(licenses: readonly LicenseDisclosure[]): string {
  if (licenses.length === 0) return "";
  return `Licenses:\n${licenses
    .map(
      (license) =>
        `  ${license.id} (${license.class}, ${license.acknowledgment}): ${license.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`,
    )
    .join("\n")}\n`;
}

/** `mostra plugin validate [dir]`. */
export const pluginValidateCommand: CommandDef = defineCommand({
  path: ["plugin", "validate"],
  summary:
    "Check a plugin package as Mostra would load it: its manifest, contract ranges, entries and licenses.",
  args: [
    {
      name: "dir",
      summary: "The plugin's package directory. Default: the current directory.",
      optional: true,
    },
  ],
  output: { type: "PluginValidateResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "plugin validate ./my-plugin",
  async run(context) {
    const dir = typeof context.args["dir"] === "string" ? context.args["dir"] : ".";
    const result = await context.call(pluginValidateMethod, { path: resolve(context.cwd, dir) });
    const lines = result.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.severity} ${diagnostic.code}${diagnostic.location && "file" in diagnostic.location ? ` (${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.column})` : ""}: ${diagnostic.message}`,
    );
    return {
      result,
      human: `${result.valid ? "valid" : "invalid"}${result.plugin ? `: ${result.plugin.package}@${result.plugin.version} (${result.plugin.name})` : ""}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`,
      ...(result.valid ? {} : { exit: EXIT.failure }),
    };
  },
});

/** `mostra plugin add <package…>`. */
export const pluginAddCommand: CommandDef = defineCommand({
  path: ["plugin", "add"],
  summary:
    "Install plugins for an artifact or the home, checking their contracts, conflicts and licenses first.",
  args: [
    {
      name: "package",
      summary: "npm specs of the plugins: name, name@version or name@range.",
      variadic: true,
    },
  ],
  flags: [
    ...SCOPE_FLAGS,
    ACCEPT_FLAG,
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "PluginAddResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "plugin add mostra-plugin-pdf --artifact ./report",
  async run(context) {
    const packages = context.args["package"];
    if (!Array.isArray(packages) || packages.length === 0)
      throw usage('"mostra plugin add" needs <package…>.');
    const accept = list(context, "accept-license");
    const requestId = flag(context, "request-id");
    const result = await context.call(pluginAddMethod, {
      ...scope(context),
      packages: packages as string[],
      ...(accept.length > 0 ? { acceptLicenses: accept } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result,
      human: `${describePlugins(result.plugins)}${describeLicenses(result.licenses)}`,
    };
  },
});

/** `mostra plugin list`. */
export const pluginListCommand: CommandDef = defineCommand({
  path: ["plugin", "list"],
  summary:
    "List an artifact's plugins, or the home's, in load order, as verify and publish load them now.",
  flags: [...SCOPE_FLAGS],
  output: { type: "PluginListResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "plugin list --artifact ./report",
  async run(context) {
    const result = await context.call(pluginListMethod, scope(context));
    return {
      result,
      human: `${describePlugins(result.plugins)}${describeLicenses(result.licenses)}`,
    };
  },
});

/** `mostra plugin remove <package…>`. */
export const pluginRemoveCommand: CommandDef = defineCommand({
  path: ["plugin", "remove"],
  summary: "Take plugins out of an artifact's lockfile, or the home's.",
  args: [{ name: "package", summary: "The plugins' package names.", variadic: true }],
  flags: [
    ...SCOPE_FLAGS,
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retry return the first attempt's result.",
    },
  ],
  output: { type: "PluginRemoveResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "plugin remove mostra-plugin-pdf --artifact ./report",
  async run(context) {
    const packages = context.args["package"];
    if (!Array.isArray(packages) || packages.length === 0)
      throw usage('"mostra plugin remove" needs <package…>.');
    const requestId = flag(context, "request-id");
    const result = await context.call(pluginRemoveMethod, {
      ...scope(context),
      packages: packages as string[],
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return {
      result,
      human: `Removed ${result.removed.join(", ")}.\n${describePlugins(result.plugins)}`,
    };
  },
});
