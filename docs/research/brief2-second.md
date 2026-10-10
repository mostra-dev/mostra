# Runtime and Architecture Recommendation for a Standalone AI-Authored Artifact Toolkit

## Executive recommendation

**Recommendation: make the default runtime a React 19.3 client application built and hot-reloaded by Vite 8, backed by a small Node 24 LTS sidecar that exposes ordinary HTTP/WebSocket endpoints and a typed optional RPC layer. Run one stable supervisor/gateway per toolkit instance and one disposable worker process per active mutable/serverful artifact. Serve frozen client-only artifacts directly from immutable build storage with no worker process. Proxy foreign development servers through the same gateway at distinct origins.**

This is preferable to making React Server Components, Next.js, Waku, TanStack Start, or another full-stack React framework the architectural foundation.

The decisive reason is not that Server Components or server functions are poor technologies. It is that this toolkit has a very unusual workload: the “applications” are small, numerous, frequently rewritten by agents, usually viewed locally rather than indexed by search engines, sometimes contain arbitrary backend logic, must coexist with completely foreign development servers and PTYs, and need exact version/submission binding. For that workload, **simple process boundaries, ordinary browser protocols, and Vite's development loop are more valuable than framework-integrated SSR**.

As of October 9, 2026, React 19.3 is current. Vite's repository is already at 8.3.4; Vite 8 has stable Rolldown-based builds, React Fast Refresh through its React plugin, and an especially relevant feature for browser-blind coding agents: Vite 8 can forward browser console messages to the development server and automatically enables that behavior when it detects a coding agent. citeturn15search3turn16search28turn14search1 Vite itself is MIT licensed. citeturn16search0

The recommended shape is:

```text
                         Rust host / coding-agent harness
                         ┌──────────────────────────────┐
                         │ durable answers             │
                         │ events / identity            │
                         │ submission delivery          │
                         │ host-rendered trusted UI     │
                         └──────────────┬───────────────┘
                                        │
                            JSON-RPC over stdio
                            versioned HostPort ABI
                                        │
                    ┌───────────────────▼────────────────────┐
                    │ Node 24 LTS artifact supervisor       │
                    │                                       │
                    │ registry / gateway / auth             │
                    │ dependency resolver / shared store    │
                    │ version store / publishing            │
                    │ reverse proxy / process supervision   │
                    └───────┬───────────┬─────────────┬─────┘
                            │           │             │
               ┌────────────▼─┐  ┌──────▼───────┐ ┌──▼─────────────┐
               │ artifact A   │  │ artifact B   │ │ foreign app    │
               │ Vite +       │  │ Vite +       │ │ arbitrary dev  │
               │ server.ts    │  │ server.ts    │ │ server         │
               │ Node worker  │  │ Node worker  │ │ React/Vue/etc. │
               └──────┬───────┘  └──────┬───────┘ └────┬───────────┘
                      │                 │                │ HTTP + WS
             distinct origin    distinct origin     distinct origin
                      │                 │                │
                    ┌─▼─────────────────▼────────────────▼─┐
                    │ trusted browser shell                │
                    │                                      │
                    │ <iframe artifact A>                  │
                    │ <iframe artifact B>                  │
                    │ <iframe foreign app>                 │
                    │ host-owned trusted controls outside  │
                    │ artifact frames                      │
                    └───────────────────────────────────────┘
```

**The ranking is:**

| Rank | Architecture | Recommendation |
|---|---|---|
| **First** | **Vite 8 + React 19 SPA + Node sidecar + optional typed RPC** | Make this the platform contract. Lowest framework lock-in, best match to agent editing/HMR, easiest foreign-app and static-build integration, and simplest multi-artifact isolation. |
| **Second** | **TanStack Start per artifact** | Offer as a first-class adapter once Start reaches a genuinely settled v1 operationally. Attractive server functions/SSR/type safety, but it is still officially RC in October 2026 and has a larger execution model for agents to learn. citeturn15search1turn15search9 |
| **Third** | **RSC-native artifact worker, preferably Waku; Next.js when its larger framework is actually wanted** | Keep experimental/optional. Waku is only at 1.0 RC; React Router's RSC support remains unstable; Parcel calls its RSC support beta. Next.js is mature and intensely maintained, but carries the most framework semantics and therefore the greatest lock-in. citeturn14search2turn14search8turn20search2 |

What would overturn the first-place recommendation is a change in the product's workload: if most artifacts become public-facing applications where initial server-rendered HTML, RSC data locality, route-level streaming and SEO are materially more important than local HMR, arbitrary package compatibility, frozen export, foreign-app support, and process isolation, a full-stack framework should move upward. Likewise, if TanStack Start reaches stable v1 and demonstrates a long period of reliable SSR HMR and packaging, it becomes a much stronger candidate for the default rather than an adapter.

## Current framework landscape and the decisive trade-offs

There is no shortage of technically capable React stacks in 2026. The more important question is which semantics should become part of your **artifact format and host ABI**, because that choice will be expensive to reverse.

React itself is currently at 19.3, released September 9, 2026. citeturn15search3 Server Components are a React capability, but deploying them requires substantial framework/bundler participation; Server Functions similarly translate client invocations into requests that a framework must decode and dispatch server-side. The operational surface is therefore much larger than “React plus a server.” That was made unusually visible in December 2025, when an upstream RSC protocol issue produced a critical remote-code-execution vulnerability and Next.js tracked the downstream impact as CVE-2025-66478, CVSS 10.0. citeturn15search11 This does **not** mean RSC should be treated as intrinsically unsafe; it means an RSC runtime becomes security-sensitive framework infrastructure that has to remain aggressively patchable.

