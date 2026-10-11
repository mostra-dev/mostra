/**
 * Artifact sources (INTERFACES §2.1, DATA_MODEL §2): finding an artifact's entry, listing its files
 * with Mostra's ignore rules, and copying them into a staging snapshot whose digest is computed from
 * the copy, so what is built and recorded is exactly what was snapshotted, whatever the author
 * edits meanwhile.
 */

import { createHash } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import ignore from "ignore";
import type { ListedFile } from "./digest.ts";

/** The entry files a directory artifact may have, in INTERFACES §2.1's order. */
const ENTRY_NAMES = ["index.tsx", "index.jsx", "index.mdx"] as const;
/** The extensions a single-file artifact may have. */
const SINGLE_FILE = new Set([".tsx", ".jsx", ".mdx"]);
/** Directories never part of a source tree (DATA_MODEL §2). */
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mostra"]);
/** Editor swap and backup files, and Finder's metadata (DATA_MODEL §2). */
const IGNORED_FILE = /^(?:\.DS_Store|\.#.*|#.*#|.*~|.*\.sw[a-px])$/;

/** An artifact's source, resolved on disk. */
export interface ResolvedSource {
  /** A single file, or a directory with an entry. */
  readonly kind: "file" | "dir";
  /** The canonical path an artifact without a manifest `id` is bound to (D51): the real path. */
  readonly bindingPath: string;
  /** The directory holding the files (the file's directory for a single file). */
  readonly root: string;
  /** The entry, relative to the snapshot root. */
  readonly entry: string;
}

/** One file of a source tree. */
export interface SourceFile {
  /** Relative, `/`-separated, NFC path inside the snapshot. */
  readonly path: string;
  /** Where it is read from. */
  readonly absolute: string;
}

function artifactError(
  code:
    | "MOSTRA_ARTIFACT_SOURCE_MISSING"
    | "MOSTRA_ARTIFACT_NO_ENTRY"
    | "MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS"
    | "MOSTRA_ARTIFACT_SOURCE_UNREADABLE",
  message: string,
): RpcError {
  return new RpcError(createDiagnostic(code, { message }));
}

const errno = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/** Finds an artifact's entry at `path` (INTERFACES §2.1). */
export async function resolveSource(path: string): Promise<ResolvedSource> {
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") {
      throw artifactError("MOSTRA_ARTIFACT_SOURCE_MISSING", `The source ${path} doesn't exist.`);
    }
    throw artifactError(
      "MOSTRA_ARTIFACT_SOURCE_UNREADABLE",
      `The source ${path} can't be read (${errno(error) ?? "error"}).`,
    );
  }
  const info = await stat(real);
  if (info.isFile()) {
    if (!SINGLE_FILE.has(extname(real))) {
      throw artifactError(
        "MOSTRA_ARTIFACT_NO_ENTRY",
        `${path} isn't an artifact: a single-file artifact is a .tsx, .jsx or .mdx file.`,
      );
    }
    return {
      kind: "file",
      bindingPath: real,
      root: dirname(real),
      entry: basename(real).normalize("NFC"),
    };
  }
  if (!info.isDirectory()) {
    throw artifactError("MOSTRA_ARTIFACT_NO_ENTRY", `${path} is neither a file nor a directory.`);
  }
  const names = new Set(await readdir(real));
  const entries = ENTRY_NAMES.filter((name) => names.has(name));
  if (entries.length === 0) {
    throw artifactError(
      "MOSTRA_ARTIFACT_NO_ENTRY",
      `The directory ${path} has no entry: add index.tsx, index.jsx or index.mdx.`,
    );
  }
  if (entries.length > 1) {
    throw artifactError(
      "MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS",
      `The directory ${path} has ${entries.join(" and ")}; an artifact has one entry.`,
    );
  }
  return { kind: "dir", bindingPath: real, root: real, entry: entries[0] as string };
}

/**
 * Lists a source's files: the single file, or every file under the directory except the ignored
 * ones (DATA_MODEL §2) and those `.mostraignore` matches. Symbolic links are followed; a link
 * that loops back into its own ancestry is skipped.
 */
export async function listSource(source: ResolvedSource): Promise<SourceFile[]> {
  if (source.kind === "file") {
    return [{ path: source.entry, absolute: source.bindingPath }];
  }
  const rules = ignore();
  try {
    rules.add(await readFile(join(source.root, ".mostraignore"), "utf8"));
  } catch (error) {
    if (errno(error) !== "ENOENT") throw unreadable(join(source.root, ".mostraignore"), error);
  }
  const files: SourceFile[] = [];
  const seen = new Map<string, string>();
  const walk = async (
    dir: string,
    relative: string,
    ancestors: ReadonlySet<string>,
  ): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw unreadable(dir, error);
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = join(dir, entry.name);
      const path = (relative ? `${relative}/${entry.name}` : entry.name).normalize("NFC");
      let kind: "file" | "dir" | "other" = entry.isFile()
        ? "file"
        : entry.isDirectory()
          ? "dir"
          : "other";
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(absolute);
          kind = target.isFile() ? "file" : target.isDirectory() ? "dir" : "other";
        } catch {
          continue; // A dangling link has no content to snapshot.
        }
      }
      if (kind === "dir") {
        if (IGNORED_DIRS.has(entry.name) || rules.ignores(`${path}/`)) continue;
        const real = await realpath(absolute);
        if (ancestors.has(real)) continue;
        await walk(absolute, path, new Set([...ancestors, real]));
      } else if (kind === "file") {
        if (IGNORED_FILE.test(entry.name) || rules.ignores(path)) continue;
        const clash = seen.get(path);
        if (clash !== undefined) {
          throw artifactError(
            "MOSTRA_ARTIFACT_SOURCE_UNREADABLE",
            `${clash} and ${absolute} have the same name after Unicode normalization (NFC).`,
          );
        }
        seen.set(path, absolute);
        files.push({ path, absolute });
      }
    }
  };
  await walk(source.root, "", new Set([source.root]));
  return files;
}

function unreadable(path: string, error: unknown): RpcError {
  return artifactError(
    "MOSTRA_ARTIFACT_SOURCE_UNREADABLE",
    `${path} can't be read (${errno(error) ?? (error as Error).message}).`,
  );
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Copies `files` into `target` (the staging snapshot) and lists the copies with their digests.
 * Hashing the copy, not the original, means the listing describes exactly the bytes that are
 * built and archived.
 */
export async function copySnapshot(
  files: readonly SourceFile[],
  target: string,
): Promise<ListedFile[]> {
  const listed: ListedFile[] = [];
  for (const file of files) {
    const destination = join(target, ...file.path.split("/"));
    try {
      const info = await stat(file.absolute);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file.absolute, destination, fsConstants.COPYFILE_FICLONE);
      const executable = (info.mode & 0o111) !== 0;
      await chmod(destination, executable ? 0o755 : 0o644);
      listed.push({ path: file.path, executable, sha256: await hashFile(destination) });
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw unreadable(file.absolute, error);
    }
  }
  return listed;
}
