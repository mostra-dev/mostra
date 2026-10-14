/**
 * The gateway through a real `mostra-runtime daemon` (WP-05): versions served with no process
 * (RT-05), only published files reachable (VR-03), links that outlive a week and survive restarts
 * (LL-05, SH-03), the loopback bind and the explicit wider one (HY-02), stable leases and a taken
 * port, and the methods `view/url`, `view/rotate` and `view/revoke` (HY-03).
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink, parseLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import { runBin, testHome } from "../support.ts";

const DAY = 86_400_000;

/** Every process below `pid`, from the operating system's process table. */
function descendants(pid: number): { pid: number; command: string }[] {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }));
  const found: { pid: number; command: string }[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.ppid === parent && row.command !== "ps -A -o pid=,ppid=,command=") {
        found.push({ pid: row.pid, command: row.command });
        queue.push(row.pid);
      }
    }
  }
  return found;
}

/** The TCP addresses a process listens on, from the operating system (`lsof` or `ss`). */
function listening(pid: number): string[] {
  if (process.platform === "darwin") {
    const out = execFileSync(
      "lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      {
        encoding: "utf8",
      },
    );
    return out
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1));
  }
  const out = execFileSync("ss", ["-Hltnp"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.includes(`pid=${pid},`))
    .map((line) => line.trim().split(/\s+/)[3] ?? "");
}

