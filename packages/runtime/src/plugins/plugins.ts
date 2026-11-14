/**
 * Plugins (D30, D31, INTERFACES §14; EX-01, EX-02, EX-04): npm packages with a `"mostra"`
 * manifest, installed for one artifact (recorded in its working lockfile, frozen into each
 * version's `lock.yaml`) or for the whole home (exporters and CLI commands, ROUND-3 §6.4).
 *
 * Loading a set of plugins checks, in this order, everything that can refuse it:
 * 1. each manifest (`checkPluginManifest`), its contract ranges against what this release
 *    implements, and the scope it is installed in;
 * 2. the licenses of everything it installed, classed (D31): one that needs an acknowledgment and
 *    has none refuses the install before any of the packages' code has run;
 * 3. conflicts: two plugins of a scope (or an artifact's and the home's) contributing one ID, or
 *    an ID Mostra builds in;
 * 4. each Node.js entry, loaded in a plugin child (never the supervisor, RT-02), which must export
 *    a definition stamped with its contract at a version this release serves.
 *
 * ```ts
 * const plugins = createPlugins({ home, dependencies, processes, log, env, policy });
 * await plugins.add({ kind: "artifact", target }, { packages: ["mostra-pdf"], accept: [] });
 * await plugins.check(resolution); // in verify and publish: a plugin that no longer loads refuses
 * ```
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ContractName,
  createDiagnostic,
  type Diagnostic,
  type LicenseDisclosure,
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
import semver from "semver";
import type {
  Dependencies,
  DependencyTarget,
  Lock,
  LockLicense,
  StagedChange,
} from "../deps/index.ts";
import { parseLock, runtimeRoot } from "../deps/index.ts";
import type { RequestKey } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { OS } from "../platform/index.ts";
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
}

/** The plugins of one instance. */
export interface Plugins {
  /** `plugin/validate`: a plugin package as Mostra would load it, installing nothing. */
  validate(path: string): Promise<PluginValidateResult>;
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
   * Loads a resolved lockfile's plugins as `verify` and `publish` do (ROUND-3 §6.4: ranges are
   * checked at install and at load), with the home's: throws the first error, so a version never
   * records plugins this release can't load.
   */
  check(input: { readonly lock: string; readonly nodeModules: string }): Promise<void>;
  /** The exporters an artifact can use: its plugins' and the home's, by ID. */
  exporters(target: DependencyTarget): Promise<readonly ExporterRef[]>;
  /** The CLI commands the home's plugins contribute, and an artifact's when given. */
  commands(target: DependencyTarget | undefined): Promise<readonly PluginCommandInfo[]>;
  /**
   * The file of the pack item `item` (its `name`) that the plugin `pkg` carries, among the
   * artifact's plugins and the home's, for `mostra add plugin:<package>/<item>`.
   */
  packItem(target: DependencyTarget, pkg: string, item: string): Promise<string | undefined>;
  /**
   * The licenses packages bring that aren't plugins (a source pack's npm dependencies, WP-16):
   * each package's production closure, classed and acknowledged as a plugin's are.
   */
  disclosePackages(input: {
    readonly nodeModules: string;
    readonly packages: readonly string[];
    readonly previous: Readonly<Record<string, LockLicense>> | undefined;
    readonly accept: readonly string[];
    /** The command the refusal's fix repeats with `--accept-license`. */
    readonly command: string;
  }): Promise<{
    readonly disclosures: readonly LicenseDisclosure[];
    readonly record: Readonly<Record<string, LockLicense>>;
  }>;
  /** Runs an exporter on a version's directory, in a plugin child. */
  runExport(input: {
    readonly exporter: ExporterRef;
    readonly versionDir: string;
    readonly version: Readonly<Record<string, unknown>>;
    readonly options: Readonly<Record<string, unknown>>;
  }): Promise<ExportResponse>;
}

