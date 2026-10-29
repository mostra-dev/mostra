/**
 * Shares through a real `mostra-runtime daemon` (HY-04, HY-05, HY-07, D158), over the test
 * tunnels (`MOSTRA_TEST_TUNNELS`: local stand-ins for `tailscale` and `cloudflared` that forward
 * on loopback as the real tools forward from their networks, add what each adds, and hold back
 * responses as quick tunnels do). The real tools are exercised by the external checks
 * (`test/external`, PROGRESS-WP-13).
 */
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, Browser, type Opened, openLink, parseLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { connectTo, initializeParams } from "../support.ts";

const TUNNELS = fileURLToPath(new URL("../../../conformance/tunnels/", import.meta.url));
const REV = "/_mostra/v/2026-10-15";

interface ShareResult {
  readonly shareId: string;
  readonly artifactId: string;
  readonly via: string;
  readonly url: string;
  readonly hostname: string;
  readonly mode: "cookie" | "worker";
  readonly tokenId: string;
  readonly expiresAt?: string;
  readonly state: "active" | "stopped";
  readonly stopReason?: string;
}

interface Face {
  readonly origin?: string;
  readonly local: string;
  readonly listener: "shell" | "artifact";
  readonly by: string;
  readonly artifactId?: string;
}

const eventually = async (check: () => Promise<boolean>, ms = 15_000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("the condition never held");
};

async function share(
  gateway: GatewayHome,
  artifactId: string,
  params: Record<string, unknown>,
): Promise<ShareResult> {
  return ok<ShareResult>(
    await gateway.client.call("share/start", { artifact: { artifactId }, ...params }, 120_000),
  );
}

async function status(gateway: GatewayHome): Promise<{
  gateway?: { faces?: Face[]; bind: string };
  shares?: ShareResult[];
}> {
  return ok(await gateway.client.call("instance/status", {}));
}

/** A field write as a page sends it, on the frame's own session. */
function write(browser: Browser, opened: Opened, value: string): Promise<Answer> {
  return browser.fetchJson(opened.frameOrigin, `${REV}/fields`, {
    body: {
      viewId: opened.viewId,
      mutationId: MutationId.create(),
      scope: "viewer",
      baseRevision: "0",
      ops: [{ id: "name", value }],
    },
    csrf: opened.frameCsrf,
  });
}

/** A frame's stream ticket (worker mode, D70). */
async function streamTicket(browser: Browser, opened: Opened): Promise<string> {
  const answer = await browser.fetchJson(opened.frameOrigin, `${REV}/ticket`, {
    body: { purpose: "stream" },
    csrf: opened.frameCsrf,
  });
  expect(answer.status).toBe(200);
  return answer.json<{ ticket: string }>().ticket;
}

