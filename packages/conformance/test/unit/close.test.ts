import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostUnderTest } from "@mostra/conformance";
import { afterEach, describe, expect, it } from "vitest";

const SHIM = join(import.meta.dirname, "..", "fixtures", "lingering-shim.ts");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The kit finds the Windows helper beside the runtime it resolves; these unit tests run without a
 * built runtime, so they name the helper Cargo built for the Windows legs, as the other suites do,
 * and fail rather than pass for another reason when it is missing.
 */
function useCheckoutHelper(): void {
  if (process.platform !== "win32" || process.env["MOSTRA_WIN_HELPER"]) return;
  const built = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "target",
    "release",
    "mostra-win.exe",
  );
  expect(existsSync(built), `the Windows helper Cargo builds (${built})`).toBe(true);
  process.env["MOSTRA_WIN_HELPER"] = built;
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("ending a host shim (Opus review of WP-W3, finding 3)", () => {
  it("ends a descendant that holds the shim's output after the shim exits", async () => {
    useCheckoutHelper();
    dir = mkdtempSync(join(tmpdir(), "kit-close-"));
    const file = join(dir, "grandchild.pid");
    const host = await HostUnderTest.start(`node --conditions=@mostra/source "${SHIM}"`, {
      MOSTRA_KIT_TEST_PID_FILE: file,
    });
    // The grandchild's PID, once it is there: a file read too early once gave 0, and `kill(0)`
    // signals this test's own process group, which is always alive (CI run 40500856396).
    const read = (): number => (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0);
    const deadline = Date.now() + 10_000;
    while (!(read() > 0) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 50));
    }
    const pid = read();
    expect(Number.isInteger(pid) && pid > 0, `the grandchild's PID file held ${pid}`).toBe(true);
    expect(alive(pid)).toBe(true);
    await host.close();
    const gone = Date.now() + 5_000;
    while (alive(pid) && Date.now() < gone) await new Promise((done) => setTimeout(done, 100));
    expect(alive(pid), `the grandchild ${pid} outlived close()`).toBe(false);
  }, 60_000);
});
