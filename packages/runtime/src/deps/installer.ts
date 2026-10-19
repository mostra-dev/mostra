/**
 * The install child (D94, D95, DP-05): pnpm 10 run by the process manager in the artifact's
 * context, never inside the supervisor. Every run is one child, `node pnpm.cjs …`, started in the
 * artifact's source directory with the artifact environment, against the home's store, metadata
 * cache and state, and stopped after 300 s (FAILURE_MODEL §9). Its NDJSON report becomes the
 * outcome: success, or one diagnostic from the DEP area.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagnostic, type Diagnostic } from "@mostra/protocol";
import type { Environment, Log } from "../log.ts";
import { artifactEnvironment, type ProcessManager } from "../processes/index.ts";
import { runtimeRoot } from "./warm.ts";

/** How long one install may take (FAILURE_MODEL §9). */
export const INSTALL_TIMEOUT_MS = 300_000;

/** The release age of an unpinned resolution, in minutes (D95): one day. */
export const MINIMUM_RELEASE_AGE_MINUTES = 1440;

/** Where the installer keeps its state inside the home (DATA_MODEL §1). */
export interface InstallerDirs {
  /** `deps/store`: the shared content-addressed store. */
  readonly store: string;
  /** `deps/cache`: registry metadata, read when offline. */
  readonly cache: string;
  /** `deps/state`: the installer's own state. */
  readonly state: string;
}

/** One installer run. */
export interface InstallRun {
  /** The pnpm command and its own arguments, such as `["install", "--frozen-lockfile"]`. */
  readonly command: readonly string[];
  /** The project directory pnpm works on (`--dir`). */
  readonly dir: string;
  /** The artifact's source directory: the child's working directory (DP-05). */
  readonly cwd: string;
  /** Use only what the store and the metadata cache hold. */
  readonly offline: boolean;
  /**
   * Resolution applies the release age (D95), exempting packages named with an exact version.
   * `false` for an install of a lockfile already resolved: its pins are exact and were checked
   * when they were chosen.
   */
  readonly releaseAge: { readonly exempt: readonly string[] } | false;
  /** What the child serves, for `instance/status` and reaping. */
  readonly ownerRef: string;
}

/** What a run ended with. */
export type InstallOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** The installer of one instance. */
export interface Installer {
  readonly version: string;
  run(run: InstallRun): Promise<InstallOutcome>;
  /**
   * `pnpm store prune` (gc, D140 item 14): removes what no layout links from the store. `dir` is
   * an empty scratch directory the prune works in, and its registry metadata cache: pnpm's prune
   * empties the metadata cache it is given, and the home's (`deps/cache`) is what offline
   * resolution reads (D95), so it never sees that one. A store command takes no network flag.
   */
  prune(input: { readonly dir: string; readonly ownerRef: string }): Promise<InstallOutcome>;
}

/** Connection failures: the registry can't be reached at all, so Mostra is offline (D95). */
const UNREACHABLE =
  /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EHOSTDOWN|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT)\b/;

/** The package a pnpm error names, from its record or its message. */
function packageNamed(record: Record<string, unknown>, message: string): string | undefined {
  const fromRecord = (record["package"] as { name?: unknown } | undefined)?.name;
  if (typeof fromRecord === "string") return fromRecord;
  const fromSpec = (record["spec"] as { name?: unknown } | undefined)?.name;
  if (typeof fromSpec === "string") return fromSpec;
  return /(?:for|resolve|GET \S+?\/)(@?[^\s@/:]+(?:\/[^\s@/:]+)?)/.exec(message)?.[1];
}

/** The install child's entry: the compiled one beside the compiled supervisor, else the source. */
function childEntry(): string {
  return fileURLToPath(import.meta.url).endsWith(".ts")
    ? join(runtimeRoot(), "src/deps/child/install.ts")
    : join(runtimeRoot(), "dist/deps/child/install.js");
}

