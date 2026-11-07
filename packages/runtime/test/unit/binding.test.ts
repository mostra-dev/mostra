/**
 * The owner's binding to a hosted home (WP-29, INTERFACES §18.2): a notification that arrives while
 * its session's own start is still under way reaches the caller with the session it came on, so a
 * page of followed events is never dropped before the binding names the session (Opus review of
 * WP-29, 2).
 */
import type { AddressInfo } from "node:net";
import { eventsSubscribeMethod, HOST_PROTOCOL_REVISIONS } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { type Binding, ownerInitialize, startBinding } from "../../src/link/index.ts";
import { BINDING_SUBPROTOCOL } from "../../src/protocol-server/index.ts";
import { until } from "../interaction-support.ts";

const servers: WebSocketServer[] = [];
const bindings: Binding[] = [];
afterEach(async () => {
  for (const binding of bindings.splice(0)) await binding.stop();
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
});

describe("the owner's binding", () => {
  it("hands a notification sent during the session's start to the caller, with its session", async () => {
    const server = new WebSocketServer({
      port: 0,
      host: "127.0.0.1",
      handleProtocols: () => BINDING_SUBPROTOCOL,
    });
    servers.push(server);
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as { id?: number; method?: string };
        if (message.method === "mostra/initialize") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                revision: HOST_PROTOCOL_REVISIONS.at(-1),
                instance: {
                  version: "0.0.0",
                  home: "hom_test",
                  platform: "test",
                  pid: 1,
                  mode: "hosted",
                },
                capabilities: { methods: [], notifications: [], ports: [] },
                warnings: [],
              },
            }),
          );
        } else if (message.method === "events/subscribe") {
          // The first page goes out before the subscription's answer reaches the binding.
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "events/notify",
              params: { subscriptionId: "sub", events: [], cursor: "7" },
            }),
          );
          setTimeout(
            () =>
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: { subscriptionId: "sub", cursor: "7" },
                }),
              ),
            50,
          );
        }
      });
    });
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const heard: { method: string; session: unknown }[] = [];
    const warnings: string[] = [];
    const binding = startBinding({
      server: `http://127.0.0.1:${port}`,
      accessToken: async () => "token",
      initialize: () =>
        ownerInitialize({ name: "test", version: "0.0.0", instanceId: "lnk_x", relayMark: 0 }),
      onRequest: () => ({}),
      onNotification: (method, _params, session) => heard.push({ method, session }),
      onOpen: async (session) => {
        await session.call(eventsSubscribeMethod, { name: "owner:lnk_x" });
      },
      log: {
        info() {},
        warn: (event, fields) => warnings.push(`${event} ${JSON.stringify(fields)}`),
        error: (event, fields) => warnings.push(`${event} ${JSON.stringify(fields)}`),
      },
    });
    bindings.push(binding);
    await until(() => binding.session !== undefined || warnings.length > 0, 10_000);
    expect(warnings).toEqual([]);
    await until(() => heard.length === 1);
    expect(heard[0]?.method).toBe("events/notify");
    expect(heard[0]?.session).toBe(binding.session);
  });
});
