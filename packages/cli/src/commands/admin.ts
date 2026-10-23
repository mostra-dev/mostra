/**
 * Administration: `secret`, `list`, `status`, `daemon`, `host`, `gc`, `doctor`, `docs` and
 * `telemetry`. Each is a client of the host protocol or the runtime binary, never of the home's
 * files, except `doctor`, which reads what it needs to explain why an instance can't start.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  artifactGetMethod,
  artifactListMethod,
  createDiagnostic,
  type Diagnostic,
  gcRunMethod,
  type InstanceCheck,
  instanceCheckMethod,
  instanceStatusMethod,
  mostraShutdownMethod,
  RpcError,
  secretDeleteMethod,
  secretListMethod,
  secretSetMethod,
} from "@mostra/protocol";
import { checkBrowser, checkFiles, enclosingBundle, readBundle, readSetup } from "@mostra/sdk";
import { type CommandContext, type CommandDef, defineCommand } from "../command.ts";
import { docsIndex, indexMarkdown, nearestTopics } from "../docs.ts";
import { EXIT, exitCodeFor } from "../exit.ts";
import { type Environment, embeddedHome, locateRuntime, readHomeMarks } from "../home.ts";
import { usage } from "../parse.ts";
import { TelemetryStore, TURNED, telemetryStatus } from "../telemetry/index.ts";
import { NOTICE_DEFAULT } from "../telemetry/words.ts";
import { cliVersion } from "../version.ts";
import { arg, artifactRef, flag, pretty } from "./shared.ts";

const artifactFlag = {
  name: "artifact",
  kind: "string" as const,
  value: "<path|id>",
  summary: "The artifact's own secret, instead of one the whole home shares.",
};

/** `mostra secret set <name>`. */
export const secretSetCommand: CommandDef = defineCommand({
  path: ["secret", "set"],
  summary:
    "Store a secret that server code reads with secret(name); the value comes from stdin and is never shown.",
  args: [{ name: "name", summary: "Letters, digits, _, . and -, starting with a letter or _." }],
  flags: [artifactFlag],
  output: { type: "SecretEntry", topic: "cli" },
  exits: [EXIT.failure],
  example: "secret set MAIL_TOKEN --artifact ./inbox < token.txt",
  readsStdin: true,
  async run(context) {
    let value = await context.readStdin();
    // One trailing newline is the terminal's or `echo`'s, never the secret's.
    if (value.endsWith("\n")) value = value.slice(0, value.endsWith("\r\n") ? -2 : -1);
    if (value === "") throw usage("The secret's value comes from stdin, and stdin was empty.");
    const artifact = flag(context, "artifact");
    const entry = await context.call(secretSetMethod, {
      name: arg(context, "name"),
      value,
      ...(artifact !== undefined ? { artifact: artifactRef(artifact, context.cwd) } : {}),
    });
    return { result: entry, human: `Stored ${entry.name} (${entry.scope})\n` };
  },
});

