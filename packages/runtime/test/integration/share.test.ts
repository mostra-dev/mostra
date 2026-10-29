/**
 * Shares through a real `mostra-runtime daemon` (HY-04, HY-05, HY-07, D158), over the test
 * tunnels (`MOSTRA_TEST_TUNNELS`: local stand-ins for `tailscale` and `cloudflared` that forward
 * on loopback as the real tools forward from their networks, add what each adds, and hold back
 * responses as quick tunnels do). The real tools are exercised by the external checks
 * (`test/external`, PROGRESS-WP-13).
 */
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MutationId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Answer, Browser, type Opened, openLink, parseLink, raw } from "../browser-client.ts";
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
  readonly artifactOrigin?: string;
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
      // The shell's own stream too, on the shell's face (Opus review of WP-13): asked of the face
      // itself, since the tunnel would hold a stream's answer back.
      const shellFace = ((await status(gateway)).gateway?.faces ?? []).find(
        (face) => face.origin === opened.link.shell,
      );
      expect(shellFace).toBeDefined();
      const shellHost = new URL(opened.link.shell).host;
      const path = `/a/${receipt.artifactId}/_mostra/v/2026-10-15/events?view=${opened.viewId}`;
      const shellStream = await raw(
        Number(new URL(shellFace?.local as string).port),
        `GET ${path} HTTP/1.1\r\nHost: ${shellHost}\r\nOrigin: ${opened.link.shell}\r\nSec-Fetch-Site: same-origin\r\nCookie: ${browser.cookiesFor(`${opened.link.shell}${path}`)}\r\nConnection: close\r\n\r\n`,
      );
      expect(shellStream.status).toBe(503);
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
      expect(listed.shares.find((one) => one.shareId === shared.shareId)?.url).toBe(shared.url);
      // Status names the share but never its link's secret: tools print it (Opus review).
      const inStatus = JSON.stringify(await status(gateway));
      expect(inStatus).toContain(shared.shareId);
      expect(inStatus).not.toContain(parseLink(shared.url).secret);
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
      // The share names the frame's address too: the second port the tailnet must allow.
      expect(shared.artifactOrigin).toBe(opened.frameOrigin);
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

/** A fresh daemon on the stand-ins, with a control directory and fixed Funnel ports. */
async function started(extra: Record<string, string> = {}): Promise<{
  gateway: GatewayHome;
  env: Record<string, string>;
  control: string;
}> {
  const control = mkdtempSync(join(tmpdir(), "mostra-fake-"));
  const env = {
    MOSTRA_TEST_TUNNELS: TUNNELS,
    MOSTRA_FAKE_CONTROL: control,
    // Above the lease range and below every ephemeral range in use: Funnel's three ports.
    MOSTRA_FAKE_FUNNEL_PORT_BASE: String(40000 + Math.floor(Math.random() * 5000) * 3),
    MOSTRA_TEST_SHARE_SWEEP_MS: "300",
    ...extra,
  };
  const gateway = new GatewayHome();
  await gateway.start({ env });
  return { gateway, env, control };
}
const tunnels = async (gateway: GatewayHome): Promise<string[]> =>
  ok<{ processes: { kind: string }[] }>(await gateway.client.call("instance/status", {}))
    .processes.map((child) => child.kind)
    .filter((kind) => kind.startsWith("tunnel-"));
const funnelPort = (env: Record<string, string>, origin: string | undefined): number =>
  Number(new URL(origin as string).port) - Number(env["MOSTRA_FAKE_FUNNEL_PORT_BASE"]);

