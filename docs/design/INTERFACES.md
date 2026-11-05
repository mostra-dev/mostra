# Mostra interfaces

**Status:** Settled v1 interface specification (C03-A). Shapes come from approved decisions; this document fixes names, types and semantics so work packages implement one contract. Type sketches are normative in meaning and illustrative in syntax: a WP may rename a private helper, but a public name, field or semantic changes only by updating this document (and DECISIONS.md where a decision is affected). Every public surface here is semver or dated-revision surface (D32, STANDARDS versioning). Agent-facing prose (descriptions, help, hints) is drafted with Mirza separately (D69) and is not fixed here.

## 1. Conventions

- **Identifiers.** Prefixed, opaque strings, never parsed by callers:

  | Prefix | Entity | Form |
  |---|---|---|
  | `art_` | artifact | ULID |
  | `ver_` | version | 26 characters of Crockford base32 SHA-256 (DATA_MODEL §2, D77), so content-addressed |
  | `vw_` | view | ULID |
  | `vwr_` | viewer | ULID |
  | `sub_` | submission | ULID |
  | `dlv_` | delivery (one submission to one host, D105) | ULID |
  | `run_` | action run | ULID |
  | `thr_`, `cmt_` | thread, comment | ULID |
  | `tok_` | capability token | ULID (the secret is separate) |
  | `mut_` | mutation | client-generated ULID |
  | `acct_` | account on a remote server (D165 item 8) | ULID |
  | `hom_` | hosted home on a remote server (D165 item 1) | ULID |
  | `lnk_` | an instance linked to a remote server (D165 item 2) | ULID |
  | `rte_` | a hosted route: one artifact on one hosted home (D165, after the Opus review) | ULID |

  Event cursors are decimal strings of a home-wide integer.
- **Time.** RFC 3339 UTC strings with milliseconds. Durations in flags and manifests are strings like `30m`, `2h` or `24h`.
- **Errors.** Every error, at every interface, is the diagnostic object of §13 (`code`, `severity`, `message`, `hint`, `docs`, optional location and fix). The host protocol wraps it in a JSON-RPC error whose `data` is the diagnostic. The CLI prints it as JSON in `--json` mode.
- **Revisions.** The host protocol and the browser protocol each carry a dated revision (`2026-11-01` style), negotiated at connect and additive within a revision (D32, D59). A receiver reads what it is sent with the wire schemas opened for that rule (`receivable` in `@mostra/protocol`): an enum value or a union member a newer peer added arrives as sent, and a field it added to a strict object is dropped, as the Rust crate reads them; a gate on such a value passes only on one it knows means passing (D152, #45).

## 2. Artifact author API

### 2.1 Files

```text
my-artifact/            or a single page.tsx / page.mdx
  index.tsx | index.mdx entry: default export is the page; manifest literal or frontmatter
  pages/                optional routes (D57): pages/index.tsx, pages/settings.tsx …
  actions.ts            any module starting with "use server" (name is free)
  live.ts               live sources (fixed name, D56)
  components/ui/        optional copies of kit components (D65)
  public/               static assets served as-is
```

The conventions WP-03 fixed:
- **Entries.** A single-file artifact is any `.tsx`, `.jsx` or `.mdx` file. A directory's entry is exactly one of `index.tsx`, `index.jsx` and `index.mdx` (`MOSTRA_ARTIFACT_NO_ENTRY`, `MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS`).
- **Pages (D57).** Every `.tsx`, `.jsx` and `.mdx` file under `pages/` is a route: `pages/index.tsx` is `/`, `pages/settings.tsx` is `/settings`, `pages/reports/index.tsx` is `/reports`, `pages/reports/[id].tsx` is `/reports/:id` and `pages/docs/[...rest].tsx` is `/docs/*`. With `pages/`, the entry's default export is optional and, when present, is the layout every page renders inside, receiving the page as `children`. Without `pages/`, the entry's default export is the page (`MOSTRA_ARTIFACT_NO_PAGE` when it has none).
- **Imports.** Relative and absolute imports stay inside the artifact: one that resolves outside it is refused (`MOSTRA_BUILD_UNRESOLVED`), because no digest would cover its bytes. `@/…` resolves from the artifact's root, so `@/components/ui/button` finds a copied component (ROUND-3 §1.1). Packages resolve from the warm set (D91) and the artifact's lockfile (D95): a package the artifact imports that isn't warm installs on demand into the home's store (or, under the `explicit` dependency policy, is `MOSTRA_DEP_MISSING` until `deps/add` adds it), and a package found anywhere else, such as a `node_modules` above the home, is refused with `MOSTRA_BUILD_UNRESOLVED`, also when a package imports a dependency it doesn't declare. Builds read no configuration from outside the artifact: Mostra writes its own `tsconfig.json` and `package.json` at the build's root and configures PostCSS inline, so no `tsconfig.json`, PostCSS config or `package.json` above the home is used or run. Nothing needs a `package.json` or a config file (AU-03), and a publish writes nothing into the artifact's directory.
- **Styles.** Every build includes Tailwind CSS 4 (its preflight and the utilities the artifact uses, scanned from its files) as the baseline the kit is built on (D68); an artifact's own CSS imports apply after it.
- **Server code.** Every module whose first statement is `"use server"` exports only async functions (`MOSTRA_ACTION_EXPORT_INVALID` otherwise). Client code that imports it gets stubs carrying each function's ID, `<module path>#<export>`; the bodies go only into the server bundle (`server/entry.mjs`, which exports `functions` by ID and `live`).

### 2.2 Manifest

```ts
export const artifact = defineArtifact({
  id?: string;                       // written by `mostra new`; else bound to the path at first publish (D51)
  title: string;
  description?: string;
  family?: "questionnaire" | "proposal" | "prototype" | "review" | "dashboard" | "deck" | "demo" | "inbox" | "tasks" | (string & {});
  links?: { rel: "round-of" | "follows" | "replaces" | (string & {}); artifact: string }[];
  mode?: "spa";                      // D19; "rsc" later
  submission?: { policy: "once"; scope?: "per-artifact" | "per-viewer" } | { policy: "epochs" } | { policy: "none" }; // requested; host decides (D39, D63)
  kit?: { base?: "base" | "radix"; theme?: string };   // default "base" (D72)
  terminals?: Record<string, { command: string[]; cwd?: string; env?: Record<string, string>; cols?: number; rows?: number; input?: boolean }>;
  demos?: Record<string, { command: string[]; cwd?: string; ready?: string; bridge?: boolean } | { attach: number; bridge?: boolean }>;
  limits?: { heapMb?: number; watchdogMs?: number; idleMinutes?: number };
  verify?: { viewports?: string[]; frames?: string[]; extraChecks?: string[]; smoke?: boolean };
  tally?: { field: string; choices: string[]; minTotal?: number }[];   // D165 item 12: counts by choice (§18.4)
  hosted?: {                                       // D165: how the artifact behaves on a remote server (§18)
    offline?: { actions?: "queue" | "fail"; limit?: string };   // item 4: default queue, "24h", at most "7d"
    actions?: "signed-in" | "link";             // D159: who may trigger relayed actions; default "signed-in"
    submissions?: "link" | "signed-in";         // item 13: who may submit; default "link" (anonymous viewers too)
    preview?: "generic" | "title";              // D161: link previews; default "generic"
  };
});
```

Mostra reads it statically, so every value must be a literal (`MOSTRA_MANIFEST_NOT_LITERAL` otherwise, with the location of the first value that needs evaluation); `as const` and `satisfies` are fine. `defineArtifact` is imported from `@mostra/react`. An entry without a manifest publishes with defaults, its title taken from its directory's name (or a single file's own name). A manifest that is present needs a `title`, and its `id` is an artifact ID (`art_` and a ULID); values the manifest doesn't allow are `MOSTRA_MANIFEST_INVALID`, and unknown keys are `MOSTRA_MANIFEST_UNKNOWN_KEY` warnings. `{port}` in a demo command is replaced with the leased port. MDX uses the same fields as YAML frontmatter, and decks add `deck:` (D65).

### 2.3 `@mostra/react` (client runtime)

```ts
// Persisted value with a stable ID (D52). Behaves like useState.
function useField<T>(id: string, initial: T, options?: FieldOptions<T>): [T, (next: T | ((prev: T) => T)) => void, FieldMeta<T>];
interface FieldOptions<T> {
  label?: string; required?: boolean; sensitive?: boolean;
  validate?: StandardSchema<T> | ((v: T) => string | undefined);   // any Standard Schema, Zod 4 included
  scope?: "viewer" | "artifact";     // D63; artifact = shared state
}
interface FieldMeta<T> {
  save: "saved" | "saving" | "offline" | "conflict" | "readonly"; // readonly: static export or submitted under `once`
  error?: string;                    // validation message
  conflict?: { theirs: T; keepMine(): void; takeTheirs(): void };
  updatedBy?: { kind: "viewer" | "agent" | "host"; name?: string }; // artifact scope
}

function useSubmit(): {
  submit(): Promise<SubmitResult>;   // only where the host allows the artifact channel (D40); else throws MOSTRA_SUBMIT_CHANNEL_DENIED
  allowed: boolean;
  blockers: { fieldId: string; label?: string; reason: "required" | "invalid" | "conflict" }[];
  state: "open" | "submitting" | "submitted" | "delivered" | "pending-delivery" | "undeliverable" | "closed";
  submission?: { id: string; at: string };
};
function useSubmitControl(options: { label?: string; confirm?: string }): void; // relabels the shell's trusted Submit
function useSignal(name: string): { send(payload?: Json): Promise<void> };

function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, options?: { key?: string }): {
  run(...args: A): Promise<R>;       // joins an in-flight run for this hook instance or key (D54)
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  isPending: boolean; data?: R; error?: { code: string; message: string };
  progress?: { fraction?: number; message?: string }; log: string[];
  partial: unknown[];                // items an AsyncIterable result yielded so far (D130)
  cancel(): void; runId?: string;
};                                   // status also has "waiting" (a relayed run waiting for its owner) and
                                     // "unknown" (its owner never reported its end within the offline limit), D165 item 4

function useLive<K extends keyof LiveSources>(key: K, options?: { mode?: "latest" | "append"; window?: number }): {
  data: LiveSources[K] | undefined; isLoading: boolean; error?: Error; refresh(): void; revision?: string; at?: string;
};

function useChoice(reviewSetId: string, options?: { candidates?: { id: string; label?: string }[]; current?: string }):
  { choice?: string; choose(candidateId: string): Promise<void> }; // channel rules as useSubmit; candidates ask for the trusted Choose (D113)
function useViewer(): { id: string; name?: string; source: "local" | "tailnet" | "token" | "host" | "account" | "anonymous"; verified?: boolean }; // account and anonymous: hosted links (D165 item 8)
function useArtifact(): { id: string; versionId: string; version: number; viewId: string; mode: "live" | "static" | "mcp-app" | "verify" };

declare global { interface Window { storage: ClaudeCompatibleStorage } } // D53
```

Rules:
- All hooks work in every delivery target. In static export, fields keep values in local storage, and `submit`, actions and live data report `MOSTRA_TARGET_UNAVAILABLE`. Inside MCP Apps they use app-only tools (§12).
- Saves are optimistic and debounced (about 400 ms). They flush on blur, `visibilitychange`, `pagehide` and before submit (IN-02).
- The runtime registers fields, actions, review surfaces and the current page with the shell (§5). Every kit input takes a required `id` and binds through `useField`.
- `LiveSources` is augmented by a generated `mostra-env.d.ts` from `typeof import("./live")` (D56).

What WP-07 fixed while building it:
- **`useField`** takes its type from `initial`, as `useState` does (`options` doesn't narrow it), and stores nothing until the value changes. Before any submit, through either channel, the runtime writes the initial value of every mounted viewer field the draft has never stored and flushes every save (D110). A conflict keeps the viewer's value on screen with `conflict.theirs` beside it; `keepMine()` writes it again on the newer revision, `takeTheirs()` drops it. A save the gateway refuses keeps the value, with `save: "offline"` and the refusal in `error`.
- **`useSubmit().submit()`** resolves with the `SubmissionSummary` and rejects with a `MostraError` carrying the diagnostic's `code`: `MOSTRA_SUBMIT_CHANNEL_DENIED`, `MOSTRA_SUBMIT_BLOCKED` (with the blockers), `MOSTRA_SUBMIT_POLICY_NONE`, `MOSTRA_SUBMIT_ALREADY`, `MOSTRA_SUBMIT_REVISION_MOVED`. `state` follows the submission's deliveries; under `none` it is `closed`.
- **The journal.** Every edit is written to IndexedDB (`mostra`/`journal`, per artifact origin) before it is sent, keyed by viewer, tab and view, and promoted to a mutation with its ID and base revision when it is sent. A page replays its own entries and those of closed tabs (Web Locks tell which tabs are open; a BroadcastChannel roll call where Web Locks are missing) in order, each against the view it was made in (FAILURE_MODEL §5). A BroadcastChannel per artifact and viewer carries acknowledged revisions between tabs only to cut latency.
- **`@mostra/react/form`** is `useForm(options & { id, labels?, scope?, sensitive? })`: react-hook-form's own hook. Each answer is persisted as `<id>.<path>`, a field array as one answer (`<id>.items`), so a row removed is gone from it; every change is saved, a `reset()` too, so a submit sends what the viewer sees. Its `required` rules and validation errors (run before either channel's submit) are the submit's blockers.
- **`@mostra/react/router`** holds `mountRoutes`, which the generated entry calls for `pages/` (D57, D111): browser history behind the gateway, hash history when the page carries `<meta name="mostra-target" content="static">`, memory history for `mcp-app`. Every navigation is reported to the shell (`mostra/page`).
- **`window.storage`** is installed by the generated entry (D53, D112): `get`, `set`, `delete` and `list`, each with `shared`; keys are the fields `storage.<key>` of the viewer's draft or, with `shared`, of the artifact state.

What WP-08 fixed (D129, D130):
- **`useAction`** records every call as a run before it starts; while the hook's run is in flight a second call joins it, and with a `key` every call anywhere joins the one run of that key, which a page that loads later finds again (`runs/attach`). `run()` resolves with the result, or rejects with a `MostraError` (`MOSTRA_ACTION_THREW`, `MOSTRA_ACTION_CANCELLED`, `MOSTRA_ACTION_INTERRUPTED`, `MOSTRA_RUNTIME_WORKER_PARKED` …); a start the network lost is retried with the same client key, so it starts one run. Progress, log lines and partial results arrive on the page's stream as ephemeral messages; a page that misses one reads the run again.
- **`useLive`** reads a source and keeps its producer running while a component shows it (a one-minute interest, renewed every 20 s); every component showing a key shares one value, an older revision never replaces a newer one, and a producer's failure sets `error` while the last good value stays. `{ mode: "append", window }` keeps the last `window` values (default 1024) from the source's ring. `refresh()` asks the producer to load again now.
- **Types.** `LiveSources` is an empty interface artifacts augment; the builder writes the declaration beside its generated files from `live.ts` (`LiveValuesOf<typeof import("./live")>`), so client code never imports server code. Without it, keys are strings and values `unknown`.
- **Server references** call through the page's runtime (`setServerCallback`, which `mountArtifact` installs): a plain call, its result streamed back (D54); outside a live page they reject with `MOSTRA_TARGET_UNAVAILABLE`.
- **`"use client"`** heads every entry and module of `@mostra/react` that renders or holds page state (D19 seam 4).

