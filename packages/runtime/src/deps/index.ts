/**
 * Dependencies (D20, D43, D94, D95; DP-01 to DP-05): which packages an artifact's build resolves.
 *
 * - The **warm set** is a pre-built, read-only layout. An artifact that imports only warm packages
 *   builds against it with no install.
 * - **On-demand packages** install through pnpm 10 into the home's shared, content-addressed store
 *   (`deps/store`) and are linked into one layout per lockfile (`deps/locks/<lockDigest>`), whose
 *   `package.json` links every warm package through one `warm` symlink. pnpm resolves each peer
 *   dependency to the warm copy, so React exists once.
 * - Each artifact has a **working lockfile** in the ledger, keyed by its artifact ID (or source
 *   path before its first publish). Every pin is exact, and the lockfile seeds each resolution, so
 *   a republish is reproducible and works offline; publish freezes it into the version.
 * - Installs run in an **install child** in the artifact's source directory with the artifact
 *   environment; lifecycle scripts run there, never in the supervisor.
 *
 * ```ts
 * const deps = createDependencies({ home, ledger, processes, log, env, warm });
 * const resolved = await deps.resolve({ key, sourceDir, artifactDir, artifactPath });
 * // resolved.lock → versions/<id>/lock.yaml; resolved.lockDigest → envDigest; resolved.nodeModules → the build
 * ```
 */
import { randomBytes } from "node:crypto";
import { existsSync, readlinkSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  type AddedPackage,
  createDiagnostic,
  type DependencyPolicy,
  type DepsAddResult,
  RpcError,
} from "@mostra/protocol";
import semver from "semver";
import { type Faults, noFaults } from "../faults.ts";
import type { Gate } from "../gate.ts";
import {
  type Ledger,
  type LedgerDb,
  type RequestKey,
  recordedResult,
  recordResult,
} from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";
import { createInstaller, INSTALL_TIMEOUT_MS, type Installer } from "./installer.ts";
import { type Lock, lockDigest, lockText, parseLock, pinnedPackages } from "./lock.ts";
import { scanImports } from "./scan.ts";
import { type PackageSpec, parseSpec } from "./specifier.ts";
import type { WarmSet } from "./warm.ts";

export { lockDigest, lockText, parseLock } from "./lock.ts";
export { scanImports } from "./scan.ts";
export { packageOf, parseSpec } from "./specifier.ts";
export { locateWarmSet, runtimeRoot, type WarmSet } from "./warm.ts";

/** The marker a complete lock layout carries; a layout without it is rebuilt. */
const LAYOUT_MARKER = ".mostra-layout";

/** Options for {@link createDependencies}. */
export interface DependenciesOptions {
  /** The instance's gate: layout installs hold it shared, so gc never runs beside one (D140). */
  readonly gate?: Gate;
  /** The home's real path; `deps/` lives in it. */
  readonly home: string;
  readonly ledger: Ledger;
  readonly processes: ProcessManager;
  readonly log: Log;
  /** The supervisor's environment: `MOSTRA_OFFLINE`, and the source of the artifact environment. */
  readonly env: Environment;
  readonly warm: WarmSet;
  /** The home's dependency policy, read when it is needed. */
  readonly policy: () => DependencyPolicy;
  /** Default 300 s (FAILURE_MODEL §9). */
  readonly installTimeoutMs?: number;
  /** Test fault points `deps:*`. */
  readonly faults?: Faults;
}

/** What a build resolves its packages from. */
export interface ResolvedDependencies {
  /** The lockfile's text, written into the version as `lock.yaml`. */
  readonly lock: string;
  /** Its SHA-256, part of `envDigest` (DP-03). */
  readonly lockDigest: string;
  /** The `node_modules` the build links: the warm layout, or the lock's layout. */
  readonly nodeModules: string;
}

/** A resolution, and the step that makes it the artifact's working lockfile. */
export interface Resolution extends ResolvedDependencies {
  /**
   * Inside the transaction that commits the publish: records the lockfile as the working
   * lockfile of `artifactId`, moving a path-keyed one to it. Nothing is recorded when the publish
   * fails, and a working lockfile changed since the resolution read it (by `deps/add`) is kept.
   */
  save(db: LedgerDb, artifactId: string): void;
}

