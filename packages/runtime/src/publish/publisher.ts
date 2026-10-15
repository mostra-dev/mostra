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
  BROWSER_PROTOCOL_REVISION,
  createDiagnostic,
  type DepsAddParams,
  type DepsAddResult,
  type PublishReceipt,
  RpcError,
  type SourceRef,
  type SubmissionPolicy,
} from "@mostra/protocol";
import type { RenderMode } from "../builder/index.ts";
import { type Dependencies, lockKey } from "../deps/index.ts";
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
}

/** Publishes and creates artifacts. */
export interface Publisher {
  /** `artifact/publish`. */
  publish(params: ArtifactPublishParams): Promise<PublishReceipt>;
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

/** Creates the publisher of one instance. */
export function createPublisher(options: PublisherOptions): Publisher {
  const { registry, ledger, renderMode, dependencies, log } = options;
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

  const publishOnce = async (params: ArtifactPublishParams): Promise<PublishReceipt> => {
    const path = pathOf(params.source);
    const source = await resolveSource(path);

    // Publishes of one source path, then of one artifact, run one at a time (always in that
    // order, so they can't deadlock): a path-bound artifact's identity is decided once, and two
    // copies claiming one ID never promote the same version directory at once. The commit checks
    // the identity again inside its transaction.
    return queue.run(`path:${source.bindingPath}`, async () => {
      const peek = extractManifest(source.entry, await readEntry(source));
      const provisional = registry.identityFor(source.bindingPath, peek.manifest?.id, () =>
        ArtifactId.create(),
      );
      return queue.run(`artifact:${provisional}`, async () => {
        const staging = await mkdtemp(join(registry.store.stagingDir, "publish-"));
        // What this publish placed in the store before its commit; removed again if it fails
        // (the next start removes it too, should this process die first: FAILURE_MODEL §3).
        const undo: (() => Promise<void>)[] = [];
        let committed = false;
        try {
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
          const artifactId = registry.identityFor(
            source.bindingPath,
            manifest.id,
            () => provisional,
          );
          if (artifactId !== provisional) {
            throw new RpcError(
              createDiagnostic("MOSTRA_PUBLISH_SOURCE_CHANGED", {
                message: `The manifest of ${path} changed while it was being published.`,
              }),
            );
          }

          // 2. The dependencies, from the snapshot's imports and the artifact's working lockfile.
          const key = lockKey(
            manifest.id ?? registry.artifactAt(source.bindingPath),
            source.bindingPath,
          );
          const deps = await dependencies.resolve({
            key,
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

          // 5. Build, archive and promote, unless this artifact already has this exact version.
          let outputDigest: string | undefined;
          const forcedCodes: string[] = [];
          // A version whose directory is missing or no longer matches its own recorded output
          // digest is rebuilt from the same source and environment, and put back in place; its
          // ledger row stays as it was (FAILURE_MODEL §3, D80 Claude review finding 3).
          const exists = registry.hasVersion(versionId);
          const damage = exists
            ? await versionDamage(registry.store.versionDir(versionId))
            : undefined;
          if (damage !== undefined) {
            log.warn("publish.version_damaged", { versionId, damage });
          }
          if (!exists || damage !== undefined) {
            const out = join(staging, "out");
            const built = await renderMode.build({
              stagingDir: staging,
              entry: source.entry,
              entryHasDefault: extracted.hasDefaultExport,
              manifest,
              nodeModules: deps.nodeModules,
              outDir: out,
            });
            if (!built.ok) {
              const [first, ...rest] = built.diagnostics;
              for (const other of rest)
                log.warn("publish.build_diagnostic", { code: other.code, message: other.message });
              throw new RpcError(
                first ?? createDiagnostic("MOSTRA_BUILD_FAILED", { message: "The build failed." }),
              );
            }
            faults.at("publish:after-build");
            await writeFile(
              join(out, "registry.json"),
              `${JSON.stringify(built.registry, null, 2)}\n`,
            );
            await writeFile(join(out, "lock.yaml"), deps.lock);
            outputDigest = listingDigest(await outputListing(out));
            await writeFile(
              join(out, "manifest.json"),
              `${JSON.stringify(
                {
                  schemaVersion: 1,
                  artifactId,
                  versionId,
                  mode: environment.mode,
                  entry: source.entry,
                  server: built.server,
                  manifest,
                  sourceDigest,
                  envDigest,
                  environment,
                  outputDigest,
                  forcedCodes,
                },
                null,
                2,
              )}\n`,
            );
            const archive = registry.store.snapshotPath(artifactId, sourceDigest);
            if (await archiveSnapshot(join(staging, "source"), listed, archive)) {
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
            stillClaims,
            faults,
            request: requestKey("artifact/publish", params),
            // The resolution becomes the artifact's working lockfile only with the version (D95):
            // a refused publish, such as a copy claiming another artifact's ID, changes nothing.
            inTransaction: (db) => deps.save(db, artifactId),
          });
          committed = true;
          faults.at("publish:after-commit");
          log.info("publish.committed", {
            artifactId,
            versionId,
            version: result.version,
            reused: result.reused,
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
        } finally {
          await removeTree(staging);
        }
      });
    });
  };

  return {
    publish: (params) =>
      idempotent(requestKey("artifact/publish", params), async () => {
        // The receipt is recorded inside the commit's transaction (Registry.commit).
        return publishOnce(params);
      }),
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
