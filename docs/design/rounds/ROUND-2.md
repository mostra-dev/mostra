# Round 2: caller-first interfaces

**Status:** Answered by Mirza in M7 (2026-10-10T10:59:01.070Z) and recorded as D51 to D64 in [DECISIONS.md](../DECISIONS.md), which wins where they differ. Kept as the record of what was presented. Code is illustrative. Names follow the [vocabulary](../PRODUCT.md#vocabulary).

The order follows the callers: what an agent writes, what a viewer sees, what a host integrates, what the CLI and MCP tools look like. Each open shape has at least two structurally different candidates and a recommendation, and is screened against shallow modules, information leakage, temporal decomposition and pass-through layers ([STANDARDS.md](../STANDARDS.md#design)).

Settled inputs from round 1: drafts per artifact and viewer (D39), shell and artifact submit channels (D40), publish gated by verify (D41), orphans kept and delivered (D42), one instance per home (D45), port-per-artifact origins (D38).

---

## 1. What an agent writes

### 1.1 The recommended author experience

J3's inbox, end to end. Three files, no `package.json`, no config file.

```text
inbox/
  index.tsx     entry page and manifest
  actions.ts    "use server" functions
  live.ts       live data sources
```

```tsx
// inbox/index.tsx
import { defineArtifact, useField, useAction, useLive } from "@mostra/react";
import { Button, Card, Skeleton, Textarea } from "@/components/ui"; // kit, copy-source shadcn
import { sendReply } from "./actions";

export const artifact = defineArtifact({
  title: "Morning inbox",
  family: "inbox",
});

export default function Inbox() {
  const { data, isLoading, error } = useLive("inbox"); // typed from live.ts
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <p>Couldn't load the inbox: {error.message}</p>;
  return data.messages.map((m) => <Message key={m.id} message={m} />);
}

function Message({ message }: { message: Mail }) {
  // Persisted per viewer, survives reloads and devices, carried to newer versions by ID.
  const [reply, setReply] = useField(`reply.${message.id}`, message.suggestedReply, {
    label: `Reply to ${message.from}`,
  });
  // Durable action run. The key makes "send this reply" happen at most once, across clicks,
  // tabs and reloads.
  const send = useAction(sendReply, { key: `send.${message.id}` });

  return (
    <Card>
      <h3>{message.subject}</h3>
      <Textarea value={reply} onChange={(e) => setReply(e.target.value)} />
      <Button onClick={() => send.run(message.id, reply)} disabled={send.isPending || send.status === "succeeded"}>
        {send.status === "succeeded" ? "Sent" : send.isPending ? (send.progress?.message ?? "Sending…") : "Send"}
      </Button>
      {send.error && <p role="alert">{send.error.message}</p>}
    </Card>
  );
}
```

```ts
// inbox/actions.ts
"use server";
import { dryRun, progress, secret, signal } from "@mostra/server";

export async function sendReply(messageId: string, body: string) {
  if (dryRun()) return { messageId, sent: false }; // verify's smoke test calls this path
  progress({ message: "Sending…" });
  const res = await fetch("https://mail.example/api/send", {
    method: "POST",
    headers: { authorization: `Bearer ${secret("MAIL_TOKEN")}` },
    body: JSON.stringify({ messageId, body }),
  });
  if (!res.ok) throw new Error(`Mail API returned ${res.status}`);
  signal("reply-sent", { messageId }); // a host may map this to anything, or ignore it
  return { messageId, sent: true };
}
```

```ts
// inbox/live.ts
import { defineLive } from "@mostra/server";

export const inbox = defineLive({
  refresh: "5m", // also: watch: "./data/*.json", or stream: async function* () {...}
  load: async () => ({ messages: await fetchInbox() }),
});
```

What the agent runs:

```sh
mostra secret set MAIL_TOKEN --artifact ./inbox < token.txt
mostra verify ./inbox          # JSON verdict; repeat until "pass"
mostra publish ./inbox         # artifact ID, version ID, capability URL
mostra wait ./inbox --until signal:reply-sent --timeout 30m
```

What a host or agent gets from `mostra results` once the viewer submits (Markdown rendering for agents; the JSON carries the same facts):

```md
# Morning inbox: submission sub_01JB… (version ver_9f3c…, view vw_…, channel shell, viewer mirza@…)
## Answers
- Reply to Alice (`reply.m1`): "Thanks, Thursday works."
- Reply to Bob (`reply.m2`): "Let's skip this week."
## Actions run in this view
- sendReply(m1): succeeded at 09:12 (run act_…)
## Not carried over from an earlier version
- (none)
```

The rules behind it:
- **Two kinds of server code, one way each.** `"use server"` modules hold functions the page calls (D19 seam 2). `live.ts` holds live data sources. React documents server functions as meant for mutations, not data fetching, so reading data is a separate concept rather than polling server functions.
- **Server context through imports** (`progress`, `secret`, `signal`, `dryRun`, `viewer`, `abortSignal` from `@mostra/server`), backed by AsyncLocalStorage (D19 seam 3). Function signatures stay plain, as React's contract requires.
- **Naming agents already know.** `useField` behaves like `useState`. `useLive` returns `{ data, isLoading, error, refresh }` like TanStack Query's `useQuery`. `useAction` returns `{ run, isPending, status, data, error, progress, cancel }` like `useMutation`.

### 1.2 Manifest form (AU1)

| | **A. Literal in the entry file (recommended)** | **B. `mostra.json` beside the entry** | **C. Typed `artifact.config.ts`** (seed) |
|---|---|---|---|
| Single-file start | `page.tsx` alone works; manifest optional | Needs a second file for any metadata | Needs a second file |
| MDX | Frontmatter (the MDX idiom) | Same JSON file | Same config file |
| Static readability | Mostra extracts the literal with Oxc without running code; non-literal values are a compile diagnostic | Plain JSON | Must be executed or restricted to literals anyway, since the supervisor never imports artifact code (RT-02) |
| Types | `defineArtifact()` gives autocomplete | `$schema` in editors | Full TS |
| Ways to do it | One per entry type | One | Two (config plus frontmatter) |

`defineArtifact` accepts `id?`, `title`, `description?`, `family?`, `links?: [{ rel, artifact }]`, `mode?: "spa"` (D19), `submission?` (requested policy; the host decides), `limits?`, `verify?` (viewports, extra checks). A directory artifact's entry is `index.tsx` or `index.mdx`.

**Artifact identity.** `mostra new` writes a generated `id` into the manifest, so a copied directory keeps meaning the same artifact and a moved one still resolves. An artifact without an `id` is bound to its canonical source path at first publish. Two paths claiming one `id` is a publish error.

### 1.3 Field identity (AU2)

- Persisted values need an explicit, stable string ID: `useField(id, initial, options?)`, and every kit input takes a required `id` prop. Dotted IDs (`reply.m1`, `q.layout`) render as nested objects in results.
- `verify` reports duplicate IDs mounted at once, IDs that change between renders of the same element, and form controls that aren't bound to any field (as a hint, never an error).
- Options: `label` (shown in results and the shell's "missing answers" list), `required`, `validate` (a Zod schema or function), `sensitive` (redacted from logs and events, still in the submission).
- Carry-over between versions is by ID (D09). IDs missing from a newer version become orphans (D42).

### 1.4 Client runtime API (CR1): two candidates

**Candidate A: field hooks (recommended).** One persisted value per hook.

```tsx
const [layout, setLayout, meta] = useField<"a" | "b" | "c">("layout", "a", { required: true, label: "Layout" });
// meta: { saveState: "saving" | "saved" | "offline" | "conflict", conflict?: { theirs, keepMine(), takeTheirs() } }
const submit = useSubmit();      // { submit(), allowed, blockers: [{ fieldId, label }], state }
const ping = useSignal("ping-agent"); // ping.send(payload?)
useSubmitControl({ label: "Submit & Send" }); // asks the shell to relabel its trusted Submit
```

**Candidate B: one typed draft document.** The artifact declares a schema; components read and write paths.

```tsx
const draft = useDraft(z.object({ layout: z.enum(["a", "b", "c"]), replies: z.record(z.string(), z.string()) }));
draft.data.layout;
draft.set(["replies", message.id], value);
```

| | A. Field hooks | B. Draft document |
|---|---|---|
| First-pass fluency | `useState` with an ID: the most-trained React idiom | A store pattern each artifact must design |
| Fits D22 rebase by field ID | Directly: the field is the unit of mutation and conflict | Through JSON paths; overlapping paths and array indices make conflicts subtler |
| Carry-over (D09, D42) | Per ID, nothing to migrate | The schema itself changes between versions; needs a migration rule |
| Typed submission shape | Assembled from dotted IDs and labels | Given by the schema |
| Interface size | 4 hooks | 1 hook, but a larger, schema-shaped surface |

A borrows B's best property: results nest dotted IDs into one object and carry labels, so the agent gets a readable shape without a schema. For large forms, `@mostra/react/form` adapts react-hook-form (D26), persisting each registered RHF field as a Mostra field; under the hood it's the same mechanism.

Behavior shared by both: optimistic local state, debounced saves (~400 ms) that flush on blur, `visibilitychange`, `pagehide` and before submit; an IndexedDB journal for offline edits; echoes from other tabs through the event stream (long-poll where SSE is unavailable, D47).

### 1.5 `window.storage` shim (CR2)

Claude artifacts taught agents `await window.storage.get/set/delete/list(key, shared?)`. Recommendation: the runtime installs a compatible `window.storage`.
- Personal keys are draft fields under `storage.<key>`: per viewer, carried over, delivered with the submission.
- `shared: true` keys live in an artifact-wide shared document (the same draft machinery with artifact scope). Shared values appear in results under `shared`.
- `verify` adds a hint pointing at `useField` for form inputs. Nothing is blocked.

The alternative, no shim, keeps one way to persist state but loses a habit agents already have.

### 1.6 Server functions and actions (SF1)

D19 fixes the outer shape (`"use server"` modules, request context from AsyncLocalStorage), so the remaining choices are inside it:
- **Plain calls vs action runs.** `await sendReply(...)` from client code is a plain RPC: not durable, no run record. `useAction(fn, { key? })` makes every invocation a durable `ActionRun` (D24) with progress, logs, cancellation, idempotency and re-attachment after reload. Default idempotency: one in-flight run per hook instance, so a double click joins the running invocation. An explicit `key` extends that across reloads, tabs and devices.
- **Serialization.** Arguments and results use exactly the type set React documents for Server Functions (primitives, plain objects, arrays, Map, Set, Date, BigInt, typed arrays, FormData, registered symbols, Promises), plus `AsyncIterable` results for streaming. One Mostra serializer implements that set in SPA mode, with conformance tests mirroring React's behavior, so switching to `rsc` later changes nothing for authors (D19). Anything else is a compile or runtime diagnostic naming the argument.
- **`"use server"` only.** No `*.server.ts` convention (seed recommendation).

### 1.7 Dry-run during `verify` (SF2)

`verify`'s smoke test clicks every enabled control (D29), and an action can send real email. Candidates:

| | **A. `dryRun()` in the body (recommended)** | **B. Separate handler export** | **C. Skip all actions** |
|---|---|---|---|
| Shape | `if (dryRun()) return …` at the top of the action | `export async function sendReply$dryRun(…)` | none |
| Detection | The compiler already transforms `"use server"` modules; it records which exports reference `dryRun` | By export name | none |
| Without opt-in | The action is **not** invoked; the click gets a synthetic "skipped in verify" result, and the verdict lists skipped actions | Same | Always skipped |
| Cost | One line, colocated with the real logic | A twin function per action | Smoke test never exercises action wiring |

### 1.8 Live data (LD1)

| | **A. Live sources (recommended)** | **B. Server functions plus client polling** |
|---|---|---|
| Producer | `live.ts` exports `defineLive({ load, refresh? \| watch? \| stream? })`, run by the artifact's worker, plus pushes from `mostra push`, the SDK and the host protocol | The page calls a server function on a timer |
| Shared across tabs and viewers | One producer per artifact, fanned out over the event stream | Every tab polls separately |
| Last value after reopen | Persisted with a revision; a view records which revisions it saw | Refetched |
| High rate | `useLive(key, { mode: "append", window: 3600 })`: a ring buffer feeding uPlot (AC-08) | Not practical |
| Fits React's guidance | Yes | Uses server functions for fetching, which React advises against |

Types for `useLive("inbox")` come from a generated declaration file that augments `@mostra/react` with `typeof import("./live")`, so client code never imports server code.

### 1.9 Multi-page routing (AU3)

| | **A. `pages/` convention on React Router (recommended)** | **B. Built-in mini router** |
|---|---|---|
| Authoring | `pages/index.tsx`, `pages/settings.tsx`; navigate with React Router's `<Link to>` and `useNavigate` | Mostra-specific `<Link page>` and `usePage()` |
| Fluency | React Router is among the most-trained React libraries | New API to learn |
| Delivery targets | Mostra picks the history mode: browser history locally, hash for static export, memory inside MCP Apps | Same, but built by Mostra |
| Review | The runtime reports the current page to the shell, so comments record their page | Same |

---

## 2. What a host integrates

### 2.1 Where interaction state lives (HP1): two candidates

**Candidate L: Mostra-owned ledger, host as authority sink (recommended).** Mostra always keeps the canonical drafts, submissions, reviews, action runs and events in its own transactional store, inside the home the host configures (H-11). Hosts implement small idempotent callbacks and pull events by cursor.

```rust
// Jcode (C03-B) through the Rust crate
let mostra = Mostra::spawn(SpawnConfig {
    home: jcode_data.join("mostra"),
    runtime: RuntimeBundle::cached(&bundle_dir)?,
    ports: Ports::new()
        .submissions(JcodeSubmissions::new(session_work.clone())) // deliver() -> Accepted | Rejected
        .drafts(JcodeDraftMirror::new(session_work.clone()))      // optional opaque mirror per revision
        .identity(JcodeIdentity)                                  // maps tunnel identity to a viewer
        .trusted_controls(TrustedControls::ShellOnlySubmit),
}).await?;

let receipt = mostra.publish(Publish::dir(&src).policy(SubmissionPolicy::once_per_artifact())).await?;
// receipt.artifact_id, receipt.version_id, receipt.url: durable before the call returns (H-07)

let mut events = mostra.events(EventFilter::types(["submission.created"]), cursor).await?;
```

```ts
// any JavaScript host through the TypeScript SDK
const mostra = await createMostra({
  home: "/var/lib/myapp/mostra",
  ports: {
    submissions: { deliver: async (s) => (await db.saveAnswer(s.submissionId, s)) ? { accepted: true } : { accepted: false, reason: "duplicate" } },
  },
});
```

**Candidate S: host-supplied store.** A host may replace Mostra's store with its own implementation of the draft, submission, review and event ports, each with compare-and-set, idempotent mutation IDs, unique-per-epoch submissions and ordered events. The conformance kit proves an implementation. This is the reading of the seed's §12 table ("Drafts: revisioned draft storage with compare-and-set").

| | L. Mostra-owned ledger | S. Host-supplied store |
|---|---|---|
| Where the submit transaction lives | One place (Mostra), tested once | Reimplemented by every host; every host can get it subtly wrong |
| Outbox (IN-12: durable before any delivery) | Natural: Mostra commits, then delivers, and retries idempotently | Requires a local store anyway when the host store is down, which is L underneath |
| Host effort | 1 to 4 small idempotent callbacks | A transactional store with five invariants |
| Jcode's C02 contract | Jcode stores the opaque submission payload and an optional draft mirror; Mostra's submission ID is Jcode's client request ID (H-03) | Jcode stores drafts and submissions as the authority |
| "Accepted by Mostra" vs "accepted by host" (§7) | Two explicit facts, both reported | Collapse into one |
| Host-specific code in core (HO-06) | None | None |

The ports under L, all optional, each with a standalone default (the standalone CLI is just the built-in adapter set, D25):

| Port | Direction | Purpose | Standalone default |
|---|---|---|---|
| `identity` | Mostra asks | Map a request's trusted headers to a viewer | Single local user; Tailscale header mapping |
| `submissions` | Mostra delivers | `deliver(submission) → accepted \| rejected(reason)`; idempotent by submission ID; outbox on failure | Accept |
| `drafts` | Mostra delivers | Optional mirror of each draft revision (opaque) | None |
| `reviews` | Mostra delivers | Optional mirror of threads and choices | None |
| `events` | Host pulls | Subscribe with filter and durable cursor; acknowledge by cursor | CLI `wait` and `results` read it |
| `addressing` | Mostra asks | External URLs, tunnel hostnames, capability minting and revocation | Loopback ports (D38) |
| `trustedControls` | Both | Which trusted controls appear; activation; allowed submit channels | Mostra's shell, both channels (D40) |
| `capture` | Mostra asks | Screenshots and accessibility snapshots on request | Built-in Playwright |
| `secrets` | Mostra asks | Resolve a named secret | Home store, mode 0600 (D44) |
| `pty` | Mostra asks | Spawn a PTY for live terminals | Built-in node-pty process |

L changes the meaning of the drafts, submissions and reviews rows in ARCHITECTURE §12 and D25's port list, from "storage" to "delivery and mirror". That needs your approval.

### 2.2 One protocol for every client (HP3)

The CLI, the MCP server, the TypeScript SDK and the Rust crate all speak the same versioned JSON-RPC 2.0 host protocol to the supervisor: over stdio when a host spawns Mostra, over the home's Unix socket when attaching to a daemon (D45). The CLI is a thin client of the protocol, so it adds no second code path. Port callbacks travel on the same connection in the other direction, and only the connection that registered a port receives its callbacks.

```text
host → Mostra    mostra/initialize { revisions, capabilities, ports }
                 artifact/publish  artifact/verify  artifact/open  results/get
                 wait  events/subscribe  events/ack  live/push  share/start  share/stop
Mostra → host    port/submissions.deliver  port/drafts.mirror  port/identity.resolve
                 port/secrets.get  port/pty.spawn  events/notify (after subscribe)
```

### 2.3 Schema source and versioning (HP2)

| | **A. Zod 4 as the source (recommended)** | B. TypeSpec | C. Hand-written JSON Schema |
|---|---|---|---|
| TypeScript validation at the boundary | Free (the schema validates) | Needs a second generated layer | Needs a validator plus types |
| JSON Schema output | `z.toJSONSchema` emits 2020-12 and draft-07 (checked with Zod 4.6.5) | Yes | Is the source |
| Rust | typify on the draft-07 output for wire types, committed with a snapshot test; the client is hand-written (brief 6) | Same | Same |
| New language for contributors | No | Yes | No |

Protocol versioning: dated revisions (`2026-11-01` style), negotiated in `mostra/initialize`, additive within a revision, at least 12 months of deprecation (STANDARDS, D32).

---

## 3. The CLI and MCP surfaces

### 3.1 CLI command set (CL1)

Every command takes `--json` (NDJSON for streams), never prompts outside a TTY, logs to stderr, and has documented exit codes (D29).

| Command | Purpose |
|---|---|
| `mostra new <dir> [--template <family>]` | Scaffold from a template, with AGENTS.md |
| `mostra dev <path>` | Developer hot reload, clearly separate from viewing (VR-08) |
| `mostra verify <path>` | The full pipeline; one JSON verdict |
| `mostra publish <path> [--force]` | Verify-gated publish (D41); prints IDs and the capability URL |
| `mostra open <artifact>` | Mint and print or open a capability URL |
| `mostra share <artifact> --tailnet \| --public [--via funnel\|cloudflare] [--ttl <d>]` · `mostra share --stop` | Remote viewing ladder |
| `mostra wait <artifact> --until submitted\|signal:<name> [--timeout <d>]` | Block; `still_waiting` on timeout |
| `mostra results <artifact> [--submission <id>] [--format md\|json]` | Complete results |
| `mostra review export <artifact> --format md\|json` | Comments with crop paths |
| `mostra push <artifact> <key> --json <file> \| --stdin` | Live data push |
| `mostra term dump <source> --format text\|cells\|ansi [--at <t>]` | Terminal output for blind checks |
| `mostra add <pkg>` | Explicit dependency (D43) |
| `mostra export <artifact> --as static\|html\|bundle\|snapshot\|mcp-app` | Export classes |
| `mostra secret set\|list\|rm` | Named secrets (D44) |
| `mostra list` · `mostra status` | Artifacts, versions, views, pending deliveries |
| `mostra daemon start\|stop\|status\|install` | The home's daemon; `install` registers a login service |
| `mostra host` | Stdio host mode for spawning hosts |
| `mostra mcp` | Local MCP server |
| `mostra plugin search\|add\|validate\|list\|remove` | Plugins (search uses the v1.x registry) |
| `mostra docs [topic]` · `mostra doctor` · `mostra gc` | Docs, environment check, collection |

Artifacts are addressed by source path or ID everywhere.

### 3.2 MCP tools (MC1)

Twelve tools, stateless, explicit handles, short names under a common prefix so hosts that don't namespace tools avoid collisions:

`artifact_create`, `artifact_write`, `artifact_patch`, `artifact_verify`, `artifact_publish`, `artifact_open` (the render tool; returns the MCP App plus the URL fallback), `artifact_wait`, `artifact_results`, `artifact_list`, `live_push`, `docs_search`, plus app-only (`visibility: ["app"]`) tools that exported MCP Apps use for drafts, submissions, actions and events. Docs and reports are resources. Descriptions are drafted with you in round 4.

### 3.3 How exported MCP Apps reach durable storage (MC2)

In v1 the artifact renders inline from Mostra's **local** MCP server (Claude Desktop, VS Code, Codex and other local MCP clients). The `ui://` resource's client runtime swaps its transport for the MCP Apps bridge, and drafts, submissions, action runs and the event cursor travel as app-only tool calls to the same server, which talks to the instance. Cloud chat hosts (claude.ai, ChatGPT) need a publicly reachable server, which is remote mode (v1.x). In a context with no reachable server, the exported page says that answers can't be saved and shows the full-page URL (MC-03).

---

## 4. Process details (PM2)

- **Home layout.** `registry/` (artifacts, ports, leases), `versions/` (immutable, content-addressed), `store/` (SQLite: drafts, submissions, events, runs, outbox), `deps/` (shared package store), `secrets/` (0600), `cache/` (LRU, D47). The control socket lives in the per-user runtime directory (VERIFIED_FACTS, process model).
- **Daemon lifetime.** A standalone daemon keeps running while it has open views, active shares, pending deliveries or attached clients, and otherwise exits after 30 idle minutes. Viewers need the daemon running, so `mostra daemon install` registers a launchd or systemd user service for people who want capability URLs to work at any time. A host-spawned instance lives exactly as long as its stdio connection.
- **Workers.** Started on first need. Evicted after 10 idle minutes with no open views, live sources or running actions. Restarted on demand after a crash, with exponential backoff and a crash report to the viewer and the event log.
- **Default limits** (stability, not security, D05): 1 GiB heap per worker, a 10 s event-loop watchdog, all configurable per artifact.
- **Ports.** The gateway port and each artifact's port are leased per home and reused across restarts. A leased port taken by another program at start-up produces a diagnostic and a re-lease; `mostra open` reissues URLs.
