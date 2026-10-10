# Mostra

Mostra is the agent artifact runtime: agents write ordinary React, Mostra turns it into stateful,
interactive web artifacts that people view, answer and act on, and the answers flow back to the
agent through any host. This file is for agents working **on this repository**. Agents writing
artifacts use the Skill (`skills/mostra/`, from WP-14).

## The dossier is the contract

`docs/design/` decides what Mostra is and how it is built; code implements it. Read
[docs/design/README.md](docs/design/README.md) for the reading order and which document owns
which kind of fact. When the code and the dossier disagree, or the dossier is silent on something
you need, stop that thread and bring Mirza the finding with a proposal. A changed decision needs
his approval and a `DECISIONS.md` entry. When in doubt, read more.

## Work happens in work packages

Each session implements one package: `docs/design/work-packages/WP-NN.md`, under the protocol in
[docs/design/work-packages/README.md](docs/design/work-packages/README.md). Evidence goes in
`docs/progress/PROGRESS-WP-NN.md`: one row per owned requirement, each closed by a check through
the real interface.

## Commands

- `pnpm check`: every CI gate, in parallel. `--affected` limits it to your change, `--job <name>`
  runs one CI job exactly as CI does, `--plan` shows what would run.
- `pnpm fix`: formatting, lint autofixes, regenerated references.
- `pnpm gen package|diagnostic|protocol-method`: start new things in the right shape.

Playbooks for recurring tasks are in [docs/agents/](docs/agents/); each ends in a completion
check. The second time you do something by hand, turn it into a generator or a playbook.

## Packages and boundaries

The package map is [REPO_STANDARDS §3](docs/design/REPO_STANDARDS.md#3-packages), and
`tools/package-map.ts` encodes it: dependency-cruiser fails any import the map doesn't allow. Each
package's `AGENTS.md` names the invariants it owns, its public interface and its tests.

## Invariants and their owners

These hold in every change ([PRODUCT, Rule strengths](docs/design/PRODUCT.md#rule-strengths)).
The owner is where the invariant is enforced; packages not built yet are named by their WP.

| Invariant | Owner |
|---|---|
| No content or capability guardrails | every package |
| Only capability-URL holders use an artifact; loopback by default | gateway, addressing (WP-05) |
| Published versions are immutable; humans see only published versions | publish, version store (WP-03) |
| Submissions are immutable, from the canonical draft, bound to version and view | interaction ledger (WP-06) |
| Drafts are never delivered as submissions | interaction ledger (WP-06) |
| A submission is durable before any delivery attempt | interaction ledger, outbox (WP-06) |
| Trusted controls render only in the shell's origin | shell (WP-07) |
| Non-OSI engines never bundled; licenses disclosed before install | license audit (`tools/license-audit`), plugins (WP-16) |
| Everything users install, embed or self-host is Apache-2.0 | repository lint, `LICENSE`, `NOTICE` |
| Interfaces evolve additively within a revision | `@mostra/protocol` schema snapshots, API reports |
| Hosts reach Mostra only through public ports and protocol | protocol server, conformance kit (WP-02, WP-12) |

Also: no telemetry; secrets and capability tokens stay out of every log and output; macOS and
Linux only for v1.0, failing closed with a diagnostic elsewhere.

## Repository discipline

- One branch per work package, `wp/NN-<short-name>`, from the accepted predecessor.
- Conventional Commits with the package as scope, each signed off: `git commit -s`. Commit
  coherent slices as you go.
- History is append-only: every change is a new commit. Work that isn't yours stays as it is.
- Every user-visible change to a published package carries a changeset (`pnpm changeset`).
- Third-party versions, licenses and behaviors are verified against a primary source on the day
  and recorded in `docs/design/VERIFIED_FACTS.md`.
- Agent-facing prose (the Skill, AGENTS.md files, MCP tool descriptions, CLI help, diagnostic
  hints) is drafted with Mirza and accepted by him (D74).

## Working with Mirza

- Find facts yourself. Ask Mirza for product choices, real tradeoffs, permissions, accounts,
  research or anything else you need, as one set of questions with your recommendation for each.
- Install any tool you need; large installs may use the external disk `Active` (D49).
- The only sub-agent is `fast-worker`, and only to summarize bulk reading from an explicit file
  list. Design, implementation, review and verification stay with you.
- After a self-contained stretch of work, tell Mirza a compaction fits: name the slices it can
  summarize and the material that must stay verbatim.
- Live model calls follow D34 and D64: announce every batch; any Anthropic model waits for his
  approval.
