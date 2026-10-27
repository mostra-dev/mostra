/**
 * Unpacking a downloaded archive (RT-01) into a new, empty directory. Only regular files,
 * directories and symbolic links are accepted, all under the archive's one top directory, which is
 * stripped; an entry's path must be relative, with no `..`, `.` or empty part and no backslash
 * (nor, on Windows, a colon; node-tar reads a backslash there as a separator, so its parts are
 * judged as separate ones), and no path may appear twice. Links are made only after every file
 * and directory is written, and after every link's own directory, so no write and no link ever
 * goes through one. Setup then checks the whole tree
 * against the bundle's file list (`checkTree`), which refuses any file or link it doesn't list and
 * any link that leaves the bundle. A pinned archive's SHA-256 is checked before any of this. A
 * Windows archive holds no links at all (D153): one that does is refused, since its junctions are
 * made by setup, from `files.json`.
 *
 * The files are written synchronously as node-tar's parser reads them. node-tar's own `x` checks
 * and clobbers what each path already holds, and on Windows writes one entry at a time; into an
 * empty directory none of that is needed, and a first install wrote its ~50,000 files 4 to 10
 * times slower for it: 6 minutes on Windows arm64 (#88, VERIFIED_FACTS, MT-02).
 */
import { closeSync, createReadStream, mkdirSync, openSync, symlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { Parser, type ReadEntry } from "tar";

const FILES = new Set(["File", "OldFile", "ContiguousFile"]);

/** Options of {@link extractBundle}. */
export interface ExtractOptions {
  /** `keep` extracts symbolic links; `refuse` refuses an archive that has any (Windows'). */
  readonly links?: "keep" | "refuse";
}

/** An entry a bundle's archive never has, or an archive that doesn't read as a tar at all. */
class ArchiveRefused extends Error {}

/** Extracts `archive` (a `.tar.gz` with one top directory `top`) into the empty directory `into`. */
export async function extractBundle(
  archive: string,
  into: string,
  top: string,
  options: ExtractOptions = {},
): Promise<void> {
  try {
    await unpack(archive, resolve(into), top, options.links === "refuse");
  } catch (error) {
    if (error instanceof ArchiveRefused) {
      throw new RpcError(createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", { message: error.message }));
    }
    const code = (error as NodeJS.ErrnoException).code;
    // The file system failing (a full disk, a permission) isn't the archive's fault.
    if (typeof code === "string" && /^E[A-Z]+$/.test(code) && code !== "EOF") {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED", {
          message: `The runtime bundle couldn't be written to ${into}: ${(error as Error).message}${code === "ENOSPC" ? " (the disk is full)" : ""}`,
        }),
      );
    }
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
        message: `The runtime bundle's archive couldn't be read: ${(error as Error).message}`,
      }),
    );
  }
}

/** The path below `top` an entry names, as parts, or why it is refused. */
export function entryParts(path: string, top: string, windows: boolean): string[] | string {
  const parts = path.split("/");
  if (parts[0] !== top) return "it is outside the bundle's directory";
  // A directory's name ends with a slash.
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  const below = parts.slice(1);
  for (const part of below) {
    if (part === "" || part === "." || part === "..") return "its path isn't a plain relative one";
    if (part.includes("\\") || (windows && part.includes(":"))) {
      return "its path holds a character a bundle's paths never have";
    }
  }
  return below;
}

async function unpack(archive: string, root: string, top: string, refuseLinks: boolean) {
  const windows = process.platform === "win32";
  const seen = new Set<string>();
  const made = new Set<string>([root]);
  const links: { path: string; target: string }[] = [];
  const ensureDir = (dir: string): void => {
    if (made.has(dir)) return;
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    for (let at = dir; !made.has(at); at = dirname(at)) made.add(at);
  };
  let failure: unknown;
  let open: number | undefined;
  const fail = (error: unknown): void => {
    failure ??= error;
  };
  const refuse = (path: string, type: string, why: string): void =>
    fail(
      new ArchiveRefused(
        `The runtime bundle's archive holds an entry a bundle never has: ${path} (${type}): ${why}.`,
      ),
    );

  const parser = new Parser({ strict: true });
  parser.on("entry", (entry: ReadEntry) => {
    const type = String(entry.type);
    if (failure !== undefined) return entry.resume();
    const parts = entryParts(entry.path, top, windows);
    if (typeof parts === "string") {
      refuse(entry.path, type, parts);
      return entry.resume();
    }
    const path = parts.length === 0 ? root : join(root, ...parts);
    // Windows and macOS keep one file for names that differ only in case or (macOS) in Unicode
    // normalization, so those are the same path there.
    const key =
      windows || process.platform === "darwin" ? path.normalize("NFC").toLowerCase() : path;
    if (parts.length > 0 && seen.has(key)) {
      refuse(entry.path, type, "its path appears twice");
      return entry.resume();
    }
    seen.add(key);
    try {
      if (type === "Directory") {
        entry.resume();
        ensureDir(path);
      } else if (type === "SymbolicLink" && parts.length > 0) {
        entry.resume();
        if (refuseLinks) refuse(entry.path, type, "a Windows bundle's links are made by setup");
        else if (!entry.linkpath) refuse(entry.path, type, "it links to nothing");
        else links.push({ path, target: entry.linkpath });
      } else if (FILES.has(type) && parts.length > 0) {
        ensureDir(dirname(path));
        // A new file only (`wx`): nothing that was there before, a link least of all, is written to.
        const fd = openSync(path, "wx", (entry.mode ?? 0) & 0o111 ? 0o755 : 0o644);
        open = fd;
        entry.on("data", (chunk: Buffer) => {
          if (failure !== undefined) return;
          try {
            let at = 0;
            while (at < chunk.length) at += writeSync(fd, chunk, at);
          } catch (error) {
            fail(error);
          }
        });
        entry.on("end", () => {
          open = undefined;
          try {
            closeSync(fd);
          } catch (error) {
            fail(error);
          }
        });
      } else {
        refuse(entry.path, type, "a bundle holds only files, directories and links");
        entry.resume();
      }
    } catch (error) {
      fail(error);
      entry.resume();
    }
  });
  // A parser error (a damaged header, a bad gzip stream) is the archive's: it settles the wait
  // rather than rejecting a promise nobody awaits yet.
  const ended = new Promise<void>((done) => {
    parser.on("end", done);
    parser.on("error", (error: Error) => {
      fail(new ArchiveRefused(`The runtime bundle's archive couldn't be read: ${error.message}`));
      done();
    });
  });
  try {
    for await (const chunk of createReadStream(archive, { highWaterMark: 1024 * 1024 })) {
      parser.write(chunk as Buffer);
      if (failure !== undefined) break;
    }
    if (failure === undefined) {
      parser.end();
      await ended;
    }
  } finally {
    if (open !== undefined) closeSync(open);
  }
  if (failure !== undefined) throw failure;
  // Every link's directory first, while no link exists: a link whose path another entry lies
  // beneath (another link included) then meets a real directory and is refused, and no directory is
  // ever made or reached through a link (the GPT review of MT-02).
  for (const link of links) ensureDir(dirname(link.path));
  for (const link of links) {
    try {
      symlinkSync(link.target, link.path);
    } catch (error) {
      // Its path is a directory other entries filled: the link would have been written through.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new ArchiveRefused(
        `The runtime bundle's archive holds an entry a bundle never has: ${link.path} (SymbolicLink): other entries are inside it.`,
      );
    }
  }
}
