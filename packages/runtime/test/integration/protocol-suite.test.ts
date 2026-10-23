/**
 * The protocol suite (RT-06, HO-02): the same scenarios against `mostra-runtime host` over stdio
 * and against a client attached to `mostra-runtime daemon` over the home socket. Both transports
 * share one dispatcher, so both must answer identically.
 */
import { existsSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  endpointExists,
  initializeParams,
  type LineClient,
  type RuntimeProcess,
  shutdownDaemon,
  startDaemon,
  startHost,
  type TestHome,
  testHome,
  WINDOWS,
} from "../support.ts";

interface Opened {
  readonly client: LineClient;
  /** The home's real path. */
  readonly home: string;
  readonly mode: "host" | "daemon";
  close(): Promise<void>;
}

interface Transport {
  readonly name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  open(): Promise<Opened>;
}

const stdio: Transport = {
  name: "stdio (mostra-runtime host)",
  async setup() {},
  async teardown() {},
  async open() {
    const home = testHome();
    const host = startHost(home);
    return {
      client: host.client,
      // testHome's root is already a real path; the host creates `home` inside it.
      home: home.home,
      mode: "host",
      async close() {
        host.client.close();
        expect((await host.exited).code).toBe(0);
      },
    };
  },
};

let daemonHome: TestHome;
let daemon: (RuntimeProcess & { status: { socket?: string; pid?: number } }) | undefined;
const socket: Transport = {
  name: "socket (attached to mostra-runtime daemon)",
  async setup() {
    daemonHome = testHome();
    daemon = await startDaemon(daemonHome);
    expect(daemon.status).toMatchObject({ status: "started" });
  },
  async teardown() {
    // Windows has no signals between processes: stop it over the protocol (D87, D150).
    if (WINDOWS) await shutdownDaemon(daemon?.status.socket ?? "");
    else daemon?.child.kill("SIGTERM");
    expect((await daemon?.exited)?.code).toBe(0);
  },
  async open() {
    const client = await connectTo(daemon?.status.socket ?? "");
    return {
      client,
      home: realpathSync(daemonHome.home),
      mode: "daemon",
      async close() {
        client.close();
        await client.closed;
      },
    };
  },
};

