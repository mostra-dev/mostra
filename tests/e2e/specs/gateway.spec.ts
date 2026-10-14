/// <reference lib="dom" />
/**
 * Capability links opened in Chromium, Firefox and WebKit through the real gateway (WP-05):
 *
 * - the WP-03 render fixtures (single TSX, single MDX, a directory with `pages/` and deep links);
 * - the shell and the artifact on two origins of one host, with cookie-mode sessions (SH-01, SH-03);
 * - the bridge handshake, and messages from the wrong window or origin, or malformed, dropped (SH-04);
 * - framing by any other page refused, tokens out of the address bar, cookies out of scripts (HY-01);
 * - a revoked link explained in plain words (FAILURE_MODEL §8).
 */
import { createServer, type Server } from "node:http";
import { expect, type Frame, type Page, test } from "@playwright/test";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

/** Opens a link in the shell and waits until the frame reported `mostra/ready`. */
async function openShell(page: Page, url: string): Promise<{ frame: Frame; errors: string[] }> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 15_000 });
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the shell has no frame");
  return { frame, errors };
}

/** A page on another origin that frames `src`, served from a throwaway server. */
async function hostile(src: string, host = "127.0.0.1"): Promise<{ url: string; close(): void }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<!doctype html><title>elsewhere</title><iframe id="victim" src="${src}" width="800" height="600"></iframe>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { url: `http://${host}:${address.port}/`, close: () => server.close() };
}

/**
 * Whether a framed document is the real one. A blocked frame shows an error page (Chromium,
 * WebKit) or never gets a document at all (Firefox, whose `content()` then never settles), so
 * the probe is bounded; the control in the framing test shows it does see a framed page.
 */
async function framedReally(frame: Frame | undefined, marker: string): Promise<boolean> {
  if (!frame) return false;
  const probe = frame.content().then(
    (html) => html.includes(marker),
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000));
  return Promise.race([probe, timeout]);
}

/** A plain page with no framing rules, as the control for {@link framedReally}. */
async function unprotected(marker: string): Promise<{ url: string; close(): void }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>control</title><p>${marker}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}

test.describe("WP-03's fixtures render through the gateway", () => {
  test("a single plain React page, styled by Tailwind, with working state", async ({ page }) => {
    const { frame, errors } = await openShell(page, run.receipts.tsx.url);
    const heading = frame.getByRole("heading", { name: "Sidebar density" });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((node) => getComputedStyle(node).fontWeight)).toBe("600");
    await frame.getByRole("button", { name: "Spacious" }).click();
    await expect(frame.getByTestId("chosen")).toHaveText("Chosen: Spacious");
    expect(errors).toEqual([]);
  });

  test("a single MDX page with GitHub tables and its own components", async ({ page }) => {
    const { frame, errors } = await openShell(page, run.receipts.mdx.url);
    await expect(frame.getByRole("heading", { name: "Release notes 2.4" })).toBeVisible();
    await expect(frame.locator("table tbody tr")).toHaveCount(2);
    await expect(frame.getByTestId("count")).toHaveText("2 changes");
    await expect(page).toHaveTitle("Release notes review");
    expect(await frame.content()).not.toContain("family: review");
    expect(errors).toEqual([]);
  });

  test("a directory's pages inside its layout, with deep links", async ({ page }) => {
    const { frame, errors } = await openShell(page, run.receipts.directory.url);
    await expect(frame.getByTestId("greeting")).toHaveText("Hello, team");
    await expect(frame.getByTestId("layout")).toHaveText("Team dashboard");
    await expect(frame.getByTestId("item")).toHaveText([
      "Ship the release notes",
      "Review the dashboard",
    ]);
    expect(
      await frame.getByTestId("logo").evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBe(16);
    const origin = new URL(frame.url()).origin;
    await frame.goto(`${origin}/settings`);
    await expect(frame.getByTestId("settings")).toHaveText("Settings");
    await frame.goto(`${origin}/reports/42`);
    await expect(frame.getByTestId("report")).toHaveText("Report 42");
    await expect(frame.getByTestId("layout")).toHaveText("Team dashboard");
    // The server function has no worker yet (WP-08): the click fails, which is a page error.
    expect(errors.filter((error) => !error.includes("can't run here"))).toEqual([]);
  });
});

