/**
 * Where a home and its control endpoint live (DATA_MODEL §1, D82, D84, D85). Resolving a path never
 * touches the file system; preparing a directory creates it owner-only, tightens one the user
 * owns, and refuses one owned by someone else. The per-system details are the platform layer's.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { VersionId } from "@mostra/protocol";
import type { Environment } from "../log.ts";
import {
  controlEndpoint,
  defaultHome,
  socketPathLimit as limitFor,
  OS,
  ownedDirectory,
  type PreparedDirectory,
  type RuntimeDirChoice,
  runtimeDirFor,
} from "../platform/index.ts";

export type { PreparedDirectory, RuntimeDirChoice };

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
 * (`~/.mostra` on macOS, `${XDG_DATA_HOME:-~/.local/share}/mostra` on Linux,
 * `%LOCALAPPDATA%\mostra` on Windows). An SDK passes its `home` option as `--home`.
 */
export function resolveHomePath(inputs: PathInputs): string {
  const cwd = inputs.cwd ?? process.cwd();
  const chosen = nonEmpty(inputs.home) ?? nonEmpty(inputs.env["MOSTRA_HOME"]);
  if (chosen !== undefined) return resolve(cwd, chosen);
  return defaultHome(inputs.platform ?? OS, inputs.env, inputs.userHome ?? homedir());
}

/**
 * The runtime directory for control sockets (D82): `MOSTRA_RUNTIME_DIR`; else `~/.mostra/run` on
 * macOS; on Linux `$XDG_RUNTIME_DIR/mostra` when `$XDG_RUNTIME_DIR` is a directory the user owns
 * that nobody else can read or write, else `${XDG_STATE_HOME:-~/.local/state}/mostra/run`. On
 * Windows `undefined`: the control pipe lives in the system's pipe namespace.
 */
export function resolveRuntimeDir(inputs: Omit<PathInputs, "home">): RuntimeDirChoice | undefined {
  return runtimeDirFor({
    os: inputs.platform ?? OS,
    env: inputs.env,
    userHome: inputs.userHome ?? homedir(),
    cwd: inputs.cwd ?? process.cwd(),
  });
}

/** The longest control socket path the operating system accepts, in bytes (VERIFIED_FACTS). */
export function socketPathLimit(platform: string = OS): number {
  return limitFor(platform);
}

/**
 * A home's hash (D82): 16 Crockford base32 characters of the SHA-256 of its real path, which
 * names its socket and its login service.
 */
export function homeHash(realHome: string): string {
  const digest = createHash("sha256").update(realHome, "utf8").digest();
  // VersionId.fromSha256 is the one Crockford encoder (D77); its body starts with the same 16
  // characters any encoding of this digest would.
  return VersionId.fromSha256(new Uint8Array(digest)).slice("ver_".length, "ver_".length + 16);
}

/**
 * The control endpoint for a home (D82), named by its {@link homeHash}: the socket in `runtimeDir`
 * on POSIX, throwing `MOSTRA_HOME_SOCKET_TOO_LONG` past the system's limit; on Windows the pipe
 * name that each bind completes with a random part.
 */
export function socketPathFor(
  runtimeDir: string | undefined,
  realHome: string,
  platform: string = OS,
): string {
  return controlEndpoint(runtimeDir, homeHash(realHome), platform);
}

/**
 * Makes `path` a directory only its owner can use (D85): creates it owner-only when missing,
 * tightens one the user owns (mode 0700, or an owner-only access list on Windows), and throws
 * `MOSTRA_HOME_NOT_OWNED` for one owned by another user or a path that isn't a directory.
 */
export function prepareOwnedDirectory(path: string): PreparedDirectory {
  return ownedDirectory(path);
}
