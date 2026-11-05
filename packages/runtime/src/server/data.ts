/**
 * A remote server's data directory (DATA_MODEL §7.1) and its hosted homes (§7.2, D165 items 0b,
 * 6): the directory is refused on a network filesystem, held by `server.lock` so a second server
 * refuses it, and its directory ledger `server.sqlite` opens in WAL with normal locking. Each
 * hosted home opens on its first request (its own `home.lock`, its ledger in normal locking, so a
 * backup replicator can read it) and closes after it has been idle a while. Opening and closing one
 * home are serialized, so a home never has two writers in one process, and a request that meets a
 * home being closed waits for the close and opens it again (FAILURE_MODEL §11.2).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import {
  type HeldLock,
  holdLock,
  type Ledger,
  type LedgerOwner,
  openLedger,
} from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { networkFilesystem, ownedDirectory } from "../platform/index.ts";
import { SERVER_MIGRATIONS } from "./directory.ts";

/** An open hosted home: its ledger, its lock, and whatever the server assembled over them. */
export interface OpenedHome<T> {
  readonly id: string;
  readonly dir: string;
  readonly ledger: Ledger;
  readonly incarnation: string;
  /** What the server built over the ledger (interaction, gateway routes, sessions). */
  readonly assembled: T;
}

/** What opens and closes the parts of a hosted home that live above its ledger. */
export interface HomeAssembler<T> {
  /** Builds a home's parts over its ledger, once it is open. */
  assemble(home: {
    readonly id: string;
    readonly dir: string;
    readonly ledger: Ledger;
  }): Promise<T>;
  /** Stops them, before the ledger closes. */
  disassemble(assembled: T): Promise<void>;
  /** Whether a home is in use now: a connection, a stream, a poll, a pending delivery, a waiting run. */
  busy(assembled: T): boolean;
}

/** The data directory, held. */
export interface DataDirectory<T> {
  readonly dir: string;
  readonly directory: Ledger;
  /** Opens a hosted home, or returns it when open; a request waits for a close in progress. */
  home(id: string): Promise<OpenedHome<T>>;
  /** The homes open now. */
  open(): readonly string[];
  /** Notes that a home was used now, so it isn't closed while used. */
  touch(id: string): void;
  /** Closes every home, then the directory, then releases the lock. */
  close(): Promise<void>;
}

/** Options for {@link openDataDirectory}. */
export interface DataDirectoryOptions<T> {
  readonly dir: string;
  readonly runtimeVersion: string;
  readonly owner: LedgerOwner;
  readonly log: Log;
  readonly env: Environment;
  readonly assembler: HomeAssembler<T>;
  /** Close a home this long after it was last used and nothing is busy. Default 10 minutes. */
  readonly idleCloseMs?: number;
  readonly walAutocheckpoint?: number;
}

function locked(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOME_LOCKED", { message }));
}

/**
 * Refuses a data directory on a network filesystem (`MOSTRA_HOME_NETWORK_FILESYSTEM`), before
 * anything in it is opened. `MOSTRA_TEST_NETWORK_FILESYSTEM` names a directory tests treat as one,
 * since no test machine mounts NFS.
 */
function refuseNetworkFilesystem(dir: string, env: Environment): void {
  const testing = env["MOSTRA_TEST_NETWORK_FILESYSTEM"];
  const found =
    testing !== undefined && testing !== "" && dir.startsWith(testing)
      ? "nfs (test)"
      : networkFilesystem(dir);
  if (found !== undefined) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_NETWORK_FILESYSTEM", {
        message: `The data directory ${dir} is on a network filesystem (${found}); a remote server's homes need a local disk.`,
      }),
    );
  }
}

