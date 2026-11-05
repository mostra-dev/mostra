/**
 * The `bundle` export class (ARCHITECTURE §3, INTERFACES §15, RM-01): the portable artifact package.
 * A bundle is one published version, whole: its version directory (`manifest.json`, the client and
 * server builds, `registry.json`, `lock.yaml`), its source snapshot, and `mostra-bundle.json`,
 * which names them. Importing it into another home (`artifact/import`, `mostra run <bundle>`)
 * makes the same version there: the same artifact ID, version ID, digests and, when free, number,
 * because a version's identity is its artifact ID and digests (D89), and each is checked against
 * the bundle's own bytes before anything is kept. Its server code runs in the importing home's
 * workers, against the bundle's lockfile, which that home's launcher installs into its own layout
 * before a worker starts (D135).
 *
 * ```text
 * <bundle>/                    or <bundle>.tar.zst, the same tree in one archive
 *   mostra-bundle.json         { schemaVersion, kind, artifactId, versionId, number, title, digests… }
 *   version/                   the version directory, as the home stores it
 *   source.tar.zst             the source snapshot (DATA_MODEL §1)
 * ```
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { ArtifactManifest, createDiagnostic, RpcError } from "@mostra/protocol";
import { renamePath } from "../platform/index.ts";
import { fsyncPath, removeTree } from "../registry/index.ts";
import {
  type BuildEnvironment,
  environmentDigest,
  listingDigest,
  sha256Hex,
  versionIdFor,
} from "./digest.ts";
import { extractManifest } from "./manifest.ts";
import { readTar, TAR_END, tarFile } from "./tar.ts";

/** What `mostra-bundle.json` holds. */
export interface BundleInfo {
  readonly schemaVersion: 1;
  readonly kind: "mostra-bundle";
  readonly artifactId: string;
  readonly versionId: string;
  /** The version's number in the home that exported it; kept on import when free there. */
  readonly number: number;
  readonly title: string;
  readonly sourceDigest: string;
  readonly envDigest: string;
  readonly outputDigest: string;
  readonly lockDigest: string;
  /** Whether the version has server code. */
  readonly server: boolean;
  /** The runtime that exported it. */
  readonly mostraVersion: string;
  readonly exportedAt: string;
}

/** The version directory's `manifest.json`, as publish writes it. */
interface VersionManifest {
  readonly schemaVersion: number;
  readonly artifactId: string;
  readonly versionId: string;
  readonly entry: string;
  readonly server: boolean;
  readonly manifest: unknown;
  readonly sourceDigest: string;
  readonly envDigest: string;
  readonly environment: BuildEnvironment;
  readonly outputDigest: string;
  readonly forcedCodes?: readonly string[];
  readonly verify?: { readonly status: "pass" | "fail"; readonly verifyRevision: string };
}

const INFO = "mostra-bundle.json";
const VERSION = "version";
const SOURCE = "source.tar.zst";

/** The largest bundle archive read whole into memory: a version's builds and source. */
const ARCHIVE_MAX = 2 * 1024 * 1024 * 1024;

/** JSON with sorted keys, to compare two manifests. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ARTIFACT_BUNDLE_INVALID", { message }));
}

/** Every file under `dir`, as `/`-separated paths relative to it, sorted. */
async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(relative(dir, path).split(/[\\/]/).join("/"));
      else throw invalid(`${relative(dir, path)} isn't a file or a directory.`);
    }
  };
  await walk(dir);
  return out.sort();
}

/** The canonical listing of a version directory's output, as `outputDigest` hashes it. */
async function outputDigestOf(versionDir: string): Promise<string> {
  const files = await filesUnder(versionDir);
  const listed = [];
  for (const path of files) {
    if (path === "registry.json" || path.startsWith("client/") || path.startsWith("server/")) {
      listed.push({
        path,
        executable: false,
        sha256: sha256Hex(await readFile(join(versionDir, ...path.split("/")))),
      });
    }
  }
  return listingDigest(listed);
}

/**
 * Writes the bundle of the version stored in `versionDir`, with its source snapshot `snapshot`,
 * to `out`: a directory, or one archive when `out` ends in `.tar.zst`. `out` must not exist, or be
 * an empty directory (`MOSTRA_ARTIFACT_DIR_NOT_EMPTY`).
 */