That is particularly relevant today. Next.js 16.4 was released on October 6, 2026 with React 19.3, additional lazy compilation, smaller development caches and production bundles, and continued Turbopack work. citeturn15search0 Yet on October 8, two days after that release and one day before the date of this report, the Next.js team announced an out-of-band security update planned for **October 14, 2026** to address two Critical and one High severity vulnerabilities in upstream dependencies. citeturn15search4 The lesson for this toolkit is not “avoid Next”; it is **do not make a fast-moving full-stack framework part of an artifact's durable execution contract unless its functionality pays for the update burden**.

The options compare as follows.

| Stack as of Oct. 9, 2026 | State / maintenance signal | Artifact-authoring strengths | Main disadvantages here | License |
|---|---|---|---|---|
| **Vite 8.3.4 + React 19.3** | Vite 8 stable Mar. 12, 8.1 Jun. 23; repository package is 8.3.4. citeturn14search1turn14search7turn16search28 | Extremely small required mental model; fast HMR; ordinary React; framework-neutral; excellent static build; agent-oriented console forwarding in Vite 8. citeturn16search4turn14search1 | No built-in server functions/loaders/RSC; toolkit must own a small server/RPC API. | MIT. citeturn16search0 |
| **React Router 8.4** | Current docs identify 8.4.0; v8 is intended as a non-breaking upgrade from v7 and requires React 19+/Node 22+/Vite 7+. citeturn15search15turn15search6 | Excellent optional routing/data layer on top of Vite; can be used minimally or as a framework. citeturn15search14 | RSC path remains unstable; unnecessary as a mandatory dependency for single-view artifacts. | MIT. |
| **TanStack Start** | Still officially **Release Candidate**; docs say feature-complete/API-stable but explicitly not bug-free. The v1 RC announcement dates to Sep. 23, 2025, so it has remained RC for more than a year. citeturn15search1turn15search5 | Type-safe routing, SSR, streaming, server functions and API routes in one Vite-based stack. citeturn15search9 | More framework semantics; isomorphic loader execution requires care; still RC. A current repository issue reports an SSR-HMR regression against `@tanstack/react-start` 1.167.50, which is a cautionary signal rather than proof of a systemic problem. citeturn20search4 | MIT via TanStack Router repository. citeturn16search2 |
| **Next.js 16.4** | Released Oct. 6; very active release/security cadence. citeturn15search0turn15search4 | Most complete RSC/server-function ecosystem; server rendering, streaming, caching, mature conventions; recent releases explicitly improve agent workflows. | Largest framework model, most generated machinery, harder frozen/static semantics for serverful artifacts, higher lock-in. Security update already announced for Oct. 14. citeturn15search4 | MIT. citeturn16search1turn16search21 |
| **Waku 1.0 RC** | 1.0 RC released Aug. 25, 2026; public APIs declared fixed for RC, final not yet shipped. citeturn14search2turn14search8 | Probably the most attractive RSC experiment for this product: deliberately minimal, built around RSC, Vite and Hono rather than a very large framework surface. citeturn14search5turn20search0 | Pre-1.0; smaller adoption/operational track record. | MIT. |
| **Parcel 2.16.4 RSC** | 2.16.4 released Feb. 1, 2026; Parcel's RSC support is still documented as beta. citeturn20search2 | Impressively zero-config; RSC can be mixed with SPA, SSR and static RSC. | More appropriate as bundler infrastructure than the platform's application/server contract; Vite ecosystem is a closer fit to the other candidates. | MIT. citeturn20search13 |

A subtle advantage of Vite is particularly aligned with your stated author profile. Vite 8's release added browser-console forwarding to the development server and says it is automatically activated when a coding agent is detected. citeturn14search1 That does not replace screenshots, but it materially reduces the normal handicap of an LLM that can run commands and inspect terminal output but cannot continuously inspect the browser.

**Judgment:** do not recreate a miniature Next.js in the Vite architecture. The server layer should stay boring. An artifact should be able to contain:

```text
artifact/
  src/
    App.tsx
    ...
  server.ts          # optional
  package.json       # ordinary npm dependency declaration
```

`server.ts` should be ordinary TypeScript exporting either a standard `fetch(Request): Promise<Response>`-style handler, a Hono application, or toolkit-provided typed procedures. The last is a convenience, not the only path. The browser can call it through `/api/...`, WebSocket, SSE, fetch streams, or an optional typed `@artifacts/rpc` client. This preserves the commitment that authors are writing normal TypeScript rather than a custom artifact language.

Hono is a strong fit for the internal server shell because it uses Web-standard request/response primitives, runs across Node/Bun/Deno, is currently at 4.13.13 in its repository package, and is MIT licensed. citeturn16search19turn16search3 tRPC 11.19 is also actively maintained and remains an excellent optional TypeScript-to-TypeScript RPC implementation. citeturn20search10turn20search14 I would **not**, however, make tRPC the Rust-host protocol: the host ABI should be language-neutral.

The most important architectural separation is therefore:

> **React is the artifact authoring contract. Vite is the default development/build engine. HTTP/WebSocket is the artifact runtime contract. JSON-RPC is the host integration contract. Full-stack React frameworks are adapters, not the substrate.**

That arrangement gives agents maximum freedom without forcing every artifact—slides, questionnaires, a chart, a terminal surface, a tiny inbox editor—to instantiate an entire SSR/RSC application architecture.