/** `mostra secret list`. */
export const secretListCommand: CommandDef = defineCommand({
  path: ["secret", "list"],
  summary: "List the secrets' names and scopes; values are never shown.",
  flags: [artifactFlag],
  output: { type: "SecretListResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "secret list --artifact ./inbox",
  async run(context) {
    const artifact = flag(context, "artifact");
    const result = await context.call(secretListMethod, {
      ...(artifact !== undefined ? { artifact: artifactRef(artifact, context.cwd) } : {}),
    });
    return {
      result,
      human: result.secrets
        .map((entry) => `${entry.name}  ${entry.scope}  ${entry.updatedAt}\n`)
        .join(""),
    };
  },
});

/** `mostra secret rm <name>`. */
export const secretRmCommand: CommandDef = defineCommand({
  path: ["secret", "rm"],
  summary: "Delete a secret.",
  args: [{ name: "name", summary: "The secret's name." }],
  flags: [artifactFlag],
  output: { type: "SecretDeleteResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "secret rm MAIL_TOKEN --artifact ./inbox",
  async run(context) {
    const artifact = flag(context, "artifact");
    const result = await context.call(secretDeleteMethod, {
      name: arg(context, "name"),
      ...(artifact !== undefined ? { artifact: artifactRef(artifact, context.cwd) } : {}),
    });
    return { result, human: result.deleted ? "Deleted\n" : "No such secret\n" };
  },
});

/** `mostra list`. */
export const listCommand: CommandDef = defineCommand({
  path: ["list"],
  summary: "List the home's published artifacts.",
  flags: [
    {
      name: "family",
      kind: "string",
      value: "<family>",
      summary: "Only artifacts of this family.",
    },
  ],
  output: { type: "ArtifactListResult", topic: "cli" },
  exits: [],
  example: "list --family dashboard",
  async run(context) {
    const family = flag(context, "family");
    const result = await context.call(artifactListMethod, {
      ...(family !== undefined ? { filter: { family } } : {}),
    });
    return {
      result,
      human: result.artifacts
        .map(
          (artifact) =>
            `${artifact.id}  v${artifact.latestVersion?.number ?? "-"}  ${artifact.title}${artifact.source ? `  ${artifact.source}` : ""}\n`,
        )
        .join(""),
    };
  },
});

/** `mostra status [artifact]`. */
export const statusCommand: CommandDef = defineCommand({
  path: ["status"],
  summary:
    "Show the instance (processes, workers, deliveries) or one artifact (versions, policy, links).",
  args: [{ name: "artifact", summary: "An artifact: its source path or its ID.", optional: true }],
  output: { type: "InstanceStatusResult or ArtifactDetail", topic: "cli" },
  exits: [EXIT.failure],
  example: "status ./sidebar-review",
  async run(context) {
    const artifact = context.args["artifact"];
    if (typeof artifact === "string") {
      const detail = await context.call(artifactGetMethod, {
        artifact: artifactRef(artifact, context.cwd),
      });
      const versions = detail.versions
        .map(
          (version) =>
            `  v${version.number}  ${version.id}  ${version.publishedAt}${version.collected ? "  collected" : ""}\n`,
        )
        .join("");
      return { result: detail, human: `${detail.id}  ${detail.title}\n${versions}` };
    }
    const status = await context.call(instanceStatusMethod, {});
    return { result: status, human: pretty(status) };
  },
});

/** The runtime's `service` command, as JSON. */
async function service(
  context: CommandContext,
  action: "install" | "uninstall" | "status",
): Promise<{ manager: string; name: string; file: string; installed: boolean }> {
  const { stdout } = await context.runtime([
    "service",
    action,
    "--home",
    context.home,
    ...(context.flags["no-start"] === true ? ["--no-start"] : []),
  ]);
  const line = stdout.split("\n").find((text) => text.trim().startsWith("{"));
  let parsed: { status?: string; service?: unknown; diagnostic?: Diagnostic } = {};
  try {
    parsed = JSON.parse(line ?? "{}") as typeof parsed;
  } catch {
    // Reported below.
  }
  if (parsed.status === "ok" && parsed.service) {
    return parsed.service as { manager: string; name: string; file: string; installed: boolean };
  }
  throw new RpcError(
    parsed.diagnostic ??
      createDiagnostic("MOSTRA_ENV_SERVICE_FAILED", {
        message: `mostra-runtime service ${action} gave no answer.`,
      }),
  );
}

const noStart = {
  name: "no-start",
  kind: "boolean" as const,
  summary: "Write or remove the service's file without asking launchd or systemd to load it.",
};

/** `mostra daemon start`. */
export const daemonStartCommand: CommandDef = defineCommand({
  path: ["daemon", "start"],
  summary: "Start the home's daemon, or find the one already running.",
  output: { type: "DaemonStatus", topic: "cli" },
  exits: [],
  example: "daemon start",
  async run(context) {
    const connection = await context.connection();
    const summary = connection?.summary;
    return {
      result: { running: true, ...summary },
      human: `${summary?.started ? "Started" : "Running"}: pid ${summary?.pid}, ${summary?.socket}\n`,
    };
  },
});

/** Stops the running daemon; resolves once its socket closed. */
async function stopDaemon(context: CommandContext): Promise<{ stopped: boolean; pid?: number }> {
  const connection = await context.connection(false);
  if (!connection) return { stopped: false };
  const { pid } = connection.summary;
  await context.call(mostraShutdownMethod, {});
  await Promise.race([connection.closed, new Promise((done) => setTimeout(done, 15_000))]);
  // The record goes last, as the instance releases its home (D87).
  const deadline = Date.now() + 15_000;
  while (existsSync(join(context.home, "instance.json")) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 50));
  }
  return { stopped: true, pid };
}

