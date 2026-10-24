/// <reference lib="dom" />
/**
 * `mostra open --browser` in Chromium, Firefox and WebKit (D140 item 15, Opus review finding 4):
 * the built CLI hands its browser a local page, never the launch URL on a command line, and that
 * page, opened from disk as a browser opens a file, sends the browser on to the shell, which
 * exchanges the one-time ticket for the link's session.
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { CLI, readRun, SCRATCH, WIN_HELPER, WINDOWS } from "../support/mostra.ts";

const run = readRun();

test("the launch page from mostra open opens the artifact once", async ({ page }) => {
  const scratch = realpathSync.native(mkdtempSync(join(SCRATCH, "mostra-e2e-open-")));
  try {
    // A stand-in browser that records what it was asked to open and opens nothing itself:
    // Node.js running a script, a program on every platform.
    const record = join(scratch, "argv.txt");
    const opener = join(scratch, "browser.mjs");
    writeFileSync(
      opener,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(record)}, process.argv.slice(2).join("\\n") + "\\n");\n`,
    );
    const windows = WINDOWS
      ? {
          // What Windows gives every program, and the development switch the legs run behind.
          ...Object.fromEntries(
            ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "LOCALAPPDATA", "APPDATA"]
              .filter((name) => process.env[name] !== undefined)
              .map((name) => [name, process.env[name] as string]),
          ),
          MOSTRA_DEV_WINDOWS: "1",
          MOSTRA_WIN_HELPER: WIN_HELPER,
          USERPROFILE: scratch,
          TEMP: scratch,
          TMP: scratch,
        }
      : {};
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [CLI, "open", run.receipts.tsx.artifactId, "--browser", "--json"],
      {
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: scratch,
          MOSTRA_HOME: run.home,
          MOSTRA_CONFIG_DIR: join(scratch, "config"),
          BROWSER: `"${process.execPath}" "${opener}"`,
          // The launch page goes into the scratch directory, which the test removes.
          TMPDIR: scratch,
          ...windows,
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, result: { opened: true } });
    // The stand-in starts detached, so its record may come a moment after the CLI ends.
    const recorded = (): string => (existsSync(record) ? readFileSync(record, "utf8").trim() : "");
    await expect.poll(recorded, { timeout: 10_000 }).toMatch(/\.html$/);
    const file = recorded();
    // Opened from disk, the page goes on to the shell, whose exchange spends the ticket.
    await page.goto(pathToFileURL(file).href);
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_/, { timeout: 15_000 });
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 15_000 });
    // The ticket left the address bar, as a token does.
    expect(new URL(page.url()).hash).toBe("");
    // The same page again: its ticket is spent, so the shell says the link doesn't work.
    const again = await page.context().browser()?.newPage();
    if (!again) throw new Error("no second page");
    await again.goto(pathToFileURL(file).href);
    await again.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_/, { timeout: 15_000 });
    await expect(again.locator("html")).toHaveAttribute("data-shell", "error", { timeout: 15_000 });
    await again.close();
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
});