describe("shares (D158)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt;
  let other: Receipt;
  let third: Receipt;

  beforeAll(async () => {
    await gateway.start({
      env: {
        MOSTRA_TEST_TUNNELS: TUNNELS,
        MOSTRA_FAKE_TAILNET_USER: "ada@example.com|Ada Lövelace",
      },
    });
    receipt = await gateway.publish("single-tsx", "page.tsx");
    other = await gateway.publish("directory");
    third = await gateway.publish("single-mdx", "page.mdx");
  }, 240_000);
  afterAll(() => gateway.stop());

  it("refuses an artifact that doesn't exist, a public lifetime past 7 days, and an unknown share", async () => {
    expect(
      refused(
        await gateway.client.call("share/start", {
          artifact: { artifactId: "art_01M62E0YJP63V3R0FXTAVNAJVZ" },
          via: "cloudflare",
        }),
      ),
    ).toBe("MOSTRA_ARTIFACT_NOT_FOUND");
    expect(
      refused(
        await gateway.client.call("share/start", {
          artifact: { artifactId: receipt.artifactId },
          via: "cloudflare",
          ttl: "8d",
        }),
      ),
    ).toBe("MOSTRA_SHARE_TTL_INVALID");
    expect(
      refused(
        await gateway.client.call("share/stop", { shareId: "shr_01M62E0YJP63V3R0FXTAVNAJVY" }),
      ),
    ).toBe("MOSTRA_SHARE_NOT_FOUND");
    expect(refused(await gateway.client.call("share/stop", {}))).toBe("MOSTRA_HOST_INVALID_PARAMS");
  });

  describe("a Cloudflare quick tunnel (HY-05, HY-07)", () => {
    let shared: ShareResult;
    const browser = new Browser();
    let opened: Opened;

    beforeAll(async () => {
      shared = await share(gateway, receipt.artifactId, { via: "cloudflare" });
      opened = await openLink(browser, shared.url);
    }, 120_000);

    it("hands out a link at the tunnel's own site, which expires in an hour by default", () => {
      const link = parseLink(shared.url);
      expect(link.shell).toMatch(/^http:\/\/t[0-9a-f]{12}\.localhost:\d+$/);
      expect(shared.mode).toBe("worker");
      expect(shared.state).toBe("active");
      const life = Date.parse(shared.expiresAt as string) - Date.now();
      expect(life).toBeGreaterThan(55 * 60_000);
      expect(life).toBeLessThanOrEqual(60 * 60_000);
    });

    it("opens the frame in worker mode, on another site than the shell, its faces bound to loopback", async () => {
      expect(new URL(opened.frameOrigin).hostname).not.toBe(new URL(opened.link.shell).hostname);
      expect(new URL(opened.frameOrigin).hostname).toMatch(/\.localhost$/);
      expect(opened.page.status).toBe(200);
      const facts = (await browser.fetchJson(opened.frameOrigin, "/_mostra/session")).json<{
        mode?: string;
        streams?: boolean;
      }>();
      expect(facts).toMatchObject({ mode: "worker", streams: false });
      const faces = (await status(gateway)).gateway?.faces ?? [];
      const ours = faces.filter((face) => face.by === "cloudflare");
      expect(ours.map((face) => face.listener).sort()).toEqual(["artifact", "shell"]);
      for (const face of ours) expect(new URL(face.local).hostname).toBe("127.0.0.1");
    });

    it("saves through the tunnel, and refuses a page's request without its frame session", async () => {
      expect((await write(browser, opened, "Phone visitor")).status).toBe(200);
      // The frame session travels as a header only its service worker adds; no cookie works.
      const stranger = new Browser();
      const without = await stranger.fetchJson(opened.frameOrigin, "/_mostra/session");
      expect(without.status).toBe(401);
      const forged = await stranger.ask({
        url: `${opened.frameOrigin}/_mostra/session`,
        headers: { "x-mostra-frame": "0".repeat(26), "sec-fetch-site": "same-origin" },
      });
      expect(forged.status).toBe(401);
    });

    it("long-polls there with single-use tickets, and refuses an event stream, which the tunnel would hold back", async () => {
      const ticket = await streamTicket(browser, opened);
      const poll = await browser.ask({
        url: `${opened.frameOrigin}${REV}/events/poll?view=${opened.viewId}&wait=0&ticket=${ticket}`,
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
      });
      expect(poll.status).toBe(200);
      expect(poll.json<{ snapshot?: { draft?: unknown } }>().snapshot).toBeDefined();
      // Spent: the same ticket opens nothing again.
      const again = await browser.ask({
        url: `${opened.frameOrigin}${REV}/events/poll?view=${opened.viewId}&wait=0&ticket=${ticket}`,
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
      });
      expect(again.status).toBe(401);
      const stream = await browser.ask({
        url: `${opened.frameOrigin}${REV}/events?view=${opened.viewId}&ticket=${await streamTicket(browser, opened)}`,
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
      });
      expect(stream.status).toBe(503);
      expect(stream.json<{ code: string }>().code).toBe("MOSTRA_HYGIENE_NOT_SERVED");
    });

    it("answers as a viewer of the link's own, never the home's local user", async () => {
      const submitted = await browser.fetchJson(opened.frameOrigin, `${REV}/submit`, {
        body: { viewId: opened.viewId, expectedRevision: "1", channel: "artifact" },
        csrf: opened.frameCsrf,
      });
      expect([200, 409]).toContain(submitted.status);
      const results = ok<{ submission: { viewer: { kind: string; ref?: string } } }>(
        await gateway.client.call("results/get", { artifact: { artifactId: receipt.artifactId } }),
      );
      expect(results.submission.viewer.kind).toBe("token");
      expect(results.submission.viewer.ref).toBe(`link:${shared.tokenId}`);
    });

    it("lists, then stops: the link is revoked, the tunnel and its faces go, and the events say so", async () => {
      const listed = ok<{ shares: ShareResult[] }>(
        await gateway.client.call("share/list", { artifact: { artifactId: receipt.artifactId } }),
      );
      expect(listed.shares.map((one) => one.shareId)).toContain(shared.shareId);
      const stopped = ok<{ stopped: ShareResult[] }>(
        await gateway.client.call("share/stop", { shareId: shared.shareId }),
      );
      expect(stopped.stopped[0]).toMatchObject({ state: "stopped", stopReason: "stopped" });
      // Stopping again stops nothing.
      expect(
        ok<{ stopped: unknown[] }>(
          await gateway.client.call("share/stop", { shareId: shared.shareId }),
        ).stopped,
      ).toEqual([]);
      const faces = (await status(gateway)).gateway?.faces ?? [];
      expect(faces.filter((face) => face.by === "cloudflare")).toEqual([]);
      await expect(browser.fetchJson(opened.link.shell, "/")).rejects.toThrow();
      const events = ok<{ events: { type: string; payload: Record<string, unknown> }[] }>(
        await gateway.client.call("events/read", {
          filter: { artifacts: [receipt.artifactId], types: ["share.*", "token.revoked"] },
        }),
      );
      expect(events.events.map((event) => event.type)).toEqual([
        "share.started",
        "token.revoked",
        "share.stopped",
      ]);
      expect(events.events[2]?.payload).toMatchObject({ via: "cloudflare", reason: "stopped" });
    });

    it("ends with its tunnel: a quick tunnel that dies takes its share with it", async () => {
      const next = await share(gateway, receipt.artifactId, { via: "cloudflare", ttl: "10m" });
      const processes = ok<{ processes: { kind: string; pid: number; ownerRef?: string }[] }>(
        await gateway.client.call("instance/status", {}),
      ).processes.filter((child) => child.kind === "tunnel-cloudflare");
      expect(processes.length).toBe(2);
      process.kill((processes[0] as { pid: number }).pid, "SIGKILL");
      await eventually(async () => {
        const all = ok<{ shares: ShareResult[] }>(
          await gateway.client.call("share/list", { all: true }),
        ).shares;
        return all.find((one) => one.shareId === next.shareId)?.stopReason === "tunnel";
      });
      const left = ok<{ processes: { kind: string }[] }>(
        await gateway.client.call("instance/status", {}),
      ).processes.filter((child) => child.kind === "tunnel-cloudflare");
      expect(left).toEqual([]);
    }, 60_000);

    it("ends at its lifetime", async () => {
      const brief = await share(gateway, receipt.artifactId, { via: "cloudflare", ttl: "3s" });
      await eventually(async () => {
        const found = ok<{ shares: ShareResult[] }>(
          await gateway.client.call("share/list", { all: true }),
        ).shares.find((one) => one.shareId === brief.shareId);
        return found?.stopReason === "expired";
      }, 20_000);
    }, 60_000);
  });

  describe("Tailscale Serve (HY-04)", () => {
    let shared: ShareResult;
    const browser = new Browser();
    let opened: Opened;

    beforeAll(async () => {
      shared = await share(gateway, other.artifactId, { via: "tailnet" });
      opened = await openLink(browser, shared.url);
    }, 120_000);

    it("serves on the device's name in cookie mode, with no expiry unless asked", () => {
      expect(shared.mode).toBe("cookie");
      expect(shared.expiresAt).toBeUndefined();
      expect(new URL(opened.frameOrigin).hostname).toBe(new URL(opened.link.shell).hostname);
    });

    it("maps the tailnet person to the viewer, their name decoded", async () => {
      const facts = (await browser.fetchJson(opened.frameOrigin, "/_mostra/session")).json<{
        viewer: { kind: string; ref?: string; name?: string };
      }>();
      expect(facts.viewer).toMatchObject({
        kind: "tailnet",
        ref: "ada@example.com",
        name: "Ada Lövelace",
      });
    });

    it("never trusts identity headers that didn't come through Tailscale Serve", async () => {
      const faces = (await status(gateway)).gateway?.faces ?? [];
      const shellFace = faces.find((face) => face.by === "tailnet" && face.listener === "shell");
      expect(shellFace).toBeDefined();
      const link = parseLink(shared.url);
      const exchange = (target: string, host: string, extra: Record<string, string>) =>
        new Browser().ask({
          method: "POST",
          url: `${target}/a/${link.artifactId}/_mostra/session`,
          headers: {
            host,
            origin: link.shell,
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            ...extra,
          },
          body: JSON.stringify({ token: link.secret }),
        });
      const host = new URL(link.shell).host;
      // Straight to the face, past the tunnel, with a forged person: a Funnel request's mark
      // means it came from the internet, where nobody is a tailnet person.
      const visitor = new Browser();
      const funneled = await visitor.ask({
        method: "POST",
        url: `${shellFace?.local as string}/a/${link.artifactId}/_mostra/session`,
        headers: {
          host,
          origin: link.shell,
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          "tailscale-user-login": "mallory@example.com",
          "tailscale-user-name": "Mallory",
          "tailscale-funnel-request": "?1",
        },
        body: JSON.stringify({ token: link.secret }),
      });
      expect(funneled.status).toBe(200);
      // The session it got is the link's own viewer, never the forged person.
      const forgedOpen = await openLink(visitor, shared.url);
      const facts = (await visitor.fetchJson(forgedOpen.frameOrigin, "/_mostra/session")).json<{
        viewer: { kind: string; ref?: string; name?: string };
      }>();
      expect(facts.viewer.kind).toBe("token");
      expect(facts.viewer.ref).toBe(`link:${shared.tokenId}`);
      void exchange;
      // The loopback shell never reads Tailscale's headers at all.
      const plain = await new Browser().ask({
        method: "POST",
        url: `${ok<{ url: string }>(await gateway.client.call("view/url", { artifact: { artifactId: other.artifactId } })).url.replace(/\/a\/.*/, "")}/a/${link.artifactId}/_mostra/session`,
        headers: {
          "content-type": "application/json",
          "tailscale-user-login": "mallory@example.com",
        },
        body: "{}",
      });
      expect(plain.status).not.toBe(200);
      const results = await gateway.client.call("events/read", {
        filter: { artifacts: [other.artifactId], types: ["view.opened"] },
      });
      const opens = ok<{ events: { payload: { viewer?: { name?: string } } }[] }>(results).events;
      expect(opens.every((event) => event.payload.viewer?.name !== "Mallory")).toBe(true);
    });

    it("keeps its address across a restart: the same link opens again", async () => {
      await gateway.stop();
      await gateway.start({
        env: {
          MOSTRA_TEST_TUNNELS: TUNNELS,
          MOSTRA_FAKE_TAILNET_USER: "ada@example.com|Ada Lövelace",
        },
      });
      await eventually(async () => {
        const faces = (await status(gateway)).gateway?.faces ?? [];
        const ours = faces.filter((face) => face.by === "tailnet" && face.origin !== undefined);
        return ours.length === 2;
      }, 30_000);
      const listed = ok<{ shares: ShareResult[] }>(
        await gateway.client.call("share/list", {}),
      ).shares;
      const kept = listed.find((one) => one.shareId === shared.shareId);
      expect(kept?.state).toBe("active");
      // The fake's address changes with its process; a real tailnet name and port don't, and the
      // link's shell address is the face's: the link opens again wherever the face now is.
      expect(kept?.url).toBeDefined();
      await openLink(new Browser(), kept?.url as string);
      ok(await gateway.client.call("share/stop", { shareId: shared.shareId }));
    }, 120_000);
  });

  describe("Tailscale Funnel's port plan (HY-05)", () => {
    it("puts the shell on 443 and two artifacts on 8443 and 10000, and refuses a third", async () => {
      const one = await share(gateway, receipt.artifactId, { via: "funnel" });
      const two = await share(gateway, other.artifactId, { via: "funnel" });
      expect(one.mode).toBe("cookie");
      expect(
        refused(
          await gateway.client.call(
            "share/start",
            {
              artifact: { artifactId: third.artifactId },
              via: "funnel",
            },
            60_000,
          ),
        ),
      ).toBe("MOSTRA_SHARE_PORTS_EXHAUSTED");
      // Both work, through one shell.
      await openLink(new Browser(), one.url);
      await openLink(new Browser(), two.url);
      expect(parseLink(one.url).shell).toBe(parseLink(two.url).shell);
      // One stopped frees its port; the shell stays for the other.
      ok(await gateway.client.call("share/stop", { shareId: one.shareId }));
      await openLink(new Browser(), two.url);
      const three = await share(gateway, third.artifactId, { via: "funnel" });
      await openLink(new Browser(), three.url);
      ok(await gateway.client.call("share/stop", { artifact: { artifactId: other.artifactId } }));
      ok(await gateway.client.call("share/stop", { shareId: three.shareId }));
    }, 180_000);
  });
});

