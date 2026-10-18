/**
 * The builder child's entry (`mostra-runtime`'s `dist/builder/child/main.js`, ARCHITECTURE §1): the
 * only process that loads Vite. The supervisor starts one per build through the process manager,
 * sends `builder/build` over IPC, and stops it after the answer; for `mostra dev` it starts one per
 * session and sends `builder/dev`, and the child serves until it is stopped (D140 item 12). It
 * exits with its supervisor (`connectToSupervisor`) and never runs artifact code: bundling reads
 * modules, it doesn't run them.
 */
import { connectToSupervisor } from "../../processes/index.ts";
import {
  BUILD_METHOD,
  type BuildRequest,
  DEV_CHANGED_METHOD,
  DEV_METHOD,
  DEV_RELOAD_METHOD,
  type DevChange,
  type DevRequest,
} from "../types.ts";
import { type DevServer, startDev } from "./dev.ts";
import { buildSpa } from "./spa.ts";

let dev: DevServer | undefined;

const supervisor = connectToSupervisor({
  onRequest: async (method, params) => {
    if (method === BUILD_METHOD) return buildSpa(params as BuildRequest);
    if (method === DEV_METHOD) {
      if (dev) throw new Error("This builder child already serves a dev session.");
      dev = await startDev(params as DevRequest, supervisor);
      return dev.ready;
    }
    if (method === DEV_CHANGED_METHOD) {
      await dev?.changed((params as { changes: DevChange[] }).changes);
      return {};
    }
    if (method === DEV_RELOAD_METHOD) {
      dev?.reload();
      return {};
    }
    throw new Error(`The builder doesn't serve ${method}.`);
  },
});