describe.each([stdio, socket])("protocol suite over $name", (transport) => {
  beforeAll(() => transport.setup());
  afterAll(() => transport.teardown());

  it("negotiates the newest common revision and describes the instance (HO-02, D84)", async () => {
    const opened = await transport.open();
    const response = await opened.client.call(
      "mostra/initialize",
      initializeParams({
        revisions: ["2025-01-01", "2026-10-10", "2099-12-31", "not-a-revision"],
        capabilities: { notifications: ["events/notify"] },
        ports: ["ai", "someFuturePort"],
        home: { path: opened.home },
      }),
    );
    expect(response.error).toBeUndefined();
    const result = response.result as {
      revision: string;
      instance: { home: string; mode: string; pid: number; platform: string; version: string };
      capabilities: { methods: string[]; notifications: string[]; ports: string[] };
      warnings: { code: string; message: string; severity: string }[];
    };
    expect(result.revision).toBe("2026-10-10");
    expect(result.instance).toMatchObject({ home: opened.home, mode: opened.mode });
    expect(result.instance.platform).toBe(`${process.platform}-${process.arch}`);
    expect(result.capabilities.methods).toEqual(
      expect.arrayContaining([
        "mostra/initialize",
        "mostra/shutdown",
        "instance/status",
        "state/get",
        "state/patch",
        "results/get",
        "wait",
        "events/read",
        "events/subscribe",
        "events/ack",
        "artifact/verify",
      ]),
    );
    // The ports the interaction ledger calls (WP-06, D105) and the notification it sends.
    // WP-07 added the trustedControls port (D108), WP-08 the secrets port (D44), WP-12 the
    // identity port (D143).
    expect(result.capabilities.ports).toEqual([
      "identity",
      "submissions",
      "drafts",
      "trustedControls",
      "secrets",
    ]);
    // WP-09 added verify's progress (D138), WP-10 the dev sessions' events (D140 item 12): each
    // sent only to a client that accepts it.
    expect(result.capabilities.notifications).toEqual([
      "events/notify",
      "artifact/progress",
      "dev/notify",
    ]);
    // Unimplemented ports, the reserved `ai` included, are warnings, never silent (D84, D46).
    expect(result.warnings.map((warning) => [warning.code, warning.severity])).toEqual([
      ["MOSTRA_HOST_PORT_UNSUPPORTED", "warning"],
      ["MOSTRA_HOST_PORT_UNSUPPORTED", "warning"],
    ]);
    expect(result.warnings[0]?.message).toContain("D46");
    await opened.close();
  });

  it("refuses an unsupported revision with MOSTRA_HOST_REVISION_UNSUPPORTED, then accepts a retry", async () => {
    const opened = await transport.open();
    const refused = await opened.client.call(
      "mostra/initialize",
      initializeParams({ revisions: ["2020-01-01"] }),
    );
    expect(refused.error?.code).toBe(-32000);
    expect(refused.error?.data.code).toBe("MOSTRA_HOST_REVISION_UNSUPPORTED");
    expect(refused.error?.data.message).toContain("2026-10-10");
    const retried = await opened.client.call("mostra/initialize", initializeParams());
    expect(retried.error).toBeUndefined();
    await opened.close();
  });

  it("requires mostra/initialize first, and only once", async () => {
    const opened = await transport.open();
    const early = await opened.client.call("instance/status");
    expect(early.error?.data.code).toBe("MOSTRA_HOST_INITIALIZE_ORDER");
    expect(
      (await opened.client.call("mostra/initialize", initializeParams())).error,
    ).toBeUndefined();
    const twice = await opened.client.call("mostra/initialize", initializeParams());
    expect(twice.error?.data.code).toBe("MOSTRA_HOST_INITIALIZE_ORDER");
    await opened.close();
  });

  it("answers malformed traffic with JSON-RPC errors carrying diagnostics", async () => {
    const opened = await transport.open();
    await opened.client.call("mostra/initialize", initializeParams());
    opened.client.sendRaw("{not json");
    const parse = await opened.client.next((message) => message.error?.code === -32700);
    expect(parse).toMatchObject({ id: null, error: { data: { code: "MOSTRA_HOST_MALFORMED" } } });
    opened.client.sendRaw(JSON.stringify([{ jsonrpc: "2.0", id: 99, method: "instance/status" }]));
    const batch = await opened.client.next((message) => message.error?.code === -32600);
    expect(batch).toMatchObject({ id: null, error: { data: { code: "MOSTRA_HOST_MALFORMED" } } });
    expect(batch.error?.message).toContain("Batches");
    const unknown = await opened.client.call("artifact/nothing");
    expect(unknown.error).toMatchObject({
      code: -32601,
      data: { code: "MOSTRA_HOST_METHOD_UNKNOWN" },
    });
    const invalid = await opened.client.call("mostra/initialize", { client: "x" });
    // Already initialized: the order rule answers before the params are read.
    expect(invalid.error?.data.code).toBe("MOSTRA_HOST_INITIALIZE_ORDER");
    // The connection survives every one of these.
    expect((await opened.client.call("instance/status")).error).toBeUndefined();
    await opened.close();
  });

  it("refuses initialize params that don't match the schema with -32602, naming the field", async () => {
    const opened = await transport.open();
    const invalid = await opened.client.call("mostra/initialize", {
      client: { name: "x", version: "1" },
      revisions: "2026-10-10",
    });
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: { code: "MOSTRA_HOST_INVALID_PARAMS" },
    });
    expect(invalid.error?.data.message).toContain("revisions");
    await opened.close();
  });

  it("checks home.path: a different home is MOSTRA_HOME_MISMATCH, the same home through a symlink is accepted", async () => {
    const opened = await transport.open();
    const mismatch = await opened.client.call(
      "mostra/initialize",
      initializeParams({ home: { path: join(opened.home, "elsewhere") } }),
    );
    expect(mismatch.error?.data.code).toBe("MOSTRA_HOME_MISMATCH");
    const link = join(dirname(opened.home), "home-link");
    if (!existsSync(link)) symlinkSync(opened.home, link, "junction");
    const same = await opened.client.call(
      "mostra/initialize",
      initializeParams({ home: { path: link } }),
    );
    expect(same.error).toBeUndefined();
    await opened.close();
  });

  it("reports instance/status: the instance, its socket, its connections and its processes", async () => {
    const opened = await transport.open();
    const init = await opened.client.call("mostra/initialize", initializeParams());
    const status = await opened.client.call("instance/status");
    const result = status.result as {
      instance: unknown;
      socket: string;
      connections: number;
      processes: unknown[];
      startedAt: string;
    };
    expect(result.instance).toEqual((init.result as { instance: unknown }).instance);
    expect(await endpointExists(result.socket)).toBe(true);
    expect(result.connections).toBeGreaterThanOrEqual(1);
    // On Windows the control pipe's helper is the instance's one child (D150).
    expect((result.processes as { kind: string }[]).map((child) => child.kind)).toEqual(
      WINDOWS ? ["control-pipe"] : [],
    );
    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
    await opened.close();
  });
});
