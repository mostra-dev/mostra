/**
 * Where a home and its control endpoint live on each operating system, and how a directory is
 * made owner-only (DATA_MODEL §1; D82, D84, D85; RT-10). Resolving a path never touches the file
 * system; `ownedDirectory` creates or checks one.
 *
 * - macOS: the home defaults to `~/.mostra`, the runtime directory to `~/.mostra/run`.
 * - Linux: `${XDG_DATA_HOME:-~/.local/share}/mostra`; `$XDG_RUNTIME_DIR/mostra` when that
 *   directory is the user's and private, else `${XDG_STATE_HOME:-~/.local/state}/mostra/run`.
 * - Windows: `%LOCALAPPDATA%\mostra`. The control endpoint is a named pipe, which lives in no
 *   directory, so there is no runtime directory and `MOSTRA_RUNTIME_DIR` doesn't apply.
 *
 * Owner-only means mode 0700 on POSIX, and on Windows a protected access list that grants only the
 * user and `SYSTEM`, inherited by everything inside (the helper's `secure-dir`).
 */
import { chmodSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { runHelper } from "./helper.ts";

/** The operating systems the runtime knows. */
export type OperatingSystem = "darwin" | "linux" | "win32" | (string & {});

/** The operating system this process runs on. Every other module asks here. */
export const OS: OperatingSystem = process.platform;

/** Whether this process runs on Windows. */
export const WINDOWS: boolean = OS === "win32";

type Environment = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/** The home a platform uses when neither `--home` nor `MOSTRA_HOME` names one. */
export function defaultHome(os: OperatingSystem, env: Environment, userHome: string): string {
  if (os === "darwin") return join(userHome, ".mostra");
  if (os === "win32") {
    const local = nonEmpty(env["LOCALAPPDATA"]);
    return win32.join(
      local !== undefined && win32.isAbsolute(local)
        ? local
        : win32.join(userHome, "AppData", "Local"),
      "mostra",
    );
  }
  const data = nonEmpty(env["XDG_DATA_HOME"]);
  return join(
    data !== undefined && isAbsolute(data) ? data : join(userHome, ".local", "share"),
    "mostra",
  );
}

/** What the runtime directory resolution decided, and why. */
export interface RuntimeDirChoice {
  readonly dir: string;
  /** `override` (MOSTRA_RUNTIME_DIR), `xdg` (the safe XDG runtime directory) or `fallback`. */
  readonly source: "override" | "xdg" | "fallback";
  /** Why `$XDG_RUNTIME_DIR` wasn't used, when it was set. */
  readonly rejected?: string;
}

/**
 * The runtime directory for control sockets (D82), or `undefined` on Windows, whose control pipe
 * lives in the system's pipe namespace.
 */
export function runtimeDirFor(inputs: {
  readonly os: OperatingSystem;
  readonly env: Environment;
  readonly userHome: string;
  readonly cwd: string;
}): RuntimeDirChoice | undefined {
  if (inputs.os === "win32") return undefined;
  const override = nonEmpty(inputs.env["MOSTRA_RUNTIME_DIR"]);
  if (override !== undefined) return { dir: resolve(inputs.cwd, override), source: "override" };
  if (inputs.os === "darwin")
    return { dir: join(inputs.userHome, ".mostra", "run"), source: "fallback" };
  const xdg = nonEmpty(inputs.env["XDG_RUNTIME_DIR"]);
  let rejected: string | undefined;
  if (xdg !== undefined) {
    rejected = unsafeXdgRuntimeDir(xdg);
    if (rejected === undefined) return { dir: join(xdg, "mostra"), source: "xdg" };
  }
  const state = nonEmpty(inputs.env["XDG_STATE_HOME"]);
  const base =
    state !== undefined && isAbsolute(state) ? state : join(inputs.userHome, ".local", "state");
  const dir = join(base, "mostra", "run");
  return rejected === undefined
    ? { dir, source: "fallback" }
    : { dir, source: "fallback", rejected };
}

/** The current user's ID on POSIX. */
function uid(): number {
  return process.getuid?.() ?? -1;
}

/** Why `$XDG_RUNTIME_DIR` can't be used, or `undefined` when it can (XDG Base Directory spec). */
function unsafeXdgRuntimeDir(dir: string): string | undefined {
  if (!isAbsolute(dir)) return "it isn't an absolute path";
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(dir);
  } catch {
    return "it doesn't exist";
  }
  if (!stats.isDirectory()) return "it isn't a directory";
  if (stats.uid !== uid()) return "another user owns it";
  if ((stats.mode & 0o077) !== 0) return "other users can access it";
  return undefined;
}

/** The longest control socket path the operating system accepts, in bytes (VERIFIED_FACTS). */
export function socketPathLimit(os: OperatingSystem): number {
  return os === "darwin" ? 103 : 107;
}

/** The outcome of {@link ownedDirectory}. */
export interface PreparedDirectory {
  /** The directory's real path. */
  readonly realPath: string;
  /** Whether Mostra created it. */
  readonly created: boolean;
  /**
   * What it allowed before Mostra made it owner-only, when it did: the octal mode on POSIX, the
   * security descriptor (SDDL) on Windows.
   */
  readonly tightenedFrom?: string;
}

function notOwned(path: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOME_NOT_OWNED", { message: `Mostra can't use ${path}: ${why}.` }),
  );
}

/**
 * Makes `path` a directory only its owner can use (D85): creates it owner-only when missing,
 * tightens one the user owns, and throws `MOSTRA_HOME_NOT_OWNED` for one owned by another user or
 * a path that isn't a directory. Symlinks are followed.
 */
export function ownedDirectory(path: string): PreparedDirectory {
  if (WINDOWS) return ownedDirectoryWindows(path);
  try {
    return preparePosix(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "EEXIST")
      throw notOwned(path, "a part of the path isn't a directory");
    if (code === "EACCES" || code === "EPERM")
      throw notOwned(path, "you have no permission to use it");
    throw error;
  }
}

function preparePosix(path: string): PreparedDirectory {
  let created = false;
  try {
    statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(path, { recursive: true, mode: 0o700 });
    created = true;
  }
  const realPath = realpathSync(path);
  const stats = statSync(realPath);
  if (!stats.isDirectory()) throw notOwned(path, "it isn't a directory");
  if (stats.uid !== uid()) throw notOwned(path, `it belongs to user ${stats.uid}, not to you`);
  const mode = stats.mode & 0o777;
  if (mode !== 0o700) {
    chmodSync(realPath, 0o700);
    return created ? { realPath, created } : { realPath, created, tightenedFrom: mode.toString(8) };
  }
  return { realPath, created };
}

type Secured =
  | { readonly secured: "created" | "kept" }
  | { readonly secured: "tightened"; readonly from: string }
  | { readonly refused: "not-owned"; readonly owner: string }
  | { readonly refused: "not-directory" };

function ownedDirectoryWindows(path: string): PreparedDirectory {
  let answer: Secured;
  try {
    answer = runHelper<Secured>(["secure-dir", path]);
  } catch (error) {
    // Access denied while creating or reading it: someone else's directory, or one above it.
    if ((error as { os?: number }).os === 5)
      throw notOwned(path, "you have no permission to use it");
    throw error;
  }
  if ("refused" in answer) {
    throw notOwned(
      path,
      answer.refused === "not-owned"
        ? `it belongs to ${answer.owner}, not to you`
        : "it isn't a directory",
    );
  }
  const realPath = realpathSync.native(path);
  if (answer.secured === "tightened")
    return { realPath, created: false, tightenedFrom: answer.from };
  return { realPath, created: answer.secured === "created" };
}
