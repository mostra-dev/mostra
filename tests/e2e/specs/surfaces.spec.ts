/// <reference lib="dom" />
/**
 * Every surface a person meets, photographed and checked (UX-01, D171): the API origin's pages
 * (sign-in, the development provider's name page, linking a machine in each of its states, a chat
 * app's consent with and without a loopback redirect, the consent of the operator's own app
 * (`operatorClients`, MT-05), "Answer as yourself", "Sign-in can't continue"), the hosted shell's chrome in each of its states (anonymous, naming oneself, signed
 * in, the report dialog, folded, sent, paused with an operator's long reason, a refused answer, a
 * new version, an operator's interstitial, a title that won't break), the pages a link can end on
 * (expired, under review, suspended, moving, a limit reached on view, an unknown host), and the
 * local shell, at 1280 and 390 pixels wide, light and dark, in Chromium, Firefox and WebKit.
 *
 * Each surface must pass axe with no serious or critical finding on the shell's own document (the
 * artifact's frame is the author's) and must never scroll sideways. With `MOSTRA_E2E_SCREENS` set
 * to a directory, every surface is also photographed there
 * (`<engine>/<mode>-<width>/<surface>.png`): UX-01's committed pictures come from this suite.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import axe from "axe-core";
import { gotoShell, openInShell, publishOwn, republish, settled } from "../support/client.ts";
import { BIN, Client, removeTree, startDaemon } from "../support/mostra.ts";
import { reserveShortLivedPort } from "../support/ports.ts";

const OPERATOR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "runtime",
  "test",
  "fixtures",
  "operator.mjs",
);
const AXE: string = axe.source;
const SCREENS = process.env["MOSTRA_E2E_SCREENS"];
const MODES = ["light", "dark"] as const;
/** A person per run, each signing in for the first time (consent is asked once per account). */
const PEOPLE = ["Grace Hopper", "Katherine Johnson", "Dorothy Vaughan", "Mary Jackson"];
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;
/**
 * An operator's message of 1,000 characters with a right-to-left run inside it (the interstitial's
 * message; its limit is 2,000), cut to 500 for a pause's reason and an operator's footer.
 */
const LONG_REASON =
  `Answers for this round are closed while the team reviews them. ${"مراجعة الإجابات جارية الآن. "}${"The page opens again for the next round. ".repeat(40)}`.slice(
    0,
    1_000,
  );

