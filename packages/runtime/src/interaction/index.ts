/**
 * The interaction core (ARCHITECTURE §6; IN-01 to IN-12, LL-01, LL-02): drafts and artifact
 * state, submissions and their delivery, signals, events, `wait` and results. The supervisor's
 * one owner of them: the gateway reaches it for the browser protocol, the protocol server for the
 * host methods, and every change is one ledger transaction that appends its events.
 *
 * ```ts
 * const interaction = createInteraction({ ledger, log, faults, hosts, settings, artifacts });
 * interaction.start();
 * const { submission } = interaction.submit({ artifactId, viewerId, viewId, expectedRevision, channel });
 * ```
 */
import {
  type Actor,
  type ArtifactRef,
  type DeliveryCounts,
  type EventFilter,
  type EventRecord,
  eventsAckMethod,
  eventsReadMethod,
  eventsSubscribeMethod,
  eventsUnsubscribeMethod,
  type FieldOp,
  type FieldScope,
  type MutationResult,
  resultsGetMethod,
  type StreamSnapshot,
  type SubmissionSummary,
  type SubmitChannel,
  stateGetMethod,
  statePatchMethod,
  type Viewer,
  type ViewerSpec,
  waitMethod,
} from "@mostra/protocol";
import type { Faults } from "../faults.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { handler, type MethodHandler, type Session } from "../protocol-server/index.ts";
import { latestCursor, readEvents } from "./events.ts";
import { applyMutation, documentFor, liveFields } from "./fields.ts";
import { type HostConnections, Outbox } from "./outbox.ts";
import { buildResults, resultsMarkdown, submissionFor } from "./results.ts";
import { raiseSignal } from "./signals.ts";
import {
  assertDraftOpen,
  closingSubmission,
  type Snapshot,
  type SubmissionRow,
  submissionSummary,
  submit,
} from "./submissions.ts";
import { Subscriptions } from "./subscriptions.ts";
import { localViewerId, openView, viewer, viewerForSpec, viewFor } from "./viewers.ts";
import { waitFor } from "./wait.ts";

export { appendEvent } from "./events.ts";
export type { HostConnections } from "./outbox.ts";
export { policyInForce } from "./policy.ts";
export { SubmitConflict } from "./submissions.ts";

/** How the interaction core finds an artifact a host names. */
export interface InteractionArtifacts {
  /** The artifact's ID; throws `MOSTRA_ARTIFACT_NOT_FOUND` for an unknown one. */
  resolve(ref: ArtifactRef): string;
}

/** Options for {@link createInteraction}. */
export interface InteractionOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly faults: Faults;
  readonly hosts: HostConnections & {
    /** Sends a notification on a connection; `false` when it is gone. */
    notify(session: number, method: string, params: unknown): boolean;
  };
  /** The hosts that always provide the submissions port (`HomeConfig.ports`, D105). */
  readonly expectedHosts: () => readonly string[];
  readonly artifacts: InteractionArtifacts;
  /** How long a host has to answer a port call (30 s; tests shorten it). */
  readonly portTimeoutMs?: number;
}

/** A browser session as the interaction core sees it: who it acts as. */
export interface PageIdentity {
  readonly artifactId: string;
  readonly viewerId: string;
}

/** The interaction core of one instance. */
export interface Interaction {
  /** Starts delivering submissions and events. */
  start(): void;
  /** Stops delivering; pending deliveries stay in the outbox. */
  stop(): void;

  /** The viewer a capability token's sessions act as (D104): its own, or the home's local user. */
  viewerOf(tokenViewerId: string | undefined): string;
  /** A viewer by ID (D104). */
  viewer(viewerId: string): Viewer;
  /** The viewer for `view/url`'s `viewer`, inside the caller's transaction. */
  viewerForSpec(db: LedgerDb, spec: ViewerSpec): string;
  /** Records a frame load of a version (D104) and returns its view ID. */
  openView(input: {
    readonly artifactId: string;
    readonly versionId: string;
    readonly viewerId: string;
    readonly tokenId?: string;
  }): string;

