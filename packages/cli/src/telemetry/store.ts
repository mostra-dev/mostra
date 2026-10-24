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
  closeSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** What `telemetry.json` holds. */
export interface TelemetrySettings {
  /** The person's choice: `mostra telemetry on|off`, or their answer to the question. */
  readonly choice?: "on" | "off";
  /**
   * The random install ID, made on the first run that sends; deleted when telemetry turns off.
   * Read from `telemetry-id`, never written into `telemetry.json`.
   */
  readonly installId?: string;
  /**
   * When the notice of what is sent was shown where sending follows: the default notice, the
   * question, or `mostra telemetry on`'s. A `default`-consent event needs it (Opus review
   * finding 3).
   */
  readonly noticeShownAt?: string;
  /**
   * When the ask-first notice ("Nothing is sent unless you run: mostra telemetry on") was
   * shown. It never stands for the default notice: a later run where telemetry is on by default
   * still shows that one before anything is sent.
   */
  readonly askFirstNoticeShownAt?: string;
  /** When a flush last started. */
  readonly lastFlushAt?: string;
}

/** The settings, or why they can't be read (which means off, D140 item 5). */
export type ReadSettings =
  | { readonly ok: true; readonly settings: TelemetrySettings }
  | { readonly ok: false; readonly file: string };

/** A lock older than this whose owner no longer runs is taken over as stale. */
const STALE_LOCK_MS = 10_000;
/**
 * A lock older than this is taken over whoever it names: a held section takes milliseconds, and
 * a PID can name an unrelated live process once the owner died (in a container, PID 1 always
 * runs), which would otherwise hold every later command up forever (Opus review finding 5).
 */
