/**
 * Commands plugins contribute (D30, WP-16): which of `mostra`'s own words they may not take, which
 * one a command line names, and how a loaded one becomes a command of the CLI.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCommandInfo } from "@mostra/protocol";
import { CORE_COMMANDS, PLUGIN_CONTRACTS } from "@mostra/protocol/plugin";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../../src/command.ts";
import { COMMANDS } from "../../src/commands/index.ts";
import { parseCommandLine } from "../../src/parse.ts";
import { loadPluginCommand, matchCommand } from "../../src/plugin-commands.ts";

/** The commands later packages add, which plugins may not take from today (D60). */
const RESERVED = ["review export", "term dump"];

const info = (command: string, file: string): PluginCommandInfo => ({
  command,
  package: "mostra-fixture-cli",
  version: "1.0.0",
  scope: "home",
  file,
  export: "default",
});

const version = PLUGIN_CONTRACTS["cli-command"].implements.at(-1) as string;

/** A module exporting a stamped command definition. */
function commandModule(
  stamp: { name: string; version: string },
  path: string[],
  body = `const status = await context.call("instance/status", {});
    return { result: { hello: input.args.name, loud: input.flags.loud === true, pid: status.instance.pid }, exit: 0 };`,
): string {
  const dir = mkdtempSync(join(tmpdir(), "mostra-plugin-command-"));
  const file = join(dir, "command.mjs");
  writeFileSync(
    file,
    `export default {
  contract: ${JSON.stringify(stamp)},
  path: ${JSON.stringify(path)},
  summary: "Say hello.",
  args: [{ name: "name", summary: "Who." }],
  flags: [{ name: "loud", kind: "boolean", summary: "Shout." }],
  async run(input, context) {
    ${body}
  },
};
`,
  );
  return file;
}

describe("plugin commands (D30)", () => {
  it("can't take a word of Mostra's own: the protocol's list is the CLI's, plus the reserved", () => {
    const own = COMMANDS.map((command) => command.path.join(" ")).sort();
    const listed = CORE_COMMANDS.map((path) => path.join(" "));
    expect([...listed].sort()).toEqual([...own, ...RESERVED].sort());
  });

  it("finds the longest command a command line names", () => {
    const commands = [info("term", "/x.mjs"), info("term record", "/y.mjs")];
    expect(matchCommand(commands, ["term", "record", "demo"])?.command).toBe("term record");
    expect(matchCommand(commands, ["term", "replay"])?.command).toBe("term");
    expect(matchCommand(commands, ["other"])).toBeUndefined();
  });

  it("runs a stamped definition as a command, its calls through the CLI's session", async () => {
    const file = commandModule({ name: "cli-command", version }, ["fixture", "hello"]);
    const command = await loadPluginCommand(info("fixture hello", file));
    expect(command.telemetryName).toBe("plugin");
    const parsed = parseCommandLine([...COMMANDS, command], ["fixture", "hello", "Ada", "--loud"]);
    if (parsed.kind !== "run") throw new Error("not parsed as a command");
    const calls: string[] = [];
    const context = {
      args: parsed.args,
      flags: parsed.flags,
      cwd: "/",
      json: true,
      log: () => {},
      call: async (method: { method: string }) => {
        calls.push(method.method);
        return { instance: { pid: 42 } };
      },
    } as unknown as CommandContext;
    const outcome = await command.run(context);
    expect(outcome.result).toEqual({ hello: "Ada", loud: true, pid: 42 });
    expect(calls).toEqual(["instance/status"]);
  });

  it("refuses a definition stamped for a contract version this release doesn't serve", async () => {
    const file = commandModule({ name: "cli-command", version: "99.0.0" }, ["fixture", "hello"]);
    await expect(loadPluginCommand(info("fixture hello", file))).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED" },
    });
  });

  it("refuses a definition whose words aren't the manifest's", async () => {
    const file = commandModule({ name: "cli-command", version }, ["fixture", "other"]);
    await expect(loadPluginCommand(info("fixture hello", file))).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_PLUGIN_FAILED" },
    });
  });

  it("says a command that throws failed as the plugin's, keeping a protocol call's own refusal", async () => {
    const context = {
      args: {},
      flags: {},
      cwd: "/",
      json: true,
      log: () => {},
    } as unknown as CommandContext;
    const throws = await loadPluginCommand(
      info(
        "fixture hello",
        commandModule(
          { name: "cli-command", version },
          ["fixture", "hello"],
          'throw new Error("no network");',
        ),
      ),
    );
    await expect(throws.run(context)).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_PLUGIN_FAILED", message: expect.stringContaining("no network") },
    });
    const unknown = await loadPluginCommand(
      info(
        "fixture hello",
        commandModule(
          { name: "cli-command", version },
          ["fixture", "hello"],
          'return await context.call("nope/nothing", {});',
        ),
      ),
    );
    await expect(unknown.run(context)).rejects.toMatchObject({
      diagnostic: { code: "MOSTRA_HOST_METHOD_UNKNOWN" },
    });
  });
});