/** The supervisor's log lines, parsed. */
function logLines(gateway: GatewayHome): Record<string, unknown>[] {
  const dir = join(gateway.home.home, "logs");
  return readdirSync(dir)
    .flatMap((file) => readFileSync(join(dir, file), "utf8").split("\n"))
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("serving versions (RT-05, VR-03)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start();
    receipt = await gateway.publish("directory");
  }, 180_000);
  afterAll(() => gateway.stop());

  it("serves a client-only version with no process: nothing runs below the supervisor", async () => {
    const browser = new Browser();
    const opened = await openLink(browser, receipt.url);
    expect(opened.page.status).toBe(200);
    // Every file the page loads, and a deep link inside its routes (D57).
    const assets = [...opened.page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (m) => m[1] as string,
    );
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect((await browser.ask({ url: `${opened.frameOrigin}${asset}` })).status, asset).toBe(200);
    }
    const deep = await browser.navigate(`${opened.frameOrigin}/reports/42`, opened.link.shell);
    expect(deep.status).toBe(200);
    expect(deep.body).toBe(opened.page.body);
    // The process table and the instance agree: no worker, builder or any other child.
    const status = await gateway.status();
    expect(status.processes).toEqual([]);
    expect(descendants(gateway.daemon.child.pid as number)).toEqual([]);
  });

  it("reaches nothing but the published client build (route enumeration)", async () => {
    const browser = new Browser();
    const opened = await openLink(browser, receipt.url);
    // Files that exist in the home but are not the client build: the source, the server bundle,
    // the version's records, the ledger, the snapshot.
    const outside = [
      "/index.tsx",
      "/pages/index.tsx",
      "/source/index.tsx",
      "/../source/index.tsx",
      "/server/entry.mjs",
      "/registry.json",
      "/manifest.json",
      "/lock.yaml",
      "/../registry.json",
      "/..%2fregistry.json",
      "/%2e%2e/registry.json",
      "/assets/../../registry.json",
      `/../../../sources/${receipt.artifactId}`,
      "/../../../store/ledger.sqlite",
      "/_mostra/",
      "/_mostra/shell/index.html",
      "/.mostra",
    ];
    for (const path of outside) {
      const answer = await browser.ask({
        url: `${opened.frameOrigin}${path}`,
        headers: { accept: "application/json" },
      });
      expect([400, 404], path).toContain(answer.status);
      expect(answer.body, path).not.toMatch(
        /export default|"use server"|schemaVersion|SQLite format/,
      );
    }
    // The shell origin serves its own page and assets, and nothing of any artifact.
    for (const path of [
      "/",
      "/index.html",
      "/assets/",
      `/a/${receipt.artifactId}/index.tsx`,
      "/_mostra/shell/../index.html",
    ]) {
      const answer = await browser.ask({
        url: `${opened.link.shell}${path}`,
        headers: { accept: "application/json" },
      });
      expect([400, 404], path).toContain(answer.status);
    }
  });

  it("never shows source edits until they are published (VR-03, D09)", async () => {
    const browser = new Browser();
    const opened = await openLink(browser, receipt.url);
    const before = opened.page.body;
    const entry = join(receipt.dir, "index.tsx");
    writeFileSync(
      entry,
      `${readFileSync(entry, "utf8")}\nexport const unpublished = "UNPUBLISHED-EDIT";\n`,
    );
    const page = await browser.navigate(`${opened.frameOrigin}/`, opened.link.shell);
    expect(page.body).toBe(before);
    for (const asset of [...page.body.matchAll(/src="(\/assets\/[^"]+)"/g)].map(
      (m) => m[1] as string,
    )) {
      expect((await browser.ask({ url: `${opened.frameOrigin}${asset}` })).body).not.toContain(
        "UNPUBLISHED-EDIT",
      );
    }
  });

  it("opens no artifact that has never been published", async () => {
    const dir = join(gateway.home.home, "..", "created");
    const created = ok<{ artifactId: string }>(
      await gateway.client.call("artifact/create", { dir }),
    );
    expect(
      refused(
        await gateway.client.call("view/url", { artifact: { artifactId: created.artifactId } }),
      ),
    ).toBe("MOSTRA_ARTIFACT_NOT_FOUND");
    // A guessed shell URL for it is a page with nothing in it, and its API knows no session.
    const browser = new Browser();
    const shell = await browser.navigate(`${parseLink(receipt.url).shell}/a/${created.artifactId}`);
    expect(shell.status).toBe(200);
    expect(shell.body).not.toContain(created.artifactId);
    expect(
      (
        await browser.fetchJson(
          parseLink(receipt.url).shell,
          `/a/${created.artifactId}/_mostra/session`,
        )
      ).status,
    ).toBe(401);
  });

  it("pins a version when the link names one, and refuses one that doesn't exist", async () => {
    const entry = join(receipt.dir, "index.tsx");
    writeFileSync(entry, readFileSync(entry, "utf8").replace("UNPUBLISHED-EDIT", "VERSION-TWO"));
    const second = ok<Receipt>(
      await gateway.client.call("artifact/publish", { source: { path: receipt.dir } }, 120_000),
    );
    expect(second.version).toBe(2);
    expect(second.url).toBe(receipt.url);
    const pinned = await gateway.link(receipt.artifactId, { version: 1 });
    expect(pinned.url).toContain(`/a/${receipt.artifactId}/v/1#t=`);
    const browser = new Browser();
    const opened = await openLink(browser, pinned.url);
    const ticket = await browser.fetchJson(
      opened.link.shell,
      `/a/${receipt.artifactId}/_mostra/ticket`,
      {
        body: {},
        csrf: opened.shellCsrf,
      },
    );
    expect(ticket.json()).toMatchObject({ version: { number: 1 }, latest: { number: 2 } });
    expect(
      refused(
        await gateway.client.call("view/url", {
          artifact: { artifactId: receipt.artifactId },
          version: 9,
        }),
      ),
    ).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
    const missing = await browser.fetchJson(
      opened.link.shell,
      `/a/${receipt.artifactId}/_mostra/ticket`,
      {
        body: { version: 9 },
        csrf: opened.shellCsrf,
      },
    );
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ code: "MOSTRA_ARTIFACT_VERSION_NOT_FOUND" });
  });
});

