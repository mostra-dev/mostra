# Interaction, State, Review Layer, Host Integration, and Local-Server Hygiene for a Standalone Artifact Toolkit

## Executive recommendation

**Judgment.** The strongest architecture for this toolkit is **not** to make a CRDT framework, hosted realtime backend, or database-sync product the center of the system. Make the center a small, server-authoritative protocol with:

1. a mutable, revisioned **draft**;
2. append-only durable **events**;
3. one immutable **submission snapshot** bound to the artifact version the human actually viewed;
4. ordinary HTTP commands plus an SSE-style downstream event stream by default;
5. an optional WebSocket path for genuinely bidirectional/high-rate workloads such as terminals, collaborative cursors, and interactive streams;
6. IndexedDB-backed client mutation queues for offline drafts;
7. **Yjs as an optional per-field/per-surface collaboration provider**, not as the universal persistence model; and
8. a language-neutral host adapter boundary, with the standalone CLI itself implementing the same host interfaces using an embedded local store.

That is a materially better fit for a local-first, host-agnostic artifact runtime than making Liveblocks, Convex, PartyKit, Electric, Zero, or any one CRDT runtime foundational. Those systems solve valuable but larger or differently shaped problems: Liveblocks supplies hosted realtime/comments infrastructure; Convex is an application backend with serializable transactions and optimistic concurrency; PartyKit targets realtime server infrastructure; Electric is a Postgres read-path sync engine; and Zero is a query-driven database sync layer. citeturn2search1turn1search6turn3search24turn4search12turn7view0

The CRDT choice is similarly asymmetric. Yjs updates are designed to be commutative, associative, and idempotent, making it a strong fit where independently produced concurrent edits really must merge. Automerge offers the same broad local-first family of capabilities, with a Rust core compiled to WebAssembly and an ecosystem of IndexedDB, filesystem, WebSocket, MessageChannel, and BroadcastChannel adapters. Both are MIT-licensed. citeturn0search11turn20search4turn21search0turn21search4 But **forms, questionnaires, choose-one review decisions, approve/submit controls, and real-world action invocations are mostly transactions, not mergeable documents**. A CRDT underneath those operations increases conceptual and forensic complexity without solving the important race: “what exact content and values did this person submit?”

The browser/server split should also distinguish **agent-authored content** from **trusted host chrome**. MCP Apps is useful prior art here: the current extension renders app content in an isolated iframe and communicates with the host over a structured `postMessage`/JSON-RPC channel rather than giving embedded code direct access to the host. citeturn16search3turn16search14 For this toolkit, I would use the same architectural boundary but avoid restricting what the artifact itself may do: **trusted review/submit/approve controls live in a separate origin controlled by the toolkit or embedding host; the artifact remains an ordinary, maximally capable web application in its own origin.** This protects trusted chrome without introducing a content whitelist or DSL.

Finally, local-server protection should borrow directly from Jupyter's threat model. Current Jupyter Server 2.21.1 enables token authentication by default and explicitly rejects suspicious non-local `Host` headers by default to defend against DNS rebinding. Its documentation warns that allowing arbitrary origins or remote access weakens those defenses. citeturn14view0turn14view1 The artifact runtime should go a little further because a button may send email, mutate a database, or perform another externally visible side effect: **loopback binding, an unguessable URL capability, exact `Host` and `Origin` validation, no permissive CORS, per-session anti-CSRF material, and authenticated WebSocket upgrades should all be baseline behavior.**

### Bottom-line architecture

| Concern | Recommended default |
|---|---|
| Draft persistence | Server-authoritative JSON/document state with monotonically increasing revision |
| Autosave | Debounced field/patch commands; flush on blur, visibility change, explicit submit |
| Multi-tab | Server event fanout; optional BroadcastChannel only as a latency optimization |
| Concurrent editing | Optimistic concurrency by default; Yjs opt-in for genuinely concurrent rich data |
| Offline | IndexedDB mutation journal; replay idempotent operations on reconnect |
| Final answer | Immutable server-created submission from canonical draft + viewed artifact version |
| Server→browser updates | One resumable event stream, preferably SSE semantics |
| Browser→server commands | Ordinary authenticated POST/PUT-style RPC |
| Full-duplex realtime | WebSocket only for terminal input, collaborative presence, high-rate bidi channels |
| Reviews | Trusted outer overlay + semantic anchors where possible + visual/coordinate fallback everywhere |
| Cross-origin content | Treat as opaque unless it implements the cooperative bridge |
| Real actions | Durable `ActionRun` objects with progress events and idempotent invocation identity |
| Long-running work | Durable run handle, not an HTTP request kept open indefinitely |
| Host integration | Narrow storage/events/identity/addressing/trusted-controls ports over versioned RPC |
| Standalone storage | Built-in host adapter, preferably an embedded transactional database |
| Local hygiene | Loopback + capability URL + Host/Origin/CSRF checks + strict WebSocket authentication |
| Remote use | Explicit tunnel/VPN mode; exact external host/origin registration, not `0.0.0.0` by default |

## State, persistence, and synchronization model

### Verified prior art and what it implies

Yjs is a mature CRDT implementation whose shared types automatically synchronize, and its binary document updates can be combined in arbitrary order because the update operation is commutative, associative, and idempotent. Its awareness system is explicitly separate from durable document state, which is a useful distinction for cursor/presence data. Yjs is MIT-licensed; its current release stream in 2026 has a stable 13.6.x line alongside 14.0 release candidates, and repository activity continued through 2026. citeturn0search0turn0search11turn0search19turn20search4turn0search5

Automerge likewise provides CRDTs plus a synchronization protocol, but its core implementation is Rust exposed to JavaScript through WebAssembly. Automerge Repo adds pluggable storage and networking, including IndexedDB storage, Node filesystem storage, WebSockets, MessageChannel, and BroadcastChannel; both core Automerge and Automerge Repo are MIT-licensed. citeturn21search0turn21search4 This makes Automerge particularly interesting if a Rust embedding host eventually needs to understand the same collaborative document format rather than treating browser collaboration as an opaque byte stream.

Convex takes a different approach: its documented transaction model uses serializable transactions and optimistic concurrency, and its open-source deployment can use SQLite, PostgreSQL, or MySQL instead of requiring its hosted service. Its action abstraction supports server-side work such as external API calls and scheduling; hosted action execution also has explicit resource/time limits, including a ten-minute execution limit documented for actions. citeturn1search6turn1search2turn1search10turn1search22 That is strong prior art for **revisioned state plus separate long-running action semantics**, even though adopting the whole Convex backend would make the artifact runtime much less minimal.

