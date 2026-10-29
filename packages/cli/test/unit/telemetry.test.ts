/**
 * Telemetry's rules (EN-08, D140 items 3 to 11), in-process: the decision order, the endpoint, the
 * time zones, the harness, the schema, the store, the question and the queue.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { decide, endpointOf } from "../../src/telemetry/decision.ts";
import { durationBucket, minute, TelemetryEvent } from "../../src/telemetry/events.ts";
import { flush } from "../../src/telemetry/flush.ts";
import { detectHarness } from "../../src/telemetry/harness.ts";
import { telemetrySession } from "../../src/telemetry/index.ts";
import { replace, TelemetryStore, writable } from "../../src/telemetry/store.ts";
import { asksFirst } from "../../src/telemetry/timezone.ts";
import { ANSWER, NOTICE_ASK_FIRST, NOTICE_DEFAULT, QUESTION } from "../../src/telemetry/words.ts";
import { buildZoneSets } from "../../src/telemetry/zone-sets.ts";
import {
  ASK_FIRST_ZONES,
  KNOWN_ZONES,
  TZDATA_VERSION,
} from "../../src/telemetry/zones.generated.ts";

const ENDPOINT = "https://collector.example/v1/events";
const configDir = (): string => mkdtempSync(join(tmpdir(), "mostra-telemetry-"));
const ok = { ok: true as const, settings: {} };

describe("the decision order (D140 item 3)", () => {
  const base = { env: {}, buildEndpoint: ENDPOINT, embedded: false, settings: ok, askFirst: false };

  it("stops at the first match, so an explicit off anywhere beats any on", () => {
    expect(decide({ ...base, buildEndpoint: "" })).toMatchObject({
      enabled: false,
      reason: "no-collector",
    });
    expect(decide({ ...base, embedded: true, env: { MOSTRA_TELEMETRY: "1" } })).toMatchObject({
      enabled: false,
      reason: "embedded",
    });
    for (const value of ["1", "true", "yes", "anything"]) {
      expect(
        decide({ ...base, env: { DO_NOT_TRACK: value, MOSTRA_TELEMETRY: "1" } }),
      ).toMatchObject({ reason: "do-not-track", enabled: false });
    }
    for (const value of ["", "0", "false"]) {
      expect(decide({ ...base, env: { DO_NOT_TRACK: value } }).reason).not.toBe("do-not-track");
    }
    for (const value of ["0", "false", "off", "no", "OFF"]) {
      expect(
        decide({
          ...base,
          env: { MOSTRA_TELEMETRY: value },
          settings: { ok: true, settings: { choice: "on" } },
        }),
      ).toMatchObject({ enabled: false, reason: "variable" });
    }
    // A stored "off" beats MOSTRA_TELEMETRY=1: withdrawn consent sticks.
    expect(
      decide({
        ...base,
        env: { MOSTRA_TELEMETRY: "1" },
        settings: { ok: true, settings: { choice: "off" } },
      }),
    ).toMatchObject({ enabled: false, reason: "setting" });
    for (const value of ["1", "true", "on", "yes"]) {
      expect(decide({ ...base, askFirst: true, env: { MOSTRA_TELEMETRY: value } })).toMatchObject({
        enabled: true,
        reason: "variable",
        consent: "explicit",
      });
    }
    expect(decide({ ...base, env: { MOSTRA_TELEMETRY: "maybe" } })).toMatchObject({
      enabled: false,
      reason: "variable-invalid",
    });
    expect(
      decide({ ...base, askFirst: true, settings: { ok: true, settings: { choice: "on" } } }),
    ).toMatchObject({
      enabled: true,
      reason: "setting",
      consent: "explicit",
    });
    expect(decide({ ...base })).toMatchObject({
      enabled: true,
      reason: "default",
      consent: "default",
    });
    expect(decide({ ...base, askFirst: true })).toMatchObject({
      enabled: false,
      reason: "default",
      askFirst: true,
    });
    expect(decide({ ...base, settings: { ok: false, file: "/x" } })).toMatchObject({
      enabled: false,
      reason: "unreadable",
    });
  });

  it("accepts an https endpoint, or http to a loopback address, and nothing else", () => {
    expect(endpointOf({}, "")).toBeUndefined();
    expect(endpointOf({ MOSTRA_TELEMETRY_ENDPOINT: "https://c.example/e" }, "")).toBe(
      "https://c.example/e",
    );
    expect(endpointOf({ MOSTRA_TELEMETRY_ENDPOINT: "http://127.0.0.1:9/e" }, "")).toBe(
      "http://127.0.0.1:9/e",
    );
    expect(endpointOf({ MOSTRA_TELEMETRY_ENDPOINT: "http://[::1]:9/e" }, "")).toBe(
      "http://[::1]:9/e",
    );
    for (const bad of [
      "http://c.example/e",
      "ftp://127.0.0.1/",
      "https://u:p@c.example/",
      "not a url",
    ]) {
      expect(endpointOf({ MOSTRA_TELEMETRY_ENDPOINT: bad }, "")).toBeUndefined();
    }
  });
});

describe("the ask-first time zones (D140 item 10)", () => {
  const zone = (tz: string | undefined, intl?: string, localtime?: string): boolean =>
    asksFirst({
      env: tz === undefined ? {} : { TZ: tz },
      intl: () => intl,
      localtime: () => localtime,
    });

  it("match names as given, never the zone tzdata links them to", () => {
    // Europe/Zagreb links to Europe/Belgrade, Indian/Reunion to Asia/Dubai, America/Marigot to
    // America/Puerto_Rico; ICU may report the target.
    expect(zone("Europe/Zagreb", "Europe/Belgrade")).toBe(true);
    expect(zone("Indian/Reunion", "Asia/Dubai")).toBe(true);
    expect(zone("America/Marigot", "America/Puerto_Rico")).toBe(true);
    expect(zone(undefined, "Asia/Dubai", "Indian/Reunion")).toBe(true);
    expect(zone("Poland", "Europe/Warsaw")).toBe(true);
    expect(zone("CET", "CET")).toBe(true);
    expect(zone(":Europe/Paris", "Europe/Paris")).toBe(true);
    expect(zone("Europe/Belfast")).toBe(true);
    expect(zone("Atlantic/Jan_Mayen")).toBe(true);
    expect(zone("UTC", "UTC")).toBe(true);
    expect(zone("Etc/GMT+3", "Etc/GMT+3")).toBe(true);
  });

  it("treat unknown zones as ask-first, and never crash on what Intl reports", () => {
    // Node: TZ=Bogus/Zone gives timeZone undefined; an empty TZ, Etc/Unknown; a POSIX rule, UTC.
    expect(zone("Bogus/Zone", undefined)).toBe(true);
    expect(zone("", "Etc/Unknown")).toBe(true);
    expect(zone("EST5EDT,M3.2.0,M11.1.0", "UTC")).toBe(true);
    expect(zone(undefined, undefined, undefined)).toBe(true);
    expect(zone(undefined, "Etc/Unknown")).toBe(true);
  });

  it("leave other zones on by default", () => {
    expect(zone("America/New_York", "America/New_York")).toBe(false);
    expect(zone("Asia/Tokyo", "Asia/Tokyo", "Asia/Tokyo")).toBe(false);
    expect(zone(undefined, "Asia/Dubai", "Asia/Dubai")).toBe(false);
    expect(zone("America/Puerto_Rico", "America/Puerto_Rico")).toBe(false);
  });

  it("are the committed set generated from the vendored tzdata", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "tzdata");
    const read = (name: string): string => readFileSync(join(dir, name), "utf8");
    const sets = buildZoneSets({
      version: read("version"),
      zoneTab: read("zone.tab"),
      backward: read("backward"),
      etcetera: read("etcetera"),
      factory: read("factory"),
    });
    expect(TZDATA_VERSION).toBe(sets.version);
    expect([...ASK_FIRST_ZONES]).toEqual(sets.askFirst);
    expect([...KNOWN_ZONES]).toEqual(sets.known);
    for (const name of [
      "Europe/Zagreb",
      "Indian/Reunion",
      "America/Marigot",
      "Poland",
      "Eire",
      "GB",
      "GB-Eire",
      "Iceland",
      "Europe/Vatican",
      "Europe/Andorra",
      "Europe/Monaco",
      "Europe/San_Marino",
      "Arctic/Longyearbyen",
      "Atlantic/Faroe",
      "Europe/Busingen",
      "Europe/Mariehamn",
    ]) {
      expect(ASK_FIRST_ZONES).toContain(name);
    }
    for (const name of [
      "Asia/Dubai",
      "America/Puerto_Rico",
      "Europe/Belgrade",
      "America/New_York",
      "Europe/Istanbul",
    ]) {
      expect(ASK_FIRST_ZONES).not.toContain(name);
    }
  });
});

describe("the harness (D140 item 9)", () => {
  it("reads AI_AGENT first, then each agent's own marker, never sending a value", () => {
    expect(detectHarness({ AI_AGENT: "claude-code_2.1.0_agent" })).toBe("claude-code");
    expect(detectHarness({ CLAUDECODE: "1" })).toBe("claude-code");
    expect(detectHarness({ CODEX_THREAD_ID: "t_1" })).toBe("codex");
    expect(detectHarness({ GEMINI_CLI: "1" })).toBe("gemini-cli");
    expect(detectHarness({ OPENCODE: "1" })).toBe("opencode");
    expect(detectHarness({ CURSOR_AGENT: "1" })).toBe("cursor");
    expect(detectHarness({ CURSOR_TRACE_ID: "x" })).toBe("none");
    expect(detectHarness({ AI_AGENT: "my-internal-bot" })).toBe("other");
    expect(detectHarness({ AGENT: "1" })).toBe("other");
    expect(detectHarness({ AI_AGENT: "codex_1", CLAUDECODE: "1" })).toBe("codex");
    expect(detectHarness({})).toBe("none");
  });
});

const common = {
  schema: 1,
  at: "2026-10-18T09:12:00Z",
  installId: "3f2b9c1e-8a4d-4f6b-9c2e-1d7a5b3e9f00",
  version: "0.1.0",
  os: "darwin",
  arch: "arm64",
  node: 24,
  harness: "codex",
  ci: false,
  consent: "default",
} as const;

describe("the event schema (D140 item 8)", () => {
  it("takes exactly the published fields, and nothing that could carry a path or a token", () => {
    expect(TelemetryEvent.safeParse({ ...common, event: "cli.first_run" }).success).toBe(true);
    const command = {
      ...common,
      event: "cli.command",
      command: "daemon install",
      exit: 0,
      duration: "<1s",
      json: true,
    };
    expect(TelemetryEvent.safeParse(command).success).toBe(true);
    expect(TelemetryEvent.safeParse({ ...command, error: "MOSTRA_DEP_MISSING" }).success).toBe(
      true,
    );
    for (const bad of [
      { ...command, path: "/Users/me/art" },
      { ...command, command: "/Users/me/art" },
      { ...command, command: "verify ./art" },
      { ...command, error: "boom: /Users/me" },
      { ...common, event: "cli.first_run", at: "2026-10-18T09:12:34Z" },
      { ...common, event: "cli.first_run", installId: "my-hostname" },
      { ...common, event: "cli.first_run", tz: "Europe/Paris" },
      {
        ...common,
        event: "verify.result",
        status: "pass",
        codes: ["see http://x/t=secret"],
        codesTruncated: false,
      },
      { ...common, event: "mcp.session", client: "acme-internal" },
    ]) {
      expect(TelemetryEvent.safeParse(bad).success).toBe(false);
    }
  });

  it("names every system Mostra runs on, and nothing else (WP-W2: Windows' events were dropped)", () => {
    for (const os of ["darwin", "linux", "win32"]) {
      expect(TelemetryEvent.safeParse({ ...common, os, event: "cli.first_run" }).success).toBe(
        true,
      );
    }
    expect(
      TelemetryEvent.safeParse({ ...common, os: "freebsd", event: "cli.first_run" }).success,
    ).toBe(false);
  });

  it("buckets durations and rounds times down to the minute", () => {
    expect(
      [0, 999, 1000, 4999, 5000, 29_999, 30_000, 119_999, 120_000, 599_999, 600_000].map(
        durationBucket,
      ),
    ).toEqual([
      "<1s",
      "<1s",
      "1-5s",
      "1-5s",
      "5-30s",
      "5-30s",
      "30s-2m",
      "30s-2m",
      "2-10m",
      "2-10m",
      ">10m",
    ]);
    expect(minute(new Date("2026-10-18T09:12:59.999Z"))).toBe("2026-10-18T09:12:00Z");
  });
});

/**
 * Whether files keep POSIX modes. Windows has none: the store lives in the user's own profile
 * (`%APPDATA%\mostra`, D151), whose access list admits only them, the system and administrators.
 */
