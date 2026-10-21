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
  type Batches,
  type CapabilityScope,
  type CarryOver,
  type ControlsPolicy,
  createDiagnostic,
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
  MutationId,
  type MutationResult,
  type Results,
  RpcError,
  type RunState,
  refusal,
  resultsGetMethod,
  type StreamSnapshot,
  type SubmissionSummary,
  type SubmitChannel,
  scopeAllows,
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
import { appendEvent, latestCursor, readEvents } from "./events.ts";
import {
  applyMutation,
  documentFor,
  type FieldRow,
  liveFields,
  replayedMutation,
} from "./fields.ts";
import { type HostConnections, Outbox } from "./outbox.ts";
import { buildResults, CHOICE, resultsMarkdown, submissionFor } from "./results.ts";
import {
  appendRunOutput,
  createOrJoinRun,
  finishRun,
  markRunning,
  openRuns,
  type RunEnd,
  type RunFlush,
  type RunOutput,
  type RunRow,
  runById,
  runByKey,
  runState,
} from "./runs.ts";
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
  viewerForHost,
  viewerForSpec,
  viewFor,
} from "./viewers.ts";
import { waitFor } from "./wait.ts";

export { createEphemeralBus, type EphemeralBus } from "./ephemeral.ts";
export { appendEvent, compactEvents, redactEvents } from "./events.ts";
export type { HostConnections } from "./outbox.ts";
export { policyInForce } from "./policy.ts";
export type { RunEnd, RunFlush, RunOutput, RunRow } from "./runs.ts";
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
  /** The link's scopes (D97): a page writes a review set's choice only with `review`. */
  readonly scopes?: readonly CapabilityScope[];
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
  /** The viewer a host's identity port named (D143 item 2), in a transaction of its own. */
  viewerForHost(spec: ViewerSpec): string;
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

  // ── Actions (WP-08) ──────────────────────────────────────────────────────────────────────
  /** The version a page's view shows: plain calls and runs run there (D104). */
  viewVersion(page: PageIdentity, viewId: string): string;
  /**
   * Records an action run before any worker starts it, or joins the one its key or client key
   * names (AC-03); `started` tells the caller to run it.
   */
  startRun(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly fnId: string;
      readonly args: Batches;
      readonly key?: string;
      readonly clientKey: string;
    },
  ): { readonly state: RunState; readonly row: RunRow; readonly started: boolean };
  /** Runs a page asks for by ID, or by function and key (re-attach, AC-02). */
  runsFor(
    page: PageIdentity,
    input: {
      readonly viewId: string;
      readonly runIds?: readonly string[];
      readonly keyed?: readonly { readonly fnId: string; readonly key: string }[];
      readonly held?: readonly {
        readonly runId: string;
        readonly log: number;
        readonly batches: number;
      }[];
    },
  ): RunState[];
  /** One run of the page's artifact, for a cancel; `MOSTRA_ACTION_RUN_NOT_FOUND` otherwise. */
  runFor(page: PageIdentity, viewId: string, runId: string): RunRow;
  /** A run its worker has. */
  runRunning(runId: string): void;
  /** A run's new log lines, batches and progress. */
  runOutput(runId: string, output: RunOutput): RunFlush | undefined;
  /** Ends a run with its event. */
  endRun(runId: string, end: RunEnd): RunState | undefined;
  /** The runs not yet ended, optionally of one version. */
  openRuns(versionId?: string): RunRow[];
  /** A run's state now. */
  runState(runId: string): RunState | undefined;
  /** `signal()` from server code: `signal.raised`, source `action`, the run as cause (AC-05). */
  serverSignal(
    artifactId: string,
    input: {
      readonly name: string;
      readonly payload?: unknown;
      readonly runId?: string;
      readonly viewerId?: string;
    },
  ): string;
  /** `emit()` from server code: a `host.<name>` event (AC-05). */
  serverEmit(
    artifactId: string,
    input: {
      readonly type: string;
      readonly payload?: unknown;
      readonly runId?: string;
      readonly viewerId?: string;
    },
  ): string;
  /** The artifact state, for `state.get` in server code. */
  serverState(
    artifactId: string,
    ids?: readonly string[],
  ): { revision: string; fields: Record<string, FieldState> };
  /** A state write from server code, as the agent (D63). */
  serverPatch(
    artifactId: string,
    input: {
      readonly ops: readonly FieldOp[];
      readonly mutationId?: string;
      readonly baseRevision?: string;
      readonly runId?: string;
    },
  ): MutationResult;
  /** The artifacts a host subscription names, whose live producers it keeps running. */
  subscribedArtifacts(): Set<string>;
  /** Appends `worker.crashed` (DATA_MODEL §4, RT-04): the version, the cause, the backoff. */
  workerCrashed(crash: {
    readonly artifactId: string;
    readonly versionId: string;
    readonly cause: string;
    readonly kind: string;
    readonly backoffMs: number;
    readonly parked: boolean;
  }): string;
  /** Hears every `version.published` once it commits, by artifact; returns the stop. */
  onPublished(listener: (artifactId: string, versionId: string) => void): () => void;
  /**
   * Hears every submission once it commits, with its Results (INTERFACES §8): how a `mostra dev`
   * session reports what its preview's submits would deliver (D140 item 12). Returns the stop.
   */
  onSubmission(listener: (results: Results) => void): () => void;
  /** How many host subscriptions are open. */
  subscriptionCount(): number;
}

