import { defineConfig, devices } from "@playwright/test";

// The shared Playwright Test setup for Mostra's end-to-end suites. Suites start the real gateway
// (WP-05 onward) and run in all three engines where behavior differs (STANDARDS, Verification).
export default defineConfig({
  testDir: "./specs",
  // One real daemon for the run, with the render fixtures published (support/mostra.ts).
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