describe("share lifecycles the GPT review of WP-13 found", () => {
  it("keeps a Funnel share's sessions across a restart: its faces' ports are leased", async () => {
    const { gateway, env } = await started();
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const shared = await share(gateway, receipt.artifactId, { via: "funnel" });
      const browser = new Browser();
      const opened = await openLink(browser, shared.url);
      await gateway.stop();
      await gateway.start({ env });
      await eventually(async () => {
        const faces = (await status(gateway)).gateway?.faces ?? [];
        return (
          faces.filter((face) => face.by === "funnel" && face.origin !== undefined).length === 2
        );
      }, 60_000);
      // The same browser, with the cookies it had: its shell session and its frame's still work.
      const shell = await browser.fetchJson(
        opened.link.shell,
        `/a/${receipt.artifactId}/_mostra/session`,
      );
      expect(shell.status).toBe(200);
      expect((await write(browser, opened, "after the restart")).status).toBe(200);
    } finally {
      await gateway.stop();
    }
  }, 240_000);

  it("gives a stopped artifact's Funnel port to the next one, and never the same port twice", async () => {
    const { gateway, env } = await started();
    try {
      const a = await gateway.publish("single-tsx", "page.tsx");
      const b = await gateway.publish("directory");
      const first = await share(gateway, a.artifactId, { via: "funnel" });
      expect(funnelPort(env, first.artifactOrigin)).toBe(1);
      ok(await gateway.client.call("share/stop", { shareId: first.shareId }));
      const second = await share(gateway, b.artifactId, { via: "funnel" });
      expect(funnelPort(env, second.artifactOrigin)).toBe(1);
      // A again: 8443 is B's now, so A takes 10000.
      const again = await share(gateway, a.artifactId, { via: "funnel" });
      expect(funnelPort(env, again.artifactOrigin)).toBe(2);
      await openLink(new Browser(), again.url);
      await openLink(new Browser(), second.url);
    } finally {
      await gateway.stop();
    }
  }, 240_000);

  it("leaves no tunnel running when one of a quick tunnel share's two fails", async () => {
    const { gateway } = await started({ MOSTRA_FAKE_CLOUDFLARED: "fail-one" });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const answer = await gateway.client.call(
        "share/start",
        { artifact: { artifactId: receipt.artifactId }, via: "cloudflare" },
        120_000,
      );
      expect(refused(answer)).toBe("MOSTRA_SHARE_TUNNEL_FAILED");
      // The other tunnel came up after the failure: it must not be left running.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await tunnels(gateway)).toEqual([]);
      expect((await status(gateway)).gateway?.faces ?? []).toEqual([]);
    } finally {
      await gateway.stop();
    }
  }, 120_000);

  it("leaves no tunnel running when a share stops while its tunnel is being set up again", async () => {
    const { gateway, control } = await started();
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const shared = await share(gateway, receipt.artifactId, { via: "funnel" });
      // The next start of a Tailscale tunnel takes 3 s; one of the share's tunnels ends now.
      writeFileSync(join(control, "slow"), "");
      writeFileSync(join(control, "die"), "");
      // Mostra starts it again after 1 s; the share stops while that start is under way.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      ok(await gateway.client.call("share/stop", { shareId: shared.shareId }));
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(await tunnels(gateway)).toEqual([]);
    } finally {
      await gateway.stop();
    }
  }, 120_000);

  it("follows its link when the link is rotated, and ends when it is revoked", async () => {
    const { gateway } = await started();
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const shared = await share(gateway, receipt.artifactId, { via: "cloudflare" });
      const rotated = ok<{ url: string; tokenId: string }>(
        await gateway.client.call("view/rotate", { tokenId: shared.tokenId }),
      );
      // The new link is at the share's own address, and the share follows it past a sweep.
      expect(parseLink(rotated.url).shell).toBe(parseLink(shared.url).shell);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const listed = ok<{ shares: ShareResult[] }>(
        await gateway.client.call("share/list", {}),
      ).shares;
      expect(listed.map((one) => [one.shareId, one.state, one.tokenId])).toEqual([
        [shared.shareId, "active", rotated.tokenId],
      ]);
      await openLink(new Browser(), rotated.url);
      ok(await gateway.client.call("view/revoke", { tokenId: rotated.tokenId }));
      await eventually(async () => {
        const all = ok<{ shares: ShareResult[] }>(
          await gateway.client.call("share/list", { all: true }),
        ).shares;
        return all[0]?.stopReason === "revoked";
      });
      // The share's end is recorded first; its tunnels stop right after.
      await eventually(async () => (await tunnels(gateway)).length === 0);
    } finally {
      await gateway.stop();
    }
  }, 120_000);
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

