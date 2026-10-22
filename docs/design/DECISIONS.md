# Mostra decision record

**Authority:** Mirza's decisions in the design conversation of 2026-10-09 and 2026-10-10. This file is the single source of truth for what was decided and why. [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [REQUIREMENTS.md](REQUIREMENTS.md) cite these IDs and work out their consequences. They don't restate the rationale.

**Status labels** follow [STANDARDS.md](STANDARDS.md#decision-labels). Every decision below is an **approved decision** unless its entry says otherwise. Mirza closed the round with this statement at **2026-10-10T07:05:13.203Z**: "Yes to everything. Nothing I want to add, change or reject."

## Source messages

| Ref | Time (UTC) | What Mirza said |
|---|---|---|
| M1 | 2026-10-09T15:47:18.227Z | Asked whether C03 can start while C02 is in progress. Wants the C03 tools to be "rather independent, third-party-like tools" that work elsewhere: "a modular system", "highly pluggable, very modular, flexible", "a separate repository, so that other people, other harnesses, other projects can use it too". C03 has two parts: designing the tool, then integrating it natively into Jcode after C02, "without having to make any changes to the tool itself". |
| M2 | 2026-10-09T16:23:33.180Z | Set the process (read, discuss, research, settle, wait for C02/WP-01, update program docs, then start C03-A, which "neither needs to read any jcode_program files, nor does it have to edit them"). Opened the product discussion: React-based, "no restrictions, strict shape, rigid boundaries", and the capability list in D08. On safety: "Safety of this is not this tool's concern. Don't implement/plan unnecessary guardrails that will simply reduce the quality of our tool". "Infinite capability." The goal is a tool good enough that "it goes viral". |
| M3 | 2026-10-10T05:48:06.596Z | Approved the first positions. Added: one submit usually carries everything, while the client application decides what each event triggers; the use cases in D11; remote hosting and remote agents, possibly a revenue stream; leaning against hot reload ("an incomplete artifact is not really useful"); plugins and a public marketplace. Answered: hygiene stances approved; public repository; remote viewing important ("Tailscale ... but also remote hosting in a simple quick easy way", else tunnels for v1); any npm package on demand left to the designer ("I guess yeah?"). |
| M4 | 2026-10-10T06:47:17.597Z | Answered the nine questions: positioning yes; viewing model yes; interaction model yes; runtime stack "sounds good" with RSC conditions (D19); remote scope "sounds good"; license delegated ("I trust your judgement"); interface priority "sounds excellent"; shadcn base settled in C03-A, "how about both"; name delegated. |
| M5 | 2026-10-10T07:05:13.203Z | "Yes to everything." Approved the RSC plan, multi-base shadcn, the name Mostra, the v1 scope, the C03-A home and standards, and the license acknowledgment flow. Asked for thorough documents in which nothing discussed is missed. |
| M6 | 2026-10-10T10:07:56.180Z | C03-A round 1. Confirmed agent evaluations with an ask-first rule, OAuth only, a mostly-GPT model mix and token-based cost reports. v1.0 explicitly excludes Windows. Approving a WP approves all of its publication. Postpone or cheapen the domain; created the GitHub org `mostra-dev`; npm org next. Delegated addressing (Q5) and secrets details. Approved Q6 to Q13, the round-1 defaults and the tooling stack, and asked that version-churn guidance cover every tool with a recent major. Added four working notes: ask him for anything, install any tool, use only the `fast-worker` sub-agent, and establish strong repository standards from the start. |
| M7 | 2026-10-10T10:59:01.070Z | C03-A round 2. Confirmed D34 as stated. Evaluations run in small batches, starting with a single call to find bottlenecks, then two or four at a time so a shared 5-hour usage limit isn't exhausted mid-batch; possibly two accounts; Claude runs to be discussed when ready; choose Codex or Jcode deliberately. Delegated Q2 to Q4 and approved Q5 to Q14, trusting C03-A's judgement throughout. Added a note: long-lived artifacts (a 24/7 personal dashboard, a company dashboard, an AI task manager) must be supported as fully as one-off artifacts, possibly with changes to submit and drafts. |
| M8 | 2026-10-10T12:41:03.402Z | C03-A rounds 3 and 4. Confirmed the long-lived additions (D63) and direct npm publishing "in a robust and enterprise-grade way"; approved round 3 ("I trust your judgement"). Shell prototype accepted as a direction; artifact design must be unlimited and up to the authoring agent, with a baseline that makes even a weak agent's output beautiful and lets a frontier model customize everything. Skill trigger: "The agent wants to visually communicate to/with the user." |
| M9 | 2026-10-10T14:55:06.757Z | Design approval. Q1: "Approved!" (the complete design, including D70 to D72 and the 27 work packages). Q2: WP-14 accepted as the planned C03-B threshold; "It's okay if this threshold moves to a later WP." Q3: approved a Claude check of EVAL-01 ("we can run it now"), asking first which harness it uses so he can sign in the right OAuth account. Q4: confirmed drafting the agent-facing prose in the WPs that build it. |
| M10 | 2026-10-10T15:11:53.172Z | Signed in Claude Code for EVAL-01b ("you can run the sonnet prompts"). GitHub: "i approve everything needed that we planned for git/github related stuff. you can create & push the repo, and the wp-01 agent can work on it in any way needed." |
| M11 | 2026-10-10T18:49:28.119Z | WP-01 questions. Approved the Crockford alphabet for version IDs ("I trust you to make the most robust decision"), the first host protocol revision `2026-10-10`, protected `main` with no bypass, installing Renovate himself, and the REPO_STANDARDS §4 correction. Contact address mmirzabicer@gmail.com; his surname is Biçer ("c" is fine for compatibility). Delegated the agent-facing prose and asked that branch protection, pull requests, CI and publishing all be done "in the **best** manner possible", acting where possible and instructing him otherwise. |
| M12 | 2026-10-10T19:49:22.550Z / 20:07:46.058Z | Accepted WP-01. Left the pre-merge review to the agent's judgement: `codex review` with GPT-6.1-Sol, GitHub Copilot review (integrated into CI if GitHub allows), or neither, and asked that future WPs build reviews into CI or the documented workflow. Claude Opus 5.5 may review truly substantial packages, at most 20% of Mostra's WPs. Copilot review may need organization credits; not important. |
| M13 | 2026-10-11T04:37:16.061Z | WP-02 questions. The C03-A design expert answered at Mirza's request (his message of 2026-10-11T04:32:46.030Z), and Mirza agreed with every point: the ledger lock as the home's authority, with `instance.json` for discovery and a self-healing socket; the XDG fallback with a `MOSTRA_RUNTIME_DIR` override; the socket name; one JSON-RPC core in `@mostra/protocol` without batches; the `mostra/initialize` shapes with `HomeConfig.path` as a check; the runtime binary and module layout; the `integration` CI job; signal handling and `mostra/shutdown` for attached clients, with idle exit left to WP-08; and a prose review limited to five hints and `packages/runtime/AGENTS.md`. These fill gaps and change no approved decision. |
| M14 | 2026-10-11T11:52:42.559Z | WP-03 questions. Delegated the version-identity collision, the publish receipt's URL before the gateway (asking that every change later packages must make be noted where those packages will see it), the warm-set package, the diagnostic area for artifact lookups and the check boundaries, each with "I trust you to make the most robust … good-engineering decision". Confirmed that the gated child launcher (issue #7) belongs in WP-03 and that WP-02 left it out of the specification. Delegated the agent-facing prose, to be brought for review only where the agent isn't confident, at the very end before the merge. |
| M15 | 2026-10-13T16:02:32.247Z | WP-04 questions. Delegated all eight (the installer's pnpm line, where the working lockfile lives, `mostra add` before the CLI exists, a release-age cooldown, lifecycle scripts, offline mode and the policy, the warm set's form, the prose review) with "I trust you to make the most robust … good-engineering decision". Asked why pnpr is excluded, and accepted pnpm 10 provided it costs no robustness, quality, performance or capability. No one uses the CLI before WP-15, so a CLI command may arrive later. Prose comes to him only where the agent isn't confident. |
| M16 | 2026-10-14T09:17:25.908Z | WP-05 questions. Delegated all ten with "I trust you to make the most robust, appropriate, high-quality, enterprise-grade … good-engineering decision": the check boundaries for the `mostra doctor` warning, MCP over HTTP and `mostra dev`; the `action:*` scope; rotation; the `viewer` parameter; the URL and session shape; framing ("Brilliant catch!"); one version per browser and artifact origin; the bind flag. Asked that every split between packages costs no robustness and never limits the later package. The Claude Opus review is decided at the end of the package. |
| M17 | 2026-10-14T19:33:32.530Z | WP-05's Claude Opus review (13 findings). Delegated all three questions with the same words: a link that names a version opens only that version; the frame can't navigate the viewer's tab, with `ui/open-link` instead; signals need a scope of their own. Asked for the balance between robustness, quality, capability and good code on one side and security on the other. |
| M18 | 2026-10-15T08:07:02.531Z | WP-06 questions. Delegated all eight (check boundaries, the policy in force, epochs, views, the `viewer` parameter, delivery owners and mirrors, prose, the first browser-protocol revision) with "I trust you to make the most robust, appropriate, high-quality, enterprise-grade, top-notch, well-fit, well-thought and considered, reliable, future-proof and foolproof, well-informed, good-engineering decision", and asked that each be brainstormed meticulously. |
| M19 | 2026-10-15T12:39:18.647Z | WP-07 questions. Delegated all eight (the channel policy's source, the orphan model, defaults the viewer saw, check boundaries, prose, the Claude review, `window.storage` limits, Choose's candidates) with "I trust you to make the most robust … optimal decision", asking for the most robust, highest-capability choice in each. Raised the Claude Opus review limit to ten of Mostra's packages. Rules aren't frozen: one that is unnecessary or significantly limits capability can be discussed. Work that later packages build on is done so it helps them as a baseline and never limits them. |
| M20 | 2026-10-16T14:50:33.927Z | Handed over the plan update he approved in his planning work of 2026-10-16, for one documentation session before WP-08. v1 gains a remote server and a relay, with a managed service's operating layer kept outside this repository; license layers (an Apache-2.0 core, a source-available `ee/` folder, a proprietary operating layer); anonymous telemetry in the standalone CLI, never in embedded use; team features; Windows and the terminal packages follow the first release as `v1.1`; new package specifications fix the surface and the options, and implementing sessions settle the details; new packages WP-28 to WP-32; Mostra's business context lives in a private repository, Mostra HQ. Recorded as D116 to D127. |
| M21 | 2026-10-16T15:56:46.921Z | Accepted the plan update (D116 to D127) and its agent-facing prose ("100% approved"), with two changes: sessions explore Mostra HQ through a sub-agent, then read needed files themselves; and they summarize the earlier progress reports with sub-agents instead of reading each one, keeping the choice to read the latest report themselves. Recorded as D128. |
| M22 | 2026-10-16T16:59:49.389Z | WP-08 questions. Delegated all twelve (the synchronous `secret()`, the worker channel and version reference, the browser protocol's additions, run states with `waiting` reserved, streamed results, re-attaching by key, the limits, secrets, lazy artifact listeners, the daemon's lifecycle and login service, issue #8, the parked notice) with "I trust you to make the most robust, appropriate, high-quality, enterprise-grade, top-notch, well-fit, well-thought and considered, reliable, future-proof and foolproof, well-informed, good-engineering, optimal decision" (his shorthand `<ITU/>`). Recorded as D129 to D134. |
| M23 | 2026-10-17T09:01:30.190Z | WP-08's open question on server code's packages: "Absolutely. I completely agree -- let's fix it in WP-08, _in the most robust, high-quality, complete, meticulous, enterprise-grade_ manner." Accepted the parked notice's wording. Recorded as D135. |
| M24 | 2026-10-17T11:51:05Z | Two requirements for the remote design: a hosted page must not be able to plant or override another page's sign-in on the user-content domain before that domain is a public suffix ("Let's indeed talk about this, research, contemplate and make a decision (or add robust instructions so that the relevant agent does so)"), and the user-content domain is configuration so new links can move to a spare ("Yes, sounds good, this is important!"). Recorded as D137. |
| M25 | 2026-10-17T12:26:33.061Z | WP-09 questions. Approved all twelve recommendations with additions and one replacement: the verify target is injected when served, the harness uses the real route table and session flow, real secrets read-only, empty state, gated workers and run directories removed; a skipped action rejects and the faults it causes are attributed; more errors (error boundaries, manifests, dependencies, timeouts, environment), the failed-request, blank-page, duplicate-ID and unstable-ID rules, axe impacts, more warnings and hints; a recorded verdict summary decides "passed", deterministic renders; rebuild-on-miss instead of re-stamping the version ID; no cached verdict with environment or timeout codes; the 120 s limit after compile; `--force` can't publish what didn't build; exact type-check settings; token formulas; `playwright-core` and axe-core injected directly; a Claude Opus review; hints of warning-level smoke and regression codes shown to him. Recorded as D138. |
| M26 | 2026-10-17T22:47:48.705Z | WP-09's two open points after the Claude Opus review: the type check's configuration (amend D138 item 8 or keep it) and the wording of the seven warning-level smoke and regression hints. Delegated both with `<ITU/>` ("I trust you to make the most robust … optimal decisions"). Recorded as D139. |
| M27 | 2026-10-17T23:47:43.836Z | WP-10's assignment, with two addenda on telemetry consent (public-safe): ask first where the machine's time zone is in the EU, EEA, UK or Switzerland, or is UTC or unknown (no pre-selected yes; no TTY means nothing is sent until the enable command runs, with the notice once on stderr); on by default elsewhere; the time zone checked locally and never sent; `DO_NOT_TRACK=1` always wins; embedded use sends nothing. The reason: the EDPB's Guidelines 2/2023 (v2.0, 7 October 2024), paragraph 33, put software that proactively calls an API endpoint within Article 5(3) of the ePrivacy Directive, so usage analytics needs prior consent there. Starting proposals for D119's deferred choices: one random install ID, JSON mode as non-interactive, `mostra telemetry on\|off\|status` and `MOSTRA_TELEMETRY`, an event list, harness detection, no live endpoint in this package, the notice text. Recorded with M28 as D140. |
| M28 | 2026-10-18T00:42:02.436Z | WP-10's nine questions and two findings: "Go with your recommendations, with the changes and additions below", with the telemetry decision order, storage, sending, schema and time-zone rules, `mostra dev` as a protocol feature with verify-grade session security, `daemon restart` and `uninstall` and a `CLI` diagnostic area, gc tombstones instead of row deletion, `view/default` and one-time launch tickets, the `--json` envelope, `mostra docs`, the approved notice, question, status and docs-page wording, and the reviews (Claude Opus as the seventh of ten). Recorded as D140. |
| M29 | 2026-10-18T13:45:08Z / 13:59:11Z | Chose a visual direction for Mostra (Italian modernism, "Mostra!") and asked for it to be refined rigorously. Then approved the three open calls on the refined draft: "I agree with your recommendation on all three." The answer dot appears only on the app icon and in big moments, Figtree is the interface face, and the default artifact theme stays as quiet as shown. Recorded as D141. |
| M30 | 2026-10-19T11:36:46.506Z | WP-11's twelve questions (the release version line, who opens the release pull request, the npm account steps, RT-01's check without a global Node.js, `npm create mostra`'s behavior, where bundles live, the first release's timing, the telemetry endpoint, `ee/`, prose, reviews, CI): "For every decision point, I trust you to make the most robust, appropriate, high-quality, enterprise-grade, top-notch, well-fit, well-thought and considered, reliable, future-proof and foolproof, well-informed, good-engineering, optimal decision." Recorded as D142. |
| M31 | 2026-10-21T00:15:19.500Z | WP-12's seven questions (which ports WP-12 builds and which move to the packages that consume them, the `identity` port's semantics, how the kit drives a host under test, browser-driven shell scenarios, the first crates.io release, receivers of newer enum values, reviews and prose): "For every decision point, I trust you to make the most robust, appropriate, high-quality, enterprise-grade, top-notch, well-fit, well-thought and considered, reliable, future-proof and foolproof, well-informed, good-engineering, optimal decision." Recorded as D143. |
| M32 | 2026-10-21T18:14:18.572Z | Accepted WP-12 ("100% approved"), approved its Claude Opus review, and removed the limit on Opus reviews: "this is an important project with big PRs and very important & complex & enterprise-grade implementation work, so every WP deserves an Opus review." Recorded as D144. |
| M33 | 2026-10-22T09:40:00Z | Approved, as part of a set of planning recommendations ("I basically approve everything"), that the remote design pass keep the hosted shell's framing configurable so a later embed mode needs no migration. Recorded as D145. |
| M34 | 2026-10-22T12:01:05Z | Approved native Windows before the first release, built right after WP-12: "Yes, sure. We can call them WP-W1...Wn, I guess n would be something around 2-4." Recorded as D146. |
| M35 | 2026-10-22T19:40:24Z | Accepted a set of recommendations ("All as recommended"), among them: harness plugins built to pass the plugin directories' review on the first scan; an MCP server that a harness plugin starts counts as embedded use and sends no telemetry; agent-facing prose accepted in one batch at the end of each package. Recorded as D147 to D149. |

## Program-level decisions

### D01. A standalone toolkit, integrated later
Mostra is an independent product in its own repository. Any agent harness or application can use it. Jcode is one host among many. Integrating Mostra into Jcode must not require changes to Mostra itself, so host-specific needs enter only through Mostra's public host ports and protocol. *Source:* M1, M5. *Consequence:* every Jcode need in [JCODE_HOST.md](JCODE_HOST.md) has to be expressible through generic ports.

### D02. Two units: C03-A and C03-B
In Mirza's Jcode program, SP-58-C03 splits into **C03-A**, the Mostra toolkit (this seed), and **C03-B**, native Jcode integration. C03-A runs now, in parallel with SP-58-C02. C03-B starts after C02 is complete and consumes a pinned Mostra release. *Source:* M1 proposal, M2 process, M5. *Rejected:* building C03 as Jcode-internal code (not reusable), and waiting for C02 before starting any C03 work (wastes the parallel window).

### D03. C03-A works from this seed only
C03-A doesn't read or edit Mirza's `jcode_program` corpus beyond this seed folder. The seed carries everything it needs: decisions, product, architecture direction, requirements, standards, the Jcode host brief and the research. Once the Mostra repository exists, its copy of these documents becomes the authority and the seed becomes a historical record. *Source:* M2, M5.

## Product decisions

### D04. Ordinary React
Agents write ordinary React and TypeScript, with MDX for document-heavy work. Mostra defines no custom language, no rigid schema the agent must fill in and no closed component list. Every bundled component can be replaced by arbitrary code. *Source:* M2. *Rejected:* declarative catalogs such as A2UI or json-render as the authoring model. They are acceptable only as optional guest formats inside an artifact.

### D05. Maximum capability
Mostra adds no content or capability guardrails. What an artifact does, including real side effects such as sending email, is the responsibility of the agent and the application that use Mostra, in the same way curl doesn't police URLs. Features are never weakened to prevent misuse. *Source:* M2. *Boundary:* D06 is not a guardrail. Abuse handling on a future public multi-tenant hosted service is an operator duty of that service (D12), not a toolkit restriction.

### D06. Hygiene that restricts strangers, not users
Two stances, approved together:
1. **Only the holder of an artifact's capability URL can use it.** Mostra binds to loopback by default and uses Jupyter-grade protection: an unguessable token exchanged for a scoped cookie, exact Host and Origin checks, CSRF protection and no permissive CORS. This keeps unrelated websites from driving a user's local artifact (for example, pressing its "Send" button). It doesn't limit the agent or the user.
2. **An optional trusted-controls slot.** A host may render its own controls (submit, approve, choose) in a trusted origin outside agent-authored content. Mostra offers the slot and enforces nothing. Hosts that need provenance, such as Jcode, use it. Others ignore it.

*Source:* M3 answer 1.

### D07. Positioning: an agent artifact runtime
Mostra is "the agent artifact runtime". It sits one layer below "generative UI": agents write normal software, and Mostra supplies durable human input, real actions, review, presentation, live data, exact terminal demos, verification for agents who can't see the browser, and host integration. One artifact has **three delivery targets**: a local full page, an inline MCP App in chat hosts, and a static or hosted page. Mostra compiles to MCP Apps and doesn't compete with it. *Source:* M4 answer 1. *Rejected positions:* an MCP-Apps-only framework (crowded and capped by chat iframes), a hosted Claude-Artifacts clone, a declarative UI framework, and another AI app builder.

### D08. What agents must be able to make
The capability catalog from M2, all in scope:
- Dashboards, many kinds of plots and other data presentation, interactive elements and demos.
- Motion graphics and animations embedded in pages, optionally interactive.
- Demos of any kind. TUI demos must show exactly what the program looks like in a terminal (for example, a real ratatui app rendered on the page). Web demos may use React, HTML, Angular or any framework, embedded as real working pages however the agent wishes.
- Interactive inputs stored server-side: questionnaires, forms and anything else. They integrate with everything else on the page. Example: the agent builds three demos, the human browses them, picks one, and comments on the one picked.
- Real data, local or online, including live API data that updates as it changes.
- Elements with real actions authored by the agent. Example: a personal assistant's morning inbox dashboard. Each email has an expandable pre-drafted reply that the human edits, then a "Send" button the agent built sends it.
- "Many more" that nobody has thought of yet. The extension system (D30) carries this.

*Source:* M2.

### D09. Users only see published versions
The human sees only published, immutable versions. There is no interactive hot reload in the human's view. The agent iterates privately, checking its work through `verify` and headless screenshots. When the agent publishes a new version while the human is viewing an older one, the page shows a "new version available" banner, and the human switches when they choose. Draft input carries over through stable field IDs. Hot module reload survives only as an optional developer tool. *Source:* M3 (hot reload "might cause bugs", "an incomplete artifact is not really useful"), M4 answer 2. *Consequences:* Vite acts as a builder in the human path, binding a submission to the version shown becomes trivial, and the research's "rendered revision during HMR" race disappears.

### D10. Interaction model
1. **Draft state accumulates.** Answers, interactive state, choices and comments save to the server as the human works, sync across tabs, and are delivered together. Comments are part of the draft, so they arrive alongside everything else.
2. **An event log records every durable change.** Hosts subscribe with filters and decide what an event triggers. Mostra never decides on its own that an event wakes an agent.
3. **Signals.** Submit is the standard signal. Artifact authors may define further non-terminal signals, such as a "Ping the agent" button. Hosts map signals however they choose.
4. **Submission policy is per host:** `once` (exactly one immutable submission, which Jcode uses) or `epochs` (repeatable, each epoch an immutable, linked submission).

*Source:* M3 ("most of the time, I would want to submit once ... the client ... would decide what triggers something from that event"), M4 answer 3.

### D11. Waiting on submission works everywhere
Every interface supports waiting for a submission: the CLI (`mostra wait <id> --until submitted --timeout <d>`), MCP (a long-polling wait tool that returns `still_waiting` on timeout), the SDK and the host protocol. Submissions are always persisted and readable later (`mostra results <id>`), so a timeout loses nothing and "I submitted, please check" always works. The use cases this serves:
- **Jcode:** the agent declares a wait on the artifact. Submit (for example "Submit & Send") ends the wait.
- **Codex, Claude Code and similar agents** use the CLI or MCP server.
- **ChatGPT and other chat products.** Inline MCP Apps work now. Agents without a filesystem need remote mode (D12).

