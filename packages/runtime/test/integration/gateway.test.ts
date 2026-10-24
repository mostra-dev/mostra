/**
 * The gateway through a real `mostra-runtime daemon` (WP-05): versions served with no process
 * (RT-05), only published files reachable (VR-03), links that outlive a week and survive restarts
 * (LL-05, SH-03), the loopback bind and the explicit wider one (HY-02), stable leases and a taken
 * port, and the methods `view/url`, `view/rotate` and `view/revoke` (HY-03).
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink, parseLink } from "../browser-client.ts";
import { GatewayHome, ok, type Receipt, refused } from "../gateway-home.ts";
import {
  eventually,
  listening,
  processTable,
  runBin,
  tempDir,
  testHome,
  WINDOWS,
} from "../support.ts";

const DAY = 86_400_000;

/** Every process below `pid`, from the operating system's process table. */
function descendants(pid: number): { pid: number; command: string }[] {
  const rows = processTable();
  const found: { pid: number; command: string }[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.ppid === parent) {
        found.push({ pid: row.pid, command: row.command });
        queue.push(row.pid);
      }
    }
  }
  return found;
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
    // The process table and the instance agree: no worker, builder or any other child. On Windows
    // the instance always runs one, its control pipe's helper behind its gate (D150 item 4), with
    // the console host Windows gives a console program.
    const status = await gateway.status();
    expect((status.processes as { kind: string }[]).map((child) => child.kind)).toEqual(
      WINDOWS ? ["control-pipe"] : [],
    );
    const below = descendants(gateway.daemon.child.pid as number);
    if (WINDOWS) {
      expect(below.length).toBeGreaterThan(0);
      for (const child of below) {
        expect(child.command).toMatch(/mostra-win(\.exe)?"? (gate|pipe)\b|conhost\.exe/i);
      }
    } else expect(below).toEqual([]);
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

  it("reaches no part of a mostra dev preview of the same source (VR-03, VR-08, D96)", async () => {
    const started = ok<{ url: string; port: number; sessionId: string }>(
      await gateway.client.call("dev/start", { source: { path: receipt.dir } }, 120_000),
    );
    try {
      const devShell = new URL(started.url).origin;
      const devOpened = await openLink(new Browser(), started.url);
      const devPorts = new Set([
        Number(new URL(devShell).port),
        Number(new URL(devOpened.frameOrigin).port),
      ]);
      // The viewer's link opens the published build, never the preview, while the preview runs.
      const browser = new Browser();
      const opened = await openLink(browser, receipt.url);
      expect(devPorts.has(Number(new URL(opened.frameOrigin).port))).toBe(false);
      expect(devPorts.has(Number(new URL(opened.link.shell).port))).toBe(false);
      expect(opened.page.body).not.toContain("@vite/client");
      // What the dev server serves isn't on any viewer origin.
      for (const path of [
        "/@vite/client",
        "/@react-refresh",
        "/source/index.tsx",
        "/.mostra-build/entry.js",
        "/@fs/",
        "/@id/react",
        "/__vite_ping",
      ]) {
        for (const origin of [opened.frameOrigin, opened.link.shell]) {
          const answer = await browser.ask({
            url: `${origin}${path}`,
            headers: { accept: "application/javascript" },
          });
          expect([400, 404], `${origin}${path}`).toContain(answer.status);
          expect(answer.body, path).not.toMatch(
            /import\.meta\.hot|createHotContext|export default/,
          );
        }
      }
      // A viewer's link is no key to the preview: its secret is unknown at the dev shell.
      const crossed = await new Browser().fetchJson(
        devShell,
        `/a/${receipt.artifactId}/_mostra/session`,
        { body: { token: opened.link.secret } },
      );
      expect(crossed.status).toBe(401);
      // And the instance lists no dev listener among the gateway's artifact origins.
      const listed = (await gateway.status()).gateway.artifacts.map((entry) => entry.origin);
      for (const origin of listed) expect(devPorts.has(Number(new URL(origin).port))).toBe(false);
    } finally {
      ok(await gateway.client.call("dev/stop", { sessionId: started.sessionId }));
    }
  }, 120_000);

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

  it("opens only the version a link names, and refuses one that doesn't exist (D97 item 9, Claude review finding 2)", async () => {
    const entry = join(receipt.dir, "index.tsx");
    writeFileSync(entry, readFileSync(entry, "utf8").replace("UNPUBLISHED-EDIT", "VERSION-TWO"));
    // A file only version 2 has, at a path the asset fallback of D98 item 5 would look in.
    mkdirSync(join(receipt.dir, "public", "assets"), { recursive: true });
    writeFileSync(join(receipt.dir, "public", "assets", "only-two.txt"), "VERSION-TWO-ONLY");
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
    // The pinned link can't ask for another version, existing or not.
    for (const version of [2, 9]) {
      const other = await browser.fetchJson(
        opened.link.shell,
        `/a/${receipt.artifactId}/_mostra/ticket`,
        { body: { version }, csrf: opened.shellCsrf },
      );
      expect(`${other.status} ${other.json<{ code: string }>().code}`, String(version)).toBe(
        "403 MOSTRA_HYGIENE_SCOPE_DENIED",
      );
    }
    // Nor reach version 2's files through the asset fallback of D98 item 5.
    const assets = (versionId: string): string[] =>
      readdirSync(join(gateway.home.home, "versions", versionId, "client", "assets"));
    const onlyInTwo = assets(second.versionId).filter(
      (name) => !assets(receipt.versionId).includes(name),
    );
    expect(onlyInTwo).toContain("only-two.txt");
    for (const name of onlyInTwo) {
      expect((await browser.ask({ url: `${opened.frameOrigin}/assets/${name}` })).status).toBe(404);
    }
    const inOne = assets(receipt.versionId)[0];
    expect((await browser.ask({ url: `${opened.frameOrigin}/assets/${inOne}` })).status).toBe(200);
    // The unpinned link reaches them, as D98 item 5 says.
    const full = new Browser();
    const latest = await openLink(full, receipt.url);
    expect((await full.ask({ url: `${latest.frameOrigin}/assets/${onlyInTwo[0]}` })).status).toBe(
      200,
    );
    expect(
      refused(
        await gateway.client.call("view/url", {
          artifact: { artifactId: receipt.artifactId },
          version: 9,
        }),
      ),
    ).toBe("MOSTRA_ARTIFACT_VERSION_NOT_FOUND");
    // An unpinned link asking for a version that doesn't exist gets 404.
    const unpinned = new Browser();
    const unpinnedOpen = await openLink(unpinned, receipt.url);
    const missing = await unpinned.fetchJson(
      unpinnedOpen.link.shell,
      `/a/${receipt.artifactId}/_mostra/ticket`,
      {
        body: { version: 9 },
        csrf: unpinnedOpen.shellCsrf,
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
    // Claude review finding 8: the same requestId with other parameters is refused, never
    // answered with the recorded (here wider) link.
    for (const params of [
      { requestId: "mint-1", scopes: ["view"] },
      { requestId: "mint-1", scopes: ["review"], ttl: "1h" },
      { requestId: "mint-1" },
    ]) {
      expect(
        refused(
          await gateway.client.call("view/url", {
            artifact: { artifactId: receipt.artifactId },
            ...params,
          }),
        ),
        JSON.stringify(params),
      ).toBe("MOSTRA_HOST_REQUEST_ID_REUSED");
    }
    // The same holds for every recorded method: a publish's requestId too.
    const published = await gateway.client.call(
      "artifact/publish",
      { source: { artifactId: receipt.artifactId }, requestId: "pub-1" },
      120_000,
    );
    expect(ok<Receipt>(published).artifactId).toBe(receipt.artifactId);
    expect(
      refused(
        await gateway.client.call(
          "artifact/publish",
          { source: { artifactId: receipt.artifactId }, requestId: "pub-1", force: true },
          120_000,
        ),
      ),
    ).toBe("MOSTRA_HOST_REQUEST_ID_REUSED");
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

describe("links work only at the address they were made for (D97 item 10)", () => {
  it("refuses an old link once the shell moved to another port, and a new link works", async () => {
    const gateway = await new GatewayHome().start();
    const receipt = await gateway.publish("single-tsx", "page.tsx");
    const old = parseLink(receipt.url);
    const shellPort = Number(new URL(old.shell).port);
    await gateway.stop();
    const squatter: Server = createServer((socket) =>
      socket.end("HTTP/1.1 200 OK\r\n\r\nsquatter"),
    );
    await new Promise<void>((resolve) => squatter.listen(shellPort, "127.0.0.1", resolve));
    try {
      await gateway.start();
      const status = await gateway.status();
      expect(status.gateway.shell).not.toBe(old.shell);
      // Whoever holds the old port could read the old link's secret: the gateway no longer takes it.
      const stolen = await new Browser().fetchJson(
        status.gateway.shell,
        `/a/${receipt.artifactId}/_mostra/session`,
        { body: { token: old.secret } },
      );
      expect(`${stolen.status} ${stolen.json<{ code: string }>().code}`).toBe(
        "410 MOSTRA_HYGIENE_TOKEN_REVOKED",
      );
      // The receipt of the next publish carries a default link at the new address.
      const again = ok<Receipt>(
        await gateway.client.call(
          "artifact/publish",
          { source: { artifactId: receipt.artifactId } },
          120_000,
        ),
      );
      expect(again.url.startsWith(`${status.gateway.shell}/`)).toBe(true);
      expect((await openLink(new Browser(), again.url)).page.status).toBe(200);
    } finally {
      squatter.close();
      await gateway.stop();
    }
  });
});

describe("the test clock (Claude review finding 11)", () => {
  it("ignores an offset that is negative, fractional or past ten years, and logs one in use", async () => {
    for (const value of ["-86400000", "1e20", "12.5"]) {
      const gateway = await new GatewayHome().start({
        env: { MOSTRA_TEST_CLOCK_OFFSET_MS: value },
      });
      try {
        const receipt = await gateway.publish("single-tsx", "page.tsx");
        const hour = await gateway.link(receipt.artifactId, { ttl: "1h" });
        // The real clock: the link expires an hour from now, and it opens.
        expect(Date.parse(hour.expiresAt ?? "") - Date.now()).toBeLessThan(3_700_000);
        expect(Date.parse(hour.expiresAt ?? "") - Date.now()).toBeGreaterThan(3_400_000);
        expect((await openLink(new Browser(), hour.url)).page.status).toBe(200);
        expect(
          logLines(gateway).some(
            (line) => line["event"] === "instance.test_clock_ignored" && line["value"] === value,
          ),
          value,
        ).toBe(true);
      } finally {
        await gateway.stop();
      }
    }
  });
});

describe("a runtime without its shell build", () => {
  it("still starts and serves frames; the shell's page says what is missing", async () => {
    const gateway = await new GatewayHome().start({
      env: { MOSTRA_SHELL_DIR: join(tmpdir(), "mostra-no-shell-here") },
    });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const browser = new Browser();
      const link = parseLink(receipt.url);
      const page = await browser.ask({
        url: `${link.shell}/a/${receipt.artifactId}`,
        headers: { accept: "application/json" },
      });
      expect(page.status).toBe(503);
      expect(page.json()).toMatchObject({ code: "MOSTRA_ENV_SHELL_MISSING" });
      expect(logLines(gateway).some((line) => line["code"] === "MOSTRA_ENV_SHELL_MISSING")).toBe(
        true,
      );
      // Everything but the shell's page still works: the exchange, the ticket and the frame.
      expect((await openLink(browser, receipt.url)).page.status).toBe(200);
    } finally {
      await gateway.stop();
    }
  });
});

describe("a damaged version (FAILURE_MODEL §3)", () => {
  it("is never shown: the ticket answers MOSTRA_HOME_INTEGRITY until a republish repairs it", async () => {
    const gateway = await new GatewayHome().start();
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      const version = join(gateway.home.home, "versions", receipt.versionId);
      chmodSync(version, 0o755);
      chmodSync(join(version, "client"), 0o755);
      chmodSync(join(version, "client", "index.html"), 0o644);
      writeFileSync(join(version, "client", "index.html"), "<p>tampered</p>");
      const browser = new Browser();
      const link = parseLink(receipt.url);
      const shell = await browser.fetchJson(
        link.shell,
        `/a/${receipt.artifactId}/_mostra/session`,
        {
          body: { token: link.secret },
        },
      );
      const csrf = shell.json<{ csrf: string }>().csrf;
      const ticket = await browser.fetchJson(
        link.shell,
        `/a/${receipt.artifactId}/_mostra/ticket`,
        {
          body: {},
          csrf,
        },
      );
      expect(ticket.status).toBe(500);
      expect(ticket.json()).toMatchObject({ code: "MOSTRA_HOME_INTEGRITY" });
      expect(ticket.body).not.toContain("tampered");
      // Publishing the source again rebuilds the directory (WP-03), and the version opens.
      const again = ok<Receipt>(
        await gateway.client.call(
          "artifact/publish",
          { source: { artifactId: receipt.artifactId } },
          120_000,
        ),
      );
      expect(again.reused).toBe(true);
      const viewer = new Browser();
      const opened = await openLink(viewer, receipt.url);
      expect(opened.page.status).toBe(200);
      expect(opened.page.body).not.toContain("tampered");
      // Claude review finding 5: a frame session that exists already, reloading after a restart
      // or a change while running, gets no damaged file either.
      for (const restart of [true, false]) {
        if (restart) await gateway.stop();
        chmodSync(version, 0o755);
        chmodSync(join(version, "client"), 0o755);
        chmodSync(join(version, "client", "index.html"), 0o644);
        writeFileSync(join(version, "client", "index.html"), "<p>tampered</p>");
        if (restart) await gateway.start();
        const reload = await viewer.navigate(`${opened.frameOrigin}/`, opened.link.shell);
        expect(reload.status, `restart: ${restart}`).toBe(500);
        expect(reload.body).not.toContain("<p>tampered</p>");
        expect(reload.body).toContain("MOSTRA_HOME_INTEGRITY");
        const repaired = ok<Receipt>(
          await gateway.client.call(
            "artifact/publish",
            { source: { artifactId: receipt.artifactId } },
            120_000,
          ),
        );
        expect(repaired.reused).toBe(true);
        expect((await viewer.navigate(`${opened.frameOrigin}/`, opened.link.shell)).status).toBe(
          200,
        );
      }
    } finally {
      await gateway.stop();
    }
  });
});

/**
 * Windows: what the firewall logged as blocked (event 5031, "blocked an application from
 * accepting incoming connections on the network": the event behind the "Windows Defender Firewall
 * has blocked some features of this app" prompt) since `since`, for programs whose path contains
 * `name`. Needs the firewall on and the Filtering Platform Connection audit, which the CI leg sets.
 */
function firewallBlocks(since: Date, name: string): string[] {
  const script = [
    `$since = [datetime]::Parse('${since.toISOString()}').ToLocalTime()`,
    `$events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 5031; StartTime = $since } -ErrorAction SilentlyContinue`,
    `$events | Where-Object { $_.Message -like '*${name}*' } | ForEach-Object { $_.Message.Replace([char]13, ' ').Replace([char]10, ' ') }`,
  ].join("; ");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return out.split(/\r?\n/).filter((line) => line.trim() !== "");
}

describe.runIf(WINDOWS)("the Windows firewall (RT-11, WP-W2)", () => {
  it("never blocks, and so never asks about, the loopback gateway; a wildcard listener it does (the control)", async () => {
    // Firewall rules and prompts are per program path, and the runner's own Node.js may already
    // have rules: each side runs on a copy of Node.js of its own, which the firewall has never
    // seen.
    const dir = tempDir("firewall", true);
    const tag = `mostra-fw-${process.pid}-${Date.now()}`;
    const controlNode = join(dir, `${tag}-control.exe`);
    const gatewayNode = join(dir, `${tag}-gateway.exe`);
    copyFileSync(process.execPath, controlNode);
    copyFileSync(process.execPath, gatewayNode);
    const since = new Date(Date.now() - 1000);

    // The control: the same Node.js listening on every interface is blocked, so a check that
    // finds nothing below is a real absence, not a firewall or an audit that is off.
    execFileSync(
      controlNode,
      [
        "-e",
        "const s = require('node:net').createServer(); s.listen(0, '0.0.0.0', () => setTimeout(() => s.close(), 2000));",
      ],
      { windowsHide: true },
    );
    await eventually(
      () => firewallBlocks(since, `${tag}-control`).length > 0,
      30_000,
      "the firewall's block of a wildcard listener (is the firewall on, and its audit?)",
    );

    // The gateway on its default bind: the shell and an artifact's listener, both bound.
    const gateway = await new GatewayHome().start({ node: gatewayNode });
    try {
      const receipt = await gateway.publish("single-tsx", "page.tsx");
      await openLink(new Browser(), receipt.url);
      // Judged by the firewall's own record alone, so a gateway that listened everywhere is caught
      // by what the firewall did (its addresses are "loopback only by default"'s to check; Opus
      // review of WP-W2, finding 8). The control's event arrived within seconds; give the
      // gateway's as long, and more.
      expect(listening(gateway.daemon.child.pid as number).length).toBeGreaterThanOrEqual(2);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      expect(firewallBlocks(since, `${tag}-gateway`)).toEqual([]);
    } finally {
      await gateway.stop();
    }
  }, 120_000);
});
