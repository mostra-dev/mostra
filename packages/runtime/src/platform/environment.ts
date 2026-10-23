/**
 * The smallest environment a child can run in (the builder's): `PATH`, `HOME` and `TMPDIR` on
 * POSIX. Windows programs need more of what Windows itself gives every program (without
 * `SystemRoot` Node.js can't load its cryptography, without `TEMP` it has no temporary folder),
 * and Windows compares variable names without case, so they are found that way.
 */
import { WINDOWS } from "./directories.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What Windows itself gives every program and programs rely on, besides `Path`: the system's
 * directories, the user's profile folders, the shell and how it finds programs, who the user is
 * and the processor. None names a secret. The one list both the base and the artifact environment
 * pass on Windows (`processes/environment.ts`).
 */
export const WINDOWS_SYSTEM_VARIABLES: readonly string[] = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
];

const WINDOWS_BASE = ["Path", ...WINDOWS_SYSTEM_VARIABLES];

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
