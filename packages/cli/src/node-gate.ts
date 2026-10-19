/**
 * The first thing `mostra` does (RT-01, D142): a copy installed from npm starts on the machine's
 * Node.js, which must be 22.19 or later to find and start the runtime bundle (the SDK's download
 * and extraction need it). An older one fails closed with `MOSTRA_ENV_NODE_UNSUPPORTED` before
 * anything else loads, so nothing breaks half-way on an API it lacks. This module imports nothing.
 */

/** The oldest Node.js `mostra` starts on, as `[major, minor]`. */
export const MINIMUM_NODE: readonly [number, number] = [22, 19];

/** Whether `version` (`process.versions.node`, `22.18.0`) is older than {@link MINIMUM_NODE}. */
export function nodeTooOld(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major < MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor < MINIMUM_NODE[1]);
}
