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
  | `run_` | action run | ULID |
  | `thr_`, `cmt_` | thread, comment | ULID |
  | `tok_` | capability token | ULID (the secret is separate) |
  | `mut_` | mutation | client-generated ULID |

  Event cursors are decimal strings of a home-wide integer.
- **Time.** RFC 3339 UTC strings with milliseconds. Durations in flags and manifests are strings like `30m`, `2h` or `24h`.
- **Errors.** Every error, at every interface, is the diagnostic object of §13 (`code`, `severity`, `message`, `hint`, `docs`, optional location and fix). The host protocol wraps it in a JSON-RPC error whose `data` is the diagnostic. The CLI prints it as JSON in `--json` mode.
- **Revisions.** The host protocol and the browser protocol each carry a dated revision (`2026-11-01` style), negotiated at connect and additive within a revision (D32, D59).

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
});
```

Mostra reads it statically, so every value must be a literal (`MOSTRA_MANIFEST_NOT_LITERAL` otherwise, with the location of the first value that needs evaluation); `as const` and `satisfies` are fine. `defineArtifact` is imported from `@mostra/react`. An entry without a manifest publishes with defaults, its title taken from its directory's name (or a single file's own name). A manifest that is present needs a `title`, and its `id` is an artifact ID (`art_` and a ULID); values the manifest doesn't allow are `MOSTRA_MANIFEST_INVALID`, and unknown keys are `MOSTRA_MANIFEST_UNKNOWN_KEY` warnings. `{port}` in a demo command is replaced with the leased port. MDX uses the same fields as YAML frontmatter, and decks add `deck:` (D65).

### 2.3 `@mostra/react` (client runtime)

```ts
// Persisted value with a stable ID (D52). Behaves like useState.
function useField<T>(id: string, initial: T, options?: FieldOptions<T>): [T, (next: T | ((prev: T) => T)) => void, FieldMeta<T>];
interface FieldOptions<T> {
  label?: string; required?: boolean; sensitive?: boolean;
  validate?: ZodType<T> | ((v: T) => string | undefined);
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
  cancel(): void; runId?: string;
};

function useLive<K extends keyof LiveSources>(key: K, options?: { mode?: "latest" | "append"; window?: number }): {
  data: LiveSources[K] | undefined; isLoading: boolean; error?: Error; refresh(): void; revision?: string; at?: string;
};

function useChoice(reviewSetId: string): { choice?: string; choose(candidateId: string): Promise<void> }; // channel rules as useSubmit
function useViewer(): { id: string; name?: string; source: "local" | "tailnet" | "token" | "host" };
function useArtifact(): { id: string; versionId: string; version: number; viewId: string; mode: "live" | "static" | "mcp-app" | "verify" };

