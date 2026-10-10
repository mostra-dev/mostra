# C03-A design acceptance

**Unit:** SP-58-C03-A phase design for Mostra v1.
**Accepted by:** Mirza, at 2026-10-10T14:55:06.757Z (M9 in [DECISIONS.md](DECISIONS.md)): "Q1: Approved!"
**Design state approved:** commit `c485549` ("Update the dossier index to D72"), as presented. Commits after it record the approval (M9, D73 to D75), add this file and the WP specifications, and run the approved EVAL-01b check. None of them changes an approved decision.

## What was accepted

- **Decisions D01 to D72**, with the source messages M1 to M8. D73 to D75 record the approval round itself.
- **The dossier:**
  - [ARCHITECTURE.md](ARCHITECTURE.md), [INTERFACES.md](INTERFACES.md), [DATA_MODEL.md](DATA_MODEL.md), [FAILURE_MODEL.md](FAILURE_MODEL.md), [REPO_STANDARDS.md](REPO_STANDARDS.md);
  - the refreshed [REQUIREMENTS.md](REQUIREMENTS.md): 140 requirements, 135 of them in v1;
  - [JCODE_HOST.md](JCODE_HOST.md) with every Jcode need mapped to a generic mechanism.
- **The plan:**
  - 27 work packages in [WORK_PACKAGES.md](WORK_PACKAGES.md), in D17 order, each sized for one fresh session;
  - [EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md): every v1 requirement owned by exactly one package and given a concrete check, enforced by `tools/design/evidence_matrix.py`.
- **The evidence the design rests on:**
  - [VERIFIED_FACTS.md](VERIFIED_FACTS.md): third-party facts re-verified on 2026-10-10, and prototypes for addressing, the instance model, terminal fidelity, cross-site frame sessions and the ledger engine;
  - [EVAL-01](evaluations/eval-01/EVAL-01.md).

## Conditions and open items carried into implementation

| Item | Where it is handled |
|---|---|
| EVAL-01b (Claude Sonnet check of the default base, D75) | Runs after Mirza signs in Claude Code. A Radix-favoring gap of 10 points or more overturns D72 before WP-18 starts |
| Shell visual design is a direction, not final (D68) | Final pass in WP-20, with design-focused review |
| Agent-facing prose (D74) | Drafted with Mirza in WP-14 (Skill, AGENTS.md), WP-15 (MCP descriptions) and the WP that adds each command or diagnostic |
| C03-B threshold (D73) | After WP-14, or later if implementation reorders work |
| Account steps only Mirza can do | npm organization, trusted publishers, the crates.io first-release token if needed (prepared by WP-11) |
| Hypothesis: a first crates.io publish needs a one-time token | Checked in WP-11 against crates.io's then-current documentation |
| Firefox service-worker install timeout seen once in the frame prototype | Test item in WP-13 |

## Rules that hold from here on

- The design is the contract. A WP that finds a contradiction stops and surfaces it, with a proposal, instead of working around it (STANDARDS). Changing an approved decision needs Mirza's explicit approval and an update to DECISIONS.md.
- Work-package specifications live in [work-packages/](work-packages/). Each one is the assignment for one session.
- Progress reports go in `docs/progress/`. The phase closeout re-checks the whole evidence matrix and writes `PHASE_COMPLETION.md`.
- [DECISION_TREE.md](DECISION_TREE.md) is retired as of this acceptance and kept only as history.