## Candidate architectures

**Candidate A — Vite worker architecture, recommended.**

```text
   mutable source tree
          │
          ▼
 ┌──────────────────┐
 │ artifact worker  │
 │ Node 24          │
 │                  │
 │ Vite dev server  │──── HMR ───────────────┐
 │ optional server  │                        │
 │ module / Hono    │──── HTTP / WS ────┐    │
 └────────┬─────────┘                    │    │
          │                              │    │
          │ host-port RPC                │    │
          ▼                              ▼    ▼
 ┌─────────────────┐              ┌─────────────────┐
 │ supervisor      │◄────────────►│ artifact iframe │
 │ + Rust host     │   gateway    │ React 19.3     │
 └─────────────────┘              └─────────────────┘
```

The toolkit owns the Vite configuration, React plugin, HMR transport, error overlay integration, dependency resolution, gateway and build output. The agent normally touches only application source. Vite 8's current package is 8.3.4 and it is MIT licensed. citeturn16search28turn16search0

This architecture gets nearly all the important server capabilities without adopting a server-rendering programming model. Mutations are ordinary POST/RPC operations. Long-running generation can stream through `ReadableStream`, SSE or WebSocket. Live data can use WebSocket/SSE and invalidation events. Forms can call the Rust-owned durable storage port. Server-side secrets remain in `server.ts` rather than the browser. A dashboard can still be entirely client-side.

The important omission is transparent component-level SSR/RSC. For your stated artifact categories, that is usually a favorable trade: dashboards, presentations, review UIs, terminal emulators, motion graphics and questionnaires derive much less value from SEO and first-request server rendering than public websites do.

React Router 8 can be preinstalled as an **optional routing layer**, not baked into the artifact format. Its current documentation explicitly supports minimal declarative/data use as well as full framework mode, and v8 is a non-breaking progression from v7. citeturn15search14turn15search6

**Candidate B — TanStack Start worker.**

```text
 mutable source
      │
      ▼
 ┌─────────────────────┐
 │ TanStack Start      │
 │ Vite                │
 │ Router              │
 │ SSR / streaming     │
 │ server functions    │
 │ API routes          │
 └─────────┬───────────┘
           │
      Node worker
           │
    reverse-proxied
           │
           ▼
     artifact origin
```

TanStack Start is philosophically much closer to this toolkit than Next.js. It is Vite based, supports full-document SSR, streaming and server functions, and does not force RSC as its basic model. citeturn15search9 Its server-function implementation also performs same-origin checks and has built-in CSRF-oriented middleware, evidence that its maintainers have treated browser-to-server action boundaries as a first-class security problem. citeturn1search4

The downside is the programming model. Start route loaders can execute on the server for SSR and then in the browser on client navigation depending on configuration, which is powerful but gives an LLM more execution-location semantics to reason about than “browser code here, server code there.” citeturn1search17 More importantly for an enterprise-grade foundational dependency, its official status is still RC as of October 2026. citeturn15search1

I would ship this as a supported artifact adapter early, because it will reveal whether users genuinely value full-stack rendering enough to revisit the default.

**Candidate C — RSC-native worker, Waku first and Next.js as a heavyweight adapter.**

```text
 React component tree
      │
      ├──── client components ───────────► browser
      │
      └──── server components/functions
                       │
                       ▼
             RSC framework worker
             Waku / Next / Parcel
                       │
                  RSC protocol
                       │
                       ▼
                    browser
```

If the toolkit wants a reference RSC implementation, **Waku is the best architectural experiment** because it was deliberately designed as a small RSC-native framework, now uses Vite and Hono, and keeps more concerns composable rather than absorbing the whole application architecture. Its 1.0 RC was released August 25, 2026 and declares public APIs fixed during the RC. citeturn14search2turn14search8

Next.js should nevertheless be supported as a foreign/full-stack adapter because agents will encounter it constantly and because its engineering investment is formidable. Next.js 16.4 added React 19.3, more lazy compilation and more development-memory/disk improvements; 16.3 had already reported up to 90% lower development memory usage, while 16.2 reported roughly 400% faster `next dev` startup. These are vendor-reported figures rather than independent benchmarks, but they show that local developer-loop performance remains an active priority. citeturn15search0turn15search4

I would not use Next's App Router as the toolkit's artifact ABI. The artifact would effectively become “a Next application,” and Next's caching, route, compilation and Server Function semantics would leak into versioning, publishing and host integration. That is exactly the type of lock-in the host-agnostic toolkit can avoid by keeping it an adapter.

Parcel is even less compelling as the default RSC implementation. Its zero-config development experience is strong and 2.16.4 remains maintained, but its RSC documentation still describes the feature as beta. citeturn20search2turn20search13 React Router 8 is highly attractive in non-RSC modes, but its RSC mode likewise remains labeled unstable. The ecosystem has therefore not converged enough to justify making RSC the artifact format's foundational server protocol.

## Runtime, distribution and dependency model

**Use Node 24 LTS as the production sidecar runtime. Do not embed a JavaScript engine into Rust. Do not make single-executable packaging an architectural requirement.**

Node 24 is the current LTS line while Node 26 is Current; React Router's June 2026 runtime-support documentation likewise identifies Node 24 as Active LTS. citeturn2search3turn15search16 A current Node 24 release in September 2026 is 24.21.0. citeturn2search27

