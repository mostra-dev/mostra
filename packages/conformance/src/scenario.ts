/**
 * Scenarios and what they get to work with. A scenario is one property a host integration must
 * have, checked through the host's own client and ports (the harness) and a viewer playing the
 * browser. Each runs against a fresh home in its own directory, with a fresh host shim.
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDiagnostic,
  type EventRecord,
  encodeLine,
  HOST_PROTOCOL_REVISIONS,
  LineSplitter,
  type Results,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { connectControl, resolveRuntime, windowsHelper } from "@mostra/sdk";
import type { Fixture } from "./fixtures.ts";
import { HostUnderTest } from "./harness/client.ts";
import type { StartParams, StartResult, StoreResult } from "./harness/protocol.ts";
import { kitVersion } from "./version.ts";
import { Viewer } from "./viewer.ts";

/**
 * The local stand-ins for `tailscale` and `cloudflared` the share scenarios start instances with
 * (`MOSTRA_TEST_TUNNELS`, D158): shipped in the kit's package beside `src` and `dist`.
 */
export const TUNNELS: string = fileURLToPath(new URL("../tunnels/", import.meta.url));

/** A scenario: one property of a host integration, with the requirements it covers. */
export interface Scenario {
  /** A stable ID, `group.name`: baselines name scenarios by it. */
  readonly id: string;
  /** What it proves, in one sentence. */
  readonly title: string;
  /** The requirements and host needs it exercises (`HO-05`, `IN-12`, `H-03` …). */
  readonly covers: readonly string[];
  /** Harness features without which it doesn't apply (it is then skipped, never failed). */
  readonly needs?: readonly string[];
  /** Runs it; throws a {@link ScenarioFailure} (or any error) when the property doesn't hold. */
  run(context: ScenarioContext): Promise<void>;
}

/** A property that didn't hold. */
export class ScenarioFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioFailure";
  }
}

/** Thrown to say a scenario doesn't apply to this host (a port or feature it lacks). */
export class NotApplicable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotApplicable";
  }
}

/** Fails the scenario with `message` unless `condition` holds. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScenarioFailure(message);
}

/** `value` as JSON with every object's keys sorted, so key order never decides equality. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

/** Fails unless `actual` deep-equals `expected` (JSON comparison, key order aside). */
export function same(actual: unknown, expected: unknown, what: string): void {
  const a = canonical(actual);
  const b = canonical(expected);
  if (a !== b) throw new ScenarioFailure(`${what}: expected ${b}, got ${a}`);
}

/** Options of a run that scenarios see. */
export interface RunSettings {
  /** The host shim's command line. */
  readonly host: string;
  /** Variables for the shim's own process (how it finds its runtime). */
  readonly hostEnv: Readonly<Record<string, string>>;
  /** Publish through verify's gate (needs the verify browser); off, publish skips it, loudly. */
  readonly verify: boolean;
}

/** What a scenario works with: its host, its home, its viewers. */
export class ScenarioContext {
  /** The run's settings. */
  readonly settings: RunSettings;
  /** The scenario's directory: the home, the authoring directories, the runtime directory. */
  readonly dir: string;
  /** The home the host is told to use (HO-08). */
  readonly home: string;
  /** The host: its name and version. */
  host!: HostUnderTest;
  readonly #hosts: HostUnderTest[] = [];
  #published = 0;

  constructor(settings: RunSettings, dir: string) {
    this.settings = settings;
    this.dir = dir;
    this.home = join(dir, "home");
  }

  /** Starts the scenario's host shim (the runner does this before `run`). */
  async open(): Promise<void> {
    this.host = await this.anotherHost();
  }

  /** A second shim of the same host, for scenarios about two hosts of one home. */
  async anotherHost(): Promise<HostUnderTest> {
    const host = await HostUnderTest.start(this.settings.host, this.settings.hostEnv);
    this.#hosts.push(host);
    return host;
  }