  /** A viewer's mutation of their draft or the artifact's state, from a page (IN-01, LL-01). */
  mutate(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly scope: FieldScope;
      readonly mutationId: string;
      readonly baseRevision: number;
      readonly ops: readonly FieldOp[];
    },
  ): MutationResult;
  /** A viewer's submit (IN-05); `SubmitConflict` under a closed `once`. */
  submit(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly expectedRevision: number;
      readonly channel: SubmitChannel;
    },
  ): SubmissionSummary & { readonly duplicate?: true };
  /** A viewer's signal (IN-09); returns its cursor. */
  signal(
    page: PageIdentity,
    input: { readonly viewId: string; readonly name: string; readonly payload?: unknown },
  ): string;
  /** Checks that a view belongs to this page's artifact and viewer (D104). */
  checkView(page: PageIdentity, viewId: string): void;
  /** Where a page stands: its viewer, draft, the artifact state and the newest cursor. */
  pageSnapshot(page: PageIdentity): StreamSnapshot;
  /** The events a page may see after a cursor (D104): never another viewer's draft or signals. */
  pageEvents(
    page: PageIdentity,
    after: number,
    limit: number,
  ): { readonly events: EventRecord[]; readonly cursor: string };
  /** Calls `listener` after every commit; returns the unsubscribe function. */
  onCommit(listener: () => void): () => void;

  /** The host protocol methods: `state/*`, `results/get`, `wait`, `events/*`. */
  methods(): MethodHandler[];
  /** A connection initialized: hosts with ports get their deliveries. */
  connected(session: Session): void;
  /** A connection closed: its subscriptions end. */
  disconnected(session: Session): void;
  /** The outbox per host, for `instance/status`. */
  deliveries(): DeliveryCounts[];
}

/** Whether a page may see an event (D104): never another viewer's draft, signal or view. */
function visibleTo(event: EventRecord, viewerId: string): boolean {
  if (event.type.startsWith("draft.")) return event.payload["viewerId"] === viewerId;
  if (event.type === "signal.raised" || event.type.startsWith("view.")) {
    return event.actor.kind !== "viewer" || event.actor.id === viewerId;
  }
  return true;
}