The case for Node here is compatibility, not glamour. The system explicitly promises arbitrary npm packages, agent-authored server code, arbitrary frameworks and PTYs. Those requirements strongly favor the runtime most npm packages assume, especially once native Node-API modules, lifecycle scripts, framework CLIs and development servers enter the picture.

| Runtime | Current state | Distribution | Compatibility for arbitrary artifacts | License / commercial consideration | Verdict |
|---|---|---|---|---|---|
| **Node 24 LTS** | LTS in Oct. 2026. citeturn2search3 | Ship a private Node runtime alongside the toolkit. SEA exists, but Node documents SEA as **Stability 1.1 — Active development**; the direct `--build-sea` CLI was only added in Node 25.5. citeturn14search0 | Best baseline for npm, native add-ons and framework CLIs. | Node project is permissively licensed, with bundled third-party license notices to preserve. | **Default.** |
| **Bun 1.4.2** | 1.4 shipped Aug. 20; 1.4.2 Sep. 5 with continued compatibility/crash fixes. citeturn17search0turn17search8 | Excellent `bun build --compile` story and cross-platform executables. | Very high and rapidly improving Node compatibility, but compatibility fixes continue to land. | Bun's license documentation says it statically links LGPL-2-licensed JavaScriptCore/WebKit and explicitly describes the relinking/object-file obligation for static linkage. citeturn17search1 | Excellent optional runtime/build experiment; not the safest redistribution default. |
| **Deno 2.9** | Released Jun. 25, 2026, with Node 26 compatibility work and improved npm migration. citeturn17search2 | `deno compile` is mature enough to detect common frameworks and embed CJS/native add-ons; strong self-contained distribution. citeturn14search6 | Much stronger npm/Node compatibility than older Deno; Node-API add-ons supported, although npm lifecycle scripts are deliberately not run by default. citeturn14search3 | Deno repository is MIT. citeturn17search7 | Strong second-place runtime, particularly if single-file distribution later becomes decisive. |

Bun's LGPL situation is not a prohibition on commercial use; LGPL is an open-source license. It is nevertheless a **redistribution/compliance consideration** that matters more when the product's attraction is a statically compiled single binary. Bun's own license file specifically calls out static linking against JavaScriptCore/WebKit and says an application must be available in a relinkable object form under the described LGPL conditions. citeturn17search1 That deserves real legal review before making a Bun-compiled executable the canonical enterprise distribution.

Node SEA should also not be allowed to distort the design. Node 26 documentation still labels Single Executable Applications “Active development,” despite improved tooling and the newer `--build-sea` command. citeturn14search0 A signed distribution directory such as:

```text
toolkit/
  bin/
    toolkit-host
    node
  lib/
    supervisor.bundle.mjs
    worker.bundle.mjs
  native/
    <platform-specific PTY/addons>
  assets/
    shell/
```

is operationally boring, inspectable, patchable and friendly to native dependencies. A one-file launcher can come later.

**Rust ↔ JavaScript integration should be a sidecar, not embedded V8/QuickJS/JavaScriptCore.** Embedding would immediately make the Rust host responsible for emulating Node's module resolution, process model, native add-on ABI, subprocess behavior and development-server expectations. A child-process boundary preserves the exact environment third-party JS expects and provides crash containment almost for free.

I recommend a two-layer host protocol:

```text
Rust host
   │
   │ stdin/stdout:
   │ JSON-RPC 2.0, request IDs, notifications
   │
   ▼
Node supervisor
   │
   ├── HostPort.storage.*
   ├── HostPort.events.*
   ├── HostPort.identity.*
   ├── HostPort.submissions.*
   └── HostPort.addressing.*
```

Use stdio JSON-RPC for lifecycle, durable storage calls, identity and submission delivery. The Rust process spawns Node with already-connected pipes, so there is no separate localhost control endpoint for another website to discover. Large browser-facing streams stay on HTTP/WebSocket and do not need to be base64-multiplexed through JSON-RPC. If later measurements show high-volume Rust↔Node streams, add a Unix-domain socket/named-pipe transport behind the same HostPort interface; do not change the logical ABI.

The host ABI should carry an explicit protocol version and capability discovery. A standalone CLI can implement the same ports internally, while the Rust harness can implement storage/submission itself. This is where host agnosticism should live.

**Dependency installation should be invisible, shared and reproducible—not eliminated.**

The wrong solution is a huge implicit global `node_modules` where agents may import whatever happens to have been preinstalled. That makes published artifacts depend on invisible ambient state. The other wrong solution is requiring a fresh `npm install` for every generated artifact.

Instead:

```text
                  npm registry
                      │
             resolve only as needed
                      │
                      ▼
          ┌──────────────────────┐
          │ shared content store │
          │ one copy of packages │
          └──────────┬───────────┘
                     │ links / projection
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
 artifact A       artifact B     artifact C
 package.json     package.json   package.json
 lock snapshot    lock snapshot  lock snapshot
 node_modules     node_modules   node_modules
 projection       projection     projection
```

pnpm's core storage model is almost exactly what is needed: it stores package content once in a content-addressed store and links packages into individual projects. citeturn18search11 Current pnpm also supports fully offline, frozen-lockfile operation against a pre-populated store. citeturn18search0 That means the toolkit can maintain one store while every artifact keeps a normal dependency graph and exact lock state.

