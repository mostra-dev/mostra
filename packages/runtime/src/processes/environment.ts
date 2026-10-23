/**
 * The artifact environment (D95, DP-05): what a child that runs an artifact's own code, or code
 * the artifact chose such as a package's lifecycle script, receives from the supervisor's
 * environment. It is an allowlist, so the supervisor's own settings and a host's credentials
 * (anything a spawning host put into Mostra's environment) never reach artifact code by accident.
 * Install children use it from WP-04 on; workers (WP-08) start from it too.
 */
import { delimiter, dirname } from "node:path";
import type { Environment } from "../log.ts";
import { WINDOWS, WINDOWS_SYSTEM_VARIABLES } from "../platform/index.ts";

/** Variables an artifact's processes need to work like an ordinary shell's programs. */
const PASSED: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  // Who the user is, and the toolchain a package's native build (node-gyp, prebuilds) uses.
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "CC",
  "CXX",
  "MAKE",
  "PYTHON",
  "DEVELOPER_DIR",
  "SDKROOT",
  // Network access through the user's proxy and certificate authorities.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

/** What Windows programs need besides the variables above (`platform`'s one list). */
const PASSED_WINDOWS: ReadonlySet<string> = new Set(
  WINDOWS_SYSTEM_VARIABLES.map((name) => name.toUpperCase()),
);
const PASSED_UPPER: ReadonlySet<string> = new Set([...PASSED].map((name) => name.toUpperCase()));

/** npm's own configuration channel: the user's registry, scopes and proxies for installs. */
const NPM_CONFIG = /^npm_config_/i;

/**
 * The artifact environment derived from the supervisor's `env`. Its `PATH` starts with the
 * directory of the Node.js the runtime runs on (D142): a lifecycle script or server code that runs
 * `node` gets the runtime bundle's private Node.js, on a machine with no other Node.js too.
 */
export function artifactEnvironment(env: Environment): Environment {
  const result: Record<string, string> = {};
  // On Windows `Path` and `PATH` are one variable; the one given keeps its own name.
  let pathName = "PATH";
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (WINDOWS) {
      const upper = name.toUpperCase();
      if (upper === "PATH") pathName = name;
      if (PASSED_UPPER.has(upper) || PASSED_WINDOWS.has(upper) || NPM_CONFIG.test(name)) {
        result[name] = value;
      }
    } else if (PASSED.has(name) || NPM_CONFIG.test(name)) {
      result[name] = value;
    }
  }
  const own = dirname(process.execPath);
  const path = result[pathName] ?? (WINDOWS ? "" : "/usr/bin:/bin");
  const first = path.split(delimiter)[0] ?? "";
  const already = WINDOWS ? first.toLowerCase() === own.toLowerCase() : first === own;
  result[pathName] = already ? path : path === "" ? own : `${own}${delimiter}${path}`;
  return result;
}
