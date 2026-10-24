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
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import {
  type ClientInfo,
  createDiagnostic,
  mostraShutdownMethod,
  RpcError,
} from "@mostra/protocol";
import { homeHash, readLiveInstanceRecord } from "../home/index.ts";
import type { Environment } from "../log.ts";
import {
  currentUserSid,
  isSameProcess,
  OS,
  serviceLauncherPath,
  stopServiceLauncher,
} from "../platform/index.ts";
import { attach } from "../protocol-server/index.ts";

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
        stopEventOf(file) ?? newStopEvent(hash),
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

/**
 * A new name for the event that asks a home's launcher to stop: in `Local\` (the logon session's
 * namespace, the only one an ordinary user may create names in), with a random part, so nobody who
 * can't read the task or the home can create it first (Opus review of WP-W2, finding 6).
 */
const newStopEvent = (hash: string): string =>
  `Local\\mostra-service-${hash.toLowerCase()}-${randomBytes(8).toString("hex")}`;

/** The stop event a definition Mostra wrote names, if the file is there. */
function stopEventOf(file: string): string | undefined {
  try {
    const text = readFileSync(file).toString("utf16le");
    return /--stop-event (Local\\mostra-service-[0-9a-z]+-[0-9a-f]{16})\b/.exec(text)?.[1];
  } catch {
    return undefined;
  }
}

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
    const status = serviceFor({ home, node: "", entry: "", env });
    if (!status.installed) return false;
    return status.manager !== "task-scheduler" || registeredLately(status);
  } catch {
    return false;
  }
}

/** What the idle check last learnt of each task: whether Task Scheduler holds it, and when. */
const registrations = new Map<string, { registered?: boolean; at: number; asking: boolean }>();

/**
 * Whether Task Scheduler held the task when last asked, asking again in the background at most
 * once a minute: the idle check runs every few seconds and must never wait for `schtasks`. A task
 * removed in Task Scheduler's own window then stops counting, so a daemon started by hand exits
 * when idle again (Opus review of WP-W2, finding 5). Until the first answer, the definition in the
 * home counts.
 */
function registeredLately(status: ServiceStatus): boolean {
  const interval = Number(process.env["MOSTRA_TEST_SERVICE_QUERY_MS"]) || 60_000;
  const entry = registrations.get(status.name) ?? { at: Number.NEGATIVE_INFINITY, asking: false };
  registrations.set(status.name, entry);
  if (!entry.asking && Date.now() - entry.at >= interval) {
    entry.asking = true;
    execFile(
      "schtasks",
      ["/Query", "/TN", status.name],
      { timeout: 30_000, windowsHide: true },
      (error) => {
        entry.registered = error === null;
        entry.at = Date.now();
        entry.asking = false;
      },
    );
  }
  return entry.registered ?? true;
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
  /** Who asks, when a Windows uninstall stops the daemon over its pipe. */
  readonly client?: ClientInfo;
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
export async function installService(
  spec: ServiceSpec,
  options: ServiceOptions = {},
): Promise<ServiceStatus> {
  // On Windows a launcher that isn't there is MOSTRA_ENV_HELPER_MISSING before anything is written.
  const status = serviceFor(
    (spec.platform ?? OS) === "win32" && spec.launcher === undefined
      ? { ...spec, launcher: serviceLauncherPath() }
      : spec,
  );
  const text = serviceFile(spec, status);
  // Windows: the home keeps the definition only once Task Scheduler took it, so a definition in
  // the home names a task that was registered (Opus review of WP-W2, finding 5).
  const registering = status.manager === "task-scheduler" && !options.noStart;
  const written = registering ? `${status.file}.new` : status.file;
  try {
    mkdirSync(dirname(status.file), { recursive: true });
    mkdirSync(join(spec.home, "logs"), { recursive: true, mode: 0o700 });
    if (status.installed && !options.noStart) await stopService(status, spec.home, options);
    writeFileSync(written, encoded(status, text), { mode: 0o644 });
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw failed(`Writing ${status.file} failed: ${(error as Error).message}`);
  }
  if (registering) {
    try {
      run("schtasks", ["/Create", "/TN", status.name, "/XML", written, "/F"]);
      renameSync(written, status.file);
    } finally {
      rmSync(written, { force: true });
    }
    registrations.delete(status.name);
  }
  if (!options.noStart) {
    if (status.manager === "launchd") {
      run("launchctl", ["bootstrap", `gui/${uid()}`, status.file]);
    } else if (status.manager === "systemd") {
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "enable", "--now", status.name]);
    } else {
      // Registered above for the user's own logons, which needs no elevation (InteractiveToken),
      // and started now, as launchd's RunAtLoad and systemd's `--now` start theirs.
      run("schtasks", ["/Run", "/TN", status.name]);
    }
  }
  return { ...status, installed: true };
}

