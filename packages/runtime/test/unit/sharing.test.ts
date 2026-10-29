/**
 * The pieces of sharing that need no tunnel (D158): who a tailnet request names, and how the
 * tools are found. The tunnels themselves run in `test/integration/share.test.ts`.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeEncodedWords, isLoopbackPeer, tailnetPerson } from "../../src/gateway/identity.ts";
import { installHint, toolCommand } from "../../src/platform/index.ts";
import { tailnetOrigin } from "../../src/share/tailscale.ts";

const WINDOWS = process.platform === "win32";

describe("who a tailnet request names (D158 item 2)", () => {
  it("decodes RFC 2047 encoded words, Q and B, and leaves plain text as it is", () => {
    expect(decodeEncodedWords("Ada Lovelace")).toBe("Ada Lovelace");
    expect(decodeEncodedWords("=?utf-8?q?Ferris_B=C3=BCller?=")).toBe("Ferris Büller");
    expect(decodeEncodedWords("=?UTF-8?B?w4FsdmFybw==?=")).toBe("Álvaro");
    // Adjacent words join without the space between them (RFC 2047 §6.2).
    expect(decodeEncodedWords("=?utf-8?q?Jos=C3=A9?= =?utf-8?q?_Mar=C3=ADa?=")).toBe("José María");
    // A word in a charset Mostra can't read stays as sent rather than becoming a guess.
    expect(decodeEncodedWords("=?x-unknown?q?abc?=")).toBe("=?x-unknown?q?abc?=");
  });

  it("believes only a loopback peer", () => {
    for (const peer of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackPeer(peer), peer).toBe(true);
    }
    for (const peer of [
      undefined,
      "",
      "10.0.0.2",
      "100.74.175.108",
      "::ffff:10.0.0.2",
      "fe80::1",
    ]) {
      expect(isLoopbackPeer(peer), String(peer)).toBe(false);
    }
  });

  it("names the person Tailscale Serve set, never on a Funnel request or from another peer", () => {
    const headers = (extra: Record<string, string>) =>
      new Headers({
        "tailscale-user-login": "ada@example.com",
        "tailscale-user-name": "=?utf-8?q?Ada_L=C3=B6velace?=",
        ...extra,
      });
    expect(tailnetPerson(headers({}), "127.0.0.1")).toEqual({
      ref: "ada@example.com",
      name: "Ada Lövelace",
    });
    expect(
      tailnetPerson(headers({ "tailscale-funnel-request": "?1" }), "127.0.0.1"),
    ).toBeUndefined();
    expect(tailnetPerson(headers({}), "192.168.1.20")).toBeUndefined();
    // A tagged device sends no login: nobody is named.
    expect(
      tailnetPerson(new Headers({ "tailscale-user-name": "Robot" }), "127.0.0.1"),
    ).toBeUndefined();
    expect(
      tailnetPerson(new Headers({ "tailscale-user-login": " " }), "127.0.0.1"),
    ).toBeUndefined();
    // A display name too long to be one is left out; the login still names the person.
    const long = tailnetPerson(headers({ "tailscale-user-name": "x".repeat(300) }), "::1");
    expect(long).toEqual({ ref: "ada@example.com" });
  });
});

describe("the tunnel tools", () => {
  it("runs the tool a variable names, refuses one that isn't there, and finds none on an empty PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtools-"));
    try {
      const tool = join(dir, WINDOWS ? "cloudflared.exe" : "cloudflared");
      writeFileSync(tool, "#!/bin/sh\n");
      if (!WINDOWS) chmodSync(tool, 0o755);
      expect(toolCommand("cloudflared", { MOSTRA_CLOUDFLARED: tool, PATH: "" })).toEqual({
        command: tool,
        args: [],
        fake: false,
      });
      expect(
        toolCommand("cloudflared", { MOSTRA_CLOUDFLARED: join(dir, "absent"), PATH: dir }),
      ).toBeUndefined();
      // Found on PATH by its name.
      expect(toolCommand("cloudflared", { PATH: dir, Path: dir })?.command).toBe(tool);
      expect(toolCommand("tailscale", { PATH: dir, Path: dir, ProgramFiles: dir })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the local stand-ins with this Node.js when the test switch names their directory", () => {
    const fakes = join(import.meta.dirname, "..", "..", "..", "conformance", "tunnels");
    const command = toolCommand("tailscale", { MOSTRA_TEST_TUNNELS: fakes, PATH: "" });
    expect(command).toEqual({
      command: process.execPath,
      args: [join(fakes, "tailscale.mjs")],
      fake: true,
    });
    expect(
      toolCommand("cloudflared", { MOSTRA_TEST_TUNNELS: join(fakes, "none") }),
    ).toBeUndefined();
  });

  it("says how to install each tool on this system", () => {
    expect(installHint("tailscale")).toMatch(/tailscale\.com\/download/);
    expect(installHint("cloudflared")).toMatch(/cloudflared/);
  });

  it("writes a tailnet address as browsers do: no port for 443", () => {
    expect(tailnetOrigin("box.tail1234.ts.net", 443)).toBe("https://box.tail1234.ts.net");
    expect(tailnetOrigin("box.tail1234.ts.net", 8443)).toBe("https://box.tail1234.ts.net:8443");
  });
});
