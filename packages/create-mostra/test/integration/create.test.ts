/**
 * `npm create mostra` through the built binary, against a real instance of the development
 * runtime beside it (RT-01): it creates the artifact with `mostra new`, says what to run next,
 * keeps `--json` to the CLI's one envelope, and passes the CLI's failures on as they are.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../../dist/bin.js", import.meta.url));
// Real path: on macOS /tmp is a link to /private/tmp, and the CLI reports real paths. /tmp keeps
// the control socket's path short on POSIX (D82); Windows has a pipe and no /tmp.
const root = realpathSync.native(
  mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "mcm-")),
);
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined || name.startsWith("npm_") || name.startsWith("MOSTRA_")) continue;
  env[name] = value;
}
Object.assign(env, {
  MOSTRA_HOME: join(root, "home"),
  MOSTRA_RUNTIME_DIR: join(root, "run"),
  MOSTRA_CONFIG_DIR: join(root, "config"),
  DO_NOT_TRACK: "1",
});

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

afterAll(async () => {
  const cli = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));
  await new Promise((done) =>
    spawn(process.execPath, [cli, "daemon", "stop", "--json"], { env, stdio: "ignore" }).on(
      "close",
      done,
    ),
  );
  rmSync(root, { recursive: true, force: true });
});

describe("npm create mostra", () => {
  it("creates an artifact with mostra new and says what to run next", async () => {
    const created = await run(["--", "review", "--title", "Q3 review"]);
    expect(created.code, created.stderr).toBe(0);
    const entry = join(root, "review", "index.tsx");
    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(entry, "utf8")).toContain("Q3 review");
    expect(created.stdout).toContain("npx @mostra/cli verify review");
  });

  it("keeps --json to the CLI's one envelope", async () => {
    const created = await run(["json-one", "--json"]);
    expect(created.code, created.stderr).toBe(0);
    const lines = created.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0] as string) as { ok: boolean; result: { dir: string } };
    expect(envelope.ok).toBe(true);
    expect(envelope.result.dir).toBe(join(root, "json-one"));
  });

  it("passes the CLI's failure on: a directory that isn't empty", async () => {
    mkdirSync(join(root, "taken"));
    writeFileSync(join(root, "taken", "notes.txt"), "mine");
    const refused = await run(["taken", "--json"]);
    expect(refused.code).not.toBe(0);
    const envelope = JSON.parse(refused.stdout.trim()) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toMatch(/^MOSTRA_ARTIFACT_/);
    expect(readFileSync(join(root, "taken", "notes.txt"), "utf8")).toBe("mine");
  });
});
