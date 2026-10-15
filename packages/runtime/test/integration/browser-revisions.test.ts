/// <reference lib="dom" />
/**
 * Published versions keep working on newer runtimes (VR-10, D111, FAILURE_MODEL §7): every
 * browser-protocol revision the gateway serves has a version frozen at it, and each frozen version
 * saves, raises a signal and submits through today's gateway, and through a gateway that serves a
 * newer revision too (the test-only `MOSTRA_TEST_BROWSER_REVISION_NEXT`), in Chromium. When a
 * revision N+1 ships, the version frozen at N runs here against it with no change to this file.
 */
import { BROWSER_PROTOCOL_REVISIONS, type Results } from "@mostra/protocol";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frozenRevisions, importFrozen } from "../frozen.ts";
import { GatewayHome, ok } from "../gateway-home.ts";
import { testHome } from "../support.ts";

/** A revision no Mostra release will have: the next one, as far as these tests are concerned. */
const NEXT = "2099-01-01";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

/** Opens a link in the shell and waits until the frame's page is ready. */
async function openShell(url: string): Promise<{ page: Page; requests: string[] }> {
  const page = await browser.newPage();
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/_mostra/v/")) requests.push(`${request.method()} ${path}`);
  });
  await page.goto(url);
  await page.waitForSelector("html[data-shell=ready]", { timeout: 30_000 });
  return { page, requests };
}

describe("versions built at an earlier browser-protocol revision (VR-10)", () => {
  it("every revision the gateway serves has a frozen version, and every frozen version is one it serves", () => {
    expect(frozenRevisions()).toEqual([...BROWSER_PROTOCOL_REVISIONS]);
  });

  for (const revision of frozenRevisions()) {
    for (const gateway of ["today's gateway", `a gateway at the next revision (${NEXT})`]) {
      it(`a version frozen at ${revision} saves, signals and submits through ${gateway}`, async () => {
        const home = testHome();
        const frozen = await importFrozen(home.home, revision);
        const next = gateway !== "today's gateway";
        const running = await new GatewayHome(home).start(
          next ? { env: { MOSTRA_TEST_BROWSER_REVISION_NEXT: NEXT } } : {},
        );
        try {
          const link = await running.link(frozen.artifactId, {
            viewer: { ref: `frozen-${revision}`, name: "Frozen" },
          });
          const { page, requests } = await openShell(link.url);
          const frame = page.frameLocator("iframe.mostra-frame");
          // The page is the frozen build, unchanged.
          expect(await frame.locator("meta[name=mostra-version]").getAttribute("content")).toBe(
            frozen.versionId,
          );
          await frame.getByTestId("name").fill("Frozen Ana");
          await page.waitForSelector("[data-mostra-save=saved]", { timeout: 15_000 });
          await frame.getByTestId("ping").click();
          await frame.getByTestId("result").filter({ hasText: /^ok:/ }).waitFor();
          await page.locator("#mostra-submit").click();
          await page.waitForSelector("[data-mostra-receipt]", { timeout: 15_000 });
          const results = ok<Results>(
            await running.client.call("results/get", {
              artifact: { artifactId: frozen.artifactId },
            }),
          );
          expect(results.submission.versionId).toBe(frozen.versionId);
          expect(results.submission.channel).toBe("shell");
          expect(results.answers).toMatchObject({ name: "Frozen Ana" });
          // The signal the page raised before submitting is in the snapshot.
          expect(results.signals.map((signal) => signal.name)).toEqual(["ping"]);
          // It spoke its own revision throughout, whatever else the gateway serves.
          expect(requests.length).toBeGreaterThan(0);
          for (const request of requests) expect(request).toContain(`/_mostra/v/${revision}/`);
          if (next) {
            // The newer gateway serves the next revision too, and still no revision it never had.
            const answers = await page.frames()[1]?.evaluate(
              async (revisions) => {
                const statuses: number[] = [];
                for (const rev of revisions) {
                  statuses.push(
                    (await fetch(`/_mostra/v/${rev}/events/poll?view=x&wait=0`)).status,
                  );
                }
                return statuses;
              },
              [NEXT, "2001-01-01"],
            );
            expect(answers).toEqual([400, 404]);
          }
          await page.close();
        } finally {
          await running.stop();
        }
      }, 120_000);
    }
  }
});