There is, however, a 2026 licensing wrinkle worth catching now. The pnpm repository says it is MIT **except for the `pnpr/` directory**, which is source-available under PolyForm Shield 1.0.0; the pnpr license contains a noncompete condition. citeturn18search8turn18search1 Do not accidentally redistribute or depend on `pnpr` as part of an otherwise permissively licensed toolkit without a separate decision. Nothing in the recommended design requires pnpr: use pnpm's ordinary local store/install path.

The dependency policy should therefore be:

**Warm, not whitelisted.** Ship or pre-seed a warm cache containing the toolkit's normal React/runtime dependencies and perhaps commonly used artifact packages, but make them explicit normal dependencies. Arbitrary npm packages remain allowed.

**Automatic resolution.** A file watcher notices a changed `package.json`/lock snapshot, invokes the pinned package-manager implementation, and refreshes the artifact worker. The agent never needs to perform an installation manually unless it wants to.

**Lock on publish.** Mutable previews may resolve a newly declared semver range. Publishing writes a resolved lock snapshot and refuses subsequent frozen builds if dependency state differs. pnpm's `--frozen-lockfile` semantics are designed to fail rather than update an inconsistent lockfile. citeturn18search0

**Offline means genuinely offline.** A frozen artifact works offline whenever every referenced package is present in the shared store. Missing content produces an explicit dependency-missing error rather than silently going online.

**Lifecycle scripts execute in the artifact execution context, not the supervisor's privileged context.** This does not impose a content/capability policy: the artifact is already arbitrary executable code. It simply prevents an npm postinstall from inheriting supervisor-only host credentials by accident.

esm.sh/import maps should be an optional lightweight mode, not the default dependency architecture. esm.sh is MIT and can resolve npm packages directly to browser-consumable URLs/import maps, but its own current documentation says its URL-module mechanism is not supported by Node.js/Bun and that the global service is CDN-backed. citeturn18search2turn18search3 That fights the requirements for offline operation, arbitrary server packages and one reproducible graph across browser and server.

## Multi-artifact isolation, routing, foreign apps and terminals

The right process model is **one stable supervisor, many disposable workers**, not one giant application server and not an entire independently packaged toolkit process per artifact.

```text
                   ONE SUPERVISOR
   ┌─────────────────────────────────────────────┐
   │ gateway / registry / version store          │
   │ dependency store / host bridge              │
   └────┬──────────────┬──────────────┬──────────┘
        │              │              │
      spawn          spawn          no process
        │              │              │
        ▼              ▼              ▼
   live worker     live worker     frozen build
   artifact A      artifact B      immutable files

   crash A  ──X──► does not take B or gateway down
```

A mutable artifact containing server code is arbitrary code. Loading ten such artifacts into one Node VM buys some memory efficiency at the cost of crash containment, global-state isolation, environment isolation, dependency/native-addon conflicts, independent HMR graphs, working-directory assumptions, and the ability to kill a runaway artifact. Those are bad trades for agent-authored applications.

The default should therefore be:

| Artifact state | Execution model |
|---|---|
| Frozen, client-only | No artifact process; gateway serves immutable files. |
| Live preview, client-only | Vite worker on demand; stop after idle timeout. |
| Live preview with `server.ts` | Dedicated Node worker. |
| Frozen with server functionality | Dedicated worker started lazily on first use. |
| Foreign framework app | Its own development-server process, reverse proxied. |
| TUI/terminal | Dedicated PTY/process session, preferably independent of the supervisor event loop. |

If measurements later show that dozens of idle Vite workers are the limiting resource, add **worker hibernation before pooling**. Shut down idle workers and restart them from their cached Vite/dependency state. Pooling arbitrary server programs in one VM should be a later optimization with an explicit trust/compatibility mode, not the initial architecture.

The browser isolation boundary should be equally deliberate. The trusted shell and each artifact should have separate browser origins. Trusted host controls—submit, accept candidate, destructive host operations, identity indicators—belong outside the artifact iframe. The artifact can request those operations through its host bridge but cannot spoof the host's trusted chrome.

For the local server, implement hygiene rather than capability restrictions: bind only to loopback by default; maintain an explicit allowed-Host set; give each browser session an unguessable session credential; validate `Origin`/Fetch Metadata on mutating toolkit endpoints; and authenticate each artifact to only its own gateway namespace. This is precisely the class of protection that prevents an unrelated website from blindly issuing requests to a user's localhost service without restricting what an authorized artifact itself may do. TanStack Start's own server-function implementation is useful precedent: it performs same-origin/CSRF-oriented checks around server functions. citeturn1search4

**For addressing, prefer virtual-host/subdomain routing, then direct ports, and make path-prefix routing the last resort.**

```text
Preferred behind gateway / tunnel:

 shell.<session-domain>          trusted shell
 a1.<session-domain>             artifact A
 a2.<session-domain>             artifact B
 foreign-7.<session-domain>      foreign dev server

All may reach one physical gateway listener,
but browser-visible origins stay distinct.
```

This should be hidden behind the proposed `HostPort.addressing` interface. On localhost, the standalone tool can choose whatever hostname/port strategy works reliably on the machine. A remote tunnel implementation can mint corresponding wildcard hostnames. That avoids baking “localhost port 4173” into artifact code.

Port-per-artifact is a good local fallback because it preserves a root `/` URL space and naturally separates origins. It becomes inconvenient for phone access through a tunnel that exposes only a single local listener.

Path routing such as `/artifacts/a1/...` is the weakest fallback for arbitrary foreign apps. Many development servers assume they own `/`; absolute asset paths, redirects, cookies and WebSocket/HMR endpoints can escape a prefix. A path also makes unrelated artifacts share a browser origin unless additional isolation is introduced. Use paths for toolkit-owned applications whose base path can be configured, not as the universal compatibility mechanism.