test.describe("the shell and the artifact (SH-01, SH-03)", () => {
  test("live on two origins of one host, and neither reads the other's document", async ({
    page,
  }) => {
    const { frame } = await openShell(page, run.receipts.tsx.url);
    const shell = new URL(page.url());
    const artifact = new URL(frame.url());
    expect(artifact.origin).not.toBe(shell.origin);
    expect(artifact.hostname).toBe(shell.hostname);
    expect(
      await frame.evaluate(() => {
        try {
          return window.parent.document.title;
        } catch (error) {
          return (error as Error).name;
        }
      }),
    ).toBe("SecurityError");
    expect(
      await page.evaluate(() => {
        try {
          return (
            (document.querySelector("iframe") as HTMLIFrameElement).contentWindow?.document.title ??
            "none"
          );
        } catch (error) {
          return (error as Error).name;
        }
      }),
    ).toBe("SecurityError");
    // The shell's state lives in the shell's document only; the artifact's document has none of it.
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
    expect(await frame.evaluate(() => document.documentElement.dataset["shell"])).toBeUndefined();
  });

  test("authenticate with HttpOnly cookies scripts can't read (cookie mode)", async ({
    page,
    context,
  }) => {
    const { frame } = await openShell(page, run.receipts.tsx.url);
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await frame.evaluate(() => document.cookie)).toBe("");
    const cookies = await context.cookies();
    expect(cookies.length).toBeGreaterThanOrEqual(2);
    for (const cookie of cookies) {
      expect(cookie.name).toMatch(/^mostra-\d+$/);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Strict");
      expect(cookie.secure).toBe(false);
    }
    // A reload keeps both sessions: the shell needs no token any more.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 15_000 });
  });

  test("takes the token out of the address bar and the history", async ({ page }) => {
    await openShell(page, run.receipts.tsx.url);
    expect(page.url()).not.toContain("#t=");
    expect(page.url()).toBe(run.receipts.tsx.url.split("#")[0]);
    expect(await page.evaluate(() => location.hash)).toBe("");
  });
});

test.describe("the bridge (SH-04)", () => {
  test("drops messages from other windows, other origins and malformed ones", async ({ page }) => {
    const { frame } = await openShell(page, run.receipts.tsx.url);
    const rejections = async (): Promise<number> =>
      Number((await page.locator("html").getAttribute("data-bridge-rejections")) ?? "0");
    const before = await rejections();
    // The shell's own window posting as if it were the artifact: wrong source.
    await page.evaluate(() =>
      window.postMessage({ jsonrpc: "2.0", method: "mostra/ready", params: {} }, "*"),
    );
    await expect.poll(rejections).toBe(before + 1);
    // The artifact posting things the bridge doesn't accept.
    await frame.evaluate(() => {
      window.parent.postMessage({ hello: "world" }, "*");
      window.parent.postMessage({ jsonrpc: "2.0", method: "mostra/unknown", params: {} }, "*");
      window.parent.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: "wide" } },
        "*",
      );
      window.parent.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: {} },
        "*",
      );
    });
    await expect.poll(rejections).toBe(before + 5);
    // A valid message from the artifact's own origin but another window (a nested frame):
    // only the window check catches it.
    await frame.evaluate(() => {
      const nested = document.createElement("iframe");
      nested.name = "nested-probe";
      document.body.append(nested);
    });
    const named = () => page.frames().find((candidate) => candidate.name() === "nested-probe");
    await expect.poll(named).toBeDefined();
    const nested = named();
    // The nested frame is about:blank: it inherits the artifact's origin.
    expect(await nested?.evaluate(() => window.origin)).toBe(new URL(frame.url()).origin);
    await nested?.evaluate(() =>
      window.top?.postMessage({ jsonrpc: "2.0", method: "mostra/ready", params: {} }, "*"),
    );
    await expect.poll(rejections).toBe(before + 6);
    // None of it changed what the shell shows.
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
  });
});

