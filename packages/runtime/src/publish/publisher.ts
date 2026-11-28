/**
 * Publish (ARCHITECTURE §3, VR-01, VR-02, VR-11): freezes an artifact's source into an immutable,
 * content-addressed version. Steps, any of which can fail and leave no visible version:
 *
 * 1. snapshot the source into staging and read its manifest from the snapshot (never running it);
 * 2. resolve and freeze the dependencies into `lock.yaml` (D95), installing what's missing;
 * 3. compute `sourceDigest`, `envDigest` and the version ID (D89);
 * 4. (the verify gate, WP-09);
 * 5. build in a builder child, archive the source snapshot into `sources/`, seal the output and
 *    rename it into `versions/`;
 * 6. commit the version, the source binding and `version.published` in one ledger transaction;
 * 7. return the receipt.
 *
 * Staging lives in the home, and a version directory without its ledger row is removed at the next
 * start, so a crash at any step leaves nothing visible (FAILURE_MODEL §3).
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import {
  type ArtifactCreateParams,
  type ArtifactCreateResult,
  type ArtifactDetail,
  type ArtifactExportParams,
  type ArtifactExportResult,
  ArtifactId,
  type ArtifactImportParams,
  type ArtifactManifest,
  type ArtifactPublishParams,
  type ArtifactRef,
  type ArtifactVerifyParams,
  BROWSER_PROTOCOL_REVISION,
  createDiagnostic,
  type DemoBuildOutcome,
  type DemoBuildParams,
  type DemoBuildResult,
  type DepsAddParams,
  type DepsAddResult,
  type Diagnostic,
  isDemoBuild,
  type PublishReceipt,
  RpcError,
  type SourceRef,
  type SubmissionPolicy,
  type VerifyVerdict,
  type VersionSummary,
} from "@mostra/protocol";
import type { RenderMode } from "../builder/index.ts";
import {
  type DemoInputs,
  type Demos,
  demoBuilds,
  demoDigestOf,
  demoProblems,
  injectDemoAgent,
} from "../demos/index.ts";
import {
  type Dependencies,
  type DependencyTarget,
  lockKey,
  parseLock,
  type Resolution,
} from "../deps/index.ts";
import { type Faults, noFaults } from "../faults.ts";
import type { Gate } from "../gate.ts";
import {
  contributedAnchorProviders,
  contributedThemes,
  kitBuildFor,
  kitVersionOf,
} from "../kit/index.ts";
import {
  InflightRequests,
  type Ledger,
  type RequestKey,
  recordedResult,
  recordResult,
  requestKey,
} from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { renamePath } from "../platform/index.ts";
import { fsyncPath, type Registry, removeTree } from "../registry/index.ts";
import {
  type BuildOutcome,
  errorCodes,
  type PreparedSource,
  VERIFY_REVISION,
  type Verifier,
} from "../verify/index.ts";
import { readBundle, writeBundle } from "./bundle.ts";
import {
  type BuildEnvironment,
  canonicalJson,
  environmentDigest,
  type ListedFile,
  listingDigest,
  sha256Hex,
  versionIdFor,
} from "./digest.ts";
import { extractManifest } from "./manifest.ts";
import { SCAFFOLD_PATHS, type ScaffoldInput, scaffoldFiles } from "./scaffold.ts";
import {
  copySnapshot,
  listSource,
  type ResolvedSource,
  readEntry,
  resolveSource,
} from "./source.ts";
import { TAR_END, tarFile } from "./tar.ts";

/** Options for {@link createPublisher}. */
export interface PublisherOptions {
  readonly registry: Registry;
  readonly ledger: Ledger;
  readonly renderMode: RenderMode;
  /** Resolves each build's packages and lockfile (D95). */
  readonly dependencies: Dependencies;
  /** This runtime's release (`mostraVersion` in `envDigest`). */
  readonly runtimeVersion: string;
  readonly log: Log;
  /** Test fault points `publish:*` (VR-02). */
  readonly faults?: Faults;
  /** The home's submission policy (`HomeConfig.submission`, D102), read at each publish. */
  readonly homePolicy?: () => SubmissionPolicy | undefined;
  /**
   * The theme stack a page that names none wears in this home (`HomeConfig.look.theme`, D181
   * item 5), read at each publish and verify; absent, Studio.
   */
  readonly homeTheme?: () => string | readonly string[] | undefined;
  /** Builds the page's demos (D185 item 4); absent, a page with demos fails to build. */
  readonly demos?: Demos;
  /** The verifier, made on first use: publish's gate and `artifact/verify` (D41, D138). */
  readonly verifier: () => Verifier;
  /**
   * Tests of other features only (`MOSTRA_TEST_UNVERIFIED_PUBLISH`): publish without the gate.
   * Such a version records no verdict, so it never counts as passing (D138 item 4).
   */
  readonly unverified?: boolean;
  /**
   * The instance's gate (D140 item 14): publishes, verify runs and dependency additions hold it
   * shared, so `gc` never removes files they use.
   */
  readonly gate?: Gate;
}

/** A version an export reads: its artifact, its summary and its sealed directory. */
export interface ExportableVersion {
  readonly detail: ArtifactDetail;
  readonly summary: VersionSummary;
  readonly versionDir: string;
}

