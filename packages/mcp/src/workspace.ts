/**
 * The local workspace (D164): an artifact's files on this computer's file system, as
 * `artifact_create`, `artifact_write` and `artifact_patch` change them. A tool changes only the
 * files of the artifact it names: every path is relative to the artifact's directory and stays in
 * it, links included, which is what the tool means, never a limit on what the agent may do with
 * its own file tools (D05).
 */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { McpWorkspace, WorkspaceFile } from "./ports.ts";

/** The default workspace: `~/mostra-artifacts`. */
export function defaultWorkspaceRoot(home: string = homedir()): string {
  return join(home, "mostra-artifacts");
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ARTIFACT_PATH_INVALID", { message }));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A file's path inside its artifact, checked and spelled with `/`: relative, no `.` or `..`
 * segments, no empty segment, no drive or control characters. Throws
 * `MOSTRA_ARTIFACT_PATH_INVALID` otherwise.
 */
export function artifactPath(path: string): string {
  const segments = path.split(/[\\/]/);
  if (
    path === "" ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    CONTROL.test(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw invalid(
      `"${path.slice(0, 200)}" isn't a path inside the artifact: give it relative to the artifact's directory, with no "..", such as "components/chart.tsx".`,
    );
  }
  return segments.join("/");
}

/** Whether `target` is `dir` itself or inside it (both absolute paths). */
function within(target: string, dir: string): boolean {
  const rel = relative(dir, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Whether `target` is strictly inside `dir` (both real, absolute paths). */
function inside(target: string, dir: string): boolean {
  return relative(dir, target) !== "" && within(target, dir);
}

const errno = (error: unknown): string | undefined => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
};

/** `lstat`, or `undefined` when nothing is there. */
async function lstatOrUndefined(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return undefined;
    throw error;
  }
}
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A rename that, on Windows, waits out another process's brief hold on the file (D150 item 8). */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 3000;
  for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const retry =
        process.platform === "win32" && TRANSIENT.has(errno(error) ?? "") && Date.now() < deadline;
      if (!retry) throw error;
      await sleep(wait);
    }
  }
}

