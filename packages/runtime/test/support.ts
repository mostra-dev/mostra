/**
 * Shared test support: temporary directories that are removed after the file's tests, and a
 * line-level host protocol client that speaks to an instance exactly as an SDK would, using only
 * `@mostra/protocol`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { LineSplitter } from "@mostra/protocol";
import { afterAll } from "vitest";
import { helperPath, OS } from "../src/platform/index.ts";

const created: string[] = [];
const closers: (() => void)[] = [];

/**
 * Closes `close`'s resource (a ledger, a database) before this file's temporary directories are
 * removed. Windows refuses to remove a file a process holds open, and Node.js's `rmSync` tries
 * such a file again with backoff before it gives up, so a ledger left open for the life of a file
 * once made its directories' removal pass its hook's limit (MT-02).
 */
export function closeBeforeRemoval(close: () => void): void {
  closers.push(close);
}
/**
 * Keeps the supervisor logs of the test homes in `MOSTRA_TEST_LOG_DIR`, when it is set, before
 * their homes are removed: CI keeps them for failed runs, since an instance's own errors (the cause
 * of a `MOSTRA_HOST_INTERNAL_ERROR`) are written only there.
 */
function keepLogs(dir: string): void {
  const into = process.env["MOSTRA_TEST_LOG_DIR"];
  if (!into) return;
  const visit = (at: string, depth: number): void => {
    if (depth > 3) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.name === "logs" && entry.isDirectory()) {
        const target = join(into, `${basename(dir)}-${depth}-${basename(at)}`);
        try {
          cpSync(path, target, { recursive: true });
        } catch {
          // A log still being written is kept as far as it could be read.
        }
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path, depth + 1);
    }
  };
  visit(dir, 0);
}

afterAll(() => {
  for (const close of closers.splice(0).reverse()) {
    try {
      close();
    } catch {
      // Closed already, or never opened: nothing holds its files.
    }
  }
  removeEvery(created.splice(0), keepLogs, removeAll);
});

/**
 * Keeps each directory's logs and removes it, every one of them before any failure is reported, so
 * one that can't be removed never leaves the others behind with their logs (the Opus review of
 * MT-02); then fails, naming each directory it couldn't remove.
 */
export function removeEvery(
  dirs: readonly string[],
  keep: (dir: string) => void,
  remove: (dir: string) => void,
): void {
  const failed: Error[] = [];
  for (const dir of dirs) {
    keep(dir);
    try {
      remove(dir);
    } catch (error) {
      // Windows refuses to remove a file this process still holds open: a resource a test opened
      // and didn't register with closeBeforeRemoval, which would otherwise make every later
      // removal wait out rmSync's retries (MT-02).
      failed.push(
        new Error(`Couldn't remove ${dir}: something still holds it open`, { cause: error }),
      );
    }
  }
  if (failed.length === 1) throw failed[0];
  if (failed.length > 1) {
    throw new AggregateError(failed, failed.map((error) => error.message).join("; "));
  }
}

/** Whether the tests run on Windows (asked of the platform layer, as the runtime asks it). */
export const WINDOWS: boolean = OS === "win32";

/**
 * How a process the fault points killed (`<point>:crash`) is seen to exit: SIGKILL on POSIX; on
 * Windows `TerminateProcess`, exit code 1, with no signal.
 */
export const KILLED: { code: number | null; signal: string | null } = WINDOWS
  ? { code: 1, signal: null }
  : { code: null, signal: "SIGKILL" };

/**
 * The allow entries of a path's access list on Windows, from the helper's test probe: each
 * entry's SID and access mask. A sealed version's must grant reading only.
 */
