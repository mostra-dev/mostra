/**
 * What the shell knows about the view it shows (WP-07): the viewer's draft as the gateway has it
 * (from the shell's own event stream, never from the frame), the submission and its deliveries,
 * the latest version, and what the frame reported over the bridge (mounted fields, save state,
 * requested controls, the page). The trusted controls decide from it; the frame can only ask.
 */
import type {
  ControlRequest,
  EventRecord,
  FieldRegistration,
  FrameTicket,
  SaveState,
  StreamSnapshot,
  SubmissionSummary,
  SubmitBlocker,
  Viewer,
} from "@mostra/protocol";

/** A review set's trusted Choose, as the frame asked for it (D113). */
export interface ChooseRequest {
  readonly reviewSetId: string;
  readonly candidates: readonly { readonly id: string; readonly label?: string }[];
  readonly current?: string;
}

/** The shell's state for one view. */
export interface ViewState {
  readonly ticket: FrameTicket;
  /** Whether the shell's event stream is connected. */
  readonly online: boolean;
  readonly viewer?: Viewer;
  /** The draft revision the shell's stream reached. */
  readonly revision: number;
  readonly epoch: number;
  /** The draft's fields: whether each holds a value, and the value where events carry it. */
  readonly draft: ReadonlyMap<string, { readonly value: unknown; readonly known: boolean }>;
  readonly submission?: SubmissionSummary;
  /** Whether a `once` submission closed the draft (D106). */
  readonly closed: boolean;
  /** The artifact's newest version. */
  readonly latest: { readonly id: string; readonly number: number };
  /** What the frame reported (`mostra/fields`). */
  readonly fields: readonly FieldRegistration[];
  readonly save: SaveState;
  readonly unsaved: boolean;
  /** The trusted Submit's label and confirmation, as the frame asked (`mostra/controls.request`). */
  readonly submitLabel?: string;
  readonly submitConfirm?: string;
  readonly chooses: ReadonlyMap<string, ChooseRequest>;
  /** The page the viewer is on (`mostra/page`). */
  readonly page?: string;
}

/** The first state of a view, from its ticket. */
export function initialState(ticket: FrameTicket): ViewState {
  return {
    ticket,
    online: false,
    revision: 0,
    epoch: 1,
    draft: new Map(),
    closed: false,
    latest: ticket.latest,
    fields: [],
    save: "saved",
    unsaved: false,
    chooses: new Map(),
  };
}

/** Whether a value counts as missing for a required field (as the client runtime counts it). */
export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Whether a submission closes this viewer's draft: under `once`, anyone's or (per viewer) their own. */
function closesDraft(state: ViewState, own: boolean): boolean {
  const policy = state.ticket.policy;
  if (policy.policy !== "once") return false;
  return policy.scope !== "per-viewer" || own;
}

/**
 * Applies the stream's snapshot. One read before events the shell already applied (a resync that
 * answered late) keeps the newer draft; a version the shell hadn't heard of is taken from it
 * (GPT review finding 13).
 */
export function withSnapshot(state: ViewState, snapshot: StreamSnapshot): ViewState {
  const latest =
    snapshot.latest !== undefined && snapshot.latest.number > state.latest.number
      ? { latest: snapshot.latest }
      : {};
  const submission = snapshot.submission;
  if (Number(snapshot.draft.revision) < state.revision) {
    return { ...state, ...latest, ...(submission ? { submission } : {}) };
  }
  const draft = new Map(
    Object.entries(snapshot.draft.fields).map(([id, field]) => [
      id,
      { value: field.value, known: true },
    ]),
  );
  const sameEpoch = submission !== undefined && submission.epoch === snapshot.draft.epoch;
  return {
    ...state,
    ...latest,
    viewer: snapshot.viewer,
    revision: Number(snapshot.draft.revision),
    epoch: snapshot.draft.epoch,
    draft,
    ...(submission ? { submission } : {}),
    closed: submission !== undefined && sameEpoch && closesDraft(state, true),
  };
}

const DELIVERY_EVENTS: Readonly<Record<string, SubmissionSummary["delivery"]>> = {
  "submission.delivered": "delivered",
  "submission.rejected": "rejected",
  "submission.undeliverable": "undeliverable",
  "submission.retrying": "pending",
};

