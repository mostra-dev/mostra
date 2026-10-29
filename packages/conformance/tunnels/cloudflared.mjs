#!/usr/bin/env node
/**
 * A stand-in for `cloudflared tunnel --url <local>`, for tests (`MOSTRA_TEST_TUNNELS`). Like a
 * Cloudflare quick tunnel (VERIFIED_FACTS, WP-13) it gives every tunnel a site of its own (a
 * random `<name>.localhost`, which browsers and the kit resolve to loopback), keeps the request's
 * `Host`, adds Cloudflare's own headers, and holds every response back until it ends, so an event
 * stream never arrives and pages must long-poll. It logs as `cloudflared` does: the address in a
 * banner, then a registered connection. `MOSTRA_FAKE_CLOUDFLARED=fail` plays a refused tunnel.
 */
import { randomBytes } from "node:crypto";
import { forward, untilStopped } from "./forward.mjs";

const args = process.argv.slice(2);
const urlAt = args.indexOf("--url");
const local = urlAt >= 0 ? args[urlAt + 1] : undefined;
if (args[0] !== "tunnel" || !local) {
  process.stderr.write(`fake cloudflared: unsupported command ${args.join(" ")}\n`);
  process.exit(2);
}
const log = (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`);
log("INF Requesting new quick Tunnel on trycloudflare.com...");
if (process.env.MOSTRA_FAKE_CLOUDFLARED === "fail") {
  log(
    'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": 429 Too Many Requests',
  );
  process.exit(1);
}
const name = `t${randomBytes(6).toString("hex")}`;
const port = await forward(local, {
  hold: true,
  rewrite(headers) {
    headers["cf-connecting-ip"] = "203.0.113.7";
    headers["cf-ray"] = `${randomBytes(8).toString("hex")}-FAKE`;
    headers["cf-visitor"] = '{"scheme":"https"}';
    headers["x-forwarded-for"] = "203.0.113.7";
    headers["x-forwarded-proto"] = "https";
    return headers;
  },
});
log(
  "INF +--------------------------------------------------------------------------------------------+",
);
log(
  "INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
);
log(
  `INF |  http://${name}.localhost:${port}                                                     |`,
);
log(
  "INF +--------------------------------------------------------------------------------------------+",
);
log(
  "INF Registered tunnel connection connIndex=0 event=0 ip=198.41.192.7 location=fake protocol=quic",
);
await untilStopped();
process.exit(0);