Electric's current architecture is explicitly a **read-path sync engine for Postgres**. Its Shapes abstraction exposes subsets of database data over HTTP, and the project now recommends composing Electric with client-side database/query tooling rather than treating Electric as a universal application state machine. As of September 2026, the official release stream showed `@electric-sql/client` 1.5.28, `@electric-sql/react` 1.0.57, and the core sync service 1.8.1, with additional canary activity later that month. citeturn4search12turn4search4turn5view0turn5view1 This is excellent precedent for live database-backed views, but an unnecessary Postgres-shaped dependency for a standalone local artifact runtime.

Zero is similarly more database-oriented. It gives clients reactive query-driven views and client-first mutations while keeping the server authoritative, but its current offline mode is read-only rather than supporting arbitrary offline writes. citeturn7view0turn8search2turn8search15turn8search19 There is also a material October-2026 project-governance wrinkle: on September 30, Rocicorp removed several Zero implementation/test components from ongoing public development while retaining previously published copies under Apache-2.0, and the public monorepo now explains that maintainers may port contributions into an internal repository before republishing. The organization and monorepo remained actively updated into October 8, 2026, so this is a transparency/development-model concern rather than an abandonment signal. citeturn7view2turn8search16 Replicache, meanwhile, is explicitly in maintenance mode and directs new development toward Zero, which makes it poor foundation material for a new toolkit despite its historically strong offline-write model. citeturn7view1

### Recommended canonical objects

**Judgment.** Keep the persistence model small and explicit:

```ts
type ArtifactVersionId = string;
type DraftId = string;
type Revision = bigint;
type EventId = string;
type SubmissionId = string;
type ViewId = string;

interface ArtifactVersion {
  artifactId: string;
  versionId: ArtifactVersionId;   // preferably content-derived
  buildDigest: string;
  createdAt: string;
  manifest: {
    clientDigest: string;
    serverDigest?: string;
    contentDigest?: string;
  };
}

interface View {
  viewId: ViewId;
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  reviewSetId?: string;
  candidateId?: string;
  openedAt: string;

  // Optional cursors for live data visible when this view was established.
  sourceCursors?: Record<string, string>;
}

interface DraftSnapshot<T = unknown> {
  draftId: DraftId;
  artifactId: string;
  revision: Revision;
  value: T;
  updatedAt: string;
}

interface DraftMutation {
  mutationId: string;             // stable across retries
  draftId: DraftId;
  expectedRevision: Revision;
  viewedArtifactVersionId: ArtifactVersionId;
  patch: JsonPatch | FieldMutation[];
  clientId: string;
  clientSequence: bigint;
}

interface Submission<T = unknown> {
  submissionId: SubmissionId;
  artifactId: string;
  artifactVersionId: ArtifactVersionId;
  viewId: ViewId;

  draftId: DraftId;
  draftRevision: Revision;
  snapshot: T;
  snapshotDigest: string;

  actor?: HostIdentity;
  submittedAt: string;

  // Immutable provenance, optional but useful.
  candidateId?: string;
  sourceCursors?: Record<string, string>;
}
```

The critical distinction is:

**Drafts are mutable; submissions are facts.**

A draft can be autosaved 10,000 times, merged between tabs, recovered after a crash, or migrated to a newer artifact version. A `Submission` should never be updated in place. If the product later needs “resubmit,” create another explicitly linked review/submission epoch rather than modifying the old record.

### Autosave and optimistic concurrency

**Judgment.** For ordinary controls, each mutation should carry `expectedRevision`. The server atomically performs:

```text
if current_revision != expected_revision:
    return conflict(current_snapshot, current_revision)

apply mutation
revision += 1
persist
emit draft.changed
return new_revision
```

For multi-tab editing, the normal case is straightforward:

```text
Tab A                 Server                     Tab B
  | set name=Alice      |                          |
  | rev=7 ------------> |                          |
  |                     | persist rev=8            |
  | <--- accepted 8     | ---- draft.changed ----> |
  |                     |                          | update local state
```

When simultaneous mutations touch different stable field IDs, the toolkit may safely auto-rebase the second mutation. When they overlap, return an explicit conflict rather than inventing merge semantics. This is essentially the same broad concurrency philosophy as Convex's documented optimistic concurrency, but kept small enough for an embedded standalone server. citeturn1search2

The server should be authoritative even when an IndexedDB copy exists. The browser copy is a **recovery/mutation journal**, not a second canonical database.

### Offline drafts

**Judgment.** Store pending operations in IndexedDB with stable `mutationId`s:

```ts
interface PendingMutation {
  mutationId: string;
  draftId: string;
  baseRevision: bigint;
  createdAt: string;
  patch: JsonPatch | FieldMutation[];
  status: "pending" | "sent";
}
```

On reconnect:

```text
load canonical server draft
      ↓
replay mutation IDs in client sequence order
      ↓
dedupe IDs server has already committed
      ↓
auto-rebase non-overlapping ordinary-field edits
      ↓
surface true overlap conflicts
```

This gives offline forms and questionnaires without requiring every artifact state value to become a CRDT. Automerge Repo proves that full IndexedDB-backed CRDT persistence is available when needed, while Zero's current read-only-offline behavior illustrates why a database-sync library cannot simply be assumed to satisfy offline draft editing. citeturn21search4turn8search2

A subtle but important rule: **do not silently replay form mutations against structurally incompatible content.** Every offline mutation records the artifact version from which it was authored. If questions/field identities have changed, the runtime either maps stable IDs or reports that migration is required.

### Submission transaction

A final submission should be created from **server canonical state**, not from an arbitrary JSON snapshot supplied by the page:

```text
submit(viewId, expectedDraftRevision)
    ↓
resolve viewId → exact artifactVersionId shown
    ↓
verify draft revision
    ↓
read canonical persisted draft
    ↓
compute snapshot digest
    ↓
insert immutable Submission
    ↓
commit transaction
    ↓
emit submission.created
```

The resulting invariant is:

```text
submission.snapshot
        +
submission.draftRevision
        +
submission.artifactVersionId
        +
submission.viewId
        =
the answer and presentation context that were actually submitted
```

A newer artifact version appearing during the interaction must never silently rewrite that provenance. A host may choose either to permit submitting the older viewed version or to require the human to review the new version first; **the persistence layer should support both policies by representing the version explicitly.**