**Foreign applications should run natively and be reverse-proxied, not rebuilt in the browser.**

For an agent's existing Next/Vite/Vue/Svelte/Astro/etc. server:

```text
agent's process
localhost:53281
     │
     │ HTTP + Upgrade: websocket
     ▼
┌──────────────────────┐
│ gateway proxy        │
│ no path-prefix       │
│ preserves streaming  │
│ WS/HMR passthrough   │
└──────────┬───────────┘
           │
           ▼
foreign-7.<artifact-domain>
           │
           ▼
        <iframe>
```

The proxy needs ordinary HTTP streaming, WebSocket upgrade passthrough, redirect/cookie handling and configurable `Host` forwarding. Do not normally rewrite application HTML or JavaScript to fix HMR URLs; giving the application its own root URL/origin eliminates most of those problems. For pathological development servers, provide adapter hooks for `Host`, forwarded headers and advertised WebSocket origin.

This approach is dramatically better aligned with local-first operation than browser-contained Node runtimes: the machine already has the toolkit sidecar, can run native binaries, can use filesystem watchers directly, and can execute non-JavaScript frameworks as well.

WebContainers are impressive but a poor core dependency for this product. Their API runs Node-like development environments inside the browser, but WebContainers require `SharedArrayBuffer`/cross-origin isolation and the official quickstart says only one WebContainer instance may be created at a time. citeturn19search1 Even more decisively for a widely adopted toolkit, StackBlitz's current terms state that production use of WebContainer API in a commercial for-profit setting requires a commercial license; prototypes/POCs are exempt. citeturn19search0 That is a commercial restriction that conflicts with making it an unrestricted foundational dependency. Keep it as an optional adapter for users who independently satisfy the license terms or for situations where a browser-only execution environment becomes a product requirement.

Sandpack is legally easier: its repository is Apache-2.0. citeturn19search2 But it is primarily a component toolkit around the CodeSandbox bundling model, which makes it attractive for code playgrounds rather than faithful execution of arbitrary native local development servers. esbuild-wasm 0.28.2 is MIT and is an excellent building block for small self-contained browser compilation experiments, but it is a bundler, not a Node process/dev-server substitute. citeturn19search3turn19search6

Thus:

| Foreign-app technique | Arbitrary framework fidelity | Offline/local fit | Multi-artifact fit | Licensing | Recommendation |
|---|---:|---:|---:|---|---|
| **Native process + gateway proxy** | **Excellent** | **Excellent** | **Excellent with process supervision** | Ordinary dependency licenses | **Default** |
| esbuild-wasm sandbox | Low–medium | Excellent | Excellent | MIT. citeturn19search3 | Optional lightweight JS playground |
| Sandpack | Medium for supported playground use | Medium | Good | Apache-2.0. citeturn19search2 | Optional editor/demo integration |
| WebContainers | High for browser-hosted Node workloads | Good after boot/cache | Single WebContainer constraint is awkward | Commercial production license required for for-profit use. citeturn19search0turn19search1 | **Do not make core** |

Terminal/TUI artifacts fit naturally into the same proxy model. xterm.js is MIT licensed and its maintained addons include `@xterm/addon-attach` for WebSocket-connected processes and `@xterm/addon-serialize` for serializing terminal state. citeturn21search0 Microsoft's node-pty provides PTYs on Linux, macOS and Windows, with Windows using ConPTY. citeturn21search1

The architecture should be:

```text
          real CLI / TUI program
                   │
                   ▼
              node-pty PTY
             cols x rows + pixels
                   │ raw VT stream
                   ▼
               WebSocket
                   │
                   ▼
                xterm.js
                   │
           exact font/theme sizing
                   │
                   ▼
               browser iframe
```

The browser sends keyboard input and resize events back to the PTY. Preserve the raw VT byte stream, terminal dimensions, pixel dimensions and timing if exact replay is important; a final terminal buffer alone is insufficient to reproduce animations or transient TUI states.

There is a maintenance reason to isolate this code particularly well: node-pty's active 1.2 line remains prerelease—the latest listed release is `1.2.0-beta.15` from August 3, 2026—and 2026 releases include several macOS/Windows handle/deadlock/native fixes. citeturn21search2 That does not make node-pty a bad choice; it is the established cross-platform primitive. It does argue for putting PTYs behind a narrow package and process boundary so that native-addon failures cannot kill the supervisor.

## Immutable versions, live previews and exact submission binding

Treat **working state**, **rendered state** and **published state** as different concepts. A single “artifact version” field is not enough.

I recommend these identifiers:

```text
source_revision
    hash of normalized source tree + artifact metadata

environment_revision
    hash of:
      exact dependency lock
      toolkit/runtime ABI version
      build engine/version
      relevant build configuration
      platform triple where native code matters

build_revision
    hash of immutable emitted client/server artifacts

view_instance
    host record saying:
      user/session
      artifact
      exact rendered revision
      route / initial state
      created_at

submission
    {
      view_instance,
      rendered_revision,
      payload,
      host identity,
      submitted_at
    }
```

Use a standard cryptographic content hash such as SHA-256 over a canonical manifest rather than treating filenames or timestamps as identity.

There should be two explicit artifact modes.

**Live preview** points to a mutable working tree. Vite HMR is active. The supervisor's source watcher assigns a new `source_revision` whenever the stable filesystem snapshot changes. A small injected client runtime observes completed HMR cycles and updates the browser's `rendered_revision` only once that revision has actually reached the page.