/** Publishes and creates artifacts. */
export interface Publisher {
  /** `artifact/publish`: gated by verify (D41). */
  publish(params: ArtifactPublishParams): Promise<PublishReceipt>;
  /** `artifact/verify`: one run, its verdict cached for the publish that follows (D138). */
  verify(params: ArtifactVerifyParams, progress?: (stage: string) => void): Promise<VerifyVerdict>;
  /** `artifact/create`. */
  create(params: ArtifactCreateParams): Promise<ArtifactCreateResult>;
  /** `deps/add`: adds packages to an artifact's working lockfile (D95). */
  addDependencies(params: DepsAddParams): Promise<DepsAddResult>;
  /** `artifact/export`: writes a version's portable bundle (RM-01). */
  exportBundle(params: ArtifactExportParams): Promise<ArtifactExportResult>;
  /** `artifact/import`: makes a bundle a version of this home, with its identity (RM-01). */
  importBundle(params: ArtifactImportParams): Promise<PublishReceipt>;
  /** `demo/build`: builds an artifact's demos into the cache now (D185 item 4). */
  /** `demo/build`; `signal` ends a running build with everything it started (Ctrl-C). */
  buildDemos(params: DemoBuildParams, signal?: AbortSignal): Promise<DemoBuildResult>;
  /** A published version, checked whole, as an export reads it (`artifact/export`, `plugin/export`). */
  exportable(params: {
    readonly artifact: ArtifactRef;
    readonly version?: number | string;
  }): Promise<ExportableVersion>;
  /** Runs `task` holding the instance's gate shared, as installs do: the home's own plugins. */
  withHome<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Runs `task` for an artifact's source, holding its path's queue (as its publishes and
   * `deps/add` do) and the instance's gate shared, with the working lockfile's target: what
   * `plugin/*` and `pack/add` change (WP-16).
   */
  withArtifact<T>(
    ref: SourceRef,
    task: (artifact: {
      readonly target: DependencyTarget;
      readonly source: ResolvedSource;
    }) => Promise<T>,
  ): Promise<T>;
}

const ENTRY_NAMES = ["index.tsx", "index.jsx", "index.mdx"];

/** The title of an artifact without a manifest: its directory's name, or a single file's own name. */
export function defaultTitle(source: ResolvedSource): string {
  if (source.kind === "dir") return basename(source.root);
  const stem = basename(source.entry, extname(source.entry));
  return stem === "page" || stem === "index" ? basename(source.root) : stem;
}

/**
 * Whether the source at `path` still claims `artifactId` in its manifest (D51). Synchronous: it
 * runs inside the commit transaction. Anything unreadable no longer claims anything.
 */
function stillClaims(path: string, artifactId: string): boolean {
  // Read, never check-then-read: the source may change between the two (CodeQL js/file-system-race).
  const claims = (file: string): boolean | undefined => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return undefined;
      return false;
    }
    try {
      return extractManifest(basename(file), text).manifest?.id === artifactId;
    } catch {
      return false;
    }
  };
  const asFile = claims(path);
  if (asFile !== undefined) return asFile;
  for (const name of ENTRY_NAMES) {
    const result = claims(join(path, name));
    if (result !== undefined) return result;
  }
  return false;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * The canonical listing of a version's output (DATA_MODEL §2, `outputDigest`): every file under
 * `client/` and `server/`, and `registry.json`, with paths relative to the version directory.
 * The version is sealed read-only (0444), so no file is listed as executable: the digest
 * describes the stored tree exactly and can be recomputed from it.
 */
async function outputListing(versionDir: string): Promise<ListedFile[]> {
  const files: ListedFile[] = [];
  const walk = async (current: string, relative: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute, path);
      else if (entry.isFile()) {
        files.push({ path, executable: false, sha256: await hashFile(absolute) });
      }
    }
  };
  for (const top of ["client", "server"]) {
    if (existsSync(join(versionDir, top))) await walk(join(versionDir, top), top);
  }
  files.push({
    path: "registry.json",
    executable: false,
    sha256: await hashFile(join(versionDir, "registry.json")),
  });
  return files;
}

/**
 * Writes the source snapshot archive (`sources/<artifact>/<sourceDigest>.tar.zst`), atomically.
 * Returns whether it wrote one: an existing archive holds the same tree (content-addressed).
 */
async function archiveSnapshot(
  source: string,
  files: readonly ListedFile[],
  target: string,
): Promise<boolean> {
  if (existsSync(target)) return false;
  const created = !existsSync(dirname(target));
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  // A new artifact directory in sources/ must be durable too.
  if (created) fsyncPath(dirname(dirname(target)), true);
  const temporary = `${target}.${process.pid}.tmp`;
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  async function* blocks(): AsyncGenerator<Buffer> {
    for (const file of sorted) {
      const data = await readFile(join(source, ...file.path.split("/")));
      yield* tarFile({ path: file.path, executable: file.executable, data });
    }
    yield TAR_END;
  }
  // Written owner-writable, synced, then made read-only: Windows flushes a file only through a
  // handle that may write, which a read-only file never opens again.
  try {
    await pipeline(
      Readable.from(blocks()),
      createZstdCompress(),
      createWriteStream(temporary, { mode: 0o600 }),
    );
    fsyncPath(temporary);
    await chmod(temporary, 0o400);
  } catch (error) {
    await removeTree(temporary).catch(() => {});
    throw error;
  }
  await renamePath(temporary, target);
  fsyncPath(dirname(target), true);
  return true;
}

/**
 * What `artifact/create` records for its `requestId`: its result, and the exact text of each file
 * it writes, so a retry, by this runtime or a newer one, completes exactly the bytes the first
 * attempt began (WP-14's GPT and Opus reviews).
 */
interface CreateRecord {
  readonly result: ArtifactCreateResult;
  readonly scaffold: { readonly files: Readonly<Record<string, string>> };
}

/** The text of each of `paths` (of {@link scaffoldFiles}) for `input`. */
function scaffoldText(paths: readonly string[], input: ScaffoldInput): Record<string, string> {
  const all = scaffoldFiles(input);
  return Object.fromEntries(
    paths.flatMap((path) => {
      const text = all.get(path);
      return text === undefined ? [] : [[path, text]];
    }),
  );
}

/**
 * Writes `artifact/create`'s files (`files`, path to text) into `dir`, completing an interrupted
 * write: an existing file whose bytes are the expected text's or a prefix of them (a write cut
 * short, even inside a character) ends as the expected text, and anything else the author has
 * written since is left alone.
 */
async function writeScaffold(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(dir, { recursive: true });
  let wrote = false;
  for (const [path, text] of Object.entries(files)) {
    const expected = Buffer.from(text, "utf8");
    const file = join(dir, path);
    let current: Buffer | undefined;
    try {
      current = await readFile(file);
    } catch {
      current = undefined;
    }
    if (current !== undefined) {
      const prefix =
        current.length <= expected.length && expected.subarray(0, current.length).equals(current);
      if (!prefix || current.length === expected.length) continue;
    }
    await writeFile(file, expected);
    fsyncPath(file);
    wrote = true;
  }
  if (wrote) fsyncPath(dir, true);
}

