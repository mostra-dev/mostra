# Extension System & Marketplace for an Agent-Authored Artifact Toolkit (Brief 8, October 2026)

**Recommendation in one sentence:** build a *hybrid* extension system where runtime code (embed engines, host adapters, connectors, exporters, verify checks, CLI commands) ships as ordinary npm packages implementing small, independently-semver'd typed contracts declared in a `package.json` `"toolkit"` manifest, while component/template packs ship as copy-source items in a shadcn-registry-compatible format, and both are indexed by a metadata-only, namespace-verified registry (modeled on the official MCP Registry) that exposes an agent-first search API and MCP tool surface, with provenance, compatibility and license class surfaced as facts rather than enforced as gates.

## TL;DR

- **Copy prior art selectively:** shadcn's registry (copy-source, namespaced `@acme/item`, JSON-schema-validated, no auto-discovery) for component packs; VS Code/Herdr-style declared host-version ranges but per-extension-point; MCP Registry's metadata-only, reverse-DNS/GitHub namespace verification and subregistry federation for the index; Vite's ecosystem-CI approach for compatibility badges. Avoid Open VSX's failure modes (namespace squatting, "evil twin" clones, packs referencing non-existent extensions).
- **Trust without guardrails is achievable:** surface npm Sigstore provenance (automatic under trusted publishing from GitHub Actions/GitLab), verified namespaces, toolkit-run compatibility baselines, and SPDX license class at install time; require an explicit, scriptable acknowledgment (not a block) for source-available engines like Remotion (paid Company License for for-profits with 4+ employees) and GSAP (free, but Webflow-proprietary with a no-code-visual-builder restriction and termination-at-discretion clause).
- **Ship in phases:** Phase 0–1 (now–Q1 2027) freeze contracts + manifest schema and launch a read-only registry API + `toolkit plugin search/add/verify` + MCP tools; Phase 2 adds publishing, provenance ingestion and compat badges; Phase 3 adds the web UI, curation and optional commerce links. A UI before the API is the wrong order because the primary consumers are agents.

## Key Findings

### Verified facts (state of prior art, October 2026)

**shadcn registry (copy-source).** A registry is `registry.json` (root must define `name` and `homepage`) listing items with typed files; item types include `registry:ui`, `registry:block`, `registry:lib`, `registry:hook`, `registry:file`, `registry:page`, `registry:theme`, `registry:style`, `registry:font`, `registry:item`.\[1\] Namespaced registries are configured in `components.json` under `registries` (e.g., `"@acme": "https://registry.acme.com/r/{name}.json"`), support auth headers for private registries, and items are validated against the registry-item schema before install.\[2\]\[3\] The docs state "No automatic registry discovery: The CLI never automatically adds registries."\[2\] May 2026 added `include` (compose multiple `registry.json` files) and `shadcn registry validate`; June 2026 added GitHub registries (`pnpm dlx shadcn@latest add <username>/<repo>/<item>`) that need no build step.\[4\]\[5\] shadcn also ships an agent skill (`skills/shadcn/registry.md`) in its repo, i.e., the ecosystem now documents itself for agents.\[1\] I did not verify the exact current `shadcn` CLI version number.

**VS Code extensions.** Manifest is `package.json` with `engines.vscode` declaring the compatible API range ("You can use the engines.vscode property to ensure the extension only gets installed for clients that contain the API you depend on"). Verified-publisher badges require proving domain ownership, and per Microsoft "a publisher must have one or more extensions on the VS Marketplace for a minimum of 6 months, and the registration of the domain must also be at least 6 months old."\[6\] The Marketplace signs all extensions on publish and VS Code verifies the signature on install; since VS Code 1.97 a publisher-trust dialog appears on first install from a third-party publisher; malware scanning runs per new extension and update; a block list removes and auto-uninstalls malicious extensions.\[7\]\[8\]

**Open VSX (vendor-neutral VS Code registry, Eclipse Foundation).** Introduced pre-publish security checks in February 2026; a logic bug ("Open Sesame") let scanner failures under load be treated as clean, fixed in Open VSX v0.32.0 after disclosure on February 8, 2026.\[9\]\[10\] Between July 26 and August 1, 2026, Manifold Security found 77 "evil twin" extensions republishing real Marketplace names/namespaces from unrelated accounts, all beaconing to one domain; removed by August 3, 2026.\[11\]\[12\] In July 2026 researchers publicly reported a namespace-hijacking gap (claiming Microsoft Marketplace publisher namespaces unregistered on Open VSX); Socket's John Tuckner counted "491 such Open VSX IDs over the previous year, including 338 in 2026. Of those 491 IDs, 415 impersonated extensions ranked among the 10,000 most popular in Microsoft's marketplace" (Socket, August 24, 2026). Bloom Security's "Extension Resurrection" research (disclosed to Open VSX on February 5, 2026) found that "Open VSX and the VS Code Marketplace allowed packs to reference non-existent extensions": "In the VS Code marketplace, 677 of 4179 extension packs contained at least one shadow dependency, 60 of which belonged to a non-registered publisher," and Bloom reports 94 of 321 Open VSX packs were also affected. The Eclipse Foundation launched an Open VSX Managed Registry in April 2026.\[13\]

**Vite / Rollup / Rolldown.** Vite 8 stable shipped in March 2026 with Rolldown as the single bundler; the team "focused on keeping the configuration API and plugin hooks unchanged," and validated key plugins (SvelteKit, react-router, Storybook) through an ecosystem CI job against `rolldown-vite`.\[14\]\[15\]\[16\] Rolldown 1.0 stable shipped in May 2026 with a semver-locked API: "Option names, types, and plugin hook signatures stay backward-compatible."\[16\] Plugins are plain objects with hooks; there is no manifest or central registry beyond npm keywords.

**Storybook addons.** Storybook 10 requires addons to be ESM-only and recommends `peerDependencies: { "storybook": "^10.0.0" }`.\[17\]\[18\] The addon catalog "is populated by querying npm's registry for Storybook-specific metadata in package.json"—an npm-indexed catalog, not a separate upload.\[19\] Storybook ran proactive outreach issues to addon repos for the v10 migration and offers community takeover of unmaintained addons.\[20\]

