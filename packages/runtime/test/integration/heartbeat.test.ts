/**
 * The binding's liveness (WP-29, RM-02; INTERFACES §18.2, D165 item 2), at the real intervals:
 * behind a stand-in proxy that drops a connection idle for 60 s, as the edges a server sits behind
 * do by default (VERIFIED_FACTS, WP-28), the 20 s heartbeat keeps the binding open; once the proxy
 * stops forwarding without closing, the owner hears nothing for 45 s, closes the connection and
 * dials again.
 */
import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type Binding, ownerInitialize, startBinding } from "../../src/link/index.ts";
import { silentLog } from "../../src/log.ts";
import {
  deviceSignIn,
  freePort,
  type RunningServer,
  startServer,
  stopServer,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

/** A TCP proxy that closes a connection idle for `idleMs`, and can be told to black-hole. */
async function idleProxy(
  target: number,
  idleMs: number,
): Promise<{
  port: number;
  server: Server;
  blackHole(on?: boolean): void;
  drops: () => number;
}> {
  let silent = false;
  let drops = 0;
  const server = createServer((client: Socket) => {
    const upstream = connect(target, "127.0.0.1");
    let timer: ReturnType<typeof setTimeout>;
    const idle = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        drops += 1;
        client.destroy();
        upstream.destroy();
      }, idleMs);
    };
    idle();
    client.on("data", (chunk) => {
      if (silent) return;
      idle();
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (silent) return;
      idle();
      client.write(chunk);
    });
    const end = (): void => {
      clearTimeout(timer);
      client.destroy();
      upstream.destroy();
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", end);
    upstream.on("error", end);
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );
  return {
    port,
    server,
    blackHole: (on = true) => {
      silent = on;
    },
    drops: () => drops,
  };
}

const running: RunningServer[] = [];
const bindings: Binding[] = [];
const proxies: Server[] = [];
afterEach(async () => {
  for (const binding of bindings.splice(0)) await binding.stop();
  for (const proxy of proxies.splice(0)) proxy.close();
  for (const server of running.splice(0)) await stopServer(server);
});

describe("the binding's heartbeat (§18.2)", () => {
  it("keeps a binding open past a proxy's 60 s idle limit, and dials again after 45 s of silence", async () => {
    const port = await freePort();
    const server = await startServer({ data: tempDir("server-data"), port });
    running.push(server);
    const ada = await deviceSignIn(port, "Ada");
    const proxy = await idleProxy(port, 60_000);
    proxies.push(proxy.server);
    const events: { kind: "open" | "close"; at: number }[] = [];
    const binding = startBinding({
      server: `http://api.localhost:${port}`,
      connectTo: { host: "127.0.0.1", port: proxy.port },
      accessToken: async () => ada.accessToken,
      initialize: () =>
        ownerInitialize({
          name: "mostra-test",
          version: "0",
          instanceId: ada.instanceId,
          relayMark: 0,
        }),
      onRequest: () => ({ accepted: true }),
      onOpen: () => {
        events.push({ kind: "open", at: Date.now() });
      },
      onClose: () => events.push({ kind: "close", at: Date.now() }),
      log: silentLog,
    });
    bindings.push(binding);
    await binding.ready();
    // 70 s: past the proxy's idle limit, and nothing but the heartbeat crosses it.
    await new Promise((resolve) => setTimeout(resolve, 70_000));
    expect(proxy.drops()).toBe(0);
    expect(events.filter((event) => event.kind === "close")).toEqual([]);

    // The proxy now forwards nothing and closes nothing: only the silence limit notices.
    const silencedAt = Date.now();
    proxy.blackHole();
    const deadline = silencedAt + 70_000;
    while (!events.some((event) => event.kind === "close") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const closed = events.find((event) => event.kind === "close");
    expect(closed).toBeDefined();
    const silentFor = (closed?.at ?? 0) - silencedAt;
    // Heard last at most one heartbeat before the silence began: closed 25 to 46 s after it.
    expect(silentFor).toBeGreaterThanOrEqual(24_000);
    expect(silentFor).toBeLessThanOrEqual(47_000);

    // The network is back: the owner dials again by itself and opens a new session.
    proxy.blackHole(false);
    const reopened = Date.now() + 15_000;
    while (events.filter((event) => event.kind === "open").length < 2 && Date.now() < reopened) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(events.filter((event) => event.kind === "open")).toHaveLength(2);
  }, 200_000);
});