const SEVERITY = { delivered: 0, pending: 1, rejected: 2, undeliverable: 3 } as const;

/** Applies durable events from the stream, in order. */
export function withEvents(state: ViewState, events: readonly EventRecord[]): ViewState {
  let next = state;
  for (const event of events) {
    if (event.type === "draft.changed") {
      const payload = event.payload as {
        revision: string;
        epoch?: number;
        changes: { id: string; value?: unknown; deleted?: true; sensitive?: true }[];
      };
      const draft = new Map(next.draft);
      for (const change of payload.changes) {
        if (change.deleted) draft.delete(change.id);
        else if (change.sensitive) draft.set(change.id, { value: undefined, known: false });
        else draft.set(change.id, { value: change.value, known: true });
      }
      next = {
        ...next,
        draft,
        revision: Math.max(next.revision, Number(payload.revision)),
        epoch: Math.max(next.epoch, payload.epoch ?? next.epoch),
      };
    } else if (event.type === "version.published") {
      const payload = event.payload as { versionId: string; number: number };
      if (payload.number > next.latest.number) {
        next = { ...next, latest: { id: payload.versionId, number: payload.number } };
      }
    } else if (event.type === "submission.created") {
      const payload = event.payload as { submissionId: string; viewerId?: string };
      const own = payload.viewerId !== undefined && payload.viewerId === next.viewer?.id;
      if (closesDraft(next, own)) next = { ...next, closed: true };
    } else if (event.type in DELIVERY_EVENTS && next.submission) {
      const payload = event.payload as {
        submissionId: string;
        deliveryId: string;
        reason?: string;
        attempts?: number;
      };
      const submission = next.submission;
      if (payload.submissionId !== submission.id) continue;
      const state = DELIVERY_EVENTS[event.type] as SubmissionSummary["delivery"];
      const deliveries = (submission.deliveries ?? []).map((delivery) =>
        delivery.deliveryId === payload.deliveryId
          ? {
              ...delivery,
              state,
              ...(event.type === "submission.retrying" ? { waiting: true as const } : {}),
              ...(payload.reason !== undefined && event.type !== "submission.retrying"
                ? { reason: payload.reason }
                : {}),
              updatedAt: event.at,
            }
          : delivery,
      );
      let worst: SubmissionSummary["delivery"] = "delivered";
      for (const delivery of deliveries)
        if (SEVERITY[delivery.state] > SEVERITY[worst]) worst = delivery.state;
      next = { ...next, submission: { ...submission, deliveries, delivery: worst } };
    }
  }
  return next;
}

/** Applies a submission the shell made or was told of. */
export function withSubmission(state: ViewState, submission: SubmissionSummary): ViewState {
  return {
    ...state,
    submission,
    closed: state.closed || closesDraft(state, true),
  };
}

/** Applies a control request from the frame; returns the state and whether the control shows. */
export function withControlRequest(
  state: ViewState,
  request: ControlRequest,
): { readonly state: ViewState; readonly shown: boolean } {
  const allowed = state.ticket.controls;
  if (request.control === "submit") {
    const shown = showsSubmit(state);
    return {
      state: {
        ...state,
        ...(request.label !== undefined ? { submitLabel: request.label } : {}),
        ...(request.confirm !== undefined ? { submitConfirm: request.confirm } : {}),
      },
      shown,
    };
  }
  if (request.control === "choose") {
    const chooses = new Map(state.chooses);
    chooses.set(request.reviewSetId, request);
    return {
      state: { ...state, chooses },
      shown: allowed.includes("choose") && state.ticket.submitChannels.includes("shell"),
    };
  }
  const chooses = new Map(state.chooses);
  if (request.reviewSetId !== undefined) chooses.delete(request.reviewSetId);
  const { submitLabel: _label, submitConfirm: _confirm, ...rest } = state;
  return { state: request.submit ? { ...rest, chooses } : { ...state, chooses }, shown: false };
}

/**
 * Whether the trusted Submit shows (D63, D108): never under policy `none`, never where the host
 * leaves the shell channel or the `submit` control out.
 */