That distinction matters. Imagine:

```text
12:00:00 browser shows rev A
12:00:01 agent writes source B
12:00:01.2 source watcher sees B
12:00:01.4 Vite begins transform
12:00:01.7 user presses Submit
12:00:01.9 browser accepts HMR B
```

Simply recording “latest source revision” would incorrectly associate the submission with B even though the human was still looking at A. The client-side toolkit bridge therefore sends the **last acknowledged rendered revision**, not the supervisor's newest filesystem digest.

For any artifact capable of producing durable human input, the supervisor should retain an immutable source/dependency snapshot for every rendered revision until all associated `view_instance` records are safely durable. The Rust host can then store:

```json
{
  "artifact_id": "inbox-review",
  "view_instance": "v_...",
  "rendered_revision": "sha256:...",
  "submission": {
    "candidate": 2,
    "edited_reply": "..."
  }
}
```

This solves a class of auditability problems that full-stack web frameworks do not solve for you.

**Published/frozen mode** creates an immutable dependency snapshot and a production build. A frozen URL never follows the working directory. Editing files creates a new live revision; publishing creates another immutable identifier.

The build key should include at least:

```text
artifact source manifest
+ package.json
+ exact lock snapshot
+ package-manager version
+ React/runtime SDK version
+ Vite/framework version
+ toolkit host-ABI version
+ build configuration
+ platform/ABI if server native modules participate
```

Do not claim that a given input key guarantees byte-for-byte reproducible output unless every plugin in the build has been audited for nondeterminism. Instead, retain both the **input/environment digest** and the **actual output digest**.

Frozen artifacts divide naturally into two classes.

| Frozen artifact | Archive/share model |
|---|---|
| Pure browser artifact | Ordinary static Vite build: HTML, hashed JS/CSS/assets and manifest. Can be copied or archived without the toolkit server if it does not depend on host APIs. |
| Artifact using host storage/actions/live backend | Immutable client assets **plus immutable server bundle/runtime manifest**. It remains a runnable artifact package, not a static website. |
| Artifact requiring live external API | Freeze its code/version, not necessarily its returned data. Record data snapshots separately where auditability requires them. |
| “Static archive” of a serverful artifact | Produce a snapshot/replay representation with actions disabled or explicitly marked unavailable; do not pretend a button backed by server logic survives static HTML export. |

That distinction matters for “Send” or other real actions. The actual action implementation belongs to a versioned server bundle. A screenshot/static HTML archive can preserve what the human saw but cannot honestly preserve a live side effect without a runtime.

Publication should be atomic:

```text
mutable tree
    │
    ├─ resolve/freeze deps
    ├─ snapshot source
    ├─ production build
    ├─ hash outputs
    ├─ write immutable manifest
    └─ atomic registry update
             │
             ▼
       published version
```

Vite's production build model is especially helpful here because the same tool used for the live developer loop produces a conventional static client build. Vite 8 consolidated its underlying production tooling around Rolldown, while retaining the established Vite plugin interface. citeturn14search1 This is a much cleaner frozen-version boundary than freezing the internal state of a long-running full-stack development framework.

## Monorepo decomposition, decision matrix and final ranking

The platform should enforce the architecture in package boundaries. In particular, the browser SDK must not know whether the outer host is Rust, a standalone CLI, or another agent harness.

A suitable monorepo decomposition is:

| Package | Responsibility | Dependency rule |
|---|---|---|
| `@artifacts/cli` | Standalone commands: create/open/dev/publish/export | Thin composition layer; no artifact execution logic |
| `@artifacts/supervisor` | Process registry, lifecycle, idle eviction, worker orchestration | Owns workers, never imports user artifact modules |
| `@artifacts/gateway` | HTTP/WS entrypoint, origins, reverse proxy, session hygiene | Stable trusted process |
| `@artifacts/host-protocol` | Versioned JSON-RPC HostPort definitions, wire validation, capability discovery | No React/framework dependencies |
| `@artifacts/worker` | Dedicated Node child-process entry for first-party artifacts | Disposable; may execute arbitrary artifact code |
| `@artifacts/vite-plugin` | Zero-config artifact entry discovery, injected client bridge, revision/HMR bookkeeping | Vite-specific but host-independent |
| `@artifacts/runtime-client` | Browser APIs: host actions, storage calls, submissions, events, live revision | Small and framework-light |
| `@artifacts/react` | React conveniences/design primitives/hooks on top of runtime-client | Optional author-facing package |
| `@artifacts/runtime-server` | Server-side HostPort API, artifact request context | Runs only inside worker |
| `@artifacts/rpc` | Optional typed TS client/server RPC convenience | Must remain optional; raw HTTP/WS remains valid |
| `@artifacts/deps` | Package resolution, pnpm store interface, offline/frozen installs | No artifact code execution except lifecycle worker |
| `@artifacts/version-store` | Source/environment/build digests, immutable manifests, GC | Framework-neutral |
| `@artifacts/foreign-proxy` | Attach/proxy arbitrary existing development servers | HTTP/WS only; framework adapters optional |
| `@artifacts/terminal` | PTY lifecycle, VT/WebSocket transport, xterm integration | Isolate native node-pty dependency |
| `@artifacts/ui` | Beautiful default shell, forms, review primitives, layouts/themes | No trusted-host authority |
| `@artifacts/testing` | Artifact fixtures, lifecycle conformance, proxy/HMR tests, screenshot integration hooks | Test-only |
| `crates/artifacts-host-protocol` | Optional generated/hand-maintained Rust implementation of HostPort wire types | Must conform to same protocol fixtures |

