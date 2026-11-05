#!/usr/bin/env python3
"""Generate docs/design/EVIDENCE_MATRIX.md from REQUIREMENTS.md, WORK_PACKAGES.md and the checks below,
and fail if any v1 or v1.1 requirement lacks exactly one owner or a check, or any owned ID is unknown.
v1.1 rows (built after the first release, D122) follow the same rules as v1 rows and get their own
section. With --check it writes nothing and fails when the committed matrix is stale (the docs job in CI
runs this)."""
import re, sys, pathlib

D = pathlib.Path(__file__).resolve().parents[2] / "docs" / "design"

# Releases whose requirements the packages in WORK_PACKAGES.md build: each row needs exactly one owner,
# a concrete check, and takes its evidence from the owner's progress report. v1.x and later rows have none.
OWNED_RELEASES = ("v1", "v1.1")


def load():
    """Parse requirement rows and WP ownership from the dossier."""
    req_rows, owners, wp = {}, {}, None
    for line in (D / "REQUIREMENTS.md").read_text().splitlines():
        m = re.match(r"^\| ([A-Z]{2}-\d\d) \| (.+?) \| (v1\.x|v1\.1|v1|later) \| (.+?) \| (.+?) \|$", line)
        if m:
            rid, text, rel, src, route = m.groups()
            if rid in req_rows:
                sys.exit(f"duplicate requirement row {rid}")
            req_rows[rid] = dict(text=text, rel=rel, src=src, route=route)
    for line in (D / "WORK_PACKAGES.md").read_text().splitlines():
        m = re.match(r"^### (WP-(?:\d\d|W\d))\.", line)
        if m:
            wp = m.group(1)
        m = re.match(r"^- \*\*Owns:\*\* (.+)\.$", line)
        if m and wp:
            for rid in [x.strip() for x in m.group(1).split(",")]:
                owners.setdefault(rid, []).append(wp)
    return req_rows, owners


