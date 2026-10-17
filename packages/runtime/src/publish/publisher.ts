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
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import {
  type ArtifactCreateParams,
  type ArtifactCreateResult,
  ArtifactId,
  type ArtifactManifest,
  type ArtifactPublishParams,
  type ArtifactVerifyParams,
  BROWSER_PROTOCOL_REVISION,
  createDiagnostic,
  type DepsAddParams,
  type DepsAddResult,
  type Diagnostic,
  type PublishReceipt,
  RpcError,
  type SourceRef,
  type SubmissionPolicy,
  type VerifyVerdict,
} from "@mostra/protocol";
import type { RenderMode } from "../builder/index.ts";
import { type Dependencies, lockKey, type Resolution } from "../deps/index.ts";
import { type Faults, noFaults } from "../faults.ts";
import {
  InflightRequests,
  type Ledger,
  type RequestKey,
  recordedResult,
  recordResult,
  requestKey,
} from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { fsyncPath, type Registry, removeTree } from "../registry/index.ts";
import {
  type BuildOutcome,
  didNotBuild,
  errorCodes,
  type PreparedSource,
  VERIFY_REVISION,
  type Verifier,
} from "../verify/index.ts";
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
  /** The verifier, made on first use: publish's gate and `artifact/verify` (D41, D137). */
  readonly verifier: () => Verifier;
  /**
   * Tests of other features only (`MOSTRA_TEST_UNVERIFIED_PUBLISH`): publish without the gate.
   * Such a version records no verdict, so it never counts as passing (D137 item 4).
   */
  readonly unverified?: boolean;
}

/** Publishes and creates artifacts. */
export interface Publisher {
  /** `artifact/publish`: gated by verify (D41). */
  publish(params: ArtifactPublishParams): Promise<PublishReceipt>;
  /** `artifact/verify`: one run, its verdict cached for the publish that follows (D137). */
  verify(params: ArtifactVerifyParams, progress?: (stage: string) => void): Promise<VerifyVerdict>;
  /** `artifact/create`. */
  create(params: ArtifactCreateParams): Promise<ArtifactCreateResult>;
  /** `deps/add`: adds packages to an artifact's working lockfile (D95). */
  addDependencies(params: DepsAddParams): Promise<DepsAddResult>;
}

const ENTRY_NAMES = ["index.tsx", "index.jsx", "index.mdx"];

/** The title of an artifact without a manifest: its directory's name, or a single file's own name. */
function defaultTitle(source: ResolvedSource): string {
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
  const output = createWriteStream(temporary, { mode: 0o400 });
  await pipeline(Readable.from(blocks()), createZstdCompress(), output);
  const handle = await import("node:fs/promises").then((fs) => fs.open(temporary, "r"));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  fsyncPath(dirname(target), true);
  return true;
}

