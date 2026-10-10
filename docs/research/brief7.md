# Remote Mode for an Agent-Artifact Toolkit: Remote MCP Clients, Sandboxes, Hosting and Business Model (October 2026)

**Bottom line:** Build remote mode as a stateless Streamable-HTTP MCP server that supports both the 2025-11-25 and 2026-07-28 protocol versions, offers CIMD with a DCR fallback, and exposes a small set of revisioned file tools (write/patch/chunked-upload) plus a server-side build-and-verify tool. Artifacts should be served from per-artifact subdomains of a separate, PSL-registered user-content domain. Agent-authored server code should run behind one `SandboxPort`. For the hosted service, use Fly Machines to serve artifact backends and E2B (Apache-2.0, self-hostable) for builds and headless verification. License the whole toolkit Apache-2.0 and keep only the multi-tenant cloud control plane proprietary.

## TL;DR

- **Clients (verified):** ChatGPT, Claude and Gemini all accept remote MCP servers by URL, but gating differs sharply. Claude allows custom connectors on every plan, Free included (Free gets one), and they work on mobile. ChatGPT restricts full read/write MCP to Business/Enterprise/Edu, gives Pro only read/fetch, keeps developer-mode apps web-only, and lets admins freeze tool snapshots. Gemini allows custom apps only on personal accounts; they are added on the web and also work on mobile. All three connect from the vendor's cloud, so your server must be publicly reachable.
- **Design consequence:** limits are tight and they differ. Anthropic's "Build an MCP server for Claude" docs set a 240-second tool-call timeout and a maximum tool result of ~150,000 characters for claude.ai and Desktop. ChatGPT tool calls hit a 1-minute ceiling ("Currently the hard limit on any tool call is 1 minute," per an OpenAI Developer Community thread), which OpenAI's own documentation does not state. So remote authoring needs incremental, revision-checked file writes, chunked uploads, and async build/verify jobs that return handles, compressed screenshots and console errors. Never send one giant bundle in one call.
- **Business/license:** use Apache-2.0 for the SDK, runtime, CLI, MCP server and self-host server, and run a proprietary hosted control plane (multi-tenancy, abuse handling, billing, scale-to-zero orchestration). Consider FSL-1.1-ALv2 only if a well-funded clone of the hosted service actually appears. Plan the free tier around abuse from day one, because Glitch's shutdown and the recent free-tier tightening at Val Town and Hugging Face show where unrestricted free hosting ends up.\[1\]\[2\]\[3\]

## Key Findings

### Verified facts (primary sources, checked October 2026)

**MCP protocol state**
- The MCP spec **2026-07-28** shipped on July 28, 2026.\[4\] It does the following:
  - Removes the `initialize` handshake and the `Mcp-Session-Id` header. Each request carries its protocol version, client info and capabilities in `_meta`, and an optional `server/discover` call is available.\[4\]
  - Requires `Mcp-Method` and `Mcp-Name` HTTP headers on Streamable HTTP.\[4\]\[5\]
  - Replaces server-initiated elicitation and sampling with Multi Round-Trip Requests (`resultType: "input_required"`).\[4\]
  - Adds `ttlMs`/`cacheScope` cache hints to list results.\[4\]
  - Formalizes extensions: Tasks (`io.modelcontextprotocol/tasks`), MCP Apps, and Enterprise Managed Authorization.\[4\]
- On authorization, the same release requires clients to validate the RFC 9207 `iss` parameter, binds client credentials to their issuer, and formally deprecates Dynamic Client Registration in favor of Client ID Metadata Documents (CIMD). DCR "continues to work for backward compatibility."\[4\]
- Roots, Sampling, Logging and the legacy HTTP+SSE transport are deprecated, with at least a 12-month runway.\[4\]\[5\]
- The TypeScript, Python, Go and C# SDKs support 2026-07-28. The Rust SDK supports it in beta,\[4\] which matters for the Rust host harness.
- The maintainers advise that servers needing state should "mint an explicit handle from a tool and have the model pass it back as an argument."\[4\] That is the pattern this design uses for artifact IDs and revisions.
- **MCP Apps (SEP-1865, stable spec dated 2026-01-26):**
  - UI resources use the `ui://` scheme and the MIME type `text/html;profile=mcp-app`.\[6\]\[7\]
  - Tools link to a resource through `_meta.ui.resourceUri`. The flat `_meta["ui/resourceUri"]` form is deprecated.\[7\]
  - The capability key is `io.modelcontextprotocol/ui`.\[8\]\[9\]
  - Rendering happens in sandboxed iframes that talk to the host over JSON-RPC via postMessage. Allowed external origins are declared through CSP metadata, and empty means no external resources.\[6\]\[10\]
  - The reference implementation is the `@modelcontextprotocol/ext-apps` npm package.\[11\]

**ChatGPT (OpenAI Help Center, "Developer mode and MCP apps in ChatGPT", updated October 2026; OpenAI developer docs)**
- **Who gets what:**
  - Full MCP, including write/modify actions, is "rolling out in beta to ChatGPT Business, Enterprise, and Edu plans."\[12\]
  - "Pro users can build apps using the Apps SDK… Pro users can connect MCPs with read/fetch permissions in developer mode."\[12\]
  - On Business, only admins/owners can use developer mode. On Enterprise/Edu, admins can grant it to specific users through RBAC.\[12\]
- **Web only:** "Are MCP apps available on mobile? No – web only."\[12\]
- **Frozen tool snapshots:** after approval, ChatGPT "uses a 'frozen' snapshot of its available tools and inputs." Changes that break backward compatibility cause tool calls to error until an admin refreshes them.\[12\] **This directly constrains how we evolve the tool schema.**
- **Local servers:** ChatGPT connects only to remote MCP servers. Local or private servers go through OpenAI's Secure MCP Tunnel.\[12\]
- **Search/fetch tools** are "no longer required."\[12\]
- **OAuth:** advertise `offline_access` and issue refresh tokens, otherwise "ChatGPT may lose access after the original authorization expires."\[12\]
- **Agent mode and deep research:** agent mode will not use custom apps. Deep research uses them read-only.\[12\]
- **UI rendering:** OpenAI's Apps SDK docs say "ChatGPT implements the open MCP Apps standard." `window.openai` remains as a compatibility layer, and `_meta["openai/outputTemplate"]` is an alias for `_meta.ui.resourceUri`. The docs list the ChatGPT web, desktop and mobile apps plus Codex as surfaces.\[13\]\[14\]
- **Conflicts I could not resolve:**
  - The Help Center says MCP apps are "web only," while the Apps SDK docs list mobile and the developer forum reports mobile widget rendering (including a regression around July 10, 2026, when a widget tool is chained after another tool in the same turn).\[12\]\[14\]\[15\] My best reading is that published or directory apps render on mobile, but developer-mode setup and testing is web-only.
  - Several third-party guides say Plus also gets developer mode,\[16\]\[17\] which contradicts the Help Center's Pro/Business/Enterprise/Edu framing. Treat Plus support as unconfirmed.
