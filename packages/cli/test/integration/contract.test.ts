/**
 * A contract test per command (AX-01, AX-09), through the built `mostra` against a real daemon:
 * with `--json` and stdin a closed pipe, every command prints exactly one envelope on stdout (its
 * schema checked), ends with its documented exit code, never waits for an answer, and keeps logs
 * off stdout. J1 runs through it end to end: new, verify, publish, open, a viewer's submission,
 * wait and results (WP-10's handoff).
 */
import { join } from "node:path";
import {
  artifactCreateMethod,
  CapabilityLink,
  gcRunMethod,
  PublishReceipt,
  Results,
  VerifyVerdict,
} from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandName } from "../../src/command.ts";
import { COMMANDS } from "../../src/commands/index.ts";
import { exitCodes } from "../../src/help.ts";
import { cli, envelope, type Ran, type TestHome, testHome, Viewer } from "../support.ts";

let home: TestHome;
const covered = new Set<string>();
let artifactDir = "";
let artifactId = "";
let link = "";

/** Runs a command with --json, checks the contract, and records that the command was covered. */
async function run(
  args: string[],
  expected: { code: number; ok: boolean; error?: string },
  input?: string,
): Promise<{ ran: Ran; result: unknown }> {
  const ran = await cli([...args, "--json"], {
    env: home.env,
    ...(input !== undefined ? { input } : {}),
  });
  const value = envelope(ran);
  expect({ code: ran.code, ok: value.ok, error: value.error?.code }, ran.stderr).toEqual({
    code: expected.code,
    ok: expected.ok,
    error: expected.error,
  });
  const command = COMMANDS.find(
    (candidate) =>
      candidate.path.every((word, index) => args[index] === word) &&
      !COMMANDS.some(
        (longer) =>
          longer.path.length > candidate.path.length &&
          longer.path.every((word, index) => args[index] === word),
      ),
  );
  expect(command, args.join(" ")).toBeDefined();
  if (command) {
    covered.add(commandName(command));
    // Every exit code a command ends with is one its help documents.
    expect(exitCodes(command)).toContain(ran.code);
  }
  return { ran, result: value.result };
}

beforeAll(() => {
  home = testHome({ MOSTRA_OFFLINE: "1" });
  artifactDir = join(home.root, "review");
});

afterAll(async () => {
  await home.cleanup();
});

