# Faithful TUI and Web Demos for an Agent Artifact Toolkit: Architecture Recommendation (October 2026)

Build every terminal mode around one normalized cell-grid frame model (`TermFrame`). Produce it with a headless VT emulator. Render it with your own React cell renderer for static, recorded and WASM-snapshot content, and use xterm.js 6 (WebGL) only for live, interactive PTY sessions. Ratzilla is a first-class but optional path for Rust/ratatui apps, and ghostty-web/wterm stay on a watch list. The core insight: "exact fidelity" is decided by the *emulator* (escape-sequence semantics, Unicode width) plus the *font/grid renderer*. If you own the renderer and pin the emulator, every mode can be pixel-identical and agent-verifiable through text/cell dumps.

## TL;DR

- **Recommended stack:**
  - **Live mode:** xterm.js 6.0.0 + WebGL addon over a Rust `portable-pty` (or node-pty 1.1.0) bridge. The bridge must be locked down: loopback-only, a per-session token, and Host and Origin checks.
  - **Recorded mode:** asciicast v3 as the interchange format, replayed through a headless emulator (avt or @xterm/headless) into `TermFrame` sequences and drawn by your own `<TerminalGrid>`. asciinema-player 3.17.0 (Apache-2.0) is the fallback.
  - **WASM mode:** Ratzilla 0.3.1 for ratatui. Bubble Tea, Textual and Ink have no mature in-browser path and should run through the live PTY instead.
- **What is mature:**
  - **Mature:** xterm.js (6.0.0, Dec 22 2025), asciinema-player (3.17.0, Jun 30 2026), Ratzilla (0.3.1, Jun 8 2026, ~68k downloads/month).
  - **Promising but young:** libghostty-vt-based terminals. ghostty-web (MIT, npm 0.4.0, still patches Ghostty) and Vercel's wterm (Apache-2.0, labelled a "Vercel Labs Experiment").\[1\]
  - **Effectively unmaintained:** webatui (0.1.1, Feb 2024, LGPL-2.1, ratatui 0.25).
- **Fidelity is a renderer problem, not a transport problem.** Ship one font, draw box-drawing and block glyphs procedurally, pin a single Unicode-width table, and give the agent three verification channels: plain-text dumps, JSON cell dumps, and headless Playwright screenshots. The agent then verifies TUI output without browser vision, and the human sees exactly what the agent checked.

## Key Findings

### Verified facts (primary sources, checked Oct 2026)

