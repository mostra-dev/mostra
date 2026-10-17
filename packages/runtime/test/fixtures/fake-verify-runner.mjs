#!/usr/bin/env node
/**
 * A stand-in for the verify runner child (`MOSTRA_VERIFY_ENTRY`): it speaks the runner's channel
 * and answers renders without a browser, so the supervisor's recovery from a runner that never
 * answers can be tested deterministically (Opus review finding 5, AX-02).
 *
 * - The first render it is ever asked for (in this home: a marker file next to the test's
 *   `MOSTRA_TEST_FAKE_RUNNER_DIR`) never answers.
 * - The next one answers after `MOSTRA_TEST_FAKE_RUNNER_DELAY_MS`, so it is in flight when the
 *   supervisor stops the stuck runner.
 * - Every other render answers at once: ready, with nothing found.
 *
 * With `MOSTRA_TEST_FAKE_RUNNER_MODE=record`, every render instead takes 300 ms and appends
 * `{ outDir, start, end }` to `renders.ndjson` in that directory, so a test can see which renders
 * overlapped (GPT review finding 2).
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcPeer, VERIFY_RUNNER_METHODS } from "@mostra/protocol";

const dir = process.env.MOSTRA_TEST_FAKE_RUNNER_DIR;
const delay = Number(process.env.MOSTRA_TEST_FAKE_RUNNER_DELAY_MS ?? "0");
const record = process.env.MOSTRA_TEST_FAKE_RUNNER_MODE === "record";
const send = process.send?.bind(process);
if (!send || !dir) process.exit(2);

const claim = (name) => {
  const marker = join(dir, name);
  if (existsSync(marker)) return false;
  writeFileSync(marker, String(process.pid));
  return true;
};

const peer = new RpcPeer({
  send: (message) => send(message),
  onRequest: async (method, params) => {
    if (method === VERIFY_RUNNER_METHODS.render && record) {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const line = { outDir: params.outDir, start, end: Date.now() };
      appendFileSync(join(dir, "renders.ndjson"), `${JSON.stringify(line)}\n`);
      return { ready: true, findings: [], timedOut: false, timingsMs: {} };
    }
    if (method === VERIFY_RUNNER_METHODS.render) {
      if (claim("stuck")) return new Promise(() => {});
      if (claim("slow")) await new Promise((resolve) => setTimeout(resolve, delay));
      return { ready: true, findings: [], timedOut: false, timingsMs: {} };
    }
    return { ratio: 0, sizeChanged: false };
  },
});
process.on("message", (message) => peer.receive(message));
process.on("disconnect", () => process.exit(0));