CHECKS = {
 "AU-01": "Fixture artifacts using plain React, TSX and MDX with no Mostra-specific constructs build, verify and render (WP-03 integration, browser)",
 "AU-02": "A single page.tsx, a single page.mdx and a directory with pages, components, \"use server\" modules, data and assets each publish and render",
 "AU-03": "Fresh directory without package.json or config publishes (integration); no config file is written",
 "AU-04": "Manifest metadata (title, description, family, links, mode) round-trips into artifact/get and results; mode defaults to spa (unit + integration)",
 "AU-05": "Fixtures with duplicate IDs, IDs changing between renders and unbound controls produce MOSTRA_FIELD_* codes at the right severity",
 "AU-06": "`mostra new --template <family>` for every family produces an artifact that passes verify, with AGENTS.md (CI matrix); Mirza reviews",
 "AU-07": "Non-literal manifest gives MOSTRA_MANIFEST_NOT_LITERAL; supervisor-side extraction never executes code (spy); duplicate id claim fails publish",
 "AU-08": "Each hook of INTERFACES §2.3 has unit tests and a browser test; window.storage passes a compatibility suite modeled on Claude's documented API",
 "AU-09": "pages/ artifact navigates in browser history locally, hash in static export, memory in MCP Apps; comments record the page",
 "RT-01": "Clean macOS and Linux CI runners without Node: npm create mostra → verify → publish; tampered bundle rejected; external: real install",
 "RT-02": "Process audit test: supervisor module graph contains no artifact module after build, publish, verify and action calls",
 "RT-03": "Worker per active version starts on first call, evicts after idle, restarts with backoff, parks after repeated crashes (integration)",
 "RT-04": "Crash, OOM and busy-loop fixtures in one artifact; sibling artifact and gateway keep serving; viewer sees actionable message",
 "RT-05": "Client-only version served with zero worker processes (process table assertion)",
 "RT-06": "16 racing starters converge on one supervisor; stale socket recovered; `mostra host` over stdio and attach over socket both pass the protocol suite",
 "RT-07": "macOS and Linux CI legs green; a simulated unsupported platform fails closed with MOSTRA_PLATFORM_UNSUPPORTED before touching the home (Windows until WP-W3 admits it, D146; a platform that stays unsupported after)",
 "RT-08": "Lifecycle tests for daemon idle exit (with and without pending work), `daemon install` units generated, heap and watchdog limits applied, port leases reused after restart",
 "RT-09": "SIGKILL the supervisor with demo and PTY grandchildren running; next start reaps them by recorded PID and start time",
 "RT-10": "Windows CI runner: 16 racing starters over the Windows transport converge on one supervisor; a killed supervisor's children and grandchildren are reaped by PID and creation time; publish and install fixtures pass; another user can open neither the home nor the transport",
 "RT-11": "Windows CI runner: the integration and e2e suites pass as on macOS and Linux (verify, crashing and busy-looping workers, controls, `dev` reload); `daemon install` starts the service at login and `daemon uninstall` removes it",
 "RT-12": "Windows CI runner without global Node: `npm create mostra` through `verify`, `publish`, a submission and `results`; release dry run produces verified win32 x64 and arm64 bundles; the Rust crate and conformance kit pass on Windows; the RT-07 fail-closed check still passes for unsupported platforms",
 "VR-01": "Digest unit tests (byte changes, renames, lockfile, env fields change the ID; ignored paths don't); same pair publishes as reused",
 "VR-02": "Fault injection at each publish step leaves no visible version and cleans staging on next start",
 "VR-03": "No viewer URL reaches dev or unpublished content (route enumeration test); viewers only open versions",
 "VR-04": "Open view shows the banner within one event after a publish (browser, three engines)",
 "VR-05": "Version with removed field: banner counts orphans, panel shows values read-only, results include `orphaned` (browser + integration)",
 "VR-06": "gc property test never removes a version referenced by a submission, view, review set or follow; dry run lists candidates",
 "VR-07": "Each export class produced from fixtures; static and html open from disk; snapshot marks actions unavailable; bundle runs via `mostra run`",
 "VR-08": "`mostra dev` hot-reloads on a separate port and is unreachable through capability URLs",
 "VR-09": "Publish reuses a cached verdict (no rebuild), refuses on errors, and with --force records failing codes in the manifest",
 "VR-10": "Fixture version built at browser-protocol revision N works against a gateway at N+1 (CI keeps old fixtures)",
 "VR-11": "Delete the authoring directory; artifact, versions, results and verify regression baselines remain readable",
 "DP-01": "Warm-set imports resolve without install; runtime check shows one React instance with an on-demand peer-dependent package",
 "DP-02": "Unknown import installs into the shared store with a per-artifact lockfile; explicit policy returns MOSTRA_DEP_MISSING with the command; external: real npm",
 "DP-03": "Lockfile change changes envDigest; frozen version rebuilds offline from the store",
 "DP-04": "Offline missing package returns MOSTRA_DEP_OFFLINE within 1 s (timer assertion), no hang",
 "DP-05": "Lifecycle script records its PID, cwd and environment; they belong to the install child in the artifact context",
 "DP-06": "License audit in CI fails on a seeded PolyForm or non-OSI dependency in the core and passes on the real tree",
 "IN-01": "Property tests for CAS, monotonic revisions and mutation-ID replay (unit + integration)",
 "IN-02": "Close the tab mid-debounce in three browsers; reopen shows the value (pagehide and journal paths)",
 "IN-03": "Two tabs and two contexts converge on different fields; same-field edit surfaces a conflict with both choices",
 "IN-04": "Offline edits journal and replay in order; edits against a replaced version map by ID or become orphans",
 "IN-05": "Submit transaction tests: snapshot from canonical draft, digest, version and view binding, stale flag, duplicate returns original; write-once trigger",
 "IN-06": "Grep and API tests: no path delivers a draft as a submission; mirrors are labelled drafts; conformance scenario",
 "IN-07": "Policy matrix tests: once per-artifact, once per-viewer, epochs linkage, none; conformance per policy",
 "IN-08": "Event cursor property test (total order, no gaps across restart and reconnect); filtered subscribe and ack resume",
 "IN-09": "Signals from shell, artifact and action appear as signal.raised; a test asserts Mostra performs no wake-up action of its own",
 "IN-10": "wait level and edge semantics; timeout returns still_waiting with a cursor and later wait returns the event (CLI, protocol, SDK)",
 "IN-11": "Results JSON validates against the schema; Markdown golden includes answers, choices, comments with crop paths, versions, runs",
 "IN-12": "Host down during submit: submission durable, delivery pending, replay in order on reconnect; crash after host ack redelivers same deliveryId",
 "IN-13": "Shell shows Submitted, Delivered, Pending delivery and Undeliverable in the right sequence (browser); Mirza reviews wording",
 "AC-01": "Fixture action reads a file, spawns a process and calls the network with no Mostra restriction (integration)",
 "AC-02": "Run streams progress, log and partial results; survives tab reload and re-attaches; final event recorded",
 "AC-03": "Double click and two tabs with an explicit key send once to a counting fake server",
 "AC-04": "Cancel reaches the action's AbortSignal; run ends cancelled",
 "AC-05": "emit() and signal() from an action reach a subscribed host with causation (conformance)",
 "AC-06": "Secrets set by name, resolved by home store and by port; grep tests over logs, events, exports, diagnostics and screenshots find no value",
 "AC-07": "load, refresh, watch, stream and push all update useLive; live data never uses HMR channels (no Vite client in versions)",
 "AC-08": "uPlot live chart holds the WP-19 target rate with the stated point count in CI browsers; frame-drop budget asserted",
 "RV-01": "Comments pin and reload on DOM, canvas, kit charts, served iframe and opaque iframe fixtures (three engines)",
 "RV-02": "Stored anchors contain every applicable layer and always a crop; resolution order tested by removing layers",
 "RV-03": "Gallery, focus, compare (2 to 4, synchronized, pixel diff) and choose-one; choice and comments arrive with the submission",
 "RV-04": "Artifact attempts to hide, cover or forge the overlay and its controls fail (browser tests)",
 "RV-05": "`mostra review export` Markdown and JSON goldens with crop paths that exist",
 "RV-06": "Comments on a Timeline, a video and a deck slide anchor to time plus region or slide plus step and re-resolve after reload",
 "SH-01": "Shell and artifact are different origins; trusted controls exist only in the shell DOM (browser assertion)",
 "SH-02": "Artifact requests a label; it cannot click or spoof the control; host shell-only policy denies artifact submit with the code; channel recorded",
 "SH-03": "Cookie mode in Chromium, Firefox, WebKit and real Safari; leases stable across restart; cross-site fixtures select worker mode",
 "SH-04": "Bridge rejects wrong origin and malformed messages (unit); message names match MCP Apps where shared",
 "SH-05": "Mirza's review of the final shell design (D68)",
 "SH-06": "Mobile layouts in WebKit and Chromium emulation; external: real phone over tailnet; Mirza reviews",
 "HY-01": "All 13 checklist items as automated negative tests (bad Host, bad Origin, missing token, CSRF, CORS, CORP, referrer, revocation 410, rate limit, redaction, GET side effects, header fuzzing, MCP HTTP)",
 "HY-02": "Default bind is loopback only (socket inspection); wider bind needs the flag",
 "HY-03": "Scoped tokens: a view-and-comment link cannot submit or run an action; expiry, rotation and revocation tests",
 "HY-04": "External: real `tailscale serve` share from a phone; identity header maps to viewer; spoofed header from loopback-bypassing request impossible",
 "HY-05": "External: Funnel share with short-lived token; Cloudflare quick tunnel share in worker mode with long-poll",
 "HY-06": "SECURITY.md with private vulnerability reporting enabled (repository setting checked); Mirza reviews",
 "HY-07": "Worker-mode cross-site fixture passes in three engines and real Safari, including reload; conflicting service-worker registration gives a diagnostic",
 "HY-08": "Signed-in and anonymous viewers record the kinds `account` and `anonymous`; a forged identity claim is refused; a link without sign-in still works within its scopes; seeded: a cookie tossed onto the parent domain, a cookie named to shadow a session and a sibling filling the jar past 180 cookies each leave every hosted session working (D165 item 8); two routes never receive the same anonymous key for one browser; sign-in starts only from the trusted chrome, and a code started on one route is refused on another",
 "HY-09": "Serving an artifact's files from the apex or from the API origin is impossible (route test); the artifact can't click, hide or restyle the report control, the sender line, the footer or the after-submit line (WP-07's forgery suite reused, D161); preview tags are identical across two artifacts; an interstitial and an expiry from `policy` are honored; every hosted response sends `Origin-Agent-Cluster: ?1` and the shell's resources CORP same-origin, no check trusts `Sec-Fetch-Site: same-site`, and no credential is bound to the user-content domain (each red on a seed); the shell's CSP and Trusted Types refuse an injected script in tenant text; a session sent with another route's path is refused; every document of a label origin names only its domain's shell in `frame-ancestors`; a sibling filling Firefox's storage group leaves the shell working, with the link kept",
 "HO-01": "Every port exercised with and without host registration (conformance), and a port of an unknown name registered and called through the same path",
 "HO-02": "Revision negotiation picks highest common; unsupported revision refused with the code (protocol suite)",
 "HO-03": "Rust crate: wire-type snapshot test, client integration against a real instance, spawn and attach, bundle cache; external: crates.io release",
 "HO-04": "SDK host registers ports, publishes, receives delivery, waits and reads results (integration)",
 "HO-05": "Conformance kit passes on standalone adapters and both reference hosts; broken host fails expected scenarios; baselines work",
 "HO-06": "Audit: no host-specific identifiers in core packages; every JCODE_HOST row maps to a conformance scenario; Mirza reviews",
 "HO-07": "Schema snapshot test fails on any non-additive change to protocol, browser protocol, CLI JSON or MCP tool schemas",
 "HO-08": "Conformance: host-chosen home; authoring directory removed; artifacts, versions and submissions still readable",
 "HO-10": "Conformance: a host's external base appears in minted links and passes the Host and Origin checks; without the port, links stay on loopback; a base the host withdraws stops working",
 "HO-11": "Conformance: a host's reviews port receives each thread and choice, and its capture port supplies the crop a comment stores; without them, no mirror and the verify runner's browser",
 "HO-09": "A fixture operator module: `limits` refuses a share with its diagnostic, and when it times out shares fail closed while submissions proceed; `metering` and `events` arrive at least once with stable IDs across a restart, MCP calls carrying `clientInfo`; `accounts` resolves an identity, sends a first sign-in step and resumes, and authenticates an operator-issued key; `abuse.pushed` reads a pushed version and quarantines it; `routing` serves a supplied hostname and an unknown host gets nothing; the handle pauses, suspends and revokes; with no operator everything works; `accounts.authenticate` admits an operator-issued key on `/host`, `/mcp` and `/files`, so an always-on owner instance links with it; `events.deliver` carries a submission's Results; the handle's `revokeLink`, `drainHome`, `releaseHome` and `restored` act as specified; `policy.link`'s idle expiry is honored",
 "KT-01": "Render test per D26 library wrapper in three engines; license and version re-verified in VERIFIED_FACTS",
 "KT-02": "License audit fails on a seeded non-OSI engine in the core bundle; passes on the real tree",
 "KT-03": "Both base packs type-check and render every component; default base set from EVAL-01 evidence",
 "KT-04": "Token change restyles every kit visual (screenshot diff); dark mode; host brand theme; MCP Apps variable mapping test; Mirza reviews",
 "KT-05": "Questionnaire features each persist through fields and appear labelled in results; Mirza reviews",
 "KT-06": "Timeline frames render deterministically (pixel-identical screenshots at given frames); play, scrub, loop; Mirza reviews",
 "KT-07": "Deck fixture: layouts, clicks, presenter view sync, print to PDF one slide per page; Mirza reviews",
 "KT-08": "Each guidance rule has a lint fixture with a working autofix; wrong-base TS2322 shape becomes MOSTRA_KIT_WRONG_BASE",
 "KT-09": "Mirza's review of the gallery for beautiful by default",
 "KT-10": "Restyle tests: className and copied components override kit visuals; an artifact with no kit usage verifies cleanly",
 "KT-11": "Each component renders from fixtures in both themes and accepts `className`",
 "TM-01": "Fidelity fixture suite (box drawing, 256 and true color, CJK, emoji ZWJ, combining marks, wrap, cursor, alt screen) renders consistently across modes within threshold",
 "TM-02": "htop, vim and a ratatui demo run live with resize and input; recording replays to identical frames",
 "TM-03": "asciicast v3 playback with scrub and markers (browser)",
 "TM-04": "Ratzilla template builds and runs in the WASM island; frames reported over the bridge",
 "TM-05": "Capture crate frames equal WASM-mode frames for the template app (zero cell difference)",
 "TM-06": "`term dump` text, cells and ANSI goldens; lint flags misaligned borders, overflow and width disagreements on fixtures",
 "TM-07": "TerminalCompare synchronized playback and cell diff; comments on cell rectangles resolve after reload",
 "TM-08": "Vite and Next.js demos proxied with HTTP and WebSocket passthrough and HMR; framing headers stripped for that demo only; device frames and screenshots",
 "AX-01": "Contract test per command: --json schema, exit codes, no prompts without a TTY, logs on stderr",
 "AX-02": "Pipeline stage fixtures each produce their diagnostics; verdict validates; timings recorded",
 "AX-03": "Diagnostic schema validation; code catalog and docs pages generated; codes covered by API snapshot",
 "AX-04": "Regression fixture (removed control, layout shift, missing field) detected against the last passing version",
 "AX-05": "Screenshots at DPR 1 with token estimates; images returned only on failure or request",
 "AX-06": "Mirza's acceptance of the Skill and AGENTS.md prose; skills-ref validate; loading mechanism tests",
 "AX-07": "Docs site built with Mostra deploys to GitHub Pages; llms.txt and per-page Markdown generated; Mirza reviews",
 "AX-08": "Evaluation harness pilot report with provider, model, date and tokens; batches announced (D34, D64)",
 "AX-09": "Every D60 command plus run and state implemented with contract tests (`run` arrives with WP-29's bundle, D125; `term` with WP-22 in v1.1, D122)",
 "AX-10": "Generated harness plugins for five harnesses are real copies and load in each harness's documented layout; external: at least Claude Code and Codex",
 "MC-01": "MCP conformance suite; scripted session create → results; HTTP hygiene tests; external: Claude Desktop or Codex",
 "MC-02": "ext-apps reference host renders the export; fields, submit and actions round-trip; CSP and variables declared; URL fallback offered; external: Claude Desktop and VS Code",
 "MC-03": "Each unavailable feature shows its explicit message in the MCP App (browser)",
 "MC-04": "Protocol suite against the remote endpoint; OAuth per the 2026-07-28 specification: a 401 with `resource_metadata`, Client ID Metadata Documents advertised with `none`, Dynamic Client Registration, PKCE S256, an audience check, `iss`, rotating refresh tokens (a reused one revokes its grant); authoring through the account's default owner instance, and `MOSTRA_REMOTE_NO_INSTANCE` without one; an unapproved registered client gets no code without the server's own consent, and an approval for one client doesn't carry to another; two refreshes within 30 s get one successor and a later reuse revokes the grant; a metadata document at a private or loopback address, or behind a redirect, is never fetched; loopback redirects ignore the port only for `127.0.0.1`, `[::1]` and `localhost`; external: a claude.ai custom connector and a ChatGPT custom MCP server (write tools need a Business or Enterprise workspace, VERIFIED_FACTS) create, open and submit an artifact on a test deployment, opening it through its hosted link. Inline persistence of exported MCP Apps needs WP-17's exporter and app-only tools: WP-17 repeats this check inline through the remote MCP server (check boundary, D125)",
 "EX-01": "Six contract packages published at 0.x with independent versions; compatibility tests in and out of range",
 "EX-02": "`mostra plugin validate` accepts valid manifests and reports each invalid field",
 "EX-03": "An unchanged third-party shadcn registry item installs; Mostra packs install through shadcn too",
 "EX-04": "Non-OSI fixture plugin refuses without --accept-license and installs with it; recorded in the lockfile; host pre-acceptance works",
 "EX-05": "Each first-party plugin installs, passes its verify baselines and exercises its contract",
 "RS-01": "One test per D19 seam (mode field, use server contract and serializer, AsyncLocalStorage context, use client runtime, RenderMode)",
 "RS-02": "Mirza's review of SPA-mode completeness at WP-26; no SPA component marked temporary",
 "RM-01": "Bundle moves between homes keeping identity; ports and WorkerLauncher documented; MCP server stateless (handle-only test)",
 "RM-02": "Two instances on one machine, one as a remote server (`mostra-runtime server`): `mostra login` by the device grant, `share --cloud`, open from a browser, submit; the respondent sees \"Your answer was sent.\" and no delivery state (IN-13 for hosted links, D165 item 1a); `wait` returns and the local host receives the delivery exactly once in effect through the owner's outbox; the sync cursor brings signals and state changes to local waits; a push sends only missing files and never server code (grep); a connection silenced past 45 s reconnects; a second instance of the account receives nothing; with two linked instances of one account, the owner instance's host receives each submission once and the other instance receives no delivery and imports nothing; signing out and in again keeps the instance's artifacts; a hosted home restored from a lagging copy under traffic rotates its incarnation, and the owner keeps what it imported, follows on and records the regression; an open binding is closed at its token's expiry unless refreshed in band, and within 60 s of a revocation; external: the same against a deployed server",
 "RM-03": "Container image serves two accounts' homes; cross-tenant reads, writes and frame entries are refused (seeded attempts); a second process refuses a hosted home it doesn't hold the lock of, a backup replicator reads a live hosted ledger, and a data directory on a network filesystem is refused; an unknown Host gets nothing; a grep and dependency audit shows no operator-layer code in the core; two accounts host one artifact ID, each on its own route; a removed artifact's label is never served again after another account pushes the same ID, and an operator's label released by one account never goes to another; `HEAD /files` and `hosted/push` tell one home nothing of another's files, and an upload no pending push of the home names is refused",
 "RM-04": "A counting fake mail action pressed on the hosted page runs once on the owner; owner offline: under `queue` the run waits and runs once on return, in order and at the drain rate, under `fail` it ends at once, and past the cap a run is refused before it is recorded; relay cut mid-run: the owner finishes and reports, past the offline limit the run is `unknown` and the reported end replaces it once; a repeated relay message starts nothing; a grep shows no secret in relay traffic; the owner accepts a run and its acknowledgement is lost: the run is sent again, joins, and happens once; an owner restored to before runs it accepted: they become `unknown` and are never sent again; after every reconnect the accepted, unfinished runs are reconciled",
 "RM-05": "Mirza accepts the design; generators pass with the refined specifications",
 "RM-07": "An artifact with a manifest tally: three hundred submissions across three choices give exactly those counts in the hosted home and in a local one, viewers receive them on the live channel with the owner offline and no worker running, a value outside the listed choices counts nothing (so no free text is ever shown), and a count never goes down (trigger)",
 "RM-08": "Load test against the container image with the owner offline: anonymous submissions at 1 a second for 30 minutes and bursts of 10 a second, p95 acceptance under 0.5 s, every one delivered to the owner in order when it returns; past a per-IP and a per-link limit the answer is 429 with `Retry-After` and the shell's \"try again shortly\", the draft kept, nothing dropped (counted); `once` per anonymous browser holds best effort and is recorded unverified; per-IP limits key IPv6 by /64 and ignore a forged leftmost `X-Forwarded-For`",
 "RM-09": "`mostra pause` and `resume` on a hosted artifact, and the operator handle's `pause`: views keep working and the shell shows it paused, submissions answer 423 and relayed actions are refused with the draft kept, links stay valid, resume restores everything; the owner can't resume an operator's pause",
 "EN-01": "LICENSE, NOTICE and DCO check present; CI rejects an unsigned commit",
 "EN-02": "Tooling baseline in place and pinned through catalogs; `pnpm check` equals CI",
 "EN-03": "CI job verifies every example and template with committed visual and ARIA baselines",
 "EN-04": "API Extractor, publint and attw gates fail on seeded violations",
 "EN-05": "Release dry run in CI; first real release with provenance after Mirza's account steps (external)",
 "EN-06": "Pinned action SHAs (lint), CodeQL, dependency review, Renovate minimum release age and Scorecard configured and running",
 "EN-07": "CI measured under 10 minutes for a typical pull request; seeded violations caught by each gate; lefthook hooks run",
 "EN-08": "Seeded: a host-spawned instance (`mostra host`) sends nothing; `DO_NOT_TRACK=1` sends nothing; payloads match the documented schema and contain no paths or tokens. WP-11 adds the SDK-spawned case to the same test",
 "EN-09": "Seeded import from core into `ee/` fails the boundary check; a packed core tarball contains no `ee/` file",
 "LL-01": "Agent and viewer write the same artifact field concurrently; both see the conflict; state.changed events filtered by a host",
 "LL-02": "Policy none: no Submit control; submit API refused; state, actions and signals work",
 "LL-03": "Follow on: new version loads automatically; blocked by unsaved edits or orphans with the banner instead",
 "LL-04": "Live updates produce no durable events; producer lifecycle with viewers, subscriptions and always:true; ring buffer bounded",
 "LL-05": "Local URL works after a week of simulated time; revocation and rotation work; doctor warns about long-lived artifacts without an always-on daemon",
 "LL-06": "Long-lived templates (dashboard, tasks), conformance scenario and gallery entries exist and pass; evaluation scenarios include J11 and J12",
 "CO-01": "Roster of five yields five links mapping to five viewers; roster changes are events",
 "CO-02": "Property test over interleavings: satisfied exactly when the last respondent submits, under `once` per-viewer and `epochs`",
 "CO-03": "Five simulated viewers in browsers move through states; hook, protocol and CLI agree",
 "CO-04": "Cursors from three viewers reach each other within the rate; the ledger holds no presence rows; opting out stops sharing",
 "CO-05": "Two viewers edit a shared field; each sees the other's attribution",
 "CO-06": "A mention emits one event naming the mentioned viewer; hosts filter it",
 "CO-07": "Each policy setting returns exactly what it promises to a viewer's hooks; the default is the one WP-31 records with Mirza",
}


