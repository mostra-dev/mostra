/**
 * Hosted submissions reach the owner's own hosts through its outbox (RM-02, D165 item 1, DATA_MODEL
 * §7.3): a hosted home's delivery carries the stored snapshot, and the owner instance keeps the same
 * submission (its ID, digest and snapshot) and its own deliveries in one transaction, so H-04's
 * guarantees hold for hosted artifacts: durable here before any local delivery, in order, and each
 * delivered once in effect, a repeated delivery and a re-import included. The sync cursor copies each
 * followed event once.
 */
import { ArtifactId, type EventRecord, type SubmissionEnvelope, VersionId } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import { noFaults } from "../../src/faults.ts";
import { appendEvent } from "../../src/interaction/events.ts";
import {
  createInteraction,
  followEvents,
  type ImportSource,
  type Interaction,
  importedDeliveryId,
} from "../../src/interaction/index.ts";
import { viewerForSpec } from "../../src/interaction/viewers.ts";
import type { Ledger } from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { FakeHosts, freshLedger, until } from "../interaction-support.ts";

const SERVER = "https://api.example";
const OWNER_LINK = "lnk_01JB8Z3QF6S7W3N8D5K2C4V9XG";

/** The same artifact and version in a home: the version ID follows from the artifact (D89). */
function publish(ledger: Ledger, artifactId: string): string {
  return ledger.write((db) => {
    db.run(
      "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, 'Survey', 'questionnaire', '[]', ?, ?, NULL)",
      artifactId,
      JSON.stringify({ policy: "once", scope: "per-viewer" }),
      new Date().toISOString(),
    );
    appendEvent(db, { artifactId, type: "artifact.created", payload: {} });
    const digest = new Uint8Array(32);
    digest[1] = artifactId.charCodeAt(12);
    const id = VersionId.fromSha256(digest);
    db.run(
      "INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest, manifest_json, forced_codes_json, published_at) VALUES (?, ?, 1, ?, ?, ?, ?, NULL, ?)",
      id,
      artifactId,
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({ title: "Survey" }),
      new Date().toISOString(),
    );
    db.run("UPDATE artifact SET latest_version_id = ? WHERE id = ?", id, artifactId);
    appendEvent(db, {
      artifactId,
      type: "version.published",
      payload: { versionId: id, number: 1 },
    });
    return id;
  });
}

function interactionOn(ledger: Ledger, hosts: FakeHosts, hosted: boolean): Interaction {
  return createInteraction({
    coverage: () => () => true,
    ledger,
    log: silentLog,
    faults: noFaults,
    hosts,
    expectedHosts: () => [],
    artifacts: { resolve: (ref) => ("artifactId" in ref ? ref.artifactId : "") },
    ...(hosted ? { deliverSnapshots: true, deliveryOwners: () => [OWNER_LINK] } : {}),
  });
}

/** A hosted home and an owner instance holding the same version, the owner's host registered. */
async function setup() {
  const artifactId = ArtifactId.create();
  const hostedLedger = freshLedger().ledger;
  const ownerLedger = freshLedger().ledger;
  const versionId = publish(hostedLedger, artifactId);
  expect(publish(ownerLedger, artifactId)).toBe(versionId);
  ownerLedger.write((db) =>
    db.run(
      "INSERT INTO remote_link (server, account_id, instance_id, is_default, linked_at, state) VALUES (?, 'acct_1', ?, 1, ?, 'signed-in')",
      SERVER,
      OWNER_LINK,
      new Date().toISOString(),
    ),
  );
  ownerLedger.write((db) =>
    db.run(
      "INSERT INTO hosted_artifact (artifact_id, server, hosted_home, route_id, label, shared_at) VALUES (?, ?, 'hom_1', 'rte_1', 'label', ?)",
      artifactId,
      SERVER,
      new Date().toISOString(),
    ),
  );
  // The hosted home delivers to the owner link; the test plays the link and keeps each envelope.
  const toOwner = new FakeHosts();
  toOwner.registered = [{ session: 1, owner: OWNER_LINK, ports: ["submissions"] }];
  const envelopes: SubmissionEnvelope[] = [];
  toOwner.answer = async (call) => {
    envelopes.push(call.params as unknown as SubmissionEnvelope);
    return { accepted: true };
  };
  const hosted = interactionOn(hostedLedger, toOwner, true);
  hosted.start();
  // The owner's own host, which records what it receives.
  const ownersHost = new FakeHosts();
  ownersHost.registered = [{ session: 7, owner: "my-host", ports: ["submissions"] }];
  const owner = interactionOn(ownerLedger, ownersHost, false);
  owner.start();
  const source: ImportSource = {
    server: SERVER,
    serverKey: "SERVERKEY",
    home: "hom_1",
    incarnation: "inc-1",
  };
  const respond = (n: number, answer: string) => {
    const viewerId = hostedLedger.write((db) =>
      viewerForSpec(db, { ref: `person-${n}`, name: `Person ${n}` }),
    );
    const page = { artifactId, viewerId };
    const viewId = hosted.openView({ artifactId, versionId, viewerId });
    const mutation = hosted.mutate(page, {
      viewId,
      scope: "viewer",
      mutationId: `mut_${String(n).padStart(26, "0")}`,
      baseRevision: 0,
      ops: [{ id: "answer", value: answer }],
    });
    return hosted.submit(page, {
      viewId,
      expectedRevision: Number(mutation.revision),
      channel: "shell",
    });
  };
  const stop = () => {
    hosted.stop();
    owner.stop();
  };
  return {
    artifactId,
    versionId,
    hostedLedger,
    ownerLedger,
    hosted,
    owner,
    ownersHost,
    envelopes,
    source,
    respond,
    stop,
  };
}

