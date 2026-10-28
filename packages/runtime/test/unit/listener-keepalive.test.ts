/**
 * Gateway listeners keep idle connections for the browser to close (D157 item 2, #66): a
 * connection that finished its answer stays open past Node's default 5 s (6 s with its buffer), so
 * the browser reuses it and closes it itself.
 */

import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { createListener, KEEP_ALIVE_MS } from "../../src/gateway/listener.ts";
import { silentLog } from "../../src/log.ts";

describe("gateway listeners' idle connections (D157 item 2)", () => {
  it("stay open past Node's default, for the browser to reuse and close", async () => {
    let port = 0;
    const listener = createListener({
      policy: () => ({ origin: `http://127.0.0.1:${port}`, hosts: [`127.0.0.1:${port}`] }),
      log: silentLog,
      frameAncestors: () => "'none'",
      configure: (app) => {
        app.get("/x", (c) => c.text("ok"));
      },
    });
    await new Promise<void>((done) => listener.server.listen(0, "127.0.0.1", done));
    port = (listener.server.address() as AddressInfo).port;
    try {
      const socket = connect(port, "127.0.0.1");
      let received = "";
      let closed = false;
      socket.on("data", (chunk) => {
        received += chunk.toString("latin1");
      });
      socket.on("close", () => {
        closed = true;
      });
      const request = `GET /x HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`;
      socket.write(request);
      await new Promise((done) => setTimeout(done, 7_500));
      // Node's default closed it after 5 s and its 1 s buffer.
      expect(closed).toBe(false);
      socket.write(request);
      await new Promise((done) => setTimeout(done, 500));
      expect(received.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
      expect(received.toLowerCase()).toContain(
        `keep-alive: timeout=${String(KEEP_ALIVE_MS / 1000)}`,
      );
      socket.destroy();
    } finally {
      await listener.close();
    }
  }, 20_000);

  it("are kept longer than Chromium keeps its own (300 s) and Firefox (115 s)", () => {
    expect(KEEP_ALIVE_MS).toBeGreaterThan(300_000);
  });
});