**Raycast Store.** Manifest is an extended `package.json` (commands, tools, preferences, categories, `platforms`).\[21\]\[22\]\[23\]\[24\] Submission is a PR to the `raycast/extensions` monorepo; CI runs manifest checks, linting and asset checks; Community Managers review first-in-first-out with "first contact within a week."\[25\]\[26\] Abandonment is defined as "the extension no longer functions, OR the Author hasn't responded to Raycast team contact (3+ attempts)," and "Raycast reserves the right to build extensions with the same functionality as an existing one."\[25\] I did not verify any paid-extension mechanism.

**Obsidian community plugins.** On May 13, 2026 Obsidian launched Obsidian Community (community.obsidian.md), replacing GitHub-PR manual review with automated review of every version ("not just the initial submission"), including malware scanning; each plugin gets a safety scorecard, and paid and official plugins are labeled.\[27\]\[28\] The launch cleared over 2,300 backlogged submissions, and closed-source plugins are no longer accepted for new submissions.\[29\] Announced as upcoming: capability disclosures, privacy labels, artifact attestation, verified author badges and private plugins for teams.\[29\]\[30\] Obsidian explicitly cited coding agents as the reason the manual queue was "only getting longer."\[28\] Plugins remain unsandboxed (they "can access files on your computer, connect to the internet, and install additional programs").\[31\]\[32\]

**Grafana plugins.** Every plugin carries a signed `MANIFEST.txt` (PGP) verified against Grafana's built-in public key at startup; statuses include Signed, Invalid, Modified, Unsigned.\[33\]\[34\] Signature levels: Grafana, Enterprise, Community ("dependent technologies that are open source and not for profit"), Commercial ("closed source or commercially backed," requiring a partnership), and Private (bound to specified `rootUrls`, not in the catalog).\[34\]\[35\]\[36\] Public plugins are reviewed before a level is granted.\[33\]

**Backstage.** The New Frontend System builds plugins with `createFrontendPlugin({ pluginId, extensions })`; extensions are created from typed "extension blueprints" (`PageBlueprint`, `ApiBlueprint`, `EntityCardBlueprint`, …) and are namespaced by plugin ID (e.g., `page:my-plugin`) into an app extension tree with inputs/outputs, so installers can override individual extensions without forking the plugin.\[37\]\[38\]\[39\]\[40\]\[41\] This is the strongest prior art for *typed extension points* in a React app.

**Herdr plugins.** Herdr (Apache-2.0; docs at v0.9.3) reports 1,548 community plugins on its homepage.\[42\]\[43\] A plugin is a directory with `herdr-plugin.toml` requiring `id`, `name`, `version`, `min_herdr_version`, plus optional `platforms`, `[[build]]`, `[[startup]]`, `[[actions]]`, `[[events]]`, `[[panes]]`, `[[link_handlers]]`; commands are argv arrays (no shell). "There is no separate plugin SDK or restricted command set. The entire Herdr CLI is the plugin API." Herdr "does not review or sandbox plugin code"; `herdr plugin install owner/repo[/subdir]` shows a preview and supports `--yes` and `--ref` pinning.\[43\] The marketplace at herdr.dev/plugins is "an automatic index of public GitHub repositories tagged with herdr-plugin," explicitly "not a reviewed catalog."\[44\]\[45\] This is the closest philosophical match to our no-guardrails commitment.

**Official MCP Registry.** Launched in preview September 8, 2025; API freeze v0.1 on October 24, 2025 (integrators told to use `/v0.1/` for stability); the registry server repo has continued releasing (v1.8.0, July 13, 2026).\[46\]\[47\]\[48\] I did not find a GA announcement, so treat it as frozen-API preview. It stores metadata only (`server.json`, schema version `2025-12-11`), not code; namespaces are `io.github.<user>/*` via GitHub OAuth or reverse-DNS (`com.example/*`) via DNS or HTTP proof; it verifies that publishers control referenced npm/PyPI/NuGet/OCI packages; security scanning is delegated to subregistries, whose API shape and `server.json` format are "intentionally designed for reuse."\[49\]\[50\]\[51\]\[52\]

**MCP Apps.** SEP-1865 is Final; the stable spec is dated 2026-01-26, extension ID `io.modelcontextprotocol/ui`, UI resources use the `ui://` scheme with MIME type `text/html;profile=mcp-app`, tools link via `_meta.ui.resourceUri`, rendering is in a sandboxed iframe speaking MCP JSON-RPC over postMessage.\[53\]\[54\]\[55\]\[56\]\[57\]\[58\] This is a natural export target.

**Agent Skills and Claude Code plugins.** Agent Skills (released as an open standard December 18, 2025; spec at agentskills.io) is a directory with a required `SKILL.md` (YAML frontmatter `name`, `description`; optional `license`, `compatibility`, `metadata`, `allowed-tools`) plus optional `scripts/`, `references/`, `assets/`; progressive disclosure loads ~100 tokens of metadata at startup and recommends a body under 5,000 tokens; `skills-ref validate` validates.\[59\]\[60\]\[61\] VS Code/Copilot, Codex and others load skills; directories such as skills.sh install via `npx skills add <owner/repo>`.\[62\]\[63\] Claude Code plugins use `.claude-plugin/plugin.json`; marketplaces are a `.claude-plugin/marketplace.json` listing plugins with `source` entries, with official JSON Schemas on SchemaStore and a `claude plugin validate` command; several marketplace fields are gated on specific Claude Code versions (e.g., v2.1.238+).\[64\]\[65\]\[66\]