async function stopService(
  status: ServiceStatus,
  home: string,
  options: ServiceOptions,
): Promise<void> {
  try {
    if (status.manager === "launchd") run("launchctl", ["bootout", `gui/${uid()}/${status.name}`]);
    else if (status.manager === "systemd")
      run("systemctl", ["--user", "disable", "--now", status.name]);
    else await stopTask(status, home, options);
  } catch {
    // Not loaded: nothing to stop.
  }
}

/**
 * Stops and deletes a home's task, the daemon first and in order (D87), as launchd's `bootout`
 * and systemd's `disable --now` send it SIGTERM:
 * - through the launcher's stop event, when this logon session has it: the launcher gives the
 *   daemon Ctrl+Break, which the runtime handles as `mostra/shutdown`;
 * - otherwise (the launcher runs in another session, as when the user is logged on at the console
 *   and uninstalls over SSH, or the home lost the definition naming the event) with
 *   `mostra/shutdown` over the home's pipe, which reaches the daemon from any session; its exit
 *   with code 0 ends the launcher (Opus review of WP-W2, finding 4);
 *
 * then the task is ended, which ends whatever its job still holds, and deleted.
 */
async function stopTask(
  status: ServiceStatus,
  home: string,
  options: ServiceOptions,
): Promise<void> {
  const event = status.installed
    ? status.command[status.command.indexOf("--stop-event") + 1]
    : undefined;
  let signalled = false;
  // A test stands for another session's launcher, whose event this session can't see.
  if (event !== undefined && process.env["MOSTRA_TEST_SERVICE_STOP"] !== "pipe") {
    try {
      signalled = stopServiceLauncher(event).signalled;
    } catch {
      // The helper couldn't ask: the pipe below stops the daemon.
    }
  }
  if (!signalled) await shutDownInstance(home, options.client);
  try {
    run("schtasks", ["/End", "/TN", status.name]);
  } catch {
    // Not running.
  }
  run("schtasks", ["/Delete", "/TN", status.name, "/F"]);
  registrations.delete(status.name);
}

/** Asks the home's running daemon, if any, to stop (`mostra/shutdown`), and waits until it has. */
async function shutDownInstance(home: string, client: ClientInfo | undefined): Promise<void> {
  const record = await readLiveInstanceRecord(home);
  if (record === undefined || record.mode !== "daemon") return;
  try {
    const session = await attach(record.socket, client ?? { name: "mostra-service", version: "0" });
    await session.client.peer
      .call(mostraShutdownMethod, {}, { timeoutMs: 10_000 })
      .catch(() => undefined);
    session.client.close();
  } catch {
    // Unreachable: ending the task stops it.
    return;
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && (await isSameProcess(record.pid, record.startTime))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

/**
 * Stops and removes the home's login service; a home without one is left as it is. On Windows a
 * task Task Scheduler still holds is removed though the home lost its definition (restored from a
 * backup, removed by hand), or the task would keep starting the daemon at every logon (Opus review
 * of WP-W2, finding 5).
 */
export async function uninstallService(
  spec: ServiceSpec,
  options: ServiceOptions = {},
): Promise<ServiceStatus> {
  const status = serviceFor(spec);
  const orphaned =
    !status.installed &&
    status.manager === "task-scheduler" &&
    !options.noStart &&
    taskRegistered(status);
  if (!status.installed && !orphaned) return status;
  if (!options.noStart) await stopService(status, spec.home, options);
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
