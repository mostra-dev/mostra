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
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

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
    replace(temporary, this.queueFile, this.#platform);
  }

  #write(settings: TelemetrySettings): void {
    const { installId: _id, ...stored } = settings;
    const temporary = `${this.settingsFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    replace(temporary, this.settingsFile, this.#platform);
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
          // between: try again. After access denied, either a lock Windows was deleting went in
          // between (twelve processes at once keep that happening), or this user can't write the
          // directory and waiting changes nothing (Opus review of WP-W2, finding 2). A file of
          // this process's own tells which, whatever the timing (MT-01: a count of such rounds
          // in a row still gave up under contention).
          if (code === "EEXIST") continue;
          if (!writable(this.dir)) return undefined;
        } else if (next === "broken") continue;
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
   * Takes a crashed owner's lock away (#98). Only one process breaks locks at a time: it holds the
   * break lock while it judges the lock again and removes it. An owner removes only its own lock
   * and every other remover holds the break lock, so the lock judged is the lock removed: no
   * breaker ever moves a live owner's lock aside or brings back one its owner released.
   *
   * The break lock is never removed by anyone but its holder, since removing a file only if it is
   * the one judged can't be done atomically (Opus review of WP-13): break locks are numbered
   * (`telemetry.lock.break.<n>`), the highest is the one in force, and a crashed breaker's is
   * superseded, never removed, by creating the next number exclusively. Two that judged the same
   * one crashed race for the same next number, and one of them wins; one that created a number
   * below a higher one holds nothing. The holder removes the ones below its own, then its own
   * when done. A break lock is crashed by the lock's own rules (older
   * than 10 s with its owner gone, or older than 60 s).
   *
   * Answers `broken` when the caller should try again at once, `absent` when no lock file exists,
   * and `held` when the caller should wait: a live owner's lock, another breaker at work, or a
   * lock that can't be read (on Windows, a lock being deleted).
   */
  #breakStale(): "broken" | "absent" | "held" {
    const judged = judge(this.#lockFile);
    if (judged !== "stale") return judged;
    const dir = dirname(this.#lockFile);
    const prefix = `${basename(this.#lockFile)}.break.`;
    const numbered = (): number[] => {
      try {
        return readdirSync(dir)
          .filter(
            (name) =>
              name.startsWith(prefix) && /^[1-9][0-9]{0,15}$/.test(name.slice(prefix.length)),
          )
          .map((name) => Number(name.slice(prefix.length)))
          .sort((a, b) => a - b);
      } catch {
        return [];
      }
    };
    const file = (n: number): string => join(dir, `${prefix}${n}`);
    const below = numbered();
    const current = below.at(-1);
    if (current !== undefined) {
      // Another breaker is at work, or one crashed at it.
      if (judge(file(current)) !== "stale") return "held";
      pause(breakPauseMs());
    }
    const mine = (current ?? 0) + 1;
    const token = `${process.pid} ${randomUUID()}`;
    try {
      writeFileSync(file(mine), token, { flag: "wx", mode: 0o600 });
    } catch {
      // Another breaker took this number first, or the directory can't be written.
      return "held";
    }
    try {
      // A process that listed before a later number existed may create a lower one: the highest
      // holds, and this one, not the highest, never acts.
      if (numbered().some((n) => n > mine)) return "held";
      // The ones before are superseded: a crashed breaker's, or ones a holder left by crashing.
      for (const n of below) rmSync(file(n), { force: true });
      // Judged again under the break lock: the lock may have gone, or been replaced, meanwhile.
      const now = judge(this.#lockFile);
      if (now !== "stale") return now;
      pause(breakPauseMs());
      rmSync(this.#lockFile, { force: true });
      return "broken";
    } finally {
      rmSync(file(mine), { force: true });
    }
  }
}

/**
 * Whether a lock file may be taken away: `stale` when it is older than 10 s and its owner no
 * longer runs, or older than 60 s whoever it names; `held` while it is younger, its owner runs,
 * or it can't be read; `absent` when there is none. One descriptor reads the age and the
 * contents, so both describe the same file.
 */
function judge(file: string): "stale" | "absent" | "held" {
  let handle: number | undefined;
  try {
    handle = openSync(file, "r");
    const age = Date.now() - fstatSync(handle).mtimeMs;
    if (age <= STALE_LOCK_MS) return "held";
    const seen = readFileSync(handle, "utf8");
    return age <= DEAD_LOCK_MS && ownerAlive(seen) ? "held" : "stale";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "held";
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/**
 * Renames `from` over `to`. Windows refuses to replace a file another process has open, as a
 * process reading the settings outside the lock does, with `EPERM` (MT-01: CI's install-ID race,
 * traced on `windows-latest`); the rename is tried again for up to a second, as the runtime's
 * renames are (D150 item 8), and never turned into a copy.
 */
export function replace(
  from: string,
  to: string,
  platform: string,
  rename: (from: string, to: string) => void = renameSync,
): void {
  const deadline = Date.now() + 1000;
  for (let pause = 5; ; pause = Math.min(pause * 2, 100)) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const shared = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (platform !== "win32" || !shared || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pause);
    }
  }
}

/** Whether this process can create a file in `dir`: a probe of its own, removed at once. */
export function writable(
  dir: string,
  remove: (path: string) => void = (path) => rmSync(path, { force: true }),
): boolean {
  const probe = join(dir, `.probe-${process.pid}-${randomUUID()}`);
  try {
    writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
  } catch {
    return false;
  }
  // The probe was made, so the directory is writable whatever its removal meets: on Windows an
  // antivirus or the indexer may hold the new file for a moment (EBUSY, EPERM), and telemetry never
  // stops a command (D140 item 5; Opus review of MT-01, 8). An empty probe left behind is harmless.
  try {
    remove(probe);
  } catch {
    // Left for the next probe's directory to carry; nothing reads it.
  }
  return true;
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

/**
 * A pause inside a breaker's step, for tests only (`MOSTRA_TEST_LOCK_BREAK_MS`): it widens the
 * window a slow machine opens between judging a lock and acting on it (#98).
 */
const BREAK_PAUSE_VARIABLE = "MOSTRA_TEST_LOCK_BREAK_MS";
function breakPauseMs(): number {
  const value = Number(process.env[BREAK_PAUSE_VARIABLE] ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5_000) : 0;
}
function pause(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