/** Opens and holds a server's data directory. Throws `MOSTRA_HOME_LOCKED` when another server holds it. */
export async function openDataDirectory<T>(
  options: DataDirectoryOptions<T>,
): Promise<DataDirectory<T>> {
  const { dir, log } = options;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  ownedDirectory(dir);
  refuseNetworkFilesystem(dir, options.env);
  const serverLock = holdLock(join(dir, "server.lock"), options.owner);
  if (!serverLock) {
    throw locked(`Another server process holds the data directory ${dir} (server.lock).`);
  }
  let directory: Ledger;
  try {
    const opening = openLedger({
      storeDir: dir,
      fileName: "server.sqlite",
      runtimeVersion: options.runtimeVersion,
      owner: options.owner,
      log,
      migrations: SERVER_MIGRATIONS,
      locking: "normal",
      ...(options.walAutocheckpoint !== undefined
        ? { walAutocheckpoint: options.walAutocheckpoint }
        : {}),
    });
    if (!opening.ok) throw locked(`server.sqlite in ${dir} is locked by another process.`);
    directory = opening.ledger;
  } catch (error) {
    serverLock.release();
    throw error;
  }
  mkdirSync(join(dir, "homes"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "files"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "keys"), { recursive: true, mode: 0o700 });

  interface Entry {
    opening: Promise<OpenedHome<T>>;
    lock?: HeldLock;
    lastUsed: number;
    closing?: Promise<void>;
  }
  const entries = new Map<string, Entry>();
  const idleCloseMs = options.idleCloseMs ?? 10 * 60_000;
  let closed = false;

  const openHome = async (id: string): Promise<OpenedHome<T>> => {
    const row = directory.read((db) =>
      db.get<{ data_path: string }>("SELECT data_path FROM home WHERE id = ?", id),
    );
    if (!row) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message: `No hosted home ${id}.` }),
      );
    }
    const homeDir = join(dir, row.data_path);
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    const lock = holdLock(join(homeDir, "home.lock"), options.owner);
    if (!lock) throw locked(`Another process holds the hosted home ${id} (home.lock).`);
    try {
      const opening = openLedger({
        storeDir: join(homeDir, "store"),
        runtimeVersion: options.runtimeVersion,
        owner: options.owner,
        log,
        locking: "normal",
        ...(options.walAutocheckpoint !== undefined
          ? { walAutocheckpoint: options.walAutocheckpoint }
          : {}),
      });
      if (!opening.ok) throw locked(`The hosted home ${id}'s ledger is locked by another process.`);
      const ledger = opening.ledger;
      const incarnation = ledger.write((db) => {
        const meta = db.get<{ incarnation: string }>(
          "SELECT incarnation FROM home_meta WHERE id = 1",
        );
        if (meta) return meta.incarnation;
        const fresh = randomBytes(16).toString("hex");
        db.run(
          "INSERT INTO home_meta (id, incarnation, created_at) VALUES (1, ?, ?)",
          fresh,
          new Date().toISOString(),
        );
        return fresh;
      });
      try {
        const assembled = await options.assembler.assemble({ id, dir: homeDir, ledger });
        const entry = entries.get(id);
        if (entry) entry.lock = lock;
        log.info("server.home_opened", { home: id });
        return { id, dir: homeDir, ledger, incarnation, assembled };
      } catch (error) {
        ledger.close();
        throw error;
      }
    } catch (error) {
      lock.release();
      throw error;
    }
  };

  const closeHome = async (id: string, entry: Entry): Promise<void> => {
    const opened = await entry.opening.catch(() => undefined);
    if (opened) {
      await options.assembler
        .disassemble(opened.assembled)
        .catch((error: unknown) => log.warn("server.home_disassemble_failed", { home: id, error }));
      opened.ledger.close();
    }
    entry.lock?.release();
    entries.delete(id);
    log.info("server.home_closed", { home: id });
  };

  const sweep = setInterval(
    () => {
      const now = Date.now();
      for (const [id, entry] of entries) {
        if (entry.closing || now - entry.lastUsed < idleCloseMs) continue;
        void entry.opening.then(
          (opened) => {
            if (options.assembler.busy(opened.assembled) || entry.closing) return;
            if (Date.now() - entry.lastUsed < idleCloseMs) return;
            entry.closing = closeHome(id, entry);
          },
          () => {
            entries.delete(id);
          },
        );
      }
    },
    Math.min(30_000, Math.max(50, idleCloseMs / 4)),
  );
  sweep.unref();

  return {
    dir,
    directory,
    async home(id) {
      if (closed) throw locked("The server is stopping.");
      for (;;) {
        const entry = entries.get(id);
        if (entry?.closing) {
          await entry.closing;
          continue;
        }
        if (entry) {
          entry.lastUsed = Date.now();
          return entry.opening;
        }
        const fresh: Entry = { opening: openHome(id), lastUsed: Date.now() };
        entries.set(id, fresh);
        fresh.opening.catch(() => {
          if (entries.get(id) === fresh) entries.delete(id);
        });
        return fresh.opening;
      }
    },
    open: () => [...entries.keys()],
    touch(id) {
      const entry = entries.get(id);
      if (entry) entry.lastUsed = Date.now();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      for (const [id, entry] of [...entries]) {
        entry.closing ??= closeHome(id, entry);
        await entry.closing;
      }
      directory.close();
      serverLock.release();
    },
  };
}
