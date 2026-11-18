import * as childProcess from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostUnderTest } from "@mostra/conformance";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every `spawnSync` the kit makes still runs; the spy only records them, to see each taskkill.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

/** The PIDs `close` handed to taskkill since the spy was last cleared. */
const taskkills = (): string[] =>
  vi
    .mocked(childProcess.spawnSync)
    .mock.calls.filter(([command]) => String(command).toLowerCase().endsWith("taskkill.exe"))
    .map(([, args]) => String((args as readonly string[])[1]));

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

/** The grandchild's PID, once the lingering shim's grandchild has written it. */
async function grandchildOf(file: string): Promise<number> {
  // A file read too early once gave 0, and `kill(0)` signals this test's own process group, which
  // is always alive (CI run 40500856396).
  const read = (): number => (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0);
  const deadline = Date.now() + 10_000;
  while (!(read() > 0) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 50));
  }
  const pid = read();
  expect(Number.isInteger(pid) && pid > 0, `the grandchild's PID file held ${pid}`).toBe(true);
  return pid;
}

async function gone(pid: number, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
  return !alive(pid);
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
    const pid = await grandchildOf(file);
    expect(alive(pid)).toBe(true);
    await host.close();
    expect(await gone(pid), `the grandchild ${pid} outlived close()`).toBe(true);
  }, 60_000);

  // Once the shell has exited, Windows may give its PID to any new process, and `taskkill /T /F`
  // on it ends that process and its tree: in CI, another suite's shim started in those 5 s
  // (runner.test.ts's fourth scenario failed at its start, #140).
  it.runIf(process.platform === "win32")(
    "never hands taskkill the PID of a shell that has exited (#140)",
    async () => {
      useCheckoutHelper();
      dir = mkdtempSync(join(tmpdir(), "kit-close-"));
      const file = join(dir, "grandchild.pid");
      const host = await HostUnderTest.start(`node --conditions=@mostra/source "${SHIM}"`, {
        MOSTRA_KIT_TEST_PID_FILE: file,
      });
      const pid = await grandchildOf(file);
      vi.mocked(childProcess.spawnSync).mockClear();
      // The shim, and with it its shell, exits as its stdin ends; the grandchild keeps the output.
      await host.close();
      expect(taskkills(), "taskkill was given the PID of a shell that had exited").toEqual([]);
      // The noted tree still ends the grandchild.
      expect(await gone(pid), `the grandchild ${pid} outlived close()`).toBe(true);
    },
    60_000,
  );

  it.runIf(process.platform === "win32")(
    "ends a shell that is still running through taskkill",
    async () => {
      useCheckoutHelper();
      dir = mkdtempSync(join(tmpdir(), "kit-close-"));
      const file = join(dir, "grandchild.pid");
      const host = await HostUnderTest.start(`node --conditions=@mostra/source "${SHIM}"`, {
        MOSTRA_KIT_TEST_PID_FILE: file,
        MOSTRA_KIT_TEST_STAY: "1",
      });
      const pid = await grandchildOf(file);
      vi.mocked(childProcess.spawnSync).mockClear();
      await host.close();
      expect(taskkills()).toHaveLength(1);
      expect(await gone(pid), `the grandchild ${pid} outlived close()`).toBe(true);
    },
    60_000,
  );
});
