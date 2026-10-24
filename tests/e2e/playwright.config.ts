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
  // On Windows one test at a time: the daemon, its workers and a browser's several contexts
  // share the runner's four cores, and Firefox there (software rendering, a profile per context)
  // took two tests at once past their 30 s (WP-W2's first runs).
  ...(process.platform === "win32" ? { workers: 1 } : {}),
  // Each test's 30 s include its page's start: on the Windows arm64 runner Firefox took 13 s to
  // launch and open a first page, and the first frame 9.5 s more while its worker started cold,
  // so a test that opens three pages ran past 30 s with nothing wrong (main's run 40096242377).
  // Windows gets 60 s.
  ...(process.platform === "win32" ? { timeout: 60_000 } : {}),
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