For a workflow that truly means “exactly one final submission,” enforce a unique key on the review/answer session. A duplicate click or retried request then returns the already-created immutable submission instead of creating another one.

### Where CRDTs are actually warranted

**Judgment.**

| State | Default technique | Why |
|---|---|---|
| Text input, checkbox, select, numeric field | Revision + field mutation | Conflicts are rare and understandable |
| Questionnaire answers | Revision + stable field IDs | Strong auditability |
| Autosaved draft | Revision + offline op journal | Simpler recovery model |
| Candidate selection | Transaction | A choice is a decision, not a merge |
| Final submission | Immutable transaction | Must have one exact meaning |
| Approve/reject | Transaction | Merge semantics would be wrong |
| Action invocation | Idempotent command | Side effects cannot be CRDT-merged |
| Comments/replies | Append/update entities | Ordinary server state is sufficient |
| Presence/cursors | Ephemeral stream | Should normally not enter durable draft |
| Rich collaborative text | **Yjs** | Concurrent intent-preserving editing matters |
| Infinite canvas/object graph | Yjs or Automerge | Independent object edits can truly coexist |
| Multiwriter offline document | Yjs/Automerge | Reordered disconnected mutations are intrinsic |

Yjs's idempotent, commutative update model is exactly the property needed in the latter cases. citeturn0search11 Do not let that useful property turn into “all state must be Yjs.”

## Technology comparison and ranked recommendation

### Current primary-source snapshot

The table below separates current project facts from the recommendation.

| Option | Verified October-2026 state | License / commercial constraint | Fit for this toolkit |
|---|---|---|---|
| **Yjs** | Stable 13.6.x line with 14.0 RC work; active 2026 repository; CRDT updates are order-independent/idempotent citeturn0search5turn0search11 | MIT; project explicitly says commercial use is allowed, with a non-binding request to sponsor maintenance citeturn20search4 | **Excellent optional collaboration primitive** |
| **Automerge + Repo** | Rust/Wasm CRDT core; Repo provides IndexedDB, filesystem, WebSocket, MessageChannel and BroadcastChannel adapters; official Repo index shows a long release history citeturn21search0turn21search4 | MIT citeturn21search0turn21search4 | Excellent alternative, particularly if Rust-native CRDT processing/history becomes important |
| **Liveblocks** | v3.24.0 released Aug. 17, 2026; rooms expose presence, broadcast, storage, threads/comments and realtime infrastructure citeturn2search1turn2search3 | Repository contains Apache-2.0 and AGPL-3.0-or-later portions; hosted product has usage-priced plans citeturn2search2turn2search19 | Useful hosted adapter/reference; poor universal core dependency |
| **Convex** | Documents serializable transactions/OCC, open-source deployments with SQLite/Postgres/MySQL, server actions and scheduling citeturn1search6turn1search2turn1search10 | OSS backend plus commercial hosted offering; re-check the exact vendored component's license before hard dependency | Strong full-backend option, but much larger abstraction than required |
| **PartyKit** | Legacy `partykit/partykit` repo says current development moved to `cloudflare/partykit`; release page exposes `partykit@0.0.113`; issues were still active in Aug. 2026 citeturn20search2turn20search10turn20search6 | MIT in the referenced repo citeturn20search2 | Good realtime deployment adapter; not an embedded local foundation |
| **Electric** | Current architecture is Postgres→client read-path sync via Shapes; Sep. 2026 packages included client 1.5.28, React 1.0.57 and sync service 1.8.1 citeturn4search12turn5view1 | Open-source project; confirm exact package license at vendoring point | Excellent live-Postgres adapter, unnecessary for ordinary artifact state |
| **Zero** | Query-driven reactive sync; server remains authoritative; current offline behavior is read-only; public-development model changed Sep. 30, 2026 although repository activity continued into Oct. 8 citeturn7view0turn8search2turn7view2turn8search16 | Public monorepo Apache-2.0; some current development is internal before publication citeturn7view2 | Interesting DB adapter; **not** the offline-draft core |
| **Replicache** | Officially in maintenance mode; users are directed toward Zero citeturn7view1 | Open-sourced/no longer charged in maintenance state citeturn7view1 | Do not start a new foundational dependency |
| **tldraw** | Current SDK/docs are in the 5.1.x generation; sophisticated React canvas/persistence/multiplayer architecture citeturn12view0turn12view1 | **Not a normal unrestricted OSS dependency for production:** tldraw SDK production use requires a license key under the tldraw license; starter kits have MIT components citeturn12view1 | Valuable architecture/reference or opt-in integration; avoid as compulsory core |
| **Jupyter Server** | 2.21.1 current in the indexed official API docs; mature token/Host protections and extensible auth boundary citeturn14view1turn14view0 | Open-source Jupyter project | Excellent local-server security/integration precedent, not a state library |

### Ranked judgment

**First — custom revisioned draft/submission/event core.**  
This is the recommendation. Its key advantage is semantic fit: all hosts can implement the same few operations, and the runtime does not inherit Postgres, Cloudflare, a hosted service, or a CRDT document format as its definition of persistence.

**What would overturn it:** if simultaneous, disconnected multiwriter editing of the *same* artifact state becomes the common case rather than a specialist artifact capability. At that point the extra semantics of a CRDT become fundamental rather than optional.

**Second — Yjs as the standard collaborative-state plugin.**  
Yjs wins the default CRDT slot because its update algebra is explicitly designed for disconnected/reordered synchronization, the project is MIT-licensed, and the ecosystem separates durable shared state from ephemeral awareness. citeturn0search11turn0search19turn20search4

**What would overturn it:** a strong requirement for the Rust host to inspect/manipulate collaborative documents natively, or a product requirement centered on document-history/branching semantics. Automerge's Rust core would then be strategically attractive. citeturn21search0

**Third — Automerge as a supported alternative provider.**  
Its Rust/Wasm implementation and pluggable Repo layer make it especially compelling in a Rust-host ecosystem. citeturn21search0turn21search4 I would avoid supporting both CRDTs in the first stable API unless real adopters need both; define a `CollaborativeDocumentPort` that leaves room for it.

**Fourth — Convex/Electric/Zero adapters for artifacts already living in those ecosystems.**  
These tools are compelling precisely when their database/backend is already the source of truth. Convex has transactional application state, Electric specializes in Postgres read sync, and Zero provides reactive database query/mutation synchronization. citeturn1search6turn4search12turn7view0 They should not determine how a standalone questionnaire saves the user's name.