export async function writeBundle(input: {
  readonly versionDir: string;
  readonly snapshot: string;
  readonly number: number;
  readonly title: string;
  readonly mostraVersion: string;
  readonly out: string;
}): Promise<string[]> {
  const archive = input.out.endsWith(".tar.zst");
  if (existsSync(input.out)) {
    const empty =
      !archive && (await stat(input.out)).isDirectory() && (await readdir(input.out)).length === 0;
    if (!empty) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_DIR_NOT_EMPTY", {
          message: `${input.out} already exists; a bundle is written only to a new path or an empty directory.`,
        }),
      );
    }
  }
  const manifest = JSON.parse(
    await readFile(join(input.versionDir, "manifest.json"), "utf8"),
  ) as VersionManifest;
  const info: BundleInfo = {
    schemaVersion: 1,
    kind: "mostra-bundle",
    artifactId: manifest.artifactId,
    versionId: manifest.versionId,
    number: input.number,
    title: input.title,
    sourceDigest: manifest.sourceDigest,
    envDigest: manifest.envDigest,
    outputDigest: manifest.outputDigest,
    lockDigest: manifest.environment.lockDigest,
    server: manifest.server,
    mostraVersion: input.mostraVersion,
    exportedAt: new Date().toISOString(),
  };
  const entries: { path: string; data: Uint8Array }[] = [
    { path: INFO, data: Buffer.from(`${JSON.stringify(info, null, 2)}\n`) },
  ];
  for (const path of await filesUnder(input.versionDir)) {
    entries.push({
      path: `${VERSION}/${path}`,
      data: await readFile(join(input.versionDir, ...path.split("/"))),
    });
  }
  entries.push({ path: SOURCE, data: await readFile(input.snapshot) });
  if (archive) {
    await mkdir(dirname(input.out), { recursive: true });
    const blocks: Buffer[] = [];
    for (const entry of entries) blocks.push(...tarFile({ ...entry, executable: false }));
    blocks.push(TAR_END);
    const temporary = `${input.out}.${process.pid}.tmp`;
    await writeFile(temporary, zstdCompressSync(Buffer.concat(blocks)));
    fsyncPath(temporary);
    await renamePath(temporary, input.out);
    fsyncPath(dirname(input.out), true);
    return [input.out];
  }
  for (const entry of entries) {
    const path = join(input.out, ...entry.path.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.data);
  }
  return [input.out];
}

/** A bundle read and checked, laid out in a scratch directory ready to be promoted. */
export interface ReadBundle {
  readonly info: BundleInfo;
  /** The artifact's manifest, as the version records it. */
  readonly manifest: ArtifactManifest;
  /** The checked version directory, inside `scratch`. */
  readonly versionDir: string;
  /** The checked source snapshot, inside `scratch`. */
  readonly snapshot: string;
  readonly forcedCodes: readonly string[];
  /** Removes the scratch directory. */
  dispose(): Promise<void>;
}

