/**
 * The fixture operator's control server (`fixtures/operator.mjs`): what a test tells the operator
 * module to answer, what the server asked it, and the server handle's actions, as an operating layer
 * would take them.
 */
import { request } from "node:http";

export interface Call {
  readonly port: string;
  readonly payload: Record<string, unknown>;
}

/** The fixture operator's control server. */
export function control(port: number) {
  const ask = (method: string, path: string, body?: unknown) =>
    new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: { "content-type": "application/json" },
        },
        (incoming) => {
          let text = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode ?? 0, json: JSON.parse(text || "null") }),
          );
        },
      );
      outgoing.on("error", reject);
      if (body !== undefined) outgoing.write(JSON.stringify(body));
      outgoing.end();
    });
  return {
    set: (state: Record<string, unknown>) => ask("POST", "/state", state),
    calls: async (port?: string) =>
      ((await ask("GET", "/calls")).json as Call[]).filter(
        (call) => port === undefined || call.port === port,
      ),
    handle: async (method: string, ...args: unknown[]) => ask("POST", "/handle", { method, args }),
  };
}