/** The entry `artifact/create` writes: a manifest with the generated `id` and a minimal page. */
function scaffold(artifactId: string, title: string): string {
  return [
    'import { defineArtifact } from "@mostra/react";',
    "",
    "export const artifact = defineArtifact({",
    `  id: ${JSON.stringify(artifactId)},`,
    `  title: ${JSON.stringify(title)},`,
    "});",
    "",
    "export default function Page() {",
    "  return (",
    '    <main className="mx-auto max-w-2xl p-8">',
    '      <h1 className="text-2xl font-semibold">{artifact.title}</h1>',
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n");
}

/**
 * Writes `artifact/create`'s entry into `dir`, completing an interrupted write: an existing file
 * that is the expected text or a prefix of it (a write cut short) ends as the expected text, and
 * anything else the author has written since is left alone.
 */
async function writeScaffold(dir: string, artifactId: string, title: string): Promise<void> {
  const expected = scaffold(artifactId, title);
  const file = join(dir, "index.tsx");
  await mkdir(dir, { recursive: true });
  let current: string | undefined;
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = undefined;
  }
  if (current !== undefined && !expected.startsWith(current)) return;
  if (current === expected) return;
  await writeFile(file, expected);
  fsyncPath(file);
  fsyncPath(dir, true);
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
 * resolved): that diagnostic alone, never cached (D137 item 3).
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

  /** What {@link prepare} read of a snapshot, besides the {@link PreparedSource}. */
  interface Staged {
    readonly prepared: PreparedSource;
    readonly source: ResolvedSource;
    readonly listed: readonly ListedFile[];
    readonly entryHasDefault: boolean;
    readonly environment: BuildEnvironment;
    readonly deps: Resolution;
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
  ): Promise<Staged> => {
    // 1. Snapshot, then read the manifest from the snapshot: what is built is what was read.
    const files = await listSource(source);
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
    });
    faults.at("publish:after-dependencies");

    // 3. Digests (DATA_MODEL §2).
    const sourceDigest = listingDigest(listed);
    const environment: BuildEnvironment = {
      mostraVersion: options.runtimeVersion,
      kitVersion: null,
      kitBase: manifest.kit?.base ?? "base",
      mode: manifest.mode ?? "spa",
      lockDigest: deps.lockDigest,
      buildConfigDigest,
      // The browser protocol the version's client runtime speaks (VR-10, D106).
      browserProtocolRevision: BROWSER_PROTOCOL_REVISION,
    };
    const envDigest = environmentDigest(environment);
    const versionId = versionIdFor(artifactId, sourceDigest, envDigest);
    faults.at("publish:after-digests");
    return {
      prepared: {
        path,
        stagingDir: staging,
        sourceDir: source.root,
        manifest,
        warnings: extracted.warnings,
        artifactId,
        identityKnown,
        sourceDigest,
        envDigest,
        versionId,
        nodeModules: deps.nodeModules,
      },
      source,
      listed,
      entryHasDefault: extracted.hasDefaultExport,
      environment,
      deps,
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
    });
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
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
      const provisional = known ?? ArtifactId.create();
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
    staged(params.source, async ({ path, source, provisional, identityKnown, staging }) => {
      progress?.("prepare");
      let ready: Staged;
      try {
        ready = await prepare(path, source, provisional, identityKnown, staging);
      } catch (error) {
        // A manifest or the dependencies that can't be read are the verdict, not a failure of verify.
        if (
          error instanceof RpcError &&
          /^MOSTRA_(MANIFEST|DEP|ARTIFACT|BUILD)_/.test(error.diagnostic.code)
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
      return verifier().run(ready.prepared, {
        build: (out) => stageBuild(ready, out),
        ...(params.screenshots ? { screenshots: params.screenshots } : {}),
        ...(progress ? { progress } : {}),
      });
    });

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
        // receipt and event too, and a repaired directory gets them back (D41, D137).
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
            // 4. The gate (D41, D137): the verdict cached for these digests, or a run now.
            const verdict =
              verifier().cached(prepared) ??
              (await verifier().run(prepared, { build: (dir) => stageBuild(ready, dir) }));
            const unbuilt = didNotBuild(verdict);
            if (unbuilt) throw new RpcError(unbuilt);
            const errors = errorCodes(verdict);
            // Verify couldn't run (no browser): without --force, publish fails with that
            // environment error itself, so the caller knows it isn't the artifact (D137 item 7).
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
            // again from the same snapshot otherwise (D137 item 5).
            const cachedBuild = verifier().builtVersion(versionId);
            if (cachedBuild && (await versionDamage(cachedBuild)) === undefined) {
              await rename(cachedBuild, out);
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

  return {
    publish: (params) =>
      idempotent(requestKey("artifact/publish", params), async () => {
        // The receipt is recorded inside the commit's transaction (Registry.commit).
        return publishOnce(params);
      }),
    verify: (params, progress) => verifyOnce(params, progress),
    // Creates run one at a time: two requests for one directory, or one request sent twice, can
    // never both find it empty.
    create: (params) => queue.run("create", () => create(params)),
    // Runs in the source path's queue, like its publishes, so a publish that binds the path never
    // races an addition to the path-keyed lockfile it re-keys.
    addDependencies: async (params) => {
      const path = pathOf(params.artifact);
      const source = await resolveSource(path);
      return queue.run(`path:${source.bindingPath}`, async () => {
        const manifestId = extractManifest(source.entry, await readEntry(source)).manifest?.id;
        return dependencies.add({
          key: lockKey(manifestId ?? registry.artifactAt(source.bindingPath), source.bindingPath),
          artifactDir: source.root,
          artifactPath: path,
          packages: params.packages,
          request: requestKey("deps/add", params),
        });
      });
    },
  };

  async function create(params: ArtifactCreateParams): Promise<ArtifactCreateResult> {
    // A retried request completes what the first attempt recorded (H-03): the entry is written
    // only after the result is durable, so a crash in between leaves something to finish.
    const key = requestKey("artifact/create", params);
    if (key !== undefined) {
      const result = ledger.read((db) => recordedResult<ArtifactCreateResult>(db, key));
      if (result !== undefined) {
        await writeScaffold(result.dir, result.artifactId, params.title ?? basename(result.dir));
        return result;
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
      files: ["index.tsx"],
    };
    record(key, result);
    faults.at("create:after-record");
    await writeScaffold(dir, result.artifactId, params.title ?? basename(dir));
    return result;
  }
}
