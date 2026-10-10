#!/usr/bin/env python3
"""Generate docs/design/EVIDENCE_MATRIX.md from REQUIREMENTS.md, WORK_PACKAGES.md and the checks below,
and fail if any v1 requirement lacks exactly one owner or any owned ID is unknown. Design-phase tool."""
import re, sys, pathlib

D = pathlib.Path(__file__).resolve().parents[2] / "docs" / "design"


def load():
    """Parse requirement rows and WP ownership from the dossier."""
    req_rows, owners, wp = {}, {}, None
    for line in (D / "REQUIREMENTS.md").read_text().splitlines():
        m = re.match(r"^\| ([A-Z]{2}-\d\d) \| (.+?) \| (v1\.x|v1|later) \| (.+?) \| (.+?) \|$", line)
        if m:
            rid, text, rel, src, route = m.groups()
            if rid in req_rows:
                sys.exit(f"duplicate requirement row {rid}")
            req_rows[rid] = dict(text=text, rel=rel, src=src, route=route)
    for line in (D / "WORK_PACKAGES.md").read_text().splitlines():
        m = re.match(r"^### (WP-\d\d)\.", line)
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
 "RT-07": "macOS and Linux CI legs green; simulated Windows platform fails closed with MOSTRA_PLATFORM_UNSUPPORTED before touching the home",
 "RT-08": "Lifecycle tests for daemon idle exit (with and without pending work), `daemon install` units generated, heap and watchdog limits applied, port leases reused after restart",
 "RT-09": "SIGKILL the supervisor with demo and PTY grandchildren running; next start reaps them by recorded PID and start time",
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
 "HO-01": "Every port exercised with and without host registration (conformance)",
 "HO-02": "Revision negotiation picks highest common; unsupported revision refused with the code (protocol suite)",
 "HO-03": "Rust crate: wire-type snapshot test, client integration against a real instance, spawn and attach, bundle cache; external: crates.io release",
 "HO-04": "SDK host registers ports, publishes, receives delivery, waits and reads results (integration)",
 "HO-05": "Conformance kit passes on standalone adapters and both reference hosts; broken host fails expected scenarios; baselines work",
 "HO-06": "Audit: no host-specific identifiers in core packages; every JCODE_HOST row maps to a conformance scenario; Mirza reviews",
 "HO-07": "Schema snapshot test fails on any non-additive change to protocol, browser protocol, CLI JSON or MCP tool schemas",
 "HO-08": "Conformance: host-chosen home; authoring directory removed; artifacts, versions and submissions still readable",
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
 "AX-09": "Every D60 command plus run and state implemented with contract tests",
 "AX-10": "Generated harness plugins for five harnesses are real copies and load in each harness's documented layout; external: at least Claude Code and Codex",
 "MC-01": "MCP conformance suite; scripted session create → results; HTTP hygiene tests; external: Claude Desktop or Codex",
 "MC-02": "ext-apps reference host renders the export; fields, submit and actions round-trip; CSP and variables declared; URL fallback offered; external: Claude Desktop and VS Code",
 "MC-03": "Each unavailable feature shows its explicit message in the MCP App (browser)",
 "EX-01": "Six contract packages published at 0.x with independent versions; compatibility tests in and out of range",
 "EX-02": "`mostra plugin validate` accepts valid manifests and reports each invalid field",
 "EX-03": "An unchanged third-party shadcn registry item installs; Mostra packs install through shadcn too",
 "EX-04": "Non-OSI fixture plugin refuses without --accept-license and installs with it; recorded in the lockfile; host pre-acceptance works",
 "EX-05": "Each first-party plugin passes `mostra plugin verify` against its baselines",
 "RS-01": "One test per D19 seam (mode field, use server contract and serializer, AsyncLocalStorage context, use client runtime, RenderMode)",
 "RS-02": "Mirza's review of SPA-mode completeness at WP-26; no SPA component marked temporary",
 "RM-01": "Bundle moves between homes keeping identity; ports and WorkerLauncher documented; MCP server stateless (handle-only test)",
 "EN-01": "LICENSE, NOTICE and DCO check present; CI rejects an unsigned commit",
 "EN-02": "Tooling baseline in place and pinned through catalogs; `pnpm check` equals CI",
 "EN-03": "CI job verifies every example and template with committed visual and ARIA baselines",
 "EN-04": "API Extractor, publint and attw gates fail on seeded violations",
 "EN-05": "Release dry run in CI; first real release with provenance after Mirza's account steps (external)",
 "EN-06": "Pinned action SHAs (lint), CodeQL, dependency review, Renovate minimum release age and Scorecard configured and running",
 "EN-07": "CI measured under 10 minutes for a typical pull request; seeded violations caught by each gate; lefthook hooks run",
 "LL-01": "Agent and viewer write the same artifact field concurrently; both see the conflict; state.changed events filtered by a host",
 "LL-02": "Policy none: no Submit control; submit API refused; state, actions and signals work",
 "LL-03": "Follow on: new version loads automatically; blocked by unsaved edits or orphans with the banner instead",
 "LL-04": "Live updates produce no durable events; producer lifecycle with viewers, subscriptions and always:true; ring buffer bounded",
 "LL-05": "Local URL works after a week of simulated time; revocation and rotation work; doctor warns about long-lived artifacts without an always-on daemon",
 "LL-06": "Long-lived templates (dashboard, tasks), conformance scenario and gallery entries exist and pass; evaluation scenarios include J11 and J12",
}


