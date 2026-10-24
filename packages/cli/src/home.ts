/**
 * Where the CLI's things are: the home (D84's order), the runtime it starts, the home's settings
 * it reads, and the CLI's own config directory (D140 item 5). Resolving a path never touches the
 * file system; the runtime owns everything inside the home.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { type Runtime, resolveRuntime } from "@mostra/sdk";

/** The environment the CLI reads. */
export type Environment = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/**
 * The home, in D84's order: `--home`, then `MOSTRA_HOME`, then the platform default (`~/.mostra`
 * on macOS, `${XDG_DATA_HOME:-~/.local/share}/mostra` on Linux, `%LOCALAPPDATA%\mostra` on
 * Windows), the same order and defaults the runtime uses (its `platform` module).
 */
export function resolveHome(options: {
  readonly home?: string | undefined;
  readonly env: Environment;
  readonly cwd: string;
  readonly platform?: string;
}): string {
  const chosen = nonEmpty(options.home) ?? nonEmpty(options.env["MOSTRA_HOME"]);
  if (chosen !== undefined) return resolve(options.cwd, chosen);
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    // As the runtime: the user's profile from the system, never a `HOME` a POSIX shell set.
    const local = nonEmpty(options.env["LOCALAPPDATA"]);
    return win32.join(
      local !== undefined && win32.isAbsolute(local)
        ? local
        : win32.join(homedir(), "AppData", "Local"),
      "mostra",
    );
  }
  const user = nonEmpty(options.env["HOME"]) ?? homedir();
  if (platform === "darwin") return join(user, ".mostra");
  const data = nonEmpty(options.env["XDG_DATA_HOME"]);
  return join(
    data !== undefined && isAbsolute(data) ? data : join(user, ".local", "share"),
    "mostra",
  );
}

/**
 * The CLI's config directory (D140 item 5): `MOSTRA_CONFIG_DIR`, else
 * `${XDG_CONFIG_HOME:-~/.config}/mostra` on macOS and Linux, and `%APPDATA%\mostra` on Windows,
 * where per-user settings live (D151). It holds telemetry's choice and queue, per
 * operating-system user, never per home.
 */
export function configDir(
  env: Environment,
  cwd: string,
  platform: string = process.platform,
): string {
  const override = nonEmpty(env["MOSTRA_CONFIG_DIR"]);
  if (override !== undefined) return resolve(cwd, override);
  if (platform === "win32") {
    const roaming = nonEmpty(env["APPDATA"]);
    return win32.join(
      roaming !== undefined && win32.isAbsolute(roaming)
        ? roaming
        : win32.join(homedir(), "AppData", "Roaming"),
      "mostra",
    );
  }
  const xdg = nonEmpty(env["XDG_CONFIG_HOME"]);
  const base =
    xdg !== undefined && isAbsolute(xdg)
      ? xdg
      : join(nonEmpty(env["HOME"]) ?? homedir(), ".config");
  return join(base, "mostra");
}

/** The runtime the CLI starts: its Node.js and its `mostra-runtime` entry. */
export interface RuntimeLocation {
  /** The Node.js to run it with: the runtime bundle's own, or this process's for a checkout. */
  readonly node: string;
  /** `mostra-runtime`'s entry. */
  readonly entry: string;
  /** The runtime as the SDK resolved it (its bundle, for the Windows helper beside it). */
  readonly runtime: Runtime;
}

/**
 * The runtime the CLI starts (D85, RT-01), found as the SDK finds it: `MOSTRA_BUNDLE`,
 * `MOSTRA_RUNTIME_BIN`, the runtime bundle this CLI sits in, or a development checkout's built
 * runtime beside it. The bootstrap (`bootstrap.ts`) has already moved a CLI installed from npm
 * into its pinned bundle, so this never downloads. Throws the SDK's diagnostic when there is none.
 */
export async function locateRuntime(env: Environment): Promise<RuntimeLocation> {
  const runtime = await resolveRuntime({ env });
  return { node: runtime.node, entry: runtime.runtimeEntry, runtime };
}

/** What the CLI reads of a home's `config.json` (DATA_MODEL §1). */
export interface HomeMarks {
  /** The first host that configured the home (D140 item 4), if any. */
  readonly hostConfigured?: { readonly client: string; readonly at: string };
  /** Whether the file couldn't be read as settings: the CLI then treats the home as a host's. */
  readonly unreadable?: true;
}

/**
 * Whether the CLI treats the home as a host's, which sends no telemetry (D140 item 4): a host
 * marked it, or its `config.json` can't be read as settings (fail closed). One rule for the
 * runner and for `mostra telemetry` (Opus review finding 6).
 */
export function embeddedHome(marks: HomeMarks): boolean {
  return marks.hostConfigured !== undefined || marks.unreadable === true;
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