const POSIX_MODES = process.platform !== "win32";

describe("the store (D140 item 5)", () => {
  it("keeps its directory 0700 and its files 0600, and reads a damaged file as off", () => {
    const dir = join(configDir(), "nested");
    const store = new TelemetryStore(dir);
    store.update((current) => ({ ...current, choice: "on" }));
    if (POSIX_MODES) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(store.settingsFile).mode & 0o777).toBe(0o600);
    }
    store.append(
      [JSON.stringify({ ...common, event: "cli.first_run", at: minute(new Date()) })],
      Date.now(),
    );
    if (POSIX_MODES) expect(statSync(store.queueFile).mode & 0o777).toBe(0o600);
    // A damaged file, in a store of its own.
    const damaged = new TelemetryStore(configDir());
    writeFileSync(damaged.settingsFile, "{ not json");
    expect(damaged.read().ok).toBe(false);
    expect(damaged.update((current) => current)).toBeUndefined();
    expect(readFileSync(damaged.settingsFile, "utf8")).toBe("{ not json");
    const invalid = new TelemetryStore(configDir());
    writeFileSync(invalid.idFile, "my-hostname\n");
    expect(invalid.read().ok).toBe(false);
    expect(invalid.installId()).toBeUndefined();
    const planted = new TelemetryStore(configDir());
    writeFileSync(planted.settingsFile, JSON.stringify({ installId: randomUUID() }));
    expect(planted.read().ok).toBe(false);
    // The install ID is its own file, 0600, and never in telemetry.json.
    const fresh = new TelemetryStore(configDir());
    const made = fresh.installId();
    expect(made?.created).toBe(true);
    if (POSIX_MODES) expect(statSync(fresh.idFile).mode & 0o777).toBe(0o600);
    expect(fresh.read()).toMatchObject({ ok: true, settings: { installId: made?.id } });
    fresh.update((current) => ({ ...current, choice: "on" }));
    expect(readFileSync(fresh.settingsFile, "utf8")).not.toContain(made?.id ?? "-");
  });

  it("takes over an hour-old lock even when its PID names a live process, and respects a recent one (Opus review finding 5)", () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = join(dir, "telemetry.lock");
    // A live PID (this test's own process), as a reused PID in a container would be.
    writeFileSync(lock, `${process.pid} reused`, { mode: 0o600 });
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(lock, hourAgo, hourAgo);
    const store = new TelemetryStore(dir);
    const started = Date.now();
    expect(store.update((current) => ({ ...current, choice: "on" }))).toBeDefined();
    expect(Date.now() - started).toBeLessThan(1000);
    // A lock 20 s old whose owner runs is someone's: it is waited for, never taken.
    writeFileSync(lock, `${process.pid} busy`, { mode: 0o600 });
    const recent = new Date(Date.now() - 20_000);
    utimesSync(lock, recent, recent);
    expect(store.update((current) => ({ ...current, choice: "off" }))).toBeUndefined();
    expect(readFileSync(lock, "utf8")).toBe(`${process.pid} busy`);
  });

  it.each([
    ["no lock", false],
    ["a lock a crashed process left", true],
  ])("gives processes on a first run one install ID (%s)", async (_, staleLock) => {
    const dir = configDir();
    if (staleLock) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const lock = join(dir, "telemetry.lock");
      // The lock of a process that no longer runs (PID 2^22 + 1 is above every default pid_max).
      writeFileSync(lock, "4194305 crashed", { mode: 0o600 });
      const old = new Date(Date.now() - 60_000);
      utimesSync(lock, old, old);
    }
    const entry = fileURLToPath(new URL("../../src/telemetry/store.ts", import.meta.url));
    const script = `import { TelemetryStore } from ${JSON.stringify(pathToFileURL(entry).href)}; import { existsSync } from "node:fs"; while (!existsSync(process.argv[2])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); const store = new TelemetryStore(process.argv[1]); const read = store.read(); const id = store.installId(); const shown = store.update((current) => ({ ...current, noticeShownAt: current.noticeShownAt ?? new Date().toISOString() })); process.stdout.write(shown && id ? id.id : "none " + JSON.stringify({ read, id: id ?? null, after: store.read(), shown: shown !== undefined }));`;
    // Every process waits for one start signal, so they make their IDs at the same moment.
    const go = join(dir, "..", `go-${randomUUID()}`);
    const running = Array.from(
      { length: 12 },
      () =>
        new Promise<string>((resolve) => {
          const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir, go], {
            stdio: ["ignore", "pipe", "inherit"],
          });
          let out = "";
          child.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
          });
          child.on("close", () => resolve(out));
        }),
    );
    await new Promise((done) => setTimeout(done, 600));
    writeFileSync(go, "");
    const ids = await Promise.all(running);
    // Every process says the same ID (the list, so a failure shows who said what, and a process
    // without one says what it read and which step gave up).
    expect(ids).toEqual(ids.map(() => ids[0]));
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    // Every process got the lock (a crashed owner's lock was taken over), and the lock is gone
    // with nothing left beside it.
    expect(readdirSync(dir).filter((name) => name.includes("lock"))).toEqual([]);
  });

  it("never brings back a lock whose owner released it while a slow breaker held it aside (#98)", async () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = join(dir, "telemetry.lock");
    // A crashed process's lock (PID 2^22 + 1 is above every default pid_max).
    writeFileSync(lock, "4194305 crashed", { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const entry = fileURLToPath(new URL("../../src/telemetry/store.ts", import.meta.url));
    // Each process waits for the start signal, then for its own delay, then takes the lock once,
    // holding it as long as it is told and writing down when it held it.
    const held = join(dir, "..", `held-${randomUUID()}`);
    const script = `import { TelemetryStore } from ${JSON.stringify(pathToFileURL(entry).href)}; import { appendFileSync, existsSync } from "node:fs"; const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); while (!existsSync(process.argv[2])) sleep(1); sleep(Number(process.argv[3])); const store = new TelemetryStore(process.argv[1]); const done = store.update((current) => { const from = Date.now(); sleep(Number(process.argv[4])); appendFileSync(process.argv[5], from + " " + Date.now() + "\\n"); return { ...current, noticeShownAt: current.noticeShownAt ?? new Date().toISOString() }; }); process.stdout.write(done ? "held the lock" : "gave up");`;
    const go = join(dir, "..", `go-${randomUUID()}`);
    // The slow breaker judges the crashed lock, then takes its time at each step; meanwhile the
    // other breaks the same lock, takes a lock of its own, holds it, and releases it while the
    // slow one may have it moved aside: the old breaker linked it back, a lock nobody owned, and
    // a breaker that acted without the break lock took a live owner's lock away.
    const run = (delay: number, hold: number, env: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", script, dir, go, String(delay), String(hold), held],
          { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...env } },
        );
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.on("close", () => resolve(out));
      });
    const slow = run(0, 0, { MOSTRA_TEST_LOCK_BREAK_MS: "300" });
    const holder = run(60, 400, {});
    await new Promise((done) => setTimeout(done, 600));
    writeFileSync(go, "");
    expect(await Promise.all([slow, holder])).toEqual(["held the lock", "held the lock"]);
    // One at a time: the two held the lock in turn, never together.
    const spans = readFileSync(held, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(" ").map(Number) as [number, number])
      .sort((a, b) => a[0] - b[0]);
    expect(spans).toHaveLength(2);
    expect((spans[1] as [number, number])[0]).toBeGreaterThanOrEqual(
      (spans[0] as [number, number])[1],
    );
    // Nobody's lock is left behind, nor anything beside it.
    expect(readdirSync(dir).filter((name) => name.includes("lock"))).toEqual([]);
  });

  it("clears a break lock a crashed breaker left, then the crashed owner's lock (#98)", () => {
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = join(dir, "telemetry.lock");
    const old = new Date(Date.now() - 60_000);
    for (const file of [lock, `${lock}.break.1`]) {
      writeFileSync(file, "4194305 crashed", { mode: 0o600 });
      utimesSync(file, old, old);
    }
    const store = new TelemetryStore(dir);
    expect(store.update((current) => ({ ...current, choice: "on" }))).toBeDefined();
    expect(readdirSync(dir).filter((name) => name.includes("lock"))).toEqual([]);
    // A live breaker's break lock is waited for: the crashed owner's lock stays until it is done.
    writeFileSync(lock, "4194305 crashed", { mode: 0o600 });
    utimesSync(lock, old, old);
    writeFileSync(`${lock}.break.1`, `${process.pid} breaking`, { mode: 0o600 });
    expect(store.update((current) => ({ ...current, choice: "off" }))).toBeUndefined();
    expect(readFileSync(lock, "utf8")).toBe("4194305 crashed");
  });

  it.each([
    ["the next number", 2],
    ["a higher number", 3],
  ])(
    "never acts beside a live breaker that took over a crashed one at %s (Opus review of WP-13)",
    async (_, number) => {
      const dir = configDir();
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const lock = join(dir, "telemetry.lock");
      const old = new Date(Date.now() - 60_000);
      // A crashed owner's lock, and a crashed breaker's break lock.
      for (const file of [lock, `${lock}.break.1`]) {
        writeFileSync(file, "4194305 crashed", { mode: 0o600 });
        utimesSync(file, old, old);
      }
      const entry = fileURLToPath(new URL("../../src/telemetry/store.ts", import.meta.url));
      const script = `import { TelemetryStore } from ${JSON.stringify(pathToFileURL(entry).href)}; const store = new TelemetryStore(process.argv[1]); process.stdout.write(store.update((current) => ({ ...current, choice: "on" })) ? "held the lock" : "gave up");`;
      // A slow breaker judges the crashed break lock, then pauses; meanwhile another breaker, alive,
      // takes over from the crashed one. The slow one must leave that breaker's lock alone.
      const slow = new Promise<string>((resolve) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir], {
          stdio: ["ignore", "pipe", "inherit"],
          env: { ...process.env, MOSTRA_TEST_LOCK_BREAK_MS: "800" },
        });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.on("close", () => resolve(out));
      });
      await new Promise((done) => setTimeout(done, 300));
      const live = `${lock}.break.${number}`;
      writeFileSync(live, `${process.pid} breaking`, { flag: "wx", mode: 0o600 });
      // While the live breaker holds on, the slow one takes nothing: it gives up at its deadline.
      expect(await slow).toBe("gave up");
      expect(readFileSync(live, "utf8")).toBe(`${process.pid} breaking`);
      expect(readFileSync(lock, "utf8")).toBe("4194305 crashed");
      // The live breaker done, the next one clears everything.
      rmSync(live);
      const store = new TelemetryStore(dir);
      expect(store.update((current) => ({ ...current, choice: "off" }))).toBeDefined();
      expect(readdirSync(dir).filter((name) => name.includes("lock"))).toEqual([]);
    },
  );

  it("deletes the install ID and the queue when telemetry turns off, and bounds the queue", () => {
    const store = new TelemetryStore(configDir());
    const id = store.installId();
    expect(id?.created).toBe(true);
    const now = Date.now();
    const fresh = JSON.stringify({ ...common, event: "cli.first_run", at: minute(new Date(now)) });
    const old = JSON.stringify({
      ...common,
      event: "cli.first_run",
      at: minute(new Date(now - 8 * 86_400_000)),
    });
    store.append([old, ...Array.from({ length: 1005 }, () => fresh)], now);
    expect(store.queued(now)).toHaveLength(1000);
    expect(store.turnOff()).toBe(true);
    const read = store.read();
    expect(read.ok && read.settings).toEqual({ choice: "off" });
    expect(store.queued(now)).toHaveLength(0);
  });
});