/** An exporter a plugin contributes, as `plugin/export` runs it. */
export interface ExporterRef {
  readonly id: string;
  readonly package: string;
  readonly scope: PluginScope;
  readonly file: string;
  readonly export: string;
  readonly dir: string;
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
function childEntry(): string {
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
    if (!manifestScopes(manifest).includes(plugin.scope)) {
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
   * Conflicts within `set`, and with `others` (the other scope's plugins, whose exporters and
   * commands share one name space with these), and with Mostra's own exporter IDs.
   */
  const conflicts = (set: readonly Installed[], others: readonly Installed[]) => {
    const found = new Map<Installed, Diagnostic[]>();
    const owner = new Map<string, Installed>();
    const add = (plugin: Installed, diagnostic: Diagnostic) => {
      found.set(plugin, [...(found.get(plugin) ?? []), diagnostic]);
    };
    const shared = (contract: ContractName) =>
      contract === "exporter" || contract === "cli-command";
    for (const plugin of others) {
      for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
        if (shared(item.contract)) owner.set(`${item.contract}:${item.id}`, plugin);
      }
    }
    for (const plugin of set) {
      for (const item of plugin.manifest ? contributionsOf(plugin.manifest) : []) {
        const key = `${item.contract}:${item.id}`;
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
        const first = owner.get(key);
        if (first !== undefined && first !== plugin) {
          add(
            plugin,
            createDiagnostic("MOSTRA_PLUGIN_CONFLICT", {
              message: `${plugin.name} and ${first.name}${first.scope !== plugin.scope ? ` (the ${first.scope}'s)` : ""} both contribute the ${item.contract} "${item.id}"; nothing is overridden: remove one.`,
              location: at(plugin, item.path),
            }),
          );
        } else owner.set(key, plugin);
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
          `${label} was built with ${PLUGIN_CONTRACTS[job.item.contract].package} ${String(stamp.version)}; this Mostra serves ${implementedOf(job.item.contract).join(", ")}.`,
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

  /** The home's own plugins as they stand. */
  const homePlugins = async (): Promise<Installed[]> => {
    const staged = await dependencies.working(homeTarget).catch(() => undefined);
    if (staged === undefined) return [];
    return installedOf(staged.lock, staged.nodeModules, "home");
  };

  /** The production dependency closure of a package in a layout, the package included. */
  const closure = async (root: Installed) => {
    const seen = new Map<
      string,
      { name: string; version: string; dir: string; json: Record<string, unknown> }
    >();
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
      const deps = {
        ...((json["dependencies"] as Record<string, string> | undefined) ?? {}),
        ...((json["optionalDependencies"] as Record<string, string> | undefined) ?? {}),
      };
      for (const dep of Object.keys(deps).sort()) {
        const found = locate(real, dep);
        if (found !== undefined) await visit(found);
      }
    };
    await visit(root.dir);
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
   * Every license `set` brings (each plugin's whole production closure), classed, with where its
   * acknowledgment stands; and the lockfile's acknowledgments after this install. A license that
   * needs one is accepted by an earlier acknowledgment, by `accept`, or by the home's policy.
   */
  const disclose = async (
    set: readonly Installed[],
    previous: Readonly<Record<string, LockLicense>> | undefined,
    accept: readonly string[],
  ): Promise<{
    disclosures: LicenseDisclosure[];
    record: Record<string, LockLicense>;
    missing: LicenseDisclosure[];
    warnings: Map<Installed, Diagnostic[]>;
    /** Each plugin's closure, by package name. */
    closures: Map<Installed, Set<string>>;
  }> => {
    const closures = new Map<Installed, Set<string>>();
    const byId = new Map<
      string,
      {
        class: LicenseTerm["class"];
        packages: Map<string, { name: string; version: string; license: string }>;
        summary?: string;
        url?: string;
      }
    >();
    const warnings = new Map<Installed, Diagnostic[]>();
    const policy = options.policy()?.accept ?? [];
    for (const plugin of set) {
      const declared = new Map<string, BundledLicense>(
        (plugin.manifest?.bundledLicenses ?? []).map((bundled) => [bundled.package, bundled]),
      );
      const classOf = (id: string) =>
        [...declared.values()].find((bundled) => bundled.license === id)?.class;
      const packages = await closure(plugin);
      closures.set(plugin, new Set(packages.map((pkg) => pkg.name)));
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
            warnings.set(plugin, [
              ...(warnings.get(plugin) ?? []),
              createDiagnostic("MOSTRA_LICENSE_MISMATCH", {
                message: `${plugin.name} declares ${pkg.name} as ${bundled.license}; ${pkg.name}@${pkg.version} itself says ${field}, which is what Mostra shows.`,
              }),
            ]);
          }
        } else if (bundled !== undefined && isReadable(bundled.license)) {
          terms = licenseTerms(parseLicenseExpression(bundled.license), classOf);
          shown = bundled.license;
        } else {
          terms = packageLicenseTerms(pkg.name, field, classOf);
          shown = field ?? "(none)";
        }
        if (
          pkg.dir !== plugin.dir &&
          bundled === undefined &&
          terms.some((term) => ACKNOWLEDGED_CLASSES.has(term.class))
        ) {
          warnings.set(plugin, [
            ...(warnings.get(plugin) ?? []),
            createDiagnostic("MOSTRA_LICENSE_UNDECLARED", {
              message: `${plugin.name} brings ${pkg.name}@${pkg.version} (${shown}) without declaring it in bundledLicenses.`,
            }),
          ]);
        }
        for (const term of terms) {
          const entry =
            byId.get(term.id) ??
            ({ class: term.class, packages: new Map() } as {
              class: LicenseTerm["class"];
              packages: Map<string, { name: string; version: string; license: string }>;
              summary?: string;
              url?: string;
            });
          entry.packages.set(`${pkg.name}@${pkg.version}`, {
            name: pkg.name,
            version: pkg.version,
            license: shown,
          });
          const describing = [...declared.values()].find((item) => item.license === term.id);
          if (describing?.summary !== undefined) entry.summary = describing.summary;
          if (describing?.url !== undefined) entry.url = describing.url;
          byId.set(term.id, entry);
        }
      }
    }
    const now = new Date().toISOString();
    const disclosures: LicenseDisclosure[] = [];
    const record: Record<string, LockLicense> = {};
    const missing: LicenseDisclosure[] = [];
    for (const [id, entry] of [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const base = {
        id,
        class: entry.class,
        packages: [...entry.packages.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
        ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
        ...(entry.url !== undefined ? { url: entry.url } : {}),
      };
      if (!ACKNOWLEDGED_CLASSES.has(entry.class)) {
        disclosures.push({ ...base, acknowledgment: "not-needed" });
        continue;
      }
      const earlier = previous?.[id];
      const accepted: LockLicense | undefined =
        earlier ??
        (accept.includes(id) || accept.includes("*")
          ? { class: entry.class, by: "flag", at: now }
          : policy.includes(id) || policy.includes("*")
            ? { class: entry.class, by: "host", at: now }
            : undefined);
      if (accepted === undefined) {
        const disclosure: LicenseDisclosure = { ...base, acknowledgment: "missing" };
        disclosures.push(disclosure);
        missing.push(disclosure);
        continue;
      }
      record[id] = accepted;
      disclosures.push({
        ...base,
        acknowledgment: accepted.by === "host" ? "host" : "accepted",
        acceptedAt: accepted.at,
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

  /**
   * Loads a set: static checks, conflicts with `others`, then (when nothing static refused it)
   * each Node.js entry in a plugin child. `entries: false` skips the child, for a set whose code
   * may not run yet.
   */
  const load = async (
    set: readonly Installed[],
    others: readonly Installed[],
    cwd: string,
    entries = true,
  ): Promise<Map<Installed, Diagnostic[]>> => {
    const found = new Map<Installed, Diagnostic[]>(
      set.map((plugin) => [plugin, staticChecks(plugin)]),
    );
    for (const [plugin, list] of conflicts(set, others)) {
      found.set(plugin, [...(found.get(plugin) ?? []), ...list]);
    }
    const clean = set.filter(
      (plugin) => !(found.get(plugin) ?? []).some((diagnostic) => diagnostic.severity === "error"),
    );
    if (entries && clean.length > 0) {
      for (const [plugin, list] of await inspectEntries(clean, cwd)) {
        found.set(plugin, [...(found.get(plugin) ?? []), ...list]);
      }
    }
    return found;
  };

  const firstError = (
    found: Map<Installed, readonly Diagnostic[]>,
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
        message: `This install brings ${missing.length === 1 ? "a license" : "licenses"} that need an acknowledgment: ${missing
          .map(
            (license) =>
              `${license.id} (${license.class}; ${license.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")})${license.summary ? `: ${license.summary}` : ""}${license.url ? ` ${license.url}` : ""}`,
          )
          .join("; ")}. Nothing was installed.`,
        fix: {
          kind: "command",
          command: `${command} ${missing.map((license) => `--accept-license ${license.id}`).join(" ")}`,
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

  const commandFor = (scope: Scope, packages: readonly string[]): string =>
    `mostra plugin add ${packages.join(" ")} ${scope.kind === "home" ? "--global" : `--artifact ${shellWord(scope.target.artifactPath)}`}`;

  return {
    async validate(path) {
      const diagnostics: Diagnostic[] = [];
      if (!existsSync(join(path, "package.json"))) {
        throw error("MOSTRA_PLUGIN_NOT_A_PLUGIN", `${path} has no package.json.`);
      }
      const plugin = await readPackage(path, "artifact");
      const found = await load([plugin], [], plugin.dir);
      diagnostics.push(...(found.get(plugin) ?? []));
      // Licenses as far as the package's own directory shows them: its dependencies, when
      // installed beside it, and what it declares.
      if (plugin.manifest !== undefined) {
        try {
          const licenses = await disclose([plugin], undefined, []);
          diagnostics.push(...(licenses.warnings.get(plugin) ?? []));
        } catch (problem) {
          log.warn("plugins.validate_licenses", { message: String(problem) });
        }
        const own = packageLicense(plugin.json as { license?: unknown });
        if (own !== undefined && !sameExpression(own, plugin.manifest.license)) {
          diagnostics.push(
            createDiagnostic("MOSTRA_LICENSE_MISMATCH", {
              message: `The manifest's license is ${plugin.manifest.license}; package.json's is ${own}.`,
              location: at(plugin, ["license"]),
            }),
          );
        }
      }
      const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
      return {
        valid,
        ...(plugin.manifest !== undefined ? { plugin: summary(plugin, diagnostics) } : {}),
        diagnostics,
      };
    },

    async add(scope, input) {
      checkAccepted(input.accept);
      const target = await targetOf(scope);
      const others = scope.kind === "artifact" ? await homePlugins() : [];
      return dependencies.change<PluginAddResult>(
        { ...target, add: input.packages, request: input.request },
        async (staged: StagedChange) => {
          const names = staged.added.map((pkg) => pkg.name);
          const previous = staged.previous?.plugins ?? [];
          const order = [...previous, ...names.filter((name) => !previous.includes(name))];
          const set = await installedOf(
            { ...staged.lock, plugins: order },
            staged.nodeModules,
            scope.kind,
          );
          const fresh = set.filter((plugin) => names.includes(plugin.name));
          // 1. What needs no code: manifests, ranges, scope, files, conflicts.
          const statics = await load(set, others, target.artifactDir, false);
          const refusal = firstError(statics, fresh);
          if (refusal !== undefined) throw new RpcError(refusal);
          // 2. Licenses, before any of the packages' code runs.
          const licenses = await disclose(set, staged.previous?.licenses, input.accept);
          if (licenses.missing.length > 0) {
            throw unacceptedError(licenses.missing, commandFor(scope, input.packages));
          }
          // 3. The deferred lifecycle scripts, then each entry in a plugin child.
          await staged.ready();
          const entries = await inspectEntries(set, target.artifactDir);
          const loaded = new Map<Installed, Diagnostic[]>(
            set.map((plugin) => [
              plugin,
              [
                ...(statics.get(plugin) ?? []),
                ...(entries.get(plugin) ?? []),
                ...(licenses.warnings.get(plugin) ?? []),
              ],
            ]),
          );
          const broken = firstError(loaded, fresh);
          if (broken !== undefined) throw new RpcError(broken);
          log.info("plugins.added", {
            scope: scope.kind,
            plugins: names,
            licenses: Object.keys(licenses.record),
          });
          return {
            plugins: order,
            // An acknowledgment is given once for the artifact (D31): it stays when a later
            // install, or a removal, no longer needs it.
            licenses: { ...(staged.previous?.licenses ?? {}), ...licenses.record },
            result: (lockDigest) => ({
              plugins: set.map((plugin) => summary(plugin, loaded.get(plugin) ?? [])),
              added: names,
              licenses: licenses.disclosures.filter((license) =>
                license.packages.some((pkg) =>
                  fresh.some((plugin) => licenses.closures.get(plugin)?.has(pkg.name)),
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
      const others = scope.kind === "artifact" ? await homePlugins() : [];
      const found = await load(set, others, target.artifactDir);
      const licenses = await disclose(set, staged?.lock.licenses, []);
      return {
        plugins: set.map((plugin) =>
          summary(plugin, [...(found.get(plugin) ?? []), ...(licenses.warnings.get(plugin) ?? [])]),
        ),
        licenses: licenses.disclosures,
      };
    },

    async remove(scope, input) {
      const target = await targetOf(scope);
      const current = await dependencies.working(target);
      const plugins = current?.lock.plugins ?? [];
      for (const name of input.packages) {
        if (!plugins.includes(name)) {
          throw error(
            "MOSTRA_PLUGIN_NOT_INSTALLED",
            `${name} isn't a plugin of ${scope.kind === "home" ? "the home" : scope.target.artifactPath}; it has ${plugins.length > 0 ? plugins.join(", ") : "none"}.`,
          );
        }
      }
      const others = scope.kind === "artifact" ? await homePlugins() : [];
      return dependencies.change<PluginRemoveResult>(
        { ...target, add: [], remove: input.packages, request: input.request },
        async (staged) => {
          const order = plugins.filter((name) => !input.packages.includes(name));
          const set = await installedOf(
            { ...staged.lock, plugins: order },
            staged.nodeModules,
            scope.kind,
          );
          const found = await load(set, others, target.artifactDir, false);
          return {
            plugins: order,
            licenses: { ...(staged.previous?.licenses ?? {}) },
            result: (lockDigest) => ({
              removed: [...input.packages],
              plugins: set.map((plugin) => summary(plugin, found.get(plugin) ?? [])),
              lockDigest,
            }),
          };
        },
      );
    },

    async check(input) {
      const lock = parseLock(input.lock);
      if ((lock.plugins?.length ?? 0) === 0) return;
      const set = await installedOf(lock, input.nodeModules, "artifact");
      const others = await homePlugins();
      const found = await load(set, others, dirname(input.nodeModules));
      const broken = firstError(found);
      if (broken !== undefined) throw new RpcError(broken);
      const licenses = await disclose(set, lock.licenses, []);
      if (licenses.missing.length > 0) {
        throw unacceptedError(
          licenses.missing,
          `mostra plugin add ${lock.plugins?.join(" ") ?? ""} --artifact <path>`,
        );
      }
    },

    async disclosePackages(input) {
      checkAccepted(input.accept);
      const set: Installed[] = [];
      for (const name of input.packages) {
        const dir = join(input.nodeModules, name);
        if (existsSync(join(dir, "package.json"))) set.push(await readPackage(dir, "artifact"));
      }
      const licenses = await disclose(set, input.previous, input.accept);
      if (licenses.missing.length > 0) throw unacceptedError(licenses.missing, input.command);
      return { disclosures: licenses.disclosures, record: licenses.record };
    },

    async packItem(target, pkg, item) {
      const staged = await dependencies.working(target).catch(() => undefined);
      const own = await installedOf(staged?.lock, staged?.nodeModules, "artifact");
      for (const plugin of [...own, ...(await homePlugins())]) {
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
      const own =
        target === undefined
          ? []
          : await (async () => {
              const staged = await dependencies.working(target).catch(() => undefined);
              return installedOf(staged?.lock, staged?.nodeModules, "artifact");
            })();
      const found: PluginCommandInfo[] = [];
      // An artifact's plugin and the home's never share a command (conflicts refuse it); the
      // home's come first, as `mostra` finds them first.
      for (const plugin of [...(await homePlugins()), ...own]) {
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

    async exporters(target) {
      const staged = await dependencies.working(target);
      const own = await installedOf(staged?.lock, staged?.nodeModules, "artifact");
      const home = await homePlugins();
      const found: ExporterRef[] = [];
      for (const plugin of [...own, ...home]) {
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
          });
        }
      }
      return found;
    },

    async runExport(input) {
      const request: ExportRequest = {
        file: input.exporter.file,
        export: input.exporter.export,
        versionDir: input.versionDir,
        version: input.version,
        options: input.options,
        mostraVersion: options.runtimeVersion,
      };
      return inChild<ExportResponse>(
        input.exporter.dir,
        `export:${input.exporter.id}`,
        (child) =>
          child.request(EXPORT_METHOD, request as unknown as Record<string, unknown>, {
            timeoutMs: childTimeoutMs,
          }) as Promise<ExportResponse>,
      );
    },
  };
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

/** A path as a shell word for a fix command. */
function shellWord(value: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