**npm supply chain (2025–2026).** After the Shai-Hulud worm, npm disabled classic token creation in November 2025 and permanently revoked all classic tokens on December 9, 2025; granular write tokens require 2FA by default with a 90-day cap.\[67\]\[68\] Trusted publishing (OIDC) is GA since July 31, 2025, requires npm CLI ≥11.5.1 and Node ≥22.14.0, and supports GitHub Actions, GitLab CI/CD and CircleCI.\[69\]\[70\] "When you publish using trusted publishing from GitHub Actions or GitLab CI/CD, npm automatically generates and publishes provenance attestations for your package"; CircleCI-published packages "will not include provenance attestations," and provenance is unavailable from private repos.\[69\]\[70\] On May 18–19, 2026, in a "Mini Shai-Hulud" wave, attackers took over the npm maintainer account "atool" (@antv ecosystem) and, per Socket (May 21, 2026), "pushed 639 malicious versions across 323 unique packages in a single automated burst... All of it slipped past Trusted Publishing"; npm responded by invalidating granular write tokens that bypass 2FA. Staged publishing (`npm stage publish` then 2FA approval) became GA on May 22, 2026; since September 3, 2026 every trusted-publishing configuration can stage by default with direct publishing opt-in, and staged packages can't be approved until malware scanning completes; since October 2, 2026 new packages can be created via staged publishing; npm is "targeting January 2027 to remove direct publishing through bypass-2FA tokens."\[71\]\[72\]\[73\]\[74\]\[75\] Consumers verify with `npm audit signatures` (registry signatures + Sigstore attestations); a package with no provenance is reported, not failed.\[76\]\[77\] JSR "automatically creates provenance statements for each package that is published from GitHub Actions," logged in Sigstore Rekor.\[78\]

**Licenses of non-OSI engines.**
- *Remotion:* custom "Remotion License," source-available. Free for individuals, for-profit organizations with up to 3 employees, non-profits, and evaluation; others need a Company License.\[79\]\[80\] Remotion's own Terms (remotion.pro/terms) set the Company License prices: "Remotion for Creators is a Company License option priced at $25 per Seat per month, with no minimum number of Seats required"; Automators is "$0.01 per render, with a Minimum Spend of $100 per month"; and "The Enterprise License has a Minimum Spend of $500 per month." The license forbids copying/modifying Remotion "for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion."\[81\] No SPDX ID; use `LicenseRef-Remotion`.
- *GSAP:* "Standard 'No Charge' GSAP License" (effective April 30, 2025; last modified May 30, 2025), owned by Webflow.\[82\] Commercial use is free including former Club plugins.\[82\]\[83\] Prohibited Uses: "tools that allow users to build visual animations without code that encourages, induces, or materially assists in creating a solution that competes with Webflow's visual animation building capabilities." Webflow "may terminate this GSAP License and revoke your access in its discretion if you fail to comply," and may amend terms (with continued use under prior terms for prior versions). The FAQ says "AI-generated code is not a 'Prohibited Use'."\[82\] No SPDX ID; ScanCode uses `LicenseRef-scancode-gsap-standard-no-charge-2025`.\[84\]
- *Terminal engines:* `@xterm/xterm` is MIT, latest 6.0.0 (December 2025; ESM builds, synchronized output, breaking scrollbar change); the unscoped `xterm` package is deprecated.\[85\]\[86\]\[87\]\[88\] `ghostty-web` (Coder) latest v0.4.0 (December 2025) is MIT: the coder/ghostty-web GitHub repo lists "MIT license" and its package.json declares `"license": "MIT"`, `"author": "Coder"`. libghostty-vt is MIT within the Ghostty repo and "available and usable today for Zig and C … and WebAssembly," but "We haven't tagged libghostty with a version yet," and Ghostty 1.3.0 (March 9, 2026) said libghostty will get its own release cycle.\[89\]\[90\]

### Prior-art comparison

| Ecosystem | Extension-point model | Manifest | Compat/versioning | Discovery | Review/verification | Trust signals | Monetization | Grew/stalled because |
|---|---|---|---|---|---|---|---|---|
| shadcn registry | Copy source files into user's repo | `registry.json` / `registry-item.json` (JSON Schema) | None at runtime; items are owned code | Explicit namespaces in `components.json`; GitHub registries | Schema validation only | Namespace = URL owner | Third-party paid registries via auth headers | Zero lock-in, agent-editable code; no central gate |
| VS Code | Contribution points + activation events, full Node API | `package.json` | `engines.vscode` range | Central Marketplace + Open VSX | Malware scan, signing, block list | Verified publisher (domain, 6 months), signature | Sponsor links only | Huge API surface; but Marketplace locked to MS builds forced Open VSX fork |
| Vite/Rollup | Hook objects | none (npm `package.json`) | Peer deps; ecosystem CI | npm keywords, community lists | None | npm provenance | None | Stable hook API survived bundler swap |
| Storybook | Manager/preview/preset entries | `package.json` + metadata | `peerDependencies` on `storybook` major | npm-indexed catalog | None | Official `@storybook` scope | None | Major-version breaks cause addon attrition; outreach mitigates |
| Raycast | Commands/tools in React | Extended `package.json` | `@raycast/api` version | Central Store | Human review + CI | Store inclusion | Not verified | High polish via monorepo review; review is a throughput bottleneck |
| Obsidian | Full app API, unsandboxed | `manifest.json` | `minAppVersion` | Community directory | Automated per-version scan + targeted manual | Scorecard, Official badge; attestation planned | Paid labels | Manual review collapsed under agent-written volume → automation |
| Grafana | Panel/datasource/app types | `plugin.json` + signed `MANIFEST.txt` | Grafana version deps | Catalog | Human review before signing | Signature levels | Commercial tier via partnership | Signing gives integrity; review limits long tail |
| Backstage | Typed extension blueprints in an extension tree | Code (`createFrontendPlugin`) | npm semver; alpha exports | Plugin directory | None central | Maintainer listing | None | Composability; migrations are heavy |
| Herdr | Manifest-declared actions/events/panes; CLI as API | `herdr-plugin.toml` | `min_herdr_version` | Auto-index of GitHub topic | None ("not a reviewed catalog") | Install preview, `--ref` pin | None | Near-zero publish friction → 1,548 plugins |
| MCP Registry | Metadata about external servers | `server.json` | Schema-versioned; API v0.1 frozen | REST API + subregistries | Namespace + package-ownership verification | Reverse-DNS namespace | None (subregistries may) | Neutral metadata layer; scanning deferred |
| Agent Skills / Claude Code | Instructions + scripts loaded by agents | `SKILL.md`; `plugin.json`, `marketplace.json` | `compatibility` field; CLI-version-gated fields | Git-hosted marketplaces, skills.sh | `skills-ref validate`, `claude plugin validate` | Repo owner | None | Cross-vendor portability, trivially authored |