export function showsSubmit(state: ViewState): boolean {
  const ticket = state.ticket;
  return (
    ticket.policy.policy !== "none" &&
    ticket.submitChannels.includes("shell") &&
    ticket.controls.includes("submit")
  );
}

/** Whether the trusted Choose shows for review sets (D108). */
export function showsChoose(state: ViewState): boolean {
  return state.ticket.controls.includes("choose") && state.ticket.submitChannels.includes("shell");
}

/**
 * What blocks the trusted Submit: required fields the gateway's draft doesn't hold, checked by
 * the shell itself (D106), and whatever the frame reported (invalid values, open conflicts,
 * required fields it sees empty), each once, in field order.
 */
export function blockers(state: ViewState, reported: readonly SubmitBlocker[]): SubmitBlocker[] {
  const found = new Map<string, SubmitBlocker>();
  for (const field of state.fields) {
    if (!field.required || field.scope !== "viewer") continue;
    const stored = state.draft.get(field.id);
    if (stored === undefined || (stored.known && isEmpty(stored.value))) {
      found.set(field.id, {
        fieldId: field.id,
        ...(field.label !== undefined ? { label: field.label } : {}),
        reason: "required",
      });
    }
  }
  for (const blocker of reported)
    if (!found.has(blocker.fieldId)) found.set(blocker.fieldId, blocker);
  return [...found.values()].sort((a, b) => (a.fieldId < b.fieldId ? -1 : 1));
}

/** The viewer's choice of a review set, from the draft (`review.<set>.choice`, D65). */
export function choiceOf(state: ViewState, reviewSetId: string): string | undefined {
  const value = state.draft.get(`review.${reviewSetId}.choice`)?.value;
  return typeof value === "string" ? value : undefined;
}

/** What the viewer sees of the submission (IN-13, D47). */
export type DeliveryView =
  | { readonly kind: "submitted" }
  | { readonly kind: "delivered"; readonly hosts: readonly string[] }
  | { readonly kind: "pending"; readonly hosts: readonly string[] }
  | { readonly kind: "undeliverable"; readonly host: string; readonly reason?: string };

/** The submission's delivery as the viewer sees it: a host's state wins over Mostra's own. */
export function deliveryView(submission: SubmissionSummary): DeliveryView {
  const hosts = (submission.deliveries ?? []).filter((delivery) => delivery.owner !== "");
  const failed = hosts.find(
    (delivery) => delivery.state === "undeliverable" || delivery.state === "rejected",
  );
  if (failed) {
    return {
      kind: "undeliverable",
      host: failed.owner,
      ...(failed.reason !== undefined ? { reason: failed.reason } : {}),
    };
  }
  const waiting = hosts.filter((delivery) => delivery.state === "pending" && delivery.waiting);
  if (waiting.length > 0) return { kind: "pending", hosts: waiting.map((d) => d.owner) };
  if (hosts.length > 0 && hosts.every((delivery) => delivery.state === "delivered")) {
    return { kind: "delivered", hosts: hosts.map((d) => d.owner) };
  }
  return { kind: "submitted" };
}

/** What the frame's page is: loading, a client runtime (WP-07), or a version built before it. */
export type FrameKind = "loading" | "runtime" | "legacy";

/**
 * The draft revision the trusted Submit names, or why it can't submit now. A runtime page must
 * confirm it saved everything (`mostra/flush`), and the revision is the one it confirmed it shows:
 * a newer one only the shell's stream has met is refused by the gateway as moved, so nothing the
 * viewer hasn't seen is submitted (GPT review findings 2 and 3). A legacy page, which saves on its
 * own and answers nothing, shows the draft the shell's stream has.
 */
export function submitRevision(
  kind: FrameKind,
  flushed: { readonly revision: string } | undefined,
  streamRevision: number,
): { readonly revision: number } | { readonly problem: "NOT_READY" | "NO_ANSWER" } {
  if (kind === "loading") return { problem: "NOT_READY" };
  if (flushed !== undefined) return { revision: Number(flushed.revision) };
  if (kind === "runtime") return { problem: "NO_ANSWER" };
  return { revision: streamRevision };
}