/** A session with a fake terminal: what it printed, what it asked, what it queued. */
function session(options: {
  env?: Record<string, string>;
  tty?: boolean;
  json?: boolean;
  readsStdin?: boolean;
  answer?: string | undefined | "interrupt";
  dir?: string;
  hostHome?: boolean;
}) {
  const dir = options.dir ?? configDir();
  const printed: string[] = [];
  const asked: string[] = [];
  const telemetry = telemetrySession({
    env: {
      MOSTRA_TELEMETRY_ENDPOINT: "http://127.0.0.1:9/never",
      TZ: "America/New_York",
      ...options.env,
    },
    configDir: dir,
    command: "verify",
    json: options.json ?? false,
    tty: { stdin: options.tty ?? false, stderr: options.tty ?? false },
    readsStdin: options.readsStdin ?? false,
    quiet: false,
    hostHome: options.hostHome ?? false,
    stderr: (text) => printed.push(text),
    // The zone is TZ alone here: the machine's /etc/localtime and Intl don't count.
    zones: { localtime: () => undefined, intl: () => undefined },
    flush: false,
    ask: async (question) => {
      asked.push(question);
      return options.answer;
    },
  });
  return { dir, printed, asked, telemetry, store: new TelemetryStore(dir) };
}

const queued = (store: TelemetryStore): unknown[] =>
  store.queued(Date.now()).map((line) => JSON.parse(line));