describe("links outlive restarts and a week (LL-05, SH-03)", () => {
  const gateway = new GatewayHome();
  let receipt: Receipt;
  let holder: Browser;
  let shellOrigin: string;
  let frameOrigin: string;

  beforeAll(async () => {
    await gateway.start();
    receipt = await gateway.publish("single-tsx", "page.tsx");
    holder = new Browser();
    const opened = await openLink(holder, receipt.url);
    shellOrigin = opened.link.shell;
    frameOrigin = opened.frameOrigin;
  }, 180_000);
  afterAll(() => gateway.stop());

  it("keeps ports and sessions across a restart: the open frame reloads with no new link", async () => {
    await gateway.stop();
    await gateway.start();
    const status = await gateway.status();
    expect(status.gateway.shell).toBe(shellOrigin);
    // The leased artifact port is bound at start, before anyone asks for it (D99).
    expect(status.gateway.artifacts).toEqual([
      { artifactId: receipt.artifactId, origin: frameOrigin },
    ]);
    expect((await holder.navigate(`${frameOrigin}/`, shellOrigin)).status).toBe(200);
    expect(
      (await holder.fetchJson(shellOrigin, `/a/${receipt.artifactId}/_mostra/session`)).status,
    ).toBe(200);
    const again = ok<Receipt>(
      await gateway.client.call(
        "artifact/publish",
        { source: { artifactId: receipt.artifactId } },
        120_000,
      ),
    );
    expect(again.url).toBe(receipt.url);
  });

  it("opens a link minted without a lifetime after a week of simulated time; a 24h link has expired", async () => {
    const day = await gateway.link(receipt.artifactId, { ttl: "24h" });
    const forever = await gateway.link(receipt.artifactId);
    expect(forever.expiresAt).toBeUndefined();
    expect(day.expiresAt).toBeDefined();
    await gateway.stop();
    await gateway.start({ env: { MOSTRA_TEST_CLOCK_OFFSET_MS: String(8 * DAY) } });
    expect((await openLink(new Browser(), forever.url)).page.status).toBe(200);
    expect((await openLink(new Browser(), receipt.url)).page.status).toBe(200);
    expect((await holder.navigate(`${frameOrigin}/`, shellOrigin)).status).toBe(200);
    const expired = await new Browser().fetchJson(
      shellOrigin,
      `/a/${receipt.artifactId}/_mostra/session`,
      {
        body: { token: parseLink(day.url).secret },
      },
    );
    expect(expired.status).toBe(410);
    expect(expired.json()).toMatchObject({ code: "MOSTRA_HYGIENE_TOKEN_REVOKED" });
  });

  it("still revokes and rotates a week-old link", async () => {
    const link = await gateway.link(receipt.artifactId);
    const rotated = ok<{ url: string; tokenId: string }>(
      await gateway.client.call("view/rotate", { tokenId: link.tokenId }),
    );
    expect((await openLink(new Browser(), rotated.url)).page.status).toBe(200);
    ok(await gateway.client.call("view/revoke", { tokenId: rotated.tokenId }));
    const gone = await new Browser().fetchJson(
      shellOrigin,
      `/a/${receipt.artifactId}/_mostra/session`,
      {
        body: { token: parseLink(rotated.url).secret },
      },
    );
    expect(gone.status).toBe(410);
    expect(
      refused(
        await gateway.client.call("view/revoke", { tokenId: "tok_01JB8Z3QF6S7W3N8D5K2C4V9XG" }),
      ),
    ).toBe("MOSTRA_HYGIENE_TOKEN_INVALID");
  });

  it("rotates the default link: receipts carry the new one and the old one answers 410", async () => {
    const rotated = ok<{ url: string; tokenId: string }>(
      await gateway.client.call("view/rotate", { tokenId: receipt.tokenId }),
    );
    const again = ok<Receipt>(
      await gateway.client.call(
        "artifact/publish",
        { source: { artifactId: receipt.artifactId } },
        120_000,
      ),
    );
    expect(again.url).toBe(rotated.url);
    expect(again.tokenId).toBe(rotated.tokenId);
    expect((await holder.navigate(`${frameOrigin}/`, shellOrigin)).status).toBe(410);
  });

  it("replays view/url by requestId without storing the link's secret", async () => {
    const first = await gateway.link(receipt.artifactId, {
      requestId: "mint-1",
      scopes: ["review"],
    });
    const replay = await gateway.link(receipt.artifactId, {
      requestId: "mint-1",
      scopes: ["review"],
    });
    expect(replay).toEqual(first);
    await gateway.stop();
    const ledger = readFileSync(join(gateway.home.home, "store", "ledger.sqlite")).toString(
      "latin1",
    );
    expect(ledger.includes(parseLink(first.url).secret)).toBe(false);
    await gateway.start({ env: { MOSTRA_TEST_CLOCK_OFFSET_MS: String(8 * DAY) } });
  });
});