const DEAD_LOCK_MS = 60_000;
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
  readonly #platform: string;

  /** `platform` is the system whose lock rules apply: this process's, but for tests. */
  constructor(dir: string, platform: string = process.platform) {
    this.dir = dir;
    this.#platform = platform;
    this.settingsFile = join(dir, "telemetry.json");
    this.queueFile = join(dir, "telemetry-queue.ndjson");
    this.idFile = join(dir, "telemetry-id");
    this.#lockFile = join(dir, "telemetry.lock");
  }

  /** The settings; a file that isn't telemetry settings is unreadable, never guessed at. */
  read(): ReadSettings {
    // A directory that can never exist (a part of its path is a file) is unreadable, never
    // "nothing stored yet". POSIX says so for every read (ENOTDIR); Windows answers ENOENT, which
    // would read as the default, on, though nothing could ever be recorded (WP-W2).
    if (blocked(this.dir)) return { ok: false, file: this.dir };
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
      const { choice, noticeShownAt, askFirstNoticeShownAt, lastFlushAt } = data;
      const installId = id;
      if (choice !== undefined && choice !== "on" && choice !== "off") throw new Error();
      // An install ID belongs in `telemetry-id`; one here is a file Mostra didn't write.
      if (data["installId"] !== undefined) throw new Error();
      if (noticeShownAt !== undefined && typeof noticeShownAt !== "string") throw new Error();
      if (askFirstNoticeShownAt !== undefined && typeof askFirstNoticeShownAt !== "string")
        throw new Error();
      if (lastFlushAt !== undefined && typeof lastFlushAt !== "string") throw new Error();
      return {
        ok: true,
        settings: {
          ...(choice !== undefined ? { choice } : {}),
          ...(installId !== undefined ? { installId } : {}),
          ...(noticeShownAt !== undefined ? { noticeShownAt } : {}),
          ...(askFirstNoticeShownAt !== undefined ? { askFirstNoticeShownAt } : {}),
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
    const current = this.read();
    if (!current.ok) return undefined;
    if (current.settings.installId !== undefined)
      return { id: current.settings.installId, created: false };
    const candidate = `${this.idFile}.${process.pid}.${randomUUID()}.tmp`;
    const id = randomUUID();
    try {
      this.#prepareDir();
      writeFileSync(candidate, `${id}\n`, { mode: 0o600 });
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

  /**
   * Removes the lines a flush sent from the head of the queue, after pruning what expired or
   * fell outside the bounds, as {@link queued} did; how many sent lines were removed (0 when the
   * lock can't be had). A flusher stops when this is 0, so it never sends a batch twice.
   */
  drop(sent: readonly string[], now: number): number {
    return (
      this.locked(() => {
        const queued = bounded(this.#queued(), now);
        let index = 0;
        while (index < sent.length && queued[index] === sent[index]) index += 1;
        this.#writeQueue(queued.slice(index));
        return index;
      }) ?? 0
    );
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
    // Windows has no modes: the directory keeps the access list `%APPDATA%` hands down.
    if (this.#platform === "win32") return;
    try {
      chmodSync(this.dir, 0o700);
    } catch {
      // A directory someone else owns: the files below fail or succeed on their own terms.
    }
  }

  /**
   * Runs `fn` holding the lock file; `undefined` when the lock can't be had within 2 s, or the
   * directory or a file in it can't be written (a full disk, a directory someone else owns):
   * telemetry never stops a command (D140 item 5). The lock
   * holds its owner's PID and a token of its own, is released only by its owner, and is taken
   * over when it is older than 10 s and its owner is no longer running (a crash), or older than
   * 60 s whoever it names.
   */
  locked<T>(fn: () => T): T | undefined {
    try {
      this.#prepareDir();
    } catch {
      return undefined;
    }
    const token = `${process.pid} ${randomUUID()}`;
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        writeFileSync(this.#lockFile, token, { flag: "wx", mode: 0o600 });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!held(code, this.#platform)) return undefined;
        // Every path back to the create checks the deadline, so nothing can hold the CLI here
        // (GPT review of WP-W2), and only a lock that just went is tried again without a pause,
        // so nothing spins either (Opus review of WP-W2, finding 2).
        if (Date.now() > deadline) return undefined;
        const next = this.#breakStale();
        if (next === "absent") {
          // No lock there, though the create was refused. After `EEXIST` it was removed in
          // between: try again. After access denied there was none to contend with (a lock
          // Windows is still deleting can't be opened either, which isn't "absent"): this user
          // can't write the directory, and waiting changes nothing.
          if (code === "EEXIST") continue;
          return undefined;
        }
        if (next === "broken") continue;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      return fn();
    } catch {
      return undefined;
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
   * Takes a crashed owner's lock away. The lock is moved aside under a name of this process's own
   * (a rename is atomic, so of two processes breaking it one gets it), and a lock that turns out
   * to be another, live owner's goes back. Answers `broken` when the caller should try again at
   * once, `absent` when no lock file exists, and `held` when the caller should wait: a live
   * owner's lock, or one that can't be read (on Windows, a lock being deleted).
   */
  #breakStale(): "broken" | "absent" | "held" {
    // One descriptor for the age and the contents, so both describe the same file.
    let seen: string;
    let age: number;
    let handle: number | undefined;
    try {
      handle = openSync(this.#lockFile, "r");
      age = Date.now() - fstatSync(handle).mtimeMs;
      if (age <= STALE_LOCK_MS) return "held";
      seen = readFileSync(handle, "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "held";
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
    if (age <= DEAD_LOCK_MS && ownerAlive(seen)) return "held";
    const aside = `${this.#lockFile}.${process.pid}.${randomUUID()}.stale`;
    try {
      renameSync(this.#lockFile, aside);
    } catch (error) {
      // Another breaker moved it first: try for it at once; anything else, wait.
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "broken" : "held";
    }
    try {
      if (readFileSync(aside, "utf8") !== seen) linkSync(aside, this.#lockFile);
    } catch {
      // Another process holds a new lock already; ours goes, and the caller waits for theirs.
    } finally {
      rmSync(aside, { force: true });
    }
    return "broken";
  }
}

/**
 * Whether a lock's exclusive create failed because another process holds it. On Windows a lock
 * its owner just removed stays "delete pending" while anyone still has it open (another process
 * judging its age), and creating it again meanwhile is refused as access denied, not `EEXIST`
 * (WP-W2: twelve first runs at once on an arm64 runner): that is contention too, never a reason
 * to give up.
 */
function held(code: string | undefined, platform: string): boolean {
  return code === "EEXIST" || (platform === "win32" && (code === "EPERM" || code === "EACCES"));
}

/** Whether `dir` can never be created: its nearest existing ancestor isn't a directory. */
function blocked(dir: string): boolean {
  for (let path = dir; ; path = dirname(path)) {
    try {
      return !statSync(path).isDirectory();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTDIR") return true;
      if (code !== "ENOENT") return false;
    }
    if (dirname(path) === path) return false;
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