/** A directory name for a title: lowercase words joined by `-`, at most 48 characters. */
export function slug(title: string | undefined): string {
  const words = (title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return words === "" ? "artifact" : words;
}

/** A scratch name beside `to` for a file being written or moved aside. */
const scratch = (to: string): string => `${to}.mostra-${randomBytes(6).toString("hex")}.tmp`;

/**
 * Applies a checked change all or nothing: every new file is written aside first, then each file
 * it replaces or deletes is moved aside and the new one moved into place. A failure on the way (a
 * full disk, a file another program holds) undoes everything done so far, in reverse, so the
 * artifact is as it was; the moved-aside files are removed only once all of it held.
 */
async function commit(
  writes: readonly { readonly file: WorkspaceFile; readonly to: string }[],
  deletes: readonly { readonly path: string; readonly to: string }[],
): Promise<{ written: string[]; deleted: string[] }> {
  const staged: { readonly to: string; readonly aside: string }[] = [];
  const undo: (() => Promise<void>)[] = [];
  const kept: string[] = [];
  try {
    for (const { file, to } of writes) {
      const aside = scratch(to);
      staged.push({ to, aside });
      await writeFile(aside, file.content, { flag: "wx" });
    }
    for (const { to, aside } of staged) {
      if ((await lstatOrUndefined(to)) !== undefined) {
        const old = scratch(to);
        await renameWithRetry(to, old);
        kept.push(old);
        undo.push(() => renameWithRetry(old, to));
      } else {
        undo.push(() => rm(to, { force: true }));
      }
      await renameWithRetry(aside, to);
    }
    const deleted: string[] = [];
    for (const { path, to } of deletes) {
      if ((await lstatOrUndefined(to)) === undefined) continue;
      const old = scratch(to);
      await renameWithRetry(to, old);
      kept.push(old);
      undo.push(() => renameWithRetry(old, to));
      deleted.push(artifactPath(path));
    }
    for (const old of kept) await rm(old, { force: true }).catch(() => {});
    return { written: writes.map(({ file }) => artifactPath(file.path)), deleted };
  } catch (error) {
    for (const step of undo.reverse()) await step().catch(() => {});
    for (const { aside } of staged) await rm(aside, { force: true }).catch(() => {});
    throw error;
  }
}

/** The workspace on this computer, rooted at `root` (absolute). */
export function localWorkspace(root: string): McpWorkspace {
  const base = resolve(root);

  /** The artifact's real directory, created when `create`; checked to be a directory. */
  async function realDir(dir: string, create: boolean): Promise<string> {
    if (create) await mkdir(dir, { recursive: true });
    let real: string;
    try {
      real = await realpath(dir);
    } catch (error) {
      if (errno(error) === "ENOENT")
        throw invalid(`The artifact's directory ${dir} doesn't exist.`);
      throw error;
    }
    if (!(await lstat(real)).isDirectory()) throw invalid(`${dir} isn't a directory.`);
    return real;
  }

  /**
   * The path a file of the artifact will have, walking its folders one at a time from the
   * artifact's real directory: a folder that is a link must lead to a folder inside the artifact,
   * a missing one is created when `create` (never through a link, since each is checked before the
   * next is made), and the file itself may not be a link or a folder.
   */
  async function target(real: string, path: string, create: boolean): Promise<string> {
    const segments = artifactPath(path).split("/");
    const name = segments.pop() as string;
    let at = real;
    for (const [index, segment] of segments.entries()) {
      const next = join(at, segment);
      const info = await lstatOrUndefined(next);
      if (info === undefined) {
        // Nothing to read there, and nothing written yet: the path as it would be.
        if (!create) return join(next, ...segments.slice(index + 1), name);
        await mkdir(next);
        at = next;
        continue;
      }
      if (info.isSymbolicLink()) {
        const resolved = await realpath(next).catch(() => undefined);
        if (resolved === undefined || !inside(resolved, real)) {
          throw invalid(`"${path}" leads out of the artifact's directory through a link.`);
        }
        at = resolved;
      } else if (info.isDirectory()) at = next;
      else throw invalid(`"${path}": ${segment} is a file, not a folder.`);
    }
    const file = join(at, name);
    const info = await lstatOrUndefined(file);
    if (info?.isSymbolicLink())
      throw invalid(`"${path}" is a link; write the file it names instead.`);
    if (info?.isDirectory()) throw invalid(`"${path}" is a folder, not a file.`);
    return file;
  }

  return {
    root: base,
    resolveDir(dir) {
      if (dir === "" || CONTROL.test(dir)) throw invalid("Give the artifact's directory.");
      if (isAbsolute(dir)) return resolve(dir);
      // A relative directory is a folder inside the workspace: one that climbs out of it, or is
      // the workspace itself, is refused; an absolute path names any other (D164).
      const resolved = resolve(base, dir);
      if (!inside(resolved, base)) {
        throw invalid(
          `"${dir.slice(0, 200)}" isn't a folder inside the workspace (${base}): give a folder name there, or an absolute path.`,
        );
      }
      return resolved;
    },
    async allocateDir(title) {
      await mkdir(base, { recursive: true });
      const name = slug(title);
      for (let attempt = 1; attempt < 1000; attempt++) {
        const candidate = join(base, attempt === 1 ? name : `${name}-${attempt}`);
        if ((await lstatOrUndefined(candidate)) === undefined) return candidate;
      }
      return join(base, `${name}-${randomBytes(4).toString("hex")}`);
    },
    async read(dir, path) {
      const real = await realDir(dir, false);
      const file = await target(real, path, false);
      try {
        return new Uint8Array(await readFile(file));
      } catch (error) {
        if (errno(error) === "ENOENT") return undefined;
        throw error;
      }
    },
    async apply(dir, changes) {
      // Every path is checked before the first byte is written.
      const paths = [...changes.write.map((file) => file.path), ...changes.delete];
      for (const path of paths) artifactPath(path);
      const seen = new Set<string>();
      for (const path of paths) {
        const key = artifactPath(path);
        if (seen.has(key)) throw invalid(`"${path}" appears twice in one change.`);
        seen.add(key);
      }
      const real = await realDir(dir, changes.write.length > 0);
      const writes: { file: WorkspaceFile; to: string }[] = [];
      for (const file of changes.write)
        writes.push({ file, to: await target(real, file.path, true) });
      const deletes: { path: string; to: string }[] = [];
      for (const path of changes.delete)
        deletes.push({ path, to: await target(real, path, false) });
      return await commit(writes, deletes);
    },
  };
}
