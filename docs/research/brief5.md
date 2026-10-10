# Interaction, State, Review Layer and Local-Server Hygiene for an Agent Artifact Toolkit (Brief 5, October 2026)

Build the interaction layer on a plain, server-authoritative event log: versioned drafts with optimistic concurrency, SSE fan-out to tabs, and an immutable, content-hash-bound submission written with an idempotency key. CRDTs (Yjs/Automerge) are overkill for single-user multi-tab forms, so keep them as an opt-in plug-in for real co-editing. Anchor review comments in four layers (semantic id → W3C Web Annotation selectors → frame-relative coordinates → screenshot region). Put trusted Submit/Approve controls in host chrome on a separate origin. Enforce Jupyter/MCP-grade hygiene: a high-entropy capability token swapped for an HttpOnly cookie, Host and Origin allowlists, CSRF tokens, loopback binding and no wildcard CORS. None of this limits what artifacts may do.

## TL;DR

- **State:** use a toolkit-owned append-only log with per-key version numbers (`If-Match`-style compare-and-set), SSE for push, IndexedDB for offline drafts, and a submission record that freezes `{artifactId, contentHash, draftVersion, values}` under an `Idempotency-Key`. Single-user multi-tab conflicts are rare and resolve well with last-writer-wins per field plus version checks. Yjs/Automerge only pay off for concurrent rich-text or canvas editing by several people.
- **Review and host integration:** model every comment as a W3C Web Annotation with several fallback selectors, inject a small bridge script into every frame the toolkit serves (cross-origin content gets a proxy-injected bridge or a screenshot fallback), and expose five host ports (Storage, Events, Identity, Addressing, TrustedControls). The ports follow the MCP Apps pattern: JSON-RPC over postMessage, content sandboxed on a separate origin, and host-rendered controls the artifact cannot spoof or click.
- **Hygiene:** the Vite (CVE-2025-24010), MCP SDK and Jupyter advisories all have the same root cause: localhost servers that do not check Host/Origin. The minimum is loopback bind, a Host allowlist, an Origin check on every state-changing request and WebSocket/SSE, a URL capability token swapped for an `HttpOnly; SameSite=Strict` cookie, a CSRF token on mutations, `Referrer-Policy: no-referrer`, per-artifact token scope, and Tailscale Serve (not Funnel) for phone access.

## Key Findings (verified facts, October 2026)

| Area | Fact | Source / date |
|---|---|---|
| MCP core | Current spec is **2026-07-28**: stateless core (no `initialize` handshake, no `Mcp-Session-Id`), Multi Round-Trip Requests (MRTR) replace server-initiated sampling/elicitation, Tasks moved to `io.modelcontextprotocol/tasks` extension, Roots/Sampling/Logging deprecated | MCP blog "The 2026-07-28 Specification" (Soria Parra, Delimarsky); RC locked May 21, 2026\[1\] |
| MCP elicitation | URL-mode elicitation introduced in **2025-11-25** (SEP-1036); form mode must not collect secrets; in 2026-07-28 `elicitationId`/`notifications/elicitation/complete` were removed in favour of MRTR (`requestState` echoed by client) | MCP 2025-11-25 elicitation spec; secondary analyses of 2026-07-28\[2\]\[3\] |
| MCP Apps | SEP-1865 **Stable 2026-01-26**, extension id `io.modelcontextprotocol/ui`, `ui://` resources with MIME `text/html;profile=mcp-app`, JSON-RPC 2.0 over postMessage, web hosts must render through a **sandbox proxy on a different origin** | `modelcontextprotocol/ext-apps` spec `2026-01-26/apps.mdx`\[4\]\[5\] |
| MCP transport security | Streamable HTTP: servers **MUST** validate `Origin` on all incoming connections, **MUST** reply 403 if present and invalid, **SHOULD** bind to 127.0.0.1 when local | MCP 2026-07-28 Streamable HTTP spec\[6\] |
| Vite | CVE-2025-24010: no Host validation + permissive CORS + no WebSocket Origin check let any website read dev-server responses; fixed in 4.5.6 / 5.4.12 / 6.0.9 (20 Jan 2025) by adding `server.allowedHosts` (default `[]`: localhost, `*.localhost`, IPs) and turning `server.cors` off by default; check skipped under HTTPS; `allowedHosts: true` re-opens DNS rebinding | Vite GHSA-vg6x-rcgg-rjx6; Vite server-options docs\[7\]\[8\]\[9\] |
| Jupyter | Token auth on by default since Notebook 4.3; XSRF required unless token-authenticated; Host check against `local_hostnames` (default `['localhost']`) when `allow_remote_access=False` was a pre-emptive DNS-rebinding defence (Notebook 5.6/5.7); **CVE-2026-40110**: `allow_origin_pat` used `re.match()` (unanchored), fixed in jupyter-server **2.18.0** (also added Origin checks on websockets); **CVE-2022-29241** token leak, fixed 1.17.1 | Jupyter Server config docs; GHSA-24qx-w28j-9m6p (May 5, 2026); Notebook changelog\[10\]\[11\]\[12\]\[13\]\[14\] |
| Chrome LNA | Local Network Access permission prompt: intent to ship in Chrome 141, enforced Chrome 142; split into "Local Network" and "Loopback Network" permissions in Chrome 145/146; same-address-space requests (localhost → localhost) do not prompt; iframes need `allow="local-network-access"` (now `loopback-network`) delegation | blink-dev Intent to Ship; Okta and Dynamsoft support docs\[15\]\[16\]\[17\]\[18\] |
| Idempotency-Key | `draft-ietf-httpapi-idempotency-key-header-07` (Oct 15, 2025) **expired 2026-04-18** without becoming an RFC; it is a de facto standard (Stripe-style) only\[19\] | IETF Datatracker history\[20\]\[21\] |
| Claude artifacts | `window.storage.get/set/delete/list(key, shared?)`; personal vs shared scope; **published artifacts only** ("storage operations will not succeed until the artifact is published"); 20 MB per artifact; text values; Pro, Max, Team and Enterprise plans on web and desktop; shipped Oct 21, 2025 | Claude Help Center "Persistent storage for artifacts" (as quoted verbatim by homespun.dev and caipi.ai); dev guides |
| Streamlit | `st.session_state` is per *session* = one browser tab; refreshing or reloading resets it; not durable\[22\]\[23\] | Streamlit docs "Advanced concepts" |
| Tailscale | Serve = tailnet-only HTTPS, adds `Tailscale-User-Login/Name/Profile-Pic` identity headers (not for tagged devices; spoofable if backend reachable directly); Funnel = public internet, **no identity headers** | Tailscale Serve/Funnel docs\[24\]\[25\] |
| W3C TAG capability URLs | Draft (2014) good practices: HTTPS only, unguessable via CSPRNG, expire, revocable, multiple per resource, no third-party links/scripts on capability pages, rate-limit, GETs side-effect free, 410/404 on expiry | W3C TAG "Good Practices for Capability URLs" ED 2014-07-23\[26\] |