  /** The variables every instance of the run gets: its own runtime and config directories. */
  instanceEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
      MOSTRA_RUNTIME_DIR: join(this.dir, "run"),
      MOSTRA_CONFIG_DIR: join(this.dir, "config"),
      ...(this.settings.verify ? {} : { MOSTRA_TEST_UNVERIFIED_PUBLISH: "1" }),
      ...extra,
    };
  }

  /** `harness/start` on this scenario's home. */
  start(
    options: {
      env?: Readonly<Record<string, string>>;
      mode?: StartParams["mode"];
      host?: HostUnderTest;
    } = {},
  ): Promise<StartResult> {
    mkdirSync(join(this.dir, "run"), { recursive: true, mode: 0o700 });
    return (options.host ?? this.host).startInstance({
      home: this.home,
      env: this.instanceEnv(options.env),
      ...(options.mode ? { mode: options.mode } : {}),
    });
  }

  /** Stops the host's instance and starts it again (the same home). */
  async restart(options: { env?: Readonly<Record<string, string>> } = {}): Promise<StartResult> {
    await this.host.stopInstance();
    return this.start(options);
  }

  /** Writes a fixture into a fresh authoring directory and returns the directory. */
  author(fixture: Fixture, name = "artifact"): string {
    this.#published += 1;
    const dir = join(this.dir, "authoring", `${name}-${this.#published}`);
    for (const [path, text] of Object.entries(fixture)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  /** Writes `files` over the authoring directory `dir` (a new version of the same artifact). */
  rewrite(dir: string, fixture: Fixture): void {
    for (const [path, text] of Object.entries(fixture)) writeFileSync(join(dir, path), text);
  }

  /** Publishes `dir` through the host (`artifact/publish`). */
  publish(
    dir: string,
    options: { policy?: unknown; requestId?: string } = {},
  ): Promise<{
    artifactId: string;
    versionId: string;
    version: number;
    url?: string;
    tokenId?: string;
    cursor: string;
  }> {
    return this.host.call("artifact/publish", {
      source: { path: dir },
      ...(options.policy !== undefined ? { policy: options.policy } : {}),
      ...(options.requestId ? { requestId: options.requestId } : {}),
    });
  }

  /** Authors and publishes a fixture; the receipt with its authoring directory. */
  async published(
    fixture: Fixture,
    options: { policy?: unknown } = {},
  ): Promise<{
    artifactId: string;
    versionId: string;
    version: number;
    url?: string;
    tokenId?: string;
    cursor: string;
    dir: string;
  }> {
    const dir = this.author(fixture);
    return { ...(await this.publish(dir, options)), dir };
  }

  /** A new capability link through the host (`view/url`). */
  async link(artifactId: string, params: Record<string, unknown> = {}): Promise<string> {
    const link = await this.host.call<{ url: string }>("view/url", {
      artifact: { artifactId },
      ...params,
    });
    return link.url;
  }

  /** Opens a new link as a viewer. */
  async viewer(
    artifactId: string,
    options: { link?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<Viewer> {
    return Viewer.open(await this.link(artifactId, options.link ?? {}), {
      ...(options.headers ? { headers: options.headers } : {}),
    });
  }

  /** `results/get` through the host. */
  results(artifactId: string, submission?: string): Promise<Results> {
    return this.host.call("results/get", {
      artifact: { artifactId },
      ...(submission ? { submission } : {}),
    });
  }

  /** `events/read` through the host. */
  async events(
    filter: { artifacts?: string[]; types?: string[] },
    after?: string,
  ): Promise<{ events: EventRecord[]; cursor: string }> {
    return this.host.call("events/read", { filter, ...(after ? { after } : {}), limit: 100 });
  }

  /** The host's store. */
  store(): Promise<StoreResult> {
    return this.host.store();
  }

  /** Waits for `condition` to hold, checking every 100 ms; fails with `what` after `timeoutMs`. */
  async eventually<T>(
    what: string,
    condition: () => Promise<T | undefined | false> | T | undefined | false,
    timeoutMs = 30_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await condition();
      if (value !== undefined && value !== false) return value;
      if (Date.now() > deadline) throw new ScenarioFailure(`${what} (waited ${timeoutMs} ms)`);
      await new Promise((done) => setTimeout(done, 100));
    }
  }

  /** Skips the scenario unless the host serves `port`. */
  requirePort(port: string): void {
    if (!this.host.serves(port)) throw new NotApplicable(`the host serves no ${port} port`);
  }

  /** Skips the scenario unless the host supports `feature`. */
  requireFeature(feature: string): void {
    if (!this.host.supports(feature))
      throw new NotApplicable(`the host lacks the ${feature} feature`);
  }

  /** The socket of the home's running instance, from `instance.json` (D81). */
  socket(): string | undefined {
    try {
      const record = JSON.parse(readFileSync(join(this.home, "instance.json"), "utf8")) as {
        socket?: string;
      };
      return record.socket;
    } catch {
      return undefined;
    }
  }

  /** Ends every shim, stops a daemon the scenario left, and removes the directory. */
  async close(): Promise<void> {
    for (const host of this.#hosts) {
      await host.stopInstance().catch(() => undefined);
      await host.close().catch(() => undefined);
    }
    const socket = this.socket();
    if (socket) {
      const session = await connectSocket(socket).catch(() => undefined);
      await session?.peer
        .request("mostra/shutdown", {}, { timeoutMs: 10_000 })
        .catch(() => undefined);
      session?.close();
    }
    await removeTree(this.dir);
  }
}

/**
 * Removes a scenario's directory. A home's versions are sealed read-only (DATA_MODEL §1): on POSIX
 * by mode (files 0444, directories 0555), so directories are made writable first; on Windows by
 * a protected access list (D150 item 3), which only the runtime's helper resets (`mostra-win
 * unseal`, found beside the runtime as every client finds it). Windows also holds a file a process
 * just closed (Defender, the indexer), so removal is retried for a while.
 */
export async function removeTree(dir: string): Promise<void> {
  if (process.platform === "win32") {
    const helper = windowsHelper(await resolveRuntime().catch(() => undefined), process.env);
    await new Promise<void>((done) => {
      const child = spawn(helper, ["unseal", dir], { stdio: "ignore", windowsHide: true });
      child.on("exit", () => done());
      child.on("error", () => done());
    });
  } else {
    const open = (path: string): void => {
      let stats: ReturnType<typeof lstatSync>;
      try {
        stats = lstatSync(path);
      } catch {
        return;
      }
      if (!stats.isDirectory()) return;
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) open(join(path, name));
    };
    open(dir);
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

/** A raw protocol session over the home's socket, opened by the kit itself. */
export interface SocketSession {
  readonly peer: RpcPeer;
  close(): void;
}

/** Connects to an instance's socket and initializes a session as `@mostra/conformance`. */
export async function connectSocket(
  path: string,
  revisions: readonly string[] = HOST_PROTOCOL_REVISIONS,
): Promise<SocketSession & { initialize: Promise<unknown> }> {
  // As every client reaches an instance: on Windows through the helper beside the runtime, which
  // refuses a pipe another user created under the name (D150 item 4).
  const socket = await connectControl(path, {
    runtime: process.platform === "win32" ? await resolveRuntime() : undefined,
  });
  const peer = new RpcPeer({
    send: (message) => {
      if (!socket.destroyed) socket.write(encodeLine(message));
    },
  });
  const lines = new LineSplitter();
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) peer.receiveLine(line);
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () =>
    peer.close(createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", { message: "socket closed" })),
  );
  const initialize = peer.request(
    "mostra/initialize",
    {
      client: { name: "mostra-conformance", version: kitVersion() },
      revisions: [...revisions],
      capabilities: {},
      ports: [],
    },
    { timeoutMs: 10_000 },
  );
  initialize.catch(() => undefined);
  return { peer, initialize, close: () => socket.destroy() };
}

/** The diagnostic code of a rejected request. */
export function rpcCode(error: unknown): string | undefined {
  return error instanceof RpcError ? error.diagnostic.code : undefined;
}