def main():
    d = D
    req_rows, owners = load()

    errors = []
    v1 = {k: v for k, v in req_rows.items() if v["rel"] == "v1"}
    for rid in v1:
        o = owners.get(rid, [])
        if len(o) != 1:
            errors.append(f"{rid}: owners {o}")
        if rid not in CHECKS:
            errors.append(f"{rid}: no check")
    for rid in owners:
        if rid not in v1:
            errors.append(f"{rid}: owned by {owners[rid]} but not a v1 requirement")
    for rid in CHECKS:
        if rid not in v1:
            errors.append(f"{rid}: check for unknown or non-v1 requirement")
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
                if rid not in v1:
                    errors.append(f"{rid}: evidence in {f.name} for an unknown or non-v1 requirement")
                elif owners[rid][0] != wp:
                    errors.append(f"{rid}: evidence in {f.name} but owned by {owners[rid][0]}")
                else:
                    evidence[rid] = f"{state} ([{wp}](../progress/{f.name}))"
    if errors:
        sys.exit("\n".join(errors))

    out = ["# Mostra requirement-to-evidence matrix", "",
           "**Status:** Generated by `tools/design/evidence_matrix.py` from [REQUIREMENTS.md](REQUIREMENTS.md) and [WORK_PACKAGES.md](WORK_PACKAGES.md). The generator fails if any v1 requirement lacks exactly one owning work package or a concrete check. Evidence states follow STANDARDS (verified, validated, plausible, blocked, unverified). The Evidence column comes from the owning WP's progress report (`docs/progress/PROGRESS-WP-NN.md`, an evidence table whose rows begin `| <ID> | <state> |`). Rows without an entry read **unverified**. The phase closeout re-checks the whole matrix.",
           "", f"v1 requirements: {len(v1)}. Owned exactly once: {len(v1)}. Not in v1 (D16): " + ", ".join(f"{k} ({v['rel']})" for k, v in req_rows.items() if v['rel'] != 'v1') + ".",
           "", "| ID | Owner | Route | Concrete check | Evidence |", "|---|---|---|---|---|"]
    for rid, r in v1.items():
        out.append(f"| {rid} | {owners[rid][0]} | {r['route']} | {CHECKS[rid]} | {evidence.get(rid, 'unverified')} |")
    (d / "EVIDENCE_MATRIX.md").write_text("\n".join(out) + "\n")
    counts = {}
    for rid in v1:
        counts[owners[rid][0]] = counts.get(owners[rid][0], 0) + 1
    print("ok", len(v1), "v1 requirements;", dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