/** One artifact, as dependencies see it. */
export interface DependencyTarget {
  /** The working lockfile's key: {@link lockKey}. */
  readonly key: string;
  /** The artifact's source directory: the install child's working directory (DP-05). */
  readonly artifactDir: string;
  /** The artifact's source path as callers name it, for the `mostra add` command in diagnostics. */
  readonly artifactPath: string;
}

/** What gc collects of the dependency state (D140 item 14). */
export interface DependencyCollection {
  /** The lock layouts, and the bytes only they hold (files the store doesn't share). */
  readonly lockLayouts: {
    readonly count: number;
    readonly bytes: number;
    readonly names: readonly string[];
  };
  /**
   * The store packages no kept lockfile needs. `bytes` is what the store shrank by in a real run
   * (its files are shared between packages, so a dry run can't attribute them) and 0 in a dry run.
   */
  readonly storePackages: {
    readonly count: number;
    readonly bytes: number;
    readonly packages: readonly string[];
  };
}

/** The dependencies of one instance. */
export interface Dependencies {
  readonly warm: WarmSet;
  /**
   * Resolves the packages the snapshot in `sourceDir` imports into a lockfile and a layout to
   * build with, installing what's missing (or, under the `explicit` policy, refusing it with
   * `MOSTRA_DEP_MISSING`). The caller records it with {@link Resolution.save}.
   */
  resolve(target: DependencyTarget & { readonly sourceDir: string }): Promise<Resolution>;
  /**
   * The `node_modules` a version's server code resolves its packages from at run time (D135):
   * the warm set when the version has no on-demand packages, else the layout of its frozen
   * lockfile, installed again from the store if it was removed. When the warm set moved since the
   * version was built (a runtime with other warm versions), a pinned layout installs the warm
   * packages the version locked at their exact versions, so its server code runs against what it
   * was built with.
   *
   * @throws RpcError `MOSTRA_DEP_OFFLINE`, `MOSTRA_DEP_INSTALL_FAILED` … when a layout can't be made.
   */
  runtimeModules(target: {
    readonly artifactId: string;
    /** The version's directory, holding its `lock.yaml`. */
    readonly versionDir: string;
    /** The artifact's source directory, when it still exists: lifecycle scripts run there. */
    readonly sourceDir?: string;
  }): Promise<string>;
  /**
   * gc's part (D95, D135, D140 item 14): the lock layouts in `deps/locks` that no working
   * lockfile and no lock text in `keep` names (a `pinned-*` layout counts as named by the
   * `lockDigest` its marker records), and the store packages only they need. A dry run lists them;
   * a real run removes the layouts, drops the packages from the store index and runs
   * `pnpm store prune` in the install child. The caller holds the instance's gate alone, so no
   * install runs meanwhile.
   */
  collect(input: {
    /** The `lock.yaml` texts of every version gc keeps. */
    readonly keep: readonly string[];
    readonly dryRun: boolean;
  }): Promise<DependencyCollection>;
  /** `deps/add`: adds packages to the artifact's working lockfile and installs them. */
  add(
    target: DependencyTarget & {
      readonly packages: readonly string[];
      readonly request?: RequestKey | undefined;
    },
  ): Promise<DepsAddResult>;
}

/**
 * At start-up, before any request: removes resolutions and lock layouts a crash left unfinished
 * (a layout is complete only once it carries its marker).
 */
export async function recoverDependencies(options: {
  readonly home: string;
  readonly log: Log;
}): Promise<void> {
  const root = join(options.home, "deps");
  await rm(join(root, "tmp"), { recursive: true, force: true });
  let entries: string[];
  try {
    entries = await readdir(join(root, "locks"));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!existsSync(join(root, "locks", entry, LAYOUT_MARKER))) {
      options.log.info("deps.layout_removed", { lockDigest: entry, reason: "incomplete" });
      await rm(join(root, "locks", entry), { recursive: true, force: true });
    }
  }
}

