import { createConnection } from "node:net";
import { join } from "node:path";
import {
  encodeLine,
  LineSplitter,
  type MostraInitializeParams,
  mostraInitializeMethod,
  Revision,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { silentLog } from "../../src/log.ts";
import { ProtocolServer } from "../../src/protocol-server/index.ts";
import { tempDir } from "../support.ts";

const servers: ProtocolServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function serve(options: { revisions?: readonly string[]; ports?: readonly string[] } = {}) {
  const dir = tempDir("mps");
  const server = new ProtocolServer({
    log: silentLog,
    describe: () => ({
      version: "0.0.0",
      home: dir,
      platform: "test",
      pid: process.pid,
      mode: "daemon",
    }),
    servesHome: (path) => path === dir,
    handlers: [],
    supportedPorts: options.ports ?? [],
    ...(options.revisions ? { revisions: options.revisions.map(Revision.parse) } : {}),
  });
  servers.push(server);
  // A short path: macOS limits socket paths to 103 bytes.
  const socket = join(tempDir("mps", true), "s.sock");
  await server.listen(socket);
  return { server, socket: server.socketPath ?? socket };
}

/** A client with its own request handler, as a host implementing ports would have. */
async function client(socket: string, onRequest?: (method: string, params: unknown) => unknown) {
  const connection = createConnection(socket);
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("error", reject);
  });
  const peer = new RpcPeer({
    send: (message) => void connection.write(encodeLine(message)),
    ...(onRequest ? { onRequest } : {}),
  });
  const splitter = new LineSplitter();
  connection.setEncoding("utf8");
  connection.on("data", (chunk: string) => {
    for (const line of splitter.push(chunk)) peer.receiveLine(line);
  });
  const closed = new Promise<void>((resolve) => connection.once("close", () => resolve()));
  return { peer, close: () => connection.end(), closed };
}

const initialize = (overrides: Partial<MostraInitializeParams> = {}): MostraInitializeParams => ({
  client: { name: "test", version: "0" },
  revisions: ["2026-10-10"],
  capabilities: {},
  ports: [],
  ...overrides,
});

describe("revision negotiation (HO-02)", () => {
  it("picks the newest revision both sides support", async () => {
    const { socket } = await serve({ revisions: ["2026-10-10", "2027-03-01", "2028-01-01"] });
    const host = await client(socket);
    const result = await host.peer.call(
      mostraInitializeMethod,
      initialize({ revisions: ["2025-01-01", "2026-10-10", "2027-03-01", "2099-01-01"] }),
    );
    expect(result.revision).toBe("2027-03-01");
    host.close();
  });

  it("refuses a client with no common revision, then accepts a retry with one", async () => {
    const { socket } = await serve({ revisions: ["2027-03-01"] });
    const host = await client(socket);
    const refusal = await host.peer
      .call(mostraInitializeMethod, initialize({ revisions: ["2026-10-10"] }))
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcError);
    expect((refusal as RpcError).code).toBe(-32000);
    expect((refusal as RpcError).diagnostic.code).toBe("MOSTRA_HOST_REVISION_UNSUPPORTED");
    expect((refusal as RpcError).diagnostic.message).toContain("2027-03-01");
    const retry = await host.peer.call(
      mostraInitializeMethod,
      initialize({ revisions: ["2027-03-01"] }),
    );
    expect(retry.revision).toBe("2027-03-01");
    host.close();
  });
});

describe("port callbacks (D59)", () => {
  it("reach only the connection that registered the port, and fail once it is gone", async () => {
    const { server, socket } = await serve({ ports: ["submissions"] });
    const calls: string[] = [];
    const registrant = await client(socket, (method) => {
      calls.push(`registrant:${method}`);
      return { accepted: true };
    });
    const bystander = await client(socket, (method) => {
      calls.push(`bystander:${method}`);
      return {};
    });
    const registered = await registrant.peer.call(
      mostraInitializeMethod,
      initialize({ ports: ["submissions", "ai"] }),
    );
    expect(registered.warnings.map((warning) => warning.code)).toEqual([
      "MOSTRA_HOST_PORT_UNSUPPORTED",
    ]);
    await bystander.peer.call(mostraInitializeMethod, initialize());

    await expect(
      server.callPort("submissions", "port/submissions.deliver", { id: 1 }),
    ).resolves.toEqual({
      accepted: true,
    });
    expect(calls).toEqual(["registrant:port/submissions.deliver"]);
    await expect(server.callPort("ai", "port/ai.x", {})).rejects.toThrow(
      "No connection registered the ai port",
    );

    registrant.close();
    await registrant.closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(server.callPort("submissions", "port/submissions.deliver", {})).rejects.toThrow(
      "No connection registered",
    );
    expect(calls).toEqual(["registrant:port/submissions.deliver"]);
    bystander.close();
  });

  it("serve a port of any name through one path: a later package's port needs no new plumbing (HO-01, D143)", async () => {
    // `addressing` (WP-13) stands for any port a later package adds: only its name joins the
    // instance's supported ports; registration, the registrant lookup, the call on the
    // registering connection, its time limit and the warning when unsupported are the same.
    const { server, socket } = await serve({ ports: ["identity", "addressing"] });
    const host = await client(socket, (method, params) => ({ method, params }));
    const session = await host.peer.call(
      mostraInitializeMethod,
      initialize({ ports: ["addressing", "identity", "capture"] }),
    );
    expect(session.capabilities.ports).toEqual(["identity", "addressing"]);
    expect(session.warnings.map((warning) => warning.code)).toEqual([
      "MOSTRA_HOST_PORT_UNSUPPORTED",
    ]);
    expect(session.warnings[0]?.message).toContain("capture");
    for (const port of ["identity", "addressing"]) {
      const [registrant] = server.registrants(port);
      expect(registrant?.owner).toBe("test");
      await expect(
        server.callSession(
          registrant?.session ?? -1,
          `port/${port}.example`,
          { artifactId: "a" },
          1000,
        ),
      ).resolves.toEqual({ method: `port/${port}.example`, params: { artifactId: "a" } });
    }
    expect(server.registrants("capture")).toEqual([]);
    // A registrant that never answers is the same timeout for every port.
    const silent = await client(socket, () => new Promise(() => undefined));
    await silent.peer.call(mostraInitializeMethod, initialize({ ports: ["addressing"] }));
    const last = server.registrants("addressing").at(-1);
    await expect(
      server.callSession(last?.session ?? -1, "port/addressing.example", {}, 100),
    ).rejects.toMatchObject({ diagnostic: { code: "MOSTRA_HOST_TIMEOUT" } });
    host.close();
    silent.close();
  });
});
