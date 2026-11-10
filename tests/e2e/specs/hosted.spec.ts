/// <reference lib="dom" />
/**
 * A hosted link in a real browser (WP-29, RM-02; INTERFACES §18.4; D165 items 1a, 7, 8): an owner
 * instance signs in to a real `mostra-runtime server` (the device page approved in the browser),
 * shares a version (`share/start { via: "remote" }`), and a respondent opens the hosted link: the
 * shell on the user-content domain's apex with its session in a header, the frame on the route's
 * own label in worker mode, no cookie anywhere. They answer and press the trusted Submit; the
 * shell says "Your answer was sent." and nothing about delivery; the owner's `wait` returns and
 * its `results` hold the answer. A reload keeps the session from the shell's storage.
 *
 * The domains are `*.localhost`, which the browsers Playwright drives resolve to loopback (RFC
 * 6761), as a server's own user-content domain and labels resolve to it.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { openInShell, publishOwn, saved, viewerName } from "../support/client.ts";
import { BIN, Client, removeTree, startDaemon } from "../support/mostra.ts";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

test.describe("a hosted link (RM-02, §18.4)", () => {
  test.describe.configure({ mode: "serial" });
  let port = 0;
  let server: ReturnType<typeof spawn> | undefined;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let client: Client | undefined;

  test.beforeAll(async () => {
    port = await freePort();
    daemon = await startDaemon({ env: { MOSTRA_TEST_SERVER_ADDRESS: `127.0.0.1:${port}` } });
    const data = join(daemon.root, "server");
    mkdirSync(data, { recursive: true });
    const config = join(daemon.root, "server.json");
    writeFileSync(
      config,
      JSON.stringify({
        apiOrigin: `http://api.localhost:${port}`,
        domains: { active: `content.localhost:${port}` },
        scheme: "http",
        identityProviders: [{ id: "dev", kind: "development", label: "Development" }],
      }),
    );
    server = spawn(
      process.execPath,
      [BIN, "server", "--data", data, "--config", config, "--listen", `127.0.0.1:${port}`],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      server?.stdout?.setEncoding("utf8");
      server?.stdout?.once("data", (line: string) =>
        line.includes('"started"') ? resolve() : reject(new Error(`server: ${line}`)),
      );
      server?.once("exit", (code) => reject(new Error(`the server exited (${code})`)));
    });
    client = await Client.connect(daemon.socket, { name: "e2e-owner" });
  });

  test.afterAll(async () => {
    client?.close();
    server?.kill("SIGTERM");
    daemon?.child.kill("SIGTERM");
    await new Promise((resolve) => daemon?.child.once("exit", resolve));
    if (daemon) removeTree(daemon.root);
  });

  /** The owner signs in, approving the machine on the server's device page as a person does. */
  const signIn = async (page: Page): Promise<void> => {
    if (!client) throw new Error("not started");
    const login = await client.call<{
      loginId: string;
      verificationUriComplete?: string;
      verificationUri: string;
      userCode: string;
    }>("remote/login", { server: `http://api.localhost:${port}` });
    await page.goto(login.verificationUriComplete ?? login.verificationUri);
    await expect(page.getByText("Approving links a machine to your account")).toBeVisible();
    await page.locator("input[name=user_code]").fill(login.userCode);
    await page.locator("input[name=name]").fill("Ada");
    await page.getByRole("button", { name: "Approve this machine" }).click();
    await expect(page.getByText("The machine is linked to your account.")).toBeVisible();
    const signedIn = await client.call<{ status: string }>("remote/login.wait", {
      loginId: login.loginId,
      timeoutMs: 30_000,
    });
    expect(signedIn.status).toBe("signed-in");
    owner = true;
  };
  let owner = false;
  /** Each case runs alone too (`-g`, as the seeds run it): it signs the owner in if none did. */
  const ensureSignedIn = async (browser: Browser): Promise<void> => {
    if (owner) return;
    const context = await browser.newContext();
    await signIn(await context.newPage());
    await context.close();
  };

  test("a respondent answers on the hosted link and the owner's agent gets it", async ({
    page,
    context,
  }, info) => {
    test.setTimeout(150_000);
    if (!client || !daemon) throw new Error("not started");
    // The owner signs in: the person approves the machine on the server's device page.
    await signIn(page);

    const own = await publishOwn(client, daemon.home, info);
    const share = await client.call<{ url: string }>("share/start", {
      artifact: { artifactId: own.artifactId },
      via: "remote",
    });
    expect(new URL(share.url).host).toBe(`content.localhost:${port}`);

    const frame = await openInShell(page, share.url);
    // The frame is the route's own label, a site of its own beside the shell's apex.
    const frameUrl = new URL((await page.locator("iframe.mostra-frame").getAttribute("src")) ?? "");
    expect(frameUrl.host).toMatch(
      new RegExp(`^[0-9a-hjkmnp-tv-z]{26}\\.content\\.localhost:${port}$`),
    );
    const answer = viewerName(info);
    await frame.getByTestId("name").fill(answer);
    await saved(page);
    // No cookie is ever set on a hosted host (D165 item 8).
    expect(await context.cookies()).toEqual([]);

    // A reload keeps the session: the shell kept its secret in its own storage, per route.
    await page.reload();
    const again = await openInShell(page, page.url());
    await expect(again.getByTestId("name")).toHaveValue(answer);

    await page.locator("#mostra-submit").click();
    const receipt = page.locator("[data-mostra-receipt]");
    await expect(receipt).toHaveAttribute("data-mostra-receipt", "sent");
    await expect(receipt).toContainText("Your answer was sent.");
    await expect(page.locator("[data-mostra-delivery]")).toHaveCount(0);
    await expect(receipt).not.toContainText("Delivered");
    await expect(receipt).not.toContainText("Pending");

    // The owner's agent waits and reads the answer through its own outbox.
    const waited = await client.call<{ status: string }>("wait", {
      artifact: { artifactId: own.artifactId },
      until: "submitted",
      timeoutMs: 20_000,
    });
    expect(waited.status).toBe("satisfied");
    const results = await client.call<{ answers: Record<string, unknown> }>("results/get", {
      artifact: { artifactId: own.artifactId },
    });
    expect(results.answers["name"]).toBe(answer);
    expect(await context.cookies()).toEqual([]);
  });

  test("the trusted chrome: sender, footer and report outside the frame, Trusted Types, sign-in from the chrome (HY-08, HY-09, D161)", async ({
    page,
    browser,
    browserName,
  }, info) => {
    test.setTimeout(150_000);
    if (!client || !daemon) throw new Error("not started");
    await ensureSignedIn(browser);
    const own = await publishOwn(client, daemon.home, info);
    const share = await client.call<{ url: string }>("share/start", {
      artifact: { artifactId: own.artifactId },
      via: "remote",
    });
    const frame = await openInShell(page, share.url);

    // The sender line names the owner, unverified under the development provider (D161).
    await expect(page.locator("[data-mostra-sender]")).toContainText("Sent by Ada");
    await expect(page.locator("[data-mostra-sender-unverified]")).toBeVisible();
    // The footer is the shell's, outside the frame, on every hosted page.
    await expect(page.locator("[data-mostra-passwords]")).toHaveText(
      "Never enter passwords on this page.",
    );
    // The page can't reach the shell's document, so it can't click, hide or restyle the chrome.
    const reach = await frame.locator("body").evaluate(() => {
      try {
        return window.top?.document.title ?? "none";
      } catch {
        return "blocked";
      }
    });
    expect(reach).toBe("blocked");
    // The shell's own script sinks refuse strings under Trusted Types, where the engine has them.
    if (browserName === "chromium") {
      const injected = await page.evaluate(() => {
        try {
          document.body.insertAdjacentHTML("beforeend", "<img src=x onerror=alert(1)>");
          return "allowed";
        } catch (error) {
          return (error as Error).name;
        }
      });
      expect(injected).toBe("TypeError");
    }

    // The report control reaches the server (abuse.report, §18.4).
    await page.locator("[data-mostra-report]").click();
    await page.locator("input[name=mostra-report-reason][value=spam]").check();
    await page.locator("[data-mostra-report-send]").click();
    await expect(page.locator("[data-mostra-report-outcome]")).toHaveAttribute(
      "data-mostra-report-outcome",
      "sent",
    );

    // Sign-in starts only from the chrome, names the sender before the person is named to them,
    // and returns to the page as the account (INTERFACES §18.4).
    await expect(page.locator("[data-mostra-viewer]")).toHaveAttribute(
      "data-mostra-viewer",
      "anonymous",
    );
    await page.locator("[data-mostra-sign-in]").click();
    await page.getByRole("link", { name: "Continue with Development" }).click();
    await page.locator("input[name=name]").fill("Grace");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Continue as Grace to answer Ada's page?")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("[data-mostra-viewer]")).toHaveAttribute(
      "data-mostra-viewer",
      "account",
    );
    await expect(page.locator("[data-mostra-viewer]")).toContainText("Signed in as Grace");
  });

  test("sends each route its own anonymous key, and never the browser's own secret (HY-08)", async ({
    page,
    context,
    browser,
  }, info) => {
    test.setTimeout(150_000);
    if (!client || !daemon) throw new Error("not started");
    await ensureSignedIn(browser);
    const links: string[] = [];
    for (const _ of [1, 2]) {
      const own = await publishOwn(client, daemon.home, info);
      links.push(
        (
          await client.call<{ url: string }>("share/start", {
            artifact: { artifactId: own.artifactId },
            via: "remote",
          })
        ).url,
      );
    }
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    context.on("request", (request) => {
      sent.push({ url: request.url(), headers: request.headers(), body: request.postData() ?? "" });
    });
    for (const link of links) await openInShell(page, link);
    const keys = sent
      .filter((request) => request.url.endsWith("/_mostra/session") && request.body !== "")
      .map((request) => (JSON.parse(request.body) as { browser?: string }).browser);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys[0]).not.toBe(keys[1]);
    const secret = await page.evaluate(() => localStorage.getItem("mostra.browser-secret"));
    expect(secret).toBeTruthy();
    for (const request of sent) {
      const everything = `${request.url}\n${JSON.stringify(request.headers)}\n${request.body}`;
      expect(everything.includes(secret as string), request.url).toBe(false);
    }
  });

  test("keeps working when a sibling filled the site's storage, with the link kept and the viewer told (HY-09)", async ({
    browser,
  }, info) => {
    test.setTimeout(150_000);
    if (!client || !daemon) throw new Error("not started");
    await ensureSignedIn(browser);
    const own = await publishOwn(client, daemon.home, info);
    const share = await client.call<{ url: string }>("share/start", {
      artifact: { artifactId: own.artifactId },
      via: "remote",
    });
    const context = await browser.newContext();
    // What a sibling page that filled the site's storage group leaves: every write throws.
    await context.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
    });
    const page = await context.newPage();
    const frame = await openInShell(page, share.url);
    const answer = viewerName(info);
    await frame.getByTestId("name").fill(answer);
    await saved(page);
    // The link stays in the address bar, so a reload still has it, and the viewer is told.
    expect(new URL(page.url()).hash).toMatch(/^#t=/);
    await expect(page.locator("[data-mostra-storage]")).toBeVisible();
    // Sign-in comes back to a session it reads from storage, so with none stored it isn't offered
    // (the trusted chrome's case shows it where storage works; second Fable review, 7).
    await expect(page.locator("[data-mostra-sign-in]")).toHaveCount(0);
    // A reload opens the page again from the link that stayed (the answer belonged to the session
    // the browser couldn't keep; FAILURE_MODEL §11.3).
    await page.reload();
    const again = await openInShell(page, page.url());
    await expect(again.getByTestId("name")).toBeVisible();
    await context.close();
  });
});
