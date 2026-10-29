#!/usr/bin/env node
/**
 * A stand-in for the `tailscale` command line, for tests (`MOSTRA_TEST_TUNNELS`). It answers the
 * three commands a Mostra share runs, as Tailscale 1.102 does (VERIFIED_FACTS, WP-13):
 *
 * - `status --json`: a running device named `localhost` on a tailnet with MagicDNS;
 * - `serve status --json`: the device's own configuration (`MOSTRA_FAKE_TAILSCALE_SERVED`, a
 *   comma-separated port list, else none);
 * - `serve|funnel --https=<port> <local>`, in the foreground: it forwards plain HTTP on loopback to
 *   `<local>`, prints the address, and, like Tailscale, removes any `Tailscale-*` header a request
 *   brought, then adds the tailnet person's (`serve`) or `Tailscale-Funnel-Request: ?1` (`funnel`).
 *
 * `MOSTRA_FAKE_TAILSCALE` plays what can go wrong: `stopped` (not signed in), `no-serve` and
 * `no-funnel` (the feature isn't enabled for the tailnet). The person is
 * `MOSTRA_FAKE_TAILNET_USER` (`login|Display Name`), sent in RFC 2047 Q encoding when it isn't
 * ASCII, as Tailscale sends it.
 */
import { forward, untilStopped } from "./forward.mjs";

const args = process.argv.slice(2);
const play = process.env.MOSTRA_FAKE_TAILSCALE ?? "";

/** RFC 2047 "Q" encoding of a non-ASCII value, as Go's `mime.QEncoding` writes it. */
function qEncode(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (byte === 0x20) out += "_";
    else if (/[A-Za-z0-9!*+\-/]/.test(char)) out += char;
    else out += `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `=?utf-8?q?${out}?=`;
}

if (args[0] === "status") {
  if (play === "stopped") {
    process.stdout.write(`${JSON.stringify({ BackendState: "NeedsLogin" })}\n`);
  } else {
    process.stdout.write(
      `${JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "localhost.", HostName: "localhost" },
        CurrentTailnet: { Name: "fake", MagicDNSSuffix: "fake.ts.net", MagicDNSEnabled: true },
      })}\n`,
    );
  }
  process.exit(0);
}

if (args[0] === "serve" && args[1] === "status") {
  const served = (process.env.MOSTRA_FAKE_TAILSCALE_SERVED ?? "").split(",").filter(Boolean);
  const tcp = Object.fromEntries(served.map((port) => [port, { HTTPS: true }]));
  process.stdout.write(`${JSON.stringify(served.length > 0 ? { TCP: tcp } : {})}\n`);
  process.exit(0);
}

const feature = args[0];
const https = args.find((arg) => arg.startsWith("--https="));
const local = args.at(-1);
if ((feature !== "serve" && feature !== "funnel") || !https || !local?.startsWith("http")) {
  process.stderr.write(`fake tailscale: unsupported command ${args.join(" ")}\n`);
  process.exit(2);
}
if (
  (feature === "serve" && play === "no-serve") ||
  (feature === "funnel" && play === "no-funnel")
) {
  const name = feature === "serve" ? "Serve" : "Funnel";
  process.stdout.write(
    `${name} is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/${feature}?node=FAKE\n\n`,
  );
  await untilStopped();
  process.exit(0);
}

const [login, name] = (
  process.env.MOSTRA_FAKE_TAILNET_USER ?? "ada@example.com|Ada Lovelace"
).split("|");
// Tailscale Serve answers on the device's name at the port asked for, so its links stay the
// same across restarts: the fake does the same on IPv6 loopback, beside the face on IPv4. Funnel's
// ports (443 and the others) need privileges a test lacks, so Funnel takes a port the system picks.
const asked = Number(https.slice("--https=".length));
const stable = feature === "serve" && asked >= 1024;
const port = await forward(local, {
  ...(stable ? { host: "::1", port: asked } : {}),
  rewrite(headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith("tailscale-")) delete headers[key];
    }
    headers["x-forwarded-host"] = headers.host ?? "";
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-for"] = "100.64.0.2";
    if (feature === "funnel") {
      headers["tailscale-funnel-request"] = "?1";
    } else {
      headers["tailscale-user-login"] = qEncode(login ?? "");
      headers["tailscale-user-name"] = qEncode(name ?? "");
      headers["tailscale-user-profile-pic"] = "";
      headers["tailscale-headers-info"] = "https://tailscale.com/s/serve-headers";
    }
    return headers;
  },
});
const where = feature === "serve" ? "Available within your tailnet:" : "Available on the internet:";
const address = stable ? `http://[::1]:${port}` : `http://127.0.0.1:${port}`;
process.stdout.write(`${where}\n\n${address}/\n|-- / proxy ${local}\n\nPress Ctrl+C to exit.\n`);
await untilStopped();
process.exit(0);