- **Timeout:** the 60-second tool-call timeout comes only from OpenAI community-forum posts ("Currently the hard limit on any tool call is 1 minute"; another thread reports "timeouts after exactly one minute"). It is not in OpenAI's documentation.

**Claude (Claude Help Center and claude.com connector docs, October 2026)**
- **Plans:** "Custom connectors using remote MCP are available on Claude, Cowork, and Claude Desktop for users on Free, Pro, Max, Team, and Enterprise plans. Free users are limited to one custom connector."\[18\]
  - On Team, only Owners/Primary Owners add connectors.\[18\]
  - On Enterprise, Owners or custom roles with "Manage access to Libraries" add them.\[18\]
- **Network:** connections originate "from Anthropic's cloud infrastructure… across every Claude client, including claude.ai, Claude Desktop, Cowork, and the mobile apps." Servers must be reachable from Anthropic's IP ranges.\[18\]
- **Auth options in the UI:**
  - Authentication: "Sign in now," "Sign in when needed," or "No sign in."\[18\]
  - OAuth client: "Use Claude's published identity (Recommended)," "Register automatically," or "Use your own OAuth client."\[18\]
  - Static request headers can carry API keys.\[18\]
- **Supported specs and transports:**
  - Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 authorization specs (2026-07-28 is not listed).\[19\]
  - Streamable HTTP is recommended. Legacy HTTP+SSE is still supported but "being deprecated."\[19\]
  - The OAuth callback is `https://claude.ai/api/mcp/auth_callback`. \[19\]
  - Resource subscriptions, sampling and "advanced or draft capabilities" are not supported.\[19\]
- **Limits:**
  - claude.ai/Desktop ("Build an MCP server for Claude"): maximum tool result size ~150,000 characters; tool call timeout 240 seconds per tool call.
  - Claude Code: 25,000 tokens by default (configurable with `MAX_MCP_OUTPUT_TOKENS`); responses from HTTP/SSE servers are cut off at 16 MB per JSON body or event.\[19\]\[20\]
- **Interactive connectors (MCP Apps)** render as "inline cards" or a "fullscreen view." Team/Enterprise owners can disable specific UI-rendering tool calls.\[18\]
- **Tool names:** MintMCP's "MCP fixes and known issues in Claude" reports that since 2026-07-28 tool names over 64 characters cause Claude to reject the server connection, breaking the whole Claude session. Keep names short regardless.

**Gemini (Google Gemini Apps Help, October 2026)**
- **Consumer app:** custom MCP "apps" need a personal Google Account (work/school accounts are excluded) and Keep Activity turned on. They are English-only, added only on the web, and then usable "in both the Gemini mobile app and Gemini web app." The server "must follow the standard MCP specifications."\[21\]
- **Unconfirmed:** third-party guides add a US-only restriction and tie the feature to "Gemini Spark."\[22\] I did not confirm this on Google's page.
- **Gemini Enterprise:** uses a "Custom MCP Server" data store configured by admins. It requires a public HTTPS endpoint and supports Streamable HTTP only, per Google codelabs and partner guides.\[23\]\[24\]

**Sandbox platforms (vendor pricing and docs pages; some secondary, flagged in the table)**
- **Cloudflare Containers/Sandboxes** reached GA on April 13, 2026.\[25\]
  - Pricing: active CPU at $0.000020/vCPU-s, memory at $0.0000025/GiB-s, disk at $0.00000007/GB-s, NA/EU egress at $0.025/GB with 1 TB included. The Workers Paid plan ($5/month) is required.\[26\]\[27\]
  - Capacity: Cloudflare says standard-plan users can run 15,000 concurrent "lite" instances.\[28\]
- **Vercel Sandbox:**
  - Pricing: Firecracker microVMs at $0.128 per active CPU-hour, $0.0212/GB-hour of provisioned memory, $0.60 per million creations, and $0.15/GB data transfer. The Hobby allotment is 5 CPU-hours, 420 GB-hours and 5,000 creations. Pro usage counts against a $20/month credit.\[29\]\[30\]\[31\]\[32\]
  - Regions and storage: the official docs now say 19 regions, which supersedes older "iad1-only" reports. Each sandbox gets 64 GB of NVMe with SDK ≥3.0.0. The session limit resets on stop/resume.\[29\]\[31\]
- **E2B:**
  - Licensing and self-hosting: Firecracker, with the stack on GitHub under Apache-2.0. A new `e2b-dev/runtime` repo includes "E2B Embed," which runs the full stack on one KVM Linux host. BYOC on AWS/GCP/Azure is an Enterprise feature.\[33\]\[34\]\[35\]
  - Pricing: $0.000014/vCPU-s ($0.0504/hr) and $0.0000045/GiB-s, billed only while running.\[36\] Paused sandboxes are not billed and are kept indefinitely.\[37\]\[38\]
  - Plans: Hobby is free (1 h sessions, 20 concurrent). Pro is $150/month plus usage (24 h sessions, 100 concurrent). Enterprise requires a $3,000/month minimum, per e2b.dev/pricing.
- **Fly.io Machines:**
  - Firecracker, billed per second while running. shared-cpu-1x/256 MB is $0.0030/hr ($2.19/month). Extra RAM is $6/GB-month.\[39\]
  - Stopped Machines pay only $0.15/GB-month for the rootfs. Volumes are also $0.15/GB-month.\[39\]
  - Fly's "Machine Suspend and Resume" docs cite "a few hundred ms" to resume from suspend versus "~2+ seconds for common apps" on a cold start; an older Fly guide (2022) claims about 300 ms boots.
  - **Fly Sprites** (January 2026) are persistent Firecracker VMs with checkpoint/restore and egress policies.\[40\]\[41\] Sprite CPU pricing conflicts between sources ($0.0385 vs $0.07 per CPU-hour),\[42\]\[43\] so check before relying on it.