/** `mostra daemon stop`. */
export const daemonStopCommand: CommandDef = defineCommand({
  path: ["daemon", "stop"],
  summary: "Stop the home's daemon; open pages reconnect when it starts again.",
  output: { type: "DaemonStop", topic: "cli" },
  exits: [],
  example: "daemon stop",
  async run(context) {
    const result = await stopDaemon(context);
    return {
      result,
      human: result.stopped ? `Stopped pid ${result.pid}\n` : "No daemon was running\n",
    };
  },
});

/** `mostra daemon restart`. */
export const daemonRestartCommand: CommandDef = defineCommand({
  path: ["daemon", "restart"],
  summary: "Stop the home's daemon and start it again, for instance after an update.",
  output: { type: "DaemonStatus", topic: "cli" },
  exits: [],
  example: "daemon restart",
  async run(context) {
    await stopDaemon(context);
    const connection = await context.connection();
    const summary = connection?.summary;
    return { result: { running: true, ...summary }, human: `Running: pid ${summary?.pid}\n` };
  },
});

/** `mostra daemon status`. */
export const daemonStatusCommand: CommandDef = defineCommand({
  path: ["daemon", "status"],
  summary:
    "Whether the home's daemon runs, when it would exit for lack of work, and its login service.",
  output: { type: "DaemonStatus", topic: "cli" },
  exits: [],
  example: "daemon status",
  async run(context) {
    const loginService = await service(context, "status");
    const connection = await context.connection(false);
    if (!connection) {
      return {
        result: { running: false, service: loginService },
        human: `Not running. Login service: ${loginService.installed ? "installed" : "not installed"}\n`,
      };
    }
    const status = await context.call(instanceStatusMethod, {});
    return {
      result: { running: true, ...connection.summary, status, service: loginService },
      human: `Running: pid ${connection.summary.pid}${status.idleExitAt ? `, exits when idle at ${status.idleExitAt}` : ""}. Login service: ${loginService.installed ? "installed" : "not installed"}\n`,
    };
  },
});

/** `mostra daemon install`. */
export const daemonInstallCommand: CommandDef = defineCommand({
  path: ["daemon", "install"],
  summary:
    "Run the home's daemon as a login service (launchd or systemd), so links answer at any hour.",
  flags: [noStart],
  output: { type: "ServiceStatus", topic: "cli" },
  exits: [],
  example: "daemon install",
  async run(context) {
    const result = await service(context, "install");
    return { result, human: `Installed ${result.name} (${result.file})\n` };
  },
});

/** `mostra daemon uninstall`. */
export const daemonUninstallCommand: CommandDef = defineCommand({
  path: ["daemon", "uninstall"],
  summary: "Remove the home's login service; the daemon then exits after 30 idle minutes.",
  flags: [noStart],
  output: { type: "ServiceStatus", topic: "cli" },
  exits: [],
  example: "daemon uninstall",
  async run(context) {
    const result = await service(context, "uninstall");
    return { result, human: `Removed ${result.name}\n` };
  },
});

