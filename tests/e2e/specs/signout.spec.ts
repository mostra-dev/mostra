/// <reference lib="dom" />
/**
 * An operator's own app signs a person out of the server's sign-in with its one "Sign out" (MT-06,
 * #204; INTERFACES §18.5), in a real browser: the app's "Sign out" form posts straight to the API
 * origin's `POST /signout`, its `Origin` the app's own, with a `state` the app keeps for this
 * sign-out; the server ends its session and sends the person back to the address the app
 * registered (`post_logout_redirect_uris`) with that `state`, where the app ends its own session
 * once the `state` is the one it kept. (A form the app's own endpoint passes on with a 307 doesn't
 * do: Chromium and WebKit then send `Origin: null`, which no server can trust; VERIFIED_FACTS,
 * MT-06.)
 *
 * Same site (the app and the API origin on one site, as an operator's own domains are), the browser
 * sends the sign-in's cookie with the form: the session's row ends, and an old copy of the cookie
 * signs nobody in. Another site (a self-hoster's app elsewhere), a browser may send no
 * `SameSite=Lax` cookie with a cross-site form: the cookie is cleared all the same. Either way the
 * next sign-in in that browser asks again. A page of any other origin that posts the same form ends nothing.
 *
 * A real `mostra-runtime server` with the development provider; the app is a small server here,
 * on `localhost`, which serves its Client ID Metadata Document too (`MOSTRA_TEST_CIMD_ORIGIN`).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { BIN, removeTree, SCRATCH } from "../support/mostra.ts";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The operator's app: its metadata document, its account page whose "Sign out" posts to the
 * server's with a `state` it keeps, and the page it comes back to, which ends the app's own session
 * when the `state` is the one it kept. `elsewhere` is a page of another origin posting the same form.
 */