describe("share lifecycles the Opus review of WP-13 found", () => {
  /** The external port of a tailnet face (its leased port, D158 item 4). */
  const tailnetPort = async (gateway: GatewayHome, listener: string, artifactId: string) => {
    const face = ((await status(gateway)).gateway?.faces ?? []).find(
      (one) =>
        one.by === "tailnet" &&
        one.listener === listener &&
        (listener === "shell" || one.artifactId === artifactId),
    );
    return Number(new URL(face?.origin as string).port);
  };

  it("refuses a new share whose tunnel is being started again, rather than give it a dead one (Opus review)", async () => {
    const { gateway, control } = await started();
    try {
      const a = await gateway.publish("single-tsx", "page.tsx");
      const b = await gateway.publish("directory");
      await share(gateway, a.artifactId, { via: "tailnet" });
      const shell = await tailnetPort(gateway, "shell", a.artifactId);
      // The shell's tunnel ends and can't start again for now.
      writeFileSync(join(control, `refuse-${shell}`), "");
      writeFileSync(join(control, `die-${shell}`), "");
      await eventually(async () => (await tunnels(gateway)).length === 1, 10_000);
      const answer = await gateway.client.call(
        "share/start",
        { artifact: { artifactId: b.artifactId }, via: "tailnet" },
        60_000,
      );
      expect(refused(answer)).toBe("MOSTRA_SHARE_TUNNEL_FAILED");
      // Once Tailscale serves again, the tunnel is back and a new share goes through.
      unlinkSync(join(control, `refuse-${shell}`));
      await eventually(async () => (await tunnels(gateway)).length === 2, 30_000);
      await share(gateway, b.artifactId, { via: "tailnet" });
    } finally {
      await gateway.stop();
    }
  }, 120_000);

  it("never sets a share up again after it was stopped while its restart waited (Opus review)", async () => {
    const { gateway, env, control } = await started();
    try {
      const a = await gateway.publish("single-tsx", "page.tsx");
      const b = await gateway.publish("directory");
      const c = await gateway.publish("single-mdx", "page.mdx");
      const one = await share(gateway, a.artifactId, { via: "tailnet" });
      await share(gateway, b.artifactId, { via: "tailnet" });
      const portA = await tailnetPort(gateway, "artifact", a.artifactId);
      // After the restart, A's tunnel can't start yet: its share waits 5 s to try again.
      await gateway.stop();
      writeFileSync(join(control, `refuse-${portA}`), "");
      await gateway.start({ env });
      const log = (): string => {
        try {
          return readFileSync(join(gateway.home.home, "logs", "supervisor.log"), "utf8");
        } catch {
          return "";
        }
      };
      const said = (event: string): boolean =>
        log()
          .split("\n")
          .some((line) => line.includes(`"${event}"`) && line.includes(one.shareId));
      // A's first attempt failed; its next comes in 5 s.
      await eventually(async () => said("share.restore_failed"), 30_000);
      // Another share's start holds the lifecycle's turn, and A's stop waits behind it.
      writeFileSync(join(control, "hold"), "");
      const third = gateway.client.call(
        "share/start",
        { artifact: { artifactId: c.artifactId }, via: "tailnet" },
        120_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const stopping = gateway.client.call("share/stop", { shareId: one.shareId }, 120_000);
      // A's retry comes due while its stop is still waiting.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      unlinkSync(join(control, `refuse-${portA}`));
      unlinkSync(join(control, "hold"));
      ok(await third);
      ok(await stopping);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      // Nothing was set up again for the stopped share: shell, B and C.
      expect(said("share.restored")).toBe(false);
      expect(await tunnels(gateway)).toHaveLength(3);
      expect(
        ((await status(gateway)).gateway?.faces ?? []).some(
          (face) => face.by === "tailnet" && face.artifactId === a.artifactId,
        ),
      ).toBe(false);
    } finally {
      await gateway.stop();
    }
  }, 180_000);
});
