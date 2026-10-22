/**
 * Taking a home (D81, D82, D85; FAILURE_MODEL §2, §3). The ledger's exclusive lock decides who
 * owns the home; the socket and `instance.json` are how everyone else finds the owner. A starter
 * that doesn't get the lock attaches to the owner (a daemon starter) or reports
 * `MOSTRA_HOME_LOCKED` (`mostra host`, or an owner it can't reach).
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  type ClientInfo,
  createDiagnostic,
  type Diagnostic,
  HOST_PROTOCOL_REVISIONS,
  type MostraInitializeResult,
  RpcError,
} from "@mostra/protocol";
import { LEDGER_FILE, type Ledger, openLedger } from "../ledger/index.ts";
import { type Environment, type Log, openFileLog, Redactor } from "../log.ts";
import { readProcess } from "../processes/index.ts";
import { attach, type SocketClient } from "../protocol-server/index.ts";
import {
  prepareOwnedDirectory,
  type RuntimeDirChoice,
  resolveRuntimeDir,
  socketPathFor,
} from "./paths.ts";
import {
  type InstanceRecord,
  readInstanceRecord,
  readLiveInstanceRecord,
  removeInstanceRecord,
  writeInstanceRecord,
} from "./record.ts";

/** How long a starter waits for the owner of a locked home to become reachable, by default. */
const DEFAULT_WAIT_MS = 20_000;
/** How often the owner checks that its home still exists, by default (at most 10 s, D81). */
const DEFAULT_WATCH_MS = 5000;

/** Options for {@link acquireHome}. */
export interface AcquireHomeOptions {
  /** The resolved home path (`resolveHomePath`). */
  readonly home: string;
  readonly env: Environment;
  /** `host` never attaches to another instance; `daemon` does. */
  readonly mode: "host" | "daemon";
  readonly runtimeVersion: string;
  /** How a losing daemon starter introduces itself when it attaches. */
  readonly client: ClientInfo;
  /** How long to wait for a locked home's owner. Default 20 s. */
  readonly waitMs?: number;
  /** Where warnings and errors are mirrored besides the log file, such as stderr. */
  readonly mirror?: (line: string) => void;
}

/** A home this process owns. Holding it holds the home's ledger lock. */
export interface OwnedHome {
  /** The home's real path. */
  readonly path: string;
  /**
   * The control endpoint's base: the socket path on POSIX; on Windows the pipe name each bind
   * completes. `instance.json` records the endpoint actually bound.
   */
  readonly socketPath: string;
  /** The runtime directory; `undefined` on Windows, which has none. */
  readonly runtimeDir: RuntimeDirChoice | undefined;
  readonly ledger: Ledger;
  readonly log: Log;
  /** Removes secrets and capability material from everything the instance logs or reports. */
  readonly redactor: Redactor;
  /** This process's identity, as recorded in `ledger_lock` and `instance.json`. */
  readonly self: { readonly pid: number; readonly startTime: string };
  /** When this process took the home (RFC 3339). */
  readonly startedAt: string;
  /** Writes `instance.json` naming the bound endpoint; call it once it listens, and again when it moves. */
  publish(mode: "host" | "daemon", socket: string): void;
  /**
   * Calls `onGone` once with `MOSTRA_HOME_GONE` if the home or its ledger disappears or is
   * replaced. Checks every `intervalMs`, at most 10 s.
   */
  watch(onGone: (diagnostic: Diagnostic) => void, intervalMs?: number): void;
  /** Removes `instance.json` if it is still this process's, and releases the lock. Idempotent. */
  release(): void;
}

/** The outcome of {@link acquireHome}. */
export type HomeAcquisition =
  | { readonly kind: "owner"; readonly home: OwnedHome }
  | {
      readonly kind: "attached";
      /** The owner, as `instance.json` names it. */
      readonly record: InstanceRecord;
      /** An initialized session with the owner; the caller closes it. */
      readonly connection: SocketClient;
      readonly result: MostraInitializeResult;
    };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function locked(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOME_LOCKED", { message }));
}

/**
 * Takes the home, or finds its owner. Throws an `RpcError` with `MOSTRA_HOME_NOT_OWNED`,
 * `MOSTRA_HOME_SOCKET_TOO_LONG`, `MOSTRA_HOME_LOCKED`, `MOSTRA_HOME_TOO_NEW`,
 * `MOSTRA_HOME_LEDGER_UNREADABLE` or `MOSTRA_HOST_REVISION_UNSUPPORTED` when it can do neither.
 * Call it only after the platform gate.
 */