/** A bundle path inside the tree: relative, `/`-separated, with no empty, `.` or `..` part. */
function safeEntry(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0"))
    return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * Reads the bundle at `path` (a directory or a `.tar.zst` archive) into a scratch directory under
 * `scratchRoot` and checks every link of its identity, refusing it with
 * `MOSTRA_ARTIFACT_BUNDLE_INVALID` before anything is kept: `mostra-bundle.json` and the version's
 * own `manifest.json` agree; the lockfile has the environment's `lockDigest`; the environment has
 * `envDigest`; the source snapshot's listing has `sourceDigest`; the builds have `outputDigest`; and
 * the version ID is the one the artifact ID and those digests give (D89).
 */
export async function readBundle(path: string, scratchRoot: string): Promise<ReadBundle> {
  if (!existsSync(path)) throw invalid(`${path} doesn't exist.`);
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(scratchRoot, "import-"));
  const dispose = (): Promise<void> => removeTree(scratch);
  try {
    if ((await stat(path)).isDirectory()) {
      for (const file of await filesUnder(path)) {
        const target = join(scratch, ...file.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await readFile(join(path, ...file.split("/"))));
      }
    } else {
      const size = (await stat(path)).size;
      if (size > ARCHIVE_MAX) throw invalid(`${path} is larger than a bundle can be.`);
      let files: ReturnType<typeof readTar>;
      try {
        files = readTar(zstdDecompressSync(await readFile(path)));
      } catch (error) {
        throw invalid(`${path} isn't a bundle archive: ${(error as Error).message}`);
      }
      const seen = new Set<string>();
      for (const file of files) {
        if (!safeEntry(file.path) || seen.has(file.path.toLowerCase())) {
          throw invalid(`The archive holds an entry it can't: ${JSON.stringify(file.path)}.`);
        }
        seen.add(file.path.toLowerCase());
        const target = join(scratch, ...file.path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.data);
      }
    }
    const read = async (file: string): Promise<Buffer> => {
      try {
        return await readFile(join(scratch, ...file.split("/")));
      } catch {
        throw invalid(`The bundle has no ${file}.`);
      }
    };
    let info: BundleInfo;
    let version: VersionManifest;
    try {
      info = JSON.parse((await read(INFO)).toString("utf8")) as BundleInfo;
      version = JSON.parse(
        (await read(`${VERSION}/manifest.json`)).toString("utf8"),
      ) as VersionManifest;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw invalid("Its mostra-bundle.json or its version's manifest.json isn't JSON.");
    }
    if (info.schemaVersion !== 1 || info.kind !== "mostra-bundle") {
      throw invalid("Its mostra-bundle.json isn't one this release reads (schemaVersion 1).");
    }
    if (!Number.isSafeInteger(info.number) || info.number < 1) {
      throw invalid("Its mostra-bundle.json names no version number.");
    }
    for (const key of [
      "artifactId",
      "versionId",
      "sourceDigest",
      "envDigest",
      "outputDigest",
    ] as const) {
      if (typeof info[key] !== "string" || info[key] !== version[key]) {
        throw invalid(
          `Its mostra-bundle.json and its version's manifest.json differ in \`${key}\`.`,
        );
      }
    }
    const manifest = ArtifactManifest.safeParse(version.manifest);
    if (!manifest.success) throw invalid("Its version's artifact manifest isn't valid.");
    // Only a version directory's own files: anything else would be promoted with it unchecked.
    for (const file of await filesUnder(join(scratch, VERSION))) {
      const allowed =
        ["manifest.json", "lock.yaml", "registry.json"].includes(file) ||
        file.startsWith("client/") ||
        file.startsWith("server/");
      if (!allowed) throw invalid(`Its version holds a file no version has: ${file}.`);
    }
    if (version.server !== existsSync(join(scratch, VERSION, "server", "entry.mjs"))) {
      throw invalid(
        "Its manifest.json and its server build disagree on whether it has server code.",
      );
    }
    const lock = await read(`${VERSION}/lock.yaml`);
    if (
      sha256Hex(lock) !== version.environment?.lockDigest ||
      info.lockDigest !== version.environment.lockDigest
    ) {
      throw invalid("Its lock.yaml doesn't have the lockDigest its environment records.");
    }
    if (environmentDigest(version.environment) !== version.envDigest) {
      throw invalid("Its environment doesn't have the envDigest it records.");
    }
    let sourceFiles: ReturnType<typeof readTar>;
    try {
      sourceFiles = readTar(zstdDecompressSync(await read(SOURCE)));
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw invalid("Its source.tar.zst isn't a source snapshot.");
    }
    const sourceDigest = listingDigest(
      sourceFiles.map((file) => ({
        path: file.path,
        executable: file.executable,
        sha256: sha256Hex(file.data),
      })),
    );
    if (sourceDigest !== version.sourceDigest) {
      throw invalid("Its source snapshot doesn't have the sourceDigest it records.");
    }
    // The artifact's manifest is read again from the source, which the digest covers: the copy in
    // manifest.json isn't, and it decides a hosted artifact's settings and its tallies.
    const entry = sourceFiles.find((file) => file.path === version.entry);
    if (!entry) throw invalid(`Its source snapshot has no entry ${String(version.entry)}.`);
    let extracted: ArtifactManifest | undefined;
    try {
      extracted = extractManifest(entry.path, Buffer.from(entry.data).toString("utf8")).manifest;
    } catch {
      throw invalid("Its entry's manifest can't be read.");
    }
    if (extracted?.id !== undefined && extracted.id !== version.artifactId) {
      throw invalid(
        `Its source names the artifact ${extracted.id}, and its version ${version.artifactId}.`,
      );
    }
    // An entry without a manifest publishes with only a title, its directory's name (D51).
    const matches =
      extracted === undefined
        ? Object.keys(manifest.data).join() === "title"
        : canonical(extracted) === canonical(manifest.data);
    if (!matches) {
      throw invalid("Its manifest.json records another artifact manifest than its source has.");
    }
    const versionDir = join(scratch, VERSION);
    if ((await outputDigestOf(versionDir)) !== version.outputDigest) {
      throw invalid("Its builds don't have the outputDigest they record.");
    }
    if (
      versionIdFor(version.artifactId, version.sourceDigest, version.envDigest) !==
      version.versionId
    ) {
      throw invalid("Its version ID isn't the one its artifact ID and digests give.");
    }
    return {
      info,
      manifest: manifest.data,
      versionDir,
      snapshot: join(scratch, SOURCE),
      forcedCodes: version.forcedCodes ?? [],
      dispose,
    };
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}