/** `mostra host`. */
export const hostCommand: CommandDef = defineCommand({
  path: ["host"],
  summary:
    "Speak the host protocol on stdin and stdout, for a host that spawns Mostra; it sends no telemetry.",
  flags: [
    {
      name: "bind",
      kind: "string",
      value: "<address>",
      summary: "Serve viewers on this address instead of 127.0.0.1.",
    },
    {
      name: "url-host",
      kind: "string",
      value: "<name>",
      summary: "The host name links use; a wildcard --bind needs it.",
    },
  ],
  output: { type: "the host protocol (INTERFACES §6)", topic: "cli" },
  exits: [],
  example: "host --home ~/.my-host/mostra",
  local: true,
  quiet: true,
  readsStdin: true,
  async run(context) {
    const runtime = await locateRuntime(context.env);
    const bind = flag(context, "bind");
    const urlHost = flag(context, "url-host");
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        runtime.node,
        [
          runtime.entry,
          "host",
          "--home",
          context.home,
          ...(bind !== undefined ? ["--bind", bind] : []),
          ...(urlHost !== undefined ? ["--url-host", urlHost] : []),
        ],
        { stdio: "inherit", env: context.env as NodeJS.ProcessEnv },
      );
      child.on("exit", (exit) => resolve(exit ?? EXIT.environment));
      child.on("error", () => resolve(EXIT.environment));
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.on(signal, () => child.kill(signal));
    });
    return { result: undefined, exit: code, raw: true };
  },
});

