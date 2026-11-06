/**
 * The hosted home's side of the relay, against a scripted owner (WP-29, RM-04; INTERFACES §18.3,
 * FAILURE_MODEL §11.1): after every reconnect the runs the owner accepted are reconciled before any
 * waiting run drains; an owner whose relay mark is below what it had accepted was restored to
 * before those runs, which become `unknown` with every run sent but never acknowledged, and none is
 * sent again; and relay sequences continue above the owner's mark.
 */
import { ArtifactId, createDiagnostic, RpcError, serializeAll, VersionId } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { appendEvent } from "../../src/interaction/events.ts";
import { createEphemeralBus, createInteraction } from "../../src/interaction/index.ts";
import { viewerForSpec } from "../../src/interaction/viewers.ts";
import { silentLog } from "../../src/log.ts";
import type { Session } from "../../src/protocol-server/index.ts";
import { createHostedRelay } from "../../src/server/relay.ts";
import { FakeHosts, freshLedger, until } from "../interaction-support.ts";

const LINK = "lnk_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const FN = "actions.ts#send";

interface Call {
  readonly session: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function setup(options: { sweepMs?: number; now?: () => number } = {}) {
  const { ledger } = freshLedger();
  const artifactId = ArtifactId.create();
  const versionId = ledger.write((db) => {
    db.run(
      "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, 'Relay', NULL, '[]', NULL, ?, NULL)",
      artifactId,
      new Date().toISOString(),
    );
    appendEvent(db, { artifactId, type: "artifact.created", payload: {} });
    const id = VersionId.fromSha256(new Uint8Array(32).fill(7));
    db.run(
      "INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest, manifest_json, forced_codes_json, published_at) VALUES (?, ?, 1, ?, ?, ?, ?, NULL, ?)",
      id,
      artifactId,
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({
        title: "Relay",
        hosted: { actions: "link", offline: { actions: "queue", limit: "1h" } },
      }),
      new Date().toISOString(),
    );
    db.run("UPDATE artifact SET latest_version_id = ? WHERE id = ?", id, artifactId);
    return id;
  });
  const interaction = createInteraction({
    coverage: () => () => true,
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts: new FakeHosts(),
    expectedHosts: () => [],
    artifacts: { resolve: () => artifactId },
  });
  const calls: Call[] = [];
  /** The owner's open session, if any, and how it answers. */
  let open: number | undefined;
  let answer: (call: Call) => unknown = () => ({ accepted: true });
  const relay = createHostedRelay({
    ledger,
    interaction,
    bus: createEphemeralBus(),
    log: silentLog,
    ownerOf: () => LINK,
    sessionOf: () => open,
    call: async (session, method, params) => {
      const call = { session, method, params: params as Record<string, unknown> };
      calls.push(call);
      return answer(call);
    },
    functions: () => new Set([FN]),
    sweepMs: options.sweepMs ?? 60_000,
    ...(options.now ? { now: options.now } : {}),
  });
  const viewerId = ledger.write((db) => viewerForSpec(db, { ref: "grace@example.com" }));
  const page = { artifactId, viewerId };
  const viewId = interaction.openView({ artifactId, versionId, viewerId });
  let keys = 0;
  const start = async () =>
    relay.startRun(page, {
      viewId,
      fnId: FN,
      args: await serializeAll(["x"], { mode: "argument" }),
      clientKey: `ck-${keys++}`,
    });
  const connect = (id: number, relayMark: number): void => {
    open = id;
    relay.connected({
      id,
      ports: new Set(["relay"]),
      link: { instanceId: LINK, relayMark },
    } as unknown as Session);
  };
  const disconnect = (id: number): void => {
    open = undefined;
    relay.disconnected({
      id,
      ports: new Set(["relay"]),
      link: { instanceId: LINK, relayMark: 0 },
    } as unknown as Session);
  };
  const status = (runId: string) => interaction.runState(runId)?.status;
  return {
    relay,
    calls,
    start,
    connect,
    disconnect,
    status,
    answering: (next: (call: Call) => unknown) => {
      answer = next;
    },
  };
}

describe("the hosted relay against a scripted owner (§18.3)", () => {
  it("reconciles the runs the owner accepted before any waiting run drains", async () => {
    const t = setup();
    t.connect(1, 0);
    await until(() => true);
    const first = await t.start();
    await until(() => t.calls.some((call) => call.method === "port/relay.run"));
    t.disconnect(1);
    const waiting = await t.start();
    expect(waiting.status).toBe("waiting");
    t.answering((call) =>
      call.method === "port/relay.reconcile"
        ? {
            runs: [
              {
                runId: first.runId,
                state: {
                  runId: first.runId,
                  fnId: FN,
                  status: "succeeded",
                  log: [],
                  batches: [],
                  startedAt: new Date().toISOString(),
                },
              },
            ],
          }
        : { accepted: true },
    );
    t.connect(2, 1);
    await until(() => t.calls.filter((call) => call.session === 2).length >= 2);
    const methods = t.calls.filter((call) => call.session === 2).map((call) => call.method);
    expect(methods).toEqual(["port/relay.reconcile", "port/relay.run"]);
    expect(
      t.calls.find((call) => call.session === 2 && call.method === "port/relay.run")?.params[
        "runId"
      ],
    ).toBe(waiting.runId);
    expect(t.status(first.runId)).toBe("succeeded");
    t.relay.stop();
  });

  it("makes every run a restored owner can't hold unknown, and sends none of them again", async () => {
    const t = setup();
    t.connect(1, 0);
    await until(() => true);
    const accepted = await t.start();
    await until(() => t.calls.length === 1);
    // The next run's acknowledgement is lost: sent, never accepted.
    t.answering(() => {
      throw new Error("the connection closed");
    });
    const unacknowledged = await t.start();
    await until(() => t.calls.length === 2);
    t.disconnect(1);
    t.answering(() => ({ accepted: true }));
    // The owner comes back with a relay mark below the run it had accepted: a restore.
    t.connect(2, 0);
    await until(
      () => t.status(accepted.runId) === "unknown" && t.status(unacknowledged.runId) === "unknown",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(t.calls.filter((call) => call.session === 2)).toEqual([]);
    t.relay.stop();
  });

  it("continues relay sequences above the owner's mark", async () => {
    const t = setup();
    t.connect(1, 50);
    await until(() => true);
    await t.start();
    await until(() => t.calls.length === 1);
    expect(t.calls[0]?.params["seq"]).toBe(51);
    t.relay.stop();
  });

  it("ends a run its owner refused before recording it failed, and sends one it never acknowledged again", async () => {
    let clock = Date.now();
    const t = setup({ sweepMs: 20, now: () => clock });
    t.connect(1, 0);
    await until(() => true);
    // The owner answers with a refusal: it never recorded the run, so the run never happened.
    t.answering(() => {
      throw new RpcError(
        createDiagnostic("MOSTRA_REMOTE_NOT_OWNER_INSTANCE", { message: "not this instance's" }),
      );
    });
    const refused = await t.start();
    await until(() => t.status(refused.runId) === "failed");
    // The owner's answer timed out: the run may be recorded there, so it is sent again later,
    // which joins it, and never ends here meanwhile.
    t.answering(() => {
      throw new RpcError(createDiagnostic("MOSTRA_HOST_TIMEOUT", { message: "no answer" }));
    });
    const silent = await t.start();
    await until(() => t.calls.filter((call) => call.params["runId"] === silent.runId).length === 1);
    expect(t.status(silent.runId)).toBe("queued");
    t.answering(() => ({ accepted: true }));
    clock += 40_000;
    await until(() => t.calls.filter((call) => call.params["runId"] === silent.runId).length === 2);
    expect(t.status(silent.runId)).toBe("queued");
    t.relay.stop();
  });
});
