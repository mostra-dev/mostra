/**
 * Every command of `mostra` (D60, D140 item 13), in the order help lists them. Commands later
 * packages own (`review export`, `export`, `mcp`, `plugin`, `term`, `run`) join this list with
 * their packages, never as placeholders; `share` joined with WP-13.
 */
import type { CommandDef } from "../command.ts";
import {
  daemonInstallCommand,
  daemonRestartCommand,
  daemonStartCommand,
  daemonStatusCommand,
  daemonStopCommand,
  daemonUninstallCommand,
  docsCommand,
  doctorCommand,
  gcCommand,
  hostCommand,
  listCommand,
  secretListCommand,
  secretRmCommand,
  secretSetCommand,
  statusCommand,
  telemetryOffCommand,
  telemetryOnCommand,
  telemetryStatusCommand,
} from "./admin.ts";
import { addCommand, newCommand, publishCommand, verifyCommand } from "./authoring.ts";
import { devCommand } from "./dev.ts";
import {
  pushCommand,
  resultsCommand,
  stateGetCommand,
  statePatchCommand,
  stateSetCommand,
  waitCommand,
} from "./interaction.ts";
import { shareCommand, shareListCommand, shareStopCommand } from "./sharing.ts";
import { openCommand } from "./viewing.ts";

/** The commands, in help's order: the authoring loop first. */
export const COMMANDS: readonly CommandDef[] = [
  newCommand,
  devCommand,
  verifyCommand,
  publishCommand,
  openCommand,
  shareCommand,
  shareStopCommand,
  shareListCommand,
  waitCommand,
  resultsCommand,
  stateGetCommand,
  stateSetCommand,
  statePatchCommand,
  pushCommand,
  addCommand,
  secretSetCommand,
  secretListCommand,
  secretRmCommand,
  listCommand,
  statusCommand,
  daemonStartCommand,
  daemonStopCommand,
  daemonRestartCommand,
  daemonStatusCommand,
  daemonInstallCommand,
  daemonUninstallCommand,
  hostCommand,
  docsCommand,
  doctorCommand,
  gcCommand,
  telemetryStatusCommand,
  telemetryOnCommand,
  telemetryOffCommand,
];