/** `mostra gc`. */
export const gcCommand: CommandDef = defineCommand({
  path: ["gc"],
  summary:
    "Remove what nothing references: unreferenced versions' files, unused packages and caches.",
  flags: [
    {
      name: "dry-run",
      kind: "boolean",
      summary: "List what a run would remove, and remove nothing.",
    },
    {
      name: "compact-events",
      kind: "boolean",
      summary: "Also replace events before --before with one summary per artifact.",
    },
    {
      name: "before",
      kind: "string",
      value: "<cursor>",
      summary: "The cursor --compact-events compacts before.",
    },
  ],
  output: { type: "GcRunResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "gc --dry-run",
  async run(context) {
    const compact = context.flags["compact-events"] === true;
    const before = flag(context, "before");
    if (compact !== (before !== undefined))
      throw usage("--compact-events and --before go together.");
    if (before !== undefined && !/^[0-9]+$/.test(before))
      throw usage(`--before takes an event cursor; "${before}" isn't one.`);
    const result = await context.call(gcRunMethod, {
      ...(context.flags["dry-run"] === true ? { dryRun: true } : {}),
      ...(before !== undefined ? { compactEvents: { before } } : {}),
    });
    // A step gc couldn't finish is a warning beside what it did (MOSTRA_HOME_GC_INCOMPLETE).
    for (const warning of result.warnings ?? []) context.warn(warning);
    const verb = result.dryRun ? "Would remove" : "Removed";
    const lines = [
      `${verb} ${result.versions.length} versions' files, ${result.snapshots.count} snapshots, ${result.lockLayouts.count} lock layouts, ${result.storePackages.count} store packages and ${result.caches.count} cache entries (${result.bytes} bytes).`,
      ...result.versions.map(
        (version) => `  ${version.artifactId} v${version.number} ${version.versionId}`,
      ),
      ...(result.compacted ? [`Compacted ${result.compacted.removed} events.`] : []),
    ];
    return { result, human: `${lines.join("\n")}\n` };
  },
});

/** One line of `doctor`. */
interface DoctorCheck {
  readonly name: string;
  readonly status: "ok" | "warning" | "error";
  readonly detail?: string;
  readonly diagnostic?: Diagnostic;
}

/**
 * Whether the runtime's gate admits this platform (RT-07, D146): macOS and Linux on x64 and arm64,
 * and Windows only behind the development switch `MOSTRA_DEV_WINDOWS=1` until WP-W3 ships it.
 * The runtime's own gate (`home/platform.ts`) decides; this is what `doctor` reports of it.
 */
function supportedPlatform(platform: string, arch: string, env: Environment): boolean {
  if (arch !== "x64" && arch !== "arm64") return false;
  if (platform === "darwin" || platform === "linux") return true;
  return platform === "win32" && env["MOSTRA_DEV_WINDOWS"] === "1";
}

/** `mostra doctor`. */
export const doctorCommand: CommandDef = defineCommand({
  path: ["doctor"],
  summary:
    "Check the platform, the runtime, the home, its daemon and ledger, and the login service.",
  flags: [
    {
      name: "deep",
      kind: "boolean",
      summary: "Also hash every version against its recorded output digest.",
    },
  ],
  output: { type: "DoctorResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "doctor",
  async run(context) {
    const checks: DoctorCheck[] = [];
    const node = Number(process.versions.node.split(".")[0]);
    checks.push(
      supportedPlatform(process.platform, process.arch, context.env)
        ? {
            name: "platform",
            status: "ok",
            detail: `${process.platform} ${process.arch}, Node ${process.versions.node}`,
          }
        : {
            name: "platform",
            status: "error",
            diagnostic: createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
              message: `Mostra doesn't run on ${process.platform === "win32" ? `Windows (${process.platform}-${process.arch})` : `${process.platform}-${process.arch}`}; it supports macOS and Linux on x64 and arm64.`,
            }),
          },
    );
    if (node < 24) {
      checks.push({
        name: "node",
        status: "error",
        diagnostic: createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", {
          message: `Mostra needs Node 24 or later; this is ${process.versions.node}.`,
        }),
      });
    }
    try {
      const runtime = await locateRuntime(context.env);
      checks.push({ name: "runtime", status: "ok", detail: runtime.entry });
    } catch (error) {
      checks.push({ name: "runtime", status: "error", diagnostic: (error as RpcError).diagnostic });
    }
    checks.push(await bundleCheck(context.env, context.flags["deep"] === true));
    checks.push(homeCheck(context.home));
    let connection: Awaited<ReturnType<CommandContext["connection"]>>;
    try {
      connection = await context.connection();
      checks.push({
        name: "daemon",
        status: "ok",
        detail: `pid ${connection?.summary.pid}, ${connection?.summary.socket}`,
      });
    } catch (error) {
      const diagnostic = error instanceof RpcError ? error.diagnostic : undefined;
      checks.push({
        name: "daemon",
        status: "error",
        ...(diagnostic ? { diagnostic } : { detail: String(error) }),
        ...(diagnostic?.code === "MOSTRA_HOME_LEDGER_UNREADABLE"
          ? { detail: backups(context.home) }
          : {}),
      });
    }
    if (connection) {
      if (connection.summary.version !== cliVersion()) {
        checks.push({
          name: "versions",
          status: "warning",
          detail: `The CLI is ${cliVersion()} and the daemon ${connection.summary.version}; run "mostra daemon restart" after an update.`,
        });
      }
      const instance = await context.call(
        instanceCheckMethod,
        context.flags["deep"] === true ? { deep: true } : {},
      );
      checks.push(...instance.checks.map((check: InstanceCheck) => ({ ...check })));
      checks.push(await alwaysOnCheck(context));
    }
    const telemetry = telemetryStatus({
      env: context.env,
      configDir: context.configDir,
      embedded:
        readHomeMarks(context.home).hostConfigured !== undefined ||
        connection?.summary.mode === "host",
    });
    checks.push({
      name: "telemetry",
      status: "ok",
      detail: telemetry.text.split("\n")[0] as string,
    });
    const firstError = checks.find((check) => check.status === "error");
    const human = checks
      .map((check) => {
        const mark = check.status === "ok" ? "ok  " : check.status === "warning" ? "warn" : "FAIL";
        const what = check.diagnostic
          ? `${check.diagnostic.code}: ${check.diagnostic.message}`
          : (check.detail ?? "");
        const hint = check.diagnostic?.hint ? `\n        ${check.diagnostic.hint}` : "";
        return `${mark}  ${check.name}${what ? `: ${what}` : ""}${hint}`;
      })
      .join("\n");
    return {
      result: { checks },
      human: `${human}\n`,
      ...(firstError
        ? {
            exit: firstError.diagnostic
              ? exitCodeFor(firstError.diagnostic.code)
              : EXIT.environment,
          }
        : {}),
    };
  },
});

/**
 * The runtime bundle this CLI runs from (RT-01): set up and matching its files. Outside a bundle
 * (a development checkout, `MOSTRA_RUNTIME_BIN`) there is nothing to check. `--deep` hashes every
 * file against the bundle's file list and the browser against its pin, as setup does.
 */
