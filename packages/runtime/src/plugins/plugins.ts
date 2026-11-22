/**
 * Plugins (D30, D31, INTERFACES §14; EX-01, EX-02, EX-04): npm packages with a `"mostra"`
 * manifest, installed for one artifact (recorded in its working lockfile, frozen into each
 * version's `lock.yaml`) or for the whole home (exporters and CLI commands, ROUND-3 §6.4).
 *
 * Every lockfile that names plugins passes one gate (`admit`, D172 items 5, 7 and 8), whoever
 * changes or uses it: `plugin/add` and `plugin/remove`, `pack/add`, `deps/add`, and the resolution
 * of `verify` and `publish` (the deps module calls it). In this order, each refusing before the
 * next starts:
 * 1. each manifest (`checkPluginManifest`), its contract ranges against what this release
 *    implements, the scope it is installed in, and conflicts within the scope (two plugins with
 *    one ID, a command that begins another's, an ID Mostra builds in);
 * 2. the licenses of everything the change brings, classed (D31), while the install's lifecycle
 *    scripts are held: one that needs an acknowledgment and has none refuses before any of the
 *    packages' code or scripts have run;
 * 3. the held scripts, then each Node.js entry, loaded in a plugin child (never the supervisor,
 *    RT-02), which must export a definition stamped with its contract on a line this release
 *    serves.
 *
 * ```ts
 * const plugins = createPlugins({ home, dependencies, processes, log, env, policy });
 * await plugins.add({ kind: "artifact", target }, { packages: ["mostra-pdf"], accept: [] });
 * createDependencies({ …, plugins: () => plugins }); // verify, publish and deps/add pass the gate
 * ```
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ContractName,
  createDiagnostic,
  type Diagnostic,
  type LicenseClass,
  type LicenseDisclosure,
  type LicensedPackage,
  type LicensePolicy,
  type PluginAddResult,
  type PluginCommandInfo,
  type PluginContribution,
  type PluginListResult,
  type PluginRemoveResult,
  type PluginScope,
  type PluginSummary,
  type PluginValidateResult,
  RpcError,
} from "@mostra/protocol";
import {
  ACKNOWLEDGED_CLASSES,
  BUILT_IN_EXPORTERS,
  type BundledLicense,
  CONTRACT_NAMES,
  checkPluginManifest,
  formatLicenseExpression,
  isLicenseRef,
  type LicenseTerm,
  licenseTerms,
  manifestScopes,
  PLUGIN_CONTRACTS,
  type PluginManifest,
  packageLicense,
  packageLicenseTerms,
  parseLicenseExpression,
  spdxLicense,
  stampServed,
} from "@mostra/protocol/plugin";
import { defineThemeLayer, ThemeError, type ThemeLayer } from "@mostra/themes";
import semver from "semver";
import type {
  Dependencies,
  DependencyTarget,
  Lock,
  LockLicense,
  PluginGate,
  StagedChange,
} from "../deps/index.ts";
import { parseLock, runtimeRoot } from "../deps/index.ts";
import type { RequestKey } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { OS, shellWord } from "../platform/index.ts";
import { artifactEnvironment, type ProcessManager } from "../processes/index.ts";
import {
  EXPORT_METHOD,
  type ExportRequest,
  type ExportResponse,
  INSPECT_METHOD,
  type InspectedEntry,
} from "./child-protocol.ts";
import { jsonLocation } from "./location.ts";

/**
 * `MOSTRA_TEST_CONTRACT_VERSIONS` (tests only): JSON naming, by contract, the versions a runtime
 * stood in for serves, `{"exporter":["0.0.0"]}`; the others keep this release's.
 */
export function testContractVersions(text: string): (contract: ContractName) => readonly string[] {
  const parsed = JSON.parse(text) as Partial<Record<ContractName, string[]>>;
  return (contract) => parsed[contract] ?? PLUGIN_CONTRACTS[contract].implements;
}

/** Where a plugin call acts: one artifact's lockfile, or the home's own. */
export type Scope =
  | { readonly kind: "artifact"; readonly target: DependencyTarget }
  | { readonly kind: "home" };

/** Options for {@link createPlugins}. */
export interface PluginsOptions {
  /** The home's real path: the home's own plugins install from `<home>/plugins`. */
  readonly home: string;
  readonly dependencies: Dependencies;
  readonly processes: ProcessManager;
  readonly log: Log;
  /** The supervisor's environment, from which plugin children get the artifact environment. */
  readonly env: Environment;
  /** The home's license policy (`HomeConfig.licenses`), read at each install. */
  readonly policy: () => LicensePolicy | undefined;
  /** This runtime's release, which exporters are told. */
  readonly runtimeVersion: string;
  /**
   * The contract versions this runtime serves: `PLUGIN_CONTRACTS`' by default. Tests stand in a
   * runtime that serves others (`MOSTRA_TEST_CONTRACT_VERSIONS`), to see a recorded plugin go out
   * of range at load (ROUND-3 §6.4).
   */
  readonly implemented?: (contract: ContractName) => readonly string[];
  /** How long one plugin child may take: loading entries, or an export. Default 120 s. */
  readonly childTimeoutMs?: number;
  /**
   * The directories of the first-party plugins this runtime carries (D175 item 3): every home has
   * them, below its own plugins and an artifact's (scope `bundled`). Never imported here: like any
   * plugin, their code runs only in a plugin child (RT-02).
   */
  readonly bundled?: readonly string[];
}

/**
 * The first-party plugins this runtime carries (D175 item 3): each built package's directory, the
 * runtime bundle's (`@mostra/plugin-*` beside `@mostra/runtime`) or this repository's
 * (`plugins/*`). `MOSTRA_BUNDLED_PLUGINS` (directories separated by the platform's path
 * delimiter) replaces them, an empty value naming none, for a test that runs without them.
 */
export function locateBundledPlugins(env: Environment): readonly string[] {
  const given = env["MOSTRA_BUNDLED_PLUGINS"];
  if (given !== undefined) return given.split(delimiter).filter((dir) => dir !== "");
  const found: string[] = [];
  for (const short of ["mcp-app"]) {
    for (const dir of [
      resolve(runtimeRoot(), "..", `plugin-${short}`),
      resolve(runtimeRoot(), "..", "..", "plugins", short),
    ]) {
      if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "dist", "index.js"))) {
        found.push(dir);
        break;
      }
    }
  }
  return found;
}