export async function acquireHome(options: AcquireHomeOptions): Promise<HomeAcquisition> {
  const prepared = prepareOwnedDirectory(options.home);
  const home = prepared.realPath;
  const runtimeDir = resolveRuntimeDir({ env: options.env });
  // Check the length before creating anything in the runtime directory, then again with its real
  // path, which is the one bound (on macOS, /tmp is /private/tmp). Windows has no runtime
  // directory: its control pipe lives in the system's pipe namespace.
  let socketPath: string;
  if (runtimeDir === undefined) {
    socketPath = socketPathFor(undefined, home);
  } else {
    socketPathFor(runtimeDir.dir, home);
    socketPath = socketPathFor(prepareOwnedDirectory(runtimeDir.dir).realPath, home);
  }
  const redactor = new Redactor();
  redactor.protectEnvironment(options.env);
  const log = openFileLog({
    dir: join(home, "logs"),
    redactor,
    ...(options.mirror ? { mirror: options.mirror } : {}),
  });
  if (prepared.tightenedFrom !== undefined) {
    log.warn("home.tightened", { home, from: prepared.tightenedFrom, to: "owner only" });
  }
  if (runtimeDir?.rejected !== undefined) {
    log.warn("home.xdg_runtime_dir_rejected", {
      reason: runtimeDir.rejected,
      using: runtimeDir.dir,
    });
  }

  const me = await readProcess(process.pid);
  if (!me) throw new Error("Couldn't read this process's own start time.");
  const self = { pid: me.pid, startTime: me.startTime };
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);
  let seen: InstanceRecord | undefined;

  for (;;) {
    const opening = openLedger({
      storeDir: join(home, "store"),
      runtimeVersion: options.runtimeVersion,
      owner: self,
      log,
    });
    if (opening.ok) {
      log.info("home.acquired", { home, socket: socketPath, pid: self.pid });
      return {
        kind: "owner",
        home: own({
          home,
          socketPath,
          runtimeDir,
          ledger: opening.ledger,
          log,
          redactor,
          self,
          options,
        }),
      };
    }

    const record = await readLiveInstanceRecord(home);
    if (record) {
      seen = record;
      if (options.mode === "host") {
        throw locked(
          `The home ${home} is already owned by a Mostra ${record.mode} (PID ${record.pid}); \`mostra host\` needs a home no other instance owns.`,
        );
      }
      try {
        const { client, result } = await attach(record.socket, options.client, 2000);
        log.info("home.attached", { home, owner: record.pid, socket: record.socket });
        return { kind: "attached", record, connection: client, result };
      } catch (error) {
        // Only an unreachable socket is worth waiting for; a refusal is final.
        if (
          !(error instanceof RpcError) ||
          error.diagnostic.code !== "MOSTRA_HOST_CONNECTION_CLOSED"
        ) {
          throw error;
        }
      }
    }

    if (Date.now() >= deadline) {
      const owner = seen ?? readInstanceRecord(home);
      throw locked(
        owner
          ? `The home ${home} is owned by PID ${owner.pid}, but its socket ${owner.socket} can't be reached.`
          : `Another process holds the ledger lock of the home ${home} and published no instance record.`,
      );
    }
    await delay(100);
  }
}

interface OwnInputs {
  readonly home: string;
  /**
   * The control endpoint's base: the socket path on POSIX; on Windows the pipe name each bind
   * completes. `instance.json` records the endpoint actually bound.
   */
  readonly socketPath: string;
  /** The runtime directory; `undefined` on Windows, which has none. */
  readonly runtimeDir: RuntimeDirChoice | undefined;
  readonly ledger: Ledger;
  readonly log: Log;
  readonly redactor: Redactor;
  readonly self: { readonly pid: number; readonly startTime: string };
  readonly options: AcquireHomeOptions;
}

function identity(path: string): string | undefined {
  try {
    const stats = statSync(path);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

function own(inputs: OwnInputs): OwnedHome {
  const { home, socketPath, runtimeDir, ledger, log, redactor, self } = inputs;
  const startedAt = new Date().toISOString();
  const homeId = identity(home);
  const ledgerId = identity(join(home, "store", LEDGER_FILE));
  let timer: ReturnType<typeof setInterval> | undefined;
  let released = false;
  return {
    path: home,
    socketPath,
    runtimeDir,
    ledger,
    log,
    redactor,
    self,
    startedAt,
    publish(mode, socket) {
      writeInstanceRecord(home, {
        pid: self.pid,
        startTime: self.startTime,
        socket,
        runtimeVersion: inputs.options.runtimeVersion,
        revisions: [...HOST_PROTOCOL_REVISIONS],
        mode,
        startedAt,
      });
    },
    watch(onGone, intervalMs = DEFAULT_WATCH_MS) {
      if (timer) clearInterval(timer);
      timer = setInterval(
        () => {
          const homeNow = identity(home);
          const ledgerNow = identity(join(home, "store", LEDGER_FILE));
          if (homeNow === homeId && ledgerNow === ledgerId) return;
          if (timer) clearInterval(timer);
          onGone(
            createDiagnostic("MOSTRA_HOME_GONE", {
              message:
                homeNow === homeId
                  ? `The ledger of the home ${home} was removed or replaced while the instance was running.`
                  : `The home ${home} was removed or replaced while the instance was running.`,
            }),
          );
        },
        Math.min(intervalMs, 10_000),
      );
      timer.unref();
    },
    release() {
      if (released) return;
      released = true;
      if (timer) clearInterval(timer);
      try {
        removeInstanceRecord(home, self.pid, self.startTime);
      } catch (error) {
        log.warn("home.record_remove_failed", { error });
      }
      ledger.close();
      log.info("home.released", { home });
    },
  };
}
