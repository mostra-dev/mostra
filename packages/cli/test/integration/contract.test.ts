/**
 * A contract test per command (AX-01, AX-09), through the built `mostra` against a real daemon:
 * with `--json` and stdin a closed pipe, every command prints exactly one envelope on stdout (its
 * schema checked), ends with its documented exit code, never waits for an answer, and keeps logs
 * off stdout. J1 runs through it end to end: new, verify, publish, open, a viewer's submission,
 * wait and results (WP-10's handoff).
 */
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  asOtherUser,
  BIN,
  cli,
  envelope,
  eventually,
  probePath,
  type Ran,
  type TestHome,
  testHome,
  Viewer,
  WINDOWS,
  windowsHelper,
} from "../support.ts";

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
  home = testHome({
    MOSTRA_OFFLINE: "1",
    // `share` runs the conformance kit's stand-ins for tailscale and cloudflared (D158).
    MOSTRA_TEST_TUNNELS: fileURLToPath(new URL("../../../conformance/tunnels/", import.meta.url)),
  });
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

  it("share opens a public and a tailnet share, lists them and stops them (D158)", async () => {
    const publicly = await run(["share", artifactId, "--public", "--ttl", "30m"], {
      code: 0,
      ok: true,
    });
    const shared = publicly.result as {
      shareId: string;
      url: string;
      via: string;
      mode: string;
      expiresAt: string;
    };
    expect(shared).toMatchObject({ via: "cloudflare", mode: "worker" });
    expect(Date.parse(shared.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    const tailnet = await run(["share", artifactId, "--tailnet"], { code: 0, ok: true });
    expect(tailnet.result).toMatchObject({ via: "tailnet", mode: "cookie" });
    // A person reads which of the device's ports the tailnet must let viewers reach.
    const ports = tailnet.result as { url: string; artifactOrigin: string; shareId: string };
    const told = await cli(["share", "stop", ports.shareId], { env: home.env });
    expect(told.code).toBe(0);
    const again = await cli(["share", artifactId, "--tailnet"], { env: home.env });
    expect(again.code).toBe(0);
    const [shellPort, framePort] = [ports.url, ports.artifactOrigin].map(
      (origin) => new URL(origin).port,
    );
    expect(again.stdout).toContain(`ports ${shellPort} and ${framePort} allowed`);
    // Exactly one of --tailnet and --public; --via only with --public; a public link lives 7 days at most.
    await run(["share", artifactId], { code: 2, ok: false, error: "MOSTRA_CLI_USAGE" });
    await run(["share", artifactId, "--tailnet", "--via", "funnel"], {
      code: 2,
      ok: false,
      error: "MOSTRA_CLI_USAGE",
    });
    await run(["share", artifactId, "--public", "--ttl", "8d"], {
      code: 3,
      ok: false,
      error: "MOSTRA_SHARE_TTL_INVALID",
    });
    const listed = await run(["share", "list", artifactId], { code: 0, ok: true });
    expect((listed.result as { shares: unknown[] }).shares).toHaveLength(2);
    const one = await run(["share", "stop", shared.shareId], { code: 0, ok: true });
    expect((one.result as { stopped: unknown[] }).stopped).toHaveLength(1);
    const rest = await run(["share", "stop", artifactId], { code: 0, ok: true });
    expect((rest.result as { stopped: unknown[] }).stopped).toHaveLength(1);
    const all = await run(["share", "list", "--all"], { code: 0, ok: true });
    expect(
      (all.result as { shares: { state: string }[] }).shares.every(
        (one) => one.state === "stopped",
      ),
    ).toBe(true);
  }, 120_000);

  it("open --browser hands the browser a 0600 page holding a one-time launch URL, never a secret on its command line (Opus review findings 4, 7)", async () => {
    // A stand-in browser: Node.js running a script that records the arguments it was started with
    // (a program on every platform; Windows runs no shell script).
    const record = join(home.root, "browser-argv.txt");
    const opener = join(home.root, "fake-browser.mjs");
    writeFileSync(
      opener,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(record)}, process.argv.slice(2).join("\\n") + "\\n");\n`,
    );
    // A `$BROWSER` list (`:` separated, `;` on Windows) whose first entry doesn't exist, and whose
    // second takes the page by %s.
    const separator = WINDOWS ? ";" : ":";
    const browser = `"${process.execPath}" "${opener}" --new %s`;
    // Windows: `%TEMP%` names a folder every local user may read, as an administrator's `C:\Temp`
    // does; the page must not go there (Opus review of WP-W2, finding 1). A file put straight in
    // it is the control: the other user reads that one.
    const shared = join(home.root, "shared-temp");
    const sharedEnv: Record<string, string> = {};
    if (WINDOWS) {
      mkdirSync(shared, { recursive: true });
      execFileSync("icacls", [shared, "/grant", "*S-1-5-32-545:(OI)(CI)RX"], { stdio: "ignore" });
      writeFileSync(join(shared, "control.txt"), "readable");
      sharedEnv["TEMP"] = shared;
      sharedEnv["TMP"] = shared;
    }
    const opened = await cli(["open", artifactId, "--browser", "--json"], {
      env: {
        ...home.env,
        ...sharedEnv,
        BROWSER: `${join(home.root, "missing-browser")}${separator}${browser}`,
      },
    });
    const value = envelope(opened);
    expect(value.result).toMatchObject({ opened: true });
    const linkSecret = new URL((value.result as { url: string }).url).hash.slice(1);
    await eventually(() => existsSync(record));
    const argv = readFileSync(record, "utf8").trim().split("\n");
    expect(argv[0]).toBe("--new");
    const page = argv[1] as string;
    // Nothing on the command line but a path: no ticket, no secret.
    expect(argv.join(" ")).not.toContain("#l=");
    expect(argv.join(" ")).not.toContain("#t=");
    expect(argv.join(" ")).not.toContain(linkSecret);
    // One descriptor for the mode and the text, so both describe the same file.
    const handle = openSync(page, "r");
    const mode = fstatSync(handle).mode & 0o777;
    const text = readFileSync(handle, "utf8");
    closeSync(handle);
    if (WINDOWS) {
      // Windows keeps no modes: the page is under the user's own profile, never `%TEMP%`, and
      // another local user can neither list nor read it (the profile's access list), though they
      // read what `%TEMP%` holds.
      expect(page.startsWith(shared)).toBe(false);
      expect(
        asOtherUser(`file:${page}`, `dir:${dirname(page)}`, `file:${join(shared, "control.txt")}`),
      ).toEqual([
        expect.objectContaining({ read: false, readWrite: false }),
        expect.objectContaining({ read: false, readWrite: false }),
        expect.objectContaining({ read: true }),
      ]);
      rmSync(dirname(page), { recursive: true, force: true });
    } else {
      expect(mode).toBe(0o600);
      expect(statSync(dirname(page)).mode & 0o777).toBe(0o700);
    }
    expect(text).not.toContain(linkSecret);
    const launch = /location\.replace\("([^"]+)"\)/.exec(text)?.[1] as string;
    expect(launch).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/a\/art_[0-9A-Z]{26}#l=[0-9A-HJKMNP-TV-Z]{26}$/,
    );
    // The ticket opens the artifact once, as the link would; a second use is refused.
    const viewer = await new Viewer().open(launch);
    expect(viewer.viewId).toMatch(/^vw_/);
    await expect(new Viewer().open(launch)).rejects.toThrow(/exchange: 4\d\d/);
    // No browser could start: `opened` says so.
    const none = await cli(["open", artifactId, "--browser", "--json"], {
      env: { ...home.env, BROWSER: join(home.root, "missing-browser") },
    });
    expect(envelope(none).result).toMatchObject({ opened: false });
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
    // The Agent Skill ships in the build as the guide (WP-14): every reference, asset and example.
    const topics = (index.result as { topics: { topic: string }[] }).topics.map((t) => t.topic);
    const skill = fileURLToPath(new URL("../../../../skills/mostra/", import.meta.url));
    for (const name of readdirSync(join(skill, "references")))
      expect(topics).toContain(`guide/${name.replace(/\.md$/, "")}`);
    for (const name of readdirSync(join(skill, "assets", "examples")))
      expect(topics).toContain(`guide/examples/${name}`);
    const guide = await run(["docs", "guide"], { code: 0, ok: true });
    const guideText = (guide.result as { markdown: string }).markdown;
    expect(guideText).not.toMatch(/^---/m);
    expect(guideText).toContain("mostra docs guide/<name>");
    const example = await run(["docs", "guide/examples/inbox"], { code: 0, ok: true });
    expect((example.result as { markdown: string }).markdown).toContain(
      readFileSync(join(skill, "assets", "examples", "inbox", "actions.ts"), "utf8"),
    );
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

  it("starts the daemon with relative path variables, as the command's directory names them (GPT and Opus reviews of WP-W2)", async () => {
    // The daemon runs in the file system's root, not the command's directory: every relative
    // path variable must reach it resolved where the command ran.
    const own = testHome();
    try {
      const project = join(own.root, "project");
      mkdirSync(project, { recursive: true });
      // The runtime's built directory, reached through a link inside the project, so the relative
      // entry names nothing from any other directory (a `../..` path would still reach it from
      // the file system's root, where `..` stays at the root).
      const dist = fileURLToPath(new URL("../../../runtime/dist", import.meta.url));
      symlinkSync(dist, join(project, "runtime"), "junction");
      const env: Record<string, string> = {
        ...own.env,
        MOSTRA_RUNTIME_BIN: join("runtime", "bin.js"),
      };
      // Windows has no runtime directory (its control endpoint is a named pipe, D150); its
      // helper, which the daemon starts its pipe with, is named relative instead, through a
      // link, as the runtime is.
      if (WINDOWS) {
        symlinkSync(dirname(windowsHelper()), join(project, "helper"), "junction");
        env["MOSTRA_WIN_HELPER"] = join("helper", "mostra-win.exe");
      } else env["MOSTRA_RUNTIME_DIR"] = "run";
      const ran = await cli(["daemon", "start", "--json"], { env, cwd: project });
      const value = envelope(ran);
      expect(value.ok, `${ran.stdout}\n${ran.stderr}`).toBe(true);
      expect(value.result).toMatchObject({ running: true, started: true });
      if (!WINDOWS) {
        expect(
          value.instance?.socket.startsWith(join(realpathSync(project), "run")),
          value.instance?.socket,
        ).toBe(true);
      }
      await cli(["daemon", "stop", "--json"], { env, cwd: project });
    } finally {
      // The link goes first, so nothing that cleans up walks into the runtime's directory.
      for (const link of ["runtime", "helper"]) {
        try {
          unlinkSync(join(own.root, "project", link));
        } catch {
          // Never made.
        }
      }
      await own.cleanup();
    }
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

  it("dev streams NDJSON envelopes until Ctrl-C, then its result (VR-08, D140 items 12 and 15)", async () => {
    // Ctrl-C at a terminal; on Windows Ctrl+Break, which the probe sends to a group of its own
    // (Ctrl-C can't reach a process that leads its own console group).
    const pidFile = join(home.root, "dev.pid");
    const child = WINDOWS
      ? spawn(
          probePath(),
          ["group", pidFile, "--", process.execPath, BIN, "dev", artifactDir, "--json"],
          {
            env: home.env,
            stdio: ["pipe", "pipe", "pipe"],
          },
        )
      : spawn(process.execPath, [BIN, "dev", artifactDir, "--json"], {
          env: home.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
    child.stdin.end();
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const closed = new Promise<number>((done) => child.on("close", (code) => done(code ?? -1)));
    await eventually(() => stdout.includes('"kind":"started"'), 90_000);
    const first = JSON.parse(stdout.split("\n")[0] as string) as {
      ok: boolean;
      event: { kind: string; url: string };
      instance?: { home: string };
    };
    expect(first.ok).toBe(true);
    expect(first.event.kind).toBe("started");
    expect(first.event.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/art_/);
    expect(first.instance?.home).toBeDefined();
    if (WINDOWS) {
      execFileSync(probePath(), ["ctrl-break", readFileSync(pidFile, "utf8").trim()], {
        windowsHide: true,
      });
    } else child.kill("SIGINT");
    const code = await closed;
    expect(code).toBe(0);
    const lines = stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    for (const line of lines) expect(line.ok).toBe(true);
    // `instance` on the first line only; the stream ends at the line with `result`.
    expect(lines.slice(1).some((line) => "instance" in line)).toBe(false);
    const last = lines.at(-1) as { result?: { stopped: string } };
    expect(last.result?.stopped).toBe("signal");
    expect(lines.slice(0, -1).every((line) => "event" in line)).toBe(true);
    covered.add("dev");
  }, 120_000);

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
    // With no daemon, the start is bounded by --timeout too, and says so (Opus review finding 7).
    const down = testHome();
    try {
      const starting = await cli(["list", "--timeout", "1ms", "--json"], { env: down.env });
      expect(starting.code).toBe(4);
      const error = envelope(starting).error as { code: string; message: string };
      expect(error.code).toBe("MOSTRA_HOST_TIMEOUT");
      expect(error.message).toContain("1 ms (--timeout)");
    } finally {
      await cli(["daemon", "stop", "--json"], { env: down.env });
      await down.cleanup();
    }
  });

  it("covers every command", () => {
    expect([...covered].sort()).toEqual(COMMANDS.map(commandName).sort());
  });
});
