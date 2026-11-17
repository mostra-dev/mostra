/**
 * `pnpm check` exits without losing output where its output is a pipe (tools/check/exit.ts): a CI
 * step's log, or a test that runs it. Found by WP-17's CI, where the gate test of a failed
 * prerequisite build lost the run's summary once the job's output outgrew a pipe's buffer.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const exitModule = pathToFileURL(new URL("../check/exit.ts", import.meta.url).pathname).href;

/** Runs `body` in a child whose stdout and stderr are pipes, with `exitAfterOutput` in scope. */
function child(body: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { exitAfterOutput } from ${JSON.stringify(exitModule)};\n${body}`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

describe("exiting after the output (pnpm check)", () => {
  it("hands on everything printed before it exits, however much, with its code", () => {
    const result = child(`
      const line = "x".repeat(100);
      for (let i = 0; i < 20000; i++) console.log(line);
      console.log("✗ api");
      console.error("on stderr too");
      exitAfterOutput(3);
    `);
    expect(result.status).toBe(3);
    expect(result.stdout.length).toBe(20000 * 101 + "✗ api\n".length);
    expect(result.stdout.endsWith("✗ api\n")).toBe(true);
    expect(result.stderr).toBe("on stderr too\n");
  });

  it("keeps the first code it is given, so a deadline's 1 isn't turned into a later 0", () => {
    const result = child(`
      console.log("deadline report");
      exitAfterOutput(1);
      console.log("summary");
      exitAfterOutput(0);
    `);
    expect(result.status).toBe(1);
    expect(result.stdout.startsWith("deadline report\n")).toBe(true);
  });
});