## 1. Server-persisted inputs: drafts, multi-tab sync, offline, submission snapshot

### Prior art, as it actually works

- **Claude artifacts** offer a plain async key-value API (`window.storage`) with a per-key `shared` flag. It works on published artifacts only, values are text, and the cap is 20 MB per artifact.\[27\]\[28\] It has no versioning, no subscriptions and no submission concept. The lesson: agents learn a tiny KV API easily. A toolkit should match its ergonomics and add what it lacks: versions, change events and an immutable submit.
- **Streamlit** state lives in server memory for each browser tab and resets on refresh.\[22\]\[29\] That is the wrong default for an artifact a user may revisit from a phone. Drafts must outlive tabs and server restarts.
- **Sync engines** solve multi-user, multi-device data replication. For a local single-user toolkit their main value is design patterns (mutation queues, server-authoritative rebase), not a dependency.

### Comparison of sync/state options

| Option | Current version / date | License (commercial notes) | Fully local, no cloud? | React integration | Maintenance signal | Fit for this toolkit |
|---|---|---|---|---|---|---|
| Plain SSE/WebSocket + version numbers (toolkit-owned) | n/a | yours (MIT/Apache) | Yes | `useSyncExternalStore` hook | n/a | **Best default** |
| Yjs | 13.6.32 latest on npm; 14.0.0 in beta\[30\] | MIT | Yes (bring transport/storage) | community bindings | very high download volume, active v14 | Opt-in for co-editing |
| Automerge | 3.4.1 (Aug 12, 2026); 3.0 (July 2025) cut memory "by over 10x" per the Automerge 3.0 blog (Moby Dick: 700 MB in v2 vs 1.3 MB in v3) | MIT | Yes (Automerge Repo) | `@automerge/react` | active monthly releases and blog | Opt-in, history-rich docs |
| Liveblocks | `@liveblocks/client` 3.24.1; `@liveblocks/server` 1.9.0 | Clients Apache-2.0; server AGPL-3.0 (open-sourced Feb 2026) | Dev server runs locally, but vendor "do not yet offer or recommend self-hosting"\[31\]\[32\]\[33\]\[34\] | first-class | very active | Prior art for comments UX only |
| Convex | self-hosted backend | FSL-1.1-Apache-2.0 (no competing hosted service; each release becomes Apache-2.0 after 2 years) | Yes (Docker + SQLite)\[35\]\[36\] | first-class | active, VC-backed | Too heavy; FSL friction for an OSS toolkit |
| PartyKit / PartyServer | `partyserver` on Cloudflare Workers | MIT | Only via Workers runtime (wrangler/miniflare) | `partysocket` | Cloudflare-owned since Apr 5, 2024; repo issues active May 2026\[37\]\[38\]\[39\] | Runtime mismatch |
| ElectricSQL | 1.0 GA Mar 17, 2025 | Apache-2.0 | Yes, but requires Postgres with logical replication | `useShape` | team joining Neon at Databricks\[40\]\[41\]\[42\] | Read-path only; needs Postgres |
| Replicache | **maintenance mode**: replicache.dev says "We will continue to support Replicache, but won't add new features. Existing users should migrate to Zero." | free, formerly source-available | Yes | yes | **maintenance mode** (no new features; migrate to Zero) | Do not adopt |
| Rocicorp Zero | 1.0 stable | Apache-2.0 | Self-hostable, needs Postgres + zero-cache | `zero-react`\[43\]\[44\]\[45\] | active | Overkill; needs Postgres |

### Ranked recommendation: are CRDTs needed?

1. **Toolkit-owned versioned KV + event log, server-authoritative (recommended).** One user and several tabs produce rare, low-stakes conflicts. Per-field last-writer-wins plus a monotonic `version` per draft key and compare-and-set writes handles them deterministically. The result is easy for agents to reason about and easy for a host to own through a StoragePort. Text fields can carry a `baseVersion`; on conflict the client rebases by keeping the server value and showing a "changed in another tab" hint.
2. **Same, plus an optional `@toolkit/crdt` plug-in backed by Yjs** for artifacts that need true concurrent editing (shared notes, whiteboards). Yjs is chosen for maturity, size and its ecosystem (TipTap, y-websocket, Liveblocks and PartyServer all speak it). Automerge is a close second when full history matters.
3. **An external sync engine (Zero/Electric/Convex).** Each adds Postgres or a separate backend, and Convex adds FSL licensing. That is unjustified for a local CLI.

