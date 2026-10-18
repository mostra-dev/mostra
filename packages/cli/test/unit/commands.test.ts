/**
 * The CLI's contracts that need no instance (AX-01, AX-09, D140 items 13 and 16): every catalog
 * code has one exit code; every `mostra …` command a diagnostic's hint or fix names parses under
 * the definitions; the command line, help and `--help --json` follow the definitions; `--json`
 * makes even a usage error one JSON envelope on stdout.
 */
import { PassThrough } from "node:stream";
import { diagnosticCatalog } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { commandName } from "../../src/command.ts";
import { COMMANDS } from "../../src/commands/index.ts";
import { EXIT, exitCodeFor } from "../../src/exit.ts";
import { commandDefinition, commandHelp } from "../../src/help.ts";
import { parseCommandLine } from "../../src/parse.ts";
import { run } from "../../src/run.ts";

/** Splits a shell-like command into words, honoring quotes, up to a redirection or a pipe. */
function words(command: string): string[] {
  const found: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    const word = match[1] ?? match[2] ?? match[3] ?? "";
    if (match[3] !== undefined && ["<", ">", "|", "&&", ";"].includes(word)) break;
    found.push(word);
  }
  return found;
}

/** Every `mostra …` command a text names: in backticks, or a fix command. */
function namedCommands(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/`(mostra [^`]+)`/g)) found.push(match[1] as string);
  return found;
}

/** Placeholders in hints (`<pkg>`, `<dir>`) stand for any value. */
const filled = (command: string): string =>
  command
    .replace(/<[^>]+>/g, "x")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/…/g, "");

describe("the exit codes (D140 item 16)", () => {
  it("give every catalog code one exit code from the table", () => {
    const codes = Object.keys(diagnosticCatalog);
    expect(codes.length).toBeGreaterThan(100);
    const allowed = new Set<number>(Object.values(EXIT));
    for (const code of codes) expect(allowed.has(exitCodeFor(code)), code).toBe(true);
    expect(exitCodeFor("MOSTRA_CLI_USAGE")).toBe(EXIT.usage);
    expect(exitCodeFor("MOSTRA_CLI_UNKNOWN_COMMAND")).toBe(EXIT.usage);
    expect(exitCodeFor("MOSTRA_HOST_TIMEOUT")).toBe(EXIT.timeout);
    expect(exitCodeFor("MOSTRA_SUBMIT_ALREADY")).toBe(EXIT.conflict);
    expect(exitCodeFor("MOSTRA_PUBLISH_VERIFY_FAILED")).toBe(EXIT.failure);
    expect(exitCodeFor("MOSTRA_PLATFORM_UNSUPPORTED")).toBe(EXIT.environment);
    expect(exitCodeFor("MOSTRA_HOME_LOCKED")).toBe(EXIT.environment);
  });
});

describe("commands named by diagnostics (D140 item 13)", () => {
  it("every `mostra …` a hint, explanation or fix names parses under the command definitions", () => {
    const named: { code: string; command: string }[] = [];
    for (const [code, spec] of Object.entries(diagnosticCatalog)) {
      const texts = [spec.hint, spec.docs.explanation, spec.docs.fix];
      for (const text of texts)
        for (const command of namedCommands(text)) named.push({ code, command });
    }
    // MOSTRA_DEP_MISSING's fix, the case the WP-10 brief names, is among them.
    expect(
      named.some(
        (entry) => entry.code === "MOSTRA_DEP_MISSING" && entry.command.startsWith("mostra add"),
      ),
    ).toBe(true);
    for (const { code, command } of named) {
      // `mostra <command> --help` names any command, not one.
      if (/^mostra <command>/.test(command)) continue;
      const argv = words(filled(command)).slice(1);
      // Prose naming a command (`mostra results`) must name one that exists; an invocation with
      // arguments or flags must parse as given.
      const known = COMMANDS.find(
        (candidate) =>
          candidate.path.length === argv.length &&
          candidate.path.every((word, index) => argv[index] === word),
      );
      // A group (`mostra daemon`) names its commands, as `mostra daemon --help` lists them.
      const group =
        argv.length === 1 && COMMANDS.some((candidate) => candidate.path[0] === argv[0]);
      if (known || group) continue;
      expect(() => parseCommandLine(COMMANDS, argv), `${code}: ${command}`).not.toThrow();
    }
  });

  it("the exact fix MOSTRA_DEP_MISSING carries at run time parses", () => {
    // The fix publish attaches (packages/runtime/src/deps): `mostra add <pkg> --artifact <dir>`.
    const argv = words("mostra add left-pad@1.3.0 --artifact '/tmp/my artifact'").slice(1);
    const parsed = parseCommandLine(COMMANDS, argv);
    expect(parsed.kind === "run" && commandName(parsed.command)).toBe("add");
  });
});

describe("the command line (AX-01)", () => {
  it("knows every command of D60 that WP-10 builds, and none of the later packages' (D140 item 12)", () => {
    const names = COMMANDS.map(commandName);
    for (const name of [
      "new",
      "verify",
      "publish",
      "open",
      "wait",
      "results",
      "push",
      "state get",
      "state set",
      "state patch",
      "add",
      "secret set",
      "secret list",
      "secret rm",
      "list",
      "status",
      "daemon start",
      "daemon stop",
      "daemon restart",
      "daemon status",
      "daemon install",
      "daemon uninstall",
      "host",
      "docs",
      "doctor",
      "gc",
      "telemetry status",
      "telemetry on",
      "telemetry off",
      "dev",
    ]) {
      expect(names).toContain(name);
    }
    for (const later of ["share", "review", "export", "mcp", "plugin", "term", "run"]) {
      expect(names.some((name) => name.split(" ")[0] === later)).toBe(false);
    }
  });

  it("refuses an unknown command and an unknown flag with a usage code", () => {
    expect(() => parseCommandLine(COMMANDS, ["shipit"])).toThrow(/isn't a mostra command/);
    expect(() => parseCommandLine(COMMANDS, ["verify", "./a", "--bogus"])).toThrow(/bogus/);
    expect(() => parseCommandLine(COMMANDS, ["verify"])).toThrow(/needs <path>/);
    expect(() => parseCommandLine(COMMANDS, ["daemon"])).toThrow(/needs one of/);
    expect(() =>
      parseCommandLine(COMMANDS, ["wait", "./a", "--until", "submitted", "--timeout", "soon"]),
    ).toThrow(/duration/);
    const parsed = parseCommandLine(COMMANDS, [
      "--json",
      "--home",
      "/h",
      "state",
      "get",
      "./a",
      "x",
      "y",
    ]);
    expect(parsed.kind === "run" && parsed.args).toEqual({ artifact: "./a", id: ["x", "y"] });
  });

  it("gives each command help with usage, output, exit codes and an example, and a definition for --help --json", () => {
    for (const command of COMMANDS) {
      const help = commandHelp(command);
      expect(help).toContain(`mostra ${commandName(command)}`);
      expect(help).toContain("Output: ");
      expect(help).toContain("Exit codes:");
      expect(help).toContain("Example:");
      const definition = commandDefinition(command);
      expect(definition["command"]).toBe(commandName(command));
      expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
      // The example itself parses.
      expect(
        () => parseCommandLine(COMMANDS, words(command.example)),
        command.example,
      ).not.toThrow();
    }
  });
});

/** Runs the CLI in-process with --json and returns its stdout lines and exit code. */
async function inProcess(
  argv: string[],
  platform?: string,
): Promise<{ code: number; out: string[]; err: string }> {
  const out: string[] = [];
  let err = "";
  const code = await run({
    argv,
    env: {
      MOSTRA_CONFIG_DIR: "/nonexistent-config-for-tests",
      MOSTRA_HOME: "/nonexistent-home-for-tests",
    },
    cwd: "/",
    stdout: (text) => out.push(text),
    stderr: (text) => {
      err += text;
    },
    stdin: new PassThrough(),
    tty: { stdin: false, stdout: false, stderr: false },
    ...(platform !== undefined ? { platform } : {}),
  });
  return { code, out, err };
}

describe("--json (D140 item 16)", () => {
  it("makes a usage error, wherever --json stands, exactly one JSON envelope on stdout", async () => {
    for (const argv of [
      ["--json", "frobnicate"],
      ["frobnicate", "--json"],
      ["verify", "--json"],
      ["verify", "./a", "--nope", "--json"],
    ]) {
      const { code, out } = await inProcess(argv);
      expect(code).toBe(EXIT.usage);
      expect(out).toHaveLength(1);
      const envelope = JSON.parse(out[0] as string);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toMatch(/^MOSTRA_CLI_(USAGE|UNKNOWN_COMMAND)$/);
      expect(envelope.instance).toBeUndefined();
    }
  });

  it("fails closed on an unsupported platform before touching anything", async () => {
    const { code, out } = await inProcess(["--json", "list"], "win32");
    expect(code).toBe(EXIT.environment);
    expect(JSON.parse(out[0] as string).error.code).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
  });

  it("prints --version and --help --json as envelopes", async () => {
    const version = await inProcess(["--version", "--json"]);
    expect(version.code).toBe(0);
    const help = await inProcess(["publish", "--help", "--json"]);
    expect(help.code).toBe(0);
    const envelope = JSON.parse(help.out[0] as string);
    expect(envelope).toMatchObject({
      ok: true,
      result: { command: "publish", output: { type: "PublishReceipt" } },
    });
  });
});
