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

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("ending a host shim (Opus review of WP-W3, finding 3)", () => {
  it("ends a descendant that holds the shim's output after the shim exits", async () => {
    dir = mkdtempSync(join(tmpdir(), "kit-close-"));
    const file = join(dir, "grandchild.pid");
    const host = await HostUnderTest.start(`node --conditions=@mostra/source "${SHIM}"`, {
      MOSTRA_KIT_TEST_PID_FILE: file,
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(file) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 50));
    }
    const pid = Number(readFileSync(file, "utf8"));
    expect(alive(pid)).toBe(true);
    await host.close();
    const gone = Date.now() + 5_000;
    while (alive(pid) && Date.now() < gone) await new Promise((done) => setTimeout(done, 100));
    expect(alive(pid), `the grandchild ${pid} outlived close()`).toBe(false);
  }, 60_000);
});
