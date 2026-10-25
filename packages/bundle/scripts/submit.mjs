#!/usr/bin/env node
/**
 * A viewer's submission through the real shell, for the bundle's smoke tests (RT-01, RT-12): the
 * bundle's own Playwright drives the bundle's own verify browser, so nothing but the bundle's
 * Node.js runs it, as on a machine without Node.js.
 *
 *   <bundle>/node/bin/node packages/bundle/scripts/submit.mjs <bundle root> <capability link> <answer>
 *
 * It opens the link in the shell, types `answer` into the artifact's field (`data-testid="note"`),
 * waits until the shell says it is saved, presses the shell's trusted Submit and waits until it
 * says Submitted. Exits 0 then, 1 with what it saw otherwise. Plain JavaScript and Node.js
 * built-ins only: it runs from a sparse checkout with no installed packages.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

const [root, link, answer] = process.argv.slice(2);
if (!root || !link || !answer) {
  console.error("usage: submit.mjs <bundle root> <capability link> <answer>");
  process.exit(2);
}
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, "browsers");
const require = createRequire(join(root, "lib", "node_modules", "playwright-core", "package.json"));
const { chromium } = require("playwright-core");

const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  await page.goto(link);
  await page.locator('html[data-shell="ready"]').waitFor({ state: "attached", timeout: 60_000 });
  const frame = page.frameLocator("iframe.mostra-frame");
  await frame.getByTestId("note").fill(answer, { timeout: 60_000 });
  await page.locator('[data-mostra-save="saved"]').waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#mostra-submit").click();
  await page.locator("[data-mostra-receipt]").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector("#mostra-submit")?.textContent?.trim() === "Submitted",
    undefined,
    { timeout: 30_000 },
  );
  console.log(JSON.stringify({ submitted: true }));
} catch (error) {
  const shell = page ? await page.content().catch(() => "") : "";
  console.error(`submit: ${error instanceof Error ? error.message : String(error)}`);
  console.error(shell.slice(0, 2000));
  process.exitCode = 1;
} finally {
  await browser.close();
}
