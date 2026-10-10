# Mostra seed (SP-58-C03-A)

**Mostra** is a standalone, open-source agent artifact runtime. Agents write ordinary React, and Mostra turns it into beautiful, stateful, interactive web artifacts that humans can view, answer, review and act on, while the answers flow back to the agent through any host.

This folder is the **seed** for Mostra's phase design. It was prepared on 2026-10-10 from Mirza's design conversation and eleven research reports, and approved by Mirza at 2026-10-10T07:05:13.203Z ([DECISIONS.md](DECISIONS.md)).

| | |
|---|---|
| **Program identity** | SP-58-C03-A in Mirza's Jcode program. The Jcode integration is SP-58-C03-B (D02). |
| **Status** | Product direction approved. Phase design not started. No work packages exist. |
| **Next unit** | SP-58-C03-A phase design, run from this seed only (D03) |
| **Repository** | To be created by the design session at `~/src/mostra` once Mirza has set up its location and write access. Public on GitHub as decided (D13). Account and organization steps are Mirza's ([STANDARDS.md](STANDARDS.md#consequential-actions)). |

## Reading order

1. [DECISIONS.md](DECISIONS.md): every approved decision with its source and rationale. This is the authority.
2. [PRODUCT.md](PRODUCT.md): the problem, users, vocabulary, journeys, scope, non-goals and invariants.
3. [ARCHITECTURE.md](ARCHITECTURE.md): the approved architecture direction. Each section ends with the questions C03-A settles.
4. [REQUIREMENTS.md](REQUIREMENTS.md): numbered requirements with release, source and verification route.
5. [JCODE_HOST.md](JCODE_HOST.md): what the first host needs, all of it through generic ports.
6. [STANDARDS.md](STANDARDS.md): engineering, verification, process and prose rules for all Mostra work.
7. [research/INDEX.md](../research/INDEX.md): the research reports and how to use them. Read individual reports where a design question needs their detail. [research/BRIEFS.md](../research/BRIEFS.md) has the exact prompts.

## What the phase design produces

The C03-A design session turns this seed into an implementation-ready dossier in the Mostra repository:
1. **Import.** Create the repository and copy this seed into `docs/design/`, with the research in `docs/research/`. From then on, the repository copy is the authority and this folder is history. Record the import in the first commit.
2. **Re-verify** the third-party facts the design depends on.
3. **Settle every "Open for C03-A" question** in [ARCHITECTURE.md](ARCHITECTURE.md) with Mirza. Confirm D33 (agent evaluations) first. Also settle Windows support, the publication authorization for accepted work packages, and the evaluation budget.
4. **Prototype what needs evidence:** the shadcn default base, terminal fidelity fixtures, the process and instance model, and Safari addressing.
5. **Design caller-first:** the artifact author's API, the client runtime hooks, the CLI and MCP tools, the host protocol and ports, and the extension contracts, each with two structurally different candidates where the shape is open.
6. **Write the dossier:** architecture, interfaces, data model, failure behavior, the requirement-to-evidence matrix, and work packages that each fit one fresh session and together deliver all of v1 (D16) in the priority order of D17.
7. **Present the complete design** for Mirza's approval. After approval, record the design acceptance and hand Mirza the first work-package assignment.

The design session writes no production code. Disposable prototypes in a scratch location are encouraged.

## Boundaries

- **Read only this seed** from Mirza's `jcode_program` (D03). Mostra design needs no other program file. Jcode source is not Mostra's to change.
- **No Jcode-specific code in Mostra** (D01). Jcode's needs are met through generic ports ([JCODE_HOST.md](JCODE_HOST.md)).
- **No capability guardrails** (D05). Hygiene that restricts strangers is required (D06).
- **Consequential actions** need Mirza's approval: public repository and organization creation, pushing, publishing, domains and spending ([STANDARDS.md](STANDARDS.md#consequential-actions)).