- **Modal Sandboxes:**
  - Isolation and pricing: gVisor ("containerized and virtualized using gVisor"), at $0.1419 per physical core-hour, where one core is 2 vCPU. That is about 3× Modal's Functions rate.\[36\]\[43\]\[44\]\[45\]\[46\]
  - Timeouts: default 5 minutes, maximum 24 hours.\[47\]
  - Networking: the best egress controls in this group, with `block_network`, `outbound_domain_allowlist` (wildcards supported), `outbound_cidr_allowlist`, and `updateNetworkPolicy` on running sandboxes (JS SDK 0.8.2, June 29, 2026).\[48\]\[49\]\[50\]
- **Daytona:** moved core development to a private codebase in June 2026. The public repo was archived on October 3, 2026 at the last open release, v0.190.0 (AGPL-3.0, June 23, 2026). SDKs remain Apache-2.0 and the CLI AGPL-3.0. A community fork, Nightona, continues the AGPL code.\[51\]\[52\]\[53\]\[54\]
- **Deno:** Deploy Classic and the Subhosting v1 API shut down on July 20, 2026. Subhosting now sits on the Builder plan ($200/month), with V8 isolates and JS/TS/Wasm only.\[55\]\[56\]\[57\]
- **Northflank** (vendor blog only): Kata Containers/Cloud Hypervisor plus Firecracker/gVisor. Managed pricing is $0.01667/vCPU-hr and $0.00833/GB-hr.\[58\] Self-serve BYOC is available across major clouds and on-prem.\[59\]\[60\]
- **CodeSandbox SDK** (now part of Together AI): VM credits at $0.01486 each, billed per minute.\[61\]\[62\] Isolation details and self-hosting are confirmed only by third parties.

**Hosting and abuse prior art**
- **Glitch:** ended project hosting on July 8, 2025. BleepingComputer's report on CEO Anil Dash's announcement cited "the rising cost of hosting millions of apps, and dealing with increasing cases of misuse from bad actors," and Glitch said its legacy architecture no longer offered unique value. Dashboards and code downloads stayed up through the end of 2025, and Glitch added subdomain redirects so URLs kept working.
- **Public Suffix List (PRIVATE section):**
  - Who can request: only the domain owner, and only for domains that "issue subdomains to mutually-untrusting parties."\[63\]\[64\]
  - Requirements: more than 2 years left on the registration and a `_psl` TXT record.\[63\]\[65\]
  - Not allowed: requests to bypass rate limits.\[64\]
  - Effects: CAs may legitimately issue wildcards such as `*.appspot.com` for PRIVATE entries. Chrome ignores PRIVATE entries for Safe Browsing exceptions, which "may change in the future."\[66\]\[67\]
- **Free-tier tightening (2026):**
  - **Val Town** raised Pro to $25/month ($250/year) in May 2026 and limited new free vals to public. Its June 2026 investor update (Steve Krouse, July 15, 2026) reported "ARR dropped 1%" despite 16% Pro subscription growth and five lost Business customers, and said "the jump from our $25 Pro plan to our $200 Business plan is too steep."
  - **Hugging Face** now requires a paid plan (PRO is $9/month) to create Gradio or Docker Spaces. Static Spaces stay free, and free personal accounts can still host up to 2 Gradio Spaces on ZeroGPU.\[2\]\[68\]

**Licensing**
- **FSL-1.1** (Sentry; SPDX `FSL-1.1-ALv2` / `FSL-1.1-MIT`):\[69\]\[70\]
  - Allows any use except "Competing Use."\[70\]
  - Each release irrevocably becomes Apache-2.0 or MIT two years after it is published.\[69\]\[71\]
  - It is not OSI-approved.\[69\]\[72\]
  - Liquibase Community moved to FSL-1.1-ALv2 starting with version 5.0.\[73\]

### Background knowledge not re-verified in this session (treat as context)
- **Next.js** is MIT and monetized through Vercel hosting.
- **Supabase** is mostly Apache-2.0, with a hosted platform plus self-host Docker.
- **Streamlit** is Apache-2.0. Snowflake acquired it in 2022, and Community Cloud is a free funnel.
- **Gradio** is Apache-2.0 and monetized through HF Spaces hardware and plans.
- **PartyKit** is MIT and was acquired by Cloudflare in 2024.
- **HashiCorp** moved to BSL 1.1 in 2023, and OpenTofu forked in response.
- **ELv2** forbids offering the software as a managed service.
- **AGPL-3.0** network copyleft deters many enterprise legal teams.

## Details

### 1. How remote agents connect today

| Client | Who can add a custom remote MCP server | Admin gating | Mobile | Auth paths | Transport | UI (MCP Apps) | Documented limits |
|---|---|---|---|---|---|---|---|
| ChatGPT | Business/Enterprise/Edu: full read/write (beta); Pro: read/fetch + Apps SDK testing; Plus: unconfirmed | Business: admins/owners only; Ent/Edu: RBAC; admin publishes; frozen tool snapshots | Dev-mode apps "web only" (Help Center); Apps SDK docs list mobile rendering | OAuth (needs refresh tokens via `offline_access`), none; DCR expected by many servers | Streamable HTTP (remote only; Secure MCP Tunnel for private) | Yes: MCP Apps standard + `window.openai` extensions | ~60 s tool timeout (community-reported only) |
| Claude (claude.ai, Desktop, Cowork, mobile) | Free (1), Pro, Max, Team, Enterprise | Team/Ent: Owners add, members connect individually; owners can disable UI tools | Yes, same cloud-brokered connector | "Claude's published identity" (likely CIMD), DCR ("Register automatically"), own client, static headers, none | Streamable HTTP; legacy SSE still accepted | Yes: inline cards and fullscreen | 240 s/tool call; ~150,000-char result |
| Gemini app (consumer) | Personal accounts only; English; Keep Activity on | n/a | Yes once added on web | OAuth with automatic client registration (per guides) | Standard MCP | Unverified | Not published |
| Gemini Enterprise | Admin-configured "Custom MCP" data store | Admin | Via Enterprise app | OAuth/none | Streamable HTTP only | Unverified | Not published |