describe("every command, with --json and no terminal", () => {
  it("new, verify, publish and open make an artifact a viewer can open (J1)", async () => {
    const created = await run(["new", artifactDir, "--title", "Sidebar review"], {
      code: 0,
      ok: true,
    });
    const parsed = artifactCreateMethod.result.parse(created.result);
    artifactId = parsed.artifactId;
    // verify needs the Chromium headless shell `playwright-core` pins (runtime's AGENTS.md).
    const verified = await run(["verify", artifactDir], { code: 0, ok: true });
    expect(VerifyVerdict.parse(verified.result).status).toBe("pass");
    // verify's progress goes to stderr, never stdout.
    expect(verified.ran.stderr).toContain("verify:");
    const published = await run(["publish", artifactDir], { code: 0, ok: true });
    const receipt = PublishReceipt.parse(published.result);
    expect(receipt.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_/);
    const opened = await run(["open", artifactDir, "--no-browser"], { code: 0, ok: true });
    const shown = CapabilityLink.parse(opened.result);
    expect(shown.url).toBe(receipt.url);
    link = shown.url;
  });

  it("wait ends still_waiting with exit 5, then returns the viewer's submission; results reads it", async () => {
    const waiting = await run(["wait", artifactId, "--until", "submitted", "--timeout", "1s"], {
      code: 5,
      ok: true,
    });
    expect(waiting.result).toMatchObject({ status: "still_waiting" });
    const viewer = await new Viewer().open(link);
    const submitted = await viewer.answerAndSubmit({ choice: "B" });
    expect(submitted.status, submitted.body).toBe(200);
    const satisfied = await run(["wait", artifactId, "--until", "submitted", "--timeout", "30s"], {
      code: 0,
      ok: true,
    });
    expect(satisfied.result).toMatchObject({ status: "satisfied" });
    const results = await run(["results", artifactId], { code: 0, ok: true });
    const parsed = Results.parse(results.result);
    expect(parsed.answers).toEqual({ choice: "B" });
    // Markdown without --json.
    const markdown = await cli(["results", artifactId], { env: home.env });
    expect(markdown.code).toBe(0);
    expect(markdown.stdout).toContain("## Answers");
  });

  it("state get, set and patch write and read artifact state; a stale base is a conflict, exit 6", async () => {
    const set = await run(["state", "set", artifactId, "priorities", '["Ship"]'], {
      code: 0,
      ok: true,
    });
    const { revision } = set.result as { revision: string };
    const read = await run(["state", "get", artifactId], { code: 0, ok: true });
    expect(read.result).toMatchObject({ fields: { priorities: { value: ["Ship"] } } });
    await run(
      ["state", "patch", artifactId, "--ops", '[{"id":"priorities","value":["Ship","Test"]}]'],
      { code: 0, ok: true },
    );
    const stale = await run(
      ["state", "patch", artifactId, "--base", revision, "--stdin"],
      { code: 6, ok: true },
      '[{"id":"priorities","value":["Mine"]}]',
    );
    expect((stale.result as { conflicts: unknown[] }).conflicts).toHaveLength(1);
  });

  it("push, add, secret set|list|rm, list and status", async () => {
    await run(["push", artifactId, "prices", "--value", '{"btc":64000}'], { code: 0, ok: true });
    // The suite's instance is offline (MOSTRA_OFFLINE), so a package the store lacks is refused at
    // once, never fetched (tests never reach the real registry).
    await run(["add", "@mostra-test/not-in-the-store", "--artifact", artifactDir], {
      code: 1,
      ok: false,
      error: "MOSTRA_DEP_OFFLINE",
    });
    const secret = "s3cret-value-never-printed";
    const stored = await run(
      ["secret", "set", "MAIL_TOKEN", "--artifact", artifactDir],
      { code: 0, ok: true },
      `${secret}\n`,
    );
    expect(stored.ran.stdout + stored.ran.stderr).not.toContain(secret);
    const listed = await run(["secret", "list", "--artifact", artifactDir], { code: 0, ok: true });
    expect(JSON.stringify(listed.result)).not.toContain(secret);
    expect(listed.result).toMatchObject({ secrets: [{ name: "MAIL_TOKEN", scope: "artifact" }] });
    await run(["secret", "rm", "MAIL_TOKEN", "--artifact", artifactDir], { code: 0, ok: true });
    await run(["secret", "set", "EMPTY"], { code: 2, ok: false, error: "MOSTRA_CLI_USAGE" }, "");
    const all = await run(["list"], { code: 0, ok: true });
    expect(
      (all.result as { artifacts: { id: string }[] }).artifacts.map((artifact) => artifact.id),
    ).toContain(artifactId);
    await run(["status"], { code: 0, ok: true });
    await run(["status", artifactId], { code: 0, ok: true });
  });

  it("open mints, rotates and revokes links", async () => {
    const fresh = await run(
      ["open", artifactId, "--new", "--scope", "view", "--ttl", "1h", "--no-browser"],
      { code: 0, ok: true },
    );
    const minted = CapabilityLink.parse(fresh.result);
    expect(minted.url).not.toBe(link);
    const rotated = await run(["open", artifactId, "--rotate", minted.tokenId, "--no-browser"], {
      code: 0,
      ok: true,
    });
    const replacement = CapabilityLink.parse(rotated.result);
    await run(["open", artifactId, "--revoke", replacement.tokenId], { code: 0, ok: true });
  });

  it("gc lists, then collects, exactly the same versions; doctor and docs", async () => {
    const dry = gcRunMethod.result.parse(
      (await run(["gc", "--dry-run"], { code: 0, ok: true })).result,
    );
    const real = gcRunMethod.result.parse((await run(["gc"], { code: 0, ok: true })).result);
    expect(real.versions).toEqual(dry.versions);
    const doctor = await run(["doctor"], { code: 0, ok: true });
    const names = (doctor.result as { checks: { name: string; status: string }[] }).checks.map(
      (check) => check.name,
    );
    for (const name of [
      "platform",
      "runtime",
      "home",
      "daemon",
      "ledger",
      "versions",
      "always-on",
      "telemetry",
    ])
      expect(names).toContain(name);
    const index = await run(["docs"], { code: 0, ok: true });
    expect((index.result as { markdown: string }).markdown).toContain("MOSTRA_DEP_MISSING");
    const page = await run(["docs", "MOSTRA_DEP_MISSING"], { code: 0, ok: true });
    expect((page.result as { url: string }).url).toMatch(/\/errors\/MOSTRA_DEP_MISSING$/);
    await run(["docs", "MOSTRA_NOPE_NOPE"], { code: 2, ok: false, error: "MOSTRA_CLI_USAGE" });
  });

  it("telemetry status, on and off answer without an instance", async () => {
    const status = await run(["telemetry", "status"], { code: 0, ok: true });
    expect(status.result).toMatchObject({ enabled: false, reason: "no-collector" });
    expect(envelope(status.ran).instance).toBeUndefined();
    await run(["telemetry", "on"], { code: 0, ok: true });
    await run(["telemetry", "off"], { code: 0, ok: true });
  });

  it("daemon status, stop, start, restart, install and uninstall (the service file only, --no-start)", async () => {
    const status = await run(["daemon", "status"], { code: 0, ok: true });
    expect(status.result).toMatchObject({ running: true });
    await run(["daemon", "stop"], { code: 0, ok: true });
    const stopped = await run(["daemon", "status"], { code: 0, ok: true });
    expect(stopped.result).toMatchObject({ running: false });
    const started = await run(["daemon", "start"], { code: 0, ok: true });
    expect(started.result).toMatchObject({ running: true, started: true });
    const before = (started.result as { pid: number }).pid;
    const restarted = await run(["daemon", "restart"], { code: 0, ok: true });
    expect((restarted.result as { pid: number }).pid).not.toBe(before);
    const installed = await run(["daemon", "install", "--no-start"], { code: 0, ok: true });
    expect(installed.result).toMatchObject({ installed: true });
    const removed = await run(["daemon", "uninstall", "--no-start"], { code: 0, ok: true });
    expect(removed.result).toMatchObject({ installed: false });
  });

  it("host speaks the protocol on stdout and nothing else", async () => {
    const other = testHome();
    try {
      const request = `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "mostra/initialize",
        params: {
          client: { name: "test-host", version: "1.0.0" },
          revisions: ["2026-10-10"],
          capabilities: {},
          ports: [],
        },
      })}\n`;
      const ran = await cli(["host"], { env: other.env, input: request });
      const lines = ran.stdout.split("\n").filter((line) => line.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
      expect(JSON.parse(lines[0] as string)).toMatchObject({
        id: 1,
        result: { instance: { mode: "host" } },
      });
      covered.add("host");
    } finally {
      await other.cleanup();
    }
  });

  it("a usage error, an unknown command and a timeout end with their codes", async () => {
    await run(["verify"], { code: 2, ok: false, error: "MOSTRA_CLI_USAGE" });
    const unknown = await cli(["frobnicate", "--json"], { env: home.env });
    expect(unknown.code).toBe(2);
    expect(envelope(unknown).error?.code).toBe("MOSTRA_CLI_UNKNOWN_COMMAND");
    // A request the instance can't finish in 1 ms: exit 4, MOSTRA_HOST_TIMEOUT.
    const slow = await cli(["verify", artifactDir, "--timeout", "1ms", "--json"], {
      env: home.env,
    });
    expect(slow.code).toBe(4);
    expect(envelope(slow).error?.code).toBe("MOSTRA_HOST_TIMEOUT");
  });

  it("covers every command", () => {
    expect([...covered].sort()).toEqual(COMMANDS.map(commandName).sort());
  });
});