describe("binding (HY-02, D99)", () => {
  it("listens on loopback only by default (socket inspection)", async () => {
    const gateway = await new GatewayHome().start();
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      // An artifact's listener opens with its first frame: open one, so both kinds are bound.
      await openLink(new Browser(), receipt.url);
      const pid = gateway.daemon.child.pid as number;
      const addresses = listening(pid);
      expect(addresses.length).toBeGreaterThanOrEqual(2);
      for (const address of addresses) expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
    } finally {
      await gateway.stop();
    }
  });

  it("binds wider only with --bind, which a wildcard pairs with --url-host", async () => {
    const home = testHome();
    const refusedStart = runBin(["daemon", "--home", home.home, "--bind", "0.0.0.0"], home.env);
    expect((await refusedStart.exited).code).toBe(3);
    const gateway = await new GatewayHome(home).start({
      args: ["--bind", "0.0.0.0", "--url-host", "127.0.0.1"],
    });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      expect(receipt.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\//);
      expect((await openLink(new Browser(), receipt.url)).page.status).toBe(200);
      const addresses = listening(gateway.daemon.child.pid as number);
      expect(addresses.length).toBeGreaterThanOrEqual(2);
      for (const address of addresses) expect(address).toMatch(/^(\*|0\.0\.0\.0):\d+$/);
      expect((await gateway.status()).gateway.bind).toBe("0.0.0.0");
    } finally {
      await gateway.stop();
    }
    // The flag isn't remembered: the next plain start is loopback again.
    const plain = await new GatewayHome(home).start();
    try {
      const addresses = listening(plain.daemon.child.pid as number);
      // The shell and the artifact's leased port, both rebound at start.
      expect(addresses.length).toBeGreaterThanOrEqual(2);
      for (const address of addresses) expect(address).toMatch(/^127\.0\.0\.1:/);
    } finally {
      await plain.stop();
    }
  });
});

describe("a leased port another program took (FAILURE_MODEL §8)", () => {
  it("leases a new port, says so, and a fresh link works", async () => {
    const gateway = await new GatewayHome().start();
    const receipt = await gateway.publish("single-tsx", "page.tsx");
    const opened = await openLink(new Browser(), receipt.url);
    const framePort = Number(new URL(opened.frameOrigin).port);
    await gateway.stop();
    const squatter: Server = createServer((socket) =>
      socket.end("HTTP/1.1 200 OK\r\n\r\nsquatter"),
    );
    await new Promise<void>((resolve) => squatter.listen(framePort, "127.0.0.1", resolve));
    try {
      await gateway.start();
      const status = await gateway.status();
      const moved = status.gateway.artifacts.find(
        (entry) => entry.artifactId === receipt.artifactId,
      );
      expect(moved?.origin).toBeDefined();
      expect(moved?.origin).not.toBe(opened.frameOrigin);
      expect(logLines(gateway).some((line) => line["code"] === "MOSTRA_ENV_PORT_TAKEN")).toBe(true);
      expect((await openLink(new Browser(), receipt.url)).frameOrigin).toBe(moved?.origin);
    } finally {
      squatter.close();
      await gateway.stop();
    }
  });
});
