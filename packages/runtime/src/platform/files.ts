/**
 * File operations whose semantics differ between POSIX and Windows (FAILURE_MODEL §3, RT-10):
 *
 * - **Renames.** Windows refuses to replace or move a file another process has open without
 *   sharing deletion, and antivirus scanners and the search indexer open new files for a moment
 *   after they are written. A rename that meets a sharing violation is tried again for a short
 *   while (`EPERM`, `EACCES`, `EBUSY`), never weakened into a copy: the step stays atomic or fails.
 * - **Syncing.** Windows syncs a file only through a handle open for writing.
 * - **Directory links.** A directory symlink needs a privilege most Windows users don't hold;
 *   junctions need none, and Node.js and pnpm resolve through them like symlinks.
 * - **Sealing.** A sealed version is read-only for everyone (0444 files and 0555 directories on
 *   POSIX; on Windows an access list granting only reading, applied by the helper). Its owner can
 *   always unseal it, as on POSIX.
 * - **Names.** Windows file names are case-insensitive: two names that differ only in case are
 *   one file.
 */
import { closeSync, type Dirent, fsyncSync, openSync, renameSync, statSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { WINDOWS } from "./directories.ts";
import { runHelperAsync } from "./helper.ts";

/** Errors a Windows rename or removal meets while another process briefly holds the file. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
/** How long a rename keeps trying through sharing violations. */
const RETRY_MS = 3000;

const errno = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames `from` to `to`, replacing a file at `to` (POSIX `rename`). On Windows a sharing
 * violation is retried with backoff for up to 3 s before it is thrown.
 */
export async function renamePath(from: string, to: string): Promise<void> {
  const deadline = Date.now() + RETRY_MS;
  for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!WINDOWS || !TRANSIENT.has(errno(error) ?? "") || Date.now() >= deadline) throw error;
      await sleep(wait);
    }
  }
}

/** {@link renamePath}, blocking. */
export function renamePathSync(from: string, to: string): void {
  const deadline = Date.now() + RETRY_MS;
  for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!WINDOWS || !TRANSIENT.has(errno(error) ?? "") || Date.now() >= deadline) throw error;
      sleepSync(wait);
    }
  }
}

/**
 * Syncs a file or a directory to disk. A file that can't be synced fails the caller (its bytes
 * would not be durable); a directory may not support it on some file systems (Windows can't open
 * one this way at all), and only that case is tolerated.
 */
export function fsyncPath(path: string, directory = false): void {
  if (directory && WINDOWS) {
    // NTFS journals directory changes, and Windows can't sync a directory; it must exist, though.
    statSync(path);
    return;
  }
  let fd: number | undefined;
  try {
    // Windows flushes a file only through a handle that may write (VERIFIED_FACTS, WP-W1).
    fd = openSync(path, WINDOWS ? "r+" : "r");
    fsyncSync(fd);
  } catch (error) {
    const code = errno(error);
    const unsupported = ["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"];
    if (!directory || !unsupported.includes(code ?? "")) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Makes `path` a link to the `node_modules`-like directory `target`: a symlink on POSIX; on
 * Windows a {@link linkFarm}, since a junction to the directory would break the relative links
 * inside it (pnpm's), which Windows resolves against the path they were reached by (VERIFIED_FACTS,
 * WP-W1).
 */
export async function linkDirectory(target: string, path: string): Promise<void> {
  if (WINDOWS) await linkFarm(target, path);
  else await symlink(target, path, "dir");
}

/** The marker a link farm keeps: what it mirrors, and the entries it mirrored. */
const FARM_MARKER = ".mostra-link";

/** Every entry of a `node_modules`-like directory, scoped ones as `@scope/name`, dot entries left out. */
async function farmEntries(target: string): Promise<{ name: string; real: string }[]> {
  const names: string[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scoped of await readdir(join(target, entry.name)))
        names.push(`${entry.name}/${scoped}`);
    } else names.push(entry.name);
  }
  const entries: { name: string; real: string }[] = [];
  for (const name of names.sort()) {
    try {
      entries.push({ name, real: await realpath(join(target, ...name.split("/"))) });
    } catch {
      // A dangling link brings nothing in, as through a directory link.
    }
  }
  return entries;
}

/**
 * A directory that stands for `target`: one junction per entry, to the entry's real path, so every
 * link inside resolves from where it really is, and a marker naming what it mirrors. Built aside
 * and renamed into place, so `path` is either missing or complete. Used on Windows; it works on
 * POSIX too, where the tests exercise it.
 */
export async function linkFarm(target: string, path: string): Promise<void> {
  const source = resolve(target);
  const entries = await farmEntries(source);
  const building = `${path}.${process.pid}.${Date.now()}.farm`;
  await mkdir(building, { recursive: true });
  try {
    for (const entry of entries) {
      const at = join(building, ...entry.name.split("/"));
      if (entry.name.includes("/")) await mkdir(join(at, ".."), { recursive: true });
      await symlink(entry.real, at, "junction");
    }
    await writeFile(
      join(building, FARM_MARKER),
      `${JSON.stringify({ target: source, entries })}\n`,
    );
    await renamePath(building, path);
  } catch (error) {
    await removeFarm(building).catch(() => {});
    throw error;
  }
}

/** Removes a link farm's junctions, never what they point to, then its directories. */
async function removeFarm(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const at = join(path, entry.name);
    if (entry.isSymbolicLink()) await unlinkEntry(at);
    else if (entry.isDirectory()) await removeFarm(at);
    else await rm(at, { force: true });
  }
  await rmdir(path);
}

/** Removes one link: on Windows a junction is removed as the directory entry it is. */
async function unlinkEntry(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!WINDOWS || errno(error) !== "EPERM") throw error;
    await rmdir(path);
  }
}