describe("hosted submissions through the owner's outbox (RM-02, D165 item 1)", () => {
  it("keeps the same submission and delivers it to the owner's host once, in order", async () => {
    const s = await setup();
    try {
      const first = s.respond(1, "yes");
      const second = s.respond(2, "no");
      await until(() => s.envelopes.length === 2);
      // Each envelope carries its snapshot and its hosted cursor.
      for (const envelope of s.envelopes) {
        expect(envelope.snapshot).toBeTypeOf("string");
        expect(envelope.cursor).toMatch(/^[0-9]+$/);
      }
      for (const envelope of s.envelopes) {
        expect(s.owner.importSubmission(envelope, s.source)).toEqual({ accepted: true });
      }
      await until(() => s.ownersHost.calls.length === 2);
      const delivered = s.ownersHost.calls.map(
        (call) => call.params as unknown as SubmissionEnvelope,
      );
      expect(delivered.map((envelope) => envelope.submissionId)).toEqual([first.id, second.id]);
      // The same submission: its ID, digest and answers, and where it came from.
      const hostedResults = s.envelopes.map((envelope) => envelope.results);
      expect(delivered.map((envelope) => envelope.results.submission.digest)).toEqual(
        hostedResults.map((results) => results.submission.digest),
      );
      expect(delivered[0]?.results.answers).toEqual({ answer: "yes" });
      expect(delivered[0]?.results.submission.origin).toEqual({
        server: SERVER,
        home: "hom_1",
        incarnation: "inc-1",
        cursor: s.envelopes[0]?.cursor,
      });
      expect(delivered[0]?.results.submission.viewer.name).toBe("Person 1");
      // Its local delivery ID is derived, so a re-import repeats it (DATA_MODEL §7.3).
      expect(delivered[0]?.deliveryId).toBe(importedDeliveryId(first.id, "my-host"));

      // A repeated delivery (the owner committed, its answer was lost) is accepted and changes nothing.
      expect(s.owner.importSubmission(s.envelopes[0] as SubmissionEnvelope, s.source)).toEqual({
        accepted: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(s.ownersHost.calls).toHaveLength(2);
      expect(
        s.ownerLedger.read(
          (db) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission")?.n,
        ),
      ).toBe(2);
    } finally {
      s.stop();
    }
  });

  it("refuses a delivery it can never hold, for good", async () => {
    const s = await setup();
    try {
      s.respond(1, "yes");
      await until(() => s.envelopes.length === 1);
      const envelope = s.envelopes[0] as SubmissionEnvelope;
      const tampered = {
        ...envelope,
        snapshot: (envelope.snapshot as string).replace('"yes"', '"no"'),
      };
      expect(s.owner.importSubmission(tampered, s.source)).toMatchObject({
        accepted: false,
        retry: false,
      });
      const { snapshot: _snapshot, ...bare } = envelope;
      expect(s.owner.importSubmission(bare, s.source)).toMatchObject({
        accepted: false,
        retry: false,
      });
      // Another server's delivery of the artifact: this instance doesn't own it there.
      expect(
        s.owner.importSubmission(envelope, { ...s.source, server: "https://other.example" }),
      ).toMatchObject({
        accepted: false,
        reason: expect.stringMatching(/^undeliverable/),
        retry: false,
      });
      expect(
        s.ownerLedger.read(
          (db) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission")?.n,
        ),
      ).toBe(0);
    } finally {
      s.stop();
    }
  });

  it("copies each followed event once, and never a hosted submission's own record", async () => {
    const s = await setup();
    try {
      s.respond(1, "yes");
      await until(() => s.envelopes.length === 1);
      const events = s.hostedLedger.read((db) =>
        db.all<{
          cursor: number;
          artifact_id: string;
          seq: number;
          type: string;
          actor_json: string;
          payload_json: string;
          at: string;
        }>("SELECT * FROM event ORDER BY cursor"),
      );
      const records: EventRecord[] = events.map((row) => ({
        cursor: String(row.cursor) as EventRecord["cursor"],
        artifactId: row.artifact_id,
        seq: row.seq,
        type: row.type,
        at: row.at,
        actor: JSON.parse(row.actor_json),
        payload: JSON.parse(row.payload_json),
      }));
      const once = s.ownerLedger.write((db) =>
        followEvents(db, { events: records, source: s.source, owned: () => true }),
      );
      // Its submission isn't here yet: the record waits for the delivery, never appended alone.
      expect(once.missing).toHaveLength(1);
      const copied = s.ownerLedger.read((db) =>
        db.all<{ type: string }>(
          "SELECT type FROM event WHERE origin_json IS NOT NULL ORDER BY cursor",
        ),
      );
      expect(copied.map((row) => row.type)).toContain("draft.changed");
      expect(copied.map((row) => row.type)).not.toContain("submission.created");
      expect(copied.map((row) => row.type)).not.toContain("version.published");
      const twice = s.ownerLedger.write((db) =>
        followEvents(db, { events: records, source: s.source, owned: () => true }),
      );
      expect(twice.appended).toBe(0);
      // Under a new incarnation (a restored hosted home) the same cursors are new events.
      const restored = s.ownerLedger.write((db) =>
        followEvents(db, {
          events: records,
          source: { ...s.source, incarnation: "inc-2" },
          owned: () => true,
        }),
      );
      expect(restored.appended).toBe(once.appended);
    } finally {
      s.stop();
    }
  });
});
