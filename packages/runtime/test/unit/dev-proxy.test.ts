/**
 * The dev sandbox's proxy through a dev server's restart (#164, D140 item 12): a restart switches
 * the session to the new dev server and then stops the old one, which cuts the requests it was
 * answering. The page that asked for one of its modules never rendered. A GET or a HEAD it cut
 * goes to the server that replaced it; anything else, and a server that failed with no restart
 * behind it, fails as before.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEV_RESTART_RETRIES,
  type DevUpstream,
  devFetchAcrossRestarts,
} from "../../src/gateway/dev.ts";

const secret = "s".repeat(32);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A dev server on loopback; `answer` decides what each request gets. */
async function devServer(
  answer: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; upstream: DevUpstream; asked: () => number }> {
  let asked = 0;
  const server = createServer((request, response) => {
    asked += 1;
    answer(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    server,
    upstream: { port: (server.address() as AddressInfo).port, secret },
    asked: () => asked,
  };
}

/** A server that holds each request until `cut` stops it, as a restart's `old.stop()` does. */
async function heldServer(): Promise<{
  upstream: DevUpstream;
  holding: Promise<void>;
  cut: () => void;
}> {
  let held: (() => void) | undefined;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const { server, upstream } = await devServer(() => held?.());
  return {
    upstream,
    holding,
    cut: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const ok = (): Promise<{ upstream: DevUpstream; asked: () => number }> =>
  devServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("export const label = 'clicks';\n");
  });

describe("the dev proxy through a restart (#164)", () => {
  it("sends a module request the restart cut to the server that replaced the old one", async () => {
    const old = await heldServer();
    const replacement = await ok();
    let current = old.upstream;
    const retried: { from: number; to: number }[] = [];
    const answer = devFetchAcrossRestarts(
      () => current,
      old.upstream,
      new Request("http://artifact.localhost/@fs/protocol/dist/policy.js"),
      "/@fs/protocol/dist/policy.js",
      ({ from, to }) => retried.push({ from, to }),
    );
    // The restart: the session names the new server first, then the old one is stopped while it
    // still holds the request (D140 item 12's order).
    await old.holding;
    current = replacement.upstream;
    old.cut();
    const answered = await answer;
    expect(answered.status).toBe(200);
    expect(answered.body.toString()).toContain("clicks");
    expect(retried).toEqual([{ from: old.upstream.port, to: replacement.upstream.port }]);
    expect(replacement.asked()).toBe(1);
  });

  it("follows restarts that come one after another, up to its bound", async () => {
    const first = await heldServer();
    const second = await heldServer();
    const last = await ok();
    let current = first.upstream;
    const answer = devFetchAcrossRestarts(
      () => current,
      first.upstream,
      new Request("http://artifact.localhost/label.tsx", { method: "HEAD" }),
      "/label.tsx",
    );
    await first.holding;
    current = second.upstream;
    first.cut();
    await second.holding;
    current = last.upstream;
    second.cut();
    expect((await answer).status).toBe(200);
    expect(DEV_RESTART_RETRIES).toBeGreaterThanOrEqual(2);
  });

  it("fails a request whose server stopped with no restart behind it", async () => {
    const lone = await heldServer();
    const answer = devFetchAcrossRestarts(
      () => lone.upstream,
      lone.upstream,
      new Request("http://artifact.localhost/index.tsx"),
      "/index.tsx",
    );
    await lone.holding;
    lone.cut();
    await expect(answer).rejects.toThrow();
  });

  it("never sends anything but a GET or a HEAD again", async () => {
    const old = await heldServer();
    const replacement = await ok();
    let current = old.upstream;
    const answer = devFetchAcrossRestarts(
      () => current,
      old.upstream,
      new Request("http://artifact.localhost/_action", { method: "POST" }),
      "/_action",
    );
    await old.holding;
    current = replacement.upstream;
    old.cut();
    await expect(answer).rejects.toThrow();
    expect(replacement.asked()).toBe(0);
  });

  it("gives up after its bound when the dev server keeps restarting under the request", async () => {
    const held = await Promise.all(
      Array.from({ length: DEV_RESTART_RETRIES + 1 }, () => heldServer()),
    );
    const never = await ok();
    let current = (held[0] as (typeof held)[number]).upstream;
    const answer = devFetchAcrossRestarts(
      () => current,
      current,
      new Request("http://artifact.localhost/index.tsx"),
      "/index.tsx",
    );
    for (const [index, server] of held.entries()) {
      await server.holding;
      current = held[index + 1]?.upstream ?? never.upstream;
      server.cut();
    }
    await expect(answer).rejects.toThrow();
    expect(never.asked()).toBe(0);
  });
});