/** The working lockfile's key: the artifact ID when there is one, else its source path. */
export function lockKey(artifactId: string | undefined, bindingPath: string): string {
  return artifactId ?? `path:${bindingPath}`;
}

/**
 * Whether Mostra is offline (D95): `MOSTRA_OFFLINE` is set, or no network interface has a
 * routable address (link-local addresses don't reach a registry).
 */
export function isOffline(env: Environment): boolean {
  const flag = env["MOSTRA_OFFLINE"];
  if (flag !== undefined && flag !== "" && !/^(?:0|false|no)$/i.test(flag)) return true;
  return !Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some(
      (address) =>
        !address.internal &&
        !address.address.startsWith("169.254.") &&
        !/^fe[89ab]/i.test(address.address),
    ),
  );
}

/** A shell-safe rendering of `value`, for the commands in diagnostics. */
function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Serializes work per key; one supervisor, so in-process order is the order. */
class KeyedQueue {
  readonly #tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const next = (this.#tails.get(key) ?? Promise.resolve()).then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return next;
  }
}

interface WorkingLock {
  readonly lock: Lock;
  /** Packages added through `deps/add`, kept whether or not the source imports them. */
  readonly added: readonly string[];
}

const fail = (code: Parameters<typeof createDiagnostic>[0], message: string): RpcError =>
  new RpcError(createDiagnostic(code, { message }));

