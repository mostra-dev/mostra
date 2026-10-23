/**
 * The home's login service (D62, D63, RT-08, RT-11): `mostra daemon install` registers the home's
 * daemon with the user's service manager, so an artifact answers at any hour, even after a reboot.
 * A launchd agent on macOS, a systemd user unit on Linux, a Task Scheduler task at the user's logon
 * on Windows (D151); each runs `mostra-runtime daemon --always-on --home <home>`, which never
 * exits for lack of work, and restarts it when it ends unexpectedly. On Windows the task runs the
 * daemon through `mostra-win-service`, a launcher without a console, so no window opens at logon,
 * which also does the restarting (Task Scheduler's own setting didn't, VERIFIED_FACTS WP-W2). The
 * definition carries no secret: the daemon reads them from the home (D44).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { homeHash } from "../home/index.ts";
import type { Environment } from "../log.ts";
import { currentUserSid, OS, serviceLauncherPath, stopServiceLauncher } from "../platform/index.ts";

/** Where a home's service is, and whether it is there. */
export interface ServiceStatus {
  /** `launchd` (macOS), `systemd` (Linux) or `task-scheduler` (Windows). */
  readonly manager: "launchd" | "systemd" | "task-scheduler";
  /** The service's name: the launchd label, the systemd unit, or the scheduled task. */
  readonly name: string;
  /**
   * The file that defines it. On Windows the task's definition as Mostra registered it, kept in
   * the home (`<home>\service\task.xml`): Task Scheduler keeps its own copy.
   */
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
  /** The operating system (`OS` of the platform layer). */
  readonly platform?: string;
  /** Windows: the user the task runs as, a SID; default the current user. */
  readonly user?: string;
  /** Windows: the launcher; default `mostra-win-service.exe` beside the helper. */
  readonly launcher?: string;
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
  if (platform === "win32") {
    const file = win32.join(spec.home, "service", "task.xml");
    return {
      manager: "task-scheduler",
      name: `mostra-${hash.toLowerCase()}`,
      file,
      installed: existsSync(file),
      command: [
        spec.launcher ?? launcherOrName(),
        "--stop-event",
        stopEvent(hash),
        "--log",
        win32.join(spec.home, "logs", "service.log"),
        ...windowsServiceVariables(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
        "--",
        ...command,
      ],
    };
  }
  throw new RpcError(
    createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
      message: `Mostra can't install a login service on ${platform}.`,
    }),
  );
}

/**
 * What a Windows task passes on besides the user's logon environment, which Task Scheduler gives
 * it: the development switch while Windows needs it (D150 item 7, until WP-W3), the helper a
 * checkout names, and the locale and time zone, as the POSIX units carry theirs. Nothing secret.
 */
function windowsServiceVariables(env: Environment): [string, string][] {
  return ["MOSTRA_DEV_WINDOWS", "MOSTRA_WIN_HELPER", "LANG", "TZ"].flatMap((name) => {
    const value = env[name];
    return value ? [[name, value] as [string, string]] : [];
  });
}

/** The event that asks a home's launcher to stop (`Local\`: this logon session's namespace). */
const stopEvent = (hash: string): string => `Local\\mostra-service-${hash}`;

/** The launcher's path, or its bare name where it isn't installed (a status only reads it). */
function launcherOrName(): string {
  try {
    return serviceLauncherPath();
  } catch {
    return "mostra-win-service.exe";
  }
}

