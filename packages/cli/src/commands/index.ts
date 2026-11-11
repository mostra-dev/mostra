/**
 * Every command of `mostra` (D60, D140 item 13), in the order help lists them. Commands later
 * packages own (`review export`, `plugin`, `term`) join this list with their
 * packages, never as placeholders; `share` joined with WP-13, `mcp` with WP-15, and `export` (its `bundle` class) and `run`
 * with WP-29.
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
import {
  addCommand,
  exportCommand,
  newCommand,
  publishCommand,
  runCommand,
  verifyCommand,
} from "./authoring.ts";
import { devCommand } from "./dev.ts";
import {
  pushCommand,
  resultsCommand,
  stateGetCommand,
  statePatchCommand,
  stateSetCommand,
  waitCommand,
} from "./interaction.ts";
import { mcpCommand } from "./mcp.ts";
import { loginCommand, logoutCommand, pauseCommand, resumeCommand } from "./remote.ts";
import { shareCommand, shareListCommand, shareStopCommand } from "./sharing.ts";
import { rosterAddCommand, rosterGetCommand, rosterRemoveCommand } from "./team.ts";
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
  loginCommand,
  logoutCommand,
  pauseCommand,
  resumeCommand,
  rosterAddCommand,
  rosterGetCommand,
  rosterRemoveCommand,
  waitCommand,
  resultsCommand,
  stateGetCommand,
  stateSetCommand,
  statePatchCommand,
  pushCommand,
  addCommand,
  exportCommand,
  runCommand,
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
  mcpCommand,
  docsCommand,
  doctorCommand,
  gcCommand,
  telemetryStatusCommand,
  telemetryOnCommand,
  telemetryOffCommand,
];