/** Creates the dependencies of one instance. */
export function createDependencies(options: DependenciesOptions): Dependencies {
  const { ledger, log, warm } = options;
  const faults = options.faults ?? noFaults;
  const root = join(options.home, "deps");
  const dirs = {
    store: join(root, "store"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    locks: join(root, "locks"),
    tmp: join(root, "tmp"),
  };
  let installer: Installer | undefined;
  const install = (): Installer =>
    (installer ??= createInstaller({
      processes: options.processes,
      log,
      dirs,
      env: options.env,
      timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
    }));
  const byArtifact = new KeyedQueue();
  const byLayout = new KeyedQueue();
  const offline = (): boolean => isOffline(options.env);

  // Every warm package as a link through the layout's `warm` symlink (D95).
  const warmLinks = Object.fromEntries(
    Object.keys(warm.packages).map((name) => [name, `link:warm/${name}`]),
  );
  const manifestOf = (packages: Readonly<Record<string, string>>): string =>
    `${JSON.stringify(
      {
        name: "mostra-artifact-dependencies",
        private: true,
        dependencies: Object.fromEntries(
          Object.entries({ ...warmLinks, ...packages }).sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
      },
      null,
      2,
    )}\n`;

  const readWorking = (key: string): WorkingLock | undefined => {
    const row = ledger.read((db) =>
      db.get<{ lock_text: string; added_json: string }>(
        "SELECT lock_text, added_json FROM dependency_lock WHERE key = ?",
        key,
      ),
    );
    return row
      ? { lock: parseLock(row.lock_text), added: JSON.parse(row.added_json) as string[] }
      : undefined;
  };
  const writeWorking = (key: string, text: string, added: readonly string[]): void => {
    ledger.write((db) =>
      db.run(
        "INSERT INTO dependency_lock (key, lock_text, added_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET lock_text = excluded.lock_text, added_json = excluded.added_json, updated_at = excluded.updated_at",
        key,
        text,
        JSON.stringify([...new Set(added)].sort()),
        new Date().toISOString(),
      ),
    );
  };
  /** A working lockfile's stored text, or `null` without one. */
  const rowText = (key: string): string | null =>
    ledger.read(
      (db) =>
        db.get<{ lock_text: string }>("SELECT lock_text FROM dependency_lock WHERE key = ?", key)
          ?.lock_text ?? null,
    );
  /** Versions of `name` the home's store holds, from the store index. */
  const stored = (name: string): string[] =>
    ledger
      .read((db) =>
        db.all<{ version: string }>("SELECT version FROM dependency_package WHERE name = ?", name),
      )
      .map((row) => row.version);

  const sameRecord = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

  /**
   * Resolves a new lockfile in a scratch project: the pins stay exactly as they are, `additions`
   * resolve through `pnpm add --save-exact`, and the previous installer lockfile seeds the graph.
   * Packages without a pin or an addition leave the lockfile.
   */
  const resolveLock = async (input: {
    readonly key: string;
    readonly artifactDir: string;
    readonly pins: Readonly<Record<string, string>>;
    readonly additions: readonly PackageSpec[];
    readonly previous: string | undefined;
  }): Promise<Lock> => {
    const isOff = offline();
    const additions = input.additions;
    if (isOff) {
      // Offline, only the store can answer (DP-04). When no version it holds can match, say so at
      // once; otherwise pnpm resolves the spec as given from its metadata cache, so tags and the
      // release age still mean what they mean online.
      for (const spec of additions) {
        const versions = stored(spec.name);
        const range = spec.range !== undefined && semver.validRange(spec.range) ? spec.range : "*";
        if (semver.maxSatisfying(versions, range) === null) {
          throw fail(
            "MOSTRA_DEP_OFFLINE",
            `Mostra is offline and the home's package store doesn't hold ${spec.name}${spec.range ? `@${spec.range}` : ""}.`,
          );
        }
      }
    }
    await mkdir(dirs.tmp, { recursive: true });
    const work = join(dirs.tmp, `resolve-${randomBytes(6).toString("hex")}`);
    await mkdir(work);
    try {
      await symlink(warm.nodeModules, join(work, "warm"), "dir");
      await writeFile(join(work, "package.json"), manifestOf(input.pins));
      if (input.previous !== undefined)
        await writeFile(join(work, "pnpm-lock.yaml"), input.previous);
      const outcome = await install().run({
        command:
          additions.length > 0
            ? [
                "add",
                ...additions.map((spec) => (spec.range ? `${spec.name}@${spec.range}` : spec.name)),
                "--save-exact",
                "--lockfile-only",
              ]
            : ["install", "--lockfile-only", "--no-frozen-lockfile"],
        dir: work,
        cwd: input.artifactDir,
        offline: isOff,
        releaseAge: {
          exempt: additions.filter((spec) => spec.exact !== undefined).map((spec) => spec.name),
        },
        ownerRef: input.key,
      });
      if (!outcome.ok) throw new RpcError(outcome.diagnostic);
      const manifest = JSON.parse(await readFile(join(work, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const packages = Object.fromEntries(
        Object.entries(manifest.dependencies ?? {}).filter(([name]) => !(name in warm.packages)),
      );
      if (Object.keys(packages).length === 0) return { warm: warm.packages, packages: {} };
      return {
        warm: warm.packages,
        packages,
        pnpm: await readFile(join(work, "pnpm-lock.yaml"), "utf8"),
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };

  /** Points a layout's `warm` symlink at the current warm set (the runtime may have moved). */
  const relinkWarm = async (dir: string): Promise<void> => {
    const link = join(dir, "warm");
    let target: string | undefined;
    try {
      target = readlinkSync(link);
    } catch {
      target = undefined;
    }
    if (target === warm.nodeModules) return;
    const fresh = `${link}.${randomBytes(4).toString("hex")}`;
    await symlink(warm.nodeModules, fresh, "dir");
    await rename(fresh, link);
  };

  /**
   * The layout of `lock`, installed from the store (and the registry for what the store lacks)
   * into `deps/locks/<lockDigest>` unless it is already complete.
   */
  const ensureLayout = (
    lock: Lock,
    digest: string,
    target: { readonly key: string; readonly artifactDir: string },
  ): Promise<string> =>
    byLayout.run(digest, async () => {
      const dir = join(dirs.locks, digest);
      const nodeModules = join(dir, "node_modules");
      if (existsSync(join(dir, LAYOUT_MARKER))) {
        await relinkWarm(dir);
        return nodeModules;
      }
      const pnpm = lock.pnpm as string;
      const isOff = offline();
      if (isOff) {
        const missing = pinnedPackages(pnpm).find(
          ({ name, version }) => !stored(name).includes(version),
        );
        if (missing) {
          throw fail(
            "MOSTRA_DEP_OFFLINE",
            `Mostra is offline and the home's package store doesn't hold ${missing.name}@${missing.version}.`,
          );
        }
      }
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      try {
        await symlink(warm.nodeModules, join(dir, "warm"), "dir");
        await writeFile(join(dir, "package.json"), manifestOf(lock.packages));
        await writeFile(join(dir, "pnpm-lock.yaml"), pnpm);
        const outcome = await install().run({
          command: ["install", "--frozen-lockfile"],
          dir,
          cwd: target.artifactDir,
          offline: isOff,
          releaseAge: false,
          ownerRef: target.key,
        });
        if (!outcome.ok) throw new RpcError(outcome.diagnostic);
        // The store index first, then the marker: a crash between them leaves an incomplete
        // layout (removed at the next start) over packages the store does hold, never a complete
        // layout whose packages the index doesn't know (D80 review finding 5).
        const now = new Date().toISOString();
        ledger.write((db) => {
          for (const { name, version } of pinnedPackages(pnpm)) {
            db.run(
              "INSERT OR IGNORE INTO dependency_package (name, version, stored_at) VALUES (?, ?, ?)",
              name,
              version,
              now,
            );
          }
        });
        faults.at("deps:before-marker");
        await writeFile(
          join(dir, LAYOUT_MARKER),
          `${JSON.stringify({ lockDigest: digest, installer: install().version })}\n`,
        );
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      log.info("deps.layout_installed", {
        lockDigest: digest,
        packages: Object.keys(lock.packages),
      });
      return nodeModules;
    });

  /**
   * A layout for a version whose locked warm packages the current warm set no longer holds at
   * those versions: each such package installs at its locked version, the others link to the warm
   * set as usual, and the version's installer lockfile seeds the rest of the graph.
   */
  const ensurePinnedLayout = (
    lock: Lock,
    digest: string,
    drifted: readonly string[],
    target: { readonly key: string; readonly artifactDir: string },
  ): Promise<string> => {
    const name = `pinned-${lockDigest(`${digest}\n${JSON.stringify(warm.packages)}`)}`;
    return byLayout.run(name, async () => {
      const dir = join(dirs.locks, name);
      const nodeModules = join(dir, "node_modules");
      if (existsSync(join(dir, LAYOUT_MARKER))) {
        await relinkWarm(dir);
        return nodeModules;
      }
      const pinnedWarm = Object.fromEntries(
        Object.keys(lock.warm).map((pkg) => [
          pkg,
          drifted.includes(pkg) ? (lock.warm[pkg] as string) : `link:warm/${pkg}`,
        ]),
      );
      const isOff = offline();
      if (isOff) {
        const missing = drifted.find((pkg) => !stored(pkg).includes(lock.warm[pkg] as string));
        if (missing) {
          throw fail(
            "MOSTRA_DEP_OFFLINE",
            `Mostra is offline, and this version's server code needs ${missing}@${lock.warm[missing]}, which the warm set no longer holds and the home's package store doesn't.`,
          );
        }
      }
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      try {
        await symlink(warm.nodeModules, join(dir, "warm"), "dir");
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify(
            {
              name: "mostra-artifact-dependencies",
              private: true,
              dependencies: Object.fromEntries(
                Object.entries({ ...pinnedWarm, ...lock.packages }).sort(([a], [b]) =>
                  a < b ? -1 : 1,
                ),
              ),
            },
            null,
            2,
          )}\n`,
        );
        if (lock.pnpm !== undefined) await writeFile(join(dir, "pnpm-lock.yaml"), lock.pnpm);
        const outcome = await install().run({
          command: ["install", "--no-frozen-lockfile"],
          dir,
          cwd: target.artifactDir,
          offline: isOff,
          // Every version here was accepted when the version was published.
          releaseAge: false,
          ownerRef: target.key,
        });
        if (!outcome.ok) throw new RpcError(outcome.diagnostic);
        const now = new Date().toISOString();
        const pinned = await readFile(join(dir, "pnpm-lock.yaml"), "utf8").catch(() => "");
        ledger.write((db) => {
          for (const { name: pkg, version } of pinnedPackages(pinned)) {
            db.run(
              "INSERT OR IGNORE INTO dependency_package (name, version, stored_at) VALUES (?, ?, ?)",
              pkg,
              version,
              now,
            );
          }
        });
        await writeFile(
          join(dir, LAYOUT_MARKER),
          `${JSON.stringify({ lockDigest: digest, pinned: drifted, installer: install().version })}\n`,
        );
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      log.info("deps.pinned_layout_installed", { lockDigest: digest, pinned: drifted });
      return nodeModules;
    });
  };

  /** Settles a lockfile: its text, digest and layout. */
  const settle = async (
    lock: Lock,
    target: { readonly key: string; readonly artifactDir: string },
  ): Promise<ResolvedDependencies> => {
    const text = lockText(lock);
    const digest = lockDigest(text);
    const nodeModules =
      Object.keys(lock.packages).length === 0
        ? warm.nodeModules
        : await ensureLayout(lock, digest, target);
    return { lock: text, lockDigest: digest, nodeModules };
  };

  const runtimeModules = async (target: {
    readonly artifactId: string;
    readonly versionDir: string;
    readonly sourceDir?: string;
  }): Promise<string> => {
    const text = await readFile(join(target.versionDir, "lock.yaml"), "utf8");
    const lock = parseLock(text);
    const digest = lockDigest(text);
    const where = { key: target.artifactId, artifactDir: target.sourceDir ?? target.versionDir };
    // Mostra's own packages always come from this runtime: they aren't on a registry to pin.
    const drifted = Object.keys(lock.warm)
      .filter((pkg) => !pkg.startsWith("@mostra/"))
      .filter((pkg) => warm.packages[pkg] !== lock.warm[pkg]);
    if (drifted.length > 0) return ensurePinnedLayout(lock, digest, drifted, where);
    if (Object.keys(lock.packages).length === 0) return warm.nodeModules;
    return ensureLayout(lock, digest, where);
  };

  /** gc's part (D140 item 14); see {@link Dependencies.collect}. */
  const collect = async (input: {
    readonly keep: readonly string[];
    readonly dryRun: boolean;
  }): Promise<DependencyCollection> => {
    const working = ledger.read((db) =>
      db
        .all<{ lock_text: string }>("SELECT lock_text FROM dependency_lock")
        .map((row) => row.lock_text),
    );
    const texts = [...working, ...input.keep];
    const named = new Set(texts.map((text) => lockDigest(text)));
    const needed = new Set<string>();
    const need = (pnpm: string | undefined): void => {
      if (pnpm === undefined) return;
      for (const { name, version } of pinnedPackages(pnpm)) needed.add(`${name}@${version}`);
    };
    for (const text of texts) {
      try {
        need(parseLock(text).pnpm);
      } catch {
        // A lockfile Mostra can't read names no package it could keep.
      }
    }
    const entries = await readdir(dirs.locks).catch(() => [] as string[]);
    const layouts: string[] = [];
    let layoutBytes = 0;
    for (const name of entries.sort()) {
      const dir = join(dirs.locks, name);
      let digest = name;
      try {
        const marker = JSON.parse(await readFile(join(dir, LAYOUT_MARKER), "utf8")) as {
          lockDigest?: unknown;
        };
        if (typeof marker.lockDigest === "string") digest = marker.lockDigest;
      } catch {
        // Unfinished: recovery at start removes it, never gc.
        continue;
      }
      if (named.has(digest)) {
        // A kept pinned layout needs its own installer lockfile's packages too.
        need(await readFile(join(dir, "pnpm-lock.yaml"), "utf8").catch(() => undefined));
        continue;
      }
      layouts.push(name);
      layoutBytes += await unsharedBytes(dir);
    }
    const unneeded = ledger
      .read((db) =>
        db.all<{ name: string; version: string }>("SELECT name, version FROM dependency_package"),
      )
      .map((row) => `${row.name}@${row.version}`)
      .filter((id) => !needed.has(id))
      .sort();
    let storeBytes = 0;
    if (!input.dryRun) {
      for (const name of layouts) {
        await rm(join(dirs.locks, name), { recursive: true, force: true });
        log.info("deps.layout_collected", { layout: name });
      }
      if (unneeded.length > 0) {
        ledger.write((db) => {
          for (const id of unneeded) {
            const at = id.lastIndexOf("@");
            db.run(
              "DELETE FROM dependency_package WHERE name = ? AND version = ?",
              id.slice(0, at),
              id.slice(at + 1),
            );
          }
        });
      }
      if (existsSync(dirs.store) && (layouts.length > 0 || unneeded.length > 0)) {
        const before = await apparentBytes(dirs.store);
        const scratch = join(dirs.tmp, `prune-${randomBytes(6).toString("hex")}`);
        await mkdir(scratch, { recursive: true });
        try {
          const outcome = await install().run({
            command: ["store", "prune"],
            dir: scratch,
            cwd: scratch,
            offline: true,
            releaseAge: false,
            ownerRef: "gc",
          });
          if (!outcome.ok) throw new RpcError(outcome.diagnostic);
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
        storeBytes = Math.max(0, before - (await apparentBytes(dirs.store)));
      }
    }
    return {
      lockLayouts: { count: layouts.length, bytes: layoutBytes, names: layouts },
      storePackages: { count: unneeded.length, bytes: storeBytes, packages: unneeded },
    };
  };

  return {
    warm,

    runtimeModules: (target) =>
      options.gate ? options.gate.shared(() => runtimeModules(target)) : runtimeModules(target),

    collect,

    resolve: (target) =>
      byArtifact.run(target.key, async () => {
        const imports = await scanImports(target.sourceDir);
        const working = readWorking(target.key);
        const added = (working?.added ?? []).filter((name) => !(name in warm.packages));
        const needed = [
          ...new Set([...[...imports.keys()].filter((name) => !(name in warm.packages)), ...added]),
        ].sort();
        const pinned = working?.lock.packages ?? {};
        const missing = needed.filter((name) => pinned[name] === undefined);
        if (missing.length > 0 && options.policy() === "explicit") {
          const first = missing[0] as string;
          const site = imports.get(first);
          const command = `mostra add ${missing.join(" ")} --artifact ${shellQuote(target.artifactPath)}`;
          throw new RpcError(
            createDiagnostic("MOSTRA_DEP_MISSING", {
              message: `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} in the warm set or the artifact's lockfile, and this home's dependency policy is explicit.`,
              ...(site ? { location: site } : {}),
              fix: { kind: "command", command },
            }),
          );
        }
        const pins = Object.fromEntries(
          needed
            .filter((name) => pinned[name] !== undefined)
            .map((name) => [name, pinned[name] as string]),
        );
        let lock: Lock;
        if (needed.length === 0) {
          lock = { warm: warm.packages, packages: {} };
        } else if (
          missing.length === 0 &&
          working?.lock.pnpm !== undefined &&
          sameRecord(pins, pinned) &&
          sameRecord(working.lock.warm, warm.packages)
        ) {
          // Exactly the working lockfile: nothing to resolve, and it works offline.
          lock = working.lock;
        } else {
          lock = await resolveLock({
            key: target.key,
            artifactDir: target.artifactDir,
            pins,
            additions: missing.map((name) => ({ name })),
            previous: working?.lock.pnpm,
          });
        }
        const resolved = await settle(lock, target);
        const seen = rowText(target.key);
        return {
          ...resolved,
          save(db, artifactId) {
            const current = db.get<{ lock_text: string; added_json: string }>(
              "SELECT lock_text, added_json FROM dependency_lock WHERE key = ?",
              target.key,
            );
            // deps/add changed it after this resolution read it: the newer lockfile stays.
            if ((current?.lock_text ?? null) !== seen) return;
            const now = new Date().toISOString();
            if (target.key !== artifactId) {
              db.run("DELETE FROM dependency_lock WHERE key = ?", target.key);
            }
            db.run(
              "INSERT INTO dependency_lock (key, lock_text, added_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET lock_text = excluded.lock_text, added_json = excluded.added_json, updated_at = excluded.updated_at",
              artifactId,
              resolved.lock,
              JSON.stringify([...new Set(added)].sort()),
              now,
            );
          },
        };
      }),

    add: (target) =>
      byArtifact.run(target.key, async () => {
        const request = target.request;
        const recorded =
          request === undefined
            ? undefined
            : ledger.read((db) => recordedResult<DepsAddResult>(db, request));
        if (recorded !== undefined) return recorded;
        const specs: PackageSpec[] = [];
        for (const text of target.packages) {
          const spec = parseSpec(text);
          if (!spec) {
            throw fail(
              "MOSTRA_DEP_SPEC_INVALID",
              `"${text}" isn't a registry package spec (name, name@version, name@range or name@tag).`,
            );
          }
          specs.push(spec);
        }
        for (const spec of specs) {
          const version = warm.packages[spec.name];
          if (version === undefined || spec.range === undefined) continue;
          const fits = semver.validRange(spec.range)
            ? semver.satisfies(version, spec.range)
            : spec.range === "latest";
          if (!fits) {
            throw fail(
              "MOSTRA_DEP_WARM_CONFLICT",
              `${spec.name} is in the warm set at ${version}, which every artifact uses; ${spec.name}@${spec.range} can't replace it.`,
            );
          }
        }
        const working = readWorking(target.key);
        const pinned = working?.lock.packages ?? {};
        const onDemand = specs.filter((spec) => !(spec.name in warm.packages));
        // A bare name that is already pinned keeps its pin; anything else resolves now.
        const additions = onDemand.filter(
          (spec) => spec.range !== undefined || pinned[spec.name] === undefined,
        );
        const additionNames = new Set(additions.map((spec) => spec.name));
        const pins = Object.fromEntries(
          Object.entries(pinned).filter(
            ([name]) => !additionNames.has(name) && !(name in warm.packages),
          ),
        );
        const lock: Lock =
          additions.length === 0 &&
          working !== undefined &&
          sameRecord(working.lock.warm, warm.packages)
            ? working.lock
            : Object.keys(pins).length === 0 && additions.length === 0
              ? { warm: warm.packages, packages: {} }
              : await resolveLock({
                  key: target.key,
                  artifactDir: target.artifactDir,
                  pins,
                  additions,
                  previous: working?.lock.pnpm,
                });
        const resolved = await settle(lock, target);
        const added = [...(working?.added ?? []), ...onDemand.map((spec) => spec.name)];
        writeWorking(target.key, resolved.lock, added);
        const packages: AddedPackage[] = specs.map((spec) => {
          const warmVersion = warm.packages[spec.name];
          return warmVersion !== undefined
            ? { name: spec.name, version: warmVersion, warm: true }
            : { name: spec.name, version: lock.packages[spec.name] as string, warm: false };
        });
        const result: DepsAddResult = { packages, lockDigest: resolved.lockDigest };
        if (request !== undefined) ledger.write((db) => recordResult(db, request, result));
        return result;
      }),
  };
}

/** The bytes of the files under `dir` that nothing else links to (a layout's own files). */
async function unsharedBytes(dir: string): Promise<number> {
  let total = 0;
  for (const info of await files(dir)) if (info.nlink <= 1) total += info.size;
  return total;
}

/** The apparent size of a tree, counting each inode once. */
async function apparentBytes(dir: string): Promise<number> {
  const seen = new Set<number>();
  let total = 0;
  for (const info of await files(dir)) {
    if (seen.has(info.ino)) continue;
    seen.add(info.ino);
    total += info.size;
  }
  return total;
}

/** The regular files under `dir`, as `lstat` sees them; symbolic links are never followed. */
async function files(dir: string): Promise<{ size: number; nlink: number; ino: number }[]> {
  const found: { size: number; nlink: number; ino: number }[] = [];
  const walk = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const info = await lstat(child).catch(() => undefined);
        if (info) found.push({ size: info.size, nlink: info.nlink, ino: info.ino });
      }
    }
  };
  await walk(dir);
  return found;
}
