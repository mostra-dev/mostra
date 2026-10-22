/**
 * The home's login service (D62, D63, RT-08): `mostra daemon install` registers the home's daemon
 * with the user's service manager, so an artifact answers at any hour, even after a reboot. A
 * launchd agent on macOS, a systemd user unit on Linux; either runs `mostra-runtime daemon
 * --always-on --home <home>`, which never exits for lack of work, and restarts it when it ends
 * unexpectedly. The unit carries no secret: the daemon reads them from the home (D44).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { homeHash } from "../home/index.ts";
import type { Environment } from "../log.ts";
import { OS } from "../platform/index.ts";

/** Where a home's service is, and whether it is there. */
export interface ServiceStatus {
  /** `launchd` (macOS) or `systemd` (Linux). */
  readonly manager: "launchd" | "systemd";
  /** The service's name: the launchd label, or the systemd unit. */
  readonly name: string;
  /** The file that defines it. */
  readonly file: string;
  /** Whether the file exists. */
  readonly installed: boolean;
  /** What it runs. */
  readonly command: readonly string[];
}

/** What a service runs and where. */
export interface ServiceSpec {
  /** The home's real path. */
  readonly home: string;
  /** The Node executable and the runtime's entry, `mostra-runtime`. */
  readonly node: string;
  readonly entry: string;
  readonly env?: Environment;
  /** `process.platform`. */
  readonly platform?: string;
}

function failed(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_SERVICE_FAILED", { message }));
}

function userHome(env: Environment): string {
  return env["HOME"] ?? homedir();
}

/** The service a home's daemon would be, installed or not. */
export function serviceFor(spec: ServiceSpec): ServiceStatus {
  const env = spec.env ?? process.env;
  const platform = spec.platform ?? OS;
  const hash = homeHash(spec.home);
  const command = [spec.node, spec.entry, "daemon", "--always-on", "--home", spec.home];
  if (platform === "darwin") {
    const name = `dev.mostra.daemon.${hash}`;
    return {
      manager: "launchd",
      name,
      file: join(userHome(env), "Library", "LaunchAgents", `${name}.plist`),
      installed: existsSync(join(userHome(env), "Library", "LaunchAgents", `${name}.plist`)),
      command,
    };
  }
  if (platform === "linux") {
    const config = env["XDG_CONFIG_HOME"] || join(userHome(env), ".config");
    const name = `mostra-${hash.toLowerCase()}.service`;
    const file = join(config, "systemd", "user", name);
    return { manager: "systemd", name, file, installed: existsSync(file), command };
  }
  throw new RpcError(
    createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
      message: `Mostra can't install a login service on ${platform}.`,
    }),
  );
}

/**
 * Whether `home` has a login service installed: its daemon then never exits for lack of work,
 * whoever started it, so a daemon started by hand before `install` keeps the artifacts answering.
 */
export function hasLoginService(home: string, env: Environment = process.env): boolean {
  try {
    return serviceFor({ home, node: "", entry: "", env }).installed;
  } catch {
    return false;
  }
}

const xml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** systemd's quoting for one `ExecStart` word. */
const systemdWord = (word: string): string =>
  /^[A-Za-z0-9_./:@=+-]+$/.test(word)
    ? word
    : `"${word
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/%/g, "%%")
        .replace(/\$/g, "$$$$")}"`;

/** The environment a service gets: what finding programs and the home needs, nothing secret. */
function serviceEnvironment(env: Environment): Record<string, string> {
  const out: Record<string, string> = {
    PATH: env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: userHome(env),
  };
  for (const name of ["MOSTRA_RUNTIME_DIR", "LANG", "TZ"]) {
    const value = env[name];
    if (value) out[name] = value;
  }
  return out;
}

/** The text of the service's file. */
export function serviceFile(spec: ServiceSpec, status: ServiceStatus): string {
  const env = serviceEnvironment(spec.env ?? process.env);
  const log = join(spec.home, "logs", "service.log");
  if (status.manager === "launchd") {
    const args = status.command.map((word) => `      <string>${xml(word)}</string>`).join("\n");
    const vars = Object.entries(env)
      .map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`)
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(status.name)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${vars}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${xml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(log)}</string>
  </dict>
</plist>
`;
  }
  const environment = Object.entries(env)
    .map(([key, value]) => `Environment=${systemdWord(`${key}=${value}`)}`)
    .join("\n");
  return `[Unit]
Description=Mostra daemon for ${spec.home.replace(/\n/g, " ").replace(/%/g, "%%")}
After=network.target

[Service]
Type=simple
ExecStart=${status.command.map(systemdWord).join(" ")}
${environment}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

/** Options of an install or uninstall. */
export interface ServiceOptions {
  /** Write the file only, without asking the service manager to start it (tests). */
  readonly noStart?: boolean;
}

function run(command: string, args: readonly string[]): void {
  try {
    execFileSync(command, [...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch (error) {
    const failure = error as { stderr?: Buffer; message: string };
    const detail = failure.stderr?.toString().trim() || failure.message;
    throw failed(`${command} ${args.join(" ")} failed: ${detail.slice(0, 400)}`);
  }
}

const uid = (): number => process.getuid?.() ?? 0;

/** Installs the home's daemon as a login service and starts it, replacing an earlier one. */
export function installService(spec: ServiceSpec, options: ServiceOptions = {}): ServiceStatus {
  const status = serviceFor(spec);
  const text = serviceFile(spec, status);
  try {
    mkdirSync(dirname(status.file), { recursive: true });
    mkdirSync(join(spec.home, "logs"), { recursive: true, mode: 0o700 });
    if (status.installed && !options.noStart) stopService(status);
    writeFileSync(status.file, text, { mode: 0o644 });
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw failed(`Writing ${status.file} failed: ${(error as Error).message}`);
  }
  if (!options.noStart) {
    if (status.manager === "launchd") {
      run("launchctl", ["bootstrap", `gui/${uid()}`, status.file]);
    } else {
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "enable", "--now", status.name]);
    }
  }
  return { ...status, installed: true };
}

function stopService(status: ServiceStatus): void {
  try {
    if (status.manager === "launchd") run("launchctl", ["bootout", `gui/${uid()}/${status.name}`]);
    else run("systemctl", ["--user", "disable", "--now", status.name]);
  } catch {
    // Not loaded: nothing to stop.
  }
}

/** Stops and removes the home's login service; a home without one is left as it is. */
export function uninstallService(spec: ServiceSpec, options: ServiceOptions = {}): ServiceStatus {
  const status = serviceFor(spec);
  if (!status.installed) return status;
  if (!options.noStart) stopService(status);
  rmSync(status.file, { force: true });
  if (!options.noStart && status.manager === "systemd") {
    try {
      run("systemctl", ["--user", "daemon-reload"]);
    } catch {
      // The file is gone either way.
    }
  }
  return { ...status, installed: false };
}

/** Whether the home has a login service whose file runs this home's daemon (`mostra doctor`). */
export function serviceStatus(spec: ServiceSpec): ServiceStatus & { readonly current: boolean } {
  const status = serviceFor(spec);
  if (!status.installed) return { ...status, current: false };
  const text = readFileSync(status.file, "utf8");
  return { ...status, current: text === serviceFile(spec, status) };
}