/** The plugins of one instance; the deps module's plugin gate. */
export interface Plugins extends PluginGate {
  /**
   * `plugin/validate`: a plugin package as Mostra would load it, installing nothing. Its entries
   * load only when every license it brings that needs an acknowledgment has one (`accept`).
   */
  validate(path: string, accept: readonly string[]): Promise<PluginValidateResult>;
  /** `plugin/add`. */
  add(
    scope: Scope,
    input: {
      readonly packages: readonly string[];
      readonly accept: readonly string[];
      readonly request?: RequestKey | undefined;
    },
  ): Promise<PluginAddResult>;
  /** `plugin/list`. */
  list(scope: Scope): Promise<PluginListResult>;
  /** `plugin/remove`. */
  remove(
    scope: Scope,
    input: { readonly packages: readonly string[]; readonly request?: RequestKey | undefined },
  ): Promise<PluginRemoveResult>;
  /**
   * The gate for a change another module makes (a pack's items and npm packages): the scope's
   * plugins as they were, the licenses of `packages` (their closures) and `items`, the held
   * scripts, the entries. Answers the lockfile's plugins and acknowledgments after the change, and
   * the disclosures of what the change itself brought.
   */
  admitChange(
    scope: Scope,
    input: {
      readonly staged: StagedChange;
      readonly packages?: readonly string[];
      readonly items?: readonly ItemLicense[];
      readonly accept: readonly string[];
      readonly command: string;
    },
  ): Promise<{
    readonly plugins: readonly string[];
    readonly licenses: Readonly<Record<string, LockLicense>>;
    readonly disclosures: readonly LicenseDisclosure[];
  }>;
  /**
   * The exporters a version can use: its own plugins, as its `lock.yaml` froze them, in the
   * layout it was built against; then the home's (an artifact's own wins over the home's of one
   * ID). An exporter whose plugin this release can't load carries the refusal as `problem`.
   */
  exporters(input: {
    readonly artifactId: string;
    readonly versionDir: string;
    readonly sourceDir?: string;
  }): Promise<readonly ExporterRef[]>;
  /**
   * The CLI commands an artifact's plugins and the home's contribute (the artifact's own wins),
   * read from layouts already installed: a lookup never starts an install.
   */
  commands(target: DependencyTarget | undefined): Promise<readonly PluginCommandInfo[]>;
  /**
   * The file of the pack item `item` (its `name`) that the plugin `pkg` carries, among the
   * artifact's plugins and the home's, for `mostra add plugin:<package>/<item>`.
   */
  packItem(target: DependencyTarget, pkg: string, item: string): Promise<string | undefined>;
  /**
   * Runs an exporter on a version's directory, in a plugin child, which checks its stamp, its ID
   * and the options against its schema before it runs (D172 item 9).
   */
  runExport(input: {
    readonly exporter: ExporterRef;
    readonly versionDir: string;
    readonly version: Readonly<Record<string, unknown>>;
    readonly options: Readonly<Record<string, unknown>>;
  }): Promise<ExportDone>;
}

/** What an exporter that ran returned. */
export type ExportDone = Exclude<ExportResponse, { readonly refused: unknown }>;

/** An exporter a plugin contributes, as `plugin/export` runs it. */
export interface ExporterRef {
  readonly id: string;
  readonly package: string;
  readonly scope: PluginScope;
  readonly file: string;
  readonly export: string;
  readonly dir: string;
  /** Why its plugin can't load here (a contract this release doesn't serve): the export refuses. */
  readonly problem?: Diagnostic;
}

/** A plugin package as it is installed (or as `plugin/validate` finds it). */
interface Installed {
  readonly name: string;
  readonly version: string;
  /** Its package directory, real. */
  readonly dir: string;
  readonly packageFile: string;
  readonly text: string;
  readonly json: Record<string, unknown>;
  /** The manifest, when it has no error. */
  readonly manifest?: PluginManifest;
  /** What its manifest check found, located in `package.json`. */
  readonly issues: readonly Diagnostic[];
  readonly scope: PluginScope;
}

/** The key of the home's own working lockfile. */
const HOME_KEY = "home:plugins";

/** The plugin child's entry: the compiled one beside the compiled supervisor, else the source. */
/** The plugin child's entry, in this runtime's source or build. */
export function childEntry(): string {
  return fileURLToPath(import.meta.url).endsWith(".ts")
    ? join(runtimeRoot(), "src/plugins/child/host.ts")
    : join(runtimeRoot(), "dist/plugins/child/host.js");
}

/** `inner` is `outer` or inside it (both real paths). */
function isInside(outer: string, inner: string): boolean {
  const from = relative(outer, inner);
  return from === "" || (!from.startsWith(`..${sep}`) && from !== ".." && !isAbsolute(from));
}

const error = (code: Parameters<typeof createDiagnostic>[0], message: string): RpcError =>
  new RpcError(createDiagnostic(code, { message }));

