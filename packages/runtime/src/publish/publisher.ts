/**
 * Publish (ARCHITECTURE §3, VR-01, VR-02, VR-11): freezes an artifact's source into an immutable,
 * content-addressed version. Steps, any of which can fail and leave no visible version:
 *
 * 1. snapshot the source into staging and read its manifest from the snapshot (never running it);
 * 2. freeze the dependencies into `lock.yaml` (the warm set until WP-04);
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
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
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
  createDiagnostic,
  type PublishReceipt,
  RpcError,
} from "@mostra/protocol";
import type { RenderMode, WarmSet } from "../builder/index.ts";
import { type Faults, noFaults } from "../faults.ts";
import type { Ledger } from "../ledger/index.ts";
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
import { copySnapshot, listSource, type ResolvedSource, resolveSource } from "./source.ts";
import { TAR_END, tarFile } from "./tar.ts";

/** Options for {@link createPublisher}. */
export interface PublisherOptions {
  readonly registry: Registry;
  readonly ledger: Ledger;
  readonly renderMode: RenderMode;
  readonly warm: WarmSet;
  /** This runtime's release (`mostraVersion` in `envDigest`). */
  readonly runtimeVersion: string;
  readonly log: Log;
  /** Test fault points `publish:*` (VR-02). */
  readonly faults?: Faults;
}

/** Publishes and creates artifacts. */
export interface Publisher {
  /** `artifact/publish`. */
  publish(params: ArtifactPublishParams): Promise<PublishReceipt>;
  /** `artifact/create`. */
  create(params: ArtifactCreateParams): Promise<ArtifactCreateResult>;
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
  try {
    const info = statSync(path);
    const entry = info.isDirectory()
      ? ENTRY_NAMES.map((name) => join(path, name)).find((file) => existsSync(file))
      : path;
    if (entry === undefined) return false;
    const { manifest } = extractManifest(basename(entry), readFileSync(entry, "utf8"));
    return manifest?.id === artifactId;
  } catch {
    return false;
  }
}

/** The frozen lockfile of a version (D20): today the warm set; WP-04 adds on-demand packages. */
function lockfile(warm: WarmSet): string {
  const lines = [
    "# Mostra lockfile: the packages this version was built with. Frozen at publish.",
    "lockfileVersion: 1",
    "warm:",
  ];
  for (const [name, version] of Object.entries(warm.packages).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(version)}`);
  }
  return `${lines.join("\n")}\n`;
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
  const { registry, ledger, renderMode, warm, log } = options;
  const faults = options.faults ?? noFaults;
  const queue = new KeyedQueue();
  const lock = lockfile(warm);
  const lockDigest = sha256Hex(lock);
  const buildConfigDigest = sha256Hex(canonicalJson(renderMode.buildConfig));
  const inflight = new Map<string, Promise<unknown>>();

  /** Replays a recorded result for a repeated `requestId` (H-03), or runs `task` once. */
  const idempotent = async <T>(
    method: string,
    requestId: string | undefined,
    task: () => Promise<T>,
  ): Promise<T> => {
    if (requestId === undefined) return task();
    const recorded = ledger.read((db) =>
      db.get<{ result_json: string }>(
        "SELECT result_json FROM request WHERE method = ? AND request_id = ?",
        method,
        requestId,
      ),
    );
    if (recorded) return JSON.parse(recorded.result_json) as T;
    const key = `${method} ${requestId}`;
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const started = task().finally(() => inflight.delete(key));
    inflight.set(key, started);
    return started;
  };

  const record = (method: string, requestId: string | undefined, result: unknown): void => {
    if (requestId === undefined) return;
    ledger.write((db) =>
      db.run(
        "INSERT OR IGNORE INTO request (method, request_id, result_json, created_at) VALUES (?, ?, ?, ?)",
        method,
        requestId,
        JSON.stringify(result),
        new Date().toISOString(),
      ),
    );
  };

  const publishOnce = async (params: ArtifactPublishParams): Promise<PublishReceipt> => {
    let path: string;
    if ("path" in params.source) path = params.source.path;
    else {
      const bound = registry.sourceOf(params.source.artifactId);
      if (bound === undefined) {
        throw new RpcError(
          createDiagnostic("MOSTRA_ARTIFACT_NOT_FOUND", {
            message: `No artifact ${params.source.artifactId} was published in this home; publish it from its source path.`,
          }),
        );
      }
      path = bound;
    }
    const source = await resolveSource(path);

    // Publishes of one source path, then of one artifact, run one at a time (always in that
    // order, so they can't deadlock): a path-bound artifact's identity is decided once, and two
    // copies claiming one ID never promote the same version directory at once. The commit checks
    // the identity again inside its transaction.
    return queue.run(`path:${source.bindingPath}`, async () => {
      const peek = extractManifest(
        source.entry,
        await readFile(
          source.kind === "file" ? source.bindingPath : join(source.root, source.entry),
          "utf8",
        ),
      );
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
            throw new Error(`The manifest of ${path} changed during the publish; publish again.`);
          }

          // 2, 3. Lockfile and digests (DATA_MODEL §2).
          const sourceDigest = listingDigest(listed);
          const environment: BuildEnvironment = {
            mostraVersion: options.runtimeVersion,
            kitVersion: null,
            kitBase: manifest.kit?.base ?? "base",
            mode: manifest.mode ?? "spa",
            lockDigest,
            buildConfigDigest,
            browserProtocolRevision: null,
          };
          const envDigest = environmentDigest(environment);
          const versionId = versionIdFor(artifactId, sourceDigest, envDigest);
          faults.at("publish:after-digests");

          // 5. Build, archive and promote, unless this artifact already has this exact version.
          let outputDigest: string | undefined;
          const forcedCodes: string[] = [];
          if (registry.hasVersion(versionId)) {
            if (!existsSync(registry.store.versionDir(versionId))) {
              throw new RpcError(
                createDiagnostic("MOSTRA_HOME_INTEGRITY", {
                  message: `The stored version ${versionId} is missing from ${registry.store.versionsDir}.`,
                }),
              );
            }
          } else {
            const out = join(staging, "out");
            const built = await renderMode.build({
              stagingDir: staging,
              entry: source.entry,
              entryHasDefault: extracted.hasDefaultExport,
              manifest,
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
            await writeFile(join(out, "lock.yaml"), lock);
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
            policy: params.policy,
            forcedCodes,
            stillClaims,
            faults,
            requestId: params.requestId,
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
      idempotent("artifact/publish", params.requestId, async () => {
        // The receipt is recorded inside the commit's transaction (Registry.commit).
        return publishOnce(params);
      }),
    // Creates run one at a time: two requests for one directory, or one request sent twice, can
    // never both find it empty.
    create: (params) => queue.run("create", () => create(params)),
  };

  async function create(params: ArtifactCreateParams): Promise<ArtifactCreateResult> {
    // A retried request completes what the first attempt recorded (H-03): the entry is written
    // only after the result is durable, so a crash in between leaves something to finish.
    const requestId = params.requestId;
    if (requestId !== undefined) {
      const recorded = ledger.read((db) =>
        db.get<{ result_json: string }>(
          "SELECT result_json FROM request WHERE method = 'artifact/create' AND request_id = ?",
          requestId,
        ),
      );
      if (recorded) {
        const result = JSON.parse(recorded.result_json) as ArtifactCreateResult;
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
    record("artifact/create", params.requestId, result);
    faults.at("create:after-record");
    await writeScaffold(dir, result.artifactId, params.title ?? basename(dir));
    return result;
  }
}
