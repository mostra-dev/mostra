/**
 * Telemetry's files in the CLI's config directory (D140 item 5): `telemetry.json` (the choice,
 * when the notice was shown, when a flush last started), `telemetry-id` (the random install ID)
 * and `telemetry-queue.ndjson` (events waiting to be sent). The directory is 0700 and the files
 * 0600; `telemetry.json` and the queue are written by rename. The install ID is made by an
 * exclusive create (a hard link that fails when the file exists), so processes on a first run
 * agree on one ID whatever happens to the lock. Every other change goes through one lock file,
 * owned by a token and taken over only when its holder has died, so a flusher never loses an
 * event appended while it sends.
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** What `telemetry.json` holds. */
export interface TelemetrySettings {
  /** The person's choice: `mostra telemetry on|off`, or their answer to the question. */
  readonly choice?: "on" | "off";
  /**
   * The random install ID, made on the first run that sends; deleted when telemetry turns off.
   * Read from `telemetry-id`, never written into `telemetry.json`.
   */
  readonly installId?: string;
  /** When the notice (or the question) was shown. */
  readonly noticeShownAt?: string;
  /** When a flush last started. */
  readonly lastFlushAt?: string;
}

/** The settings, or why they can't be read (which means off, D140 item 5). */
export type ReadSettings =
  | { readonly ok: true; readonly settings: TelemetrySettings }
  | { readonly ok: false; readonly file: string };

/** The longest a lock is held before another process takes it over as stale. */
const STALE_LOCK_MS = 10_000;
/** The queue's bounds (D140 item 6). */
export const QUEUE_MAX_EVENTS = 1000;
export const QUEUE_MAX_AGE_MS: number = 7 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Telemetry's files in one config directory. */
export class TelemetryStore {
  readonly dir: string;
  readonly settingsFile: string;
  readonly queueFile: string;
  readonly idFile: string;
  readonly #lockFile: string;

  constructor(dir: string) {
    this.dir = dir;
    this.settingsFile = join(dir, "telemetry.json");
    this.queueFile = join(dir, "telemetry-queue.ndjson");
    this.idFile = join(dir, "telemetry-id");
    this.#lockFile = join(dir, "telemetry.lock");
  }

  /** The settings; a file that isn't telemetry settings is unreadable, never guessed at. */
  read(): ReadSettings {
    const id = this.#readId();
    if (id === null) return { ok: false, file: this.idFile };
    let text: string;
    try {
      text = readFileSync(this.settingsFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { ok: true, settings: id !== undefined ? { installId: id } : {} };
      return { ok: false, file: this.settingsFile };
    }
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error();
      const { choice, noticeShownAt, lastFlushAt } = data;
      const installId = id;
      if (choice !== undefined && choice !== "on" && choice !== "off") throw new Error();
      // An install ID belongs in `telemetry-id`; one here is a file Mostra didn't write.
      if (data["installId"] !== undefined) throw new Error();
      if (noticeShownAt !== undefined && typeof noticeShownAt !== "string") throw new Error();
      if (lastFlushAt !== undefined && typeof lastFlushAt !== "string") throw new Error();
      return {
        ok: true,
        settings: {
          ...(choice !== undefined ? { choice } : {}),
          ...(installId !== undefined ? { installId } : {}),
          ...(noticeShownAt !== undefined ? { noticeShownAt } : {}),
          ...(lastFlushAt !== undefined ? { lastFlushAt } : {}),
        },
      };
    } catch {
      return { ok: false, file: this.settingsFile };
    }
  }

  /**
   * Changes the settings under the lock and returns what they became; `undefined` when the file
   * can't be read (nothing is written over it).
   */
  update(change: (current: TelemetrySettings) => TelemetrySettings): TelemetrySettings | undefined {
    return this.locked(() => {
      const current = this.read();
      if (!current.ok) return undefined;
      const next = change(current.settings);
      this.#write(next);
      return next;
    });
  }

