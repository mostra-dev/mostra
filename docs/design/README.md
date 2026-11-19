# Mostra design dossier (SP-58-C03-A)

**Mostra** is a standalone, open-source agent artifact runtime. Agents write ordinary React, and Mostra turns it into beautiful, stateful, interactive web artifacts that humans view, answer, review and act on, while the answers flow back to the agent through any host.

| | |
|---|---|
| **Program identity** | SP-58-C03-A in Mirza's Jcode program. The Jcode integration is SP-58-C03-B (D02) and needs no change to Mostra (D01). |
| **Status** | **Design accepted** by Mirza on 2026-10-10 ([DESIGN_ACCEPTANCE.md](DESIGN_ACCEPTANCE.md)). WP specifications are in [work-packages/](work-packages/). |
| **Authority** | This folder. The seed it started from was imported verbatim in commit `e1a5683`; the seed folder in Mirza's program is history (D03). |
| **Plan update** | 2026-10-16 (M20, D116 to D127): the remote server, relay and team features join v1; Windows and the terminal packages follow the first release as `v1.1`; new packages WP-28 to WP-32. 2026-10-22 (M34, D146): Windows moves into v1.0 as WP-W1 to WP-W3, built after WP-12; WP-32 is withdrawn. |
| **Next unit** | WP-18, Kit I: design system, tokens and forms (work-package mode); the maintenance unit MT-06, signing out ([its specification](work-packages/MT-06.md), #204 and #203), runs beside it. WP-17 is done (D175, [PROGRESS-WP-17](../progress/PROGRESS-WP-17.md)), released as Mostra 0.17.0: the same artifact source shows inline in chat hosts as an MCP App. `@mostra/plugin-mcp-app`, the first first-party plugin, exports a version as one self-contained `ui://mostra/view/<versionId>` page and comes with every home; `artifact_open` names the loader `ui://mostra/app`, which shows the version's page in the chat beside the full-page link; the page acts through its link over eleven app-only tools and the app channel (`app/open`, `app/request`, the gateway's own checked routes), in the host's look, with a bar for its save state, Submit and the full page, and says plainly what a chat host's frame can't do; a hosted home makes each version's page from its own files, so cloud chat hosts show it while the owner is away, per chat host (`chatHosts`, D160). #139 (the owner's log in the hosted order) and #157 (`artifact_verify` answering within 45 s and joining the run under way) are fixed; #210, CI's starved macOS jobs, is open. The maintenance unit MT-05 is done ([PROGRESS-MT-05](../progress/PROGRESS-MT-05.md)), released as Mostra 0.16.0 (D176): an operator's own clients named as the server's own on the consent page (`operatorClients`), GitHub's sign-in asking for `user:email` and carrying the primary address GitHub verified, a directory that keeps no sign-in's address, and an idle hosted home that writes nothing. The maintenance unit MT-04 is done ([PROGRESS-MT-04](../progress/PROGRESS-MT-04.md)), released as Mostra 0.15.2 with the phone bar's fix (#182): the Skill's showcase walkthrough (D174), `references/walkthrough.md` served as `mostra docs guide/walkthrough`, with which any agent asked "Should I use Mostra?" builds, publishes and grows one live page for its person's own work; the Skill's check now holds every Skill file to the commands, flags, wait conditions, `docs` topics, MCP tools and hooks the release has; the site's copy is in its report; #188 is on WP-20's milestone. WP-16 is done (D172, D173, [PROGRESS-WP-16](../progress/PROGRESS-WP-16.md)), released as Mostra 0.15.0 and 0.15.1: six extension contract packages at 0.1.0 (`@mostra/contract-embed-engine`, `-exporter`, `-verify-check`, `-anchor-provider`, `-connector`, `-cli-command`), each with its own version and a `define*` blueprint stamping its contract; the plugin manifest under `"mostra"`, validated by `mostra plugin validate` field by field; `mostra plugin add|list|remove` per artifact or for the whole home (`--global`), with contract ranges, load order and conflicts checked before any plugin code runs and again at verify and publish; packs as shadcn registry items, any of which `mostra add` installs as shadcn writes it; license classes from SPDX 3.29.0, `--accept-license` and `HomeConfig.licenses`, recorded in `lock.yaml`; exporters through `mostra export --as` and plugin commands in `mostra`; and the release age letting the contracts through (D173). WP-17 builds the MCP App exporter on the exporter contract; WP-25 the plugin author's local loop with `mostra plugin verify`. #135, #160, #164, #174, #175, #178, #183, #184 and #189 stay open on no milestone (D155 item 7; #183 left for later by Mirza). Windows x64 and arm64 are supported like macOS and Linux since WP-W3 (D153), and every package keeps the Windows legs green. Every WP session starts from [work-packages/PROMPT.md](work-packages/PROMPT.md) with only the `WORK PACKAGE` line changed. |

## Reading order

For a work-package session, read the files marked *always*, then the ones its WP specification names. When in doubt, read more.

1. **[DECISIONS.md](DECISIONS.md)** *(always)*: every approved decision, D01 to D176, with source messages M1 to M80. It is the authority.
2. **[PRODUCT.md](PRODUCT.md)** *(always)*: the problem, users, vocabulary, journeys J1 to J14, scope, non-goals and invariants.
3. **[STANDARDS.md](STANDARDS.md)** *(always)*: how all Mostra work is done, including labels, verification, prose and consequential actions.
4. **[ARCHITECTURE.md](ARCHITECTURE.md)** *(always)*: the settled architecture, the remote server (§15), and the resolution of every seed open question (§16).
5. **[INTERFACES.md](INTERFACES.md)**: the author API, browser protocol, bridge, host protocol, ports, results, CLI, MCP and diagnostics.
6. **[DATA_MODEL.md](DATA_MODEL.md)**: the home, identity and digests, ledger tables and constraints, the event catalog, limits and migrations.
7. **[FAILURE_MODEL.md](FAILURE_MODEL.md)**: failure, recovery and concurrency behavior for every case STANDARDS requires.
8. **[REQUIREMENTS.md](REQUIREMENTS.md)**: 174 numbered requirements (154 in v1, 15 in v1.1) with release, source and verification route.
9. **[WORK_PACKAGES.md](WORK_PACKAGES.md)**: 37 one-session work packages in D125 order (32 for v1, 5 after the first release: WP-33 to WP-35, homes an organization owns, D170, then the terminal packages) and the maintenance units, with ownership, dependencies and evidence.
10. **[EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md)**: one row per v1 and v1.1 requirement with its owning WP, route, concrete check and evidence state. Regenerate it with `python3 tools/design/evidence_matrix.py`.
11. **[REPO_STANDARDS.md](REPO_STANDARDS.md)**: the repository machinery (layout, packages, toolchain, CI, workflow, docs, releases).
12. **[JCODE_HOST.md](JCODE_HOST.md)**: what the first host needs, and the generic mechanism that meets each need.
13. **[VERIFIED_FACTS.md](VERIFIED_FACTS.md)**: third-party facts re-verified on 2026-10-10 and by each package since, and the prototype evidence.
14. **[evaluations/](evaluations/)**: agent-evaluation reports (EVAL-01, Base UI vs Radix).
15. **[rounds/](rounds/)**: the decision rounds as presented. ROUND-3 holds the detailed kit, demo, extension and shell shapes that D65 approved by reference; ORGANIZATION-HOMES holds D170's design, its candidates and its checks. [DECISION_TREE.md](DECISION_TREE.md) is the working map of the rounds, retired at acceptance.
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