**Team hooks** (D121). *Deferred decision* for WP-31, which names and specifies them (WP-28 reserves their place): a respondent-status hook (each expected respondent's state: not opened, drafting, submitted; options include `useRespondents()`), a presence hook with opt-in cursor and selection sharing as ephemeral traffic (options include `usePresence()`), and the attribution of artifact-scoped fields (who last changed each and when), for which `FieldMeta.updatedBy` is the starting point. Every addition is additive to this section. D165 item 16 reserves the same places for hosted links; the remote server's outbound invitation port is reserved in §18.6.

### 2.4 `@mostra/server` (worker side)

```ts
// Available inside "use server" functions and live producers (AsyncLocalStorage, D19 seam 3).
function dryRun(): boolean;                                     // D55; true only during verify's smoke test
function progress(p: { fraction?: number; message?: string }): void;
function log(line: string): void;                               // action-run log (1 MB cap, D47)
function secret(name: string): string;                          // D44; throws MOSTRA_SECRET_MISSING
function signal(name: string, payload?: Json): void;            // signal.raised with causation = this run
function emit(type: `host.${string}`, payload?: Json): void;    // a host event (AC-05)
function viewer(): { id: string; name?: string } | undefined;   // undefined in live producers
const abortSignal: AbortSignal;                                 // cancellation (AC-04)
const state: {                                                  // artifact-scoped fields (D63)
  get<T>(id: string): Promise<T | undefined>;
  set<T>(id: string, value: T, options?: { mutationId?: string; baseRevision?: string }): Promise<{ revision: string }>;
  patch(ops: { id: string; value?: Json; delete?: true }[], options?: { mutationId?: string; baseRevision?: string }): Promise<{ revision: string; conflicts: string[] }>;
};

function defineLive<T>(source: {
  load?: () => Promise<T>;
  refresh?: string;                         // "5s" … "24h"
  watch?: string | string[];                // globs relative to the artifact source
  stream?: (signal: AbortSignal) => AsyncIterable<T>;
  always?: boolean;                         // run without viewers (D63)
  ring?: number;                            // keep the last N values for append mode (AC-08)
}): LiveSource<T>;
```

What WP-08 fixed (D129, D131): `secret()` is synchronous and reads the host's `secrets` port, then the artifact's secrets, then the home's, else throws `MOSTRA_SECRET_MISSING`; `signal()` and `emit()` take names of 1 to 64 letters, digits, `.`, `_` and `-` (`submit` is reserved) and JSON payloads of at most 64 KiB, else `MOSTRA_SUBMIT_SIGNAL_INVALID` or `MOSTRA_ACTION_EVENT_INVALID`; `state.set` throws `MOSTRA_FIELD_CONFLICT` when the field changed after `baseRevision`, and a write without `mutationId` gets one of its own; errors these functions throw are `MostraServerError`s with a `code`. `abortSignal` listeners run in the call that added them. `console` output in a call goes to its run's log. `defineLive` needs `load`, `stream` or both; `refresh` is `1s` to `24h`; `ring` is a positive integer. A source's key is its export name in `live.ts`.

Server functions are ordinary async exports of `"use server"` modules. Arguments and results use React's Server Function type set plus `AsyncIterable` results (D54), with two refinements (D136): an argument can't be a registered symbol (React 19.3's reply codec refuses it too; `Symbol.for` would keep the name for the life of the worker) or a bigint of more than 10,000 digits, and a typed-array subclass such as Node's `Buffer` crosses as its built-in base (`Uint8Array`). Anything else is `MOSTRA_ACTION_UNSERIALIZABLE`, naming the argument. Thrown errors reach the page as `{ code: "MOSTRA_ACTION_THREW", message }`, with the stack in the run log.

## 3. Kit

The kit surface is in [rounds/ROUND-3.md](rounds/ROUND-3.md) §1 to §5 (D65): component resolution and `mostra add`, the warm and on-demand sets, tokens, `@mostra/kit/questionnaire`, `/review`, `/motion`, `/deck`, `/terminal`, `/charts` and `/demo`. Two rules are interface-level:
- Every persisted kit input takes `id` and binds through `useField`.
- Every kit visual reads the token variables, and accepts `className` and copy-source editing (D68).

## 4. Browser protocol (client runtime ↔ gateway)

Internal to Mostra, but immutable versions embed the client runtime, so this is a dated, additive protocol. A gateway serves every revision it ever shipped (FAILURE_MODEL §7). All paths sit under `/_mostra/` on the artifact origin.

| Method and path | Purpose | Auth |
|---|---|---|
| `GET /_mostra/enter?ticket=…` (cookie mode) or `/_mostra/enter#t=…` (worker mode, D70) | Exchange a frame ticket for the frame session; cookie mode answers 303 to `/` with the session cookie (D98) | ticket |
| `GET /_mostra/session` | The frame session's facts for same-origin code: `{ csrf, artifactId, shellOrigin, scopes, version? }`; the client runtime learns the shell's exact origin for the bridge here (WP-05) | session |
| `GET /*` | The version's client build: the version the frame session last entered, `/assets/*` of any version of the artifact, and `index.html` for a navigation to any other path (D57, D98) | session |
| `GET /_mostra/sw.js` | Worker-mode service worker (`Service-Worker-Allowed: /`) | none |
| `POST /_mostra/enter` (worker mode) | `{ ticket }` → `{ session, shellOrigin }`: the bootstrap page's exchange of the frame ticket for a frame-session secret, which the worker then sends as `X-Mostra-Frame` (D70, D158 item 5) | ticket |
| `POST /_mostra/v/{rev}/fields` | Mutations: `{ mutationId, scope, baseRevision, viewId, ops[] }` → `{ revision, applied[], conflicts[] }` | session, CSRF, Origin, `draft` scope |
| `POST /_mostra/v/{rev}/submit` | `{ viewId, expectedRevision, channel: "artifact" }` → submission or typed conflict | session, `submit` scope |
| `POST /_mostra/v/{rev}/signal` | `{ viewId, name, payload }` | session, `signal` scope (D97) |
| `POST /_mostra/v/{rev}/call/{fnId}` | Plain server-function call (Mostra serializer; streamed body for `AsyncIterable`) | session, `action:<name>` scope |
| `POST /_mostra/v/{rev}/runs` | Start or join a run: `{ fnId, args, key?, clientKey }` → `{ runId }` | as above |
| `POST /_mostra/v/{rev}/runs/attach` | Read runs and follow them for a minute: `{ viewId, runIds?, keyed?: { fnId, key }[], held?: { runId, log, batches }[] }` → `{ runs: RunState[] }`; a run the page holds part of answers from there (`logFrom`, `batchFrom`) (WP-08, D136) | as above, filtered per run |
| `POST /_mostra/v/{rev}/runs/{id}/cancel` | Cancel: `{ viewId }` → `RunState` | as above |
| `POST /_mostra/v/{rev}/live` | Read live sources and keep their producers running for this view for a minute: `{ viewId, keys: { key, window?, refresh? }[] }` → `{ sources: LiveState[] }` (WP-08) | session, CSRF |
| `POST /_mostra/v/{rev}/ticket` | `{ purpose: "stream" \| "socket" }` → `{ ticket, expiresAt }`: a single-use ticket (60 s) for one event stream, long poll or WebSocket, which bypasses the worker (worker mode, terminals; D158 item 5) | session, CSRF |
| `GET /_mostra/v/{rev}/events?view=…&cursor=…` | SSE: field changes, state, runs, live, version notices, delivery states | session or ticket |
| `GET /_mostra/v/{rev}/events/poll?view=…&cursor=…&wait=25` | Long-poll on the same cursor (D47) | same |
| `POST /a/{artifactId}/_mostra/v/{rev}/review/*` (on the shell origin) | Shell only: comments, crops, choices | shell session, `review` scope |
| `GET /_mostra/v/{rev}/term/{session}` (WebSocket) | Live terminal frames: `data`, `resize`, `input`, `ack`, `exit` | ticket |
| `POST /a/{artifactId}/_mostra/v/{rev}/submit` (shell origin) | The trusted Submit: `ShellSubmitRequest` `{ viewId, expectedRevision }` → `SubmissionSummary`, recorded on the `shell` channel (D40) | shell session, CSRF, `submit` scope |
| `POST /a/{artifactId}/_mostra/v/{rev}/review/choose` (shell origin) | The trusted Choose: `ChooseRequest` `{ viewId, mutationId, baseRevision, reviewSetId, candidateId, label? }` writes the review set's choice field on the `shell` channel (D113) | shell session, CSRF, `review` scope |
| `POST /a/{artifactId}/_mostra/v/{rev}/follow` (shell origin) | `FollowRequest` `{ follow }`: the viewer's "Always follow this artifact" (D63) | shell session, CSRF |
| `GET /a/{artifactId}/_mostra/v/{rev}/carry?version=…` (shell origin) | `CarryOver` `{ version, orphans: OrphanedField[] }`: the viewer's answers that version doesn't cover (D42, D109), for the banner's count and the "Not carried over" panel | shell session |
| `GET /a/{artifactId}/_mostra/v/{rev}/events` and `/events/poll` (shell origin) | The same stream and long poll as the frame's, for the shell's own view of the draft, deliveries and versions: the trusted banner and receipt never depend on the frame | shell session |

**The first revision, `2026-10-15`** (WP-06, D106; `BROWSER_PROTOCOL_REVISIONS` in `@mostra/protocol`). Its payloads are the Zod schemas `FieldsRequest`, `SubmitRequest`, `SignalRequest`, `StreamSnapshot` and `PollResult`; a revision the gateway never shipped answers 404 `MOSTRA_HYGIENE_NOT_SERVED`. Every request names the page's `viewId`, the view the shell's ticket recorded (D104), and acts as the link's viewer.
- **`fields`.** `scope: "viewer"` writes the session viewer's draft, `"artifact"` the artifact state; ops whose field changed after `baseRevision` come back in `conflicts` with what the field holds now, the others apply under one new revision. A body may be up to 17 MiB (a document's 16 MiB and the envelope).
- **`submit`** answers the `SubmissionSummary`, with `duplicate: true` when it repeats an earlier submit of the same view and revision. Under a closed `once` it is 409 `MOSTRA_SUBMIT_ALREADY` with the existing `submission` beside the diagnostic (H-02); a moved draft is 409 `MOSTRA_SUBMIT_REVISION_MOVED`; policy `none` is 409 `MOSTRA_SUBMIT_POLICY_NONE`. A draft a `once` submission closed refuses `fields` writes the same way; artifact state stays writable.
- **`signal`** takes a name of letters, digits, `.`, `_` and `-` (`submit` is reserved) and a JSON payload of at most 64 KiB; it answers `{ cursor }`.
- **`events`** is `text/event-stream`. Without a cursor its first message is `event: snapshot` (a `StreamSnapshot`: cursor, viewer, draft, artifact state, and the submission that closed or last ended the viewer's draft); then each durable event the page may see is `event: mostra` with `id: <cursor>` and the `EventRecord` as data. A reconnect sends `Last-Event-ID` (or `?cursor=`) and gets every event after it; a cursor inside a compacted range gets a fresh snapshot instead. A page never sees another viewer's draft events, signals or views (D104). Idle streams send a comment every 15 s, and a stream ends when its link is revoked.
- **`events/poll`** answers `PollResult` on the same cursor, waiting up to `wait` seconds (0 to 25) for an event; without a cursor it answers the snapshot. A poll whose link is revoked or expires while it waits answers 410 `MOSTRA_HYGIENE_TOKEN_REVOKED` and nothing it read. Both resume from the newer of `?cursor=` and `Last-Event-ID`, since an `EventSource` reconnects to the URL it opened with the last ID it received. The stream reads a page of events only when the client took the last one. Pages see other viewers' changes with their display name but without their viewer and view IDs, and a page names only views its own link opened (`MOSTRA_SUBMIT_VIEW_INVALID`).
- **What WP-07 added to `2026-10-15`**, additively (D111): the shell-origin routes above; `StreamSnapshot.latest`, the artifact's latest version, so a reader that missed a `version.published` still learns of it; `SubmissionSummary.deliveries` (each with `waiting: true` while its host is away or its first attempt failed, `submission.retrying` appended once); and `MOSTRA_SUBMIT_CHANNEL_DENIED` (403) on the frame's `submit`, and on its `fields` writes to a review set's choice, where the view doesn't allow the artifact channel (D108). Every revision the gateway serves has a version frozen at it in `packages/runtime/test/fixtures/browser-revisions/`, run in CI against the current gateway and one serving a newer test-only revision (VR-10).
- **What WP-08 added to `2026-10-15`**, additively (D130): the `call`, `runs`, `runs/attach`, `runs/{id}/cancel` and `live` payloads (`CallRequest` and NDJSON `CallLine`s, `RunRequest`, `RunAttachRequest`, `RunCancelRequest`, `RunState`, `LiveRequest`, `LiveState`); ephemeral messages on the stream (`event: run` with a `RunDelta`, `event: live` with a `LiveUpdate`, neither with an `id`) and in `PollResult.ephemeral`, never stored; and `FrameTicket.serverParked`. A `call` answers 200 with NDJSON once its worker has started, then one `{ batch }` line per serialized batch and a final `{ end: { status: "succeeded" | "failed", error? } }`; refusals before that are the diagnostics as JSON: 400 for malformed arguments or `MOSTRA_ACTION_UNSERIALIZABLE`, 404 `MOSTRA_ACTION_UNKNOWN_FUNCTION`, 413 `MOSTRA_ACTION_TOO_LARGE`, 503 `MOSTRA_RUNTIME_WORKER_PARKED` or `MOSTRA_RUNTIME_WORKER_CRASHED`. Every route checks the view, the action scope of the function it names (D97 item 4), the arguments' frames (`checkArgumentFrames`) and that the function exists in the view's version, before a run is recorded or a worker starts; `runs/attach` answers only runs whose function the link may run. A page's stream carries `action.*` events only for runs it may see, a signal from server code only to the viewer whose call raised it, no `host.*` event, and `worker.crashed` without its `cause` (D136).
- **What WP-13 added to `2026-10-15`**, additively (D158): worker-mode frame sessions (`FrameTicket.mode: "worker"` with `src` at `/_mostra/enter#t=<ticket>`, the bootstrap page, `POST /_mostra/enter`, `/_mostra/sw.js`, the `X-Mostra-Frame` header in place of the cookie); stream tickets (`POST /_mostra/v/{rev}/ticket`, and `?ticket=` on `events` and `events/poll`, which a ticket authenticates instead of the session; single-use, 60 s, good only for the purpose, origin and artifact they were minted for, at most eight outstanding per session, the oldest dropped); `/_mostra/session` reports `mode` (`cookie` or `worker`) and `streams` (`false` behind a quick tunnel, where the page long-polls from the start); every event stream opens with `event: ready` before anything else, so a page that hears nothing within 6 s long-polls instead (a proxy or tunnel holds the stream back); an event stream in worker mode without a ticket, or on a face streams don't pass, is refused (503 `MOSTRA_HYGIENE_NOT_SERVED`), so every client, published versions included, falls back to long polling at once.
- **What WP-14 added to `2026-10-15`**, additively (D162 item 8): `LiveState.awaiting` is `true` while a source has no value and no failure and the artifact's latest version has a producer whose first `load` is on its way, and a `live` update with `awaiting: false` says a source read that way only streams. `useLive` is loading, and verify waits for it, only while that holds; a key only `mostra push` writes, or a source that only streams, is never waited for.
- **What the remote server adds** (D165; WP-29 and WP-30 build it, additively): on a hosted host the shell's exchange sets no cookie and answers the session secret, which the shell sends as `X-Mostra-Shell`, and frames always use worker mode; every `Cookie` header is dropped unread. `RunState.status` gains `waiting` (a relayed run waiting for its owner) and `unknown` (no end reported within the artifact's offline limit), `RunState.ownerUnreachable` marks a running run whose owner is out of reach, and `reason` gains `owner-offline`. `LiveState.ownerOffline` marks a value its producer can't refresh while the owner is offline. The reserved live key `$tally/<fieldId>` carries a tally (§18.4). `SubmissionSummary.deliveries` is absent for a respondent on a hosted link (D165 item 1a). New refusals: 423 `MOSTRA_SUBMIT_PAUSED` and, for a relayed action on a paused artifact, 423 `MOSTRA_ACTION_PAUSED`, 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`, 403 `MOSTRA_REMOTE_LIMIT_REACHED`, 503 `MOSTRA_REMOTE_OWNER_OFFLINE` and `MOSTRA_REMOTE_QUEUE_FULL`, 403 `MOSTRA_REMOTE_SIGN_IN_REQUIRED` (§18.4).
- Refusals are the diagnostics as JSON: 400 for a malformed body or an invalid field ID or signal, 403 `MOSTRA_SUBMIT_VIEW_INVALID` for a view of another viewer or artifact, 409 as above and for `MOSTRA_FIELD_MUTATION_ID_REUSED`, 413 `MOSTRA_FIELD_TOO_LARGE`.

The shell origin has its own endpoints for capability exchange, trusted-control activation, the banner, follow preferences and review, all with the same checks. Mutations require JSON content types and the CSRF header (seed hygiene items 5 and 11). WP-05 serves these on the shell origin, each artifact under `/a/{artifactId}`, so each has its own shell session (D97, D98):

| Method and path | Purpose | Auth |
|---|---|---|
| `GET /a/{artifactId}` and `/a/{artifactId}/v/{number}` | The shell page; the link's token is in the fragment (`#t=…`), which the page sends to the exchange and removes | none |
| `GET /_mostra/shell/assets/*` | The shell's built files | none |
| `POST /a/{artifactId}/_mostra/session` | Exchange `{ token, replace?, browser? }` for the shell session (`browser`: the shell's random key in its origin's storage, so two exchanges of one browser that overlap, such as while a host's identity port answers, still meet D98 item 8's conflict; WP-12) → `{ csrf, artifact: { id, title }, scopes, expiresAt?, version? }`. While a live session from another link exists, 409 `MOSTRA_HYGIENE_SESSION_CONFLICT` with `current` and `offered` (`{ scopes, expiresAt?, version? }` each) unless `replace` is `true`; the same link again reuses its session (D98 item 8) | token, Origin |
| `GET /a/{artifactId}/_mostra/session` | The same facts for an existing session | shell session |
| `POST /a/{artifactId}/_mostra/ticket` | `{ version? }` → `FrameTicket`: `{ viewId, src, artifactOrigin, version: { id, number }, latest: { id, number } }` and, since WP-07, the view's context (`artifactId`, `policy`, `submitChannels`, `controls`, `target`, `follow`, `pinned`; D108): a single-use frame ticket, and the view this frame load is (D104, WP-06) (60 s, valid while this shell session exists) for the link's version, the asked one or the latest; a link that names a version gets 403 for any other (D97 item 9); a damaged version is 500 `MOSTRA_HOME_INTEGRITY` | shell session, CSRF |

Every route declares its intent (read, stream, upgrade, exchange or mutation), its session and its scope, and one runner applies the checks in one order: Host, request target and headers; Origin and content type; the rate limit on token paths; the session (bound to the origin it was issued for, with a live token); the CSRF token; the scope (D96). A route a later package serves answers 501 `MOSTRA_HYGIENE_NOT_SERVED` once every check has passed. Refusals are the HYGIENE diagnostics as JSON, or a plain page for a navigation: 421 for a Host outside the allowlist, 400 for a malformed request, 401 without a session or with an unknown token, 410 for a revoked or expired one, 403 for another Origin, a missing or wrong CSRF token or a scope the link lacks, 415 for a body not declared as JSON, 429 with `Retry-After` while guessing for the artifact is limited, 409 when another link's session is open, 431 with `Clear-Site-Data: "cookies"` for headers past 1 MiB, and 404 or 405 for what isn't served. Every response carries `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; none carries an `Access-Control-*` header. The shell page sends `frame-ancestors 'none'`, `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`, and artifact documents `frame-ancestors <shell origin>`; the shell sandboxes the frame with every capability but navigating the viewer's tab (D98 item 7).

## 5. Shell ↔ artifact bridge

JSON-RPC 2.0 over `postMessage`, with exact origin checks and schema validation. It uses MCP Apps names where the concept exists (SH-04, D65). The full message set is in [rounds/ROUND-3.md §8](rounds/ROUND-3.md#8-shell-and-bridge-sh1), plus:
- `mostra/fields` carries `{ fields: { id, label?, required?, scope, sensitive?, error?, conflict? }[], save, unsaved }`: the mounted fields and the page's save state, so the shell lists blockers by label and shows "Saving" and "Saved". The shell checks `required` against the draft it reads itself.
- `mostra/controls.request` covers `submit` (`label`, `confirm`), `choose` (`reviewSetId`, `candidates`, `current`) and `release`, and answers `{ shown }`. The shell decides what to render (D108): the artifact asks, the shell answers.
- `mostra/flush` (shell → artifact, `{ reason: "submit" | "switch" }` → `{ revision, unsaved, blockers }`): the page saves everything now, writing the defaults the viewer saw first for a submit (D110).
- `mostra/page` (`{ path, title? }`) reports the page of a `pages/` artifact; `mostra/field.focus` (`{ id }`) asks the page to focus a field the shell lists as a blocker.
- `mostra/version.available` carries `{ versionId, version, orphans: number }`: the answers the newer version would leave behind that the view carries. The artifact may show its own notice too, but the trusted banner always appears.
- `ui/initialize` carries `mostra: { versionId }`, the version the page's build belongs to, and its result `mostra: ViewContext`, the view the shell opened; a page whose build isn't its view's version saves nothing and is loaded again at its view's version (D115). The page reads `mostra` as `ViewContextWire`, open to values later releases add, through `readViewContext`: a channel it doesn't know isn't allowed, an unknown policy or `once` scope acts as `once` per viewer, an unknown target as `live`, so a published version never loses its view to a newer shell (Claude review finding 5).
- `mostra/frameSession.entered` and `mostra/frameSession.failed` (`{ code, reason, message }`) come from the worker-mode bootstrap page before any client runtime runs (D70, D158 item 5): the first starts the shell's wait for the page, the second (`MOSTRA_HYGIENE_FRAME_SESSION`, with `reason` `unsupported`, `blocked`, `conflict` or `refused`) shows the viewer what to do instead of a frame that never greets.
- `ui/open-link` (MCP Apps, `{ url }` → `{ isError? }`) is how the artifact sends the viewer elsewhere, since its frame can't navigate the viewer's tab (D98 item 7). The shell opens `http:`, `https:`, `mailto:` and `tel:` URLs (`OPEN_LINK_SCHEMES`) in a new tab without an opener, announced as `hostCapabilities.openLinks`; `openLink(url)` in `@mostra/react` sends it, or opens the URL itself outside a shell. WP-05 ships `ui/initialize`, `ui/notifications/initialized`, `ui/notifications/size-changed`, `ui/open-link` and `mostra/ready`.
- A host-supplied shell implements the same set and passes the shell conformance scenarios.

## 6. Host protocol (clients ↔ supervisor)

JSON-RPC 2.0 over newline-delimited stdio (spawned: `mostra host`, which is the runtime bundle's `mostra-runtime host`, D85) or the home's Unix socket (attached to `mostra-runtime daemon`); on Windows the home's control endpoint is an owner-only named pipe, `\\.\pipe\mostra-<home hash>-<16 random hex>`, fresh on every bind, which clients read from `instance.json` and open like a socket (D150). A third binding, over an authenticated network transport to a remote server (D116, RM-02), is JSON-RPC 2.0 over WebSocket on the server's API origin, with the same methods and rules (§18.2, D165 item 2). Schemas are Zod 4 in `@mostra/protocol`, published as JSON Schema 2020-12, with draft-07 output for typify (D59). Methods are grouped by caller need. Every mutating method takes an optional `requestId` for idempotent retries (H-03): a retry with the same parameters returns the recorded result, and the same `requestId` with other parameters is `MOSTRA_HOST_REQUEST_ID_REUSED` (D100).

**Framing and errors.** Each message is one line of JSON (JSON never contains a raw newline). Revision `2026-10-10` has no batches: a JSON array is answered with an Invalid Request error (D83). Every error's `data` is the diagnostic, and `error.code` is the JSON-RPC code: -32700 for unparseable JSON and -32600 for a message that isn't a valid request (`MOSTRA_HOST_MALFORMED`), -32601 for an unknown method (`MOSTRA_HOST_METHOD_UNKNOWN`), -32602 for params that fail the method's schema (`MOSTRA_HOST_INVALID_PARAMS`), -32603 for an unexpected failure (`MOSTRA_HOST_INTERNAL_ERROR`), and -32000 for every other diagnostic. Clients switch on `data.code`, never on the message.

**Session rules.** `mostra/initialize` is the first request on every connection and is sent once; anything else first, or a second initialize, gets `MOSTRA_HOST_INITIALIZE_ORDER`. Notifications before initialization are ignored.

```text
Session
  mostra/initialize { client: {name, version}, revisions: string[], capabilities: ClientCapabilities, ports: PortName[], home?: HomeConfig }
      → { revision, instance: InstanceInfo, capabilities: InstanceCapabilities, warnings: Diagnostic[] }
  mostra/shutdown {}                       → {}   (the spawning host, or any attached client of a daemon, D87;
                                                  other callers get MOSTRA_HOST_SHUTDOWN_REFUSED)

Authoring
  artifact/create  { dir, template?, title? }       → { artifactId, dir }
  artifact/verify  { source: SourceRef, screenshots?: "on-failure" | "always" | "never", progressToken? } → VerifyVerdict (§13); artifact/progress notifications (WP-09)
  artifact/publish { source: SourceRef, force?, policy?: SubmissionPolicy } → PublishReceipt
  artifact/list    { filter? }                      → { artifacts: ArtifactSummary[] }
  artifact/get     { artifact: ArtifactRef }        → ArtifactDetail (versions, views, policy, links, metadata)
  artifact/export  { artifact, version?, as: ExportClass, out } → { files: string[] }
  deps/add         { artifact: SourceRef, packages: string[] } → { packages: AddedPackage[], lockDigest }   (D95; `mostra add`)

Viewing and sharing
  view/url        { artifact, version?, scopes?, ttl?, viewer?: { ref, name? }, requestId? } → CapabilityLink { url, tokenId, scopes, expiresAt?, viewer? }   (D97, D104)
  view/rotate     { tokenId, requestId? }            → CapabilityLink   (D97; same artifact, scopes, expiry and pinned version; the old token answers 410)
  view/revoke     { tokenId, requestId? }            → {}   (revoking a revoked token succeeds; an unknown one is MOSTRA_HYGIENE_TOKEN_INVALID)
  view/default    { artifact }                       → CapabilityLink   (D140 item 15; the artifact's default link, a new default when it was revoked)
  view/launch     { tokenId }                        → { url, expiresAt }   (D140 item 15; a one-time launch URL for a browser, `…#l=<ticket>`)
  share/start     { artifact, via: "tailnet" | "funnel" | "cloudflare" | "remote", server?, ttl?, scopes?, viewer?, requestId? } → Share & { url }   (D158 item 3; "remote": D165, §18.2)
  share/stop      { shareId } | { artifact }         → { stopped: Share[] }
  share/list      { artifact?, all? }                → { shares: Share[] }

Interaction
  results/get     { artifact, submission?: string, format?: "json" | "md" } → Results (§8), or { submissionId, markdown } for "md"
  wait            { artifact, until: WaitCondition, after?: Cursor, timeoutMs } → { status: "satisfied", event, cursor } | { status: "still_waiting", cursor }
  state/get       { artifact, ids? }                 → { revision, fields }
  state/patch     { artifact, ops, baseRevision?, mutationId, as?: "agent" | "host" } → { revision, applied, conflicts }
  live/push       { artifact, key, value, mode?: "replace" | "append" } → { revision }
  review/export   { artifact, submission?, format: "md" | "json", out? } → { path | content }

Events
  events/subscribe   { filter?: EventFilter, after?: Cursor, name? } → { subscriptionId, cursor }; then notifications events/notify { subscriptionId, events[], cursor }
  events/unsubscribe { subscriptionId }              → {}
  events/ack         { subscriptionId, cursor }     → {}   (durable per subscriber name)
  events/read        { filter?, after?, limit? }    → { events[], cursor }

Administration
  secret/set    { name, value, artifact? }           → SecretEntry { name, scope: "artifact" | "home", artifactId?, updatedAt }   (D131)
  secret/list   { artifact? }                        → { secrets: SecretEntry[] }   (names only; a value is never returned)
  secret/delete { name, artifact? }                  → { deleted }
  instance/status    {}                              → { instance, startedAt, socket, connections, processes, gateway? } (WP-02; `gateway: { bind, shell, artifacts: { artifactId, origin }[] }`, WP-05; `deliveries: { owner, connected, pending, delivered, rejected, undeliverable }[]`, WP-06); ports, shares and versions in use are added by the packages that own them
  gc/run             { dryRun?, compactEvents?: { before } } → { dryRun, versions: { artifactId, versionId, number, bytes }[], snapshots, lockLayouts, storePackages, caches, bytes, compacted?, warnings? }   (D140 items 14, 18)
  instance/check     { deep? }                       → { checks: { name, status: "ok" | "warning" | "error", diagnostic? }[] }   (D140 item 18)

Development (D140 item 12)
  dev/start     { source: SourceRef, port? }         → { url, port, sessionId }; then notifications dev/notify { sessionId, kind, at, diagnostics?, files?, results? }
  dev/stop      { sessionId }                        → {}

Mostra → host (only to the connection that registered the port)
  port/<name>.<method>   see §7
```

`VersionSummary` gains `collected?` (when gc collected the version's files, D140 item 14). `SourceRef` is `{ path }` (an absolute path; clients resolve relative ones) or `{ artifactId }` (the path it was last published from). `ArtifactRef` has the same two forms and names an existing artifact; a path is matched by its real path, so a deleted source's path still names its artifact. `ArtifactSummary` is `{ id, title, description?, family?, links, mode, policy?, source?, createdAt, latestVersion? }`, with metadata from the latest version's manifest; `ArtifactDetail` adds the latest `manifest` and every `VersionSummary` (`{ id, number, publishedAt, sourceDigest, envDigest, outputDigest, forcedDiagnostics? }`), newest first. `artifact/list` takes `filter: { family? }`. `artifact/create` writes a minimal entry with a generated `id` into an empty directory, with an `AGENTS.md` for the agent that edits it next (the loop, its rules, the guide's place, the CLI pinned to this release) and a `CLAUDE.md` that imports it (D162), and returns `{ artifactId, dir, files }` (`files`: `index.tsx`, `AGENTS.md`, `CLAUDE.md`; a retried creation, by this runtime or a newer one, completes each file to the exact bytes the first attempt recorded and leaves one the author changed alone); the artifact appears in `artifact/list` once published, and templates arrive with WP-26. `WaitCondition` is one of `submitted`, `signal:<name>`, `state:<fieldId>` and `event:<type>` (`event:submission.*` matches a family), with the semantics in ARCHITECTURE §6 and D103: `submitted` is level-triggered under `once` (under `per-viewer` only without an explicit `after`, so an agent can wait for the next respondent, D107) and edge-triggered after the cursor under `epochs`, and refused with `MOSTRA_SUBMIT_POLICY_NONE` under `none`; wait conditions for every expected respondent and for N submissions, with a roster-complete event (D121, CO-02), are a *Deferred decision* for WP-31 (options include `submitted:all` and `submitted:<N>`); `after` defaults to the artifact's latest publish; `timeoutMs` is 0 (check once) to 2^31 − 1; `still_waiting` carries the newest cursor examined, and a wait ends `still_waiting` when its connection closes. `events/subscribe` needs the client to accept `events/notify` in `mostra/initialize` (`MOSTRA_HOST_NOTIFICATION_UNSUPPORTED` otherwise); without `after` a named subscriber resumes after its acknowledged cursor, and a new name, like an unnamed subscription, starts now (the history stays readable through `events/read`); a name's filter is the one its latest subscription gave, and its acknowledged cursor counts for that filter. A subscription waits while its connection's output is full, so a slow host never makes the instance buffer without bound. Every events filter takes `artifacts` and `types` (patterns such as `submission.*`), and `artifact.compacted` passes any types filter; a cursor inside a compacted range is `MOSTRA_HOST_CURSOR_COMPACTED` for `events/read`, unless it passes `acceptCompacted: true`: the read then continues through the range, the summary arrives in cursor order among other artifacts' events, and the page that carries it has `compacted` set. Events are delivered in cursor order, a page of at most 100 events and about 8 MiB per notification or `events/read` answer (well inside the 64 Mi-character line limit), continuing exactly where a page stopped. A subscription overtaken by compaction reads through the range the same way: the notification carrying the summary has `compacted: MOSTRA_HOST_CURSOR_COMPACTED`, and other artifacts' events around it arrive without a gap or a repeat. No message of the host protocol is longer than one line may be (64 Mi characters, `MAX_LINE_LENGTH`): an answer that would be is replaced by `MOSTRA_HOST_MESSAGE_TOO_LARGE`. `PublishReceipt` is `{ artifactId, versionId, version, url?, tokenId?, cursor, reused: boolean, forcedDiagnostics?: string[] }`. `artifact/publish` is gated by verify (D41, D138): a verdict with errors refuses it with `MOSTRA_PUBLISH_VERIFY_FAILED` naming their codes (or with the environment's own error when verify couldn't run), and `force: true` publishes and records the error codes in `forcedDiagnostics` and the version manifest's `forcedCodes`; a source that didn't build is refused whatever `force` says. It is durable before the response (H-07). `url` is the artifact's default capability link (D97 item 3): the same across publishes and `requestId` replays until it is rotated or revoked, with `tokenId` to do either. Both are optional on the wire because instances without the gateway (WP-03, before WP-05) have none; WP-05 sets them on every publish (D90). A recorded receipt that a `requestId` replays never holds the link's secret: the link joins every answer from the token. `HomeConfig` lets a spawning host set the submission policy defaults, the allowed submit channels, the dependency policy (`dependencies: "auto" | "explicit"`, D43, D95, kept in the home's `config.json` for every later client), and the ports it will always provide (so deliveries wait for it, FAILURE_MODEL §4); each field arrives with the package that implements it. WP-06 adds `submission` (the home's submission policy, D102) and `ports` (the ports this client always provides, kept per client name; an empty list clears them, D105). WP-07 adds `submitChannels` (`["shell"]`, `["artifact"]` or both; absent: both), the home's submit channels, which a connected `trustedControls` port can replace per view (D108). Its `path` is a check, not a setting (D84): the supervisor resolved and locked its home at process start (`--home`, then `MOSTRA_HOME`, then the platform default; an SDK passes its `home` option as `--home`), and a `path` that names a different home is refused with `MOSTRA_HOME_MISMATCH`.

What WP-08 added (D129 to D133): `secret/set`, `secret/list` and `secret/delete` (D131), which aren't recorded under a `requestId` (setting a value again is idempotent, and a recorded digest of a short secret could be guessed); `live/push` writes a source's value (4 MiB at most, `MOSTRA_LIVE_TOO_LARGE`) under a new revision, `append` adding it to the ring, and creates the source when it doesn't exist; `instance/status` gains `workers` (`{ artifactId, versionId, state: "starting" | "ready" | "backoff" | "parked" | "stopped", pid?, crashes, lastCause?, retryAt?, active }`) and `idleExitAt`, when a daemon would exit if nothing happened. `mostra-runtime daemon --always-on` never exits for lack of work, and `mostra-runtime service install|uninstall|status [--home <path>] [--no-start]` manages the home's login service, printing one JSON line (`{ status: "ok", action, service: { manager, name, file, installed, command } }`, or `{ status: "failed", diagnostic }` with `MOSTRA_ENV_SERVICE_FAILED` and exit 3); `mostra daemon install` (WP-10) runs it (D133). On Windows `manager` is `task-scheduler`, `file` the definition kept at `<home>\service\task.xml`, `command` the launcher `mostra-win-service.exe` and its arguments, and `status` adds `registered`, whether Task Scheduler holds the task (D151).

`deps/add` (D95) takes npm registry specs (`name`, `name@version`, `name@range`, `name@tag`) and records each package at an exact version in the artifact's working lockfile, installing it into the home's store. A package of the warm set is answered with its warm version (`warm: true`), and a version of it the warm one doesn't satisfy is `MOSTRA_DEP_WARM_CONFLICT`. `AddedPackage` is `{ name, version, warm }`; `lockDigest` is the lockfile's digest after the change, which the artifact's next publish uses. Packages added this way stay in the lockfile whether or not the source imports them. The supervisor treats itself as offline when its environment sets `MOSTRA_OFFLINE` (any value but `0`, `false` or `no`) or no network interface has a routable address; offline, packages resolve only from the home's store.

`view/url` mints a new token on every call (D97), for the artifact's latest version or a pinned `version` (a number or a version ID; an unknown one is `MOSTRA_ARTIFACT_VERSION_NOT_FOUND`). `scopes` default to every scope: `view` (always added), `draft`, `submit`, `review`, `signal` and `action:*`; `action:<export>` and `action:<module path>#<export>` grant one action. A link with a `version` opens that version only (D97 item 9), and every link works only at the shell address it was minted for (D97 item 10). `ttl` is a duration such as `30m`, `24h` or `7d`; without one the link doesn't expire (D63). A replayed `requestId` with the same parameters returns the same link (D100). `CapabilityLink.url` is `http://<url host>:<shell port>/a/<artifactId>[/v/<number>]#t=<secret>`.

What WP-13 added (D158):
- **`share/start`** opens the artifact through a tunnel the instance drives and answers the `Share` (`{ shareId, artifactId, via, url, hostname, artifactOrigin?, mode, tokenId, startedAt, expiresAt?, state, stoppedAt?, stopReason? }`, `artifactOrigin` the frame's address over the tunnel while the share is active): `tailnet` (Tailscale Serve, the tailnet's people by name), `funnel` (Tailscale Funnel) or `cloudflare` (a Cloudflare quick tunnel), the last two public. Its link is minted for the tunnel's shell address (D97 item 10) with `scopes` (default every scope) and `viewer` (D104); without a viewer, a tailnet session acts as the tailnet person and any other as the link's own viewer, never the home's local user. Public shares last `ttl`, 1 hour by default and 7 days at most (`MOSTRA_SHARE_TTL_INVALID`); tailnet shares until stopped unless given one. A missing tool is `MOSTRA_SHARE_TOOL_MISSING` with how to install it; Tailscale signed out `MOSTRA_SHARE_TOOL_NOT_READY`; Serve or Funnel off for the tailnet `MOSTRA_SHARE_NOT_ENABLED` with the page that turns it on; Funnel's two artifact ports in use, or a port the device's own Tailscale configuration serves, `MOSTRA_SHARE_PORTS_EXHAUSTED`; a tunnel that doesn't come up `MOSTRA_SHARE_TUNNEL_FAILED`. A `requestId` replays its share. `view/rotate` of a share's link keeps it at the share's address, and the share follows it (`tokenId` and `url` name the replacement); `view/revoke` ends the share within 30 s, as its expiry does; `view/rotate` of a link at a host's external base keeps it there while the gateway serves that address, and moves a loopback link whose shell port moved to the shell's address now.
- **`share/stop`** ends one share, or every active share of an artifact, revoking its link and stopping the tunnels no other share uses; `share/list` lists the active shares, with `all` the ended ones too, each with why it ended (`stopped`, `expired`, `revoked`, `tunnel`, `restart`). An unknown share is `MOSTRA_SHARE_NOT_FOUND`.
- **`instance/status`** adds `shares` (the active ones, which keep a daemon from its idle exit, D133; without their `url`, since status is printed where a link's secret must not appear, and `share/list` gives it) and `gateway.faces` (each face's `by`, `listener`, `artifactId?`, external `origin` and loopback `local`).

What WP-10 added (D140):
- **`view/default`** answers the artifact's default link (D97 item 3), the one every `PublishReceipt.url` carries; when it was revoked, a new default is minted and the old token stays revoked. `view/url` keeps minting a new token on every call. `mostra open` prints it.
- **`view/launch`** mints a single-use launch ticket for a live token: 130 bits, 60 s, kept in memory as a hash, counted by D97 item 8's guessing limit like a token. Its URL is `…/a/<artifactId>[/v/<number>]#l=<ticket>`; the shell sends `{ launch }` instead of `{ token }` to its exchange, which spends the ticket only when it creates or reuses the session (a 409 session conflict leaves it for the viewer's choice). A browser that `mostra open` starts gets this URL, never the link's secret, because a command line is visible to every local user, and gets it inside a page, never on its command line either: the CLI writes a page that redirects to the launch URL (mode 0600, in a fresh directory of mode 0700) and opens the page's path, so no other local user can read the ticket and spend it first (Opus review of WP-10, finding 4; Jupyter's server opens its token the same way). `$BROWSER` is read as `xdg-open` reads it: a `:`-separated list (`;` on Windows, of Windows command lines, D151), `%s` replaced by the page, and `opened` is true only when a browser command started; without it the opener is `open` on macOS, `xdg-open` on Linux and `explorer.exe` on Windows.
- **`gc/run`** (D140 item 14) runs in the supervisor holding the instance's gate alone, so no publish, verify run or install runs beside it. It keeps each artifact's latest version and every version its reference sources name (`REFERENCE_SOURCES` in the runtime's `gc` module: submissions, views, threads, action runs, sessions, live values, review-set fields, live pinned tokens, the newest passing verdict, followed artifacts), records the others in `version_collected` and removes their files after the commit, then source snapshots no kept version shares, lock layouts nothing names (D135; an open `mostra dev` session's lockfile names its layout too, from its resolution until its dev server stops), the store's unused packages (`pnpm store prune` through the install child) and verify's caches past their caps. `dryRun` lists exactly what a run would remove. A step that fails (a file it can't remove, the installer's prune) leaves that step's files and becomes a `MOSTRA_HOME_GC_INCOMPLETE` warning in `warnings`; the counts say what the run did remove, the other steps still run, and a store package leaves the index (`dependency_package`) only once its prune succeeded. The prune runs with a scratch metadata cache, since pnpm's prune empties the one it is given and the home's (`deps/cache`) is what offline resolution reads (D95). `compactEvents` compacts each artifact's events before `before` (DATA_MODEL §4). A collected version keeps its row, ID and number; `VersionSummary.collected` says when; `view/url` for it, and a frame ticket for it (410), answer `MOSTRA_ARTIFACT_VERSION_COLLECTED`; publishing its exact source again restores its files and clears the mark.
- **`instance/check`** runs the checks only the owner of the ledger can: SQLite's integrity check, every uncollected version's manifest (with `deep`, its files against its `outputDigest`), the shell's build and the warm set. `mostra doctor` adds what the CLI can check itself.
- **`dev/*`** (D140 item 12): a dev session belongs to the connection that started it and ends with it (or `dev/stop` from that connection; another connection's is `MOSTRA_HOST_INVALID_PARAMS`); it counts against a daemon's idle exit (D133). As built:
  - **Where it lives.** The source is mirrored into `cache/dev/<session>/root/source` (Mostra never writes into the artifact's directory) and kept in step by file events and a 1 s comparison. A sandbox like verify's (D138 item 1) serves it: a scratch ledger, its own worker pool, a shell and an artifact listener on loopback ports the operating system picks (`port` chooses the shell's), and a link minted in the scratch ledger (`url`, `/v/1`), so no home link opens it and its link opens nothing of the home. A non-loopback `--bind` refuses `dev/start` with `MOSTRA_ENV_BIND_FAILED`.
  - **The dev server** is Vite 8 in middleware mode in a builder child (the supervisor never loads the bundler, RT-02), with the SPA build's settings and plugins and the packages `Dependencies.resolve` gives, on a loopback port that answers only requests carrying the session's random secret (compared in constant time). The artifact listener runs the gateway's checks (exact Host and Origin, the origin-bound frame session) before it proxies a file or the HMR WebSocket there, without Mostra's cookies; Vite also has `allowedHosts` and `cors: false`. Client edits are hot updates (the entry's `export const artifact` is unexported in dev, so React Fast Refresh holds); a server bundle that changed restarts the session's worker and loads the pages again (`server-restarted`); another manifest or other packages (`mostra add`) start a new dev server and load the pages again (`reloaded`).
  - **What it reports.** `dev/notify` kinds are `built` (an update), `reloaded`, `server-restarted`, `submission` (with its `results`, §8: submissions go to the scratch ledger, never to hosts or ports) and `diagnostics`. The frame ticket carries `devPreview: true`, and the shell shows "Development preview, not published" for the view's life. Actions run for real with the real secrets, as the developer's own code on their own machine (D140 item 12).
- **A host marks the home** (D140 item 4): `mostra/initialize` from a client other than `mostra-cli` (`CLI_CLIENT_NAME`) that sends `home` or `ports`, and a `mostra-runtime host` instance owning the home, write `hostConfigured: { client, at }` into `config.json` once. The CLI sends no telemetry from such a home.

`mostra-runtime host|daemon` take `--bind <address>` (default `127.0.0.1`) and `--url-host <name>`, which a wildcard address needs; neither is remembered (D99). A bad pair fails with `MOSTRA_ENV_BIND_FAILED` before the home is touched.

The initialize shapes (D84):

```ts
interface ClientCapabilities { notifications?: string[] }        // notification methods the client accepts; the instance sends no others
interface InstanceCapabilities {
  methods: string[];                                            // every method this instance serves
  notifications: string[];                                      // notifications it may send
  ports: PortName[];                                            // ports it calls when a client registers them
}
interface InstanceInfo { version: string; home: string; platform: string; pid: number; mode: "host" | "daemon" }
type PortName = "identity" | "submissions" | "drafts" | "reviews" | "addressing" | "trustedControls"
              | "capture" | "secrets" | "pty" | "ai" | (string & {}); // "ai" is reserved (D46)
```

Registering a port the instance doesn't list in `capabilities.ports` returns the warning `MOSTRA_HOST_PORT_UNSUPPORTED` in `warnings`. Port names are open strings on the wire, so an older instance warns about a newer port instead of refusing the session.

## 7. Ports

Every port is optional. Registering one in `mostra/initialize` makes the supervisor call it on that connection, and every call is idempotent by its stable ID (D58).

```ts
interface Ports {
  identity?: { resolve(req: { headers: Record<string, string>; via: "local" | "tailnet" | "token" }): Promise<Viewer | null> };
  submissions?: { deliver(s: SubmissionEnvelope): Promise<{ accepted: true } | { accepted: false; reason: "duplicate" | "undeliverable" | "invalid" | (string & {}); retry: boolean }> };
  drafts?: { mirror(d: { artifactId: string; viewerId: string; revision: string; fields: FieldValues }): Promise<void> };
  reviews?: { mirror(r: ReviewEnvelope): Promise<void> };
  addressing?: { externalBase(o: { artifactId: string; listener: "shell" | "artifact"; local: string }): Promise<{ origin: string; mode?: "cookie" | "worker" } | null> };
  trustedControls?: { policy(a: ArtifactSummary): Promise<{ submitChannels: ("shell" | "artifact")[]; controls?: ("submit" | "choose" | "approve")[] }>;
                      activated?(e: { artifactId: string; control: string; viewer: Viewer; viewId: string }): Promise<void> };
  capture?: { screenshot(r: CaptureRequest): Promise<{ png: Uint8Array }>; aria?(r: CaptureRequest): Promise<{ yaml: string }> };
  secrets?: { get(r: { artifactId: string; name: string }): Promise<string | null> };
  pty?: { spawn(spec: PtySpec): Promise<PtyHandle> };   // streams over the same connection
}
```

- **`SubmissionEnvelope`** is `{ kind: "submission", deliveryId, submissionId, artifactId, attempt, results }`: the full submission (§8 JSON) built from the immutable submission alone, and a stable `deliveryId` that a redelivery repeats (H-03). A host may store it as an opaque payload (H-01). Port calls are `port/submissions.deliver` and `port/drafts.mirror` on the registering connection, each with 30 s to answer.
- **`deliver` results** (D105). Deliveries' `owner` is the host's client name, and empty for Mostra's built-in adapter, which accepts at once when no host takes submissions. `accepted: true` is delivered; `retry: true` keeps the delivery pending with backoff (1 s doubling to 5 min), as does a transport failure or a late answer; `accepted: false, retry: false` is terminal: `duplicate` counts as delivered, `undeliverable` is shown to the viewer, any other reason is `rejected`. Each host's deliveries go out one at a time in submission order, and a host that is away gets them when it registers again.
- **`trustedControls`** (D108): `port/trustedControls.policy { artifact: ArtifactSummary }` → `{ submitChannels, controls? }` is asked when a frame ticket is issued, answered within 5 s; its answer replaces the home's `submitChannels` for that view, and a failure or timeout narrows the view to the shell channel. `port/trustedControls.activated { artifactId, control, viewer, viewId, detail? }` follows a trusted Submit or Choose once it committed, best effort and never retried.
- **`drafts.mirror`** receives `{ kind: "draft", artifactId, viewerId, epoch, revision, fields }`, the latest revision only, best effort and never retried (IN-06).
- **The Rust crate** exposes the same ports as async traits.
- **`identity`** (D143 item 2): `port/identity.resolve { artifactId, via, headers }` → `{ ref, name? } | null` is asked when a browser exchanges a link minted without a viewer for a shell session, answered within 5 s. `headers` are the request's, names in lower case, without `cookie` and Mostra's `x-mostra-*` headers; `via` is `local` (the gateway's own address), and from WP-13 `tailnet` or `token`. `{ ref, name? }` is one viewer of kind `host` per `ref`, and the session acts as it; `null` keeps the standalone default (the home's local user). A link minted with a viewer asks nothing. A failure, a timeout, an answer its schema refuses, or a host that names `identity` in `HomeConfig.ports` but isn't connected refuses the exchange with 503 `MOSTRA_HOST_IDENTITY_UNAVAILABLE`.
- **`addressing`** (HO-10, D158 item 6): `port/addressing.externalBase { artifactId, listener, local }` → `{ origin, mode? } | null` is asked within 5 s when Mostra mints a link for the artifact (`listener: "shell"`: publish receipts, `view/url`, `view/default`) and when a shell on the host's face asks for a frame ticket (`listener: "artifact"`). `local` is the loopback origin of the face Mostra opened for it, on a leased port the host forwards its own tunnel to. An answer becomes a face with that exact `Host` and origin, kept in the home so its links work after a restart before the host is back; `mode` overrides the frame-session mode, which is otherwise `cookie` for one host name and `worker` for two. `null`, or another origin, withdraws the face before, whose links stop working at once; a call that fails or a host that is away keeps the face it gave before, else links stay on loopback.
- **`identity`** from WP-13 (D158 item 2): requests through Tailscale Serve ask with `via: "tailnet"` and Serve's `tailscale-user-*` headers, public shares and hosts' external bases with `via: "token"`; with no answer, a tailnet session acts as the tailnet person (kind `tailnet`, by login) and any other as its link's own viewer (kind `token`, `ref` `link:<tokenId>`).
- **Ports arrive with their consumers** (D143 item 1): this release calls `identity`, `submissions`, `drafts`, `trustedControls`, `secrets` and, from WP-13, `addressing` (HO-10); `reviews` and `capture` arrive with WP-20 (HO-11), `pty` with WP-23. Every port uses one path: registered in `mostra/initialize`, listed in `capabilities.ports` when the instance calls it, called only on the registering connection, and remembered per client name through `HomeConfig.ports`.
- **The published schema bundles list the methods** (D143 item 3): `x-mostra-methods` names each method with its `direction`, `mutating`, and `params` and `result` (a reference to a definition, or `{}` for a result whose content is ignored); `x-mostra-notifications` names each notification with its `params`. Removing one, or changing any of these, is a breaking change (HO-07).
- **`secrets`** (D131): `port/secrets.get { artifactId, name }` → `string | null`, asked first for every `secret()`; `null` falls back to the artifact's, then the home's store; a call that fails or takes over 30 s makes `secret()` throw `MOSTRA_SECRET_MISSING`, never falling back. Every value it returns is redacted wherever Mostra keeps or shows text.
- **`WorkerLauncher`** (internal in v1, the seam for v1.x `SandboxPort`) is `{ launch(spec: { version: VersionRef, env, limits }): Promise<WorkerChannel> }` (D124). `VersionRef` names the version by its digest and a locator for its portable bundle (§15), never by a directory path; the local implementation resolves it to the version's directory in the home and forks a child process. `WorkerChannel` carries only serializable messages, so a launcher whose worker is a separate process over a socket, or on another machine, fits without a change. `env` holds no secrets: a worker reads secrets only through the secrets port (`secret()`, D44), never from an inherited environment. WP-08 lands it, with a second fixture launcher that proves the seam. As built (D129): `launch({ artifactId, version: { versionId, outputDigest, locator }, env, limits, sourceDir? })`, where the local locator is `home:versions/<versionId>` and only the local launcher passes `sourceDir`; the channel is newline-delimited JSON-RPC 2.0 (`WORKER_METHODS`, revision `WORKER_CHANNEL_REVISION` in `@mostra/protocol`): `worker/start`, `worker/call` with its streamed `worker/batch`, `worker/cancel`, `worker/ping`, `worker/live.start`, `.stop` and `.refresh`, `worker/stop` from the supervisor, and `server/progress`, `server/log`, `server/secret`, `server/signal`, `server/emit`, `server/state.get`, `server/state.patch` and `server/live.value` from the worker, each validated by the supervisor. `worker-host.mjs` in `@mostra/runtime`'s tests is the second launcher: a process started on its own that takes `{ launch }` over a Unix socket and relays the channel (`MOSTRA_TEST_WORKER_HOST`).
- **`relay`** (D117, D165 item 4) is the port an owner instance registers on its connection to a hosted home, so the home runs the artifact's server code, live producers and authoring on the owner (§18.3).
- **Operator ports** (D116, HO-09) belong to a remote server, not to an instance's hosts: `limits`, `metering`, `accounts`, `abuse`, `policy`, `routing` and `events`, each with a no-op default (§18.6, D165 item 9). WP-30 builds them.

## 8. Results

`results/get`, `mostra results`, `artifact_results` and the submissions port all carry one structure:

```ts
interface Results {
  artifact: { id: string; title: string; description?: string; family?: string; links: Link[] };   // from the version the viewer saw
  submission: { id: string; at: string; epoch: number; previous?: string; policy: SubmissionPolicy; channel: "shell" | "artifact";
                viewer: Viewer; versionId: string; version: number; viewId: string; staleView: boolean; latestVersion?: number;
                draftRevision: string; stateRevision?: string; digest: string;
                delivery: "pending" | "delivered" | "rejected" | "undeliverable"; deliveries: DeliveryStatus[] };
  answers: Record<string, unknown>;         // dotted field IDs nested; labels in `fields`
  fields: { id: string; label?: string; required?: boolean; sensitive?: boolean; scope: "viewer" | "artifact" }[];
  state?: Record<string, unknown>;          // artifact-scoped fields at stateRevision
  choices: { reviewSetId: string; candidateId: string; label?: string }[];
  comments: { threadId: string; status: "open" | "resolved"; messages: { author: Viewer; at: string; text: string }[];
              anchor: { reviewId?: string; selectors?: W3CSelector[]; rect?: Rect; viewport?: Viewport; page?: string;
                        candidateId?: string; terminal?: { rows: [number, number]; cols: [number, number]; t?: number };
                        time?: number; slide?: { index: number; step: number } };
              crop: { path: string; width: number; height: number } }[];
  orphaned: { id: string; label?: string; value: unknown; fromVersion: number }[];   // D42
  actions: { runId: string; action: string; status: string; at: string }[];         // runs started in this view
  signals: { name: string; at: string; payload?: unknown }[];   // the newest 100, within 1 MiB of payloads
  signalsOmitted?: number; signalsCompacted?: true;                // older signals left out; some removed by compaction
}
```

The Markdown rendering follows ROUND-2 §1.1: a header with IDs, then answers by label, the artifact state, choices, comments with crop paths, actions, signals, then "Not carried over"; every section appears, with "(none)" when empty. `digest` is the SHA-256 of the stored snapshot's RFC 8785 form (`canonicalJson`), the snapshot's identity: results don't carry the snapshot's own text, so a host compares digests rather than recomputing one, `delivery` the worst state among `deliveries`, and dotted IDs nest unless a value already sits at a prefix, where the dotted ID stays a key of its own. Sensitive fields appear in results and are redacted from events and logs (D52).

## 9. CLI

The command set is D60 plus `mostra run <bundle>` (runs a portable `bundle` export) and `mostra state get|set|patch`. Sign-in, sign-out and sharing to a remote server join it with WP-29 (`mostra login`, `logout`, `share --cloud`), and pausing with WP-30 (`mostra pause`, `resume`), §18.7 (D165 item 15), and the standalone CLI's telemetry setting with WP-10 (D119); both are additive. `mostra add <package…> [--artifact <path|id>]` is the client of `deps/add` (D95), defaulting to the artifact in the current directory; `MOSTRA_DEP_MISSING` carries that exact command. Rules (AX-01):
- `--json` on every command, NDJSON for streaming commands;
- `--home`, `--cwd`, `--timeout`;
- no prompts when not on a TTY or in JSON mode;
- logs on stderr.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success, or `verify` passed |
| 1 | Artifact failure (verify failed, publish refused) |
| 2 | Usage error |
| 3 | Environment error (no runtime, browser or socket; unsupported platform) |
| 4 | Timeout |
| 5 | `wait` timed out with `still_waiting` (not an error; the status is in the JSON) |
| 6 | Conflict (`once` already submitted, compare-and-set mismatch) |

Every command is a thin client of §6. The CLI starts the home's daemon when needed, and prints the attach target in `--json` output.

What WP-10 fixed (D140 items 13, 16, 17):
- **The envelope.** With `--json`, stdout carries exactly one JSON value, also for usage errors (`--json` is read before anything is parsed) and unexpected exceptions (`MOSTRA_HOST_INTERNAL_ERROR`, exit 3): `{ "ok": true, "result": …, "instance": { home, socket, pid, mode, version, started }, "warnings": [Diagnostic] }` or `{ "ok": false, "error": Diagnostic, "instance"?, "warnings" }`. `instance` is the attach target, absent for commands that reach none (`docs`, `telemetry`, `--version`, `--help`). `ok` means the command produced its result: a failing verdict is `ok: true` with exit 1, `still_waiting` `ok: true` with exit 5, a refused publish `ok: false` with exit 1. `warnings` carries `mostra/initialize`'s warnings and anything else an agent should see; each is also logged on stderr. MCP tools return raw results (WP-15); the envelope is the CLI's alone.
- **Streams** are NDJSON: one envelope per line, progress as `{ "ok": true, "event": … }` (`instance` on the first line only), and the last line the command's `result` or `error`.
- **One exit-code table** keyed by diagnostic code (`EXIT` and `exitCodeFor` in `@mostra/cli`): each area has a code (`CLI` 2; `HOST`, `HOME`, `ENV`, `PLATFORM` and `SHARE` 3; the others 1), and a few codes differ from their area: `MOSTRA_HOST_TIMEOUT` 4 (`--timeout`, the request limit; `wait --timeout` is the wait's own length and ends with 5; `host` and `dev` run until Ctrl-C or their connection ends, and refuse `--timeout` with `MOSTRA_CLI_USAGE`), the conflicts (`MOSTRA_SUBMIT_ALREADY`, `MOSTRA_SUBMIT_REVISION_MOVED`, `MOSTRA_FIELD_CONFLICT`, `MOSTRA_FIELD_MUTATION_ID_REUSED`, `MOSTRA_HOST_REQUEST_ID_REUSED`) 6, `MOSTRA_HOST_INVALID_PARAMS` 2, `MOSTRA_HOME_INTEGRITY` 1. A test maps every catalog code.
- **Help** is generated from the command definitions: a summary, usage, arguments, flags, the global flags, `Output:` (the result type and its `mostra docs` topic), exit codes and one example. `mostra <command> --help --json` prints the definition itself (arguments, flags with types and defaults, exit codes); `docs/reference/cli.md` is the same text, checked in CI.
- **`mostra docs [topic]`** prints the bundled reference by stable slug: `cli`, `telemetry`, each diagnostic code (`mostra docs MOSTRA_DEP_MISSING`), and the Agent Skill as `guide`, `guide/<reference>`, `guide/studio.css` and `guide/examples/<name>` (D162); without a topic the index; an unknown topic is `MOSTRA_CLI_USAGE` with the nearest topics; `--json` gives `{ topic, markdown, url }`.
- **The command set** is D60's without the commands later packages add with their packages (`review export`, `export`, `mcp`, `plugin`, `term`, `run`, D140 item 13), plus `state get|set|patch`, `daemon restart|uninstall` and `telemetry on|off|status`. WP-13 added `share <artifact> --tailnet | --public [--via cloudflare|funnel] [--ttl <d>] [--scope …] [--viewer <ref>]`, `share stop <shareId|artifact>` and `share list [artifact] [--all]`, clients of `share/*`; `--public` is a Cloudflare quick tunnel unless `--via funnel`, since a Funnel URL names the device and the tailnet (D158 item 4). An unknown command is `MOSTRA_CLI_UNKNOWN_COMMAND`, listing the commands; every `mostra …` a diagnostic's hint or fix names parses under the definitions (a test).
- **No prompt** but telemetry's question (D140 item 11), and only on terminals.
- **Telemetry** (D119, D140 items 1 to 11) lives in `@mostra/cli` alone; `docs/reference/telemetry.md` publishes its events.

## 10. Terminal frames and dumps

The frame model is in [rounds/ROUND-3.md §5.2](rounds/ROUND-3.md#52-frame-model) (D65), as Zod schemas in `@mostra/protocol` that the Rust crate shares.

`mostra term dump <source> --format text|cells|ansi [--at <time|marker|step>] [--cols N --rows N]` accepts:
- `.cast` files;
- frame JSON;
- a live session (`--session <artifact>:<name>`);
- a URL to a `<Terminal>` inside a published version.

The `text` format is exact cells with wide tails omitted, followed by a lint section listing misaligned box borders, cells beyond `cols` and width-table disagreements.

## 11. Build and render mode (internal)

`RenderMode` is in [rounds/ROUND-3.md §7](rounds/ROUND-3.md#7-render-mode-contract-rd1). The builder entry is `build({ source, lockfile, base, mode, out }) → { client, server?, registry: { fields, actions (with dryRun flags), liveSources, pages, terminals, demos }, diagnostics }`. The registry feeds `verify`, the shell and `results`. WP-03's builder writes `registry.json` with `schemaVersion`, `entry`, `actions` (`{ id, module, export, dryRun }`), `liveSources`, `pages` (`{ path, file }`), `terminals` and `demos`; WP-07 adds `fields` (D109): `{ open, openReasons, entries }`, the field IDs the version's code can use (each with its `hook`, a literal `id` or a `template` of literal parts around each `${…}` hole, its `location`, and the literal `scope`, `label`, `required` and `sensitive` it was given), found statically; an `open` version covers every ID, and `openReasons` say why. The generated `index.html` carries `<meta name="mostra-version">` (D115). The builder runs in a child process per build (`builder/build` over IPC), so the supervisor never loads the bundler (RT-02).

## 12. MCP server

`mostra mcp` runs over stdio, or over Streamable HTTP with `--http`, applying the full hygiene checklist (HY-01 item 13). It is stateless: every tool takes explicit handles (D61). Its tool handlers are independent of the transport, so the remote MCP server (D116, MC-04, WP-30) serves the same tools over Streamable HTTP with OAuth, and MCP Apps in cloud chat hosts persist through it; its authorization, revisions and ports are §18.8 (D165 item 10).

| Tool | Arguments | Returns |
|---|---|---|
| `artifact_create` | `dir`, `template?`, `title?` | `artifactId`, `dir`, files written |
| `artifact_write` | `dir`, `files: [{ path, content }]`, `deletes?` | written paths |
| `artifact_patch` | `dir`, `path`, `edits: [{ old, new }]` or a unified `diff` | patched paths, or rejected hunks |
| `artifact_verify` | `dir`, `screenshots?: "on-failure" \| "always" \| "never"` | verdict (§13), plus images for failing viewports |
| `artifact_publish` | `dir`, `force?` | `PublishReceipt` |
| `artifact_open` | `artifact`, `version?` | MCP App resource (`ui://mostra/view/<versionId>`) plus the URL fallback |
| `artifact_wait` | `artifact`, `until`, `after?`, `timeoutSeconds` (≤ 50) | satisfied event or `still_waiting` with cursor |
| `artifact_results` | `artifact`, `submission?`, `format?` | Results (§8) |
| `artifact_list` | `filter?` | summaries |
| `live_push` | `artifact`, `key`, `value`, `mode?` | revision |
| `docs_search` | `query` | snippets with doc URIs |

What WP-15 fixed (D164):
- **The package.** `@mostra/mcp` holds the tools, resources and instructions over three ports (the instance, the workspace of artifacts' files, the bundled reference) and a hygiene-guarded HTTP endpoint; `mostra mcp` serves it. It knows no transport, so WP-30 serves the same factory.
- **Thirteen tools**, the eleven above plus `state_get` (`artifact`, `ids?` → `{ revision, fields }`) and `state_patch` (`artifact`, `ops: [{ id, value } | { id, delete: true }]`, `baseRevision?`, `mutationId?` → `{ revision, applied, conflicts }`), as `state/get` and `state/patch` with `as: "agent"`. `artifact` is an artifact ID or a directory; a relative directory is inside the workspace (`mostra mcp --workspace`, `MOSTRA_MCP_WORKSPACE`, default `~/mostra-artifacts`), never the server's working directory. `artifact_create`'s `dir` is optional: without it the artifact gets a new workspace folder named after its title. `artifact_write`'s files take `encoding?: "utf8" | "base64"`. `artifact_patch` takes `edits` with `path`, or a unified `diff` of one or more files (`path?` overriding a single file's headers), all or nothing, refusing with `MOSTRA_ARTIFACT_PATCH_REJECTED` and every edit or hunk that didn't apply (`not-found`, `ambiguous`, `missing`, `exists`, `context`, `binary`, `malformed`). A path outside the artifact, or through a link out of it, is `MOSTRA_ARTIFACT_PATH_INVALID`. `artifact_open` returns the default link (`view/default`), or a new one (`view/url`) when given `version`, `viewer`, `scopes` or `ttl`; `open: true` also opens it in a browser on this computer through a launch ticket (`view/launch`). `artifact_wait`'s `timeoutSeconds` defaults to 50. `artifact_results` returns Markdown unless `format: "json"`. `docs_search` takes `query` or `topic` (a topic read whole).
- **Results** are the protocol's own (JSON text, Markdown, the verdict with an image for each screenshot marked `returned`); a failure is an `isError` result whose text is `{ "error": <diagnostic> }`. Input schemas are the `mcp-tools` wire bundle, snapshot-checked like the protocol's (D32).
- **`mostra mcp`** runs over stdio; `--http` serves Streamable HTTP at `/mcp` on `127.0.0.1` (`--port`, the system's choice by default; `--bind`, `--url-host`), requiring `Authorization: Bearer <token>` (`MOSTRA_MCP_TOKEN`, at least 26 characters of at least 8 different ones, or a token made for the run and printed once on stderr, never on stdout, whose `--json` `listening` event carries the URL alone; the scheme is read without regard to case) behind `checkRequest`'s `rpc` intent and a guessing limit (D164 item 3). `--embedded` marks a server a host or harness plugin starts, which sends no telemetry (D148, D164 item 4). Its session with the home's daemon opens on the first call, reopens after the daemon restarts and closes after five idle minutes.
- **Installed from npm** (D164 item 7), `mostra mcp` doesn't move into its pinned bundle first, as other commands do (§16): it answers its client at once and installs the bundle in the background, and a call that needs the instance waits for that install up to 45 s, then answers `MOSTRA_ENV_RUNTIME_INSTALLING` with how far it is; the daemon it starts runs on the bundle's own Node.js.

App-only tools (`visibility: ["app"]`) back the MCP App transport: `app_fields`, `app_submit`, `app_signal`, `app_call`, `app_run`, `app_run_status` and `app_events`. Resources: `mostra://docs/{topic}` and `mostra://artifacts/{id}/report`.

Exported MCP Apps:
- map the token variables to the host-context variables (VERIFIED_FACTS, MCP Apps);
- declare CSP domains;
- degrade explicitly where server features are unreachable (MC-03).

## 13. Diagnostics and the verify verdict

```ts
interface Diagnostic {
  code: `MOSTRA_${Area}_${string}`;   // codes are semver surface (AX-03)
  // Area: MANIFEST BUILD TYPE LINT DEP KIT FIELD ACTION LIVE RUNTIME CONSOLE NETWORK A11Y VISUAL SMOKE REGRESSION
  //       TERM PUBLISH SUBMIT HOST HOME HYGIENE SECRET SHARE VERIFY TARGET ENV PLATFORM ARTIFACT (D92) CLI (D140)
  //       REMOTE (D165)
  // (ROUND-3 §9's list, extended additively here; this list is the authority)
  severity: "error" | "warning" | "hint";  // error only for definite failures; smoke observations are warnings (D72)
  message: string;                     // what is wrong
  hint?: string;                       // what to do (one imperative sentence)
  fix?: { kind: "replace" | "insert" | "delete" | "command"; file?: string; range?: [number, number, number, number]; text?: string; command?: string };
  location?: { file: string; line: number; column: number } | { viewport: string; selector?: string };
  phase: "manifest" | "compile" | "lint" | "runtime" | "console" | "network" | "a11y" | "visual" | "smoke" | "regression" | "contract" | "publish" | "host" | "hygiene" | "platform";
  docs: string;                        // `${docsBase}/errors/${code}` (D37)
  count?: number;                      // deduplicated repeats
}
interface VerifyVerdict {
  status: "pass" | "fail";
  artifact: { id?: string; path: string; sourceDigest: string; envDigest: string };
  diagnostics: Diagnostic[];
  screenshots: { viewport: string; path: string; tokensEstimate: { claude: number; gpt: number; gemini: number }; returned: boolean }[];
  aria: { viewport: string; path: string; summary: string }[];
  smoke: { interactions: number; skippedActions: string[]; stateChanges: number };
  regressions: { against?: string; aria?: string; pixels?: { viewport: string; ratio: number }[]; contracts?: string[] };
  timingsMs: Record<string, number>;
}
```

Images are returned only when `status` is `fail` or on request, at DPR 1 (AX-05).

What WP-28 reserved (D165), for WP-29 and WP-30 to add with their pages: the area `REMOTE` with `MOSTRA_REMOTE_CONFIG_INVALID`, `_LOGIN_FAILED`, `_UNREACHABLE`, `_OWNER_OFFLINE`, `_QUEUE_FULL`, `_NO_INSTANCE`, `_NOT_OWNER_INSTANCE`, `_SIGN_IN_REQUIRED`, `_RATE_LIMITED`, `_LIMIT_REACHED`, `_OPERATOR_UNAVAILABLE` and `_PAUSED_BY_OPERATOR`; and `MOSTRA_SUBMIT_PAUSED`, `MOSTRA_ACTION_PAUSED` and `MOSTRA_HOME_NETWORK_FILESYSTEM` (INTERFACES §18, FAILURE_MODEL §11). `MOSTRA_REMOTE_NOT_OWNER_INSTANCE` names the owning instance (its `RemoteLink.name`). A package may rename one before it ships, recording it here.

What WP-10 added (D140): the area `CLI` with `MOSTRA_CLI_USAGE` and `MOSTRA_CLI_UNKNOWN_COMMAND` (exit 2), `MOSTRA_ARTIFACT_VERSION_COLLECTED` (a version gc collected), `MOSTRA_ENV_RUNTIME_MISSING` (the CLI can't find `mostra-runtime`) and `MOSTRA_HOME_NOT_ALWAYS_ON` (a warning of `mostra doctor`, LL-05).

What WP-09 fixed (D138):
- **`artifact/verify`** runs the pipeline of ARCHITECTURE §12 on a source and returns one verdict; it never publishes and never touches the home's drafts, state, events or deliveries. `screenshots` sets each screenshot's `returned` (`on-failure` by default): screenshots are always taken and written, and `returned` says whether a client should hand the image to its model (the CLI and MCP server act on it, WP-10 and WP-15). With `progressToken`, a client that accepts `artifact/progress` in `mostra/initialize` receives `{ progressToken, stage, fraction? }` as each stage starts (`prepare`, `compile`, `boot`, `render`, `smoke`, `regression`). A verdict replaces the one cached for the same digests; publish reuses it (D41).
- **The verdict, additively:** `artifact.versionId` (with `artifact.id`, when the artifact's identity is known: a manifest `id` or a binding); each screenshot's `width` and `height` in CSS pixels, which at DPR 1 are its pixels; `tokensEstimate` per VERIFIED_FACTS (WP-09). `status` is `fail` exactly when an error exists. Diagnostics are sorted errors first, and identical ones are folded with a `count`. `timingsMs` names the stages that ran (`build`, `typecheck`, `lint`, `boot`, `render`, `smoke`, `regression`) and `total`; a stage that didn't run is absent. Screenshots, ARIA snapshots and pixel diffs are files in `cache/verify/<key>/` (DATA_MODEL §1), ARIA text redacted.
- **The codes** (catalog in `@mostra/protocol`, pages in `docs/reference/errors/`): `VERIFY` (`ACTION_SKIPPED`, `SKIP_CONSEQUENCE`, `TIMEOUT`, `CRASHED`, `NO_BASELINE`, `BASELINE_MISSING`, `LIVE_FAILED`, `SECRET_MISSING`), `TYPE` (`ERROR`, `UNTYPED_PACKAGE`), `FIELD` (`DUPLICATE_ID`, `ID_UNSTABLE`, `SHARED`, `UNBOUND`), `RUNTIME` (`PAGE_ERROR`, `BLANK`, `NOT_READY`), `CONSOLE` (`ERROR`, `WARNING`), `NETWORK` (`REQUEST_FAILED`, `EXTERNAL_FAILED`), `A11Y` (`SERIOUS`, `MINOR`), `SMOKE` (`NO_EFFECT`, `BUDGET`), `REGRESSION` (`ARIA`, `PIXELS`, `FIELD_REMOVED`, `ACTION_REMOVED`, `LIVE_REMOVED`, `PAGE_REMOVED`), `PUBLISH_VERIFY_FAILED` and `ENV_BROWSER_MISSING`, each at the severity D138 item 3 gives it.
- **In the page:** a page served for verify carries `<meta name="mostra-target" content="verify">`, added by the sandbox's gateway as it serves `index.html` (D138 item 1). The client runtime then installs `globalThis.__mostraVerify` (`VERIFY_PROBE`), whose `fields()` lists every field mounted with its hook, scope, initial value's type, mount count and conflicts (`ProbedField`), for AU-05; nothing else changes. A call of a server function that didn't opt into `dryRun()` answers 409 `MOSTRA_VERIFY_ACTION_SKIPPED` before a run is recorded, so `run()` and server references reject with a `MostraError` carrying that code.
- **The runner's channel** (internal): the supervisor starts `@mostra/verify`'s `mostra-verify` through the process manager and speaks `VERIFY_RUNNER_METHODS` (`verify/render`, `verify/compare`, with `RenderRequest`, `RenderResult`, `CompareRequest` and `CompareResult` in `@mostra/protocol`) over Node IPC.

## 14. Extension contracts and the plugin manifest

These are specified in [rounds/ROUND-3.md §6](rounds/ROUND-3.md#6-extensions-ex1-to-ex3) (D65): six contract packages with `define*` blueprints, the `"mostra"` manifest key validated by `mostra plugin validate`, shadcn-compatible packs, loading order, conflict rules and license acknowledgment (D31).

## 15. Export formats

- **`static` and `html`.** Hash routing, the runtime's static transport, and no credentials or secrets.
- **`bundle`.** A directory or `.tar.zst` with `mostra-bundle.json`, which records schema version, artifact metadata, `versionId`, digests, the lockfile, and the client and server builds. `mostra run <bundle> [--home]` imports it into a home as a version of the same artifact ID, so a share can push versions between homes (RM-01, WP-29).
- **`snapshot`.** The `static` build, plus a frozen `snapshot.json` (field values, live values and choices at a cursor). Actions render as unavailable.
- **`mcp-app`.** One HTML file plus `mcp-app.json`, carrying the `_meta.ui` CSP declaration and resource URI.

Secrets never enter any export (STANDARDS security).

## 16. Distribution: the runtime bundle and the SDK

What WP-11 fixed (D142), with Windows from WP-W3 (D153). The schemas are in `@mostra/protocol` (`bundle.ts`), published with the other wire schemas, so the Rust crate (WP-12) reads the same files.

**A bundle** is `mostra-<version>-<platform>.tar.gz` (`bundleAssetName`; platforms `BUNDLE_PLATFORMS`: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` (glibc only), `win32-x64`, `win32-arm64`) with one top directory, `mostra-<version>-<platform>/`:

```text
bundle.json            BundleInfo: name "mostra-runtime-bundle", version, platform, node { version, path },
                       entries { runtime, cli, setup }, files { path, sha256 }, browser (BundleBrowser), source?
files.json             BundleFiles: every regular file { path, size, sha256, executable } and link { path, target }
node/                  the official Node.js distribution (node/node.exe on Windows)
lib/node_modules/      Mostra's packages and their dependencies; @mostra/warm/node_modules, the warm set
bin/mostra, bin/mostra-runtime, bin/mostra-setup   POSIX launchers on the bundle's own Node.js
                       (Windows: mostra.exe, mostra-runtime.exe, mostra-setup.exe, mostra-win.exe,
                       mostra-win-service.exe and THIRD-PARTY-LICENSES.txt)
LICENSE, NOTICE
```

A Windows archive holds files and directories only (an installer refuses a link in one); its `files.json` lists the links, each to a directory, and setup makes them junctions at the bundle's real path. Windows keeps no execute bit, so a Windows `files.json` lists none (D153).

Setup adds `browsers/` (the verify browser, fetched and checked against `BundleBrowser.files`) and `.mostra-setup.json` (`BundleSetup`: version, platform, `files` (the `files.json` digest it checked), the browser's revision, when, and for a Windows bundle `root`, the real path its junctions point into, so a moved Windows bundle is set up again). A bundle is usable only with a marker whose files digest, version, platform and browser revision match its own `bundle.json`. `bin/mostra-setup` (the entry `setup`) runs it by hand and prints one JSON line (`{ status: "ok", bundle: { root, …marker } }` or `{ status: "failed", diagnostic }`, exit 3).

**Pins.** `@mostra/sdk` ships `dist/bundles.json` (`BundlePins`: version, `release` (the base URL, `https://github.com/mostra-dev/mostra/releases/download/v<version>`), `assets` per platform: `{ file, sha256, size, unpackedSize }`). The GitHub release carries the six archives, each archive's asset record (`mostra-<version>-<platform>.json`, a `BundleAsset`, so a host that downloads one directly knows its unpacked size), `SHA256SUMS` in `sha256sum`'s format and an artifact attestation per archive. It is published before any npm package of its version, so a pin always names an archive that exists. An asset's `file` is exactly `mostra-<version>-<platform>.tar.gz` of its pins' version and platform, or the pins are refused.

**The cache.** `<cache>/bundles/<archive SHA-256>/`, the bundle's root (the archive's top directory is stripped), with `<cache>` = `MOSTRA_CACHE_DIR`, else `~/Library/Caches/mostra` (macOS), `%LOCALAPPDATA%\mostra-cache` (Windows, D153), else `${XDG_CACHE_HOME:-~/.cache}/mostra` (Linux); `<sha256>.lock` and `.tmp-*` scratch directories beside them while an install runs. An entry exists only once its files are checked; it is ready once its setup marker is written.

**Finding the runtime** (`resolveRuntime`, the CLI's bootstrap, every SDK host), first match:
1. `MOSTRA_BUNDLE` (or the SDK's `bundle` option): an extracted bundle, set up first when it isn't;
2. `MOSTRA_RUNTIME_BIN`: a `mostra-runtime` entry, run on this process's Node.js (`MOSTRA_ENV_RUNTIME_MISSING` when it doesn't exist);
3. the bundle the calling code runs from;
4. the release's pins: the cached bundle, installed first when missing;
5. a development checkout's built `packages/runtime/dist/bin.js` beside the package;
6. otherwise `MOSTRA_ENV_BUNDLE_UNAVAILABLE`.

**Variables.** `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, `MOSTRA_CACHE_DIR`, `MOSTRA_BUNDLE_MIRROR` (a base URL, `https:`, `http:` or `file:`, holding the archives under their names; a user and password in it are sent as Basic authorization and never printed), `MOSTRA_OFFLINE` (only the cache serves), the proxy variables (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, either case, read from the environment the caller passes: the SDK's `env` option, else the process's) and Playwright's own download mirror for the browser (`PLAYWRIGHT_DOWNLOAD_HOST`).

**Diagnostics.** `MOSTRA_ENV_BUNDLE_INVALID` (a size, digest, file, link or browser that differs from its pin; nothing installed), `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED` (the network, a proxy, a mirror, the disk), `MOSTRA_ENV_BUNDLE_UNAVAILABLE` (offline without a cached bundle, or no bundle for this release and platform), and `MOSTRA_PLATFORM_UNSUPPORTED` before any download on another platform.

**The npm entry points.** `@mostra/cli`'s `mostra`, outside a bundle, installs its release's bundle (steps 1 to 4) and runs the bundle's `mostra` with the same arguments, signals and exit code (`mcp` excepted: it serves at once and installs the bundle in the background, §12, D164 item 7); with `--json` a failure there is one envelope. `npm create mostra [dir] [-- <mostra new flags>]` (`create-mostra`) runs `mostra new` through that CLI and prints the next steps, except with `--json`.

**The SDK** (`@mostra/sdk`, HO-04):

```ts
const mostra = await createMostra({
  home: string,                       // the host's own home (D45)
  ports?: Ports,                      // submissions.deliver, drafts.mirror, secrets.get, trustedControls.policy|activated
  client?: { name: string; version?: string },   // default { name: "mostra-sdk", version: <SDK> }
  settings?: HomeSettings,            // submission, submitChannels, dependencies (HomeConfig)
  expectPorts?: boolean,              // default true: deliveries wait for this host while it is away (D105)
  bundle?: string, bind?: string, urlHost?: string, env?: Environment,
  onLog?, onProgress?, onPortError?, signal?: AbortSignal,
});
mostra.instance; mostra.capabilities; mostra.revision; mostra.warnings; mostra.runtime; mostra.closed;
await mostra.publish(source, { force?, policy?, requestId? });       // PublishReceipt
await mostra.verify(source, { screenshots? });                       // VerifyVerdict
await mostra.wait(artifact, until, { after?, timeoutMs?, signal? }); // satisfied | still_waiting
await mostra.results(artifact, { submission?, format? });            // Results, or Markdown
await mostra.getState(artifact, ids?); await mostra.patchState(artifact, { ops, mutationId, baseRevision?, as? });
await mostra.pushLive(artifact, { key, value, mode? }); await mostra.viewUrl(artifact, { scopes?, ttl?, viewer?, version? });
for await (const page of mostra.events({ filter?, after?, name?, highWaterMark?, signal? })) { … }
await mostra.call(method, params, { timeoutMs? });                   // any host protocol method by its definition
await mostra.close();                                                // InstanceExit
```

`artifact` and `source` are an ID (`art_…`), a path (made absolute) or an `ArtifactRef`/`SourceRef`. A port handler's request and answer are checked against the method's schemas; an answer that fails is `MOSTRA_HOST_INTERNAL_ERROR` to the instance, and a handler that throws is reported to `onPortError` (the instance retries a delivery, D105). `events()` pauses its subscription past `highWaterMark` pages (default 16) and resumes after the last cursor it received, with no gap or repeat; with a `name`, each page is acknowledged once the next one is asked for. The SDK sends no telemetry (D119).

**Opening a control endpoint** (WP-W2, D151): `connectControl(endpoint, { runtime?, env?, timeoutMs? }) → Promise<Duplex>` opens the socket or pipe `instance.json` names: a Unix socket with `node:net`, or on Windows the owner-only pipe through `mostra-win connect`, found beside `runtime` (`MOSTRA_WIN_HELPER` in `env`, the bundle's `bin\mostra-win.exe`, a checkout's Cargo build), which refuses a pipe another user created under the name; failures are `MOSTRA_HOST_CONNECTION_CLOSED`, or `MOSTRA_ENV_HELPER_MISSING` without a helper. The CLI opens its sessions through it.

## 17. The Rust host crate and the conformance kit

What WP-12 fixed (D143).

**`mostra-host`** (HO-03, crates.io, Apache-2.0, the release group's version). The wire types are generated by typify from `@mostra/protocol`'s draft-07 bundle (`crates/mostra-host-codegen`; the committed `src/wire/generated.rs` and `methods.rs` are checked against a fresh generation in CI, and a schema outside the subset typify handles fails the generator). Unknown object fields are ignored, and an unknown enum value or union member reads as an `Unknown` variant that serializes back unchanged. Every method and notification is a typed marker in `wire::methods`, generated from the bundle's `x-mostra-methods`.

```rust
let mostra = Mostra::spawn(                         // or Mostra::attach: the home's daemon, started when none runs
    Options::new("/var/lib/my-host/mostra")
        .client("my-host", "1.4.0")
        .submissions(store.clone())                // ports::Submissions, Drafts, Identity, TrustedControls, Secrets
        .identity(directory),
).await?;
let receipt = mostra.publish("/work/questions", PublishOptions::default()).await?;
let outcome = mostra.wait(receipt.artifact_id.as_str(), "submitted", WaitOptions::default()).await?;
let mut events = mostra.events(EventStreamOptions { name: Some("my-host".into()), ..Default::default() });
let page = events.next().await?;
let answer = mostra.call::<wire::methods::ResultsGet>(&params).await?;   // any method, typed
mostra.close().await?;                               // &self: a shared handle can close it
```

- **The runtime.** `runtime::resolve_runtime` finds it as the SDK does (§16): `Options::bundle`, `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the crate's own release pins (installed into the shared digest-keyed cache by `bundle::install_pinned`: size and SHA-256 before extraction, strict extraction, every file against `files.json`, the browser through the bundle's own `bin/mostra-setup`), then a development checkout. Proxies, the mirror and offline mode come from the environment the host gives (`Options::env`), never silently from the process.
- **Windows** (D153): `Mostra::attach` opens the pipe `instance.json` names with `SECURITY_IDENTIFICATION` and refuses it (`MOSTRA_HOST_CONNECTION_CLOSED`) before a byte is sent unless its owner is the user; a daemon it starts runs detached in its file system's root; a spawned instance has no console window and is ended without signals. A child's environment keeps Windows' own system variables (`SystemRoot` and the rest) the host's `Options::env` lacks.
- **Ports** are async traits. A handler that fails or panics answers the instance with an error (a delivery is retried), and `Delivered` covers every answer of §7. A `Delivery` carries the typed envelope and its exact JSON, for a host that stores it opaquely (H-01).
- **Events.** `EventStream` keeps the SDK's guarantees: pages in cursor order, a page acknowledged when the next one is asked for, a pause past its high-water mark that resumes after the last cursor with no gap or repeat.
- **Errors** are the instance's diagnostics (`Error::code`, `hint`, `diagnostic`), or local ones with the same codes (`MOSTRA_HOST_CONNECTION_CLOSED`, `MOSTRA_HOST_TIMEOUT`, `MOSTRA_ENV_BUNDLE_*`).
- **No telemetry** (D119): the crate holds no code that sends an event, and the homes it configures are marked host-configured.

**`@mostra/conformance`** (HO-05). `mostra-conformance --host "<command>" [--baseline <file>] [--only <id>]… [--verify] [--json] [--list]` runs the scenarios against the harness shim `<command>` starts, and exits 0 when the host is conformant, 1 when not, 2 on a usage error.
- **The harness protocol** (revision `2026-10-21`, `src/harness/protocol.ts`): `harness/initialize`, `start`, `call`, `stop` and `store`; with the feature `faults`, `script`; with `events`, `events`; with `attach`, `start` may attach to a daemon.
- **A baseline** is `{ "schemaVersion": 1, "expectedFailures": { "<scenario id>": "<why>" } }`.
- **Scenario IDs** are stable surface, since baselines name them: `session.negotiation`, `session.process-models`, `home.authoring-removed`, `home.privacy`, `delivery.submission`, `delivery.exactly-once`, `delivery.retry`, `delivery.outbox-replay`, `drafts.mirror`, `interaction.policies`, `events.subscription`, `events.signals`, `interaction.wait`, `interaction.long-lived-state`, `interaction.results`, `interaction.request-ids`, `interaction.durability`, `ports.identity`, `ports.trusted-controls`, `ports.secrets`, `ports.server-events`, `viewing.links`, `viewing.hygiene`, `viewing.shell-bridge`, and from WP-13 `ports.addressing` (`ports.identity` also opens a tailnet and a Cloudflare share through the kit's stand-ins for `tailscale` and `cloudflared`, `MOSTRA_TEST_TUNNELS`). WP-20, WP-29 and WP-31 add theirs.
- **The library** exports `runConformance`, `readBaseline`, `serveHarness`, the scenarios and the viewer the kit plays. `mostra-conformance-reference-host` is the TypeScript reference host (`--standalone`, `--break`); `crates/mostra-host-reference` is the Rust one.

## 18. The remote server

The names, types and semantics of the remote server (ARCHITECTURE §15, D165). WP-29 builds the network binding, sharing and the relay; WP-30 builds the public server, its sign-in, operator ports and remote MCP. Each may settle finer shapes under D123 and records them here, additively. Domains are examples: `usercontent.example` is a user-content domain (its apex is the hosted shell, D165 item 7) and `api.example` an API origin.

### 18.1 The server and its configuration

```text
mostra-runtime server --data <dir> [--config <file>] [--listen <address:port>]
```

- `--data` holds the server's directory ledger, its hosted homes and the version files (DATA_MODEL §7). A directory on a network filesystem is refused (`MOSTRA_HOME_NETWORK_FILESYSTEM`, D165 item 0b).
- The server speaks plain HTTP on `--listen` (default `127.0.0.1:8080`; the container image listens on every address) behind a TLS terminator, and routes every request by its exact `Host` (§18.4). It believes `X-Forwarded-For` only from `trustedProxies`, reading it from the right and taking the first address that isn't a trusted proxy.
- `server.lock` in the data directory, and `home.lock` in each hosted home, are one-row SQLite databases the server holds in `locking_mode=EXCLUSIVE` with a transaction open: advisory locks the operating system releases when the process dies, needing no native addon, which nothing else ever opens (DATA_MODEL §7).

```ts
interface RemoteServerConfig {
  apiOrigin: string;                                  // "https://api.example": binding, version files, OAuth, /mcp
  domains: { active: string; spares?: string[] };     // user-content domains (D137); each apex is a hosted shell
  trustedProxies?: string[];                          // addresses whose X-Forwarded-For and -Proto are believed
  identityProviders?: IdentityProviderConfig[];       // §18.5
  rateLimits?: {                                      // D165 item 13: server settings, never operator policy
    perIp?: { submissions?: Rate; requests?: Rate };
    perLink?: { submissions?: Rate; relayedRuns?: Rate };
    ipv6Prefix?: number;                              // default 64: IPv6 addresses count per /64
  };
  ledger?: { walAutocheckpoint?: number };            // a backup replicator may ask for 0 (SQLite's default 1000)
  chatHosts?: Record<string, ChatHostPolicy>;         // D160, by client: rendering, sign-in, quota wording; operator `policy` may override
  relay?: { waitingRunsPerArtifact?: number; drainPerSecond?: number };   // D165 item 4
  homes?: { idleCloseMinutes?: number };              // default 10 (D165 item 6)
  framing?: { frameAncestors: "'none'" };             // D145: the only v1 value
  operator?: string;                                  // path of an operator module (§18.6)
}
type Rate = { count: number; per: string };           // per: a duration such as "1m"
```

Every key can also come from an environment variable (`MOSTRA_SERVER_<KEY>`). A configuration the server can't use stops it before it serves anything, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`).

### 18.2 The network binding

- **Endpoint:** `wss://api.example/host`, opened with `Authorization: Bearer <access token>` (§18.5) and `Sec-WebSocket-Protocol: mostra.host`. Without a valid token the upgrade answers `401` with a `WWW-Authenticate` naming the server's protected-resource metadata.
- **Framing:** one JSON-RPC 2.0 message per text frame, at most `MAX_LINE_LENGTH` characters, checked on both sides. A binary frame or a longer message closes the connection (1003 or 1009). No batches (D83).
- **Liveness:** each side sends a WebSocket ping and the notification `mostra/ping` every 20 s (some proxies don't count control frames as activity). A connection with nothing received for 45 s is closed and dialled again with backoff (1 s doubling to 60 s, with jitter). A restart of an edge or of the server is the same reconnect (D165 item 2).
- **Tokens on an open connection.** The server closes a binding when its access token expires, unless the client sent a fresh one in band (`remote/token { accessToken } → { expiresAt }`), and within 60 s of the grant's revocation or the account's suspension. An operator-issued credential (`accounts.authenticate`, §18.6) is accepted here as on `/mcp` and `/files`, so a program can run an always-on owner instance for an account.
- **Session:** `mostra/initialize` as in §6. The token names the account, and the session acts on that account's hosted home (`InstanceInfo.mode: "hosted"`, with `incarnation`, the home's current incarnation, and `cursor`, its head). An owner instance's session sends `link: { instanceId, relayMark }` (its `lnk_` ID, and the highest relayed run sequence its ledger has accepted) and registers the ports `submissions` and `relay`. On a hosted home `HomeConfig.ports` is kept per link, never per client name, and a submission's one delivery owner is its artifact's owner link, so deliveries and relayed runs wait for that instance while it is away, and another instance of the account gets none (D105, D165 item 1b).
- **Methods on a hosted home:** §6's viewing, interaction and events methods (`view/*`, `results/get`, `wait`, `state/*`, `live/push`, `events/*`), `artifact/list`, `artifact/get`, and:

  ```text
  hosted/push    { artifactId, version: VersionPush, requestId? }
                   → { status: "complete", versionId, number } | { status: "missing", files: string[] }   (SHA-256s)
  artifact/pause { artifact, paused: boolean, reason?, requestId? } → { paused, by?: "owner" | "operator" }
  ```

  `hosted/push` answers with the artifact's hosted route too (`route: { routeId, label }`), minted on the first push. `VersionPush` is `{ versionId, number, sourceDigest, envDigest, outputDigest, manifest, registry, lock, listing }`: the version's identity, its `manifest.json`, `registry.json` and `lock.yaml`, and `listing`, the canonical output listing of every built file (`[path, executable, sha256, size]`, server files included) whose digest is `outputDigest` (DATA_MODEL §2). The server stores the client files the listing names, never the server files (D165 item 3). A push answers `missing` with the SHA-256s it lacks until every client file is there, then `complete`. It is idempotent by `versionId`.
- **Version files** go over HTTPS: `PUT https://api.example/files/<sha256>` with the same bearer token and the bytes as the body, accepted only for a file a pending push of this home names as missing, refused unless the bytes hash to the name or past the operator's storage limit. A file counts as present for a home only once that home uploaded it or a version of that home names it, whatever the server stores underneath, so neither `missing` nor any answer tells one home what another holds, and no home completes a version with bytes it never sent.
- **Methods on the owner's own instance**, for its CLI and SDK, additive to §6:

  ```text
  remote/login       { server?, requestId? } → { loginId, verificationUri, verificationUriComplete?, userCode, expiresAt }
  remote/login.wait  { loginId, timeoutMs } → { status: "signed-in", server, account: { id, name? }, instanceId } | { status: "pending" }
  remote/logout      { server?, forget? } → { servers: string[] }
  remote/status      {} → { links: RemoteLink[] }
  share/start        { artifact, via: "remote", server?, ttl?, scopes?, viewer?, requestId? } → Share & { url }
  artifact/pause     { artifact, paused, reason?, requestId? } → { paused, by? }   (forwarded for a hosted artifact)
  ```

  - `remote/login` starts the OAuth device authorization grant (RFC 8628) against `server` (default: the configured default server) and polls for the token in the background; `remote/login.wait` waits for its end, and a refused or expired code is `MOSTRA_REMOTE_LOGIN_FAILED`. The instance keeps the refresh token in the home (DATA_MODEL §7).
  - The instance's `lnk_` ID belongs to its home on that server, kept in the home (DATA_MODEL §7.3): `remote/logout` revokes the grant and keeps the ID unless `forget`, and a later `remote/login` rebinds the same link, so the artifacts it owns stay its own. The server never removes an artifact's owner link when a grant is revoked.
  - `RemoteLink` is `{ server, account: { id, name? }, instanceId, name, default, state: "connected" | "connecting" | "offline" | "signed-out", since, pendingPushes, lastError? }`. `default` marks the account's default instance for chat-host authoring (D165 item 1b; WP-29 names the command that changes it).
  - A `remote` share pushes the artifact's latest version, mints a link on the hosted home (its `url`, `https://usercontent.example/a/<routeId>#t=…`, and `tokenId`, with the hosted shell's address as `hostname`), and keeps pushing later publishes while it is active. `share/stop` revokes the hosted link. `share.done`'s `kind` is `remote` (D140 item 8).
- **Hosted artifacts on the owner's instance** (D165 item 1): `wait`, `results/get` and `events/*` read the owner's own ledger, which the hosted home's deliveries and the sync cursor fill. `state/get`, `state/patch` and `live/push` on a hosted artifact act on the hosted home through the link, refused with `MOSTRA_REMOTE_UNREACHABLE` when it can't be reached. Imported submissions and events carry `origin: { server, home, incarnation, cursor }`, additive to `EventRecord` and `Results.submission`. The follow copies only the events of artifacts this instance owns. An instance that doesn't own an artifact reads and waits on it through a session with the hosted home (the SDK, or remote MCP), never through its own ledger.
- **A restored hosted home.** When `mostra/initialize` reports an incarnation the instance hasn't seen, it continues after the lower of its committed cursor and the home's head, under the new incarnation, keeps everything it imported, and appends `remote.regressed { server, home, from, to }`, so the owner knows events in that window were lost on the server (FAILURE_MODEL §11.2).

### 18.3 Relay messages

An owner instance registers the port `relay` (§7) on its binding session, and the hosted home calls it only for artifacts whose owner instance that session is (D165 item 1b). IDs are the hosted home's, so a repeated message joins what it started (FAILURE_MODEL §1 rule 3).

```text
Hosted home → owner instance (port calls, each answered within 30 s)
  port/relay.run     { runId, artifactId, versionId, fnId, args, key?, viewer, viewId? } → { accepted: true }
  port/relay.cancel  { runId } → {}
  port/relay.call    { callId, artifactId, versionId, fnId, args, viewer, viewId? } → { accepted: true }
  port/relay.live    { artifactId, versionId, interest: "start" | "renew" | "stop" | "refresh", keys: string[] } → {}
  port/relay.reconcile { runs: string[] } → { runs: { runId, state: RunState | "unknown-to-owner" }[] }   (after every reconnect)
  port/relay.author  { method, params } → result              (remote MCP's authoring, §18.8)

Owner instance → hosted home (methods)
  relay/run.update   { runId, seq, progress?, log?, batches?, end?: { status: "succeeded" | "failed" | "cancelled", reason?, error? } } → {}
  relay/call.batch   { callId, seq, batch?, end?: { status, error? } } → {}
  relay/live.value   { artifactId, versionId, key, value? | error?, at } → { revision }
  relay/effect       { runId? | callId?, kind: "signal" | "emit", name, payload? } → { cursor }
  state/patch        { …, as: "agent", causation: { runId } }   (server code's `state`, §2.4)
```

- **Runs.** `port/relay.run` carries the run's relay sequence (per owner link) and is answered once the owner has recorded the run under `runId` in its own ledger (DATA_MODEL §7); the hosted home records the answer (`accepted_at`). A repeat answers the same and starts nothing. `relay/run.update` messages are idempotent by `(runId, seq)` and applied in order; the one with `end` is the run's end. A run started with a `key` keeps D130's rule, checked by the hosted home.
- **Reconnects.** After every reconnect the hosted home sends `port/relay.reconcile` with the link's accepted, unfinished runs; the owner answers each with its state, and a run it answers `unknown-to-owner` becomes `unknown` at once and is never sent again. A session whose `relayMark` is below the highest sequence the owner had accepted means the owner's home was restored to before those runs: every accepted, unfinished run, and every run sent but not acknowledged, becomes `unknown` and is never sent again. A run sent but not acknowledged otherwise is sent again, which joins it if the owner recorded it.
- **Offline** (D165 item 4). While the owner is away a run is `waiting`.
  - The manifest's `hosted.offline.actions` is `queue` (default) or `fail`, and `hosted.offline.limit` is a duration (default `24h`, at most `7d`, else `MOSTRA_MANIFEST_INVALID`). The limit has two clocks: a run never sent counts from when it was recorded, and a run the owner accepted (or that was sent) counts from when the owner was last heard from. Under `queue`, a run never sent that is still waiting at its limit ends `failed` with reason `owner-offline`; under `fail` it ends that way at once. A run sent and not acknowledged is never `failed` for the owner's absence: at its limit it is `unknown`.
  - Cancelling a run never sent ends it `cancelled` on the hosted home without contacting the owner.
  - Past `relay.waitingRunsPerArtifact` waiting runs, or when `limits` refuses the operation `run.wait`, a new run is refused with 503 `MOSTRA_REMOTE_QUEUE_FULL` before anything is recorded.
  - When the owner returns, waiting runs go out in the order they were recorded, at most `relay.drainPerSecond` a second per artifact.
- **Owner unreachable mid-run.** The run stays `running` with `ownerUnreachable: true`. When the offline limit passes after the owner was last heard from, the run becomes `unknown`, with the event `action.unknown`. A later `end` from the owner replaces it once, with its own event (DATA_MODEL §3, §4).
- **Plain calls** go out only while the owner is connected, and otherwise answer 503 `MOSTRA_REMOTE_OWNER_OFFLINE` at once.
- **Live.** Interest follows views as locally (D130): the hosted home sends `start` when a view or an `always` source needs a producer, `renew` every 20 s, and `stop` when none does. Values arrive as `relay/live.value` and are stored and sent like local live values. While the owner is offline, `LiveState.ownerOffline` is `true` and the last value stays, with its `at`.
- **A paused artifact** (D165 item 14) refuses relayed runs and calls with 423 `MOSTRA_ACTION_PAUSED` before anything is recorded.
- **Who may trigger** (D159). With `hosted.actions` `"signed-in"` (the default), `relay.run` and `relay.call` are sent only for a viewer of kind `account` or an expected respondent; anyone else gets 403 `MOSTRA_REMOTE_SIGN_IN_REQUIRED`. `"link"` lets any holder of a link with the action's scope trigger them. Either way `rateLimits.perLink.relayedRuns` applies.
- **Secrets.** `secret()` is answered by the owner's supervisor (D129). No relay message carries a secret, and the owner's redactor runs over every update it sends (AC-06).

### 18.4 Hosted pages

- **Routing.** A request's exact `Host` decides:
  - an active or spare user-content domain's apex is the hosted shell;
  - `<label>.<domain>` is the hosted route whose label it is, served only through links minted on that domain;
  - any other host goes to `routing.resolve` (§18.6), and with no answer it is refused (421).
- **Hosted routes.** The server mints one route per hosted home and artifact on its first push: a random `rte_` ID and a random label of 26 lower-case Crockford base32 characters (130 bits). Routes are keyed by home and artifact, so two accounts can host one artifact ID and nobody can claim another's. A label, the server's or one an operator supplies, is recorded forever once issued: it is never issued again and never moves to another home, so no origin, nor the browser storage it holds, passes to another tenant. An artifact page still sees its own artifact ID (`useArtifact()`); the route is the server's.
- **Links:** `https://usercontent.example/a/<routeId>[/v/<number>]#t=<secret>`. D97's rules hold, the shell address being the domain the link was minted on. On a hosted shell every `/a/{artifactId}/…` route of §4 is served at `/a/{routeId}/…`.
- **The shell rules** of ARCHITECTURE §15.6 hold on every hosted response: only the shell on the apex, `Origin-Agent-Cluster: ?1`, no credential on the user-content domain, `Cross-Origin-Resource-Policy: same-origin`, `frame-ancestors 'none'` and `X-Frame-Options: DENY` on the shell, `frame-ancestors` naming only the domain's shell on every document of a label origin (the worker-mode bootstrap included), D98 item 6's headers everywhere, and `noindex` (D161). The shell's own policy is `script-src 'self'` with no inline script, `require-trusted-types-for 'script'`, and every string a tenant or operator supplies rendered as text.
- **Sessions without cookies** (D165 item 8). The shell's exchange (`POST /a/{routeId}/_mostra/session`) answers `session`, a 26-character secret the shell keeps in its origin's storage under the route and sends as `X-Mostra-Shell` on every later request for that route; a session sent with another route's path is refused (401). The ledger keeps its SHA-256, as for a cookie (D98). Frames use worker mode (`X-Mostra-Frame`, D158 item 5). The server drops every `Cookie` header on hosted hosts before routing.
- **When storage fails.** Tenant pages share the apex's storage group in Firefox and the disk everywhere (VERIFIED_FACTS, WP-28). A shell whose storage write fails keeps the session in memory, keeps the link's fragment in place until the secret is stored, and tells the viewer that reloading will need the link again.
- **Viewers.** A link with a viewer acts as it (D104). Without one, a signed-in person acts as their account (kind `account`, `ref` the account ID, `verified: true`), and anyone else as an anonymous viewer per browser (kind `anonymous`, with an optional name and `verified: false`). The shell keeps one random browser secret and sends each route `HMAC-SHA-256(secret, routeId)` as the anonymous key, so two routes, and two owners, never see one key for the same browser. `useViewer()` reports `source` and `verified`.
- **Viewer sign-in.** It starts only from a click on the shell's "Sign in" in the trusted chrome, never at an artifact's request. It goes to the API origin's authorization server (`/oauth/authorize`, the shell as a public client with PKCE, §18.5), which names the page's sender before continuing ("Continue as Ada to answer Grace Hopper's page"), once per account and home, and returns to `https://usercontent.example/_mostra/signin` on the apex. `state` is bound to the route and the shell session and checked there. The shell then exchanges the code through `POST /a/{routeId}/_mostra/session/signin { code, verifier }` → `{ viewer }`. No token, password or WebAuthn credential is ever kept for the user-content domain (ARCHITECTURE §15.6).
- **Submissions** (D165 items 1a, 13). After a commit the shell says "Your answer was sent." and shows a respondent no delivery state: `SubmissionSummary.deliveries` is present only when the viewer is the owner's account. Each refusal below keeps the draft:
  - with `hosted.submissions` `"signed-in"`, anonymous viewers get 403 `MOSTRA_REMOTE_SIGN_IN_REQUIRED`;
  - past `rateLimits`, 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`;
  - a `limits` refusal of `submit`, 403 `MOSTRA_REMOTE_LIMIT_REACHED` ("This page isn't accepting answers right now");
  - a paused artifact, 423 `MOSTRA_SUBMIT_PAUSED`.
- **Counts by choice** (D165 item 12). For each manifest `tally` entry `{ field, choices, minTotal? }` (a viewer-scoped field; `choices` 2 to 50 distinct strings, else `MOSTRA_MANIFEST_INVALID`), the submit transaction adds one to the count of the choice the submission's snapshot holds for that field (a value outside `choices`, or none, counts nothing). Viewers read it with `useLive("$tally/<field>")`, whose value is `{ counts: Record<choice, number>, total }`, pushed on the live channel whenever it changes, with no artifact code and no relay. It counts answers, never people, and shows no answer or who gave it. Below `minTotal` answers (default 0) viewers see only `total`, since with a handful of respondents each change reveals one person's choice. A local instance keeps the same tally.
- **The trusted chrome** (D161) and the report control render in the shell only. The report control posts `POST /a/{routeId}/_mostra/report { reason, detail? }`, which reaches `abuse.report`. `policy.link` may add an interstitial and an expiry (HY-09).

### 18.5 Sign-in and the authorization server

On the API origin (D165 items 8, 10; VERIFIED_FACTS, WP-28):

```text
/.well-known/oauth-authorization-server        RFC 8414 metadata
/.well-known/oauth-protected-resource/host     RFC 9728, resource "https://api.example/host"
/.well-known/oauth-protected-resource/mcp      RFC 9728, resource "https://api.example/mcp"; scopes_supported ["mostra"]
/oauth/authorize   /oauth/token   /oauth/device   /oauth/register   /oauth/revoke
/signin/<provider>/callback                    an identity provider's return
```

- **Metadata** advertises `issuer`, `code_challenge_methods_supported: ["S256"]`, the grants `authorization_code`, `refresh_token` and `urn:ietf:params:oauth:grant-type:device_code`, `token_endpoint_auth_methods_supported` with `none`, `client_id_metadata_document_supported: true`, a `registration_endpoint` (Dynamic Client Registration), `authorization_response_iss_parameter_supported: true` and `scopes_supported: ["mostra", "offline_access"]`.
- **Consent.** The authorization server shows its own consent page for every client an account hasn't approved, naming the client (a registered or metadata-document client's name marked unverified), its redirect host and what `mostra` grants. Consent is kept per account and client ID, is revocable, and is never skipped because an identity provider skipped its own. First-party clients (the hosted shells and the CLI) are named as themselves.
- **The device grant's page** says that approving links a machine to the account and to continue only if the person started it there. A new instance link appears in `remote/status` and as the hosted event `instance.linked`.
- **Tokens** are opaque, stored as SHA-256 hashes, and bound to their resource (audience) and account. Access tokens last an hour. Refresh tokens rotate on every use; for 30 s after a rotation the old token returns the same successor, so a client's parallel refreshes don't collide, and a reuse after that revokes the grant. Every endpoint answers within 10 s.
- **Client ID Metadata Documents** are fetched over `https` only, after resolving the name and refusing loopback, private, link-local and metadata addresses on every connection, with no redirects, at most 64 KiB and 5 s, and cached as their headers allow.
- **Redirect URIs** match exactly, except that the port is ignored for `http://127.0.0.1`, `http://[::1]` and `http://localhost` (RFC 8252 §7.3). Registered clients never used for 30 days are removed.
- **Identity providers** sit behind a port: `IdentityProvider` is `{ id, label, authorize(state, pkce) → URL, callback(params) → SignInIdentity }`. Built-in adapters for OpenID Connect and GitHub are configured in `identityProviders` (`{ id, kind: "oidc" | "github", issuer?, clientId, clientSecretFile, label }`); others come from the operator module. A `SignInIdentity` is `{ provider, subject, email?, name?, facts? }`, where `facts` carries what a provider tells (an account's age, for an operator's policy). `accounts.resolve` maps it to an account (§18.6).
- **Clients:** the CLI (the device grant, a public client), MCP clients (Client ID Metadata Documents or registration, authorization code with PKCE), and each hosted shell (a first-party public client per user-content domain).

### 18.6 Operator ports

An operator module is an ES module whose default export receives the server's handle and returns the ports it implements. Its types are exported by `@mostra/protocol` (`@mostra/protocol/operator`), so an operating layer imports nothing else of Mostra (invariant 11, D165 items 9, 11).

```ts
type OperatorModule = (server: ServerHandle) => OperatorPorts | Promise<OperatorPorts>;
interface OperatorPorts {
  limits?: { check(q: { account: string; home: string; artifact?: string; operation: LimitOperation; quantity?: number }):
      Promise<{ allowed: true } | { allowed: false; code: string; message: string; retryAfterMs?: number }> };
  metering?: { record(batch: { batchId: string; from: string; to: string; counters: MeterCounter[] }): Promise<void> };
  accounts?: {
    resolve(identity: SignInIdentity): Promise<{ account: string; name?: string; status: "active" | "suspended" }
      | { step: { url: string } } | { refused: { message: string } }>;
    authenticate?(bearer: string): Promise<{ account: string; scope: string[] } | null>;   // on /host, /mcp and /files
    status?(account: string): Promise<"active" | "suspended">;
  };
  abuse?: {
    report(r: { artifactId: string; home: string; versionId?: string; reason: string; detail?: string; at: string }): Promise<void>;
    pushed?(v: { artifactId: string; home: string; versionId: string; manifest: unknown; read(path: string): Promise<Uint8Array> }):
      Promise<{ quarantine?: { reason: string } } | void>;
  };
  policy?: {
    link(q: { account: string; home: string; artifactId: string; tokenId?: string }): Promise<{
      interstitial?: { kind: string; message?: string }; maxTtl?: string; idleExpiry?: string;
      afterSubmit?: string; footer?: string; madeWith?: { show: boolean; href?: string } }>;
    chatHost?(client: { name: string; redirectHost?: string }): Promise<ChatHostPolicy | null>;   // D160, over config's chatHosts
  };
  routing?: { resolve(host: string): Promise<{ shell: { domain: string } } | { route: { home: string; routeId: string } } | null> };
  events?: { deliver(e: { eventId: string; kind: "submission.accepted" | "version.pushed" | "run.ended" | "roster.completed" | (string & {});
      account: string; home: string; artifactId: string; at: string; payload: unknown }): Promise<void> };
      // payload: submission.accepted carries the submission's Results (§8); version.pushed { versionId, number };
      // run.ended { runId, action, status }; roster.completed is WP-31's
  invitations?: unknown;   // reserved for WP-31 (D121, D165 item 16); no mailer ships
}
type LimitOperation = "share" | "version.push" | "link" | "view" | "submit" | "run" | "run.wait" | "call" | "mcp.call" | "storage";
interface ServerHandle {
  quarantine(target: { artifactId: string } | { versionId: string }, reason: string): Promise<void>;
  release(target: { artifactId: string } | { versionId: string }): Promise<void>;
  pause(artifactId: string, reason: string): Promise<void>;
  resume(artifactId: string): Promise<void>;
  suspendHome(home: string, reason: string): Promise<void>;
  resumeHome(home: string): Promise<void>;
  revokeLinks(artifactId: string): Promise<number>;
  revokeLink(tokenId: string): Promise<void>;
  drainHome(home: string): Promise<void>;       // close it and refuse to reopen it, to move it between data directories
  releaseHome(home: string): Promise<void>;     // serve it again
  restored(home: string): Promise<void>;        // a restore from a backup: rotate its incarnation (§18.2)
  remove(artifactId: string): Promise<void>;   // deletion: explicit, never part of another action
}
```

- **Time limits and failures.** `limits.check`, `policy.link` and `routing.resolve` answer within 2 s, and the server may cache an answer as long as the operator says. When `limits` doesn't answer, `share`, `version.push`, `link` and authoring fail closed with 503 `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE`, while `view`, `submit` and draft writes proceed (D165 item 9). `accounts.resolve` has 5 s; past it, sign-in fails with the same code and existing sessions keep working. `abuse.pushed` has 30 s and never blocks serving: its answer can quarantine the version afterwards.
- **At least once.** `metering.record` and `events.deliver` are retried with backoff until they succeed, idempotent by `batchId` and `eventId`. The server keeps what it hasn't delivered across restarts, and logs any gap it had to drop.
- **Counters** (`MeterCounter`, `{ name, account, home?, artifactId?, value, dimensions? }`): `views` (with a monthly pseudonymous `viewerKey`, an HMAC under a key rotated each month, never an identity), `submissions`, `requests`, `bytes.stored`, `bytes.egress`, `relay.messages`, `mcp.calls` (with the client's `clientInfo` name, D148) and `home.activeSeconds`.
- **An operator's pause** can't be resumed by the owner: `artifact/pause` from the owner answers 403 `MOSTRA_REMOTE_PAUSED_BY_OPERATOR` for it.
- **No-op defaults:** `limits` allows; `metering` and `events` discard; `accounts` uses the server's own account table with no step and accepts no outside credential; `abuse` does nothing; `policy` adds nothing beyond configuration; `routing` serves only the server's own labels. A label `routing` supplies is recorded like the server's own: never given to another home.

### 18.7 CLI

Additive to §9 (D165 item 15). Help text is drafted with Mirza (D149).
- `mostra login [<server>]` prints the verification address and code (on stderr, or one `--json` event), waits for the person, and links this home. `mostra logout [<server>]` revokes the grant and removes the token.
- `mostra share <artifact> --cloud [<server>] [--scope …] [--viewer <ref>] [--ttl <d>]` hosts the artifact and prints the hosted link. `mostra share list` and `share stop` include cloud shares.
- `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (WP-30).
- `mostra status` reports each linked server (`remote/status`).
- `mostra-runtime server` (§18.1) is the remote server's entry, in the runtime bundle and the container image.

### 18.8 Remote MCP

`https://api.example/mcp` serves `@mostra/mcp`'s `createMcpServerFactory` (D164) over Streamable HTTP, statelessly, for `2026-07-28` and the 2025 revisions, behind the authorization server (§18.5). A request without a valid token for the resource `https://api.example/mcp` answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"`; a token missing a scope answers `403` with `error="insufficient_scope"`. The server's ports for the factory:
- **`McpInstance`:** the account's hosted home for `artifact_list`, `artifact_wait`, `artifact_results`, `artifact_open`, `state_get`, `state_patch` and `live_push`; the account's default owner instance, through `port/relay.author`, for `artifact_create`, `artifact_verify` and `artifact_publish` (a publish there also pushes the version and shares it to this server). With no default instance connected these answer `MOSTRA_REMOTE_NO_INSTANCE`.
- **`McpWorkspace`:** the default owner instance's own workspace (`MOSTRA_MCP_WORKSPACE`), through `port/relay.author`.
- **`McpDocs`:** the bundled reference. There is no `McpBrowser`.
- **`artifact_open`** returns the hosted link.

The tool set and its schemas are the `mcp-tools` bundle (D32); a remote tool of its own would join the bundle additively. `onClient` reports each client's `clientInfo` to `metering` (D148). How a page renders and what a quota message may say in a chat host is a policy per host (D160).

### 18.9 Reserved for WP-31

*Deferred decision* for WP-31 (D121, D165 item 16), reserved so the remote binding is designed with them in view:
- the hooks `useRespondents()` and `usePresence()` (§2.3), and `FieldMeta.updatedBy`;
- the wait conditions `submitted:all` and `submitted:<N>`, with a roster-complete event (§6);
- expected respondents on `share/start` (`respondents: { ref, name?, email? }[]`), each with a personal link;
- the operator port `invitations` (§18.6), which a server uses to send invitations where it sends them, and which ships with no mailer.