/** An HTTP request to the server under a host it serves (Node doesn't resolve `*.localhost`). */
function ask(
  port: number,
  host: string,
  path: string,
  options: { method?: string; type?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        setHost: false,
        headers: {
          host,
          ...(options.type ? { "content-type": options.type } : {}),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test.describe("every surface a person meets (UX-01, D171)", () => {
  test.describe.configure({ mode: "serial" });
  let port = 0;
  let control = 0;
  let api = "";
  let server: ReturnType<typeof spawn> | undefined;
  /** Serves the operator's own app's Client ID Metadata Document (MT-05). */
  let documents: Server | undefined;
  let ownClient = "";
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let client: Client | undefined;
  const findings: string[] = [];

  /** Changes the fixture operator's behaviour, or calls the server handle through it. */
  const operator = async (path: "/state" | "/handle", body: unknown): Promise<unknown> => {
    const answer = await ask(control, `127.0.0.1:${control}`, path, {
      method: "POST",
      type: "application/json",
      body: JSON.stringify(body),
    });
    expect(answer.status, answer.body).toBeLessThan(300);
    return answer.body ? (JSON.parse(answer.body) as unknown) : undefined;
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    // Both held until the server, which binds both, starts: the daemon, started first, binds
    // short-lived listeners in the same range, and a port only probed was taken once before the
    // server bound it (EADDRINUSE, main's nightly run 44898874910).
    const reservedPort = await reserveShortLivedPort();
    const reservedControl = await reserveShortLivedPort();
    port = reservedPort.port;
    control = reservedControl.port;
    api = `http://api.localhost:${port}`;
    daemon = await startDaemon({ env: { MOSTRA_TEST_SERVER_ADDRESS: `127.0.0.1:${port}` } });
    const data = join(daemon.root, "server");
    mkdirSync(data, { recursive: true });
    // The operator's own app signs people in as a metadata-document client, from a name (never a
    // literal address), which the server's test hook lets it fetch over http on loopback.
    documents = createHttpServer((request, response) => {
      response.writeHead(request.url === "/account.json" ? 200 : 404, {
        "content-type": "application/json",
      });
      response.end(
        request.url === "/account.json"
          ? JSON.stringify({
              client_id: ownClient,
              client_name: "Account",
              redirect_uris: ["https://account.example/signin/done"],
            })
          : "",
      );
    });
    await new Promise<void>((resolve) => documents?.listen(0, "127.0.0.1", resolve));
    const documentsOrigin = `http://localhost:${(documents.address() as { port: number }).port}`;
    ownClient = `${documentsOrigin.replace("http:", "https:")}/account.json`;
    const config = join(daemon.root, "server.json");
    writeFileSync(
      config,
      JSON.stringify({
        apiOrigin: api,
        domains: { active: `content.localhost:${port}` },
        scheme: "http",
        identityProviders: [{ id: "dev", kind: "development", label: "Development" }],
        operator: OPERATOR,
        operatorClients: [{ clientId: ownClient, name: "Example Cloud account" }],
      }),
    );
    await Promise.all([reservedPort.release(), reservedControl.release()]);
    server = spawn(
      process.execPath,
      [BIN, "server", "--data", data, "--config", config, "--listen", `127.0.0.1:${port}`],
      {
        stdio: ["ignore", "pipe", "inherit"],
        env: {
          ...process.env,
          MOSTRA_TEST_OPERATOR_PORT: String(control),
          MOSTRA_TEST_CIMD_ORIGIN: documentsOrigin,
          // The meter's window, short, so a page's performance report is seen at once (#167).
          MOSTRA_TEST_METER_WINDOW_MS: "300",
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      server?.stdout?.setEncoding("utf8");
      server?.stdout?.once("data", (line: string) =>
        line.includes('"started"') ? resolve() : reject(new Error(`server: ${line}`)),
      );
      server?.once("exit", (code) => reject(new Error(`the server exited (${code})`)));
    });
    client = await Client.connect(daemon.socket, { name: "e2e-owner" });
    // The owner links this machine, approving it on the device page as a person does.
    const context = await browser.newContext();
    const page = await context.newPage();
    const login = await client.call<{
      loginId: string;
      verificationUriComplete?: string;
      verificationUri: string;
      userCode: string;
    }>("remote/login", { server: api });
    await gotoShell(page, login.verificationUriComplete ?? login.verificationUri);
    await page.locator("input[name=user_code]").fill(login.userCode);
    await page.locator("input[name=name]").fill("Ada Lovelace");
    await page.getByRole("button", { name: "Approve this machine" }).click();
    await expect(page.getByText("The machine is linked to your account.")).toBeVisible();
    await client.call("remote/login.wait", { loginId: login.loginId, timeoutMs: 30_000 });
    await context.close();
  });

  test.afterAll(async () => {
    client?.close();
    server?.kill("SIGTERM");
    documents?.close();
    daemon?.child.kill("SIGTERM");
    await new Promise((resolve) => daemon?.child.once("exit", resolve));
    if (daemon) removeTree(daemon.root);
    expect(findings, findings.join("\n")).toEqual([]);
  });

  test("keyboard only: signing in from the chrome, answering and Submit, every focus visible", async ({
    browser,
    browserName,
  }, info) => {
    test.setTimeout(180_000);
    if (!client || !daemon) throw new Error("not started");
    // WebKit on macOS moves Tab between form controls only, as Safari does by default: links and
    // buttons need Option+Tab there, which is the browser's setting, not the page's.
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const own = await publishOwn(client, daemon.home, info, { fixture: "surfaces" });
    const shared = await client.call<{ url: string }>("share/start", {
      artifact: { artifactId: own.artifactId },
      via: "remote",
    });
    const frame = await openInShell(page, shared.url);
    /** Presses Tab until `selector` has the focus, and checks that the focus can be seen. */
    const tabTo = async (selector: string, within = 40): Promise<void> => {
      for (let step = 0; step < within; step += 1) {
        await page.keyboard.press(tab);
        if (
          await page.locator(selector).evaluate((element) => element === document.activeElement)
        ) {
          const outline = await page
            .locator(selector)
            .evaluate((element) => getComputedStyle(element).outlineStyle);
          expect(outline, `${selector}'s focus is visible`).not.toBe("none");
          return;
        }
      }
      throw new Error(`Tab never reached ${selector}`);
    };
    await tabTo("[data-mostra-sign-in]");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Continue with Development" })).toBeVisible();
    await tabTo('a[href^="/signin/dev/start"]');
    await page.keyboard.press("Enter");
    await tabTo("input[name=name]");
    await page.keyboard.type("Mary Golda Ross");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Continue as Mary Golda Ross to answer")).toBeVisible();
    await tabTo('button[value="approve"]');
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname.startsWith("/a/"));
    await openInShell(page, page.url());
    await expect(page.locator("[data-mostra-viewer]")).toContainText("Mary Golda Ross");
    // The answer by keyboard alone, inside the frame, then the trusted Submit.
    await frame.getByTestId("day-Tuesday").focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-mostra-save]")).toHaveAttribute("data-mostra-save", "saved");
    // A trusted control is disabled, so no Tab reaches it, until it is armed (D111's half second
    // after the controls last changed, as the answer just did): the keyboard reaches it once armed.
    await expect(page.locator("[data-mostra-trusted][data-mostra-armed]")).toBeVisible();
    await page.locator("#mostra-fold").focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
    await expect(page.locator("#mostra-submit")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-mostra-submission]")).toHaveAttribute(
      "data-mostra-submission",
      "sent",
    );
    await context.close();
  });

  for (const mode of MODES) {
    for (const size of SIZES) {
      test(`every surface, ${mode}, ${size.width} px wide`, async ({
        browser,
        browserName,
      }, info) => {
        test.setTimeout(300_000);
        if (!client || !daemon) throw new Error("not started");
        const owner = client;
        const home = daemon.home;
        const phone = size.width < 500;
        const who = PEOPLE[MODES.indexOf(mode) * SIZES.length + SIZES.indexOf(size)] as string;
        const newContext = (): Promise<BrowserContext> =>
          (browser as Browser).newContext({
            viewport: size,
            colorScheme: mode,
            reducedMotion: "reduce",
            ...(phone ? { deviceScaleFactor: 2, hasTouch: true } : {}),
            ...(phone && browserName !== "firefox" ? { isMobile: true } : {}),
          });

        /** Checks a surface (axe, no sideways scrolling) and photographs it when asked. */
        const shoot = async (page: Page, name: string): Promise<void> => {
          await page.evaluate(() => document.fonts.ready.then(() => true));
          // The trusted controls take no click for 500 ms after they appear (SH-02): the picture
          // and the checks are of the page a person acts on.
          const armed = (): Promise<unknown> =>
            page.waitForFunction(
              () =>
                document.querySelector("[data-mostra-trusted]") === null ||
                document.querySelector("[data-mostra-trusted][data-mostra-armed]") !== null,
            );
          // They disarm again when their words change as the page greets the shell: wait past it.
          await armed();
          await page.waitForTimeout(600);
          await armed();
          const where = `${browserName} ${mode} ${size.width}px ${name}`;
          const wide = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          if (wide > 1) findings.push(`${where}: scrolls sideways by ${wide}px`);
          await page.evaluate(AXE);
          const violations = await page.evaluate(async () => {
            const engine = (
              window as unknown as {
                axe: {
                  run(
                    context: unknown,
                    options: unknown,
                  ): Promise<{
                    violations: {
                      id: string;
                      impact: string;
                      nodes: { target: unknown; failureSummary?: string }[];
                    }[];
                  }>;
                };
              }
            ).axe;
            const result = await engine.run(
              { exclude: [["iframe"]] },
              { resultTypes: ["violations"] },
            );
            return result.violations
              .filter(
                (violation) => violation.impact === "serious" || violation.impact === "critical",
              )
              .map(
                (violation) =>
                  `${violation.id} (${violation.impact}) at ${JSON.stringify(violation.nodes.map((node) => [node.target, node.failureSummary]))}`,
              );
          });
          for (const violation of violations) findings.push(`${where}: ${violation}`);
          if (SCREENS) {
            const dir = join(SCREENS, browserName, `${mode}-${size.width}`);
            mkdirSync(dir, { recursive: true });
            await page.screenshot({
              path: join(dir, `${name}.png`),
              fullPage:
                !name.startsWith("hosted") && !name.startsWith("local") && !name.startsWith("end-"),
            });
          }
        };

        const share = async (
          fixture = "surfaces",
        ): Promise<{ url: string; artifactId: string }> => {
          const own = await publishOwn(owner, home, info, { fixture });
          const shared = await owner.call<{ url: string }>("share/start", {
            artifact: { artifactId: own.artifactId },
            via: "remote",
          });
          return { url: shared.url, artifactId: own.artifactId };
        };
        const routeOf = (url: string): string => new URL(url).pathname.split("/")[2] as string;
        /** Opens a link afresh: the same link again is only a fragment change, which loads nothing. */
        const reopen = async (page: Page, url: string): Promise<void> => {
          await page.goto("about:blank");
          await gotoShell(page, url);
        };

        // The hosted chrome for someone who isn't signed in.
        const person = await newContext();
        const page = await person.newPage();
        const first = await share();
        await openInShell(page, first.url);
        await shoot(page, "hosted-anonymous");
        // Naming oneself: on a phone, through the sheet of the viewer's choices.
        if (phone) {
          await page.locator(".mostra-viewer-toggle").click();
          await shoot(page, "hosted-viewer-sheet");
        }
        await page.locator("[data-mostra-name]").click();
        await shoot(page, "hosted-naming");
        await page.locator("[data-mostra-naming] input").fill("مريم الأحمدي");
        await page.locator("[data-mostra-naming] button[type=submit]").click();
        await expect(page.locator("[data-mostra-name]")).toContainText("مريم الأحمدي");
        if (phone) await page.locator(".mostra-viewer-close").click();
        await shoot(page, "hosted-named");
        // The report dialog.
        await page.locator("[data-mostra-report]").click();
        // Photographed opened, not half-way through its fade (#161).
        await settled(page.locator("[data-mostra-report-dialog]"));
        await shoot(page, "hosted-report");
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-mostra-report-dialog]")).toBeHidden();
        // Folded: only the status and the way back.
        await page.locator("#mostra-fold").click();
        await expect(page.locator("#mostra-unfold")).toBeFocused();
        await expect(page.locator(".mostra-rail")).toBeHidden();
        await expect(page.locator("[data-mostra-passwords]")).toHaveCount(0);
        // Folded where the bar was (#218): at the top on a computer, at the dock's place, the
        // bottom, on a phone.
        const folded = await page.locator("[data-mostra-folded-bar]").boundingBox();
        const screen = page.viewportSize();
        expect(folded && screen).toBeTruthy();
        if (folded && screen) {
          if (phone) expect(folded.y + folded.height).toBeGreaterThan(screen.height - 80);
          else expect(folded.y).toBeLessThan(40);
        }
        await shoot(page, "hosted-folded");
        await page.locator("#mostra-unfold").click();
        await expect(page.locator("#mostra-fold")).toBeFocused();
        // A refused answer: a required field left empty.
        await page.locator("#mostra-submit").click();
        await expect(page.locator(".mostra-problem")).toBeVisible();
        await shoot(page, "hosted-blocked");

        // Signing in from the chrome: the API origin's pages.
        await page.locator(phone ? ".mostra-viewer-toggle" : "[data-mostra-sign-in]").click();
        if (phone) await page.locator("[data-mostra-sign-in]").click();
        await expect(page.getByRole("link", { name: "Continue with Development" })).toBeVisible();
        await shoot(page, "api-signin");
        await page.getByRole("link", { name: "Continue with Development" }).click();
        await shoot(page, "api-dev-name");
        await page.locator("input[name=name]").fill(who);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText(`Continue as ${who} to answer`)).toBeVisible();
        await shoot(page, "api-answer-as");
        await page.getByRole("button", { name: "Continue" }).click();
        // The sign-in returns to the apex, which redeems the code once and goes back to the page.
        await page.waitForURL((url) => url.pathname.startsWith("/a/"));
        const signed = await openInShell(page, page.url());
        await expect(page.locator("[data-mostra-viewer]")).toContainText(`Signed in as ${who}`);
        await shoot(page, "hosted-signed-in");
        await signed.getByTestId("day-Tuesday").check();
        await signed.getByTestId("notes").fill("Mornings work better for Lisbon.");
        await expect(page.locator("[data-mostra-save]")).toHaveAttribute(
          "data-mostra-save",
          "saved",
        );
        await page.locator("#mostra-submit").click();
        await expect(page.locator("[data-mostra-submission]")).toHaveAttribute(
          "data-mostra-submission",
          "sent",
        );
        await shoot(page, "hosted-sent");
        // The footer is one row at any width (Mirza's review of WP-20): its items never wrap
        // under each other, and Report keeps its name where only its flag shows.
        const footer = page.locator("[data-mostra-footer]");
        const items = await footer
          .locator("[data-mostra-passwords], [data-mostra-report], .mostra-footer-end")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.getBoundingClientRect();
              return box.top + box.height / 2;
            }),
          );
        expect(Math.max(...items) - Math.min(...items)).toBeLessThan(8);
        await expect(page.getByRole("button", { name: "Report" })).toBeVisible();

        // Linking a machine, signed in: approved and refused.
        const code = async (): Promise<string> => {
          const answer = await ask(port, `api.localhost:${port}`, "/oauth/device", {
            method: "POST",
            type: "application/x-www-form-urlencoded",
            body: "client_id=mostra-cli&mostra_name=Ada%27s+MacBook",
          });
          return (JSON.parse(answer.body) as { user_code: string }).user_code;
        };
        await gotoShell(page, `${api}/device?user_code=${await code()}`);
        await shoot(page, "api-device-signed-in");
        await page.getByRole("button", { name: "Approve this machine" }).click();
        await expect(page.getByText("The machine is linked to your account.")).toBeVisible();
        await shoot(page, "api-device-approved");
        await gotoShell(page, `${api}/device?user_code=${await code()}`);
        await page.getByRole("button", { name: "Refuse" }).click();
        await shoot(page, "api-device-refused");

        // A chat app's consent: a registered client, then one that returns to this computer.
        const registerClient = async (name: string, redirect: string): Promise<string> => {
          const answer = await ask(port, `api.localhost:${port}`, "/oauth/register", {
            method: "POST",
            type: "application/json",
            body: JSON.stringify({
              client_name: name,
              redirect_uris: [redirect],
              token_endpoint_auth_method: "none",
            }),
          });
          return (JSON.parse(answer.body) as { client_id: string }).client_id;
        };
        const authorize = (clientId: string, redirect: string): string =>
          `${api}/oauth/authorize?${new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirect,
            state: "ux",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            code_challenge_method: "S256",
            resource: `${api}/mcp`,
            scope: "mostra offline_access",
          })}`;
        const claude = "https://claude.ai/api/mcp/auth_callback";
        await gotoShell(page, authorize(await registerClient("Claude", claude), claude));
        await shoot(page, "api-allow");
        const local = "http://127.0.0.1/callback";
        await gotoShell(page, authorize(await registerClient("Local agent", local), local));
        await shoot(page, "api-allow-loopback");
        // The operator's own app (MT-05): named as the server's own, never as naming itself.
        const accountPage = "https://account.example/signin/done";
        await gotoShell(page, authorize(ownClient, accountPage));
        await expect(page.getByText("this server's own app")).toBeVisible();
        await shoot(page, "api-allow-own");
        await gotoShell(page, `${api}/signin/return?step=nothing`);
        await shoot(page, "api-cant-continue");
        // Signing out (MT-06): the sign-in page asked for afresh with the session shown, the page
        // with one button, and the page after it.
        await gotoShell(page, `${authorize(ownClient, accountPage)}&prompt=login`);
        await expect(page.getByText(`Signed in as ${who}`)).toBeVisible();
        await shoot(page, "api-signin-signed-in");
        await gotoShell(page, `${api}/signout`);
        await shoot(page, "api-sign-out");
        await page.locator('form[action="/signout"] button').last().click();
        await expect(page.getByRole("heading", { name: "You're signed out" })).toBeVisible();
        await shoot(page, "api-signed-out");
        await person.close();

        // Linking a machine, not signed in: the development provider's form, and a wrong code.
        const stranger = await newContext();
        const device = await stranger.newPage();
        await gotoShell(device, `${api}/device`);
        await shoot(device, "api-device");
        await device.locator("input[name=user_code]").fill("WXYZ-2345");
        await device.locator("input[name=name]").fill("Ada Lovelace");
        await device.getByRole("button", { name: "Approve this machine" }).click();
        await shoot(device, "api-device-error");

        // The pages a link can end on.
        await gotoShell(device, `http://nowhere.localhost:${port}/`);
        await shoot(device, "end-unknown-host");
        const ending = await share();
        const route = routeOf(ending.url);
        await operator("/handle", { method: "quarantine", args: [{ routeId: route }, "review"] });
        await reopen(device, ending.url);
        await expect(device.locator("html")).toHaveAttribute("data-shell", "error");
        await shoot(device, "end-under-review");
        await operator("/handle", { method: "release", args: [{ routeId: route }] });
        await operator("/state", {
          limits: { view: { code: "MOSTRA_REMOTE_LIMIT_REACHED", message: "Views are used up." } },
        });
        await reopen(device, ending.url);
        await expect(device.locator("html")).toHaveAttribute("data-shell", "error");
        await shoot(device, "end-limit");
        await operator("/state", { limits: {} });
        // The owner's pages suspended, then moving between machines.
        const calls = JSON.parse((await ask(control, `127.0.0.1:${control}`, "/calls")).body) as {
          port: string;
          payload: { routeId?: string; home?: string };
        }[];
        const homeId = calls.find((call) => call.payload.routeId === route && call.payload.home)
          ?.payload.home as string;
        expect(homeId).toBeDefined();
        await operator("/handle", { method: "suspendHome", args: [homeId, "review"] });
        await reopen(device, ending.url);
        // A suspended home refuses the shell's own page: the server's page in its theme says so.
        await expect(device.locator("body")).toContainText("MOSTRA_REMOTE_HOME_SUSPENDED");
        await shoot(device, "end-suspended");
        await operator("/handle", { method: "resumeHome", args: [homeId] });
        await operator("/handle", { method: "drainHome", args: [homeId] });
        await reopen(device, ending.url);
        await expect(device.locator("body")).toContainText("MOSTRA_REMOTE_HOME_MOVING");
        await shoot(device, "end-moving");
        await operator("/handle", { method: "releaseHome", args: [homeId] });
        await owner.call("share/stop", { artifact: { artifactId: ending.artifactId } });
        await reopen(device, ending.url);
        await expect(device.locator("html")).toHaveAttribute("data-shell", "error");
        await shoot(device, "end-expired");

        // An operator's interstitial, then a page whose owner paused it with a long reason.
        await operator("/state", {
          policy: {
            interstitial: { kind: "risk", message: LONG_REASON },
            footer: LONG_REASON.slice(0, 500),
          },
        });
        const guarded = await share();
        await gotoShell(device, guarded.url);
        await expect(device.locator("[data-mostra-interstitial]")).toBeVisible();
        await shoot(device, "hosted-interstitial");
        // Where the operator asks (#167), the shell sends one report of the page's load, which
        // the server counts for the operator's metering and keeps nowhere.
        await operator("/state", { policy: { performance: { report: true } } });
        const measured = await share();
        await openInShell(device, measured.url);
        await expect(device.locator("html")).toHaveAttribute("data-shell", "ready");
        await expect
          .poll(
            async () => {
              const answer = await ask(control, `127.0.0.1:${control}`, "/calls");
              const calls = JSON.parse(answer.body) as {
                port: string;
                payload: { counters?: { name: string; artifactId?: string }[] };
              }[];
              return calls.some(
                (call) =>
                  call.port === "metering" &&
                  (call.payload.counters ?? []).some(
                    (counter) =>
                      counter.name === "page.loads" && counter.artifactId === measured.artifactId,
                  ),
              );
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        await operator("/state", { policy: {} });
        const paused = await share();
        await owner.call("artifact/pause", {
          artifact: { artifactId: paused.artifactId },
          paused: true,
          reason: LONG_REASON.slice(0, 500),
        });
        await openInShell(device, paused.url);
        await expect(device.locator("[data-mostra-paused]")).toBeVisible();
        await shoot(device, "hosted-paused");

        // A new version while the page is open, and a title that won't break.
        const versioned = await publishOwn(owner, home, info, { fixture: "surfaces" });
        const versionedLink = await owner.call<{ url: string }>("share/start", {
          artifact: { artifactId: versioned.artifactId },
          via: "remote",
        });
        await openInShell(device, versionedLink.url);
        await republish(owner, versioned, (text) =>
          text.replace("Three days work", "Two days work"),
        );
        await expect(device.locator("[data-mostra-banner]")).toBeVisible({ timeout: 30_000 });
        await shoot(device, "hosted-new-version");
        const long = await share("surfaces-long");
        await openInShell(device, long.url);
        await shoot(device, "hosted-long-title");
        await stranger.close();

        // The local shell, on the owner's own machine.
        const mine = await newContext();
        const local1 = await mine.newPage();
        const own = await publishOwn(owner, home, info, { fixture: "surfaces" });
        const view = await owner.call<{ url: string }>("view/url", {
          artifact: { artifactId: own.artifactId },
        });
        await openInShell(local1, view.url);
        await shoot(local1, "local-page");
        await republish(owner, own, (text) => text.replace("Three days work", "Two days work"));
        await expect(local1.locator("[data-mostra-banner]")).toBeVisible({ timeout: 20_000 });
        await shoot(local1, "local-new-version");
        await mine.close();
      });
    }
  }
});
