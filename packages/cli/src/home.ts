/**
 * Where the CLI's things are: the home (D84's order), the runtime it starts, the home's settings
 * it reads, and the CLI's own config directory (D140 item 5). Resolving a path never touches the
 * file system; the runtime owns everything inside the home.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";

/** The environment the CLI reads. */
export type Environment = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/**
 * The home, in D84's order: `--home`, then `MOSTRA_HOME`, then the platform default (`~/.mostra`
 * on macOS, `${XDG_DATA_HOME:-~/.local/share}/mostra` on Linux), the same order the runtime uses.
 */
export function resolveHome(options: {
  readonly home?: string | undefined;
  readonly env: Environment;
  readonly cwd: string;
  readonly platform?: string;
}): string {
  const chosen = nonEmpty(options.home) ?? nonEmpty(options.env["MOSTRA_HOME"]);
  if (chosen !== undefined) return resolve(options.cwd, chosen);
  const user = nonEmpty(options.env["HOME"]) ?? homedir();
  if ((options.platform ?? process.platform) === "darwin") return join(user, ".mostra");
  const data = nonEmpty(options.env["XDG_DATA_HOME"]);
  return join(
    data !== undefined && isAbsolute(data) ? data : join(user, ".local", "share"),
    "mostra",
  );
}

/**
 * The CLI's config directory (D140 item 5): `MOSTRA_CONFIG_DIR`, else
 * `${XDG_CONFIG_HOME:-~/.config}/mostra`, on both platforms. It holds telemetry's choice and
 * queue, per operating-system user, never per home.
 */
export function configDir(env: Environment, cwd: string): string {
  const override = nonEmpty(env["MOSTRA_CONFIG_DIR"]);
  if (override !== undefined) return resolve(cwd, override);
  const xdg = nonEmpty(env["XDG_CONFIG_HOME"]);
  const base =
    xdg !== undefined && isAbsolute(xdg)
      ? xdg
      : join(nonEmpty(env["HOME"]) ?? homedir(), ".config");
  return join(base, "mostra");
}

/**
 * The runtime the CLI starts (D85): `MOSTRA_RUNTIME_BIN` when set, else the `mostra-runtime`
 * beside this package, as the repository and the runtime bundle (WP-11) lay them out. Throws
 * `MOSTRA_ENV_RUNTIME_MISSING` when there is none.
 */
export function locateRuntime(env: Environment): {
  readonly entry: string;
  readonly nodeArgs: readonly string[];
} {
  const override = nonEmpty(env["MOSTRA_RUNTIME_BIN"]);
  if (override !== undefined) {
    if (!existsSync(override))
      throw runtimeMissing(`MOSTRA_RUNTIME_BIN names ${override}, which doesn't exist.`);
    return { entry: override, nodeArgs: [] };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ of packages/cli; the runtime package sits beside it.
  const built = resolve(here, "..", "..", "runtime", "dist", "bin.js");
  if (existsSync(built)) return { entry: built, nodeArgs: [] };
  throw runtimeMissing(`No Mostra runtime beside the CLI (looked for ${built}).`);
}

function runtimeMissing(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", { message }));
}

/** What the CLI reads of a home's `config.json` (DATA_MODEL §1). */
export interface HomeMarks {
  /** The first host that configured the home (D140 item 4), if any. */
  readonly hostConfigured?: { readonly client: string; readonly at: string };
  /** Whether the file couldn't be read as settings: the CLI then treats the home as a host's. */
  readonly unreadable?: true;
}

/**
 * The home's host mark, read from `config.json` without the instance, for commands that never
 * reach one. A file that can't be read as JSON counts as a host's home, so telemetry fails closed.
 */
export function readHomeMarks(home: string): HomeMarks {
  let text: string;
  try {
    text = readFileSync(join(home, "config.json"), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : { unreadable: true };
  }
  try {
    const data = JSON.parse(text) as { hostConfigured?: { client?: unknown; at?: unknown } };
    const mark = data.hostConfigured;
    if (mark === undefined) return {};
    return typeof mark.client === "string" && typeof mark.at === "string"
      ? { hostConfigured: { client: mark.client, at: mark.at } }
      : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}
