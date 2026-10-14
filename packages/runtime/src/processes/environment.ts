/**
 * The artifact environment (D95, DP-05): what a child that runs an artifact's own code, or code
 * the artifact chose such as a package's lifecycle script, receives from the supervisor's
 * environment. It is an allowlist, so the supervisor's own settings and a host's credentials
 * (anything a spawning host put into Mostra's environment) never reach artifact code by accident.
 * Install children use it from WP-04 on; workers (WP-08) start from it too.
 */
import type { Environment } from "../log.ts";

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

/** npm's own configuration channel: the user's registry, scopes and proxies for installs. */
const NPM_CONFIG = /^npm_config_/i;

/** The artifact environment derived from the supervisor's `env`. */
export function artifactEnvironment(env: Environment): Environment {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (PASSED.has(name) || NPM_CONFIG.test(name)) result[name] = value;
  }
  result["PATH"] ??= "/usr/bin:/bin";
  return result;
}
