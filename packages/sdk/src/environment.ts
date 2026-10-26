/**
 * The environment of a process the SDK starts (the instance, the browser's fetch). A host may
 * give an environment of its own (`createMostra`'s `env`), and on Windows a program starts only
 * with the system's own variables: Node.js aborts without `SystemRoot`, which its random-number
 * source needs. So on Windows each of them this process has is added where the host's environment
 * lacks it, matched without case as Windows matches names (D150 item 9, D153). They name the
 * system's own folders and nothing of the user's secrets. Elsewhere the environment is the host's,
 * as it is.
 */
/** An environment as a host gives it. */
type Environment = Readonly<Record<string, string | undefined>>;

/** What Windows gives every program, which a child of the SDK keeps (D150 item 9). */
const WINDOWS_SYSTEM_VARIABLES: readonly string[] = [
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

/** `env` for a child process: on Windows with the system's own variables this process has. */
export function childEnvironment(
  env: Environment,
  options: { readonly platform?: string; readonly own?: Environment } = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined) out[name] = value;
  if ((options.platform ?? process.platform) !== "win32") return out;
  const own = options.own ?? process.env;
  const present = new Set(Object.keys(out).map((name) => name.toUpperCase()));
  for (const name of WINDOWS_SYSTEM_VARIABLES) {
    if (present.has(name.toUpperCase())) continue;
    const found = Object.entries(own).find(([key]) => key.toUpperCase() === name.toUpperCase());
    if (found?.[1] !== undefined) out[found[0]] = found[1];
  }
  return out;
}