/**
 * The output digest of a version directory's files (DATA_MODEL §2): what its manifest records and
 * the integrity checks compare. Tests that freeze a version for VR-10 recompute it.
 */
export async function versionOutputDigest(dir: string): Promise<string> {
  return listingDigest(await outputListing(dir));
}

/**
 * What is wrong with a stored version directory, or `undefined` when it is intact: its
 * `manifest.json` names an output digest, and its `client/`, `server/` and `registry.json` still
 * have that digest (DATA_MODEL §2).
 */
/**
 * What is wrong with a stored version directory, or `undefined` when its files still match the
 * output digest its manifest records (FAILURE_MODEL §3). Publish rebuilds a damaged directory; the
 * gateway refuses to show one.
 */
export async function versionDamage(dir: string): Promise<string | undefined> {
  let recorded: unknown;
  try {
    recorded = (
      JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { outputDigest?: unknown }
    ).outputDigest;
  } catch (error) {
    return `its manifest.json can't be read (${(error as NodeJS.ErrnoException).code ?? "invalid JSON"})`;
  }
  try {
    const actual = listingDigest(await outputListing(dir));
    return actual === recorded ? undefined : "its files no longer match their output digest";
  } catch (error) {
    return `its files can't be read (${(error as NodeJS.ErrnoException).code ?? "error"})`;
  }
}

/** Serializes work per key, so two publishes of one artifact never race (FAILURE_MODEL §1 rule 2). */
class KeyedQueue {
  readonly #tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
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

/** The first diagnostic of a failed build, or a generic one. */
function firstDiagnostic(diagnostics: readonly Diagnostic[]): Diagnostic {
  return (
    diagnostics[0] ?? createDiagnostic("MOSTRA_BUILD_FAILED", { message: "The build failed." })
  );
}

/**
 * The verdict of a source verify couldn't prepare (an invalid manifest, dependencies that can't be
 * resolved): that diagnostic alone, never cached (D138 item 3).
 */
function failedVerdict(path: string, diagnostic: Diagnostic): VerifyVerdict {
  return {
    status: diagnostic.severity === "error" ? "fail" : "pass",
    artifact: { path, sourceDigest: "", envDigest: "" },
    diagnostics: [diagnostic],
    screenshots: [],
    aria: [],
    smoke: { interactions: 0, skippedActions: [], stateChanges: 0 },
    regressions: {},
    timingsMs: { total: 0 },
  };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Verify's stand-in artifact ID for a source no manifest `id` or binding names yet: derived from
 * its real path, shaped like a ULID (D77's alphabet), and never committed anywhere.
 */
function stableProvisional(bindingPath: string): string {
  const hash = createHash("sha256")
    .update(`mostra verify provisional\u0000${bindingPath}`)
    .digest();
  let body = CROCKFORD[(hash[0] as number) % 8] as string;
  for (let index = 1; index < 26; index += 1) body += CROCKFORD[(hash[index] as number) % 32];
  return ArtifactId.parse(`art_${body}`);
}

/** Creates the publisher of one instance. */
export function createPublisher(options: PublisherOptions): Publisher {
  const { registry, ledger, renderMode, dependencies, log, verifier } = options;
  const faults = options.faults ?? noFaults;
  const queue = new KeyedQueue();
  const buildConfigDigest = sha256Hex(canonicalJson(renderMode.buildConfig));
  const inflight = new InflightRequests();

  /**
   * Replays the result recorded for a repeated `requestId` with the same parameters (H-03), joins
   * an attempt still running, or runs `task` once. The same `requestId` with other parameters is
   * `MOSTRA_HOST_REQUEST_ID_REUSED`.
   */
  const idempotent = async <T>(key: RequestKey | undefined, task: () => Promise<T>): Promise<T> => {
    if (key === undefined) return task();
    const recorded = ledger.read((db) => recordedResult<T>(db, key));
    if (recorded !== undefined) return recorded;
    return inflight.run(key, task);
  };

  const record = (key: RequestKey | undefined, result: unknown): void => {
    if (key === undefined) return;
    ledger.write((db) => recordResult(db, key, result));
  };

  /** The path a `SourceRef` names: itself, or the path an artifact was last published from. */
  const pathOf = (ref: SourceRef): string => {
    if ("path" in ref) return ref.path;
    const bound = registry.sourceOf(ref.artifactId);
    if (bound === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_NOT_FOUND", {
          message: `No artifact ${ref.artifactId} was published in this home; name it by its source path.`,
        }),
      );
    }
    return bound;
  };

  /**
   * The folders of the artifact that are a demo's (D185 item 4), relative to its root: a demo's
   * project inside it, or its output when the project is the artifact's own folder. Read from the
   * entry as it is on disk, before the snapshot; a manifest that doesn't parse names none.
   */
  const demoFolders = async (source: ResolvedSource): Promise<string[]> => {
    if (source.kind === "file") return [];
    let builds: ReturnType<typeof demoBuilds>;
    try {
      builds = demoBuilds(extractManifest(source.entry, await readEntry(source)).manifest?.demos);
    } catch {
      return [];
    }
    const inside = (path: string): string | undefined => {
      const rel = relative(source.root, path).replaceAll("\\", "/");
      return rel === "" || rel.startsWith("../") || rel === ".." || isAbsolute(rel)
        ? undefined
        : rel;
    };
    const folders: string[] = [];
    for (const [, spec] of builds) {
      const project = resolve(source.root, spec.source);
      const folder = inside(project) ?? inside(resolve(project, spec.output));
      if (folder !== undefined) folders.push(folder.normalize("NFC"));
    }
    return folders;
  };