| Component | Latest version / date | License | Maintenance signal | Notes |
|---|---|---|---|---|
| **xterm.js** (@xterm/xterm) | 6.0.0, Dec 22 2025. 6.1.0 exists only as betas (e.g. 6.1.0-beta.304)\[2\]\[3\] | MIT | Microsoft/VS Code team (Tyriar); continuous betas through mid-2026 | 6.0 removed the canvas renderer ("this addon no longer exists and we recommend using either the DOM renderer or WebGL"). Added DEC 2026 synchronized output, OSC 52, shadow-DOM WebGL and the progress addon. Breaking: viewport/scrollbar rewrite, alt→ctrl+arrow hack removed, `windowsMode`/`fastScrollModifier` removed.\[4\] |
| @xterm/addon-webgl | 0.19.0 (Dec 22 2025); 0.20.0 beta\[5\] | MIT | same | Recommended renderer |
| @xterm/addon-unicode11 | 0.9.0 | MIT | same | Unicode 11 width tables |
| @xterm/addon-unicode-graphemes | 0.4.0 | MIT | marked "currently experimental and may introduce unexpected and non-standard behavior"\[6\] | Grapheme clustering; makes emoji such as ⚠️ ☑️ ▶️ take two cells\[7\] |
| @xterm/addon-image | 0.9.0; 0.10.0 beta | MIT | same | Stable: "Supports SIXEL and iTerm's inline image protocol (IIP)".\[8\] Kitty graphics only appears in the 0.10 beta line (secondhand report)\[9\] |
| @xterm/addon-serialize | 0.14.0 | MIT | README still says "experimental addon that is still under construction"\[10\] | Serializes to VT sequences or HTML. Open bug with headless 6.0.0\[11\] |
| @xterm/headless | 6.0.0 | MIT | README: "This package is experimental".\[12\] Third-party report of a broken `module` entry in the 6.0.0 tarball\[13\] | Node-side emulator with xterm.js semantics |
| **ghostty-web** (coder) | npm 0.4.0, released Dec 9 2025 per the coder/ghostty-web GitHub Releases page; ~2.9k stars | MIT | Users asking for a new npm release (issue #137, Mar 2026: "The last npm release was v0.4.0 on Dec 9, 2025"); several active forks (e.g. @xgent-ai/ghostty-web 0.5.2, Oct 6 2026, built on unpatched upstream libghostty-vt, ~830 KB WASM / ~280 KB gzipped) | xterm.js-compatible API. README: "builds from Ghostty's source with a patch". Claims better RTL/complex-script handling than xterm.js\[14\]\[15\] |
| **libghostty-vt** | untagged; upstream HEAD | MIT (Ghostty) | Described as alpha; Mitchell Hashimoto says prebuilt `ghostty-vt.wasm` now ships in Ghostty GitHub releases (tweet; not checked against the releases page)\[16\]\[17\] | Zero-dependency parser/state library. Claims faster IO/reflow than xterm.js using the same renderer (vendor benchmark)\[17\]\[18\] |
| **wterm** (vercel-labs) | 0.5.2 (GitHub release Sep 28 2026; PR #222: "Release all eight @wterm/* packages at 0.5.2"); 0.5.1 Sep 25 2026; ~3.3k stars, 24 open issues | Apache-2.0 | "Vercel Labs Experiment" | DOM renderer (native selection, find, a11y). Built-in Zig core is "a ~26 KB .wasm binary (release build)" per the current README (it was ~12 KB in v0.1.7). @wterm/ghostty is pinned to Ghostty v1.3.1 and had an unimplemented scrollback stub (issue #91, Jul 2026). Has @wterm/react |
| **Ratzilla** | 0.3.1 (Jun 8 2026); 0.3.0 (Jan 23 2026)\[19\] | MIT/Apache-2.0 | Owners Orhun Parmaksız, Adrian Papari (junkdog), ratatui org; ~68k downloads/month\[19\] | ratatui 0.30.1. Backends: WebGL2 (via beamterm, "typically under 1ms CPU time per frame"), Canvas, DOM. 0.3.1 added grid-coordinate mouse events and dynamic font atlas\[19\]\[20\]\[21\] |
| beamterm | 1.0.0 (Mar 30 2026)\[22\] | MIT/Apache-2.0 (assumed from Ratzilla family; check) | junkdog | GPU terminal *renderer* (not an emulator) for WebGL2/OpenGL 3.3\[22\] |
| **webatui** | 0.1.1 (Feb 26 2024) | **LGPL-2.1** | stale (ratatui 0.25, yew 0.21) | "not a fully interactive terminal yet… cursor location, editing text, etc, are not supported"\[23\]\[24\] |
| **textual-serve** | 1.1.3 (Nov 1 2025)\[25\] | MIT | Textualize; slow cadence | Spawns the Textual app in a subprocess and talks to it over WebSocket. Self-hosted equivalent of textual-web\[25\]\[26\] |
| textual-web | 0.7.0 (Feb 20 2024)\[27\] | MIT | "public beta", stale\[28\] | Publishes through Textualize's relay at a public URL; not local-first\[28\] |
| **Bubble Tea → WASM** | no official support; PR #1790 proposes GOOS=js stubs | MIT | community shims: bubbweb (+ v2 fork), bubbletea-in-wasm | "Stock Bubble Tea v2 doesn't build for js/wasm" (missing `listenForResize`, `initInput`, suspend functions)\[29\]\[30\]\[31\]\[32\] |
| **node-pty** | 1.1.0 latest; 1.2.0-beta.15 (Aug 3 2026) | MIT | Microsoft; publisher switched to `microsoft1es` | Native addon (node-gyp); conpty on Windows\[33\]\[34\]\[35\] |
| **portable-pty** | 0.9.0 (Feb 11 2025)\[36\] | MIT (wezterm) | Lives in wezterm monorepo; infrequent releases; patched forks exist\[37\]\[38\] | Runtime-selectable trait-object PTY;\[39\] sync I/O (wrap in threads/tokio) |
| **ttyd** | 1.7.7 | MIT | slow cadence | xterm.js front end. `-O/--check-origin`, `-i` bind, `-c` basic auth, read-only by default (`-W` to write)\[40\]\[41\]\[42\] |
| **asciinema-player** | 3.17.0 (Jun 30 2026); 3.16.0 (Jun 18 2026)\[43\] | Apache-2.0 | Healthy (Snyk); ~109k weekly downloads\[43\] | JS + Rust/WASM (avt). 3.16 added bundled TypeScript types, keystroke overlay, `cursorMode`, error events\[44\]\[45\] |
| **asciicast v3** | asciinema CLI 3.0.0 (Sep 15 2025); CLI 3.2.0 (Mar 2026)\[46\]\[47\] | spec in docs; CLI GPL-3.0 | active | NDJSON; header with `term:{cols,rows,type,theme}`. Events use *intervals* (deltas): `o`, `i`, `m` (marker), `r` (resize), `x` (exit). `#` comments allowed. Not backward compatible with v2\[48\]\[49\]\[50\] |
| **avt** | 0.17.0 | Apache-2.0 | asciinema; used by CLI, player, server, agg | Parser + virtual buffers only; "input handling, rendering" out of scope\[51\]\[52\]\[53\] |
| **vt100** (doy) | 0.16.2 | (check crate) | Forks by Atuin and others | `contents_formatted`, `contents_diff`, per-cell fg/bg\[54\]\[55\]\[56\] |
| **VHS** | 0.12.1 (Sep 2026); 0.11.0 (Mar 10 2026)\[57\]\[58\] | MIT | Charm; active PR queue | Drives ttyd + xterm.js through go-rod (headless Chrome) and encodes with ffmpeg. Outputs GIF/MP4/WebM/frames. 0.11 added scroll commands and Ctrl+arrows\[59\]\[60\]\[61\]\[62\]\[63\] |

### Judgment (my assessment, not vendor claims)

1. **xterm.js remains the only production-grade choice for live interactive terminals in Oct 2026.** ghostty-web and wterm have better emulation cores on paper, but their packaging is still in flux. ghostty-web's npm release is stale and carries a patch, the active forks are only days old, and @wterm/ghostty pins an old Ghostty with known stubs.\[64\]\[65\]\[66\]\[67\] Neither is safe to standardize on yet, but both are worth tracking because of their xterm.js-compatible APIs.
2. **Do not use a third-party player as your recorded-mode renderer.** asciinema-player is excellent, but its rendering is a black box: you can't pin comments to cells, diff frames, or sync two players at cell granularity. Use asciicast v3 as the *file format*, and render through your own grid.
3. **Ratzilla is the right WASM path for ratatui, but it's a port, not a capture.** The app must swap crossterm for Ratzilla's backend and give up `std::fs`, threads and blocking network calls. It's ideal for "the demo *is* the TUI" artifacts. It can't show an arbitrary existing binary; use the PTY for that.

## Details

### 1. ratatui → web (WASM mode)

**Ratzilla (recommended).**
- **Setup:** Ratzilla replaces ratatui's terminal backend with WebGL2Backend, CanvasBackend or DomBackend. Builds use `trunk build --release`, and the app's draw loop becomes `terminal.draw_web(...)`.\[68\]\[69\]
- **Input:** keyboard and mouse events arrive as Ratzilla `KeyEvent`/`MouseEvent`, now with grid coordinates as of 0.3.1. Input is delivered through callbacks (`on_key_event`/`on_mouse_event`), not crossterm's `event::read()`.\[20\]\[70\]
- **Fidelity:**
  - Ratzilla consumes ratatui's `Buffer` directly. Cell content, style and width (via `unicode-width` 0.2.2) are exact by construction, and no VT parsing step can drift.\[19\]\[71\]
  - The WebGL2 backend uses a font atlas. A user report on 0.3.1 says "Emoji now render at full width".\[70\]
  - Visual fidelity therefore depends on your atlas font matching the native terminal's font.
- **Limits (judgment, consistent with the WASM target):**
  - Crates that assume a real TTY (crossterm event loop, termion) must be feature-gated out.
  - There is no blocking I/O, no `std::thread`, and no direct filesystem access. Network calls go through `fetch`/WebSocket via `web-sys`/`gloo`, subject to CORS.
  - Async runs on `wasm-bindgen-futures`, not tokio's multithreaded runtime.
- **Integration plan:**
  - Provide a template crate with two backends behind a feature flag (`native` = crossterm, `web` = ratzilla). The agent's app logic is then shared, and the same binary can also be captured natively for recorded mode.
  - Run Ratzilla inside an iframe island, not in the React tree. It owns its canvas and event loop.
  - Expose a `postMessage` bridge that emits ratatui `Buffer` snapshots as `TermFrame` JSON, so annotations and dumps work in WASM mode too.

**webatui:** don't adopt it. It's LGPL-2.1, was last released Feb 2024 against ratatui 0.25, and is explicitly non-interactive for text editing and cursor.\[23\]\[24\]

**Other frameworks:**

| Framework | Best browser path | Maturity | Recommendation |
|---|---|---|---|
| Python Textual | textual-serve 1.1.3 (subprocess + WebSocket + its own JS client)\[26\] | Stable but slow cadence | Use the **live PTY** path for uniformity. textual-serve uses a custom protocol and its own front end, so it bypasses your renderer and annotation layer\[72\] |
| Go Bubble Tea | GOOS=js shims (bubbweb, PR #1790 stubs) + xterm.js | Experimental. Stock v2 doesn't compile for js/wasm; builds are large (one report: 7.2 MB wasm, 1.5 MB brotli) | **Live PTY** by default; WASM only for hosted static demos\[31\]\[32\]\[73\] |
| Node Ink | No maintained browser target found in this research; Ink depends on Node's TTY streams (judgment) | n/a | **Live PTY** |
| Any binary | PTY → your emulator | Mature | Universal fallback and the default for "show me the real thing" |

### 2. Live terminals (PTY mode)

**PTY bridge choice.** The known host is a Rust harness, so implement the PTY server in Rust with `portable-pty` 0.9.0 and run blocking reads on a dedicated thread feeding a tokio channel. Ship node-pty 1.1.0 only if a Node sidecar is otherwise needed.\[34\] Its native build (node-gyp) and prebuild matrix are an install-friction risk for a CLI meant for wide adoption. For Go hosts, creack/pty is the standard library (version not re-verified here). The ttyd/gotty/wetty pattern (process ↔ PTY ↔ WebSocket ↔ xterm.js) is the right shape.\[41\]\[74\] Reimplement it rather than shelling out to ttyd, so you control auth, framing and recording.

**Protocol (judgment):**
- Use a binary WebSocket with typed frames: `data`, `resize{cols,rows}`, `input`, `ack` for flow control, `snapshot`, and `exit{code}`.
- Tee every output chunk into an asciicast v3 writer. Every live session then becomes a recording for free, with `r` events on resize and `x` on exit.
- Resize: the client measures through the fit addon and sends cols/rows. The server calls `master.resize()`, which triggers SIGWINCH.
- Apply backpressure with high/low watermarks so a runaway `yes` can't freeze the tab.
- **Latency:** loopback adds well under a frame. Batching output per animation frame and honoring DEC 2026 synchronized output (now in xterm.js 6) removes tearing for apps like Claude Code that emit it.\[7\]\[75\]

**Fidelity checklist for live mode:**
- **True color:** set `TERM=xterm-256color` and `COLORTERM=truecolor` in the child environment.
- **Unicode width:** load unicode11 and decide deliberately on unicode-graphemes, which is experimental.\[76\]\[77\] Mismatched width tables between the TUI library (e.g. ratatui's `unicode-width`) and the emulator are the #1 source of misaligned borders with emoji. Pin both, and test with a width-torture fixture.
- **Box drawing:** xterm.js has `customGlyphs` (on by default), which draws box/block characters procedurally so lines join seamlessly. Keep it on.
- **Fonts and ligatures:** bundle one monospace webfont (e.g. JetBrains Mono or Iosevka, both OFL) plus a Nerd Font symbols fallback, and wait for `document.fonts.ready` before opening the terminal. Leave ligatures off by default, since real terminals mostly don't ligate TUI output.
- **Multiple sessions:** one WebGL context per terminal is fine for a handful of terminals, but browsers cap active WebGL contexts. pyvista issue #5207 reports a limit of 16 on Chrome for Linux and 8 on Chrome for Android, after which Chrome logs "Too many active WebGL contexts. Oldest context will be lost." Pages can't raise it (only the `--max-active-webgl-contexts` launch flag does), so virtualize offscreen terminals to the DOM renderer or to static snapshots.

**Alternatives to xterm.js, ranked:**
1. **xterm.js 6 + WebGL**: adopt now.
2. **ghostty-web (or an upstream-libghostty fork)**: pilot behind the same adapter interface. Switch when an official upstream `ghostty-vt.wasm` is consumed unpatched and an npm release has six months of stability.\[14\]
3. **wterm**: interesting because DOM rendering gives native find/selection/a11y and it ships a React package, but it's an "Experiment".\[1\]\[78\] Re-evaluate at 1.0.

**Overturn condition:** if libghostty-vt publishes tagged WASM releases and ghostty-web (or wterm's Ghostty core) passes your fidelity fixture suite with better grapheme/RTL results, swap the emulator core behind the adapter. The xterm.js-compatible API makes this cheap.\[79\]

**Security hygiene for the local PTY server** (in scope even under "no guardrails"):
- Bind to `127.0.0.1`/`::1` only, on a random port. Never bind `0.0.0.0` by default; remote phone access goes through the user's tunnel or VPN.
- Require a 128-bit+ per-launch secret. Deliver it in the URL *fragment*, exchange it for an HttpOnly, SameSite=Strict cookie or a short-lived WS ticket, and require it on every HTTP and WS request.
- **DNS rebinding:** reject any request whose `Host` header isn't in an allowlist (`127.0.0.1:PORT`, `localhost:PORT`, configured tunnel hostnames).
- **Cross-site WebSocket hijacking:** check `Origin` on the WS upgrade against the same allowlist. Real-world deployments show proxies rewriting Host can defeat ttyd's built-in `--check-origin`, so do the check in your own server, before any proxying.\[80\]\[81\]
- No permissive CORS. Spawn arbitrary commands only from host-registered session specs, never from URL parameters (ttyd's `--url-arg` is a cautionary example).\[42\]
- Make sessions read-only unless the artifact explicitly requests input, mirroring ttyd's read-only default.\[42\]

### 3. Recorded and static mode

**Format:** asciicast v3 is the interchange and storage format. It has relative-interval events (easy to edit and splice), a `term` header with theme capture, markers (`m`) for chapters and review checkpoints, resize events, and an exit status.\[46\]\[49\] It's simple enough for agents to generate or edit by hand.

**Pipeline (recommended):**
```
source bytes (PTY tee | asciinema rec | VHS | ratatui TestBackend)
   → headless emulator (pinned)  → TermFrame[] (keyframes + diffs)
   → <TerminalGrid> React renderer | text dump | JSON cell dump | PNG
```

**Headless emulator choice:**
- **avt** (Rust, Apache-2.0). This is the same core asciinema-player and agg use, so your frames match asciinema's playback by construction.\[53\]\[82\] The Rust harness can call it natively.
- **@xterm/headless** (Node). Gives xterm.js semantics, so recorded frames match live mode exactly, but it's labelled experimental.\[12\]
- **vt100** crate. Has a good diff API.\[55\]
- **Recommendation:** use avt in the Rust host for capture/export, and @xterm/headless where you need parity with the live renderer. Run a CI parity test that feeds both the same fixtures and diffs cell output.

**ratatui TestBackend:**
- Serialize `Buffer` cells (`symbol`, `fg`, `bg`, `modifier`, plus a computed width; skip-cells for wide characters) directly to `TermFrame` JSON. This bypasses VT parsing entirely and is the most exact possible capture for ratatui apps.
- Provide a tiny crate (`artifact-ratatui-capture`) that runs scripted key events against the app's `App` struct and emits a frame sequence with timestamps.
- Bubble Tea, Textual and Ink have analogous test harnesses (teatest, Textual's `run_test`/pilot, ink-testing-library). Those emit strings, though, so route them through the emulator.

**VHS:** good for authoring scripted, reproducible demos (`.tape` files). Under the hood it's ttyd + xterm.js + headless Chrome + ffmpeg, so its pixels are xterm.js pixels.\[60\]\[61\]\[63\] Prefer its frame or ASCII outputs, or record the same tape's PTY stream to asciicast. Don't embed GIF/MP4, which can't be annotated or diffed.

**`TermFrame` data model (proposed):**
```ts
type Cell = { t: string /* grapheme */, w: 0|1|2, fg?: Color, bg?: Color,
              a?: number /* bitset: bold,dim,italic,underline(style),blink,inverse,hidden,strike */,
              ul?: Color, link?: number /* OSC 8 id */ };
type TermFrame = { cols: number, rows: number, cells: Cell[] /* row-major */,
                   cursor?: {x,y,shape,visible}, altScreen: boolean,
                   t: number /* ms */, seq: number, key?: boolean };
type Recording = { header: {theme, font, widthTable: "unicode15"|...},
                   frames: (TermFrame | FrameDiff)[], markers: {t,label}[] };
```

**Pixel-faithful renderer (`<TerminalGrid>`):**
- **Cell geometry:**
  - Measure cell width from the loaded font's advance width at the chosen size, rounded to device pixels. Cell height = ascent + descent + lineGap, scaled.
  - Lay out by absolute cell coordinates, never by text flow. This is the single most important rule for exact grids.
- **Glyph rendering:**
  - Draw U+2500–U+259F (box drawing, block elements), U+2800 braille and powerline separators procedurally on canvas, as xterm.js customGlyphs, Ghostty and beamterm do. Font glyphs for these rarely tile seamlessly.
  - Draw text through Canvas 2D or WebGL for animation, with a selectable transparent DOM text layer on top for copy/find/a11y.
- **Width:** trust the frame's `w` field from the emulator; never re-measure in the browser. Wide cells span two columns, and emoji use a color-emoji font fallback clipped to two cells.
- **Animation:** keyframe every N frames plus diffs, a `requestAnimationFrame` player, a scrubber, and markers. Canvas redraws only dirty rows.

**Honest fidelity limits per mode:**

| Mode | What is exact | What can differ from the user's real terminal |
|---|---|---|
| Live PTY + xterm.js | The app's real output bytes; real behavior | xterm.js emulation quirks (RTL/complex scripts weaker than Ghostty).\[15\] Font differs from the user's terminal. Kitty graphics only in beta. Grapheme widths if the addon isn't used |
| Recorded (asciicast → emulator → grid) | Byte-exact replay; deterministic frames | Same emulator caveats. Theme is only what was captured. No interactivity beyond scrubbing |
| ratatui TestBackend → grid | Cell-exact to ratatui's own buffer | Doesn't exercise the real terminal backend (crossterm escape output); terminal-specific bugs are invisible |
| WASM (Ratzilla) | ratatui buffer exact; real interactivity | App had to be ported. No fs/threads; network subject to CORS. Font-atlas rendering differs subtly from text-layer rendering |
| VHS GIF/MP4 | Pixels as rendered by xterm.js in Chrome | Lossy, not annotatable, not diffable; use only as an export |

### 4. Annotation and comparison

**Anchoring (judgment):** pin comments to *semantic* anchors with layered fallbacks:
1. **Region anchor:** `{frameSeq or marker, rect: {x,y,w,h} in cells}`. This is exact for a given frame.
2. **Content anchor:** a hash plus the text of the anchored rows, and a snippet from the region (e.g. "│ Status: FAILED"). Re-locate it after resize or in later frames by fuzzy search on the screen text. This works because ratatui and similar apps re-layout deterministically.
3. **Widget anchor (optional):** if the TUI emits OSC 8 hyperlinks or a sidecar layout map (ratatui capture crate can export `Rect`s per named widget), anchor to the widget id. That survives any resize.

On resize or reflow, try (3) → (2) → (1). If an anchor can't be relocated, mark it "detached" rather than silently moving it.

**Side-by-side comparison:**
- Render N `<TerminalGrid>`s off one shared clock. Sync by timestamp, marker or step index (step index is best for scripted captures, since every candidate gets the same input script).
- Cell diffing is trivial on `TermFrame`: compare `(t, fg, bg, a)` per cell. Highlight changed cells and report counts in the text dump.
- For review surfaces, feed comparisons from TestBackend captures driven by the same key script, so differences are design differences and not timing noise.

### 5. Arbitrary web demos (Vite/Next/etc.)

**Isolation (judgment, standard web-platform behavior):**
- Serve each demo on its own **origin**. Note that `localhost:5173` and `localhost:5174` are different origins but the *same site*, and cookies are not isolated by port.
- Prefer per-demo hostnames under `*.localhost`, e.g. `demo-3.localhost:PORT`. Chromium and Firefox resolve `*.localhost` to loopback; verify Safari before relying on it.
- Embed with `<iframe sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals">`. `allow-same-origin` is only acceptable *because* the demo is on a different origin from the toolkit shell; never combine `allow-scripts` and `allow-same-origin` on a same-origin frame.
- Keep host-rendered trusted controls (submit, "Send") in the parent, outside the frame.

**COOP/COEP:**
- Don't make the toolkit shell cross-origin-isolated by default. COEP `require-corp` forces every embedded demo and asset to opt in through CORP/CORS and breaks typical third-party embeds.
- If a demo needs `SharedArrayBuffer` (some WASM apps), open it as a top-level isolated window or tab, or serve both shell and frame with COEP plus `credentialless` where supported.

**Viewport and device frames:** set iframe CSS size to device presets (390×844, 768×1024, 1440×900) and scale the frame down with `transform`. The demo then sees real media-query widths. Emulating DPR or touch requires Playwright's device emulation; an iframe can't do it.

**HMR passthrough:**
- Reverse-proxy the dev server and forward WebSocket `Upgrade` requests. Vite's HMR socket uses the page path by default, and Next.js uses `/_next/webpack-hmr`.
- Configure Vite `server.hmr.clientPort`/`path` (and `server.allowedHosts`) when the proxy port or host differs.
- The simpler and more robust option: put each dev server on its own `*.localhost` origin and *don't* proxy paths, only ports. This avoids base-path rewriting bugs.

**Screenshots for agents:**
- Use headless Playwright/CDP driven by the toolkit CLI: `artifact screenshot <id> --viewport 390x844 --wait-for networkidle --out a.png`. It returns the PNG, console errors, failed requests, and an accessibility-tree/text dump.
- In-browser capture (html2canvas-style) is not faithful for canvas/WebGL or cross-origin frames, so use it only for user-initiated "attach screenshot to comment".

## Recommendations

**Ranked architecture decisions:**

1. **One data model (`TermFrame`/`Recording`) plus an owned `<TerminalGrid>` renderer for all non-live modes.** *Overturn if:* a maintained library exposes cell-level render hooks and annotation APIs. asciinema-player doesn't today.
2. **Live: xterm.js 6.0.0 + WebGL + unicode11 behind a `TerminalEngine` adapter.** Make ghostty-web the pilot second engine. *Overturn if:* upstream libghostty-vt WASM ships tagged releases and a ghostty-based package beats xterm.js on your fidelity fixtures for two consecutive releases.
3. **PTY server in Rust (portable-pty) inside, or alongside, the host harness,** with a host port for spawn policy. *Overturn if:* the toolkit's standalone CLI is Node-only, in which case use node-pty 1.1.0 and accept native-build friction.
4. **Capture: avt in Rust for asciicast→frames; ratatui TestBackend exporter for cell-exact ratatui captures.** *Overturn if:* the parity test shows avt and xterm.js diverging on your fixtures; then standardize on @xterm/headless for everything.
5. **WASM: Ratzilla 0.3.1 template with a dual native/web backend.** Bubble Tea, Textual and Ink go through the PTY. *Overturn if:* Bubble Tea merges official js/wasm support (PR #1790) and binary sizes become acceptable.

**React component family:**
- `<Terminal mode="live" session=…/>`: xterm.js engine; tees to a recording; exposes `getFrame()`.
- `<Terminal mode="recording" src="x.cast" | frames=…/>`: `<TerminalGrid>` + player controls + markers.
- `<Terminal mode="wasm" src="pkg/">`: Ratzilla iframe island + frame bridge.
- `<TerminalCompare candidates=[…] sync="step|time|marker"/>`, `<AnnotationLayer/>` (shared by all modes, operates on cell rects), `<WebDemo src port device/>`.
- Shared theme: one `TerminalTheme` (16 ANSI + fg/bg/cursor/selection, imported from the asciicast v3 `term.theme`) and one `FontSpec` (family, size, lineHeight, fallback chain, width table) used by every engine.

**Prototype plan:**

| Milestone | Scope | Exit criterion (agent-verifiable) |
|---|---|---|
| M0 (week 1) | `TermFrame` schema; avt-based `cast → frames` CLI; text and JSON cell dumps | `artifact term dump demo.cast --at 3.2s --format text` matches a golden file |
| M1 (weeks 2–3) | `<TerminalGrid>` canvas renderer with procedural box/block glyphs, bundled font, scrubber | Playwright screenshot pixel-diff < 0.1% against golden PNGs for a fixture suite (box drawing, 256/true color, CJK, emoji ZWJ, combining marks) |
| M2 (weeks 3–4) | Rust PTY server (portable-pty) + WS protocol + xterm.js 6 live view + asciicast tee; full security checklist | Automated tests: wrong Host → 403, foreign Origin WS → 403, missing token → 401; `htop`/`vim`/ratatui demo resize correctly |
| M3 (week 5) | ratatui capture crate (TestBackend → frames, scripted keys) + Ratzilla template | The same app renders identically (cell diff = 0) in capture mode and WASM mode |
| M4 (week 6) | Annotation layer (rect + content anchors) + compare view with synced playback and cell diff | Anchors survive a 80→120 col resize in fixture tests; diff count reported in text dump |
| M5 (week 7) | `<WebDemo>`: per-origin dev servers, HMR passthrough, device frames, `artifact screenshot` | Vite + Next demos hot-reload inside the frame; screenshot command returns PNG + console log |
| M6 | ghostty-web engine pilot behind adapter; parity report | Fixture-suite comparison table generated automatically |

**How a vision-less agent verifies output:**
1. `artifact term dump --format text`: the exact screen as plain text, which is what the agent reads first.
2. `--format cells`: JSON with colors and attributes for assertions like "row 0 is bold on blue".
3. `--format ansi`: re-renderable in the agent's own terminal.
4. `artifact screenshot`: PNG for multimodal agents or humans, plus a pixel-diff against the last approved golden.
5. A lint pass that flags common TUI breakage automatically: misaligned borders (box-drawing continuity check), cells overflowing `cols`, and width-table disagreements (emulator width ≠ TUI library width).

**Top risks:**
- Unicode width disagreements between TUI libraries and emulators. Mitigate with a pinned width table and the torture fixture.
- Font loading races. Gate rendering on `document.fonts.ready` and measure after load.
- WebGL context limits with many terminals. Virtualize.
- @xterm/headless and serialize are still "experimental".\[10\]\[12\]
- Ghostty-based packages churning weekly.
- node-pty native builds, if Node is chosen.

## Caveats

- **Not re-verified from primary sources in this session:** creack/pty and gotty/wetty versions, Ink's browser story, and exact Vite/Next HMR configuration keys. These rest on established knowledge and are marked as judgment above.
- **Version conflicts:**
  - The earlier wterm version conflict (CHANGELOG 0.3.4 vs npm 0.3.0) is resolved: per the vercel-labs/wterm GitHub release (Sep 28 2026) and PR #222, all eight @wterm/* packages were released at 0.5.2.
  - ghostty-web's last npm publish is confirmed as v0.4.0 on Dec 9, 2025 (coder/ghostty-web Releases page; issue #137).
  - The claim that Ghostty publishes prebuilt `ghostty-vt.wasm` comes from a Mitchell Hashimoto tweet, not the releases page.\[17\]
  - libghostty's speed claims versus xterm.js are vendor benchmarks.
- **Third-party reports:** the kitty-graphics support in the @xterm/addon-image 0.10 beta, and the broken `@xterm/headless` 6.0.0 `module` entry, are from third-party repos, not upstream docs.\[9\]\[13\]
- **PR #1790 (Bubble Tea GOOS=js) is still open, not merged.** GitHub shows "0pcom wants to merge 1 commit into charmbracelet:main". Downstream projects pin forks instead: Kiln PR #117 (Oct 6 2026) pins "v2.0.10, plus three merged-but-unreleased upstream fixes… plus the two js files", and go-booba uses neomantra/bubbletea, also based on v2.0.10. Treat Bubble Tea WASM as unsupported upstream.
- **The proposed `TermFrame` schema, anchoring strategy and milestone timings are design judgments.** Validate them with the M0–M2 fixture suite before committing the public API.

## Sources

1. [GitHub - vercel-labs/wterm: A terminal emulator for the web · GitHub](https://github.com/vercel-labs/wterm)
2. [Releases · xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/releases)
3. [chore(deps): upgrade xterm.js to the 6.1 beta set with no behaviour change by openwong2kim · Pull Request #1958 · openwong2kim/wmux](https://github.com/openwong2kim/wmux/pull/1958)
4. [xtermjs/xterm.js 6.0.0 on GitHub](https://newreleases.io/project/github/xtermjs/xterm.js/release/6.0.0)
5. [@xterm/addon-webgl - npmx](https://npmx.dev/package/@xterm/addon-webgl)
6. [@xterm/addon-unicode-graphemes CDN by jsDelivr - A CDN for npm and GitHub](https://www.jsdelivr.com/package/npm/@xterm/addon-unicode-graphemes)
7. [xterm.js 6: what we gain, what it costs, and when to move · Issue #119 · derek-larson14/obsidian-claude-sidebar](https://github.com/derek-larson14/obsidian-claude-sidebar/issues/119)
8. [@xterm/addon-image - npm](https://www.npmjs.com/package/@xterm/addon-image)
9. [feat(terminal): render inline images (SIXEL / iTerm2 IIP) via @xterm/addon-image by lmsh7 · Pull Request #19201 · stablyai/orca](https://github.com/stablyai/orca/pull/19201)
10. [@xterm/addon-serialize - npm](https://www.npmjs.com/package/@xterm/addon-serialize/v/0.12.0)
11. [Serialize addon restores a cursor one column left after a full-row write · Issue #6165 · xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/issues/6165)
12. [@xterm/headless - npm](https://www.npmjs.com/package/@xterm/headless)
13. [Dependencies: upgrade xterm.js to 6 · Issue #487 · luojiahai/code-by-wire](https://github.com/luojiahai/code-by-wire/issues/487)
14. [ghostty-web - npm](https://www.npmjs.com/package/ghostty-web)
15. [GitHub - mbrukman/coder-ghostty-web: Ghostty for the web with xterm.js API compatibility](https://github.com/mbrukman/coder-ghostty-web)
16. [Ghostty on Windows — research notes and roadmap (May 2026)](https://gist.github.com/stephengodderidge/efb468adcb5b75e8033c1dbede78dc17)
17. [Mitchell Hashimoto on X: "libghostty for WebAssembly got a lot of love recently and is now very, very, very good. I spent the day building harnesses and comparing to xterm.js and here are the results: faster at IO, faster at reflow, faster at rendering. Like, a lot a lot faster. We now provide pr… / X](https://x.com/mitchellh/status/2088378990998524206)
18. [Libghostty Is Coming](https://mitchellh.com/writing/libghostty-is-coming)
19. [Ratzilla — WebAssembly in Rust // Lib.rs](https://lib.rs/crates/ratzilla)
20. [build(deps): bump ratzilla from 0.3.0 to 0.3.1 by dependabot\[bot\] · Pull Request #4 · ano333333/redmine-tui](https://github.com/ano333333/redmine-tui/pull/4)
21. [ratzilla::backend - Rust](https://docs.rs/ratzilla/latest/ratzilla/backend/index.html)
22. [GitHub - junkdog/beamterm: A sub-millisecond terminal text rendering system for WebGL2 and OpenGL 3.3 · GitHub](https://github.com/junkdog/beamterm)
23. [webatui - Rust](https://docs.rs/webatui/latest/webatui/)
24. [Webatui — WebAssembly in Rust // Lib.rs](https://lib.rs/crates/webatui)
25. [textual-serve 1.1.3 on PyPI - Libraries.io - security & maintenance data for open source software](https://libraries.io/pypi/textual-serve)
26. [Textual Serve (textualize/textual-serve)](https://context7.com/textualize/textual-serve)
27. [Releases · Textualize/textual-web](https://github.com/Textualize/textual-web/releases)
28. [What is Textual Web? - Textual](https://textual.textualize.io/blog/2023/09/06/what-is-textual-web/)
29. [GitHub - BigJk/bubbletea-in-wasm: POC for bubbletea in WASM · GitHub](https://github.com/BigJk/bubbletea-in-wasm)
30. [bubbweb package - github.com/justwasm/bubbweb - Go Packages](https://pkg.go.dev/github.com/justwasm/bubbweb)
31. [Epic: Web app (Kiln in WASM, plus a WebSocket relay) · Issue #74 · latrani/Kiln](https://github.com/latrani/Kiln/issues/74)
32. [add GOOS=js (wasm) build support by 0pcom · Pull Request #1790 · charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea/pull/1790)
33. [chore(deps): bump node-pty from 1.0.0 to 1.1.0 by dependabot\[bot\] · Pull Request #15 · Debarun1205/GearVane](https://github.com/Debarun1205/GearVane/pull/15)
34. [node-pty - npm](https://www.npmjs.com/package/node-pty)
35. [node-pty](https://classic.yarnpkg.com/en/package/node-pty)
36. [portable-pty 0.9.0 - Docs.rs](https://docs.rs/crate/portable-pty/latest)
37. [portable-pty-psmux — CLI for Rust // Lib.rs](https://lib.rs/crates/portable-pty-psmux)
38. [psmux/portable-pty-patched](https://deepwiki.com/psmux/portable-pty-patched)
39. [portable-pty: Cross-Platform PTY Interface for Rust](https://openapps.pro/packages/portable-pty)
40. [ttyd(1) — Arch manual pages](https://man.archlinux.org/man/extra/ttyd/ttyd.1.en)
41. [Ubuntu Manpage: ttyd - Share your terminal over the web](https://manpages.ubuntu.com/manpages/jammy/man1/ttyd.1.html)
42. [GitHub - tsl0922/ttyd: Share your terminal over the web · GitHub](https://github.com/tsl0922/ttyd)
43. [asciinema-player](https://security.snyk.io/package/npm/asciinema-player)
44. [asciinema-player 3.16.0 on npm - Libraries.io - security & maintenance data for open source software](https://libraries.io/npm/asciinema-player)
45. [chore: 🤖 update dependency asciinema-player to v3.17.0 by renovate\[bot\] · Pull Request #1594 · Exlint/dashboard](https://github.com/Exlint/dashboard/pull/1594)
46. [asciinema/CHANGELOG.md at develop · asciinema/asciinema](https://github.com/asciinema/asciinema/blob/develop/CHANGELOG.md)
47. [Asciinema player 3.16.0 - Announcements - asciinema forum](https://discourse.asciinema.org/t/asciinema-player-3-16-0/1094)
48. [asciicast v3 - asciinema docs](https://docs.asciinema.org/manual/asciicast/v3/)
49. [3.0 · asciinema blog](https://blog.asciinema.org/post/three-point-o/)
50. [Releases · asciinema/asciinema](https://github.com/asciinema/asciinema/releases)
51. [asciinema · GitHub](https://github.com/asciinema)
52. [Releases · asciinema/avt](https://github.com/asciinema/avt/releases)
53. [github.com](https://github.com/asciinema/avt)
54. [GitHub - atuinsh/vt100-rust: Fork of https://github.com/doy/vt100-rust · GitHub](https://github.com/atuinsh/vt100-rust)
55. [vt100::Screen - Rust](https://docs.rs/vt100/0.8.0/vt100/struct.Screen.html)
56. [vt100 - crates.io: Rust Package Registry](https://crates.io/crates/vt100)
57. [vhs(1) — Arch manual pages](https://man.archlinux.org/man/vhs.1.en)
58. [chore(deps): update dependency charmbracelet/vhs to v0.12.1 by renovate\[bot\] · Pull Request #1309 · zpratt/lousy-agents](https://github.com/zpratt/lousy-agents/pull/1309)
59. [Update ghcr.io/charmbracelet/vhs Docker tag to v0.12.1 by renovate\[bot\] · Pull Request #213 · metaplay/cli](https://github.com/metaplay/cli/pull/213)
60. [vhs command - github.com/charmbracelet/vhs - Go Packages](https://pkg.go.dev/github.com/charmbracelet/vhs)
61. [VHS download](https://sourceforge.net/projects/charm-vhs.mirror/)
62. [vhs - WakeMeOps](https://docs.wakemeops.com/packages/vhs/)
63. [How to Create Terminal Demos as Code with VHS by Charm - Hypertext Dispatches](https://tenthirtyam.org/dispatches/2026/04/16/how-to-create-terminal-demos-as-code-with-vhs-by-charm/)
64. [wterm/packages/@wterm/ghostty at main · vercel-labs/wterm](https://github.com/vercel-labs/wterm/tree/main/packages/@wterm/ghostty)
65. [@wterm/ghostty: scrollback rows render blank — \`get\_scrollback\_line\` is an unimplemented stub · Issue #91 · vercel-labs/wterm](https://github.com/vercel-labs/wterm/issues/91)
66. [Request: publish new npm release (v0.5.0?) · Issue #137 · coder/ghostty-web](https://github.com/coder/ghostty-web/issues/137)
67. [Release v0.5.0 · rockie/ghostty-web](https://github.com/rockie/ghostty-web/releases/tag/v0.5.0)
68. [ratzilla - Rust](https://docs.rs/ratzilla/latest/ratzilla/)
69. [orhun/ratzilla](https://deepwiki.com/orhun/ratzilla)
70. [Modernise terminal site for ratzilla 0.3.1, CV update, toys and mobile view by jscarrott · Pull Request #11 · jscarrott/website](https://github.com/jscarrott/website/pull/11)
71. [ratatui/ratzilla](https://deepwiki.com/ratatui/ratzilla)
72. [GitHub - Textualize/textual-web: Run TUIs and terminals in your browser · GitHub](https://github.com/Textualize/textual-web)
73. [web: the demo garden in a browser, as WebAssembly on xterm.js by RursusAeternum · Pull Request #1 · RursusAeternum/GitAGarden](https://github.com/RursusAeternum/GitAGarden/pull/1)
74. [Ttyd: Browse or Scrape in CLI? Terminal and Headless Options](https://www.x-cmd.com/install/ttyd/)
75. [\[Bug\]: TUI animations scroll instead of animating in-place (missing xterm.js Synchronized Output support) · Issue #2787 · wavetermdev/waveterm](https://github.com/wavetermdev/waveterm/issues/2787)
76. [Emoji like ✅ ❌ take one cell in the terminal, so the next character is hidden · Issue #113 · derek-larson14/obsidian-claude-sidebar](https://github.com/derek-larson14/obsidian-claude-sidebar/issues/113)
77. [loxel: Unicode 11+ character widths in terminals (emoji alignment in TUIs) · Issue #361 · bizimind/loxel](https://github.com/bizimind/loxel/issues/361)
78. [wterm: The Terminal Emulator That Chooses the DOM on Purpose — Repo Explainer](https://repo-explainer.com/vercel-labs/wterm/)
79. [coder/ghostty-web](https://deepwiki.com/coder/ghostty-web)
80. [fix: refuse cross-origin WebSocket upgrades and bind ttyd to loopback by owine · Pull Request #371 · owine/claude-terminal-home-assistant](https://github.com/owine/claude-terminal-home-assistant/pull/371)
81. [fix(ai-trading): let same-origin terminal WebSockets pass ttyd --check-origin via the hub Worker by thangtran3112 · Pull Request #45 · thangtran3112/family-app](https://github.com/thangtran3112/family-app/pull/45)
82. [How it works - asciinema docs](https://docs.asciinema.org/how-it-works/)