*Source:* M3.

### D12. Remote scope and the release ladder
- **v1, local-first.** Local viewing plus a remote-viewing ladder: Tailscale Serve (tailnet-only, identity headers); a quick public share through Tailscale Funnel or a Cloudflare quick tunnel, behind an explicit flag and a capability token; and static export of client-only artifacts to any static host. v1 also builds the **remote-mode seams**: portable artifact packages, storage, identity and addressing ports, a worker-isolation interface and a stateless MCP design.
- **v1.x, remote mode.** A self-hostable remote server for agents without a filesystem. It provides a remote MCP server over Streamable HTTP with OAuth (CIMD, DCR and refresh tokens), revisioned file-push and patch authoring, server-side build and verify jobs, a `SandboxPort` and wildcard per-artifact origins.
- **Later: a managed cloud service.** A separate product and the revenue path. It may run on proprietary control-plane code (D14) and owns the operator duties of public hosting: abuse handling, a separate user-content domain and free-tier limits.

*Source:* M3 answer 3 and remote-agent comments, M4 answer 5. *Amended by D116:* the remote server, the relay and the remote MCP server move into v1; sandboxed remote execution stays v1.x; the managed service's operating layer lives outside this repository.

### D13. Public repository
The Mostra repository is public. *Source:* M3 answer 2. *Note:* creating the public repository, organizations and domains are account actions that Mirza performs or approves (see [STANDARDS.md](STANDARDS.md#consequential-actions)).

### D14. License
Apache-2.0 for everything users install, embed or self-host: libraries, runtime, CLI, MCP server, self-host server, plugin contracts and first-party plugins. Contributions use the DCO (sign-off), not a CLA. Only a future managed cloud's multi-tenant control plane may be proprietary. The business is protected by trademark, hosting quality and network effects, not by license terms. *Source:* M4 answer 6 (delegated), research briefs 1, 6 and 7. *Rejected:* MIT (no explicit patent grant), FSL, BSL, ELv2 and AGPL for the core (they hurt adoption and embedding; tldraw and Remotion are the cautionary examples). *Overturn condition:* a well-funded clone of the hosted service could justify FSL-1.1-ALv2 for new cloud-only modules, never for the core. *Amended by D118:* three license layers (the Apache-2.0 core, a source-available `ee/` folder, the proprietary operating layer of the managed service), with the overturn condition restated.

### D15. Name: Mostra
**Mostra** is Italian for "exhibition" (the Venice Film Festival is the *Mostra*). In Italian and Portuguese it is also the imperative "show!". Packages are `@mostra/*`, and the CLI is `mostra` (`mostra new`, `mostra verify`, `mostra wait`, `mostra results`). *Source:* M4 answer 9 (delegated), M5. *Availability observed 2026-10-10:* no software project on GitHub with the name; npm org `@mostra` and GitHub orgs `mostra-dev` and `mostrajs` looked free; `mostra.dev` and `mostra.sh` looked unregistered. The bare npm name `mostra` is an empty 2022 placeholder, which can be disputed later; until then use `npm create mostra` and `@mostra/cli`. *Actions for Mirza:* register `mostra.dev`, npm org `@mostra` and GitHub org `mostra-dev`, and run a trademark search before public launch. *Fallback:* `mostrakit`. *Rejected:* `atk` (clashes with GNOME's Accessibility Toolkit and is unsearchable), Plinth (an existing AI engineering toolkit and Cardano's smart-contract language), Easel (EaselJS), Maquette (a virtual-DOM library), Voilà (Jupyter dashboards), Curio (Python async), and many common words already taken on npm.

### D16. Release scope
- **v1 (the complete local-first product):**
  - the runtime, versions and publishing, the tunnel ladder and static export;
  - drafts, submissions, the event log, signals, actions and live data;
  - the review layer;
  - the full kit, including the motion composition primitive and the deck runtime;
  - all three TUI modes and web demos;
  - the CLI, Skill, AGENTS.md, templates, `verify`, `wait` and `results`;
  - the local MCP server and MCP Apps export;
  - the TypeScript SDK, the host protocol, the Rust host crate and the host conformance kit;
  - plugin contracts at 0.x with first-party plugins.
- **v1.x:** remote mode (D12), the read-only plugin registry and its agent tools, RSC render mode once its triggers are met (D19), a Yjs collaboration plugin, and PDF and video exporters.
- **Later:** the managed cloud service and the marketplace web interface.

*Source:* M5. *Note:* v1 is large. C03-A splits it into work packages without shrinking it, under [STANDARDS.md](STANDARDS.md#completion). *Amended by D116, D121 and D122:* v1 gains the remote server, relay, remote MCP server and team features; the terminal modes move to the `v1.1` follow-up release.

### D17. Interface priority
In order: (1) the CLI, Skill and `verify`, built together with the host protocol and Rust host crate because Jcode needs them; (2) the local MCP server; (3) MCP Apps export. *Source:* M4 answer 7. *See* D125: the remote server and team packages join the order right after the local MCP server.

## Architecture decisions

### D18. Runtime stack
- Vite 8 builds a React 19 single-page application.
- Server functions run on Hono.
- A **private Node LTS runtime** ships with Mostra, so users never install Node globally. Pin 24 LTS now and move to 26 LTS after its LTS date.
- One supervisor and gateway process runs per Mostra instance, with one worker process per active artifact that has server code. Frozen client-only artifacts need no process.
- Hosts talk to Mostra through JSON-RPC over stdio. No host embeds a JavaScript engine.

*Source:* M4 answer 4, research briefs 2 and 2-second (both ranked this first). *Rejected:* Next.js, TanStack Start or React Router framework mode as the artifact format (heavy, lock-in; they may become adapters). RSC as the foundation (0.x, unstable, CVE history; see D19). Bun as the reference runtime (its 1.4 Rust rewrite is fresh, and static linking carries LGPL duties; Bun remains a CI target). Embedding V8, QuickJS or `deno_core` in hosts (cannot run Vite, churns, weaker crash containment). WebContainers and Nodebox as core (commercial terms).

### D19. React Server Components policy
- **SPA mode is permanent and first-class.** It stays the right default for most artifacts: it exports statically, works inside MCP Apps and needs no worker process when the artifact has no server code. It is never treated as temporary.
- **RSC arrives as an additive render mode** (v1.x minor, opt-in per artifact) when all three triggers hold:
  1. **Stability:** `@vitejs/plugin-rsc` reaches 1.0, a stable RSC mode ships in React Router or Waku 1.0 final, and six months pass with no new critical React Flight advisories.
  2. **Evidence:** Mostra's agent evaluations (D33) show that agents produce working data-heavy artifacts more often with RSC idioms, or that RSC-style attempts in SPA mode fail often enough to matter.
  3. **Bounded exposure:** Flight endpoints sit behind capability authentication. In local mode only capability holders reach them. In hosted mode, Flight parsing happens only after authentication.
- **Five seams ship in v1** so that RSC is additive, not a 2.x rewrite:
  1. artifact manifests declare `mode` (default `spa`);
  2. server functions follow React's `"use server"` contract (async functions, Flight-compatible serializable arguments and results), compiled to RPC stubs in SPA mode and to real Server Functions in RSC mode;
  3. server-side request context comes from AsyncLocalStorage;
  4. client runtime modules carry `"use client"`, avoid environment-assuming singletons and keep host-bridge access client-only;
  5. building and serving go through a `RenderMode` contract with SPA as the first implementation.
- **No weaker architecture before RSC.** Each seam is good engineering on its own merits. Nothing in SPA mode is built less robustly because RSC might replace it, and Mostra never builds its own server-component system to fill the gap.
- **Old artifacts never migrate.** Published versions are immutable. An artifact opts into RSC with a new version. In RSC mode, interactive components need `"use client"`.

*Source:* M4 answer 4 (Mirza's three conditions: when, what integration means, and "RSC later should not lead to a less robust architecture"), M5.

### D20. Dependencies
- A curated, pre-warmed set (React, the kit, Motion, xterm.js and similar) resolves instantly for every artifact, with a single React copy.
- **Any npm package works on demand.** It installs into a shared content-addressed store with a per-artifact lockfile.
- The lockfile hash is part of the version identity.
- Offline use works for anything in the store. A missing package produces a clear error, never a hang.
- Package lifecycle scripts run in the artifact's execution context, not the supervisor's.
- Mostra uses only pnpm's MIT-licensed parts, never the PolyForm Shield `pnpr/` directory.

*Source:* M3 answer 4 (delegated), M5, research brief 2-second. *Rejected:* import maps to public CDNs as the default (online-only, leaks usage, a second resolution graph). They remain an optional lightweight mode.

### D21. Isolation and addressing
- Each artifact gets its own browser origin (`<artifact>.localhost:<port>`). Paths would make artifacts share an origin, so path routing is the weakest fallback.
- Safari doesn't resolve `*.localhost`, so a port-per-artifact fallback exists.
- The trusted shell (review overlay, trusted controls, version banner) runs on a separate origin.
- All of this sits behind the addressing port, so tunnel and hosted modes can map origins differently without changing artifacts.

*Source:* research consensus (briefs 2, 2-second, 5, 5-second), M5. *Amended by D38:* v1 addresses artifact origins by port on the shell's host, not by `*.localhost` subdomain.

### D22. State model
- **Drafts** are server-authoritative documents with monotonically increasing revisions and compare-and-set writes. Mutations carry stable IDs. Non-overlapping edits rebase automatically, and true overlaps surface as conflicts.
- **The event log** is append-only, with stable event IDs and a replay cursor.
- **Submissions** are immutable. The server creates them from its canonical persisted draft, never from page-supplied JSON. Each submission names the exact artifact version and view the human saw.
- **Transport:** commands go up over HTTP. One resumable event stream (SSE semantics) comes down. WebSocket is used only for terminals and high-rate bidirectional work.
- **Offline:** an IndexedDB mutation journal replays on reconnect.
- **CRDTs:** Yjs is an optional plugin for real co-editing, never the base.

*Source:* research consensus (briefs 5 and 5-second), M5.

### D23. Review layer
- Review lives in the trusted shell's overlay, never inside agent code. It therefore works over any content: native React, canvas, terminals, and same- or cross-origin iframes.
- **Anchors** resolve in order: semantic ID (`data-review-id`), W3C Web Annotation selectors, frame-relative coordinates, then a screenshot crop of the region. The screenshot crop is always stored.
- **Review sets** (gallery, side-by-side compare, choose one) are first-class objects. A choice is part of the draft and is delivered with the submission.

*Source:* M2 example, research consensus, M5.

### D24. Actions
- Agent-authored server functions run with full capability.
- Every invocation is a durable `ActionRun` that records progress, output, cancellation, its final state and an idempotency key, so a double click never sends two emails.
- An action may emit a host event or a signal.
- Retries happen only in the author's code, never implicitly.

*Source:* M2 email example, research briefs 5 and 5-second, M5.

### D25. Host ports and protocol
- Hosts integrate through ports: identity, drafts, submissions, reviews, events, addressing, trusted controls and capture, plus a sandbox port in v1.x.
- The standalone CLI is just a built-in adapter set (local storage, local identity, `*.localhost` addressing, Mostra's own shell).
- The host protocol is versioned and language-neutral, with capability negotiation.
- A Rust host crate and a host conformance kit ship in v1.

*Source:* D01, research consensus, M5. *Amended by D58:* the drafts, submissions and reviews ports deliver and mirror; Mostra's store stays canonical.

### D26. Kit defaults and the license boundary
The default kit follows research brief 3:
- UI and styling: shadcn/ui on Tailwind CSS 4.
- Charts: Recharts 3 through shadcn charts, uPlot for high-rate live data, ECharts 6 for breadth.
- Tables: TanStack Table.
- Forms: react-hook-form with Zod 4.
- Diagrams: Mermaid, xyflow and Excalidraw.
- Maps: MapLibre with deck.gl.
- 3D: react-three-fiber.
- Code: Shiki for display, CodeMirror 6 for editing.
- Math: KaTeX.
- Motion: Motion, plus Mostra's own frame-based composition primitive.
- Slides: Mostra's own MDX deck runtime.

**Non-OSI engines are never bundled** (GSAP, Remotion, tldraw, AG Grid Enterprise, Theatre.js Studio). They exist only as user-installed plugins with license disclosure (D31). *Strength:* the kit list is a **default**, which C03-A may refine with evidence. The license boundary is an **invariant**. *Source:* M5.

### D27. Several shadcn bases
The design system ships as shadcn-registry items with base variants: Base UI and Radix in v1, and React Aria later as a plugin. Each artifact uses one base. Mostra's higher-level components use only public component APIs plus a small `Slot` adapter for the `asChild` versus `render` difference, so supporting several bases costs CI time, not duplicate code. `verify` flags idioms that belong to a different base. The **default base** is chosen by a C03-A evaluation of first-pass success. *Source:* M4 answer 8 ("how about both"), M5.

### D28. TUI and web demos
- **One terminal frame model** (cells, styles, cursor, size) with Mostra's own renderer for static and recorded content.
- **Live mode:** xterm.js over a PTY.
- **Recorded mode:** asciicast v3 recordings.
- **WASM mode:** Ratzilla for ratatui.
- **Capture:** a ratatui TestBackend capture crate.
- **Agent checks:** text, cell and screenshot dumps let agents verify terminal output without vision.
- **Web demos:** run the demo's own dev server and proxy it into an iframe on its own origin, with WebSocket passthrough, viewport switching and device frames. In-browser bundling is only an optional snippet mode.

*Source:* M2 ("render TUI in React ... precisely"), research brief 4, M5. *Amended by D122:* the terminal modes ship in `v1.1`, after the first release; web demos stay in v1.

### D29. Agent experience
- **`verify` is the decisive feature.** It builds and type-checks the artifact, renders it headlessly with Playwright, and captures console, network and accessibility findings, an ARIA snapshot and multi-viewport screenshots. It also runs a synthetic smoke test with actions in dry-run mode, and regression checks against the last passing version.
- **Output:** one JSON verdict with stable diagnostic codes.
- **Documentation for agents:** an Agent Skill, AGENTS.md in the repository and in every scaffolded artifact, templates, and a gallery that shows source next to result.
- **CLI:** every command has a `--json` mode and documented exit codes.

*Source:* research brief 6 and consensus, M5.

### D30. Extensibility
- Toolkit, components and other features are all extensible.
- **Runtime plugins** are npm packages that declare a `"mostra"` manifest key and implement small typed contracts. Each extension point's contract is versioned separately from the core.
- **Source packs** (components, templates, themes, starters) are copy-source items in a superset of the shadcn registry format, so any shadcn item installs unchanged.
- **First-party plugins** prove each contract.
- **Registry:** a metadata-only registry with agent search tools comes in v1.x. The public marketplace web interface comes later.
- **Trust:** shown through provenance, verified namespaces, compatibility badges and license metadata. Never through capability gates.

*Source:* M3 ("a public marketplace that the users/agents can add to"), research brief 8, M5.

### D31. License acknowledgment
Installing a plugin that pulls in a non-OSI engine requires a one-time, scriptable acknowledgment (`--accept-license <id>`), recorded in the artifact's lockfile. A host may pre-accept by policy. This is disclosure that protects users from accidental license liability. It is not a capability limit. *Source:* M5.

### D32. Interfaces evolve additively
Tool schemas (CLI JSON output, MCP tools) and protocol messages change additively within a version: new optional fields and new tools, never changed meanings. ChatGPT freezes tool snapshots after approval, and hosts pin versions. Breaking changes need a new protocol revision with a deprecation window. *Source:* research briefs 6 and 7, M5.

### D33. Agent evaluations for Mostra (confirmed by D34)
Mostra may keep an opt-in, budgeted agent-evaluation suite. It measures toolkit ergonomics (first-pass `verify` success, turns to pass, retention across turns), not prose quality. D27 and D19 depend on it. Skill and documentation prose is still accepted through Mirza's review, never through phrase tests. *Label:* approved by implication, because Mirza approved the decisions that rely on it. C03-A confirms it explicitly in its first decision round, because Mirza's Jcode program excludes behavioral benchmarks from that program, and Mostra is a separate project.

## C03-A phase-design decisions

Decisions taken with Mirza during the SP-58-C03-A phase design. Each one is an **approved decision**. Where Mirza delegated a choice, the entry says so and names the evidence.

### D34. Agent evaluations: confirmed, ask first, OAuth, model mix
D33 is confirmed. Rules for every run that makes real model requests:
1. **Ask first.** Before every batch run, the agent tells Mirza what question the batch answers, which models it uses in what ratio, and the estimated cost **in tokens** (never dollars). A batch that uses any Anthropic model waits for his explicit approval. A batch that uses only GPT models doesn't need approval; the agent still announces it before starting. *(Confirmed in M7.)* How batches are paced is in D64.
2. **OAuth, never API keys.** Runs authenticate through the vendors' OAuth logins (for example the Codex and Claude Code CLIs signed in to Mirza's accounts).
3. **Model mix.** Mostly **GPT-6.1-Sol**, with some **Claude Sonnet 5.5** and **Claude Opus 5.5**, roughly 70/15/15. The ratio is a guide: the agent picks models and proportions per question, keeping variety so Mostra isn't tuned to one model.
4. **No fixed caps.** Report token usage per run with provider, model and date (STANDARDS, Verification).

*Source:* M6 Q1. *Supersedes* the "budget Mirza approves" wording in STANDARDS with the ask-first rule.

### D35. Windows is out of v1.0
v1.0 explicitly does not support Windows. Windows stays on the roadmap for a later release. The v1 design need not constrain itself for Windows. On an unsupported platform every Mostra entry point fails closed with a clear diagnostic. *Source:* M6 Q2. *Resolves* RT-07. *Amended by D120:* Windows support follows in v1.1 (WP-32); the fail-closed rule stands for anything still unsupported. *Amended by D146:* Windows ships in v1.0, built by WP-W1 to WP-W3 right after WP-12.

### D36. Approving a work package approves its publication
When Mirza accepts a work package, that acceptance authorizes every publication step for it: pushing to the public repository, publishing to npm and crates.io, creating releases and deploying the docs site. Agents ask only when something is uncertain or a real dilemma arises. *Source:* M6 Q3. *Changes* STANDARDS, Consequential actions.

### D37. No domain yet; GitHub org created
Mostra postpones buying a domain. The docs site is hosted for free on GitHub Pages under the `mostra-dev` GitHub organization, which Mirza created. Docs links in diagnostics and tools use one configurable base URL, so a later domain only changes that base (GitHub Pages redirects to a custom domain once one is configured). If a domain is bought later, `mostrakit.dev` and `mostradev.com` fit the budget. Mirza is creating the npm organization `@mostra`. *Source:* M6 Q4. *Amends* D15's action list.

### D38. Addressing: port-per-artifact origins with cookie sessions (delegated)
In v1, the shell and every artifact share one host and differ by port: the shell on the instance's gateway port, each artifact on its own leased port. The two are the same **site** and different **origins**, so D06's mechanism holds as written: the capability token is exchanged for an `HttpOnly; SameSite=Strict` session cookie. Ports are leased stably per instance and artifact, so capability URLs and per-origin browser storage survive restarts. The gateway strips Mostra session cookies before proxying to workers, foreign apps or terminals, and binds each session to the one origin it was issued for. Tunnel modes map onto ports of the tunnel hostname the same way. Hosted remote mode (v1.x) is cross-site by nature and gets its own frame-credential design behind the addressing port (*moved into v1 by D116*, designed in WP-28).

*Evidence:* [VERIFIED_FACTS.md](VERIFIED_FACTS.md#browser-addressing-and-cookies-prototype-evidence). Artifact iframes on `*.localhost` subdomains are third-party contexts: Chromium and Firefox drop Strict and Lax cookies there, and Safari 26.2 drops every cookie. Same-host port origins carry Strict cookies in all four engines tested. Tailscale gives one hostname per device, and Funnel allows ports 443, 8443 and 10000. *Rejected:* capability-bearing subdomains (unusual, and tunnels still need ports) and path-prefix capabilities (absolute paths in agent code break). *Source:* M6 Q5 (delegated). *Amends* D21.

### D39. Draft scope and the `once` scope
A draft belongs to one artifact and one viewer identity, so a refresh, a second tab or a second device of the same identity continues it. The `once` policy takes a scope: `per-artifact` (default: exactly one submission per artifact, which Jcode uses) or `per-viewer` (one submission per viewer identity, for surveys). `epochs` is unchanged. *Source:* M6 Q6. *Refines* D10 additively.

### D40. Submit channels
In the standalone host, both the shell's trusted Submit and the artifact's own `submit()` create submissions. Every submission records its channel (`shell` or `artifact`) and the viewer identity. A host can restrict submission to the shell channel; Jcode does. *Source:* M6 Q7.

### D41. Publish is gated by verify
Publish reuses the verify verdict cached for the exact source and environment digest, and runs `verify` when none exists. Error-severity diagnostics block publish. Warnings don't. `--force` publishes anyway and records the failing codes in the version manifest, where hosts can read them. *Source:* M6 Q8.

### D42. Fields that don't carry over
When a newer version can't map some draft fields, the banner says how many answers won't carry over. After switching, a "Not carried over" panel shows those values read-only and copyable. The submission carries them in a labelled `orphaned` section. Nothing is dropped. *Source:* M6 Q9.

### D43. Dependency policy
Unknown imports auto-install into the shared store by default, and publish freezes the lockfile. A host policy `dependencies: "auto" | "explicit"` switches to explicit mode, where the agent gets the structured diagnostic `MOSTRA_DEP_MISSING` with the exact `mostra add` command. *Source:* M6 Q10.

### D44. Secrets (details delegated)
Secrets are named values held outside artifact source in the Mostra home, in an owner-only (0600) store. `mostra secret set NAME` reads the value from stdin. A secret is scoped to one artifact or shared within the home, and server code reads it by name. Secrets never enter source, versions, exports, logs, diagnostics, events or screenshots. A host may supply secrets through a port instead (Jcode can use its own credential store). A keychain-backed store can come later as a plugin. *Source:* M6 Q11 (implementation details delegated).

### D45. Instance model: one instance per Mostra home
A Mostra home is a directory holding one instance's registry, versions, interaction data and secrets. At most one supervisor runs per home, enforced by a lock. The CLI starts the home's daemon on demand, or attaches to it through an owner-only Unix socket in the home. A host either spawns its own instance over stdio with its own home or attaches to a running daemon. `MOSTRA_HOME` selects the home, so a CLI running inside a host's environment reaches that host's instance. Several homes can run side by side for unrelated hosts. *Source:* M6 Q12. *Resolves* the instance-model question in ARCHITECTURE §4.

### D46. AI port is out of v1
The optional AI port is not part of v1. The capability name is reserved in protocol negotiation so it can be added later without a breaking change. *Source:* M6 Q13.

### D47. Round-1 defaults
Adopted without objection:
- **Retention.** Every published version is kept. `mostra gc` removes only unreferenced versions and only on request. Build caches are LRU-capped, 5 GB by default.
- **Events.** Durable events are kept. Compaction is opt-in, writing a snapshot plus a cursor; resuming from a compacted cursor returns the snapshot. Ephemeral traffic is never stored.
- **Action runs** live with their artifact. Per-run logs cap at 1 MB with a truncation marker.
- **Viewer-visible states.** Drafts: Saving, Saved. Submissions: Submitted (durable in Mostra), Delivered (host acknowledged), Pending delivery (retrying), and Undeliverable when the host reports it.
- **Comments.** Threads with replies, resolve and reopen. Each message records its author. Resolution state travels with the submission.
- **Sharing.** `mostra share --tailnet` and `mostra share --public --ttl <d>` drive installed `tailscale` or `cloudflared` and explain how to install them when missing. The event stream falls back to long-polling on the same cursor wherever SSE is unavailable, such as behind a Cloudflare quick tunnel.
- **Later plugins.** The AG-UI adapter, the A2UI guest renderer and the import-map/CDN dependency mode are v1.x.

*Source:* M6.

### D48. Tooling deviations and version-churn guidance
The STANDARDS tooling baseline moves to pnpm 12 (npm's `latest` since the research), Vitest 5, the v2 MCP TypeScript SDK packages, Node 24 now and Node 26 after its LTS date of 2026-10-28, and TanStack Table 9. Whenever a tool Mostra ships or recommends has a recent major release or rename that models are likely to get wrong, Mostra ships "write this, not that" guidance and, where possible, a lint rule with an autofix. This applies beyond the kit libraries. *Evidence:* [VERIFIED_FACTS.md](VERIFIED_FACTS.md). *Source:* M6.

### D49. Working agreements for Mostra agents
1. Agents may ask Mirza for anything at any time, including new external research reports and subscriptions.
2. Agents may install any tool without asking. Large installs may use the external disk named `Active` when the internal disk is tight.
3. The only sub-agent Mostra agents use is `fast-worker`, for summarizing bulk reading. Jcode's other sub-agents aren't ready yet.
4. Agents ask Mirza for a context compaction at natural points, such as after a self-contained stretch of work. Compaction summarizes named slices of earlier work, not the whole session, so the request names the slices that can be summarized and the material that must stay.

*Source:* M6 notes 1 to 3. *Changes* STANDARDS, Working with Mirza.

### D50. Repository standards from the first commit of code
The repository starts with strong engineering standards, designed in this phase and set up by the first work package:
- a modular CI that runs independent checks in parallel and caches aggressively;
- a defined quality toolchain: formatting, linting, type checking, language servers, API reports, license and dependency audits, and more;
- commit, pre-commit and pull-request standards;
- structured documentation for agents and humans, so every worker reads what it needs, erring towards reading more;
- a seamless publication pipeline.

The aim is that agents don't repeat work, naturally produce modular, modern, high-quality code, and never wait on checks that don't depend on each other. *Source:* M6 note 4. *Detailed in* the dossier's repository-standards document.

### D51. Manifest in the entry file (delegated)
Artifact metadata is a literal object in the entry file: `export const artifact = defineArtifact({...})` in `index.tsx`, or frontmatter in `index.mdx`. Mostra extracts it statically (the supervisor never runs artifact code), and a non-literal value is a compile diagnostic. A single file with no manifest is a complete artifact with defaults. The fields are `id`, `title`, `description`, `family`, `links`, `mode` (default `spa`), the requested `submission` policy (the host decides), `limits` and `verify`. `mostra new` writes a generated `id`. An artifact without one is bound to its canonical source path at first publish, and two paths claiming one `id` is a publish error. *Rejected:* `mostra.json` (a second file for any metadata) and `artifact.config.ts` (two forms, and it must be executed or restricted to literals anyway). *Source:* M7 Q2 (delegated). *Resolves* ARCHITECTURE §2 manifest form.

### D52. Field hooks and field identity (delegated)
The client runtime's persistence primitive is `useField(id, initial, options)`, which behaves like `useState` with a stable ID. Alongside it come `useSubmit`, `useSignal` and `useSubmitControl`. IDs are explicit strings, and dotted IDs nest in results. The options are `label`, `required`, `validate`, `sensitive` (redacted from logs and events, kept in the submission) and `scope` (D63). `verify` reports duplicate IDs and IDs that change between renders as errors, and unbound form controls as hints. `@mostra/react/form` adapts react-hook-form onto the same fields. *Rejected:* one schema-typed draft document (a store each artifact must design, path-level conflicts, schema migrations between versions). *Source:* M7 Q3, Q4 (delegated). *Resolves* ARCHITECTURE §2 field identity and §7 client runtime API.

### D53. `window.storage` compatibility
The client runtime installs a `window.storage` compatible with Claude artifacts. Personal keys are viewer-scoped fields under `storage.<key>`. `shared: true` keys are artifact-scoped fields (D63). `verify` hints towards `useField` for form inputs. *Source:* M7 Q5.

### D54. Server functions and action runs
Calling a `"use server"` function directly is a plain RPC with no durable record. `useAction(fn, { key })` turns each invocation into a durable `ActionRun` (D24). By default there is one in-flight run per hook instance, so a double click joins the running invocation. An explicit `key` makes the invocation at-most-once across reloads, tabs and devices. Server context comes from `@mostra/server` imports (`progress`, `secret`, `signal`, `dryRun`, `viewer`, `abortSignal`) backed by AsyncLocalStorage. Arguments and results use exactly React's documented Server Function type set plus `AsyncIterable` results, through one Mostra serializer with conformance tests against React's behavior. There is no `*.server.ts` convention. *Source:* M7 Q6. *Resolves* ARCHITECTURE §5 serialization and file convention.

### D55. Dry-run opt-in for `verify`
An action opts into `verify`'s smoke test by checking `dryRun()`, and the compiler records which `"use server"` exports reference it. `verify` never invokes an action that hasn't opted in. The click gets a synthetic "skipped in verify" result, and the verdict lists the skipped actions. *Source:* M7 Q7. *Resolves* ARCHITECTURE §8 dry-run semantics.

### D56. Live sources
Live data is its own concept. `live.ts` exports `defineLive({ load, refresh | watch | stream })` producers, which the artifact's worker runs. `mostra push`, the SDK and the host protocol push values into the same sources. The page reads them with `useLive(key)`, which returns `{ data, isLoading, error, refresh }`, and can request an append mode with a ring buffer for high-rate charts. Values carry server-assigned revisions, the latest value persists (D63), and a view records the revisions it saw. Types reach client code through a generated declaration file, never by importing server code. *Rejected:* client polling of server functions (per-tab load, no shared latest value, and React advises against server functions for data fetching). *Source:* M7 Q8.

### D57. Multi-page routing
Multi-page artifacts use a `pages/` convention on React Router. Mostra chooses the history mode per delivery target: browser history locally, hash routing for static export, memory routing inside MCP Apps. The runtime reports the current page to the shell so comments record it. *Source:* M7 Q9. *Resolves* ARCHITECTURE §2 routing.

### D58. Mostra-owned ledger; ports deliver and mirror
Mostra's own transactional store is always the canonical record of drafts, artifact state, submissions, reviews, action runs and events. It lives inside the home the host configures. Hosts integrate through small, idempotent, optional ports, each with a standalone default:
- `identity`;
- `submissions`: deliver, then accepted or rejected with a reason, with outbox and idempotent replay on failure;
- `drafts` and `reviews`: optional opaque mirrors;
- `events`: the host pulls with a filter and a durable cursor;
- `addressing`, `trustedControls`, `capture`, `secrets` and `pty`.

"Accepted by Mostra" and "accepted by the host" remain separate, reported facts. *Rejected:* host-supplied stores. Every host would have to reimplement compare-and-set, idempotency and unique submissions, and would still need a local store for the outbox. *Source:* M7 Q10. *Amends* D25 and the ARCHITECTURE §12 port table.

### D59. One host protocol for every client
The CLI, the local MCP server, the TypeScript SDK and the Rust crate all speak one versioned JSON-RPC 2.0 protocol to the supervisor. They use stdio when a host spawns Mostra and the home's Unix socket when attaching to its daemon. Port callbacks travel on the same connection and reach only the connection that registered them. Zod 4 is the schema source. Generated JSON Schema 2020-12 is published, and draft-07 feeds typify for the Rust wire types, which are committed with a snapshot test. The Rust client is hand-written. Revisions are dated, negotiated in `mostra/initialize` and change additively, with at least 12 months of deprecation. *Source:* M7 Q11. *Resolves* ARCHITECTURE §12 transports, schema source and versioning.

### D60. CLI command set
`new`, `dev`, `verify`, `publish`, `open`, `share`, `wait`, `results`, `review export`, `push`, `state` (D63), `term dump`, `add`, `export`, `secret`, `list`, `status`, `daemon`, `host`, `mcp`, `plugin`, `docs`, `doctor` and `gc`, as specified in [rounds/ROUND-2.md](rounds/ROUND-2.md#31-cli-command-set-cl1). Artifacts are addressed by source path or ID. Help text is drafted with Mirza. *Source:* M7 Q12.

*Extended by D140:* `daemon restart`, `daemon uninstall` and `telemetry on|off|status` join the set; `share`, `review export`, `export`, `mcp`, `plugin`, `term` and `run` stay unregistered until their packages add them.

### D61. MCP tools and MCP Apps persistence
The local MCP server has about twelve tools under an `artifact_` prefix (create, write, patch, verify, publish, open as the render tool, wait, results, list), plus `live_push`, `docs_search` and app-only tools for exported MCP Apps. In v1, inline MCP Apps persist drafts, submissions, actions and events through the local MCP server. Cloud chat hosts need remote mode (v1.x). Until then the exported page states that answers can't be saved there and offers the full-page URL. Tool descriptions are drafted with Mirza. *Source:* M7 Q13. *Amended by D116:* in v1, MCP Apps in cloud chat hosts persist through the remote MCP server (WP-30), so the "until then" message is replaced; local hosts are unchanged.

### D62. Process details
- **Home layout:** `registry/`, `versions/`, `store/` (SQLite), `deps/`, `secrets/` (0600), `cache/`. The control socket lives in a short per-user runtime directory.
- **Daemon:** keeps running while it has open views, active shares, pending deliveries, running producers or attached clients, and otherwise exits after 30 idle minutes. `mostra daemon install` registers a launchd or systemd user service for always-on use (D63). A host-spawned instance lives as long as its stdio connection.
- **Workers:** started on demand, evicted after 10 idle minutes, restarted after crashes with exponential backoff and a reported cause.
- **Default limits** (stability, not security): 1 GiB heap per worker and a 10 s event-loop watchdog, configurable per artifact.
- **Ports:** the gateway port and each artifact's port are leased per home and reused across restarts. A conflict at start-up gives a diagnostic and a re-lease.

*Source:* M7 Q14. *Resolves* ARCHITECTURE §4 eviction, limits and home location.

### D63. Long-lived artifacts are first-class
One-off artifacts (approve a report, choose a prototype, answer questions) and long-lived ones (a personal dashboard open all week, a company dashboard, an AI task manager) carry equal weight in design, verification and evaluation. The model handles both with these additions:
1. **Artifact-scoped state.** A field declares `scope: "viewer"` (the default: the viewer's draft) or `scope: "artifact"` (shared state that every viewer sees and edits). Agents and hosts read and write artifact state through `mostra state get|set|patch`, the SDK and the protocol. They use the same revisions, compare-and-set and mutation IDs as viewer edits, and overlapping writes surface as conflicts on both sides. Every change emits a durable `state.changed` event that hosts filter (D10: Mostra never decides what wakes an agent).
2. **Submission policy `none`.** Besides `once` (D39) and `epochs`, an artifact can have no submission at all. It then talks to the agent through artifact state, actions and signals, and the shell shows no Submit control. When a policy does submit, the snapshot includes the viewer's draft and the artifact state at that revision.
3. **Following new versions.** The version banner offers "Switch" and "Always follow this artifact". Following is a per-viewer, per-artifact choice the viewer makes once (D09 intact). While it's on, a new version loads automatically unless the viewer has unsaved edits or fields that wouldn't carry over.
4. **Live updates are not durable events.** A live source persists its latest value and, optionally, a ring buffer. Updates travel on the stream as ephemeral notifications with revisions, so a 24/7 dashboard doesn't fill the event log. Producers run while someone is viewing or a host is subscribed. `defineLive({ always: true })` keeps one running regardless.
5. **Capability lifetime.** Local capability URLs don't expire by default; they are revocable and rotatable. Public shares keep short default lifetimes (D47). Tailnet shares may be long-lived.
6. **Always-on.** `mostra daemon install` (D62) is the documented path for artifacts that must answer at any hour. `mostra doctor` reports when artifacts with policy `none` exist without it.
7. **Growth over months.** Versions share content-addressed assets. Event compaction (D47) and `mostra gc` keep a long-running home bounded, on request.
8. **Coverage.** PRODUCT gains journeys J11 (personal dashboard) and J12 (team task manager). Templates, the conformance kit and agent evaluations include long-lived scenarios.

*Source:* M7 note (direction approved by Mirza). The details are C03-A's design, to be confirmed in round 3. *Extended by D121:* expected respondents, respondent status, presence and attribution.

### D64. Running evaluations in small batches
Evaluation runs never fire as one big batch. The first run of a new harness is a single call, to find bottlenecks and calibrate token use. Later runs go two or four at a time, so a shared five-hour usage limit is used steadily rather than exhausted part-way through. A second account may be used if available. Runs with Claude models are planned with Mirza first (D34). The v1 evaluations drive the **Codex CLI** (`codex exec --json`, ChatGPT OAuth). That choice is deliberate:
- Codex is one of Mostra's target harnesses (D11).
- It runs non-interactively with isolated working directories and reports token usage per turn.
- Jcode's sub-agents aren't ready for this use (D49).

*Source:* M7 Q1.

### D65. Round 3 shapes (delegated)
Mirza approved every shape in [rounds/ROUND-3.md](rounds/ROUND-3.md) as written. Those sections are the record and are carried into the dossier unchanged:
- kit components resolving without copying, and `mostra add` copying one for editing (§1.1);
- the warm set, with maps, 3D and Excalidraw installed on demand (§1.2);
- one token system mapped to the MCP Apps variables (§1.3);
- the questionnaire (§1.4) and review sets with a trusted Choose control (§2);
- the `Timeline`/`Clip`/`useFrame` composition primitive (§3) and the Slidev-style MDX deck grammar (§4);
- terminals declared in the manifest, the frame model, node-pty in a PTY host process, and web demos with bridge injection on by default (§5);
- the six v1 contract packages, the plugin manifest, packs, and the loading and conflict rules (§6);
- the internal `RenderMode` contract (§7) and the shell bridge message set, with a host-replaceable shell (§8);
- the `verify` code scheme, smoke-test scope, regression baseline, viewports and warm browser (§9);
- harness plugins and MCP Apps conformance scope (§10);
- package map P2 (§11.1), the repository standards (§11.2) and the publication pipeline (§11.3).

*Source:* M8 Q3.

### D66. Long-lived additions confirmed
D63 is confirmed as written: two configurations of one model, set mainly by the submission policy and field scope. *Source:* M8 Q1.

### D67. Direct npm publishing from a protected environment
Releases publish when the Changesets release pull request merges. The workflow runs in a protected GitHub environment that only that merge can trigger. npm trusted publishing is configured for direct `npm publish` with provenance, and each package is set to "Require two-factor authentication and disallow tokens". crates.io uses trusted publishing through `rust-lang/crates-io-auth-action`. *Rejected:* stage-only publishing, which needs Mirza's 2FA on every release (D36). *Source:* M8 Q2.

### D68. Design freedom with a beautiful baseline
Artifacts have no imposed look. An artifact's design is entirely the authoring agent's choice: any styling, fonts, layout, motion, libraries, or none of the kit at all. The kit and its tokens are a **baseline** that makes the result beautiful when an agent with no design skill uses the defaults. Every kit component is restyleable through tokens, `className` and copy-source editing, and nothing in Mostra enforces kit usage. The shell is deliberately quiet so it never competes with the artifact. The round-4 shell prototype is a **direction**, not the final visual design; the final pass happens in the shell's WP with design-focused review (Mirza may supply design skills). *Source:* M8 Q4.

### D69. Skill trigger
The Agent Skill's description triggers on one branch: **the agent wants to communicate visually with the user**. That covers every case (asking, showing, deciding, reporting, demonstrating, keeping something up to date), since the uses are unbounded. The rest of [rounds/ROUND-4.md](rounds/ROUND-4.md) part B (purposes, boundaries, structures and leading words) is agreed, and full drafts are iterated with Mirza. *Source:* M8 Q5.

### D70. Two frame-session modes behind the addressing port (delegated, extends D38)
- **Cookie mode** (D38) applies wherever the shell and the artifact are same-site: loopback ports, Tailscale Serve and Funnel (one device hostname, different ports).
- **Worker mode** applies wherever they are cross-site. In v1 that means Cloudflare quick tunnels, because `trycloudflare.com` is a public suffix and each tunnel is its own site. Hosted mode (v1.x; *in v1 by D116*) uses the same mechanism. The flow:
  1. The shell loads the frame at `/_mostra/enter#t=<frame token>`.
  2. The bootstrap page registers Mostra's service worker at scope `/`.
  3. The worker attaches the frame session header to every same-origin request.
  4. Event streams and WebSockets bypass the worker and authenticate with single-use tickets from an authenticated POST.

  Origin and CSRF checks are unchanged in both modes.
- **Constraint in worker mode:** the artifact can't register its own root-scope service worker. The client runtime turns such an attempt into a diagnostic rather than silently breaking the session.
- The addressing port decides the mode per origin pair. Artifacts never see the difference.

*Evidence:* VERIFIED_FACTS, cross-site frames (all engines and real Safari). *Source:* round-1 Q5 delegation (M6); found while designing HY-05 on 2026-10-10.

### D71. Ledger engine: SQLite through better-sqlite3 (Default)
The home's ledger is one SQLite database in WAL mode with `synchronous=FULL`, opened only by the supervisor, through `better-sqlite3` (MIT, prebuilt for the v1 platforms). `node:sqlite` replaces it when Node marks it stable; the store module hides the driver, so the switch is internal. *Evidence:* VERIFIED_FACTS. *Strength:* Default.

### D72. Default shadcn base: Base UI (decided by evaluation, D27)
Base UI is the default base. EVAL-01 found no first-pass difference between Base UI and Radix for GPT-6.1-Sol: 17 of 20 each, no cross-base type errors in 40 runs. The secondary factors decide: Base UI is shadcn's own default (along with its docs, Skills and `llms.txt`), most new shadcn projects choose it, and the model used its `render` prop correctly every time. Radix stays a fully supported base (D27). Two consequences of the same evaluation:
1. **`verify` severity.** Smoke-test observations without a runtime error are warnings, and only definite failures are errors. False positives made agents break working code.
2. **Warm set.** `@hookform/resolvers` joins the warm set (D65).

*Evidence:* [evaluations/eval-01/EVAL-01.md](evaluations/eval-01/EVAL-01.md), including EVAL-01b (Claude Sonnet: 6/6 in both bases, D75). *Overturn:* a first-pass gap of 10 points or more in Radix's favor on any model in the D34 mix. *Source:* D27, D34; Mirza may veto at design approval.

### D73. Design approved; C03-B threshold
Mirza approved the complete C03-A design at M9, recorded in [DESIGN_ACCEPTANCE.md](DESIGN_ACCEPTANCE.md). C03-B can start once WP-14 is accepted. That threshold may move to a later package if implementation reorders work; the move is recorded here, and nothing in C03-B's needs (JCODE_HOST) may move out of the packages before it. *Source:* M9 Q1, Q2.

### D74. Agent-facing prose is drafted in the WPs that build it
The Skill and AGENTS.md texts are drafted in WP-14, the MCP tool descriptions in WP-15, and CLI help and diagnostic hints in the package that adds each command or code. Each is iterated with Mirza until he accepts it (STANDARDS prose, D69). *Source:* M9 Q4. *Amended by D149:* acceptance happens once per package, at its end.

### D75. EVAL-01b: Claude check of the default base
A Claude Sonnet run of EVAL-01 (6 prompts × 2 bases, in pairs, through Claude Code signed in with Mirza's OAuth account) checks D72 across model families, as D34 asks. Mirza approved the batch at M9. D72's overturn rule applies to its result. *Source:* M9 Q3.

### D76. GitHub repository and pre-acceptance pushes
Standing authorization for everything planned on Git and GitHub:
- **The design session** creates the public repository `mostra-dev/mostra` (D13) and pushes `main` with the accepted dossier.
- **WP sessions** may push their `wp/NN-*` branches and open pull requests before acceptance, so CI evidence exists when Mirza reviews.
- **WP-01** may configure the repository as REPO_STANDARDS requires: private vulnerability reporting, secret scanning with push protection, branch protection and required checks on `main`, the protected `release` environment, Actions permissions, CODEOWNERS, labels and Pages.

Merging to `main` and publishing packages still follow acceptance (D36). Deleting the repository, transferring it, or making it private would still need Mirza's explicit approval (STANDARDS). *Source:* M10.

### D77. Version IDs use Crockford base32 (delegated)
`versionId` is `ver_` plus the first 26 characters of the SHA-256 digest of `sourceDigest ‖ envDigest` in Crockford's base32 alphabet (`0-9A-HJKMNP-TV-Z`, uppercase, most significant bit first), 130 bits. Every Mostra ID body then uses the one alphabet ULIDs use, so parsers, logs and copy-paste behave alike, and the letters I, L, O and U never appear. `VersionId.fromSha256` in `@mostra/protocol` is the single encoder. *Source:* M11 Q1 (delegated). *Fills* DATA_MODEL §2, which named "base32" without an alphabet.

### D78. The first host protocol revision is `2026-10-10`
`HOST_PROTOCOL_REVISIONS` in `@mostra/protocol` starts at `2026-10-10`, the date WP-01 defined the protocol's foundations. Later work packages extend it additively; a breaking change adds a newer revision (D32, D59). *Source:* M11 Q2.

### D79. `main` is protected; everything lands through pull requests
`main` takes changes only through pull requests that pass the `ci-ok` check and code scanning, merged with merge commits. Force pushes and deletion are blocked, and nobody bypasses the rules, including administrators. The progress report a WP finalizes after acceptance therefore reaches `main` through its own small pull request that merges when green. Release tags can't be moved or deleted. *Source:* M11 Q3. *Changes* the publication step of work-packages/README.md §4, which said "push".

### D80. Independent reviews before acceptance
Every work package gets an independent code review before it is presented to Mirza, and every finding is fixed or answered in the progress report:
1. **GPT-6.1-Sol through `codex review`**, effort high, on the pull request's diff. A GPT-only live call, announced as D34 requires, with its tokens recorded.
2. **GitHub Copilot code review** runs automatically on every push to a pull request (the `main` ruleset). Its comments are review threads, and the ruleset requires every thread resolved before merging.
3. **Claude Opus 5.5** also reviews the truly substantial packages, up to ten of Mostra's packages (D114; at first at most one in five). It waits for Mirza's approval like every Anthropic batch (D34). *Amended by D144:* every package gets one.

Reviews find defects; they never replace the evidence table. The WP-01 review (13 findings, all fixed with regression tests) showed the value: a green gate suite still had false negatives. *Source:* M12.

### D81. The ledger lock decides who owns a home
A supervisor owns a home by holding an exclusive SQLite lock on its ledger (`locking_mode=EXCLUSIVE` in WAL mode), taken with a write transaction before anything else in the home is used. The operating system releases the lock when the process dies, so it never goes stale, and any second opener fails at once. The control socket is only how clients find the owner:
1. The owner unlinks any leftover socket file at its path and binds a new one. No takeover mutex is needed, because only the lock holder touches the socket.
2. After binding, the owner writes `instance.json` in the home (a temporary file, then a rename) with its PID, process start time, socket path, runtime version and protocol revisions, and removes it on a clean exit. The file is for discovery only, never a lock. It is stale when its PID and start time don't match a live process.
3. A starter that can't take the lock reads `instance.json` and attaches to the socket recorded there. Only when that socket can't be reached does it fail with `MOSTRA_HOME_LOCKED`, naming the owner's PID and how to restart it. `mostra host` never attaches to another instance: it reports `MOSTRA_HOME_LOCKED` with the owner's PID.
4. A running supervisor checks its socket at least every 10 s and re-creates it when the file has disappeared, for example when a Linux logout removes `$XDG_RUNTIME_DIR`.

Consequence: every ledger reader, including `mostra doctor`'s integrity check, goes through the supervisor or runs only when no supervisor holds the lock. *Supersedes* the `run/takeover.lock` mutex in FAILURE_MODEL §2 and WP-02's original design detail. *Strengthens* D45 and D71. *Source:* M13 points 1 and 6.

### D82. Runtime directory and socket name
The control socket is `<runtime dir>/<home hash>.sock`:
- **Runtime directory.** `MOSTRA_RUNTIME_DIR` when set. Otherwise `~/.mostra/run` on macOS. On Linux, `$XDG_RUNTIME_DIR/mostra` when `$XDG_RUNTIME_DIR` is a directory the user owns with mode 0700, else `${XDG_STATE_HOME:-~/.local/state}/mostra/run`. Mostra creates its directory with mode 0700. A directory owned by someone else fails closed with `MOSTRA_HOME_NOT_OWNED`. Two starters with different environments may compute different directories; `instance.json` (D81) is how they find each other.
- **Home hash.** The first 16 characters, in D77's Crockford base32 alphabet, of the SHA-256 of the home's real path, so a symlinked home maps to the same socket.
- **Length.** A socket path over the operating system's limit (103 bytes on macOS, 107 on Linux) fails closed with `MOSTRA_HOME_SOCKET_TOO_LONG`, whose hint names `MOSTRA_RUNTIME_DIR`.

*Source:* M13 points 2 and 3. *Fills* ARCHITECTURE §4 and DATA_MODEL §1.

### D83. One JSON-RPC 2.0 core in `@mostra/protocol`
`@mostra/protocol` holds the one JSON-RPC 2.0 implementation every Mostra connection uses: message schemas, request correlation, notifications, timeouts, connection close, and errors carried as diagnostics. The host protocol server and its clients, child-process messaging and the shell bridge all use it. It has no I/O and no Node built-ins, works in the browser and is tree-shakable; size-limit gates the browser packages that import it. Revision `2026-10-10` has **no batches**: a batch is answered with an Invalid Request error (-32600) carrying a diagnostic. Batches can be added later without breaking anything, and MCP dropped them too. *Source:* M13 point 4.

### D84. The `mostra/initialize` shapes
- **`capabilities`.** The client lists the notifications it accepts. The instance lists its methods, the notifications it sends and the ports it supports.
- **`HomeConfig.path` is a check, not a setting.** The supervisor resolves its home at process start (`--home`, then `MOSTRA_HOME`, then the platform default; an SDK passes its `home` option as `--home`) and has locked it before `mostra/initialize` arrives. When `HomeConfig.path` is present and names a different home, initialization is refused with `MOSTRA_HOME_MISMATCH`.
- **`instance`** also reports the supervisor's `pid` and its `mode` (`host` or `daemon`).
- **Ports.** Registering a port the instance doesn't implement, including the reserved `ai` (D46), returns a warning. It is never a silent no-op.

*Source:* M13 point 5. *Fills* INTERFACES §6.

### D85. The runtime binary and module layout
- **Binary.** `mostra-runtime host|daemon` is the runtime bundle's entry point. `mostra host` is `mostra-runtime host`, so the Rust crate and the SDK spawn it directly from the bundle, and `mostra daemon start` runs `mostra-runtime daemon`.
- **Modules.** `@mostra/runtime` gains the modules `home` (resolution, permissions, the runtime directory and acquisition) and `instance`. `instance` is the composition root only: it assembles the other modules and holds no policy of its own.
- **Home permissions.** A home the user owns is tightened to mode 0700, and the supervisor logs that it did. A home owned by someone else fails closed with `MOSTRA_HOME_NOT_OWNED`, because Mostra keeps secrets there (D44).

*Source:* M13 point 6. *Fills* REPO_STANDARDS §3 and INTERFACES §6.

### D86. An `integration` CI job on macOS and Linux
Suites that run real Mostra processes (sockets, process groups, start times) run in an `integration` job on both macOS and Linux. The plan job runs it only when the runtime or the protocol is affected, so pull requests stay inside the 10-minute target (D50). Later packages add their real-process suites to this job. *Source:* M13 point 7. *Fills* REPO_STANDARDS §6.

### D87. Stopping an instance
SIGTERM and SIGINT stop an instance cleanly: in-flight ledger transactions finish, children stop, and the socket and `instance.json` are removed before it exits 0. `mostra/shutdown` is available to attached clients of a daemon as well as to the spawning host. The socket is owner-only, so every attached client is the same user, and `mostra daemon stop` uses the method. Idle exit after 30 minutes stays with WP-08 (RT-08, D62). *Source:* M13 point 8. *Amends* INTERFACES §6, which said "host-spawned only".

### D88. Prose review for WP-02
Mirza delegates WP-02's diagnostic wording as at M11, except for the hints a person is likely to read when something goes wrong. He reviews those in the candidate: `MOSTRA_HOME_LOCKED`, `MOSTRA_HOME_NOT_OWNED`, `MOSTRA_HOME_SOCKET_TOO_LONG`, `MOSTRA_HOME_TOO_NEW` and `MOSTRA_PLATFORM_UNSUPPORTED`. `packages/runtime/AGENTS.md` is shown in full, because agents read it in every later package. *Source:* M13 point 9.

### D89. Version identity covers the artifact (delegated)
`versionId` is `ver_` plus the first 26 Crockford base32 characters (D77) of the SHA-256 of the artifact ID's UTF-8 bytes, one `0x00` byte, the 32 bytes of `sourceDigest` and the 32 bytes of `envDigest`. Publishing the same source in the same environment for the same artifact still returns the existing version (`reused: true`), and a bundle imported into another home keeps its version ID because it keeps its artifact ID (RM-01). Two artifacts with identical files, such as a copied directory bound by path, now get two versions instead of colliding on `version.id`. *Source:* M14 Q1 (delegated); found by WP-03. *Amends* D77 and DATA_MODEL §2, which hashed `sourceDigest ‖ envDigest` only.

### D90. The publish receipt and events before the gateway (delegated)
- `PublishReceipt.url` is optional on the wire. The capability URL needs the gateway, its leased ports and tokens (WP-05), so WP-03's receipts have none. WP-05 sets it on every publish, and from then on every receipt carries it. The field stays optional, so the schema never changes; hosts use it when present.
- WP-03 creates DATA_MODEL §3's `event` table and appends `artifact.created` and `version.published` in the publish transaction, as ARCHITECTURE §3 step 6 says, so the receipt's `cursor` is real from the start. WP-06 adds reading, filters, subscriptions and the other event types on the same table.
- Whatever a later package must change because of this is written into that package's specification (WP-05, WP-06), so its session sees it.

*Source:* M14 Q2 (delegated, with the request to note follow-ups where later packages see them).

### D91. The warm set is the package `@mostra/warm` (delegated)
The warm set (ROUND-3 §1.2) is an unpublished workspace package, `packages/warm`, whose dependencies are exactly the warm packages and which contains no code. The builder links each build's `node_modules` to it, so artifacts resolve the warm set with no `package.json` and one React copy, and `@mostra/runtime` keeps no dependency on React (REPO_STANDARDS §3). WP-03 starts it with what WP-03's builds need (`react`, `react-dom`, `react-router`, `tailwindcss`, `@mostra/react`); WP-04 turns it into the pre-built warm layout of the shared store and adds the rest of the warm set; WP-11 ships it in the runtime bundle. *Source:* M14 Q3 (delegated). *Amends* the package map (REPO_STANDARDS §3).

### D92. The `ARTIFACT` diagnostic area (delegated)
INTERFACES §13 gains the area `ARTIFACT` for finding and creating artifacts: an unknown artifact or source path, a source that no longer exists, a directory that isn't empty, an unknown template. Every method that takes an `ArtifactRef` or a `SourceRef` reports these codes. *Source:* M14 Q5 (delegated).

### D93. WP-03's check boundaries and prose
- **Boundaries.** Some WP-03 checks name features later packages build: `verify` in AU-01 and AU-02 (WP-09), results in AU-04 and VR-11 (WP-06), regression baselines in VR-11 (WP-09), and verify and action calls in RT-02's process audit (WP-08, WP-09). WP-03 proves everything else through the real interfaces. Each of those packages extends WP-03's fixtures and audit to its feature, as its specification says.
- **Issue #7.** The gated child launcher, which records a child before it may run its command, is WP-03's (it was left out of WP-03's specification by mistake).
- **Prose.** The agent-facing prose of WP-03 is delegated (as at M11). The agent brings Mirza only the texts it isn't confident in, at the very end, when the pull request is about to merge.

*Source:* M14 Q4, Q6, Q7.

### D94. The install child runs pnpm 10 (delegated)
Mostra's package installs run pnpm 10 (`pnpm` 10.34, MIT), not the repository's pnpm 12:
- **Why the `pnpr/` rule exists.** Everything users install is Apache-2.0 over OSI-licensed components (D14, invariants 8 and 9), and the runtime bundle ships the installer (WP-11). pnpm's `pnpr/` directory is under PolyForm Shield 1.0.0, which isn't an OSI license (it forbids competing products), so shipping its code would put non-OSI terms inside Mostra (D20, DP-06).
- **Finding (2026-10-13).** pnpm 12's native binary (`@pnpm/exe.<platform>`, npm license MIT) statically links `pnpr-registry`, `pnpr-package-name` and `pnpr-error` through `pnpm-config`. Those crates sit in `pnpr/crates/` with `license-file = "../../LICENSE.md"`, the Shield text. pnpm 11's JavaScript bundle contains `pnpr/client`, declared MIT but inside the directory the pnpm README puts under Shield. pnpm 10.34 contains no `pnpr` code at all ([VERIFIED_FACTS](VERIFIED_FACTS.md#wp-04-re-verification-2026-10-13)).
- **Nothing is lost.** pnpm 10 has every capability WP-04 uses: the content-addressed store, offline and frozen installs, `link:` peers, lifecycle scripts, `minimumReleaseAge`, `--lockfile-only` and the NDJSON reporter. It is maintained (`latest-10`; 10.34.7 on 2026-10-12) and was faster in the prototype (2.5 s against 4.4 s for pnpm 11 on the same install). The installer is internal to the `deps` module, so a later switch changes no interface.
- **Enforced.** The license audit refuses `pnpm` 11 or later and every `@pnpm/exe.*` package in the core's dependency tree.
- **Repository tooling stays on pnpm 12.** It is a development tool that Mostra never distributes, and Shield permits every use that doesn't compete with pnpr.

*Overturn:* a pnpm release whose published artifacts contain no `pnpr/` code, or pnpm 10 ending its security releases. *Source:* M15 Q1 (delegated; the capability condition holds).

### D95. The dependency model (delegated)
How DP-01 to DP-05 work, filling what DATA_MODEL and INTERFACES left open:
1. **The warm layer.** The warm set (D91) stays one pre-built, read-only layout. An artifact that imports nothing beyond it builds straight against it, with no install. An artifact with on-demand packages builds against a lock layout, `deps/locks/<lockDigest>/`, whose `package.json` links every warm package through one `warm` symlink (`link:warm/<name>`). pnpm then resolves every peer dependency on React, or on any warm package, to the single warm copy, so one React holds by construction, and the installer's lockfile carries no machine paths.
2. **The working lockfile.** Each artifact has one working lockfile in the ledger (`dependency_lock`), keyed by its artifact ID, or by its source path until its first publish binds it (re-keyed inside the publish transaction). Publish, `verify` (WP-09) and `deps/add` read and write it, so they agree on versions. Publish freezes it into `versions/<id>/lock.yaml`. Mostra never writes into the artifact's source.
3. **The lockfile format.** WP-03's `lock.yaml` grows additively. When the artifact has on-demand packages it gains `packages` (each direct on-demand package with its exact version) and `pnpm` (the installer's lockfile text, which pins the whole graph). An artifact without them keeps WP-03's form. `lockDigest` is the SHA-256 of the text.
4. **Resolution.** Package imports are found statically in the snapshot, never by running code: static, dynamic and `require` imports and `@jsxImportSource` pragmas in scripts, ESM blocks in MDX, `@import`, `@plugin` and `@reference` in CSS. Every pin is exact: a new package resolves through `pnpm add --save-exact`, and the working lockfile seeds everything already resolved, so a republish is reproducible and works offline. Packages added with `deps/add` stay in the lockfile whether or not the source imports them yet.
5. **Policy.** `HomeConfig.dependencies` is `"auto"` (the default) or `"explicit"`, persisted in the home's `config.json`. Under `"explicit"` only `deps/add` adds packages, and an import of anything else is `MOSTRA_DEP_MISSING` at the import's location, with the exact command.
6. **`mostra add`.** WP-04 delivers it as the host protocol method `deps/add`. The CLI command (WP-10) is a thin client of it: `mostra add <package…> [--artifact <path|id>]`, defaulting to the artifact in the current directory.
7. **Release age.** A package resolved without an exact version takes the newest release at least one day old (pnpm's `minimumReleaseAge`, 1440 minutes). That holds back a freshly compromised release, not the user: a package named with an exact version in `deps/add` installs whatever its age.
8. **Lifecycle scripts run** for every on-demand package (pnpm's build approval is off), inside the install child: a process the process manager starts in the artifact's source directory with the artifact environment, an allowlist (`PATH`, `HOME`, `TMPDIR`, locale, time zone, the user's name and shell, the native-build toolchain variables such as `CC` and `XDG_CACHE_HOME`, proxy and certificate variables, `npm_config_*`). Nothing else of the supervisor's environment reaches it.
9. **Offline.** Mostra is offline when `MOSTRA_OFFLINE` is set, when no non-loopback network interface is up, or when the registry can't be reached. A package the home's store doesn't hold then fails with `MOSTRA_DEP_OFFLINE`, naming it. When the store index already shows that, the supervisor answers before any child starts. An install is stopped after 300 s with `MOSTRA_DEP_TIMEOUT` (FAILURE_MODEL §9).

*Rejected:* declarations in a `package.json` or a manifest field (a single-file artifact has nowhere to put them, and verify and publish wouldn't share pins); copying the warm packages into every lock layout (a second React per layout unless deduplicated); finding imports by building first (a failed build per new package, and no answer within DP-04's second). *Source:* M15 Q2 to Q7 (delegated).

### D96. WP-05's check boundaries (delegated)
Each split leaves the later package free: WP-05 builds nothing the later package would have to work around.
- **LL-05's doctor warning.** WP-05 proves that local capability URLs don't expire and stay revocable and rotatable. The `mostra doctor` warning about long-lived artifacts (policy `none`, D63) in a home without an always-on daemon is WP-10's, which owns `doctor`, built on WP-08's `mostra daemon install`: doctor reads the artifacts' policies through `artifact/list` and looks for the login-service unit WP-08 installs for the home.
- **HY-01 item 13, MCP over HTTP.** The request checks (exact Host, exact Origin, JSON content type with the CSRF header, request-target and header sanity) are pure functions in `@mostra/protocol` (`hygiene`), with no I/O, so the gateway and WP-15's `mostra mcp --http`, a separate process, apply the same code. WP-15's HTTP hygiene tests close item 13 on that transport.
- **VR-03 and `mostra dev`.** WP-05's route enumeration covers everything the gateway serves. WP-10 adds `mostra dev`, on its own port and never behind a capability URL, to the same enumeration.
- **Routes later packages implement.** The gateway declares every route of INTERFACES §4 with its scope and checks now, so a view-only session is refused on `/submit` or `/call/…` before any handler exists. WP-06, WP-07, WP-08, WP-13 and WP-20 attach handlers behind the declared checks and repeat the scope tests with real handlers.
- **RT-05.** WP-08 keeps WP-05's zero-worker test green: a worker starts only for a version with server code.

*Source:* M16 points 1 to 3.

### D97. Capability links (delegated)
1. **Form.** `http://<url host>:<shell port>/a/<artifactId>[/v/<number>]#t=<secret>`; the URL host is `127.0.0.1` unless D99's flags say otherwise. The secret travels in the fragment, so no server, log or `Referer` sees it. The shell posts it to its exchange endpoint and removes it with `history.replaceState`. Without `/v/<number>` the link opens the artifact's latest version.
2. **Tokens.** A token is a `tok_` ULID and a secret of 26 Crockford base32 characters (130 bits): HMAC-SHA-256 of the token ID under the home's capability key, 32 random bytes in `<home>/keys/capability` (mode 0600). The ledger stores only the SHA-256 of the secret, so a copy of the ledger grants nothing. Deriving the secret lets Mostra show a link it minted again without storing it. A lost key changes nothing for existing links, which verify by hash; Mostra writes a new key and mints a new default link.
3. **The default link.** Each artifact has one default link: every scope, no expiry. Every `PublishReceipt.url` is that link, so it stays the same across publishes and `requestId` replays, and the receipt gains an optional `tokenId` to rotate or revoke it. `view/url` always mints a new token.
4. **Scopes.** `view` (every token has it), `draft`, `submit`, `review`, `signal`, `action:*`, `action:<export>` (that export of any `"use server"` module) and `action:<module path>#<export>` (one function ID). `view/url` defaults to every scope. `signal` joined after the Claude review (M17): a signal may wake an agent (D10), so a view-only link must not raise one.
5. **Expiry.** `ttl` is a duration (`30m`, `24h`, `7d`); local links have none by default (D63). An expired or revoked token, and every session made from it, answers 410 with `MOSTRA_HYGIENE_TOKEN_REVOKED`.
6. **Rotation.** `view/rotate { tokenId }` mints, in one transaction, a token with the same artifact, scopes and expiry and revokes the old one, appending `token.revoked`. Rotating the default link makes the new token the default.
7. **Viewer.** `view/url`'s `viewer` arrives with WP-06, which first records viewers; until then every session is the home's local user.
8. **Guessing.** Failed capability tokens count per artifact; past 30 in a minute, every token for that artifact gets 429 with `Retry-After` until the window clears. A correct token is refused too while the limit holds, so a guess can't succeed during an attack, and the limit is checked in the same step as the token, so guesses sent together can't slip past it. Tokens for artifacts the home doesn't have share one count. Frame tickets don't count: they are single-use 130-bit secrets that live a minute, and any page on the host could spend a count by loading an entry URL. A frame entry the browser marks `Sec-Fetch-Site: cross-site` is refused (403) before its ticket is looked at (found in WP-05's review). *Amended after the Claude review (M17):* the limit was one per gateway and counted frame entries, so one artifact's page could lock every viewer of every artifact out.
9. **A link that names a version opens that version only** (M17). Its shell asks for no other version (403 `MOSTRA_HYGIENE_SCOPE_DENIED`), and its frame gets no file of another version through D98 item 5's asset fallback. A link without a version follows the latest. Rotation keeps the version, as it keeps the scopes.
10. **A link works only at the shell address it was minted for** (M17). A token records its shell origin; when the shell moves to another port (a lease another program took, D99), old links answer 410, because whoever holds the old port could read their secrets from the fragment. The default link is minted again at the new address, and old links work again if the gateway returns to the old one.

*Source:* M16 points 4 to 7.

### D98. Sessions and frames in cookie mode (delegated)
Browsers keep cookies per host, not per port, so every artifact port and the shell share one cookie jar, and a page on one port is same-site to all the others (VERIFIED_FACTS, addressing prototype). The rules follow from that:
1. **One session cookie per origin.** It is named `mostra-<port>`, holds a 26-character random secret (the ledger keeps its SHA-256), and is `HttpOnly; SameSite=Strict`, never `Secure` over loopback HTTP. An artifact's cookie has `Path=/`. The shell's has `Path=/a/<artifactId>`, so each artifact's shell session is separate. `Max-Age` is 400 days, the recommended cap, so a bookmarked page survives a browser restart. Every request checks that the session was issued for this listener's origin and that its token is live.
2. **CSRF.** Each session has a CSRF token, derived from its cookie with SHA-256 under a fixed label, so the ledger keeps only the token's SHA-256, as it does the cookie's: a copy of the ledger can't forge either. Same-origin code reads the token from `GET /_mostra/session` (artifact origins) or `GET /a/<artifactId>/_mostra/session` (shell); every mutation sends it as `X-Mostra-CSRF` with a JSON content type. A double-submit cookie can't work here, because every port can read the host's cookies. (WP-05's hygiene suite found the first version storing a random token in plain text.)
3. **Frames.** The shell posts for a single-use frame ticket (60 s, kept in memory, bound to its session, the artifact's origin and the version); the frame opens `GET /_mostra/enter?ticket=…`, which creates its session (or updates the one it has for the same token) and redirects to `/`. A ticket works only while the shell session that asked for it exists (the binding was missing until the Claude review, M17).
4. **Framing.** The shell sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`; artifact documents send `frame-ancestors <shell origin>`. Otherwise one artifact's page, holding the shared cookies, could frame another artifact or its shell and lead the viewer into clicking its buttons or its trusted Submit.
5. **One current version per browser and artifact origin.** Versions are built with base `/`, and agent code uses absolute paths (D38), so an artifact origin serves the version its frame session last entered. Content-hashed files under `/assets/` are served from any version of the same artifact the link may open, so a page keeps loading its chunks after another tab switched versions; WP-07's banner tells the older tab. Every file served comes from a version whose stored files match its output digest; the check runs before a version's first file and again whenever a served file's change time differs (FAILURE_MODEL §3, Claude review finding 5).
6. **Every response** carries `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`, and no `Access-Control-*` header ever.
7. **The frame can't replace the shell** (M17). The frame is sandboxed with every capability a page has (scripts, its own origin and storage, forms, dialogs, popups that escape the sandbox, downloads, pointer lock, presentation, storage access) except navigating the viewer's tab, which would let artifact code swap the trusted shell for a look-alike page and defeat WP-07's trusted controls. The shell keeps only the tokens the browser knows, so WebKit logs no error. The shell page sends `Cross-Origin-Opener-Policy: same-origin`, so the frame's popups have no opener: Firefox lets even a sandboxed popup navigate `opener.top` (VERIFIED_FACTS, WP-05). An artifact sends the viewer elsewhere with `ui/open-link` (MCP Apps, `openLink` in `@mostra/react`), which the shell opens in a new tab without an opener, for `http:`, `https:`, `mailto:` and `tel:` URLs. This withholds one navigation, not a capability: everything the artifact could reach before, it still reaches (D05), and it is what keeps trusted controls trusted (D06).
8. **Another link never silently replaces a session** (M17). One shell session per browser and artifact means opening a second link replaces the first, and any page could send the viewer to its own, narrower link and take over their tabs. When a live session from another token exists, the exchange answers 409 `MOSTRA_HYGIENE_SESSION_CONFLICT` with what each link allows; the shell shows both and lets the viewer keep theirs or use the new one (`replace: true`). The same link again reuses its session, and a session whose link died is replaced without asking.
9. **A full cookie jar** (M17). Every port of the host shares one jar, and any artifact's page can fill it; Chromium, Firefox and WebKit keep about 400 KB per host (VERIFIED_FACTS, WP-05). Listeners accept headers up to 1 MiB, so a full jar still works. Past that a request gets 431 `MOSTRA_HYGIENE_HEADERS_TOO_LARGE`, a page that runs nothing and sends `Clear-Site-Data: "cookies"`, which empties the host's jar; Mostra's sessions come back with the next link.

*Source:* M16 points 7 to 9.

### D99. Binding and port leases (delegated)
- **Bind.** The gateway binds `127.0.0.1` only. `mostra-runtime host|daemon --bind <address>` binds another address; a wildcard address (`0.0.0.0`, `::`) also needs `--url-host <name>`, the host name its URLs use and its Host allowlist accepts. Neither flag is persisted, so every wider start is explicit, and a public share never falls back to it (FAILURE_MODEL §8).
- **Leases.** The shell port and each artifact's port are leased in `port_lease` from 20000 to 32767, below the ephemeral ranges of Linux (32768 to 60999) and macOS (49152 to 65535), so outgoing connections never take a leased port between restarts. Every leased port is bound at start; one taken by another program is leased again with the warning `MOSTRA_ENV_PORT_TAKEN`, and its old URLs stop working (FAILURE_MODEL §8).

*Source:* M16 point 10. *Amended by D132:* artifact listeners not viewed in the last 7 days bind when first used.

### D100. A `requestId` replays only its own request (delegated, M17)
Every mutating method records a SHA-256 of its parameters (RFC 8785-style canonical JSON without `requestId`) beside the result it records for a `requestId` (DATA_MODEL §3 `request.params_digest`). A retry with the same parameters gets the recorded result, as H-03 requires; the same `requestId` with other parameters is refused with `MOSTRA_HOST_REQUEST_ID_REUSED` (-32000), including while the first attempt still runs. Replaying would answer a request nobody made: `view/url` would hand out a wider link than asked for, another artifact's, or one without the requested expiry (Claude review finding 8). Rows recorded before the column existed replay as before. *Source:* M17; refines H-03.

### D101. WP-06's check boundaries and prose (delegated, M18)
Each split leaves the later package free, as D93 and D96 required:
- **Clients.** WP-06 proves `wait`, `results/get`, `state/*` and events through the host protocol over both transports. `mostra wait`, `results` and `state` repeat those checks through the CLI in WP-10, and `createMostra` through the SDK in WP-11. The conformance scenarios that IN-06 to IN-10, IN-12 and LL-02 name are WP-12's kit, built on the same methods and ports.
- **The shell channel.** The submit transaction serves both channels (D40) and is tested for both. The shell's trusted Submit, the channel policy and the absence of a Submit control under policy `none` are WP-07's (SH-02, IN-13); WP-06 refuses a submit under `none` and serves the artifact channel's route.
- **Signals from actions.** `signal.raised` with `source: "action"` exists and is tested in the interaction module; WP-08's `signal()` in `@mostra/server` calls it.
- **Comments and action runs in results.** `Results.comments` and `Results.actions` stay empty until WP-20 and WP-08 fill them from their tables; the Markdown renderer is proven now by a golden that has every section.
- **Compaction.** The interaction module compacts and every reader reports `MOSTRA_HOST_CURSOR_COMPACTED`; `mostra gc --compact-events` (WP-10) is the command that triggers it.
- **Prose.** The diagnostic hints and `AGENTS.md` additions are delegated as in WP-03 to WP-05: Mirza sees only the texts the agent isn't confident in, before the merge.

Each follow-up is written into its package's specification.

### D102. The submission policy in force (delegated, M18)
The manifest requests a policy and the host decides (D39, D63). At every publish the policy in force is the first of: the publish's `policy`; the policy an earlier publish of the artifact named explicitly (a host's explicit choice sticks until another publish names one); the home's `HomeConfig.submission` (kept in `config.json` like the dependency policy); the manifest's `submission`; `once` with scope `per-artifact`. A `once` without a scope is `per-artifact`. The resolved policy is stored on the artifact and reported by `artifact/get`, and submissions follow the policy in force when they are made. A host such as Jcode can so force `once` whatever an agent's manifest asks, either per artifact at publish or for the whole home, and the standalone CLI honors the manifest. (The sticky explicit choice was added while building: without it, an agent's plain republish silently undid a host's choice.)

### D103. Epochs and `wait --until submitted` (delegated, M18)
- **Epochs are per viewer.** Each viewer's draft carries an epoch, starting at 1. A submit under `epochs` records the draft's epoch, links the submission to the previous one of the same viewer, and moves the draft to the next epoch in the same transaction. The draft's values carry forward, so the viewer edits and submits again; nothing on the page resets.
- **`submitted`** is level-triggered under `once`: any submission of the artifact satisfies it, whatever the cursor, so a wait after the human already submitted returns at once (D11). Under `epochs` it is satisfied by the first submission after the cursor, which defaults to the artifact's latest publish, so a waiting agent is never handed a round it already read. Under `none` it is refused with `MOSTRA_SUBMIT_POLICY_NONE`.
- **The others** (`signal:<name>`, `state:<fieldId>`, `event:<type>`) are edge-triggered after the cursor (ARCHITECTURE §6). `still_waiting` returns the newest cursor the wait examined, so the next wait misses nothing.

*Extended by D121:* wait conditions for every expected respondent and for N submissions (WP-31).

### D104. Views and viewers (delegated, M18)
- **A view is one frame load.** The gateway records a view each time a shell asks for a frame ticket: the artifact, the exact version the ticket opens and the viewer, with `view.opened`. The ticket answer carries its `viewId`, which the shell hands its frame over the bridge (WP-07). Mutations and submits name their view, and the server takes the version from the view, never from the frame's session (which another tab may have moved), so a submission names exactly what its tab showed (IN-05, H-10). A view of another viewer or artifact is `MOSTRA_SUBMIT_VIEW_INVALID`.
- **`view/url`'s `viewer`** (D97 item 7) is `{ ref, name? }`: `ref` is the host's own stable key for a person (an email, an account ID), mapped idempotently to one viewer of kind `token`, and `name` its display name, updated when given. The link's sessions act as that viewer; rotation keeps it, and a token's viewer never changes (the token trigger). Without `viewer`, sessions act as the home's local user, one viewer of kind `local`. `once` per-viewer surveys mint one link per person.

### D105. Deliveries and draft mirrors (delegated, M18)
- **Owners.** A submissions port belongs to the host that registers it, named by its `client.name`, so deliveries outlive connections. `HomeConfig.ports` records, per client name, the ports that host always provides (`config.json`; an empty list clears it). A submission gets one delivery per owner that is registered or expected at commit; with neither, it gets one to Mostra's built-in adapter, which accepts at once (D58's standalone default).
- **Order.** Each owner's deliveries go out one at a time in submission order. A retryable failure (`retry: true`, a transport failure, no answer within 30 s) keeps the head pending with backoff from 1 s doubling to 5 min; an owner that isn't connected is retried when it registers again. Accepted is `delivered`; `accepted: false, retry: false` is `undeliverable` for the reason `undeliverable`, `delivered` for `duplicate` (the host already holds it, as ROUND-2's SDK example uses it) and `rejected` otherwise, each with its event. Mostra never retries a terminal answer.
- **Identity.** Each delivery has a stable `deliveryId` (`dlv_` and a ULID) that a redelivery after a crash repeats. The envelope carries `kind: "submission"` and the Results structure built from the immutable submission row alone.
- **Draft mirrors** (`drafts.mirror`) are best effort: each viewer draft's latest revision goes to every connection that registered the port, coalesced while one is in flight, with `kind: "draft"` so no host can take one for a submission (IN-06). A mirror is never retried, and never delivered through the submissions port.

### D106. Fields, signals and the first browser-protocol revision (delegated, M18)
- **Mutations.** A field op conflicts when the field changed after the mutation's `baseRevision`; the other ops apply, and one revision covers them. Viewers always send a base; agents and hosts may omit it to write unconditionally. A mutation ID replays its recorded result and is refused with `MOSTRA_FIELD_MUTATION_ID_REUSED` when sent again with other contents. Ops carry the field's optional `label`, `required` and `sensitive`, which results and event redaction use. A draft closed by a `once` submission takes no further writes (`MOSTRA_SUBMIT_ALREADY`); artifact state stays writable.
- **Submit is a signal.** Every submission also appends `signal.raised` with the name `submit` and its channel as the source, so `signal:submit` and host filters see it like any other signal. Required fields are checked by the shell and the client runtime before submit (WP-07); the server, which can't know which fields a page shows, doesn't guess.
- **The browser protocol.** WP-06 defines revision `2026-10-15` of the browser protocol: the payloads of `fields`, `submit`, `signal`, `events` and `events/poll`, as Zod schemas in `@mostra/protocol`. The gateway serves only revisions it knows. WP-07 builds the client runtime on it and records it in `envDigest`; WP-13 adds the long-poll fallback over tunnels on the same handler.

### D107. Waiting for the next respondent under `once` per-viewer (delegated under M18; found by the Claude review)
Amends D103. Under `once` with scope `per-viewer` (a survey: one submission per person), `wait --until submitted` is level-triggered only when the caller gives no cursor, so "has anyone answered?" returns at once. After an explicit `after` cursor it is edge-triggered, as under `epochs`: the first submission after the cursor satisfies it, so an agent can wait for each next respondent without being handed the first one forever. `once` per-artifact stays level-triggered whatever the cursor (exactly one submission exists or will). *Source:* finding 5 of WP-06's Claude Opus review; Mirza delegated WP-06's interaction semantics at M18, and the choice is shown to him at the candidate. *Extended by D121:* waiting for the whole roster of expected respondents (WP-31).

### D108. The submit channel policy in force (delegated, M19)
Fills D40 and INTERFACES §6 and §7, which name both a home setting and the `trustedControls` port:
- **The home's default.** `HomeConfig.submitChannels` (`["shell"]`, `["artifact"]` or both) is kept in `config.json` like the other settings, so it holds while its host is away. Without it, both channels are allowed (D40).
- **The host's answer per artifact.** When a connected client registered `trustedControls`, the gateway asks its `policy` when a frame ticket is issued, bounded at 5 seconds because the page is waiting. The answer's `submitChannels` and `controls` replace the home's default for that view. A call that fails or times out narrows the view to the shell channel and logs why: a host that took over the policy never has it widened by its own outage.
- **One record per view.** The channels and controls in force are stored on the view (`view.controls_json`), so the shell, the page and the server judge a view by the same answer. The shell renders only the controls the view allows. The artifact's `submit()`, and its writes to `review.<set>.choice`, are refused with `MOSTRA_SUBMIT_CHANNEL_DENIED` where the artifact channel isn't allowed. Every submission records its channel (D40).
- **Activation.** After a trusted control's change commits, a registered `trustedControls.activated` is told, best effort and never retried, like draft mirrors (D105).

### D109. Field coverage and orphans (delegated, M19)
Fills D42 and DATA_MODEL §3, which left open how Mostra knows which fields a version has:
- **Coverage is static.** The builder records in `registry.json` every field ID the version's code can use: literal IDs of `useField`, `useChoice` (`review.<set>.choice`) and the form adapter; template IDs as patterns; `storage.*` where the code uses `window.storage`. A field ID the scan can't know (a computed one, or one an MDX page or a package passes) makes the version *open*: it covers every ID, so nothing is ever orphaned by a guess. A version built before WP-07 has no `fields` and is open too. WP-18 and WP-20 extend the scan to kit inputs and review sets.
- **Orphans are derived, never stored.** A draft field is an orphan of a view when the view's version doesn't cover it. A submission computes its `orphaned` section in the submit transaction against the submitting view's version; the banner counts orphans against the newer version; the "Not carried over" panel lists them against the view's own. Nothing moves or is dropped: the field stays in the draft, a version that covers it shows it again, and every orphan is delivered (D42).
- **`fromVersion`.** Migration 6 renames DATA_MODEL's unused `field.orphaned_from_version` to `field.version_number`: the number of the version whose view last wrote the field, which is an orphan's `fromVersion`.
- **No fields declared.** A version whose code uses none of these (it writes the browser protocol itself, or keeps no fields) is open too: found while building, when such a version orphaned every answer it saved.

### D110. A submission contains what the viewer saw (delegated, M19)
`useField(id, initial)` stores nothing until the value changes, as `useState` would. Before any submit, through either channel, the client runtime writes the initial value of every mounted viewer field the draft has never stored, then flushes every pending save. A submission therefore holds the defaults the viewer saw and accepted, and the shell's required-field check, which reads the server's draft, agrees with the page. Fields that aren't mounted (another page, a closed section) were never seen and stay out.

### D111. WP-07's check boundaries (delegated, M19)
Each split leaves the later package free and gives it a baseline, as D93, D96 and D101 required:
- **Delivery targets (AU-09).** The client runtime takes its target from a `<meta name="mostra-target">` the exporters write (`static`, `mcp-app` or `verify`; none means `live`), and with it the history mode: browser, hash or memory. WP-07 proves each mode against a real version's client build served with that marker. WP-13's static export and WP-17's MCP App exporter write the marker and repeat the check; WP-09's `verify` sets `verify`.
- **Browser-protocol revisions (VR-10).** The first revision, `2026-10-15`, grows additively in WP-07. Every revision the gateway serves has a frozen fixture version in the repository, built at that revision and run in CI against the current gateway and against one that also serves a newer, test-only revision. A real N+1 adds its own fixture.
- **Shell wording.** The viewer-facing words (delivery states, banner, panel) are shown to Mirza with the candidate (IN-13). WP-20's design pass may restyle the shell, never weaken its trusted controls.
- **Prose** is delegated as in WP-03 to WP-06: Mirza sees only the texts the agent isn't confident in, before the merge.

### D112. `window.storage` compatibility details (delegated, M19)
D53's `window.storage` follows the API Claude-written artifacts use (`get`, `set`, `delete` and `list`, each with `shared`, answering `{ key, value, shared }`) over Mostra fields. Anthropic's help center documents personal and shared storage and a 20 MB limit per artifact, but not the signatures (VERIFIED_FACTS, WP-07), so Mostra's choices are stated here. A missing key resolves `null`, which code written to expect a thrown error or `null` handles alike. A value is limited to DATA_MODEL's 1 MiB per field, refused with `MOSTRA_FIELD_TOO_LARGE`, never truncated; a larger value belongs in a blob. Writes are last-write-wins, as in Claude: a conflict on a storage key is resolved by writing again on the newer revision.

### D113. `useChoice` names its candidates (delegated, M19)
`useChoice(reviewSetId, options?)` takes an optional `{ candidates: { id, label? }[]; current?: string }`, an additive extension of INTERFACES §2.3. With candidates it asks the shell for the trusted Choose control of that review set, which the shell renders outside the frame ("Choose Airy"). WP-20's `ReviewSet` passes them.

### D114. Claude reviews for up to ten packages (M19)
Amends D80 item 3: Claude Opus 5.5 may review up to ten of Mostra's packages, still chosen for substance and still waiting for Mirza's approval of each run (D34). *Superseded by D144:* there is no limit.

### D115. A frame always shows its own view's version (delegated, M19)
D98 item 5 lets an artifact origin serve the version its frame session last entered, so a tab whose frame reloads after another tab switched versions gets the other version's page. WP-07 makes that page unable to act as the wrong view, rather than only telling the viewer:
- **The page names its build.** The builder writes `<meta name="mostra-version" content="<versionId>">` into every version's `index.html` (the version ID is known from the digests before the build, D89, so builds stay a function of their inputs), and the client runtime sends it in `ui/initialize` (`mostra.versionId`, an additive parameter).
- **A mismatch saves nothing.** A page whose build isn't its view's version runs detached: nothing it shows is saved, journaled or submitted as that view.
- **The shell enters its version again.** The shell answers, then gets a ticket for its own view's version, so the frame reloads at that version. More than three re-entries within ten seconds mean two tabs keep moving the frame session, and the shell says so instead of reloading without end.

The version banner is unchanged: it tells a view about versions newer than its own (VR-04).

## Plan update of 2026-10-16

Mirza approved these in his planning work of 2026-10-16 and handed them over at M20. They change the plan of the packages from WP-08 on; nothing already built changes. Each is an **approved decision**. Where one leaves a choice open, it names the package that settles it as a **deferred decision** (D123).

### D116. The remote server and relay are in v1; the managed service's operating layer is separate
- **v1 adds** a remote transport for the host protocol, a relay (D117), a self-hostable remote server that hosts many homes behind one gateway on a separate user-content domain, viewer sign-in, operator ports, and a remote MCP server over Streamable HTTP with OAuth. These were v1.x (D12).
- **The managed cloud** runs this open remote server. Its multi-tenant operating layer (accounts, billing, quotas, metering, abuse handling, fleet operation) is proprietary and lives outside this repository (D118). The operating layer reaches the remote server only through the operator ports, as hosts reach Mostra only through public ports (invariant 11); nothing in the core depends on it.
- **v1.x keeps** sandboxed remote execution (actions and builds that run on a remote server without the owner's instance, through `SandboxPort`), the plugin registry, RSC, Yjs and the exporters.

*Why:* sharing a link that works without a tunnel and while the author's machine is asleep is central to how people use artifacts; inline MCP Apps in cloud chat hosts can only persist answers through a remote MCP server (D61); the v1 seams (RM-01) make it a bounded addition. *Source:* M20. *Amends* D12 (release ladder), D16 (scope), D61 (cloud chat hosts no longer wait for v1.x), and PRODUCT's non-goal "A managed public hosting service in v1". *Rejected:* keeping remote mode in v1.x; building the operating layer into the open repository.

### D117. Relay: hosted artifacts run their server code on the owner's instance
A remote server forwards a hosted artifact's action calls and live producers to the owning Mostra instance over that instance's outbound connection. The remote server runs no artifact code in v1.
- **Authoring from chat hosts** (an agent in claude.ai or ChatGPT creating, building, verifying and publishing through the remote MCP server): *Deferred decision* for WP-28. Recommendation: relay these operations to the owner's instance in v1, so builds and `verify` run there; cloud-side builds come with RM-06 (v1.x).
- **Secrets** never leave the owner's instance. Capability URLs and scopes authorize exactly as for a tunnel share (D06, D97).
- **When the owner is offline,** hosted pages, drafts, submissions and comments keep working; action runs wait or fail according to the artifact's offline policy; live sources show their last value with its time. The exact states, timeouts and ordering are a *Deferred decision* for WP-28.

*Why:* no user code on shared infrastructure, a small attack surface, low cost, and identical semantics to local use. *Source:* M20. *Overturn:* sandboxed remote execution (v1.x) adds a second path, never replacing the relay.

### D118. License layers
- **Core:** everything users install, embed or self-host outside `ee/` stays Apache-2.0 with NOTICE and DCO, including the remote server (D116).
- **`ee/`:** a top-level folder for enterprise features of self-hosted servers, source-available under a commercial license whose text Mirza supplies before the first `ee/` code. The core never imports `ee/` (a boundary rule); the license audit treats `ee/` separately; contributions to `ee/` come only from the core team unless a CLA is introduced later. Which features go there (for example SSO, SCIM, audit log, retention, admin console) is a *Deferred decision* for the package that first builds `ee/` code, with Mirza.
- **The operating layer of the managed service:** proprietary, in a separate private repository (D116).

*Source:* M20. *Amends* D14 and invariant 9. D14's overturn condition is restated: if a well-funded competitor runs the Apache remote server as a competing managed service and takes significant share, new server-side modules may move to FSL-1.1-ALv2; the core runtime stays Apache. *Rejected:* closing the repository; FSL or BSL for the core; a proprietary remote server (self-hosters and embedding hosts need it open, and D14 already promised it).

### D119. Telemetry in the standalone CLI
- The standalone CLI sends anonymous usage telemetry by default, announced on first run, and turned off by a setting, an environment variable or `DO_NOT_TRACK=1`.
- **Never from embedded use:** the SDK, the Rust crate, host-spawned instances and any home a host configures send nothing. This keeps the approved H-16 rule for Jcode and every host unchanged.
- Events are listed publicly in the docs. They carry no artifact content, paths, tokens, identities or IP addresses (the collector stores none). The most useful fields are the command, its outcome and duration, the Mostra version, the platform, and the agent or harness that ran it (from MCP `clientInfo` or known environment markers).
- The collector belongs to the managed service's operating layer; the endpoint is configurable and disabled in development builds. The event list and detection rules are a *Deferred decision* for WP-10 with Mirza (the first-run notice is agent-facing prose, D74).

*Decided by D140:* the consent model, the decision order, the event list, harness detection and the endpoint rules (M27, M28). *Source:* M20. *Amends* STANDARDS ("No telemetry"), REPO_STANDARDS, the root AGENTS.md, the work-package protocol and the assignment prompt. H-16 keeps its meaning for hosts. *Clarified by D148:* an MCP server a harness plugin starts counts as embedded use.

### D120. Windows in v1.1
v1.0 remains macOS and Linux, failing closed elsewhere (D35, RT-07). Windows support follows in v1.1, shortly after the first release, as a new package WP-32 under "After the first release". *Source:* M20. *Amends* D35 (adds the target; the fail-closed rule stands for anything still unsupported). *Superseded by D146:* Windows moves into v1.0 as WP-W1 to WP-W3; WP-32 is withdrawn.

### D121. Team features in v1
- **Expected respondents:** an artifact or share names the people who should answer, by the host's stable viewer reference and display name (or email on a remote server that sends invitations); locally Mostra issues one personal link per respondent.
- **Waiting for everyone:** wait conditions for "every expected respondent has submitted" and "N submissions", defined under `once` per-viewer and `epochs`, and an event when the roster completes.
- **Respondent status as data:** each respondent's state (not opened, drafting, submitted) through a client hook, the host protocol and the CLI, so the agent's page shows it in any design.
- **Presence as data:** who is viewing, with opt-in sharing of cursor and selection, delivered as ephemeral traffic (never stored, rate-limited and coalesced). The shell imposes no presence UI.
- **Attribution:** who last changed each artifact-scoped field, and when.
- **Mentions:** `@mention` in review comments raises an event hosts can route (WP-20).
- **Visibility:** owners, agents and hosts always see respondent status. What viewers see of each other by default is a *Deferred decision* for WP-31 with Mirza; recommendation: private unless the artifact opts in.
- Real-time co-editing of text stays the v1.x Yjs plugin.

API names and exact semantics are a *Deferred decision* for WP-31. *Source:* M20. *Extends* D63, D103 and D107.

### D122. Terminals after the first release
WP-22 and WP-23 (TUI frames, renderer, recordings, capture, live PTY, WASM and compare) move to a follow-up release after v1.0, unchanged in content. TM-01 to TM-07 take the release label `v1.1`; J4 and the TUI launch demo wait for them. From WP-25 they take `mostra term record` and the contract proof of their xterm.js engine; WP-25 no longer depends on WP-23. Web demos (TM-08, WP-24) stay in v1. *Source:* M20. *Amends* D16 and D28.

### D123. Specification depth for new packages
From WP-28 on, a package specification fixes the outcome, the architecture at the surface, constraints, useful libraries and references, and the real options with a recommendation. The implementing session settles finer details and records them as delegated decisions, as M13 to M19 already practise. Choices a specification leaves open are labelled *Deferred decision* with the owning package. *Source:* M20.

### D124. `WorkerLauncher` takes a version reference
`WorkerLauncher.launch` takes a version reference (the version's digest and a locator for its portable bundle) instead of a directory path; the local launcher resolves it to a path. `WorkerChannel` carries only serializable messages, and secrets reach a worker through the secrets port, never through inherited environment. *Why:* the seam must fit a remote launcher (D116, v1.x `SandboxPort`) without a migration. *Source:* M20. *Amends* INTERFACES §7. Lands in WP-08.

### D125. New packages and their order
- New packages take the next numbers, WP-28 to WP-32, because the generators require two-digit IDs and renumbering would break history.
- Execution order is the order of WORK_PACKAGES.md: WP-08 to WP-15, then WP-28, WP-29, WP-30, WP-31, then WP-16 to WP-21, WP-24, WP-25, WP-26, WP-27. Under a heading "After the first release" follow WP-32 (Windows, D120), WP-22 and WP-23 (D122).
- D17's interface priority still explains the first part of the order. The remote server comes right after the local MCP server because MCP Apps export (WP-17) persists through it in cloud chat hosts, and the team package needs its viewer identity.
- The C03-B threshold (WP-14, D73) is unchanged. The phase closeout still follows WP-27.

*Source:* M20. *Amended by D146:* WP-32 is withdrawn; the Windows packages WP-W1 to WP-W3 follow WP-12 and carry a W series rather than the next two-digit numbers, and the generators accept both forms.

### D126. Embedding in host applications later
A chrome-less embed mode with host theming, host identity and host-rendered trusted controls (the `trustedControls` port already allows the last) is a `later` item (EX-08), so applications such as desktop GUIs for coding agents can render Mostra views natively. *Source:* M20.

### D127. Business context from Mostra HQ
Mirza keeps Mostra's business context (strategy, decisions, roadmap, product definitions for the managed service and team features) in a private repository, Mostra HQ, cloned at `~/src/mostra-hq`. Every session reads its README, decision log and roadmap for orientation, and the parts its package touches, as HQ's own AGENTS.md lists. The dossier stays the contract: HQ is context, never a reason to deviate without Mirza. Sessions write to HQ only with Mirza's approval. Nothing from HQ enters this public repository (files, issues, pull requests, commit messages, release notes); a product decision it informs is recorded here with product reasons only. *Source:* M20.

### D128. Sub-agents summarize the progress reports and Mostra HQ
The progress reports have grown large, and HQ is a second repository. During Orient, a work-package session:
- has `fast-worker` sub-agents summarize the earlier `PROGRESS-WP-*.md` reports, each with an explicit list, for what bears on its package (decisions, follow-ups, untested boundaries). It may leave the latest report out and read it itself, and it reads in full any report whose details it needs;
- explores Mostra HQ through a `fast-worker` sub-agent given HQ's AGENTS.md and the files it lists, then reads itself any HQ file it needs in full.

The dossier, the specification and its required reading are still read in full by the session. Design, implementation, review and verification stay with it (D49). *Source:* M21. *Amends* D49 item 3's use of `fast-worker`, the assignment prompt ("You read Mostra's own documents yourself, in full") and the work-package protocol §1.

## WP-08 decisions

Mirza delegated every WP-08 question at M22. Each is an **approved decision** taken by the WP-08 session under that delegation; none changes an earlier decision except where it says *Amends*.

### D129. Workers, their channel and their launcher (delegated, M22)
- **One worker per version with server code**, started on the first call, run or producer that needs it (RT-03). The local launcher starts `@mostra/worker` through the process manager (gated, recorded, its own process group) with the artifact environment (`artifactEnvironment`, D95), `--max-old-space-size` from the manifest's `limits.heapMb` (default 1024), and its channel on descriptor 4: newline-delimited JSON-RPC (`WORKER_CHANNEL_REVISION` `2026-10-16` in `@mostra/protocol`), never Node IPC, so the same messages cross a socket.
- **`WorkerLauncher` takes a version reference** (D124): `{ versionId, outputDigest, locator }`, the locator `home:versions/<versionId>` for the local home; a remote launcher names its own scheme. Only the local launcher learns the artifact's source directory, the working directory of its server code (relative reads and `watch` globs). The worker checks the version's manifest and output digest before it loads `server/entry.mjs`, and resolves the bundle's external `@mostra/server` to its own copy, so one `AsyncLocalStorage` holds every call's context (D19 seam 3).
- **`secret()` stays synchronous** (INTERFACES §2.4). The worker's channel runs on a worker thread; `secret()` posts the request and waits on a `SharedArrayBuffer` (`Atomics.wait`) for the supervisor's answer, at most 40 s. A secret reaches a worker only as that answer, never through its environment, arguments or files (D44, D124).
- **The watchdog** pings every worker; the channel thread answers only while the main thread's heartbeat, written every 100 ms, is fresh, so a busy loop (but not a wait for a secret) trips it after `limits.watchdogMs` (default 10 s) and the worker is killed with the cause `hang`.
- **Proof of the seam:** the action suite also runs against a worker host started on its own, reached over a Unix socket with only the launch message and the channel's messages (`test/fixtures/worker-host.mjs`, `MOSTRA_TEST_WORKER_HOST`).

*Rejected:* an async `secret()` (changes approved interface text); secrets pre-fetched by a static scan of literal names (misses computed names); Node IPC as the channel (doesn't cross a socket or a machine).

### D130. Calls, runs and live data on the browser protocol (delegated, M22)
Additive to revision `2026-10-15`, which is unreleased:
- **`call/{fnId}`** answers NDJSON: one `{ batch }` line per serialized batch, then `{ end: { status, error? } }`. Plain calls are never recorded (D54).
- **`runs`** starts or joins a run: `{ viewId, fnId, args, key?, clientKey }` → `RunState`. The run is recorded (`queued`, with `action.started`) before any worker sees it. A `key` joins the one run of that artifact, function and key, whatever its state: a keyed run happens at most once, ever, and a failed one stays failed (a new attempt takes a new key). A `clientKey` makes a retried request join the run it started. **`runs/attach`** reads runs by ID or by `{ fnId, key }` and follows them for a minute; this is how a reloaded page finds a keyed run again (AC-02), and why a run without a key keeps running when its tab closes but is found only by the page that started it. **`runs/{id}/cancel`** fires the action's `abortSignal` (AC-04).
- **Run states:** `queued`, `running`, `waiting` (reserved for WP-28's relay, D117, D124; no WP-08 path enters it), `succeeded`, `failed`, `cancelled`, with a `reason`: `threw`, `unserializable`, `too-large`, `interrupted` (its worker stopped during the run, or Mostra did), `crashed` (its worker couldn't start), `parked` or `cancelled`. A final run never changes (a trigger refuses it).
- **Results stream:** a run stores its result as serializer batches. An `AsyncIterable` result yields its items as later batches, and `useAction` shows them as `partial` (additive to INTERFACES §2.3); the stored batches replay to a page that attaches late.
- **`live`** reads live sources (`{ viewId, keys: [{ key, window?, refresh? }] }`) and keeps their producers running for this view for a minute; pages renew every 20 s.
- **Ephemeral messages:** run and live updates go out on the page's stream as `event: run` and `event: live` without an `id`, so they never move its cursor, and in a poll's `ephemeral`. They are lossy and coalesced; a page that misses one (a gap in a run's offsets, a skipped live revision, a reconnect) reads again with `runs/attach` or `live`. Nothing of them is a durable event (LL-04). Coalescing (D136): while a reader is behind, a live value in latest mode replaces its source's older ones and a run's contiguous deltas merge, on the server and again in the page, which also renders at most once per animation frame. `runs/attach` takes `held` (what the page holds of each run, in log lines and batches) and answers only what is newer (`RunState.logFrom`, `batchFrom`, additive), so the page's renewal every 20 s never reads a run whole again.
- **Who sees a run** (D97 item 4, D104): only a link that may run its function sees a run, checked before the page is attached to it; then a keyed run belongs to the artifact, since its key makes it one invocation for everyone whose link may run that function, so another viewer's click joins it and sees its progress and end; a run without a key is its viewer's own (other viewers can't attach, cancel or follow it, and a client key never joins another viewer's run, nor a run of another function). Run states carry no arguments. The durable events of runs follow the same rule on a page's stream (D136).
- **Refusals before anything is recorded:** a function the view's version doesn't have answers 404 `MOSTRA_ACTION_UNKNOWN_FUNCTION`, and arguments the serializer refuses answer 400 `MOSTRA_ACTION_UNSERIALIZABLE`, before a run is recorded, a key is spent or a worker starts (D136).
- **Results' `actions`** list the runs started in the submitting view, captured in the submission's immutable snapshot at submit time (at most 100), so a redelivery carries the same list (IN-05).

### D131. Limits and secrets (delegated, M22)
- **Limits:** arguments and stored results up to 16 MiB of serialized JSON each (`MOSTRA_ACTION_TOO_LARGE`); the run log 1 MB with one truncation marker (D47); a live value 4 MiB (`MOSTRA_LIVE_TOO_LARGE`); a source's ring its `defineLive({ ring })`, or 1024 for pushed keys, at most 100,000; `signal()` and `emit()` payloads 64 KiB, like the page's signals.
- **Secrets:** a name is letters, digits, `_`, `.` and `-`, starting with a letter or `_`, at most 128 characters; a value is 1 byte to 64 KiB of UTF-8. `secret/set`, `secret/list` and `secret/delete` (the CLI's `mostra secret`, WP-10) take an optional `artifact` scope; a value is never returned. Each value is a file `secrets/<artifactId|home>/<name>` (0600, directories 0700), written by rename. `secret(name)` looks in the host's `secrets` port first, then the artifact's secrets, then the home's, else `MOSTRA_SECRET_MISSING`; a port that fails answers the same code rather than falling back silently.
- **Redaction:** every value `secret()` hands out, and every stored value at start or when read, is registered with the instance's redactor (values of 4 characters or more, with their JSON-escaped spelling). Logs, run logs, run progress, error messages (a live source's too), events, run results, state written by actions and live values pass through it, so a secret an action returns or stores reads `[redacted]` wherever Mostra keeps or shows it (AC-06); the effect the secret was for (the mail API call) is unchanged. Results and live values are redacted as values, never as encoded text (D136): bytes (an `ArrayBuffer`, a typed array, a file in a `FormData`) are searched for each secret's UTF-8 bytes, which become `*`, and a secret starting with `$` stays a string. A multi-line secret (a PEM key) is also protected line by line, since child output is kept a line at a time.

### D132. Artifact listeners bind when used (delegated, M22)
*Amends* D99's "every leased port is bound at start". Leases stay as D99 says: stable per home and artifact, reused across restarts, so links and per-origin storage survive. At start the gateway binds the shell and the artifacts a view opened in the last 7 days; any other artifact's listener binds when a frame ticket for it is issued, on its leased port, and stays bound while the instance runs. A home with thousands of old artifacts no longer holds thousands of listeners, and a taken port is still found and leased again (`MOSTRA_ENV_PORT_TAKEN`) before the frame loads.

### D133. The daemon's lifecycle and the login service (delegated, M22)
- **Idle exit** (D62): a daemon exits 0 after 30 minutes without attached clients, open page streams or polls, pending deliveries, running action runs, running live producers or host subscriptions (WP-13 adds active shares); `instance/status` reports `idleExitAt`. A host-spawned instance lives as long as its stdio.
- **`mostra-runtime service install|uninstall|status [--home] [--no-start]`** writes, loads and removes a per-home login service (a launchd LaunchAgent `dev.mostra.daemon.<home hash>` on macOS, a systemd user unit `mostra-<home hash>.service` on Linux) that runs `mostra-runtime daemon --always-on --home <home>`. `--always-on` turns idle exit off, and so does an installed service for its home, whoever started the daemon: a daemon started by hand before `install` keeps the artifacts answering, and the service's own start then attaches to it. The unit restarts the daemon only after a failure, carries `PATH` and `HOME` and no secret, and is what `mostra daemon install` (WP-10's CLI) runs and `mostra doctor` looks for (D96). A failure is `MOSTRA_ENV_SERVICE_FAILED`.
- **Workers** are evicted after `limits.idleMinutes` (default 10) without calls, runs or producers, restarted after a crash with backoff from 1 s doubling to 60 s, replaced only once a stopping worker has exited (a call during an idle stop waits for it, so a version never has two), stopped as hung when their event loop stays blocked past the watchdog limit or when three watchdog pings in a row go unanswered (one ping queued behind a large result stops nothing), and **parked** after more than five crashes in ten minutes: requests answer 503 `MOSTRA_RUNTIME_WORKER_PARKED` with the last cause, `worker.crashed` records `parked: true`, and the shell says "This artifact's server code keeps crashing" (FrameTicket `serverParked`, additive). Any publish of the artifact, a reused version included, a restart of the instance, and `verify` (WP-09) clear the park, for its calls and its live producers alike. A worker that ends before it answers its start counts as one crash, not two (D136). Runs a crash cut off end `failed` with reason `interrupted`, never retried (D24). A cancel while the run waits for its worker ends it at once.

*Extended by D140:* an open `mostra dev` session keeps a daemon from its idle exit.

### D134. Process identity on macOS: issue #8 (delegated, M22)
macOS start times keep their one-second resolution. XNU hands out PIDs in order up to 99,999 and skips any still used as a process, process group or session ID (VERIFIED_FACTS, WP-08), so a PID returns only after about 99,900 forks, about 100 s at this machine's spawn rate, and never while the recorded group lives. Issue #8 is closed with that evidence instead of a native addon in the runtime bundle.

### D135. Server code's packages run from their own directories (M23)
WP-03 bundled every package a version's server code imports into `server/entry.mjs`, so a package with a native addon (`sharp`, `bcrypt`, `better-sqlite3`), or one that reads files beside itself at run time (templates, WASM, engines through `__dirname` or `import.meta.url`), failed to build or failed at run time, short of D05's full capability.
- **The server build keeps package imports external** (Vite's default for a server build): the artifact's own code is bundled, and `server/entry.mjs` imports each package by name. A package Vite can't run unbundled (a linked one, or one whose entry isn't JavaScript) is still bundled. `@mostra/server` stays the worker's own copy (D129).
- **The worker resolves them from the layout the version was built against**, through the resolve hook it already has: the warm set when the version has no on-demand packages, else `deps/locks/<lockDigest>/node_modules` for the version's frozen `lock.yaml`. `lockDigest` is in `envDigest`, so the version's identity covers every package its server code runs (VR-01). One React holds as at build time (D95).
- **Before a worker starts,** the local launcher makes that layout ready through `Dependencies.runtimeModules`: a layout removed since the publish is installed again from the home's store (offline, from the store alone, DP-04); a store that lacks a package answers `MOSTRA_DEP_OFFLINE`, and the start fails and backs off like any other.
- **A runtime whose warm set moved on** (another release, other warm versions) still runs a version against the warm packages it locked: a *pinned layout*, `deps/locks/pinned-<digest>`, installs each drifted warm package at its locked version and links the rest to the warm set. Mostra's own packages always come from the running runtime.
- **The seam (D124):** a launcher elsewhere receives the same version reference and resolves the layout from the version's lockfile itself (the test worker host does; WP-29's portable bundle carries the lockfile).

*Rejected:* keeping the bundle and copying `.node` files beside it (misses packages that read their own files, and every native package's own loader); recording the gap for WP-29 (a missing capability until then). *Consequences:* WP-10's `gc` keeps every layout a kept version's `lock.yaml` names, pinned layouts included; WP-29's remote launcher installs the bundle's lockfile before its worker starts.

### D136. The Claude Opus review of WP-08 (delegated, M22)
The fourteen findings of WP-08's Claude Opus review (D80, D114) were all fixed; where a fix is a choice, it is recorded here, under M22's delegation.
- **Arguments a page sends end with their call** (*amends* D54's "exactly React's documented type set" for arguments): a registered symbol is refused as an argument, as React 19.3's own reply codec refuses it without a temporary reference set (VERIFIED_FACTS, WP-08), because `Symbol.for` keeps every name for the life of the process, so a link that may run one action could otherwise fill a worker's heap and park it for every viewer. A bigint argument is limited to 10,000 digits (decoding is quadratic in its length), an async iterable is refused as an argument (as the writer already did), and an argument must arrive complete: every promise in it settled. The supervisor checks the frames before a worker sees them (`checkArgumentFrames`), and the worker's reader refuses them again. Results keep React's whole result type set, symbols included.
- **A cancel the action ignored doesn't hide what it did** (FAILURE_MODEL §6, AC-04): a run is `cancelled` only when the action stopped on the abort or a streamed result was cut short; an action that returned is `succeeded`, with its result, whatever was clicked meanwhile.
- **What a page sees of server code** (D104, D130): `signal()` and `emit()` from server code record the viewer whose call raised them (hosts see it); a page sees an action's signal only if its own call raised it, never a `host.*` event (they are for hosts, AC-05), `action.*` events only for runs it may see, and `worker.crashed` without its `cause`, which quotes the server code's own output.
- **Thousands of artifacts:** which artifacts' latest versions have live sources is kept in memory and updated on publish, so reconciling producers costs nothing per artifact without them; a worker started only to learn which sources are `always` starts one at a time and stops at once when nothing needs it.
- **Typed arrays by kind:** a subclass (Node's `Buffer`) crosses as its built-in base, so `readFile`'s result reaches the page as a `Uint8Array`. React's Flight server sends a `Buffer` through its `toJSON` with a warning; Mostra sends the bytes.
- **Write-once action runs** (DATA_MODEL §3): migration 7, unreleased, refuses an insert over an existing run, a deletion of a result batch, and a batch for a finished run.

### D137. Hosted pages without a public-suffix entry; the user-content domain is configuration (M24)
- **No public-suffix entry at first.** The user-content domain is not on the Public Suffix List when hosted links first ship, and an entry takes months to reach browsers. Until it does, every hosted page is same-site with every other tenant's page and can set cookies for the parent domain (cookie tossing). Viewer sessions on the user-content domain therefore use host-only `__Host-` cookies or none, never trust a cookie scoped to the parent domain, and stay bound to the origin they were issued for (D98 item 1). WP-28 settles the mechanism (its questions 7 and 8) and WP-30 proves it with seeded negative tests. The design stays correct once an entry exists.
- **The user-content domain is configuration.** A remote server reads its active user-content domain and any spare domains from configuration: new links use the active domain, links already issued keep resolving on theirs, and changing the active domain needs no release. A domain flagged by a blocklist then costs a configuration change, not an outage of new shares.

*Why:* one tenant's page must never be able to sign a viewer in as someone else or hijack another page's session (invariant 1, D06); and a shared domain can be flagged because of one abusive page, so moving new links has to be cheap. *Source:* M24. *Amends* WP-28's questions 7 and 8 and its risks.

## WP-09 decisions

### D138. Verify, its sandbox and the publish gate (delegated with additions, M25)
Mirza approved the WP-09 session's twelve recommendations at M25, with the additions and the one replacement below. It fills ARCHITECTURE §12, INTERFACES §13 and D41, D55 and D72 where they left the shape open.

1. **A sandbox per run.** A verify run serves its build through the real interaction, actions, live and route code over a scratch ledger in `cache/verify/runs/<run>/`, with its own worker pool, behind two short-lived loopback listeners: a harness origin that frames the page and the artifact's origin. Nothing reaches the home's drafts, state, events, hosts or deliveries, and the human-facing gateway never serves an unpublished build.
   - The verify target is set when the page is served, never in the build: the artifact listener injects `<meta name="mostra-target" content="verify">` into `index.html`, so the stored build is byte-identical to what publish promotes.
   - The harness uses the real route table and session flow: a per-run random capability token, its exchange for an origin-bound session, and frame tickets. No route bypasses them, so verify meets the failures a viewer would, and no other local process can use the listeners.
   - Server code sees the real secrets, read-only: `secret()` resolves as in the instance (the host's port, the artifact's, the home's). No other host port is called and nothing is delivered. Live producers run for real; only actions follow D55. Everything verify keeps or prints passes through the instance's redactor.
   - State starts empty, like a first view.
   - The sandbox's workers start through the gated process manager. Verify clears a parked worker of the artifact in the real pool (D133). The run's directory is deleted when the run ends, and recovery at start removes leftovers.
2. **A skipped action** (D55) is refused by the sandbox's gateway before anything is recorded or a worker starts, for plain calls and runs alike: `run()` and server references reject with a `MostraError` carrying `MOSTRA_VERIFY_ACTION_SKIPPED`. Faults that follow from it are verify's, not the artifact's: an unhandled rejection with that reason is dropped; a page error or an error-boundary catch whose error (or its `cause` chain) is that error is a hint naming the action; a console error between a click that produced a skip and the page settling is a hint naming the action.
3. **Severities** (each code's severity is fixed by its catalog entry). `status` is `fail` exactly when an error exists.
   - **Errors:** manifest errors (`MOSTRA_MANIFEST_*`), dependency failures (`MOSTRA_DEP_*`), build and type errors, uncaught page errors, errors caught by React error boundaries (the root's `onCaughtError` and `onUncaughtError` included), console errors, failed requests on resources the page loaded (the document, scripts, styles, images, fonts, fetches by artifact code) on its own origin, a blank page, a page that never gets ready, conflicting duplicate field IDs, field IDs that change between renders, `MOSTRA_VERIFY_TIMEOUT`, and environment failures such as `MOSTRA_ENV_BROWSER_MISSING`.
   - **Failed requests** exclude requests the browser makes on its own (chiefly `/favicon.ico`) and Mostra protocol answers the client runtime handles by design (the skip refusal, the stream's fallback). Chrome's own "Failed to load resource" console message is folded into the request's finding at the request's severity.
   - **A blank page** is an error only when no element has a visible box of nonzero area (text, `img`, `svg`, `canvas`, `video`) and the screenshot is one uniform color.
   - **Duplicate field IDs:** an ID used with another hook kind, another scope or an initial value of another type is an error; the same ID bound the same way twice is a deliberate shared value, a hint at most.
   - **Changing IDs:** two fresh boots with identical inputs under one fixed clock; an ID that differs between them is an error. An ID an interaction creates (a new list row) is a new field.
   - **Warnings:** controls with no visible effect (after the hover-opened and already-active checks), axe's critical and serious findings, failed requests to other origins, failing live sources, unknown manifest keys, packages without type declarations (`MOSTRA_TYPE_UNTYPED_PACKAGE`), `MOSTRA_SECRET_MISSING` raised during verify, and every regression.
   - **Hints:** unbound inputs, skipped actions, axe's moderate and minor findings (its `incomplete` results aren't reported), console warnings, the smoke test stopping at its budget (200 interactions or 60 s), and "no baseline" for a first version.
4. **The regression baseline** is the newest version of the artifact whose recorded verdict passed, rendered fresh from its stored build in the same run: boot, render, ARIA and screenshots, no smoke test. Contracts come from its stored `registry.json`. It always comes from the home, never from the authoring directory (VR-11, D93); a baseline whose build is gone is a hint, and no regression stage runs.
   - **"Passed" is recorded:** the version manifest gains, additively, `verify: { status, verifyRevision }`. A version without it, one published with `--force`, or one published when verify couldn't run never counts as passing.
   - **Both renders are deterministic:** one fixed clock (`page.clock`) at the same instant, `document.fonts.ready`, `reducedMotion: "reduce"`, screenshots with animations disabled and the caret hidden, and the empty sandbox state.
5. **Cache and gate.** The cached verdict is keyed by source digest, environment digest and the verify revision. `artifact/verify` always runs and replaces the cached verdict; publish reuses it or runs verify, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and `--force` records the error codes (never warnings). Verify's stored build is keyed by its version ID: publish promotes it when its own version ID matches, and otherwise builds again from the same snapshot with the real version ID, still reusing the verdict (the first publish of a source with no manifest `id` and no binding, or a build the 5 GB LRU cache evicted). Editing output after the build would break D115, and reserving the ID would write to the real ledger. A verdict whose errors include an environment or timeout code isn't cached. Regressions are warnings, so the baseline isn't in the key; if one ever becomes an error, the baseline's version ID joins it.
6. **Time limits.** Verify's 120 s cover everything after compile, the baseline's render included. Installs keep their 300 s and the build its 180 s; the type check runs beside the build inside the same 180 s (FAILURE_MODEL §9).
7. **When verify can't run** (no browser): it still runs every stage that doesn't need one (type check, build, lint, the static field-ID scan) and reports the environment error. With `--force`, publish records every error code, the environment's included, and the version doesn't count as passing; without it, publish fails closed. `--force` never publishes what didn't build: a build failure (`MOSTRA_BUILD_*`, or a `MOSTRA_DEP_*` that stops the build) refuses the publish whatever the flags.
8. **The type check** is TypeScript 7.0.2 `tsc --noEmit` in a recorded child, resolving imports as the build does (its `node_modules` layout, `@/*` at the snapshot root, the types of `@mostra/react` and `@mostra/server`, the generated live-source declaration). Its configuration extends the artifact's own `tsconfig.json` when it has one; Mostra's options win only for `noEmit`, `skipLibCheck: true`, `moduleResolution: "bundler"`, the `@/*` path and the include list. Without one it is `strict: true` with `noUnusedLocals` and `noUnusedParameters` off (the shadcn templates fail TS6133). The configuration's text is part of the verify revision. *Amended by D139.* `MOSTRA_TYPE_ERROR` (error) carries the TS code and location; TS7016 is `MOSTRA_TYPE_UNTYPED_PACKAGE` (warning); a TS2307 for an import the build or dependency stage already reported is dropped; MDX isn't type-checked.
9. **Screenshot token estimates** (VERIFIED_FACTS, WP-09): Claude `⌈w/28⌉ × ⌈h/28⌉` after its high-resolution tier's downscale (2576 px, 4784 tokens); GPT `⌈⌈w/32⌉ × ⌈h/32⌉ × 1.2⌉` at `detail: high` (2048 × 2048 and 2,500 patches first); Gemini 3 and 4 a flat 1120 per image at the default media resolution.
10. **Dependencies.** `@mostra/verify` uses `playwright-core` 1.64.0 with the Chromium headless shell that release pins (Renovate moves them together), injects `axe-core` 4.14.0 unmodified (its license in NOTICE), and compares pixels with `pixelmatch` 8.0.0 over `pngjs` 7.0.0. The runtime bundle ships only the host platform's `@typescript/typescript-<platform>` binary of TypeScript 7.0.2.
11. **Reviews and prose.** A Claude Opus review (the sixth of ten, D114) besides GPT's. Prose is delegated as in WP-03 to WP-08, except that Mirza sees the hint of every warning-level smoke and regression code before the merge: each says what was observed, never that working code must change (EVAL-01).

*Source:* M25. *Amends* FAILURE_MODEL §9 (the verify row) and the WP-09 specification (where regression baselines come from).

### D139. The type check judges what the build compiles; the warning hints ship as written (delegated, M26)
1. **Amends D138 item 8.** The build compiles with Mostra's own settings, never with the artifact's `tsconfig.json`, so a check that reads only that file disagrees with the build and fails code that builds and runs: a `tsconfig.json` with only `strict` has no `jsx` and fails every TSX file; a TypeScript 5 configuration with `baseUrl` (shadcn's Vite setup) is refused by TypeScript 7 as a whole (TS5102); CSS modules, fonts and `import.meta.glob` had no declarations (the Claude Opus review of WP-09, finding 2). A false type error refuses publish and leads agents to change working code (D72, EVAL-01). The check therefore:
   - starts from the build's compile settings (target, lib, `jsx`, `module`, isolated modules, JSON and `.ts`-extension imports, Node's types), with the artifact's own `tsconfig.json` applied over them, so every option it chooses (`strict`, `noImplicitAny` and the rest) still holds;
   - forces `noEmit`, `skipLibCheck: true`, `module: "ESNext"` with `moduleResolution: "bundler"` (the build is a bundler), a cleared `baseUrl` (the build doesn't use it, and TypeScript 7 refuses it), the `@/*` path and the include list;
   - declares imports with Vite's own client types for the pinned release, plus MDX, so they follow Vite rather than a hand-kept list;
   - stays `strict: true` with `noUnusedLocals` and `noUnusedParameters` off when the artifact has no `tsconfig.json`.

   A configuration TypeScript refuses as a whole (contradictory or unknown options) is still `MOSTRA_TYPE_ERROR`. The check's configuration and the Vite release are part of the verify revision.
2. **The seven warning-level hints** (D138 item 11) ship as written: `MOSTRA_SMOKE_NO_EFFECT` and the six `MOSTRA_REGRESSION_*` codes each start with "Observed only:", state what verify saw, name the intended change and say it needs nothing. Directive wording ("restore the control") is what made agents break working code in EVAL-01.

*Source:* M26 (delegated). *Rejected:* keeping D138 item 8 literally (false errors on configurations and imports that build).

## WP-10 decisions

### D140. The CLI: telemetry consent and events, `mostra dev`, gc tombstones, links, output (M27, M28)
Mirza answered WP-10's questions at M28, on top of the consent model he set at M27. Each item is an **approved decision**. *Decides* D119's deferred event list and detection rules.

1. **Telemetry lives only in `@mostra/cli`.** No other package (the runtime, `@mostra/sdk`, the Rust crate) contains code that can send an event, so embedded use can't send by construction; a dependency-cruiser rule lets only `@mostra/cli` import its telemetry module.
2. **Consent (M27).** Mostra asks first where the machine's time zone is in the EU, the EEA, the UK, Switzerland or nearby (item 10), or is UTC or unknown: no pre-selected yes, and Enter, `n`, end of input, Ctrl-C or 60 s without an answer mean no. Elsewhere telemetry is on by default, with a notice once before the first event (also on non-interactive runs). The time zone is read locally and never sent. *Why:* the EDPB's Guidelines 2/2023 (v2.0, 7 October 2024), paragraph 33, put software that proactively calls an API endpoint within Article 5(3) of the ePrivacy Directive whether or not the data is personal, and usage analytics isn't strictly necessary, so it needs prior consent there. *Rejected:* asking everyone first (agents run the CLI where no one can answer); opt-out everywhere.
3. **The decision order.** The first match decides, so an explicit "off" anywhere wins over any "on" and withdrawn consent sticks:
   1. no collector in this build: off, `no-collector`;
   2. embedded (a host-spawned instance, or a home a host configures, item 4): off, `embedded`;
   3. `DO_NOT_TRACK` set to anything but empty, `0` or `false` (the parser of `MOSTRA_OFFLINE`): off, `do-not-track`;
   4. `MOSTRA_TELEMETRY` set to an off value (`0`, `false`, `off`, `no`): off, `variable`;
   5. the stored choice is off: off, `setting`;
   6. `MOSTRA_TELEMETRY` set to an on value (`1`, `true`, `on`, `yes`): on, `variable`; any other value is off, `variable-invalid`;
   7. the stored choice is on: on, `setting`;
   8. the time-zone default: on elsewhere, off in the ask-first zones, `default` with `askFirst`.

   `MOSTRA_TELEMETRY=1` and `mostra telemetry on` are explicit yeses in the ask-first zones; the notice is still shown before the first event. A settings file that can't be read or parsed is off too (`unreadable`).
4. **A home a host configures** carries a write-once mark in `config.json`, `hostConfigured: { client, at }` (the first client only; the CLI never removes it), written by the protocol server where `configureHome` runs: when a `mostra-runtime host` instance owns the home, and on `mostra/initialize` from a client whose name isn't the CLI's own (`mostra-cli`, a constant) that sends `home` or `ports`. A host passing the CLI's name as its own is out of scope. The CLI also sends nothing while its instance reports `mode: "host"`, and commands that reach no instance read the mark from `config.json`.
5. **Storage.** The choice is per operating-system user: `MOSTRA_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/mostra`, on both platforms, a 0700 directory holding `telemetry.json` (0600, written by rename: the choice, the install ID, when the notice was shown) and `telemetry-queue.ndjson` (0600). The install ID is a random UUID made on the first run that sends, never derived from the machine or the person, and the only value kept between events; two first runs agree on one ID (an exclusive create). Turning telemetry off deletes the ID and the queue at once, with no farewell event; turning it on again makes a new ID. A file that can't be read or parsed means off: nothing is sent, nothing crashes, no exit code changes, and `status` says why. Tests always set `MOSTRA_CONFIG_DIR` to a temporary directory.
6. **Sending.** An event is queued only once someone may know of it (the notice was shown elsewhere, or an explicit yes in an ask-first zone). After a command, a fully detached flusher (`detached`, `stdio: "ignore"`, `unref()`) posts the queue, at most one at a time (a lock file) and only when the queue isn't empty and no flush started in the last 60 s; it reads the decision again before sending, so `telemetry off` in between drops the events. Batches of at most 100 events per POST, `Content-Type: application/json`, no cookies, no header but `User-Agent: mostra-cli/<version>`; a failed attempt keeps them for the next flush; past 1,000 events or 7 days the oldest are dropped. `mostra host` and anything embedded never start a flusher. `MOSTRA_TELEMETRY_DEBUG=1` prints each event to stderr exactly as it would be sent, and sends nothing.
7. **The endpoint** is a build constant, set only by the release workflow at bundle time and empty in this package; `MOSTRA_TELEMETRY_ENDPOINT` overrides it when it is `https:`, or `http:` to a loopback address, and any other value is `no-collector`. The override never bypasses the decision order. Without an endpoint there is no notice, no question, no install ID and no queue, so a person first hears of telemetry from a release that can send; the notice counts as shown only then.
8. **Event schema 1** (camelCase, published in `docs/reference/telemetry.md`). Every event carries `schema` (`1`), `event`, `at` (UTC, rounded down to the minute), `installId`, `version`, `os` and `arch`, `node` (the major version), `harness`, `ci` and `consent` (`explicit` or `default`). The events:
   - `cli.first_run`, once, when the install ID is created;
   - `cli.command`: `command` (the command path from the definitions, or `unknown`; never what was typed), `exit`, `duration` (`<1s`, `1-5s`, `5-30s`, `30s-2m`, `2-10m`, `>10m`), `json`, and `error` (the failing diagnostic's catalog code; a code outside the catalog is left out);
   - `verify.result`: `status`, `codes` (the distinct catalog codes of every severity, sorted, at most 50) and `codesTruncated`;
   - `publish.done`: `reused`, `forced`;
   - `share.done` (emitted by WP-13 and WP-29): `kind`, the driver's name (`tailnet`, `funnel`, `cloudflare`, `remote`);
   - `mcp.session` (emitted by WP-15): `client`, the known harness ID of `clientInfo.name` or `other`, and `clientVersion` for known clients only (the raw name can name a private tool).

   Retention, as the docs page states: raw events 12 months, then aggregates only.
9. **Harness detection:** `AI_AGENT` when it starts with a known harness ID; else, in order, `CLAUDECODE` (`claude-code`), `CODEX_THREAD_ID` (`codex`), `GEMINI_CLI` (`gemini-cli`), `OPENCODE` (`opencode`), `CURSOR_AGENT` (`cursor`); else `AI_AGENT` or `AGENT` set to anything gives `other`; else `none`. A marker's value is never sent. Each marker is verified against a primary source (VERIFIED_FACTS, WP-10); others join only from one.
10. **Ask-first zones**, generated from tzdata and committed as data with a snapshot test: every `zone.tab` name of the EU 27 (with GP, MQ, GF, RE, YT, MF), AX, IS, LI, NO, GB, GG, JE, IM, GI, CH, FO, SJ, AD, MC, SM and VA; every `backward` alias of those; `CET`, `EET`, `WET`, `MET`, `UTC`, `GMT`, `Etc/*`, `Universal`, `Zulu`, `Greenwich` and `Factory`. A zone is unknown when it is missing, empty, `Etc/Unknown`, not an IANA name or a POSIX rule. The candidates are `TZ` (a leading `:` removed), the target of `/etc/localtime` after `zoneinfo/`, and `Intl`'s `timeZone`; Mostra asks first when any candidate is in the set or none is a known name, matching names as given, never the canonical zone they link to (tzdata merged `Europe/Zagreb` into `Europe/Belgrade` and `Indian/Reunion` into `Asia/Dubai`).
11. **The question** is asked on stderr, before the command's work, only when stdin and stderr are TTYs, `--json` isn't given, no CI and no harness marker is detected, the command doesn't read stdin, and it isn't `telemetry`, `--help`, `--version` or `docs`. Otherwise the ask-first zones get the non-interactive notice once and send nothing. The notice, the question, the answers, the `status` lines and the docs page are Mirza's text (M28).
12. **`mostra dev`** (VR-08) is a protocol feature: `dev/start { source, port? } → { url, port, sessionId }`, `dev/stop { sessionId }` and the `dev/notify` notification. A session belongs to the connection that started it and ends with it; an open one counts against a daemon's idle exit (*extends* D133). Vite runs in a recorded child with the SPA build settings and `Dependencies.resolve`; a lockfile change reloads the page. Session security is verify's (D138 item 1): loopback listeners only (a non-loopback `--bind` is refused for dev), a per-session random secret in the URL's fragment exchanged for an origin-bound session through the real route table, never a ledger token; Vite's own surface gets exact Host and Origin checks, `server.allowedHosts` set to the dev origin, `server.cors: false` and an Origin-checked HMR WebSocket. Scratch state lives in `cache/dev/<session>/`, starts empty, survives reloads, and is deleted when the session ends (recovery removes leftovers). Actions run for real with real secrets; nothing is delivered to hosts or ports, and `dev/notify` reports each submission with its Results. The shell shows "Development preview, not published". VR-03's route enumeration covers the dev listeners.
13. **Check boundaries.** `share` (WP-13), `review export` (WP-20), `export` (WP-24, its first class), `mcp` (WP-15), `plugin` (WP-16), `term` (WP-22) and `run` (WP-29) are unregistered until their packages add them. A new diagnostic area `CLI` holds `MOSTRA_CLI_USAGE` and `MOSTRA_CLI_UNKNOWN_COMMAND` (exit 2; an unknown command lists the available ones). `mostra daemon restart` and `daemon uninstall` exist, and every catalog `fix` or hint that names a `mostra …` command must parse under the command definitions (a test).
14. **gc keeps tombstones.** It keeps each artifact's latest version (followed artifacts included), every version a submission, view, comment thread, action run, live session or live producer value names, every version ID a review-set candidate or choice names, every version a live pinned link opens, and the newest version whose verdict passed. A collected version keeps its ledger row, ID and number forever: a write-once `version_collected (version_id, collected_at)` records it, `VersionSummary.collected` reports it, `view/url` for it answers `MOSTRA_ARTIFACT_VERSION_COLLECTED`, the integrity checks don't call it damaged, and republishing its exact source restores its files through publish's repair path and clears the mark. Each reference rule is a named source in one list, and a schema test fails on any ledger column that names a version and no source covers or exempts with a reason. gc runs in the supervisor, serialized with publish, verify and installs, decides and marks in one transaction and removes files after the commit (recovery finishes an interrupted run); a real run's result lists exactly what the dry run lists. *Rejected:* deleting the row (a republish would give one content-addressed ID two numbers).
15. **Links from the CLI.** `view/default { artifact } → CapabilityLink` returns the artifact's default link, minting a new default when the old one was revoked; `view/url` keeps always minting (D97). `mostra open` prints the link on stdout and opens a browser when stdout is a TTY without `--json` (not with `--no-browser`, nor over SSH without a display), or always with `--browser`. The browser never gets the secret: a command line is visible to other local users, so the CLI asks for a single-use launch ticket (60 s, 130 bits, like a frame ticket) and opens `…/a/<id>#l=<ticket>`, which the shell exchanges for the session the link would give; the opener runs with direct arguments, never through a shell.
16. **`--json` output.** stdout carries exactly one JSON value: `{ ok: true, result, instance?, warnings }` or `{ ok: false, error, instance?, warnings }`, even for usage errors and unexpected exceptions (`MOSTRA_HOST_INTERNAL_ERROR`, exit 3). `ok` means the command produced its result: a failing verdict is `ok: true`, exit 1; `still_waiting` is `ok: true`, exit 5; a refused publish is `ok: false`, exit 1. Exit codes come from one table keyed by diagnostic code, and a test maps every catalog code. Streams are NDJSON envelopes (`{ ok: true, event }`, `instance` on the first line, the last line the `result` or `error`). MCP tools stay raw (WP-15). `mostra <command> --help --json` prints the machine-readable definition, and help adds an `Output:` line naming the result type and its docs topic.
17. **`mostra docs`** prints the bundled reference by stable slug (diagnostic pages by code, the CLI reference, the telemetry page); without a topic it prints the index, an unknown topic exits 2 with the nearest topics, and `--json` gives `{ topic, markdown, url }`. The index is the one source WP-15's `docs_search` and WP-26's site read.
18. **Shapes.** `gc/run { dryRun?, compactEvents? } → { dryRun, versions: { artifactId, versionId, number, bytes }[], snapshots, lockLayouts, storePackages, caches, bytes, compacted? }`; `instance/check { deep? } → { checks: { name, status: "ok" | "warning" | "error", diagnostic? }[] }`, where `deep` hashes every version against its `outputDigest` (`mostra doctor --deep`).
19. **Reviews.** GPT-6.1-Sol through `codex review` and Claude Opus 5.5 as the seventh of ten (D114), each announced (D34).

*Source:* M27, M28. *Amends* D60 (the command set), D119 (decided here) and D133 (idle exit).

## Visual identity decisions

### D141. Studio, the kit's default theme (M29)
D68 gives artifacts no imposed look and asks the kit for a baseline that makes an unstyled artifact beautiful. **Studio** is that baseline's values. WP-18 builds them into the token system (KT-04), and WP-20's final pass on the shell starts from the same tokens and faces, keeping the shell quiet.

1. **Quiet by design.** White and warm grey surfaces, near-black text, one blue for the main action and focus, and a yellow `--answer` that marks only what a person answered or chose. Colour is spent on the agent's content, not on Mostra. Mostra's own brand (its logo, site and marketing) is louder, and none of it appears in an artifact by default.
2. **Tokens** keep shadcn's names (the kit builds on shadcn, so templates and agents' knowledge carry over) and add `--success`, `--warning`, `--answer` and a sixth chart colour. Values are given in OKLCH, with the hex they were derived from:

   | Token | Light, `oklch()` (hex) | Dark, `oklch()` (hex) |
   |---|---|---|
   | `--background` | `1.000 0 0` (#ffffff) | `0.178 0.006 271.0` (#101114) |
   | `--foreground` | `0.191 0 0` (#141414) | `0.960 0.004 106.5` (#f2f2ef) |
   | `--card` | `1.000 0 0` (#ffffff) | `0.205 0.008 274.5` (#16171b) |
   | `--muted` | `0.972 0.004 106.5` (#f6f6f3) | `0.223 0.010 276.6` (#1a1b20) |
   | `--muted-foreground` | `0.466 0.008 106.7` (#5a5a55) | `0.717 0.007 286.2` (#a3a3a8) |
   | `--border` | `0.917 0.008 106.6` (#e4e4de) | `0.290 0.011 278.2` (#2a2b31) |
   | `--input` | `0.880 0.009 106.6` (#d8d8d1) | `0.331 0.012 279.2` (#34353c) |
   | `--primary` | `0.450 0.212 267.0` (#2340c8) | `0.662 0.180 272.8` (#7086ff) |
   | `--primary-foreground` | `1.000 0 0` (#ffffff) | `0.165 0.009 274.3` (#0d0e12) |
   | `--secondary` | `0.957 0.004 106.5` (#f1f1ee) | `0.258 0.013 279.0` (#22232a) |
   | `--secondary-foreground` | `0.191 0 0` (#141414) | `0.960 0.004 106.5` (#f2f2ef) |
   | `--accent` | `0.959 0.015 273.9` (#eef1fc) | `0.265 0.055 271.9` (#1c2340) |
   | `--accent-foreground` | `0.370 0.173 267.5` (#1a2f99) | `0.855 0.072 277.0` (#c3ccff) |
   | `--destructive` | `0.541 0.198 32.0` (#c8290c) | `0.706 0.188 32.9` (#ff6a4d) |
   | `--ring` | `0.450 0.212 267.0` (#2340c8) | `0.662 0.180 272.8` (#7086ff) |
   | `--success` | `0.513 0.111 161.3` (#0b7a52) | `0.797 0.164 159.7` (#3ddc97) |
   | `--warning` | `0.528 0.109 82.4` (#8a6400) | `0.861 0.163 87.1` (#ffc933) |
   | `--answer` | `0.814 0.167 83.9` (#f5b700) | `0.861 0.163 87.1` (#ffc933) |
   | `--chart-1` | `0.450 0.212 267.0` (#2340c8) | `0.657 0.182 273.1` (#6f84ff) |
   | `--chart-2` | `0.627 0.201 33.0` (#e8492a) | `0.636 0.186 35.5` (#e5552f) |
   | `--chart-3` | `0.559 0.192 301.5` (#8a4fd0) | `0.630 0.182 299.0` (#9a6ae6) |
   | `--chart-4` | `0.561 0.121 160.3` (#138a5c) | `0.627 0.133 159.6` (#22a06b) |
   | `--chart-5` | `0.651 0.135 80.9` (#b98500) | `0.645 0.131 81.9` (#b58408) |
   | `--chart-6` | `0.586 0.176 358.8` (#c9437a) | `0.630 0.169 355.6` (#d4558d) |

   - `--radius` is `0.625rem` (10 px), and the primary button is a pill.
   - `--answer` is never used for text (1.8 to 1 on white). Text on it uses `--foreground`.
   - Every text token meets WCAG 2.2 AA (4.5 to 1) on the surface it is meant for, in both modes. On `--background`, light then dark: `--foreground` 18.4 and 16.8, `--primary` 8.0 and 5.9, `--muted-foreground` 6.9 and 7.5, `--destructive` 5.6 and 6.7, `--success` 5.4 and 10.7, `--warning` 5.4 and 12.3. `--primary-foreground` on `--primary` is 8.0 and 6.0.
3. **Charts: six colours in a fixed order** (blue, red, violet, green, ochre, pink), assigned in order and never cycled. Both sets pass a colour-vision check for lightness, chroma, separation of adjacent pairs under common colour blindness, and contrast against their surface. Kit charts label series directly or with a legend, so identity never rests on colour alone. *Amends* ROUND-3 §1.3, which named five chart variables.
4. **Faces.** **Figtree** for interface text (`--font-sans`, weights 400 to 650) and **Spline Sans Mono** for code (`--font-mono`). Both are SIL Open Font License 1.1 (VERIFIED_FACTS, Default theme). They ship inside the kit as self-hosted variable fonts, so a page makes no third-party request and renders offline, with the system UI and monospace stacks as fallbacks. They map onto the MCP Apps `--font-*` variables like every other token, so a host's faces win inline.
5. **Motion defaults:** a press scales to .97 over 140 ms, and hover and state changes take 180 ms and change colour only. Everything stops under `prefers-reduced-motion`.
6. **Nothing here is enforced** (D68, KT-10). A host brand theme, an agent's own tokens, `className` or copied components replace any of it.

*Why:* a default that looks like Mostra would turn every unstyled artifact into an advert for the tool and compete with the content people came to answer. Figtree keeps a geometric look with a larger x-height than geometric display faces, so 13 to 15 px table and form text stays readable, and it isn't Inter, the default that makes generated pages look alike. OKLCH steps keep light and dark consistent. *Source:* M29. *Rejected:* the brand's full palette in charts and headers by default (competes with the content); a geometric display face for interfaces (a small x-height reads poorly at form sizes); Inter or the system stack alone (indistinguishable from other generated pages); loading fonts from a CDN (third-party requests from every artifact, and no offline rendering).

## WP-11 decisions

### D142. Distribution: the runtime bundle, its verification, the SDK and releases (delegated, M30)
Mirza delegated every WP-11 question at M30. Each item is an **approved decision** taken by the WP-11 session under that delegation. It fills ARCHITECTURE §4 (runtime distribution), REPO_STANDARDS §9 and INTERFACES §16, and *amends* them where it says so.

1. **One bundle per platform** (RT-01): `mostra-<version>-<platform>.tar.gz` for `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64` (glibc; musl and every other platform fail closed with `MOSTRA_PLATFORM_UNSUPPORTED` before any download). One top directory holds `bundle.json` (`BundleInfo`: version, platform, Node.js, entry points, the SHA-256 of `files.json`, the verify browser's pin), `files.json` (every file's path, size, SHA-256 and execute bit, and every link), `node/` (the official Node.js distribution, whole, its archive checked against SHA-256s pinned in `packages/bundle/node.json`, taken from `SHASUMS256.txt` whose signature was verified with the Node.js release keys), `lib/node_modules/` (Mostra's packages, deployed hoisted from `@mostra/bundle`, so each sits beside the others as the runtime looks for them, with pnpm 10, the native modules of that platform and `playwright-core`; the warm set deployed apart in `@mostra/warm/node_modules`, isolated, so artifacts resolve nothing but warm packages), `bin/` (`mostra`, `mostra-runtime`, `mostra-setup`, POSIX launchers that run the bundle's own Node.js from any path), `LICENSE` and `NOTICE`. Each bundle is built on its own platform's runner; its archive is a sorted, owner-free gzip tar with one fixed time, and the assembler fails on a link that leaves the bundle or a file naming the build machine's paths. Node.js 24.21.0 now (D48: 26 LTS from 2026-10-28, in a later release).
2. **The verify browser is not in the archive** (*amends* ARCHITECTURE §4 and REPO_STANDARDS §9, which put "the Playwright Chromium headless shell" in the bundle). Playwright 1.64 installs `chromium-headless-shell` as Google's Chrome Headless Shell from Chrome for Testing: its `ABOUT` file reads "Google Chrome … Copyright 2026 Google LLC. All rights reserved" and points to `chrome://terms`, and no source grants a right to redistribute it inside an Apache-2.0 archive (VERIFIED_FACTS, WP-11). Shipping it would put non-OSI terms inside what users install, against invariant 8's rule. So `bundle.json` pins the browser (revision, version, every file's SHA-256), and setup (`bin/mostra-setup`, or the SDK on first use) runs the bundle's own Playwright to fetch it into `<bundle>/browsers` and checks every file against the pin; a mismatch is `MOSTRA_ENV_BUNDLE_INVALID` and the bundle stays unready. Verify always uses that directory inside a bundle. Two installs of one revision were byte-identical (VERIFIED_FACTS). A machine without the internet sets Playwright's own mirror (`PLAYWRIGHT_DOWNLOAD_HOST`), which setup passes through.
3. **Hash-pinned end to end.** The published `@mostra/sdk` carries `dist/bundles.json` (`BundlePins`: each platform's archive name, size, SHA-256 and unpacked size, and the release's base URL), written by the release after the bundles are built, so npm's provenance covers the pins. An installer refuses an archive whose size or SHA-256 isn't the pinned one, an archive entry outside the bundle's directory or of any kind but files, directories and symbolic links, a `files.json` whose SHA-256 isn't the one `bundle.json` names, and any file, link or execute bit that differs from `files.json` (`MOSTRA_ENV_BUNDLE_INVALID`, nothing installed). `mostra doctor --deep` repeats the check. The GitHub release also carries `SHA256SUMS` and a GitHub artifact attestation per archive, for hosts that download one directly.
4. **The cache is keyed by digest:** `<cache>/bundles/<archive SHA-256>/`, where `<cache>` is `MOSTRA_CACHE_DIR`, else `~/Library/Caches/mostra` on macOS and `${XDG_CACHE_HOME:-~/.cache}/mostra` on Linux. One installer per digest holds a lock; it downloads, extracts and checks in a scratch directory and renames it into place, so a crash, a full disk or a race never leaves a half bundle where a ready one is expected, and an installer that loses the rename uses the winner's checked directory. Downloads honor the proxy variables of the environment the caller gives (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, never silently the process's), make three attempts in all on failures a retry can cure (never on a digest, a size or a 4xx other than 408 and 429), and come from `MOSTRA_BUNDLE_MIRROR` when set (an `https:`, `http:` or `file:` base holding the archives; a user and password in it are sent as Basic authorization, and no message prints them). Offline (`MOSTRA_OFFLINE`), only the cache serves (`MOSTRA_ENV_BUNDLE_UNAVAILABLE` names what's missing). v1 removes no cached bundle by itself, since a login service may still run an older one; a later release may add pruning.
5. **One way to find the runtime**, in the SDK (`resolveRuntime`) and used by the CLI: `MOSTRA_BUNDLE` (an extracted bundle), then `MOSTRA_RUNTIME_BIN`, then the bundle the code runs from, then the bundle the package's pins name (installed on first use), then a development checkout's built runtime beside the package. Every Mostra process runs on that bundle's Node.js, and children that run an artifact's own code (installs, workers) find it first on `PATH`.
6. **The npm entry points.** `@mostra/cli` installed from npm is a bootstrap: before any command it installs its release's pinned bundle (progress on stderr; with `--json` a failure is still one envelope) and runs the bundle's own `mostra` with the same arguments, signals and exit code, so the system's Node.js (22.19 or later) only starts it, and an older one is refused with `MOSTRA_ENV_NODE_UNSUPPORTED` before anything loads; telemetry, if any, runs in the bundle's CLI, never in the bootstrap. `create-mostra` runs that CLI's `mostra new [dir]` with every other argument as given and prints what to run next (`npx @mostra/cli verify`, `publish`, `npm install --global @mostra/cli`); it installs nothing globally and edits no shell profile. RT-01's "no global Node.js" holds for every Mostra process; the check proves it twice: bundles extracted by hand on fresh runners with no Node.js on the test's `PATH`, and the npm path on an older Node.js line than the bundle's.
7. **One version per release.** Every published package but the extension contracts (versioned on their own, D30) is one Changesets `fixed` group; private packages are never versioned or tagged (repo-lint enforces both). A release's tag is `v<version>`. The first release is 0.1.0.
8. **The SDK** (HO-04): `createMostra({ home, ports, client?, settings?, expectPorts?, bundle?, bind?, urlHost?, env?, onLog?, onProgress?, onPortError?, signal? })` resolves the runtime, spawns `mostra-runtime host --home <home>` on the bundle's Node.js, opens the session as `client.name` (default `mostra-sdk`), registers the ports it was given and returns a `Mostra` handle: `publish`, `verify`, `wait` (abortable, losing nothing), `results` (JSON or Markdown), `getState`, `patchState`, `pushLive`, `viewUrl`, `events()` (an async iterable of pages in cursor order, bounded, acknowledged per page for a named stream), `call` for any other method by its definition, `instance`, `capabilities`, `revision`, `warnings`, `runtime`, `closed` and `close()`. Port requests and answers are checked against their schemas both ways. The instance lives as long as the handle. The SDK contains no telemetry code, and its instance is a host instance, so its home sends nothing (D119, D140 item 4).
9. **Releases** (EN-05, D67). The session that finishes an accepted package opens the version pull request (`changeset version`, `docs/agents/release.md`); no bot holds a credential that can open pull requests, and the merge stays a reviewed change under `main`'s rules. On `main`, `.github/workflows/release.yml` publishes a version with no changeset pending and no tag yet, after building and auditing the four bundles, smoke-testing each with no Node.js, packing every package and dry-running its publish, and smoke-testing the npm path on Node.js 22 (and its refusal on Node.js 20): in the `release` environment (only `main` deploys there, one run at a time) it attests the bundles, publishes the GitHub release with them, their asset records and `SHA256SUMS` (immutable releases are on), checks from outside that it holds exactly those bytes and that each pinned URL downloads, and only then publishes the npm tarballs the smoke tests used with `npm publish` and trusted publishing (provenance; each package set to "Require two-factor authentication and disallow tokens"). The published release is the one source of truth for a version's bundles, since npm's pins and the release can never change once published (the Opus review of WP-11, findings 1 and 2): a run that finds the release published and npm lacking part of the version *finishes* it, building every package from the release's tag (pnpm's tarballs are reproducible) and pinning the release's own archives, never new ones; a package npm already has is skipped only when npm holds exactly that tarball, and anything else fails before a byte is published. A version on npm without a published release can't arise in this order and fails the run closed. crates.io publishes through `rust-lang/crates-io-auth-action` once a crate is publishable (WP-12); its first release needs a one-time token (VERIFIED_FACTS, WP-11: the hypothesis holds). npm configures trusted publishing only for a package that exists, so `tools/release/npm-setup.sh` publishes a placeholder for each new package before configuring it.
10. **`ee/`** (EN-09, D118): dependency-cruiser's `core-never-imports-ee`; the license audit refuses a core closure that reaches a package in `ee/` and holds `ee/`'s third-party dependencies to the core's OSI rules while leaving `ee/`'s own license to its text; the api gate's packing check refuses a published tarball with a file under an `ee` directory or a sourcemap built from `ee/` sources. The license audit also audits each assembled bundle (`--bundle`), because a platform's optional native packages exist only on that platform.
11. **Telemetry's release endpoint stays empty** (D140 item 7) until the managed service's collector exists, so the published CLI sends nothing.

*Source:* M30 (delegated). *Rejected:* redistributing Chrome Headless Shell (item 2); npm packages per platform for the runtime (an npm-only channel the Rust crate and hosts can't use, and size); a Changesets bot with an App or token (a standing credential that can open pull requests, for no gain over the accepting session opening one); per-package versions (a compatibility matrix between the CLI, the SDK and bundles); stripping npm and headers from the bundled Node.js (native-addon builds in install children need them).

## WP-12 decisions

### D143. Host ports, the Rust crate and the conformance kit (delegated, M31)
Mirza delegated every WP-12 question at M31. Each item is an **approved decision** taken by the WP-12 session under that delegation. It fills INTERFACES §6, §7 and §16 and ARCHITECTURE §11 where they left the shape open, and *amends* the ownership of HO-01.

1. **Each port arrives with the package that consumes it** (*amends* HO-01's scope). A port without a caller would fix its shape by guesswork and couldn't be exercised "with and without host registration". WP-12 builds the generic path every port uses (registration in `mostra/initialize`, the instance's `capabilities.ports`, calls on the registering connection with their time limits, `HomeConfig.ports`, the Rust traits and the SDK's handlers), the `identity` port, and the Rust traits and kit scenarios of every port the runtime calls (`identity`, `submissions`, `drafts`, `trustedControls`, `secrets`) and of `events` (subscriptions, D58). `addressing` arrives with WP-13, whose share drivers, port plan and Host allowlist registration are what a host's external base needs (new requirement HO-10); `reviews` and `capture` arrive with WP-20, whose threads and crops are their only callers (new requirement HO-11); `pty` stays with WP-23 (v1.1). Each of those packages adds its port to the Rust traits, the SDK and the kit, additively.
2. **The `identity` port** (INTERFACES §7). `port/identity.resolve { artifactId, via, headers }` → `{ ref, name? } | null` is asked when a browser exchanges a capability link minted without a viewer for a shell session, within 5 s (a page is waiting, as for `trustedControls.policy`). `headers` are the request's, with lower-case names, without `cookie` and without Mostra's own `x-mostra-*` headers. `via` is how the request reached the gateway: `local` (its own address), and from WP-13 `tailnet` (Tailscale Serve) and `token` (a public share, where the link is all that identifies the viewer). An answer `{ ref, name? }` is one viewer of kind `host`, mapped idempotently by `ref` as `view/url`'s viewers are (D104), and the session acts as it; `null` leaves the standalone default (the home's local user; WP-13's tailnet mapping). A link minted with a viewer keeps it and asks nothing (D104: a token's viewer never changes). A host that took identity over never has a viewer silently become someone else: a call that fails, times out or answers something its schema refuses, and a host that names `identity` in `HomeConfig.ports` but isn't connected, refuse the exchange with 503 `MOSTRA_HOST_IDENTITY_UNAVAILABLE`, which the shell shows.
3. **The kit drives a host through a harness protocol** (HO-05). A host ships a small shim, a program the kit starts, that speaks JSON-RPC 2.0 over its stdio (revision `2026-10-21`, additive within it like the host protocol): `harness/initialize` (its name, the ports it registers, its features `attach`, `faults` and `events`), `harness/start { home, env, mode? }` (it spawns or attaches to its instance for that home, adding `env` to the instance's environment, which is how a scenario sets the runtime's fault points), `harness/call` (one host-protocol request through the host's own client), `harness/stop`, `harness/store` (what the host's own store holds: deliveries with how often each was called and stored, draft mirrors, activations, identity, policy and secret calls), `harness/script` (feature `faults`: answer a port as the kit asks) and `harness/events` (feature `events`: read the host's own named event stream). Every host-protocol call goes through the host, so its client, wire types and ports are what is judged; the kit itself plays only the viewer (the browser protocol through the real gateway) and, for a property of the instance rather than the host, opens its own socket session. A scenario skips only when the host lacks a port or feature it needs. Each scenario gets a fresh home, runtime directory and shim, and a time limit (240 s). TypeScript hosts write the shim with `serveHarness`. *Rejected:* a TypeScript library hosts call from their own test suites (no Rust host could use it, and a host's suite would grade itself).
4. **Baselines and broken hosts.** A baseline (`{ schemaVersion: 1, expectedFailures: { <scenario>: <why> } }`) turns a listed failure into `expected-failure`; a listed scenario that passes is `unexpected-pass` and fails the run, so a baseline only shrinks, and a baseline naming an unknown scenario is refused. The reference hosts take `--break store-duplicates,drafts-as-submissions,ignore-policy`, whose committed baselines name exactly the scenarios those faults break; the TypeScript and Rust reference hosts, their `--standalone` modes (Mostra's built-in adapters) and their broken modes with baselines are each run in CI.
5. **The shell's bridge in a real browser.** `viewing.shell-bridge` loads a link in Chromium through `playwright-core` (the shell must speak the bridge: the label the page asked for, blockers by label that focus the field, a flush that writes the defaults the page showed before a trusted Submit, the new-version banner). It runs against whatever shell serves the host's links; a host that replaces the shell (D65, later D126) passes the same scenario.
6. **The crate.** `mostra-host` follows the release group's version (D142 item 7; `tools/release/versions.ts sync` after `changeset version`, repo lint refusing a crate that differs), so a release names one runtime, and it embeds the same bundle pins as `@mostra/sdk` (`bundles.json`, written by the release before packaging; its build refuses pins of another version). Its first crates.io release is published once by Mirza with a token (`tools/release/crates-setup.sh`, from the release's tag with the pins the published SDK carries, checked against the release's `SHA256SUMS`); then he adds the trusted publisher, and every later release publishes the crate from its tag through trusted publishing. Wire types accept what a newer Mostra adds: unknown object fields are ignored, and an unknown enum value or union member reads as an `Unknown` variant that serializes back unchanged (older TypeScript clients still refuse them: issue #45). `Mostra::close` takes `&self`, so a host that shares its handle can close it. A pull request's release rehearsal builds, packs and dry-runs the version its pending changesets make (`versions.ts plan` and `rehearse`), since npm refuses even a dry run over a version it has.
7. **No host-specific code in the core** (HO-06) is a gate: `tools/audit/host-neutral.ts`, in the `boundaries` job, refuses a known host's identifiers in any package's `src/`, manifest, README or AGENTS.md, any crate's sources, the lockfiles and the CLI reference. JCODE_HOST.md names, for every need H-01 to H-16, the scenarios that exercise it, and a test keeps that column true.
8. **CI.** The `conformance` job runs the kit against the Rust reference host (every port, standalone, broken with its baseline) on macOS and Linux; the TypeScript reference host's runs are in the integration job's `clients` group.
9. **Reviews and prose.** GPT-6.1-Sol through `codex review`, and Claude Opus 5.5 (approved at M32, which also made it every package's, D144), each announced (D34). Agent-facing prose (the crate's and the kit's AGENTS.md and READMEs, rustdoc, the new diagnostic's hint) is delegated as in WP-03 to WP-11: Mirza sees only the texts the agent isn't confident in, before the merge.

*Rejected:* building `addressing`, `reviews` and `capture` before their callers (item 1); a single TypeScript-only conformance library (item 3).


### D144. A Claude Opus review for every package (M32)
*Supersedes* D114 and *amends* D80 item 3: every work package gets a Claude Opus 5.5 review of its pull request before it merges, beside GPT-6.1-Sol's (D80 item 1), whatever its size. The session writes the review prompt (the package, its decisions, its evidence and where to look hardest), Mirza runs it and brings the findings back, and each is fixed with a test red on the old code or answered in the progress report, as for every reviewer. Anthropic runs still follow D34: Mirza runs or approves each one. *Why:* Mostra's packages are large, complex and enterprise-grade, and each Opus review so far found defects the other gates missed. *Source:* M32.

### D145. The hosted shell's framing is an operator setting (M33)
*Amends* D126: WP-28 designs the hosted shell's framing policy (`frame-ancestors` and `X-Frame-Options`, INTERFACES §4) as operator configuration whose default and only v1 value is today's `'none'` and `DENY` (D98). A later embed mode (EX-08) can then add a per-tenant allow-list, paired with host-rendered trusted controls, without migrating issued links or shells. Nothing in v1 allows framing, and invariant 7 is unchanged: any allow-list waits for the embed decision and its own review against that invariant. *Why:* products that build on Mostra may want its pages inside their own web apps; keeping the policy a setting now costs little, while changing every hosted shell after launch would not. *Source:* M33.

### D146. Windows in v1.0, as WP-W1 to WP-W3 (M34)
*Supersedes* D120 and *amends* D35 and D125: Windows (x64 and arm64) ships in v1.0. Three packages build it right after WP-12 and before WP-13: WP-W1 (platform layer, supervisor and ledger, RT-10), WP-W2 (gateway, workers, `verify`, the CLI and the login service, RT-11) and WP-W3 (bundles, the SDK, the Rust crate and conformance, RT-12). WP-32 is withdrawn, and RT-10 takes the release label `v1`, with RT-11 and RT-12 split from it. Until WP-W3 removes it, a development switch that only CI sets admits Windows, so no release exposes a partial port; every other platform still fails closed (RT-07). From WP-W3 on, every package keeps its Windows CI legs green. Terminal features on Windows wait for WP-22 and WP-23. The W series keeps the existing numbers stable; `tools/design/wp_specs.py` and `tools/design/evidence_matrix.py` accept `WP-W<n>`. *Why:* about half of professional developers work on Windows (Stack Overflow Developer Survey 2025: 49.5%), so a release without it turns away many of the people agents work for and send pages to; and porting now, before the remaining packages, keeps each of them from adding Unix-only code that would have to be retrofitted. *Source:* M34.

### D147. Harness plugins built for directory review (M35)
WP-14's harness plugins are built to pass the plugin directories' review on the first scan:
- **Claude Code:** the generated plugin lives in its own repository with its manifest at the root; it launches the local MCP server pinned to an exact version; its README discloses everything it runs, sends or fetches, every network destination included (the telemetry endpoint and how to turn it off); it has no hooks; its name is `mostra`.
- **OpenAI's directory (ChatGPT and Codex):** no upgrade prompts or plan display inside the plugin or app, OAuth only, no hooks, no trial plugins; framed third-party pages get extra review, so the app renders through the MCP Apps resource.
- MCP Bundle desktop extensions are not built.

The session verifies each rule against the directories' own pages on the day and records them in VERIFIED_FACTS. *Why:* directory review decides whether the plugin can be listed, a plugin that fails its first scan is rejected, and the directories are how people who never open a terminal install Mostra. *Source:* M35. *Amends* WP-14's scope.

### D148. Plugin-started MCP servers count as embedded use (M35)
*Clarifies* D119: an MCP server that a harness plugin starts runs on the host's behalf, so it counts as embedded use and sends no telemetry, whatever the consent setting of the standalone CLI on that machine. Usage on that route is measured from the directories' own dashboards, package downloads and the `clientInfo` a remote server receives, never from the user's machine. WP-15 implements it and adds a test: `mostra mcp` started with a plugin's launch configuration sends nothing. *Why:* D119 limits telemetry to commands a person runs in the standalone CLI, and a plugin whose only network destination is its own server keeps its disclosure simple. *Source:* M35.

### D149. Agent-facing prose is accepted once per package (M35)
*Amends* D74: Mirza accepts each package's agent-facing prose (the Skill, AGENTS.md files, MCP tool descriptions, CLI help, diagnostic hints) in one batch at the end of the package, on the complete texts, instead of text by text during it. Drafts are still written with him in mind, and mechanism tests may use placeholder text until then. The acceptance is the package's evidence row for its prose. *Why:* prose is judged best in context, as the whole set an agent will read, and WP-14 and WP-15 are mostly prose. *Source:* M35.

## Research consensus adopted

These points were presented as the converged research findings and approved as a set at M5. The decisions above carry their details.

| Area | Adopted | Decision |
|---|---|---|
| Positioning | Agent artifact runtime with three delivery targets; compile to MCP Apps | D07 |
| Runtime | Vite 8 + React 19 SPA + server functions on Hono; RSC later as opt-in mode | D18, D19 |
| Process model | Private Node LTS sidecar, supervisor plus per-artifact workers, stdio JSON-RPC to hosts | D18 |
| Isolation | Origin per artifact, port fallback, separate trusted shell origin | D21 |
| State | Revisioned drafts, append-only events, immutable bound submissions, SSE down / HTTP up | D22 |
| Review | Outer-shell overlay, multi-resolution anchors | D23 |
| Kit | Brief 3 defaults; non-OSI engines plugin-only | D26 |
| TUI | Frame model + owned renderer, xterm.js live, asciicast v3, Ratzilla, capture crate | D28 |
| Agent loop | `verify`, JSON diagnostics, Skill + AGENTS.md, regression across turns | D29 |
| Remote | Stateless dual-version remote MCP, sandbox port, PSL user-content domain (v1.x and later) | D12; the remote server moved into v1 by D116 |
| Extensions | Hybrid npm plugins + copy-source packs, metadata registry | D30 |