export function accessEntries(path: string): { sid: string; mask: number }[] {
  const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
  const out = execFileSync(probe, ["security", path], { encoding: "utf8", windowsHide: true });
  const { result } = JSON.parse(out) as { result: { sddl: string } };
  const dacl = result.sddl.slice(result.sddl.indexOf("D:"));
  const rights: Record<string, number> = {
    FA: 0x1f01ff,
    FR: 0x120089,
    FX: 0x1200a0,
    GA: 0x10000000,
    GR: 0x80000000,
    GX: 0x20000000,
    GW: 0x40000000,
  };
  return [...dacl.matchAll(/\(A;[^;]*;([^;]*);[^;]*;[^;]*;([^)]*)\)/g)].map((match) => {
    const text = match[1] ?? "";
    const mask = text.startsWith("0x")
      ? Number(text)
      : (text.match(/../g) ?? []).reduce((sum, code) => sum | (rights[code] ?? 0xffffffff), 0);
    return { sid: match[2] ?? "", mask };
  });
}

/** What may be written through an access mask: data, appended data, attributes, deletion, the list itself. */
export const WRITE_RIGHTS =
  0x2 | 0x4 | 0x10 | 0x100 | 0x10000 | 0x40000 | 0x80000 | 0x40000000 | 0x10000000;

/**
 * Whether `path` is sealed against its owner's writes: no write bit on POSIX; on Windows no entry
 * of its access list grants a write right (the runners' administrator passes any list through
 * Node.js, so the list itself is what is judged, VERIFIED_FACTS WP-W1).
 */
export function sealedAgainstWrites(path: string): boolean {
  if (!WINDOWS) return (statSync(path).mode & 0o222) === 0;
  return accessEntries(path).every((entry) => (entry.mask & WRITE_RIGHTS) === 0);
}

/** Lifts a version's seal so a test can damage it: modes back on POSIX, the owner's list on Windows. */
export function unsealTree(dir: string): void {
  if (WINDOWS) {
    execFileSync(helperPath(), ["unseal", dir], { stdio: "ignore", windowsHide: true });
    return;
  }
  chmodSync(dir, 0o755);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) unsealTree(path);
    else chmodSync(path, 0o644);
  }
}

/** Removes a tree, including sealed (read-only) version directories. */
export function removeAll(dir: string): void {
  if (WINDOWS) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // A sealed version's access list refuses deletion until its owner resets it.
      execFileSync(helperPath(), ["unseal", dir], { stdio: "ignore", windowsHide: true });
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
    return;
  }
  const unseal = (path: string): void => {
    let entries: Dirent[];
    try {
      chmodSync(path, 0o755);
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory()) unseal(join(path, entry.name));
  };
  unseal(dir);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * A fresh directory, removed after the file's tests. `short` places it under `/tmp`, because
 * macOS limits socket paths to 103 bytes and its `os.tmpdir()` is long (Windows has no such
 * limit: its control endpoint is a pipe). Its real path is the long form on Windows too.
 */
export function tempDir(prefix: string, short = false): string {
  const base = short && !WINDOWS ? "/tmp" : tmpdir();
  const dir = realpathSync.native(mkdtempSync(join(base, `${prefix}-`)));
  created.push(dir);
  return dir;
}

/** The built runtime binary (`pnpm --filter @mostra/runtime build`). */
export const BIN: string = join(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");

/**
 * The version of `name` in the warm set (`packages/warm`, D91) these suites run against, so a
 * check of what a build or a lockfile records follows the warm set when its packages move.
 */
export function warmVersion(name: string): string {
  const manifest = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../warm/node_modules",
    name,
    "package.json",
  );
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

/** A home and a runtime directory for one test. */
export interface TestHome {
  readonly home: string;
  readonly runtimeDir: string;
  /** The environment the binary runs with: the runtime directory, no MOSTRA_HOME and no npm configuration. */
  readonly env: NodeJS.ProcessEnv;
}

export function testHome(): TestHome {
  const root = tempDir("mrt", true);
  const runtimeDir = join(root, "run");
  const { MOSTRA_HOME: _home, ...inherited } = process.env;
  // npm and pnpm put their own configuration (`npm_config_userconfig` naming the developer's
  // ~/.npmrc, among others) into the environment of every script they run; a test home's installs
  // must not depend on it.
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !/^npm_config_/i.test(name)),
  );
  // Suites of other features publish without verify's gate (D138); `verifiedHome` keeps it.
  return {
    home: join(root, "home"),
    runtimeDir,
    env: { ...env, MOSTRA_RUNTIME_DIR: runtimeDir, MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" },
  };
}

