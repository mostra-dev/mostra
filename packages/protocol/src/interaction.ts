/**
 * The interaction ledger's wire types (INTERFACES §4, §6, §7, §8; DATA_MODEL §3, §4): viewers,
 * fields and their mutations, events and their filters, `wait` conditions, submissions, deliveries
 * and results. The host protocol methods (`state/*`, `results/get`, `wait`, `events/*`), the
 * submissions and drafts ports, and the browser protocol all speak these shapes.
 */
import * as z from "zod";
import {
  ArtifactId,
  Cursor,
  DeliveryId,
  SubmissionId,
  VersionId,
  ViewerId,
  ViewId,
} from "./ids.ts";
import { ArtifactLink, SubmissionPolicy } from "./manifest.ts";
import { wireRegistry } from "./wire-registry.ts";

// ── Viewers and actors ────────────────────────────────────────────────────────────────────

/** How Mostra knows a viewer (DATA_MODEL §3 `viewer.kind`). */
export type ViewerKind = "local" | "tailnet" | "token" | "host";

/**
 * A person who views an artifact (PRODUCT vocabulary). The home's local user is one viewer of kind
 * `local`; a link minted with `viewer` acts as a viewer of kind `token` (D104).
 */
export interface Viewer {
  /** The viewer's ID. */
  readonly id: string;
  /** How Mostra knows the viewer. */
  readonly kind: ViewerKind;
  /** The display name, when one is known. */
  readonly name?: string;
  /** The host's own key for this person, as given to `view/url` (D104). */
  readonly ref?: string;
}

/** The Zod schema of the `Viewer` type. */
export const Viewer: z.ZodType<Viewer> = z
  .object({
    id: ViewerId.schema,
    kind: z.enum(["local", "tailnet", "token", "host"]),
    name: z.string().exactOptional(),
    ref: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "Viewer",
    description: "A person who views an artifact: ID, kind, display name and the host's own key.",
  });

/**
 * The person a capability link acts for (`view/url`'s `viewer`, D104): the host's stable key for
 * them, such as an email or an account ID, and a display name.
 */
export interface ViewerSpec {
  /** The host's stable key for this person: the same `ref` always names the same viewer. */
  readonly ref: string;
  /** The name people see; updated when given again. */
  readonly name?: string;
}

/** The Zod schema of the `ViewerSpec` type. */
export const ViewerSpec: z.ZodType<ViewerSpec> = z
  .object({
    ref: z.string().min(1).max(256),
    name: z.string().min(1).max(256).exactOptional(),
  })
  .register(wireRegistry, {
    id: "ViewerSpec",
    description: "The person a capability link acts for: the host's stable key and a display name.",
  });

/** Who caused an event or wrote a field (DATA_MODEL §4). */
export interface Actor {
  /** Who: a viewer, an agent (a protocol client), a host, or Mostra itself. */
  readonly kind: "viewer" | "agent" | "host" | "mostra";
  /** A viewer's ID, or the protocol client's name for agents and hosts. */
  readonly id?: string;
  /** A display name, when one is known. */
  readonly name?: string;
}

/** The Zod schema of the `Actor` type. */
export const Actor: z.ZodType<Actor> = z
  .object({
    kind: z.enum(["viewer", "agent", "host", "mostra"]),
    id: z.string().exactOptional(),
    name: z.string().exactOptional(),
  })
  .register(wireRegistry, {
    id: "Actor",
    description: "Who caused an event or wrote a field: a viewer, an agent, a host or Mostra.",
  });

// ── Fields and mutations ──────────────────────────────────────────────────────────────────

/** The longest field ID, in UTF-16 code units. */
export const FIELD_ID_MAX_LENGTH = 256;

/**
 * Whether `id` is a field ID (D52): 1 to 256 characters without control characters; dots separate
 * the parts that nest in results, so none is empty.
 */
export function isFieldId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length >= 1 &&
    id.length <= FIELD_ID_MAX_LENGTH &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
    !/[\u0000-\u001f\u007f]/.test(id) &&
    !id.split(".").includes("")
  );
}

/** Which document a field belongs to: the viewer's draft, or the artifact's shared state (D63). */
export type FieldScope = "viewer" | "artifact";

/**
 * A document revision: the decimal string of a document's monotonic counter (DATA_MODEL §3).
 * `"0"` is a document nothing has written yet.
 */
export type DocumentRevision = string;