Keep framework integrations outside the core:

```text
adapters/
  react-router/
  tanstack-start/
  waku/
  next/
  parcel-rsc/
```

And foreign-server knowledge similarly separate:

```text
foreign-adapters/
  vite/
  next/
  generic-http/
```

The core supervisor should be able to proxy a completely unknown server using only a target port. Framework adapters merely improve diagnostics, HMR configuration or startup detection.

The overall decision matrix is:

| Criterion | Vite SPA + sidecar | TanStack Start | Waku/RSC | Next 16.4 |
|---|---:|---:|---:|---:|
| Ordinary React/TS authoring | **Excellent** | Excellent | Good | Good |
| Agent mental-model simplicity | **Excellent** | Good | Medium | Medium |
| Zero-config under toolkit ownership | **Excellent** | Good | Good | Good |
| Client HMR | **Excellent** | Good, but RC/HMR churn exists | Good | Excellent |
| Browser-blind agent observability | **Excellent** because Vite 8 forwards browser console output | Good | Good via Vite | Excellent; Next also actively ships agent-oriented diagnostics |
| Server mutations/actions | Good via typed HTTP/RPC | **Excellent** | **Excellent** | **Excellent** |
| SSR/initial streaming | Manual/optional | **Excellent** | **Excellent** | **Excellent** |
| RSC | No, by default | Experimental/optional | **Core strength** | **Core strength** |
| Static frozen artifact | **Excellent** | Medium–good | Good for compatible routes | Medium |
| Arbitrary npm/server compatibility | **Excellent** | Good | Good | Good |
| Multi-artifact worker isolation | **Straightforward** | Straightforward | Straightforward | Heavier workers |
| Foreign-app architectural fit | **Excellent** | Separate subsystem | Separate subsystem | Separate subsystem |
| Framework lock-in | **Lowest** | Medium | Medium | Highest |
| Oct. 2026 maturity of chosen surface | **Stable** | RC | 1.0 RC / RSC ecosystem still mixed | Stable but extremely fast-moving |
| Core license | MIT. citeturn16search0 | MIT. citeturn16search2 | Waku MIT | MIT. citeturn16search1 |
| **Overall for this product** | **First** | **Second** | **Third / experimental** | **Supported adapter, not substrate** |

The resulting technology baseline I would freeze for the first production architecture is therefore:

**React 19.3** as the authoring runtime, current since September 9, 2026. citeturn15search3

**Vite 8.x**, currently 8.3.4 in the repository, with the toolkit pinning an exact tested patch and upgrading centrally rather than letting every artifact choose its own dev-server version. citeturn16search28

**Node 24 LTS** as the private sidecar runtime. Do not require users to install Node globally; ship the runtime as part of the toolkit distribution. citeturn2search3turn15search16

**Hono 4.x**, currently 4.13.13, for the small internal Web-standard server/gateway surfaces where a framework is useful. citeturn16search19

**pnpm-compatible content-addressed dependency storage**, with exact per-artifact lock snapshots and offline/frozen installs. Do not include or depend on the PolyForm-Shield-licensed `pnpr` subsystem unless deliberately approved. citeturn18search0turn18search8

**Process-per-active-artifact execution**, with lazy startup and idle eviction rather than a shared VM. Frozen browser-only versions require no worker.

**One reverse-proxy gateway with distinct artifact origins**, behind a pluggable addressing provider so localhost and wildcard-tunnel deployment can use different mappings without changing artifacts.

**Native foreign development servers**, proxied with full HTTP/WebSocket passthrough. Browser bundlers are optional utilities, not the general execution layer.

**xterm.js + a PTY boundary** for terminals, with node-pty isolated behind its own package/process because its currently active 1.2 line remains prerelease and continues to receive native-platform fixes. citeturn21search0turn21search1turn21search2

**Content-addressed immutable publication plus `view_instance`/`rendered_revision` submission binding**, making it possible to prove which exact code/dependency revision a human saw before supplying an answer or triggering an action.

The strongest argument for this architecture is that it leaves almost every future door open. TanStack Start can be an artifact type. Waku can be an artifact type. Next.js can be an artifact type. A hand-built React SPA can be an artifact type. A Svelte or Rust/WASM dev server can be displayed as a foreign app. A terminal is simply another proxied interactive surface. The Rust host can own storage or the standalone runtime can provide it. Frozen static artifacts can outlive the toolkit itself.

The inverse is not true: making Next, RSC, TanStack Start, Bun compilation, WebContainers, or any other full-stack execution model the foundational artifact contract would require the rest of the platform to inherit its routing, dependency, rendering, packaging or licensing assumptions.

**Final ranking:** build the platform around **Vite + ordinary React + a small Node sidecar and explicit protocol boundaries**; offer **TanStack Start** as the first full-stack adapter; keep **Waku/RSC** as an opt-in advanced architecture until the post-React-19 RSC tooling and security surface have had more time to converge. The recommendation should be revisited if full-stack SSR/RSC becomes the dominant artifact workload, if TanStack Start reaches stable v1 with a sustained operational track record, or if actual multi-artifact benchmarks—not synthetic runtime benchmarks—show that Node worker memory/startup costs dominate user experience strongly enough to justify a Bun/Deno or pooled-worker transition.