/** A test home whose publishes go through verify's gate, as a user's do (D41, D138). */
export function verifiedHome(): TestHome {
  const home = testHome();
  const { MOSTRA_TEST_UNVERIFIED_PUBLISH: _unverified, ...env } = home.env;
  return { ...home, env };
}

/** A message received on a connection. */
export type Message = {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    code: number;
    message: string;
    data: {
      code: string;
      message: string;
      hint?: string;
      location?: unknown;
      fix?: { kind: string; command?: string };
    };
  };
  readonly method?: string;
};

/** A raw newline-delimited JSON-RPC connection. */
export class LineClient {
  readonly #output: Writable;
  readonly #received: Message[] = [];
  readonly #waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  #nextId = 1;
  readonly closed: Promise<void>;

  constructor(input: Readable, output: Writable) {
    this.#output = output;
    const splitter = new LineSplitter();
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as Message;
        const waiter = this.#waiters.findIndex((entry) => entry.match(message));
        if (waiter >= 0) this.#waiters.splice(waiter, 1)[0]?.resolve(message);
        else this.#received.push(message);
      }
    });
    this.closed = new Promise((resolve) => {
      input.once("close", () => resolve());
      input.once("end", () => resolve());
    });
  }

  /** Sends a raw line, exactly as given. */
  sendRaw(line: string): void {
    this.#output.write(`${line}\n`);
  }

  /** Waits for the first message matching `match` (already received or arriving later). */
  next(match: (message: Message) => boolean, timeoutMs = 10_000): Promise<Message> {
    const index = this.#received.findIndex(match);
    if (index >= 0) return Promise.resolve(this.#received.splice(index, 1)[0] as Message);
    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve: (message: Message) => {
          clearTimeout(timer);
          resolve(message);
        },
      };
      // A waiter that timed out leaves the list: left there, it would take the next matching
      // message for a promise nobody awaits any more, and that message would be lost (a host
      // polling for port calls never answered one, WP-W2).
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error("No matching message arrived."));
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  /** Sends a request and waits for its response (builds take seconds, so the default is generous). */
  call(method: string, params?: unknown, timeoutMs = 60_000): Promise<Message> {
    const id = this.#nextId++;
    this.sendRaw(
      JSON.stringify(
        params === undefined
          ? { jsonrpc: "2.0", id, method }
          : { jsonrpc: "2.0", id, method, params },
      ),
    );
    return this.next((message) => message.id === id, timeoutMs);
  }

  close(): void {
    this.#output.end();
  }
}

/** The params of a well-formed `mostra/initialize`. */
export function initializeParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client: { name: "protocol-suite", version: "0" },
    revisions: ["2026-10-10"],
    capabilities: {},
    ports: [],
    ...overrides,
  };
}

/**
 * Whether a control endpoint exists: a socket file on POSIX; on Windows a pipe a client can
 * connect to (a pipe is no file, and it disappears with its server).
 */
export async function endpointExists(path: string): Promise<boolean> {
  if (!WINDOWS) return existsSync(path);
  return new Promise((resolve) => {
    const connection = createConnection(path);
    connection.once("connect", () => {
      connection.destroy();
      resolve(true);
    });
    connection.once("error", () => resolve(false));
  });
}

/**
 * Stops a daemon the way every platform can: `mostra/shutdown` over its socket (D87). (A signal
 * would do on POSIX; Windows has none to send.)
 */
export async function shutdownDaemon(socket: string): Promise<void> {
  const client = await connectTo(socket);
  await client.call("mostra/initialize", initializeParams());
  const response = await client.call("mostra/shutdown");
  if (response.error) throw new Error(`mostra/shutdown failed: ${response.error.message}`);
  await client.closed;
}