async function bundleCheck(env: CommandContext["env"], deep: boolean): Promise<DoctorCheck> {
  const root = env["MOSTRA_BUNDLE"] || enclosingBundle();
  if (!root)
    return { name: "bundle", status: "ok", detail: "No runtime bundle: a development runtime." };
  try {
    const bundle = await readBundle(root);
    const label = `Mostra ${bundle.info.version} for ${bundle.info.platform} at ${root}`;
    if (!(await readSetup(bundle))) {
      return {
        name: "bundle",
        status: "error",
        diagnostic: createDiagnostic("MOSTRA_ENV_BUNDLE_UNAVAILABLE", {
          message: `The runtime bundle at ${root} isn't set up; run its bin/mostra-setup.`,
        }),
      };
    }
    if (!deep) return { name: "bundle", status: "ok", detail: label };
    await checkFiles(bundle);
    const browser = await checkBrowser(bundle);
    if (browser.length > 0) {
      return {
        name: "bundle",
        status: "error",
        diagnostic: createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", {
          message: `The verify browser of the bundle at ${root} differs from its pin: ${browser.join("; ")}.`,
        }),
      };
    }
    return { name: "bundle", status: "ok", detail: `${label}; every file matches its SHA-256` };
  } catch (error) {
    return {
      name: "bundle",
      status: "error",
      diagnostic:
        error instanceof RpcError
          ? error.diagnostic
          : createDiagnostic("MOSTRA_ENV_BUNDLE_INVALID", { message: (error as Error).message }),
    };
  }
}

/** The home: absent (it is made on first use), a directory the user owns, or not. */
function homeCheck(home: string): DoctorCheck {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(home);
  } catch {
    return { name: "home", status: "ok", detail: `${home} (not created yet)` };
  }
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
    return {
      name: "home",
      status: "error",
      diagnostic: createDiagnostic("MOSTRA_HOME_NOT_OWNED", {
        message: `Mostra can't use ${home}: another user owns it or it isn't a directory.`,
      }),
    };
  }
  return { name: "home", status: "ok", detail: home };
}

/** The ledger's backups beside it, for a ledger that can't be opened (FAILURE_MODEL §3). */
function backups(home: string): string {
  try {
    const found = readdirSync(join(home, "store")).filter((name) =>
      name.startsWith("ledger.sqlite.bak-"),
    );
    return found.length > 0
      ? `Backups: ${found.map((name) => join(home, "store", name)).join(", ")}`
      : "No ledger backups.";
  } catch {
    return "No ledger backups.";
  }
}

/**
 * LL-05's doctor half (D96, D63): artifacts with submission policy `none` are meant to answer at
 * any hour, which needs the home's login service.
 */
async function alwaysOnCheck(context: CommandContext): Promise<DoctorCheck> {
  const { artifacts } = await context.call(artifactListMethod, {});
  const longLived = artifacts.filter((artifact) => artifact.policy?.policy === "none");
  if (longLived.length === 0)
    return { name: "always-on", status: "ok", detail: "No artifact needs an always-on daemon." };
  const loginService = await service(context, "status");
  if (loginService.installed) {
    return {
      name: "always-on",
      status: "ok",
      detail: `Login service ${loginService.name} keeps the daemon running.`,
    };
  }
  return {
    name: "always-on",
    status: "warning",
    diagnostic: createDiagnostic("MOSTRA_HOME_NOT_ALWAYS_ON", {
      message: `${longLived.length} ${longLived.length === 1 ? "artifact has" : "artifacts have"} submission policy none (${longLived
        .map((artifact) => artifact.title)
        .slice(0, 3)
        .join(", ")}), and no login service keeps this home's daemon running.`,
    }),
  };
}

