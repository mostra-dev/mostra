/**
 * Running `mostra-win`, the Windows platform helper (`crates/mostra-win`, WP-W1): finding it and
 * reading its one-line JSON answers. The runtime asks it for what Node.js can't do on Windows:
 * owner-only access control, process identity by creation time, the child gate and reaping, and
 * the owner-only control pipe. Only this module's Windows code calls it.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, RpcError } from "@mostra/protocol";

/** The name `bundle.json` gives a runtime bundle (D142). */
const BUNDLE_NAME = "mostra-runtime-bundle";

/** The directory of `@mostra/runtime`'s `package.json`, wherever the code runs from. */
export function runtimeRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (name === "@mostra/runtime") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/runtime's package.json.");
    dir = parent;
  }
}

/** The runtime bundle the runtime sits in (four levels above its package), if any. */
function enclosingBundle(root: string): string | undefined {
  const bundle = resolve(root, "..", "..", "..", "..");
  try {
    const info = JSON.parse(readFileSync(join(bundle, "bundle.json"), "utf8")) as {
      name?: unknown;
    };
    return info.name === BUNDLE_NAME ? bundle : undefined;
  } catch {
    return undefined;
  }
}

let located: string | undefined;

/**
 * The helper's path: `MOSTRA_WIN_HELPER`; else the runtime bundle's `bin/mostra-win.exe`; else,
 * in a development checkout, the one Cargo built (`target/release`, then `target/debug`). Throws
 * `MOSTRA_ENV_HELPER_MISSING` when none exists.
 */
export function helperPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["MOSTRA_WIN_HELPER"];
  if (override) {
    if (!existsSync(override))
      throw missing(`MOSTRA_WIN_HELPER names ${override}, which doesn't exist.`);
    return override;
  }
  if (located !== undefined) return located;
  const root = runtimeRoot();
  const bundle = enclosingBundle(root);
  const candidates =
    bundle !== undefined
      ? [join(bundle, "bin", "mostra-win.exe")]
      : ["release", "debug"].map((profile) =>
          resolve(root, "..", "..", "target", profile, "mostra-win.exe"),
        );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw missing(`Mostra's Windows helper isn't installed; looked for ${candidates.join(", ")}.`);
  }
  located = found;
  return found;
}

function missing(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_HELPER_MISSING", { message }));
}

/** What the helper answers. */
type Answer<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly error: { readonly message: string; readonly os?: number } };

/** A failure the helper reported, with the Windows error code when there is one. */
export class HelperError extends Error {
  readonly os: number | undefined;
  constructor(command: string, message: string, os: number | undefined) {
    super(`mostra-win ${command}: ${message}`);
    this.os = os;
  }
}

function parse<T>(command: string, stdout: string): T {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  let answer: Answer<T>;
  try {
    answer = JSON.parse(line) as Answer<T>;
  } catch {
    throw new HelperError(
      command,
      `answered something that isn't JSON: ${line.slice(0, 200)}`,
      undefined,
    );
  }
  if (!answer.ok)
    throw new HelperError(command, answer.error.message, answer.error.os ?? undefined);
  return answer.result;
}

/** Runs a helper command and returns its result; for the calls that must finish before going on. */
export function runHelper<T>(args: readonly string[]): T {
  const helper = helperPath();
  let stdout: string;
  try {
    stdout = execFileSync(helper, args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failed = error as { stdout?: string; message: string };
    if (failed.stdout) return parse<T>(args[0] ?? "", failed.stdout);
    throw new HelperError(args[0] ?? "", failed.message, undefined);
  }
  return parse<T>(args[0] ?? "", stdout);
}

/** Runs a helper command without blocking the event loop. */
export function runHelperAsync<T>(args: readonly string[]): Promise<T> {
  const helper = helperPath();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helper, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", () => {
      try {
        resolvePromise(parse<T>(args[0] ?? "", stdout || stderr));
      } catch (error) {
        reject(error);
      }
    });
  });
}