/** One word of a Windows command line, quoted as the Microsoft C runtime parses it. */
export function windowsArgument(word: string): string {
  if (word !== "" && !/[\s"]/.test(word)) return word;
  let out = '"';
  let backslashes = 0;
  for (const char of word) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    out += "\\".repeat(char === '"' ? backslashes * 2 + 1 : backslashes) + char;
    backslashes = 0;
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`;
}

/** The Task Scheduler definition (schema 1.2) of a home's task. */
function taskFile(spec: ServiceSpec, status: ServiceStatus): string {
  const user = xml(spec.user ?? currentUserSid());
  const [program = "", ...args] = status.command;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(`Mostra daemon for ${spec.home}`)}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(program)}</Command>
      <Arguments>${xml(args.map(windowsArgument).join(" "))}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
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
  // The task runs in the user's own logon environment, as any program they start does.
  if (status.manager === "task-scheduler") return taskFile(spec, status);
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

/** The definition's bytes: Task Scheduler reads UTF-16 with its byte order mark. */
function encoded(status: ServiceStatus, text: string): Buffer | string {
  return status.manager === "task-scheduler" ? Buffer.from(`\ufeff${text}`, "utf16le") : text;
}

/** The definition as written, decoded as {@link encoded} wrote it. */
function readDefinition(status: ServiceStatus): string {
  const bytes = readFileSync(status.file);
  if (status.manager !== "task-scheduler") return bytes.toString("utf8");
  return bytes.toString("utf16le").replace(/^\ufeff/, "");
}

/** Installs the home's daemon as a login service and starts it, replacing an earlier one. */
export function installService(spec: ServiceSpec, options: ServiceOptions = {}): ServiceStatus {
  // On Windows a launcher that isn't there is MOSTRA_ENV_HELPER_MISSING before anything is written.
  const status = serviceFor(
    (spec.platform ?? OS) === "win32" && spec.launcher === undefined
      ? { ...spec, launcher: serviceLauncherPath() }
      : spec,
  );
  const text = serviceFile(spec, status);
  try {
    mkdirSync(dirname(status.file), { recursive: true });
    mkdirSync(join(spec.home, "logs"), { recursive: true, mode: 0o700 });
    if (status.installed && !options.noStart) stopService(status);
    writeFileSync(status.file, encoded(status, text), { mode: 0o644 });
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw failed(`Writing ${status.file} failed: ${(error as Error).message}`);
  }
  if (!options.noStart) {
    if (status.manager === "launchd") {
      run("launchctl", ["bootstrap", `gui/${uid()}`, status.file]);
    } else if (status.manager === "systemd") {
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "enable", "--now", status.name]);
    } else {
      // Registered for the user's own logons, which needs no elevation (InteractiveToken), and
      // started now, as launchd's RunAtLoad and systemd's `--now` start theirs.
      run("schtasks", ["/Create", "/TN", status.name, "/XML", status.file, "/F"]);
      run("schtasks", ["/Run", "/TN", status.name]);
    }
  }
  return { ...status, installed: true };
}

function stopService(status: ServiceStatus): void {
  try {
    if (status.manager === "launchd") run("launchctl", ["bootout", `gui/${uid()}/${status.name}`]);
    else if (status.manager === "systemd")
      run("systemctl", ["--user", "disable", "--now", status.name]);
    else stopTask(status);
  } catch {
    // Not loaded: nothing to stop.
  }
}

/**
 * Stops and deletes a home's task: its launcher stops the daemon cleanly first (Ctrl+Break, which
 * the runtime handles as `mostra/shutdown`, D87), then the task is ended, which ends whatever its
 * job still holds, and deleted.
 */
function stopTask(status: ServiceStatus): void {
  const event = status.command[status.command.indexOf("--stop-event") + 1];
  if (event !== undefined) {
    try {
      stopServiceLauncher(event);
    } catch {
      // No launcher runs, or the helper couldn't ask: ending the task below stops it.
    }
  }
  try {
    run("schtasks", ["/End", "/TN", status.name]);
  } catch {
    // Not running.
  }
  run("schtasks", ["/Delete", "/TN", status.name, "/F"]);
}

/** Whether Task Scheduler holds the home's task. */
function taskRegistered(status: ServiceStatus): boolean {
  try {
    run("schtasks", ["/Query", "/TN", status.name]);
    return true;
  } catch {
    return false;
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

/**
 * Whether the home has a login service whose file runs this home's daemon (`mostra doctor`); on
 * Windows also whether Task Scheduler holds its task (`registered`).
 */
export function serviceStatus(
  spec: ServiceSpec,
): ServiceStatus & { readonly current: boolean; readonly registered?: boolean } {
  const status = serviceFor(spec);
  const registered =
    status.manager === "task-scheduler" ? { registered: taskRegistered(status) } : {};
  if (!status.installed) return { ...status, current: false, ...registered };
  return {
    ...status,
    current: readDefinition(status) === serviceFile(spec, status),
    ...registered,
  };
}