/** Creates the interaction core. */
export function createInteraction(options: InteractionOptions): Interaction {
  const { ledger, log, hosts } = options;
  const outbox = new Outbox({
    ledger,
    log,
    hosts,
    expected: options.expectedHosts,
    faults: options.faults,
    ...(options.portTimeoutMs !== undefined ? { portTimeoutMs: options.portTimeoutMs } : {}),
  });
  const subscriptions = new Subscriptions({
    ledger,
    log,
    notify: (session, method, params) => hosts.notify(session, method, params),
  });

  const pageActor = (page: PageIdentity): Actor => {
    const record = ledger.read((db) => viewer(db, page.viewerId));
    return {
      kind: "viewer",
      id: page.viewerId,
      ...(record.name !== undefined ? { name: record.name } : {}),
    };
  };

  const documentSnapshot = (db: LedgerDb, artifactId: string, viewerId: string | null) => {
    const document = documentFor(db, artifactId, viewerId);
    return {
      revision: String(document?.revision ?? 0),
      epoch: document?.epoch ?? 1,
      fields: liveFields(db, document?.id),
    };
  };

  const clientActor = (session: Session, as: "agent" | "host" = "agent"): Actor => ({
    kind: as,
    ...(session.client ? { id: session.client.name } : {}),
  });

  return {
    start() {
      outbox.start();
      subscriptions.start();
    },
    stop() {
      outbox.stop();
      subscriptions.stop();
    },

    viewerOf(tokenViewerId) {
      if (tokenViewerId !== undefined) return tokenViewerId;
      const existing = ledger.read((db) =>
        db.get<{ id: string }>(
          "SELECT id FROM viewer WHERE kind = 'local' AND external_ref = 'local'",
        ),
      );
      return existing?.id ?? ledger.write((db) => localViewerId(db));
    },
    viewer: (viewerId) => ledger.read((db) => viewer(db, viewerId)),
    viewerForSpec,
    openView(input) {
      return ledger.write((db) => openView(db, input));
    },

    mutate(page, input) {
      const actor = pageActor(page);
      const outcome = ledger.write((db) => {
        viewFor(db, input.viewId, page.artifactId, page.viewerId);
        if (input.scope === "viewer") assertDraftOpen(db, page.artifactId, page.viewerId);
        return applyMutation(db, {
          artifactId: page.artifactId,
          scope: input.scope,
          ...(input.scope === "viewer" ? { viewerId: page.viewerId } : {}),
          mutationId: input.mutationId,
          baseRevision: input.baseRevision,
          ops: input.ops,
          actor,
          viewId: input.viewId,
        });
      });
      if (outcome.changed && input.scope === "viewer")
        outbox.mirror(page.artifactId, page.viewerId);
      return outcome.result;
    },
    submit(page, input) {
      const owners = outbox.owners();
      const outcome = ledger.write((db) =>
        submit(db, {
          artifactId: page.artifactId,
          viewerId: page.viewerId,
          viewId: input.viewId,
          expectedRevision: input.expectedRevision,
          channel: input.channel,
          owners,
        }),
      );
      if (outcome.created) {
        log.info("interaction.submitted", {
          artifactId: page.artifactId,
          submissionId: outcome.submission.id,
          channel: input.channel,
        });
      }
      return outcome.submission;
    },
    signal(page, input) {
      const actor = pageActor(page);
      return ledger.write((db) => {
        viewFor(db, input.viewId, page.artifactId, page.viewerId);
        return raiseSignal(db, {
          artifactId: page.artifactId,
          name: input.name,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
          source: "artifact",
          actor,
          viewId: input.viewId,
        });
      });
    },
    checkView(page, viewId) {
      ledger.read((db) => viewFor(db, viewId, page.artifactId, page.viewerId));
    },
    pageSnapshot(page) {
      return ledger.read((db) => {
        const closing = closingSubmission(db, page.artifactId, page.viewerId);
        const latestOwn =
          closing ??
          db.get<SubmissionRow>(
            "SELECT * FROM submission WHERE artifact_id = ? AND viewer_id = ? ORDER BY position DESC LIMIT 1",
            page.artifactId,
            page.viewerId,
          );
        return {
          cursor: String(latestCursor(db)),
          viewer: viewer(db, page.viewerId),
          draft: documentSnapshot(db, page.artifactId, page.viewerId),
          state: documentSnapshot(db, page.artifactId, null),
          ...(latestOwn ? { submission: submissionSummary(db, latestOwn) } : {}),
        };
      });
    },
    pageEvents(page, after, limit) {
      // Read in pages until enough visible events or the end, so other viewers' events never
      // stall a page.
      return ledger.read((db) => {
        const events: EventRecord[] = [];
        let cursor = after;
        for (;;) {
          const read = readEvents(db, {
            filter: { artifacts: [page.artifactId] },
            after: cursor,
            limit,
          });
          for (const event of read.events) {
            if (events.length === limit) return { events, cursor: String(cursor) };
            cursor = Number(event.cursor);
            if (visibleTo(event, page.viewerId)) events.push(event);
          }
          cursor = Math.max(cursor, Number(read.cursor));
          if (read.events.length < limit || events.length === limit) {
            return { events, cursor: String(cursor) };
          }
        }
      });
    },
    onCommit: (listener) => ledger.onCommit(listener),

    methods: () => [
      handler(stateGetMethod, (params) => {
        const artifactId = options.artifacts.resolve(params.artifact);
        return ledger.read((db) => {
          const snapshot = documentSnapshot(db, artifactId, null);
          const fields =
            params.ids === undefined
              ? snapshot.fields
              : Object.fromEntries(
                  Object.entries(snapshot.fields).filter(([id]) => params.ids?.includes(id)),
                );
          return { revision: snapshot.revision, fields };
        });
      }),
      handler(statePatchMethod, (params, session) => {
        const artifactId = options.artifacts.resolve(params.artifact);
        return ledger.write(
          (db) =>
            applyMutation(db, {
              artifactId,
              scope: "artifact",
              mutationId: params.mutationId,
              ...(params.baseRevision !== undefined
                ? { baseRevision: Number(params.baseRevision) }
                : {}),
              ops: params.ops,
              actor: clientActor(session, params.as),
            }).result,
        );
      }),
      handler(resultsGetMethod, (params) => {
        const artifactId = options.artifacts.resolve(params.artifact);
        return ledger.read((db) => {
          const row = submissionFor(db, artifactId, params.submission);
          const results = buildResults(db, row);
          if (params.format !== "md") return results;
          return {
            submissionId: row.id,
            markdown: resultsMarkdown(results, JSON.parse(row.snapshot_json) as Snapshot),
          };
        });
      }),
      handler(waitMethod, (params, session) =>
        waitFor({
          ledger,
          artifactId: options.artifacts.resolve(params.artifact),
          until: params.until,
          after: params.after === undefined ? undefined : Number(params.after),
          timeoutMs: params.timeoutMs,
          signal: session.signal,
        }),
      ),
      handler(eventsReadMethod, (params) =>
        ledger.read((db) =>
          readEvents(db, {
            filter: params.filter as EventFilter | undefined,
            after: params.after === undefined ? 0 : Number(params.after),
            limit: params.limit ?? 100,
          }),
        ),
      ),
      handler(eventsSubscribeMethod, (params, session) => subscriptions.subscribe(session, params)),
      handler(eventsUnsubscribeMethod, (params, session) => {
        subscriptions.unsubscribe(session, params.subscriptionId);
        return {};
      }),
      handler(eventsAckMethod, (params, session) => {
        subscriptions.ack(session, params.subscriptionId, Number(params.cursor));
        return {};
      }),
    ],
    connected(session) {
      if (session.ports.has("submissions") && session.client)
        outbox.registered(session.client.name);
    },
    disconnected(session) {
      subscriptions.closed(session.id);
    },
    deliveries: () => outbox.counts(),
  };
}
