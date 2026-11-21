/**
 * The extension contracts Mostra implements (D30, ARCHITECTURE §13, ROUND-3 §6.1): each
 * contract's package, the versions of it this release serves, where its contributions run, the
 * manifest key that lists them and where a plugin with them may be installed.
 */
import type { ContractName, PluginScope } from "../plugins.ts";
import { CONTRACT_VERSIONS } from "./contract-versions.generated.ts";

/** One contract as this release implements it. */
export interface ContractInfo {
  /** Its name. */
  readonly name: ContractName;
  /** Its package: `@mostra/contract-<name>`. */
  readonly package: string;
  /**
   * The versions of it this release serves, newest last. A plugin's range must admit one, and
   * every stamp must be of a served line, at most that version (`stampCompatible`).
   */
  readonly implements: readonly string[];
  /** Where its contributions run: the artifact's page, or Node.js (a child of the instance). */
  readonly runs: "browser" | "node";
  /** The key of the manifest's `contributes` that lists its contributions. */
  readonly key: ContributesKey;
  /** Where a plugin contributing it may be installed (ROUND-3 §6.4). */
  readonly scopes: readonly PluginScope[];
}

/** The keys of a manifest's `contributes`, each a list of one kind of contribution. */
export type ContributesKey =
  | "embedEngines"
  | "exporters"
  | "verifyChecks"
  | "anchorProviders"
  | "connectors"
  | "cliCommands";

const info = (
  name: ContractName,
  key: ContributesKey,
  runs: "browser" | "node",
  scopes: readonly PluginScope[],
): ContractInfo => ({
  name,
  package: `@mostra/contract-${name}`,
  implements: [CONTRACT_VERSIONS[name]],
  runs,
  key,
  scopes,
});

/**
 * Every contract, by name. Exporters and CLI commands may also be installed for the whole home
 * (ROUND-3 §6.4); the others change what an artifact's version is, so they belong to one artifact
 * and its lockfile.
 */
export const PLUGIN_CONTRACTS: Readonly<Record<ContractName, ContractInfo>> = {
  "embed-engine": info("embed-engine", "embedEngines", "browser", ["artifact"]),
  exporter: info("exporter", "exporters", "node", ["artifact", "home"]),
  "verify-check": info("verify-check", "verifyChecks", "node", ["artifact"]),
  "anchor-provider": info("anchor-provider", "anchorProviders", "browser", ["artifact"]),
  connector: info("connector", "connectors", "node", ["artifact"]),
  "cli-command": info("cli-command", "cliCommands", "node", ["artifact", "home"]),
};

/** The contracts in their manifest order. */
export const CONTRACT_NAMES: readonly ContractName[] = Object.keys(
  PLUGIN_CONTRACTS,
) as ContractName[];

/** The exporters Mostra builds in (VR-07): a plugin's exporter can't take their IDs. */
export const BUILT_IN_EXPORTERS: readonly string[] = ["static", "html", "bundle", "snapshot"];

/**
 * Every command `mostra` has of its own (D60, INTERFACES §9), as its words: a plugin's command
 * may be none of them, nor a prefix of one, nor have one as its prefix. The CLI's tests keep this
 * list equal to its command table, plus the commands later packages add (`review export`, WP-20;
 * `term dump`, WP-22), which are reserved from today.
 */
export const CORE_COMMANDS: readonly (readonly string[])[] = [
  ["add"],
  ["daemon", "install"],
  ["daemon", "restart"],
  ["daemon", "start"],
  ["daemon", "status"],
  ["daemon", "stop"],
  ["daemon", "uninstall"],
  ["dev"],
  ["docs"],
  ["doctor"],
  ["export"],
  ["gc"],
  ["host"],
  ["list"],
  ["login"],
  ["logout"],
  ["mcp"],
  ["new"],
  ["open"],
  ["pause"],
  ["plugin", "add"],
  ["plugin", "list"],
  ["plugin", "remove"],
  ["plugin", "validate"],
  ["publish"],
  ["push"],
  ["results"],
  ["review", "export"],
  ["resume"],
  ["roster", "add"],
  ["roster", "get"],
  ["roster", "remove"],
  ["run"],
  ["secret", "list"],
  ["secret", "rm"],
  ["secret", "set"],
  ["share"],
  ["share", "list"],
  ["share", "stop"],
  ["state", "get"],
  ["state", "patch"],
  ["state", "set"],
  ["status"],
  ["telemetry", "off"],
  ["telemetry", "on"],
  ["telemetry", "status"],
  ["term", "dump"],
  ["theme", "list"],
  ["theme", "show"],
  ["verify"],
  ["wait"],
];

/** Whether a command path is taken by `mostra` itself (equal, or a prefix either way). */
export function coreCommandTaken(path: readonly string[]): readonly string[] | undefined {
  return CORE_COMMANDS.find((core) => {
    const shorter = Math.min(core.length, path.length);
    for (let index = 0; index < shorter; index += 1) {
      if (core[index] !== path[index]) return false;
    }
    return true;
  });
}

/** `major.minor.patch` of a release version, or `undefined`. */
function versionParts(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/**
 * Whether this release serves a definition stamped `stamp` for `contract`: the stamp names the
 * contract on a line this release implements (the major, and at 0.x the minor), as each contract
 * package's `stampCompatible` judges it. The version within the line is the manifest's range's to
 * decide, which the loader checks first (D172 item 2): a plugin whose caret range resolved a newer
 * patch of the contract package than this release's loads where its range admits this release's.
 */
export function stampServed(
  stamp: unknown,
  contract: ContractName,
  /** The versions served; this release's by default (a test stands in an older runtime's). */
  implemented: readonly string[] = PLUGIN_CONTRACTS[contract].implements,
): boolean {
  if (typeof stamp !== "object" || stamp === null) return false;
  const { name, version } = stamp as Record<string, unknown>;
  if (name !== contract || typeof version !== "string") return false;
  const theirs = versionParts(version);
  if (theirs === undefined) return false;
  return implemented.some((served) => {
    const ours = versionParts(served);
    if (ours === undefined || theirs[0] !== ours[0]) return false;
    return ours[0] !== 0 || theirs[1] === ours[1];
  });
}
