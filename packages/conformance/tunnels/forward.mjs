/**
 * The forwarding half of the test tunnels (`MOSTRA_TEST_TUNNELS`): an HTTP listener on loopback
 * that passes every request on to a local origin, keeping its `Host` as the real tools do, and
 * WebSocket upgrades through. The fakes add what each real tool adds on its way: Tailscale's
 * identity headers, Cloudflare's held-back responses. Plain Node.js with no dependencies, so it
 * runs from the kit's installed package as from this repository.
 */
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";

/**
 * Starts forwarding to `local` (`http://127.0.0.1:<port>`); resolves with the port it listens on.
 *
 * - `rewrite(headers)` changes the request's headers before they go on.
 * - `hold`: answer only once the whole response arrived, as Cloudflare's quick tunnels do.
 * - `host` and `port`: where it listens (loopback, a port the system picks, by default).
 */
export function forward(
  local,
  { rewrite = (headers) => headers, hold = false, host = "127.0.0.1", port = 0 } = {},
) {
  const target = new URL(local);
  const server = createServer((incoming, outgoing) => {
    const headers = rewrite({ ...incoming.headers });
    const upstream = request(
      {
        host: target.hostname,
        port: target.port,
        method: incoming.method,
        path: incoming.url,
        headers,
        agent: false,
      },
      (answer) => {
        if (!hold) {
          outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(outgoing);
          return;
        }
        const chunks = [];
        answer.on("data", (chunk) => chunks.push(chunk));
        answer.on("end", () => {
          const body = Buffer.concat(chunks);
          const { "transfer-encoding": _chunked, ...rest } = answer.headers;
          outgoing.writeHead(answer.statusCode ?? 502, { ...rest, "content-length": body.length });
          outgoing.end(body);
        });
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
    outgoing.on("close", () => upstream.destroy());
  });
  server.on("upgrade", (incoming, socket, head) => {
    const headers = rewrite({ ...incoming.headers });
    const upstream = connect(Number(target.port), target.hostname, () => {
      const lines = [`${incoming.method} ${incoming.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  server.keepAliveTimeout = 305_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, () => resolve(server.address().port));
  });
}

/**
 * Waits until the process is told to stop, as a foreground tunnel command does. `tag` names this
 * tunnel for a test: `die-<tag>` ends this one only (Tailscale's tunnels are tagged with their port).
 */
export function untilStopped(tag) {
  return new Promise((resolve) => {
    // Mostra's process manager ends its children by signal, or by their job on Windows.
    for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK"]) process.once(signal, resolve);
    setInterval(() => {}, 1 << 30);
    // A test ends a running tunnel by creating `die` in `MOSTRA_FAKE_CONTROL`, as a tunnel whose
    // process ended by itself: the fake that notices it first takes it and exits 1.
    const control = process.env.MOSTRA_FAKE_CONTROL;
    if (control) {
      const names = tag === undefined ? ["die"] : ["die", "die-" + tag];
      setInterval(() => {
        for (const name of names) {
          try {
            unlinkSync(join(control, name));
          } catch {
            continue;
          }
          process.exit(1);
        }
      }, 100);
    }
  });
}

/**
 * Takes a one-time mark in `MOSTRA_FAKE_CONTROL`: `true` for the one process that creates
 * `<name>` first, so tests can make one of two tunnels behave otherwise.
 */
export function takeMark(name) {
  const control = process.env.MOSTRA_FAKE_CONTROL;
  if (!control) return false;
  try {
    writeFileSync(join(control, name), String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/** Whether `MOSTRA_FAKE_CONTROL` holds `<name>`: a switch a test turns on and off. */
export function marked(name) {
  const control = process.env.MOSTRA_FAKE_CONTROL;
  return control !== undefined && existsSync(join(control, name));
}