/** Finds pnpm 10 beside the runtime; anything else is refused (D94). */
function locatePnpm(): { entry: string; version: string } {
  let dir = runtimeRoot();
  for (;;) {
    const candidate = join(dir, "node_modules", "pnpm");
    if (existsSync(join(candidate, "package.json"))) {
      const real = realpathSync(candidate);
      const { version } = JSON.parse(readFileSync(join(real, "package.json"), "utf8")) as {
        version: string;
      };
      if (!version.startsWith("10.")) {
        throw new Error(`The runtime found pnpm ${version}; its installer must be pnpm 10 (D94).`);
      }
      return { entry: join(real, "dist", "pnpm.cjs"), version };
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("The runtime is missing its installer, pnpm 10.");
    dir = parent;
  }
}

/** The project settings of a run: the release age, and the packages named exactly (D95). */
export function workspaceSettings(releaseAge: InstallRun["releaseAge"]): string {
  if (releaseAge === false) return "minimumReleaseAge: 0\n";
  const lines = [`minimumReleaseAge: ${MINIMUM_RELEASE_AGE_MINUTES}`];
  if (releaseAge.exempt.length > 0) {
    lines.push("minimumReleaseAgeExclude:");
    for (const name of [...new Set(releaseAge.exempt)].sort()) {
      lines.push(`  - ${JSON.stringify(name)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Options for {@link createInstaller}. */
export interface InstallerOptions {
  readonly processes: ProcessManager;
  readonly log: Log;
  readonly dirs: InstallerDirs;
  /** The supervisor's environment; the child gets the artifact environment derived from it. */
  readonly env: Environment;
  /** Default {@link INSTALL_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** Creates the installer. */
export function createInstaller(options: InstallerOptions): Installer {
  const pnpm = locatePnpm();
  const entry = childEntry();
  const timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS;
  // The artifact environment passes no CI variable, which would switch pnpm to frozen installs on
  // its own; every run says what it wants.
  const env = artifactEnvironment(options.env);

  /** The arguments every pnpm run takes; `network` is absent for a store command. */
  const argsFor = (spec: {
    readonly command: readonly string[];
    readonly dir: string;
    readonly cacheDir: string;
    readonly network?: "--offline" | "--prefer-offline";
  }): string[] => [
    // The install child connects to the supervisor and runs pnpm in its own process group.
    entry,
    pnpm.entry,
    ...spec.command,
    "--dir",
    spec.dir,
    `--config.store-dir=${options.dirs.store}`,
    `--config.cache-dir=${spec.cacheDir}`,
    `--config.state-dir=${options.dirs.state}`,
    // Settings a user's .npmrc could change, which these layouts depend on.
    "--config.lockfile=true",
    "--config.modules-dir=node_modules",
    "--config.virtual-store-dir=node_modules/.pnpm",
    "--config.shamefully-hoist=false",
    "--config.enable-global-virtual-store=false",
    "--reporter=ndjson",
    ...(spec.network ? [spec.network] : []),
    "--config.update-notifier=false",
    // Every on-demand package's lifecycle scripts run, here in the install child (D95).
    "--config.dangerously-allow-all-builds=true",
    "--config.ignore-scripts=false",
    "--config.auto-install-peers=true",
    "--config.strict-peer-dependencies=false",
    "--config.node-linker=isolated",
    "--config.fetch-retries=2",
    "--config.fetch-retry-mintimeout=1000",
    "--config.fetch-retry-maxtimeout=8000",
  ];

  /** Runs pnpm in an install child, bounded by the install limit. */
  const execute = async (run: {
    readonly args: readonly string[];
    readonly dir: string;
    readonly cwd: string;
    readonly releaseAge: InstallRun["releaseAge"];
    readonly ownerRef: string;
  }): Promise<InstallOutcome> => {
    const args = [...run.args];
    // pnpm 10 reads the release age's exemptions only from the project's pnpm-workspace.yaml, and
    // reads that file only when the project is its own workspace root (VERIFIED_FACTS, WP-04);
    // being the root also stops pnpm's upward search for a workspace above the home.
    await writeFile(join(run.dir, "pnpm-workspace.yaml"), workspaceSettings(run.releaseAge));
    const errors: { code: string; message: string; record: Record<string, unknown> }[] = [];
    const scriptLines: string[] = [];
    const child = await options.processes.spawn({
      kind: "install",
      ownerRef: run.ownerRef,
      command: process.execPath,
      args,
      cwd: run.cwd,
      env,
      // The IPC channel is the child's lifeline: when the supervisor dies, it ends its group.
      ipc: {},
      onStdout: (line) => {
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (record["name"] === "pnpm:lifecycle" && typeof record["line"] === "string") {
          scriptLines.push(record["line"]);
          if (scriptLines.length > 20) scriptLines.shift();
        }
        if (record["level"] !== "error") return;
        const err = (record["err"] ?? {}) as { code?: unknown; message?: unknown };
        const code = String(record["code"] ?? err.code ?? "");
        const message = String(err.message ?? record["message"] ?? "");
        errors.push({ code, message, record });
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      child.exited.then((exit) => ({ kind: "exit" as const, exit })),
      new Promise<{ kind: "timeout" }>((done) => {
        timer = setTimeout(() => done({ kind: "timeout" }), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (outcome.kind === "timeout") {
      await child.stop(2000);
      return {
        ok: false,
        diagnostic: createDiagnostic("MOSTRA_DEP_TIMEOUT", {
          message: `Installing packages took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
        }),
      };
    }
    if (outcome.exit.code === 0) return { ok: true };
    options.log.warn("deps.install_failed", {
      code: outcome.exit.code,
      signal: outcome.exit.signal,
      errors: errors.map(({ code, message }) => ({ code, message })),
    });
    return { ok: false, diagnostic: diagnose(errors, scriptLines, outcome.exit.stderrTail) };
  };

  return {
    version: pnpm.version,
    run: (run) =>
      execute({
        args: argsFor({
          command: run.command,
          dir: run.dir,
          cacheDir: options.dirs.cache,
          network: run.offline ? "--offline" : "--prefer-offline",
        }),
        dir: run.dir,
        cwd: run.cwd,
        releaseAge: run.releaseAge,
        ownerRef: run.ownerRef,
      }),
    prune: (input) =>
      execute({
        args: argsFor({
          command: ["store", "prune"],
          dir: input.dir,
          cacheDir: join(input.dir, "metadata-cache"),
        }),
        dir: input.dir,
        cwd: input.dir,
        releaseAge: false,
        ownerRef: input.ownerRef,
      }),
  };
}

