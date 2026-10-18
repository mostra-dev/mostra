/**
 * `mostra dev` through a real daemon (VR-08, D140 item 12): a development preview of unpublished
 * source in a real browser, with Vite's hot module replacement through the gateway's checks,
 * server code that runs for real and restarts when it changes, submissions reported to the
 * session's connection and delivered nowhere, and a session that ends with its connection and
 * leaves nothing behind. What viewers can and can't reach is VR-03's enumeration in
 * `gateway.test.ts`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser as Client, openLink, raw } from "../browser-client.ts";
import { writeDevFixture } from "../dev-fixture.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { FIXTURE_PACKAGES, startRegistry } from "../registry.ts";
import {
  connectTo,
  eventually,
  initializeParams,
  type LineClient,
  listening,
  tempDir,
  testHome,
} from "../support.ts";

interface DevEvent {
  readonly sessionId: string;
  readonly kind: string;
  readonly files?: readonly string[];
  readonly results?: { readonly answers: Record<string, unknown> };
}

describe("mostra dev (VR-08)", () => {
  const gateway = new GatewayHome();
  let browser: Browser;
  let client: LineClient;
  let dir = "";
  const events: DevEvent[] = [];

  beforeAll(async () => {
    await gateway.start();
    browser = await chromium.launch();
    dir = join(tempDir("dev"), "preview");
    writeDevFixture(dir);
    client = await devClient();
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    await gateway.stop();
  });

  /** A connection that hears `dev/notify`, as the CLI's does. */
  async function devClient(): Promise<LineClient> {
    const connection = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await connection.call(
        "mostra/initialize",
        initializeParams({ capabilities: { notifications: ["dev/notify"] } }),
      ),
    );
    void (async () => {
      for (;;) {
        const message = await connection
          .next((m) => m.method === "dev/notify", 600_000)
          .catch(() => undefined);
        if (!message) return;
        events.push((message as unknown as { params: DevEvent }).params);
      }
    })();
    return connection;
  }

  it("previews the source in a browser and updates it in place when the source changes", async () => {
    const started = ok<{ url: string; port: number; sessionId: string }>(
      await client.call("dev/start", { source: { path: dir } }, 120_000),
    );
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_[0-9A-Z]{26}\/v\/1#t=/);
    const page = await browser.newPage();
    await page.goto(started.url);
    // The shell says it's a preview, for as long as the view lasts.
    await expect
      .poll(() => page.locator("[data-mostra-dev-preview]").innerText(), { timeout: 30_000 })
      .toBe("Development preview, not published");
    const frame = page.frameLocator("iframe");
    await expect
      .poll(() => frame.locator("#title").innerText(), { timeout: 30_000 })
      .toBe("HEADING-ONE");
    // A marker the page keeps unless it loads again.
    const handle = page.frames().find((candidate) => candidate !== page.mainFrame());
    await handle?.evaluate(() => {
      (window as unknown as { marker: number }).marker = 1;
    });
    writeDevFixture(dir, "HEADING-TWO");
    await expect
      .poll(() => frame.locator("#title").innerText(), { timeout: 30_000 })
      .toBe("HEADING-TWO");
    // Hot module replacement: the module changed in place, the page didn't load again.
    expect(await handle?.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
    await eventually(() =>
      events.some((event) => event.kind === "built" && event.files?.includes("index.tsx")),
    );
    await page.close();
  }, 120_000);

  it("runs server code for real, and restarts it when it changes", async () => {
    const page = await browser.newPage();
    const url = ok<{ url: string }>(
      await client.call("dev/start", { source: { path: dir } }, 120_000),
    ).url;
    await page.goto(url);
    const frame = page.frameLocator("iframe");
    await frame.locator("#call").click({ timeout: 30_000 });
    await expect
      .poll(() => frame.locator("#server").innerText(), { timeout: 30_000 })
      .toBe("SERVER-ONE");
    // A value the page saved survives the reload a server change causes: the session's scratch
    // ledger holds it for the session's life.
    await frame.locator("#answer").fill("kept across reloads");
    await page.waitForTimeout(800);
    writeDevFixture(dir, "HEADING-TWO", "SERVER-TWO");
    await eventually(() => events.some((event) => event.kind === "server-restarted"), 60_000);
    // The page loaded again with the new server code behind it.
    await expect
      .poll(
        async () => {
          await frame
            .locator("#call")
            .click({ timeout: 5000 })
            .catch(() => {});
          return frame
            .locator("#server")
            .innerText({ timeout: 5000 })
            .catch(() => "");
        },
        { timeout: 60_000 },
      )
      .toBe("SERVER-TWO");
    expect(await frame.locator("#answer").inputValue()).toBe("kept across reloads");
    await page.close();
  }, 180_000);

  it("starts live producers again in the new worker when server code changes (GPT review finding 3)", async () => {
    const liveDir = join(tempDir("dev-live"), "preview");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(
      join(liveDir, "index.tsx"),
      `import { defineArtifact, useLive } from "@mostra/react";\nexport const artifact = defineArtifact({ title: "Live" });\nexport default function Page() {\n  const { data } = useLive("reading");\n  return <p id="reading">{String(data ?? "")}</p>;\n}\n`,
    );
    const writeLive = (value: string): void =>
      writeFileSync(
        join(liveDir, "live.ts"),
        `import { defineLive } from "@mostra/server";\nexport const reading = defineLive({ refresh: "1s", load: async () => "${value}" });\n`,
      );
    writeLive("LIVE-ONE");
    const owner = await devClient();
    const started = ok<{ url: string; sessionId: string }>(
      await owner.call("dev/start", { source: { path: liveDir } }, 120_000),
    );
    const page = await browser.newPage();
    await page.goto(started.url);
    const frame = page.frameLocator("iframe");
    const reading = (): Promise<string> =>
      frame
        .locator("#reading")
        .innerText({ timeout: 5000 })
        .catch(() => "");
    await expect.poll(reading, { timeout: 30_000 }).toBe("LIVE-ONE");
    writeLive("LIVE-TWO");
    await eventually(
      () =>
        events.some(
          (event) => event.sessionId === started.sessionId && event.kind === "server-restarted",
        ),
      60_000,
      "the server restarted",
    );
    await expect.poll(reading, { timeout: 30_000 }).toBe("LIVE-TWO");
    await page.close();
    ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
    owner.close();
  }, 180_000);

  it("serves a page added under pages/ without a restart (GPT review finding 4)", async () => {
    const pagesDir = join(tempDir("dev-pages"), "preview");
    mkdirSync(join(pagesDir, "pages"), { recursive: true });
    writeFileSync(
      join(pagesDir, "index.tsx"),
      `import { defineArtifact } from "@mostra/react";\nexport const artifact = defineArtifact({ title: "Pages" });\n`,
    );
    writeFileSync(
      join(pagesDir, "pages", "index.tsx"),
      `export default function Home() {\n  return <h1 id="page">HOME</h1>;\n}\n`,
    );
    const owner = await devClient();
    const started = ok<{ url: string; sessionId: string }>(
      await owner.call("dev/start", { source: { path: pagesDir } }, 120_000),
    );
    const page = await browser.newPage();
    await page.goto(started.url);
    const frame = page.frameLocator("iframe");
    const heading = (): Promise<string> =>
      frame
        .locator("#page")
        .innerText({ timeout: 5000 })
        .catch(() => "");
    await expect.poll(heading, { timeout: 30_000 }).toBe("HOME");
    writeFileSync(
      join(pagesDir, "pages", "about.tsx"),
      `export default function About() {\n  return <h1 id="page">ABOUT</h1>;\n}\n`,
    );
    await eventually(
      () =>
        events.some(
          (event) =>
            event.sessionId === started.sessionId &&
            event.kind === "built" &&
            (event.files ?? []).includes("pages/about.tsx"),
        ),
      30_000,
      "the new page built",
    );
    // The open page follows its route table without being told: a link to the new page works.
    await expect
      .poll(
        async () => {
          await frame
            .locator("body")
            .evaluate(() => {
              if (location.pathname !== "/about") location.assign("/about");
            })
            .catch(() => {});
          return heading();
        },
        { timeout: 30_000 },
      )
      .toBe("ABOUT");
    await page.close();
    ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
    owner.close();
  }, 180_000);

  it("reports server code that doesn't build, and runs it again once it does", async () => {
    const owner = await devClient();
    const started = ok<{ url: string; sessionId: string }>(
      await owner.call("dev/start", { source: { path: dir } }, 120_000),
    );
    const mine = (kind: string): boolean =>
      events.some((event) => event.sessionId === started.sessionId && event.kind === kind);
    writeFileSync(
      join(dir, "actions.ts"),
      `"use server";\nexport async function whoAmI() {\n  return (;\n}\n`,
    );
    await eventually(() => mine("diagnostics"), 60_000, "the build's diagnostics");
    const reported = events.find(
      (event) => event.sessionId === started.sessionId && event.kind === "diagnostics",
    ) as unknown as { diagnostics: { code: string }[] };
    expect(reported.diagnostics.length).toBeGreaterThan(0);
    writeDevFixture(dir, "HEADING-TWO", "SERVER-THREE");
    await eventually(() => mine("server-restarted"), 60_000, "the server's restart");
    ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
    owner.close();
  }, 180_000);

  it("reports a submission with its Results, and delivers nothing to the home", async () => {
    const page = await browser.newPage();
    const url = ok<{ url: string }>(
      await client.call("dev/start", { source: { path: dir } }, 120_000),
    ).url;
    await page.goto(url);
    const frame = page.frameLocator("iframe");
    await frame.locator("#answer").fill("from the preview", { timeout: 30_000 });
    await frame.locator("#submit").click();
    await eventually(() => events.some((event) => event.kind === "submission"), 30_000);
    const submitted = events.find((event) => event.kind === "submission");
    expect(submitted?.results?.answers).toEqual({ answer: "from the preview" });
    // The home holds no artifact, version, submission or event of the preview.
    expect(
      ok<{ artifacts: unknown[] }>(await gateway.client.call("artifact/list", {})).artifacts,
    ).toEqual([]);
    const read = ok<{ events: { type: string }[] }>(await gateway.client.call("events/read", {}));
    expect(read.events.filter((event) => !event.type.startsWith("token."))).toEqual([]);
    await page.close();
  }, 120_000);

  it("ends with its connection and leaves nothing behind", async () => {
    const owner = await devClient();
    const started = ok<{ url: string; sessionId: string }>(
      await owner.call("dev/start", { source: { path: dir } }, 120_000),
    );
    const session = join(gateway.home.home, "cache", "dev", started.sessionId);
    expect(existsSync(session)).toBe(true);
    const shell = new URL(started.url).origin;
    owner.close();
    await eventually(() => !existsSync(session), 30_000);
    await expect(fetch(`${shell}/a/x`)).rejects.toThrow();
    // No builder or worker of the session outlives it (the others' sessions keep theirs).
    await eventually(async () => {
      const status = ok<{ processes: { ownerRef: string }[] }>(
        await gateway.client.call("instance/status", {}),
      );
      return !status.processes.some((process) => process.ownerRef.includes(started.sessionId));
    }, 30_000);
  }, 120_000);

  it.each([150, 600, 1500])(
    "leaves nothing behind when its connection closes while it starts (%i ms in, GPT review finding 1)",
    async (delayMs) => {
      const devDir = join(gateway.home.home, "cache", "dev");
      const before = new Set(existsSync(devDir) ? readdirSync(devDir) : []);
      const builders = async (): Promise<string[]> =>
        ok<{ processes: { kind: string; ownerRef: string }[] }>(
          await gateway.client.call("instance/status", {}),
        )
          .processes.filter((process) => process.kind === "builder")
          .map((process) => process.ownerRef);
      const running = new Set(await builders());
      const owner = await devClient();
      // The answer never arrives: the connection is gone before it.
      void owner.call("dev/start", { source: { path: dir } }, 120_000).catch(() => undefined);
      await new Promise((done) => setTimeout(done, delayMs));
      owner.close();
      const added = (): string[] =>
        (existsSync(devDir) ? readdirSync(devDir) : []).filter((name) => !before.has(name));
      await eventually(() => added().length === 0, 30_000, "the session's directory gone");
      await eventually(
        async () => (await builders()).every((ref) => running.has(ref)),
        30_000,
        "no dev server of the session",
      );
      // Still none a little later: nothing finished starting after the cleanup.
      await new Promise((done) => setTimeout(done, 3000));
      expect(added()).toEqual([]);
      expect((await builders()).every((ref) => running.has(ref))).toBe(true);
    },
    120_000,
  );

  it("refuses dev/stop from a connection that didn't start the session", async () => {
    const owner = await devClient();
    const started = ok<{ sessionId: string }>(
      await owner.call("dev/start", { source: { path: dir } }, 120_000),
    );
    const other = await gateway.client.call("dev/stop", { sessionId: started.sessionId });
    expect(other.error?.data.code).toBe("MOSTRA_HOST_INVALID_PARAMS");
    ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
    owner.close();
  }, 120_000);

  it("keeps its listeners to loopback and its secrets to itself: rebinding, other origins, no session, the dev server itself", async () => {
    const owner = await devClient();
    const started = ok<{ url: string; sessionId: string }>(
      await owner.call("dev/start", { source: { path: dir } }, 120_000),
    );
    const viewer = new Client();
    const opened = await openLink(viewer, started.url);
    expect(opened.page.status).toBe(200);
    const artifactPort = Number(new URL(opened.frameOrigin).port);
    const shellPort = Number(new URL(started.url).port);
    // Every listener of the session, the dev server's included, is on loopback.
    const status = ok<{ processes: { pid: number; kind: string }[] }>(
      await gateway.client.call("instance/status", {}),
    );
    const builder = status.processes.find((process) => process.kind === "builder");
    expect(builder).toBeDefined();
    const vite = listening(builder?.pid as number);
    expect(vite.length).toBe(1);
    for (const address of [...vite, ...listening(gateway.daemon.child.pid as number)]) {
      expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
    }
    const vitePort = Number(vite[0]?.split(":")[1]);
    // The dev server answers nothing without the session's secret: not a page, not a module, not
    // an HMR socket.
    for (const path of ["/", "/@vite/client", "/source/index.tsx", "/source/actions.ts"]) {
      const direct = await raw(
        vitePort,
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${vitePort}\r\n\r\n`,
      );
      expect(direct.status, path).toBe(403);
      expect(direct.text, path).not.toMatch(/whoAmI|SERVER-|HEADING-/);
    }
    const directSocket = await raw(
      vitePort,
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${vitePort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`,
    );
    expect(directSocket.status).not.toBe(101);
    // The gateway's checks come first on the artifact origin: another Host (DNS rebinding), no
    // session, another Origin on the HMR socket.
    const rebinding = await raw(
      artifactPort,
      `GET /source/index.tsx HTTP/1.1\r\nHost: attacker.example:${artifactPort}\r\n\r\n`,
    );
    expect(rebinding.status).toBe(421);
    expect(rebinding.text).not.toMatch(/HEADING-/);
    const anonymous = await new Client().ask({
      url: `${opened.frameOrigin}/source/index.tsx`,
      headers: { accept: "application/javascript" },
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).not.toMatch(/HEADING-/);
    const upgrade = (origin: string, cookie: string): Promise<{ status: number }> =>
      raw(
        artifactPort,
        `GET /?token=x HTTP/1.1\r\nHost: 127.0.0.1:${artifactPort}\r\nOrigin: ${origin}\r\n${cookie ? `Cookie: ${cookie}\r\n` : ""}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`,
      );
    const cookie = viewer.cookiesFor(`${opened.frameOrigin}/`);
    expect(cookie).not.toBe("");
    expect((await upgrade("http://attacker.example", cookie)).status).toBe(403);
    expect((await upgrade(opened.frameOrigin, "")).status).toBe(401);
    // The preview's link is no key to the home's shell (and VR-03 checks the other way round).
    const homeShell = ok<{ gateway: { shell: string } }>(
      await gateway.client.call("instance/status", {}),
    ).gateway.shell;
    const devSecret = new URLSearchParams(new URL(started.url).hash.slice(1)).get("t");
    const artifactId = /\/a\/(art_[0-9A-Z]{26})/.exec(started.url)?.[1] as string;
    const crossed = await new Client().fetchJson(homeShell, `/a/${artifactId}/_mostra/session`, {
      body: { token: devSecret },
    });
    expect(crossed.status).toBe(401);
    expect(shellPort).not.toBe(Number(new URL(homeShell).port));
    ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
    owner.close();
  }, 120_000);

  it("refuses to run beside a gateway bound wider than loopback", async () => {
    const wide = await new GatewayHome(testHome()).start({
      args: ["--bind", "0.0.0.0", "--url-host", "127.0.0.1"],
    });
    try {
      const answer = await wide.client.call("dev/start", { source: { path: dir } }, 60_000);
      expect(answer.error?.data.code).toBe("MOSTRA_ENV_BIND_FAILED");
    } finally {
      await wide.stop();
    }
  }, 120_000);
});

describe("mostra dev's packages and leftovers (VR-08)", () => {
  it("loads every page again when mostra add changes the packages, and the new package resolves", async () => {
    const registry = await startRegistry(FIXTURE_PACKAGES);
    const home = testHome();
    const gateway = new GatewayHome(home);
    const browser = await chromium.launch();
    try {
      await gateway.start({
        env: { HOME: tempDir("dev-user"), npm_config_registry: registry.url },
      });
      const dir = join(tempDir("dev-add"), "preview");
      writeDevFixture(dir);
      const events: DevEvent[] = [];
      const owner = await connectTo(gateway.daemon.status.socket as string);
      ok(
        await owner.call(
          "mostra/initialize",
          initializeParams({ capabilities: { notifications: ["dev/notify"] } }),
        ),
      );
      void (async () => {
        for (;;) {
          const message = await owner
            .next((m) => m.method === "dev/notify", 600_000)
            .catch(() => undefined);
          if (!message) return;
          events.push((message as unknown as { params: DevEvent }).params);
        }
      })();
      const started = ok<{ url: string; sessionId: string }>(
        await owner.call("dev/start", { source: { path: dir } }, 120_000),
      );
      const page = await browser.newPage();
      await page.goto(started.url);
      const frame = page.frameLocator("iframe");
      await expect
        .poll(() => frame.locator("#title").innerText(), { timeout: 30_000 })
        .toBe("HEADING-ONE");
      ok(
        await gateway.client.call(
          "deps/add",
          { artifact: { path: dir }, packages: ["mostra-fixture-util@1.0.0"] },
          120_000,
        ),
      );
      await eventually(() => events.some((event) => event.kind === "reloaded"), 60_000, "a reload");
      // The page uses the package it just got.
      writeFileSync(
        join(dir, "label.tsx"),
        `import { label } from "mostra-fixture-util";\nexport function Label() {\n  return <p id="label">{label}</p>;\n}\n`,
      );
      writeDevFixture(dir, "HEADING-THREE");
      const entry = join(dir, "index.tsx");
      const text = readFileSync(entry, "utf8");
      writeFileSync(
        entry,
        text
          .replace(
            'import { whoAmI } from "./actions";',
            'import { whoAmI } from "./actions";\nimport { Label } from "./label";',
          )
          .replace("</main>", "<Label /></main>"),
      );
      await expect
        .poll(
          () =>
            frame
              .locator("#label")
              .innerText()
              .catch(() => ""),
          { timeout: 20_000 },
        )
        .toBe("clicks");
      ok(await owner.call("dev/stop", { sessionId: started.sessionId }));
      owner.close();
    } finally {
      await browser.close();
      await gateway.stop();
      await registry.close();
    }
  }, 240_000);

  it("stops a dev server whose setup fails after it started, and leaves nothing behind", async () => {
    const home = testHome();
    const gateway = new GatewayHome(home);
    await gateway.start({ env: { MOSTRA_TEST_FAULTS: "dev:after-child:throw" } });
    try {
      const dir = join(tempDir("dev-fault"), "preview");
      writeDevFixture(dir);
      const answer = await gateway.client.call("dev/start", { source: { path: dir } }, 120_000);
      expect(answer.error).toBeDefined();
      const devDir = join(home.home, "cache", "dev");
      await eventually(
        () => !existsSync(devDir) || readdirSync(devDir).length === 0,
        20_000,
        "the session's directory gone",
      );
      await eventually(
        async () =>
          !ok<{ processes: { kind: string }[] }>(
            await gateway.client.call("instance/status", {}),
          ).processes.some((process) => process.kind === "builder"),
        20_000,
        "no dev server left",
      );
      await new Promise((done) => setTimeout(done, 3000));
      expect(!existsSync(devDir) || readdirSync(devDir).length === 0).toBe(true);
    } finally {
      await gateway.stop();
    }
  }, 120_000);

  it("removes what a stopped instance left of its sessions at the next start", async () => {
    const home = testHome();
    const first = await new GatewayHome(home).start();
    await first.stop();
    const left = join(home.home, "cache", "dev", "dev_LEFTOVER", "root", "source");
    mkdirSync(left, { recursive: true });
    writeFileSync(join(left, "index.tsx"), "export default () => null;\n");
    const second = await new GatewayHome(home).start();
    try {
      expect(existsSync(join(home.home, "cache", "dev", "dev_LEFTOVER"))).toBe(false);
    } finally {
      await second.stop();
    }
  }, 120_000);
});
