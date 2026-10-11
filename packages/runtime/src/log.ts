/**
 * The supervisor's log: JSON lines in `<home>/logs/supervisor.log`, rotated by size (DATA_MODEL
 * §1). Every module receives a {@link Log} and writes structured events; nothing here formats
 * for people. Messages never carry secrets or capability tokens (STANDARDS security).
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** Structured fields of one log event. Values must be JSON-serializable. */
export type LogFields = Readonly<Record<string, unknown>>;

/** Where modules write what happened. */
export interface Log {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** A log that drops everything, for code paths that run before a home exists. */
export const silentLog: Log = { info() {}, warn() {}, error() {} };

/** Options for {@link openFileLog}. */
export interface FileLogOptions {
  /** The directory (`<home>/logs`), created with mode 0700. */
  readonly dir: string;
  /** Rotate when the file reaches this size. Default 10 MiB. */
  readonly maxBytes?: number;
  /** How many rotated files to keep (`supervisor.log.1` …). Default 3. */
  readonly keep?: number;
  /** Also mirrors warnings and errors here, such as stderr. */
  readonly mirror?: (line: string) => void;
}

/**
 * Opens the supervisor's file log. Writes are synchronous appends, so the last lines before a
 * crash are on disk. A write that fails (the home was removed) is dropped; the log never throws.
 */
export function openFileLog(options: FileLogOptions): Log {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const keep = options.keep ?? 3;
  const file = join(options.dir, "supervisor.log");
  let size = 0;
  try {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    size = statSync(file).size;
  } catch {
    size = 0;
  }

  const rotate = (): void => {
    for (let index = keep - 1; index >= 1; index--) {
      try {
        renameSync(`${file}.${index}`, `${file}.${index + 1}`);
      } catch {
        // The older file doesn't exist yet.
      }
    }
    try {
      renameSync(file, `${file}.1`);
    } catch {
      // Nothing to rotate.
    }
    size = 0;
  };

  const write = (level: "info" | "warn" | "error", event: string, fields?: LogFields): void => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), level, pid: process.pid, event, ...fields }, replacer)}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (size + bytes > maxBytes) rotate();
      appendFileSync(file, line, { mode: 0o600 });
      size += bytes;
    } catch {
      // The log must never take the supervisor down.
    }
    if (level !== "info") options.mirror?.(line);
  };

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

/** Serializes errors as their name, message and stack instead of `{}`. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

/** Environment variables, as `process.env` holds them. */
export type Environment = Readonly<Record<string, string | undefined>>;