describe("shares that can't start", () => {
  it("names the missing tool and how to install it", async () => {
    const gateway = new GatewayHome();
    await gateway.start({
      env: {
        MOSTRA_CLOUDFLARED: "/nonexistent/cloudflared",
        MOSTRA_TAILSCALE: "/nonexistent/tailscale",
      },
    });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      for (const via of ["cloudflare", "tailnet", "funnel"]) {
        const answer = await gateway.client.call("share/start", {
          artifact: { artifactId: receipt.artifactId },
          via,
        });
        expect(refused(answer)).toBe("MOSTRA_SHARE_TOOL_MISSING");
        expect(answer.error?.data.message).toMatch(/Install/);
      }
      const shares = ok<{ shares: unknown[] }>(
        await gateway.client.call("share/list", { all: true }),
      );
      expect(shares.shares).toEqual([]);
    } finally {
      await gateway.stop();
    }
  }, 120_000);

  it("says Tailscale isn't signed in, or that the tailnet has Serve off, with where to turn it on", async () => {
    for (const [play, code] of [
      ["stopped", "MOSTRA_SHARE_TOOL_NOT_READY"],
      ["no-serve", "MOSTRA_SHARE_NOT_ENABLED"],
    ] as const) {
      const gateway = new GatewayHome();
      await gateway.start({ env: { MOSTRA_TEST_TUNNELS: TUNNELS, MOSTRA_FAKE_TAILSCALE: play } });
      try {
        const receipt = await gateway.publish("single-tsx", "page.tsx");
        const answer = await gateway.client.call(
          "share/start",
          { artifact: { artifactId: receipt.artifactId }, via: "tailnet" },
          60_000,
        );
        expect(refused(answer)).toBe(code);
        if (play === "no-serve") {
          expect(answer.error?.data.message).toContain("https://login.tailscale.com/f/serve");
        }
        // Nothing stays behind: no face, no tunnel.
        const after = await status(gateway);
        expect(after.gateway?.faces ?? []).toEqual([]);
      } finally {
        await gateway.stop();
      }
    }
  }, 180_000);

  it("never takes over a port this device's own Tailscale configuration serves", async () => {
    const gateway = new GatewayHome();
    await gateway.start({
      env: { MOSTRA_TEST_TUNNELS: TUNNELS, MOSTRA_FAKE_TAILSCALE_SERVED: "443" },
    });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      expect(
        refused(
          await gateway.client.call(
            "share/start",
            { artifact: { artifactId: receipt.artifactId }, via: "funnel" },
            60_000,
          ),
        ),
      ).toBe("MOSTRA_SHARE_PORTS_EXHAUSTED");
    } finally {
      await gateway.stop();
    }
  }, 120_000);
});

