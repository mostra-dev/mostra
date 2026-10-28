/**
 * The gateway's request record (#66, `MOSTRA_TEST_REQUEST_LOG`): with it, a listener logs each
 * connection and request and how it ended, answered or not, never a query or a header; without
 * it, nothing.
 */
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createListener, type Listener } from "../../src/gateway/listener.ts";
import type { Log, LogFields } from "../../src/log.ts";

interface Line {
  readonly event: string;
  readonly fields: LogFields;
}

const open: Listener[] = [];
afterEach(async () => {
  for (const listener of open.splice(0)) await listener.close();
});

async function listen(traceRequests: boolean): Promise<{ lines: Line[]; port: number }> {
  const lines: Line[] = [];
  const log: Log = {
    info: (event, fields = {}) => lines.push({ event, fields }),
    warn: (event, fields = {}) => lines.push({ event, fields }),
    error: (event, fields = {}) => lines.push({ event, fields }),
  };
  let port = 0;
  const listener = createListener({
    policy: () => ({ origin: `http://127.0.0.1:${port}`, hosts: [`127.0.0.1:${port}`] }),
    log,
    frameAncestors: () => "'none'",
    configure: (app) => {
      app.get("/answered", (c) => c.text("ok"));
      // Never answers: the client gives up first.
      app.get("/held", () => new Promise<Response>(() => {}));
    },
    ...(traceRequests ? { traceRequests } : {}),
  });
  open.push(listener);
  await new Promise<void>((done) => listener.server.listen(0, "127.0.0.1", done));
  port = (listener.server.address() as AddressInfo).port;
  return { lines, port };
}

/** A GET that gives up after `abortMs`, if given; resolves once its connection is gone. */
function get(port: number, path: string, abortMs?: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", () => resolve(undefined));
    if (abortMs !== undefined) setTimeout(() => req.destroy(), abortMs);
    req.end();
  });
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 200));

describe("the gateway's request record (#66)", () => {
  it("logs each connection, request and answer, with the path but never its query", async () => {
    const { lines, port } = await listen(true);
    expect(await get(port, "/answered?ticket=SECRET-TICKET-1234")).toBe(200);
    await settle();
    const events = lines.map((line) => line.event);
    expect(events).toEqual([
      "gateway.connection",
      "gateway.request",
      "gateway.request_closed",
      "gateway.connection_closed",
    ]);
    const request = lines[1]?.fields;
    expect(request).toMatchObject({ method: "GET", path: "/answered" });
    expect(typeof request?.["client"]).toBe("number");
    expect(lines[2]?.fields).toMatchObject({
      path: "/answered",
      status: 200,
      headersSent: true,
      finished: true,
    });
    expect(JSON.stringify(lines)).not.toContain("SECRET-TICKET-1234");
  });

  it("logs a request that ended without an answer", async () => {
    const { lines, port } = await listen(true);
    expect(await get(port, "/held", 300)).toBeUndefined();
    await settle();
    const closed = lines.find((line) => line.event === "gateway.request_closed");
    expect(closed?.fields).toMatchObject({
      method: "GET",
      path: "/held",
      headersSent: false,
      finished: false,
    });
  });

  it("logs nothing without the switch", async () => {
    const { lines, port } = await listen(false);
    expect(await get(port, "/answered")).toBe(200);
    await settle();
    expect(lines).toEqual([]);
  });
});
