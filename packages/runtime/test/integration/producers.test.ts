/**
 * Live producers and the secrets port through a real daemon (WP-08): a producer runs while a page
 * reads its source, while a host subscribes to its artifact's events, or always when it says
 * `always: true`, and stops when none of these hold (LL-04); the ring keeps only its bounded
 * window; a host's `secrets` port answers server code before the home's store, and its values are
 * redacted like the store's (AC-06).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPage } from "../action-page.ts";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";
import {
  connectTo,
  eventually,
  initializeParams,
  type LineClient,
  type Message,
} from "../support.ts";

interface Worker {
  versionId: string;
  state: string;
  active: number;
}

describe("live producers (LL-04) and the secrets port (AC-06)", () => {
  const gateway = new GatewayHome();
  let always: Receipt & { dir: string };
  let actions: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start({ env: { MOSTRA_TEST_INTEREST_LEASE_MS: "1500" } });
    always = await gateway.publish("always");
    actions = await gateway.publish("actions");
  }, 240_000);

  afterAll(async () => {
    await gateway.stop();
  });

  const producers = async (versionId: string): Promise<number> => {
    const status = ok<{ workers?: Worker[] }>(await gateway.client.call("instance/status", {}));
    return status.workers?.find((worker) => worker.versionId === versionId)?.active ?? 0;
  };

  it("runs an `always` producer with no viewer, and others only while wanted", async () => {
    // Nobody views the artifact: its `always` source is produced, its other one isn't.
    await eventually(async () => (await producers(always.versionId)) === 1, 15_000);
    const page = await openPage(always.url);
    let beats = 0;
    await eventually(async () => {
      const sources = (await page.live([{ key: "heartbeat" }])).json<{
        sources: { revision?: string }[];
      }>().sources;
      beats = Number(sources[0]?.revision ?? 0);
      return beats >= 2;
    }, 15_000);
    // A page reads the other one: it runs while the page keeps reading (a one-minute lease, 1.5 s
    // here), then stops.
    expect((await page.live([{ key: "onDemand" }])).status).toBe(200);
    await eventually(async () => (await producers(always.versionId)) === 2, 10_000);
    await eventually(async () => (await producers(always.versionId)) === 1, 15_000);
    // A host subscribed to the artifact's events keeps it running too, until it unsubscribes.
    const subscriber = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await subscriber.call(
        "mostra/initialize",
        initializeParams({ capabilities: { notifications: ["events/notify"] } }),
      ),
    );
    const subscribed = ok<{ subscriptionId: string }>(
      await subscriber.call("events/subscribe", { filter: { artifacts: [always.artifactId] } }),
    );
    await eventually(async () => (await producers(always.versionId)) === 2, 15_000);
    ok(await subscriber.call("events/unsubscribe", { subscriptionId: subscribed.subscriptionId }));
    subscriber.close();
    await eventually(async () => (await producers(always.versionId)) === 1, 15_000);
  }, 90_000);

  it("keeps the latest value and a bounded ring, never more than the source's window", async () => {
    const page = await openPage(actions.url);
    let ring: unknown[] = [];
    await eventually(async () => {
      const sources = (await page.live([{ key: "ticks", window: 500 }])).json<{
        sources: { revision?: string; ring?: unknown[] }[];
      }>().sources;
      ring = sources[0]?.ring ?? [];
      return Number(sources[0]?.revision ?? 0) > 40;
    }, 20_000);
    // `ticks` keeps 20 (`ring: 20`) however many it produced and however many a page asks for.
    expect(ring).toHaveLength(20);
  }, 60_000);

  it("asks a host's `secrets` port first, and redacts what it answers", async () => {
    ok(
      await gateway.client.call("secret/set", {
        name: "SHARED",
        value: "from-the-home-store-1",
        artifact: { artifactId: actions.artifactId },
      }),
    );
    const host: LineClient = await connectTo(gateway.daemon.status.socket as string);
    ok(
      await host.call(
        "mostra/initialize",
        initializeParams({ client: { name: "vault", version: "1" }, ports: ["secrets"] }),
      ),
    );
    let answering = true;
    const answers = (async () => {
      while (answering) {
        let message: Message & { params?: { artifactId: string; name: string } };
        try {
          message = (await host.next(
            (m) => m.method === "port/secrets.get",
            200,
          )) as typeof message;
        } catch {
          continue;
        }
        const value =
          message.params?.name === "VAULT_ONLY"
            ? "vault-value-123456"
            : message.params?.name === "SHARED"
              ? "from-the-vault-2"
              : null;
        expect(message.params?.artifactId).toBe(actions.artifactId);
        host.sendRaw(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: value }));
      }
    })();
    const page = await openPage(actions.url);
    // The port's value wins over the store's; a name the port doesn't know falls back to it.
    expect((await page.call("actions.ts#holds", ["VAULT_ONLY", "vault-value-123456"])).value).toBe(
      true,
    );
    expect((await page.call("actions.ts#holds", ["SHARED", "from-the-vault-2"])).value).toBe(true);
    // A port answer is a secret like any other: redacted from what Mostra sends and keeps.
    expect((await page.call("actions.ts#named", ["VAULT_ONLY"])).value).toBe("[redacted]");
    answering = false;
    await answers;
    host.close();
    // Without the port, the home's store answers.
    await eventually(async () => {
      const held = await page.call("actions.ts#holds", ["SHARED", "from-the-home-store-1"]);
      return held.value === true;
    }, 10_000);
    const gone = await page.call("actions.ts#named", ["VAULT_ONLY"]);
    expect(gone.end).toMatchObject({ status: "failed", error: { code: "MOSTRA_SECRET_MISSING" } });
  }, 60_000);
});
