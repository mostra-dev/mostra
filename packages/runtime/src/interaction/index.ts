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
  type CarryOver,
  type ControlsPolicy,
  type DeliveryCounts,
  type EventFilter,
  type EventRecord,
  eventsAckMethod,
  eventsReadMethod,
  eventsSubscribeMethod,
  eventsUnsubscribeMethod,
  type FieldOp,
  type FieldScope,
  type FieldState,
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
import {
  applyMutation,
  documentFor,
  type FieldRow,
  liveFields,
  replayedMutation,
} from "./fields.ts";
import { type HostConnections, Outbox } from "./outbox.ts";
import { buildResults, CHOICE, resultsMarkdown, submissionFor } from "./results.ts";
import { raiseSignal } from "./signals.ts";
import {
  assertChannel,
  assertDraftOpen,
  closingSubmission,
  orphansOf,
  type Snapshot,
  type SubmissionRow,
  submissionSummary,
  submit,
} from "./submissions.ts";
import { Subscriptions } from "./subscriptions.ts";
import {
  localViewerId,
  openView,
  viewControls,
  viewer,
  viewerForSpec,
  viewFor,
} from "./viewers.ts";
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
    /** Settles when a full connection drained; `undefined` when it can take more now. */
    drained(session: number): Promise<void> | undefined;
  };
  /** The hosts that always provide the submissions port (`HomeConfig.ports`, D105). */
  readonly expectedHosts: () => readonly string[];
  readonly artifacts: InteractionArtifacts;
  /**
   * Whether a version covers a field ID (D109): from the version's `registry.json`; every ID for
   * a version whose code can use IDs the builder couldn't know.
   */
  readonly coverage: (versionId: string) => (fieldId: string) => boolean;
  /** How long a host has to answer a port call (30 s; tests shorten it). */
  readonly portTimeoutMs?: number;
}

/** A browser session as the interaction core sees it: who it acts as. */
export interface PageIdentity {
  readonly artifactId: string;
  readonly viewerId: string;
  /** The link the page's session came from: a page names only views its own link opened. */
  readonly tokenId?: string;
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
  /** Records a frame load of a version (D104), with the controls in force (D108); returns its ID. */
  openView(input: {
    readonly artifactId: string;
    readonly versionId: string;
    readonly viewerId: string;
    readonly tokenId?: string;
    readonly controls?: ControlsPolicy;
  }): string;
  /** The channels and controls a page's view was opened with (D108). */
  viewControls(page: PageIdentity, viewId: string): ControlsPolicy;

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
  /**
   * The shell's trusted Choose (D65, D113): writes `review.<set>.choice` in the viewer's draft
   * through the `shell` channel, keeping the candidate's label.
   */
  choose(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly mutationId: string;
      readonly baseRevision: number;
      readonly reviewSetId: string;
      readonly candidateId: string;
      readonly label?: string;
    },
  ): MutationResult;
  /** The viewer's draft fields a version doesn't cover (D42, D109). */
  carryOver(
    page: PageIdentity,
    version: { readonly id: string; readonly number: number },
  ): CarryOver;
  /** Whether the viewer follows the artifact's new versions (D63). */
  following(page: PageIdentity): boolean;
  /** Sets the viewer's "Always follow this artifact" (D63, LL-03). */
  setFollowing(page: PageIdentity, follow: boolean): void;
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

/** The number of a version. */
function versionNumber(db: LedgerDb, versionId: string): number {
  const row = db.get<{ number: number }>("SELECT number FROM version WHERE id = ?", versionId);
  if (!row) throw new Error(`No version ${versionId}.`);
  return row.number;
}

/** Whether a page may see an event (D104): never another viewer's draft, signal or view. */
function visibleTo(event: EventRecord, viewerId: string): boolean {
  if (event.type.startsWith("draft.")) return event.payload["viewerId"] === viewerId;
  if (event.type === "signal.raised" || event.type.startsWith("view.")) {
    return event.actor.kind !== "viewer" || event.actor.id === viewerId;
  }
  return true;
}

/**
 * Another viewer as a page sees them: kind and display name, never their viewer or view IDs
 * (D104; Claude review finding 12). The name stays, so a conflict can say who changed a field.
 */
function actorForPage(actor: Actor, viewerId: string): Actor {
  if (actor.kind !== "viewer" || actor.id === viewerId) return actor;
  return { kind: "viewer", ...(actor.name !== undefined ? { name: actor.name } : {}) };
}

/** An event as a page sees it: other viewers' identities left out. */
function eventForPage(event: EventRecord, viewerId: string): EventRecord {
  const own = event.actor.kind !== "viewer" || event.actor.id === viewerId;
  if (own) return event;
  const { viewerId: _viewer, viewId: _view, ...payload } = event.payload as Record<string, unknown>;
  const causation = event.causation
    ? Object.fromEntries(Object.entries(event.causation).filter(([key]) => key !== "viewId"))
    : undefined;
  return {
    ...event,
    actor: actorForPage(event.actor, viewerId),
    ...(causation ? { causation } : {}),
    payload,
  };
}

