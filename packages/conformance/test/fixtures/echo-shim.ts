/**
 * A harness shim for the runner's unit tests: it names itself and answers every other harness
 * method with nothing, so scenarios that don't touch an instance run against it.
 */
import { serveHarness } from "@mostra/conformance";

await serveHarness({
  initialize: () => ({ host: { name: "echo-shim", version: "0" }, ports: [], features: [] }),
  start: () => {
    throw new Error("echo-shim starts no instance");
  },
  call: () => null,
  stop: () => undefined,
  store: () => ({ deliveries: [], drafts: [], activations: [], identity: [], policies: [], secrets: [] }),
});