/** Turns the installer's errors into one diagnostic. */
function diagnose(
  errors: readonly { code: string; message: string; record: Record<string, unknown> }[],
  scriptLines: readonly string[],
  stderr: readonly string[],
): Diagnostic {
  const first = errors[0];
  const output = [...scriptLines, ...stderr].slice(-12).join("\n");
  if (!first) {
    return createDiagnostic("MOSTRA_DEP_INSTALL_FAILED", {
      message: `The package installer failed.${output ? `\n${output}` : ""}`,
    });
  }
  const named = packageNamed(first.record, first.message);
  const subject = named ? `the package ${named}` : "a package";
  if (first.code === "ERR_PNPM_NO_OFFLINE_META" || first.code === "ERR_PNPM_NO_OFFLINE_TARBALL") {
    return createDiagnostic("MOSTRA_DEP_OFFLINE", {
      message: `Mostra is offline and the home's package store doesn't hold ${subject}.`,
    });
  }
  if (UNREACHABLE.test(first.message)) {
    return createDiagnostic("MOSTRA_DEP_OFFLINE", {
      message: `The package registry can't be reached, so ${subject} can't be installed: ${first.message}`,
    });
  }
  if (
    first.code === "ERR_PNPM_FETCH_404" ||
    first.code === "ERR_PNPM_NO_MATCHING_VERSION" ||
    first.code === "ERR_PNPM_NO_MATURE_MATCHING_VERSION"
  ) {
    // pnpm reports a range whose only matches are too new either way (D95's release age).
    const mature =
      first.code === "ERR_PNPM_FETCH_404"
        ? ""
        : " Without an exact version, only releases at least a day old match; a release less than a day old installs when named exactly.";
    return createDiagnostic("MOSTRA_DEP_NOT_FOUND", {
      message: `The registry has no match for ${subject}: ${first.message}.${mature}`,
    });
  }
  return createDiagnostic("MOSTRA_DEP_INSTALL_FAILED", {
    message: `Installing ${subject} failed: ${first.message}${output ? `\n${output}` : ""}`,
  });
}