/**
 * What the directory link `path` stands for, or `undefined` when it is missing, isn't a link, or
 * (a link farm) no longer mirrors its target's current entries.
 */
export async function linkTarget(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return resolve(join(path, ".."), await readlink(path));
    if (!info.isDirectory()) return undefined;
    const marker = JSON.parse(await readFile(join(path, FARM_MARKER), "utf8")) as {
      target: string;
      entries: { name: string; real: string }[];
    };
    const now = await farmEntries(marker.target);
    return JSON.stringify(now) === JSON.stringify(marker.entries) ? marker.target : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Points the directory link `path` at `target`, replacing what it pointed at with no moment
 * where `path` is missing on POSIX (a new link renamed over it). Windows can't rename a link over
 * an existing directory entry, so the old link is renamed aside first and removed after.
 */
export async function replaceDirectoryLink(target: string, path: string): Promise<void> {
  const fresh = `${path}.${process.pid}.${Date.now()}.new`;
  await linkDirectory(target, fresh);
  if (!WINDOWS) {
    await rename(fresh, path);
    return;
  }
  const aside = `${path}.${process.pid}.${Date.now()}.old`;
  let moved = false;
  try {
    await renamePath(path, aside);
    moved = true;
  } catch (error) {
    if (errno(error) !== "ENOENT") {
      await unlinkDirectory(fresh);
      throw error;
    }
  }
  await renamePath(fresh, path);
  if (moved) await unlinkDirectory(aside);
}

/**
 * `path` without the separators it ends in (a loop: a regular expression here is quadratic). On
 * POSIX a backslash is an ordinary character of a name, never a separator.
 */
function trimSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || (WINDOWS && path[end - 1] === "\\"))) end--;
  return path.slice(0, end);
}

/** Whether a link points at `target` (paths compared as this file system compares them). */
export function samePath(a: string, b: string): boolean {
  const normal = (path: string): string =>
    nameKey(trimSeparators(resolve(path.startsWith("\\\\?\\") ? path.slice(4) : path)));
  return normal(a) === normal(b);
}

/**
 * A path as a key for comparison: `/`-separated, without a trailing `/`, and on Windows in lower
 * case, since Windows names compare without case and bundlers spell `C:\x` as `C:/x`. The key has
 * the path's length, so an index found in it holds in the path too.
 */
export function pathKey(path: string): string {
  // Only Windows spells a separator `\\`; on POSIX it is part of a name (Opus review of WP-W1).
  return nameKey(WINDOWS ? path.replaceAll("\\", "/") : path);
}

/** Whether `file` is `dir` itself or lies under it, however either spells its separators. */
export function isUnder(file: string, dir: string): boolean {
  const key = pathKey(file);
  const root = trimSeparators(pathKey(dir));
  return key === root || key.startsWith(`${root}/`);
}

/** Removes a link made by {@link linkDirectory}, never what it points to. */
export async function unlinkDirectory(path: string): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
  if (info.isDirectory() && !info.isSymbolicLink()) await removeFarm(path);
  else await unlinkEntry(path);
}

/** Calls `visit` for every entry under `dir`, children before their directory. */
async function walk(
  dir: string,
  visit: (path: string, isDirectory: boolean) => Promise<void>,
): Promise<void> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, visit);
    await visit(path, entry.isDirectory());
  }
}

/**
 * Makes a tree read-only and syncs it to disk. On POSIX the top directory is left writable when
 * `keepTop` is set, since renaming a directory needs write access to it; on Windows the whole tree
 * is synced first and sealed in one step after it is in place ({@link sealPlaced}).
 */
export async function sealTree(dir: string, keepTop = false): Promise<void> {
  if (WINDOWS) {
    await walk(dir, async (path, isDirectory) => {
      if (!isDirectory) fsyncPath(path);
    });
    return;
  }
  await walk(dir, async (path, isDirectory) => {
    await chmod(path, isDirectory ? 0o555 : 0o444);
    fsyncPath(path, isDirectory);
  });
  if (!keepTop) await chmod(dir, 0o555);
  fsyncPath(dir, true);
}

/**
 * Finishes sealing a tree that is in its final place: on POSIX its top directory becomes 0555; on
 * Windows the whole tree gets the read-only access list (moving a sealed directory would need the
 * delete right the seal withholds).
 */
export async function sealPlaced(dir: string): Promise<void> {
  if (WINDOWS) {
    await runHelperAsync(["seal", dir]);
    return;
  }
  await chmod(dir, 0o555);
  fsyncPath(dir, true);
}

/** Removes a tree, sealed or not. Missing trees are fine. Links inside are removed, never followed. */
export async function removeTree(dir: string): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(dir);
  } catch {
    return;
  }
  if (info.isDirectory() && !WINDOWS) {
    await chmod(dir, 0o755);
    await walk(dir, async (path, isDirectory) => {
      if (isDirectory) await chmod(path, 0o755);
    }).catch(() => {});
  }
  const deadline = Date.now() + RETRY_MS;
  let unsealed = false;
  for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!WINDOWS || !TRANSIENT.has(errno(error) ?? "") || Date.now() >= deadline) throw error;
      // A sealed version refuses deletion until its access list is the owner's again; only
      // sealed trees need it, and they hold no links the reset could follow.
      if (!unsealed && info.isDirectory()) {
        unsealed = true;
        await runHelperAsync(["unseal", dir]).catch(() => {});
        continue;
      }
      await sleep(wait);
    }
  }
}

/** The form under which two file names are the same name on this file system. */
export function nameKey(name: string): string {
  return WINDOWS ? name.toLowerCase() : name;
}
