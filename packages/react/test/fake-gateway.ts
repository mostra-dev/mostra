/**
 * A gateway in memory for the store's unit tests: the browser protocol's field rules as WP-06's
 * interaction core applies them (per-field compare-and-set against a base revision, conflicts
 * with the current value, replayed mutation IDs), events to every subscriber, and switches to
 * take the network away or refuse requests. The real gateway is exercised end to end in
 * `tests/e2e`; this one makes the store's own logic testable step by step.
 */
import type {
  EventRecord,
  FieldsRequest,
  MutationResult,
  SignalRequest,
  StreamSnapshot,
  SubmissionSummary,
  SubmitRequest,
} from "@mostra/protocol";
import { MostraError } from "../src/runtime/errors.ts";
import { NetworkError, type StreamHandlers, type Transport } from "../src/runtime/transport.ts";

interface Field {
  value: unknown;
  revision: number;
}

interface Doc {
  revision: number;
  fields: Map<string, Field>;
}

export class FakeGateway {
  readonly docs: Record<"viewer" | "artifact", Doc> = {
    viewer: { revision: 0, fields: new Map() },
    artifact: { revision: 0, fields: new Map() },
  };
  readonly mutations = new Map<string, { digest: string; result: MutationResult }>();
  readonly received: FieldsRequest[] = [];
  readonly submits: SubmitRequest[] = [];
  readonly signals: SignalRequest[] = [];
  readonly events: EventRecord[] = [];
  /** The network is down: every request fails before it arrives. */
  offline = false;
  /** Refuses the next mutations with this code. */
  refuseWith: string | undefined;
  /** View IDs the gateway accepts. */
  views = new Set<string>(["vw_01J00000000000000000000000"]);
  readonly #subscribers = new Set<StreamHandlers>();
  #cursor = 0;

  transport(): Transport {
    return {
      snapshot: async () => this.snapshot(),
      mutate: async (request) => this.mutate(request),
      submit: async (request) => this.submit(request),
      signal: async (request) => {
        if (this.offline) throw new NetworkError("offline");
        this.signals.push(request);
        return { cursor: String(++this.#cursor) };
      },
      subscribe: (_cursor, handlers) => {
        this.#subscribers.add(handlers);
        queueMicrotask(() => {
          handlers.onStatus("live");
          handlers.onSnapshot(this.snapshot());
        });
        return () => this.#subscribers.delete(handlers);
      },
    };
  }

  snapshot(): StreamSnapshot {
    const doc = (scope: "viewer" | "artifact") => ({
      revision: String(this.docs[scope].revision),
      epoch: 1,
      fields: Object.fromEntries(
        [...this.docs[scope].fields].map(([id, field]) => [
          id,
          {
            value: field.value,
            revision: String(field.revision),
            updatedAt: new Date().toISOString(),
          },
        ]),
      ),
    });
    return {
      cursor: String(this.#cursor),
      viewer: { id: "vwr_01J00000000000000000000000", kind: "local" },
      draft: doc("viewer"),
      state: doc("artifact"),
    };
  }

  /** Another writer (an agent, another device) changes fields directly. */
  write(scope: "viewer" | "artifact", values: Record<string, unknown>): number {
    const doc = this.docs[scope];
    doc.revision += 1;
    for (const [id, value] of Object.entries(values)) {
      doc.fields.set(id, { value, revision: doc.revision });
    }
    this.#emit(
      scope,
      doc.revision,
      Object.entries(values).map(([id, value]) => ({ id, value })),
      {
        kind: "agent",
      },
    );
    return doc.revision;
  }

  #emit(
    scope: "viewer" | "artifact",
    revision: number,
    changes: { id: string; value?: unknown; deleted?: true }[],
    actor: EventRecord["actor"],
    mutationId?: string,
  ): void {
    const event: EventRecord = {
      cursor: String(++this.#cursor) as EventRecord["cursor"],
      artifactId: "art_01J00000000000000000000000",
      seq: this.#cursor,
      type: scope === "viewer" ? "draft.changed" : "state.changed",
      at: new Date().toISOString(),
      actor,
      ...(mutationId ? { causation: { mutationId } } : {}),
      payload: { revision: String(revision), changes },
    };
    this.events.push(event);
    for (const subscriber of this.#subscribers) {
      queueMicrotask(() => subscriber.onEvents([event]));
    }
  }

  mutate(request: FieldsRequest): MutationResult {
    if (this.offline) throw new NetworkError("offline");
    this.received.push(request);
    if (this.refuseWith) {
      const code = this.refuseWith;
      throw new MostraError(code, `Refused: ${code}.`, { status: 400 });
    }
    if (!this.views.has(request.viewId)) {
      throw new MostraError("MOSTRA_SUBMIT_VIEW_INVALID", "Another link's view.", { status: 403 });
    }
    const digest = JSON.stringify([request.scope, request.baseRevision, request.ops]);
    const recorded = this.mutations.get(request.mutationId);
    if (recorded) {
      if (recorded.digest !== digest) {
        throw new MostraError("MOSTRA_FIELD_MUTATION_ID_REUSED", "Reused.", { status: 409 });
      }
      return recorded.result;
    }
    const doc = this.docs[request.scope];
    const base = Number(request.baseRevision);
    const revision = doc.revision + 1;
    const applied: string[] = [];
    const conflicts: MutationResult["conflicts"][number][] = [];
    const changes: { id: string; value?: unknown; deleted?: true }[] = [];
    for (const op of request.ops) {
      const current = doc.fields.get(op.id);
      if (current && current.revision > base) {
        conflicts.push({ id: op.id, revision: String(current.revision), value: current.value });
        continue;
      }
      applied.push(op.id);
      if (op.delete) {
        doc.fields.delete(op.id);
        changes.push({ id: op.id, deleted: true });
      } else {
        doc.fields.set(op.id, { value: op.value, revision });
        changes.push({ id: op.id, value: op.value });
      }
    }
    if (applied.length > 0) doc.revision = revision;
    const result: MutationResult = {
      revision: String(doc.revision),
      applied,
      conflicts,
    };
    this.mutations.set(request.mutationId, { digest, result });
    if (applied.length > 0) {
      this.#emit(
        request.scope,
        revision,
        changes,
        { kind: "viewer", id: "vwr_01J00000000000000000000000" },
        request.mutationId,
      );
    }
    return result;
  }

  submit(request: SubmitRequest): SubmissionSummary {
    if (this.offline) throw new NetworkError("offline");
    this.submits.push(request);
    if (Number(request.expectedRevision) !== this.docs.viewer.revision) {
      throw new MostraError("MOSTRA_SUBMIT_REVISION_MOVED", "Moved.", { status: 409 });
    }
    return {
      id: "sub_01J00000000000000000000000",
      at: new Date().toISOString(),
      epoch: 1,
      channel: "artifact",
      versionId: "ver_00000000000000000000000000",
      version: 1,
      viewId: request.viewId,
      staleView: false,
      draftRevision: request.expectedRevision,
      digest: "0".repeat(64),
      delivery: "pending",
      deliveries: [],
    };
  }
}