def main():
    d = D
    req_rows, owners = load()

    errors = []
    owned = {k: v for k, v in req_rows.items() if v["rel"] in OWNED_RELEASES}
    for rid, r in owned.items():
        o = owners.get(rid, [])
        if len(o) != 1:
            errors.append(f"{rid} ({r['rel']}): owners {o}")
        if rid not in CHECKS:
            errors.append(f"{rid} ({r['rel']}): no check")
    for rid in owners:
        if rid not in owned:
            errors.append(f"{rid}: owned by {owners[rid]} but not a v1 or v1.1 requirement")
    for rid in CHECKS:
        if rid not in owned:
            errors.append(f"{rid}: check for an unknown requirement or one that is neither v1 nor v1.1")
    if errors:
        sys.exit("\n".join(errors))

    # Evidence comes from the owning WP's progress report: a table whose rows start
    # "| <ID> | <state> |" with a STANDARDS evidence state. The report is the single source of truth.
    states = {"verified", "validated", "plausible", "blocked", "unverified"}
    evidence = {}
    prog = D.parent / "progress"
    for f in sorted(prog.glob("PROGRESS-WP-*.md")) if prog.exists() else []:
        wp = f.stem.replace("PROGRESS-", "")
        for line in f.read_text().splitlines():
            m = re.match(r"^\| ([A-Z]{2}-\d\d) \| (\w+) \|", line)
            if m and m.group(2).lower() in states:
                rid, state = m.group(1), m.group(2).lower()
                if rid not in owned:
                    errors.append(f"{rid}: evidence in {f.name} for an unknown requirement or one that is neither v1 nor v1.1")
                elif owners[rid][0] != wp:
                    errors.append(f"{rid}: evidence in {f.name} but owned by {owners[rid][0]}")
                else:
                    evidence[rid] = f"{state} ([{wp}](../progress/{f.name}))"
    if errors:
        sys.exit("\n".join(errors))

    v1 = {k: v for k, v in owned.items() if v["rel"] == "v1"}
    v11 = {k: v for k, v in owned.items() if v["rel"] == "v1.1"}
    rest = ", ".join(f"{k} ({v['rel']})" for k, v in req_rows.items() if v["rel"] not in OWNED_RELEASES)
    header = ["| ID | Owner | Route | Concrete check | Evidence |", "|---|---|---|---|---|"]
    row = lambda rid, r: f"| {rid} | {owners[rid][0]} | {r['route']} | {CHECKS[rid]} | {evidence.get(rid, 'unverified')} |"
    out = ["# Mostra requirement-to-evidence matrix", "",
           "**Status:** Generated by `tools/design/evidence_matrix.py` from [REQUIREMENTS.md](REQUIREMENTS.md) and [WORK_PACKAGES.md](WORK_PACKAGES.md). The generator fails if any v1 or v1.1 requirement lacks exactly one owning work package or a concrete check. Evidence states follow STANDARDS (verified, validated, plausible, blocked, unverified). The Evidence column comes from the owning WP's progress report (`docs/progress/PROGRESS-WP-NN.md`, an evidence table whose rows begin `| <ID> | <state> |`). Rows without an entry read **unverified**. The phase closeout re-checks the v1 rows; the v1.1 rows close with the packages after the first release (D122).",
           "", f"v1 requirements: {len(v1)}. v1.1 requirements: {len(v11)}. Owned exactly once: {len(owned)}. Neither v1 nor v1.1 (D16): {rest}.",
           "", "## v1", ""] + header + [row(rid, r) for rid, r in v1.items()]
    if v11:
        out += ["", "## v1.1", "",
                "Built after the first release by the packages under \"After the first release\" in [WORK_PACKAGES.md](WORK_PACKAGES.md) (D122), under the same rules as v1.",
                ""] + header + [row(rid, r) for rid, r in v11.items()]
    text = "\n".join(out) + "\n"
    target = d / "EVIDENCE_MATRIX.md"
    if "--check" in sys.argv:
        if target.read_text() != text:
            sys.exit("docs/design/EVIDENCE_MATRIX.md is stale: run python3 tools/design/evidence_matrix.py")
    else:
        target.write_text(text)
    counts = {}
    for rid in owned:
        counts[owners[rid][0]] = counts.get(owners[rid][0], 0) + 1
    print("ok", len(v1), "v1 and", len(v11), "v1.1 requirements;", dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
