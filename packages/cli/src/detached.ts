/**
 * The directory and environment of the processes the CLI leaves running: its home's daemon and
 * the telemetry flusher. They run in their file system's root, because on Windows nobody can
 * rename or remove a running process's working directory, and they outlive the command (WP-W2,
 * D151 item 3). Every path the environment names relative to the command's directory is made
 * absolute first, so it still names what it named for the command (Opus review of WP-W2,
 * finding 3).
 */
import { isAbsolute, parse, resolve } from "node:path";

/**
 * The variables whose values are paths: Mostra's own, as the runtime, the SDK and the CLI read
 * them. A test keeps the list complete.
 */
export const PATH_VARIABLES: readonly string[] = [
  "MOSTRA_HOME",
  "MOSTRA_RUNTIME_DIR",
  "MOSTRA_CONFIG_DIR",
  "MOSTRA_CACHE_DIR",
  "MOSTRA_BUNDLE",
  "MOSTRA_RUNTIME_BIN",
  "MOSTRA_SHELL_DIR",
  "MOSTRA_WARM_DIR",
  "MOSTRA_WORKER_ENTRY",
  "MOSTRA_VERIFY_ENTRY",
  "MOSTRA_WIN_HELPER",
  "MOSTRA_TEST_WORKER_HOST",
  "MOSTRA_TEST_BUNDLE_PINS",
  "MOSTRA_TAILSCALE",
  "MOSTRA_CLOUDFLARED",
  "MOSTRA_TEST_TUNNELS",
];

/** `env` with every relative path variable resolved against `cwd`. */
export function detachedEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...env };
  for (const name of PATH_VARIABLES) {
    const value = result[name];
    if (value !== undefined && value !== "" && !isAbsolute(value)) {
      result[name] = resolve(cwd, value);
    }
  }
  return result;
}

/** The working directory of a process the CLI leaves running: the root of `anchor`'s file system. */
export function detachedDirectory(anchor: string): string {
  return parse(resolve(anchor)).root;
}
