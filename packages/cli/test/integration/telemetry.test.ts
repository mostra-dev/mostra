/**
 * EN-08 through the built `mostra` against a fake collector on loopback (D119, D140): what is
 * sent, when, and never. A host-spawned instance and a home a host configured send nothing;
 * DO_NOT_TRACK=1 sends nothing; an ask-first time zone with no terminal sends nothing and says so
 * once; payloads match the published schema and carry no path, token, ID, name or time zone; the
 * command never waits for the network, and its stdout is closed when it exits.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TelemetryEvent } from "../../src/telemetry/events.ts";
import { NOTICE_ASK_FIRST, NOTICE_DEFAULT } from "../../src/telemetry/words.ts";
import {
  BIN,
  type Collector,
  cli,
  collector,
  envelope,
  eventually,
  type TestHome,
  testHome,
} from "../support.ts";

let fake: Collector;
const homes: TestHome[] = [];

beforeAll(async () => {
  fake = await collector();
});
afterAll(async () => {
  await fake.close();
});
afterEach(async () => {
  for (const home of homes.splice(0)) await home.cleanup();
  fake.requests.splice(0);
});

/** A home whose CLI sends to the fake collector, in a zone where telemetry is on by default. */
function telemetryHome(extra: Record<string, string> = {}): TestHome {
  const home = testHome({
    MOSTRA_TELEMETRY_ENDPOINT: fake.url,
    TZ: "America/New_York",
    // The machine's own zone doesn't count: CI runners are UTC, which asks first.
    MOSTRA_TEST_LOCALTIME: "",
    // A flush may start after every command, instead of once a minute.
    MOSTRA_TEST_FLUSH_INTERVAL_MS: "0",
    ...extra,
  });
  homes.push(home);
  return home;
}

/** Every event the collector received. */
function received(): unknown[] {
  return fake.requests.flatMap(
    (request) => (JSON.parse(request.body) as { events: unknown[] }).events,
  );
}