function runNotFound(runId: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_ACTION_RUN_NOT_FOUND", {
      message: `This artifact has no action run ${String(runId).slice(0, 64)}.`,
    }),
  );
}

/** The number of a version. */
function versionNumber(db: LedgerDb, versionId: string): number {
  const row = db.get<{ number: number }>("SELECT number FROM version WHERE id = ?", versionId);
  if (!row) throw new Error(`No version ${versionId}.`);
  return row.number;
}

/**
 * Whether a page may see an event (D104, D130): never another viewer's draft, signal or view;
 * server code's signals only by the viewer whose call raised them; `host.*` events never (they
 * are for hosts, AC-05); an action's run events only through a link that may see its run.
 * `run` looks a run up by its ID.
 */
function visibleTo(
  event: EventRecord,
  page: PageIdentity,
  run: (runId: string) => RunRow | undefined,
): boolean {
  const viewerId = page.viewerId;
  if (event.type.startsWith("draft.")) return event.payload["viewerId"] === viewerId;
  if (event.type.startsWith("host.")) return false;
  if (event.type.startsWith("action.")) {
    const row = run(String(event.payload["runId"] ?? ""));
    return row !== undefined && runVisible(row, page);
  }
  if (event.type === "signal.raised" && event.payload["source"] === "action") {
    return event.payload["viewerId"] === viewerId;
  }
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
  // A worker's crash shows a page only what the shell's notice needs: never the server code's
  // own output, which its cause quotes (Opus review 4).
  if (event.type === "worker.crashed") {
    const { cause: _cause, ...payload } = event.payload as Record<string, unknown>;
    return { ...event, payload };
  }
  if (event.type.startsWith("action.") || event.type === "signal.raised") {
    // A run's or a signal's own viewer: a page sees only its own runs' viewer, so leave it out.
    const { viewerId: _viewer, ...payload } = event.payload as Record<string, unknown>;
    if (event.actor.kind !== "viewer") return { ...event, payload };
  }
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

/**
 * Whether a page may see a run (D97 item 4, D104, D130): only through a link that may run its
 * function, and then a keyed run belongs to the artifact, since its key makes it one invocation
 * for everyone who may run it, while a run without a key is its viewer's own.
 */
function runVisible(row: RunRow, page: PageIdentity): boolean {
  if (!scopeAllows(page.scopes ?? [], `action:${row.action}` as CapabilityScope)) return false;
  return row.key !== null || row.viewer_id === page.viewerId;
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
    viewerForHost: (spec) => ledger.write((db) => viewerForHost(db, spec)),
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
          if (input.ops.some((op) => CHOICE.test(op.id))) {
            // A choice needs the `review` scope however it is written, as the trusted Choose
            // does (D97; Claude review finding 7)…
            if (page.scopes !== undefined && !scopeAllows(page.scopes, "review")) {
              throw new RpcError(
                refusal("MOSTRA_HYGIENE_SCOPE_DENIED", "This link doesn't carry the review scope.")
                  .diagnostic,
              );
            }
            // …and a page's own choice is the artifact channel, which the host may not allow (D108).
            assertChannel(view, "artifact");
          }
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
      // Read again after the commit: the outbox's first step runs on commit and may already have
      // marked a delivery waiting, which the answer must not contradict (Claude review finding 8).
      const fresh = ledger.read((db) => {
        const row = db.get<SubmissionRow>(
          "SELECT * FROM submission WHERE id = ?",
          outcome.submission.id,
        );
        return row ? submissionSummary(db, row) : undefined;
      });
      if (!fresh) return outcome.submission;
      return outcome.submission.duplicate ? { ...fresh, duplicate: true } : fresh;
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
        const runs = new Map<string, RunRow | undefined>();
        const runOf = (runId: string): RunRow | undefined => {
          if (!runs.has(runId)) runs.set(runId, runById(db, page.artifactId, runId));
          return runs.get(runId);
        };
        for (;;) {
          const read = readEvents(db, {
            filter: { artifacts: [page.artifactId] },
            after: cursor,
            limit,
          });
          for (const event of read.events) {
            if (events.length === limit) return { events, cursor: String(cursor) };
            cursor = Number(event.cursor);
            if (visibleTo(event, page, runOf)) events.push(eventForPage(event, page.viewerId));
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

    viewVersion(page, viewId) {
      return ledger.read(
        (db) => viewFor(db, viewId, page.artifactId, page.viewerId, page.tokenId).version_id,
      );
    },
    startRun(page, input) {
      const actor = pageActor(page);
      return ledger.write((db) => {
        const view = viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
        const { row, joined } = createOrJoinRun(db, {
          artifactId: page.artifactId,
          versionId: view.version_id,
          viewId: view.id,
          viewerId: page.viewerId,
          fnId: input.fnId,
          args: input.args,
          ...(input.key !== undefined ? { key: input.key } : {}),
          clientKey: input.clientKey,
          actor,
        });
        // A joined run is shown only to a link that may see it (D130): the scope was checked for
        // the function asked, and the run joined is of that function, but say so here too.
        if (joined && !runVisible(row, page)) throw runNotFound(row.id);
        return { row, state: runState(db, row, joined), started: !joined };
      });
    },
    runsFor(page, input) {
      return ledger.read((db) => {
        viewFor(db, input.viewId, page.artifactId, page.viewerId, page.tokenId);
        const rows = new Map<string, RunRow>();
        for (const runId of input.runIds ?? []) {
          const row = runById(db, page.artifactId, runId);
          if (row && runVisible(row, page)) rows.set(row.id, row);
        }
        for (const entry of input.keyed ?? []) {
          const row = runByKey(db, page.artifactId, entry.fnId, entry.key);
          if (row && runVisible(row, page)) rows.set(row.id, row);
        }
        const held = new Map((input.held ?? []).map((entry) => [entry.runId, entry]));
        return [...rows.values()].map((row) => runState(db, row, undefined, held.get(row.id)));
      });
    },
    runFor(page, viewId, runId) {
      return ledger.read((db) => {
        viewFor(db, viewId, page.artifactId, page.viewerId, page.tokenId);
        const row = runById(db, page.artifactId, runId);
        if (!row || !runVisible(row, page)) throw runNotFound(runId);
        return row;
      });
    },
    runRunning(runId) {
      ledger.write((db) => markRunning(db, runId));
    },
    runOutput(runId, output) {
      return ledger.write((db) => appendRunOutput(db, runId, output));
    },
    endRun(runId, end) {
      return ledger.write((db) => {
        const row = finishRun(db, runId, end);
        return row ? runState(db, row) : undefined;
      });
    },
    openRuns(versionId) {
      return ledger.read((db) => openRuns(db, versionId));
    },
    runState(runId) {
      return ledger.read((db) => {
        const row = db.get<RunRow>("SELECT * FROM action_run WHERE id = ?", runId);
        return row ? runState(db, row) : undefined;
      });
    },
    serverSignal(artifactId, input) {
      return ledger.write((db) =>
        raiseSignal(db, {
          artifactId,
          name: input.name,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
          source: "action",
          actor: { kind: "agent" },
          // No view: a page never learns another viewer's view from an action's signal (D104).
          // The viewer whose call raised it decides which page may see it.
          ...(input.viewerId !== undefined ? { viewerId: input.viewerId } : {}),
          ...(input.runId !== undefined ? { causation: { runId: input.runId } } : {}),
        }),
      );
    },
    serverEmit(artifactId, input) {
      return ledger.write((db) =>
        appendEvent(db, {
          artifactId,
          type: input.type,
          actor: { kind: "agent" },
          ...(input.runId !== undefined ? { causation: { runId: input.runId } } : {}),
          payload: {
            ...(input.payload === undefined ? {} : { data: input.payload }),
            ...(input.viewerId !== undefined ? { viewerId: input.viewerId } : {}),
          },
        }),
      );
    },
    serverState(artifactId, ids) {
      return ledger.read((db) => {
        const snapshot = documentSnapshot(db, artifactId, null);
        const fields =
          ids === undefined
            ? snapshot.fields
            : Object.fromEntries(
                Object.entries(snapshot.fields).filter(([id]) => ids.includes(id)),
              );
        return { revision: snapshot.revision, fields };
      });
    },
    serverPatch(artifactId, input) {
      return ledger.write(
        (db) =>
          applyMutation(db, {
            artifactId,
            scope: "artifact",
            mutationId: input.mutationId ?? MutationId.create(),
            ...(input.baseRevision !== undefined
              ? { baseRevision: Number(input.baseRevision) }
              : {}),
            ops: input.ops,
            actor: { kind: "agent", ...(input.runId !== undefined ? { id: input.runId } : {}) },
          }).result,
      );
    },
    subscribedArtifacts: () => subscriptions.subscribedArtifacts(),
    workerCrashed(crash) {
      return ledger.write((db) =>
        appendEvent(db, {
          artifactId: crash.artifactId,
          type: "worker.crashed",
          actor: { kind: "mostra" },
          payload: {
            versionId: crash.versionId,
            cause: crash.cause,
            kind: crash.kind,
            backoffMs: crash.backoffMs,
            parked: crash.parked,
          },
        }),
      );
    },
    onSubmission(listener) {
      let position = ledger.read(
        (db) =>
          db.get<{ last: number | null }>("SELECT MAX(position) AS last FROM submission")?.last ??
          0,
      );
      return ledger.onCommit(() => {
        const made = ledger.read((db) =>
          db
            .all<SubmissionRow>(
              "SELECT * FROM submission WHERE position > ? ORDER BY position",
              position,
            )
            .map((row) => ({ position: row.position, results: buildResults(db, row) })),
        );
        for (const { position: at, results } of made) {
          position = at;
          listener(results);
        }
      });
    },
    onPublished(listener) {
      let cursor = ledger.read((db) => latestCursor(db));
      return ledger.onCommit(() => {
        const published = ledger.read((db) =>
          db.all<{ cursor: number; artifact_id: string; payload_json: string }>(
            "SELECT cursor, artifact_id, payload_json FROM event WHERE cursor > ? AND type = 'version.published' ORDER BY cursor",
            cursor,
          ),
        );
        cursor = ledger.read((db) => latestCursor(db));
        for (const row of published) {
          const { versionId } = JSON.parse(row.payload_json) as { versionId: string };
          listener(row.artifact_id, versionId);
        }
      });
    },
    subscriptionCount: () => subscriptions.size,
  };
}