/** Fields as a page sees them: who last wrote each, without another viewer's ID. */
function fieldsForPage(
  fields: Record<string, FieldState>,
  viewerId: string,
): Record<string, FieldState> {
  return Object.fromEntries(
    Object.entries(fields).map(([id, field]) => [
      id,
      field.updatedBy ? { ...field, updatedBy: actorForPage(field.updatedBy, viewerId) } : field,
    ]),
  );
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
    drained: (session) => hosts.drained(session),
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
    viewControls(page, viewId) {
      return ledger.read((db) =>
        viewControls(viewFor(db, viewId, page.artifactId, page.viewerId, page.tokenId)),
      );
    },

    mutate(page, input) {
      const actor = pageActor(page);
      const outcome = ledger.write((db) => {
        const view = viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
        const mutation = {
          artifactId: page.artifactId,
          scope: input.scope,
          ...(input.scope === "viewer" ? { viewerId: page.viewerId } : {}),
          mutationId: input.mutationId,
          baseRevision: input.baseRevision,
          ops: input.ops,
          actor,
          viewId: input.viewId,
          versionNumber: versionNumber(db, view.version_id),
        };
        // A committed mutation replays its result even after a submission closed the draft (D106):
        // the retry of a save whose answer was lost must not turn into a failure.
        const replay = replayedMutation(db, mutation);
        if (replay) return { result: replay, changed: false, replayed: true };
        if (input.scope === "viewer") {
          assertDraftOpen(db, page.artifactId, page.viewerId);
          // A page's own choice is the artifact channel, which the host may not allow (D108).
          if (input.ops.some((op) => CHOICE.test(op.id))) assertChannel(view, "artifact");
        }
        return applyMutation(db, mutation);
      });
      const result = {
        ...outcome.result,
        conflicts: outcome.result.conflicts.map((conflict) =>
          conflict.updatedBy
            ? { ...conflict, updatedBy: actorForPage(conflict.updatedBy, page.viewerId) }
            : conflict,
        ),
      };
      if (outcome.changed && input.scope === "viewer")
        outbox.mirror(page.artifactId, page.viewerId);
      return result;
    },
    submit(page, input) {
      const owners = outbox.owners();
      const outcome = ledger.write((db) =>
        submit(db, {
          artifactId: page.artifactId,
          viewerId: page.viewerId,
          ...(page.tokenId !== undefined ? { tokenId: page.tokenId } : {}),
          viewId: input.viewId,
          expectedRevision: input.expectedRevision,
          channel: input.channel,
          owners,
          covers: options.coverage,
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
    choose(page, input) {
      const actor = pageActor(page);
      const outcome = ledger.write((db) => {
        const view = viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
        assertChannel(view, "shell");
        const mutation = {
          artifactId: page.artifactId,
          scope: "viewer" as const,
          viewerId: page.viewerId,
          mutationId: input.mutationId,
          baseRevision: input.baseRevision,
          ops: [
            {
              id: `review.${input.reviewSetId}.choice`,
              value: input.candidateId,
              ...(input.label !== undefined ? { label: input.label } : {}),
            },
          ],
          actor,
          viewId: input.viewId,
          versionNumber: versionNumber(db, view.version_id),
          channel: "shell" as const,
        };
        const replay = replayedMutation(db, mutation);
        if (replay) return { result: replay, changed: false, replayed: true };
        assertDraftOpen(db, page.artifactId, page.viewerId);
        return applyMutation(db, mutation);
      });
      if (outcome.changed) outbox.mirror(page.artifactId, page.viewerId);
      return outcome.result;
    },
    carryOver(page, version) {
      const covers = options.coverage(version.id);
      return ledger.read((db) => {
        const draft = documentFor(db, page.artifactId, page.viewerId);
        const rows =
          draft === undefined
            ? []
            : db.all<FieldRow>(
                "SELECT * FROM field WHERE document_id = ? AND deleted = 0 ORDER BY field_id",
                draft.id,
              );
        return { version, orphans: orphansOf(rows.filter((row) => !covers(row.field_id))) };
      });
    },
    following(page) {
      return ledger.read(
        (db) =>
          db.get(
            "SELECT 1 FROM follow WHERE viewer_id = ? AND artifact_id = ?",
            page.viewerId,
            page.artifactId,
          ) !== undefined,
      );
    },
    setFollowing(page, follow) {
      ledger.write((db) => {
        if (follow) {
          db.run(
            "INSERT OR IGNORE INTO follow (viewer_id, artifact_id, followed_at) VALUES (?, ?, ?)",
            page.viewerId,
            page.artifactId,
            new Date().toISOString(),
          );
        } else {
          db.run(
            "DELETE FROM follow WHERE viewer_id = ? AND artifact_id = ?",
            page.viewerId,
            page.artifactId,
          );
        }
      });
    },
    signal(page, input) {
      const actor = pageActor(page);
      return ledger.write((db) => {
        viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
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
      ledger.read((db) => viewFor(db, viewId, page.artifactId, page.viewerId, page.tokenId));
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
          state: (() => {
            const state = documentSnapshot(db, page.artifactId, null);
            return { ...state, fields: fieldsForPage(state.fields, page.viewerId) };
          })(),
          ...(latestOwn ? { submission: submissionSummary(db, latestOwn) } : {}),
          ...(() => {
            // The latest version, so a page that missed its `version.published` learns of it.
            const latest = db.get<{ id: string; number: number }>(
              `SELECT version.id, version.number FROM artifact
                 JOIN version ON version.id = artifact.latest_version_id WHERE artifact.id = ?`,
              page.artifactId,
            );
            return latest ? { latest: { id: latest.id, number: latest.number } } : {};
          })(),
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
            if (visibleTo(event, page.viewerId)) events.push(eventForPage(event, page.viewerId));
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
            ...(params.acceptCompacted ? { acceptCompacted: true } : {}),
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
