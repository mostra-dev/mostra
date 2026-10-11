/**
 * Where a home and its control socket live (DATA_MODEL §1, D82, D84, D85). Resolving a path never
 * touches the file system; preparing a directory creates it with mode 0700, tightens one the user
 * owns, and refuses one owned by someone else.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createDiagnostic, RpcError, VersionId } from "@mostra/protocol";
import type { Environment } from "../log.ts";

/** What path resolution reads: the flag, the environment and the platform. */
export interface PathInputs {
  /** `--home`, when given. */
  readonly home?: string | undefined;
  readonly env: Environment;
  readonly platform?: string;
  /** The user's home directory. Default `os.homedir()`. */
  readonly userHome?: string;
  /** Resolves a relative `--home` or `MOSTRA_HOME`. Default `process.cwd()`. */
  readonly cwd?: string;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/**
 * The home path, resolved in D84's order: `--home`, then `MOSTRA_HOME`, then the platform default
 * (`~/.mostra` on macOS, `${XDG_DATA_HOME:-~/.local/share}/mostra` on Linux). An SDK passes its
 * `home` option as `--home`.
 */
export function resolveHomePath(inputs: PathInputs): string {
  const cwd = inputs.cwd ?? process.cwd();
  const chosen = nonEmpty(inputs.home) ?? nonEmpty(inputs.env["MOSTRA_HOME"]);
  if (chosen !== undefined) return resolve(cwd, chosen);
  const user = inputs.userHome ?? homedir();
  if ((inputs.platform ?? process.platform) === "darwin") return join(user, ".mostra");
  const data = nonEmpty(inputs.env["XDG_DATA_HOME"]);
  return join(
    data !== undefined && isAbsolute(data) ? data : join(user, ".local", "share"),
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

/** The current user's ID. */
function uid(): number {
  return process.getuid?.() ?? -1;
}

/**
 * The runtime directory for control sockets (D82): `MOSTRA_RUNTIME_DIR`; else `~/.mostra/run` on
 * macOS; on Linux `$XDG_RUNTIME_DIR/mostra` when `$XDG_RUNTIME_DIR` is a directory the user owns
 * that nobody else can read or write, else `${XDG_STATE_HOME:-~/.local/state}/mostra/run`.
 */
export function resolveRuntimeDir(inputs: Omit<PathInputs, "home">): RuntimeDirChoice {
  const override = nonEmpty(inputs.env["MOSTRA_RUNTIME_DIR"]);
  if (override !== undefined) {
    return { dir: resolve(inputs.cwd ?? process.cwd(), override), source: "override" };
  }
  const user = inputs.userHome ?? homedir();
  if ((inputs.platform ?? process.platform) === "darwin") {
    return { dir: join(user, ".mostra", "run"), source: "fallback" };
  }
  const xdg = nonEmpty(inputs.env["XDG_RUNTIME_DIR"]);
  let rejected: string | undefined;
  if (xdg !== undefined) {
    rejected = unsafeXdgRuntimeDir(xdg);
    if (rejected === undefined) return { dir: join(xdg, "mostra"), source: "xdg" };
  }
  const state = nonEmpty(inputs.env["XDG_STATE_HOME"]);
  const base = state !== undefined && isAbsolute(state) ? state : join(user, ".local", "state");
  const dir = join(base, "mostra", "run");
  return rejected === undefined
    ? { dir, source: "fallback" }
    : { dir, source: "fallback", rejected };
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
export function socketPathLimit(platform: string = process.platform): number {
  return platform === "darwin" ? 103 : 107;
}

/**
 * The control socket for a home (D82): 16 Crockford base32 characters of the SHA-256 of the
 * home's real path. Throws `MOSTRA_HOME_SOCKET_TOO_LONG` when the path exceeds the limit.
 */
export function socketPathFor(runtimeDir: string, realHome: string, platform?: string): string {
  const digest = createHash("sha256").update(realHome, "utf8").digest();
  // VersionId.fromSha256 is the one Crockford encoder (D77); its body starts with the same 16
  // characters any encoding of this digest would.
  const hash = VersionId.fromSha256(new Uint8Array(digest)).slice(
    "ver_".length,
    "ver_".length + 16,
  );
  const path = join(runtimeDir, `${hash}.sock`);
  const limit = socketPathLimit(platform);
  const length = Buffer.byteLength(path);
  if (length > limit) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_SOCKET_TOO_LONG", {
        message: `The control socket path ${path} is ${length} bytes; this system allows ${limit}.`,
        fix: { kind: "command", command: "export MOSTRA_RUNTIME_DIR=/tmp/mostra-$USER" },
      }),
    );
  }
  return path;
}

/** The outcome of {@link prepareOwnedDirectory}. */
export interface PreparedDirectory {
  /** The directory's real path. */
  readonly realPath: string;
  /** Whether Mostra created it. */
  readonly created: boolean;
  /** The mode it had when Mostra tightened it to 0700, when it did. */
  readonly tightenedFrom?: number;
}

function notOwned(path: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOME_NOT_OWNED", { message: `Mostra can't use ${path}: ${why}.` }),
  );
}

/**
 * Makes `path` a directory only its owner can use (D85): creates it with mode 0700 when missing,
 * tightens one the user owns to 0700, and throws `MOSTRA_HOME_NOT_OWNED` for one owned by
 * another user or a path that isn't a directory. Symlinks are followed.
 */
export function prepareOwnedDirectory(path: string): PreparedDirectory {
  try {
    return prepare(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "EEXIST")
      throw notOwned(path, "a part of the path isn't a directory");
    if (code === "EACCES" || code === "EPERM")
      throw notOwned(path, "you have no permission to use it");
    throw error;
  }
}

function prepare(path: string): PreparedDirectory {
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
    return created ? { realPath, created } : { realPath, created, tightenedFrom: mode };
  }
  return { realPath, created };
}