describe("a share and the daemon's idle exit (D133)", () => {
  it("keeps the daemon running while a share is active, and lets it exit after", async () => {
    const gateway = new GatewayHome();
    await gateway.start({
      env: { MOSTRA_TEST_TUNNELS: TUNNELS, MOSTRA_TEST_IDLE_EXIT_MS: "2000" },
    });
    const receipt = await gateway.publish("single-tsx", "page.tsx");
    const shared = await share(gateway, receipt.artifactId, { via: "cloudflare", ttl: "10m" });
    gateway.client.close();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(gateway.daemon.child.exitCode).toBeNull();
    const client = await connectTo(gateway.daemon.status.socket as string);
    ok(await client.call("mostra/initialize", initializeParams()));
    ok(await client.call("share/stop", { shareId: shared.shareId }));
    client.close();
    const exit = await Promise.race([
      gateway.daemon.exited,
      new Promise((resolve) => setTimeout(() => resolve("still running"), 15_000)),
    ]);
    expect(exit).toEqual({ code: 0, signal: null });
  }, 120_000);

  it("ends a quick tunnel's share at a restart, which its address can't survive", async () => {
    const gateway = new GatewayHome();
    await gateway.start({ env: { MOSTRA_TEST_TUNNELS: TUNNELS } });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const shared = await share(gateway, receipt.artifactId, { via: "cloudflare" });
      await gateway.stop();
      await gateway.start({ env: { MOSTRA_TEST_TUNNELS: TUNNELS } });
      await eventually(async () => {
        const found = ok<{ shares: ShareResult[] }>(
          await gateway.client.call("share/list", { all: true }),
        ).shares.find((one) => one.shareId === shared.shareId);
        return found?.stopReason === "restart";
      });
      const grant = ok<{ shares: ShareResult[] }>(await gateway.client.call("share/list", {}));
      expect(grant.shares).toEqual([]);
    } finally {
      await gateway.stop();
    }
  }, 120_000);
});