**What would overturn it:** a deliberate strategy shift from “standalone toolkit” to “opinionated application backend.”

**Fifth — Liveblocks/PartyKit as remote collaboration deployments, not contracts.**  
Both are useful for remote realtime infrastructure; Liveblocks additionally has first-class thread/comment concepts. citeturn2search1turn20search2 The core protocol should remain implementable without either service.

Replicache is not recommended for new foundational work because Rocicorp explicitly places it in maintenance mode. citeturn7view1 tldraw should likewise remain optional or inspirational unless its production licensing becomes compatible with the toolkit's desired dependency story. citeturn12view1

## Universal review and annotation architecture

The hard review problem is not drawing a pin on HTML. It is establishing an anchor that still means something across:

- normal DOM;
- rich React applications;
- canvas/WebGL;
- terminal emulators;
- arbitrary iframes;
- cross-origin iframes;
- responsive layout;
- changed artifact versions;
- candidate galleries; and
- screenshots.

Vercel's Preview Deployment comments are useful prior art for reviewing rendered interfaces rather than source files, while Liveblocks supplies room/thread primitives that can back application-defined commenting UX. citeturn10search25turn2search1 tldraw demonstrates the value of a semantic object model for canvas-like surfaces, although its current production licensing makes it a poor mandatory dependency for this project. citeturn12view0turn12view1

### The decisive design: annotations belong to the outer review shell

**Judgment.** Do not inject the review UI into agent-authored React code.

Use:

```text
Trusted toolkit/host shell
┌─────────────────────────────────────────────────────────────┐
│ Review toolbar       Candidate picker       Trusted Submit │
│                                                             │
│   annotation-overlay                                        │
│   ┌─────────────────────────────────────────────────────┐   │
│   │             artifact origin / iframe                │   │
│   │                                                     │   │
│   │       arbitrary React/web/canvas/terminal app       │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│          ● comment pin                                     │
└─────────────────────────────────────────────────────────────┘
```

This gives four important properties:

**The review system works even when the artifact knows nothing about reviews.**  
A transparent overlay can intercept a placement click over HTML, canvas, a terminal, or an iframe.

**Agent-authored CSS cannot accidentally style or hide the review chrome.**

**Agent-authored JavaScript cannot impersonate trusted host controls if the shell and artifact are different origins.**

**Cooperative artifacts can still enrich the generic anchor through a message bridge.**

MCP Apps validates the broad trust-boundary pattern: the embedded interface runs isolated from the host and all integration goes through a structured `postMessage` channel. citeturn16search3turn16search14 VS Code webviews similarly use explicit `postMessage`/receive-message APIs to cross the boundary between web content and privileged extension code. citeturn18search0

### Use a multi-resolution anchor, not one selector

Every comment should have a **visual fallback**, while richer surfaces can add semantic locators:

```ts
interface VisualAnchor {
  // Coordinates relative to a named surface, not entire screen.
  x: number;        // normalized 0..1 preferred
  y: number;
  width?: number;
  height?: number;

  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
    scrollX?: number;
    scrollY?: number;
  };

  captureRef?: string;
  captureDigest?: string;
}

type ReviewAnchor =
  | {
      kind: "dom";
      anchorId?: string;          // e.g. data-artifact-anchor
      textQuote?: string;
      selectorHint?: string;
      visual: VisualAnchor;
    }
  | {
      kind: "semantic";
      namespace: string;          // "tldraw", "chart", "custom", ...
      objectId: string;
      localPoint?: { x: number; y: number };
      visual: VisualAnchor;
    }
  | {
      kind: "terminal";
      bufferId?: string;
      row?: number;
      column?: number;
      generation?: string;
      visual: VisualAnchor;
    }
  | {
      kind: "iframe";
      frameId: string;
      frameUrlHint?: string;
      visual: VisualAnchor;
    }
  | {
      kind: "visual";
      visual: VisualAnchor;
    };

interface ReviewThread {
  threadId: string;
  artifactVersionId: string;
  candidateId?: string;
  surfaceId: string;

  anchor: ReviewAnchor;
  messages: ReviewMessage[];

  resolvedAt?: string;
  createdAt: string;
  createdBy?: HostIdentity;
}
```

The resolver order should be:

```text
semantic object ID
      ↓ failure
stable DOM anchor / text quotation
      ↓ failure
geometric position
      ↓ failure
stored screenshot context
```

This is deliberately redundant. A selector is fragile after React rerenders; a pixel position is fragile after responsive reflow; an object ID cannot exist for arbitrary third-party content. Combining them creates graceful degradation.

### Cross-origin iframe rule

**Judgment based on the browser trust boundary.** Treat arbitrary cross-origin iframe interiors as **opaque unless they cooperate**. The fact that MCP Apps needs an explicit `postMessage` bridge across an isolated iframe is the useful precedent here. citeturn16search3

Therefore, two modes exist.

**Opaque mode:** the outer review system can anchor to a point relative to the iframe rectangle and store the viewport/capture context. This works universally, but if the iframe later scrolls internally the semantic target cannot automatically follow.

**Cooperative mode:** a tiny optional artifact bridge negotiates:

```ts
interface ReviewSurfaceBridge {
  hitTest(point: { x: number; y: number }): Promise<SemanticTarget | null>;
  resolve(target: SemanticTarget): Promise<DOMRectLike | null>;
  describe?(target: SemanticTarget): Promise<string>;
}
```

The message could look like:

```json
{
  "jsonrpc": "2.0",
  "method": "review/hitTest",
  "params": {
    "surfaceId": "main",
    "x": 0.421,
    "y": 0.638
  },
  "id": "req-..."
}
```

This bridge is **enhancement, not a requirement**. That is what makes the review layer universal.

### Canvas and motion graphics

For a canvas/WebGL artifact, generic review mode still places a visual pin. A cooperative artifact can return a semantic object such as:

```json
{
  "namespace": "chart",
  "objectId": "series/revenue/point/2026-08",
  "localPoint": [0.5, 0.5]
}
```

If that object later moves, the comment moves with it. If it disappears, the review UI can show the stored visual context and label the anchor unresolved.

This is the right place to borrow the *idea* of tldraw's structured canvas state without taking a production dependency on its commercially restricted SDK. citeturn12view0turn12view1

### Terminal and TUI content

For a terminal rendered through a known emulator, the integration should capture both:

```text
buffer generation + row/column
```

and:

```text
visual screenshot point/crop
```