/** The Zod schema of the `DocumentRevision` type. */
export const DocumentRevision: z.ZodType<DocumentRevision> = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})$/)
  .register(wireRegistry, {
    id: "DocumentRevision",
    description: "A draft's or artifact state's revision: a non-negative decimal integer string.",
  });

/**
 * One change to one field. Exactly one of `value` and `delete` is given. The optional metadata
 * travels with the field into results and decides what events redact (D52, D106).
 */
export interface FieldOp {
  /** The field ID (D52). */
  readonly id: string;
  /** The new value: any JSON value, `null` included. */
  readonly value?: unknown;
  /** Removes the field. */
  readonly delete?: true;
  /** The label people see in results and the shell's blocker list. */
  readonly label?: string;
  /** Whether the shell asks for it before submit. */
  readonly required?: boolean;
  /** Kept in submissions and results, redacted from events and logs (D52). */
  readonly sensitive?: boolean;
}

/** The Zod schema of the `FieldOp` type. */
export const FieldOp: z.ZodType<FieldOp> = z
  .object({
    id: z.string().min(1).max(FIELD_ID_MAX_LENGTH),
    value: z.unknown().exactOptional(),
    delete: z.literal(true).exactOptional(),
    label: z.string().max(1024).exactOptional(),
    required: z.boolean().exactOptional(),
    sensitive: z.boolean().exactOptional(),
  })
  .register(wireRegistry, {
    id: "FieldOp",
    description:
      "One change to one field: a value or a delete, with optional label, required and sensitive.",
  }) as z.ZodType<FieldOp>;

/** A field's current state. */
export interface FieldState {
  /** The field's value: any JSON value. */
  readonly value: unknown;
  /** The document revision that last wrote it. */
  readonly revision: DocumentRevision;
  /** Who wrote it last. */
  readonly updatedBy?: Actor;
  /** When it was written last. */
  readonly updatedAt: string;
  /** The label people see. */
  readonly label?: string;
  /** Whether the shell asks for it before submit. */
  readonly required?: boolean;
  /** Whether events and logs redact its value (D52). */
  readonly sensitive?: boolean;
}

/** The Zod schema of the `FieldState` type. */
export const FieldState: z.ZodType<FieldState> = z
  .object({
    value: z.unknown(),
    revision: DocumentRevision,
    updatedBy: Actor.exactOptional(),
    updatedAt: z.iso.datetime(),
    label: z.string().exactOptional(),
    required: z.boolean().exactOptional(),
    sensitive: z.boolean().exactOptional(),
  })
  .register(wireRegistry, {
    id: "FieldState",
    description: "A field's current value, the revision that wrote it, who wrote it and when.",
  }) as z.ZodType<FieldState>;

/**
 * A field op that wasn't applied because the field changed after the mutation's base revision
 * (D22, FAILURE_MODEL §5): what the field holds now, so the writer can keep theirs or take it.
 */
export interface FieldConflict {
  /** The field's ID. */
  readonly id: string;
  /** The revision that last changed the field. */
  readonly revision: DocumentRevision;
  /** Its current value; absent when it was deleted. */
  readonly value?: unknown;
  /** `true` when the field was deleted. */
  readonly deleted?: true;
  /** Who changed it. */
  readonly updatedBy?: Actor;
  /** When it changed. */
  readonly updatedAt?: string;
}

/** The Zod schema of the `FieldConflict` type. */
export const FieldConflict: z.ZodType<FieldConflict> = z
  .object({
    id: z.string(),
    revision: DocumentRevision,
    value: z.unknown().exactOptional(),
    deleted: z.literal(true).exactOptional(),
    updatedBy: Actor.exactOptional(),
    updatedAt: z.iso.datetime().exactOptional(),
  })
  .register(wireRegistry, {
    id: "FieldConflict",
    description: "A field op not applied because the field changed after the base revision.",
  }) as z.ZodType<FieldConflict>;

/** What a mutation did: the document's revision after it, the ops applied, and the conflicts. */
export interface MutationResult {
  /** The document's revision after the mutation; unchanged when nothing applied. */
  readonly revision: DocumentRevision;
  /** The field IDs whose ops were applied. */
  readonly applied: readonly string[];
  /** The ops not applied, with what each field holds now. */
  readonly conflicts: readonly FieldConflict[];
}

/** The Zod schema of the `MutationResult` type. */
export const MutationResult: z.ZodType<MutationResult> = z
  .object({
    revision: DocumentRevision,
    applied: z.array(z.string()).readonly(),
    conflicts: z.array(FieldConflict).readonly(),
  })
  .register(wireRegistry, {
    id: "MutationResult",
    description:
      "A mutation's outcome: the revision after it, the applied field IDs, the conflicts.",
  });

