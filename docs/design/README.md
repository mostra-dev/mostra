# Mostra design dossier (SP-58-C03-A)

**Mostra** is a standalone, open-source agent artifact runtime. Agents write ordinary React, and Mostra turns it into beautiful, stateful, interactive web artifacts that humans view, answer, review and act on, while the answers flow back to the agent through any host.

| | |
|---|---|
| **Program identity** | SP-58-C03-A in Mirza's Jcode program. The Jcode integration is SP-58-C03-B (D02) and needs no change to Mostra (D01). |
| **Status** | **Design accepted** by Mirza on 2026-10-10 ([DESIGN_ACCEPTANCE.md](DESIGN_ACCEPTANCE.md)). WP specifications are in [work-packages/](work-packages/). |
| **Authority** | This folder. The seed it started from was imported verbatim in commit `e1a5683`; the seed folder in Mirza's program is history (D03). |
| **Plan update** | 2026-10-16 (M20, D116 to D127): the remote server, relay and team features join v1; Windows and the terminal packages follow the first release as `v1.1`; new packages WP-28 to WP-32. 2026-10-22 (M34, D146): Windows moves into v1.0 as WP-W1 to WP-W3, built after WP-12; WP-32 is withdrawn. |
| **Next unit** | WP-16, extension contracts and plugin system (work-package mode). WP-31 is done (D168, [PROGRESS-WP-31](../progress/PROGRESS-WP-31.md)), released as Mostra 0.12.0: expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`, `mostra roster`, `share --cloud --respondent`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, respondent status through `useRespondents()`, the host protocol and the CLI, presence with opt-in cursor and selection through `usePresence()` as ephemeral traffic that is never stored, attribution of shared fields by a per-artifact key, the manifest's `team.visibility` (`private` unless the artifact opts in), the operator's `invitations` port and `roster.completed` event on a remote server, the kit's `team.roster` and `team.waits`, and `verify`'s second render after Chromium's own connection failure (CO-01 to CO-05, CO-07). WP-19 and WP-20 build the team components and mentions on these hooks. #132 and #135 are closed; #139 is on WP-17's milestone; #39, #46, #55, #85, #95, #111, #124 and #140 stay open on no milestone (D155 item 7). Windows x64 and arm64 are supported like macOS and Linux since WP-W3 (D153), and every package keeps the Windows legs green. Every WP session starts from [work-packages/PROMPT.md](work-packages/PROMPT.md) with only the `WORK PACKAGE` line changed. |

## Reading order

For a work-package session, read the files marked *always*, then the ones its WP specification names. When in doubt, read more.

1. **[DECISIONS.md](DECISIONS.md)** *(always)*: every approved decision, D01 to D168, with source messages M1 to M63. It is the authority.
2. **[PRODUCT.md](PRODUCT.md)** *(always)*: the problem, users, vocabulary, journeys J1 to J14, scope, non-goals and invariants.
3. **[STANDARDS.md](STANDARDS.md)** *(always)*: how all Mostra work is done, including labels, verification, prose and consequential actions.
4. **[ARCHITECTURE.md](ARCHITECTURE.md)** *(always)*: the settled architecture, the remote server (§15), and the resolution of every seed open question (§16).
5. **[INTERFACES.md](INTERFACES.md)**: the author API, browser protocol, bridge, host protocol, ports, results, CLI, MCP and diagnostics.
6. **[DATA_MODEL.md](DATA_MODEL.md)**: the home, identity and digests, ledger tables and constraints, the event catalog, limits and migrations.
7. **[FAILURE_MODEL.md](FAILURE_MODEL.md)**: failure, recovery and concurrency behavior for every case STANDARDS requires.
8. **[REQUIREMENTS.md](REQUIREMENTS.md)**: 166 numbered requirements (154 in v1, 7 in v1.1) with release, source and verification route.
9. **[WORK_PACKAGES.md](WORK_PACKAGES.md)**: 32 one-session work packages in D125 order (29 for v1, 3 after the first release), with ownership, dependencies and evidence.
10. **[EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md)**: one row per v1 and v1.1 requirement with its owning WP, route, concrete check and evidence state. Regenerate it with `python3 tools/design/evidence_matrix.py`.
11. **[REPO_STANDARDS.md](REPO_STANDARDS.md)**: the repository machinery (layout, packages, toolchain, CI, workflow, docs, releases).
12. **[JCODE_HOST.md](JCODE_HOST.md)**: what the first host needs, and the generic mechanism that meets each need.
13. **[VERIFIED_FACTS.md](VERIFIED_FACTS.md)**: third-party facts re-verified on 2026-10-10 and by each package since, and the prototype evidence.
14. **[evaluations/](evaluations/)**: agent-evaluation reports (EVAL-01, Base UI vs Radix).
15. **[rounds/](rounds/)**: the decision rounds as presented. ROUND-3 holds the detailed kit, demo, extension and shell shapes that D65 approved by reference. [DECISION_TREE.md](DECISION_TREE.md) is the working map of the rounds, retired at acceptance.
16. **[../research/INDEX.md](../research/INDEX.md)**: the research reports. They are design input, never authority.
17. **Mostra HQ** (private, cloned at `~/src/mostra-hq`): Mirza's business context, read as its own AGENTS.md lists. It is context, never authority, and nothing from it enters this repository (D127).

## One source of truth per kind of fact

| Kind | Lives in |
|---|---|
| What was decided and why | DECISIONS.md |
| Vocabulary, journeys, invariants | PRODUCT.md |
| How work is done | STANDARDS.md |
| Structure and flows | ARCHITECTURE.md |
| Names, types and semantics of public surfaces | INTERFACES.md (ROUND-3 for kit, demo and extension detail, by D65) |
| Stored data and its constraints | DATA_MODEL.md |
| Failure behavior | FAILURE_MODEL.md |
| Requirements | REQUIREMENTS.md |
| Who builds what, and its evidence | WORK_PACKAGES.md and EVIDENCE_MATRIX.md |
| Repository machinery | REPO_STANDARDS.md |
| Third-party facts | VERIFIED_FACTS.md |

When two documents disagree, STANDARDS' order of sources applies, and the mismatch is a finding to fix in the lower-ranked document.