declare global { interface Window { storage: ClaudeCompatibleStorage } } // D53
```

Rules:
- All hooks work in every delivery target. In static export, fields keep values in local storage, and `submit`, actions and live data report `MOSTRA_TARGET_UNAVAILABLE`. Inside MCP Apps they use app-only tools (§12).
- Saves are optimistic and debounced (about 400 ms). They flush on blur, `visibilitychange`, `pagehide` and before submit (IN-02).
- The runtime registers fields, actions, review surfaces and the current page with the shell (§5). Every kit input takes a required `id` and binds through `useField`.
- `LiveSources` is augmented by a generated `mostra-env.d.ts` from `typeof import("./live")` (D56).

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

Server functions are ordinary async exports of `"use server"` modules. Arguments and results use React's Server Function type set plus `AsyncIterable` results (D54). Anything else is `MOSTRA_ACTION_UNSERIALIZABLE`, naming the argument. Thrown errors reach the page as `{ code: "MOSTRA_ACTION_THREW", message }`, with the stack in the run log.

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
| `POST /_mostra/v/{rev}/fields` | Mutations: `{ mutationId, scope, baseRevision, viewId, ops[] }` → `{ revision, applied[], conflicts[] }` | session, CSRF, Origin |
| `POST /_mostra/v/{rev}/submit` | `{ viewId, expectedRevision, channel: "artifact" }` → submission or typed conflict | session, `submit` scope |
| `POST /_mostra/v/{rev}/signal` | `{ viewId, name, payload }` | session |
| `POST /_mostra/v/{rev}/call/{fnId}` | Plain server-function call (Mostra serializer; streamed body for `AsyncIterable`) | session, `action:<name>` scope |
| `POST /_mostra/v/{rev}/runs` | Start or join a run: `{ fnId, args, key?, clientKey }` → `{ runId }` | as above |
| `POST /_mostra/v/{rev}/runs/{id}/cancel` | Cancel | as above |
| `POST /_mostra/v/{rev}/ticket` | Single-use stream or WebSocket ticket (worker mode, terminals) | session |
| `GET /_mostra/v/{rev}/events?view=…&cursor=…` | SSE: field changes, state, runs, live, version notices, delivery states | session or ticket |
| `GET /_mostra/v/{rev}/events/poll?…&wait=25` | Long-poll on the same cursor (D47) | same |
| `POST /a/{artifactId}/_mostra/v/{rev}/review/*` (on the shell origin) | Shell only: comments, crops, choices | shell session, `review` scope |
| `GET /_mostra/v/{rev}/term/{session}` (WebSocket) | Live terminal frames: `data`, `resize`, `input`, `ack`, `exit` | ticket |

The shell origin has its own endpoints for capability exchange, trusted-control activation, the banner, follow preferences and review, all with the same checks. Mutations require JSON content types and the CSRF header (seed hygiene items 5 and 11). WP-05 serves these on the shell origin, each artifact under `/a/{artifactId}`, so each has its own shell session (D97, D98):

| Method and path | Purpose | Auth |
|---|---|---|
| `GET /a/{artifactId}` and `/a/{artifactId}/v/{number}` | The shell page; the link's token is in the fragment (`#t=…`), which the page sends to the exchange and removes | none |
| `GET /_mostra/shell/assets/*` | The shell's built files | none |
| `POST /a/{artifactId}/_mostra/session` | Exchange `{ token }` for the shell session → `{ csrf, artifact: { id, title }, scopes, expiresAt? }` | token, Origin |
| `GET /a/{artifactId}/_mostra/session` | The same facts for an existing session | shell session |
| `POST /a/{artifactId}/_mostra/ticket` | `{ version? }` → `{ src, artifactOrigin, version: { id, number }, latest: { number } }`: a single-use frame ticket (60 s) for the link's pinned version, the asked one or the latest | shell session, CSRF |

Every route declares its intent (read, stream, upgrade, exchange or mutation), its session and its scope, and one runner applies the checks in one order: Host, request target and headers; Origin and content type; the rate limit on token paths; the session (bound to the origin it was issued for, with a live token); the CSRF token; the scope (D96). A route a later package serves answers 501 `MOSTRA_HYGIENE_NOT_SERVED` once every check has passed. Refusals are the HYGIENE diagnostics as JSON, or a plain page for a navigation: 421 for a Host outside the allowlist, 400 for a malformed request, 401 without a session or with an unknown token, 410 for a revoked or expired one, 403 for another Origin, a missing or wrong CSRF token or a scope the link lacks, 415 for a body not declared as JSON, 429 with `Retry-After` while guessing is limited, and 404 or 405 for what isn't served. Every response carries `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; none carries an `Access-Control-*` header. The shell page sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`, and artifact documents `frame-ancestors <shell origin>` (D98).

## 5. Shell ↔ artifact bridge

JSON-RPC 2.0 over `postMessage`, with exact origin checks and schema validation. It uses MCP Apps names where the concept exists (SH-04, D65). The full message set is in [rounds/ROUND-3.md §8](rounds/ROUND-3.md#8-shell-and-bridge-sh1), plus:
- `mostra/fields` carries `{ id, label, required, scope, sensitive }` registrations, so the shell lists blockers and labels.
- `mostra/controls.request` covers `submit` (label, confirm text) and `choose` (review set). The shell decides what to render: the artifact asks, the shell answers.
- `mostra/version.available` carries `{ versionId, version, orphans: number }`. The artifact may show its own notice too, but the trusted banner always appears.
- A host-supplied shell implements the same set and passes the shell conformance scenarios.

## 6. Host protocol (clients ↔ supervisor)

JSON-RPC 2.0 over newline-delimited stdio (spawned: `mostra host`, which is the runtime bundle's `mostra-runtime host`, D85) or the home's Unix socket (attached to `mostra-runtime daemon`). Schemas are Zod 4 in `@mostra/protocol`, published as JSON Schema 2020-12, with draft-07 output for typify (D59). Methods are grouped by caller need. Every mutating method takes an optional `requestId` for idempotent retries (H-03).

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
  artifact/verify  { source: SourceRef, options? }  → VerifyVerdict (§13); streams progress notifications
  artifact/publish { source: SourceRef, force?, policy?: SubmissionPolicy } → PublishReceipt
  artifact/list    { filter? }                      → { artifacts: ArtifactSummary[] }
  artifact/get     { artifact: ArtifactRef }        → ArtifactDetail (versions, views, policy, links, metadata)
  artifact/export  { artifact, version?, as: ExportClass, out } → { files: string[] }
  deps/add         { artifact: SourceRef, packages: string[] } → { packages: AddedPackage[], lockDigest }   (D95; `mostra add`)

Viewing and sharing
  view/url        { artifact, version?, scopes?, ttl?, requestId? } → CapabilityLink { url, tokenId, scopes, expiresAt? }   (D97; `viewer?` arrives with WP-06)
  view/rotate     { tokenId, requestId? }            → CapabilityLink   (D97; same artifact, scopes, expiry and pinned version; the old token answers 410)
  view/revoke     { tokenId, requestId? }            → {}   (revoking a revoked token succeeds; an unknown one is MOSTRA_HYGIENE_TOKEN_INVALID)
  share/start     { artifact, via: "tailnet" | "funnel" | "cloudflare", ttl? } → { url, hostname, mode: "cookie" | "worker" }
  share/stop      { artifact | shareId }             → {}

Interaction
  results/get     { artifact, submission?: string, format?: "json" | "md" } → Results (§8)
  wait            { artifact, until: WaitCondition, after?: Cursor, timeoutMs } → { status: "satisfied", event, cursor } | { status: "still_waiting", cursor }
  state/get       { artifact, ids? }                 → { revision, fields }
  state/patch     { artifact, ops, baseRevision?, mutationId } → { revision, conflicts }
  live/push       { artifact, key, value, mode?: "replace" | "append" } → { revision }
  review/export   { artifact, submission?, format: "md" | "json", out? } → { path | content }

Events
  events/subscribe   { filter: EventFilter, after?: Cursor } → { subscriptionId }; then notifications events/notify { events[], cursor }
  events/ack         { subscriptionId, cursor }     → {}   (durable per subscriber name)
  events/read        { filter, after, limit }       → { events[], cursor }

Administration
  secret/set | secret/list | secret/delete         (value only via set; never returned)
  instance/status    {}                              → { instance, startedAt, socket, connections, processes, gateway? } (WP-02; `gateway: { bind, shell, artifacts: { artifactId, origin }[] }`, WP-05); ports, pending deliveries, shares and versions in use are added by the packages that own them
  gc/run             { dryRun? }                     → reclaimed

Mostra → host (only to the connection that registered the port)
  port/<name>.<method>   see §7
```

`SourceRef` is `{ path }` (an absolute path; clients resolve relative ones) or `{ artifactId }` (the path it was last published from). `ArtifactRef` has the same two forms and names an existing artifact; a path is matched by its real path, so a deleted source's path still names its artifact. `ArtifactSummary` is `{ id, title, description?, family?, links, mode, policy?, source?, createdAt, latestVersion? }`, with metadata from the latest version's manifest; `ArtifactDetail` adds the latest `manifest` and every `VersionSummary` (`{ id, number, publishedAt, sourceDigest, envDigest, outputDigest, forcedDiagnostics? }`), newest first. `artifact/list` takes `filter: { family? }`. `artifact/create` writes a minimal entry with a generated `id` into an empty directory and returns `{ artifactId, dir, files }`; the artifact appears in `artifact/list` once published, and templates arrive with WP-26. `WaitCondition` is one of `submitted`, `signal:<name>`, `state:<fieldId>` and `event:<type>`, with the semantics in ARCHITECTURE §6. `PublishReceipt` is `{ artifactId, versionId, version, url?, tokenId?, cursor, reused: boolean, forcedDiagnostics?: string[] }`. It is durable before the response (H-07). `url` is the artifact's default capability link (D97 item 3): the same across publishes and `requestId` replays until it is rotated or revoked, with `tokenId` to do either. Both are optional on the wire because instances without the gateway (WP-03, before WP-05) have none; WP-05 sets them on every publish (D90). A recorded receipt that a `requestId` replays never holds the link's secret: the link joins every answer from the token. `HomeConfig` lets a spawning host set the submission policy defaults, the allowed submit channels, the dependency policy (`dependencies: "auto" | "explicit"`, D43, D95, kept in the home's `config.json` for every later client), and the ports it will always provide (so deliveries wait for it, FAILURE_MODEL §4); each field arrives with the package that implements it. Its `path` is a check, not a setting (D84): the supervisor resolved and locked its home at process start (`--home`, then `MOSTRA_HOME`, then the platform default; an SDK passes its `home` option as `--home`), and a `path` that names a different home is refused with `MOSTRA_HOME_MISMATCH`.

`deps/add` (D95) takes npm registry specs (`name`, `name@version`, `name@range`, `name@tag`) and records each package at an exact version in the artifact's working lockfile, installing it into the home's store. A package of the warm set is answered with its warm version (`warm: true`), and a version of it the warm one doesn't satisfy is `MOSTRA_DEP_WARM_CONFLICT`. `AddedPackage` is `{ name, version, warm }`; `lockDigest` is the lockfile's digest after the change, which the artifact's next publish uses. Packages added this way stay in the lockfile whether or not the source imports them. The supervisor treats itself as offline when its environment sets `MOSTRA_OFFLINE` (any value but `0`, `false` or `no`) or no network interface has a routable address; offline, packages resolve only from the home's store.

`view/url` mints a new token on every call (D97), for the artifact's latest version or a pinned `version` (a number or a version ID; an unknown one is `MOSTRA_ARTIFACT_VERSION_NOT_FOUND`). `scopes` default to every scope: `view` (always added), `draft`, `submit`, `review` and `action:*`; `action:<export>` and `action:<module path>#<export>` grant one action. `ttl` is a duration such as `30m`, `24h` or `7d`; without one the link doesn't expire (D63). A replayed `requestId` returns the same link. `CapabilityLink.url` is `http://<url host>:<shell port>/a/<artifactId>[/v/<number>]#t=<secret>`.

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
  addressing?: { externalBase(o: { artifactId: string; purpose: "view" | "share" }): Promise<{ origin: string; mode?: "cookie" | "worker" } | null> };
  trustedControls?: { policy(a: ArtifactSummary): Promise<{ submitChannels: ("shell" | "artifact")[]; controls?: ("submit" | "choose" | "approve")[] }>;
                      activated?(e: { artifactId: string; control: string; viewer: Viewer; viewId: string }): Promise<void> };
  capture?: { screenshot(r: CaptureRequest): Promise<{ png: Uint8Array }>; aria?(r: CaptureRequest): Promise<{ yaml: string }> };
  secrets?: { get(r: { artifactId: string; name: string }): Promise<string | null> };
  pty?: { spawn(spec: PtySpec): Promise<PtyHandle> };   // streams over the same connection
}
```

- **`SubmissionEnvelope`** carries the full submission (§8 JSON) and a stable `deliveryId`. A host may store it as an opaque payload (H-01).
- **`deliver` results.** `retry: true` keeps the delivery in the outbox. `undeliverable` is terminal and shown to the viewer.
- **The Rust crate** exposes the same ports as async traits.
- **`WorkerLauncher`** (internal in v1, the seam for v1.x `SandboxPort`) is `{ launch(spec: { versionDir, env, limits }): Promise<WorkerChannel> }`. Its local implementation forks a child process.

## 8. Results

`results/get`, `mostra results`, `artifact_results` and the submissions port all carry one structure:

```ts
interface Results {
  artifact: { id: string; title: string; family?: string; links: Link[] };
  submission: { id: string; at: string; epoch?: number; policy: SubmissionPolicy; channel: "shell" | "artifact";
                viewer: Viewer; versionId: string; version: number; viewId: string; staleView: boolean;
                draftRevision: string; stateRevision?: string; digest: string; delivery: "pending" | "delivered" | "undeliverable" };
  answers: Record<string, unknown>;         // dotted field IDs nested; labels in `fields`
  fields: { id: string; label?: string; required?: boolean; scope: "viewer" | "artifact" }[];
  state?: Record<string, unknown>;          // artifact-scoped fields at stateRevision
  choices: { reviewSetId: string; candidateId: string; label?: string }[];
  comments: { threadId: string; status: "open" | "resolved"; messages: { author: Viewer; at: string; text: string }[];
              anchor: { reviewId?: string; selectors?: W3CSelector[]; rect?: Rect; viewport?: Viewport; page?: string;
                        candidateId?: string; terminal?: { rows: [number, number]; cols: [number, number]; t?: number };
                        time?: number; slide?: { index: number; step: number } };
              crop: { path: string; width: number; height: number } }[];
  orphaned: { id: string; label?: string; value: unknown; fromVersion: number }[];   // D42
  actions: { runId: string; action: string; status: string; at: string }[];         // runs started in this view
  signals: { name: string; at: string; payload?: unknown }[];
}
```

The Markdown rendering follows ROUND-2 §1.1: a header with IDs, then answers by label, choices, comments with crop paths, actions, then "Not carried over". Sensitive fields appear in results and are redacted from events and logs (D52).

## 9. CLI

The command set is D60 plus `mostra run <bundle>` (runs a portable `bundle` export) and `mostra state get|set|patch`. `mostra add <package…> [--artifact <path|id>]` is the client of `deps/add` (D95), defaulting to the artifact in the current directory; `MOSTRA_DEP_MISSING` carries that exact command. Rules (AX-01):
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

## 10. Terminal frames and dumps

The frame model is in [rounds/ROUND-3.md §5.2](rounds/ROUND-3.md#52-frame-model) (D65), as Zod schemas in `@mostra/protocol` that the Rust crate shares.

`mostra term dump <source> --format text|cells|ansi [--at <time|marker|step>] [--cols N --rows N]` accepts:
- `.cast` files;
- frame JSON;
- a live session (`--session <artifact>:<name>`);
- a URL to a `<Terminal>` inside a published version.

The `text` format is exact cells with wide tails omitted, followed by a lint section listing misaligned box borders, cells beyond `cols` and width-table disagreements.

## 11. Build and render mode (internal)

`RenderMode` is in [rounds/ROUND-3.md §7](rounds/ROUND-3.md#7-render-mode-contract-rd1). The builder entry is `build({ source, lockfile, base, mode, out }) → { client, server?, registry: { fields, actions (with dryRun flags), liveSources, pages, terminals, demos }, diagnostics }`. The registry feeds `verify`, the shell and `results`. WP-03's builder writes `registry.json` with `schemaVersion`, `entry`, `actions` (`{ id, module, export, dryRun }`), `liveSources`, `pages` (`{ path, file }`), `terminals` and `demos`; `fields` join it with the client runtime (WP-07). The builder runs in a child process per build (`builder/build` over IPC), so the supervisor never loads the bundler (RT-02).

## 12. MCP server

`mostra mcp` runs over stdio, or over Streamable HTTP with `--http`, applying the full hygiene checklist (HY-01 item 13). It is stateless: every tool takes explicit handles (D61).

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
  //       TERM PUBLISH SUBMIT HOST HOME HYGIENE SECRET SHARE VERIFY TARGET ENV PLATFORM ARTIFACT (D92)
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

## 14. Extension contracts and the plugin manifest

These are specified in [rounds/ROUND-3.md §6](rounds/ROUND-3.md#6-extensions-ex1-to-ex3) (D65): six contract packages with `define*` blueprints, the `"mostra"` manifest key validated by `mostra plugin validate`, shadcn-compatible packs, loading order, conflict rules and license acknowledgment (D31).

## 15. Export formats

- **`static` and `html`.** Hash routing, the runtime's static transport, and no credentials or secrets.
- **`bundle`.** A directory or `.tar.zst` with `mostra-bundle.json`, which records schema version, artifact metadata, `versionId`, digests, the lockfile, and the client and server builds. `mostra run <bundle> [--home]` imports it into a home as a version of the same artifact ID, so remote mode can ship versions between homes (RM-01).
- **`snapshot`.** The `static` build, plus a frozen `snapshot.json` (field values, live values and choices at a cursor). Actions render as unavailable.
- **`mcp-app`.** One HTML file plus `mcp-app.json`, carrying the `_meta.ui` CSP declaration and resource URI.

Secrets never enter any export (STANDARDS security).
