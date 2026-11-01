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
import { isAbsolute, join, relative, resolve } from "node:path";
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

/** Whether `target` is strictly inside `dir` (both real, absolute paths). */
function inside(target: string, dir: string): boolean {
  const rel = relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
      return isAbsolute(dir) ? resolve(dir) : resolve(base, dir);
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
      const written: string[] = [];
      for (const { file, to } of writes) {
        const aside = `${to}.mostra-${randomBytes(6).toString("hex")}.tmp`;
        try {
          await writeFile(aside, file.content, { flag: "wx" });
          await renameWithRetry(aside, to);
        } catch (error) {
          await rm(aside, { force: true });
          throw error;
        }
        written.push(artifactPath(file.path));
      }
      const deleted: string[] = [];
      for (const { path, to } of deletes) {
        try {
          await rm(to);
          deleted.push(artifactPath(path));
        } catch (error) {
          if (errno(error) !== "ENOENT") throw error;
        }
      }
      return { written, deleted };
    },
  };
}