// ── Events ────────────────────────────────────────────────────────────────────────────────

/**
 * One durable event (DATA_MODEL §4). Its cursor is its stable ID and its place in the home-wide
 * order; `seq` orders an artifact's own events without gaps.
 */
export interface EventRecord {
  /** The event's stable ID and home-wide position. */
  readonly cursor: Cursor;
  /** The artifact, or `null` for a home-wide event. */
  readonly artifactId: string | null;
  /** The artifact's sequence number, or `null` for a home-wide event. */
  readonly seq: number | null;
  /** The type from DATA_MODEL §4's catalog. */
  readonly type: string;
  /** When it was appended. */
  readonly at: string;
  /** Who caused it. */
  readonly actor: Actor;
  /** What caused it: a run, a mutation, a submission. */
  readonly causation?: Readonly<Record<string, string>>;
  /** The event's data; sensitive field values are redacted (D52). */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The Zod schema of the `EventRecord` type. */
export const EventRecord: z.ZodType<EventRecord> = z
  .object({
    cursor: Cursor.schema,
    artifactId: ArtifactId.schema.nullable(),
    seq: z.int().min(1).nullable(),
    type: z.string(),
    at: z.iso.datetime(),
    actor: Actor,
    causation: z.record(z.string(), z.string()).exactOptional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .register(wireRegistry, {
    id: "EventRecord",
    description:
      "One durable event: cursor, artifact, per-artifact sequence, type, time, actor, payload.",
  }) as z.ZodType<EventRecord>;

/**
 * An event type, or a family of them: `submission.created`, or `submission.*` for every type that
 * starts with `submission.`.
 */
export type EventTypePattern = string;

/** The Zod schema of the `EventTypePattern` type. */
export const EventTypePattern: z.ZodType<EventTypePattern> = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)*(\.\*)?$/)
  .register(wireRegistry, {
    id: "EventTypePattern",
    description: "An event type (submission.created) or a family of them (submission.*).",
  });

/**
 * Which events a reader wants (IN-08, H-09). Both parts are optional, and an event must pass both.
 * `artifact.compacted` always passes for a matching artifact, so a filtered reader still learns of
 * a compaction (DATA_MODEL §4).
 */
export interface EventFilter {
  /** Only these artifacts' events; absent: every artifact's, and home-wide ones. */
  readonly artifacts?: readonly string[];
  /** Only these types; absent: every type. */
  readonly types?: readonly EventTypePattern[];
}

/** The Zod schema of the `EventFilter` type. */
export const EventFilter: z.ZodType<EventFilter> = z
  .object({
    artifacts: z.array(ArtifactId.schema).max(1000).readonly().exactOptional(),
    types: z.array(EventTypePattern).max(100).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "EventFilter",
    description:
      "Which events a reader wants: these artifacts' and these types (patterns allowed).",
  });

/**
 * What `wait` waits for (ARCHITECTURE §6, D103): `submitted`, `signal:<name>`, `state:<fieldId>`
 * or `event:<type pattern>`.
 */
export type WaitCondition = string;

/** A signal's name: letters, digits, `.`, `_` and `-`, starting with a letter or digit (D106). */
export const SIGNAL_NAME_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The Zod schema of the `WaitCondition` type. */
export const WaitCondition: z.ZodType<WaitCondition> = z
  .string()
  .regex(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: field IDs exclude control characters.
    /^(submitted|signal:[A-Za-z0-9][A-Za-z0-9._-]{0,63}|state:[^\u0000-\u001f\u007f]{1,256}|event:[a-z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)*(\.\*)?)$/,
  )
  .register(wireRegistry, {
    id: "WaitCondition",
    description: "What wait waits for: submitted, signal:<name>, state:<fieldId> or event:<type>.",
  });

// ── Submissions, deliveries and results ──────────────────────────────────────────────────

/** Where a submit came from (D40). */
export type SubmitChannel = "shell" | "artifact";

/** The Zod schema of the `SubmitChannel` type. */
export const SubmitChannel: z.ZodType<SubmitChannel> = z
  .enum(["shell", "artifact"])
  .register(wireRegistry, {
    id: "SubmitChannel",
    description: "Where a submit comes from: the shell's trusted Submit, or the artifact's code.",
  });

/**
 * A trusted control the shell renders outside the artifact's frame (D06, PRODUCT vocabulary):
 * Submit, Choose (review sets) and Approve. Open for later controls on the wire.
 */
export type TrustedControl = "submit" | "choose" | "approve" | (string & {});

/** The Zod schema of the `TrustedControl` type. */
export const TrustedControl: z.ZodType<TrustedControl> = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/)
  .register(wireRegistry, {
    id: "TrustedControl",
    description: "A trusted control the shell renders: submit, choose, approve; open for more.",
  });

