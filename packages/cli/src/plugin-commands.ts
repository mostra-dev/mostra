/**
 * Commands plugins contribute (`@mostra/contract-cli-command`, D30): when a command line names
 * none of `mostra`'s own commands, the runner asks the instance which commands the home's plugins
 * and the current artifact's contribute (`plugin/commands`), and runs the longest one the words
 * name in this process, as git runs a subcommand: its `call` goes over the CLI's own session, to
 * the methods of the host protocol only, each checked against its schema.
 */
import { pathToFileURL } from "node:url";
import {
  createDiagnostic,
  hostMethods,
  type MethodDefinition,
  type PluginCommandInfo,
  RpcError,
} from "@mostra/protocol";
import { stampServed } from "@mostra/protocol/plugin";
import { type ArgDef, type CommandDef, defineCommand, type FlagDef } from "./command.ts";
import { EXIT } from "./exit.ts";
import { cliVersion } from "./version.ts";

/** A plugin command's definition as its module exports it (the contract's `CliCommand`). */
interface PluginDefinition {
  readonly contract: unknown;
  readonly path: readonly string[];
  readonly summary: string;
  readonly args?: readonly ArgDef[];
  readonly flags?: readonly FlagDef[];
  readonly example?: string;
  run(
    input: {
      readonly args: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly flags: Readonly<
        Record<string, string | number | boolean | readonly string[] | undefined>
      >;
      readonly cwd: string;
      readonly json: boolean;
    },
    context: {
      readonly signal: AbortSignal;
      log(message: string): void;
      readonly mostraVersion: string;
      call(method: string, params: Record<string, unknown>): Promise<unknown>;
      progress(line: string): void;
    },
  ): Promise<{ readonly result: unknown; readonly human?: string; readonly exit?: number }>;
}

const failed = (message: string): RpcError =>
  new RpcError(createDiagnostic("MOSTRA_PLUGIN_FAILED", { message }));

/** The plugin command `words` start with (the longest), or `undefined`. */
export function matchCommand(
  commands: readonly PluginCommandInfo[],
  words: readonly string[],
): PluginCommandInfo | undefined {
  let best: PluginCommandInfo | undefined;
  for (const command of commands) {
    const path = command.command.split(" ");
    if (path.length > words.length) continue;
    if (!path.every((word, index) => words[index] === word)) continue;
    if (best === undefined || path.length > best.command.split(" ").length) best = command;
  }
  return best;
}

/**
 * Loads a plugin command and turns it into a command of `mostra`: its definition is checked
 * (its stamp is one this release serves, its words are the manifest's), and its `run` gets a
 * context whose `call` reaches the host protocol through the CLI's session.
 */
export async function loadPluginCommand(info: PluginCommandInfo): Promise<CommandDef> {
  let value: unknown;
  try {
    const module = (await import(pathToFileURL(info.file).href)) as Record<string, unknown>;
    value = module[info.export];
  } catch (error) {
    throw failed(
      `The plugin ${info.package} couldn't load its command "${info.command}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const definition = value as PluginDefinition | undefined;
  if (
    definition === undefined ||
    typeof definition !== "object" ||
    typeof definition.run !== "function"
  ) {
    throw failed(`The plugin ${info.package} exports no command definition for "${info.command}".`);
  }
  if (!stampServed(definition.contract, "cli-command")) {
    throw new RpcError(
      createDiagnostic("MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED", {
        message: `The plugin ${info.package}@${info.version}'s command "${info.command}" was built for a cli-command contract this release doesn't serve.`,
      }),
    );
  }
  if (!Array.isArray(definition.path) || definition.path.join(" ") !== info.command) {
    throw failed(
      `The plugin ${info.package}'s command is "${String(definition.path)}", not "${info.command}" as its manifest says.`,
    );
  }
  return defineCommand({
    path: [...definition.path],
    summary: typeof definition.summary === "string" ? definition.summary : info.command,
    ...(definition.args !== undefined ? { args: definition.args } : {}),
    ...(definition.flags !== undefined ? { flags: definition.flags } : {}),
    output: { type: `the result of ${info.package}'s command`, topic: "cli" },
    exits: [EXIT.failure],
    example: definition.example ?? info.command,
    // Telemetry never learns a plugin's command (D140 item 8): it records `plugin`.
    telemetryName: "plugin",
    async run(context) {
      const controller = new AbortController();
      const outcome = await runCommand(info, () =>
        definition.run(
          { args: context.args, flags: context.flags, cwd: context.cwd, json: context.json },
          {
            signal: controller.signal,
            log: (message) => context.log(String(message)),
            progress: (line) => context.log(String(line)),
            mostraVersion: cliVersion(),
            call: (method, params) => {
              const known = hostMethods.find((candidate) => candidate.method === method);
              if (known === undefined || known.direction !== "client-to-instance") {
                throw new RpcError(
                  createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
                    message: `${method} isn't a method of the host protocol a client calls.`,
                  }),
                );
              }
              return context.call(
                known as MethodDefinition<unknown, unknown>,
                known.params.parse(params),
              );
            },
          },
        ),
      );
      if (typeof outcome !== "object" || outcome === null || !("result" in outcome)) {
        throw failed(`The plugin ${info.package}'s command "${info.command}" returned no result.`);
      }
      const exit =
        typeof outcome.exit === "number" &&
        Number.isInteger(outcome.exit) &&
        outcome.exit >= 0 &&
        outcome.exit <= 255
          ? outcome.exit
          : undefined;
      return {
        result: outcome.result,
        ...(typeof outcome.human === "string" ? { human: outcome.human } : {}),
        ...(exit !== undefined && exit !== 0 ? { exit } : {}),
      };
    },
  });
}

/**
 * Runs a plugin's command: a diagnostic it throws (its own, or one a protocol call answered)
 * stays as it is; anything else it throws is the plugin's failure, never Mostra's crash.
 */
async function runCommand<T>(info: PluginCommandInfo, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw failed(
      `The plugin ${info.package}'s command "${info.command}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