/** Connects to a control socket. */
export async function connectTo(socket: string): Promise<LineClient> {
  const connection = createConnection(socket);
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("error", reject);
  });
  return new LineClient(connection, connection);
}

/** A started `mostra-runtime` process. */
export interface RuntimeProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  stderr(): string;
}

/** Starts the binary. */
export function runBin(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  nodeArgs: readonly string[] = [],
  node: string = process.execPath,
): RuntimeProcess {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing: build @mostra/runtime first.`);
  const child = spawn(node, [...nodeArgs, BIN, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, stderr: () => stderr };
}

/** The first stdout line of a `mostra-runtime daemon`, parsed. */
export interface DaemonStatus {
  readonly status: "started" | "attached" | "failed";
  readonly pid?: number;
  readonly home?: string;
  readonly socket?: string;
  readonly reaped?: number;
  readonly diagnostic?: { code: string; message: string; hint?: string };
}

/** Starts `mostra-runtime daemon` and waits for its status line. */
export async function startDaemon(
  testHome: TestHome,
  options: {
    env?: NodeJS.ProcessEnv;
    nodeArgs?: readonly string[];
    args?: readonly string[];
    /** The Node.js to run it on: this process's by default. */
    node?: string;
  } = {},
): Promise<RuntimeProcess & { status: DaemonStatus }> {
  const started = runBin(
    ["daemon", "--home", testHome.home, ...(options.args ?? [])],
    options.env ?? testHome.env,
    options.nodeArgs,
    options.node,
  );
  const status = await new Promise<DaemonStatus>((resolve, reject) => {
    const splitter = new LineSplitter();
    started.child.stdout?.setEncoding("utf8");
    started.child.stdout?.on("data", (chunk: string) => {
      const [line] = splitter.push(chunk);
      if (line !== undefined) resolve(JSON.parse(line) as DaemonStatus);
    });
    // `exit` can come before the last of stdout is read (an attached starter prints its line and
    // exits at once): only the end of stdout means no line is coming. Seen on Linux CI after
    // WP-10's merge, as the CLI's daemon start saw it (its own fix, WP-10).
    started.child.stdout?.on("end", () => {
      void started.exited.then(({ code }) =>
        reject(new Error(`daemon exited (${code}) before a status line: ${started.stderr()}`)),
      );
    });
  });
  return { ...started, status };
}

/** Starts `mostra-runtime host` with a line client on its stdio. */
export function startHost(
  testHome: TestHome,
  options: { env?: NodeJS.ProcessEnv; nodeArgs?: readonly string[] } = {},
) {
  const started = runBin(
    ["host", "--home", testHome.home],
    options.env ?? testHome.env,
    options.nodeArgs,
  );
  const { stdout, stdin } = started.child;
  if (!stdout || !stdin) throw new Error("no stdio");
  return { ...started, client: new LineClient(stdout, stdin) };
}

/** Whether a process with this PID exists. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Polls `condition` until it holds, or fails after `timeoutMs`. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * The TCP addresses a process listens on, from the operating system: `lsof` on macOS, `ss` on
 * Linux, `netstat -ano` on Windows (whose columns are the protocol, the local and foreign
 * addresses, the state and the owning PID).
 */
export function listening(pid: number): string[] {
  if (WINDOWS) {
    const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const v6 = execFileSync("netstat", ["-ano", "-p", "TCPv6"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return `${out}\n${v6}`
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (cols) => cols[0]?.startsWith("TCP") && cols[3] === "LISTENING" && cols[4] === String(pid),
      )
      .map((cols) => cols[1] ?? "");
  }
  if (process.platform === "darwin") {
    const out = execFileSync(
      "lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      {
        encoding: "utf8",
      },
    );
    return out
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1));
  }
  let out: string;
  try {
    out = execFileSync("ss", ["-Hltnp"], { encoding: "utf8" });
  } catch (error) {
    // A machine without iproute2 (a minimal container): the kernel's own tables.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return listeningFromProc(pid);
    throw error;
  }
  return out
    .split("\n")
    .filter((line) => line.includes(`pid=${pid},`))
    .map((line) => line.trim().split(/\s+/)[3] ?? "");
}

/** Linux: the TCP listeners of `pid`, from its descriptors and `/proc/net/tcp{,6}` (proc(5)). */
function listeningFromProc(pid: number): string[] {
  const fds = join("/proc", String(pid), "fd");
  const inodes = new Set<string>();
  for (const fd of readdirSync(fds)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(join(fds, fd)));
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // Closed meanwhile.
    }
  }
  const found: string[] = [];
  for (const [file, v6] of [
    ["/proc/net/tcp", false],
    ["/proc/net/tcp6", true],
  ] as const) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      // local_address, state (0A is LISTEN) and inode, as proc(5) lays them out.
      const [local, state, inode] = [fields[1], fields[3], fields[9]];
      if (!local || state !== "0A" || !inode || !inodes.has(inode)) continue;
      const [hexAddress = "", hexPort = "0"] = local.split(":");
      const port = Number.parseInt(hexPort, 16);
      found.push(`${v6 ? `[${procAddress6(hexAddress)}]` : procAddress4(hexAddress)}:${port}`);
    }
  }
  return found;
}

/** An IPv4 address as /proc/net/tcp writes it: four bytes, little-endian, in hex. */
function procAddress4(hex: string): string {
  const bytes = (hex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  return bytes.reverse().join(".");
}

/** An IPv6 address as /proc/net/tcp6 writes it: four 32-bit words, each little-endian. */
function procAddress6(hex: string): string {
  const words = (hex.match(/.{8}/g) ?? []).map((word) =>
    (word.match(/../g) ?? []).reverse().join(""),
  );
  const groups = (words.join("").match(/.{4}/g) ?? []).map((group) =>
    group.replace(/^0+(?=.)/, ""),
  );
  const text = groups.join(":");
  if (text === "0:0:0:0:0:0:0:0") return "::";
  if (text === "0:0:0:0:0:0:0:1") return "::1";
  return text;
}

/**
 * The command line a process runs: `ps` on POSIX; on Windows its `CommandLine` from CIM (as Task
 * Manager shows it).
 */
export function commandLineOf(pid: number): string {
  if (WINDOWS) {
    // One process's row, by a filtered CIM query, so a process that isn't there is an error
    // naming it, never an empty command line. The whole table took 5 s on Windows x64 and 37 s on
    // arm64, once 55 s on a loaded x64 runner, past the suite's limit; one row takes 0.4 s and
    // 23 s (VERIFIED_FACTS, WP-W3).
    const started = Date.now();
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const row =
      out === ""
        ? undefined
        : (JSON.parse(out) as { ProcessId: number; Name: string; CommandLine: string | null });
    if (!row || row.ProcessId !== pid) {
      throw new Error(
        `No process ${pid} is in the process table (read in ${Date.now() - started} ms; ${alive(pid) ? "it still runs" : "it no longer runs"}).`,
      );
    }
    return row.CommandLine ?? row.Name;
  }
  return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
}

/**
 * Stops a process from running without ending it, or lets it run again: `SIGSTOP` and `SIGCONT`
 * on POSIX; on Windows every thread suspended or resumed, through the helper's test probe.
 */
export function suspendProcess(pid: number, suspend: boolean): void {
  if (!WINDOWS) {
    process.kill(pid, suspend ? "SIGSTOP" : "SIGCONT");
    return;
  }
  const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
  execFileSync(probe, [suspend ? "suspend" : "resume", String(pid)], {
    encoding: "utf8",
    windowsHide: true,
  });
}

/** What another local user could do with a path (`mostra-win-probe as-user`). */
export interface Opened {
  readonly path: string;
  readonly read: boolean;
  readonly readWrite: boolean;
}

/**
 * Windows: opens each `kind:path` (`file`, `dir`, `pipe`, `mkdir`) as the second local user the CI
 * leg creates, through the helper's probe. A missing user is a failure, never a skip
 * (docs/agents/run-on-windows.md).
 */
export function asOtherUser(...targets: string[]): Opened[] {
  const user = process.env["MOSTRA_TEST_OTHER_USER"];
  const password = process.env["MOSTRA_TEST_OTHER_PASSWORD"];
  if (!user || !password) {
    throw new Error("Set MOSTRA_TEST_OTHER_USER and MOSTRA_TEST_OTHER_PASSWORD (the CI leg does).");
  }
  const probe = join(dirname(helperPath()), "mostra-win-probe.exe");
  const out = execFileSync(probe, ["as-user", user, password, ...targets], { encoding: "utf8" });
  const answer = JSON.parse(out) as { ok: boolean; result?: Opened[]; error?: unknown };
  if (!answer.ok || !answer.result) throw new Error(`probe failed: ${out}`);
  return answer.result;
}

/** Windows: the SID (`S-1-5-21-…`) of the user the tests run as, from the helper. */
export function currentUserSid(): string {
  const out = execFileSync(helperPath(), ["whoami"], { encoding: "utf8", windowsHide: true });
  return (JSON.parse(out) as { result: { user: string } }).result.user;
}

/**
 * Every process below `pid`, with its command line. On Windows the tree comes from the helper's
 * `processes` (a process snapshot: milliseconds), a child counted only when created after its
 * parent, since a parent PID can name a later process; only those processes' command lines are
 * then read, in one filtered CIM query, instead of the whole table (5 s on Windows x64 and 37 s
 * on arm64 in WP-W3's probe). A process that exits meanwhile is left out, as the table would.
 */
export function descendantsOf(pid: number): { pid: number; command: string }[] {
  if (!WINDOWS) {
    const rows = processTable();
    const found: { pid: number; command: string }[] = [];
    const queue = [pid];
    while (queue.length > 0) {
      const parent = queue.shift();
      for (const row of rows) {
        if (row.ppid === parent) {
          found.push({ pid: row.pid, command: row.command });
          queue.push(row.pid);
        }
      }
    }
    return found;
  }
  const listed = JSON.parse(
    execFileSync(helperPath(), ["processes"], { encoding: "utf8", windowsHide: true }),
  ) as { result: { pid: number; ppid?: number; startTime?: string }[] };
  const born = (time: string | undefined): bigint | undefined =>
    time?.startsWith("win/") ? BigInt(time.slice(4)) : undefined;
  const rows = listed.result;
  const top = born(rows.find((row) => row.pid === pid)?.startTime);
  if (top === undefined) return [];
  const below: number[] = [];
  const queue: [number, bigint][] = [[pid, top]];
  while (queue.length > 0) {
    const [parent, parentBorn] = queue.shift() as [number, bigint];
    for (const row of rows) {
      const at = born(row.startTime);
      if (row.ppid !== parent || at === undefined || at < parentBorn || below.includes(row.pid))
        continue;
      below.push(row.pid);
      queue.push([row.pid, at]);
    }
  }
  if (below.length === 0) return [];
  const filter = below.map((id) => `ProcessId = ${Number(id)}`).join(" OR ");
  const out = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `@(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,Name,CommandLine) | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const found = (out === "" ? [] : [JSON.parse(out)].flat()) as {
    ProcessId: number;
    Name: string;
    CommandLine: string | null;
  }[];
  return below.flatMap((id) => {
    const row = found.find((entry) => entry.ProcessId === id);
    return row ? [{ pid: id, command: row.CommandLine ?? row.Name }] : [];
  });
}

/** Every process's ID, parent and command line: `ps` on POSIX, CIM's `Win32_Process` on Windows. */
function processTable(): { pid: number; ppid: number; command: string }[] {
  if (WINDOWS) {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
    const rows = JSON.parse(out) as {
      ProcessId: number;
      ParentProcessId: number;
      Name: string;
      CommandLine: string | null;
    }[];
    return rows.map((row) => ({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      command: row.CommandLine ?? row.Name,
    }));
  }
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }))
    .filter((row) => row.command !== "ps -A -o pid=,ppid=,command=");
}
