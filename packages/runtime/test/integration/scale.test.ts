/**
 * A home of thousands of artifacts stays responsive while live producers are reconciled (D132;
 * Opus review 2): which artifacts have live sources is kept in memory and updated on publish, so
 * a reconcile costs nothing per artifact without them. Thousands of published artifacts are
 * written into the ledger directly (publishing each would take an hour), then a real daemon
 * reconciles every few hundred milliseconds while a client measures how long the instance takes
 * to answer.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ArtifactId, VersionId } from "@mostra/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayHome, ok, type Receipt } from "../gateway-home.ts";

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");

const ARTIFACTS = 3000;

describe("a home with thousands of artifacts (Opus review 2)", () => {
  const gateway = new GatewayHome();
  let actions: Receipt & { dir: string };

  beforeAll(async () => {
    await gateway.start();
    actions = await gateway.publish("actions");
    await gateway.stop();
    // Thousands of artifacts without live sources, each with a published version.
    const db = new Database(join(gateway.home.home, "store", "ledger.sqlite"));
    const now = new Date().toISOString();
    const artifact = db.prepare(
      "INSERT INTO artifact (id, title, links_json, created_at, latest_version_id) VALUES (?, ?, '[]', ?, ?)",
    );
    const version = db.prepare(
      `INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest,
         manifest_json, published_at) VALUES (?, ?, 1, ?, ?, ?, '{"title":"t"}', ?)`,
    );
    db.transaction(() => {
      for (let index = 0; index < ARTIFACTS; index++) {
        const artifactId = ArtifactId.create();
        const digest = createHash("sha256").update(`artifact ${index}`).digest("hex");
        const versionId = VersionId.fromSha256(Buffer.from(digest, "hex"));
        artifact.run(artifactId, `artifact ${index}`, now, versionId);
        version.run(versionId, artifactId, digest, digest, digest, now);
      }
    })();
    db.close();
    // Reconcile every 375 ms, as a home with views and pushes does all day.
    await gateway.start({ env: { MOSTRA_TEST_INTEREST_LEASE_MS: "1500" } });
  }, 240_000);

  afterAll(async () => {
    await gateway.stop();
  });

  it("answers at once while it reconciles live producers", async () => {
    const listed = ok<{ artifacts: unknown[] }>(
      await gateway.client.call("artifact/list", {}, 60_000),
    );
    expect(listed.artifacts.length).toBe(ARTIFACTS + 1);
    // A push makes reconciles run on top of the periodic ones.
    ok(
      await gateway.client.call("live/push", {
        artifact: { artifactId: actions.artifactId },
        key: "counter",
        value: 1,
      }),
    );
    const latencies: number[] = [];
    const until = Date.now() + 4_000;
    while (Date.now() < until) {
      const started = performance.now();
      ok(await gateway.client.call("instance/status", {}));
      latencies.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    latencies.sort((a, b) => a - b);
    // Before the fix each reconcile read every artifact's latest version once per artifact: about
    // 4.5 s of blocked event loop per pass at 3,000 artifacts.
    expect(latencies.at(-1)).toBeLessThan(500);
  }, 60_000);
});
