#!/usr/bin/env node
/**
 * The verify runner child's entry (`mostra-verify`, ARCHITECTURE §1): the supervisor's process
 * manager starts it, in its own process group, with a JSON-RPC channel over Node IPC. It serves
 * `verify/render` and `verify/compare`, keeps one warm Chromium for them, and exits after 10 idle
 * minutes or when its supervisor goes away, taking the browser with it (FAILURE_MODEL §2).
 */
import {
  type CompareRequest,
  createDiagnostic,
  type RenderRequest,
  RpcError,
  RpcPeer,
  VERIFY_RUNNER_METHODS,
} from "@mostra/protocol";
import { createRunner } from "./runner.ts";

const send = process.send?.bind(process);
if (!send) {
  process.stderr.write("mostra-verify runs only as a child of a Mostra supervisor.\n");
  process.exit(2);
}

/**
 * Ends this child and its process group (the browser with it). On Windows there is no group to
 * signal: its gate's Job Object ends the browser once this process exits (D150).
 */
function exitWithGroup(code: number): never {
  if (process.platform !== "win32") {
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      // The group is already gone.
    }
  }
  process.exit(code);
}

const idle = Number(process.env["MOSTRA_TEST_VERIFY_IDLE_MS"]);
const runner = createRunner({
  ...(idle > 0 ? { idleMs: idle } : {}),
  onIdle: () => {
    void runner.close().finally(() => exitWithGroup(0));
  },
});

const peer = new RpcPeer({
  send: (message) => {
    send(message);
  },
  onRequest: async (method, params) => {
    if (method === VERIFY_RUNNER_METHODS.render) {
      return runner.render(params as unknown as RenderRequest);
    }
    if (method === VERIFY_RUNNER_METHODS.compare) {
      return runner.compare(params as unknown as CompareRequest);
    }
    throw new RpcError(
      createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
        message: `The verify runner serves no method ${method}.`,
      }),
    );
  },
});
process.on("message", (message) => peer.receive(message));
process.on("disconnect", () => {
  peer.close();
  void runner.close().finally(() => exitWithGroup(0));
});