/**
 * Which submit channels a view accepts and which trusted controls its shell renders (D40, D108):
 * the `trustedControls` port's answer, or the home's `HomeConfig.submitChannels`.
 */
export interface ControlsPolicy {
  /** The channels submissions may come through; at least one. */
  readonly submitChannels: readonly SubmitChannel[];
  /** The trusted controls the shell may render; absent: every control the artifact asks for. */
  readonly controls?: readonly TrustedControl[];
}

/** The Zod schema of the `ControlsPolicy` type. */
export const ControlsPolicy: z.ZodType<ControlsPolicy> = z
  .object({
    submitChannels: z.array(SubmitChannel).min(1).max(2).readonly(),
    controls: z.array(TrustedControl).max(32).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "ControlsPolicy",
    description:
      "Which submit channels a view accepts and which trusted controls its shell renders (D108).",
  });

/** A delivery's state (FAILURE_MODEL §4). */
export type DeliveryState = "pending" | "delivered" | "rejected" | "undeliverable";

/** One submission's delivery to one host (D105). */
export interface DeliveryStatus {
  /** The delivery's stable ID (`dlv_`), repeated by every redelivery. */
  readonly deliveryId: string;
  /**
   * The host: its client name. Empty for Mostra's built-in adapter, which takes submissions when no
   * host does; client names are never empty, so no host can be mistaken for it (D105).
   */
  readonly owner: string;
  /** Where the delivery stands. */
  readonly state: DeliveryState;
  /** How many times Mostra called the host for it. */
  readonly attempts: number;
  /** The host's reason, for a rejection. */
  readonly reason?: string;
  /**
   * `true` while a pending delivery waits: its host isn't connected, or an attempt failed and it
   * will be retried (D47's "Pending delivery"). Absent while the first attempt is under way.
   */
  readonly waiting?: true;
  /** When its state last changed. */
  readonly updatedAt: string;
}

/** The Zod schema of the `DeliveryStatus` type. */
export const DeliveryStatus: z.ZodType<DeliveryStatus> = z
  .object({
    deliveryId: DeliveryId.schema,
    owner: z.string(),
    state: z.enum(["pending", "delivered", "rejected", "undeliverable"]),
    attempts: z.int().min(0),
    reason: z.string().exactOptional(),
    waiting: z.literal(true).exactOptional(),
    updatedAt: z.iso.datetime(),
  })
  .register(wireRegistry, {
    id: "DeliveryStatus",
    description: "One submission's delivery to one host: owner, state, attempts and reason.",
  });

/** A submission as a submit answers it (INTERFACES §4). */
export interface SubmissionSummary {
  /** The submission's ID. */
  readonly id: string;
  /** When it was made. */
  readonly at: string;
  /** The draft epoch it closed (D103); 1 outside `epochs`. */
  readonly epoch: number;
  /** Where the submit came from (D40). */
  readonly channel: SubmitChannel;
  /** The version the view showed. */
  readonly versionId: string;
  /** That version's number. */
  readonly version: number;
  /** The view it was made from. */
  readonly viewId: string;
  /** Whether a newer version existed when the viewer submitted (H-10). */
  readonly staleView: boolean;
  /** The draft revision it was made from. */
  readonly draftRevision: DocumentRevision;
  /** SHA-256 of the snapshot's canonical JSON (RFC 8785), lowercase hex. */
  readonly digest: string;
  /** Every delivery's state, summed up: the worst of them. */
  readonly delivery: DeliveryState;
  /** Each host's delivery, so a viewer sees which host has it (IN-13). */
  readonly deliveries?: readonly DeliveryStatus[];
  /** `true` when this submit repeated an earlier one and got it back (D22). */
  readonly duplicate?: true;
}

