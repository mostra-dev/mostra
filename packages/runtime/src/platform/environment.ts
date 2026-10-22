/**
 * The smallest environment a child can run in (the builder's): `PATH`, `HOME` and `TMPDIR` on
 * POSIX. Windows programs need more of what Windows itself gives every program (without
 * `SystemRoot` Node.js can't load its cryptography, without `TEMP` it has no temporary folder),
 * and Windows compares variable names without case, so they are found that way.
 */
import { WINDOWS } from "./directories.ts";

type Environment = Readonly<Record<string, string | undefined>>;

const WINDOWS_BASE = [
  "Path",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

/** The base environment of a child, from the supervisor's `env`. */
export function baseEnvironment(env: Environment): Record<string, string> {
  if (!WINDOWS) {
    return {
      PATH: env["PATH"] ?? "/usr/bin:/bin",
      HOME: env["HOME"] ?? "/",
      ...(env["TMPDIR"] ? { TMPDIR: env["TMPDIR"] } : {}),
    };
  }
  const byName = new Map(Object.entries(env).map(([name, value]) => [name.toUpperCase(), value]));
  const result: Record<string, string> = {};
  for (const name of WINDOWS_BASE) {
    const value = byName.get(name.toUpperCase());
    if (value !== undefined) result[name] = value;
  }
  return result;
}
