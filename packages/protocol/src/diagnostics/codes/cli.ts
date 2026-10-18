/**
 * Diagnostic codes of the CLI area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the CLI area, in the order they were added. */
export const cliDiagnosticCodes = [
  "MOSTRA_CLI_USAGE",
  "MOSTRA_CLI_UNKNOWN_COMMAND",
  "MOSTRA_CLI_CONFIG_UNWRITABLE",
  // gen:codes
] as const;

/** The codes of the CLI area. */
export type CliDiagnosticCode = (typeof cliDiagnosticCodes)[number];

/** The CLI area's catalog entries. */
export const cliDiagnostics: AreaCatalog<CliDiagnosticCode> = {
  MOSTRA_CLI_USAGE: {
    severity: "error",
    phase: "host",
    title: "Command used wrongly",
    hint: "Run `mostra <command> --help` for the command's arguments and flags, then run it again.",
    docs: {
      explanation:
        "The command line didn't fit the command's definition: a missing or extra argument, an unknown flag, a flag without its value, or a value of the wrong form (a duration, a number, JSON). Nothing ran. In `--json` mode the error is the envelope's `error`, and the exit code is 2.",
      fix: "Read `mostra <command> --help` (or `--help --json` for the machine-readable definition) and correct the arguments.",
    },
  },
  MOSTRA_CLI_UNKNOWN_COMMAND: {
    severity: "error",
    phase: "host",
    title: "Unknown command",
    hint: "Pick one of the commands this message lists; `mostra --help` describes each.",
    docs: {
      explanation:
        "The first word after `mostra` isn't a command this CLI has. The message lists the commands that exist. Commands that later releases add (sharing, export, plugins, terminals) appear only once they exist, never as placeholders.",
      fix: "Run one of the listed commands. `mostra --help` lists every command with a one-line summary.",
    },
  },
  MOSTRA_CLI_CONFIG_UNWRITABLE: {
    severity: "error",
    phase: "platform",
    title: "The CLI's config directory can't be written",
    hint: "Make the directory the message names yours and writable (or point MOSTRA_CONFIG_DIR at one that is), then run the command again; DO_NOT_TRACK=1 turns telemetry off without writing anything.",
    docs: {
      explanation:
        "`mostra telemetry on` and `off` record the choice in the CLI's config directory (`MOSTRA_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/mostra`). The directory or its `telemetry.json` can't be written (another user owns it, the disk is full, it's read-only), so the choice wasn't recorded and nothing changed. Telemetry never stops another command for this: a store that can't be written means nothing is sent.",
      fix: "Fix the directory's owner or mode, or set `MOSTRA_CONFIG_DIR` to a directory you own, and run the command again. `DO_NOT_TRACK=1` or `MOSTRA_TELEMETRY=0` in your environment turn telemetry off without a file.",
    },
  },
  // gen:entries
};
