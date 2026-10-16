/**
 * The supervisor's log: JSON lines in `<home>/logs/supervisor.log`, rotated by size (DATA_MODEL
 * §1). Every module receives a {@link Log} and writes structured events; nothing here formats
 * for people. Every string written passes through the instance's {@link Redactor}, so secrets and
 * capability tokens never reach the file or its mirror (STANDARDS security).
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

/** What replaces a redacted value. */
export const REDACTED = "[redacted]";

/** Query and fragment parameters that carry capability material in Mostra URLs. */
const CAPABILITY_PARAMS = /([?#&](?:t|token|ticket|capability)=)[^&#\s"']+/gi;

/** Environment variable names whose values are treated as secrets. */
const SECRET_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|AUTH/i;

/** The shortest value worth redacting; shorter ones would mangle ordinary text. */
const MIN_SECRET_LENGTH = 8;

/** The shortest named secret redacted (`mostra secret set`). */
const MIN_NAMED_SECRET_LENGTH = 4;

/**
 * Removes secrets and capability material from text before it is logged or reported: values the
 * instance registered (secrets it hands to children, token secrets) and the token parameters of
 * capability URLs.
 */
export class Redactor {
  readonly #values = new Set<string>();

  /** Registers a value that must never appear in logs or reports. Short values are ignored. */
  protect(value: string): void {
    if (value.length >= MIN_SECRET_LENGTH) this.#values.add(value);
  }

  /**
   * Registers a named secret's value (D44): one a person set on purpose, so it is protected from
   * 4 characters on; a shorter one would match ordinary text everywhere.
   */
  protectSecret(value: string): void {
    if (value.length < MIN_NAMED_SECRET_LENGTH) return;
    this.#values.add(value);
    // As it appears inside JSON text (an event payload, a log line), escapes and all.
    const escaped = JSON.stringify(value).slice(1, -1);
    if (escaped !== value) this.#values.add(escaped);
  }

  /** Registers the values of variables whose names look like secrets (`*_TOKEN`, `*_SECRET` …). */
  protectEnvironment(env: Environment): void {
    for (const [name, value] of Object.entries(env)) {
      if (value !== undefined && SECRET_NAME.test(name)) this.protect(value);
    }
  }

  /** Returns `text` with every registered value and capability parameter replaced. */
  redact(text: string): string {
    let result = text.replace(CAPABILITY_PARAMS, `$1${REDACTED}`);
    // Longest first, so a secret that contains another is replaced whole.
    for (const value of [...this.#values].sort((a, b) => b.length - a.length)) {
      if (result.includes(value)) result = result.split(value).join(REDACTED);
    }
    return result;
  }
}

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
  /** Applied to every string field. Default: a redactor for capability parameters only. */
  readonly redactor?: Redactor;
}

/**
 * Opens the supervisor's file log. Writes are synchronous appends, so the last lines before a
 * crash are on disk. A write that fails (the home was removed) is dropped; the log never throws.
 */
export function openFileLog(options: FileLogOptions): Log {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const keep = options.keep ?? 3;
  const redactor = options.redactor ?? new Redactor();
  const replacer = (_key: string, value: unknown): unknown => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactor.redact(value.message),
        stack: value.stack && redactor.redact(value.stack),
      };
    }
    return typeof value === "string" ? redactor.redact(value) : value;
  };
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

/** Environment variables, as `process.env` holds them. */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * `value` with every string in it, keys too, passed through `redactor`: what server code hands to
 * Mostra (results, state, live values) never carries a secret Mostra knows (D44, AC-06).
 */
export function redactValue<T>(value: T, redactor: { redact(text: string): string }): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redactor.redact(item);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [redactor.redact(key), walk(entry)]),
      );
    }
    return item;
  };
  return walk(value) as T;
}