/** Waits long enough that a flusher, had one started, would have posted. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 1500));

describe("EN-08: telemetry from the standalone CLI", () => {
  it("elsewhere: the notice once on stderr, then schema-valid events, sent in the background", async () => {
    const home = telemetryHome();
    fake.hold();
    const first = await cli(["list", "--json"], { env: home.env });
    // The command ended, its stdout closed, while the collector still held its answer.
    expect(first.code).toBe(0);
    envelope(first);
    expect(first.stderr).toContain(NOTICE_DEFAULT);
    await eventually(() => fake.requests.length > 0);
    fake.release();
    const second = await cli(["list", "--json"], { env: home.env });
    expect(second.stderr).not.toContain("Mostra sends anonymous usage data");
    const events = received() as {
      event: string;
      consent: string;
      command?: string;
      json?: boolean;
    }[];
    expect(events.map((event) => event.event)).toEqual(["cli.first_run", "cli.command"]);
    for (const event of events)
      expect(TelemetryEvent.safeParse(event).success, JSON.stringify(event)).toBe(true);
    expect(events[1]).toMatchObject({ command: "list", json: true, exit: 0, consent: "default" });
    const request = fake.requests[0];
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["user-agent"]).toMatch(/^mostra-cli\//);
    expect(request?.headers["cookie"]).toBeUndefined();
  });

  it("sends verify.result and publish.done, and nothing that names a path, a token, an ID or the zone", async () => {
    const home = telemetryHome();
    const dir = join(home.root, "my-secret-project");
    const created = envelope(
      await cli(["new", dir, "--title", "Quarterly numbers", "--json"], { env: home.env }),
    );
    const artifactId = (created.result as { artifactId: string }).artifactId;
    const published = envelope(await cli(["publish", dir, "--json"], { env: home.env }));
    const url = (published.result as { url: string }).url;
    const secret = new URL(url).hash.slice("#t=".length);
    await cli(["verify", dir, "--json"], { env: home.env });
    await cli(["open", artifactId, "--no-browser", "--json"], { env: home.env });
    await eventually(
      () => received().some((event) => (event as { event: string }).event === "verify.result"),
      30_000,
    );
    const events = received() as { event: string }[];
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(["cli.first_run", "publish.done", "verify.result", "cli.command"]),
    );
    for (const event of events)
      expect(TelemetryEvent.safeParse(event).success, JSON.stringify(event)).toBe(true);
    const text = fake.requests.map((request) => request.body).join("\n");
    const forbidden = [
      home.root,
      dir,
      "my-secret-project",
      "Quarterly",
      artifactId,
      secret,
      url,
      "America",
      "New_York",
      hostname(),
    ];
    const user = userInfo().username;
    if (user.length >= 4) forbidden.push(user);
    for (const value of forbidden) expect(text, value).not.toContain(value);
    expect(text).not.toMatch(/"(ver|art|tok|vw|sub)_[0-9A-Z]{20,}"/);
  });

  it("sends nothing with DO_NOT_TRACK=1, nor creates an install ID or a queue", async () => {
    const home = telemetryHome({ DO_NOT_TRACK: "1" });
    const ran = await cli(["list", "--json"], { env: home.env });
    expect(ran.code).toBe(0);
    expect(ran.stderr).not.toContain("usage data");
    await settle();
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(join(home.config, "telemetry-queue.ndjson"))).toBe(false);
    const status = envelope(await cli(["telemetry", "status", "--json"], { env: home.env }));
    expect(status.result).toMatchObject({ enabled: false, reason: "do-not-track" });
    expect((status.result as { installId?: string }).installId).toBeUndefined();
  });

  it("sends nothing from a host-spawned instance, nor later from the home that host configured", async () => {
    const home = telemetryHome();
    // A host spawns `mostra host` and keeps its stdin open; the CLI in the host's environment
    // attaches to that instance through the home's socket.
    const host = spawn(process.execPath, [BIN, "host"], {
      env: home.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    host.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "mostra/initialize", params: { client: { name: "test-host", version: "1" }, revisions: ["2026-10-10"], capabilities: {}, ports: [] } })}\n`,
    );
    await new Promise<void>((done) => host.stdout.once("data", () => done()));
    try {
      const attached = await cli(["list", "--json"], { env: home.env });
      expect(envelope(attached).instance?.mode).toBe("host");
      await settle();
      expect(fake.requests).toHaveLength(0);
    } finally {
      host.stdin.end();
      await new Promise((done) => host.on("exit", done));
    }
    // The host's home stays marked, so the CLI sends nothing from it after the host is gone.
    const settings = JSON.parse(readFileSync(join(home.home, "config.json"), "utf8")) as {
      hostConfigured?: { client: string };
    };
    expect(settings.hostConfigured?.client).toBe("mostra-runtime host");
    const later = await cli(["list", "--json"], { env: home.env });
    expect(envelope(later).instance?.mode).toBe("daemon");
    await settle();
    expect(fake.requests).toHaveLength(0);
    const status = envelope(await cli(["telemetry", "status", "--json"], { env: home.env }));
    expect(status.result).toMatchObject({ enabled: false, reason: "embedded" });
  });

  it("in an ask-first zone with no terminal: the notice once, naming the command, and nothing sent", async () => {
    const home = telemetryHome({ TZ: "Europe/Zagreb" });
    const first = await cli(["list", "--json"], { env: home.env });
    expect(first.stderr).toContain(NOTICE_ASK_FIRST);
    expect(first.stderr).toContain("mostra telemetry on");
    const second = await cli(["list", "--json"], { env: home.env });
    expect(second.stderr).not.toContain("usage data");
    await settle();
    expect(fake.requests).toHaveLength(0);
    // An explicit yes, by the variable, sends with consent explicit; the zone is never sent.
    await cli(["list", "--json"], { env: { ...home.env, MOSTRA_TELEMETRY: "1" } });
    await eventually(() => fake.requests.length > 0);
    const events = received() as { consent: string }[];
    expect(events.every((event) => event.consent === "explicit")).toBe(true);
    expect(fake.requests.map((request) => request.body).join("")).not.toMatch(/Europe|Zagreb/);
  });

  it("telemetry off deletes the install ID and the queue, and wins over MOSTRA_TELEMETRY=1", async () => {
    const home = telemetryHome();
    await cli(["list", "--json"], { env: home.env });
    await eventually(() => fake.requests.length > 0);
    const before = envelope(await cli(["telemetry", "status", "--json"], { env: home.env }));
    expect((before.result as { installId?: string }).installId).toMatch(/^[0-9a-f-]{36}$/);
    const off = await cli(["telemetry", "off", "--json"], { env: home.env });
    expect(envelope(off).result).toMatchObject({ enabled: false, reason: "setting", queued: 0 });
    expect((envelope(off).result as { installId?: string }).installId).toBeUndefined();
    fake.requests.splice(0);
    await cli(["list", "--json"], { env: { ...home.env, MOSTRA_TELEMETRY: "1" } });
    await settle();
    expect(fake.requests).toHaveLength(0);
  });

  it("sends nothing without an endpoint, and says nothing about it", async () => {
    const home = testHome({ TZ: "America/New_York", MOSTRA_TEST_LOCALTIME: "" });
    homes.push(home);
    const ran = await cli(["list", "--json"], { env: home.env });
    expect(ran.stderr).not.toContain("usage data");
    expect(existsSync(join(home.config, "telemetry.json"))).toBe(false);
    const status = envelope(await cli(["telemetry", "status", "--json"], { env: home.env }));
    expect(status.result).toMatchObject({ enabled: false, reason: "no-collector" });
  });

  it("MOSTRA_TELEMETRY_DEBUG=1 prints every event on stderr exactly as it would be sent, and sends nothing", async () => {
    const home = telemetryHome({ MOSTRA_TELEMETRY_DEBUG: "1" });
    const ran = await cli(["list", "--json"], { env: home.env });
    const lines = ran.stderr
      .split("\n")
      .filter((line) => line.startsWith("mostra telemetry (debug, not sent): "));
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(
        TelemetryEvent.safeParse(
          JSON.parse(line.slice("mostra telemetry (debug, not sent): ".length)),
        ).success,
      ).toBe(true);
    }
    await settle();
    expect(fake.requests).toHaveLength(0);
  });

  // Root writes anywhere: these need a directory the user can't write.
  const asRoot = process.getuid?.() === 0;

  it("refuses telemetry on and off it can't record, and changes nothing (Opus review finding 6)", async () => {
    // A config directory that can't exist: a part of its path is a file. Unlike a directory
    // another user owns, this can't be written by anyone, root included, on every system.
    const home = telemetryHome();
    mkdirSync(home.root, { recursive: true });
    const blocker = join(home.root, "not-a-directory");
    writeFileSync(blocker, "");
    const env = { ...home.env, MOSTRA_CONFIG_DIR: join(blocker, "mostra") };
    for (const choice of ["off", "on"]) {
      const ran = await cli(["telemetry", choice, "--json"], { env });
      const value = envelope(ran) as { ok: boolean; error?: { code: string } };
      expect(value.ok, choice).toBe(false);
      expect(value.error?.code).toBe("MOSTRA_CLI_CONFIG_UNWRITABLE");
      expect(ran.code).toBe(3);
      expect(ran.stdout).not.toContain("were deleted");
    }
    // Nothing was recorded, and status says nothing is sent from a store it can't read.
    const status = envelope(await cli(["telemetry", "status", "--json"], { env })) as {
      result: { enabled: boolean; reason: string };
    };
    expect(status.result).toMatchObject({ enabled: false, reason: "unreadable" });
  });

  it("telemetry status agrees with the runner on a home whose config.json can't be read (Opus review finding 6)", async () => {
    const home = telemetryHome({ MOSTRA_TELEMETRY_DEBUG: "1" });
    mkdirSync(home.home, { recursive: true, mode: 0o700 });
    writeFileSync(join(home.home, "config.json"), "{not json");
    const status = envelope(await cli(["telemetry", "status", "--json"], { env: home.env })) as {
      result: { enabled: boolean; reason: string; unreadableFile?: string };
    };
    expect(status.result.enabled).toBe(false);
    expect(status.result.reason).toBe("unreadable");
    expect(status.result.unreadableFile).toBe(join(home.home, "config.json"));
    const ran = await cli(["docs", "--json"], { env: home.env });
    expect(ran.stderr).not.toContain("debug, not sent");
  });

  it.skipIf(asRoot)(
    "never stops a command when its config directory can't be written (GPT review finding 2)",
    async () => {
      const parent = join(telemetryHome().root, "locked");
      mkdirSync(parent, { mode: 0o500 });
      chmodSync(parent, 0o500);
      const home = telemetryHome({ MOSTRA_CONFIG_DIR: join(parent, "mostra") });
      for (const argv of [
        ["docs", "--json"],
        ["list", "--json"],
        ["telemetry", "status", "--json"],
      ]) {
        const ran = await cli(argv, { env: home.env });
        expect(ran.code, argv.join(" ")).toBe(0);
        expect(envelope(ran).ok, argv.join(" ")).toBe(true);
        // Nothing it can't record: no notice, and so nothing sent.
        expect(ran.stderr).not.toContain("usage data");
      }
      await settle();
      expect(fake.requests).toHaveLength(0);
    },
  );
});
