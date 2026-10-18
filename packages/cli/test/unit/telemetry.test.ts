/**
 * Telemetry's rules (EN-08, D140 items 3 to 11), in-process: the decision order, the endpoint, the
 * time zones, the harness, the schema, the store, the question and the queue.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide, endpointOf } from "../../src/telemetry/decision.ts";
import { durationBucket, minute, TelemetryEvent } from "../../src/telemetry/events.ts";
import { detectHarness } from "../../src/telemetry/harness.ts";
import { telemetrySession } from "../../src/telemetry/index.ts";
import { TelemetryStore } from "../../src/telemetry/store.ts";
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

describe("the store (D140 item 5)", () => {
  it("keeps its directory 0700 and its files 0600, and reads a damaged file as off", () => {
    const dir = join(configDir(), "nested");
    const store = new TelemetryStore(dir);
    store.update((current) => ({ ...current, choice: "on" }));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(store.settingsFile).mode & 0o777).toBe(0o600);
    store.append(
      [JSON.stringify({ ...common, event: "cli.first_run", at: minute(new Date()) })],
      Date.now(),
    );
    expect(statSync(store.queueFile).mode & 0o777).toBe(0o600);
    writeFileSync(store.settingsFile, "{ not json");
    expect(store.read().ok).toBe(false);
    expect(store.update((current) => current)).toBeUndefined();
    expect(readFileSync(store.settingsFile, "utf8")).toBe("{ not json");
    writeFileSync(store.settingsFile, JSON.stringify({ installId: "my-hostname" }));
    expect(store.read().ok).toBe(false);
  });

  it("gives two processes on a first run one install ID", async () => {
    const dir = configDir();
    const entry = fileURLToPath(new URL("../../src/telemetry/store.ts", import.meta.url));
    const script = `import { TelemetryStore } from ${JSON.stringify(entry)}; const id = new TelemetryStore(process.argv[1]).installId(); process.stdout.write(id ? id.id : "none");`;
    const ids = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<string>((resolve) => {
            const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir], {
              stdio: ["ignore", "pipe", "inherit"],
            });
            let out = "";
            child.stdout.on("data", (chunk: Buffer) => {
              out += chunk.toString();
            });
            child.on("exit", () => resolve(out));
          }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

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