const END = { exit: 0, durationMs: 1200, hostInstance: false };

describe("a lock that can never be taken (GPT review of WP-W2)", () => {
  it("gives up within its 2 s instead of trying forever", () => {
    const dir = configDir();
    // A directory where the lock file goes, old enough to look abandoned: it can be neither
    // created nor read, so breaking it "succeeds" without changing anything.
    const lock = join(dir, "telemetry.lock");
    mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    // In a process of its own: a loop that never ends would hold this one past any time limit.
    const entry = fileURLToPath(new URL("../../src/telemetry/store.ts", import.meta.url));
    const script = `import { TelemetryStore } from ${JSON.stringify(pathToFileURL(entry).href)}; process.stdout.write(String(new TelemetryStore(process.argv[1]).locked(() => "ran")));`;
    const started = Date.now();
    const ran = spawnSync(process.execPath, ["--input-type=module", "-e", script, dir], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(ran.signal, "the lock was still being tried after 15 s").toBeNull();
    expect(ran.stdout).toBe("undefined");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("a config directory this user can't write (Opus review of WP-W2, finding 2)", () => {
  // Under Windows' rules access denied on the lock's create may be a lock being deleted, so it
  // counts as held; when no lock file exists at all it can't be, and the store gives up at once
  // instead of spinning for its 2 s. A read-only directory gives access denied on POSIX too, so
  // the Windows rules run here; Windows' own runners pass any access list (their administrator's
  // backup privileges), so the case can't be made there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "gives up at once under Windows' lock rules",
    () => {
      const dir = configDir();
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o500);
      try {
        const started = performance.now();
        const cpuBefore = process.cpuUsage();
        expect(new TelemetryStore(dir, "win32").locked(() => "ran")).toBeUndefined();
        expect(performance.now() - started).toBeLessThan(500);
        const cpu = process.cpuUsage(cpuBefore);
        expect((cpu.user + cpu.system) / 1000).toBeLessThan(500);
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );
});

describe("a config directory that can never exist (WP-W2)", () => {
  it("reads as unreadable, not as nothing stored yet, on every system", () => {
    const root = configDir();
    mkdirSync(root, { recursive: true });
    const blocker = join(root, "not-a-directory");
    writeFileSync(blocker, "");
    for (const dir of [join(blocker, "mostra"), join(blocker, "deeper", "mostra")]) {
      const read = new TelemetryStore(dir).read();
      expect(read.ok, dir).toBe(false);
    }
    // A directory that doesn't exist yet is just empty.
    expect(new TelemetryStore(join(root, "fresh", "mostra")).read()).toEqual({
      ok: true,
      settings: {},
    });
  });
});

describe("the notice, the question and the queue (D140 items 6, 11)", () => {
  it("elsewhere: the notice once before the first event, then events with consent default", async () => {
    const run = session({ env: { MOSTRA_TELEMETRY_DEBUG: "" } });
    await run.telemetry.begin();
    expect(run.printed).toEqual([NOTICE_DEFAULT]);
    run.telemetry.record({
      event: "verify.result",
      fields: { status: "fail", codes: ["MOSTRA_TYPE_ERROR", "MOSTRA_TYPE_ERROR", "NOT_A_CODE"] },
    });
    run.telemetry.end(END);
    const events = queued(run.store) as { event: string; consent: string; codes?: string[] }[];
    expect(events.map((event) => event.event)).toEqual([
      "cli.first_run",
      "verify.result",
      "cli.command",
    ]);
    expect(events.every((event) => event.consent === "default")).toBe(true);
    expect(events[1]?.codes).toEqual(["MOSTRA_TYPE_ERROR"]);
    for (const event of events) expect(TelemetryEvent.safeParse(event).success).toBe(true);
    // A second command: no notice again, no second first_run.
    const again = session({ dir: run.dir });
    await again.telemetry.begin();
    again.telemetry.end(END);
    expect(again.printed).toEqual([]);
    expect(
      (queued(run.store) as { event: string }[]).filter((event) => event.event === "cli.first_run"),
    ).toHaveLength(1);
  });

  it("in a Europe time zone with no terminal: the notice once, nothing queued, no install ID", async () => {
    const run = session({ env: { TZ: "Europe/Berlin" } });
    await run.telemetry.begin();
    run.telemetry.end(END);
    expect(run.printed).toEqual([NOTICE_ASK_FIRST]);
    expect(run.asked).toEqual([]);
    expect(queued(run.store)).toEqual([]);
    const read = run.store.read();
    expect(read.ok && read.settings.installId).toBeFalsy();
    const again = session({ dir: run.dir, env: { TZ: "Europe/Berlin" } });
    await again.telemetry.begin();
    expect(again.printed).toEqual([]);
  });

  it("after the ask-first notice, a run where it is on by default shows the default notice before it sends (Opus review finding 3)", async () => {
    const berlin = session({ env: { TZ: "Europe/Berlin" } });
    await berlin.telemetry.begin();
    berlin.telemetry.end(END);
    expect(berlin.printed).toEqual([NOTICE_ASK_FIRST]);
    // The same person's shell, now where telemetry is on by default (travel, another context).
    const newYork = session({ dir: berlin.dir, env: { TZ: "America/New_York" } });
    await newYork.telemetry.begin();
    expect(newYork.printed).toEqual([NOTICE_DEFAULT]);
    newYork.telemetry.end(END);
    const events = queued(newYork.store) as { consent: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.consent === "default")).toBe(true);
    // Back in an ask-first zone, at a terminal: never asked, so asked now.
    const paris = session({ dir: berlin.dir, env: { TZ: "Europe/Paris" }, tty: true, answer: "" });
    await paris.telemetry.begin();
    expect(paris.asked).toEqual([QUESTION]);
  });

  it("in a Europe time zone at a terminal: an explicit y turns it on; Enter, n, no answer and Ctrl-C don't", async () => {
    const yes = session({ env: { TZ: "Europe/Paris" }, tty: true, answer: "y" });
    expect(await yes.telemetry.begin()).toBe(true);
    expect(yes.asked).toEqual([QUESTION]);
    expect(yes.printed).toEqual([ANSWER.yes]);
    yes.telemetry.end(END);
    const events = queued(yes.store) as { consent: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.consent === "explicit")).toBe(true);
    for (const [answer, words] of [
      ["", ANSWER.no],
      ["n", ANSWER.no],
      [undefined, ANSWER.timeout],
      ["interrupt", ANSWER.no],
    ] as const) {
      const no = session({ env: { TZ: "Europe/Paris" }, tty: true, answer });
      expect(await no.telemetry.begin()).toBe(answer !== "interrupt");
      expect(no.printed).toEqual([words]);
      no.telemetry.end(END);
      expect(queued(no.store)).toEqual([]);
      const read = no.store.read();
      expect(read.ok && read.settings.choice).toBe("off");
    }
  });

  it("never asks with --json, in CI, under an agent, or before a command that reads stdin", async () => {
    for (const options of [
      { json: true },
      { env: { CI: "true" } },
      { env: { CLAUDECODE: "1" } },
      { readsStdin: true },
    ]) {
      const run = session({
        ...options,
        env: { TZ: "Europe/Paris", ...(options.env ?? {}) },
        tty: true,
        answer: "y",
      });
      await run.telemetry.begin();
      expect(run.asked).toEqual([]);
      expect(run.printed).toEqual([NOTICE_ASK_FIRST]);
    }
  });

  it("sends nothing, and says nothing, for DO_NOT_TRACK, a host's home, a host-spawned instance or no collector", async () => {
    for (const run of [
      session({ env: { DO_NOT_TRACK: "1" } }),
      session({ hostHome: true }),
      session({ env: { MOSTRA_TELEMETRY_ENDPOINT: "" } }),
    ]) {
      await run.telemetry.begin();
      run.telemetry.end(END);
      expect(queued(run.store)).toEqual([]);
    }
    const quiet = session({ hostHome: true });
    await quiet.telemetry.begin();
    expect(quiet.printed).toEqual([]);
    const spawned = session({});
    await spawned.telemetry.begin();
    spawned.telemetry.end({ ...END, hostInstance: true });
    expect(queued(spawned.store)).toEqual([]);
    const none = session({ env: { MOSTRA_TELEMETRY_ENDPOINT: "" } });
    await none.telemetry.begin();
    none.telemetry.end(END);
    expect(none.printed).toEqual([]);
    expect(none.store.read()).toEqual({ ok: true, settings: {} });
  });

  it("with MOSTRA_TELEMETRY_DEBUG=1 prints each event as it would be sent, and queues nothing", async () => {
    const run = session({ env: { MOSTRA_TELEMETRY_DEBUG: "1" } });
    await run.telemetry.begin();
    run.telemetry.end(END);
    const lines = run.printed.filter((line) =>
      line.startsWith("mostra telemetry (debug, not sent): "),
    );
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const event = JSON.parse(line.slice("mostra telemetry (debug, not sent): ".length).trim());
      expect(TelemetryEvent.safeParse(event).success).toBe(true);
    }
    expect(queued(run.store)).toEqual([]);
  });

  it("never sends the time zone", async () => {
    const run = session({ env: { TZ: "America/New_York" } });
    await run.telemetry.begin();
    run.telemetry.end(END);
    const text = run.store.queued(Date.now()).join("\n");
    expect(text).not.toMatch(/America|New_York|TZ|zone/);
  });
});

describe("the flusher (D140 item 6)", () => {
  it("sends each event once even when the queue's head expired, and stops when nothing is removed (GPT review finding 5)", async () => {
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        bodies.push(body);
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const store = new TelemetryStore(configDir());
      const now = Date.now();
      const event = (at: number, extra: Record<string, unknown> = {}): string =>
        JSON.stringify({ ...common, event: "cli.first_run", at: minute(new Date(at)), ...extra });
      // Queued when the oldest was still within its 7 days, which ran out before this flush;
      // then one the schema refuses (an extra field), then one to send.
      const week = 7 * 86_400_000;
      store.append(
        [event(now - week - 120_000), event(now, { path: "/Users/someone" }), event(now)],
        now - week,
      );
      expect(store.queued(now - week)).toHaveLength(3);
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const flushed = flush(store, { MOSTRA_TELEMETRY_ENDPOINT: endpoint }, () => now);
      const outcome = await Promise.race([
        flushed.then(() => "done"),
        new Promise((done) => setTimeout(() => done("still sending"), 3000)),
      ]);
      expect(outcome).toBe("done");
      expect(bodies).toHaveLength(1);
      const sent = (JSON.parse(bodies[0] as string) as { events: { path?: string }[] }).events;
      expect(sent).toHaveLength(1);
      expect(sent[0]?.path).toBeUndefined();
      expect(store.queued(now)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
});

describe("replacing a telemetry file (MT-01)", () => {
  const refused = (times: number, code: string) => {
    let calls = 0;
    return {
      rename: () => {
        calls += 1;
        if (calls <= times) throw Object.assign(new Error(code), { code });
      },
      calls: () => calls,
    };
  };

  it("counts a directory it made a probe in as writable, whatever the probe's removal meets (Opus review of MT-01, 8)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mostra-probe-"));
    try {
      const held = (): void => {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      };
      expect(writable(dir, held)).toBe(true);
      expect(writable(dir)).toBe(true);
      expect(writable(join(dir, "missing", "deeper"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tries again while Windows refuses to replace a file another process has open", () => {
    const fake = refused(3, "EPERM");
    replace("from", "to", "win32", fake.rename);
    expect(fake.calls()).toBe(4);
  });

  it("gives up after a second, and never retries elsewhere or other errors", () => {
    const always = refused(Number.POSITIVE_INFINITY, "EBUSY");
    const started = Date.now();
    expect(() => replace("from", "to", "win32", always.rename)).toThrow("EBUSY");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(Date.now() - started).toBeLessThan(3000);
    const posix = refused(1, "EPERM");
    expect(() => replace("from", "to", "linux", posix.rename)).toThrow("EPERM");
    expect(posix.calls()).toBe(1);
    const missing = refused(1, "ENOENT");
    expect(() => replace("from", "to", "win32", missing.rename)).toThrow("ENOENT");
    expect(missing.calls()).toBe(1);
  });
});