/** Creates the plugins of one instance. */
export function createPlugins(options: PluginsOptions): Plugins {
  const implementedOf = (contract: ContractName): readonly string[] =>
    options.implemented?.(contract) ?? PLUGIN_CONTRACTS[contract].implements;
  const { dependencies, log } = options;
  const homeTarget: DependencyTarget = {
    key: HOME_KEY,
    artifactDir: join(options.home, "plugins"),
    artifactPath: "--global",
  };
  const childTimeoutMs = options.childTimeoutMs ?? 120_000;

  const targetOf = async (scope: Scope): Promise<DependencyTarget> => {
    if (scope.kind === "artifact") return scope.target;
    await mkdir(homeTarget.artifactDir, { recursive: true });
    return homeTarget;
  };

  /** Reads a package directory's `package.json` and manifest. */
  const readPackage = async (dir: string, scope: PluginScope): Promise<Installed> => {
    const real = realpathSync(dir);
    const packageFile = join(real, "package.json");
    const text = await readFile(packageFile, "utf8");
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new RpcError(
        createDiagnostic("MOSTRA_PLUGIN_MANIFEST_INVALID", {
          message: `${packageFile} isn't JSON.`,
          location: { file: packageFile, line: 1, column: 1 },
        }),
      );
    }
    const name = typeof json["name"] === "string" ? json["name"] : "";
    const version = typeof json["version"] === "string" ? json["version"] : "0.0.0";
    const issues: Diagnostic[] = [];
    let manifest: PluginManifest | undefined;
    if (json["mostra"] !== undefined) {
      const check = checkPluginManifest(json["mostra"]);
      manifest = check.manifest;
      for (const issue of check.issues) {
        issues.push(
          createDiagnostic(
            issue.severity === "error"
              ? "MOSTRA_PLUGIN_MANIFEST_INVALID"
              : "MOSTRA_PLUGIN_MANIFEST_WARNING",
            {
              message: `${issue.path.join(".")}: ${issue.message}`,
              location: { file: packageFile, ...jsonLocation(text, issue.path) },
            },
          ),
        );
      }
    }
    return {
      name,
      version,
      dir: real,
      packageFile,
      text,
      json,
      ...(manifest ? { manifest } : {}),
      issues,
      scope,
    };
  };

  const at = (plugin: Installed, path: readonly (string | number)[]) => ({
    file: plugin.packageFile,
    ...jsonLocation(plugin.text, ["mostra", ...path]),
  });

  /** The checks of one set of plugins that need no code to run: ranges, scope, files, platform. */
  const staticChecks = (plugin: Installed): Diagnostic[] => {
    const found: Diagnostic[] = [...plugin.issues];
    const manifest = plugin.manifest;
    if (manifest === undefined) {
      if (plugin.json["mostra"] === undefined) {
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_NOT_A_PLUGIN", {
            message: `${plugin.name || plugin.dir} has no "mostra" key in its package.json, so it isn't a Mostra plugin.`,
            location: { file: plugin.packageFile, line: 1, column: 1 },
          }),
        );
      }
      return found;
    }
    for (const [contract, range] of Object.entries(manifest.contracts) as [
      ContractName,
      string,
    ][]) {
      const valid = semver.validRange(range);
      const implemented = implementedOf(contract);
      if (valid === null) {
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_MANIFEST_INVALID", {
            message: `contracts.${contract}: "${range}" isn't a semver range.`,
            location: at(plugin, ["contracts", contract]),
          }),
        );
      } else if (!implemented.some((version) => semver.satisfies(version, range))) {
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED", {
            message: `${plugin.name}@${plugin.version} needs the ${contract} contract at ${range}; this Mostra implements ${PLUGIN_CONTRACTS[contract].package} ${implemented.join(", ")}.`,
            location: at(plugin, ["contracts", contract]),
          }),
        );
      }
    }
    // A bundled plugin is the home's (D175 item 3): it may contribute exporters and commands only.
    if (!manifestScopes(manifest).includes(plugin.scope === "bundled" ? "home" : plugin.scope)) {
      found.push(
        createDiagnostic("MOSTRA_PLUGIN_SCOPE_INVALID", {
          message: `${plugin.name} contributes more than exporters and CLI commands, so it is installed for an artifact, not for the home.`,
          location: at(plugin, ["contributes"]),
        }),
      );
    }
    for (const name of CONTRACT_NAMES) {
      const key = PLUGIN_CONTRACTS[name].key;
      (manifest.contributes[key] ?? []).forEach((entry, index) => {
        const file = resolve(plugin.dir, entry.entry);
        if (!existsSync(file) || !isInside(plugin.dir, realpathSync(file))) {
          found.push(
            createDiagnostic("MOSTRA_PLUGIN_ENTRY_INVALID", {
              message: `contributes.${key}[${index}]: ${entry.entry} isn't a file of ${plugin.name}.`,
              location: at(plugin, ["contributes", key, index, "entry"]),
            }),
          );
        }
      });
    }
    (manifest.contributes.packs ?? []).forEach((pack, index) => {
      const file = resolve(plugin.dir, pack.item);
      if (!existsSync(file) || !isInside(plugin.dir, realpathSync(file))) {
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_ENTRY_INVALID", {
            message: `contributes.packs[${index}]: ${pack.item} isn't a file of ${plugin.name}.`,
            location: at(plugin, ["contributes", "packs", index, "item"]),
          }),
        );
      }
    });
    (manifest.contributes.themes ?? []).forEach((entry, index) => {
      const file = resolve(plugin.dir, entry.theme);
      const where = at(plugin, ["contributes", "themes", index, "theme"]);
      if (!existsSync(file) || !isInside(plugin.dir, realpathSync(file))) {
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_ENTRY_INVALID", {
            message: `contributes.themes[${index}]: ${entry.theme} isn't a file of ${plugin.name}.`,
            location: where,
          }),
        );
        return;
      }
      // A theme is data (D181 item 3): checked as `defineThemeLayer` checks it, faces included.
      try {
        defineThemeLayer(JSON.parse(readFileSync(file, "utf8")) as ThemeLayer);
      } catch (error) {
        const problem =
          error instanceof ThemeError ? error.problems.join("; ") : (error as Error).message;
        found.push(
          createDiagnostic("MOSTRA_PLUGIN_ENTRY_INVALID", {
            message: `contributes.themes[${index}]: ${entry.theme} isn't a theme: ${problem}.`,
            location: where,
          }),
        );
      }
    });
    if (manifest.platforms !== undefined && !manifest.platforms.includes(OS)) {
      found.push(
        createDiagnostic("MOSTRA_PLUGIN_PLATFORM_UNSUPPORTED", {
          message: `${plugin.name} names ${manifest.platforms.join(", ")}, not ${OS}.`,
          location: at(plugin, ["platforms"]),
        }),
      );
    }
    return found;
  };

  /** Every contribution of a manifest, with its contract and position. */
  const contributionsOf = (manifest: PluginManifest) => {
    const all: {
      contract: ContractName;
      id: string;
      entry: string;
      export: string;
      path: (string | number)[];
    }[] = [];
    for (const name of CONTRACT_NAMES) {
      const key = PLUGIN_CONTRACTS[name].key;
      (manifest.contributes[key] ?? []).forEach((entry, index) => {
        all.push({
          contract: name,
          id: "command" in entry ? entry.command : entry.id,
          entry: entry.entry,
          export: entry.export ?? "default",
          path: ["contributes", key, index],
        });
      });
    }
    return all;
  };

  /**
   * Conflicts within `set`: two plugins contributing one ID of a contract, a CLI command whose
   * words begin another's (`foo` and `foo bar`: the longer would swallow the shorter's arguments),
   * an exporter ID Mostra builds in. Those refuse. Against `others` (the home's plugins, when
   * `set` is an artifact's) a shared exporter or command is a warning: the artifact's own wins in
   * the artifact (D172 item 5), so a home install never breaks an artifact.
   */
  const conflicts = (set: readonly Installed[], others: readonly Installed[]) => {
    const found = new Map<Installed, Diagnostic[]>();
    const add = (plugin: Installed, diagnostic: Diagnostic) => {
      found.set(plugin, [...(found.get(plugin) ?? []), diagnostic]);
    };
    const owner = new Map<string, Installed>();
    const commands: { words: string[]; plugin: Installed }[] = [];
    for (const plugin of set) {
      for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
        if (item.contract === "exporter" && BUILT_IN_EXPORTERS.includes(item.id)) {
          add(
            plugin,
            createDiagnostic("MOSTRA_PLUGIN_CONFLICT", {
              message: `${plugin.name} contributes the exporter "${item.id}", which Mostra builds in.`,
              location: at(plugin, [...item.path, "id"]),
            }),
          );
          continue;
        }
        const key = `${item.contract}:${item.id}`;
        const first = owner.get(key);
        if (first !== undefined && first !== plugin) {
          add(
            plugin,
            createDiagnostic("MOSTRA_PLUGIN_CONFLICT", {
              message: `${plugin.name} and ${first.name} both contribute the ${item.contract} "${item.id}"; nothing is overridden: remove one.`,
              location: at(plugin, item.path),
            }),
          );
          continue;
        }
        owner.set(key, plugin);
        if (item.contract !== "cli-command") continue;
        const words = item.id.split(" ");
        const prefix = commands.find(
          (other) =>
            other.plugin !== plugin &&
            other.words.length !== words.length &&
            other.words
              .slice(0, Math.min(other.words.length, words.length))
              .every((word, index) => word === words[index]),
        );
        if (prefix !== undefined) {
          add(
            plugin,
            createDiagnostic("MOSTRA_PLUGIN_CONFLICT", {
              message: `${plugin.name}'s command "${item.id}" and ${prefix.plugin.name}'s "${prefix.words.join(" ")}" begin with the same words, so one would take the other's arguments: remove one.`,
              location: at(plugin, item.path),
            }),
          );
        } else commands.push({ words, plugin });
      }
    }
    for (const other of others) {
      for (const item of other.manifest ? contributionsOf(other.manifest) : []) {
        if (item.contract !== "exporter" && item.contract !== "cli-command") continue;
        const mine = owner.get(`${item.contract}:${item.id}`);
        if (mine === undefined) continue;
        add(
          mine,
          createDiagnostic("MOSTRA_PLUGIN_SHADOWED", {
            message: `${mine.name} and ${other.scope === "bundled" ? "Mostra's bundled" : "the home's"} ${other.name} both contribute the ${item.contract} "${item.id}"; ${mine.scope === "home" ? "the home" : "this artifact"} uses ${mine.name}'s.`,
          }),
        );
      }
    }
    return found;
  };

  /** Loads the Node.js entries of plugins whose static checks passed, in one plugin child. */
  const inspectEntries = async (
    set: readonly Installed[],
    cwd: string,
  ): Promise<Map<Installed, Diagnostic[]>> => {
    const found = new Map<Installed, Diagnostic[]>();
    const jobs: {
      plugin: Installed;
      item: ReturnType<typeof contributionsOf>[number];
      file: string;
    }[] = [];
    for (const plugin of set) {
      for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
        if (PLUGIN_CONTRACTS[item.contract].runs !== "node") continue;
        jobs.push({ plugin, item, file: realpathSync(resolve(plugin.dir, item.entry)) });
      }
    }
    if (jobs.length === 0) return found;
    const answers = await inChild<InspectedEntry[]>(
      cwd,
      "plugins",
      (child) =>
        child.request(
          INSPECT_METHOD,
          { entries: jobs.map((job) => ({ file: job.file, export: job.item.export })) },
          { timeoutMs: childTimeoutMs },
        ) as Promise<InspectedEntry[]>,
    );
    jobs.forEach((job, index) => {
      const answer = answers[index];
      const where = at(job.plugin, [...job.item.path, "entry"]);
      const problem = (
        message: string,
        code:
          | "MOSTRA_PLUGIN_ENTRY_INVALID"
          | "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED" = "MOSTRA_PLUGIN_ENTRY_INVALID",
      ) =>
        found.set(job.plugin, [
          ...(found.get(job.plugin) ?? []),
          createDiagnostic(code, { message, location: where }),
        ]);
      const label = `${job.plugin.name}'s ${job.item.contract} "${job.item.id}" (${job.item.entry}${job.item.export === "default" ? "" : `#${job.item.export}`})`;
      if (answer === undefined || !answer.ok) {
        problem(`${label} didn't load: ${answer && !answer.ok ? answer.error : "no answer"}.`);
        return;
      }
      const stamp = answer.stamp as { name?: unknown; version?: unknown } | null;
      if (stamp === null || typeof stamp !== "object" || typeof stamp.name !== "string") {
        problem(
          `${label} exports no stamped definition: export what ${PLUGIN_CONTRACTS[job.item.contract].package}'s define function returns.`,
        );
        return;
      }
      if (stamp.name !== job.item.contract) {
        problem(`${label} exports a ${stamp.name} definition, not a ${job.item.contract}.`);
        return;
      }
      if (!stampServed(stamp, job.item.contract, implementedOf(job.item.contract))) {
        problem(
          `${label} was built with ${PLUGIN_CONTRACTS[job.item.contract].package} ${String(stamp.version)}, of another line than the ${implementedOf(job.item.contract).join(", ")} this Mostra serves.`,
          "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED",
        );
        return;
      }
      const id = job.item.contract === "cli-command" ? answer.path?.join(" ") : answer.id;
      if (id !== job.item.id) {
        problem(
          `${label}'s definition is "${id ?? "(none)"}", not "${job.item.id}" as the manifest says.`,
        );
      }
    });
    return found;
  };

  /** Runs a plugin child for one task and stops it. */
  const inChild = async <T>(
    cwd: string,
    ownerRef: string,
    task: (child: Awaited<ReturnType<ProcessManager["spawn"]>>) => Promise<T>,
  ): Promise<T> => {
    const child = await options.processes.spawn({
      kind: "plugin",
      ownerRef,
      command: process.execPath,
      args: [childEntry()],
      cwd,
      env: artifactEnvironment(options.env),
      ipc: {},
    });
    try {
      return await task(child);
    } catch (problem) {
      // A refusal of the plugin's own stays as it is; anything else (the child crashed, hung past
      // its limit, or answered nonsense) is the plugin's failure, said as one.
      if (
        problem instanceof RpcError &&
        /^MOSTRA_(PLUGIN|LICENSE)_/.test(problem.diagnostic.code)
      ) {
        throw problem;
      }
      const reason =
        problem instanceof RpcError
          ? `${problem.diagnostic.code}: ${problem.diagnostic.message}`
          : problem instanceof Error
            ? problem.message
            : String(problem);
      throw error("MOSTRA_PLUGIN_FAILED", `A plugin's child (${ownerRef}) failed: ${reason}`);
    } finally {
      await child.stop(2000);
    }
  };

  /** Reads a scope's plugins from its working lockfile and layout. */
  const installedOf = async (
    lock: Lock | undefined,
    nodeModules: string | undefined,
    scope: PluginScope,
  ): Promise<Installed[]> => {
    const found: Installed[] = [];
    for (const name of lock?.plugins ?? []) {
      const dir = nodeModules ? join(nodeModules, name) : undefined;
      if (dir === undefined || !existsSync(join(dir, "package.json"))) {
        throw error(
          "MOSTRA_PLUGIN_NOT_INSTALLED",
          `The lockfile names the plugin ${name}, which its layout doesn't hold.`,
        );
      }
      found.push(await readPackage(dir, scope));
    }
    return found;
  };

  /**
   * The home's own plugins as they stand, for the shadow warnings and the home's exporters and
   * commands; `install: false` reads only a layout already installed (nothing starts).
   */
  /** The runtime's own plugins, read once: a bundle's files never change under it. */
  let bundledRead: Promise<Installed[]> | undefined;
  const bundledPlugins = (): Promise<Installed[]> => {
    bundledRead ??= Promise.all(
      (options.bundled ?? []).map((dir) =>
        readPackage(dir, "bundled").catch((failure: unknown) => {
          // A runtime without its bundled plugin still serves everything else.
          log.error("plugins.bundled_unreadable", { dir, error: String(failure) });
          return undefined;
        }),
      ),
    ).then((found) => found.filter((plugin): plugin is Installed => plugin !== undefined));
    return bundledRead;
  };
  /**
   * The plugins below a scope's own, which it shadows: an artifact's sees the home's and the
   * runtime's, the home's the runtime's.
   */
  const othersOf = async (kind: PluginScope): Promise<Installed[]> =>
    kind === "artifact"
      ? [...(await homePlugins(false)), ...(await bundledPlugins())]
      : kind === "home"
        ? bundledPlugins()
        : [];

  const homePlugins = async (install: boolean): Promise<Installed[]> => {
    const staged = await dependencies.working(homeTarget, { install }).catch(() => undefined);
    if (staged?.nodeModules === undefined) return [];
    return installedOf(staged.lock, staged.nodeModules, "home").catch(() => []);
  };

  /**
   * Every package a plugin's code can reach at run time, the plugin included: its dependencies,
   * optional dependencies, peer dependencies (the installer installs them, `auto-install-peers`)
   * and bundled dependencies, as Node resolves each from the package's real directory.
   */
  const closure = async (root: string) => {
    const seen = new Map<
      string,
      { name: string; version: string; dir: string; json: Record<string, unknown> }
    >();
    const names = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((name): name is string => typeof name === "string")
        : typeof value === "object" && value !== null
          ? Object.keys(value)
          : [];
    const visit = async (dir: string): Promise<void> => {
      const real = realpathSync(dir);
      if (seen.has(real)) return;
      const json = JSON.parse(await readFile(join(real, "package.json"), "utf8")) as Record<
        string,
        unknown
      >;
      seen.set(real, {
        name: String(json["name"] ?? ""),
        version: String(json["version"] ?? ""),
        dir: real,
        json,
      });
      const deps = new Set([
        ...names(json["dependencies"]),
        ...names(json["optionalDependencies"]),
        ...names(json["peerDependencies"]),
        ...names(json["bundleDependencies"]),
        ...names(json["bundledDependencies"]),
      ]);
      for (const dep of [...deps].sort()) {
        const found = locate(real, dep);
        if (found !== undefined) await visit(found);
      }
    };
    await visit(root);
    return [...seen.values()];
  };

  /** Node's resolution of a package directory from `from` (pnpm's isolated layout puts it beside). */
  const locate = (from: string, name: string): string | undefined => {
    let dir = from;
    for (;;) {
      if (!dir.endsWith(`${sep}node_modules`)) {
        const candidate = join(dir, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) return candidate;
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  };

  /**
   * Every license an install brings, classed, with where its acknowledgment stands, and the
   * acknowledgments it makes: each plugin's whole closure, each other package's (a pack's npm
   * dependencies), and each pack item's own `mostra.license`. A license that needs an
   * acknowledgment is accepted by an earlier one of the same class, by `accept`, or by the
   * home's policy (D31).
   *
   * What a plugin declares (`bundledLicenses`) describes a package whose own license field Mostra
   * can't read, and only ever as a license that needs an acknowledgment: no declaration makes a
   * package OSI-licensed (D172 item 7).
   */
  const disclose = async (input: {
    readonly plugins: readonly Installed[];
    readonly packages?: readonly Installed[];
    readonly items?: readonly ItemLicense[];
    readonly previous: Readonly<Record<string, LockLicense>> | undefined;
    readonly accept: readonly string[];
  }): Promise<{
    disclosures: LicenseDisclosure[];
    record: Record<string, LockLicense>;
    missing: LicenseDisclosure[];
    warnings: Map<Installed, Diagnostic[]>;
    /** Each plugin's or package's closure, by package name. */
    closures: Map<Installed, Set<string>>;
  }> => {
    const closures = new Map<Installed, Set<string>>();
    type Entry = {
      class: LicenseTerm["class"];
      packages: Map<string, LicensedPackage>;
      summary?: string;
      url?: string;
    };
    const byId = new Map<string, Entry>();
    const entry = (id: string, licenseClass: LicenseTerm["class"]): Entry => {
      const found = byId.get(id) ?? { class: licenseClass, packages: new Map() };
      byId.set(id, found);
      return found;
    };
    const warnings = new Map<Installed, Diagnostic[]>();
    const warn = (owner: Installed, diagnostic: Diagnostic) =>
      warnings.set(owner, [...(warnings.get(owner) ?? []), diagnostic]);
    const policy = options.policy()?.accept ?? [];
    for (const owner of [...input.plugins, ...(input.packages ?? [])]) {
      const isPlugin = input.plugins.includes(owner);
      const declared = new Map<string, BundledLicense>(
        (owner.manifest?.bundledLicenses ?? []).map((bundled) => [bundled.package, bundled]),
      );
      const classOf = (id: string) =>
        [...declared.values()].find((bundled) => bundled.license === id)?.class;
      const packages = await closure(owner.dir);
      closures.set(owner, new Set(packages.map((pkg) => pkg.name)));
      for (const pkg of packages) {
        const field = packageLicense(pkg.json as { license?: unknown; licenses?: unknown });
        const bundled = declared.get(pkg.name);
        let terms: readonly LicenseTerm[];
        let shown: string;
        const readable = field !== undefined && field !== "UNLICENSED" && isReadable(field);
        if (readable) {
          terms = packageLicenseTerms(pkg.name, field, classOf);
          shown = field;
          if (bundled !== undefined && !sameExpression(bundled.license, field)) {
            warn(
              owner,
              createDiagnostic("MOSTRA_LICENSE_MISMATCH", {
                message: `${owner.name} declares ${pkg.name} as ${bundled.license}; ${pkg.name}@${pkg.version} itself says ${field}, which is what Mostra shows.`,
              }),
            );
          }
        } else {
          const unreadable = packageLicenseTerms(pkg.name, field, classOf);
          const declaredTerms =
            bundled !== undefined && isReadable(bundled.license)
              ? licenseTerms(parseLicenseExpression(bundled.license), classOf)
              : undefined;
          if (declaredTerms?.every((term) => ACKNOWLEDGED_CLASSES.has(term.class))) {
            terms = declaredTerms ?? unreadable;
            shown = bundled?.license ?? "";
          } else {
            terms = unreadable;
            shown = field ?? "(none)";
            if (declaredTerms !== undefined) {
              warn(
                owner,
                createDiagnostic("MOSTRA_LICENSE_MISMATCH", {
                  message: `${owner.name} declares ${pkg.name} as ${bundled?.license}, which Mostra can't confirm: ${pkg.name}@${pkg.version}'s own license field is ${field === undefined ? "absent" : `"${field}"`}, so it is shown as ${unreadable.map((term) => term.id).join(" AND ")} (${unreadable.map((term) => term.class).join(", ")}).`,
                }),
              );
            }
          }
        }
        if (
          isPlugin &&
          pkg.dir !== owner.dir &&
          bundled === undefined &&
          terms.some((term) => ACKNOWLEDGED_CLASSES.has(term.class))
        ) {
          warn(
            owner,
            createDiagnostic("MOSTRA_LICENSE_UNDECLARED", {
              message: `${owner.name} brings ${pkg.name}@${pkg.version} (${shown}) without declaring it in bundledLicenses.`,
            }),
          );
        }
        for (const term of terms) {
          const slot = entry(term.id, term.class);
          slot.packages.set(`${pkg.name}@${pkg.version}`, {
            name: pkg.name,
            version: pkg.version,
            license: shown,
          });
          const describing = [...declared.values()].find((item) => item.license === term.id);
          if (describing?.summary !== undefined) slot.summary = describing.summary;
          if (describing?.url !== undefined) slot.url = describing.url;
        }
      }
      if (isPlugin && owner.manifest !== undefined) {
        const own = packageLicense(owner.json as { license?: unknown; licenses?: unknown });
        if (own !== undefined && !sameExpression(own, owner.manifest.license)) {
          warn(
            owner,
            createDiagnostic("MOSTRA_LICENSE_MISMATCH", {
              message: `${owner.name}'s manifest says ${owner.manifest.license}; its package.json says ${own}, which is what Mostra shows.`,
              location: at(owner, ["license"]),
            }),
          );
        }
      }
    }
    for (const item of input.items ?? []) {
      const terms = (() => {
        try {
          return licenseTerms(parseLicenseExpression(item.license), (id) =>
            isLicenseRef(id) ? item.class : undefined,
          );
        } catch {
          return [{ id: unreadableItemRef(item.name), class: "unknown" as const }];
        }
      })();
      for (const term of terms) {
        entry(term.id, term.class).packages.set(`item:${item.name}`, {
          name: item.name,
          license: item.license,
          item: true,
        });
      }
    }
    const now = new Date().toISOString();
    const disclosures: LicenseDisclosure[] = [];
    const record: Record<string, LockLicense> = {};
    const missing: LicenseDisclosure[] = [];
    for (const [id, found] of [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const base = {
        id,
        class: found.class,
        packages: [...found.packages.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
        ...(found.summary !== undefined ? { summary: found.summary } : {}),
        ...(found.url !== undefined ? { url: found.url } : {}),
      };
      if (!ACKNOWLEDGED_CLASSES.has(found.class)) {
        disclosures.push({ ...base, acknowledgment: "not-needed" });
        continue;
      }
      // An acknowledgment counts for the license as it was then: one Mostra now classes otherwise
      // (a newer SPDX list, a plugin's other declaration) is asked again.
      const earlier = input.previous?.[id]?.class === found.class ? input.previous[id] : undefined;
      const accepted: LockLicense | undefined =
        earlier ??
        (input.accept.includes(id) || input.accept.includes("*")
          ? { class: found.class, by: "flag" }
          : policy.includes(id) || policy.includes("*")
            ? { class: found.class, by: "host" }
            : undefined);
      if (accepted === undefined) {
        const disclosure: LicenseDisclosure = { ...base, acknowledgment: "missing" };
        disclosures.push(disclosure);
        missing.push(disclosure);
        continue;
      }
      record[id] = accepted;
      if (earlier === undefined) {
        // The lockfile keeps no time (D172 item 6); the log says when, and by what.
        log.info("plugins.license_accepted", {
          license: id,
          class: found.class,
          by: accepted.by,
          packages: base.packages.map((pkg) =>
            pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name,
          ),
        });
      }
      disclosures.push({
        ...base,
        acknowledgment: accepted.by === "host" ? "host" : "accepted",
        ...(earlier === undefined ? { acceptedAt: now } : {}),
      });
    }
    return { disclosures, record, missing, warnings, closures };
  };

  /** Summarizes a loaded plugin. */
  const summary = (plugin: Installed, diagnostics: readonly Diagnostic[]): PluginSummary => {
    const manifest = plugin.manifest;
    const contributions: PluginContribution[] = manifest
      ? contributionsOf(manifest).map((item) => ({ contract: item.contract, id: item.id }))
      : [];
    return {
      package: plugin.name,
      version: plugin.version,
      name: manifest?.name ?? plugin.name,
      ...(manifest?.title !== undefined ? { title: manifest.title } : {}),
      ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
      scope: plugin.scope,
      contracts: { ...(manifest?.contracts ?? {}) } as Record<string, string>,
      contributions,
      packs: (manifest?.contributes.packs ?? []).map((pack) => pack.item),
      effects: [...(manifest?.effects ?? [])],
      license: manifest?.license ?? String(plugin.json["license"] ?? ""),
      ...(manifest?.platforms !== undefined ? { platforms: [...manifest.platforms] } : {}),
      status: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "error" : "ok",
      diagnostics: [...diagnostics],
    };
  };

  /** Static checks and conflicts of a set: everything that needs no code to run. */
  const statics = (
    set: readonly Installed[],
    others: readonly Installed[],
  ): Map<Installed, Diagnostic[]> => {
    const found = new Map<Installed, Diagnostic[]>(
      set.map((plugin) => [plugin, staticChecks(plugin)]),
    );
    for (const [plugin, list] of conflicts(set, others)) {
      found.set(plugin, [...(found.get(plugin) ?? []), ...list]);
    }
    return found;
  };

  const merged = (
    set: readonly Installed[],
    ...maps: readonly ReadonlyMap<Installed, readonly Diagnostic[]>[]
  ): Map<Installed, Diagnostic[]> =>
    new Map(set.map((plugin) => [plugin, maps.flatMap((map) => [...(map.get(plugin) ?? [])])]));

  const firstError = (
    found: ReadonlyMap<Installed, readonly Diagnostic[]>,
    prefer: readonly Installed[] = [],
  ): Diagnostic | undefined => {
    for (const plugin of [...prefer, ...found.keys()]) {
      const hit = found.get(plugin)?.find((diagnostic) => diagnostic.severity === "error");
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  const unacceptedError = (missing: readonly LicenseDisclosure[], command: string): RpcError =>
    new RpcError(
      createDiagnostic("MOSTRA_LICENSE_UNACCEPTED", {
        message: `This install brings ${missing.length === 1 ? "a license that needs" : "licenses that need"} an acknowledgment: ${missing
          .map(
            (license) =>
              `${license.id} (${license.class}; ${license.packages.map((pkg) => (pkg.version ? `${pkg.name}@${pkg.version}` : `the item ${pkg.name}`)).join(", ")})${license.summary ? `: ${license.summary}` : ""}${license.url ? ` ${license.url}` : ""}`,
          )
          .join("; ")}. Nothing was installed, and nothing of it ran.`,
        fix: {
          kind: "command",
          command: `${command} ${missing.map((license) => `--accept-license ${shellWord(license.id)}`).join(" ")}`,
        },
      }),
    );

  const checkAccepted = (accept: readonly string[]): void => {
    for (const id of accept) {
      if (id === "*" || isLicenseRef(id) || spdxLicense(id) !== undefined) continue;
      throw error(
        "MOSTRA_LICENSE_ACCEPT_INVALID",
        `"${id}" isn't an SPDX license ID, a LicenseRef- reference or *.`,
      );
    }
  };

  const scopeOf = (target: DependencyTarget): PluginScope =>
    target.key === HOME_KEY ? "home" : "artifact";

  const scopeFlag = (scope: Scope): string =>
    scope.kind === "home" ? "--global" : `--artifact ${shellWord(scope.target.artifactPath)}`;

  /**
   * The gate (D172 items 5, 7 and 8): admits a staged lockfile's plugins, `order` in load order,
   * with the licenses of everything the change brings. In this order, each refusing before the
   * next starts: the static checks and conflicts; the licenses (nothing of the packages has run,
   * their scripts are held); then `staged.ready()` runs the held scripts, and the Node.js
   * entries load in a plugin child. Answers the lockfile's plugins and its acknowledgments after
   * the change: every earlier one, and the ones this change made.
   */
  const admitSet = async (input: {
    readonly scope: PluginScope;
    readonly target: DependencyTarget;
    readonly staged: StagedChange;
    readonly order: readonly string[];
    readonly fresh?: readonly string[];
    readonly packages?: readonly string[];
    readonly items?: readonly ItemLicense[];
    readonly accept: readonly string[];
    readonly command: string;
  }) => {
    checkAccepted(input.accept);
    const set = await installedOf(
      { ...input.staged.lock, plugins: [...input.order] },
      input.staged.nodeModules,
      input.scope,
    );
    const fresh = set.filter((plugin) => input.fresh?.includes(plugin.name));
    const others = await othersOf(input.scope);
    const checked = statics(set, others);
    const refusal = firstError(checked, fresh);
    if (refusal !== undefined) throw new RpcError(refusal);
    const extra: Installed[] = [];
    for (const name of input.packages ?? []) {
      const dir = join(input.staged.nodeModules, name);
      if (existsSync(join(dir, "package.json"))) extra.push(await readPackage(dir, "artifact"));
    }
    const licenses = await disclose({
      plugins: set,
      packages: extra,
      ...(input.items !== undefined ? { items: input.items } : {}),
      previous: input.staged.previous?.licenses,
      accept: input.accept,
    });
    if (licenses.missing.length > 0) throw unacceptedError(licenses.missing, input.command);
    await input.staged.ready();
    const entries = await inspectEntries(set, input.target.artifactDir);
    const loaded = merged(set, checked, entries, licenses.warnings);
    const broken = firstError(loaded, fresh);
    if (broken !== undefined) throw new RpcError(broken);
    return {
      set,
      fresh,
      loaded,
      licenses,
      plugins: [...input.order],
      // An acknowledgment is given once for the artifact (D31): it stays when a later change no
      // longer needs it, and one this change made joins it.
      record: { ...(input.staged.previous?.licenses ?? {}), ...licenses.record },
    };
  };

  return {
    async admit(input) {
      const scope = scopeOf(input.target);
      const admitted = await admitSet({
        scope,
        target: input.target,
        staged: input.staged,
        order: input.staged.lock.plugins ?? [],
        accept: input.accept,
        command: input.command,
      });
      return { plugins: admitted.plugins, licenses: admitted.record };
    },

    async admitChange(scope, input) {
      const target = scope.kind === "artifact" ? scope.target : homeTarget;
      const admitted = await admitSet({
        scope: scope.kind,
        target,
        staged: input.staged,
        order: input.staged.previous?.plugins ?? [],
        ...(input.packages !== undefined ? { packages: input.packages } : {}),
        ...(input.items !== undefined ? { items: input.items } : {}),
        accept: input.accept,
        command: input.command,
      });
      return {
        plugins: admitted.plugins,
        licenses: admitted.record,
        disclosures: admitted.licenses.disclosures.filter((license) =>
          license.packages.some(
            (pkg) =>
              pkg.item === true ||
              [...admitted.licenses.closures.entries()].some(
                ([owner, names]) => !admitted.set.includes(owner) && names.has(pkg.name),
              ),
          ),
        ),
      };
    },

    async validate(path, accept) {
      checkAccepted(accept);
      const diagnostics: Diagnostic[] = [];
      if (!existsSync(join(path, "package.json"))) {
        throw error("MOSTRA_PLUGIN_NOT_A_PLUGIN", `${path} has no package.json.`);
      }
      const plugin = await readPackage(path, "artifact");
      const checked = statics([plugin], []);
      diagnostics.push(...(checked.get(plugin) ?? []));
      let blocked = false;
      if (plugin.manifest !== undefined) {
        // Licenses as far as the package's own directory shows them (its dependencies when
        // installed beside it), before any of its code runs: nothing loads whose license needs an
        // acknowledgment it hasn't been given.
        const licenses = await disclose({ plugins: [plugin], previous: undefined, accept }).catch(
          (problem: unknown) => {
            log.warn("plugins.validate_licenses", { message: String(problem) });
            return undefined;
          },
        );
        diagnostics.push(...(licenses?.warnings.get(plugin) ?? []));
        if (licenses !== undefined && licenses.missing.length > 0) {
          blocked = true;
          const refusal = unacceptedError(
            licenses.missing,
            `mostra plugin validate ${shellWord(path)}`,
          ).diagnostic;
          diagnostics.push({
            ...refusal,
            message: `${plugin.name} brings ${licenses.missing.map((license) => license.id).join(", ")}, which need an acknowledgment; its entries weren't loaded.`,
          });
        }
      }
      if (!blocked && firstError(checked) === undefined) {
        diagnostics.push(...((await inspectEntries([plugin], plugin.dir)).get(plugin) ?? []));
      }
      const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
      return {
        valid,
        ...(plugin.manifest !== undefined ? { plugin: summary(plugin, diagnostics) } : {}),
        diagnostics,
      };
    },

    async add(scope, input) {
      const target = await targetOf(scope);
      return dependencies.change<PluginAddResult>(
        { ...target, add: input.packages, request: input.request },
        async (staged: StagedChange) => {
          const names = staged.added.map((pkg) => pkg.name);
          const previous = staged.previous?.plugins ?? [];
          const admitted = await admitSet({
            scope: scope.kind,
            target,
            staged,
            order: [...previous, ...names.filter((name) => !previous.includes(name))],
            fresh: names,
            accept: input.accept,
            command: `mostra plugin add ${input.packages.map(shellWord).join(" ")} ${scopeFlag(scope)}`,
          });
          log.info("plugins.added", {
            scope: scope.kind,
            plugins: names,
            licenses: Object.keys(admitted.licenses.record),
          });
          return {
            plugins: admitted.plugins,
            licenses: admitted.record,
            result: (lockDigest) => ({
              plugins: admitted.set.map((plugin) =>
                summary(plugin, admitted.loaded.get(plugin) ?? []),
              ),
              added: names,
              licenses: admitted.licenses.disclosures.filter((license) =>
                license.packages.some((pkg) =>
                  admitted.fresh.some((plugin) =>
                    admitted.licenses.closures.get(plugin)?.has(pkg.name),
                  ),
                ),
              ),
              lockDigest,
            }),
          };
        },
      );
    },

    async list(scope) {
      const target = await targetOf(scope);
      const staged = await dependencies.working(target);
      const set = await installedOf(staged?.lock, staged?.nodeModules, scope.kind);
      const others = await othersOf(scope.kind);
      // What needs no code: listing never runs a plugin.
      const checked = statics(set, others);
      const licenses = await disclose({
        plugins: set,
        previous: staged?.lock.licenses,
        accept: [],
      });
      // The home lists the runtime's own plugins too (scope `bundled`), after its own.
      const bundled = scope.kind === "home" ? await bundledPlugins() : [];
      return {
        plugins: [
          ...set.map((plugin) =>
            summary(plugin, [
              ...(checked.get(plugin) ?? []),
              ...(licenses.warnings.get(plugin) ?? []),
            ]),
          ),
          ...bundled.map((plugin) => summary(plugin, staticChecks(plugin))),
        ],
        licenses: licenses.disclosures,
      };
    },

    async remove(scope, input) {
      const target = await targetOf(scope);
      return dependencies.change<PluginRemoveResult>(
        { ...target, add: [], remove: input.packages, request: input.request },
        async (staged) => {
          // Read inside the change, which holds the lockfile's queue: a plugin another call
          // added meanwhile stays (WP-16 review R01 finding 4).
          const plugins = staged.previous?.plugins ?? [];
          const bundled = new Set((await bundledPlugins()).map((plugin) => plugin.name));
          for (const name of input.packages) {
            if (!plugins.includes(name) && bundled.has(name)) {
              throw error(
                "MOSTRA_PLUGIN_NOT_INSTALLED",
                `${name} comes with Mostra and can't be removed; a plugin installed with the same exporter or command takes its place.`,
              );
            }
            if (!plugins.includes(name)) {
              throw error(
                "MOSTRA_PLUGIN_NOT_INSTALLED",
                `${name} isn't a plugin of ${scope.kind === "home" ? "the home" : scope.target.artifactPath}; it has ${plugins.length > 0 ? plugins.join(", ") : "none"}.`,
              );
            }
          }
          const order = plugins.filter((name) => !input.packages.includes(name));
          const set = await installedOf(
            { ...staged.lock, plugins: order },
            staged.nodeModules,
            scope.kind,
          );
          const others = await othersOf(scope.kind);
          const checked = statics(set, others);
          return {
            plugins: order,
            licenses: { ...(staged.previous?.licenses ?? {}) },
            result: (lockDigest) => ({
              removed: [...input.packages],
              plugins: set.map((plugin) => summary(plugin, checked.get(plugin) ?? [])),
              lockDigest,
            }),
          };
        },
      );
    },

    async packItem(target, pkg, item) {
      const staged = await dependencies.working(target).catch(() => undefined);
      const own = await installedOf(staged?.lock, staged?.nodeModules, "artifact");
      for (const plugin of [...own, ...(await homePlugins(true))]) {
        if (plugin.name !== pkg) continue;
        for (const pack of plugin.manifest?.contributes.packs ?? []) {
          const file = resolve(plugin.dir, pack.item);
          if (!existsSync(file) || !isInside(plugin.dir, realpathSync(file))) continue;
          try {
            const data = JSON.parse(await readFile(file, "utf8")) as { name?: unknown };
            if (data.name === item) return realpathSync(file);
          } catch {
            // Not an item: `plugin/validate` reports it.
          }
        }
      }
      return undefined;
    },

    async commands(target) {
      // A lookup for a word `mostra` doesn't know: it reads only layouts already installed, so a
      // typo never starts an install (WP-16 review, R01's addendum).
      const own =
        target === undefined
          ? []
          : await (async () => {
              const staged = await dependencies
                .working(target, { install: false })
                .catch(() => undefined);
              if (staged?.nodeModules === undefined) return [];
              return installedOf(staged.lock, staged.nodeModules, "artifact").catch(() => []);
            })();
      const found: PluginCommandInfo[] = [];
      // The artifact's own command wins over the home's of the same words (D172 item 5).
      for (const plugin of [...own, ...(await homePlugins(false)), ...(await bundledPlugins())]) {
        for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
          if (item.contract !== "cli-command") continue;
          if (found.some((command) => command.command === item.id)) continue;
          const file = resolve(plugin.dir, item.entry);
          if (!existsSync(file)) continue;
          found.push({
            command: item.id,
            package: plugin.name,
            version: plugin.version,
            scope: plugin.scope,
            file: realpathSync(file),
            export: item.export,
          });
        }
      }
      return found;
    },

    async exporters(input) {
      // The version's own plugins, as its lockfile froze them (D172 item 6), in the layout it was
      // built against; then the home's. The artifact's own wins over the home's of one ID.
      const text = await readFile(join(input.versionDir, "lock.yaml"), "utf8");
      const lock = parseLock(text);
      const own =
        (lock.plugins ?? []).length === 0
          ? []
          : await installedOf(
              lock,
              await dependencies.runtimeModules({
                artifactId: input.artifactId,
                versionDir: input.versionDir,
                ...(input.sourceDir !== undefined ? { sourceDir: input.sourceDir } : {}),
              }),
              "artifact",
            );
      const home = await homePlugins(true);
      // Then the runtime's own (D175 item 3): an exporter of the same ID above shadows it.
      const bundled = await bundledPlugins();
      const found: ExporterRef[] = [];
      for (const plugin of [...own, ...home, ...bundled]) {
        const problem = staticChecks(plugin).find((diagnostic) => diagnostic.severity === "error");
        for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
          if (item.contract !== "exporter") continue;
          if (found.some((exporter) => exporter.id === item.id)) continue;
          found.push({
            id: item.id,
            package: plugin.name,
            scope: plugin.scope,
            file: realpathSync(resolve(plugin.dir, item.entry)),
            export: item.export,
            dir: plugin.dir,
            ...(problem !== undefined ? { problem } : {}),
          });
        }
      }
      return found;
    },

    async runExport(input) {
      if (input.exporter.problem !== undefined) throw new RpcError(input.exporter.problem);
      const request: ExportRequest = {
        file: input.exporter.file,
        export: input.exporter.export,
        id: input.exporter.id,
        implemented: implementedOf("exporter"),
        versionDir: input.versionDir,
        version: input.version,
        options: input.options,
        mostraVersion: options.runtimeVersion,
      };
      const answer = await inChild<ExportResponse>(
        input.exporter.dir,
        `export:${input.exporter.id}`,
        (child) =>
          child.request(EXPORT_METHOD, request as unknown as Record<string, unknown>, {
            timeoutMs: childTimeoutMs,
          }) as Promise<ExportResponse>,
      );
      if ("refused" in answer) {
        throw error(
          answer.refused.code,
          `The exporter "${input.exporter.id}" (${input.exporter.package}) wasn't run: ${answer.refused.message}.`,
        );
      }
      return answer;
    },
  };
}

/** A pack item's own license (its `mostra.license`), disclosed as a package's is. */
export interface ItemLicense {
  readonly name: string;
  readonly license: string;
  /** For a `LicenseRef-`, the class the item declares (`mostra.licenseClass`). */
  readonly class?: LicenseClass;
}

/** The reference an item's unreadable license is shown as. */
function unreadableItemRef(name: string): string {
  return `LicenseRef-item-${name.replace(/[^A-Za-z0-9.-]/g, "-")}`;
}

/** Whether `text` parses as a license expression. */
function isReadable(text: string): boolean {
  try {
    parseLicenseExpression(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether two license expressions are the same once canonical. */
function sameExpression(a: string, b: string): boolean {
  try {
    return (
      formatLicenseExpression(parseLicenseExpression(a)) ===
      formatLicenseExpression(parseLicenseExpression(b))
    );
  } catch {
    return a.trim() === b.trim();
  }
}
