/**
 * Diagnostic codes of the HOME area: the Mostra home, its ledger and the instance that owns it
 * (DATA_MODEL §1, §6; FAILURE_MODEL §2, §3).
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the HOME area, in the order they were added. */
export const homeDiagnosticCodes = [
  "MOSTRA_HOME_LOCKED",
  "MOSTRA_HOME_NOT_OWNED",
  "MOSTRA_HOME_SOCKET_TOO_LONG",
  "MOSTRA_HOME_TOO_NEW",
  "MOSTRA_HOME_LEDGER_UNREADABLE",
  "MOSTRA_HOME_DISK_FULL",
  "MOSTRA_HOME_GONE",
  "MOSTRA_HOME_MISMATCH",
  "MOSTRA_HOME_INTEGRITY",
  // gen:codes
] as const;

/** The codes of the HOME area. */
export type HomeDiagnosticCode = (typeof homeDiagnosticCodes)[number];

/** The HOME area's catalog entries. */
export const homeDiagnostics: AreaCatalog<HomeDiagnosticCode> = {
  MOSTRA_HOME_LOCKED: {
    severity: "error",
    phase: "host",
    title: "Home in use by another instance",
    hint: "Use the instance that already owns this home, or stop it (`mostra daemon stop`, or end the process named in the message) and start again.",
    docs: {
      explanation:
        "One Mostra instance owns a home at a time. It holds an exclusive lock on the home's ledger, and the operating system releases that lock when the process exits. Mostra reports this code in two cases: `mostra host` was started for a home another instance already owns, or a starter found the owner but couldn't reach its control socket. The message names the owner's process ID.",
      fix: "To share the running instance, attach to it: start the client with the same home (`MOSTRA_HOME` or `--home`) instead of starting a second instance. To replace it, stop it with `mostra daemon stop`, or end the process named in the message, and start again. A host that needs its own instance gives it its own home.",
    },
  },
  MOSTRA_HOME_NOT_OWNED: {
    severity: "error",
    phase: "host",
    title: "Directory not owned by you",
    hint: "Choose a home you own with `--home` or `MOSTRA_HOME`, or give the directory named in the message back to your user with `chown`.",
    docs: {
      explanation:
        "Mostra keeps secrets, answers and its ledger in the home, and its control socket in a runtime directory, so it uses only directories that belong to the user running it. It reports this code when the home or the runtime directory is owned by another user, or when the path exists but isn't a directory. Mostra changes nothing in that case.",
      fix: "Point Mostra at a directory you own: `--home <dir>` or `MOSTRA_HOME` for the home, `MOSTRA_RUNTIME_DIR` for the runtime directory. If the directory should be yours, change its owner with `chown`. Mostra tightens a directory you own to mode 0700 by itself.",
    },
  },
  MOSTRA_HOME_SOCKET_TOO_LONG: {
    severity: "error",
    phase: "host",
    title: "Control socket path too long",
    hint: "Set `MOSTRA_RUNTIME_DIR` to a short directory you own, for example `/tmp/mostra-$USER`, and start again.",
    docs: {
      explanation:
        "Clients reach an instance through a Unix socket in a per-user runtime directory. The operating system limits a socket path to 103 bytes on macOS and 107 on Linux, and the path Mostra computed is longer, usually because the home directory's path is long. Mostra stops instead of using a different place that clients couldn't find.",
      fix: "Set `MOSTRA_RUNTIME_DIR` to a short directory you own, such as `/tmp/mostra-$USER`, in the environment of every Mostra client and host that uses this home. Mostra creates it with mode 0700 and re-creates its socket if a temporary-file cleanup removes it.",
    },
  },
  MOSTRA_HOME_TOO_NEW: {
    severity: "error",
    phase: "host",
    title: "Home written by a newer Mostra",
    hint: "Run a Mostra release at least as new as the one named in the message, or use another home with `--home`.",
    docs: {
      explanation:
        "A newer Mostra migrated this home's ledger to a schema version this runtime doesn't know. Reading it could misinterpret or lose data, so this runtime refuses to open it. The message names the schema version and the release that wrote it.",
      fix: "Upgrade the runtime (or the host or CLI that bundles it) to at least the release named in the message. Mostra never migrates a ledger backwards; to keep an older release, give it a separate home with `--home` or `MOSTRA_HOME`.",
    },
  },
  MOSTRA_HOME_LEDGER_UNREADABLE: {
    severity: "error",
    phase: "host",
    title: "Ledger can't be read",
    hint: "Restore the ledger from the latest `ledger.sqlite.bak-*` backup in the home's `store/` directory, or move the damaged file aside.",
    docs: {
      explanation:
        "The ledger (`store/ledger.sqlite` in the home) holds drafts, submissions, events and the rest of the home's interaction data. Mostra reports this code when the file can't be opened, isn't a SQLite database, isn't a Mostra ledger, or fails SQLite's integrity check. Mostra never replaces an existing ledger with an empty one.",
      fix: "Stop every Mostra process for this home. Copy `store/ledger.sqlite` somewhere safe, then restore the newest `store/ledger.sqlite.bak-<from>-<to>` in its place, or move the damaged file aside to start an empty ledger. Versions, sources and blobs in the home are untouched either way.",
    },
  },
  MOSTRA_HOME_DISK_FULL: {
    severity: "error",
    phase: "host",
    title: "Disk full",
    hint: "Free space on the disk that holds the Mostra home, then retry.",
    docs: {
      explanation:
        "A ledger write failed because the disk holding the home is full. The transaction was rolled back, so nothing partial was saved and nothing that was acknowledged earlier is lost. Viewers keep unsaved edits in their browser until a retry succeeds.",
      fix: "Free space on that disk (`mostra gc` removes unreferenced versions; build caches can be deleted), then retry the operation. Retries with the same request or mutation ID are safe.",
    },
  },
  MOSTRA_HOME_GONE: {
    severity: "error",
    phase: "host",
    title: "Home directory removed",
    hint: "Restore or recreate the home directory, then start Mostra again.",
    docs: {
      explanation:
        "The instance's home directory disappeared or was replaced while the instance was running. Writing anywhere else could split the home's data, so the instance stops accepting requests, stops its child processes and exits.",
      fix: "Put the home back (or choose a new one with `--home` or `MOSTRA_HOME`) and start Mostra again. Clients reconnect and retry their requests by ID.",
    },
  },
  MOSTRA_HOME_MISMATCH: {
    severity: "error",
    phase: "host",
    title: "Instance serves a different home",
    hint: "Connect to the instance for the home you expect, or start it with `--home` set to that home.",
    docs: {
      explanation:
        "A client sent `home.path` in `mostra/initialize`, and it names a different home from the one the instance locked at start-up. The home is chosen when the instance starts (`--home`, then `MOSTRA_HOME`, then the platform default), so `home.path` is a check: it stops a client from writing to a home it didn't mean.",
      fix: "Start the instance with `--home` set to the home the client expects, or connect to the socket of the instance that serves it. Leave `home.path` out to accept whichever home the instance serves.",
    },
  },
  MOSTRA_HOME_INTEGRITY: {
    severity: "error",
    phase: "host",
    title: "Stored version or file damaged",
    hint: "Run `mostra doctor`; publish the artifact again to rebuild a damaged version.",
    docs: {
      explanation:
        "Mostra checks stored versions, source snapshots and blobs against their recorded content digests before using them. This code means a stored object is missing or its content changed after it was written, for example after a disk error or a manual edit inside the home. The message names the object.",
      fix: "Leave files inside the home unchanged. Republishing the artifact from its source writes a fresh version; `mostra doctor` lists other damaged objects.",
    },
  },
  // gen:entries
};
