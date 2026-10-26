/**
 * How `create-mostra` runs the CLI (Opus review finding 9): the exit code a signal gives, the
 * signals it passes on (as the CLI's bootstrap does), and one `--json` envelope when the CLI
 * can't be started at all.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "../../src/index.ts";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mcmr-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in `mostra`: it ends itself by a signal, or counts the SIGINTs it gets for a while. */
const FAKE_CLI = `
const { writeFileSync } = require("node:fs");
const mode = process.env.FAKE_MODE;
if (mode === "sigterm") process.kill(process.pid, "SIGTERM");
if (mode === "exit") process.exit(7);
let interrupts = 0;
process.on("SIGINT", () => { interrupts += 1; });
writeFileSync(process.env.FAKE_READY, "ready");
setTimeout(() => process.exit(interrupts), 1500);
`;

/** Runs `create()` in a process of its own, so a signal can be sent to it. */
function drive(env: Record<string, string>, onReady?: (pid: number) => void): Promise<number> {
  const cli = join(dir, "fake-mostra.cjs");
  writeFileSync(cli, FAKE_CLI);
  const driver = join(dir, "driver.mjs");
  const index = resolve(import.meta.dirname, "..", "..", "src", "index.ts");
  writeFileSync(
    driver,
    // A file URL: Windows' absolute paths aren't import specifiers.
    `import { create } from ${JSON.stringify(pathToFileURL(index).href)};
const code = await create({
  args: ["art"],
  cwd: ${JSON.stringify(dir)},
  env: process.env,
  stdout: () => {},
  stderr: () => {},
  terminal: process.env.TERMINAL === "1",
  cli: () => ${JSON.stringify(cli)},
});
process.exit(code);
`,
  );
  const ready = join(dir, `ready-${Math.random().toString(36).slice(2)}`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [driver], {
      env: { ...process.env, ...env, FAKE_READY: ready },
      stdio: "ignore",
    });
    const poll = setInterval(() => {
      if (existsSync(ready)) {
        clearInterval(poll);
        onReady?.(child.pid as number);
      }
    }, 20);
    child.on("exit", (code) => {
      clearInterval(poll);
      done(code ?? -1);
    });
  });
}

/** Windows sends no signal between processes (D150 item 6): a CLI ends there with an exit code. */
const POSIX = process.platform !== "win32";

describe("create-mostra runs the CLI as its bootstrap does", () => {
  it("exits with the CLI's own exit code", async () => {
    expect(await drive({ FAKE_MODE: "exit" })).toBe(7);
  });

  it.runIf(POSIX)(
    "exits as a shell reports a signal that ended the CLI: 128 plus its number",
    async () => {
      expect(await drive({ FAKE_MODE: "sigterm" })).toBe(
        128 + (constants.signals.SIGTERM as number),
      );
    },
  );

  it.runIf(POSIX)(
    "passes SIGINT on when no terminal is attached, and not when one is (the CLI got its own)",
    async () => {
      const send = (pid: number): void => {
        process.kill(pid, "SIGINT");
      };
      expect(await drive({ TERMINAL: "0" }, send)).toBe(1);
      expect(await drive({ TERMINAL: "1" }, send)).toBe(0);
    },
  );

  it("answers a CLI it can't find with one --json envelope and exit 3, never a stack trace", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await create({
      args: ["art", "--json"],
      cwd: dir,
      env: process.env,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      cli: () => {
        throw new Error("Cannot find module '@mostra/cli/package.json'");
      },
    });
    expect(code).toBe(3);
    const lines = out.join("").trim().split("\n");
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0] as string) as {
      ok: boolean;
      error: Record<string, string>;
      warnings: unknown[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.warnings).toEqual([]);
    expect(envelope.error).toMatchObject({
      code: "MOSTRA_ENV_RUNTIME_MISSING",
      severity: "error",
      phase: "host",
      docs: "https://mostra-dev.github.io/mostra/errors/MOSTRA_ENV_RUNTIME_MISSING",
    });
    expect(envelope.error["message"]).toContain("Cannot find module");
    expect(err.join("")).not.toMatch(/at .*\.(js|ts):\d+/);
    expect(existsSync(join(dir, "art"))).toBe(false);
  });
});