test.describe("framing and revoked links (HY-01, D98 item 4)", () => {
  test("no other page can frame the shell or an artifact", async ({ page }) => {
    // Eight hostile pages and a control, each given time to load what it frames.
    test.setTimeout(120_000);
    const opened = await openShell(page, run.receipts.tsx.url);
    const artifactOrigin = new URL(opened.frame.url()).origin;
    // The control: the same hostile page does frame a page that sets no framing rules.
    const control = await unprotected("CONTROL-FRAMED");
    const controlHost = await hostile(control.url);
    try {
      const attacker = await page.context().newPage();
      await attacker.goto(controlHost.url, { waitUntil: "domcontentloaded" });
      await attacker.waitForTimeout(1_500);
      const framed = attacker.frames().find((frame) => frame !== attacker.mainFrame());
      expect(await framedReally(framed, "CONTROL-FRAMED")).toBe(true);
      await attacker.close();
    } finally {
      control.close();
      controlHost.close();
    }
    for (const host of ["127.0.0.1", "localhost"]) {
      for (const src of [run.receipts.tsx.url, `${artifactOrigin}/`]) {
        const evil = await hostile(src, host);
        try {
          const attacker = await page.context().newPage();
          // A blocked frame may never fire `load` (Firefox): wait for the document, then give the
          // frame time to load if it were allowed to.
          await attacker.goto(evil.url, { waitUntil: "domcontentloaded" });
          await attacker.waitForTimeout(1_500);
          const victim = attacker.frames().find((frame) => frame !== attacker.mainFrame());
          expect(await framedReally(victim, "Sidebar density"), `${host} framing ${src}`).toBe(
            false,
          );
          expect(await framedReally(victim, "data-shell"), `${host} framing ${src}`).toBe(false);
          await attacker.close();
        } finally {
          evil.close();
        }
      }
    }
  });

  test("a page elsewhere can't lock viewers out by spending the guessing limit", async ({
    page,
  }) => {
    const opened = await openShell(page, run.receipts.mdx.url);
    const artifactOrigin = new URL(opened.frame.url()).origin;
    // Forty hidden frames entering with junk tickets: more than the 30 failures a minute allows.
    const server: Server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      const frames = Array.from(
        { length: 40 },
        (_, index) =>
          `<iframe src="${artifactOrigin}/_mostra/enter?ticket=${String(index).padStart(26, "0")}"></iframe>`,
      ).join("");
      response.end(`<!doctype html><title>elsewhere</title>${frames}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    try {
      const attacker = await page.context().newPage();
      await attacker.goto(`http://localhost:${address.port}/`, { waitUntil: "domcontentloaded" });
      await attacker.waitForTimeout(2_000);
      await attacker.close();
      // A viewer opening a link right after still gets in.
      const viewer = await page.context().newPage();
      await openShell(viewer, run.receipts.mdx.url);
      await viewer.close();
    } finally {
      server.close();
    }
  });

  test("a revoked link says so in plain words", async ({ page }) => {
    const client = await Client.connect(run.socket);
    try {
      const link = await client.call<{ url: string; tokenId: string }>("view/url", {
        artifact: { artifactId: run.receipts.tsx.artifactId },
      });
      await client.call("view/revoke", { tokenId: link.tokenId });
      await page.goto(link.url);
      await expect(page.locator("html")).toHaveAttribute("data-shell", "error");
      await expect(page.locator("html")).toHaveAttribute(
        "data-shell-error",
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
      );
      await expect(page.getByRole("heading")).toHaveText("This link was revoked or has expired");
    } finally {
      client.close();
    }
  });

  test("a view-and-review link can't submit", async ({ page }) => {
    const client = await Client.connect(run.socket);
    try {
      const link = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: run.receipts.tsx.artifactId },
        scopes: ["review"],
      });
      const { frame } = await openShell(page, link.url);
      const status = await frame.evaluate(async () => {
        const session = (await (await fetch("/_mostra/session")).json()) as { csrf: string };
        const response = await fetch("/_mostra/v/1/submit", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mostra-csrf": session.csrf },
          body: "{}",
        });
        return `${response.status} ${((await response.json()) as { code: string }).code}`;
      });
      expect(status).toBe("403 MOSTRA_HYGIENE_SCOPE_DENIED");
    } finally {
      client.close();
    }
  });
});