  /** What {@link prepare} read of a snapshot, besides the {@link PreparedSource}. */
  interface Staged {
    readonly prepared: PreparedSource;
    readonly source: ResolvedSource;
    readonly listed: readonly ListedFile[];
    readonly entryHasDefault: boolean;
    readonly environment: BuildEnvironment;
    readonly deps: Resolution;
    /** Each demo's inputs, or why it has none (D185 item 4). */
    readonly demos: readonly (DemoInputs | Diagnostic)[];
  }

  /**
   * Steps 1 to 3 of a publish, shared with verify (D41, D95): the snapshot, its manifest, the
   * dependencies (resolved exactly as publish does, through the same working lockfile) and the
   * digests. Throws the manifest's or the dependencies' diagnostic.
   */
  const prepare = async (
    path: string,
    source: ResolvedSource,
    provisional: string,
    identityKnown: boolean,
    staging: string,
    themeOverride?: string | readonly string[],
  ): Promise<Staged> => {
    // 1. Snapshot, then read the manifest from the snapshot: what is built is what was read. A
    // demo's project or output inside the artifact is the demo's, never the page's (D185).
    const files = await listSource(source, await demoFolders(source));
    const listed = await copySnapshot(files, join(staging, "source"));
    faults.at("publish:after-snapshot");
    const extracted = extractManifest(
      source.entry,
      await readFile(join(staging, "source", source.entry), "utf8"),
    );
    for (const warning of extracted.warnings)
      log.warn("publish.manifest_warning", { code: warning.code, message: warning.message });
    const manifest: ArtifactManifest = extracted.manifest ?? { title: defaultTitle(source) };
    const artifactId = registry.identityFor(source.bindingPath, manifest.id, () => provisional);
    if (artifactId !== provisional) {
      throw new RpcError(
        createDiagnostic("MOSTRA_PUBLISH_SOURCE_CHANGED", {
          message: `The manifest of ${path} changed while it was being published.`,
        }),
      );
    }

    // 2. The dependencies, from the snapshot's imports and the artifact's working lockfile.
    const deps = await dependencies.resolve({
      key: lockKey(manifest.id ?? registry.artifactAt(source.bindingPath), source.bindingPath),
      sourceDir: join(staging, "source"),
      artifactDir: source.root,
      artifactPath: path,
      kitBase: manifest.kit?.base ?? "base",
    });
    // A lockfile that names plugins passed the plugin gate inside `resolve` (D172 item 5): its
    // ranges, conflicts and licenses, then its entries, so no version records plugins this release
    // can't load, or a license nobody acknowledged.
    faults.at("publish:after-dependencies");

    // 3. Digests (DATA_MODEL §2).
    const sourceDigest = listingDigest(listed);
    // The kit and the theme stack (D181): the stack is the manifest's, so the snapshot's digest
    // covers it and the artifact's own layers; the kit's registry is the layout's, named by its
    // version; the theme's stylesheet is this release's `@mostra/themes`, named by Mostra's.
    // `verify --theme` builds in another stack for that run only (D181 item 6): the theme's
    // digest below covers the stack built, so its verdict is never a publish's.
    // A page that names no theme wears the home's default (a host's, D181 item 5), else Studio.
    const homeTheme = options.homeTheme?.();
    const { kit, theme } = kitBuildFor({
      manifest,
      ...(homeTheme !== undefined ? { homeTheme } : {}),
      ...(themeOverride !== undefined ? { override: themeOverride } : {}),
      sourceDir: join(staging, "source"),
      nodeModules: deps.nodeModules,
      // Themes the artifact's plugins contribute (D181 item 4), from the layout the build reads.
      contributed: contributedThemes(deps.nodeModules, parseLock(deps.lock).plugins ?? []),
      // And their anchor providers, which the page registers (WP-20).
      anchorProviders: contributedAnchorProviders(
        deps.nodeModules,
        parseLock(deps.lock).plugins ?? [],
      ),
    });
    let environment: BuildEnvironment = {
      mostraVersion: options.runtimeVersion,
      kitVersion: kitVersionOf(deps.nodeModules),
      themeDigest: sha256Hex(
        [kit.themeCss, ...kit.themeFiles, kit.host ?? "", themeOverride ? "requested" : ""].join(
          "\0",
        ),
      ),
      kitBase: manifest.kit?.base ?? "base",
      mode: manifest.mode ?? "spa",
      lockDigest: deps.lockDigest,
      buildConfigDigest,
      // The browser protocol the version's client runtime speaks (VR-10, D106).
      browserProtocolRevision: BROWSER_PROTOCOL_REVISION,
    };
    // Each demo's inputs (D185 item 4): what it is built from joins the version's identity.
    const demos: (DemoInputs | Diagnostic)[] = [];
    for (const [name, spec] of demoBuilds(manifest.demos)) {
      if (!options.demos) {
        demos.push(
          createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
            message: `This runtime builds no demos, so the demo "${name}" can't be built here.`,
          }),
        );
        continue;
      }
      try {
        demos.push(await options.demos.inputs(name, spec, source.root));
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        demos.push(error.diagnostic);
      }
    }
    const demoDigest = demoDigestOf(demos.filter((one): one is DemoInputs => "digest" in one));
    if (demoDigest !== undefined) environment = { ...environment, demoDigest };
    const envDigest = environmentDigest(environment);
    const versionId = versionIdFor(artifactId, sourceDigest, envDigest);
    faults.at("publish:after-digests");
    return {
      prepared: {
        path,
        stagingDir: staging,
        sourceDir: source.root,
        manifest,
        warnings: [...extracted.warnings, ...theme.warnings],
        artifactId,
        identityKnown,
        sourceDigest,
        envDigest,
        versionId,
        nodeModules: deps.nodeModules,
        kit,
        theme: {
          stack: theme.stack,
          // The page named none: it wears the home's default, or Studio.
          default: theme.default,
          ...(themeOverride !== undefined ? { requested: true } : {}),
        },
      },
      source,
      listed,
      entryHasDefault: extracted.hasDefaultExport,
      environment,
      deps,
      demos,
    };
  };

  /**
   * Step 5's build, laid out as a version directory in `out`: the client and server builds,
   * `registry.json`, `lock.yaml` and `manifest.json` (whose `forcedCodes` and `verify` publish
   * fills in when it promotes; neither is part of the output digest).
   */
  const stageBuild = async (staged: Staged, out: string): Promise<BuildOutcome> => {
    const { prepared } = staged;
    const built = await renderMode.build({
      stagingDir: prepared.stagingDir,
      entry: staged.source.entry,
      entryHasDefault: staged.entryHasDefault,
      manifest: prepared.manifest,
      versionId: prepared.versionId,
      nodeModules: staged.deps.nodeModules,
      outDir: out,
      kit: prepared.kit,
    });
    const unsupported = demoProblems(prepared.manifest.demos);
    if (!built.ok) return { ok: false, diagnostics: [...built.diagnostics, ...unsupported] };
    // The demos (D185 item 4): built, or found built, and kept with the version's client build.
    const demoFailures: Diagnostic[] = [...unsupported];
    for (const demo of staged.demos) {
      if (!("digest" in demo)) {
        demoFailures.push(demo);
        continue;
      }
      // Copied into the version while the cache keeps the build (review of WP-24, finding 2).
      const kept = join(out, "client", "_mostra", "demos", demo.name);
      const outcome = await (options.demos as Demos).build(demo, { into: kept });
      if (outcome.status === "failed") demoFailures.push(outcome.diagnostic);
      else {
        // Comments anchor inside the demo (D183 item 7), unless it turned the bridge off.
        const agent = built.registry.reviewAgent;
        if (demo.spec.bridge !== false && agent !== undefined) {
          const code = await readFile(join(out, "client", agent), "utf8").catch(() => undefined);
          if (code !== undefined) await injectDemoAgent(kept, code, agent);
        }
      }
    }
    if (demoFailures.length > 0) return { ok: false, diagnostics: demoFailures };
    faults.at("publish:after-build");
    await writeFile(join(out, "registry.json"), `${JSON.stringify(built.registry, null, 2)}\n`);
    await writeFile(join(out, "lock.yaml"), staged.deps.lock);
    const outputDigest = listingDigest(await outputListing(out));
    await writeVersionManifest(out, staged, {
      outputDigest,
      server: built.server,
      forcedCodes: [],
    });
    return { ok: true, outputDigest, registry: built.registry };
  };

  /** Writes a version directory's `manifest.json`. */
  const writeVersionManifest = async (
    out: string,
    staged: Staged,
    fields: {
      readonly outputDigest: string;
      readonly server: boolean;
      readonly forcedCodes: readonly string[];
      readonly verify?: { readonly status: "pass" | "fail"; readonly verifyRevision: string };
    },
  ): Promise<void> => {
    const { prepared } = staged;
    await writeFile(
      join(out, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          artifactId: prepared.artifactId,
          versionId: prepared.versionId,
          mode: staged.environment.mode,
          entry: staged.source.entry,
          server: fields.server,
          manifest: prepared.manifest,
          sourceDigest: prepared.sourceDigest,
          envDigest: prepared.envDigest,
          environment: staged.environment,
          outputDigest: fields.outputDigest,
          forcedCodes: fields.forcedCodes,
          ...(fields.verify ? { verify: fields.verify } : {}),
        },
        null,
        2,
      )}\n`,
    );
  };

  /**
   * Runs `fn` with the source's identity decided and its staging directory made: one at a time per
   * source path, then per artifact (always in that order, so they can't deadlock), so a path-bound
   * artifact's identity is decided once and two copies claiming one ID never promote the same
   * version directory at once. The commit checks the identity again inside its transaction.
   */
  const staged = async <T>(
    ref: SourceRef,
    fn: (input: {
      readonly path: string;
      readonly source: ResolvedSource;
      readonly provisional: string;
      readonly identityKnown: boolean;
      readonly staging: string;
    }) => Promise<T>,
    how?: { readonly stableProvisional?: boolean },
  ): Promise<T> => {
    const path = pathOf(ref);
    const source = await resolveSource(path);
    return queue.run(`path:${source.bindingPath}`, async () => {
      // A manifest that can't be read here is reported by `prepare`, from the snapshot.
      let peeked: string | undefined;
      try {
        peeked = extractManifest(source.entry, await readEntry(source)).manifest?.id;
      } catch {
        peeked = undefined;
      }
      const known = peeked ?? registry.artifactAt(source.bindingPath);
      // An unbound source's artifact is decided at its first publish (D51). Verify's stand-in is
      // derived from the path, so verifying unchanged source again reuses its build; a publish's
      // is new, as the artifact's real ID (Opus review finding 9).
      const provisional =
        known ??
        (how?.stableProvisional ? stableProvisional(source.bindingPath) : ArtifactId.create());
      return queue.run(`artifact:${provisional}`, async () => {
        const staging = await mkdtemp(join(registry.store.stagingDir, "publish-"));
        try {
          return await fn({
            path,
            source,
            provisional,
            identityKnown: known !== undefined,
            staging,
          });
        } finally {
          await removeTree(staging);
          await removeTree(`${staging}-check`);
        }
      });
    });
  };

  const verifyOnce = (params: ArtifactVerifyParams, progress?: (stage: string) => void) =>
    staged(
      params.source,
      async ({ path, source, provisional, identityKnown, staging }) => {
        progress?.("prepare");
        let ready: Staged;
        try {
          ready = await prepare(path, source, provisional, identityKnown, staging, params.theme);
        } catch (error) {
          // A manifest or the dependencies that can't be read are the verdict, not a failure of verify.
          if (
            error instanceof RpcError &&
            /^MOSTRA_(MANIFEST|DEP|ARTIFACT|BUILD|PLUGIN|LICENSE|KIT)_/.test(error.diagnostic.code)
          ) {
            return failedVerdict(path, error.diagnostic);
          }
          throw error;
        }
        // Verify records the working lockfile like publish (D95), so the publish that follows
        // resolves the same versions and its environment digest matches the cached verdict.
        ledger.write((db) =>
          ready.deps.save(
            db,
            lockKey(
              ready.prepared.manifest.id ?? registry.artifactAt(source.bindingPath),
              source.bindingPath,
            ),
          ),
        );
        const outcome = await verifier().run(ready.prepared, {
          build: (out) => stageBuild(ready, out),
          ...(params.screenshots ? { screenshots: params.screenshots } : {}),
          ...(progress ? { progress } : {}),
        });
        return outcome.verdict;
      },
      { stableProvisional: true },
    );

  const publishOnce = (params: ArtifactPublishParams): Promise<PublishReceipt> =>
    staged(params.source, async ({ path, source, provisional, identityKnown, staging }) => {
      // What this publish placed in the store before its commit; removed again if it fails
      // (the next start removes it too, should this process die first: FAILURE_MODEL §3).
      const undo: (() => Promise<void>)[] = [];
      let committed = false;
      try {
        const ready = await prepare(path, source, provisional, identityKnown, staging);
        const { prepared } = ready;
        const { artifactId, versionId, sourceDigest, envDigest, manifest } = prepared;

        // 4 and 5. Gate, build, archive and promote, unless this artifact already has this exact
        // version. A version whose directory is missing or no longer matches its own recorded
        // output digest is rebuilt from the same source and environment, and put back in place;
        // its ledger row stays as it was (FAILURE_MODEL §3, D80 Claude review finding 3).
        let outputDigest: string | undefined;
        let forcedCodes: string[] = [];
        let verifyRecord: { status: "pass" | "fail"; verifyRevision: string } | undefined;
        const recorded = registry.version(versionId);
        const exists = recorded !== undefined;
        // An existing version keeps what it was published with: its forced codes reach this
        // receipt and event too, and a repaired directory gets them back (D41, D138).
        if (recorded) {
          forcedCodes = [...recorded.forcedCodes];
          verifyRecord = recorded.verify;
        }
        const damage = exists
          ? await versionDamage(registry.store.versionDir(versionId))
          : undefined;
        if (damage !== undefined) log.warn("publish.version_damaged", { versionId, damage });
        if (!exists || damage !== undefined) {
          const out = join(staging, "out");
          if (exists || options.unverified === true) {
            // A repair (the version passed, or was forced, when it was published), or a test of
            // another feature that publishes without the gate.
            const built = await stageBuild(ready, out);
            if (!built.ok) throw new RpcError(firstDiagnostic(built.diagnostics));
            outputDigest = built.outputDigest;
            if (exists) {
              await writeVersionManifest(out, ready, {
                outputDigest,
                server: existsSync(join(out, "server", "entry.mjs")),
                forcedCodes,
                ...(verifyRecord ? { verify: verifyRecord } : {}),
              });
            }
          } else {
            // 4. The gate (D41, D138): the verdict cached for these digests, or a run now.
            const outcome =
              verifier().cached(prepared) ??
              (await verifier().run(prepared, { build: (dir) => stageBuild(ready, dir) }));
            const { verdict } = outcome;
            // What didn't build can't be published, whatever the flags (D138 item 7): the run
            // recorded whether compile produced a build, so no code is matched to decide it.
            if (!outcome.built) {
              throw new RpcError(
                verdict.diagnostics.find(
                  (diagnostic) => diagnostic.severity === "error" && diagnostic.phase === "compile",
                ) ??
                  verdict.diagnostics.find((diagnostic) => diagnostic.severity === "error") ??
                  createDiagnostic("MOSTRA_BUILD_FAILED", { message: "The build failed." }),
              );
            }
            const errors = errorCodes(verdict);
            // Verify couldn't run (no browser): without --force, publish fails with that
            // environment error itself, so the caller knows it isn't the artifact (D138 item 7).
            const environmental = verdict.diagnostics.find(
              (diagnostic) =>
                diagnostic.severity === "error" && diagnostic.code.startsWith("MOSTRA_ENV_"),
            );
            if (environmental && params.force !== true) throw new RpcError(environmental);
            if (errors.length > 0 && params.force !== true) {
              throw new RpcError(
                createDiagnostic("MOSTRA_PUBLISH_VERIFY_FAILED", {
                  message: `Verify found errors, so nothing was published: ${errors.join(", ")}.`,
                }),
              );
            }
            forcedCodes = params.force === true ? errors : [];
            verifyRecord = {
              status: errors.length === 0 ? "pass" : "fail",
              verifyRevision: VERIFY_REVISION,
            };
            // 5. Verify's build, promoted as it is when it was made for this version ID; built
            // again from the same snapshot otherwise (D138 item 5).
            const cachedBuild = verifier().builtVersion(versionId);
            if (cachedBuild && (await versionDamage(cachedBuild)) === undefined) {
              await renamePath(cachedBuild, out);
              outputDigest = (
                JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as {
                  outputDigest: string;
                }
              ).outputDigest;
            } else {
              log.info("publish.rebuild", {
                versionId,
                reason: cachedBuild ? "damaged" : "not cached",
              });
              const built = await stageBuild(ready, out);
              if (!built.ok) throw new RpcError(firstDiagnostic(built.diagnostics));
              outputDigest = built.outputDigest;
            }
            const server = existsSync(join(out, "server", "entry.mjs"));
            await writeVersionManifest(out, ready, {
              outputDigest,
              server,
              forcedCodes,
              verify: verifyRecord,
            });
          }
          const archive = registry.store.snapshotPath(artifactId, sourceDigest);
          if (await archiveSnapshot(join(staging, "source"), ready.listed, archive)) {
            undo.push(() => rm(archive, { force: true }));
          }
          faults.at("publish:after-archive");
          if (damage !== undefined) await removeTree(registry.store.versionDir(versionId));
          undo.push(() => removeTree(registry.store.versionDir(versionId)));
          await registry.store.promote(out, versionId);
          faults.at("publish:after-promote");
        }

        // 6. One transaction: identity, version, binding, events.
        const result = registry.commit({
          artifactId,
          bindingPath: source.bindingPath,
          manifestId: manifest.id,
          versionId,
          sourceDigest,
          envDigest,
          outputDigest,
          manifest,
          // D102: the registry resolves the policy in force from these, the earlier publishes'
          // choice and the manifest's request.
          policy: params.policy,
          homePolicy: options.homePolicy?.(),
          forcedCodes,
          ...(verifyRecord ? { verify: verifyRecord } : {}),
          stillClaims,
          faults,
          request: requestKey("artifact/publish", params),
          // The resolution becomes the artifact's working lockfile only with the version (D95):
          // a refused publish, such as a copy claiming another artifact's ID, changes nothing.
          inTransaction: (db) => ready.deps.save(db, artifactId),
        });
        committed = true;
        faults.at("publish:after-commit");
        log.info("publish.committed", {
          artifactId,
          versionId,
          version: result.version,
          reused: result.reused,
          ...(forcedCodes.length > 0 ? { forcedCodes } : {}),
        });
        return {
          artifactId,
          versionId,
          version: result.version,
          cursor: result.cursor,
          reused: result.reused,
          ...(forcedCodes.length > 0 ? { forcedDiagnostics: forcedCodes } : {}),
        };
      } catch (error) {
        if (!committed) {
          for (const step of undo.reverse()) {
            await step().catch((cleanup: unknown) =>
              log.warn("publish.undo_failed", { error: cleanup }),
            );
          }
        }
        throw error;
      }
    });

  const gated = <T>(fn: () => Promise<T>): Promise<T> =>
    options.gate ? options.gate.shared(fn) : fn();

  return {
    publish: (params) =>
      gated(() =>
        idempotent(requestKey("artifact/publish", params), async () => {
          // The receipt is recorded inside the commit's transaction (Registry.commit).
          return publishOnce(params);
        }),
      ),
    verify: (params, progress) => gated(() => verifyOnce(params, progress)),
    // Creates run one at a time: two requests for one directory, or one request sent twice, can
    // never both find it empty.
    create: (params) => queue.run("create", () => create(params)),
    // Runs in the source path's queue, like its publishes, so a publish that binds the path never
    // races an addition to the path-keyed lockfile it re-keys.
    addDependencies: (params) => gated(() => addDependencies(params)),
    // gc removes files no kept version names: an export reads a version's files, and an import
    // writes them, so both hold the gate shared like a publish (D140 item 14).
    exportBundle: (params) => gated(() => exportBundle(params)),
    buildDemos: (params, signal) => gated(() => buildDemos(params, signal)),
    importBundle: (params) =>
      gated(() => idempotent(requestKey("artifact/import", params), () => importBundle(params))),
    exportable: (params) => gated(() => exportable(params)),
    withHome: (task) => gated(task),
    withArtifact: (ref, task) =>
      gated(async () => {
        const path = pathOf(ref);
        const source = await resolveSource(path);
        return queue.run(`path:${source.bindingPath}`, async () => {
          const manifestId = extractManifest(source.entry, await readEntry(source)).manifest?.id;
          return task({
            target: {
              key: lockKey(
                manifestId ?? registry.artifactAt(source.bindingPath),
                source.bindingPath,
              ),
              artifactDir: source.root,
              artifactPath: path,
            },
            source,
          });
        });
      }),
  };

  /** A published version of an artifact, checked whole: what an export reads. */
  async function exportable(params: {
    readonly artifact: ArtifactRef;
    readonly version?: number | string;
  }): Promise<ExportableVersion> {
    // `artifact` arrives canonical: the method's handler made it so (canonicalRef).
    const detail = registry.get(params.artifact);
    const wanted = params.version;
    const summary =
      wanted === undefined
        ? detail.latestVersion
        : detail.versions.find((version) =>
            typeof wanted === "number" ? version.number === wanted : version.id === wanted,
          );
    if (!summary) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
          message: `${detail.title} has no version ${String(wanted ?? "")}.`,
        }),
      );
    }
    if (summary.collected !== undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_VERSION_COLLECTED", {
          message: `Version ${summary.number} of ${detail.title} was collected; publish its source again to export it.`,
        }),
      );
    }
    const versionDir = registry.store.versionDir(summary.id);
    const damage = await versionDamage(versionDir);
    if (damage !== undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: `Version ${summary.number} of ${detail.title} is damaged: ${damage}.`,
        }),
      );
    }
    return { detail, summary, versionDir };
  }

  /** `demo/build` (D185 item 4): the source's demos, built or found built, one by one. */
  async function buildDemos(
    params: DemoBuildParams,
    signal?: AbortSignal,
  ): Promise<DemoBuildResult> {
    const source = await resolveSource(pathOf(params.source));
    const manifest = extractManifest(source.entry, await readEntry(source)).manifest;
    const builds = demoBuilds(manifest?.demos);
    if (params.demo !== undefined && manifest?.demos?.[params.demo] === undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_DEMO_UNKNOWN", {
          message: `The artifact declares no demo "${params.demo}" to build${builds.length > 0 ? `; it declares ${builds.map(([name]) => name).join(", ")}` : ""}.`,
        }),
      );
    }
    const outcomes: DemoBuildOutcome[] = [];
    for (const [name, spec] of Object.entries(manifest?.demos ?? {})) {
      if (isDemoBuild(spec) || (params.demo !== undefined && name !== params.demo)) continue;
      outcomes.push({ name, status: "failed", diagnostics: demoProblems({ [name]: spec }) });
    }
    for (const [name, spec] of builds) {
      if (params.demo !== undefined && name !== params.demo) continue;
      if (!options.demos) {
        outcomes.push({
          name,
          status: "failed",
          diagnostics: [
            createDiagnostic("MOSTRA_DEMO_BUILD_FAILED", {
              message: `This runtime builds no demos, so the demo "${name}" can't be built here.`,
            }),
          ],
        });
        continue;
      }
      let inputs: DemoInputs;
      try {
        inputs = await options.demos.inputs(name, spec, source.root);
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        outcomes.push({ name, status: "failed", diagnostics: [error.diagnostic] });
        continue;
      }
      const built = await options.demos.build(inputs, { force: params.force === true, signal });
      outcomes.push(
        built.status === "failed"
          ? { name, status: "failed", digest: inputs.digest, diagnostics: [built.diagnostic] }
          : {
              name,
              status: built.status,
              digest: inputs.digest,
              files: built.files,
              ms: built.ms,
              diagnostics: [],
            },
      );
    }
    return { demos: outcomes };
  }

  async function exportBundle(params: ArtifactExportParams): Promise<ArtifactExportResult> {
    const { detail, summary, versionDir } = await exportable(params);
    const files = await writeBundle({
      versionDir,
      snapshot: registry.store.snapshotPath(detail.id, summary.sourceDigest),
      number: summary.number,
      title: detail.title,
      mostraVersion: options.runtimeVersion,
      out: params.out,
    });
    log.info("publish.exported", { artifactId: detail.id, versionId: summary.id });
    return { files, versionId: summary.id };
  }

  async function importBundle(params: ArtifactImportParams): Promise<PublishReceipt> {
    const read = await readBundle(params.bundle, registry.store.stagingDir);
    const { info } = read;
    return queue.run(`artifact:${info.artifactId}`, async () => {
      const undo: (() => Promise<void>)[] = [];
      let committed = false;
      try {
        if (!registry.hasVersion(info.versionId)) {
          const archive = registry.store.snapshotPath(info.artifactId, info.sourceDigest);
          if (!existsSync(archive)) {
            await mkdir(dirname(archive), { recursive: true, mode: 0o700 });
            await copyFile(read.snapshot, archive);
            fsyncPath(archive);
            fsyncPath(dirname(archive), true);
            undo.push(() => removeTree(archive));
          }
          undo.push(() => removeTree(registry.store.versionDir(info.versionId)));
          await registry.store.promote(read.versionDir, info.versionId);
        }
        const result = registry.commit({
          artifactId: info.artifactId,
          bindingPath: undefined,
          manifestId: read.manifest.id,
          versionId: info.versionId,
          sourceDigest: info.sourceDigest,
          envDigest: info.envDigest,
          outputDigest: info.outputDigest,
          manifest: read.manifest,
          number: info.number,
          policy: undefined,
          homePolicy: options.homePolicy?.(),
          forcedCodes: read.forcedCodes,
          // Another home's verdict isn't this one's: an imported version records none, so it
          // counts as passing here only once verify passes here (D138 item 4).
          stillClaims: () => false,
          faults,
          request: requestKey("artifact/import", params),
        });
        committed = true;
        log.info("publish.imported", {
          artifactId: info.artifactId,
          versionId: info.versionId,
          version: result.version,
          reused: result.reused,
        });
        return {
          artifactId: info.artifactId,
          versionId: info.versionId,
          version: result.version,
          cursor: result.cursor,
          reused: result.reused,
          ...(read.forcedCodes.length > 0 ? { forcedDiagnostics: [...read.forcedCodes] } : {}),
        };
      } catch (error) {
        if (!committed) {
          for (const step of undo.reverse()) {
            await step().catch((cleanup: unknown) =>
              log.warn("publish.undo_failed", { error: cleanup }),
            );
          }
        }
        throw error;
      } finally {
        await read.dispose().catch(() => {});
      }
    });
  }

  async function addDependencies(params: DepsAddParams): Promise<DepsAddResult> {
    {
      const path = pathOf(params.artifact);
      const source = await resolveSource(path);
      return queue.run(`path:${source.bindingPath}`, async () => {
        const manifestId = extractManifest(source.entry, await readEntry(source)).manifest?.id;
        return dependencies.add({
          key: lockKey(manifestId ?? registry.artifactAt(source.bindingPath), source.bindingPath),
          artifactDir: source.root,
          artifactPath: path,
          packages: params.packages,
          ...(params.acceptLicenses !== undefined ? { accept: params.acceptLicenses } : {}),
          request: requestKey("deps/add", params),
        });
      });
    }
  }

  async function create(params: ArtifactCreateParams): Promise<ArtifactCreateResult> {
    // A retried request completes what the first attempt recorded (H-03): the files are written
    // only after the result is durable, so a crash in between leaves something to finish. The
    // record also keeps the files' exact text, so a retry by a newer runtime completes exactly
    // what the first attempt began (WP-14's GPT and Opus reviews); the client gets the result
    // alone.
    const key = requestKey("artifact/create", params);
    if (key !== undefined) {
      const recorded = ledger.read((db) =>
        recordedResult<CreateRecord | ArtifactCreateResult>(db, key),
      );
      if (recorded !== undefined) {
        if ("result" in recorded) {
          await writeScaffold(recorded.result.dir, recorded.scaffold.files);
          return recorded.result;
        }
        // A record from before WP-14 is the result itself, whose one file, the entry, names no
        // release: it is written as this runtime writes it.
        await writeScaffold(
          recorded.dir,
          scaffoldText(recorded.files, {
            artifactId: recorded.artifactId,
            title: params.title ?? basename(recorded.dir),
            version: options.runtimeVersion,
          }),
        );
        return recorded;
      }
    }
    if (params.template !== undefined) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_TEMPLATE_UNKNOWN", {
          message: `This Mostra release provides no template "${params.template}"; create the artifact without one.`,
        }),
      );
    }
    if (existsSync(params.dir)) {
      const info = await stat(params.dir);
      if (!info.isDirectory() || (await readdir(params.dir)).length > 0) {
        throw new RpcError(
          createDiagnostic("MOSTRA_ARTIFACT_DIR_NOT_EMPTY", {
            message: `${params.dir} already exists and isn't an empty directory.`,
          }),
        );
      }
    }
    await mkdir(params.dir, { recursive: true });
    const dir = await realpath(params.dir);
    const result: ArtifactCreateResult = {
      artifactId: ArtifactId.create(),
      dir,
      files: [...SCAFFOLD_PATHS],
    };
    const files = scaffoldText(result.files, {
      artifactId: result.artifactId,
      title: params.title ?? basename(dir),
      version: options.runtimeVersion,
    });
    const recordedCreate: CreateRecord = { result, scaffold: { files } };
    record(key, recordedCreate);
    faults.at("create:after-record");
    await writeScaffold(dir, files);
    return result;
  }
}