/** The Zod schema of the `SubmissionSummary` type. */
export const SubmissionSummary: z.ZodType<SubmissionSummary> = z
  .object({
    id: SubmissionId.schema,
    at: z.iso.datetime(),
    epoch: z.int().min(1),
    channel: z.enum(["shell", "artifact"]),
    versionId: VersionId.schema,
    version: z.int().min(1),
    viewId: ViewId.schema,
    staleView: z.boolean(),
    draftRevision: DocumentRevision,
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    delivery: z.enum(["pending", "delivered", "rejected", "undeliverable"]),
    deliveries: z.array(DeliveryStatus).readonly().exactOptional(),
    duplicate: z.literal(true).exactOptional(),
  })
  .register(wireRegistry, {
    id: "SubmissionSummary",
    description:
      "A submission as a submit answers it: ID, time, epoch, version, view, digest, delivery.",
  });

/** A rectangle in CSS pixels, relative to its frame. */
export interface Rect {
  /** Distance from the frame's left edge. */
  readonly x: number;
  /** Distance from the frame's top edge. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** A viewport: its size in CSS pixels and its device pixel ratio. */
export interface Viewport {
  /** Width in CSS pixels. */
  readonly width: number;
  /** Height in CSS pixels. */
  readonly height: number;
  /** Device pixel ratio. */
  readonly dpr: number;
}

/** One comment thread in results (INTERFACES §8; built by the review layer, WP-20). */
export interface ResultComment {
  /** The thread's ID. */
  readonly threadId: string;
  /** Whether the thread is open or resolved. */
  readonly status: "open" | "resolved";
  /** The thread's messages, oldest first, each with its author. */
  readonly messages: readonly {
    readonly author: Viewer;
    readonly at: string;
    readonly text: string;
  }[];
  /** Every layer of the anchor that applies (D23). */
  readonly anchor: {
    readonly reviewId?: string;
    /** W3C Web Annotation selectors. */
    readonly selectors?: readonly unknown[];
    readonly rect?: Rect;
    readonly viewport?: Viewport;
    readonly page?: string;
    readonly candidateId?: string;
    readonly terminal?: {
      readonly rows: readonly [number, number];
      readonly cols: readonly [number, number];
      readonly t?: number;
    };
    readonly time?: number;
    readonly slide?: { readonly index: number; readonly step: number };
  };
  /** The screenshot crop, always stored (D23). */
  readonly crop: { readonly path: string; readonly width: number; readonly height: number };
}

/**
 * The complete submission (INTERFACES §8): what `results/get`, `mostra results` and the
 * submissions port carry. Everything in it comes from the immutable submission and the version it
 * names, never from the live draft (IN-06).
 */
export interface Results {
  /** The artifact, with the metadata of the version the viewer saw. */
  readonly artifact: {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly family?: string;
    readonly links: readonly ArtifactLink[];
  };
  /** The submission's facts: when, how, by whom, from which version and view, and its delivery. */
  readonly submission: {
    readonly id: string;
    readonly at: string;
    readonly epoch: number;
    /** The same viewer's previous submission, under `epochs` (D103). */
    readonly previous?: string;
    readonly policy: SubmissionPolicy;
    readonly channel: SubmitChannel;
    readonly viewer: Viewer;
    readonly versionId: string;
    readonly version: number;
    readonly viewId: string;
    /** Whether a newer version existed when the viewer submitted (H-10). */
    readonly staleView: boolean;
    /** The newest version's number at the time, when the view was stale. */
    readonly latestVersion?: number;
    readonly draftRevision: DocumentRevision;
    readonly stateRevision?: DocumentRevision;
    readonly digest: string;
    readonly delivery: DeliveryState;
    readonly deliveries: readonly DeliveryStatus[];
  };
  /** The draft's fields by ID, dotted IDs nested (D52). */
  readonly answers: Readonly<Record<string, unknown>>;
  /** Every field in `answers` and `state`, with its label and scope. */
  readonly fields: readonly {
    readonly id: string;
    readonly label?: string;
    readonly required?: boolean;
    readonly sensitive?: boolean;
    readonly scope: FieldScope;
  }[];
  /** Artifact state at `stateRevision`, dotted IDs nested (D63). */
  readonly state?: Readonly<Record<string, unknown>>;
  /** The review sets' choices: the fields `review.<set>.choice` (D65). */
  readonly choices: readonly {
    readonly reviewSetId: string;
    readonly candidateId: string;
    readonly label?: string;
  }[];
  /** Comment threads with their anchors and crops (WP-20). */
  readonly comments: readonly ResultComment[];
  /** Answers a newer version couldn't map (D42). */
  readonly orphaned: readonly {
    readonly id: string;
    readonly label?: string;
    readonly value: unknown;
    readonly fromVersion: number;
  }[];
  /** Action runs started in this view (WP-08). */
  readonly actions: readonly {
    readonly runId: string;
    readonly action: string;
    readonly status: string;
    readonly at: string;
  }[];
  /** Signals raised in this view before the submission: the newest 100, within 1 MiB of payloads. */
  readonly signals: readonly {
    readonly name: string;
    readonly at: string;
    readonly payload?: unknown;
  }[];
  /** How many older signals of the view the limit left out; absent when none. */
  readonly signalsOmitted?: number;
  /** Set when compaction removed events of this view before it submitted, so signals may be missing. */
  readonly signalsCompacted?: true;
}

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/** The Zod schema of the `ResultComment` type. */
export const ResultComment: z.ZodType<ResultComment> = z
  .object({
    threadId: z.string(),
    status: z.enum(["open", "resolved"]),
    messages: z
      .array(z.object({ author: Viewer, at: z.iso.datetime(), text: z.string() }))
      .readonly(),
    anchor: z.object({
      reviewId: z.string().exactOptional(),
      selectors: z.array(z.unknown()).readonly().exactOptional(),
      rect: RectSchema.exactOptional(),
      viewport: z
        .object({ width: z.number(), height: z.number(), dpr: z.number() })
        .exactOptional(),
      page: z.string().exactOptional(),
      candidateId: z.string().exactOptional(),
      terminal: z
        .object({
          rows: z.tuple([z.int(), z.int()]).readonly(),
          cols: z.tuple([z.int(), z.int()]).readonly(),
          t: z.number().exactOptional(),
        })
        .exactOptional(),
      time: z.number().exactOptional(),
      slide: z.object({ index: z.int(), step: z.int() }).exactOptional(),
    }),
    crop: z.object({ path: z.string(), width: z.int(), height: z.int() }),
  })
  .register(wireRegistry, {
    id: "ResultComment",
    description: "One comment thread in results: messages, anchor layers and the screenshot crop.",
  }) as z.ZodType<ResultComment>;

/** The Zod schema of the `Results` type. */
export const Results: z.ZodType<Results> = z
  .object({
    artifact: z.object({
      id: ArtifactId.schema,
      title: z.string(),
      description: z.string().exactOptional(),
      family: z.string().exactOptional(),
      links: z.array(ArtifactLink).readonly(),
    }),
    submission: z.object({
      id: SubmissionId.schema,
      at: z.iso.datetime(),
      epoch: z.int().min(1),
      previous: SubmissionId.schema.exactOptional(),
      policy: SubmissionPolicy,
      channel: z.enum(["shell", "artifact"]),
      viewer: Viewer,
      versionId: VersionId.schema,
      version: z.int().min(1),
      viewId: ViewId.schema,
      staleView: z.boolean(),
      latestVersion: z.int().min(1).exactOptional(),
      draftRevision: DocumentRevision,
      stateRevision: DocumentRevision.exactOptional(),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
      delivery: z.enum(["pending", "delivered", "rejected", "undeliverable"]),
      deliveries: z.array(DeliveryStatus).readonly(),
    }),
    answers: z.record(z.string(), z.unknown()),
    fields: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().exactOptional(),
          required: z.boolean().exactOptional(),
          sensitive: z.boolean().exactOptional(),
          scope: z.enum(["viewer", "artifact"]),
        }),
      )
      .readonly(),
    state: z.record(z.string(), z.unknown()).exactOptional(),
    choices: z
      .array(
        z.object({
          reviewSetId: z.string(),
          candidateId: z.string(),
          label: z.string().exactOptional(),
        }),
      )
      .readonly(),
    comments: z.array(ResultComment).readonly(),
    orphaned: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().exactOptional(),
          value: z.unknown(),
          fromVersion: z.int().min(1),
        }),
      )
      .readonly(),
    actions: z
      .array(
        z.object({
          runId: z.string(),
          action: z.string(),
          status: z.string(),
          at: z.iso.datetime(),
        }),
      )
      .readonly(),
    signals: z
      .array(
        z.object({ name: z.string(), at: z.iso.datetime(), payload: z.unknown().exactOptional() }),
      )
      .readonly(),
    signalsOmitted: z.int().min(1).exactOptional(),
    signalsCompacted: z.literal(true).exactOptional(),
  })
  .register(wireRegistry, {
    id: "Results",
    description:
      "The complete submission: artifact, submission facts, answers, fields, state, choices, comments, orphans, actions, signals.",
  }) as z.ZodType<Results>;