test.describe("one artifact against the others and against its shell (Claude review)", () => {
  test("an artifact page can't lock another artifact's viewers out (finding 1)", async ({
    page,
    browser,
  }) => {
    const target = await openShell(page, run.receipts.mdx.url);
    const targetOrigin = new URL(target.frame.url()).origin;
    const attacker = await page.context().newPage();
    const { frame } = await openShell(attacker, run.receipts.tsx.url);
    // The artifact's own script loads 40 entry URLs of the other artifact with junk tickets.
    await frame.evaluate(async (origin) => {
      await Promise.all(
        Array.from(
          { length: 40 },
          (_, index) =>
            new Promise((resolve) => {
              const image = new Image();
              image.onload = image.onerror = resolve;
              image.src = `${origin}/_mostra/enter?ticket=${String(index).padStart(26, "0")}`;
            }),
        ),
      );
    }, targetOrigin);
    // A viewer of the other artifact, in a fresh browser profile, still gets in.
    const context = await browser.newContext();
    try {
      await openShell(await context.newPage(), run.receipts.mdx.url);
    } finally {
      await context.close();
    }
  });

  test("an artifact page can't break every link by filling the host's cookie jar (finding 3)", async ({
    page,
  }) => {
    const { frame } = await openShell(page, run.receipts.tsx.url);
    const kept = await frame.evaluate(() => {
      for (let index = 0; index < 400; index++) {
        // biome-ignore lint/suspicious/noDocumentCookie: the attack under test fills the cookie jar
        document.cookie = `junk${index}=${"x".repeat(4090)}; path=/; max-age=3600`;
      }
      return document.cookie.length;
    });
    expect(kept).toBeGreaterThan(32 * 1024);
    // Every link on the host still opens, the artifact's own and another one.
    await openShell(await page.context().newPage(), run.receipts.mdx.url);
    await openShell(await page.context().newPage(), run.receipts.tsx.url);
  });

  test("the frame can't replace the shell page, neither itself nor through a popup (finding 4)", async ({
    page,
  }) => {
    const { frame } = await openShell(page, run.receipts.tsx.url);
    const shellUrl = page.url();
    const artifactOrigin = new URL(frame.url()).origin;
    // A click gives the frame user activation, which top navigation would otherwise accept.
    await frame.locator("body").click();
    const direct = await frame.evaluate((origin) => {
      try {
        // biome-ignore lint/style/noNonNullAssertion: the frame always has a top window
        window.top!.location.href = `${origin}/a/look-alike`;
        return "assigned";
      } catch (error) {
        return String(error);
      }
    }, artifactOrigin);
    await page.waitForTimeout(1_000);
    expect(page.url(), direct).toBe(shellUrl);
    // A popup the frame opens runs unsandboxed, but it can't navigate the shell either.
    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      frame
        .locator("body")
        .click({ modifiers: [] })
        .then(() =>
          frame.evaluate(() => {
            window.open("about:blank", "_blank");
          }),
        ),
    ]);
    const viaPopup = await popup.evaluate((origin) => {
      try {
        // biome-ignore lint/style/noNonNullAssertion: the popup's opener is the frame
        window.opener!.top.location.href = `${origin}/a/look-alike`;
        return "assigned";
      } catch (error) {
        return String(error);
      }
    }, artifactOrigin);
    await page.waitForTimeout(1_000);
    expect(page.url(), viaPopup).toBe(shellUrl);
    // Nor by naming the top as a target, in script or in a link the viewer clicks.
    await frame.locator("body").click();
    await frame.evaluate((origin) => {
      window.open(`${origin}/a/look-alike`, "_top");
    }, artifactOrigin);
    await frame.evaluate((origin) => {
      const link = document.createElement("a");
      link.href = `${origin}/a/look-alike`;
      link.target = "_top";
      link.textContent = "look-alike";
      link.id = "look-alike";
      document.body.append(link);
    }, artifactOrigin);
    await frame.locator("#look-alike").click();
    await page.waitForTimeout(1_000);
    expect(page.url()).toBe(shellUrl);
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
  });

  test("ui/open-link opens a new tab, and refuses a URL that would run in the shell", async ({
    page,
  }) => {
    const target: Server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>opened</title><p>opened</p>");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    try {
      const { frame } = await openShell(page, run.receipts.tsx.url);
      const shellOrigin = new URL(page.url()).origin;
      const ask = (url: string, id: number) =>
        frame.evaluate(
          ({ url, id, shellOrigin }) =>
            new Promise<unknown>((resolve) => {
              const listener = (event: MessageEvent) => {
                const data = event.data as { id?: number };
                if (event.origin !== shellOrigin || data?.id !== id) return;
                window.removeEventListener("message", listener);
                resolve(data);
              };
              window.addEventListener("message", listener);
              window.parent.postMessage(
                { jsonrpc: "2.0", id, method: "ui/open-link", params: { url } },
                shellOrigin,
              );
            }),
          { url, id, shellOrigin },
        );
      const refused = await ask("javascript:alert(1)", 9001);
      expect(refused).toMatchObject({ result: { isError: true } });
      // A click inside the frame activates the shell too, so its window.open isn't blocked.
      await frame.locator("body").click();
      const [opened, answer] = await Promise.all([
        page.context().waitForEvent("page"),
        ask(`http://127.0.0.1:${address.port}/`, 9002),
      ]);
      expect(answer).toMatchObject({ result: {} });
      await opened.waitForLoadState("domcontentloaded");
      expect(opened.url()).toBe(`http://127.0.0.1:${address.port}/`);
      // noopener: the new tab can't reach back into the shell.
      expect(await opened.evaluate(() => window.opener)).toBeNull();
      expect(page.url()).toContain("/a/");
    } finally {
      target.close();
    }
  });

  test("a second link for an open artifact asks before it replaces the session (finding 6)", async ({
    page,
  }) => {
    const client = await Client.connect(run.socket);
    try {
      const narrow = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: run.receipts.directory.artifactId },
        scopes: ["view"],
      });
      await openShell(page, run.receipts.directory.url);
      const scopes = (target: Page) =>
        target.evaluate(async () => {
          const response = await fetch(`${location.pathname.replace(/\/$/, "")}/_mostra/session`);
          return ((await response.json()) as { scopes: string[] }).scopes;
        });
      // Another link: the shell asks, and keeping the current link changes nothing.
      const second = await page.context().newPage();
      await second.goto(narrow.url);
      await expect(second.locator("html")).toHaveAttribute("data-shell", "choosing");
      await expect(second.getByText("The link you just opened: Can view.")).toBeVisible();
      await second.getByRole("button", { name: "Keep the link I have" }).click();
      await expect(second.locator("html")).toHaveAttribute("data-shell", "ready", {
        timeout: 15_000,
      });
      expect(await scopes(second)).toContain("submit");
      // Using the new link replaces the session for every tab.
      const third = await page.context().newPage();
      await third.goto(narrow.url);
      await expect(third.locator("html")).toHaveAttribute("data-shell", "choosing");
      await third.getByRole("button", { name: "Use the new link" }).click();
      await expect(third.locator("html")).toHaveAttribute("data-shell", "ready", {
        timeout: 15_000,
      });
      expect(await scopes(third)).toEqual(["view"]);
    } finally {
      client.close();
    }
  });
});