function operatorApp(appOrigin: string, api: string): Server {
  const clientId = `${appOrigin.replace("http:", "https:")}/account.json`;
  const back = `${appOrigin}/signed-out`;
  /** The app's one session, and the state its sign-out carries. */
  const app = { signedIn: true, state: `st-${Math.random().toString(36).slice(2)}` };
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", appOrigin);
    const host = request.headers.host ?? "";
    const page = (body: string) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>${body}</body></html>`);
    };
    const form = `<form method="post" action="${api}/signout"><input type="hidden" name="client_id" value="${clientId}"><input type="hidden" name="post_logout_redirect_uri" value="${back}"><input type="hidden" name="state" value="${app.state}"><button>Sign out</button></form>`;
    if (!host.startsWith("localhost:")) {
      // Another origin's page posting the operator's form to the server.
      page(`<h1>Elsewhere</h1>${form}`);
      return;
    }
    if (url.pathname === "/account.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          client_id: clientId,
          client_name: "The app's own name",
          redirect_uris: [`${appOrigin.replace("http:", "https:")}/callback`],
          post_logout_redirect_uris: [back],
        }),
      );
      return;
    }
    if (url.pathname === "/signed-out") {
      // Back from the server: the app ends its own session, for its own sign-out's state only.
      if (url.searchParams.get("state") === app.state) app.signedIn = false;
      page(app.signedIn ? "<h1>Still signed in to the app</h1>" : "<h1>Signed out of the app</h1>");
      return;
    }
    page(`<h1>Your account</h1>${form}`);
  });
}

for (const where of [
  { name: "the same site", api: (port: number) => `http://localhost:${port}`, sameSite: true },
  { name: "another site", api: (port: number) => `http://api.localhost:${port}`, sameSite: false },
] as const) {
  test.describe(`an operator's own app signs a person out, from ${where.name} (MT-06)`, () => {
    test.describe.configure({ mode: "serial" });
    let root = "";
    let server: ReturnType<typeof spawn> | undefined;
    let app: Server | undefined;
    let api = "";
    let appOrigin = "";
    let appPort = 0;

    test.beforeAll(async () => {
      const port = await freePort();
      appPort = await freePort();
      api = where.api(port);
      appOrigin = `http://localhost:${appPort}`;
      root = mkdtempSync(join(SCRATCH, "mostra-e2e-signout-"));
      const data = join(root, "server");
      mkdirSync(data, { recursive: true });
      const config = join(root, "server.json");
      writeFileSync(
        config,
        JSON.stringify({
          apiOrigin: api,
          domains: { active: `content.localhost:${port}` },
          scheme: "http",
          identityProviders: [{ id: "dev", kind: "development", label: "Development" }],
          operatorClients: [
            {
              clientId: `${appOrigin.replace("http:", "https:")}/account.json`,
              name: "Example account",
            },
          ],
        }),
      );
      app = operatorApp(appOrigin, api);
      await new Promise<void>((resolve) => app?.listen(appPort, "127.0.0.1", resolve));
      server = spawn(
        process.execPath,
        [BIN, "server", "--data", data, "--config", config, "--listen", `127.0.0.1:${port}`],
        {
          env: { ...process.env, MOSTRA_TEST_CIMD_ORIGIN: appOrigin },
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      await new Promise<void>((resolve, reject) => {
        server?.stdout?.setEncoding("utf8");
        server?.stdout?.once("data", (line: string) =>
          line.includes('"started"') ? resolve() : reject(new Error(`server: ${line}`)),
        );
        server?.once("exit", (code) => reject(new Error(`the server exited (${code})`)));
      });
    });

    test.afterAll(async () => {
      server?.kill("SIGTERM");
      app?.close();
      if (server) await new Promise((resolve) => server?.once("exit", resolve));
      if (root !== "") removeTree(root);
    });

    /** Signs the browser in on the API origin through the development provider. */
    const signIn = async (page: Page, name: string): Promise<void> => {
      await page.goto(`${api}/signin/dev/start?next=${encodeURIComponent("/signout")}`);
      await page.locator("input[name=name]").fill(name);
      await page.getByRole("button", { name: "Continue" }).click();
      // Signed in, the sign-out page offers its one button.
      await expect(page.getByRole("heading", { name: "Sign out?" })).toBeVisible();
    };
    const signInCookie = async (page: Page) =>
      (await page.context().cookies(api)).find((cookie) => cookie.name === "mostra-signin");

    test("the app's one Sign out signs the person out of the server too, back to where the app said", async ({
      page,
    }) => {
      await signIn(page, "Ada");
      const before = await signInCookie(page);
      expect(before).toBeDefined();
      await page.goto(`${appOrigin}/`);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("heading", { name: "Signed out of the app" })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/signed-out");
      // The browser holds no sign-in any more, and the server's page says so.
      expect(await signInCookie(page)).toBeUndefined();
      await page.goto(`${api}/signout`);
      await expect(page.getByRole("heading", { name: "You're signed out" })).toBeVisible();
      // Same site, the cookie came with the form, so the session itself ended: an old copy of the
      // cookie signs nobody in. From another site a browser may send no cookie with the form
      // (Chromium and Firefox; WebKit sent it for these loopback names), and then only the cookie
      // went, its row left to expire and be swept.
      if (where.sameSite) {
        await page.context().addCookies([{ ...(before as NonNullable<typeof before>) }]);
        await page.goto(`${api}/signout`);
        await expect(page.getByRole("heading", { name: "You're signed out" })).toBeVisible();
        await page.context().clearCookies();
      }
    });

    test("a page of another origin posting the same form ends nothing", async ({ page }) => {
      await signIn(page, "Grace");
      const elsewhere = `http://elsewhere.localhost:${appPort}/`;
      await page.goto(elsewhere);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(
        page.getByText("Signing out here works from this server's own pages"),
      ).toBeVisible();
      expect(await signInCookie(page)).toBeDefined();
      await page.goto(`${api}/signout`);
      await expect(page.getByRole("heading", { name: "Sign out?" })).toBeVisible();
    });
  });
}
