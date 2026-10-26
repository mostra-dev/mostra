/**
 * The CLI's contracts that need no instance (AX-01, AX-09, D140 items 13 and 16): every catalog
 * code has one exit code; every `mostra …` command a diagnostic's hint or fix names parses under
 * the definitions; the command line, help and `--help --json` follow the definitions; `--json`
 * makes even a usage error one JSON envelope on stdout.
 */
import { PassThrough } from "node:stream";
import { diagnosticCatalog } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../../src/command.ts";
import { commandName } from "../../src/command.ts";
import { firstFailing } from "../../src/commands/admin.ts";
import { verifyCommand } from "../../src/commands/authoring.ts";
import { COMMANDS } from "../../src/commands/index.ts";
import { waitCommand } from "../../src/commands/interaction.ts";
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
    // INTERFACES §9: 6 is a conflict, `once` already submitted or a compare-and-set mismatch.
    for (const conflict of [
      "MOSTRA_SUBMIT_ALREADY",
      "MOSTRA_SUBMIT_REVISION_MOVED",
      "MOSTRA_FIELD_CONFLICT",
      "MOSTRA_FIELD_MUTATION_ID_REUSED",
      "MOSTRA_HOST_REQUEST_ID_REUSED",
    ]) {
      expect(exitCodeFor(conflict), conflict).toBe(EXIT.conflict);
    }
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
    // The = forms stand before the command too (GPT review finding 6).
    for (const argv of [
      ["--home=/h", "list"],
      ["--cwd=/c", "--timeout=10s", "state", "get", "./a"],
      ["--json", "--timeout=5s", "daemon", "status"],
    ]) {
      const equals = parseCommandLine(COMMANDS, argv);
      expect(equals.kind, argv.join(" ")).toBe("run");
    }
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
  extraEnv: Record<string, string> = {},
  arch?: string,
): Promise<{ code: number; out: string[]; err: string }> {
  const out: string[] = [];
  let err = "";
  const code = await run({
    argv,
    env: {
      MOSTRA_CONFIG_DIR: "/nonexistent-config-for-tests",
      MOSTRA_HOME: "/nonexistent-home-for-tests",
      ...extraEnv,
    },
    cwd: "/",
    stdout: (text) => out.push(text),
    stderr: (text) => {
      err += text;
    },
    stdin: new PassThrough(),
    tty: { stdin: false, stdout: false, stderr: false },
    ...(platform !== undefined ? { platform } : {}),
    ...(arch !== undefined ? { arch } : {}),
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
    for (const [platform, arch] of [
      ["freebsd", "x64"],
      ["aix", "ppc64"],
      ["win32", "ia32"],
      ["linux", "ia32"],
    ] as const) {
      const { code, out } = await inProcess(["--json", "list"], platform, {}, arch);
      expect(code, `${platform}-${arch}`).toBe(EXIT.environment);
      expect(JSON.parse(out[0] as string).error.code).toBe("MOSTRA_PLATFORM_UNSUPPORTED");
    }
  });

  it("admits Windows on x64 and arm64 like macOS and Linux, with no switch (D146)", async () => {
    for (const arch of ["x64", "arm64"]) {
      const admitted = await inProcess(["--json", "--version"], "win32", {}, arch);
      expect(admitted.code, arch).toBe(EXIT.ok);
    }
  });

  it("documents exit 4 wherever --timeout applies, and refuses --timeout where it doesn't", async () => {
    for (const command of COMMANDS) {
      const unbounded = command.path[0] === "host" || command.path[0] === "dev";
      const help = await inProcess([...command.path, "--help", "--json"]);
      const definition = JSON.parse(help.out[0] as string).result as {
        exitCodes: { code: number }[];
      };
      const codes = definition.exitCodes.map((exit) => exit.code);
      if (unbounded || command.path[0] === "wait")
        expect(codes, command.path.join(" ")).not.toContain(EXIT.timeout);
      else expect(codes, command.path.join(" ")).toContain(EXIT.timeout);
    }
    for (const argv of [
      ["dev", "./a", "--timeout", "5s", "--json"],
      ["host", "--timeout", "5s", "--json"],
    ]) {
      const { code, out } = await inProcess(argv);
      expect(code, argv.join(" ")).toBe(EXIT.usage);
      expect(JSON.parse(out[0] as string).error.code).toBe("MOSTRA_CLI_USAGE");
    }
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

describe("a status a newer instance adds (Opus review of MT-01, 2; #45)", () => {
  /** A command's context whose instance answers every call with `answer`. */
  const context = (
    args: Record<string, string>,
    flags: Record<string, string>,
    answer: unknown,
  ): CommandContext =>
    ({
      args,
      flags,
      cwd: process.cwd(),
      json: true,
      timeoutMs: undefined,
      env: {},
      home: "/nowhere",
      tty: { stdin: false, stdout: false, stderr: false },
      call: async () => answer,
      connection: async () => undefined,
      log() {},
      emit() {},
      warn() {},
      record() {},
    }) as unknown as CommandContext;

  it("fails verify unless the verdict passed", async () => {
    const verdict = (status: string) => ({ status, diagnostics: [], screenshots: [] });
    const exit = async (status: string) =>
      (await verifyCommand.run(context({ path: "." }, {}, verdict(status)))).exit;
    expect(await exit("pass")).toBeUndefined();
    expect(await exit("fail")).toBe(EXIT.failure);
    expect(await exit("blocked")).toBe(EXIT.failure);
  });

  it("ends a wait on a status it doesn't know as a failure, never waiting again", async () => {
    let calls = 0;
    const waiting = context({ artifact: "." }, { until: "submitted" }, undefined);
    const outcome = await waitCommand.run({
      ...waiting,
      call: async () => {
        calls++;
        // A wait that would wait again fails here instead of spinning forever.
        if (calls > 3) throw new Error("the wait asked again");
        return { status: "expired", cursor: "c" };
      },
    } as CommandContext);
    expect(calls).toBe(1);
    expect(outcome.exit).toBe(EXIT.failure);
  });

  it("fails doctor on a check status it doesn't know", () => {
    const check = (status: string) => ({ name: status, status });
    expect(firstFailing([check("ok"), check("warning")])).toBeUndefined();
    expect(firstFailing([check("ok"), check("error")])?.name).toBe("error");
    expect(firstFailing([check("ok"), check("critical")])?.name).toBe("critical");
  });
});
