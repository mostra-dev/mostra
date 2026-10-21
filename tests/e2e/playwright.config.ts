import { defineConfig, devices } from "@playwright/test";

// The shared Playwright Test setup for Mostra's end-to-end suites. Suites start the real gateway
// (WP-05 onward) and run in all three engines where behavior differs (STANDARDS, Verification).
const projects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];
const browser = process.env["MOSTRA_E2E_BROWSER"];
if (browser && !projects.some((project) => project.name === browser)) {
  throw new Error(`MOSTRA_E2E_BROWSER is chromium, firefox or webkit, not "${browser}".`);
}

export default defineConfig({
  testDir: "./specs",
  // One real daemon for the run, with the render fixtures published (support/mostra.ts).
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  // CI runs one engine per machine (`MOSTRA_E2E_BROWSER`, the e2e job's matrix), so each stays
  // inside its time limit; locally every engine runs.
  projects: projects.filter(
    (project) => browser === undefined || browser === "" || project.name === browser,
  ),
});
