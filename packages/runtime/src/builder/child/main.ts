/**
 * The builder child's entry (`mostra-runtime`'s `dist/builder/child/main.js`, ARCHITECTURE §1): the
 * only process that loads Vite. The supervisor starts one per build through the process manager,
 * sends `builder/build` over IPC, and stops it after the answer. It exits with its supervisor
 * (`connectToSupervisor`) and never runs artifact code: bundling reads modules, it doesn't run them.
 */
import { connectToSupervisor } from "../../processes/index.ts";
import { BUILD_METHOD, type BuildRequest } from "../types.ts";
import { buildSpa } from "./spa.ts";

connectToSupervisor({
  onRequest: async (method, params) => {
    if (method !== BUILD_METHOD) throw new Error(`The builder serves only ${BUILD_METHOD}.`);
    return buildSpa(params as BuildRequest);
  },
});