A row number alone is insufficient after scrollback changes; a screenshot alone cannot follow a stable line/object when the viewport moves. For a totally opaque terminal renderer, the visual anchor remains universal fallback.

### Screenshot-anchored review

A normal agent-authored page should **not** be the component trusted to generate evidentiary screenshots of itself. Instead define a host capability:

```ts
interface CapturePort {
  captureSurface(request: {
    artifactId: string;
    artifactVersionId: string;
    viewId: string;
    surfaceId: string;
    viewport?: Viewport;
  }): Promise<{
    blobRef: string;
    digest: string;
    viewport: Viewport;
    capturedAt: string;
  }>;
}
```

For the known Rust harness, that port can use whatever browser-control/screenshot facility the harness already exposes. Standalone mode can implement it through an optional browser automation/capture module. Where trusted pixel capture is unavailable, the review layer still works with coordinates; screenshot evidence is an enhancement.

This avoids pretending that arbitrary cross-origin iframe pixels can be reliably extracted by ordinary page JavaScript.

### Candidate galleries and comparisons

Model a comparison as a first-class review object rather than special-casing its UI:

```ts
interface ReviewSet {
  reviewSetId: string;
  version: bigint;

  candidates: Array<{
    candidateId: string;
    artifactVersionId: string;
    label?: string;
  }>;

  selection?: {
    candidateId: string;
    selectedBy?: HostIdentity;
    selectedAt: string;
  };
}
```

Gallery, carousel, and side-by-side compare are then merely renderings of this state. Each candidate gets a distinct `surfaceId`, so annotation locations cannot accidentally collide.

**Candidate choice is a transaction, not collaborative document state.** Apply optimistic concurrency to `ReviewSet.version`; do not make candidate selection a CRDT register unless there is a very unusual product requirement for multiple independently authoritative selectors.

## Actions, event streams, and live data

### A unified event envelope

The same event layer can drive draft propagation, action progress, comments, host notifications, file updates, and live data:

```ts
interface ArtifactEvent<T = unknown> {
  eventId: string;

  // Monotonic within one artifact/session stream.
  sequence: bigint;

  artifactId: string;
  artifactVersionId?: string;
  viewId?: string;
  sessionId?: string;

  type: string;
  occurredAt: string;

  causedBy?: {
    mutationId?: string;
    actionRunId?: string;
    actorId?: string;
  };

  payload: T;
}
```

Persist events for which replay matters:

```text
draft.changed
draft.conflicted
submission.created

review.thread.created
review.thread.updated
review.thread.resolved
review.candidate.selected

action.queued
action.started
action.progress
action.output
action.succeeded
action.failed
action.cancelled

live.source.changed

host.notification.requested
```

Presence, cursor locations, animation frames, mouse moves, and high-rate terminal screen deltas can be explicitly ephemeral.

### SSE-style downstream stream, HTTP upstream

**Judgment.** Use a simple split by default:

```text
Browser ── POST command ──────────> server
Browser <─ event stream ─────────── server
```

Reserve WebSocket for:

```text
browser terminal keystrokes <────> PTY
collaboration awareness      <────> peers/server
high-rate bidirectional app  <────> server
```

RFC 6455 defines WebSocket specifically as two-way communication between browser code and a remote host, with an origin-oriented browser security model. citeturn19search10 That makes it appropriate when the workload is actually bidirectional, but not a reason to turn every autosaved checkbox into a socket message.

One event stream per artifact/browser session also makes reconnect recovery conceptually simple:

```text
connect(cursor=1831)
     ↓
server replays durable 1832...
     ↓
switches to live delivery
```

If historical events have been compacted, return a fresh state snapshot plus the new cursor.

### Agent-authored server actions

Actions should remain ordinary TypeScript rather than a schema DSL. A conventional filesystem API is sufficient:

```ts
// artifact/server/actions/sendReply.ts
import type { ActionContext } from "@artifact/runtime";

export async function sendReply(
  input: { messageId: string; body: string },
  ctx: ActionContext,
) {
  await ctx.progress({ message: "Sending reply…" });

  const result = await sendThroughProvider(input);

  await ctx.emit("mail.reply.sent", {
    messageId: input.messageId,
    providerId: result.id,
  });

  await ctx.host.notifyAgent({
    kind: "artifact.action.completed",
    summary: "User sent the edited reply",
  });

  return { providerId: result.id };
}
```

The runtime wraps this in a durable `ActionRun`:

```ts
interface ActionRun {
  actionRunId: string;
  artifactVersionId: string;
  actionName: string;

  requestId: string;       // invocation idempotency identity
  argsDigest: string;

  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";

  attempt: number;

  resultRef?: string;
  error?: SerializedError;

  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
```

MCP's current Tasks extension reaches essentially the same broad conclusion for long-running work: instead of keeping the original tool request blocked, the server can return a durable task handle which the client polls for progress/result. citeturn15search33 The artifact runtime can improve the browser experience by combining that durable handle with pushed progress events.

### Idempotency and retries

**Judgment.** Give every invocation a stable `requestId`, with a database uniqueness constraint on something equivalent to:

```text
(artifactVersionId, actionName, requestId)
```

A repeated POST caused by connection loss returns the existing `ActionRun`.

This only deduplicates the toolkit-side invocation. It does **not** magically make an external side effect exactly once. For important integrations:

```text
artifact transaction
    ↓
record durable external-effect intent
    ↓
worker executes
    ↓
use downstream idempotency key when provider supports one
    ↓
record provider result
```

An action should therefore declare retry semantics, not merely `catch { retry }` every error:

```ts
export const runtime = {
  retry: {
    mode: "explicit", // "never" | "explicit" | "safe"
    maxAttempts: 3
  }
};
```

This is execution semantics, not a capability restriction. An agent remains free to implement arbitrary server behavior.

### Process restarts and long-running work

Do not equate:

```text
HTTP request lifetime = action lifetime
```

Instead:

```text
POST /actions/send
      ↓
persist ActionRun(queued)
      ↓
return runId immediately
      ↓
worker claims run
      ↓
events: started → progress → succeeded
```

For standalone operation, worker and HTTP server may live in one OS process initially while still using the durable model. If that process dies, unfinished runs can become `interrupted` on recovery rather than being silently reported as successful.

A future host can replace execution with a task runner without changing the browser API.

### Live data model

Use the same event substrate but separate **stateful source snapshots** from transient events:

```ts
interface LiveSourceState<T = unknown> {
  sourceId: string;
  revision: bigint;
  observedAt: string;
  value: T;
}

interface LiveUpdate<T = unknown> {
  sourceId: string;
  revision: bigint;
  mode: "replace" | "patch" | "append";
  value: T;
}
```

Support four ingestion modes:

```text
loader    → browser asks server for current value
poller    → browser/server re-runs loader periodically
watcher   → filesystem/server event triggers refresh
push      → CLI/SDK/host publishes value into running artifact
```

CLI examples can stay extremely small:

```bash
artifact data push build-status --json '{"state":"passing"}'
artifact data push metrics --file metrics.json
```

SDK:

```ts
await artifact.publishLiveData("metrics", payload);
```

The server assigns the revision and distributes:

```json
{
  "type": "live.source.changed",
  "payload": {
    "sourceId": "metrics",
    "revision": 42
  }
}
```

The live-data system should not assume all streams are durable. A dashboard displaying a 60-Hz telemetry feed might persist only the latest state or a configured ring buffer, while a submitted questionnaire remains fully durable.

Electric's Shapes are a useful precedent for exposing continuously changing backend subsets as resources rather than treating every update as a bespoke RPC. citeturn4search12turn4search16 Zero similarly demonstrates reactive queries driven by server/database changes. citeturn8search19 The toolkit should adopt the **pattern**, not require either database.

## Host ports and trust boundaries

### Architectural principle

The standalone program and the Rust harness should not be two architectures.

They should be two implementations of:

```ts
HostPorts
```

The standalone adapter owns local durable state. The Rust harness adapter forwards operations to the harness. Tests can use an in-memory adapter.

MCP Apps and VS Code webviews both reinforce a useful principle here: privileged host capabilities are exposed through a narrow message boundary rather than by sharing the host's implementation environment with arbitrary UI code. citeturn16search3turn18search0 The current MCP specification itself was revised on July 28, 2026 toward a stateless core with separately defined application-level extensions, another useful example of keeping transport/session mechanics distinct from durable application semantics. citeturn15search6turn15search13

### Recommended TypeScript-facing interface

```ts
export interface HostPorts {
  identity: IdentityPort;

  drafts: DraftPort;
  submissions: SubmissionPort;
  reviews: ReviewPort;

  events: HostEventPort;
  addressing: AddressingPort;

  trustedControls?: TrustedControlsPort;
  capture?: CapturePort;
}

export interface HostIdentity {
  subject: string;
  displayName?: string;
  claims?: Record<string, unknown>;
}

export interface IdentityPort {
  currentViewer(context: RequestContext): Promise<HostIdentity | null>;
}

export interface DraftPort {
  get(id: string): Promise<DraftSnapshot | null>;

  apply(request: {
    draftId: string;
    mutationId: string;
    expectedRevision: bigint;
    viewedArtifactVersionId: string;
    patch: JsonPatch | FieldMutation[];
  }): Promise<
    | {
        status: "accepted";
        revision: bigint;
      }
    | {
        status: "conflict";
        current: DraftSnapshot;
      }
  >;
}

export interface SubmissionPort {
  create(request: {
    submissionId: string;
    draftId: string;
    expectedDraftRevision: bigint;

    viewId: string;
    artifactVersionId: string;

    candidateId?: string;
    actor?: HostIdentity;
  }): Promise<Submission>;

  get(id: string): Promise<Submission | null>;
}

export interface ReviewPort {
  createThread(thread: ReviewThread): Promise<void>;
  updateThread(thread: ReviewThread): Promise<void>;
  getThreads(query: ReviewQuery): Promise<ReviewThread[]>;

  selectCandidate(request: {
    reviewSetId: string;
    expectedVersion: bigint;
    candidateId: string;
    actor?: HostIdentity;
  }): Promise<void>;
}

export interface HostEventPort {
  emit(event: ArtifactEvent): Promise<void>;

  // Host-to-toolkit events, if embedding requires them.
  subscribe?(
    cursor: string | undefined,
    handler: (event: HostInboundEvent) => Promise<void>,
  ): Promise<Subscription>;
}

export interface AddressingPort {
  artifactAddress(request: {
    artifactId: string;
    artifactVersionId: string;
  }): Promise<{
    browserUrl: string;
    externalUrl?: string;
  }>;

  resolveResource(request: {
    artifactId: string;
    resource: string;
  }): Promise<string>;
}

export interface TrustedControl {
  id: string;
  kind: "submit" | "approve" | "reject" | "choose" | "custom";
  label: string;
  enabled: boolean;
  state?: unknown;
}

export interface TrustedControlsPort {
  setControls(request: {
    viewId: string;
    controls: TrustedControl[];
  }): Promise<void>;

  onInvoke(
    handler: (request: {
      viewId: string;
      controlId: string;
      actor?: HostIdentity;
    }) => Promise<void>,
  ): Subscription;
}

export interface CapturePort {
  captureSurface(request: CaptureRequest): Promise<CaptureResult>;
}
```

### Do not expose host storage implementation details to artifacts

The artifact-facing API should be higher-level:

```ts
const draft = useArtifactDraft<MyAnswers>();

await artifact.actions.invoke("sendReply", input);

artifact.host.notify({
  kind: "user-requested-agent-attention",
  payload: { threadId }
});
```

The artifact should not need to know whether the host persists through SQLite, Rust structs, PostgreSQL, a remote service, or an agent conversation store.

### Wire protocol between a Rust host and toolkit process

**Judgment.** Use a versioned, language-neutral request/notification protocol, plausibly JSON-RPC over stdio or a local Unix-domain socket:

```text
Rust harness
     │
     │  draft.get
     │  draft.apply
     │  submission.create
     │  identity.current
     │  events.emit
     │  controls.set
     ▼
artifact toolkit process
     │
     ▼
browser runtime
```

A representative wire message:

```json
{
  "jsonrpc": "2.0",
  "id": "42",
  "method": "draft.apply",
  "params": {
    "draftId": "draft-9",
    "mutationId": "01J...",
    "expectedRevision": "81",
    "viewedArtifactVersionId": "sha256:...",
    "patch": [
      { "op": "replace", "path": "/recipient", "value": "alice@example.com" }
    ]
  }
}
```

This resembles MCP Apps' use of structured JSON-RPC over `postMessage` without forcing the internal host interface itself to become MCP. MCP Apps explicitly standardized that structured bridge to avoid inventing arbitrary host/app messaging formats. citeturn16search14turn16search22

### Trusted controls need a real origin boundary

This deserves emphasis.

Rendering:

```text
[agent-authored artifact]
[host-approved Submit button]
```

in the same DOM/origin does **not** create a trustworthy distinction if arbitrary artifact JavaScript can modify the parent DOM.

Preferred deployment:

```text
trusted shell origin A
     │
     ├── review controls
     ├── host Submit/Approve
     └── <iframe src="artifact origin B">
```

Origin B remains an ordinary web application with maximum capability. The isolation exists only so it cannot forge origin-A UI or read origin-A state. Communication uses validated messages.

MCP Apps makes the same separation more restrictive by sandboxing its embedded iframe and exposing privileged operations over the host bridge. citeturn16search3 Your toolkit need not adopt its content restrictions to adopt the **privilege-separation principle**.

### MCP elicitation as prior art, not as the artifact format

Current MCP elicitation supports both form-mode structured user input and URL-mode out-of-band interactions; URL mode exists specifically for interactions that should happen outside the normal client data path. citeturn15search2turn15search14

The lesson for this project is architectural, not syntactic:

> the host should be able to own a trusted interaction surface independently of agent-authored content.

Do **not** therefore reduce artifacts to MCP's form schema. Ordinary React remains the right commitment. A host-level trusted `Approve` control can coexist with an unrestricted React artifact.

## Local-server hygiene without content restrictions

Jupyter is the strongest directly relevant precedent because it assumes its local web server may ultimately execute arbitrary user code. Current Jupyter Server documentation says token authentication is enabled by default precisely because server access can mean arbitrary code execution. Tokens may be supplied through authorization headers or the login URL, after which Jupyter establishes a browser cookie. citeturn14view0

Jupyter Server 2.21.1 also has an explicit `allow_remote_access` protection: by default it returns `403` when the `Host` header says the browser believes it is talking to a non-local domain. The documentation states that this is a DNS-rebinding defense, and it automatically considers loopback addresses such as `127.0.0.1` and `::1` local. citeturn14view1turn14view2 Jupyter separately exposes `allow_origin`, with `*` documented as allowing any origin to access the server. citeturn14view1 That is exactly the configuration style this artifact toolkit should **not** default to.

### Threat model

The minimum hygiene target should be explicit:

```text
Protect against:
  malicious ordinary websites
  cross-site form/fetch attempts
  DNS rebinding
  guessed localhost ports
  cross-site WebSocket use
  accidental LAN exposure
  stale/foreign artifact URLs
  capability leakage through ordinary referrers

Not protect against:
  malicious code the user intentionally allowed the artifact to run
  malware already executing as the user's OS account
  someone to whom the user intentionally gave the capability URL
```

That distinction honors the commitment to maximum artifact capability. Security is at the **invocation boundary**, not a policy engine deciding whether sending mail is acceptable.

### Recommended capability bootstrap

A particularly clean pattern for local use is:

```text
http://127.0.0.1:41731/#cap=<256-bit-random-value>
```

The capability is in the **fragment**, so the bootstrap HTTP request itself does not need to put the bearer value into a query string. Trusted bootstrap JavaScript:

```text
reads #cap
    ↓
POST /__runtime/session
    Authorization: Artifact <cap>
    Origin: exact runtime origin
    ↓
server exchanges cap for short-lived runtime session
    ↓
browser gets:
    HttpOnly session cookie
    + JS-visible anti-CSRF nonce
    ↓
history.replaceState(...)
removes #cap from visible URL
```

This is an improvement over simply leaving a powerful bearer token in every artifact API URL. Jupyter demonstrates the basic token→cookie pattern, though its documented example puts the login token in a query parameter. citeturn14view0

For a shareable remote-phone URL, the launcher can retain or mint a capability link for a second session; revocation remains under the local process.

### Exact Host validation

For local mode, accept only explicitly generated local names/addresses. Conceptually:

```text
Host: 127.0.0.1:<actual-port>  ✓
Host: localhost:<actual-port>  ✓ if this instance issued it
Host: attack.example:<port>     ✗
Host: random-lan-name:<port>    ✗
```

Do this **even though the socket is loopback-bound**. Jupyter's documentation explicitly explains why Host validation matters: DNS rebinding can otherwise make a remote website appear to the browser to be addressing a local IP while passing same-origin checks. citeturn14view1

Remote/tunnel mode should extend the exact allowlist with the configured tunnel hostname rather than switching to “accept any Host.”

### Exact Origin validation

For every state-changing browser endpoint:

```text
POST /draft/*
POST /submit
POST /actions/*
POST /reviews/*
DELETE ...
WebSocket Upgrade
```

require an expected browser `Origin`.

There should be no default:

```http
Access-Control-Allow-Origin: *
```

Jupyter's API documents that `allow_origin="*"` means any origin can access the server; that is exactly the opposite of the desired local hygiene. citeturn14view1

Non-browser CLI clients can authenticate through a separate local credential and need not pretend to carry browser Origin semantics.

WebSockets require the same attention. RFC 6455 explicitly describes WebSocket's security model in terms of an origin-based browser model. citeturn19search10 Validate the upgrade origin and authenticate the connection before accepting application messages.

### Anti-CSRF token even with cookies

**Judgment.** Do not rely on the session cookie alone.

Mutating browser calls should also require a random per-session value in a non-simple header, for example:

```http
X-Artifact-CSRF: Fj3k...
```

The toolkit-provided action/draft client adds it automatically.

The combination is deliberately redundant:

```text
unguessable launch capability
+ authenticated runtime session
+ exact Host
+ exact Origin
+ CSRF header
```

No single browser quirk becomes the whole security model.

All GET endpoints should remain side-effect-free. The agent's “Send” button invokes a protected command endpoint, never an actionful GET URL that could be triggered through an image, link prefetch, or crawler.

### Cookie scope

Recommended session cookie properties:

```text
HttpOnly
SameSite=Strict
host-only (no Domain attribute)
instance-specific Path where practical
Secure whenever HTTPS is in use
short lifetime / process-scoped revocation
```

Do not treat cookie scoping as a substitute for Origin/CSRF validation. In particular, local development often involves several services and ports; endpoint-level authentication must remain authoritative.

### Separate trusted-shell and artifact origins

There are two different security questions:

```text
Can random website X invoke my local artifact server?
```

and:

```text
Can arbitrary artifact JS forge the host's "Approved" UI?
```

The first is addressed by capability/session + Host/Origin/CSRF checks.

The second requires **origin separation**.

Thus a review-mode deployment should resemble:

```text
Trusted shell
http://127.0.0.1:41000/
       │
       └── iframe
           http://127.0.0.1:41001/artifact/...
```

or another arrangement that gives the artifact a genuinely different browser origin.

The parent accepts only the documented message protocol. This applies the same essential privilege-boundary idea used by MCP Apps' isolated iframe/postMessage integration and VS Code's webview bridge. citeturn16search3turn18search0

Importantly, **do not impose a restrictive CSP on the artifact merely to make this boundary work.** A CSP controlling what the artifact may load would conflict with the maximum-capability commitment. A strict CSP is reasonable for the toolkit's own trusted shell; the artifact origin should retain normal browser capabilities.

### Tunnel and VPN mode

**Judgment.** Prefer:

```text
artifact server bound to loopback
         ↑
local tunnel/VPN forwarder
         ↑
HTTPS public/private tunnel hostname
         ↑
phone browser
```

over:

```text
artifact server --host 0.0.0.0
```

When remote mode is enabled, register exactly:

```text
allowedHost   = generated tunnel hostname
allowedOrigin = https://generated tunnel hostname
```

and keep the artifact URL capability requirement. A tunnel's secrecy or network membership is useful defense in depth; it should not cause the application-level capability check to disappear.

If direct VPN-interface binding is required, bind that explicit interface rather than every LAN interface, and preserve exactly the same Host/Origin/session rules.

### Minimal hygiene checklist

The following is the minimum I would consider release-blocking:

- **Bind to loopback by default.** Remote exposure is an explicit mode.
- **Generate a high-entropy per-launch or per-artifact capability.** Never rely on “localhost is private.”
- **Exchange the URL capability for a scoped browser session** and remove the capability from routine navigations.
- **Reject unexpected `Host` headers.** Jupyter does this specifically to mitigate DNS rebinding. citeturn14view1
- **Reject unexpected browser `Origin` values on every mutation and WebSocket upgrade.**
- **Do not enable wildcard CORS.** Jupyter documents `*` as allowing any origin. citeturn14view1
- **Require a per-session CSRF header for browser mutations.**
- **Make GET/HEAD read-only.**
- **Authenticate WebSockets at upgrade and validate Origin.** WebSocket's browser security model is origin-based. citeturn19search10
- **Scope/expire sessions and rotate capabilities when an artifact instance restarts or is revoked.**
- **Keep trusted host controls on a distinct origin from agent-authored content.**
- **For remote access, allow only explicitly configured tunnel/VPN hosts and origins; never disable the DNS-rebinding check globally.**
- **Bind action invocations to an artifact version/view identity.** An old page must not silently invoke a newly replaced server function under the same visible button.
- **Log durable side-effect invocations by `ActionRun` and request ID.** A retry should resolve to an existing run rather than accidentally create a second external operation.
- **Do not add content-policy restrictions to artifact code as a substitute for these boundary defenses.** The artifact is trusted to do what its author programmed; the network/runtime boundary decides who may invoke it.

The last point is important. Jupyter protects access to a server capable of executing arbitrary code through authentication and network/browser hygiene rather than by attempting to classify which notebook computations are acceptable. citeturn14view0 That is the correct precedent for the toolkit's stated curl-like capability philosophy.

## Recommended integrated model

Putting the pieces together, the artifact runtime becomes a relatively small set of orthogonal layers:

```text
┌───────────────────────────────────────────────────────────────┐
│                      EMBEDDING HOST                           │
│ Rust harness / standalone adapter / future app               │
│                                                               │
│ identity  storage  events  addressing  capture  trusted UI   │
└──────────────────────────┬────────────────────────────────────┘
                           │ versioned host RPC
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                      TOOLKIT SERVER                           │
│                                                               │
│ ArtifactVersion                                               │
│ View                                                          │
│ Draft + revisions                                             │
│ Submission (immutable)                                        │
│ ReviewSet + ReviewThread                                      │
│ ActionRun                                                     │
│ LiveSource                                                    │
│ Event stream                                                  │
│                                                               │
│ optional collaboration provider: Yjs / future Automerge       │
└──────────────┬───────────────────────────────┬────────────────┘
               │                               │
      trusted shell origin             artifact origin
               │                               │
┌──────────────▼──────────────┐     ┌──────────▼───────────────┐
│ review / trusted controls  │     │ arbitrary React/TS       │
│ candidate comparison       │◄───►│ canvas / web app / TUI   │
│ annotation overlay         │ msg │ loaders / actions / live │
└─────────────────────────────┘     └──────────────────────────┘
```

The durable event flow is:

```text
human edits field
      ↓
draft mutation(expectedRevision, mutationId)
      ↓
canonical persistence
      ↓
draft.changed
      ↓
all tabs

human clicks agent-authored action
      ↓
ActionRun(requestId)
      ↓
started/progress/output/completed
      ↓
browser + host event port
      ↓
optional "notify agent"

human creates comment
      ↓
ReviewThread(anchor + visual fallback + version)
      ↓
review.thread.created
      ↓
all review surfaces / host

human clicks trusted Submit
      ↓
host-shell invocation
      ↓
canonical draft + exact View
      ↓
immutable Submission
      ↓
submission.created
      ↓
host durable-answer storage / agent harness
```

The most important invariants should be treated as public API guarantees:

```text
A draft revision is monotonically ordered by its authority.

A mutation ID is idempotent.

A submission never changes after creation.

A submission names the exact artifact version/view it represents.

Selection/approval/submission/action invocation are transactions,
not CRDT merge operations.

Every durable event has a stable ID and replay cursor.

A browser tab is never itself the durable authority.

Review comments always retain a visual fallback anchor.

Cross-origin surfaces are opaque unless they voluntarily implement
the review bridge.

Trusted controls are not rendered in an origin controlled by
agent-authored artifact code.

Possessing an artifact capability authorizes use of that artifact;
unrelated websites cannot invoke it merely because its server is local.
```

This architecture leaves the system maximally extensible. A plain questionnaire needs no CRDT and no cloud service. A collaborative whiteboard can opt into Yjs. A Postgres dashboard can use Electric. A Zero application can bring its existing reactive data layer. A hosted team deployment can implement the same ports with Liveblocks or another backend. A Rust agent harness can own final answers and trusted approval UI without becoming coupled to React internals.

Most importantly, none of those integrations changes what an artifact fundamentally is: **ordinary React/TypeScript authored by an agent, backed by a small state/action/event runtime whose trust boundaries are explicit rather than encoded as capability restrictions.**