**Lessons that matter most (judgment):**
1. Friction-free publishing grows ecosystems (Herdr, shadcn GitHub registries); central human review becomes the bottleneck once agents write plugins (Obsidian's explicit reason for automating).\[28\] Our authors *are* agents, so review must be automated and per-version.
2. Integrity and identity are cheap and high-value; behavioral safety is expensive and never complete (Open VSX's scanner bypass and evil twins passed checks). Invest in identity/provenance/compat evidence, not gatekeeping.
3. Name squatting and dangling references are the dominant registry attack class. Namespaces must be tied to verifiable control (DNS/GitHub/npm scope), and dependency references must resolve at publish time.
4. A stable hook/contract API survives core rewrites (Vite → Rolldown); major-version breaks of a monolithic host API cause attrition (Storybook 10). Version contracts per extension point, not one `engines` range.

## Details

### 1. Extension architecture

**Two distribution modes, one manifest.**

- **Runtime plugins (npm packages).** Embed engines, host adapters, export targets, data connectors, verify checks, review anchor providers, CLI commands. They execute code the core calls, so they need typed contracts and semver. Published to npm with trusted publishing; consumed via the user's package manager.
- **Source packs (copy-source).** Components, templates, themes, artifact starters. Agents need to *edit* these, so ship them as files copied into the artifact project—exactly shadcn's model. Make our pack format a superset of shadcn's `registry-item.json` (add a `toolkit` block) so any shadcn registry item installs unchanged, and `shadcn` itself can consume our packs.
- A single plugin may contain both (e.g., a Remotion adapter: npm runtime package + copy-source composition templates + a bundled `SKILL.md`).

**Contract style per extension point (recommendation):**

| Extension point | Contract style | Lifecycle hooks | Why |
|---|---|---|---|
| Component/template packs | Copy-source registry items + optional typed props metadata | `postInstall` codemod (declared, previewed) | Agents must own and edit code |
| Embed engines (terminal: xterm.js/ghostty-web; foreign-app adapters; Remotion/GSAP adapters) | Typed interface `EmbedEngine` (`mount`, `resize`, `snapshot`, `dispose`, `capabilities`) + manifest declaring licenses of bundled engines | `setup`/`teardown`, capability negotiation | Core must render, screenshot and verify them uniformly |
| Host adapters (storage, events, identity, addressing, trusted controls) | Typed ports (`StoragePort`, `EventPort`, `IdentityPort`, `AddressingPort`, `TrustedControlPort`) with conformance test suite | `init(config)`, `health()`, `close()` | The Rust host and others implement these; conformance > documentation |
| Review anchor providers | Typed `AnchorProvider` (`resolve(anchor)`, `serialize(selection)`) | none | Small, pure, testable |
| Verify checks | Typed `VerifyCheck` returning structured findings (+ screenshot refs) | `run(ctx)` | Machine-readable output for agents |
| Export targets (MCP App, PDF, video) | Typed `Exporter` (`export(artifact, opts) → files`) + declared output MIME (e.g., `text/html;profile=mcp-app`) | `prepare`, `export`, `cleanup` | Deterministic outputs enable baselines |
| Data connectors | Typed `Connector` (`schema()`, `read()`, `subscribe()`, optional `write()`) | `connect`/`disconnect` | Live views need subscription semantics |
| CLI commands | Declared in manifest (name, args schema) → handler module; Herdr-style argv, JSON output mode | none | Discoverable by `--help --json` for agents |

Use Backstage's idea of **blueprints**: the core exports `defineEmbedEngine(...)`, `defineExporter(...)`, etc., each stamping the contract ID and version into the object so the loader can check compatibility without trusting the manifest alone.

**Independent versioning.** Each contract lives in its own package, e.g., `@toolkit/contract-embed-engine@2.3.0`, semver'd separately from the core. Plugins declare `"contracts": { "embed-engine": "^2.1" }`; the core declares which contract majors it implements (and may implement two majors concurrently during migrations). Additive changes are minors; capability flags (`capabilities: ["snapshot", "a11y-tree"]`) cover optional features without a version bump. This is VS Code's `engines` and Herdr's `min_herdr_version` made per-point, with Rolldown's "hook signatures stay backward-compatible" discipline. Overturn condition: if fewer than ~3 extension points see real third-party use after Phase 2, collapse to a single `toolkit` engine range to reduce cognitive load.

**No capability restrictions, but honest disclosure.** Plugins run with the toolkit's privileges (like Herdr, Obsidian, VS Code). The manifest *declares* (not enforces) `effects`: `network`, `filesystem`, `process`, `credentials`, `sendsData`. The registry diff-checks declared effects against static analysis and flags mismatches as facts. The in-scope hygiene is third-party isolation: plugins never get to widen the local server's origin/CORS/token policy; the core owns that.

### 2. Manifest schema sketch

Canonical location: the `"toolkit"` key in `package.json` (npm plugins) or `toolkit-plugin.json` (git-only/source packs). Validated by a published JSON Schema.

```jsonc
{
  "$schema": "https://toolkit.dev/schema/plugin/v1.json",
  "name": "dev.acme/terminal-ghostty",          // reverse-DNS or io.github.<user>/<name>, matches registry namespace
  "displayName": "Ghostty terminal engine",
  "version": "1.4.0",
  "description": "Pixel-exact TUI embeds via ghostty-web",
  "license": "MIT",                               // SPDX expression for the plugin's own code
  "bundledLicenses": [                            // third-party engines the plugin pulls in or requires
    { "package": "ghostty-web", "spdx": "MIT", "class": "osi-permissive" }
  ],
  "contracts": { "embed-engine": "^2.1", "verify-check": "^1.0" },
  "toolkit": ">=0.9 <2",                          // coarse core range, secondary to contracts
  "contributes": {
    "embedEngines": [{ "id": "ghostty", "entry": "./dist/engine.js", "capabilities": ["snapshot", "resize", "true-color"] }],
    "verifyChecks": [{ "id": "tui-golden", "entry": "./dist/check.js" }],
    "cliCommands":  [{ "name": "ghostty:record", "entry": "./dist/cli.js", "argsSchema": "./schemas/record.json" }],
    "sourcePacks":  [{ "registryItem": "./registry/terminal-demo.json" }]
  },
  "effects": ["process"],                         // declared, not enforced
  "platforms": ["macos", "linux"],
  "skills": ["./skills/terminal-ghostty/SKILL.md"],
  "examples": [{ "id": "htop-demo", "path": "./examples/htop", "baseline": "./baselines/htop" }],
  "repository": "https://github.com/acme/toolkit-terminal-ghostty",
  "funding": "https://github.com/sponsors/acme",
  "deprecated": null,                             // or { "reason": "...", "successor": "dev.acme/terminal-ghostty2" }
  "keywords": ["terminal", "tui"]
}
```

TypeScript side (contract packages):

```ts
// @toolkit/contract-embed-engine v2
export interface EmbedEngine {
  readonly contract: "embed-engine@2";
  readonly capabilities: ReadonlySet<string>;
  mount(el: HTMLElement, src: EmbedSource, ctx: EngineContext): Promise<EmbedHandle>;
}
export interface EmbedHandle {
  resize(cols: number, rows: number): void;
  snapshot?(): Promise<{ png: Uint8Array; text?: string }>;
  dispose(): Promise<void>;
}
export const defineEmbedEngine = (e: Omit<EmbedEngine, "contract">): EmbedEngine =>
  ({ ...e, contract: "embed-engine@2" });
```

For the bundled `SKILL.md`, follow the Agent Skills spec verbatim (`name` equals directory name, `description` says what and when, `license` set), so the same skill works in Claude Code, Codex and Copilot.\[60\]\[62\] Skills teach agents *how to use the plugin*; the manifest tells the toolkit *what the plugin is*.

### 3. Registry design

**Architecture (MCP Registry model).** Metadata-only index; code stays on npm (or GitHub for source packs). Records are immutable per version. Publishing proves namespace control: `io.github.<user>/*` via GitHub OIDC/OAuth, reverse-DNS via DNS TXT or HTTP well-known; plus package ownership (the npm package's `toolkit.name` must equal the registry name, mirroring MCP's `mcpName` check). Subregistries (enterprise mirrors, curated lists) reuse the same OpenAPI and record format and may filter or annotate.

**Publish-time checks (automated, every version, à la Obsidian):** schema validity; namespace and package ownership; every `registryDependencies`/plugin dependency resolves (blocks the Extension Resurrection class); name-similarity check against existing namespaces (flag lookalikes of verified namespaces for 72-hour hold rather than reject); provenance fetch; license extraction; malware/static scan via a pluggable scanner whose *failure is a failure*, never "clean" (the Open VSX v0.32.0 lesson).

**Endpoints (v0, freeze as v0.1 before GA):**

| Method & path | Purpose |
|---|---|
| `GET /v0/plugins?q=&point=&contract=&license_class=&compat=&verified=&platform=&cursor=` | Search (lexical + embedding), filterable by extension point, contract major, license class, compat status |
| `GET /v0/plugins/{name}` | Latest record with trust summary |
| `GET /v0/plugins/{name}/versions` / `…/versions/{v}` | Immutable version records |
| `GET /v0/plugins/{name}/versions/{v}/install-plan?core=0.9.3&host=rust-harness` | Resolved plan: packages, copy-source files, license acknowledgments needed, declared effects, compat verdict |
| `GET /v0/plugins/{name}/versions/{v}/compat` | Baseline results matrix (core × contract × OS × browser) |
| `GET /v0/plugins/{name}/skills` | Bundled SKILL.md metadata/body for agent loading |
| `POST /v0/publish` | Authenticated (OIDC from CI preferred) |
| `PATCH /v0/plugins/{name}/versions/{v}/status` | `active` / `deprecated` / `yanked` / `malicious` with reason |
| `GET /v0/feed?since=` | Change feed for mirrors and local caches |
| `GET /llms.txt` | Agent-oriented index of docs and top plugins |

**Agent search ranking (judgment):** rank by contract match and compat-baseline pass with the caller's core version first, then provenance + verified namespace, then recency of maintenance, then usage. Return a compact, token-cheap summary per hit (name, one-line purpose, points, license class, compat badge, trust flags) and require a second call for details—progressive disclosure, as in Agent Skills.

**MCP tool surface (served by `toolkit mcp` and by a hosted MCP server for remote agents such as ChatGPT web/mobile):**
- `plugin_search(query, point?, license_class?, compat_with?)`
- `plugin_inspect(name, version?)` → manifest, effects, licenses, provenance, compat, skill summaries
- `plugin_install_plan(name, version?, project?)` → dry-run diff (files, deps, acknowledgments required)
- `plugin_install(plan_id, accept_licenses?: string[])` → executes; refuses only if a required license acknowledgment is missing
- `plugin_verify(name, example_id?)` → runs the plugin's examples against baselines locally, returns findings + screenshots
- `plugin_list_installed()`, `plugin_update(name)`, `plugin_remove(name)`

Remote-authoring agents without a filesystem call the same tools against the hosted toolkit; the install target is the remote workspace, not the user's laptop.

**Verification baselines and compat badges.** Each plugin ships `examples/` with deterministic inputs plus `baselines/` (DOM snapshot, accessibility tree, screenshot hashes with a perceptual-diff tolerance, exported file hashes for exporters, recorded TTY streams for terminal engines). A toolkit-run "ecosystem CI" (Vite's model) re-runs every listed plugin's examples against each core/contract release candidate across macOS/Linux × Chromium/WebKit/Firefox. Badges are facts with dates: `compat: core 0.9.x ✓ (2026-10-08)`, `compat: core 1.0.0-rc.2 ✗ (snapshot drift)`. Host adapters additionally run the public conformance suite for their port; passing yields `conforms: storage-port@1`. Badges never block install; they drive ranking and warnings.

### 4. Trust without capability restrictions

**Provenance.** Ingest npm Sigstore attestations at publish; show `provenance: verified (GitHub Actions, acme/repo@sha)` or `none`. Note the known limits: CircleCI trusted publishing and private repos produce no provenance, and Mini Shai-Hulud showed trusted publishing alone doesn't stop a compromised CI workflow.\[69\]\[70\]\[91\] So also surface whether the package version went through npm staged publishing (2FA human approval) where determinable, and recommend publishers use stage-only trusted-publishing configurations.\[72\] For source packs from GitHub, record commit SHA and, if present, GitHub artifact attestations. JSR packages published from GitHub Actions carry Rekor-logged provenance and can be ingested the same way.\[78\]

**Verified publishers.** Two tiers: *namespace-verified* (DNS/GitHub proof, immediate) and *verified publisher* (namespace-verified + 2FA-enforced org + ≥90 days of good standing). Unlike VS Code's six-month domain-age gate, keep it attainable for solo maintainers, because the long tail is where agent-authored plugins come from.\[6\]\[8\]

**License metadata at install time.** Require SPDX expressions for the plugin and declared `bundledLicenses`; cross-check against the npm `license` fields of resolved dependencies. Classify into `osi-permissive`, `osi-copyleft`, `source-available`, `proprietary-free`, `commercial`, `unknown`. Use `LicenseRef-*` identifiers for non-SPDX licenses with a registry-hosted summary page (e.g., `LicenseRef-Remotion`, `LicenseRef-GSAP-Standard-No-Charge`). Behavior:
- Interactive CLI: print a one-screen summary ("Remotion: free for individuals, ≤3-employee for-profits, non-profits; Company License required otherwise") and ask once per license per project.
- Non-interactive/agent: install fails with a structured error naming the required acknowledgment; the agent re-runs with `--accept-license LicenseRef-Remotion` (recorded in the project lockfile with timestamp). This is disclosure, not a guardrail: anyone can pass the flag, and the host can pre-accept via policy.
- GSAP-specific note: the toolkit's code-first model and the GSAP FAQ ("AI-generated code is not a 'Prohibited Use'") suggest normal adapter use is permitted, but a plugin that offers a *no-code visual animation builder* on GSAP risks the Prohibited Uses clause.\[82\] Flag that in the GSAP summary page. This is judgment, not legal advice.
- Default packs should prefer OSI-licensed engines (e.g., MIT-licensed xterm.js/ghostty-web, Motion's MIT core) so "beautiful by default" never silently implies a paid license.

**Deprecation, yanking and takeover policy.**
- *Deprecate:* the publisher sets `deprecated` with reason and optional `successor`; search demotes, install warns, and existing installs keep working.
- *Yank:* the version is hidden from resolution and stays fetchable by exact pin (for reproducibility).
- *Malicious:* the registry operator sets it after confirmation; the CLI warns on next run and offers removal (VS Code's block-list idea, but warn-and-offer rather than silently uninstalling, consistent with no-guardrails).\[8\]
- *Abandonment* (Raycast-style): broken against two consecutive core minors *or* no response to 3 contact attempts over 60 days.
- *Takeover:* prefer **forks under the new maintainer's own namespace** with the registry adding a `successor` pointer on the abandoned record. Transfer the original *name* only with the original owner's consent or after 180 days' abandonment plus the npm package's own ownership transfer. Never auto-claim namespaces mirrored from other ecosystems (the Open VSX hijack lesson).
- *Name disputes:* trademark holders with DNS proof can claim reverse-DNS namespaces; `io.github.*` follows GitHub account ownership.

### 5. Ranked recommendations (distribution model for the index)

| Rank | Option | Reasons | What would overturn it |
|---|---|---|---|
| 1 | **Metadata registry (MCP-Registry-style) over npm + GitHub, with toolkit-run compat CI** | Reuses npm provenance and 2026 hardening; namespace verification addresses squatting; cheap to run; subregistries let enterprises curate; agent-friendly API | npm ecosystem trust collapses further (e.g., provenance proven routinely forgeable) → host artifacts ourselves with our own signing |
| 2 | Pure index of a GitHub topic (Herdr-style) | Zero friction; proven growth (1,548 plugins) | Weak identity, no compat evidence, no license metadata; acceptable as an *ingestion source* feeding rank 1 |
| 3 | Hosted, signed store (Grafana/VS Code-style) | Strong integrity; signature levels map well to license classes | Costly human review conflicts with agent-scale authoring; choose this only if an enterprise customer base demands signed artifacts and pays for review |
| 4 | Decentralized namespaces only (shadcn-style `components.json` registries, no index) | No central operator | Agents can't discover anything; keep as a supported *protocol* (any URL registry works), not the primary index |

## Recommendations — Phased marketplace plan

**Phase 0 (now → December 2026): contracts and schema.**
- Publish contract packages for host ports, embed engine, exporter, verify check and connector at `0.x`.
- Publish the manifest JSON Schema v1 and a `toolkit plugin validate` command.
- Make source packs shadcn-item-compatible.
- Write the conformance suite for host ports and run it against the Rust harness adapter first.
- Ship first-party plugins as dogfood: xterm.js and ghostty-web engines, MCP App exporter, PDF exporter, Remotion adapter (with its license flow) and a GSAP adapter.

**Phase 1 (Q1 2027): read-only registry and agent surface.**
- Stand up `GET` endpoints, the change feed, `llms.txt` and MCP tools (`plugin_search`, `plugin_inspect`, `plugin_install_plan`, `plugin_install`, `plugin_verify`).
- Seed the index by ingesting npm packages with a `toolkit` manifest and GitHub repos tagged `toolkit-plugin` (Herdr/Storybook-style auto-indexing).
- Show provenance and license class from day one.
- Freeze API v0.1.

**Phase 2 (Q2–Q3 2027): publishing and evidence.**
- Add namespace verification, OIDC publish, per-version automated checks, ecosystem-CI compat badges, deprecation/yank/malicious statuses, the takeover process and subregistry support (enterprise allowlists).
- Bump contracts to `1.0` once at least two third-party implementations exist per point.

**Phase 3 (Q4 2027+): UI and ecosystem.**
- Build a web gallery rendering live example artifacts (the plugins' own examples) with screenshots from baselines, plus curated collections and "Official"/"verified publisher" labels.
- Optionally list paid/commercial plugins with an external purchase link (Obsidian's "paid" label model) rather than running payments.
- Let hosts embed a host-rendered trusted "plugin installer" control.

**Metrics to watch:** third-party plugins with passing compat baselines; median time from publish to listed; percentage of installs by agents vs humans; percentage of versions with provenance; count of lookalike-namespace flags.

## Caveats

- Several facts come from secondary sources and should be re-checked before committing: CircleCI's trusted-publishing support (from doc snippets); the exact current `shadcn` CLI version (not verified); and whether the MCP Registry has formally reached GA (I found only the v0.1 freeze and continued server releases through v1.8.0).\[46\]\[48\] Remotion's Company License prices ($25/seat/month Creators, $100/month Automators minimum, $500/month Enterprise minimum) and ghostty-web's MIT license are now confirmed from primary sources (remotion.pro/terms; the coder/ghostty-web repo and package.json).
- Remotion's licensing pages reference upcoming v5 terms; re-verify thresholds before release.\[92\] GSAP's license is amendable by Webflow at any time (prior versions remain usable under prior terms).\[82\]
- Ghostty 1.4 and a tagged libghostty release were not confirmed as of this research; treat a libghostty-native engine as experimental.
- Declared `effects` are honesty signals, not security; a malicious plugin can lie. Static analysis narrows but does not close that gap, as the Open VSX campaigns show.
- Timelines in the phased plan are judgment, sized for a small core team.

## Sources

1. [ui/skills/shadcn/registry.md at main · shadcn-ui/ui](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/registry.md)
2. [Namespaces - shadcn/ui](https://ui.shadcn.com/docs/registry/namespace)
3. [Shadcn Registry Guide: Setup, Schema, CLI](https://tailkits.com/blog/shadcn-registry/)
4. [May 2026 - Registry Include and Validate - shadcn/ui](https://ui.shadcn.com/docs/changelog/2026-05-registry-include)
5. [June 2026 - GitHub Registries - shadcn/ui](https://ui.shadcn.com/docs/changelog/2026-06-github-registries)
6. [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
7. [Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
8. [Extension runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
9. [Open VSX Flaw Allowed Malicious VS Code Extensions to Bypass Security Checks - CXO Digitalpulse](https://www.cxodigitalpulse.com/open-vsx-flaw-allowed-malicious-vs-code-extensions-to-bypass-security-checks/)
10. [Open VSX Bug Let Malicious VS Code Extensions Bypass Pre-Publish Security Checks](https://thehackernews.com/2026/03/open-vsx-bug-let-malicious-vs-code.html?m=1)
11. [77 Open VSX extensions found harvesting developer info](https://www.bleepingcomputer.com/news/security/77-open-vsx-extensions-found-harvesting-developer-info/)
12. [77 "evil twin" Open VSX extensions: 19 copy private repo and CI data to a new domain - Manifold Security](https://www.manifold.security/blog/open-vsx-evil-twin-extensions)
13. [Open VSX](https://en.wikipedia.org/wiki/Open_VSX)
14. [Vite 8 Beta: The Rolldown-powered Vite](https://vite.dev/blog/announcing-vite8-beta)
15. [Vite 8.0 is out!](https://vite.dev/blog/announcing-vite8)
16. [Announcing Rolldown 1.0](https://voidzero.dev/posts/announcing-rolldown-1-0)
17. [Addon migration guide for Storybook 10.0](https://storybook.js.org/docs/addons/addon-migration-guide/)
18. [Storybook 10 support · Issue #32774 · storybookjs/storybook](https://github.com/storybookjs/storybook/issues/32774)
19. [GitHub - storybookjs/addon-kit: Everything you need to build a Storybook addon · GitHub](https://github.com/storybookjs/addon-kit)
20. [Storybook 10 support · chakra-ui/chakra-ui · Discussion #10405](https://github.com/chakra-ui/chakra-ui/discussions/10405)
21. [Raycast Extension Development](https://deepwiki.com/enuno/claude-command-and-control/10.3.1-raycast-extension-development)
22. [raycast/extensions](https://deepwiki.com/raycast/extensions)
23. [Prepare an Extension for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store)
24. [File Structure](https://developers.raycast.com/information/file-structure)
25. [Extensions Guidelines](https://manual.raycast.com/extensions-guidelines)
26. [How the Raycast API and extensions work - Raycast Blog](https://www.raycast.com/blog/how-raycast-api-extensions-work)
27. [Obsidian Community - Sébastien Dubois](https://www.dsebastien.net/obsidian-community/)
28. [The future of Obsidian plugins - Obsidian](https://obsidian.md/blog/future-of-plugins/)
29. [The future of Obsidian plugins](https://app.daily.dev/posts/the-future-of-obsidian-plugins-zbgltgurm)
30. [The future of Obsidian plugins](https://x.com/obsdmd/article/2054234821875146898)
31. [Obsidian Plugin Updates: A Safe 2026 Workflow](https://www.obsibrain.com/blog/obsidian-plugin-updates-safe-workflow/)
32. [Best Obsidian Plugins for 2026: Picks by Workflow](https://www.obsibrain.com/blog/top-obsidian-plugins-in-2026-the-essential-list-for-power-users/)
33. [Sign a plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin)
34. [Plugin signatures](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-sign/)
35. [Grafana Kafka Plugin and Plugin Signatures: Meetup Recap](https://lucaberton.com/blog/grafana-and-friends-amsterdam-2025-kafka-plugin/)
36. [Plugin Signing Process](https://deepwiki.com/grafana/database-plugin-tools/3.1-plugin-signing-process)
37. [Frontend Plugins](https://backstage.io/docs/frontend-system/architecture/plugins/)
38. [Backstage logbook: Migrating the Catalog Plugin to the New Frontend System - DEV Community](https://dev.to/sarabadu/backstage-logbook-migrating-the-catalog-plugin-to-the-new-frontend-system-f6)
39. [backstage/docs/frontend-system/building-plugins/05-migrating.md at master · backstage/backstage](https://github.com/backstage/backstage/blob/master/docs/frontend-system/building-plugins/05-migrating.md)
40. [Frontend Extension Blueprints](https://backstage.io/docs/frontend-system/architecture/extension-blueprints/)
41. [backstage/docs/frontend-system/building-plugins/01-index.md at master · backstage/backstage](https://github.com/backstage/backstage/blob/master/docs/frontend-system/building-plugins/01-index.md)
42. [Herdr: the runtime coding agents run on](https://herdr.dev/)
43. [Plugins](https://herdr.dev/docs/plugins/)
44. [A practical guide to Herdr plugins - Flavio Copes](https://flaviocopes.com/herdr-plugins/)
45. [Marketplace](https://herdr.dev/docs/marketplace/)
46. [GitHub - modelcontextprotocol/registry: A community driven registry service for Model Context Protocol (MCP) servers. · GitHub](https://github.com/modelcontextprotocol/registry)
47. [update to recent MCP registry specification changes · Issue #643 · openkaiden/kaiden](https://github.com/openkaiden/kaiden/issues/643)
48. [Releases · modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry/releases)
49. [Evolution of AI Agent Registry Solutions: Centralized, Enterprise, and Distributed Approaches](https://arxiv.org/pdf/2508.03095)
50. [Building an MCP Registry: Why It Matters and How to Get It Right](https://obot.ai/blog/building-an-mcp-registry-why-it-matters-and-how-to-get-it-right/)
51. [Registry FAQ](https://modelcontextprotocol.info/tools/registry/faq/)
52. [Publish Your MCP Server](https://modelcontextprotocol.info/tools/registry/publishing/)
53. [SEP-1865: MCP Apps - Interactive User Interfaces for MCP - Model Context Protocol](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
54. [SEP-1865: MCP Apps - Interactive User Interfaces for MCP · Issue #1431 · modelcontextprotocol/csharp-sdk](https://github.com/modelcontextprotocol/csharp-sdk/issues/1431)
55. [ext-apps/specification/2026-01-26/apps.mdx at main · modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
56. [MCP Apps: Interactive UI, Architecture & Security Guide](https://mcpblog.org/mcp-apps/)
57. [MCP Apps in 6 steps: build a server-rendered UI on MCP](https://ecorpit.com/mcp-apps-server-rendered-ui-extension-build-guide-2026/)
58. [MCP Apps made HTML the official UI of agents. Where does that HTML live? · Stacktree](https://stacktr.ee/blog/mcp-apps-html-ui)
59. [What Are Agent Skills and How To Use Them](https://strapi.io/blog/what-are-agent-skills-and-how-to-use-them)
60. [Specification - Agent Skills](https://agentskills.io/specification)
61. [Agent Skills — Specification (agentskills.io)](https://www.beri.net/learning/agentskills-io-specification)
62. [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills)
63. [Agent Skills: The Open Standard for AI Capabilities](https://inference.sh/blog/skills/agent-skills-overview)
64. [Marketplace reference - Claude Code Docs](https://code.claude.com/docs/en/plugins/marketplace-reference)
65. [GitHub - hesreallyhim/claude-code-json-schema: Unofficial JSON Schema definitions for Claude Code, including plugins and marketplaces · GitHub](https://github.com/hesreallyhim/claude-code-json-schema)
66. [Build Your Own Claude Code Marketplace: Scaffold, Structure, and Auto-Updates - DEV Community](https://dev.to/nagell/build-your-own-claude-code-marketplace-scaffold-structure-and-auto-updates-4n3f)
67. [npm to Implement Staged Publishing After Turbulent Shift Off Classic Tokens](https://socket.dev/blog/npm-to-implement-staged-publishing)
68. [Revised npm Security Timeline Based on Your Feedback · community · Discussion #178140](https://github.com/orgs/community/discussions/178140)
69. [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
70. [npm trusted publishing with OIDC is generally available - GitHub Changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
71. [npm staged publishing now supports creating new packages - GitHub Changelog](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/)
72. [Staged publishing and new install-time controls for npm - GitHub Changelog](https://github.blog/changelog/2026-05-22-staged-publishing-and-new-install-time-controls-for-npm/)
73. [Multiple trusted publishing configurations for npm - GitHub Changelog](https://github.blog/changelog/2026-09-03-multiple-trusted-publishing-configurations-for-npm/)
74. [Stage-only npm tokens for safer automation - GitHub Changelog](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation/)
75. [npm Trusted Publishing Now Supports Up to 10 OIDC Configurations Per Package](https://aicybr.com/blog/npm-multiple-trusted-publishing-oidc-configurations)
76. [npm-audit](https://docs.npmjs.com/cli/v10/commands/npm-audit/)
77. [npm provenance attestations walkthrough 2026](https://safeguard.sh/resources/blog/npm-provenance-attestations-walkthrough-2026)
78. [Provenance and trust - Docs - JSR](https://jsr.io/docs/trust)
79. [License & Pricing](https://v3.remotion.dev/docs/license)
80. [Open-Source Remotion Alternatives: Is Free Really ...](https://autoae.online/blog/open-source-remotion-alternatives-2026)
81. [remotion/LICENSE.md at main · remotion-dev/remotion](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
82. [Standard License](https://gsap.com/community/standard-license/)
83. [Webflow makes GSAP 100% free](https://webflow.com/updates/gsap-becomes-free)
84. [gsap-standard-no-charge-2025 - ScanCode LicenseDB](https://scancode-licensedb.aboutcode.org/gsap-standard-no-charge-2025.html)
85. [Releases · xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/releases)
86. [xtermjs/xterm.js 6.0.0 on GitHub](https://newreleases.io/project/github/xtermjs/xterm.js/release/6.0.0)
87. [@xterm/xterm - npm](https://www.npmjs.com/@xterm/xterm)
88. [xterm - npm](https://www.npmjs.com/package/xterm)
89. [GitHub - ghostty-org/ghostty: 👻 Ghostty is a fast, feature-rich, and cross-platform terminal emulator that uses platform-native UI and GPU acceleration.](https://github.com/ghostty-org/ghostty)
90. [1.3.0 - Release Notes](https://ghostty.org/docs/install/release-notes/1-3-0)
91. [npm Invalidates Granular Access Tokens as Mini Shai-Hulud Sweeps the Registry](https://socket.dev/blog/npm-invalidates-tokens-mini-shai-hulud)
92. [Is Remotion Free? License and Pricing Explained (2026)](https://autoae.online/blog/is-remotion-free)