**What would overturn it:** requirements for (a) multiple humans editing the same artifact at once, (b) long offline edits on several devices with merges, or (c) hosts that need peer-to-peer sync with no server. Any of these makes the CRDT plug-in the default for the affected fields.

### Draft, offline and submission design (judgment)

- **Draft record:** `{artifactId, contentHash, key, value, version, updatedAt, clientId}`, written by `PUT /drafts/:key` with `If-Match: <version>`. The server answers `409` with the current value on mismatch. Autosave is debounced (around 400 ms) and flushes immediately on `visibilitychange`/`pagehide`.
- **Multi-tab:** the server broadcasts `draft.changed` over the artifact's SSE stream. Same-browser tabs also use `BroadcastChannel` for instant echo. Each tab keeps a `clientId` so it ignores its own echoes.
- **Offline:** an IndexedDB mutation queue (the Replicache pattern) replays in order on reconnect, with each mutation carrying its `baseVersion`. Rejected mutations surface as conflicts and are never silently dropped.
- **Submission (immutable):** `POST /submissions` with `Idempotency-Key: <uuid generated when the form opened>`.\[46\] The body freezes `{artifactId, contentHash (SHA-256 of the built artifact bundle and its data inputs), draftVersion, values, schemaHint?, submittedAt, identity}`. The server stores the record write-once, then replays the stored response for duplicate keys (the expired IETF draft's semantics: same key and same fingerprint → same response; same key and different payload → 422). A submission whose `contentHash` no longer matches the current build is still accepted and flagged `stale: true`, because the human answered what they saw. The agent receives the hash and can diff.

## 2. Review layer: comments, annotations, galleries, compare

### How prior art anchors comments

- **Vercel Toolbar comments** pin to a clicked element or highlighted text ("attached to the underlying DOM element"). They record browser, OS, screen dimensions, device pixel ratio and deployment, and sync threads to GitHub PRs and a `vercel comments` CLI.\[47\]\[48\]\[49\]\[50\] Users have asked for programmatic export of "DOM selector of the commented element" for AI agent loops, which confirms that agents need this data.\[47\]
- **W3C Web Annotation Data Model** (Recommendation, 23 Feb 2017) defines composable selectors: `CssSelector`, `XPathSelector`, `TextQuoteSelector` (exact + prefix/suffix), `TextPositionSelector`, `FragmentSelector` (including media fragments `xywh=` and `t=`), `SvgSelector`, `RangeSelector`, and refinement via `refinedBy`. One target may list several selectors as fallbacks.\[51\]\[52\]\[53\]\[54\]\[55\]
- **Liveblocks Comments, Figma, Marker.io, BugHerd, tldraw** (not re-verified in this pass; general knowledge): Figma and tldraw pin to canvas coordinates in the document's own space. Marker.io and BugHerd attach a screenshot plus selector and environment metadata. Liveblocks offers thread and room primitives with app-defined anchoring metadata.

### Recommended architecture (judgment)

**Layered anchor:** every comment stores all applicable layers and resolves top-down.

1. **Semantic anchor:** `data-review-id="chart.revenue.q3"`, emitted by toolkit components automatically and addable by agents to anything. It survives re-renders and agent edits, and it is the layer agents can act on directly.
2. **DOM/text anchor:** `CssSelector` plus `TextQuoteSelector` (exact/prefix/suffix), stored in W3C format.\[56\]
3. **Coordinate anchor:** frame-relative `xywh` as a fraction of the element's box (or of the viewport if no element), plus viewport size and DPR.
4. **Visual anchor:** a cropped screenshot of the region, captured on the client or by a headless renderer, plus the `contentHash` of the version shown. Always stored, because agents cannot see the browser and need the pixels.

**Special content:**
- *Canvas/WebGL/charts:* the toolkit's chart and canvas wrappers expose `getReviewTarget(x, y) → {seriesId, datumIndex}` so a click becomes a semantic anchor. Otherwise the coordinate and screenshot layers apply.
- *Terminal/TUI (xterm.js):* anchor to `{row, col, rowSpan, colSpan}` in buffer coordinates plus the recorded stream offset (an asciicast v2 event timestamp) and the selected cell text as a quote selector.
- *Video/motion:* `FragmentSelector` media fragment `t=12.4` plus `xywh`.
- *Cross-origin iframes:* (a) if the toolkit serves the frame (its own sandbox origin), it injects the bridge script, which answers hit-test, selector and scroll requests over postMessage; (b) third-party live demos go through a toolkit reverse proxy that injects the bridge script (works for most sites, breaks some CSP/integrity setups); (c) otherwise fall back to coordinates plus a screenshot of the iframe rectangle.

**Overlay:** the comment overlay is rendered by toolkit or host chrome *above* the artifact frame. It is never part of agent-authored content, so pins, threads and the "resolve" state stay trustworthy and survive artifact crashes.

**Galleries, choose-one and compare:** a candidate set is `{setId, candidates:[{candidateId, artifactId, contentHash, label}]}`. The views are a grid (thumbnails rendered headlessly), a focus view, side-by-side compare (2–4 synchronized frames sharing scroll and viewport, with an optional pixel-diff or onion-skin view), and a host-rendered "Choose this one" control. A choice is a submission whose payload is `{choice: candidateId, comments:[annotationIds]}` and which binds every candidate's `contentHash`.

## 3. Real actions: agent-authored server functions

**Prior art.** React Server Functions/Actions (React 19.x) give the "function reference from a button" ergonomics. TanStack Start server functions and tRPC show typed RPC without a framework lock-in. Inngest, Trigger.dev and Temporal show durable steps and retries. Versions for these were not re-verified in this pass, so treat them as patterns, not dependencies.

**Recommended model (judgment):**
- Agents write `actions/*.ts` exporting `defineAction({ input?: zodLike, run: async (input, ctx) => … })`. The toolkit runs them in the local server process (Node/Bun) with full capability. It adds no sandbox, consistent with the "curl" stance.
- The client calls `useAction('sendReply')`, which returns `{run, status, progress, result, error}`. Transport is `POST /actions/:name` with an `Idempotency-Key` header and a JSON body, and the response is an SSE stream (`progress`, `log`, `partial`, `result`, `error` events). A `ReadableStream` with `text/event-stream` works in all browsers, and SSE reconnect with `Last-Event-ID` lets the page reattach to a running action after reload.
- `ctx` provides `ctx.progress(pct, msg)`, `ctx.emit(event)` (forwarded to the host EventPort, e.g. `agent.notify`), `ctx.signal` (AbortSignal for cancel), `ctx.storage` and `ctx.identity`.
- **Long-running work:** every invocation becomes an `ActionRun {runId, name, idempotencyKey, status: queued|running|succeeded|failed|cancelled, startedAt, events[]}` persisted to the StoragePort. Runs outlive the tab and can be listed and re-attached. Retries belong to the agent's code (`ctx.retry(fn, policy)` helper) and never happen implicitly on non-idempotent work.
- **Idempotency:** the server de-duplicates on `(artifactId, actionName, idempotencyKey)` and replays the stored result for a duplicate. The button generates the key when clicked, so a double-click or a network retry never sends two emails.

## 4. Live data: loaders, polling, streams, file watching, CLI push

- **Channel choice (judgment):** use **SSE as the default push channel**. It is HTTP, survives proxies and tunnels, reconnects automatically, is easy to Origin-check, and is enough for server→client data. Use WebSocket only for high-rate bidirectional streams (terminal I/O, CRDT updates). Polling is the fallback for remote APIs the agent fetches on a timer.
- **Loader API:** `defineLoader({ key, load, watch?: paths | interval | stream })`. Results are cached under a versioned key, and the client consumes them through one `useLive(key)` hook built on `useSyncExternalStore`, so React Query/SWR are optional, not required.
- **Push from CLI/SDK:** `toolkit push <artifact> <key> --json data.json` or `POST /data/:key` (token-authenticated) bumps the version and broadcasts on SSE. Agents can update a running dashboard without touching the browser.
- **File watching:** prefer Node's built-in `fs.watch({recursive:true})` (supported on macOS and on Linux in current Node LTS) or `@parcel/watcher` for large trees. Chokidar is a fine wrapper (versions not re-verified here). Debounce and hash file contents to avoid duplicate events.
- **Vite HMR custom events** (`server.ws.send` / `import.meta.hot.on`) are tempting as a push channel but couple live data to dev mode. Use them only to trigger code reloads and keep data on the toolkit's own SSE stream, which also works in built or preview mode.

## 5. Host integration: ports, adapters and trusted controls

### Prior art

- **MCP Apps (stable 2026-01-26):** UI templates are pre-declared `ui://` resources, rendered in a sandboxed iframe behind a sandbox proxy on a separate origin, communicating with the host via JSON-RPC over postMessage that the host can intercept, audit or gate on user consent.\[4\]\[5\] This is the closest model and should be the toolkit's embed protocol.
- **MCP elicitation:** form mode (structured, non-secret) vs URL mode (out-of-band page for secrets/OAuth).\[57\]\[58\] The toolkit's artifact URL is a natural URL-mode target. Under 2026-07-28 this is expressed through MRTR rather than a server-initiated request.
- **OpenAI Apps SDK:** secondary sources (Aug 2026) say MCP Apps `ui/*` is now the baseline for ChatGPT, with `window.openai` an optional ChatGPT-specific extension.\[59\] A thin adapter is cheap. This was not verified against OpenAI docs in this pass.
- **Jupyter and VS Code webviews** (patterns, not re-verified): Jupyter separates server (REST + token) from kernels (ZeroMQ message protocol) and hands clients a tokenized URL. VS Code webviews are isolated, CSP-restricted frames that talk to the extension host only via `postMessage`/`acquireVsCodeApi()`, with host-rendered chrome around them.

### Design principles (judgment)

- **Two origins minimum:** `chrome.<id>.localhost` (toolkit/host UI, trusted controls, comment overlay) and `content-<artifactId>.localhost` (agent-authored React). Browsers resolve `*.localhost` to loopback, which gives a distinct origin per artifact for free. The content frame can call its own server functions but cannot script the chrome frame. Trusted controls are clickable only by the human in chrome, and the artifact can only *request* them (`trustedControls.request({kind:'submit', label})`).
- **Content frame sandbox flags** are about *integrity of host controls*, not capability limits: the artifact keeps full network, scripts and storage access on its own origin.
- **The Rust harness** spawns `toolkit serve --host-adapter=stdio`. Ports are then served over JSON-RPC on stdio (mirroring MCP stdio), so the harness owns storage and receives submissions without opening another socket.

## 6. Hygiene without capability limits

**Threat:** any website the user visits can make their browser send requests to `127.0.0.1:<port>` (CSRF) or rebind its own DNS name to 127.0.0.1 and then read responses as "same-origin" (DNS rebinding).\[7\]\[60\] Vite CVE-2025-24010, the MCP TypeScript SDK's CVE-2025-66414 (NVD, Dec 2, 2025: before 1.24.0 the SDK "does not enable DNS rebinding protection by default for HTTP-based servers"; fixed in `@modelcontextprotocol/sdk` 1.24.0) and Jupyter's pre-emptive Host checks all address this. Chrome's Local Network Access prompt (enforced since 142) now blocks *public-site → loopback* requests by default,\[16\] but only in Chromium, only behind a permission the user may grant, and not for rebinding (where the page is already "local"). Server-side checks remain mandatory.

**Remote access from a phone:** ranked choices.
1. **Tailscale Serve (recommended):** tailnet-only, automatic HTTPS, and identity headers (`Tailscale-User-Login`) the toolkit can map to the IdentityPort. Bind the backend to loopback so the headers cannot be spoofed.\[24\]\[61\] Add `*.ts.net` hostname to the Host allowlist explicitly.
2. **Cloudflare Tunnel + Access:** no open ports, with an email one-time PIN or IdP login in front (Cloudflare One docs: "OTP codes are single-use and expire 10 minutes after the initial request"). Good when no VPN is installed on the phone, but traffic terminates at Cloudflare.
3. **ngrok with an OAuth/OIDC traffic policy:** quick, restrict by email expression. Managed OAuth apps are for development.\[62\]\[63\]
4. **Tailscale Funnel or any unauthenticated public tunnel:** "anyone with the Funnel URL can access", so the capability token becomes the only barrier.\[64\]\[65\] Allow it only with an explicit flag and short-lived tokens.

**What would overturn the ranking:** a host that already provides an authenticated reverse proxy (then delegate identity to it), or an enterprise ZTNA mandate (then Cloudflare Access or an equivalent).

## Deliverable (a): State and event model

```
Entities (all keyed by artifactId; artifact = {artifactId, contentHash, version, title})
  Draft        {key, value, version, updatedAt, clientId}              mutable, CAS by version
  Submission   {submissionId, idempotencyKey, artifactId, contentHash,
                draftVersion, values, identity, submittedAt, stale}    write-once
  Annotation   {id, target:{source, contentHash, selectors[]}, body,
                author, status: open|resolved, thread[]}               append-only edits
  ActionRun    {runId, action, idempotencyKey, status, events[]}       append-only events
  DataSnapshot {key, version, value, source: loader|push|watch}        latest + version

Event envelope (one append-only log per artifact, delivered by SSE id = seq)
  {seq, ts, artifactId, contentHash, type, actor:{kind: human|agent|host, id}, payload}

Event types
  artifact.published | artifact.updated (new contentHash)
  draft.changed | draft.conflict
  submission.created            -> EventPort.deliver (host forwards to agent)
  annotation.created|updated|resolved
  choice.made                   (gallery choose-one; a submission subtype)
  action.started|progress|log|succeeded|failed|cancelled
  data.updated
  agent.notify                  (emitted by ctx.emit from actions)

Rules
  - Server is authoritative; clients apply events by seq; reconnect with Last-Event-ID.
  - Writes: Draft via If-Match version; Submission/Action via Idempotency-Key
    (same key + same body -> replay; same key + different body -> 422).
  - Every human-facing record binds the contentHash that was on screen.
```

## Deliverable (b): Review-layer architecture

```
┌──────────── Host/Toolkit chrome (origin A, trusted) ────────────┐
│ Toolbar · Comment overlay & pins · Inbox · Gallery/Compare grid │
│ TrustedControls (Submit / Approve / Choose)  ← human-only       │
│        ▲ postMessage JSON-RPC (MCP Apps-style, origin-checked)  │
│ ┌────── Content frame (origin B = content-<id>.localhost) ─────┐│
│ │ Agent React artifact + injected review bridge:               ││
│ │  hitTest(x,y) → {reviewId?, cssSelector, textQuote, rect}    ││
│ │  resolve(anchor) → rect | null ; scrollTo(anchor)            ││
│ │  ├─ nested iframe served by toolkit → bridge injected        ││
│ │  ├─ third-party iframe via proxy → bridge injected           ││
│ │  └─ opaque iframe/canvas → coordinates + screenshot only     ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
Anchor resolution order: data-review-id → CssSelector+TextQuote → xywh (frame-relative) → screenshot region
Terminal: {row,col,span} + asciicast t + cell-text quote.  Video: t= + xywh.
Agent-facing export: `toolkit review export <artifact> --format=md|json` with the screenshot crop path per comment.
```

## Deliverable (c): Host-port interface sketch (TypeScript)

```ts
type ArtifactRef = { artifactId: string; contentHash: string; version: number };
type Actor = { kind: 'human' | 'agent' | 'host'; id: string; display?: string };

interface StoragePort {
  getDraft(a: ArtifactRef, key: string): Promise<{ value: unknown; version: number } | null>;
  putDraft(a: ArtifactRef, key: string, value: unknown, ifVersion: number | null,
           by: Actor): Promise<{ ok: true; version: number } | { ok: false; current: { value: unknown; version: number } }>;
  createSubmission(s: Omit<Submission, 'submissionId'>): Promise<Submission>; // idempotent on s.idempotencyKey
  listSubmissions(artifactId: string): Promise<Submission[]>;
  appendEvent(e: ToolkitEvent): Promise<{ seq: number }>;
  readEvents(artifactId: string, afterSeq: number): AsyncIterable<ToolkitEvent>;
  putAnnotation(a: Annotation): Promise<void>;
  putBlob(bytes: Uint8Array, mime: string): Promise<{ blobId: string }>; // screenshots
}

interface EventPort {
  deliver(e: ToolkitEvent): Promise<void>;          // submission.created, agent.notify, choice.made …
  subscribe?(filter: { artifactId?: string; types?: string[] },
             onEvent: (e: ToolkitEvent) => void): () => void; // host → toolkit (e.g., agent pushes data)
}

interface IdentityPort {
  resolve(req: { headers: Record<string, string>; cookie?: string }): Promise<Actor | null>;
  // default: single local user; Tailscale adapter maps Tailscale-User-Login
}

interface AddressingPort {
  urlFor(a: ArtifactRef, opts?: { view?: 'content' | 'review' | 'gallery'; ttlSec?: number;
         scope?: CapabilityScope[] }): Promise<string>; // mints capability URL
  publicBase(): Promise<string>;                        // http://127.0.0.1:port | https://host.tailnet.ts.net
  revoke(tokenId: string): Promise<void>;
}
type CapabilityScope = 'view' | 'draft' | 'submit' | 'action:*' | `action:${string}` | 'review';

interface TrustedControlsPort {
  // Rendered by host chrome, outside agent content; artifact can only request.
  render(slot: { artifact: ArtifactRef; controls: TrustedControl[] }): void;
  onActivate(cb: (c: TrustedControl, by: Actor) => Promise<void>): () => void;
}
type TrustedControl =
  | { kind: 'submit'; label: string; bindsDraftKeys: string[] }
  | { kind: 'approve' | 'reject'; label: string; subject: string }
  | { kind: 'choose'; setId: string; candidateId: string };

interface HostAdapter {
  storage: StoragePort; events: EventPort; identity: IdentityPort;
  addressing: AddressingPort; trustedControls?: TrustedControlsPort; // absent => toolkit chrome renders them
  transport: 'in-process' | 'stdio-jsonrpc' | 'http';
}
```

Defaults: a file-backed (SQLite/JSONL) StoragePort, stdout/NDJSON EventPort, single-user IdentityPort, loopback AddressingPort, and toolkit-chrome TrustedControls. The Rust harness swaps in stdio-JSON-RPC implementations of all five.

## Deliverable (d): Minimal hygiene checklist

None of these items restrict artifact or agent behaviour. They only ensure that requests come from the holder of the artifact URL.

| # | Control | Why / source |
|---|---|---|
| 1 | Bind `127.0.0.1` (and `::1`) by default; never `0.0.0.0` unless `--lan` | MCP Streamable HTTP "SHOULD bind only to localhost";\[6\] Vite docs on wildcard hosts |
| 2 | **Host header allowlist**: `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, plus explicitly configured tunnel names; reject others with 403/421. Never offer an "allow all" switch without a loud warning | Vite CVE-2025-24010 fix (`server.allowedHosts`); Jupyter `local_hostnames`/`allow_remote_access` DNS-rebinding check\[8\]\[13\] |
| 3 | **Origin check** on every non-GET request and on every WebSocket upgrade and SSE connect: Origin must equal the artifact's own origin or the chrome origin; 403 otherwise; compare exact strings (no unanchored regex) | MCP spec MUST + 403; Jupyter CVE-2026-40110 (`re.match` bypass, fixed 2.18.0); Vite WebSocket Origin gap\[6\]\[7\]\[66\] |
| 4 | **Capability token** ≥128 bits from a CSPRNG in the launch URL (`/a/<id>#t=…` or `?t=`), exchanged once for a cookie and then stripped from the URL via redirect/`history.replaceState` | Jupyter token URLs; W3C TAG capability URLs ("unguessable… secure random number generator")\[26\]\[67\] |
| 5 | Session cookie: `HttpOnly; SameSite=Strict; Path=/a/<id>; Secure` when served over HTTPS, scoped per artifact origin (`content-<id>.localhost`) | SameSite blocks cross-site CSRF sends; per-origin scoping isolates artifacts |
| 6 | **CSRF token** (double-submit or header-bound) on state-changing requests, in addition to SameSite and Origin; require `Content-Type: application/json` to force preflight | Jupyter/Tornado XSRF model\[14\]\[68\] |
| 7 | **No wildcard CORS**; no `Access-Control-Allow-Origin: *`, no reflected origins; answer Private/Local-Network preflights only for configured origins | Vite set `server.cors` off by default; Jupyter `allow_origin`\[9\]\[13\] |
| 8 | `Referrer-Policy: no-referrer` on all responses; capability pages avoid third-party links/scripts by default (the agent may still add them; this is only a header) | W3C TAG capability URL guidance on Referer leakage\[26\] |
| 9 | **Per-artifact, per-scope tokens** (`view`, `submit`, `action:sendReply`), so a shared review link can view and comment without pressing Send | W3C TAG: multiple revocable URLs per resource\[67\] |
| 10 | Token expiry and rotation (`toolkit token rotate`), revocation list, 410 on revoked; rate-limit token-guessing paths | W3C TAG "should expire", "rate limited", 410/404\[26\] |
| 11 | Remote access via Tailscale Serve (identity headers, tailnet-only) by default; Funnel/public tunnels only behind an explicit flag plus short TTL tokens | Tailscale Serve/Funnel docs\[24\] |
| 12 | Never log full capability URLs; redact `t=` in logs and in events sent to hosts | Jupyter scrubs `token`, `xsrf`; CVE-2022-29241 token leak\[11\]\[69\] |
| 13 | GETs are side-effect free; actions are POST-only with Idempotency-Key | W3C TAG; IETF Idempotency-Key draft (expired, de facto)\[19\]\[21\]\[26\] |

## Caveats

- **Not re-verified in this pass:** exact current versions of React 19.x, TanStack Start, tRPC, chokidar, `@parcel/watcher`, xterm.js; VS Code webview docs; OpenAI Apps SDK `window.openai` status (secondary sources only); Liveblocks Comments/Marker.io/BugHerd/Figma/tldraw anchoring internals. Pin these before implementation.
- **Claude artifact storage figures** come from the Claude Help Center article "Persistent storage for artifacts", as quoted verbatim by homespun.dev and caipi.ai: "Persistent storage is only available for published artifacts. During development and testing, storage operations will not succeed until the artifact is published." The same article gives the 20 MB per-artifact limit and lists Pro, Max, Team and Enterprise plans on Claude web and desktop. Re-read the article directly before quoting it in toolkit docs.
- **CVE-2025-66414 (MCP TS SDK)** is confirmed on NVD (GHSA-w48q-cv73-mx4w; fixed in 1.24.0). **Vite CVE-2026-39364** (GHSA-v2wj-q39q-566r, Apr 6, 2026, High) is not a DNS-rebinding bug but a `server.fs.deny` bypass: denied files "can be retrieved with HTTP 200 responses when query parameters such as ?raw, ?import&raw, or ?import&url&inline are appended" (affects 7.1.0–7.3.1 and 8.0.0–8.0.4; patched in 7.3.2 / 8.0.5). It still matters for any toolkit that embeds Vite. A related **CVE-2026-6657** may duplicate CVE-2026-40110.\[70\]
- **MCP 2026-07-28 elicitation details** (MRTR, `requestState`) are summarised from secondary analyses of the changelog. MCP Apps interplay with the stateless core should be confirmed against the ext-apps repo before the embed protocol is frozen.
- `*.localhost` subdomain resolution to loopback is standard in Chromium and Firefox. Verify Safari behaviour on macOS before relying on per-artifact origins; fallback is distinct ports per artifact.
- The W3C TAG capability-URL document is a 2014 draft that predates `Referrer-Policy`; its referrer mechanisms (`CSP referrer`) are obsolete, but the principles hold.

## Sources

1. [mcp: support protocol revision 2026-07-28 (stateless core) · Issue #29248 · vlang/v](https://github.com/vlang/v/issues/29248)
2. [Elicitation - Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
3. [MCP Elicitation in 2026: What Changed in the Current Spec](https://www.devmoment.dev/journal/mcp-elicitation-field-log-2026)
4. [ext-apps/specification/2026-01-26/apps.mdx at main · modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
5. [GPT-6 Intelligent UI: Four Generative UI Routes and Their Risks](https://redreamality.com/blog/gpt-6-intelligent-ui-generative-ui-survey)
6. [Streamable HTTP - Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
7. [Any websites were able to send any requests to the development server and read the response · Advisory · vitejs/vite · GitHub](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
8. [Server Options](https://vite.dev/config/server-options)
9. [Vite 5, 6, 7, 8 dev server changes, incl. allowedHosts](https://localhost-5173.com/server-options-by-version/)
10. [Changelog — Jupyter Notebook 5.7.3 documentation](https://jupyter-notebook.readthedocs.io/en/5.7.3/changelog.html)
11. [Advisory Database](https://advisories.gitlab.com/pkg/pypi/jupyter-server/CVE-2022-29241/)
12. [CORS Origin Validation Bypass via \`re.match()\` in \`allow\_origin\_pat\` · Advisory · jupyter-server/jupyter\_server · GitHub](https://github.com/jupyter-server/jupyter_server/security/advisories/GHSA-24qx-w28j-9m6p)
13. [Config file and command line options — Jupyter Server documentation](https://jupyter-server.readthedocs.io/en/latest/other/full-config.html)
14. [Security release: Jupyter Notebook 4.3.1](https://blog.jupyter.org/security-release-jupyter-notebook-4-3-1-808e1f3bb5e2?gi=805557e2f038)
15. [Intent to Ship: Local network access restrictions](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY)
16. [Chrome's Local Network Access (LNA) Permission Explained](https://blog.openreplay.com/chrome-local-network-access-lna-permission/)
17. [Configure Chrome to Suppress the Local Network Access Prompt for Okta FastPass](https://support.okta.com/help/s/article/configure-chrome-to-suppress-the-local-network-access-prompt-for-okta-fastpass?language=en_US)
18. [Error message - Local network access permission denied](https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.html)
19. [Internet-Draft The Idempotency-Key HTTP Header Field October 2025](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html)
20. [History for draft-ietf-httpapi-idempotency-key-header -07](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/history/)
21. [Idempotency Keys Explained: Safe API Retries in 2026](https://www.alekseialeinikov.com/en/blog/topics/architecture/idempotency-in-practice-api-retries-2026)
22. [Advanced concepts of Streamlit - Streamlit Docs](https://docs.streamlit.io/get-started/fundamentals/advanced-concepts)
23. [Session & State Management](https://deepwiki.com/streamlit/streamlit/5-session-and-state-management)
24. [Tailscale Serve · Tailscale Docs](https://tailscale.com/docs/features/tailscale-serve)
25. [security: do not treat headerless Tailscale Serve requests as trusted localhost · Issue #149 · projectmushroom/gravedecay](https://github.com/projectmushroom/gravedecay/issues/149)
26. [Good Practices for Capability URLs](https://w3ctag.github.io/capability-urls/2014-07-23.html)
27. [GitHub - BlockSecCA/claude-artefact-storage · GitHub](https://github.com/BlockSecCA/claude-artefact-storage)
28. [Can Claude Artifacts Save Data? What Persists and What Silently Disappears · Caipi Field Notes](https://caipi.ai/blog/can-claude-artifacts-save-data)
29. [Streamlit Session State: How to Use st.session\_state](https://docs.kanaries.net/topics/Streamlit/streamlit-session-state)
30. [yjs - npm](https://www.npmjs.com/package/yjs?activeTab=versions)
31. [liveblocks/client](https://www.npmjs.com/package/@liveblocks/client)
32. [What's new in Liveblocks: February 2026](https://liveblocks.io/blog/whats-new-in-liveblocks-february-2026)
33. [Open sourcing the Liveblocks sync engine and dev server](https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server)
34. [liveblocks/server](https://www.npmjs.com/package/@liveblocks/server)
35. [Self Hosting](https://docs.convex.dev/self-hosting)
36. [Convex Self-Hosted: Tools, Pricing & How to Deploy](https://tekyous.dev/stacks/convex-self-hosted)
37. [Issues · cloudflare/partykit](https://github.com/cloudflare/partykit/issues)
38. [Whither Serverless Compute? or Why the Cloudflare-PartyKit Acquisition Matters](https://redmonk.com/kholterhoff/2024/04/26/whither-serverless-compute/)
39. [PartyKit is joining Cloudflare!](https://blog.partykit.io/posts/partykit-is-joining-cloudflare/)
40. [Electric 1.0 released](https://electric.ax/blog/2025/03/17/electricsql-1.0-released)
41. [ElectricSQL: Postgres sync engine install and HTTP API](https://hysenlabs.com/projects/electric-sql-electric)
42. [Electric](https://electric.ax/)
43. [Zero 1.0](https://zero.rocicorp.dev/docs/release-notes/1.0)
44. [Zero is Open Source Software](https://zero.rocicorp.dev/docs/open-source)
45. [Introduction to Zero - Zero](https://rocicorp-mono.mintlify.app/introduction)
46. [Internet-Draft The Idempotency-Key HTTP Header Field May 2022](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-01)
47. [Sync Vercel preview deployment comments to GitHub PR for AI agent feedback loops - Feedback - Vercel Community](https://community.vercel.com/t/sync-vercel-preview-deployment-comments-to-github-pr-for-ai-agent-feedback-loops/31663)
48. [Using Vercel comments to improve the Next.js 13 documentation - Vercel](https://vercel.com/blog/using-vercel-comments-to-improve-the-next-js-13-documentation)
49. [Vercel Toolbar](https://vercel.com/academy/vercel-foundations/toolbar)
50. [Preview deployments for retail campaign review](https://vercel.com/kb/guide/preview-deployments-retail-campaign-review)
51. [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
52. [Web Annotation Vocabulary](https://www.w3.org/TR/annotation-vocab/)
53. [Web Annotation Data Model](https://w3c.github.io/web-annotation/model/wd/)
54. [Ontology in RDF/XML](https://www.w3.org/ns/oa.rdf)
55. [Multiple Selectors · Issue #93 · w3c/web-annotation](https://github.com/w3c/web-annotation/issues/93)
56. [semiont/docs/protocol/W3C-SELECTORS.md at main · The-AI-Alliance/semiont](https://github.com/The-AI-Alliance/semiont/blob/main/docs/protocol/W3C-SELECTORS.md)
57. [Elicitation](https://www.mcp-framework.com/docs/tools/elicitation)
58. [MCP elicitation: how agents ask users for input mid-tool-call](https://nango.dev/blog/mcp-elicitation-explained)
59. [MCP Apps: Interactive UI, Architecture & Security Guide](https://mcpblog.org/mcp-apps/)
60. [Config file and command line options — Jupyter Notebook 5.7.4 documentation](https://jupyter-notebook.readthedocs.io/en/5.7.4/config.html)
61. [Authenticating Navidrome over Tailscale - Prose - Naman Sood](https://prose.nsood.in/navidrome-tailscale)
62. [Authentication - ngrok documentation](https://ngrok.com/docs/guides/share-localhost/auth)
63. [Google OAuth - ngrok documentation](https://ngrok.com/docs/integrations/oauth/google-oauth)
64. [Funnel vs. sharing devices · Tailscale Docs](https://tailscale.com/docs/reference/funnel-vs-sharing)
65. [Tailscale Funnel: the one-word difference that puts your app on the public internet - VPNSmith](https://www.vpnsmith.com/en/blog/tailscale-funnel-vs-serve-2026)
66. [OSV - Open Source Vulnerabilities](https://osv.dev/vulnerability/GHSA-24qx-w28j-9m6p)
67. [Good Practices for Capability URLs](https://w3ctag.github.io/capability-urls/)
68. [Support XSRF-protected Jupyter deployments without Bearer tokens · Issue #183 · datalayer/jupyter-mcp-server](https://github.com/datalayer/jupyter-mcp-server/issues/183)
69. [jupyter\_server package — Jupyter Server documentation](https://jupyter-server.readthedocs.io/en/latest/api/jupyter_server.html)
70. [CVE vendor ID 15653 for Jupyter](https://www.cvedetails.com/vulnerability-list/vendor_id-15653/Jupyter.html)