  /**
   * The install ID, made when there is none yet. A new ID is written to a file of this process's
   * own, then hard-linked to `telemetry-id`, which fails when the file exists: of any processes
   * making one at once exactly one wins, and the others read the winner's. `undefined` when the
   * settings can't be read.
   */
  installId(): { readonly id: string; readonly created: boolean } | undefined {
    this.#prepareDir();
    const current = this.read();
    if (!current.ok) return undefined;
    if (current.settings.installId !== undefined)
      return { id: current.settings.installId, created: false };
    const candidate = `${this.idFile}.${process.pid}.${randomUUID()}.tmp`;
    const id = randomUUID();
    writeFileSync(candidate, `${id}\n`, { mode: 0o600 });
    try {
      linkSync(candidate, this.idFile);
      return { id, created: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
      const winner = this.#readId();
      return winner ? { id: winner, created: false } : undefined;
    } finally {
      rmSync(candidate, { force: true });
    }
  }

  /** The install ID in `telemetry-id`: `undefined` when there is none, `null` when it's damaged. */
  #readId(): string | undefined | null {
    let text: string;
    try {
      text = readFileSync(this.idFile, "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
    }
    const id = text.trim();
    return UUID.test(id) ? id : null;
  }

  /**
   * Replaces a file that can't be read with these settings; only `telemetry on|off` do, as the
   * person's explicit choice. Call it holding the lock.
   */
  reset(settings: TelemetrySettings): TelemetrySettings {
    const { installId: _id, ...rest } = settings;
    this.#write(rest);
    // A damaged install ID goes too; `on` makes a new one on its first send.
    rmSync(this.idFile, { force: true });
    if (settings.choice === "off") rmSync(this.queueFile, { force: true });
    return rest;
  }

  /** Turns telemetry off: the choice, and the install ID and the queue deleted at once. */
  turnOff(): boolean {
    return (
      this.locked(() => {
        const current = this.read();
        if (!current.ok) return false;
        const { installId: _id, ...rest } = current.settings;
        this.#write({ ...rest, choice: "off" });
        rmSync(this.idFile, { force: true });
        rmSync(this.queueFile, { force: true });
        return true;
      }) ?? false
    );
  }

  /** Appends events to the queue, keeping its bounds. */
  append(lines: readonly string[], now: number): void {
    if (lines.length === 0) return;
    this.locked(() => {
      const kept = bounded([...this.#queued(), ...lines], now);
      this.#writeQueue(kept);
    });
  }

  /** The queued events, within their bounds. */
  queued(now: number): string[] {
    return bounded(this.#queued(), now);
  }

  /** Removes the first `count` queued lines, which a flush sent. */
  drop(sent: readonly string[]): void {
    this.locked(() => {
      const queued = this.#queued();
      let index = 0;
      while (index < sent.length && queued[index] === sent[index]) index += 1;
      this.#writeQueue(queued.slice(index));
    });
  }

  #queued(): string[] {
    try {
      return readFileSync(this.queueFile, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }

  #writeQueue(lines: readonly string[]): void {
    if (lines.length === 0) {
      rmSync(this.queueFile, { force: true });
      return;
    }
    const temporary = `${this.queueFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o600 });
    renameSync(temporary, this.queueFile);
  }

  #write(settings: TelemetrySettings): void {
    const { installId: _id, ...stored } = settings;
    const temporary = `${this.settingsFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.settingsFile);
  }

  #prepareDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(this.dir, 0o700);
    } catch {
      // A directory someone else owns: the files below fail or succeed on their own terms.
    }
  }

  /**
   * Runs `fn` holding the lock file; `undefined` when the lock can't be had within 2 s. The lock
   * holds its owner's PID and a token of its own, is released only by its owner, and is taken
   * over only when it is older than 10 s and its owner is no longer running (a crash).
   */
  locked<T>(fn: () => T): T | undefined {
    this.#prepareDir();
    const token = `${process.pid} ${randomUUID()}`;
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        writeFileSync(this.#lockFile, token, { flag: "wx", mode: 0o600 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
        if (this.#breakStale()) continue;
        if (Date.now() > deadline) return undefined;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      return fn();
    } finally {
      this.#release(token);
    }
  }

  /** Removes the lock when it is still this owner's. */
  #release(token: string): void {
    try {
      if (readFileSync(this.#lockFile, "utf8") === token) rmSync(this.#lockFile, { force: true });
    } catch {
      // Gone already.
    }
  }

  /**
   * Takes a crashed owner's lock away; `true` when the caller should try again at once. The lock
   * is moved aside under a name of this process's own (a rename is atomic, so of two processes
   * breaking it one gets it), and a lock that turns out to be another, live owner's goes back.
   */
  #breakStale(): boolean {
    let seen: string;
    try {
      if (Date.now() - statSync(this.#lockFile).mtimeMs <= STALE_LOCK_MS) return false;
      seen = readFileSync(this.#lockFile, "utf8");
    } catch {
      return true;
    }
    if (ownerAlive(seen)) return false;
    const aside = `${this.#lockFile}.${process.pid}.${randomUUID()}.stale`;
    try {
      renameSync(this.#lockFile, aside);
    } catch {
      return true;
    }
    try {
      if (readFileSync(aside, "utf8") !== seen) linkSync(aside, this.#lockFile);
    } catch {
      // Another process holds a new lock already; ours goes, and the caller waits for theirs.
    } finally {
      rmSync(aside, { force: true });
    }
    return true;
  }
}

/** Whether the process a lock names still runs; a lock whose owner can't be read counts as live. */
function ownerAlive(lock: string): boolean {
  const pid = Number(lock.split(" ")[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The newest events within 1,000, none older than 7 days; lines that aren't JSON go. */
function bounded(lines: readonly string[], now: number): string[] {
  const fresh = lines.filter((line) => {
    try {
      const at = Date.parse((JSON.parse(line) as { at?: string }).at ?? "");
      return Number.isFinite(at) && now - at <= QUEUE_MAX_AGE_MS;
    } catch {
      return false;
    }
  });
  return fresh.slice(-QUEUE_MAX_EVENTS);
}