**What this means (judgment):**
- **Mobile authoring.** Claude is the most dependable client for the brief's "remote from a phone" case. Gemini also works once the app has been added from a desktop browser. ChatGPT is the most restrictive for individual developers, and its frozen-snapshot workflow penalizes tool-schema churn. Version the tool surface conservatively and add only optional parameters.
- **Reachability.** Every vendor connects from its own cloud, so "local-first plus remote agent" needs a public endpoint. The options are the user's own tunnel (Cloudflare Tunnel/Tailscale Funnel), OpenAI's Secure MCP Tunnel, or the hosted service acting as a relay. A server on a VPN-only address will not work with Claude.\[12\]\[18\]
- **Protocol versions.** Claude documents only the 2025-era authorization specs. Serve both 2025-11-25 (initialize and sessions accepted) and 2026-07-28 (stateless) from one endpoint, and keep every tool independent of sessions anyway, using explicit `artifact_id` and `rev` handles.
- **Authentication.** Implement CIMD as the primary path, keep DCR (Claude's "Register automatically," and many ChatGPT-oriented servers report needing it), always issue refresh tokens, validate `iss`, and allow-list `https://claude.ai/api/mcp/auth_callback` plus ChatGPT's redirect URIs.

### 2. Remote authoring: MCP tool surface sketch

**Design principles (judgment, driven by the limits above):**
1. **Revisioned, content-addressed workspace.** Each artifact is a tree of files at a monotonically increasing `rev`. Every mutating call takes a `base_rev` and fails on conflict, which gives optimistic concurrency between a phone session and a desktop agent.
2. **Three write modes, chosen by size.**
   - **Push:** whole files. This is the default for new files under about 32 KB.
   - **Patch:** unified diff or search/replace blocks. This is the default for edits. It keeps arguments small and mirrors how coding agents already edit.
   - **Chunked bundle:** `upload_begin`, then `upload_part` (≤64 KB base64 each, with sha256), then `upload_commit`. This is for assets and large generated data.
   - I found no published tool-*argument* size limits for any client. Treat about 100 KB per call as a safe ceiling, and confirm it empirically per client.
3. **Builds are jobs.** `build` returns synchronously only if the work finishes in about 40 s, which stays inside ChatGPT's reported 60 s with a margin. Otherwise it returns a `job_id`. Advertise the Tasks extension for clients that support it, and fall back to a model-pollable `job_status` tool.
4. **Verification output is designed for a model.** Return structured diagnostics first (TypeScript errors with file:line, bundler errors, runtime console errors, failed requests, uncaught exceptions, axe accessibility violations), then one or two downscaled screenshots (WebP or JPEG, roughly ≤1280 px wide, a few hundred KB) as image content. This keeps results well under Claude's 150,000-character cap.
5. **Show inside the chat via MCP Apps; fall back to a link.**
   - A `show` render tool returns a small `ui://` shell (`text/html;profile=mcp-app`) that embeds the hosted artifact preview, with the artifact origin declared in the CSP/domain metadata.
   - Only render tools carry UI metadata, following OpenAI's guidance to keep data tools and render tools separate.\[14\]\[74\] This also avoids the ChatGPT mobile chained-widget regression.
   - Every tool also returns a plain HTTPS URL, so clients without UI support still work.

| Tool | Purpose | Key args → returns |
|---|---|---|
| `docs_search` / `templates_list` | Ground the agent in toolkit APIs and starter templates (dashboard, deck, form, review, live-data, action page, TUI) | query → snippets; template ids |
| `artifact_create` | New artifact from a template or empty | title, template, files? → `artifact_id`, `rev`, preview URL |
| `artifact_list_files` / `artifact_read` | Inspect state (paged; byte ranges for big files) | artifact_id, rev?, glob/paths → contents + hashes |
| `artifact_write_files` | Atomic multi-file push/delete | artifact_id, base_rev, files[{path, content\|base64, sha256}], deletes[] → new rev |
| `artifact_apply_patch` | Edits via unified diff / search-replace | artifact_id, base_rev, patch → new rev or rejected hunks |
| `artifact_upload_begin/part/commit` | Large assets/bundles | upload_id, part_no, data, sha256 → committed rev |
| `artifact_build` | Server-side install/bundle/typecheck + headless verify | artifact_id, rev, verify{routes, viewports, scripted interactions, wait_for} → diagnostics + screenshots, or `job_id` |
| `job_status` | Poll long builds | job_id → progress/result |
| `artifact_show` (render tool) | Inline MCP App preview | artifact_id, rev → `ui://` resource + URL |
| `artifact_publish` | Promote rev to a stable URL; set audience | artifact_id, rev, visibility(private/link/org/public), expiry → URL, share token |
| `artifact_versions` / `artifact_fork` / `artifact_rollback` | History, branching, candidates for review surfaces | — |
| `submissions_list` / `submission_read` | Pull form answers, review choices, comments, action events | artifact_id, since_cursor → events |
| `artifact_secrets_set` | Bind credentials used by agent-authored server actions (e.g., the "Send" button's mail API) | artifact_id, name, value or user-entry link → ok |

**Notes (judgment):**
- **Submissions are pull-based.** Claude does not support resource subscriptions, and the 2026-07-28 notification stream is opt-in. The Rust host harness should instead receive submissions through its own events port, such as a webhook or SSE.
- **Keep tool names under 64 characters** and the total tool count around 15 or fewer, to limit tool-selection errors and avoid Claude's reported cap.

### 3. Multi-tenant execution of agent-authored server code

The threat model is tenant against tenant, not a user against their own artifact. Three kinds of workload exist:
- **(a)** short build/verify jobs (Node, a bundler, headless Chromium);
- **(b)** long-lived artifact backends (form endpoints, live-data pollers, "Send" actions, PTY-backed TUI demos);
- **(c)** optional JS-only server actions.

| Platform | Isolation | Cold/resume start (vendor claim unless noted) | Egress control | Persistence | Price signal | License / self-host | Fit |
|---|---|---|---|---|---|---|---|
| **Fly Machines / Sprites** | Firecracker microVM | Resume from suspend "a few hundred ms" vs cold start "~2+ seconds" (Fly docs); create can take "low double-digit seconds" | Sprites: network policy; Machines: standard networking | Volumes $0.15/GB-mo; stopped Machine pays rootfs only | shared-cpu-1x 256 MB $0.0030/hr; per-second | Proprietary platform; no self-host | **Best for (b)**: cheap idle, any language, PTY |
| **E2B** | Firecracker microVM | Vendor and benchmarks vary (≈150 ms–1.8 s) | Configurable internet access | Pause/resume; paused not billed, kept indefinitely | $0.0504/vCPU-hr + $0.0162/GiB-hr while running; Pro $150/mo floor | **Apache-2.0** stack; self-host (Terraform; "E2B Embed" single host); BYOC (Enterprise) | **Best for (a)** and self-host parity |
| **Cloudflare Sandbox/Containers** | VM-backed containers on CF fleet | Independent Aug 2026 benchmark: ~5 s median TTI (secondary) | Egress proxy with credential injection | Snapshots; sleeps after idle | Active CPU $0.072/vCPU-hr; mem $0.009/GiB-hr; $5/mo floor | Proprietary; no self-host (SDK open) | Strong if all-in on CF edge |
| **Modal Sandboxes** | gVisor (VM runtime beta) | Sub-second (vendor) | **Best**: block_network, domain/CIDR allowlists, live updates | Filesystem snapshots; 24 h max | $0.1419/core-hr (=2 vCPU) | Proprietary | Good for (a) when egress allowlisting matters |
| **Vercel Sandbox** | Firecracker microVM | Fast (benchmarks ~0.7–1.9 s, secondary) | Network policies (not verified here) | Persistent sandboxes, snapshots; 64 GB NVMe | $0.128 active CPU-hr + $0.0212/GB-hr provisioned | Proprietary | Fine if hosted on Vercel |
| **Daytona** | Containers by default (Kata/Sysbox opt-in, secondary) | ~90 ms (vendor) | Network limits | Snapshots, archive | ≈$0.0504/vCPU-hr | **Closed since June 2026**; AGPL fork (Nightona) frozen base | Avoid: governance risk |
| **Northflank** | Kata/Cloud Hypervisor, Firecracker, gVisor | n/p | Platform networking | Volumes | $0.01667/vCPU-hr managed; BYOC fee extra | Proprietary; **self-serve BYOC** | Enterprise BYOC option |
| **Deno Subhosting** | V8 isolates | Isolate-fast | Platform | Deno KV | Builder $200/mo | Proprietary; runtime MIT | Only for (c); JS-only; v1 sunset churn |
| **CodeSandbox SDK** | Firecracker (third-party claims) | ~2 s boot, fast fork (secondary) | n/p | Snapshots/hibernation | $0.01486/credit, per-minute | Proprietary (Together AI) | Watch; pricing in flux |
| **Self-host: Docker + gVisor (runsc) or E2B Embed** | gVisor / Firecracker | Local | iptables/proxy | Local disk | VPS cost | OSS | Single-VPS mode |

**Ranked recommendation (judgment):**
1. **Fly Machines for artifact backends (b).** Firecracker isolation, per-second billing, near-zero idle cost (a stopped Machine pays only for rootfs) and fast resume\[39\]\[75\] suit artifacts that sit idle most of the time but must answer a form POST or "Send" click. Any runtime works, including real PTYs for exact-fidelity TUI demos. *Would overturn it:* a need for first-class per-tenant egress allowlists on every backend (then use Modal or Sprites policies), or a decision to standardize on Cloudflare's edge for everything.
2. **E2B for build/verify (a) and as the reference self-host and BYOC sandbox.** It is the only Firecracker option with an Apache-2.0 stack you can run yourself, which keeps the hosted and self-host code paths identical behind `SandboxPort`. Pause-not-billed fits iterative authoring sessions. *Would overturn it:* the $150/month Pro floor at very low volume (start on Hobby or self-host), or E2B following Daytona into closed source, which is a real risk given the 2026 precedent. Pin a known-good Apache-2.0 release.
3. **Cloudflare Sandbox SDK** as the alternative if the hosted product goes edge-first (static artifact hosting on R2/Workers plus containers). Active-CPU billing is attractive, but the platform is proprietary and independent benchmarks show slower start times.
4. **Modal** for verification jobs that need strict egress allowlists. **Vercel Sandbox** only if the control plane already runs on Vercel.
5. **Avoid Daytona** for a new long-term dependency, given its June 2026 closed-source move and archived repo.\[52\]

### 4. Hosting artifacts at scale

**Origins and TLS (judgment informed by PSL rules):**
- Serve artifacts from `https://<artifact-id>--<owner>.<usercontent-domain>`. The user-content domain should be a registrable domain separate from the control-plane and marketing domain (the pattern behind `githubusercontent.com` and `appspot.com`).
- Put the user-content domain in the PSL PRIVATE section. This isolates cookies and storage between tenants and lets a CA issue wildcard certificates for it. Expect a review delay, keep more than 2 years of registration and the `_psl` TXT record, and do not frame the request as rate-limit relief.
- Use DNS-01 ACME wildcard certificates (`*.usercontent.example`). Avoid per-artifact certificate issuance, which runs into CA rate limits and Certificate Transparency noise.
- Give the MCP server and OAuth server their own origin (e.g. `mcp.example.com`), and never serve them from the user-content domain.
- **Safe Browsing risk:** Chrome ignores PRIVATE entries for Safe Browsing exceptions, so one phishing artifact can still taint the whole user-content domain's reputation. Keep a spare domain and a migration runbook, and give private and org artifacts a different domain from anonymous public ones.

**Viewer authentication (judgment):**
- **Private by default.** The owner signs in through the control plane's OIDC (GitHub/Google) or a magic link.
- **Share links** carry a high-entropy, revocable, expiring token. The artifact origin exchanges it once for an origin-scoped, `HttpOnly`, `SameSite=Lax` cookie and strips it from the URL, so tokens don't leak through Referer or history.
- **Org sharing** uses an IdentityPort mapped to SSO groups.
- **Submissions are authenticated to a viewer identity** (or an anonymous token), so the agent knows who answered.
- **Host-rendered trusted controls** (e.g., confirming "Send") run on the control-plane origin, not inside artifact code.

**Storage (judgment):**
- Use immutable content-addressed blobs (S3/R2/MinIO) for file trees and build outputs, and Postgres (SQLite in self-host mode) for artifacts, revisions, publications, share tokens and submissions.
- Store submissions as an append-only event log with idempotency keys. The host's storage port can take ownership of them, which covers the Rust harness's requirement to "own durable answer storage."

**Abuse and phishing on a public multi-tenant domain (judgment, informed by Glitch and the free-tier trend):**
- **Anonymous and free public artifacts:**
  - Expire after N days unless claimed.
  - Show a first-visit interstitial ("user-generated content by …").
  - Cannot use custom domains.
  - Have outbound email and form posting to third-party domains rate-limited.
- **Automated scanning:**
  - Check new publications against Safe Browsing / Web Risk.
  - Detect credential forms (password fields plus brand logos or names) and auto-quarantine public artifacts that match until reviewed.
  - Hash known phishing kits.
- **Takedown:**
  - Provide a visible "Report" link on every public artifact and a documented takedown SLA.
  - Provide `abuse@` and `security.txt`.
  - Disable instantly per artifact, owner or IP range.
- **Separate tiers by domain and by egress budget,** so free-tier abuse cannot exhaust paid capacity.
- **Lesson from Glitch:** design the exit path from day one, with export, redirects and a self-host fallback. Never let free hosting be the only path to running an artifact.

### 5. Self-host vs managed: one codebase

**Single-VPS self-host needs (judgment):**
- One binary or container image: the control plane plus the MCP server (Streamable HTTP).
- Caddy for TLS (a wildcard via DNS-01 for `*.artifacts.yourdomain`, or path-based fallback origins with a warning about weaker isolation).
- SQLite (or Postgres) and the local filesystem or MinIO for blobs.
- A sandbox driver: Docker + gVisor (`runsc`) by default, or E2B Embed on hosts with KVM.
- Headless Chromium for verification.
- A built-in minimal OAuth authorization server that supports CIMD and DCR with refresh tokens, so ChatGPT, Claude and Gemini can connect.
- A documented tunnel option for laptop and home use, since all three vendors require public reachability.

**Ports that make it one codebase:**

| Port | Local CLI | Self-host VPS | Managed cloud | Rust host harness |
|---|---|---|---|---|
| Storage (metadata) | SQLite | SQLite/Postgres | Postgres | Host-owned |
| Blob | FS | FS/MinIO | R2/S3 | Host or FS |
| Sandbox | none/process | Docker+gVisor / E2B Embed | Fly (serve) + E2B (build) | Host-chosen |
| Identity | OS user | OIDC/magic link | OIDC + SSO | Host |
| Addressing | `localhost` ports + per-artifact origins | wildcard subdomains | PSL'd usercontent domain | Host |
| Events | stdout/file | webhook/SSE | queue + webhooks | Host delivers to agent |
| Trusted controls | toolkit UI | toolkit UI | control-plane UI | Host-rendered |

**Rule (judgment):** the managed cloud should be "self-host plus proprietary adapters": a multi-tenant scheduler, billing, abuse pipeline and fleet autoscaling. Nothing a self-hoster needs to run artifacts should exist only in the proprietary layer.

### 6. Open-core economics and license choice

| Comparable | Core license | How hosting is monetized | Lesson |
|---|---|---|---|
| Vercel / Next.js | MIT (background) | Hosting plans + usage; framework drives platform | Permissive core + best-in-class hosting works when the host is genuinely better |
| Supabase | Apache-2.0 (background) | Hosted Postgres tiers; self-host available | Self-host parity builds trust and still converts |
| Streamlit / Community Cloud | Apache-2.0 (background) | Free cloud as funnel → Snowflake | Free hosting as acquisition, monetized elsewhere |
| Gradio / HF Spaces | Apache-2.0 (background) | Spaces hardware ($0.03/hr CPU upgrade, $0.40/hr T4) + PRO $9/mo now required for Gradio/Docker Spaces (verified) | Even HF gated compute-backed free hosting |
| Val Town | Proprietary platform | Pro $25/mo; Business from $167/mo (annual); at-cost AI inference (verified) | Pro→Business gap "too steep"; free tier narrowed to public vals |
| PartyKit | MIT (background) | Acquired by Cloudflare | Permissive core can exit to a platform |
| Glitch | — | Pro subscriptions; shut down hosting July 2025 (verified) | Abuse + cost at scale kills undifferentiated free hosting |

**License options for "viral adoption plus a hosted business":**

| License | Adoption / embeddability (Rust harness, enterprises, marketplaces) | Protection vs hosted clones | Community perception | Verdict |
|---|---|---|---|---|
| **Apache-2.0** (core) | Maximal; patent grant; OSI | None | Best | **Recommended for everything users embed or self-host** |
| FSL-1.1-ALv2 | Fine for internal use/self-host; "Competing Use" restriction creates legal review friction for platforms embedding you | Strong for 2 years per release | Mixed ("fair source," not OSI) | Reserve for the hosting control plane if you ever publish it |
| BSL 1.1 | Variable additional-use grants; 4-year change date default | Strong | Negative after HashiCorp | No |
| ELv2 | Blocks managed-service offering | Strong | Not open source; deters forks | No |
| AGPL-3.0 | Many enterprises ban it; hostile to embedding in proprietary harnesses | Moderate (network copyleft) | Respected by FOSS, avoided by enterprise | No for core; the Daytona episode shows AGPL didn't prevent a closed pivot |

**Ranked recommendation (judgment):**
1. **Apache-2.0 for the SDK, React component library, runtime, CLI, MCP server, self-host server and plugin API.** Keep the multi-tenant cloud (scheduler, abuse, billing, fleet adapters) closed. Protect the business with a trademark policy (name and logo), the hosted network effects (marketplace, sharing, identity), and operational quality, not with the license. *Why:* the brief's goals (host-agnostic embedding by other harnesses, a plugin marketplace, enterprise adoption) are all hurt by non-OSI terms, and the hosted value lies in abuse handling, isolation, uptime and domains, which competitors cannot copy from the source anyway.
2. **Apache-2.0 core plus FSL-1.1-ALv2 for a published "cloud server" package,** if you want the hosting stack source-available for audit or BYOC while blocking a direct clone for two years.
3. **AGPL or source-available core:** not recommended.

**Would overturn the recommendation:** a well-funded clone appears that hosts the Apache core as a competing service and takes significant share, or investors require license-level protection. In that case relicense *new* cloud-specific modules under FSL-1.1-ALv2 and leave the core Apache.

**Hosted pricing sketch (judgment, anchored to comparables):**
- **Free:** private artifacts for the owner. Public sharing comes with an interstitial and expiry, plus small build-minute and backend-hour quotas, with no custom domains.
- **Pro (~$15–25/month):** persistent backends, custom domains, larger quotas, version history.
- **Team (per seat):** org sharing and SSO-lite. Avoid Val Town's steep cliff with a seat-based ramp.
- **Enterprise:** SSO/SCIM, audit, BYOC through E2B or Northflank-style deployment, and self-host support contracts.
- **Usage:** sandbox compute at a transparent markup.
- **Marketplace:** take a revenue share on paid plugins and templates later, once an install base exists.

## Recommendations

1. **Ship the remote MCP server first, on the hosted service.**
   - Stateless and dual-version (2025-11-25 and 2026-07-28), Streamable HTTP only. Don't build legacy SSE.
   - Auth: CIMD, plus DCR, plus refresh tokens.
   - Tool count: about 15, with handle-based state.
   - Test against Claude first (broadest plans, mobile, documented limits), then ChatGPT Business developer mode, then Gemini personal.
2. **Make `artifact_build` the product's center.** Server-side typecheck and bundle, headless Chromium screenshots and console/network errors, all returned in a compact, model-friendly format. Use async jobs beyond about 40 s. This replaces the browser that remote agents cannot see.
3. **Make sandboxes a port:**
   - Hosted: Fly Machines (serve) plus E2B (build/verify).
   - Self-host: Docker + gVisor or E2B Embed.
   - Pin an Apache-2.0 E2B release, and keep a Docker+gVisor fallback in case a vendor relicenses.
4. **Buy and PSL-register a dedicated user-content domain now,** since review takes time. Use wildcard DNS-01 certificates and per-artifact subdomains. Build the abuse pipeline (scanning, interstitials, reporting, quarantine) before launching anonymous public sharing.
5. **License Apache-2.0** for everything users touch, with a proprietary cloud control plane and a trademark policy. Revisit FSL only on the triggers listed above.
6. **Treat tool-schema changes as breaking** because of ChatGPT's frozen snapshots. Add optional parameters only, and introduce new tools rather than changing existing ones.

## Caveats

- **ChatGPT gating is moving and inconsistently documented.** Plus support, mobile rendering for developer-mode apps, and the 60 s timeout are not settled by primary docs. Re-test before launch.
- **No client publishes tool-*argument* size limits.** The chunking thresholds above are engineering judgment.
- **Many sandbox latency figures are vendor claims or single third-party benchmarks** with conflicting results (for example, Daytona showed a 37% success rate in one August 2026 run, and Cloudflare a ~5 s median in the same run).\[45\] Benchmark your own workload, especially Chromium-heavy verification.
- **Daytona's closed-source pivot shows vendor OSS can disappear quickly.** E2B's Apache-2.0 status was verified mostly through E2B's site and repo mirrors, not every LICENSE file.
- **Treat items marked "background" as context only.** Next.js, Supabase, Streamlit, PartyKit, BSL/ELv2 history and Cloudflare Workers for Platforms were not re-verified in this session.
- **This is not legal advice.** License and PSL decisions should get counsel review.

## Sources

1. [Glitch to end app hosting and user profiles on July 8](https://www.bleepingcomputer.com/news/security/glitch-to-end-app-hosting-and-user-profiles-on-july-8/)
2. [Spaces Overview · Hugging Face](https://huggingface.co/docs/hub/en/spaces-overview)
3. [Changelog](https://blog.val.town/changelog-05262026)
4. [The 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
5. [Stateless MCP: What the 2026-07-28 specification changes for security](https://equixly.com/blog/2026/08/05/stateless-mcp/)
6. [ext-apps/specification/2026-01-26/apps.mdx at main · modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
7. [MCP Apps in 6 steps: build a server-rendered UI on MCP](https://ecorpit.com/mcp-apps-server-rendered-ui-extension-build-guide-2026/)
8. [MCP Apps](https://csharp.sdk.modelcontextprotocol.io/v2/concepts/apps/apps.html)
9. [MCP Apps: Interactive UI, Architecture & Security Guide](https://mcpblog.org/mcp-apps/)
10. [MCP Apps: Extending servers with interactive user interfaces](https://daily.dev/posts/mcp-apps-extending-servers-with-interactive-user-interfaces-6eebbfsoh)
11. [SEP-1865: MCP Apps - Interactive User Interfaces for MCP · Issue #1431 · modelcontextprotocol/csharp-sdk](https://github.com/modelcontextprotocol/csharp-sdk/issues/1431)
12. [Developer mode and MCP apps in ChatGPT | OpenAI Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
13. [Reference](https://developers.openai.com/apps-sdk/reference)
14. [Add UI to your MCP server](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)
15. [\[BUG\] ChatGPT mobile app fails to render MCP App widget when the widget-linked tool is called after another tool in the same assistant turn (regression, \~July 10) - #3 by harsha.hegde - ChatGPT Apps SDK - OpenAI Developer Community](https://community.openai.com/t/bug-chatgpt-mobile-app-fails-to-render-mcp-app-widget-when-the-widget-linked-tool-is-called-after-another-tool-in-the-same-assistant-turn-regression-july-10/1387449/3)
16. [Using MCP Servers in ChatGPT: Developer Mode + Apps SDK](https://www.usecarly.com/blog/chatgpt-mcp/)
17. [ChatGPT MCP Servers: The Complete List (2026)](https://www.usecarly.com/blog/chatgpt-mcp-servers/)
18. [Get started with custom connectors using remote MCP | Claude Help Center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
19. [Build an MCP server for Claude - Claude.ai Documentation](https://claude.com/docs/connectors/building)
20. [Connect Claude Code to tools via MCP - Claude Code Docs](https://code.claude.com/docs/en/mcp)
21. [Connect & manage custom apps for Gemini Apps - Computer - Gemini Apps Help](https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DDesktop)
22. [Gemini MCP: How to Add a Custom Server in 2026](https://www.usecarly.com/blog/gemini-mcp/)
23. [Gemini Enterprise MCP: Connect AI Agents to Live Data](https://blog.coupler.io/gemini-enterprise-mcp/)
24. [Custom MCP Server: Smart, Essential Gemini Business Guide](https://www.progressiverobot.com/2026/09/06/gemini-business-custom-mcp-server-connections/)
25. [Cloudflare Sandboxes Are GA: Active-CPU Billing vs E2B/Daytona, Repriced Line by Line](https://bex.co/blog/2026/09/09/cloudflare-containers-sandboxes-active-cpu-pricing)
26. [Cloudflare Containers Pricing Calculator (2026)](https://flarecalc.com/calculators/containers/)
27. [Cloudflare Sandboxes - Secure Code Execution](https://www.cloudflare.com/products/sandboxes/)
28. [Agents have their own computers with Sandboxes GA](https://blog.cloudflare.com/sandbox-ga/)
29. [Vercel Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing)
30. [Vercel Sandbox](https://rywalker.com/research/vercel-sandbox)
31. [What It Costs to Run Claude Code or Codex in a Cloud Sandbox · Learn](https://fly.io/learn/claude-code-sandbox-cost/)
32. [Best cloud sandboxes in 2026](https://northflank.com/blog/best-cloud-sandboxes)
33. [GitHub - e2b-dev/runtime: The runtime behind every E2B stack: Cloud, Enterprise, and your own machine. · GitHub](https://github.com/e2b-dev/runtime)
34. [E2B](https://e2b.dev/ai-agents/shoppal)
35. [Enterprise](https://e2b.dev/enterprise)
36. [E2B vs Modal vs Daytona: Idle Time, Not Cold Start, Sets the Bill](https://www.beri.net/article/e2b-vs-modal-vs-daytona-agent-sandbox-pricing-isolation-2026)
37. [Billing & limits - E2B Docs](https://docs.e2b.dev/billing)
38. [How do I calculate the price of a sandbox? - E2B Docs](https://docs.e2b.dev/faq/calculate-sandbox-price)
39. [Pricing](https://fly.io/pricing/)
40. [Fly.io introduces Sprites: lightweight, persistent VMs to isolate agentic AI](https://devclass.com/2026/01/13/fly-io-introduces-sprites-lightweight-persistent-vms-to-isolate-agentic-ai/)
41. [Fly.io Sprites: specs, pricing & alternatives · CompareSandboxes](https://comparesandboxes.com/sandbox/fly-sprites/)
42. [What It Costs to Host an AI Agent 24/7 · Learn](https://fly.io/learn/always-on-agent-hosting-cost/)
43. [AI Sandbox pricing comparison (2026)](https://northflank.com/blog/ai-sandbox-pricing)
44. [Best AI Code Execution Sandboxes in 2026: E2B, Modal, Daytona and Cloudflare Compared](https://devtoollab.com/blog/best-ai-code-execution-sandboxes)
45. [Best Agent Sandboxes in 2026: Cold Start, Per-Second Pricing, and Network Policy Across E2B, Daytona, Modal, Cloudflare, and Vercel - MarkTechPost](https://www.marktechpost.com/2026/08/27/best-agent-sandboxes-2026-cold-start-pricing-network-policy/)
46. [Security and privacy at Modal](https://modal.com/docs/guide/security)
47. [Sandboxes](https://modal.com/docs/guide/sandboxes)
48. [modal.Sandbox](https://modal.com/docs/reference/modal.Sandbox)
49. [JS SDK Release Notes](https://modal.com/docs/sdk/js/releases)
50. [Networking and security](https://modal.com/docs/guide/sandbox-networking)
51. [GitHub - nightona-co/nightona: Open-source continuation of Daytona — secure, elastic sandbox infrastructure for AI code execution and agent workflows. Community fork of the last AGPL-3.0 release (v0.190.0).](https://github.com/nightona-co/nightona)
52. [GitHub - daytonaio/daytona: Daytona is a Secure and Elastic Infrastructure for Running AI-Generated Code · GitHub](https://github.com/daytonaio/daytona)
53. [Daytona on a Phone in 2026](https://cosyra.com/guides/daytona-on-phone.html)
54. [microsandbox vs daytona: source access, VMs, and snapshots](https://microsandbox.dev/compare/daytona)
55. [Deno Deploy Pricing 2026: Free Tier, Edge Runtime & Alternatives](https://www.srvrlss.io/provider/deno-deploy/)
56. [Deno Deploy Classic Shuts Down July 20, 2026 — and Takes Subhosting v1 With It](https://bex.co/blog/2026/07/10/deno-deploy-classic-sunset-sub-hosting)
57. [Deno Deploy Pricing](https://deno.com/deploy/pricing)
58. [E2B vs Vercel Sandbox: comparing AI sandbox environments in 2026](https://northflank.com/blog/e2b-vs-vercel-sandbox)
59. [Sandbox providers: types, categories, and top platforms in 2026](https://northflank.com/blog/sandbox-providers)
60. [AWS Lambda MicroVMs pricing vs Northflank: which is cheaper for AI sandboxes?](https://northflank.com/blog/aws-lambda-microvms-vs-northflank-pricing)
61. [Pricing](https://codesandbox.io/docs/sdk/pricing)
62. [CodeSandbox SDK](https://rywalker.com/research/codesandbox-sdk)
63. [Guidelines · publicsuffix/list Wiki · GitHub](https://github.com/publicsuffix/list/wiki/Guidelines)
64. [Submit amendments to the Public Suffix List](https://publicsuffix.org/submit/)
65. [Add Hikaproj domains to the PRIVATE DOMAINS section by hikaproj · Pull Request #3309 · publicsuffix/list](https://github.com/publicsuffix/list/pull/3309)
66. [Public Suffix List/Uses - MozillaWiki](https://wiki.mozilla.org/Public_Suffix_List/Uses)
67. [Format · publicsuffix/list Wiki · GitHub](https://github.com/publicsuffix/list/wiki/format)
68. [Hugging Face pricing explained: what you actually pay in 2026](https://www.eesel.ai/blog/hugging-face-pricing)
69. [Functional Source License v1.1 (Apache 2.0 Future License)](https://tools.spdx.org/app/license_requests/366/)
70. [New license request: FSL-1.1-MIT \[SPDX-Online-Tools\] · Issue #2458 · spdx/license-list-XML](https://github.com/spdx/license-list-XML/issues/2458)
71. [Sentry introduces Functional Source License for BSL critics](https://www.theregister.com/software/2023/11/20/sentry-introduces-functional-source-license-for-bsl-critics/820196)
72. [Sentry Wrote Its Own License. Is "Fair Source" Actually Fair to You?](https://fossunited.org/c/indiafoss/2026/cfp/65csphmuup)
73. [Strengthening Liquibase Community for the Future](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl)
74. [APL · Issue #217 · openai/openai-apps-sdk-examples](https://github.com/openai/openai-apps-sdk-examples/issues/217)
75. [Machine Suspend and Resume · Fly Docs](https://fly.io/docs/reference/suspend-resume/)
