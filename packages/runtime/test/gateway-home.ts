/**
 * Shared set-up for the suites that drive the gateway: a real `mostra-runtime daemon` on a test
 * home, a protocol client, and helpers to publish fixtures and mint links.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
  WINDOWS,
} from "./support.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/artifacts/", import.meta.url));

/** A receipt as `artifact/publish` returns it. */
export interface Receipt {
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  readonly url: string;
  readonly tokenId: string;
  readonly reused: boolean;
}

/** A link as `view/url` and `view/rotate` return it. */
export interface MintedLink {
  readonly url: string;
  readonly tokenId: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
}

/** The result of a call, or a thrown error naming the diagnostic. */
export function ok<T>(message: Message): T {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result as T;
}

/** The diagnostic code of a refused call. */
export function refused(message: Message): string {
  if (!message.error) throw new Error("the call succeeded");
  return message.error.data.code as string;
}

/** A running daemon on a test home, with a client. */
export class GatewayHome {
  readonly home: TestHome;
  daemon!: RuntimeProcess & { status: DaemonStatus };
  client!: LineClient;

  constructor(home: TestHome = testHome()) {
    this.home = home;
  }

  /** Starts (or restarts) the daemon, with extra arguments and environment. */
  async start(
    options: { args?: readonly string[]; env?: NodeJS.ProcessEnv; node?: string } = {},
  ): Promise<this> {
    const env = { ...this.home.env, ...options.env };
    this.daemon = await startDaemon(this.home, {
      env,
      ...(options.args ? { args: options.args } : {}),
      ...(options.node ? { node: options.node } : {}),
    });
    if (this.daemon.status.status !== "started") {
      throw new Error(`daemon ${this.daemon.status.status}: ${JSON.stringify(this.daemon.status)}`);
    }
    this.client = await connectTo(this.daemon.status.socket as string);
    ok(await this.client.call("mostra/initialize", initializeParams()));
    return this;
  }

  /** Stops the daemon and waits for it to exit. */
  async stop(): Promise<void> {
    if (this.daemon && this.daemon.child.exitCode === null) {
      if (WINDOWS) {
        // Windows has no signal that asks a process to stop: the daemon stops over the protocol,
        // as `mostra daemon stop` stops it (D87, D150 item 6); a kill only if it doesn't.
        await this.client?.call("mostra/shutdown", {}, 15_000).catch(() => undefined);
        const timer = setTimeout(() => this.daemon.child.kill(), 20_000);
        await this.daemon.exited;
        clearTimeout(timer);
      } else {
        this.client?.close();
        this.daemon.child.kill("SIGTERM");
        await this.daemon.exited;
      }
    }
    this.client?.close();
  }

  /** Copies a fixture and publishes it. */
  async publish(fixture: string, entry = ""): Promise<Receipt & { dir: string }> {
    const dir = join(tempDir(`gw-${fixture}`), fixture);
    cpSync(join(FIXTURES, fixture), dir, { recursive: true });
    const receipt = ok<Receipt>(
      await this.client.call(
        "artifact/publish",
        { source: { path: entry ? join(dir, entry) : dir } },
        120_000,
      ),
    );
    return { ...receipt, dir };
  }

  /** Mints a link through `view/url`. */
  async link(artifactId: string, params: Record<string, unknown> = {}): Promise<MintedLink> {
    return ok<MintedLink>(
      await this.client.call("view/url", { artifact: { artifactId }, ...params }),
    );
  }

  /** `instance/status`. */
  async status(): Promise<{
    gateway: { bind: string; shell: string; artifacts: { artifactId: string; origin: string }[] };
    processes: unknown[];
  }> {
    return ok(await this.client.call("instance/status", {}));
  }
}