/** `mostra docs [topic]`. */
export const docsCommand: CommandDef = defineCommand({
  path: ["docs"],
  summary: "Print Mostra's reference: the CLI, telemetry, and every diagnostic code's page.",
  args: [
    { name: "topic", summary: "A topic or a diagnostic code. Default: the index.", optional: true },
  ],
  output: { type: "DocsPage", topic: "cli" },
  exits: [],
  example: "docs MOSTRA_DEP_MISSING",
  local: true,
  quiet: true,
  async run(context) {
    const topics = docsIndex();
    const wanted = context.args["topic"];
    if (typeof wanted !== "string") {
      const markdown = indexMarkdown(topics);
      return {
        result: {
          topic: "index",
          markdown,
          url: topics[0]?.url.replace(/\/[^/]+$/, "") ?? "",
          topics: topics.map(({ topic, title, url }) => ({ topic, title, url })),
        },
        human: markdown,
      };
    }
    const found = topics.find(
      (topic) => topic.topic === wanted || topic.topic === wanted.toUpperCase(),
    );
    if (!found) {
      throw usage(
        `No topic "${wanted}". The nearest: ${nearestTopics(wanted, topics).join(", ")}. Run "mostra docs" for the index.`,
      );
    }
    const markdown = readFileSync(found.file, "utf8");
    return { result: { topic: found.topic, markdown, url: found.url }, human: markdown };
  },
});

/** `mostra telemetry status`. */
export const telemetryStatusCommand: CommandDef = defineCommand({
  path: ["telemetry", "status"],
  summary: "Whether the CLI sends anonymous usage data, and why.",
  output: { type: "TelemetryStatus", topic: "telemetry" },
  exits: [],
  example: "telemetry status",
  local: true,
  quiet: true,
  async run(context) {
    const { status, text } = telemetryStatus({
      env: context.env,
      configDir: context.configDir,
      ...homeTelemetry(context.home),
    });
    return { result: status, human: `${text}\n` };
  },
});

/** How the home bears on telemetry: a host's home, or one whose `config.json` can't be read. */
function homeTelemetry(home: string): { embedded: boolean; homeConfigUnreadable?: string } {
  const marks = readHomeMarks(home);
  return {
    embedded: embeddedHome(marks) && marks.unreadable !== true,
    ...(marks.unreadable === true ? { homeConfigUnreadable: join(home, "config.json") } : {}),
  };
}

/** The choice couldn't be recorded: nothing changed (Opus review finding 6). */
function unwritable(store: TelemetryStore): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_CLI_CONFIG_UNWRITABLE", {
      message: `${store.settingsFile} can't be written, so the choice wasn't recorded and nothing changed.`,
    }),
  );
}

/** `mostra telemetry on`. */
export const telemetryOnCommand: CommandDef = defineCommand({
  path: ["telemetry", "on"],
  summary: "Send anonymous usage data from this CLI; the notice says what it contains.",
  output: { type: "TelemetryStatus", topic: "telemetry" },
  exits: [EXIT.environment],
  example: "telemetry on",
  local: true,
  quiet: true,
  async run(context) {
    const store = new TelemetryStore(context.configDir);
    const read = store.read();
    const shownBefore = read.ok && read.settings.noticeShownAt !== undefined;
    if (!shownBefore) context.stderr(NOTICE_DEFAULT);
    const now = new Date().toISOString();
    const written =
      store.update((current) => ({
        ...current,
        choice: "on",
        noticeShownAt: current.noticeShownAt ?? now,
      })) ?? store.locked(() => store.reset({ choice: "on", noticeShownAt: now }));
    if (written === undefined) throw unwritable(store);
    const { status } = telemetryStatus({
      env: context.env,
      configDir: context.configDir,
      ...homeTelemetry(context.home),
    });
    return { result: status, human: `${TURNED.on}\n` };
  },
});

/** `mostra telemetry off`. */
export const telemetryOffCommand: CommandDef = defineCommand({
  path: ["telemetry", "off"],
  summary: "Stop sending usage data, and delete the install ID and any unsent events.",
  output: { type: "TelemetryStatus", topic: "telemetry" },
  exits: [EXIT.environment],
  example: "telemetry off",
  local: true,
  quiet: true,
  async run(context) {
    const store = new TelemetryStore(context.configDir);
    const done =
      store.turnOff() || store.locked(() => store.reset({ choice: "off" })) !== undefined;
    if (!done) throw unwritable(store);
    const { status } = telemetryStatus({
      env: context.env,
      configDir: context.configDir,
      ...homeTelemetry(context.home),
    });
    return { result: status, human: `${TURNED.off}\n` };
  },
});
