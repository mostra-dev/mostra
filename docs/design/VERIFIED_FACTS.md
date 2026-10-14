# Verified facts

**Status:** Working record for the SP-58-C03-A phase design. Every row is an **observation** in the sense of [STANDARDS.md](STANDARDS.md#decision-labels): a fact checked against the named primary source on the stated date. The design depends on these facts. Implementation work packages re-check versions before pinning.

**Checked:** 2026-10-10 unless a row says otherwise. "npm registry" means `npm view <pkg> version license dist-tags time` against registry.npmjs.org. "crates.io" means the crates.io API.

## Runtime and build

| Fact | Value | Source | Consequence for the design |
|---|---|---|---|
| Vite latest | 8.3.4 (MIT), modified 2026-10-08 | npm registry | Pin 8.3.x centrally (D18) |
| `@vitejs/plugin-react` | 6.1.2 (MIT) | npm registry | |
| `@vitejs/plugin-rsc` | 0.5.36, still 0.x (MIT) | npm registry | D19 trigger 1 not met |
| Rolldown | 1.2.13 (MIT) | npm registry | |
| React / React DOM | 19.3.0 (MIT) | npm registry | Target React 19.3 |
| Hono | 4.13.13 (MIT); `@hono/node-server` 2.1.4 | npm registry | |
| Waku | 1.0.0-rc.3, not final | npm registry | D19 trigger 1 not met |
| React Router | 8.4.0 (MIT) | npm registry | Candidate for multi-page routing |
| TanStack Start | 1.168.61 | npm registry | Adapter only (D18) |
| Node.js 24 | Active LTS since 2025-10-28; maintenance from **2026-10-20**; end 2028-04-30; latest 24.21.0 | github.com/nodejs/Release `schedule.json`; nodejs.org/dist/index.json | D18 pins 24 now |
| Node.js 26 | Current (26.11.1 on 2026-10-07); LTS from **2026-10-28**; end 2029-04-30 | same | D18 moves to 26 after 2026-10-28, which falls inside v1 implementation |
| Node.js 27 | Alpha 2026-10-28, release 2027-04-22 | same | Out of v1 |
| Local toolchain on Mirza's Mac | Node 24.12.0, npm 11.6.2, Rust 1.97.1, macOS 26.2 arm64, Safari 26.2 | `node -v`, `rustc --version`, `sw_vers` | Prototype baseline |

## Tooling baseline (STANDARDS defaults)

| Fact | Value | Source | Consequence |
|---|---|---|---|
| pnpm | `latest` is **12.10.1**; 11.x line at 11.28.5 under `next-11`; 12.0.0 published 2026-08-26 | npm registry dist-tags | STANDARDS default "pnpm 11, trial 12" is stale. Brief 6's own overturn condition ("move to 12 once it becomes npm `latest`") has fired |
| pnpm `pnpr/` | `pnpr/LICENSE.md` is **PolyForm Shield 1.0.0**; repository root `LICENSE` is MIT | raw.githubusercontent.com/pnpm/pnpm/main | D20 exclusion stands; the license audit must check it |
| Turborepo | 2.11.7 (MIT) | npm registry | |
| Changesets | `@changesets/cli` 3.0.3 | npm registry | |
| tsdown | 0.23.0 (MIT) | npm registry | |
| TypeScript | `latest` 7.0.2 (Apache-2.0) | npm registry | TS 7 as `tsc`; keep TS 6.0.x for API-consuming tools |
| Vitest | `latest` **5.0.3** (5.0.0 on 2026-09-03); 4.x at 4.1.11 | npm registry | "4.1.8 or later" satisfied; adopt 5.x |
| Playwright | 1.64.0 (Apache-2.0), 2026-10-10 | npm registry | Pin 1.64.x |
| axe-core | 4.14.0 (MPL-2.0); `@axe-core/playwright` 4.13.0 | npm registry | MPL-2.0 is OSI, file-level copyleft; fine as a dependency |
| Biome / Oxlint | 2.5.15 (MIT OR Apache-2.0) / 1.87.0 (MIT) | npm registry | |
| API Extractor | 7.59.4 | npm registry | |
| TypeSpec | `@typespec/compiler` and `@typespec/json-schema` 1.17.0 (MIT) | npm registry | Candidate schema source |
| typify (Rust) | 0.8.0 (Apache-2.0), 2026-10-05 | crates.io | Draft-7-centric per brief 6; constrain the schema subset |
| schemars | 1.2.2 (MIT) | crates.io | |
| tokio | 1.53.2 (MIT) | crates.io | |

## Kit libraries

| Fact | Value | Source | Consequence |
|---|---|---|---|
| shadcn CLI | 4.21.4 (MIT) | npm registry | |
| shadcn default base | "July 2026 - Base UI as the Default"; React Aria a first-class base (July 2026); Questionnaire component for Base UI, React Aria and Radix (August 2026); components import `cn` from the `cn` package (September 2026) | ui.shadcn.com/docs/changelog | D27 eval still decides Mostra's default; `cn` package joins the warm set |
| `@base-ui/react` | 1.9.0 (MIT), 2026-10-09 | npm registry | |
| `radix-ui` | 1.7.0 (MIT); `@radix-ui/react-slot` 1.4.0 | npm registry | |
| `react-aria-components` | 1.22.1 (Apache-2.0) | npm registry | Later plugin (D27) |
| Tailwind CSS | 4.3.3 (MIT) | npm registry | |
| Recharts / uPlot / ECharts | 3.10.1 (MIT) / 1.6.32 (MIT, last publish 2025-03) / 6.1.0 (Apache-2.0) | npm registry | uPlot is stable but quiet; wrap it once |
| TanStack Table | `latest` **9.2.8** (9.0.0 on 2026-08-04) | npm registry | New major since the research; most model training data is v8. Churn-table and lint entry needed |
| react-hook-form / Zod / resolvers | 7.89.0 / 4.6.5 / 5.9.1 (MIT) | npm registry | |
| Mermaid / xyflow / Excalidraw | 12.1.0 / 12.12.0 / 0.18.1 (MIT) | npm registry | |
| MapLibre / deck.gl | 6.13.0 (BSD-3-Clause) / 9.4.0 (MIT) | npm registry | |
| r3f / drei / three | 9.8.1 / 10.7.9 / 0.186.1 (MIT) | npm registry | |
| Shiki / CodeMirror / KaTeX | 4.5.0 / `@codemirror/view` 6.43.14 / 0.19.0 (MIT) | npm registry | |
| Motion | 14.1.0 (MIT) | npm registry | |
| MDX | `@mdx-js/mdx` and `@mdx-js/rollup` 3.1.1 (MIT) | npm registry | |
| GSAP | 3.15.0; npm license field "Standard 'no charge' license"; terms: Prohibited Uses cover no-code visual animation builders that compete with Webflow; Webflow may terminate at its discretion for non-compliance; FAQ: "AI-generated code is not a 'Prohibited Use'" | npm registry; gsap.com/community/standard-license | Plugin only, with license acknowledgment (D26, D31) |
| Remotion | 4.0.534; license "SEE LICENSE IN LICENSE.md"; free for individuals and companies of up to 3 people; Company License for 4+; Automators $0.01/render with $100/month minimum, covering "embedding the Remotion Player" | npm registry; remotion.dev/docs/license/pricing (updated 2026-10-09) | Plugin only, with license acknowledgment |
| Yjs | 13.6.33 (MIT) | npm registry | v1.x plugin |

## Terminal

| Fact | Value | Source | Consequence |
|---|---|---|---|
| xterm.js | `@xterm/xterm` 6.0.0 latest, 6.1.0-beta.304; addons webgl 0.19.0, unicode11 0.9.0, serialize 0.14.0, fit 0.11.0; `@xterm/headless` 6.0.0 (MIT) | npm registry | |
| node-pty | `latest` 1.1.0, `beta` 1.2.0-beta.15 (MIT) | npm registry | Pin 1.1.0 |
| asciinema-player | 3.17.0 (Apache-2.0) | npm registry | Fallback only |
| ghostty-web | 0.4.0 (MIT) | npm registry | Watch list |
| avt | 0.18.0 (Apache-2.0), 2026-05-05 | crates.io | Candidate headless emulator |
| vt100 | 0.16.2 (MIT) | crates.io | |
| ratatui | 0.30.2 (MIT) | crates.io | |
| Ratzilla | 0.3.1 (MIT OR Apache-2.0), 2026-06-08 | crates.io | WASM mode |
| portable-pty | 0.9.0 (MIT), 2025-02-11 | crates.io | |
| unicode-width | 0.2.2 | crates.io | Pin with the frame model's width table |
| asciicast v3 | NDJSON; header `version: 3`, required `term.cols`/`term.rows`, optional `term.type`, `term.version`, `term.theme {fg, bg, palette}`; events `[interval, code, data]` with codes `o`, `i`, `m`, `r` (`"COLSxROWS"`), `x`; interval is relative to the previous event; unknown codes and header keys MUST be ignored or passed through; MIME `application/x-asciicast` | docs.asciinema.org/manual/asciicast/v3 | Recording format (D28) |

## MCP

| Fact | Value | Source | Consequence |
|---|---|---|---|
| MCP current revision | **2026-07-28**; version carried per request in `_meta` key `io.modelcontextprotocol/protocolVersion` and the `MCP-Protocol-Version` header; optional `server/discover`; deprecated features stay at least 12 months | modelcontextprotocol.io/specification/versioning | Stateless local MCP server (D17, MC-01) |
| MCP TypeScript SDK | `@modelcontextprotocol/sdk` 1.32.1 (MIT); split v2 packages `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1 (Apache-2.0) | npm registry | Use the v2 server package |
| MCP conformance | `@modelcontextprotocol/conformance` 0.1.16 (MIT) | npm registry | Pattern for Mostra's conformance kit |
| Rust MCP SDK | `rmcp` 3.5.1 (Apache-2.0) | crates.io | Not needed by Mostra's Rust crate |
| MCP Apps spec | Stable revision `2026-01-26` plus `draft` in modelcontextprotocol/ext-apps. `ui://` resources, MIME `text/html;profile=mcp-app`, HTML5 document as `text` or base64 `blob`; restrictive default CSP when `ui.csp` is omitted; host MUST NOT allow undeclared domains; tool `visibility` defaults to `["model","app"]`, `["app"]` tools hidden from the model; web hosts wrap the view in a sandbox proxy on a different origin with `allow-scripts allow-same-origin`; JSON-RPC 2.0 over `postMessage` with `ui/initialize`, `ui/open-link`, `ui/message`, `ui/request-display-mode`, `ui/update-model-context`, `ui/notifications/tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`, `size-changed`, `host-context-changed`, `ui/resource-teardown`; standardized `--color-*` style variables | raw apps.mdx in ext-apps `specification/2026-01-26` | Bridge shape for SH-04 and MC-02 |
| MCP Apps SDK | `@modelcontextprotocol/ext-apps` 2.0.3 (MIT), 2.0.0 on 2026-09-08 | npm registry | |

## Remote viewing

| Fact | Value | Source | Consequence |
|---|---|---|---|
| Tailscale Serve | Tailnet-only HTTPS on `device-name.tailnet-name.ts.net` (names restricted to the tailnet domain); adds `Tailscale-User-Login`, `Tailscale-User-Name`, `Tailscale-User-Profile-Pic` (RFC 2047 encoding for non-ASCII), strips spoofed copies; no identity headers for tagged devices; includes users of shared devices; best practice is a backend listening on localhost only; optional `Tailscale-App-Capabilities` (v1.92+) | tailscale.com/kb/1312/serve (validated 2026-01-20) | One hostname per device: tunnel addressing cannot use per-artifact subdomains |
| Tailscale Funnel | Beta; public; **no identity headers**; listens only on ports **443, 8443, 10000**; TLS only; non-configurable bandwidth limits; needs MagicDNS, HTTPS and a `funnel` node attribute; a port is either Serve or Funnel | tailscale.com/kb/1223/funnel | At most three public origins per device |
| Cloudflare Quick Tunnels | `cloudflared tunnel --url http://localhost:PORT` gives a random `trycloudflare.com` hostname per process; no account; up to **200 in-flight requests** (then 429); **do not support Server-Sent Events**; optional `--allowed-mail` email one-time-PIN gate (interactive browsers only); no uptime guarantee | developers.cloudflare.com/.../trycloudflare (updated 2026-09-30) | D22's SSE downstream breaks behind a quick tunnel; the client transport needs a fallback or the share must avoid quick tunnels |
| Local tools | `tailscale` and `cloudflared` are not installed on Mirza's Mac | `which` | External share tests need installs (standing authorization covers tools) and accounts |

## Browser addressing and cookies (prototype evidence)

Prototype: `$JCODE_SCRATCH_DIR/proto-addressing` (disposable, not in the repository). A shell page on one origin embeds an iframe on an artifact origin. The iframe sets six cookie variants, then reads them back through `fetch`, `EventSource` and its own document navigation. Engines: Playwright 1.64.0 Chromium, Firefox and WebKit 27.2, plus real Safari 26.2 on macOS 26.2.

| Layout (shell → artifact iframe) | Chromium | Firefox | WebKit and real Safari 26.2 |
|---|---|---|---|
| `localhost:P` → `a1.localhost:P` (subdomain) | Iframe loads. Strict and Lax cookies **not sent**. `SameSite=None; Secure` and `Partitioned` cookies sent | Same as Chromium | Iframe loads (**`*.localhost` resolves**). **No cookie of any kind** is stored or sent |
| `shell.localhost:P` → `a1.localhost:P` | Same as above | Same | Same as above |
| `localhost:P` → `localhost:P+1` (port per artifact) | All six variants sent | All six sent | Strict and Lax sent; `Secure` variants refused over `http` |
| `127.0.0.1:P` → `127.0.0.1:P+1` | All sent | All sent | Strict and Lax sent (Playwright WebKit) |

Supporting observations:
- macOS 26.2's system resolver maps any `*.localhost` name to `127.0.0.1` and `::1` (`dscacheutil -q host -a name a1.localhost`). The premise behind D21's Safari fallback ("Safari doesn't resolve `*.localhost`") no longer holds on current macOS. Older macOS releases and iOS were not tested.
- `*.localhost` names count as separate **sites** (no public-suffix rule matches, so each name is its own registrable domain). An artifact iframe on `a1.localhost` under a shell on `localhost` is a third-party context.
- Different ports on one host are the **same site** with different origins: storage (`localStorage`) is per origin, cookies are shared per host.
- WebKit refuses cookies with the `Secure` attribute over `http://localhost`, so `__Host-` prefixes, `SameSite=None` and `Partitioned` are unavailable there without HTTPS.

**Consequence.** The ARCHITECTURE §11 item 4 mechanism (token exchanged for an `HttpOnly; SameSite=Strict` cookie scoped to the artifact origin) cannot authenticate an artifact iframe on a `*.localhost` subdomain in any engine, and no cookie can do it in Safari. It works only when the artifact origin is same-site with the shell (port per artifact). The decision record must change one of: the addressing default (D21) or the frame credential mechanism (D06 item 4). See the first decision round.

## Process and instance model (prototype evidence)

Prototype: `$JCODE_SCRATCH_DIR/proto-instance` (disposable). Node 24.12.0 on macOS 26.2. A supervisor acquires a home by binding a Unix socket in it; racing starters that find a live socket attach instead; a dead socket file is taken over only by the holder of an atomic `mkdir` mutex. Workers are `fork`ed children with an IPC heartbeat and `--max-old-space-size=64`.

| Check | Result |
|---|---|
| 16 starters race on a fresh home, three rounds | Exactly one supervisor each round; the rest attached |
| Racing `listen()` on the same socket path | Fails with `EEXIST` as well as `EADDRINUSE` on macOS. Acquisition must treat both as "socket exists" (the first run crashed one starter before this fix) |
| Supervisor SIGKILLed, leaving a stale socket file; five new starters | One took over, four attached |
| Socket path of 149 bytes | `listen EINVAL`. macOS limits `sun_path` to 104 bytes, so the socket can't always live inside an arbitrary home path |
| Worker throws | Exit code 1 reported; siblings unaffected |
| Worker allocates without bound | V8 heap limit abort (`SIGABRT`) reported; siblings unaffected |
| Worker spins in a busy loop | Heartbeat watchdog (1.5 s in the prototype) SIGKILLs it; siblings unaffected |
| Supervisor SIGKILLed with two workers | Both workers exited within 1 s through the IPC `disconnect` event |

Consequences for the design:
- The control socket lives in a short per-user runtime directory keyed by a hash of the home path (`$XDG_RUNTIME_DIR/mostra/` on Linux, `~/.mostra/run/` on macOS, mode 0700), with the home recording the path. Both directories survive the macOS three-day temp cleanup that would remove a socket under `/tmp` or `$TMPDIR`.
- The takeover mutex needs a staleness rule, so a starter that dies while holding it doesn't block the home forever.
- Workers exit with their supervisor, but processes that artifact code starts (foreign dev servers, PTY children) don't. Workers run in their own process group. The supervisor records every child process group with its start time and reaps leftovers on the next start of the home.
- A heartbeat watchdog can't tell a long synchronous computation from a hang, so the threshold is generous (10 s default), configurable per artifact, and the kill is reported with the reason.

## Terminal fidelity fixtures (prototype evidence)

Prototype: `$JCODE_SCRATCH_DIR/proto-term` (disposable). Nine byte-stream fixtures (box drawing and blocks, 256 colours, true colour with attributes, CJK and full-width, emoji including ZWJ, flags and VS16, combining marks, wrap with a wide character at the margin, cursor movement and erase, alternate screen) at 80×6, fed to avt 0.18.0 (Rust), `@xterm/headless` 6.0.0 with `@xterm/addon-unicode11` 0.9.0, and `@xterm/headless` with `@xterm/addon-unicode-graphemes` 0.4.0. Output compared cell by cell (grapheme, width, foreground, background, attributes) and by cursor position. `unicode-width` 0.2.2 (ratatui's width source) supplied a third opinion on widths.

| Fixture | avt vs xterm + unicode11 | Notes |
|---|---|---|
| box, color256, truecolor, cjk, wrap, cursor, altscreen | 0 cell differences, same cursor | |
| combining | 18 differences; avt cursor at column 20, xterm at 14 | avt stores one `char` per cell and gives each combining mark its own column, so text after accents shifts right. xterm attaches marks to the base cell, which is correct |
| emoji | 29 differences; cursor 46 vs 38 | Both split the ZWJ family into four wide emoji (8 columns); avt also spends a column per ZWJ |

Width opinions for the same strings:

| String | `unicode-width` 0.2.2 (ratatui) | xterm + unicode11 | xterm + graphemes (experimental) |
|---|---|---|---|
| 👍 | 2 | 2 | **1** (wrong) |
| 👨‍👩‍👧‍👦 (ZWJ family) | 2 | 8 (four wide emoji) | 2 |
| 🏳️‍🌈 | 2 | split | split, wrong |
| ⚠️ (VS16) | 2 | 1 | 2 |
| é as `e` + U+0301 | 1 | 1 | 1 |

Consequences for the design:
- **Headless emulator (resolves ARCHITECTURE §14 open item):** `@xterm/headless` with the Unicode 11 width table, the same engine and table as live xterm.js, so recorded frames and live sessions agree by construction. avt is rejected because of the combining-mark cursor drift. The graphemes addon is rejected while experimental and wrong on simple emoji.
- **Width table:** the frame model records `widthTable: "unicode11"`. The ratatui capture path takes widths from ratatui's own buffer, which is exact for that path.
- **Terminal lint** flags ZWJ sequences, flags and VS16 emoji, where TUI libraries and terminals disagree. That is where misaligned borders come from.
- `@xterm/headless` 6.0.0 imported cleanly as an ES module default import in Node 24.12; the broken `module` entry reported by a third party did not reproduce.

## Cross-site frames and the ledger engine

| Fact | Value | Source | Consequence |
|---|---|---|---|
| Public Suffix List entries | `trycloudflare.com` and `ts.net` are both PSL entries; `localhost` is not listed | publicsuffix.org list fetched 2026-10-10 | Each Cloudflare quick-tunnel hostname is its own site, so a shell tunnel embedding an artifact tunnel is **cross-site** and the D38 cookie session fails there. A tailnet device name (`host.<tailnet>.ts.net`) on different ports stays same-site, so Serve and Funnel keep the cookie session |
| Cookie-free frame session (prototype `proto-frame`) | Shell on `http://localhost:P` embedding `http://127.0.0.1:P+1` (cross-site). The frame loads `/_mostra/enter#t=<token>` and registers a service worker at scope `/` (needs response header `Service-Worker-Allowed: /`), which attaches `x-mostra-frame` to every same-origin request. HTML navigation, scripts, images and POSTs all arrived authenticated, and no request reached the server without the header. Passed in Playwright Chromium, Firefox and WebKit (3 runs each, including shell reload) and in real Safari 26.2 (load and reload) | prototype runs 2026-10-10 | Cross-site frames work without cookies in every engine |
| Streams through a service worker | Firefox stalls on infinite responses (EventSource or streamed `fetch`) passed through `respondWith`, deterministically after a reload. When the worker skips the stream path and the page opens it with a single-use ticket from an authenticated POST, EventSource and streamed `fetch` pass in all engines and real Safari, including reloads. One of four Firefox first loads timed out during worker installation (unexplained) | same | Event streams and WebSockets in worker mode use single-use tickets and bypass the worker. The worker install timeout is a WP test item |
| `node:sqlite` | Node 24.12: works, but emits "ExperimentalWarning: SQLite is an experimental feature"; docs (v24.x and main) mark it "Stability 1.2, Release candidate" | local run; nodejs/node docs | Not yet a dependency for the durable ledger |
| `better-sqlite3` 13.0.3 | MIT, `engines: node >=22`, prebuilt binary installed in about 6 s on macOS arm64, SQLite 3.53.4; WAL plus `synchronous=FULL`: 200 single-row commits in 105 ms, 1000 rows in one transaction in 4 ms | local run 2026-10-10 | The ledger engine for v1 (D71) |

## Publishing

| Fact | Value | Source | Consequence |
|---|---|---|---|
| npm trusted publishing | OIDC from GitHub-hosted runners (also GitLab.com, CircleCI); needs npm CLI ≥ 11.5.1 and Node ≥ 22.14.0; configured **per package** on npmjs.com (up to 10 publishers); a new configuration must complete its first publish within **2 days** or it expires; configurations created after 2026-09-03 allow only `npm stage publish` (2FA approval per release) unless direct `npm publish` is also allowed; provenance is automatic from public GitHub repositories; `package.json` `repository.url` must match the repository exactly; recommended package setting "Require two-factor authentication and disallow tokens" | docs.npmjs.com/trusted-publishers | Per-package setup on npmjs.com is Mirza's account action. Stage-only would need his 2FA approval on every release, which conflicts with D36's seamless publication |
| crates.io trusted publishing | Available for GitHub Actions through `rust-lang/crates-io-auth-action`, configured per crate on crates.io | forge.rust-lang.org/infra/docs/trusted-publishing.html; blog.rust-lang.org 2025-07-11 | **Hypothesis to verify in the release WP:** trusted publishing can only be configured for a crate that already exists, so each crate's first release needs a one-time API token created by Mirza |

## Kit components (observed in shadcn templates)

| Fact | Value | Source | Consequence |
|---|---|---|---|
| `shadcn init -t vite -b <radix\|base> -p nova` | Scaffolds Vite 8, React 19.3, Tailwind 4, TypeScript ~6.0.2; `add --all` installs 61 components; the Radix variant also depends on `@base-ui/react`; components import `cn` from `cn` | `shadcn@4.21.4`, run on 2026-10-10 | The base-evaluation templates |
| Base UI template defect | `scroll-area.tsx` in the Base UI variant fails `tsc -b` (unused `React` import, TS6133); the Radix variant is clean | same | Mostra's kit packs must type-check clean in CI for every base. The evaluation normalized this before any run |
| shadcn Questionnaire | `questionnaire.tsx` wraps `@shadcn/react/questionnaire` (`@shadcn/react` 0.3.1, MIT): a step-by-step `<form>` with items, choices (`checked`, `onChange`), inputs (`value`), progress, previous, next, skip and submit | template source and `.d.ts` | Mostra's questionnaire binds these controlled props to fields and adds ranking, scales, per-item comments, a recommended option and sections |
| Cross-base idiom (instrument check) | A Radix-style `asChild` in the Base UI variant, or a Base-UI-style `render` prop in the Radix variant, fails `tsc` with TS2322. `vite build`, rendering and clicking still succeed | evaluation control pages | `verify` must treat type errors as blocking and translate this TS2322 shape into a "wrong base" diagnostic with the right idiom as the fix |

## WP-01 re-verification (2026-10-10)

Checked by the WP-01 session on 2026-10-10 against the npm registry, crates.io, GitHub releases and the projects' own documentation. Pinned versions follow the 7-day minimum release age that pnpm and Renovate enforce (REPO_STANDARDS §10): the newest release published on or before 2026-10-03.

| Fact | Value | Source | Consequence |
|---|---|---|---|
| pnpm | `latest` 12.11.2 (2026-10-09); pinned **12.9.0** (2026-10-02) | npm registry `time` | `packageManager: pnpm@12.9.0` |
| pnpm supply-chain settings | `minimumReleaseAge` (minutes, default 1440 since v11), `minimumReleaseAgeStrict` (on when set explicitly), `trustPolicy: no-downgrade`, `blockExoticSubdeps` (default true), `strictDepBuilds` (default true), `allowBuilds` (replaces `onlyBuiltDependencies` since v11); `catalogMode` only affects `pnpm add` | pnpm.io docs, `docs/settings/*.md` on github.com/pnpm/pnpm.io main | Set in `pnpm-workspace.yaml`; catalog-only specifiers are enforced by `tools/repo-lint` |
| pnpm `pnpr` on npm | `@pnpm/pnpr` 0.0.0-26070301 "SEE LICENSE IN LICENSE.md" (PolyForm Shield 1.0.0) with platform packages `@pnpm/pnpr.<os>`; `@pnpm/pnpr.client` 3.1.3 is MIT; the `pnpm` 12.9.0 tarball contains no `pnpr` files | npm registry; `npm pack pnpm@12.9.0`; raw `pnpr/LICENSE.md` | The license audit rejects every `@pnpm/pnpr*` package and any shipped PolyForm text |
| TypeScript 7 | `latest` 7.0.2 (2026-07-08); exports only `./lib/version.cjs` and `./unstable/*`; `bin/tsc` supports `-b` and `--lsp`; latest 6.x is 6.0.3 | npm registry; package manifest; `tsc --help` | `tsc -b` on TS 7; a `ts6` catalog for compiler-API tools |
| API Extractor | 7.59.4 latest, 7.59.3 pinned; depends on `typescript` **5.9.3** exactly and always analyzes with it; `typescriptCompilerFolder` only supplies system typings | npm registry; `lib-dts/api/Extractor.d.ts` | REPO_STANDARDS §4's "TypeScript 6 only for API Extractor" is imprecise: API Extractor brings its own engine; TS 6 serves its typings, typescript-eslint and dependency-cruiser |
| typescript-eslint | 8.71.1 latest, 8.71.0 pinned; peer `typescript >=4.8.4 <6.1.0` | npm registry | Runs from `tools/ts6` against TS 6.0.3 |
| dependency-cruiser | 18.5.0 (MIT); parses TypeScript only with `typescript >=2 <7`, resolved from its own location | npm registry; `src/utl/try-import.mjs`, run output | `packageExtensions` declares the peer so pnpm hands it TS 6 instead of the hoisted TS 7 |
| knip | 6.41.0 latest, 6.39.0 pinned (ISC); parses with `oxc-parser`, no TS compiler API | npm registry | Runs on the TS 7 tree |
| are-the-types-wrong | `@arethetypeswrong/cli` 0.18.5; its core bundles `typescript` 5.6.1-rc | npm registry | Independent of the repo's TypeScript |
| Turborepo, Changesets, tsdown | turbo 2.11.7; `@changesets/cli` 3.0.3 (config schema 4.0.1), changelog-github 1.0.1; tsdown 0.23.1 latest, 0.23.0 pinned (rolldown 1.2.12) | npm registry | |
| Vitest, Playwright | vitest 5.0.3; `@playwright/test` 1.64.0 latest (2026-10-07), **1.63.0 pinned** | npm registry | VERIFIED_FACTS' "pin 1.64.x" waits for the cooldown; Renovate proposes it after 2026-10-14 |
| Biome, ESLint | Biome 2.5.15 (`linter.rules.recommended` is deprecated for `preset`); eslint 10.12.0; eslint-plugin-react-hooks 7.1.1 (peer eslint ≤10) | npm registry; `biome migrate` | |
| publint, size-limit, lefthook | publint 0.3.25; size-limit 14.2.0 latest, 14.1.0 pinned (needs `size-limit` and its plugin in the measured package's own dependencies); lefthook 2.2.1 latest, 2.1.16 pinned | npm registry; run output | |
| Zod | 4.6.5: `z.toJSONSchema` targets `draft-2020-12` and `draft-07`, `io: "input"` leaves objects open (no `additionalProperties: false`), private registries, `exactOptional()`, `templateLiteral` | npm registry; local probe | Wire schemas are emitted in input mode, so receivers accept unknown fields |
| Node.js 24.12.0 | Runs `.ts` files directly (type stripping, no warning); `import.meta.main` is available | local run | Repository tools are TypeScript run by Node, with no build step |
| Rust tools | cargo-deny 0.20.2 (2026-07-09); cargo-nextest 0.9.148 (2026-10-08), **0.9.146 pinned**; Rust 1.97.1 | crates.io API; Homebrew | `rust-toolchain.toml` pins 1.97.1 |
| GitHub Actions pins | actions/checkout v7.0.1 `3d3c42e5`, setup-node v7.0.0 `82076278`, pnpm/action-setup v6.1.0 `ea17c68d`, cache v5.1.0 `caa29612`, Swatinem/rust-cache v2.9.2 `6323deb1`, taiki-e/install-action v2.87.22 `83ac0ad6`, dependency-review-action v5.0.0 `a1d282b3`, codeql-action v4.38.2 `2892aa5e`, scorecard-action v2.4.4 `2d114668`, upload-artifact v7.0.1 `043fb46d` | GitHub releases and tag objects | Full SHAs in the workflows; the repository requires SHA pinning |
| CodeQL | Supports GitHub Actions, JavaScript/TypeScript (TypeScript up to 7.0) and Rust (editions 2021 and 2024) | codeql.github.com supported languages | Three CodeQL languages in `codeql.yml` |
| Contributor Covenant | 3.0 is current | contributor-covenant.org; EthicalSource/contributor_covenant | `CODE_OF_CONDUCT.md` |
| GitHub-hosted runners | `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19 | run annotation, actions/runner-images#14748 | Watch the first runs after that date |

## WP-02 re-verification (2026-10-11)

Checked by the WP-02 session on 2026-10-11 against the npm registry, the package tarball, the Node.js 24 docs, the XDG Base Directory specification, the Linux man-pages source and local runs on macOS 26.2 arm64 (Node 24.12.0). Prototype: `$JCODE_SCRATCH_DIR/proto2` (disposable).

| Fact | Value | Source | Consequence |
|---|---|---|---|
| `better-sqlite3` | 13.0.3 (MIT), published 2026-08-05, still `latest`; `engines: node >=22`; one dependency, `node-addon-api` (MIT) | npm registry | Pinned 13.0.3, past the 7-day cooldown |
| `better-sqlite3` prebuilds | The tarball ships N-API prebuilds (`NAPI_VERSION=10`) for darwin, linux and linuxmusl on x64 and arm64 (and win32). `gypfile: false` and no `install` script, so installs run nothing and pnpm's `strictDepBuilds` needs no allowance. `lib/binding.js` loads `prebuilds/<platform>-<arch>.node`. SQLite 3.53.4 | `npm pack better-sqlite3@13.0.3`: `package.json`, `binding.gyp`, `lib/binding.js` | No build toolchain on user machines or in CI |
| `@types/better-sqlite3` | 9.6.0 (MIT), published 2026-08-01; depends only on `@types/node` | npm registry | Driver types, used only inside the `ledger` module |
| WAL with `locking_mode=EXCLUSIVE` | After `PRAGMA locking_mode=EXCLUSIVE`, `journal_mode=WAL` and a transaction, a second process gets `SQLITE_BUSY` at once (`timeout: 0`) for reads and writes. No `-shm` file is created. After `kill -9` of the holder, the next opener gets the lock and recovers the `-wal` | prototype runs | D81: the ledger lock is the home's ownership, released by the OS when the owner dies |
| better-sqlite3 and garbage collection | A `Database` object that becomes unreachable is closed by its finalizer, which releases the lock; the prototype lost its lock until it kept a reference | prototype run | The ledger keeps a strong reference for the supervisor's lifetime |
| `VACUUM INTO` | Works on an exclusive WAL connection. The output is a consistent snapshot, and SQLite fsyncs it when the source's `synchronous` is NORMAL or FULL | prototype run; sqlite.org/lang_vacuum.html | The pre-migration backup. The ledger file is never copied with `fs`, which would drop the lock |
| `PRAGMA max_page_count` | Lowering it below the needed size makes the next growing write fail with `SQLITE_FULL` | prototype run | Simulates a full disk in `MOSTRA_HOME_DISK_FULL` tests |
| Garbage file opened as a ledger | `SQLITE_NOTADB` on the first pragma | local run | `MOSTRA_HOME_LEDGER_UNREADABLE` |
| Node `child_process` `detached` | "On non-Windows platforms, if `options.detached` is set to `true`, the child process will be made the leader of a new process group and session" | nodejs/node v24.x `doc/api/child_process.md` | Every child leads its own process group, signalled with `process.kill(-pgid)` |
| Unix socket path limit | Node throws when the path exceeds `sizeof(sockaddr_un.sun_path)`: "Typical values are 107 bytes on Linux and 103 bytes on macOS" | nodejs/node v24.x `doc/api/net.md` | `MOSTRA_HOME_SOCKET_TOO_LONG` above those lengths (D82) |
| macOS process start time | `LC_ALL=C TZ=UTC ps -o pid=,pgid=,lstart=` prints e.g. `Sun Oct 11 04:24:33 2026` (second resolution, the `%c` format); `ps -A` over about 550 processes takes about 20 ms; `sysctl -n kern.boottime` prints `{ sec = 1790805851, usec = 365279 } …` | local runs; `man ps` | Start-time identity is the boot time plus `lstart` seconds on macOS |
| Linux process start time | `/proc/<pid>/stat` field (5) is `pgrp` and field (22) `starttime`, in clock ticks since boot. Field (2), `comm`, is parenthesised and may contain spaces and parentheses | man-pages `man5/proc_pid_stat.5` (kernel.org git) | Parse the fields after the last `)`; identity is `/proc/sys/kernel/random/boot_id` plus `starttime` |
| `$XDG_RUNTIME_DIR` | "The directory MUST be owned by the user, and they MUST be the only one having read and write access to it"; when it is unset, "applications should fall back to a replacement directory with similar capabilities and print a warning message" | specifications.freedesktop.org/basedir-spec/latest | D82's ownership and 0700 check, and its fallback |
| `$XDG_RUNTIME_DIR` on GitHub runners | Set system-wide to `/run/user/1001`, with reports of it pointing at a missing or inaccessible directory | actions/runner-images issues 13401 and 14649 | The fallback must work on the Linux CI leg |
| Removing an open ledger | With `locking_mode=EXCLUSIVE` in WAL mode, deleting `ledger.sqlite` and its `-wal` while the database is open doesn't make writes fail: SQLite 3.53.4 kept committing into the unlinked files (no `SQLITE_READONLY_DBMOVED`), so those writes would be lost | `packages/runtime/test/unit/ledger.test.ts` (red before the fix) | `Ledger.write` checks the file's identity before and after each transaction and fails closed with `MOSTRA_HOME_GONE` |
| Node `net.Server.close()` on a Unix socket | Removes the socket file, even when another server has since bound a new socket at that path | `packages/runtime/test/integration/instance.test.ts` (the re-created socket vanished until the old listener was closed first) | The supervisor closes a lost listener before binding its replacement |
| Concurrent starters building a ledger | Without a guard, a starter that cleaned up `*.creating` files removed another starter's file in progress (`ENOENT`, about one round in six of 16 starters) | disposable race script (16 `mostra-runtime daemon` processes per round), 2026-10-11 | Only files whose creating PID is gone are removed; 15 further rounds of 16 starters converged |

## WP-03 re-verification (2026-10-11)

Checked by the WP-03 session on 2026-10-11 against the npm registry (`time`, `license`, `scripts`, `engines` of each version), the Node.js v24.x docs and local runs on macOS 26.2 arm64 (Node 24.12.0). Pins follow the 7-day minimum release age: the newest release published on or before 2026-10-04. Prototype: `$JCODE_SCRATCH_DIR/proto3` (disposable).

| Fact | Value | Source | Consequence |
|---|---|---|---|
| Vite | `latest` 8.3.4 (2026-10-08); pinned **8.3.2** (2026-10-01), MIT, no install scripts; depends on `rolldown ~1.2.11`, `lightningcss` (MPL-2.0), `picomatch`, `postcss`, `tinyglobby`; Node `^20.19.0` or `>=22.12.0`; `build.rollupOptions` is deprecated for `build.rolldownOptions`, and `envFile` for `envDir: false` | npm registry; `dist/node/index.d.ts`; prototype run | The builder child's bundler (D18), configured with Vite 8's option names |
| `@vitejs/plugin-react` | `latest` 6.1.2 (2026-10-05); pinned **6.1.1** (2026-08-28), MIT | npm registry | JSX through Vite 8's Oxc transform |
| React, React DOM, their types | 19.3.0 (2026-09-09), MIT | npm registry | Warm set (`@mostra/warm`, D91) and `@mostra/react`'s peer |
| React Router | 8.4.0 (2026-09-15), MIT, Node 22.22 or later | npm registry | `pages/` routes (D57) |
| MDX | `@mdx-js/mdx` and `@mdx-js/rollup` 3.1.1 (2025-08-29), MIT; `remark-frontmatter` 5.0.0 and `remark-gfm` 4.0.1, MIT. `@mdx-js/rollup` declares `rollup` as a peer, which pnpm installs in full | npm registry; `pnpm install` | The builder compiles MDX with `@mdx-js/mdx` in its own small Vite plugin, so no second bundler is installed; frontmatter is the manifest (D51) |
| Tailwind CSS | `tailwindcss` and `@tailwindcss/vite` 4.3.3 (2026-07-16), MIT; `@tailwindcss/oxide` native, no install scripts; `tailwindcss` exports `.` with a `style` condition pointing at `index.css` | npm registry; package manifest | `@import "tailwindcss"` resolves only where `tailwindcss` sits in a `node_modules` above the CSS file (prototype: a CSS file in a directory without one fails in `enhanced-resolve`), so each build gets a `node_modules` link to the warm set |
| Build with no `package.json` | A Vite 8 build whose root has `node_modules` linked to a directory holding only `react`, `react-dom`, `react-router` and `tailwindcss`, with an artifact copied beside it (no `package.json`), `configFile: false` and a virtual entry module, builds a TSX page with Tailwind classes in about 1.5 s, with one copy of React in the output | prototype run | The builder's staging layout (D91) |
| `oxc-parser` | `latest` 0.153.0 (2026-10-05); pinned **0.152.0** (2026-09-29), MIT, N-API prebuilds as optional dependencies, no install scripts | npm registry | Static manifest extraction in the supervisor (D51): parsing, never executing |
| `ignore` | 7.0.12 (2026-10-02), MIT, no dependencies | npm registry | `.mostraignore` follows gitignore rules (DATA_MODEL §2) |
| `yaml` | 2.9.1 (2026-09-11), ISC | npm registry (already in the catalog) | MDX frontmatter |
| Playwright | `playwright` 1.63.0 pinned (1.64.0 waits for the cooldown), Apache-2.0 | npm registry | Browser render checks of built versions (AU-01, AU-02) |
| `node:zlib` zstd | `zstdCompressSync` and `zstdDecompressSync`, added in v23.8.0, "Stability: 1 - Experimental" in the v24.x docs; they write standard zstd frames and printed no warning on 24.12.0 | nodejs/node v24.x `doc/api/zlib.md`; local run | Source snapshots are `.tar.zst` (DATA_MODEL §1). The file format is the zstd standard, so replacing the API later changes no stored snapshot |
| `module.registerHooks` | Synchronous in-thread hooks for `import` and `require`, added in v23.5.0 and v22.15.0, release candidate since v24.13.1 | nodejs/node v24.x `doc/api/module.md` | Used only by the RT-02 process-audit test, to record every module the supervisor loads |

## WP-04 re-verification (2026-10-13)

Checked by the WP-04 session on 2026-10-13 against the npm registry (`time`, `license`, `scripts`, `dist-tags` of each version), the published tarballs, the pnpm repository at its release tags (GitHub API: `Cargo.toml`, `Cargo.lock`, crate manifests, `pnpr/LICENSE.md`, pull request #12082) and local runs on macOS 26.2 arm64 (Node 24.12.0). Pins follow the 7-day minimum release age: the newest release published on or before 2026-10-06. Prototypes: `$JCODE_SCRATCH_DIR/wp04/proto` (disposable).

| Fact | Value | Source | Consequence |
|---|---|---|---|
| pnpm 12 packaging | `pnpm` 12.9.0 (MIT) is a wrapper whose `preinstall` and `postinstall` link a native binary from `@pnpm/exe.<platform>` (MIT, 45 MB, built from Rust); `dist/wasm/pnpm.wasm` serves WebContainers | `npm pack pnpm@12.9.0`, `npm pack @pnpm/exe.darwin-arm64@12.9.0` | The repository's pnpm is a native program, not a JavaScript bundle |
| pnpm 12 links pnpr code | The binary crate `pnpm-cli` (`pnpm/crates/cli`, `[[bin]] pnpm`) depends on `pnpm-config`, whose normal `[dependencies]` include `pnpr-registry`. That crate and its dependencies `pnpr-package-name` and `pnpr-error` live in `pnpr/crates/` with `license-file = "../../LICENSE.md"`, which is PolyForm Shield 1.0.0. The same holds at v12.10.1 and v12.13.0; v12.0.0's `pnpm-config` had no pnpr dependency. The binary's strings include the pnpr client protocol (`/-/pnpr/v0/resolve`) | `Cargo.toml` and `Cargo.lock` at `v12.9.0`; `pnpm/crates/config/Cargo.toml`, `pnpr/crates/{registry,package-name}/Cargo.toml` and `pnpr/LICENSE.md` at tags `v12.0.0`, `v12.9.0`, `v12.10.1`, `v12.13.0` | D94: Mostra's installer can't be pnpm 12; the license audit refuses `@pnpm/exe.*` and `pnpm` 11 or later. WP-01's "the pnpm 12.9.0 tarball contains no pnpr files" holds for the wrapper only |
| pnpm 11 bundles pnpr/client | `pnpm` 11.28.5 (2026-10-06, MIT) is a JavaScript bundle (`dist/pnpm.mjs`, no install scripts) that contains `pnpr/client/lib/*` (`@pnpm/pnpr.client`, declared MIT, inside the `pnpr/` directory). PR #12082 (2026-05-30) relicensed "the pnpr/ directory" under Shield while stating that clients stay MIT; the README says "MIT, except the `pnpr/` directory" | `npm pack pnpm@11.28.5`; `pnpr/client/package.json` at `v11.28.5`; github.com/pnpm/pnpm/pull/12082; README at `v11.28.5` | Ambiguous licensing, so avoided (D94) |
| pnpm 10 | `pnpm` 10.34.6 (2026-09-28), MIT, a JavaScript bundle (`dist/pnpm.cjs`) with no install scripts and no `pnpr` strings; `latest-10` dist-tag; 10.34.7 on 2026-10-12 | `npm view`, `npm pack pnpm@10.34.6`, `grep -c pnpr` | The install child's pnpm (D94), pinned in the catalog |
| pnpm 10: peers through `link:` | A project whose `package.json` links `react` as `link:warm/react` (a `warm` symlink to the warm set's `node_modules`) resolves an installed package's `react` peer to that link: `.pnpm/<pkg>/node_modules/react` points through `warm` to the warm set's real React. The lockfile records `link:warm/react` and peer suffixes `react@warm+react`, so it holds no machine paths | prototype runs, `pnpm-lock.yaml`, `realpath` | D95's single React by construction |
| pnpm 10: offline | `install --frozen-lockfile --offline` in a fresh project with the same `package.json` and lockfile links from the store with no network (2.3 s); a package missing from the store gives `ERR_PNPM_NO_OFFLINE_META` (metadata) or `ERR_PNPM_NO_OFFLINE_TARBALL` (files) after about 1.2 s of start-up | prototype runs | DP-04's one-second bound can't wait for pnpm: the supervisor answers from its store index first |
| pnpm 10: error codes | A missing package is `ERR_PNPM_FETCH_404`; no matching version `ERR_PNPM_NO_MATCHING_VERSION`; a failing lifecycle script `ELIFECYCLE` (its output in `pnpm:lifecycle` records); a refused connection or an unknown host `ERR_PNPM_META_FETCH_FAIL` with `ECONNREFUSED` or `ENOTFOUND` in the message. All arrive in the `--reporter=ndjson` stream with `level: "error"` | prototype runs against a local registry | The installer's mapping to the DEP codes |
| pnpm 10: lifecycle scripts | With `--config.dangerously-allow-all-builds=true` a dependency's `postinstall` runs with its package directory as cwd, `INIT_CWD` set to the project (`--dir`), and the environment pnpm itself got plus `npm_*` variables; a variable absent from pnpm's environment is absent from the script's | prototype (`record.cjs` writing its pid, ppid, cwd and environment) | DP-05 holds when the install child gets only the artifact environment |
| pnpm 10: release age | `minimumReleaseAge` applies to exact versions too (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`, or `ERR_PNPM_NO_MATCHING_VERSION` when a range has only immature matches). `minimumReleaseAgeExclude` takes effect only from the project's `pnpm-workspace.yaml`, not from `--config.minimum-release-age-exclude`, `.npmrc` or `name@version` patterns, and that file is ignored under `--ignore-workspace`. A frozen install checks the age of locked versions again | prototype runs (`mra.sh`, `mra2.sh`) | Each install project carries its own `pnpm-workspace.yaml`: age 1440 with exact names exempt for resolutions, 0 for frozen installs. Being its own workspace root also stops pnpm's search for a workspace above the home |
| pnpm 10: option forms | `--state-dir` isn't an option of `add` or `install` (`Unknown option: 'state-dir'`); `--config.state-dir=…`, `--config.store-dir=…` and `--config.cache-dir=…` are accepted | run output | The installer passes every setting as `--config.<name>=…` |
| `semver` | 7.8.5 (2026-06-19), ISC, no dependencies; `@types/semver` 7.8.0 (MIT) | npm registry | Spec checks in `deps/add` |
| Warm set additions | `cn` 0.4.0, `lucide-react` 1.52.0 (ISC), `radix-ui` 1.7.0, `@base-ui/react` 1.8.0, `cmdk` 1.1.1, `vaul` 1.1.2, `sonner` 2.0.8, `embla-carousel-react` 8.6.0, `react-day-picker` 10.0.2, `react-resizable-panels` 4.14.2, `input-otp` 1.5.0, `recharts` 3.10.1, `uplot` 1.6.32, `echarts` 6.1.0 (Apache-2.0), `@tanstack/react-table` 9.2.6, `react-hook-form` 7.89.0, `@hookform/resolvers` 5.9.1, `zod` 4.6.5, `motion` 14.0.0, `mermaid` 12.1.0, `@xyflow/react` 12.12.0, `shiki` 4.5.0, `codemirror` 6.0.2 with `@codemirror/state` 6.7.6, `view` 6.43.13, `commands` 6.11.1, `language` 6.12.4 and `lang-javascript` 6.2.5, `lang-json` 6.0.2, `lang-markdown` 6.5.2, `lang-css` 6.3.1, `lang-html` 6.4.12, `lang-python` 6.2.1, `katex` 0.19.0, `@xterm/xterm` 6.0.0 with `addon-fit` 0.11.0, `addon-webgl` 0.19.0, `addon-unicode11` 0.9.0. All MIT unless noted, none with install scripts, and every React-based one takes React as a peer | npm registry | ROUND-3 §1.2 and D72's warm set in `@mostra/warm`. `@base-ui/react` is 1.8.0, not the 1.9.0 seen on 2026-10-10, because of the cooldown |
| Mermaid's licenses | `mermaid` 12.1.0 depends on `elkjs` 0.9.3 (EPL-2.0, OSI-approved, file-level weak copyleft) and `khroma` 2.1.0, whose manifest has no `license` field and whose `license` file is the MIT text; it also brings its own `katex` 0.16 | installed packages; `npm view khroma@2.1.0` | The license audit accepts EPL-2.0 like MPL-2.0 and records khroma 2.1.0's verified MIT license |
